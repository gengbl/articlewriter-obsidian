import { App, Modal, Notice, Plugin, PluginSettingTab, TAbstractFile, TFile, TFolder, type SettingDefinitionItem, type SettingDefinitionPage } from "obsidian";
import { ActionItem, ActionMenuModal, ChapterListModal, ConfirmModal, FolderPickerModal, MarkdownViewerModal, MultiFieldModal, NewStoryInput, NewStoryModal, PanelLine, StoryPickerModal, TextAreaPrompt, TextPanelModal, TextInputModal, VolumeBatchCreateModal } from "./modals";
import { LlmChatView } from "./llm_chat_view";
import { GenProgressView, type WritingStreamSink } from "./gen_progress_view";
import { StatusView, type StatusAction, type StatusChapterEntry, type StatusDetail, type StatusSnapshot, type StatusStoryEntry } from "./status_view";
import { chapterOutlineTemplate, countPureWords, FORESHADOW_TEMPLATE, formatLocalDateTime, md5, NOTES_TEMPLATE, outlineTemplate, WORLD_TEMPLATE } from "./story_types";
import { safeFilename } from "./story_types";
import { StoryManager, NO_VOL_MODE_MSG } from "./story_manager";
import { chKey, parseChKey } from "./state_doc";
import { buildDefaultLlmConf } from "./plugin_config";
import type { LlmConfigDoc, PluginConfig } from "./plugin_config";
import { DEFAULT_SYSTEM_GUIDE } from "./system_guide_default";
import { EMPTY_GUIDE_TEMPLATE } from "./guide_template_default";
import { DEFAULT_USAGE_GUIDE } from "./usage_guide_default";
import { assembleSystemPrompt, chatCompletion, chatStream, normalizeBaseURL, testConnection } from "./llm_client";
import type { Message } from "./llm_client";
import { findAiWordHits, mergeGuideCategories } from "./banned_words";
import { appendOutlineInstruction, buildChapterPrompt, buildChapterSummaryPrompt, buildContinuePrompt, buildPolishPrompt, buildReviewPrompt, buildRewritePrompt, buildStoryTypeSystemPrompt, buildVolRebuildPrompt, buildWritingContext, CHAPTER_SUMMARY_SYSTEM_PROMPT, checkOutlineCoverage, cleanAiText, embedAggHash, formatRetryNote, parseAggHash, serializeAggregateGuide, stripHeading, validateStoryTypeFormat, VOL_SUMMARY_SYSTEM_PROMPT, wordRangeFromGuides } from "./prompts";
import { parseChapterSelection, splitList, stripComments } from "./md_docs";

interface ArticleWriterSettings {
	workDir: string; // 写小说的文件夹（对齐 CLI --work_dir / /dir）；空=未初始化，首次用命令时弹选择器
	lastStory: string;
	autoOpenOnCreate: boolean;
	prevChapters?: number; // v0.1.4+：写作提示词「前文内容」窗口章数 N（缺省/非法按 CLI 默认 3；0=不注入前文）。卷模式窗口限本卷、跨卷缺口以各前卷《卷摘要》填充
	includeVolumeSummary?: boolean; // v0.1.4+：是否把整卷《卷摘要》注入写作上下文（含跨卷前卷摘要）；默认关——对齐 Python 原版严格 prev_n 语义，只注入最近 N 章
	llm?: PluginConfig; // LLM 多组模型配置 + system_prompt/desc_style（替代 ~/.articlewriter/config.json，存插件数据目录 data.json）
}

const DEFAULT_SETTINGS: ArticleWriterSettings = {
	workDir: "",
	lastStory: "",
	autoOpenOnCreate: true,
	prevChapters: 3,
};

export default class ArticleWriterPlugin extends Plugin {
	settings: ArticleWriterSettings = { ...DEFAULT_SETTINGS };
	manager!: StoryManager;
	private statusRefreshTimer: number | null = null; // 工作目录内文件变更 → 防抖刷新已打开状态面板的定时器
	private flatBlocked: string | null = null; // 仍为平面结构且整理失败的书名：章节/卷结构操作锁定，直至「按卷整理目录」成功

	/** v0.1.4+：data.json settings.prevChapters → 有效窗口章数 N（缺省/非法回落 CLI 默认 3；0=不注入前文） */
	private effectivePrevN(): number {
		const n = Math.floor(Number(this.settings.prevChapters ?? 3));
		return Number.isFinite(n) && n >= 0 ? n : 3;
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.manager = new StoryManager({
			app: this.app,
			getStoryRoot: () => this.settings.workDir,
			onStateChanged: () => this.notifyContextChanged(),
			getPrevChapters: () => this.effectivePrevN(), // v0.1.4+：实时读 data.json，改设置即时生效
			includeVolumeSummary: () => !!this.settings.includeVolumeSummary, // v0.1.4+：卷摘要注入开关（默认关）
			generateChapterSummary: async ({ label, sourceText, viaOutline }) => { // v0.1.4+：缺失/过期章节摘要的 LLM 延迟生成入口（对齐 CLI _summarize_chapter），无配置/失败返回 null
				const setup = this.getLlmSetup();
				if (!setup) return null;
				try {
					const t = await chatCompletion(
						setup.cfg,
						[
							{ role: "system" as const, content: CHAPTER_SUMMARY_SYSTEM_PROMPT },
							{ role: "user" as const, content: buildChapterSummaryPrompt(label, sourceText, viaOutline) },
						],
						{ max_tokens: 600, temperature: 0.4 }
					);
					return (t || "").trim() || null;
				} catch (e) {
					console.warn("[articlewriter] 章节摘要生成失败：", e);
					return null;
				}
			},
			generateVolumeSummary: async ({ volumeName, chapters }) => { // v0.1.4+：卷摘要全量重建——输入本卷全部成员章的新鲜 AI 摘要，取代旧增量合并滚动法
				const setup = this.getLlmSetup();
				if (!setup) return null;
				try {
					const lines = chapters.map((c) => ({ label: c.label, title: c.title, summary: c.summary }));
					const t = await chatCompletion(
						setup.cfg,
						[
							{ role: "system" as const, content: VOL_SUMMARY_SYSTEM_PROMPT },
							{ role: "user" as const, content: buildVolRebuildPrompt(volumeName, lines) },
						],
						{ max_tokens: 900, temperature: 0.4 }
					);
					return (t || "").trim() || null;
				} catch (e) {
					console.warn("[articlewriter] 卷摘要生成失败：", e);
					return null;
				}
			},
			onProgress: (msg) => { void this.notifyGenProgress(msg); }, // v0.1.4+：延迟生成的进度反馈（持久 Notice + 空闲超时兜底）；回调契约为 void，显式丢弃 Promise
		});
		await this.ensureSystemGuideFile(); // 首次运行把系统级写作指南从 data.json/内置默认播种到插件数据目录文件
		void this.ensureUsageDocOnStartup(); // 工作目录已设且《使用说明.md》缺失时：自动生成并打开（首跑引导）；真·首启无工作目录则等 pickWorkDir 投放

		this.addCommand({ id: "set-work-dir", name: "选择工作目录（work_dir，对齐 CLI --work_dir）", callback: () => this.pickWorkDir(false) });
		this.addCommand({ id: "switch-story", name: "切换当前小说（/dir：选书并加载其状态）", callback: () => this.cmdSwitchStory() });

		this.addCommand({ id: "new-story", name: "创建新小说（建书：小说文件夹+模板文档）", callback: () => this.cmdNewStory() });
		this.addCommand({ id: "new-chapter", name: "新建章节（章节目录+正文/大纲等文档）", callback: () => this.cmdNewChapter() });
		this.addCommand({ id: "insert-chapter", name: "插入章节（在选中章之前/之后新建，后续章节号自动顺延）", callback: () => void this.cmdInsertChapter() });
		this.addCommand({ id: "list-chapters", name: "章节列表（选择打开正文）", callback: () => this.cmdListChapters() });
		this.addCommand({ id: "open-outline", name: "打开总大纲 大纲.md", callback: () => this.cmdOpenOutline() });
		this.addCommand({ id: "open-worldview", name: "打开世界观 世界观.md", callback: () => this.cmdOpenDoc("世界观.md", WORLD_TEMPLATE) });
		this.addCommand({ id: "open-foreshadow", name: "打开伏笔记录 伏笔.md", callback: () => this.cmdOpenDoc("伏笔.md", FORESHADOW_TEMPLATE) });
		this.addCommand({ id: "open-notes", name: "打开笔记 笔记.md", callback: () => this.cmdOpenDoc("笔记.md", NOTES_TEMPLATE) });
		this.addCommand({ id: "next-chapter", name: "下一章（并打开正文）", callback: () => this.cmdNextOrPrev(1) });
		this.addCommand({ id: "prev-chapter", name: "上一章（并打开正文）", callback: () => this.cmdNextOrPrev(-1) });
		this.addCommand({ id: "count-current", name: "统计当前章节字数（纯文字）", callback: () => this.cmdCount() });
		this.addCommand({ id: "count-all", name: "统计全书各章字数与合计", callback: () => this.cmdCountAll() });
		this.addCommand({ id: "save-current", name: "保存当前章节（编辑器内容强制落盘）", callback: () => this.cmdSave() });
		this.addCommand({ id: "status", name: "小说状态（标题/类型/当前章节/总字数）", callback: () => this.cmdStatus() });

		this.addCommand({ id: "volume-list", name: "卷列表（含各卷章节数与当前标记）", callback: () => this.cmdVolumeList() });
		this.addCommand({ id: "volume-add", name: "新建卷（并设为当前卷，可顺带建章归属）", callback: () => this.cmdVolumeAdd() });
		this.addCommand({ id: "volume-manage", name: "管理卷（启用/改名/改描述/分配章节/删除）", callback: () => this.cmdVolumeManage() });
		this.addCommand({ id: "organize-volumes", name: "按卷整理目录（把书根下已归属各卷的章节移入对应卷实体目录；幂等可重复执行）", callback: () => void this.cmdOrganizeVolumes() });
		this.addCommand({ id: "volume-mode-off", name: "设为无卷模式（/volume off：拍平并删除全部卷，保持纯 书籍→章节 扁平结构；破坏性、需确认）", callback: () => void this.cmdVolumeMode(false) });
		this.addCommand({ id: "volume-mode-on", name: "启用有卷模式（/volume on：允许建卷/归卷/按卷整理目录）", callback: () => void this.cmdVolumeMode(true) });

		this.addCommand({ id: "scene-list", name: "场景列表（全部章节+全局未归属）", callback: () => this.cmdSceneList() });
		this.addCommand({ id: "scene-add", name: "新增场景（ID/简介/角色/正文/归属章节）", callback: () => this.cmdSceneAdd() });
		this.addCommand({ id: "scene-manage", name: "管理场景（切换/查看/编辑/移动/删除）", callback: () => this.cmdSceneManage() });

		this.addCommand({ id: "character-list", name: "人物列表（全部章节+全局）", callback: () => this.cmdCharacterList() });
		this.addCommand({ id: "character-add", name: "新增人物（身份/性别/性格/外貌/背景/能力等）", callback: () => this.cmdCharacterAdd() });
		this.addCommand({ id: "character-manage", name: "管理人员（查看/编辑/移动/改名/删除）", callback: () => this.cmdCharacterManage() });

		this.addCommand({ id: "foreshadow-list", name: "伏笔列表（全书 伏笔.md，含状态）", callback: () => this.cmdForeshadowList() });
		this.addCommand({ id: "foreshadow-add", name: "添加伏笔（章节/角色/原因）", callback: () => this.cmdForeshadowAdd() });
		this.addCommand({ id: "foreshadow-manage", name: "管理伏笔（标记完成/取消/删除）", callback: () => this.cmdForeshadowManage() });

		this.addCommand({ id: "world-show", name: "世界观总览（世界/类型/规则/势力/地点/历史/力量体系）", callback: () => this.cmdWorldShow() });
		this.addCommand({ id: "world-set", name: "设置世界观字段（世界/类型/规则/势力/地点/历史/力量体系）", callback: () => this.cmdWorldSet() });

		this.addCommand({ id: "outline-append-current", name: "追加当前章大纲（自动去重并提取 [伏] 伏笔）", callback: () => this.cmdOutlineAppendCurrent() });
		this.addCommand({ id: "open-chapter-outline", name: "打开当前章 章节大纲.md", callback: () => this.cmdOpenChapterOutline() });

		this.addCommand({ id: "chapter-delete", name: "删除章节（移入回收站并清理元数据）", callback: () => this.cmdChapterDelete() });
		this.addCommand({ id: "chapter-rename", name: "重命名章节标题（同步目录名与文档引用）", callback: () => this.cmdChapterRename() });
		this.addCommand({ id: "chapter-renumber", name: "重排全部章节编号为连续序号（含交叉引用改写）", callback: () => this.cmdChapterRenumber() });

		this.addCommand({ id: "pack-chapters", name: "打包章节合集（/pack：正文合辑单 MD，留空=当前章，支持 all/区间 3-7/列表 1、4、5；输出路径可自定义）", callback: () => this.cmdPackChapters() });
		this.addCommand({ id: "pack-volume", name: "导出卷合集（该卷全部章节正文合一 MD，默认 <书名>-<卷名>-合集.md；写字台卷节点右键同义入口）", callback: () => this.cmdPackVolume() });
		this.addCommand({ id: "rescan-story", name: "扫描重建小说状态文档（以磁盘为准）", callback: () => this.cmdRescanStory() });
		this.addCommand({ id: "set-style", name: "设置编写类型（网文小说/剧本/普通小说/散文随笔…）", callback: () => this.cmdSetStyle() });
		this.addCommand({ id: "agents-view", name: "查看创作规范 WRITING_GUIDE.md（对齐 CLI /agents view：小说级/用户级/系统级三层）", callback: () => this.cmdAgentsView() });
		this.addCommand({ id: "agents-edit", name: "编辑创作规范 WRITING_GUIDE.md（对齐 CLI /agents edit：小说级/用户级/系统级三层）", callback: () => this.cmdAgentsEdit() });
		this.addCommand({ id: "generate-writing-guide", name: "生成写作指南（在用户级 work_dir 与当前书目录各建一份同格式空模板；已存在非空则跳过并提示）", callback: () => this.cmdGenerateWritingGuide() });
		this.addCommand({ id: "regenerate-system-guide", name: "重新生成系统写作指南（按代码内置默认覆盖插件数据目录中的系统级 WRITING_GUIDE.md，需确认）", callback: () => this.cmdRegenerateSystemGuide() });
		this.addCommand({ id: "generate-usage-doc", name: "生成使用说明（在 work_dir 根建「使用说明.md」；已存在非空则跳过并提示）", callback: () => this.cmdGenerateUsageDoc() });
		this.addCommand({ id: "llm-test", name: "LLM 连接测试（/llm test：GET /models 验证当前激活配置）", callback: () => this.cmdLlmTest() });

		this.addCommand({ id: "write-chapter", name: "创作章节（/write：按大纲+指令 LLM 流式生成，自动去AI味后保存）", callback: () => this.cmdWrite() });
		this.addCommand({ id: "continue-writing", name: "续写当前章（/continue：按两级大纲在正文末尾继续）", callback: () => this.cmdContinueWriting() });
		this.addCommand({ id: "rewrite-chapter", name: "重写本章（/rewrite：基于大纲与旧文整体重构）", callback: () => this.cmdRewriteChapter() });
		this.addCommand({ id: "polish-text", name: "润色当前章（/polish：仅优化文字表达不改情节）", callback: () => this.cmdPolishText() });
		this.addCommand({ id: "deai-clean", name: "去AI味（/deai：含 AI 常用词的句子打回 LLM 重写并原位替换）", callback: () => this.cmdDeaiClean() });
		this.addCommand({ id: "review-chapter", name: "审阅本章（/review：全局视角查逻辑/连贯性问题出报告）", callback: () => this.cmdReviewChapter() });
		this.addCommand({ id: "llm-chat", name: "打开 LLM 对话窗口（常驻面板：多轮流式聊天，可停靠任意区域、切换已保存的模型配置）", callback: () => void this.openLlmPanel() });
		this.addCommand({ id: "status-page", name: "打开写字台（当前书/章节/文件一览，点击小说或章节可切换激活）", callback: () => void this.openStatusPanel() });

		this.registerView(LlmChatView.VIEW_TYPE, (leaf) => new LlmChatView(leaf, () => this.settings.llm, () => this.getChatSystemPrompt(), () => this.getActiveStoryInfo()));
		this.registerView(GenProgressView.VIEW_TYPE, (leaf) => new GenProgressView(leaf)); // v0.1.4+：摘要延迟生成的工作过程面板（notifyGenProgress 驱动）
		this.registerView(StatusView.VIEW_TYPE, (leaf) => new StatusView(leaf, () => this.getStatusSnapshot(), (name) => this.statusSwitchStory(name), (story, key) => this.statusActivateChapter(story, key), (a) => this.handleStatusAction(a)));
		this.addRibbonIcon("message-square", "打开 LLM 对话窗口（常驻面板）", () => void this.openLlmPanel());
		this.addRibbonIcon("book-open", "打开写字台（当前书/章节/文件）", () => void this.openStatusPanel());
		this.addSettingTab(new ArticleWriterSettingTab(this));

		// 工作目录内文件变更（编辑器写作自动落盘等）→ 防抖刷新所有已打开状态面板，让章节字数实时跟进写作进度
		const watchFile = (file: TAbstractFile) => {
			if (file instanceof TFile && file.path.endsWith(".md") && this.pathUnderWorkDir(file.path)) this.scheduleStatusPanelRefresh();
		};
		this.registerEvent(this.app.vault.on("modify", watchFile));
		this.registerEvent(this.app.vault.on("create", watchFile));
		this.registerEvent(this.app.vault.on("delete", watchFile));
		// 主窗口重命名/移动（文件列表右键改名、拖拽）：触发时 file.path 已是新路径，须同时看 oldPath 判断是否涉及工作目录（覆盖跨边界移入/移出 workDir），任一侧为 .md 即可能改变面板枚举
		const watchRename = (file: TAbstractFile, oldPath: string) => {
			if (!(file instanceof TFile)) return;
			if ((this.pathUnderWorkDir(file.path) || this.pathUnderWorkDir(oldPath)) && (file.path.endsWith(".md") || oldPath.endsWith(".md"))) this.scheduleStatusPanelRefresh();
		};
		this.registerEvent(this.app.vault.on("rename", watchRename));
	}

	async loadSettings(): Promise<void> {
		const saved = ((await this.loadData()) ?? {}) as Partial<ArticleWriterSettings> & { storyDir?: string };
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		if (!this.settings.workDir && saved.storyDir) this.settings.workDir = saved.storyDir; // 兼容旧设置键名
		if (!this.settings.llm) {
			// 首次运行（或 data.json 无 llm 段）：按 Python 用户配置文件结构预置标准模板，api_key/model_name 留空待填；不迁移旧的 ArticleWriter设置.md
			this.settings.llm = buildDefaultLlmConf();
			await this.saveData(this.settings);
			new Notice("已预置 3 组模型配置模板（local / deepseek / qwen-dashscope）\n请在 Obsidian 设置 → ArticleWriter 填写 api_key/模型名", 8000);
		} else if (this.settings.llm.system_guide === undefined) {
			// 旧数据补字段：系统级写作指南（CLI 内置层），不覆盖用户已有内容
			this.settings.llm.system_guide = DEFAULT_SYSTEM_GUIDE;
			await this.saveData(this.settings);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.notifyContextChanged(); // lastStory 等设置变更后同步刷新 LLM 面板顶部小说·章节行
	}

	// ---------- work_dir（首次使用必须选定写小说的文件夹）----------

	private async ensureWorkDir(): Promise<string | null> {
		const dir = this.settings.workDir.replace(/\/+$/, "");
		if (!dir) return this.pickWorkDir(true); // 首次使用：弹选择器初始化
		const f = this.app.vault.getAbstractFileByPath(dir);
		if (!(f instanceof TFolder)) {
			new Notice(`工作目录已不存在：${dir}，请重新选择`);
			return this.pickWorkDir(false);
		}
		return dir;
	}

	pickWorkDir(firstUse: boolean): Promise<string | null> {
		return new Promise((resolve) => {
			new FolderPickerModal(
				this.app,
				async (path) => {
					this.settings.workDir = path.replace(/\/+$/, "");
					this.settings.lastStory = ""; // 切换工作目录后清空旧小说记忆（对齐 CLI /dir）
					await this.saveSettings();
					let msg = firstUse ? `已初始化工作目录：${path || "vault 根"}` : `已切换工作目录：${path || "vault 根"}`;
					if (await this.seedUsageDoc()) msg += "；已在该目录创建《使用说明.md》"; // 设置/切换后把使用说明投放到 work_dir（已有非空则跳过）
					try {
						const stories = await this.manager.listStories();
						if (stories.length === 0) {
							msg += "；该目录下还没有书，请先用「创建新小说」建书";
						} else if (stories.length === 1) {
							this.settings.lastStory = stories[0]; // 唯一一本书时直接加载（对齐 CLI /dir 到已有小说目录）
							await this.saveSettings();
							msg += `；已加载唯一的小说：${stories[0]}`;
						} else {
							msg += `；共 ${stories.length} 本书，可用「切换当前小说」选择`;
						}
					} catch {
						/* 列表失败不影响切换结果 */
					}
					new Notice(msg, 8000);
					resolve(path);
				},
				() => resolve(null)
			).open();
		});
	}

	/** 切换当前小说（对齐 CLI /dir <work_dir>/<书名>：选书、设为当前并展示其状态） */
	async cmdSwitchStory(): Promise<void> {
		const dir = await this.ensureWorkDir();
		if (!dir) return;
		let stories: string[];
		try {
			stories = await this.manager.listStories();
		} catch (e) {
			this.notifyError("获取小说列表失败", e);
			return;
		}
		if (stories.length === 0) {
			new Notice(`工作目录下还没有书，请先用「创建新小说」建书`);
			return;
		}
		const items: ActionItem[] = [];
		for (const s of stories) {
			let sub = "";
			try {
				const state = await this.manager.loadState(s);
				const chCount = Object.keys(state?.chapters ?? {}).length;
				sub = `${chCount} 章`;
				if (state && state.current_chapter != null) sub += ` 当前第${String(state.current_chapter).padStart(2, "0")}章`;
			} catch {
				sub = "（状态读取失败）";
			}
			items.push({ label: s, sub, marker: s === this.settings.lastStory ? "▶ 当前" : undefined });
		}
		const idx = await this.pickAction("切换当前小说（/dir）", items);
		if (idx == null) return;
		this.settings.lastStory = stories[idx];
		await this.saveSettings();
		new Notice(`已切换到：${stories[idx]}`, 6000);
		await this.enforceVolumeLayoutOnSwitch(stories[idx]); // 平面结构 → 强制自动按卷整理（不可跳过）
		await this.cmdStatus(); // /dir 加载该书后展示章节与当前状态
	}

	// ---------- 活动小说解析：记住上次选择；多书时弹选择器 ----------

	private async activeStory(): Promise<string | null> {
		const stories = await this.manager.listStories();
		if (stories.length === 0) return null;
		if (this.settings.lastStory && stories.includes(this.settings.lastStory)) return this.settings.lastStory;
		if (stories.length === 1) {
			this.settings.lastStory = stories[0];
			await this.saveSettings();
			return stories[0];
		}
		return new Promise((resolve) => {
			new StoryPickerModal(
				this.app,
				stories,
				async (name) => {
					this.settings.lastStory = name;
					await this.saveSettings();
					resolve(name);
				},
				() => resolve(null)
			).open();
		});
	}

	/** 无小说时先引导建书 */
	private async requireStory(): Promise<string | null> {
		let story = await this.activeStory();
		if (story == null) {
			new Notice("还没有小说，请先用「创建新小说」建书");
			story = await this.cmdNewStory();
		}
		return story || null;
	}

	// ---------- 按卷实体目录：布局门禁与整理命令 ----------

	/** 「按卷整理目录」核心执行（命令入口与切换强制迁移共用），完成后弹结果摘要 */
	private async runOrganizeVolumes(story: string): Promise<void> {
		const r = await this.manager.organizeByVolumes(story);
		const parts: string[] = [];
		if (r.movedKeys.length) parts.push(`${r.movedKeys.length} 章移入卷实体目录`);
		if (r.unassignedAtRoot) parts.push(`${r.unassignedAtRoot} 个未归属章节留在书根（正常）`);
		for (const uc of r.unknownContainers) parts.push(`未识别容器「${uc.folder}」含 ${uc.keys.join("、")}`);
		new Notice(parts.length ? `按卷整理完成：${parts.join("；")}` : "目录已按卷就位，无需移动", 8000);
	}

	/** 全书一个卷都没有时：弹一次批量新建卷页面（手动加名单、确定后按序创建；取消/空列表 = 跳过直接继续），供手动整理与切换强制迁移共用 */
	private async promptCreateVolumesIfEmpty(story: string): Promise<void> {
		if ((await this.manager.volumeList(story)).length > 0) return;
		new Notice(`《${story}》当前没有任何卷：可先在弹出的页面里建几个卷（取消 = 跳过、直接继续）`, 6000);
		const names = await this.pickNewVolumeNames(story);
		if (!names || !names.length) return;
		await this.createVolumesInOrder(story, names);
	}

	/** 主动新建卷的统一入口页：列表式批量输入（手动添加卷名、可调顺序/删除，确定 → 按列表顺序依次创建）；返回 null = 取消或空列表 */
	private async pickNewVolumeNames(story: string): Promise<string[] | null> {
		let existing: string[] = [];
		try {
			existing = (await this.manager.volumeList(story)).map((v) => v.name);
		} catch { /* 读取失败不阻断弹框，重名校验由 addVolume 兜底报错 */ }
		return await new Promise<string[] | null>((resolve) => {
			let settled = false;
			const finish = (v: string[] | null) => {
				if (!settled) {
					settled = true;
					resolve(v);
				}
			};
			new VolumeBatchCreateModal(this.app, story, existing, (names) => finish(names.length ? names : null), () => finish(null)).open();
		});
	}

	/** 按列表顺序逐个建卷（单个失败不中断其余），最后成功创建的设为当前卷，末尾汇总通知；返回最后一个成功卷的 id（全失败为 null） */
	private async createVolumesInOrder(story: string, names: string[]): Promise<string | null> {
		const ok: string[] = [];
		const failed: string[] = [];
		let lastId: string | null = null;
		for (const n of names) {
			try {
				const vol = await this.manager.addVolume(story, n, ""); // 唯一名校验 + 自动建同名实体目录
				ok.push(vol.name);
				lastId = vol.id;
			} catch (e) {
				failed.push(`${n}（${e instanceof Error ? e.message : String(e)}）`);
			}
		}
		if (lastId != null) await this.manager.activateVolume(story, lastId); // 最后成功的成为当前卷
		const parts: string[] = [];
		if (ok.length) parts.push(`已创建 ${ok.join("、")}`);
		if (failed.length) parts.push(`未建成：${failed.join("；")}`);
		new Notice(parts.join("；"), 8000);
		return lastId;
	}

	/** v0.0.16+：切换该书工作模式。enabled=false=无卷（若有卷则先拍平迁移回书根并删除全部卷实体目录——破坏性、需二次确认）；enabled=true=有卷（仅置位）。完成后刷新写字台 */
	async cmdVolumeMode(enabled: boolean): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const cur = (await this.manager.loadState(story))?.use_volumes ?? false;
			if (cur === enabled) {
				new Notice(`《${story}》已是「${enabled ? "有卷" : "无卷"}」模式，无需切换。`, 6000);
				return;
			}
			let volCount = 0;
			let chInVols = 0;
			try {
				volCount = (await this.manager.volumeList(story)).length;
				chInVols = (await this.manager.listChapters(story)).filter((c) => c.vol != null).length;
			} catch { /* 统计失败不阻断开关本身 */ }
			if (!enabled && volCount > 0) { // 破坏性：拍平并删除全部卷 → 必须二次确认
				const ok = await this.confirmBox(
					`把《${story}》的全部 ${volCount} 个卷拍平回书根？`,
					`${chInVols} 章将从各卷目录移回书根并在书内重新连续编号；各卷残留的直属文档（如卷大纲/人物等设定四件套）也将挪出到书根，跨卷同名者前面加「<卷名>-」前缀以免覆盖；随后 ${volCount} 个卷实体目录与卷.md 元数据清除进回收站。此操作不可撤销（可去 Obsidian 回收站找回）。`,
					"确认切换为无卷"
				);
				if (!ok) return;
			}
			const r = await this.manager.setVolumeMode(story, enabled);
			this.flatBlocked = null;
			new Notice(
				enabled
					? `已启用「有卷模式」：现在可用「新建卷」「管理卷」「按卷整理目录」。`
					: r.flattened
						? `已切换为「无卷模式」：拍平 ${r.movedKeys.length} 章${r.movedDocs ? `、挪出 ${r.movedDocs} 份卷内文档` : ""}回书根、移除 ${r.deletedVolumes} 个卷，保持纯 书籍→章节 结构。`
						: `已切换为「无卷模式」（本就无卷，仅锁定扁平结构）。`,
				10000
			);
		} catch (e) {
			this.notifyError("切换工作模式失败", e);
		}
	}

	/** v0.0.16+：无卷模式书触发卷操作时先自动切到「有卷」模式（setVolumeMode(true) 仅置位、非破坏性），再继续原逻辑 */
	private async ensureVolumeModeEnabled(story: string): Promise<void> {
		if ((await this.manager.loadState(story))?.use_volumes !== false) return;
		await this.manager.setVolumeMode(story, true);
		new Notice(`《${story}》已启用「有卷」模式，继续…`, 6000);
	}

	async cmdOrganizeVolumes(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		await this.ensureVolumeModeEnabled(story); // v0.0.16+：无卷模式先自动转为有卷再整理
		try {
			await this.promptCreateVolumesIfEmpty(story); // 无卷 → 先弹批量建卷页（手动加名单，取消 = 跳过）
			if (!(await this.manager.volumeList(story)).length) new Notice("该书没有卷：全部章节将留在书根。如需分卷管理请先到「新建卷」建卷再整理。", 8000);
			await this.runOrganizeVolumes(story);
			this.flatBlocked = null;
			await this.assignUnassignedChapters(story); // 书根残留的无归属章节 → 逐个让用户选择归入哪个卷
		} catch (e) {
			this.notifyError("按卷整理失败", e);
		}
	}

	/** 按卷整理收尾：对仍留书根的无归属章节，引导用户逐章选择归入哪个卷（物理移目录+写归属字段）；仅一卷时一次确认整体移动 */
	private async assignUnassignedChapters(story: string): Promise<void> {
		try {
			const base = this.manager.storyPath(story);
			const unassigned = (await this.manager.listChapters(story)).filter((c) => c.parentPath === base && !c.vol).sort((a, b) => a.num - b.num);
			if (!unassigned.length) return;
			const vols = await this.manager.volumeList(story);
			if (!vols.length) {
				new Notice(`书根还有 ${unassigned.length} 个未归属章节且暂无可分配的卷：请先「新建卷」后再运行「按卷整理目录」。`, 8000);
				return;
			}
			let assigned = 0;
			if (vols.length === 1) {
				const ok = await this.confirmBox(
					`把 ${unassigned.length} 个未归属章节全部移入唯一的卷「${vols[0].name}」？`,
					"章节目录将物理移入该卷实体目录并写入归属字段。",
					"全部移入"
				);
				if (!ok) return;
				for (const ch of unassigned) {
					try { await this.manager.setChapterVolume(story, ch.key, vols[0].id); assigned++; } catch { /* 单章失败保留原地，继续其余 */ }
				}
			} else {
				const ok = await this.confirmBox(
					`发现 ${unassigned.length} 个留在书根的未归属章节`,
					"现在可以逐章选择它们归入哪个卷（章节目录会物理移入对应卷目录）；也可以稍后在「管理卷→分配章节」里处理。",
					"开始分配"
				);
				if (!ok) return;
				const STOP = vols.length + 1; // 选项下标：卷们 / 留书根 / 停止分配
				for (let i = 0; i < unassigned.length; i++) {
					const ch = unassigned[i];
					const idx = await this.pickAction(
						`${this.chapterLabel(ch.num, ch.title)} 放到哪个卷？`,
						[
							...vols.map((v) => ({ label: v.name, sub: v.description || v.id })),
							{ label: "留在书根", sub: "本章暂不归属任何卷" },
							{ label: "停止分配", sub: `剩余 ${unassigned.length - i - 1} 章保持原样` },
						]
					);
					if (idx == null || idx === STOP) break; // Esc 或选「停止分配」→ 结束本轮
					if (idx >= vols.length) continue; // 「留在书根」
					try { await this.manager.setChapterVolume(story, ch.key, vols[idx].id); assigned++; } catch { /* 单章失败保留原地，继续其余 */ }
				}
			}
			new Notice(`未归属章节处理完成：${assigned} 章已移入卷目录${assigned < unassigned.length ? `，其余 ${unassigned.length - assigned} 章仍留书根` : ""}`, 8000);
		} catch (e) {
			this.notifyError("分配未归属章节失败", e);
		}
	}

	/** 结构操作门禁：该书若仍有平面残留（书根下带卷归属的章节），先引导执行整理；取消则阻断本次操作 */
	private async ensureVolumeLayout(story: string): Promise<boolean> {
		if (this.flatBlocked === story) {
			new Notice("该书的章节目录尚未按卷整理完毕，章节/卷操作已锁定：请先运行「按卷整理目录」命令。", 10000);
			return false;
		}
		try {
			const nums = await this.manager.needsVolumeOrganize(story);
			if (!nums.length) return true;
			const ok = await this.confirmBox(
				`《${story}》还有 ${nums.length} 个已归属卷的章节留在书根`,
				"启用「章节按卷实体目录归位」前，需要先把这些章节移入对应卷目录。点击确定将立即自动整理，之后继续你刚才的操作。",
				"立即整理"
			);
			if (!ok) {
				new Notice(`已取消：请先手动运行「按卷整理目录」（共 ${nums.length} 章待归位）后再进行章节/卷操作。`, 10000);
				return false;
			}
			await this.runOrganizeVolumes(story);
			return (await this.manager.needsVolumeOrganize(story)).length === 0;
		} catch (e) {
			this.notifyError("检查章节目录布局失败", e);
			return false;
		}
	}

	/** 切换书籍后调用：检测到平面结构则强制自动按卷整理（不可跳过）；**全书无卷时先弹批量建卷页**（VolumeBatchCreateModal：手动加名单、确定后按序创建；取消/空列表 = 跳过），覆盖两种残留——有卷但章留书根、或零卷却存在未识别章节目录；失败时锁定该书的结构操作 */
	private async enforceVolumeLayoutOnSwitch(story: string): Promise<void> {
		try {
			const st0 = await this.manager.loadState(story);
			if (st0 && !st0.use_volumes) { // v0.0.16+：无卷模式的书刻意保持纯 书→章 扁平结构，跳过建卷/按卷整理引导
				this.flatBlocked = null;
				return;
			}
			const nums = await this.manager.needsVolumeOrganize(story); // 有卷时的平面残留（needsVolumeOrganize 对零卷书恒返回 []）
			let strayContainer = false;
			if (!nums.length) {
				strayContainer = (await this.manager.volumeList(story)).length === 0 &&
					(await this.manager.listChapters(story)).some((c) => c.parentPath !== this.manager.storyPath(story) && !c.vol); // 零卷 + 遗留子目录含章节 → 也视为待整理
			}
			if (!nums.length && !strayContainer) {
				this.flatBlocked = null;
				return;
			}
			await this.promptCreateVolumesIfEmpty(story); // 零卷 → 先弹建卷框（新建与遗留目录同名的卷，其内章节立即归属）
			new Notice(nums.length ? `《${story}》仍为平面结构（${nums.length} 章带卷归属），正在自动按卷整理…` : `《${story}》存在未识别章节目录，正在自动按卷整理…`, 5000);
			await this.runOrganizeVolumes(story);
			this.flatBlocked = (await this.manager.needsVolumeOrganize(story)).length ? story : null;
		} catch (e) {
			this.flatBlocked = story;
			this.notifyError("自动按卷整理失败", e);
			new Notice("章节/卷操作已临时锁定：请稍后手动运行「按卷整理目录」命令。", 12000);
		}
	}

	// ---------- 交互辅助 ----------

	private prompt(title: string, placeholder: string, hint?: string, initial?: string): Promise<string | null> { // v0.1.6+：可选 hint 渲染在输入框上方（详细说明），placeholder 只留极短占位；initial 预填初始值（光标置末尾）
		return new Promise((resolve) => {
			new TextInputModal(
				this.app,
				title,
				placeholder,
				(value) => resolve(value),
				() => resolve(null),
				hint,
				initial
			).open();
		});
	}

	private pickNewStoryInput(): Promise<NewStoryInput | null> {
		return new Promise((resolve) => {
			new NewStoryModal(this.app, (input) => resolve(input), () => resolve(null)).open();
		});
	}

	// ---------- 命令实现 ----------

	async cmdNewStory(): Promise<string | null> {
		if (!(await this.ensureWorkDir())) return null;
		const input = await this.pickNewStoryInput();
		if (!input) return null;
		try {
			const name = await this.manager.createStory(input.title, input.genre, input.style);
			this.settings.lastStory = name;
			await this.saveSettings();
			new Notice(`已创建小说「${name}」：文件夹与模板文档就绪`);
			if (this.settings.autoOpenOnCreate) {
				await this.manager.openMarkdown(`${this.manager.storyPath(name)}/大纲.md`);
			}
			return name;
		} catch (e) {
			new Notice(`创建失败：${(e as Error).message}`);
			return null;
		}
	}

	async cmdNewChapter(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		const chapters = await this.manager.listChapters(story);
		const curVol = ((await this.manager.loadState(story))?.current_volume ?? "").trim(); // 有当前卷 → 新章直接落卷实体目录并写归属字段（v0.0.15：编号在容器内自动顺延）
		const base = this.manager.storyPath(story);
		const inScope = curVol ? chapters.filter((c) => c.vol === curVol) : chapters.filter((c) => !c.vol && c.parentPath === base);
		const nextNum = inScope.length ? Math.max(...inScope.map((c) => c.num)) + 1 : 1;
		let volName = "";
		try { if (curVol) volName = this.manager.findVolumeIn(await this.manager.loadVolumes(story), curVol)?.name ?? curVol; } catch { volName = curVol; }
		const scopeLabel = curVol ? `卷「${volName}」` : "书根";
		const title = await this.prompt(`新建章节（将成为 ${scopeLabel}第${nextNum}章）`, "章节标题");
		if (title == null || !title.trim()) return;
		try {
			const bodyPath = await this.manager.createChapter(story, title.trim(), curVol);
			new Notice(`已创建 ${scopeLabel}第${String(nextNum).padStart(2, "0")}章-${title.trim()}：章节目录与文档就绪`);
			if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(bodyPath);
		} catch (e) {
			new Notice(`创建失败：${(e as Error).message}`);
		}
	}

	/** 在当前激活章（无则先选）之前/之后插入新空章节：本容器内 ≥插入位的各章整体 +1、引用同步重写（manager.insertChapter），完成后聚焦新章 */
	async cmdInsertChapter(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const chapters = await this.manager.listChapters(story);
			if (!chapters.length) {
				new Notice("还没有章节，先用「新建章节」创建第一章");
				return;
			}
			const volNames = await this.volNameMap(story);
			const cur = (await this.manager.loadState(story))?.current_chapter ?? null;
			let refIdx: number | null = cur != null ? chapters.findIndex((c) => c.key === cur) : -1;
			if (refIdx < 0) {
				refIdx = await this.pickAction(
					"选择参照章节（在其之前/之后插入）",
					chapters.map((c) => ({ label: this.keyLabel(c.key, volNames, c.title), marker: cur === c.key ? "▶ 当前" : undefined }))
				);
				if (refIdx == null) return;
			}
			const ref = chapters[refIdx];
			const posIdx = await this.pickAction(`相对 ${this.keyLabel(ref.key, volNames)} 的插入位置`, [
				{ label: `之前 → 新章成为第${String(ref.num).padStart(2, "0")}章，原该章及本容器后续各 +1` },
				{ label: `之后 → 新章成为第${String(ref.num + 1).padStart(2, "0")}章，其后的章各 +1` },
			]);
			if (posIdx == null) return;
			const newNum = posIdx === 0 ? ref.num : ref.num + 1;
			const t = await this.prompt(`新建第${newNum}章`, "章节标题");
			if (t == null) return;
			const title = t.trim() || String(newNum); // 留空沿用建章惯例：以编号作标题
			const r = await this.manager.insertChapter(story, ref.key, posIdx === 0 ? "before" : "after", title);
			new Notice(`${this.keyLabel(r.key, volNames, title)} 已插入；本卷内后续章节号与文档引用已顺延更新`, 6000);
			if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(r.path);
		} catch (e) {
			this.notifyError("插入章节失败", e);
		}
	}

	async cmdListChapters(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const chapters = await this.manager.listChapters(story);
		if (chapters.length === 0) {
			new Notice("还没有章节，先用「新建章节」创建第一章");
			return;
		}
		const state = await this.manager.loadState(story);
		const volNames = await this.volNameMap(story);
		new ChapterListModal(
			this.app,
			chapters.map((c) => ({ num: c.num, key: c.key, title: c.title, path: c.dir.path, isCurrent: state?.current_chapter === c.key, display: this.keyLabel(c.key, volNames, c.title) })),
			async (item) => {
				await this.manager.switchChapter(story, item.key ?? String(item.num));
				await this.manager.openMarkdown(`${item.path}/章节.md`);
			}
		).open();
	}

	/** 打开总大纲（缺失时按书名生成模板，对齐 CLI create_book_docs 的 大纲.md 初始内容） */
	async cmdOpenOutline(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.activeStory();
		if (!story) return;
		try {
			const state = await this.manager.loadState(story);
			await this.manager.openStoryDoc(story, "大纲.md", outlineTemplate((state?.title ?? "").trim() || story));
		} catch (e) {
			new Notice(`打开失败：${(e as Error).message}`);
		}
	}

	async cmdOpenDoc(docName: string, template: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.activeStory();
		if (!story) return;
		try {
			await this.manager.openStoryDoc(story, docName, template);
		} catch (e) {
			new Notice(`打开失败：${(e as Error).message}`);
		}
	}

	async cmdNextOrPrev(dir: 1 | -1): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const result = await this.manager.nextOrPrev(story, dir);
		if (!result) {
			new Notice("已到边界，没有更多章节");
			return;
		}
		await this.manager.openMarkdown(result.path);
		new Notice(`已切换到第${String(result.num).padStart(2, "0")}章`);
	}

	async cmdCount(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		if (state?.current_chapter == null) {
			new Notice("还没有当前章节，先新建或切换章节");
			return;
		}
		const rows = await this.manager.countWords(story, state.current_chapter);
		const row = rows[0];
		new Notice(row ? `第${String(row.num).padStart(2, "0")}章 ${row.title}：纯文字 ${row.words} 字` : "该章节无正文", 5000);
	}

	async cmdCountAll(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const rows = await this.manager.countWords(story);
		if (rows.length === 0) {
			new Notice("还没有章节");
			return;
		}
		let total = 0;
		for (const r of rows) total += r.words;
		new StatusModal(this.app, [
			"各章字数（只计纯文字字符）：",
			...rows.map((r) => `  第${String(r.num).padStart(2, "0")}章 ${r.title} ${r.words} 字`),
			`合计：${total} 字`,
		]).open();
	}

	async cmdSave(): Promise<void> {
		const words = await this.manager.saveCurrentChapter();
		if (words < 0) {
			new Notice("当前打开的不是 章节.md，无法保存");
			return;
		}
		new Notice(`已保存当前章节（纯文字 ${words} 字）`);
	}

	async cmdStatus(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.activeStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		if (!state) {
			new Notice("未找到小说状态文档（故事状态.md / story_state.json）");
			return;
		}
		const chapters = await this.manager.listChapters(story);
		let total = 0;
		for (const ch of chapters) {
			const f = this.app.vault.getAbstractFileByPath(`${ch.dir.path}/章节.md`);
			if (f instanceof TFile) total += countPureWords(await this.app.vault.read(f));
		}
		const lines: string[] = [
			`书名：${state.title}`,
			`题材：${state.genre || "-"} 编写类型：${state.writing_style || "-"}`,
			`当前章节：${state.current_chapter != null ? `第${String(state.current_chapter).padStart(2, "0")}章` : "无"}`,
		];
		let volName = "";
		try {
			if (state.current_volume) {
				const vols = await this.manager.loadVolumes(story);
				volName = this.manager.findVolumeIn(vols, state.current_volume)?.name ?? state.current_volume;
			}
		} catch {
			volName = state.current_volume || "";
		}
		lines.push(`当前卷：${volName || "-"} 当前场景：${state.current_scene || "-"}`);
		lines.push(`章节数：${chapters.length} 总字数（纯文字）：${total}`);
		lines.push(`创建：${formatLocalDateTime(state.created_at, true)} 更新：${formatLocalDateTime(state.updated_at, true)}`);
		new StatusModal(this.app, lines).open();
	}

	// ---------- 通用交互辅助 ----------

	private chapterLabel(num: number, title?: string): string {
		return `第${String(num).padStart(2, "0")}章${title ? ` ${title}` : ""}`;
	}

	/** v0.0.15：卷内编号的展示名（带卷前缀）："第二卷·第03章 标题" / "第05章 标题" */
	private keyLabel(key: string, volNames?: Record<string, string>, title?: string): string {
		const p = parseChKey(key);
		const base = this.chapterLabel(p.num, title);
		return p.vol ? `${volNames?.[p.vol] || p.vol}·${base}` : base;
	}

	/** 一次性构建 卷id→卷名 映射，供各命令展示用；失败返回空表（降级为显示卷 id） */
	private async volNameMap(story: string): Promise<Record<string, string>> {
		try {
			const vols = await this.manager.loadVolumes(story);
			const out: Record<string, string> = {};
			for (const [id, v] of Object.entries(vols)) out[id] = v.name;
			return out;
		} catch {
			return {};
		}
	}

	/** v0.0.15：场景/人物「归属章节」的展示名（本地号+容器卷前缀），0=全局 */
	private refLabel(num: number, vol: string | null | undefined, volNames?: Record<string, string>): string {
		if (!num) return "全局";
		return this.keyLabel(chKey(vol ?? null, num), volNames);
	}

	/** v0.0.15：把用户输入的裸章号解析到具体容器（跨卷同号逐个确认）；0=全局直通；不存在/取消 → null */
	private async resolveLocalNum(story: string, n: number, volNames: Record<string, string>): Promise<{ num: number; vol?: string } | null> {
		if (n === 0) return { num: 0 };
		const cands = (await this.manager.listChapters(story)).filter((c) => c.num === n);
		if (!cands.length) return null;
		if (cands.length === 1) return { num: n, vol: cands[0].vol };
		const ci = await this.pickAction(`「第${String(n).padStart(2, "0")}章」在多个容器里都存在，请选择`, cands.map((c) => ({ label: this.keyLabel(c.key, volNames, c.title) })));
		return ci == null ? null : { num: n, vol: cands[ci].vol };
	}

	private notifyError(prefix: string, e: unknown): void {
		new Notice(`${prefix}：${(e as Error)?.message || String(e)}`, 6000);
	}

	private pickAction(title: string, items: ActionItem[]): Promise<number | null> {
		return new Promise((resolve) => {
			new ActionMenuModal(this.app, title, items, (i) => resolve(i), () => resolve(null)).open();
		});
	}

	private confirmBox(title: string, message: string, label = "确认"): Promise<boolean> {
		return new Promise((resolve) => {
			new ConfirmModal(this.app, title, message, label, () => resolve(true), () => resolve(false)).open();
		});
	}

	/** 无当前章节时弹框询问章号（v0.0.15：返回复合键；裸号按容器解析，跨卷同号逐个确认） */
	private async requireChapterKey(story: string): Promise<string | null> {
		const state = await this.manager.loadState(story);
		if (state?.current_chapter != null) return state.current_chapter;
		const volNames = await this.volNameMap(story);
		const t = await this.prompt("没有当前章节", "请输入章节号（卷内本地号）");
		if (t == null) return null;
		const n = parseInt(t, 10);
		const ref = Number.isFinite(n) && n > 0 ? await this.resolveLocalNum(story, n, volNames) : null;
		if (!ref) { new Notice(`第${n ?? "?"}章不存在`); return null; }
		return chKey(ref.vol ?? null, ref.num);
	}

	// ---------- 卷（/volume）----------

	async cmdVolumeList(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const vols = await this.manager.volumeList(story);
			if (!vols.length) {
				new Notice("还没有卷，先用「新建卷」创建");
				return;
			}
			const state = await this.manager.validatedState(story);
			const chapters = await this.manager.listChapters(story); // v0.0.15：按卷过滤用实体目录清单（state.chapters 键已为复合键）
			const lines: Array<string | PanelLine> = [];
			for (const v of vols) {
				lines.push({ text: `${state.current_volume === v.id ? "◀ " : ""}${v.name}`, bold: true });
				if (v.description) lines.push(`  描述：${v.description}`);
				const assigned = chapters.filter((c) => c.vol === v.id).map((c) => this.chapterLabel(c.num));
				lines.push(assigned.length ? `  归属章节：${assigned.join("、")}` : "  暂无归属章节");
			}
			lines.push("");
			lines.push(`当前卷：${state.current_volume || "无"}（共 ${vols.length} 卷）`);
			new TextPanelModal(this.app, "卷列表", lines).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdVolumeAdd(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		await this.ensureVolumeModeEnabled(story); // v0.0.16+：无卷模式先自动转为有卷再建卷
		if (!(await this.ensureVolumeLayout(story))) return;
		const names = await this.pickNewVolumeNames(story); // 列表式批量新建卷页面（手动加名单、确定后按序创建）
		if (!names || !names.length) return;
		try {
			const lastId = await this.createVolumesInOrder(story, names);
			if (lastId == null) return; // 全部失败：汇总通知已给出原因
			let volName = lastId;
			try {
				volName = this.manager.findVolumeIn(await this.manager.loadVolumes(story), lastId)?.name ?? lastId;
			} catch { /* 名称回退用 id */ }
			const doChapter = await this.confirmBox("顺带建章", `是否立即创建一个新章节并归属到最后一个新建的卷「${volName}」？`, "创建");
			if (!doChapter) return;
			const chapters = await this.manager.listChapters(story);
			const inVol = chapters.filter((c) => c.vol === lastId); // v0.0.15：编号在目标卷内自动顺延
			const nextNum = inVol.length ? Math.max(...inVol.map((c) => c.num)) + 1 : 1;
			const t = await this.prompt(`新建第${nextNum}章（卷「${volName}」）`, "章节标题");
			if (t == null) return;
			const title = t.trim() || String(nextNum);
			const bodyPath = await this.manager.createChapter(story, title, lastId); // 直接落卷实体目录并写归属字段（位置即归属）
			new Notice(`${this.chapterLabel(nextNum, title)} 已创建并归属卷「${volName}」`);
			if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(bodyPath);
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	async cmdVolumeManage(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		await this.ensureVolumeModeEnabled(story); // v0.0.16+：无卷模式先自动转为有卷再管理卷
		if (!(await this.ensureVolumeLayout(story))) return;
		try {
			const vols = await this.manager.volumeList(story);
			if (!vols.length) {
				new Notice("还没有卷，先用「新建卷」创建");
				return;
			}
			const state = await this.manager.validatedState(story);
			const idx = await this.pickAction(
				"选择要管理的卷",
				vols.map((v) => ({ label: v.name, sub: v.description || v.id, marker: state.current_volume === v.id ? "▶ 当前" : undefined }))
			);
			if (idx == null) return;
			const vol = vols[idx];
			const chAll = await this.manager.listChapters(story); // v0.0.15：归属清单按复合键管理（本地号在卷内独立）
			const assigned = chAll.filter((c) => c.vol === vol.id).map((c) => ({ key: c.key, num: c.num, title: c.title }));
			const act = await this.pickAction(`管理卷「${vol.name}」`, [
				{ label: "启用此卷（设为当前卷并切到其最后一章）" },
				{ label: "重命名卷" },
				{ label: "编辑描述" },
				{ label: `把某章节分配到本卷${assigned.length ? `（现有 ${assigned.length} 章）` : ""}` },
				{ label: "解除本卷中某章节的归属", disabled: !assigned.length },
				{ label: "导出此卷合集（全部章节正文合一 MD，/pack 同款格式）", disabled: !assigned.length },
				{ label: "删除此卷（其章节变为未分配）" },
			]);
			if (act == null) return;
			switch (act) {
				case 0: {
					const r = await this.manager.activateVolume(story, vol.id);
					new Notice(r.num != null ? `已启用「${vol.name}」，切换到${this.chapterLabel(r.num)}` : `已将「${vol.name}」设为当前卷（暂无归属章节）`);
					if (r.path) await this.manager.openMarkdown(r.path);
					break;
				}
				case 1: {
					const n = await this.prompt("重命名卷", "新名称");
					if (!n || !n.trim()) break;
					const u = await this.manager.updateVolume(story, vol.id, { name: n.trim() });
					new Notice(u ? `已改名为「${u.name}」` : "改名失败：卷不存在");
					break;
				}
				case 2: {
					const d = await new Promise<string | null>((resolve) => {
						new TextAreaPrompt(this.app, "编辑描述", "卷的描述…", vol.description || "", "保存", (v) => resolve(v), () => resolve(null)).open();
					});
					if (d == null) break;
					await this.manager.updateVolume(story, vol.id, { description: d });
					new Notice("描述已更新");
					break;
				}
 			case 3: {
 				const t = await this.prompt("分配章节", "章节号：支持 all/全部、区间如 3-7（或 三至七）、列表如 1，4，5；跨卷同号时逐个确认");
 				if (t == null || !t.trim()) break;
 				const sel = parseChapterSelection(t, [...new Set(chAll.map((c) => c.num))].sort((a, b) => a - b)); // 复用打包合集同款表达式解析（去重升序）
 				if (sel.invalid.length) new Notice(`无法识别的片段已忽略：${sel.invalid.join("、")}`, 6000);
 				if (!sel.nums.length) {
 					new Notice("没有可分配的章节");
 					break;
 				}
 				const volNames2 = await this.volNameMap(story);
 				const resolvedKeys: string[] = [];
 				let skippedAmb = 0;
 				for (const n of sel.nums) {
 					const cands = chAll.filter((c) => c.num === n);
 					if (!cands.length) continue;
 					if (cands.length === 1) {
 						resolvedKeys.push(cands[0].key);
 					} else {
 						const ci = await this.pickAction(
 							`「第${String(n).padStart(2, "0")}章」在多个容器里都存在，选要移入本卷的那个`,
 							cands.map((c) => ({ label: `${this.keyLabel(c.key, volNames2, c.title)}${c.vol === vol.id ? "（已在本卷）" : ""}` }))
 						);
 						if (ci == null || ci < 0) { skippedAmb++; continue; } // Esc/取消 → 跳过该号继续其余
 						resolvedKeys.push(cands[ci].key);
 					}
 				}
 				if (!resolvedKeys.length) { new Notice("没有可分配的章节"); break; }
 				if (resolvedKeys.length > 1) {
 					const labels = resolvedKeys.map((k) => this.keyLabel(k, volNames2));
 					const shown = labels.length <= 12 ? labels.join("、") : `${labels.slice(0, 12).join("、")} …等共 ${labels.length} 章`;
 					const ok = await this.confirmBox(
 						`把以下 ${resolvedKeys.length} 个章节分配到卷「${vol.name}」？`,
 						shown + "。章节目录将物理移入该卷实体目录并写入归属字段。",
 						"确认分配"
 					);
 					if (!ok) break;
 				}
 				let done = 0;
 				for (const k of resolvedKeys) try { await this.manager.setChapterVolume(story, k, vol.id); done++; } catch { /* 单章失败保留原地，继续其余 */ }
 				new Notice(`${done}/${resolvedKeys.length} 章已归属卷「${vol.name}」${skippedAmb ? `；跳过未选择 ${skippedAmb} 号` : ""}${done < resolvedKeys.length ? "（个别失败请重试）" : ""}`, 8000);
 				break;
 			}
				case 4: {
					const ci = await this.pickAction(
						"选择要解除归属的章节",
						assigned.map((c) => ({ label: this.chapterLabel(c.num, c.title) }))
					);
					if (ci == null) break;
					await this.manager.unassignChapterVolume(story, assigned[ci].key);
					new Notice("已解除该章节的卷归属");
					break;
				}
			case 5: {
				const outText = await this.prompt(`导出卷「${vol.name}」`, "输出位置（留空用默认文件名）", [
				"将该卷全部章节的《章节.md》正文合一 MD（按章序排列），输出路径规则：",
				"· 留空 —— 存到该小说目录下 <书名>-<卷名>-合集.md（再次导出会覆盖同名文件）",
				"· 以 .md 结尾 —— 视为完整文件名，原样使用",
				"· 其他 —— 视为目标目录，自动拼上默认文件名 <书名>-<卷名>-合集.md",
			].join("\n"));
				if (outText == null) break;
				const r = await this.manager.packVolume(story, vol.id, outText.trim());
				const words = r.packed.reduce((s, p) => s + p.words, 0);
				new Notice(`已生成 ${r.path}（共 ${r.packed.length} 章，纯文字 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}）`, 8000);
				await this.manager.openMarkdown(r.path);
				break;
			}
				default: {
					const ok = await this.confirmBox(
						"删除卷？",
						`删除后，其下 ${assigned.length} 个章节的卷字段将被清空（章节本身保留）。此操作不可撤销。`,
						"删除"
					);
					if (!ok) break;
					const r = await this.manager.deleteVolume(story, vol.id);
					new Notice(r.deleted ? `已删除，共 ${r.movedKeys.length} 章被移出该卷` : "删除失败：卷不存在");
				}
			}
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	// ---------- 场景（/scene）----------

	async cmdSceneList(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const scenes = Object.values(await this.manager.loadAllScenes(story)).sort((a, b) => a.chapter_num - b.chapter_num || a.scene_id.localeCompare(b.scene_id));
			if (!scenes.length) {
				new Notice("还没有场景，先用「新增场景」创建");
				return;
			}
			const state = await this.manager.validatedState(story);
			const volNames = await this.volNameMap(story); // v0.0.15：归属展示带卷前缀
			const lines: Array<string | PanelLine> = [];
			for (const s of scenes) {
				lines.push({ text: `${state.current_scene === s.scene_id ? "◀ " : ""}${s.scene_id}`, bold: true });
				const bits = [this.refLabel(s.chapter_num, s.vol, volNames), s.characters?.length ? `角色：${s.characters.join("、")}` : "", s.description || ""].filter(Boolean);
				if (bits.length) lines.push(`  ${bits.join(" ")}`);
			}
			lines.push("");
			lines.push(`当前场景：${state.current_scene || "无"}（共 ${scenes.length} 个）`);
			new TextPanelModal(this.app, "场景列表", lines).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdSceneAdd(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		const defKey = state?.current_chapter ?? null; // v0.0.15：复合键 "volId:N" / "N"
		const volNames = await this.volNameMap(story);
		const curRef = defKey != null ? (() => { const p = parseChKey(defKey); return { num: p.num, vol: p.vol ?? undefined }; })() : null;
		const vals = await new Promise<Record<string, string> | null>((resolve) => {
			new MultiFieldModal(
				this.app,
				"新增场景",
				[
					{ key: "id", label: "场景 ID/标题", placeholder: "如：夜半天台" },
					{ key: "desc", label: "简介", placeholder: "一句话说明场景氛围/用途" },
					{ key: "chars", label: "在场角色", placeholder: '多个用「、」分隔' },
					{ key: "chap", label: "归属章节号（卷内本地号）", placeholder: `留空=${curRef ? `当前 ${this.refLabel(curRef.num, curRef.vol, volNames)}` : "无（全局）"}，0=全局未归属` },
					{ key: "notes", label: "备注" },
				],
				"下一步（正文）",
				(v) => resolve(v),
				() => resolve(null)
			).open();
		});
		if (!vals || !vals.id.trim()) return;
		const content = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, "场景正文（可选）", "描写该场景的环境/道具/关键动作…", "", "完成", (v) => resolve(v ?? ""), () => resolve(null)).open();
		});
		if (content == null) return;
		let chapNum = 0; let chapVol: string | undefined;
		const ct = (vals.chap ?? "").trim();
		if (ct !== "") {
			const n = parseInt(ct, 10);
			if (!Number.isFinite(n) || n < 0) {
				new Notice(`无效的章节号：${ct}`);
				return;
			}
			const ref = await this.resolveLocalNum(story, n, volNames); // v0.0.15：裸章号 → 具体容器
			if (!ref) { new Notice(`第${n}章不存在`); return; }
			chapNum = ref.num; chapVol = ref.vol;
		} else if (curRef) {
			chapNum = curRef.num; chapVol = curRef.vol;
		}
		try {
			await this.manager.addScene(story, {
				scene_id: vals.id.trim(),
				description: vals.desc,
				characters: splitList(vals.chars || ""),
				chapter_num: chapNum,
				vol: chapVol,
				notes: vals.notes,
				content,
			});
			new Notice(`已创建场景「${vals.id.trim()}」（${this.refLabel(chapNum, chapVol ?? null, volNames)}）`);
		} catch (e) {
			this.notifyError("创建失败", e);
		}
	}

	async cmdSceneManage(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const scenes = Object.values(await this.manager.loadAllScenes(story));
			if (!scenes.length) {
				new Notice("还没有场景，先用「新增场景」创建");
				return;
			}
			scenes.sort((a, b) => a.chapter_num - b.chapter_num || a.scene_id.localeCompare(b.scene_id));
			const state = await this.manager.validatedState(story);
			const volNames = await this.volNameMap(story); // v0.0.15：归属展示带卷前缀（s.vol 为加载时打标的运行态容器）
			const idx = await this.pickAction(
				"选择要管理的场景",
				scenes.map((s) => ({ label: s.scene_id, sub: `${this.refLabel(s.chapter_num, s.vol, volNames)} · ${s.description || ""}`.trim(), marker: state.current_scene === s.scene_id ? "▶ 当前" : undefined }))
			);
			if (idx == null) return;
			const scene = scenes[idx];
			const act = await this.pickAction(`管理场景「${scene.scene_id}」`, [
				{ label: "切换为当前场景（仅运行态）" },
				{ label: "查看详情" },
				{ label: "编辑信息（简介/角色/备注/归属章节）" },
				{ label: "删除此场景" },
			]);
			if (act == null) return;
			switch (act) {
				case 0: {
					await this.manager.switchScene(story, scene.scene_id);
					new Notice(`当前场景已切换到「${scene.scene_id}」（不影响当前章节）`);
					break;
				}
				case 1: {
					const lines: Array<string | PanelLine> = [
						{ text: scene.scene_id, bold: true },
						`归属：${this.refLabel(scene.chapter_num, scene.vol, volNames)}`,
					];
					for (const [k, v] of Object.entries({ 简介: scene.description, 角色: scene.characters?.join("、"), 备注: scene.notes })) if (v) lines.push(`${k}：${v}`);
					lines.push("", "---", "", scene.content || "（无正文）");
					new TextPanelModal(this.app, `场景详情 · ${scene.scene_id}`, lines).open();
					break;
				}
				case 2: {
					const vals = await new Promise<Record<string, string> | null>((resolve) => {
						new MultiFieldModal(
							this.app,
							`编辑场景「${scene.scene_id}」`,
							[
								{ key: "desc", label: "简介" },
								{ key: "chars", label: "在场角色", placeholder: '多个用「、」分隔' },
								{ key: "notes", label: "备注" },
								{ key: "chap", label: "归属章节号（卷内本地号）", placeholder: `当前=${this.refLabel(scene.chapter_num, scene.vol, volNames)}，留空不变；跨容器移动需同时改卷归属时请配合「管理卷→分配」` },
							],
							"保存",
							(v) => resolve(v),
							() => resolve(null),
							{ desc: scene.description ?? "", chars: (scene.characters ?? []).join("、"), notes: scene.notes ?? "", chap: "" }
						).open();
					});
					if (!vals) break;
					await this.manager.updateScene(story, scene.scene_id, { description: vals.desc, characters: splitList(vals.chars || ""), notes: vals.notes });
					const ct = (vals.chap ?? "").trim();
					if (ct !== "") {
						const n = parseInt(ct, 10);
						if (!Number.isFinite(n) || n < 0) new Notice(`无效的章节号：${ct}`);
						else {
							const ref = await this.resolveLocalNum(story, n, volNames); // v0.0.15：裸章号 → 具体容器（跨卷同号逐个确认）
							if (!ref) new Notice(`第${n}章不存在，未移动`);
							else if (ref.num === scene.chapter_num && (ref.vol ?? undefined) === (scene.vol ?? undefined)) { /* 同容器同号 → 不变 */ }
							else {
								await this.manager.updateScene(story, scene.scene_id, { chapter_num: ref.num, vol: ref.vol });
								new Notice(`已移动到 ${this.refLabel(ref.num, ref.vol ?? null, volNames)}`);
							}
						}
					} else new Notice("场景信息已保存");
					break;
				}
				default: {
					const ok = await this.confirmBox("删除场景？", `将删除「${scene.scene_id}」并清理其引用。`, "删除");
					if (!ok) break;
					const done = await this.manager.deleteScene(story, scene.scene_id);
					new Notice(done ? "已删除该场景" : "删除失败：场景不存在");
				}
			}
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	// ---------- 人物（/character）----------

	async cmdCharacterList(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const chars = Object.values(await this.manager.loadAllCharacters(story)).sort((a, b) => a.chapter - b.chapter || a.name.localeCompare(b.name));
			if (!chars.length) {
				new Notice("还没有人物，先用「新增人物」创建");
				return;
			}
			const lines: Array<string | PanelLine> = [];
			for (const c of chars) {
				lines.push({ text: c.name, bold: true });
				const bits = [c.chapter === 0 ? "全局" : this.chapterLabel(c.chapter), c.identity || "", c.gender ? `性别：${c.gender}` : ""].filter(Boolean);
				if (bits.length) lines.push(`  ${bits.join(" ")}`);
			}
			lines.push("");
			lines.push(`共 ${chars.length} 人`);
			new TextPanelModal(this.app, "人物列表", lines).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdCharacterAdd(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		const defKey = state?.current_chapter ?? null; // v0.0.15：复合键 "volId:N" / "N"
		const volNames = await this.volNameMap(story);
		const curRef = defKey != null ? (() => { const p = parseChKey(defKey); return { num: p.num, vol: p.vol ?? undefined }; })() : null;
		const vals = await new Promise<Record<string, string> | null>((resolve) => {
			new MultiFieldModal(
				this.app,
				"新增人物",
				[
					{ key: "name", label: "姓名（必填）" },
					{ key: "identity", label: "身份" },
					{ key: "age", label: "年龄" },
					{ key: "gender", label: "性别" },
					{ key: "personality", label: "性格" },
					{ key: "appearance", label: "外貌" },
					{ key: "background", label: "背景" },
					{ key: "abilities", label: "能力/技能", placeholder: '多个用「、」分隔' },
					{ key: "notes", label: "备注" },
					{ key: "chap", label: "归属章节号（卷内本地号）", placeholder: `留空=${curRef ? `当前 ${this.refLabel(curRef.num, curRef.vol, volNames)}` : "无（全局）"}，0=全局` },
				],
				"创建",
				(v) => resolve(v),
				() => resolve(null)
			).open();
		});
		if (!vals || !vals.name.trim()) return;
		let chapNum = 0; let chapVol: string | undefined;
		const ct = (vals.chap ?? "").trim();
		if (ct !== "") {
			const n = parseInt(ct, 10);
			if (!Number.isFinite(n) || n < 0) {
				new Notice(`无效的章节号：${ct}`);
				return;
			}
			const ref = await this.resolveLocalNum(story, n, volNames); // v0.0.15：裸章号 → 具体容器
			if (!ref) { new Notice(`第${n}章不存在`); return; }
			chapNum = ref.num; chapVol = ref.vol;
		} else if (curRef) {
			chapNum = curRef.num; chapVol = curRef.vol;
		}
		try {
			await this.manager.addCharacter(story, { name: vals.name.trim(), identity: vals.identity, age: vals.age, gender: vals.gender, personality: vals.personality, appearance: vals.appearance, background: vals.background, abilities: vals.abilities, notes: vals.notes, chapter: chapNum, vol: chapVol });
			new Notice(`已创建人物「${vals.name.trim()}」（${this.refLabel(chapNum, chapVol ?? null, volNames)}）`);
		} catch (e) {
			this.notifyError("创建失败", e);
		}
	}

	async cmdCharacterManage(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const chars = Object.values(await this.manager.loadAllCharacters(story));
			if (!chars.length) {
				new Notice("还没有人物，先用「新增人物」创建");
				return;
			}
			chars.sort((a, b) => a.chapter - b.chapter || a.name.localeCompare(b.name));
			const volNames = await this.volNameMap(story); // v0.0.15：归属展示带卷前缀（c.vol 为加载时打标的运行态容器）
			const idx = await this.pickAction(
				"选择要管理的人物",
				chars.map((c) => ({ label: c.name, sub: `${this.refLabel(c.chapter, c.vol, volNames)} · ${c.identity || ""}`.trim() }))
			);
			if (idx == null) return;
			const char = chars[idx];
			const act = await this.pickAction(`管理人员「${char.name}」`, [
				{ label: "查看详情" },
				{ label: "编辑信息（身份/年龄/性格/外貌/背景/能力等）" },
				{ label: `移动归属章节（当前：${this.refLabel(char.chapter, char.vol, volNames)}）` },
				{ label: "改名（全小说 MD 同步替换并自动备份）" },
				{ label: "删除此人（并清理各场景中的引用）" },
			]);
			if (act == null) return;
			switch (act) {
				case 0: {
					const lines: Array<string | PanelLine> = [{ text: char.name, bold: true }];
					for (const [k, v] of Object.entries({ 归属: this.refLabel(char.chapter, char.vol, volNames), 身份: char.identity, 年龄: char.age, 性别: char.gender, 性格: char.personality, 外貌: char.appearance, 背景: char.background, 能力: char.abilities?.join("、"), 备注: char.notes })) if (v) lines.push(`${k}：${v}`);
					new TextPanelModal(this.app, `人物详情 · ${char.name}`, lines).open();
					break;
				}
				case 1: {
					const vals = await new Promise<Record<string, string> | null>((resolve) => {
						new MultiFieldModal(
							this.app,
							`编辑「${char.name}」`,
							[
								{ key: "identity", label: "身份" },
								{ key: "age", label: "年龄" },
								{ key: "gender", label: "性别" },
								{ key: "personality", label: "性格" },
								{ key: "appearance", label: "外貌" },
								{ key: "background", label: "背景" },
								{ key: "abilities", label: "能力/技能", placeholder: '多个用「、」分隔' },
								{ key: "notes", label: "备注" },
							],
							"保存",
							(v) => resolve(v),
							() => resolve(null),
							{ identity: char.identity ?? "", age: char.age ?? "", gender: char.gender ?? "", personality: char.personality ?? "", appearance: char.appearance ?? "", background: char.background ?? "", abilities: (char.abilities ?? []).join("、"), notes: char.notes ?? "" }
						).open();
					});
					if (!vals) break;
					await this.manager.updateCharacter(story, char.name, { identity: vals.identity, age: vals.age, gender: vals.gender, personality: vals.personality, appearance: vals.appearance, background: vals.background, abilities: splitList(vals.abilities || ""), notes: vals.notes });
					new Notice(`已更新「${char.name}」`);
					break;
				}
				case 2: {
					const t = await this.prompt("移动归属章节", `新的章节号（卷内本地号，0=全局，当前=${this.refLabel(char.chapter, char.vol, volNames)}）`);
					if (t == null) break;
					const n = parseInt(t, 10);
					if (!Number.isFinite(n) || n < 0) new Notice(`无效的章节号：${t}`);
					else {
						const ref = await this.resolveLocalNum(story, n, volNames); // v0.0.15：裸章号 → 具体容器（跨卷同号逐个确认）
						if (!ref) new Notice(`第${n}章不存在`);
						else if (ref.num === char.chapter && (ref.vol ?? undefined) === (char.vol ?? undefined)) { /* 同容器同号 → 不变 */ }
						else {
							await this.manager.updateCharacter(story, char.name, { chapter: ref.num, vol: ref.vol });
							new Notice(`「${char.name}」已移动到 ${this.refLabel(ref.num, ref.vol ?? null, volNames)}`);
						}
					}
					break;
				}
				case 3: {
					const newName = await this.prompt(`改名「${char.name}」`, "新名字");
					if (!newName?.trim()) break;
					if (newName.trim() === char.name) {
						new Notice("新名字与旧名相同");
						break;
					}
					const r = await this.manager.renameCharacter(story, char.name, newName.trim());
					new Notice(r ? `已将 ${r.hits} 处「${char.name}」替换为「${newName.trim()}」（涉及 ${r.files} 个文件，原文件已备份到 _backup/）` : "未找到任何出现位置，未做修改", 8000);
					break;
				}
				default: {
					const ok = await this.confirmBox("删除人物？", `将删除「${char.name}」并清理各场景中的引用。如需保留请改用「改名」。`, "删除");
					if (!ok) break;
					const done = await this.manager.deleteCharacter(story, char.name);
					new Notice(done ? "已删除该人物" : "删除失败：人物不存在");
				}
			}
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	// ---------- 伏笔（/foreshadow）----------

	async cmdForeshadowList(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const items = await this.manager.loadForeshadows(story);
			if (!items.length) {
				new Notice("还没有伏笔记录");
				return;
			}
			const volNames = await this.volNameMap(story); // v0.0.15：it.chapter 为复合键，展示带卷前缀
			const lines: Array<string | PanelLine> = [];
			items.forEach((it, i) => {
				lines.push({ text: `${it.done ? "✔" : "○"} ${this.keyLabel(it.chapter, volNames)} #${(it.index ?? i) + 1}`, bold: !it.done });
				const bits = [it.character ? `人物：${it.character}` : "", it.reason || ""].filter(Boolean);
				if (bits.length) lines.push(`  ${bits.join(" ")}`);
			});
			lines.push("");
			lines.push(`共 ${items.length} 条，其中已完成 ${items.filter((i) => i.done).length} 条`);
			new TextPanelModal(this.app, "伏笔列表", lines).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdForeshadowAdd(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const key = await this.requireChapterKey(story); // v0.0.15：复合键
		if (key == null) return;
		const volNames = await this.volNameMap(story);
		const label = this.keyLabel(key, volNames);
		const character = await this.prompt(`${label} · 添加伏笔`, "涉及角色（可留空）");
		if (character == null) return;
		const reason = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, `${label} · 伏笔事由`, "埋了什么、为什么重要…", "", "保存", (v) => resolve(v), () => resolve(null)).open();
		});
		if (reason == null || !reason.trim()) return;
		try {
			const idx = await this.manager.addForeshadow(story, key, character, reason);
			new Notice(`已写入 伏笔.md：${label} 伏笔 #${idx + 1}`);
		} catch (e) {
			this.notifyError("添加失败", e);
		}
	}

	async cmdForeshadowManage(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const items = await this.manager.loadForeshadows(story);
			if (!items.length) {
				new Notice("还没有伏笔记录，先用「添加伏笔」创建");
				return;
			}
			const volNames = await this.volNameMap(story); // v0.0.15：item.chapter 为复合键
			const idx = await this.pickAction(
				"选择要管理的伏笔",
				items.map((it, i) => ({ label: `${it.done ? "✔" : "○"} ${this.keyLabel(it.chapter, volNames)} #${(it.index ?? i) + 1}`, sub: [it.character, it.reason].filter(Boolean).join(" ") }))
			);
			if (idx == null) return;
			const item = items[idx];
			const act = await this.pickAction(`管理 ${this.keyLabel(item.chapter, volNames)} 伏笔 #${(item.index ?? idx) + 1}`, [
				item.done ? { label: "取消完成标记" } : { label: "标记为已完成" },
				{ label: "删除这条伏笔" },
			]);
			if (act == null) return;
			const pos = item.index ?? idx;
			if (act === 0) {
				const ok = await this.manager.setForeshadowDone(story, item.chapter, pos, !item.done);
				new Notice(ok ? `已${!item.done ? "标记完成" : "取消完成"}` : "操作失败：未找到该条伏笔（可能已被其他操作改动，请重新打开列表）");
			} else {
				const confirmOk = await this.confirmBox("删除伏笔？", `[${[item.character, item.reason].filter(Boolean).join(" ") || "无内容"}]`, "删除");
				if (!confirmOk) return;
				const ok = await this.manager.deleteForeshadow(story, item.chapter, pos);
				new Notice(ok ? "已删除该条伏笔" : "删除失败：未找到该条伏笔");
			}
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	// ---------- 世界观（/world）----------

	async cmdWorldShow(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const ws = await this.manager.readWorldDoc(story);
			const lines: Array<string | PanelLine> = [];
			for (const [k, v] of Object.entries({ 世界: ws.name, 类型: ws.world_type, 规则: ws.rules?.length ? ws.rules.join("；") : "", 势力: ws.factions?.length ? ws.factions.join("、") : "", 地点: ws.locations?.length ? ws.locations.join("、") : "" })) if (v) lines.push(`${k}：${v}`);
			if (ws.history) lines.push("", "---", "", `历史：`, ws.history);
			if (ws.magic_system) lines.push("", "---", "", `力量体系：`, ws.magic_system);
			new TextPanelModal(this.app, "世界观总览", lines.length ? lines : ["（世界观.md 还是空的，用「设置世界观字段」填写）"]).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdWorldSet(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const field = await this.prompt("设置世界观", "字段名：世界 / 类型 / 规则 / 势力 / 地点 / 历史 / 力量体系");
		if (!field?.trim()) return;
		const value = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, `世界观 · ${field.trim()}`, "规则/势力/地点多个项可用「、」或分号分隔；历史与力量体系支持多行…", "", "保存", (v) => resolve(v), () => resolve(null)).open();
		});
		if (value == null) return;
		try {
			const ok = await this.manager.setWorldField(story, field, value);
			new Notice(ok ? `${field.trim()} 已写入 世界观.md` : `未知字段：${field.trim()}（可选：世界/类型/规则/势力/地点/历史/力量体系）`, 6000);
		} catch (e) {
			this.notifyError("写入失败", e);
		}
	}

	// ---------- 大纲追加 / 章节大纲打开 ----------

	async cmdOutlineAppendCurrent(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const key = await this.requireChapterKey(story); // v0.0.15：复合键
		if (key == null) return;
		const volNames = await this.volNameMap(story);
		const label = this.keyLabel(key, volNames);
		const content = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, `${label} · 追加大纲`, "写剧情要点；需要埋伏笔用 [伏]…[/] 包裹，将自动提取到 伏笔.md", "", "保存并追加", (v) => resolve(v), () => resolve(null)).open();
		});
		if (content == null || !content.trim()) return;
		try {
			const r = await this.manager.appendChapterOutline(story, key, content);
			if (!r.appended) new Notice("该内容已存在于本章大纲中，未重复追加");
			else new Notice(`已追加到 ${label} 的 章节大纲.md${r.foreshadows ? `，并提取 ${r.foreshadows} 条伏笔` : ""}`, 6000);
		} catch (e) {
			this.notifyError("追加失败", e);
		}
	}

	async cmdOpenChapterOutline(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const key = await this.requireChapterKey(story); // v0.0.15：复合键
		if (key == null) return;
		try {
			const f = await this.manager.chapterBodyFile(story, key);
			if (!f || !f.parent) {
				new Notice(`${this.keyLabel(key)} 没有正文文档`);
				return;
			}
			const path = `${f.parent.path}/章节大纲.md`;
			const num = parseChKey(key).num;
			const t = (await this.manager.listChapters(story)).find((c) => c.key === key)?.title ?? "";
			await this.manager.ensureDoc(path, chapterOutlineTemplate(num, t));
			await this.manager.openMarkdown(path);
		} catch (e) {
			this.notifyError("打开失败", e);
		}
	}

	// ---------- 章节删除 / 改名 / 重编号（对齐 chapters.py）----------

	private async pickChapterAction(title: string): Promise<{ key: string; num: number; title: string } | null> {
		const story = await this.requireStory();
		if (!story) return null;
		const chapters = await this.manager.listChapters(story);
		if (!chapters.length) {
			new Notice("还没有章节");
			return null;
		}
		const state = await this.manager.loadState(story);
		const volNames = await this.volNameMap(story); // v0.0.15：展示带卷前缀、按复合键比对当前章
		const idx = await this.pickAction(
			title,
			chapters.map((c) => ({ label: this.keyLabel(c.key, volNames, c.title), marker: state?.current_chapter === c.key ? "▶ 当前" : undefined }))
		);
		if (idx == null) return null;
		return { key: chapters[idx].key, num: chapters[idx].num, title: chapters[idx].title };
	}

	async cmdChapterDelete(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const picked = await this.pickChapterAction("选择要删除的章节");
		if (!picked) return;
		const story = (this.settings.lastStory || (await this.requireStory()));
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const ok = await this.confirmBox(`删除${this.chapterLabel(picked.num, picked.title)}？`, "章节目录将移入 Obsidian 回收站，元数据与卷归属一并清理；若为当前章节则回退到最后一章。本容器内其后的各章会自动重新排号、保持连续编号。", "删除");
			if (!ok) return;
			const r = await this.manager.deleteChapter(story, picked.key); // v0.0.15：复合键
			new Notice(`${this.chapterLabel(picked.num, picked.title)} 已删除（可在回收站找回）${r.resequenced ? "；后续章节已自动重新排号为连续" : ""}`);
		} catch (e) {
			this.notifyError("删除失败", e);
		}
	}

	async cmdChapterRename(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		const picked = await this.pickChapterAction("选择要重命名的章节");
		if (!picked) return;
		const t = await this.prompt(`重命名 ${this.chapterLabel(picked.num)}`, `新标题（当前：${picked.title}）`);
		if (!t?.trim()) return;
		try {
			const newTitle = await this.manager.renameChapter(story, picked.key, t.trim()); // v0.0.15：复合键
			new Notice(`已改名为 ${this.chapterLabel(picked.num, newTitle)}，目录与文档引用已同步`, 6000);
		} catch (e) {
			this.notifyError("改名失败", e);
		}
	}

	async cmdChapterRenumber(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		const ok = await this.confirmBox(
			"重排全部章节编号？",
			"所有章节目录将按现有顺序从第1章起连续重新编号，各文档中的「第N章 / 章节：N」交叉引用与伏笔编号会一并改写。建议先保存所有打开的编辑。",
			"开始重排"
		);
		if (!ok) return;
		try {
			const r = await this.manager.renumberChapters(story);
			new Notice(r.msg || (r.ok ? "已完成重排" : "未完成"), 8000);
		} catch (e) {
			this.notifyError("重排失败", e);
		}
	}

	// ---------- 打包合集（/pack）----------

	async cmdPackChapters(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const specText = await this.prompt("打包章节合集", "输入范围表达式（留空=仅当前章）", [
			"将所选范围内章节的《章节.md》正文合一 MD、按阅读序排列：",
			"· 留空 —— 只打当前章",
			"· all / 全部 —— 整本书（书根未归卷章节 + 各卷）",
			"· 区间 —— 如 3-7 或 三至七（容器内本地章号，自动升序）",
			"· 列表 —— 如 1、4、5（逗号/顿号/空格分隔均可）",
			"· 多卷可加卷名前缀限定范围，如 「风起 3-7」（裸号跨多个容器会报歧义，请加前缀区分）",
		].join("\n"));
		if (specText == null) return;
		const outText = await this.prompt("输出路径", "输出位置（留空用默认文件名）", [
			"· 留空 —— 存到该小说目录下 <书名>-第X-Y章-合集.md（单章为 <书名>-第X章-合集.md；重打包覆盖同名文件）",
			"· 以 .md 结尾 —— 视为完整文件名，原样使用",
			"· 其他 —— 视为目标目录，自动拼上默认文件名",
		].join("\n"));
		if (outText == null) return;
		try {
			const r = await this.manager.packChapters(story, specText.trim(), outText.trim());
			const words = r.packed.reduce((s, p) => s + p.words, 0);
			new Notice(`已生成 ${r.path}（${r.packed.length} 章，纯文字共 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}）`, 8000);
			await this.manager.openMarkdown(r.path);
		} catch (e) {
			this.notifyError("打包失败", e);
		}
	}

	async cmdPackVolume(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		await this.ensureVolumeModeEnabled(story); // v0.0.16+：无卷模式先自动转为有卷再导出
		if (!(await this.ensureVolumeLayout(story))) return; // 平面残留先归位，位置才等于归属
		try {
			const vols = await this.manager.volumeList(story);
			if (!vols.length) {
				new Notice("还没有卷，先用「新建卷」创建");
				return;
			}
			const state = await this.manager.validatedState(story);
			const chs = await this.manager.listChapters(story);
			const idx = await this.pickAction(
				"选择要导出的卷",
				vols.map((v) => ({ label: v.name, sub: `${chs.filter((c) => c.vol === v.id).length} 章${v.description ? ` · ${v.description}` : ""}`, marker: state.current_volume === v.id ? "▶ 当前" : undefined }))
			);
			if (idx == null) return;
			const vol = vols[idx];
			const outText = await this.prompt(`导出卷「${vol.name}」`, "输出位置（留空用默认文件名）", [
				"将该卷全部章节的《章节.md》正文合一 MD（按章序排列），输出路径规则：",
				"· 留空 —— 存到该小说目录下 <书名>-<卷名>-合集.md（再次导出会覆盖同名文件）",
				"· 以 .md 结尾 —— 视为完整文件名，原样使用",
				"· 其他 —— 视为目标目录，自动拼上默认文件名 <书名>-<卷名>-合集.md",
			].join("\n"));
			if (outText == null) return;
			const r = await this.manager.packVolume(story, vol.id, outText.trim());
			const words = r.packed.reduce((s, p) => s + p.words, 0);
			new Notice(`已生成 ${r.path}（卷「${vol.name}」共 ${r.packed.length} 章，纯文字 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}）`, 8000);
			await this.manager.openMarkdown(r.path);
		} catch (e) {
			this.notifyError("导出失败", e);
		}
	}

	// ---------- 扫描重建 / 编写类型 ----------

	async cmdRescanStory(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const r = await this.manager.rescanStory(story);
			new Notice(`扫描完成：章节 ${r.chapters} 个，总字数（纯文字）${r.totalWords}${r.createdDocs ? `，补齐缺失模板文档 ${r.createdDocs} 份` : ""}${r.volumeFixed ? `，修正与目录位置不一致的卷归属字段 ${r.volumeFixed} 处` : ""}`, 6000);
		} catch (e) {
			this.notifyError("扫描失败", e);
		}
	}

	async cmdSetStyle(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const t = await this.prompt("设置编写类型", "如：网文小说 / 剧本 / 普通小说 / 散文随笔");
		if (!t?.trim()) return;
		try {
			const style = await this.manager.setWritingStyle(story, t.trim());
			new Notice(`编写类型已设为「${style}」`);
		} catch (e) {
			this.notifyError("设置失败", e);
		}
	}

	// ---------- 创作规范 WRITING_GUIDE.md（三层：小说级 <书名>/ > 用户级 <work_dir>/ > 系统级插件设置 data.json，对齐 CLI /agents view/edit） ----------

	/** 系统级指南文件路径：插件数据目录 .obsidian/plugins/<id>/WRITING_GUIDE.md（不被元数据索引收录，走 DataAdapter 读写） */
	private systemGuidePath(): string {
		return `${this.app.vault.configDir}/plugins/${this.manifest.id}/WRITING_GUIDE.md`;
	}

	/** 首次运行确保系统级文件存在：缺失则用 data.json 内嵌内容（旧版迁移）或内置默认播种；失败不阻断启动 */
	private async ensureSystemGuideFile(): Promise<void> {
		try {
			const p = this.systemGuidePath();
			if (!(await this.manager.pluginFileExists(p))) {
				const sg = this.settings.llm?.system_guide; // 旧版内嵌内容作一次性迁移种子
				const seed = sg && sg.trim() ? sg : DEFAULT_SYSTEM_GUIDE;
				await this.manager.writePluginFile(p, seed);
			}
		} catch (e) {
			console.warn("[ArticleWriter] 初始化系统级写作指南失败", e);
		}
	}

	/** 读取系统级生效文本；读不到/为空回落内置默认（提示词永不缺底层规范） */
	private async readSystemGuideText(): Promise<string> {
		const t = await this.manager.readPluginFile(this.systemGuidePath());
		return t && t.trim() ? t : DEFAULT_SYSTEM_GUIDE;
	}

	private guideLayers(story: string): Array<{ label: string; path?: string }> {
		return [
			{ label: `小说级 ${this.manager.bookGuidePath(story)}`, path: this.manager.bookGuidePath(story) },
			{ label: `用户级 ${this.manager.userGuidePath()}`, path: this.manager.userGuidePath() },
			{ label: `系统级 ${this.systemGuidePath()}` }, // 无 path→走插件数据目录文件（只读面板查看、全量保存覆盖）
		];
	}

	private async readGuideLayer(l: { label: string; path?: string }): Promise<string> {
		if (l.path) return (await this.manager.readGuideAt(l.path)) ?? "";
		return await this.readSystemGuideText();
	}

	private async writeGuideLayer(l: { label: string; path?: string }, text: string): Promise<void> {
		if (l.path) await this.manager.writeGuideAt(l.path, text);
		else await this.manager.writePluginFile(this.systemGuidePath(), text);
	}

	// ---------- 三层创作规范 → 书籍目录下《写作指南汇总.md》（变更检测：头部记录三层原文 md5，任一层变化即重算落盘；提示词仅注入该汇总正文）----------

	private aggregatePath(story: string): string {
		return `${this.manager.storyPath(story)}/写作指南汇总.md`;
	}

	/** 合并三层→序列化为可再解析的 MD；按需把带 hash 头的汇总文件写入书目录；返回注入用正文（去 HTML 注释）与合并结果 */
	private async persistAggregatedGuide(story: string, bookText: string, userText: string, systemText: string): Promise<{ guideText: string; merged: Record<string, string> }> {
		const layers = [bookText, userText, systemText].filter((t) => t.trim()); // 顺序=优先级：小说级 > 用户级 > 系统级
		const merged = mergeGuideCategories(layers);
		const body = serializeAggregateGuide(merged);
		const h = { b: md5(bookText), u: md5(userText), s: md5(systemText) };
		try {
			const p = this.aggregatePath(story);
			const existing = await this.manager.readGuideAt(p); // null=尚未生成
			const prev = existing ? parseAggHash(existing) : null;
			if (existing == null || !prev || prev.b !== h.b || prev.u !== h.u || prev.s !== h.s) {
				await this.manager.writeGuideAt(p, embedAggHash(body, h));
			}
		} catch { /* 汇总落盘失败不影响提示词构建 */ }
		return { guideText: stripComments(body).trim(), merged };
	}

	/** 读三层→合并→落盘汇总文件，返回注入正文与禁用词类目文本（写作命令/对话面板共用） */
	private async rebuildAggregatedGuide(story: string): Promise<{ guideText: string; bannedGuideText: string }> {
		const bookText = (await this.manager.readGuideAt(this.manager.bookGuidePath(story))) ?? "";
		const userText = (await this.manager.readGuideAt(this.manager.userGuidePath())) ?? "";
		const systemText = await this.readSystemGuideText();
		const r = await this.persistAggregatedGuide(story, bookText, userText, systemText);
		return { guideText: r.guideText, bannedGuideText: r.merged["禁用词"] || "" };
	}

	async cmdAgentsView(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const layers = this.guideLayers(story);
			const existing: Array<{ label: string; path?: string }> = [];
			for (const l of layers) if ((await this.readGuideLayer(l)).trim()) existing.push(l);
			if (!existing.length) {
				new Notice("未找到写作指南\n可用「编辑创作规范」（/agents edit）创建", 8000);
				return;
			}
			let target = existing[0];
			if (existing.length > 1) {
				const idx = await this.pickAction("打开哪一层创作规范？", existing.map((l) => ({ label: l.label, sub: "已存在" })));
				if (idx == null) return;
				target = existing[idx];
			}
			if (target.path) await this.manager.openMarkdown(target.path);
			else new MarkdownViewerModal(this.app, `创作规范 · ${target.label}`, await this.readGuideLayer(target)).open(); // 系统级无 vault 文件，弹只读面板
		} catch (e) {
			this.notifyError("打开失败", e);
		}
	}

	async cmdAgentsEdit(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const layers = this.guideLayers(story);
			const items: ActionItem[] = [];
			for (const l of layers) {
				const content = await this.readGuideLayer(l);
				items.push({ label: l.label, sub: content.trim() ? "已存在（将覆盖保存）" : "未创建（将新建）" });
			}
			const idx = await this.pickAction("编辑哪一层创作规范？", items);
			if (idx == null) return;
			const target = layers[idx];
			const initial = await this.readGuideLayer(target);
			const value = await new Promise<string | null>((resolve) => {
				new TextAreaPrompt(this.app, `创作规范 · ${target.label}`, "小说背景 / 专业内容 / 禁用词与去AI腔规则…（全量保存，覆盖原内容）", initial, "保存", (v) => resolve(v), () => resolve(null)).open();
			});
			if (value == null) return;
			if (!value.trim()) {
				new Notice("内容为空，未保存");
				return;
			}
			await this.writeGuideLayer(target, value.trim());
			const dest = target.path ?? this.systemGuidePath();
			try { await this.rebuildAggregatedGuide(story); } catch { /* 汇总刷新失败不阻断保存提示 */ } // 任一层变更→重算《写作指南汇总》（提示词仅注入该文件）
			new Notice(`创作规范已保存到 ${dest}\n已同步刷新本书《写作指南汇总》`, 8000);
		} catch (e) {
			this.notifyError("保存失败", e);
		}
	}

	async cmdGenerateWritingGuide(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const tpl = EMPTY_GUIDE_TEMPLATE; // 空模板（仅段名+结构标记）由 docs/WRITING_GUIDE_template.md 打包内联，与系统级同格式
			const created: string[] = [];
			const skipped: string[] = [];
			for (const [label, path] of [["用户级", this.manager.userGuidePath()], ["小说级", this.manager.bookGuidePath(story)]] as Array<[string, string]>) {
				const ex = await this.manager.readGuideAt(path);
				if (ex != null && ex.trim()) skipped.push(`${label} ${path}`);
				else { await this.manager.writeGuideAt(path, tpl); created.push(`${label} ${path}`); }
			}
			let msg = "";
			if (created.length) msg += `已创建空模板（仅段名）：\n${created.join("\n")}\n`;
			if (skipped.length) msg += `已跳过（目标非空）：\n${skipped.join("\n")}\n`;
			msg += "系统级请用「重新生成系统写作指南」命令维护。";
			new Notice(msg.trim(), 10000);
			try { await this.rebuildAggregatedGuide(story); } catch { /* ignore */ }
		} catch (e) {
			this.notifyError("生成写作指南失败", e);
		}
	}

	/** 启动自检：工作目录有效但《使用说明.md》缺失/为空 → 用内置默认创建并在布局就绪后打开（覆盖首装升级、文档被删两种场景）；已存在一律不动 */
	private async ensureUsageDocOnStartup(): Promise<void> {
		try {
			const dir = this.settings.workDir.replace(/\/+$/, "");
			if (!dir) return;
			if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) return;
			const p = this.usageDocPath();
			const ex = await this.manager.readGuideAt(p);
			if (ex != null && ex.trim()) return;
			await this.manager.writeGuideAt(p, DEFAULT_USAGE_GUIDE);
			new Notice("已在工作目录创建《使用说明.md》", 8000);
			this.openWhenLayoutReady(p);
		} catch (e) {
			console.warn("[ArticleWriter] 启动生成《使用说明.md》失败", e);
		}
	}

	/** 等 workspace 布局就绪再开文件（onload 阶段 getLeaf 可能不可用）；本仓库 dts 版本的 workspace.on 无 layout-ready 事件，改用短轮询、registerInterval 托管卸载清理 */
	private openWhenLayoutReady(path: string): void {
		const run = () => { void this.manager.openMarkdown(path).catch((e) => console.warn(`[ArticleWriter] 打开 ${path} 失败`, e)); };
		if (this.app.workspace.layoutReady) {
			run();
			return;
		}
		const timer = window.setInterval(() => {
			if (!this.app.workspace.layoutReady) return;
			window.clearInterval(timer);
			run();
		}, 250);
		this.registerInterval(timer);
	}

	/** 《使用说明.md》路径：work_dir 根（vault 根=顶层文件） */
	private usageDocPath(): string {
		const dir = this.settings.workDir.replace(/\/+$/, "");
		return dir ? `${dir}/使用说明.md` : "使用说明.md";
	}

	/** 设置/切换工作目录后把《使用说明.md》投放到其根：仅缺失或为空时写入内置默认，绝不覆盖用户内容。返回是否新建 */
	private async seedUsageDoc(): Promise<boolean> {
		try {
			const p = this.usageDocPath(); // 调用时 settings.workDir 已更新（pickWorkDir 回调内先赋值）
			const ex = await this.manager.readGuideAt(p);
			if (ex != null && ex.trim()) return false;
			await this.manager.writeGuideAt(p, DEFAULT_USAGE_GUIDE);
			try { await this.manager.openMarkdown(p); } catch { /* 打开失败不影响投放结果（用户交互期 workspace 已就绪，理论上不会到这里） */ }
			return true;
		} catch (e) {
			console.warn("[ArticleWriter] 生成《使用说明.md》失败", e);
			return false;
		}
	}

	/** 手动重新生成使用说明（与自动投放同源；目标非空则跳过并提示） */
	async cmdGenerateUsageDoc(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		try {
			const p = this.usageDocPath();
			const ex = await this.manager.readGuideAt(p);
			if (ex != null && ex.trim()) {
				new Notice(`已存在非空文件，未改动：${p}\n如需更新请手动编辑该文档`, 8000);
				return;
			}
			await this.manager.writeGuideAt(p, DEFAULT_USAGE_GUIDE);
			new Notice(`已创建使用说明：${p}`, 8000);
			await this.manager.openMarkdown(p);
		} catch (e) {
			this.notifyError("生成使用说明失败", e);
		}
	}

	async cmdRegenerateSystemGuide(): Promise<void> {
		try {
			const ok = await this.confirmBox("重新生成系统写作指南？", "将用代码内置默认内容覆盖插件数据目录中的系统级 WRITING_GUIDE.md。\n你此前对系统级的修改会丢失。", "覆盖");
			if (!ok) return;
			await this.manager.writePluginFile(this.systemGuidePath(), DEFAULT_SYSTEM_GUIDE);
			let note = `系统级写作指南已重置为内置默认\n${this.systemGuidePath()}`;
			const cur = this.settings.lastStory?.trim();
			if (cur && (await this.manager.listStories()).includes(cur)) {
				try { await this.rebuildAggregatedGuide(cur); note += "\n已刷新该书的《写作指南汇总》"; } catch { /* ignore */ }
			}
			new Notice(note, 8000);
		} catch (e) {
			this.notifyError("重新生成系统写作指南失败", e);
		}
	}

	// ---------- LLM 配置（存插件数据目录 data.json，替代 ~/.articlewriter/config.json；首次运行预置标准模板） ----------

	/** 从插件设置读取激活模型配置 + 全局字段（system_prompt / desc_style），无可用配置返回 null */
	private getLlmSetup(): { cfg: LlmConfigDoc; systemPrompt?: string; descStyle?: string } | null {
		const conf = this.settings.llm ?? null;
		const cfgs = conf?.llm_configs ?? [];
		if (!conf || !cfgs.length) return null;
		const cfg = cfgs.find((c) => c.name === conf.active_llm) ?? cfgs[0];
		return { cfg, systemPrompt: conf.system_prompt, descStyle: conf.desc_style };
	}

	// ---------- LLM 连接测试（对齐 CLI /llm test，GET /models） ----------

	async cmdLlmTest(): Promise<void> {
		try {
			const setup = this.getLlmSetup();
			if (!setup) {
				new Notice("未找到 LLM 配置\n请在 Obsidian 设置 → ArticleWriter 的「LLM 模型配置」区填写", 8000);
				return;
			}
			await this.runLlmTest(setup.cfg);
		} catch (e) {
			this.notifyError("LLM 连接测试失败", e);
		}
	}

	/** 对指定配置执行 GET /models 连通性测试并弹通知（命令与设置页共用） */
	async runLlmTest(target: LlmConfigDoc): Promise<void> {
		const n = new Notice(`正在测试 LLM 连接：${target.name || "(未命名)"} @ ${normalizeBaseURL(target.base_url)} …`);
		try {
			const r = await testConnection(target);
			n.hide();
			new Notice(
				r.ok
					? `✓ 已连接 ${target.name}${r.models?.length ? `\n可用模型：${r.models.join("、")}` : ""}`
					: `✗ 连接失败 ${target.name}\n${r.message}`,
				r.ok ? 8000 : 20000,
			);
		} catch (e) {
			n.hide();
			new Notice(`✗ 测试异常：${e instanceof Error ? e.message : String(e)}`, 20000);
		}
	}

	/** 打开常驻 LLM 对话面板：已有则直接激活，否则在工作区新建分割区域承载（UI 在 onOpen 建进 contentEl，勿用 getEmptyStateElement——本环境不调用它）；无配置时由面板内状态行提示去设置页 */
	private async openLlmPanel(): Promise<void> {
		try {
			const existing = this.app.workspace.getLeavesOfType(LlmChatView.VIEW_TYPE);
			if (existing.length) {
				this.app.workspace.setActiveLeaf(existing[0]); // revealLeaf 已废弃，改用 setActiveLeaf（minAppVersion 1.4+ 可用）
				return;
			}
			const leaf = this.app.workspace.getLeaf("split");
			await leaf.setViewState({ type: LlmChatView.VIEW_TYPE, active: true });
		} catch (e) {
			this.notifyError("打开对话窗口失败", e);
		}
	}

	private async openStatusPanel(): Promise<void> {
		try {
			const existing = this.app.workspace.getLeavesOfType(StatusView.VIEW_TYPE);
			if (existing.length) {
				this.app.workspace.setActiveLeaf(existing[0]); // revealLeaf 已废弃，改用 setActiveLeaf（minAppVersion 1.4+ 可用）
				return;
			}
			// 不分割新面板：直接复用左栏现有叶子（与文件列表同一位置，替换其内容显示状态面板；点侧栏文件图标可切回文件列表）；左栏为空才退回新建
			const leaf = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeftLeaf(true) ?? this.app.workspace.getLeaf("split");
			await leaf.setViewState({ type: StatusView.VIEW_TYPE, active: true });
		} catch (e) {
			this.notifyError("打开写字台失败", e);
		}
	}

	// ---------- LLM 写作命令（/write /continue /rewrite /polish /deai /review，对应 Python WritingMixin + writer.py） ----------

	private promptArea(title: string, placeholder: string, initial = ""): Promise<string | null> {
		return new Promise((resolve) => {
			new TextAreaPrompt(this.app, title, placeholder, initial, "确定", (v) => resolve(v), () => resolve(null)).open();
		});
	}

	/** 章节号输入：空=当前章默认；Esc=取消整个命令（v0.0.15：返回复合键） */
	private async targetChapterKey(story: string, verb: string): Promise<string | null> {
		const state = await this.manager.loadState(story);
		const cur = state?.current_chapter ?? null; // 复合键 "volId:N" / "N"
		const volNames = await this.volNameMap(story);
		const raw = await this.prompt(`要${verb}哪一章`, cur ? `当前 ${this.keyLabel(cur, volNames)}，留空即用当前章` : "请输入章节号");
		if (raw == null) return null;
		const t = raw.trim();
		let key: string | null = null;
		if (t === "") key = cur;
		else if (/^\d+$/.test(t)) {
			const ref = await this.resolveLocalNum(story, parseInt(t, 10), volNames); // 裸章号 → 具体容器（跨卷同号逐个确认）
			key = ref ? chKey(ref.vol ?? null, ref.num) : null;
		}
		if (!key || !t && !cur) { new Notice(`第${t || "?"}章不存在`); return null; }
		return key;
	}

	/** 从插件设置（data.json）返回激活模型配置 + 全局字段（system_prompt / desc_style），无可用配置弹通知并返回 null */
	private async loadWriterSetup(): Promise<{ cfg: LlmConfigDoc; systemPrompt?: string; descStyle?: string } | null> {
		const setup = this.getLlmSetup();
		if (!setup) {
			new Notice("未找到 LLM 配置\n请在 Obsidian 设置 → ArticleWriter 的「LLM 模型配置」区填写 api_key/模型名", 8000);
			return null;
		}
		return setup;
	}

	/** 三层创作规范（小说级 > 用户级 > 系统级插件文件，顺序即优先级）：合并并落盘《写作指南汇总》，guideText=该汇总去注释正文（提示词仅注入它），bannedGuideText=合并后禁用词类目 */
	private async loadWriterGuides(storyName: string): Promise<{ bookText: string; userText: string; systemText: string; guideText: string; bannedGuideText: string }> {
		const bookText = (await this.manager.readGuideAt(this.manager.bookGuidePath(storyName))) ?? "";
		const userText = (await this.manager.readGuideAt(this.manager.userGuidePath())) ?? "";
		const systemText = await this.readSystemGuideText(); // 读不到回落内置默认（写作命令不打扰）
		const r = await this.persistAggregatedGuide(storyName, bookText, userText, systemText);
		return { bookText, userText, systemText, guideText: r.guideText, bannedGuideText: r.merged["禁用词"] || "" };
	}

	/** 组装正文生成系统提示词：编写类型格式块+禁用词 → config.system_prompt → 内置默认；末尾附【创作规范】原文 */
	private writerSystemPrompt(
		baseSp: string | undefined,
		guides: { guideText: string; bannedGuideText: string },
		writingStyle?: string,
		title?: string,
		charNames?: Array<string | null>
	): string {
		const custom = buildStoryTypeSystemPrompt({ storyType: writingStyle, guideText: guides.guideText, title, charNames, bannedGuideText: guides.bannedGuideText });
		return assembleSystemPrompt(custom || undefined, guides.guideText, baseSp);
	}

	/** 对话面板系统提示词（与写作命令同一套规则）：编写类型块+禁用词 → settings.system_prompt → 内置默认，末尾附【创作规范】；非交互取 lastStory（不弹选择器），无当前小说时仅用户级/系统级两层 */
	// ---------- 写字台（StatusView）数据与动作 ----------

	/** 路径是否落在当前工作目录内（含根本身）；未设置工作目录时一律不匹配 */
	private pathUnderWorkDir(p: string): boolean {
		const root = this.settings.workDir.replace(/\/+$/, "");
		if (!root) return false;
		return p === root || p.startsWith(root + "/");
	}

	/** 防抖刷新所有已打开的状态面板（编辑器自动落盘会连发变更，合并成一次重渲染；无面板打开时直接忽略） */
	private scheduleStatusPanelRefresh(delayMs = 800): void {
		if (!this.app.workspace.getLeavesOfType(StatusView.VIEW_TYPE).length) return;
		if (this.statusRefreshTimer != null) window.clearTimeout(this.statusRefreshTimer);
		this.statusRefreshTimer = window.setTimeout(() => {
			this.statusRefreshTimer = null;
			for (const leaf of this.app.workspace.getLeavesOfType(StatusView.VIEW_TYPE)) {
				if (leaf.view instanceof StatusView) void leaf.view.refresh();
			}
		}, delayMs);
	}

	/** 状态页数据快照：工作目录 + 全部小说概览 + 当前小说详情（章节/文件路径），全程非交互、逐段容错 */
	async getStatusSnapshot(): Promise<StatusSnapshot> {
		const root = this.settings.workDir.replace(/\/+$/, "");
		if (!root) return { workDir: "", stories: [], details: {} };
		const names = await this.manager.listStories();
		const last = this.settings.lastStory?.trim() ?? "";
		const stories: StatusStoryEntry[] = [];
		/** 逐书实时统计的章节字数（key→words）：状态文档里的 words/total_words 可能是过期值（旧数据、CLI 写入或建章后未同步），展示一律以磁盘 MD 为准（同 /count 口径）。**只为当前激活书做全量 countWords**——视图只渲染激活书的章节小节，非激活书仅用 state 值兜底（下拉框只显示书名），省掉多本书逐章读盘的 IO（手机上刷新明显卡顿的主因之一） */
		let activeLiveWords: Record<string, number> | undefined;
		for (const name of names) {
			let title = name;
			let chapterCount = 0;
			let currentChapter: string | null = null;
			let words = 0;
			try {
				const st = await this.manager.loadState(name); // 单文件读取，成本低，全部保留（切书提示也要用）
				if (st) {
					title = st.title || name;
					chapterCount = Object.keys(st.chapters).length;
					currentChapter = st.current_chapter;
					words = st.total_words;
				}
			} catch {
				/* 单本状态读取失败不影响列表其余项 */
			}
			if (name === last) {
				try {
					const rows = await this.manager.countWords(name); // 读各章 章节.md 纯文字计数
					const map: Record<string, number> = {};
					for (const r of rows) map[r.key] = r.words;
					activeLiveWords = map;
					words = rows.reduce((s, r) => s + r.words, 0); // 实时值优先，覆盖可能过期的 state 值
				} catch {
					/* 字数统计失败时保留 state 里的旧值兜底 */
				}
			}
			stories.push({ name, title, chapterCount, currentChapter, words, active: name === last });
		}
		// 只为当前激活书构建详情子树（视图仅渲染其「案头资料/书稿」小节；切书必走完整 refresh 重新拉取）；失败则该节显示加载提示
		const details: Record<string, StatusDetail> = {};
		if (last && names.includes(last)) {
			try {
				details[last] = await this.buildStoryDetail(last, activeLiveWords);
			} catch {
				/* 详情缺失时视图显示「未能加载状态」提示 */
			}
		}
		return { workDir: root, stories, details };
	}

	/** 单本书的详情快照：状态字段 + 章节目录（含各章文件）+ 书根案头资料；字数优先用传入的实时磁盘统计 chWords，回退 state 值 */
	private async buildStoryDetail(storyName: string, chWords?: Record<string, number>): Promise<StatusDetail> {
		const state = await this.manager.loadState(storyName);
		let vols: Array<{ id: string; name: string; description: string; order: number }> = [];
		try {
			vols = await this.manager.volumeList(storyName); // 卷列表缺失（未建过卷）→ 按无卷渲染，章节全部平铺
		} catch { /* ignore */ }
		const curVolId = state?.current_volume ?? "";
		const chs = await this.manager.listChapters(storyName);
		const chapters: StatusChapterEntry[] = chs.map((c) => ({
			key: c.key,
			num: c.num,
			title: c.title,
			words: chWords ? (chWords[c.key] ?? 0) : (state?.chapters[c.key]?.words ?? 0),
			active: c.key === state?.current_chapter,
			volumeId: c.vol ?? "", // 以章节目录物理位置判归属（与 /scan 口径一致），供面板挂到对应卷节点下
			files: c.dir.children.filter((f): f is TFile => f instanceof TFile).map((f) => ({ path: f.path, name: f.name })).sort((a, b) => a.name.localeCompare(b.name, "zh")),
		}));
		const storyDir = this.app.vault.getAbstractFileByPath(this.manager.storyPath(storyName));
		const globalFiles =
			storyDir instanceof TFolder
				? storyDir.children.filter((f): f is TFile => f instanceof TFile).map((f) => ({ path: f.path, name: f.name })).sort((a, b) => a.name.localeCompare(b.name, "zh"))
				: [];
		const volDocs = await this.manager.listVolumeDocsByVol(storyName); // v0.1.3+：各卷实体目录直属 md（非章节目录），供写字台「文档」子节点展示
		return {
			storyName,
			title: state?.title || storyName,
			genre: state?.genre || "",
			writingStyle: state?.writing_style || "",
			currentChapter: state?.current_chapter ?? null,
			currentVolume: curVolId,
			totalWords: chWords ? Object.values(chWords).reduce((s, w) => s + w, 0) : (state?.total_words ?? 0),
			updatedAt: state?.updated_at || "",
			volumes: vols.map((v) => ({ id: v.id, name: v.name, order: v.order, active: v.id === curVolId, docs: volDocs[v.id] ?? [] })),
			chapters,
			globalFiles,
			useVolumes: state?.use_volumes ?? true, // v0.0.16+：无卷模式时写字台隐藏全部「新建卷」入口；状态缺失按有卷兜底不擅藏功能
		};
	}

	/** 状态页切换当前小说：写回 lastStory（对齐 switch-story 的持久化语义） */
	async statusSwitchStory(name: string): Promise<void> {
		this.settings.lastStory = name;
		await this.saveSettings();
		new Notice(`已切换当前小说：${name}`, 4000);
		await this.enforceVolumeLayoutOnSwitch(name); // 平面结构 → 强制自动按卷整理（不可跳过）
	}

	/** 状态页激活章节：写回 current_chapter；该章归属卷时同步补激活所属卷（对齐切章约定），返回新的当前章复合键 */
	async statusActivateChapter(storyName: string, key: string): Promise<string> {
		const state = await this.manager.loadState(storyName);
		if (!state) throw new Error("状态文档缺失，请先执行「重建小说状态」");
		await this.manager.switchChapter(storyName, key); // 含 chapters 条目回填 + 按键内容器同步当前卷（目录与状态脱节时也稳定生效）
		return key;
	}

	/** 广播刷新所有已打开的 LLM 对话面板顶部「当前小说 · 章节」行（切书/切章/建章等任何状态或设置变更路径都会经 saveSettings 或 manager.saveState 触发到这里），并防抖刷新所有已打开的写字台（切书/切章后跨分栏同步） */
	notifyContextChanged(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(LlmChatView.VIEW_TYPE)) {
			if (leaf.view instanceof LlmChatView) {
				void leaf.view.updateCtxLine(); // 顶部小说·章节行
				void leaf.view.updateSpLabel(); // 「提示词」标签（是否含小说上下文、约字数）
			}
		}
		// lastStory/current_chapter 等元数据变更时同步刷新所有已打开的写字台：切书/切章后其它面板不再停留在旧书；scheduleStatusPanelRefresh 自带防抖合并突发
		this.scheduleStatusPanelRefresh(200);
	}

	/** 状态页右键快捷菜单动作执行器（语义与对应命令一致，但直接针对右键所在的小说/章节/目录，不再弹选择器） */
	async handleStatusAction(a: StatusAction): Promise<void> {
		switch (a.kind) {
			case "new-story": {
				await this.cmdNewStory(); // 复用建书三问流程
				return;
			}
			case "rename-story": {
				const cur = (await this.manager.loadState(a.name))?.title ?? a.name;
				const t = await this.prompt(`改名「${a.name}」`, `新书名（当前：${cur || "无"}）`);
				if (t == null || !t.trim() || t.trim() === cur) return; // 留空/未变更不执行
				const r = await this.manager.renameStory(a.name, t.trim()); // title + 顶层目录同步改名 + 大纲起始标题行
				if ((this.settings.lastStory || "") === a.name) {
					this.settings.lastStory = r.newName; // 当前书记忆随目录改名，同时触发 LLM 面板上下文行刷新
					await this.saveSettings();
				}
				new Notice(r.newName !== a.name ? `已改名为「${t.trim()}」，顶层目录已同步移动为 ${r.newName}` : `已改名为「${t.trim()}」（目录名不变）`, 6000);
				return;
			}
			case "delete-story": {
				const folder = this.app.vault.getAbstractFileByPath(this.manager.storyPath(a.name));
				if (!(folder instanceof TFolder)) throw new Error("小说目录不存在或已被移动");
				const ok = await this.confirmBox(`删除小说「${a.name}」？`, "整本书的文件夹（含全部章节与文档）将移入 Obsidian 回收站，可从中找回。", "删除");
				if (!ok) return;
				await this.app.fileManager.trashFile(folder);
				if ((this.settings.lastStory || "") === a.name) {
					this.settings.lastStory = "";
					await this.saveSettings(); // 同时触发 LLM 面板上下文行刷新
				}
				new Notice(`小说「${a.name}」已删除（可在回收站找回）`);
				return;
			}
			case "new-chapter": {
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const chapters = await this.manager.listChapters(a.story);
				const st = await this.manager.loadState(a.story);
				let curVol = (st?.current_volume ?? "").trim(); // 有当前卷 → 落卷实体目录
				if (st && !st.use_volumes) curVol = ""; // v0.0.16+：无卷模式一律落书根（纯 书→章），忽略残留 current_volume/右键 volId
				if (a.volId && a.volId !== curVol) { // 卷节点右键建章：目标卷优先，并同步设为当前卷（位置即归属）
					curVol = a.volId;
					if (st) {
						st.current_volume = a.volId;
						await this.manager.saveState(a.story, st);
					}
				}
				const base = this.manager.storyPath(a.story);
				const inScope = curVol ? chapters.filter((c) => c.vol === curVol) : chapters.filter((c) => !c.vol && c.parentPath === base);
				const nextNum = inScope.length ? Math.max(...inScope.map((c) => c.num)) + 1 : 1;
				let volName = "";
				try { if (curVol) volName = this.manager.findVolumeIn(await this.manager.loadVolumes(a.story), curVol)?.name ?? curVol; } catch { volName = curVol; }
				const scopeLabel = curVol ? `卷「${volName}」` : "书根";
				const title = await this.prompt(`新建章节（将成为 ${scopeLabel}第${nextNum}章）`, "章节标题");
				if (title == null || !title.trim()) return;
				const bodyPath = await this.manager.createChapter(a.story, title.trim(), curVol); // v0.0.15：编号在容器内自动顺延，不再手输章号
				new Notice(`${scopeLabel}已创建第${String(nextNum).padStart(2, "0")}章-${title.trim()}：章节目录与文档就绪`);
				if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(bodyPath);
				return;
			}
			case "create-volume": {
				if ((await this.manager.loadState(a.story))?.use_volumes === false) { new Notice(NO_VOL_MODE_MSG, 10000); return; } // v0.0.16+：无卷模式禁止建卷兜底（写字台已隐藏该入口）
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const names = await this.pickNewVolumeNames(a.story); // 列表式批量新建卷页面（手动加名单、确定后按序创建）
				if (!names || !names.length) return;
				await this.createVolumesInOrder(a.story, names); // 单个卷失败不中断其余，汇总通知给出原因；最后成功的设为当前卷
				return;
			}
			case "rename-volume": {
				const vols = await this.manager.volumeList(a.story);
				const curName = vols.find((v) => v.id === a.id)?.name ?? a.id;
				const n = await this.prompt("重命名卷", `新名称（当前：${curName}）`);
				if (!n?.trim() || n.trim() === curName) return;
				const u = await this.manager.updateVolume(a.story, a.id, { name: n.trim() }); // 同步重命名卷实体目录；同名冲突/移动失败抛错回滚
				new Notice(u ? `已改名为「${u.name}」，卷实体目录已同步移动` : "改名失败：卷不存在", 6000);
				return;
			}
			case "delete-volume": {
				const vols = await this.manager.volumeList(a.story);
				const vol = vols.find((v) => v.id === a.id);
				if (!vol) throw new Error(`卷 ${a.id} 不存在或已被删除`);
				const state = await this.manager.loadState(a.story);
				const nums = Object.entries(state?.chapters ?? {})
					.filter(([, m]) => (m.volume || "") === vol.id || (m.volume || "") === vol.name)
					.map(([k]) => parseChKey(k).num)
					.sort((x, y) => x - y);
				const ok = await this.confirmBox(
					`删除卷「${vol.name}」？`,
					nums.length
						? `其归属的 ${nums.length} 章（${nums.slice(0, 12).map((n) => this.chapterLabel(n)).join("、")}${nums.length > 12 ? " 等" : ""}）将一并移入 Obsidian 回收站，可从中找回；其余章节编号自动保持连续。`
						: "该卷暂无归属章节，仅删除卷本身及其实体目录。",
					"删除"
				);
				if (!ok) return;
				const r = await this.manager.deleteVolumeCascade(a.story, vol.id); // 级联删章入回收站 + 单次补洞重排
				new Notice(`已删除卷「${r.name}」${r.chaptersDeleted.length ? `，级联删除 ${String(r.chaptersDeleted.length)} 章（可在回收站找回）` : ""}`, 8000);
				return;
			}
			case "activate-volume": {
				const vols = await this.manager.volumeList(a.story);
				const name = vols.find((v) => v.id === a.id)?.name ?? a.id;
				const r = await this.manager.activateVolume(a.story, a.id); // 设 current_volume 并切到该卷最后一章
				new Notice(r.num != null ? `已启用「${name}」，切换到${this.chapterLabel(r.num)}` : `已将「${name}」设为当前卷（暂无归属章节）`, 4000);
				if (r.path) await this.manager.openMarkdown(r.path);
				return;
			}
			case "export-volume": {
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留先归位：导出按物理位置判归属
				const vols = await this.manager.volumeList(a.story);
				const vol = vols.find((v) => v.id === a.id);
				if (!vol) throw new Error(`卷 ${a.id} 不存在或已被删除`);
				const specText = await this.prompt(`导出（卷「${vol.name}」）`, "输入范围表达式（留空/all=该卷全部章节）", [
					"将该卷内所选范围的《章节.md》正文合一 MD，按章序排列、文件首行带本卷标题；默认存 <书名>-<卷名>-范围.md（不支持自定义文件名/路径，重导覆盖同名文件）。范围写法：",
					"· 留空 / all / 全部 —— 该卷全部章节",
					"· 区间 —— 如 3-7 或 三至七（该卷内本地章号，自动升序去重）",
					"· 列表 —— 如 1、4、5（顿号/逗号/空格分隔均可）",
				].join("\n"));
				if (specText == null) return;
				const r = await this.manager.packStory(a.story, specText.trim(), vol.id, ""); // 锁定本卷：留空=all 即该卷全章；默认名 <书名>-<卷名>-范围.md
				const words = r.packed.reduce((s, p) => s + p.words, 0);
				new Notice(`已生成 ${r.path}（共 ${r.packed.length} 章，纯文字 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}`, 8000);
				await this.manager.openMarkdown(r.path);
				return;
			}
			case "export-story": {
				const specText = await this.prompt("导出书稿", "输入范围表达式（留空/all=整本）", [
					"将所选范围内全部章节的《章节.md》正文合一 MD，阅读序排列。有卷模式每个卷组前带「# 第N卷 · 卷名」标题行（无章的空卷也照样输出其卷名），无卷模式平铺不带；章标题行为「## 第N章 章节名」。范围写法：",
					"· 留空 / all / 全部 —— 整本（含书根未归卷 + 各卷）",
					"· 区间 —— 如 3-7 或 三至七（自动升序去重；多卷书可加卷名前缀限定，如 风起:3-7、第一卷,2-5）",
					"· 列表 —— 如 1、4、5（顿号/逗号/空格分隔均可）",
					"· 裸号跨多个卷重名时会弹选择器让你选所在卷",
				].join("\n"));
				if (specText == null) return;
				const outText = await this.prompt("输出路径", "输出位置（留空用默认文件名）", [
					"· 留空 —— 限定某卷时存到该小说目录下 <书名>-<卷名>-范围.md（如 <书名>-风起-第3-7章.md；单章为 -第N章、离散号为 -第1、4、5章），整本/书根域为 <书名>-书稿.md（重导覆盖同名文件）",
					"· 以 .md 结尾 —— 视为完整文件名，原样使用",
					"· 其他 —— 视为目标目录，自动拼上对应默认文件名",
				].join("\n"));
				if (outText == null) return;
				try {
					let r: Awaited<ReturnType<typeof this.manager.packStory>>;
					try {
						r = await this.manager.packStory(a.story, specText.trim(), undefined, outText.trim());
					} catch (e2) {
						if (!String((e2 as Error)?.message).includes("PACK_AMBIGUOUS_CONTAINER")) throw e2; // 裸号跨容器有歧义 → 选容器后以 forcedVolId 重入
						const vols = await this.manager.volumeList(a.story);
						const idx = await this.pickAction("章节号在多个容器里都存在，请选择所在卷", vols.map((v) => ({ label: v.name })));
						if (idx == null) return;
						r = await this.manager.packStory(a.story, specText.trim(), vols[idx].id, outText.trim());
					}
					const words = r.packed.reduce((s, p) => s + p.words, 0);
					new Notice(`已生成 ${r.path}（${r.packed.length} 章，纯文字共 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}）`, 8000);
					await this.manager.openMarkdown(r.path);
				} catch (e) {
					this.notifyError("导出书稿失败", e);
				}
				return;
			}
			case "rename-chapter": {
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const curNum = parseChKey(a.key).num;
				const cur = (await this.manager.loadState(a.story))?.chapters[a.key]?.title ?? "";
				const t = await this.prompt(`重命名 ${this.chapterLabel(curNum, cur)}`, `新标题（当前：${cur || "无"}）`);
				if (!t?.trim()) return;
				const newTitle = await this.manager.renameChapter(a.story, a.key, t.trim()); // 重命名目录并同步各文档中的旧标题引用
				new Notice(`已改名为 ${this.chapterLabel(curNum, newTitle)}，目录与文档引用已同步`, 6000);
				return;
			}
			case "insert-chapter": {
				// 右键所在章节即参照章、方向已定：只问标题（留空以编号作标题），复用 manager.insertChapter 的顺延+引用重写
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const refNum = parseChKey(a.key).num;
				const newNum = a.pos === "before" ? refNum : refNum + 1;
				const t = await this.prompt(`新建第${newNum}章`, `插入到 ${this.chapterLabel(refNum)} ${a.pos === "before" ? "之前" : "之后"}的章节标题`);
				if (t == null) return;
				const title = t.trim() || String(newNum);
				const r = await this.manager.insertChapter(a.story, a.key, a.pos, title);
				new Notice(`${this.chapterLabel(r.newNum, title)} 已插入；后续章节号与文档引用已顺延更新`, 6000);
				if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(r.path);
				return;
			}
			case "delete-chapter": {
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const st = await this.manager.loadState(a.story);
				const meta = st?.chapters[a.key];
				const delNum = parseChKey(a.key).num;
				const ok = await this.confirmBox(`删除第${String(delNum).padStart(2, "0")}章${meta?.title ? " " + meta.title : ""}？`, "章节目录将移入 Obsidian 回收站，元数据与卷归属一并清理；若为当前章节则回退到最后一章。其后的各章会自动重新排号、保持连续编号。", "删除");
				if (!ok) return;
				const r = await this.manager.deleteChapter(a.story, a.key);
				new Notice(`章节已删除（可在回收站找回）${r.resequenced ? "；后续章节已自动重新排号为连续" : ""}`);
				return;
			}
			case "new-file": {
				const target = a.key == null ? {} : { chKey: a.key }; // 书根（案头资料）或章节目录
				const stds = await this.manager.standardDocs(a.story, target); // 标准模板文档优先列出（参与提示词者），已存在禁用
				const items: ActionItem[] = [
					...stds.map((s) => ({ label: s.name, sub: s.exists ? "已存在，未改动" : undefined, disabled: s.exists })),
					{ label: "自定义文件名…" },
				];
				const idx = await this.pickAction(`新建${a.key == null ? "资料" : "文章"}（优先标准文档）`, items);
				if (idx == null) return;
				if (idx < stds.length) {
					const created = await this.manager.ensureStandardDoc(a.story, target, stds[idx].name); // 按模板创建，已存在不覆盖
					new Notice(created ? `已创建 ${stds[idx].name}（模板）` : `${stds[idx].name} 已存在，未改动`);
					return;
				}
				let folder: string;
				if (a.key == null) {
					folder = this.manager.storyPath(a.story);
				} else {
					const ch = (await this.manager.listChapters(a.story)).find((c) => c.key === a.key); // 以磁盘为准取真实章节目录（含章名）
					if (!ch) throw new Error(`第${parseChKey(a.key).num}章不存在`);
					folder = ch.dir.path;
				}
				const name = await this.prompt(a.key == null ? "新建资料" : "新建文章", `在${a.key == null ? "书根目录（案头资料）" : "该章节目录"}下创建 .md 文件名（留扩展名可自定义）`); // v0.1.6+：书根入口文案与「新建资料…」菜单项一致，章节目录内仍为「新建文章」
				if (name == null || !name.trim()) return;
				let base = safeFilename(name.trim());
				if (!base.toLowerCase().endsWith(".md")) base += ".md";
				const path = `${folder}/${base}`;
				if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`同名文件已存在：${path}`);
				await this.app.vault.create(path, "");
				new Notice(`已创建 ${path}`);
				return;
			}
			case "delete-file": {
				const f = this.app.vault.getAbstractFileByPath(a.path);
				if (!(f instanceof TFile)) throw new Error("文件不存在或已被移动");
				if (f.name === "故事状态.md") throw new Error("不能删除小说状态文档（需要重置请用「重建小说状态」命令）");
				const ok = await this.confirmBox(`删除文件 ${f.path}？`, "将移入 Obsidian 回收站，可从中找回。", "删除");
				if (!ok) return;
				await this.app.fileManager.trashFile(f);
				new Notice(`${f.name} 已删除（可在回收站找回）`);
				return;
			}
			case "new-volume-doc": {
				const vols = await this.manager.loadVolumes(a.story);
				const vol = this.manager.findVolumeIn(vols, a.volId); // 按 id/名解析目标卷
				if (!vol) throw new Error(`卷 ${a.volId} 不存在或已被删除`);
				const target = { volId: vol.id };
				const stds = await this.manager.standardDocs(a.story, target); // 设定四件套优先列出，已存在禁用
				const items: ActionItem[] = [
					...stds.map((s) => ({ label: s.name, sub: s.exists ? "已存在，未改动" : undefined, disabled: s.exists })),
					{ label: "自定义文件名…" },
				];
				const idx = await this.pickAction(`在卷「${vol.name}」新建文档（优先标准文档）`, items);
				if (idx == null) return;
				if (idx < stds.length) {
					const created = await this.manager.ensureStandardDoc(a.story, target, stds[idx].name); // 按模板创建，已存在不覆盖
					new Notice(created ? `已在卷「${vol.name}」创建 ${stds[idx].name}（模板）` : `${stds[idx].name} 已存在，未改动`);
					return;
				}
				const folder = `${this.manager.storyPath(a.story)}/${this.manager.volumeFolderName(vol)}`;
				if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw new Error("该卷实体目录缺失，请先执行「按卷整理目录」");
				const name = await this.prompt("新建文档", `在卷「${vol.name}」下创建 .md 文件名（留扩展名可自定义）`);
				if (name == null || !name.trim()) return;
				let base = safeFilename(name.trim());
				if (!base.toLowerCase().endsWith(".md")) base += ".md";
				const path = `${folder}/${base}`;
				if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`同名文件已存在：${path}`);
				await this.app.vault.create(path, "");
				new Notice(`已在卷「${vol.name}」创建 ${base}`);
				return;
			}
			case "complete-volume-docs": {
				const vols = await this.manager.loadVolumes(a.story);
				const vol = this.manager.findVolumeIn(vols, a.volId); // 按 id/名解析目标卷
				if (!vol) throw new Error(`卷 ${a.volId} 不存在或已被删除`);
				const created = await this.manager.ensureVolumeDocs(a.story, vol.id); // 缺失的设定模板补建，已存在保留不覆盖
				new Notice(created.length ? `已为卷「${vol.name}」补全缺失文档：${created.join("、")}` : `卷「${vol.name}」的模板文档已齐全（卷大纲/人物/人物关系/场景），无需补全`, 8000);
				return;
			}
			case "complete-root-docs": {
				const created = await this.manager.ensureRootDocs(a.story); // 书根默认资料七件套补缺，已存在保留不覆盖
				new Notice(created.length ? `已为「${a.story}」补全缺失资料：${created.join("、")}` : `「${a.story}」的默认资料文件已齐全（大纲/世界观/伏笔/笔记/人物/人物关系/场景），无需补全`, 8000);
				return;
			}
			case "llm-write":
			case "llm-continue":
			case "llm-polish": {
				await this.statusRunWriting(a.kind, a.story, a.key); // 章节行右键的 LLM 写作入口
				return;
			}
		}
	}

	/** 状态面板章节行右键调用 LLM 写作命令：先把目标书/章设为当前（与点章节名激活同语义），再复用对应命令的既有交互流程（创作要点输入、流式预览确认等全部保留） */
	private async statusRunWriting(kind: "llm-write" | "llm-continue" | "llm-polish", story: string, key: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		if ((this.settings.lastStory || "").trim() !== story) {
			this.settings.lastStory = story;
			await this.saveSettings(); // 切到目标书：持久化并广播刷新 LLM 面板上下文行
		}
		await this.statusActivateChapter(story, key); // 写回 current_chapter + 同步所属卷
		switch (kind) {
			case "llm-write": await this.cmdWrite(); break;
			case "llm-continue": await this.cmdContinueWriting(); break;
			case "llm-polish": await this.cmdPolishText(); break;
		}
	}

	/** 当前活动小说快照（供对话面板头部展示）：非交互读取 lastStory+状态；无有效当前小说返回 null */
	async getActiveStoryInfo(): Promise<{ story: string; chapterNum: number; chapterTitle: string } | null> {
		const s = this.settings.lastStory?.trim();
		if (!s || !(await this.manager.listStories()).includes(s)) return null;
		let chapterNum = 1;
		let chapterTitle = "";
		try {
			const st = await this.manager.loadState(s);
			const curKey = st?.current_chapter ?? null;
			if (curKey != null) {
				chapterNum = parseChKey(curKey).num; // v0.0.15：current_chapter 为复合键，展示用本地章号
				const ch = (await this.manager.listChapters(s)).find((c) => c.key === curKey);
				chapterTitle = ch?.title || "";
			}
		} catch {
			/* 状态/章节读取失败仍显示小说名与默认章号 */
		}
		return { story: s, chapterNum, chapterTitle };
	}

	/** 对话专用系统提示词（对齐 chat.py `_chat_reply` + `_build_chat_context` + `_apply_agents`）：
	 * 友好写作助手身份 +【创作规范】(与写作命令同源三层指南) + 当前小说上下文快照(写作上下文+当前章节正文截断6000字)。
	 * 无当前小说=仅身份+指南；任一部分构建失败不阻断整体（回退纯问答，对齐 CLI「某部分失败不影响整体」）。恒返回非 null。 */
	private async getChatSystemPrompt(): Promise<{ text: string; hasStory: boolean }> {
		const CHAT_ASSISTANT_PROMPT =
			"你是一个友好的写作助手。请用简体中文自然、简洁地回答用户的问题；" +
			"若问题与当前小说相关，请结合提供的【小说上下文】回答；" +
			"若提供了【对话历史】，请结合历史理解语境与指代（如'他/它/刚才/后来'），回答与之前的内容保持连贯，不要重复已说过的内容；" +
			"若问题与写作、小说或创作相关，请遵循下方【创作规范】的要求与文风作答" +
			"（如直白平实、避免AI腔；下方无【创作规范】时按此要求正常回答），" +
			"不要编造上下文中没有的设定；" +
			"思考完成后请直接在正文输出完整回答，不要把回答只放在思考过程里；" +
			"如果用户的问题与小说创作无关，就正常回答，不要编造小说内容。";
		let guideText = "";
		let hasStory = false;
		const lastStory = this.settings.lastStory?.trim();
		try {
			if (lastStory && (await this.manager.listStories()).includes(lastStory)) {
				hasStory = true;
				guideText = (await this.loadWriterGuides(lastStory)).guideText;
			} else {
				// 无当前小说：仅用户级+系统级两层，按同一汇总格式合并（不落盘——书目录不存在）
				const userText = (await this.manager.readGuideAt(this.manager.userGuidePath())) ?? "";
				const systemText = await this.readSystemGuideText();
				const merged = mergeGuideCategories([userText, systemText].filter((t) => t.trim()));
				guideText = stripComments(serializeAggregateGuide(merged)).trim();
			}
		} catch {
			/* 指南读取失败则不带【创作规范】，不阻断对话 */
		}
		let text = assembleSystemPrompt(CHAT_ASSISTANT_PROMPT, guideText); // 与 CLI _apply_agents 同一拼接规则/措辞
		if (hasStory) {
			try {
				const state = await this.manager.loadState(lastStory);
				if (state?.title) {
					const curKey = state.current_chapter; // v0.0.15：复合键（"volId:N"/"N"）
					let volNames: Record<string, string> = {};
					try { volNames = await this.volNameMap(lastStory); } catch { /* 卷名缺失降级为 id */ }
					const parts: string[] = [];
					if (curKey != null && curKey !== "") {
						try {
							const data = await this.manager.loadWritingData(lastStory, curKey, { includeCurrentSummary: false });
							const ctx = buildWritingContext(data);
							if (ctx) parts.push(ctx);
						} catch {
							/* 写作上下文构建失败不影响当前章节部分 */
						}
						try {
							const content0 = await this.manager.readChapterContent(lastStory, curKey);
							if (content0 && content0.trim()) {
								let content = content0;
								if (content.length > 6000) content = content.slice(0, 6000) + "\n[...内容省略...]";
								parts.push(`\n【当前章节】${this.keyLabel(curKey, volNames)}\n${content}`);
							}
						} catch {
							/* 章节读取失败则只带写作上下文 */
						}
					}
					if (parts.length) {
						text +=
							"\n\n以下是当前小说的上下文，供你回答时参考。请基于它回答，不要复述上下文本身：\n\n" +
							parts.join("\n");
					}
				}
			} catch {
				/* 状态读取失败则不带小说上下文，回退纯问答（对齐 CLI） */
			}
		}
		return { text, hasStory };
	}

	/** 单次流式调用：空流按「结果为空」处理（返回""），用户中断向上抛 AbortError，其余异常原样抛出 */
	private async streamOnce(cfg: LlmConfigDoc, messages: Message[], sink: WritingStreamSink): Promise<string> {
		try {
			return await chatStream(cfg, messages, (d) => sink.append(d), undefined, sink.signal);
		} catch (e) {
			if (sink.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes("输出为空") || msg.includes("未返回内容")) return "";
			throw e;
		}
	}

	/** 生成失败统一提示：用户中断仅通知；其它错误额外在预览框内显示失败态 */
	private genFailure(e: unknown, label: string, sink?: WritingStreamSink): void {
		if (e instanceof Error && e.name === "AbortError") {
			new Notice(`已停止生成，${label}未保存`);
			return;
		}
		this.notifyError(`${label}失败`, e);
		sink?.fail((e as Error)?.message || String(e));
	}

	/** 流式生成 + 结果为空自动重试 ×3（对应 cmd 层 max_attempts=3）；失败/中断/全空均返回"" */
	private async streamWithEmptyRetry(
		cfg: LlmConfigDoc,
		buildMessages: () => Message[],
		sink: WritingStreamSink,
		label: string
	): Promise<string> {
		for (let attempt = 1; attempt <= 3; attempt++) {
			let content: string;
			try {
				content = await this.streamOnce(cfg, buildMessages(), sink);
			} catch (e) {
				this.genFailure(e, label, sink);
				return "";
			}
			if (content.trim()) return content;
			if (attempt < 3) {
				new Notice(`生成结果为空（第${String(attempt)}次），正在重试…`, 6000);
				sink.reset();
			}
		}
		new Notice(`✗ ${label}失败：连续 3 次生成结果为空`, 12000);
		sink.fail("连续 3 次生成结果为空");
		return "";
	}

	/** 对齐 writer.generate_chapter：最多 3 轮「生成→格式校验→带修正注记重新生成」；中断/异常/全空返回"" */
	private async generateChapterStreamed(
		cfg: LlmConfigDoc,
		systemPrompt: string,
		prompt: string,
		writingStyle: string | undefined,
		sink: WritingStreamSink
	): Promise<string> {
		const sysMsg: Message = { role: "system", content: systemPrompt };
		let content = "";
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				content = await this.streamOnce(cfg, [sysMsg, { role: "user" as const, content: prompt }], sink);
			} catch (e) {
				this.genFailure(e, "创作", sink);
				return "";
			}
			if (!content.trim()) break; // 空结果 → 外层统一报错（与 Python break 一致）
			const reason = validateStoryTypeFormat(content, writingStyle);
			if (!reason) return content;
			new Notice(`生成内容不符合【编写类型】（第${String(attempt)}次）：${reason}\n正在附加格式修正要求重新生成…`, 8000);
			sink.reset();
			let retried: string;
			try {
				retried = await this.streamOnce(cfg, [sysMsg, { role: "user" as const, content: prompt + formatRetryNote(writingStyle, reason) }], sink);
			} catch (e) {
				this.genFailure(e, "创作", sink);
				return "";
			}
			const r2 = validateStoryTypeFormat(retried, writingStyle);
			if (retried.trim() && !r2) return retried;
			content = retried;
		}
		if (!content.trim()) {
			new Notice("✗ 创作失败：连续 3 次生成结果为空", 12000);
			sink.fail("连续 3 次生成结果为空");
		}
		return content;
	}

	// v0.1.4+ 起卷摘要不再在写盘命令后 eager 刷新：上下文组装需要时由 manager.ensureFreshVolumeSummary 延迟全量重建（输入=本卷全部成员章的新鲜章节摘要）。

	/** v0.1.4+ 摘要延迟生成的进度反馈——专用面板展示工作过程（GenProgressView）：每个 LLM 任务实时追加一行带时间戳的日志并自动滚底；onProgress(null)=本轮结束，追加分隔完成行后面板保持展示，直到下一轮生成清空或用户手动关闭。面板打开/写入失败仅告警，绝不影响生成本身 */
	private genRunOpen = false;
	private async notifyGenProgress(msg: string | null): Promise<void> {
		try {
			if (!msg) {
				if (this.genRunOpen) {
					const view = await this.getGenPanel(false); // 只找已开实例；用户中途关过面板则静默跳过收尾行
					view?.finishRun();
					this.genRunOpen = false;
				}
				return;
			}
			const view = await this.getGenPanel(true); // 无已开实例则新开 tab
			if (!view) return;
			if (!this.genRunOpen) {
				view.startRun(this.settings.lastStory?.trim() || undefined);
				this.genRunOpen = true;
			}
			view.appendLine(`⏳ ${msg}`);
		} catch (e) {
			console.warn("[articlewriter] 更新摘要进度面板失败：", e);
		}
	}

	/** 取「生成过程」面板视图：withOpen=false 只找已开启的实例（收尾用）；true=没有时新开一个 tab。失败返回 null */
	private async getGenPanel(withOpen: boolean): Promise<GenProgressView | null> {
		for (const l of this.app.workspace.getLeavesOfType(GenProgressView.VIEW_TYPE)) if (l.view instanceof GenProgressView) return l.view;
		if (!withOpen) return null;
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: GenProgressView.VIEW_TYPE, active: true });
		return leaf.view instanceof GenProgressView ? leaf.view : null;
	}

	/** v0.1.4+ 打开统一生成面板并进入流式小节（与摘要日志同一 ItemView，替换原独立 StreamingPreviewModal）：无实例则新开 tab；失败返回 null */
	private async beginWritingPanel(title: string): Promise<GenProgressView | null> {
		const view = await this.getGenPanel(true);
		if (!view) return null;
		view.beginStream(title);
		return view;
	}

	/** 生成后自动去AI味（对应 _auto_clean_ai）：命中 AI 常用词的句子打回 LLM 重写并原位替换；失败保留原文 */
	private async autoCleanAi(
		cfg: LlmConfigDoc,
		baseSp: string | undefined,
		guides: { guideText: string },
		content: string,
		onProgress?: () => void
	): Promise<string> {
		if (!content || !content.trim()) return content;
		const hits = findAiWordHits(content);
		if (!hits.length) return content;
		new Notice(`检测到 ${String(hits.length)} 处 AI 常用词，正在打回重写…`, 6000);
		onProgress?.();
		// 去AI味使用基础系统提示词（不带编写类型块），对齐 Python system_prompt=None 回落行为
		const sp = assembleSystemPrompt(undefined, guides.guideText, baseSp);
		try {
			const { text, report } = await cleanAiText(content, async (p, maxTokens) =>
				chatCompletion(cfg, [
					{ role: "system" as const, content: sp },
					{ role: "user" as const, content: p },
				], { max_tokens: Math.min(maxTokens, cfg.max_tokens ?? maxTokens) })
			);
			this.notifyAiReport(report);
			return text;
		} catch (e) {
			console.warn("AI 用语清洗失败，保留原文：", e);
			return content;
		}
	}

	/** 输出清洗结果摘要（对应 _print_ai_clean_report） */
	private notifyAiReport(report: import("./prompts").CleanReport): void {
		const parts: string[] = [];
		if (report.simplified.length) parts.push(`句式简化 ${String(report.simplified.length)} 处`);
		if (report.replaced.length) parts.push(`LLM 重写 ${String(report.replaced.length)} 句`);
		if (report.remaining.length) parts.push(`⚠ 仍残留 ${String(report.remaining.length)} 处（建议人工检查）`);
		if (report.errors.length) parts.push(`✗ ${String(report.errors.length)} 句改写失败已保留原句`);
		new Notice(parts.length ? `去AI味完成：${parts.join("，")}` : "去AI味完成", 8000);
	}

	/** 字数超限提醒（对应 _warn_word_limit） */
	private warnWordLimit(content: string, wordRange: [number, number]): void {
		const wc = countPureWords(content || "");
		if (wc > wordRange[1]) new Notice(`⚠ 生成内容 ${String(wc)} 字，超过上限 ${wordRange[1]} 字；如需要请精简`, 10000);
	}

	// ---------- /write 创作章节 ----------

	async cmdWrite(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			const scenes = await this.manager.loadAllScenes(story);
			const curSceneId = state.current_scene ?? undefined;
			const curScene = curSceneId ? scenes[curSceneId] : undefined;

			// 目标章节复合键：当前章 → 当前场景归属章 → 当前卷/书根内下一未建章（v0.0.15：编号在容器内自动顺延）
			const chapters = await this.manager.listChapters(story); // 阅读序：书根在前 + 各卷按 order、组内本地号升序
			let targetKey: string | null = state.current_chapter && state.current_chapter !== "" ? state.current_chapter : null;
			if (!targetKey && curScene?.chapter_num) targetKey = chKey(curScene.vol ?? "", curScene.chapter_num);
			if (!targetKey) {
				const basePath = this.manager.storyPath(story);
				const scopeVol = (state.current_volume ?? "").trim();
				const inScope = scopeVol ? chapters.filter((c) => c.vol === scopeVol) : chapters.filter((c) => !c.vol && c.parentPath === basePath);
				targetKey = chKey(scopeVol, inScope.length ? Math.max(...inScope.map((c) => c.num)) + 1 : 1);
			}

			const volNames = await this.volNameMap(story).catch(() => ({}));
			const tLabel = this.keyLabel(targetKey, volNames); // 展示名（含卷前缀），交互提示统一用它
			const targetVol = parseChKey(targetKey).vol ?? ""; // 新建章节的容器（""=书根）
			const chEntry = chapters.find((c) => c.key === targetKey) ?? null;
			const meta = state.chapters[targetKey] ?? null;
			const wasNew = !meta; // 对应 Python is_new（以状态元数据为准）
			const isNewLike = wasNew && !chEntry; // 全新章节（无目录且无元数据）
			const bodyOnDisk = chEntry ? await this.manager.readChapterContent(story, targetKey) : "";
			const outlineOnDisk = chEntry ? await this.manager.readChapterOutlineForPrompt(story, targetKey) : "";
			const hasContent = bodyOnDisk.trim() !== "";

			// 章节标题：已有取磁盘/状态；全新章节询问（Esc=取消）
			let title = ((meta?.title || "").trim()) || (chEntry ? chEntry.title : "") || `第${parseChKey(targetKey).num}章`;
			if (isNewLike) {
				const t = await this.prompt(`${tLabel}标题`, `${tLabel}`);
				if (t == null) return;
				title = t.trim() || `第${parseChKey(targetKey).num}章`;
			}

			// 写作指令交互（对齐 CLI args 语义）
			let instruction = "";
			if (hasContent) {
				const pick = await this.pickAction(`${this.keyLabel(targetKey, volNames, title)} 已有内容（${String(countPureWords(bodyOnDisk))} 字）`, [
					{ label: "给出新的创作要点", sub: "生成后选择追加或覆盖" },
					{ label: "暂不创作", sub: "仅提示当前状态" },
				]);
				if (pick == null) return;
				if (pick === 1) {
					new Notice("章节已有创作内容，请输入新的写作指令开始创作\n或使用「续写当前章 (/continue)」继续");
					return;
				}
				instruction = ((await this.prompt("创作要点", "如：写主角来到小镇的见闻")) ?? "").trim();
				if (!instruction) {
					new Notice("未输入创作要点，已取消");
					return;
				}
			} else if (!outlineOnDisk.trim()) {
				// 无正文且无大纲：才交互询问；有大纲时不再打扰（对齐 CLI /write「未提供写作指令→按大纲自动创作」语义）
				const pick = await this.pickAction(`${tLabel}还没有正文，也没有大纲`, [
					{ label: "先输入创作要点再开始" },
					{ label: "直接开始（无参考内容）" },
				]);
				if (pick == null) return;
				if (pick === 0) {
					instruction = ((await this.prompt("创作要点（可选）", "如：写主角与反派的初次交锋")) ?? "").trim();
				}
			} else {
				new Notice(`未提供写作指令，按${tLabel}大纲自动创作`, 4000); // 有大纲、无正文：直接开写，不弹任何输入框
			}

			let structureReady = !!chEntry;
			let outlineForGen = outlineOnDisk;

			// 全新章节且无指令：从磁盘/询问补充大纲（对应 is_new && !instruction 分支）
			if (!instruction && isNewLike && !outlineOnDisk.trim()) {
				const o = await this.promptArea(`${tLabel}大纲（可选）`, "- 情节要点一\n- 情节要点二");
				if (o == null) return;
				outlineForGen = o.trim();
			}

			// 未提供写作指令：有大纲且尚无正文 → 按大纲自动创作；否则只创建/就绪后返回
			if (!instruction) {
				if (!(outlineForGen.trim() !== "" && !hasContent)) {
					if (wasNew && !structureReady) {
						await this.manager.createChapter(story, title, targetVol); // 目标容器（卷/书根）内自动顺延编号
						structureReady = true;
						new Notice(`✓ 已创建 ${this.keyLabel(targetKey, volNames, title)}`, 6000);
					} else {
						new Notice(`✓ 已就绪：${this.keyLabel(targetKey, volNames, title)}`, 6000);
					}
					new Notice("章节已有创作内容时，请给出新的写作指令开始创作\n或使用「续写当前章 (/continue)」继续", 10000);
					return;
				}
			}

			// 追加还是覆盖（对应 a/r 询问，默认追加）
			let mode: "a" | "r" = "a";
			if (hasContent) {
				const m = await this.pickAction(`${this.keyLabel(targetKey, volNames, title)} 已有内容（${String(countPureWords(bodyOnDisk))} 字），如何处理？`, [
					{ label: "追加到现有内容之后", sub: "默认；自动剥离新内容的重复标题" },
					{ label: "覆盖整章正文" },
				]);
				if (m == null) return;
				mode = m === 1 ? "r" : "a";
			}

			// 生成前把用户指令并入大纲并落盘（仅对已有章节/已有大纲做预合并）
			if (instruction && !!(meta || chEntry || outlineOnDisk.trim())) {
				outlineForGen = appendOutlineInstruction(outlineOnDisk, "创作要点", instruction);
				if (!structureReady) {
					await this.manager.createChapter(story, title, targetVol); // 目标容器内自动顺延编号
					structureReady = true;
				}
				await this.manager.setChapterOutline(story, targetKey, outlineForGen);
				new Notice(`已更新${tLabel}大纲并保存`, 4000);
			}

			// 组装提示词与系统提示词（loadWritingData/readOutlineWindow 按磁盘阅读序定位，全新章须先建目录）
			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			if (!structureReady) {
				await this.manager.createChapter(story, title, targetVol); // 目标容器内自动顺延编号
				structureReady = true;
				new Notice(`✓ 已创建 ${this.keyLabel(targetKey, volNames, title)}`, 6000);
			}
			const data = await this.manager.loadWritingData(story, targetKey, { includeCurrentSummary: false });
			const context = buildWritingContext(data);
			let prevRefs: Array<{ label: string; text?: string }> = [];
			try {
				prevRefs = (await this.manager.readOutlineWindow(story, targetKey, { back: 3 })).map((w) => ({ label: w.label, text: w.text || undefined }));
			} catch { /* 前文大纲窗口读取失败不阻断生成 */ }
			const wordRange = wordRangeFromGuides(guides.bookText, guides.userText);
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const built = buildChapterPrompt({
				chapterNum: data.chapterNum, // v0.0.15：阅读序位置（ordinal，跨卷连续）
				chapterLabel: tLabel,
				chapterKey: targetKey,
				chapterOutlineRaw: outlineForGen,
				userInstruction: instruction || undefined,
				context,
				wordRange,
				descStyle: setup.descStyle,
				storyType: state.writing_style,
				prevOutlines: prevRefs,
			});

			// 流式生成（带编写类型格式校验重试）
			const modal = await this.beginWritingPanel(`创作 ${this.keyLabel(targetKey, volNames, title)}`);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			let content = await this.generateChapterStreamed(setup.cfg, sp, built.prompt, state.writing_style, modal);
			if (modal.signal.aborted) return;
			if (!content.trim()) return;

			// 后处理：去AI味 + 字数提醒
			content = await this.autoCleanAi(setup.cfg, setup.systemPrompt, guides, content, () => {
				modal.setStatus("正在去除 AI 常用词…");
			});
			this.warnWordLimit(content, wordRange);
			if (mode === "a" && hasContent) content = bodyOnDisk.replace(/\s+$/, "") + "\n\n" + stripHeading(content);
			if (content !== modal.fullText) {
				modal.reset();
				modal.append(content);
			}
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice(`未保存${wasNew ? "（新章节结构已保留，正文未写入）" : ""}`, 6000);
				return;
			}

			// 落盘：新章创建目录；追加/覆盖写正文；新章指令并入大纲
			if (!structureReady) {
				await this.manager.createChapter(story, title, targetVol); // 目标容器内自动顺延编号
				structureReady = true;
			}
			const words = await this.manager.setChapterBody(story, targetKey, content); // v0.1.4+：摘要不再写盘后即时生成——下次组装写作上下文时按需延迟生成（带进度反馈）
			if (wasNew) {
				let finalOutline = outlineForGen;
				if (instruction) finalOutline = appendOutlineInstruction(finalOutline, "创作要点", instruction);
				if (finalOutline.trim()) await this.manager.setChapterOutline(story, targetKey, finalOutline);
			}

			// 当前场景归属该章时同步场景正文（v0.0.15：按复合键比较）
			if (curScene?.chapter_num && chKey(curScene.vol ?? "", curScene.chapter_num) === targetKey) {
				const old = (curScene.content || "").replace(/\s+$/, "");
				const sceneNew = old ? `${old}\n\n${content}` : content;
				await this.manager.updateScene(story, curScene.scene_id, { content: sceneNew });
				new Notice(`✓ 已同步到场景 '${curScene.scene_id}'`, 6000);
			}

			try {
				const f = await this.manager.chapterBodyFile(story, targetKey);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* 打开失败不影响结果 */ }
			new Notice(`✓ ${this.keyLabel(targetKey, volNames, title)} 创作完成！\n字数：${String(words)}`, 8000);
		} catch (e) {
			this.notifyError("创作章节失败", e);
		}
	}

	// ---------- /continue 续写当前章 ----------

	async cmdContinueWriting(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const state = await this.manager.validatedState(story);
			const currentKey = state.current_chapter ?? ""; // v0.0.15：复合键（"volId:N"/"N"）
			if (!currentKey) {
				new Notice("还没有章节，请先使用「创作章节 (/write)」创建");
				return;
			}
			const chapters = await this.manager.listChapters(story);
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const curLabel = this.keyLabel(currentKey, volNames);
			const chEntry = chapters.find((c) => c.key === currentKey) ?? null;
			const meta = state.chapters[currentKey] ?? null;
			if (!chEntry) {
				if (meta) {
					// 状态中存在但磁盘目录未定位：交给 /write 兜底（有大纲则按大纲自动创作）
					await this.cmdWrite();
					return;
				}
				new Notice(`${curLabel}不存在`);
				return;
			}
			const bodyOnDisk = await this.manager.readChapterContent(story, currentKey);
			if (!bodyOnDisk.trim()) {
				new Notice(`${curLabel}还没有正文内容，将从章节大纲开始创作…`, 6000);
				await this.cmdWrite();
				return;
			}
			const outlineOnDisk = await this.manager.readChapterOutlineForPrompt(story, currentKey);

			// 续写要点（Esc=取消；留空=按两级大纲自然续写）
			const rawInstr = await this.prompt("续写要点（可选）", "如：写主角与反派的正面对峙");
			if (rawInstr == null) return;
			const instruction = rawInstr.trim();

			// 大纲覆盖率检查：已有内容且全部要点已覆盖、无新指令 → 跳过
			if (outlineOnDisk && !instruction) {
				const cov = checkOutlineCoverage(bodyOnDisk, outlineOnDisk);
				if (cov.allCovered) {
					new Notice(`⚠ ${curLabel}大纲要点已全部完成，无需续写\n请给出新的写作纲要后再试`, 10000);
					return;
				}
			}

			// 先把指令并入大纲落盘（对齐 cmd_continue 预合并语义）
			let mergedForGen = outlineOnDisk;
			if (instruction) {
				mergedForGen = appendOutlineInstruction(outlineOnDisk, "续写要点", instruction);
				await this.manager.setChapterOutline(story, currentKey, mergedForGen);
				new Notice(`已更新${curLabel}大纲并保存`, 4000);
			}

			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			const data = await this.manager.loadWritingData(story, currentKey, { includeCurrentSummary: true });
			const context = buildWritingContext(data);
			let prevRefs: Array<{ label: string; text?: string }> = [];
			try {
				prevRefs = (await this.manager.readOutlineWindow(story, currentKey, { back: 3 })).map((w) => ({ label: w.label, text: w.text || undefined }));
			} catch { /* 前文大纲窗口读取失败不阻断生成 */ }
			const wordRange = wordRangeFromGuides(guides.bookText, guides.userText);
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const built = buildContinuePrompt({
				chapterNum: data.chapterNum, // v0.0.15：阅读序位置（ordinal，跨卷连续）
				chapterLabel: curLabel,
				chapterKey: currentKey,
				userInstruction: instruction || undefined,
				context,
				globalOutlineRaw: data.globalOutlineRaw,
				chapterOutlineRaw: mergedForGen,
				prevOutlines: prevRefs,
				descStyle: setup.descStyle,
				storyType: state.writing_style,
				currentSummary: data.summaries[data.chapterNum] ?? "",
				existingContent: bodyOnDisk,
				wordRange,
			});

			const modal = await this.beginWritingPanel(`续写 ${this.keyLabel(currentKey, volNames, meta?.title || chEntry.title)}`);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			let content = await this.streamWithEmptyRetry(
				setup.cfg,
				() => [
					{ role: "system" as const, content: sp },
					{ role: "user" as const, content: built.prompt },
				],
				modal,
				"续写"
			);
			if (modal.signal.aborted) return;
			if (!content.trim()) return;

			content = stripHeading(content); // 剥离 LLM 自带的章节标题，避免重复标题
			content = await this.autoCleanAi(setup.cfg, setup.systemPrompt, guides, content, () => {
				modal.setStatus("正在去除 AI 常用词…");
			});
			this.warnWordLimit(content, wordRange);
			const newContent = bodyOnDisk.replace(/\s+$/, "") + "\n\n" + content;
			if (newContent !== modal.fullText) {
				modal.reset();
				modal.append(newContent);
			}
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（续写内容仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, currentKey, newContent); // v0.1.4+：摘要延迟到下次上下文组装时按需生成
			try {
				const f = await this.manager.chapterBodyFile(story, currentKey);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ 续写完成！\n新增字数：${String(countPureWords(content))}\n总字数：${String(words)}`, 8000);
		} catch (e) {
			this.notifyError("续写失败", e);
		}
	}

	// ---------- /rewrite 重写本章 ----------

	async cmdRewriteChapter(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const num = await this.targetChapterKey(story, "重写"); // v0.0.15：复合键
			if (num == null) return;
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const chLabel = this.keyLabel(num, volNames);
			const bodyOnDisk = await this.manager.readChapterContent(story, num);
			if (!bodyOnDisk.trim()) {
				new Notice(`${chLabel}还没有内容，请先使用「创作章节 (/write)」`);
				return;
			}
			const rawInstr = await this.prompt("重写要求（可选）", '如："改为反派视角"、"增加反转"、"压缩节奏"');
			if (rawInstr == null) return;
			const instruction = rawInstr.trim();

			const state = await this.manager.validatedState(story);
			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			const data = await this.manager.loadWritingData(story, num, { includeCurrentSummary: true });
			const context = buildWritingContext(data);
			let bridge: { prev?: { label: string; text?: string }; cur?: { label: string; text?: string }; nxt?: { label: string; text?: string } } = {};
			try {
				for (const w of await this.manager.readOutlineWindow(story, num, { back: 1, fwd: 1 })) {
					const ref = { label: w.label, text: w.text || undefined };
					if (w.key === num) bridge.cur = ref;
					else if (w.ordinal < data.chapterNum) bridge.prev = ref;
					else bridge.nxt = ref;
				}
			} catch { /* 大纲桥读取失败不阻断重写 */ }
			const wordRange = wordRangeFromGuides(guides.bookText, guides.userText);
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const prompt = buildRewritePrompt({
				chapterNum: data.chapterNum, // v0.0.15：阅读序位置（ordinal，跨卷连续）
				chapterLabel: chLabel,
				userInstruction: instruction || undefined,
				context,
				bridge,
				oldContent: bodyOnDisk,
				currentSummary: data.summaries[data.chapterNum] ?? "",
				wordRange,
				storyType: state.writing_style,
			});

			const modal = await this.beginWritingPanel(`重写 ${chLabel}`);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			let content = await this.streamWithEmptyRetry(
				setup.cfg,
				() => [
					{ role: "system" as const, content: sp },
					{ role: "user" as const, content: prompt },
				],
				modal,
				"重写"
			);
			if (modal.signal.aborted) return;
			if (!content.trim()) {
				new Notice("✗ 重写结果为空", 8000);
				return;
			}
			content = await this.autoCleanAi(setup.cfg, setup.systemPrompt, guides, content, () => {
				modal.setStatus("正在去除 AI 常用词…");
			});
			if (content !== modal.fullText) {
				modal.reset();
				modal.append(content);
			}
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（重写结果仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, num, content); // 全量覆盖；v0.1.4+：摘要延迟到下次上下文组装时按需生成
			try {
				const f = await this.manager.chapterBodyFile(story, num);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ ${chLabel}已重写（${String(words)} 字）`, 8000);
		} catch (e) {
			this.notifyError("重写章节失败", e);
		}
	}

	// ---------- /polish 润色当前章 ----------

	async cmdPolishText(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const state = await this.manager.validatedState(story);
			const currentKey = state.current_chapter ?? ""; // v0.0.15：复合键（"volId:N"/"N"）
			if (!currentKey) {
				new Notice("还没有章节，请先使用「创作章节 (/write)」创建");
				return;
			}
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const curLabel = this.keyLabel(currentKey, volNames);
			const bodyOnDisk = await this.manager.readChapterContent(story, currentKey);
			if (!bodyOnDisk.trim()) {
				new Notice(`${curLabel}还没有内容`);
				return;
			}
			const rawStyle = await this.prompt("润色风格（可选）", "如：更简洁有力、更有画面感");
			if (rawStyle == null) return; // Esc=取消
			const style = rawStyle.trim();

			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			const data = await this.manager.loadWritingData(story, currentKey, { includeCurrentSummary: true });
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const prompt = buildPolishPrompt({
				text: bodyOnDisk,
				style: style || undefined,
				summary: data.summaries[data.chapterNum] ?? "",
				storyType: state.writing_style,
			});

			const modal = await this.beginWritingPanel(`润色 ${curLabel}`);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			let content = await this.streamWithEmptyRetry(
				setup.cfg,
				() => [
					{ role: "system" as const, content: sp },
					{ role: "user" as const, content: prompt },
				],
				modal,
				"润色"
			);
			if (modal.signal.aborted) return;
			if (!content.trim()) {
				new Notice("✗ 润色结果为空", 8000);
				return;
			}
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（润色结果仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, currentKey, content); // 全量覆盖原章节；v0.1.4+：摘要延迟到下次上下文组装时按需生成
			try {
				const f = await this.manager.chapterBodyFile(story, currentKey);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ 已保存润色结果到${curLabel}（${String(words)} 字）`, 8000);
		} catch (e) {
			this.notifyError("润色失败", e);
		}
	}

	// ---------- /deai 去AI味 ----------

	async cmdDeaiClean(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const num = await this.targetChapterKey(story, "去除 AI 常用词"); // v0.0.15：复合键
			if (num == null) return;
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const chLabel = this.keyLabel(num, volNames);
			const bodyOnDisk = await this.manager.readChapterContent(story, num);
			if (!bodyOnDisk.trim()) {
				new Notice(`${chLabel}还没有内容`);
				return;
			}
			const hits = findAiWordHits(bodyOnDisk);
			if (!hits.length) {
				new Notice(`✓ ${chLabel}未检测到 AI 常用词`, 6000);
				return;
			}
			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			const baseSp = assembleSystemPrompt(undefined, guides.guideText, setup.systemPrompt); // 去AI味用基础系统提示词

			const n = new Notice(`正在清洗${chLabel}的 AI 常用词（${String(hits.length)} 处）…\n逐句打回 LLM 重写，可能需要一点时间`);
			let cleaned: string;
			try {
				const r = await cleanAiText(
					bodyOnDisk,
					async (p, maxTokens) =>
						chatCompletion(setup.cfg, [
							{ role: "system" as const, content: baseSp },
							{ role: "user" as const, content: p },
						], { max_tokens: Math.min(maxTokens, setup.cfg.max_tokens ?? maxTokens) })
				);
				cleaned = r.text;
				this.notifyAiReport(r.report);
			} catch (e) {
				n.hide();
				this.notifyError("去AI味失败", e);
				return;
			}
			n.hide();

			if (!cleaned.trim()) {
				new Notice("✗ 清洗结果为空", 8000);
				return;
			}
			const modal = await this.beginWritingPanel(`去AI味结果 · ${chLabel}`);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			modal.append(cleaned);
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（清洗结果仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, num, cleaned); // 全量覆盖；v0.1.4+：摘要延迟到下次上下文组装时按需生成
			try {
				const f = await this.manager.chapterBodyFile(story, num);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ ${chLabel}已更新（${String(words)} 字）`, 8000);
		} catch (e) {
			this.notifyError("去AI味失败", e);
		}
	}

	// ---------- /review 审阅本章 ----------

	async cmdReviewChapter(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const state = await this.manager.validatedState(story);
			void state;
			const num = await this.targetChapterKey(story, "审阅"); // v0.0.15：复合键
			if (num == null) return;
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const chLabel = this.keyLabel(num, volNames);
			const bodyOnDisk = await this.manager.readChapterContent(story, num);
			if (!bodyOnDisk.trim()) {
				new Notice(`${chLabel}还没有内容，无法审阅`);
				return;
			}
			const rawInstr = await this.prompt("重点审阅要求（可选）", "如：重点检查时间线与人物动机");
			if (rawInstr == null) return;
			const instruction = rawInstr.trim();

			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			const data = await this.manager.loadWritingData(story, num, { includeCurrentSummary: false });
			const context = buildWritingContext(data);
			let bridge: { prev?: { label: string; text?: string }; cur?: { label: string; text?: string }; nxt?: { label: string; text?: string } } = {};
			try {
				for (const w of await this.manager.readOutlineWindow(story, num, { back: 1, fwd: 1 })) {
					const ref = { label: w.label, text: w.text || undefined };
					if (w.key === num) bridge.cur = ref;
					else if (w.ordinal < data.chapterNum) bridge.prev = ref;
					else bridge.nxt = ref;
				}
			} catch { /* 大纲桥读取失败不阻断审阅 */ }
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const prompt = buildReviewPrompt({
				chapterNum: data.chapterNum, // v0.0.15：阅读序位置（ordinal，跨卷连续）
				chapterLabel: chLabel,
				userInstruction: instruction || undefined,
				context,
				bridge,
				chapterContent: bodyOnDisk,
			});

			const n = new Notice(`正在从全局视角审阅${chLabel}…\n将结合小说大纲、前文与角色设定分析本章逻辑，请耐心等待`);
			let report = "";
			for (let attempt = 1; attempt <= 3 && !report.trim(); attempt++) {
				try {
					report = await chatCompletion(setup.cfg, [
						{ role: "system" as const, content: sp },
						{ role: "user" as const, content: prompt },
					]);
				} catch (e) {
					n.hide();
					const msg = e instanceof Error ? e.message : String(e);
					if ((msg.includes("未返回内容") || msg.includes("输出为空")) && attempt < 3) {
						new Notice(`审阅结果为空（第${String(attempt)}次），正在重试…`, 6000);
						continue;
					}
					this.notifyError("审阅失败", e);
					return;
				}
			}
			n.hide();
			if (!report.trim()) {
				new Notice("✗ 审阅结果为空：服务繁忙或生成被中断，请稍后重试", 12000);
				return;
			}

			const modal = await this.beginWritingPanel(`审阅报告 · ${chLabel}`);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			modal.append(report);
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（仅预览）", 6000);
				return;
			}
			const path = await this.manager.saveReviewNote(story, num, report);
			await this.manager.openMarkdown(path).catch(() => undefined);
			new Notice(`✓ 审阅笔记已保存到\n${path}`, 8000);
		} catch (e) {
			this.notifyError("审阅失败", e);
		}
	}
}

/** 多行文本展示框 */
class StatusModal extends Modal {
	constructor(app: App, private lines: string[]) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "小说状态 / 统计" });
		this.contentEl.createEl("pre", { cls: "aw-status-pre" }).setText(this.lines.join("\n")); // white-space:pre-wrap 走类名
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

class ArticleWriterSettingTab extends PluginSettingTab {
	plugin: ArticleWriterPlugin;

	constructor(plugin: ArticleWriterPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	// ===== 声明式设置（唯一实现：minAppVersion=1.13.0 保证框架恒调 getSettingDefinitions；pre-1.13 的已废弃 display()/renderLlm 旧渲染路径已删除——目录校验器禁 deprecated API）=====

	private conf(): PluginConfig {
		return this.plugin.settings.llm ?? (this.plugin.settings.llm = buildDefaultLlmConf());
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const cfgs = this.conf().llm_configs ?? [];
		const defs: SettingDefinitionItem[] = [];

		defs.push({ name: "工作目录（work_dir）", desc: "写小说的文件夹（vault 内已有文件夹）。首次使用任何命令时会自动弹出选择器让你选定；以后建书/建章/打开文档等全部在该目录下操作。每个小说是其下一个子文件夹：故事状态.md、大纲.md、第NN章-标题/章节.md 等", control: { key: "workDir", type: "text", placeholder: "首次使用时自动选择" } });
		defs.push({ name: "重新选择工作目录…", desc: "弹出文件夹选择器切换 work_dir（同「选择工作目录」命令）", action: () => void this.plugin.pickWorkDir(false) });
		defs.push({ name: "创建后自动打开文档", desc: "新建小说/章节后立即在标签页中打开对应正文或大纲", control: { key: "autoOpenOnCreate", type: "toggle" } });
		defs.push({ name: "前文参考章数 prevN", desc: "写作命令生成提示词时注入【前文内容】的最近 N 章（每章取 AI 摘要、缺失自动生成；0=不注入前文）。留空=默认 3。卷模式下窗口限本卷，不再拉取他卷章节细节", control: { key: "prevChapters", type: "text", placeholder: "默认 3" } });
		defs.push({ name: "注入整卷《卷摘要》", desc: "开启后写作上下文额外包含当前卷完整《卷摘要》，跨卷缺口另以各前卷《卷摘要》填充（含触发 LLM 重建）；关闭=严格只注入最近 N 章（对齐 Python 原版语义，默认关）", control: { key: "includeVolumeSummary", type: "toggle" } });

		const llmNameMap = cfgs.reduce<Record<string, string>>((m, c) => { m[c.name] = c.name; return m; }, {}); // ES2019 同名 API 的低版本等价写法：构造 name→name 恒等映射
		defs.push({ type: "group", heading: "LLM 全局设置", items: [
			{ name: "当前激活配置（active_llm）", desc: "连接测试与写作命令使用该配置", control: { key: "llm.active_llm", type: "dropdown", options: llmNameMap, defaultValue: "" } },
			{ name: "写作系统提示词 system_prompt", desc: "全局基础系统提示词：无编写类型格式块时使用；留空=内置默认。对齐 CLI config.json 的 system_prompt", control: { key: "llm.system_prompt", type: "textarea", rows: 5, placeholder: "留空使用内置默认" } },
			{ name: "描述方式 desc_style", desc: "normal / complete（对齐 CLI）", control: { key: "llm.desc_style", type: "dropdown", options: { normal: "normal", complete: "complete" }, defaultValue: "normal" } },
		] });

		defs.push({ type: "list", heading: "模型配置（llm_configs，存于插件数据目录 data.json）", emptyState: "没有模型配置。", addItem: { name: "新建配置", action: () => void this.addLlmConfig() }, onDelete: (i) => void this.removeLlmConfig(i), onReorder: (o, n) => void this.reorderLlmConfigs(o, n), items: cfgs.map((cfg, i) => this.configPage(cfg, i)) });

		defs.push({ name: "关于", desc: "ArticleWriter Obsidian 版：建书/建章、打开文档、保存、字数统计；数据全部为 vault 内 MD 文档，运行态存于各书的「故事状态.md」YAML 文件属性（version 2）。LLM 走 OpenAI 兼容接口（openai SDK），可接 DeepSeek / DashScope / Ollama / LM Studio / llama.cpp 等。api_key 明文存放——同步/分享 vault 时注意不要泄露配置文件。" });
		return defs;
	}

	private configPage(cfg: LlmConfigDoc, i: number): SettingDefinitionPage<string> {
		const active = this.conf().active_llm === cfg.name;
		const strFields: Array<[keyof LlmConfigDoc, string, string]> = [
			["base_url", "服务地址 base_url", "如 http://localhost:8509 或 https://api.deepseek.com（已含 /vN 不重复拼接）"],
			["model_name", "模型 model_name", "本地服务可留空（用其已加载模型）"],
			["api_key", "API Key api_key", "明文存于插件数据目录 data.json"],
			["reasoning_effort", "推理强度 reasoning_effort", "low/medium/high（兼容端点支持时生效）"],
		];
		const numFields: Array<[keyof LlmConfigDoc, string]> = [["temperature", "温度 temperature"], ["max_tokens", "最大 token max_tokens"]];
		const items: SettingDefinitionItem[] = [];
		items.push({ name: "设为激活（active_llm）", desc: active ? "当前激活中" : "保存后，连接测试与写作命令将使用该配置", disabled: active || undefined, action: () => void this.setActiveLlm(cfg.name) });
		items.push({ name: "测试连接", desc: "对该配置执行 GET /models 连通性测试并弹通知（列出可用模型）", action: () => void this.plugin.runLlmTest(cfg) });
		for (const [k, label] of numFields) items.push({ name: label, control: { key: `cfg.${i}.${String(k)}`, type: "text", placeholder: String(k) } });
		for (const [k, label, ph] of strFields) items.push({ name: label, desc: ph, control: { key: `cfg.${i}.${String(k)}`, type: "text", placeholder: ph } });
		return { type: "page", name: `${cfg.name}${active ? " ◀ 当前" : ""}`, desc: cfg.base_url || "（未填服务地址）", displayValue: () => [cfg.model_name && `模型 ${cfg.model_name}`, cfg.base_url].filter(Boolean).join(" · "), status: cfg.base_url ? null : ("warning" as const), items };
	}

	getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (key === "workDir") return s.workDir ?? "";
		if (key === "autoOpenOnCreate") return !!s.autoOpenOnCreate;
		if (key === "prevChapters") return s.prevChapters == null ? "" : String(s.prevChapters); // v0.1.4+：空=按内置默认 3
		if (key === "includeVolumeSummary") return !!s.includeVolumeSummary; // v0.1.4+：卷摘要注入开关（缺省=false）
		const c = this.conf();
		if (key === "llm.active_llm") {
			const names = (c.llm_configs ?? []).map((x) => x.name);
			return c.active_llm && names.includes(c.active_llm) ? c.active_llm : (names[0] ?? "");
		}
		if (key === "llm.system_prompt") return c.system_prompt ?? "";
		if (key === "llm.desc_style") return c.desc_style || "normal";
		if (key.startsWith("cfg.")) {
			const parts = key.split(".");
			const field = parts.slice(2).join(".") as keyof LlmConfigDoc;
			const v = (c.llm_configs ?? [])[Number(parts[1])]?.[field];
			return v == null ? "" : String(v);
		}
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		const str = typeof value === "string" ? value : "";
		if (key === "workDir") {
			s.workDir = str.trim().replace(/^\/+|\/+$/g, "");
			s.lastStory = "";
			await this.plugin.saveSettings();
			return;
		}
		if (key === "autoOpenOnCreate") {
			s.autoOpenOnCreate = value === true;
			await this.plugin.saveSettings();
			return;
		}
		if (key === "prevChapters") { // v0.1.4+：非负整数；留空/非法=清除回落内置默认 3（对齐 cfg 数值字段「空=undefined」约定）
			const n = Number(str);
			s.prevChapters = str.trim() !== "" && !Number.isNaN(n) && n >= 0 ? Math.floor(n) : undefined;
			await this.plugin.saveSettings();
			return;
		}
		if (key === "includeVolumeSummary") { // v0.1.4+：布尔开关，关闭存 false（缺省即关）
			s.includeVolumeSummary = value === true;
			await this.plugin.saveSettings();
			return;
		}
		const c = this.conf();
		if (key === "llm.active_llm") c.active_llm = str || undefined;
		else if (key === "llm.system_prompt") c.system_prompt = str.trim() || undefined;
		else if (key === "llm.desc_style") c.desc_style = str || "normal";
		else if (key.startsWith("cfg.")) {
			const parts = key.split(".");
			const field = parts.slice(2).join(".") as keyof LlmConfigDoc;
			const cfg = (c.llm_configs ?? [])[Number(parts[1])];
			if (!cfg) return;
			const rec = cfg as unknown as Record<string, unknown>;
			if (field === "temperature" || field === "max_tokens") { const n = Number(str); rec[field] = str.trim() !== "" && !Number.isNaN(n) ? n : undefined; }
			else rec[field] = str.trim() || undefined;
		} else return; // 未知键忽略
		await this.plugin.saveSettings();
		this.update();
	}

	private async addLlmConfig(): Promise<void> {
		const conf = this.conf();
		const cfgs = (conf.llm_configs ??= []);
		let i = cfgs.length + 1;
		let name = `config-${i}`;
		while (cfgs.some((x) => x.name === name)) { i++; name = `config-${i}`; }
		cfgs.push({ name, provider: "openai", api_key: "", base_url: "", model_name: "", temperature: 0.8, max_tokens: 65535, top_p: 0.9, repeat_penalty: 1.1, thinking: "", reasoning_effort: "high", openai_extras: [], api_style: "" });
		if (!conf.active_llm) conf.active_llm = name;
		await this.plugin.saveSettings();
		this.update();
		new Notice("已新建模型配置，请填写服务地址/模型/API Key");
	}

	private removeLlmConfig(i: number): void {
		void (async () => {
			const conf = this.conf();
			const cfgs = conf.llm_configs ?? [];
			const removed = cfgs.splice(i, 1)[0];
			if (removed && conf.active_llm === removed.name) conf.active_llm = cfgs[0]?.name; // 删激活项则回落到第一个（可能为 undefined=空列表）
			await this.plugin.saveSettings();
			this.update();
		})();
	}

	private reorderLlmConfigs(oldIndex: number, newIndex: number): void {
		void (async () => {
			const cfgs = this.conf().llm_configs ?? [];
			const [moved] = cfgs.splice(oldIndex, 1);
			cfgs.splice(newIndex, 0, moved);
			await this.plugin.saveSettings();
			this.update();
		})();
	}

	private setActiveLlm(name: string): void {
		void (async () => {
			this.conf().active_llm = name;
			await this.plugin.saveSettings();
			this.update();
		})();
	}
}
