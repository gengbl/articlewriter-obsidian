import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder } from "obsidian";
import { ActionItem, ActionMenuModal, ChapterListModal, ConfirmModal, FolderPickerModal, MarkdownViewerModal, MultiFieldModal, NewStoryInput, NewStoryModal, PanelLine, StoryPickerModal, StreamingPreviewModal, TextAreaPrompt, TextPanelModal, TextInputModal } from "./modals";
import { LlmChatView } from "./llm_chat_view";
import { StatusView, type StatusAction, type StatusChapterEntry, type StatusDetail, type StatusSnapshot, type StatusStoryEntry } from "./status_view";
import { chapterOutlineTemplate, countPureWords, FORESHADOW_TEMPLATE, formatLocalDateTime, NOTES_TEMPLATE, outlineTemplate, WORLD_TEMPLATE } from "./story_types";
import { safeFilename } from "./story_types";
import { StoryManager } from "./story_manager";
import { buildDefaultLlmConf } from "./plugin_config";
import type { LlmConfigDoc, PluginConfig } from "./plugin_config";
import { DEFAULT_SYSTEM_GUIDE } from "./system_guide_default";
import { assembleSystemPrompt, chatCompletion, chatStream, normalizeBaseURL, testConnection } from "./llm_client";
import type { Message } from "./llm_client";
import { findAiWordHits, mergeGuideCategories } from "./banned_words";
import { appendOutlineInstruction, buildChapterPrompt, buildContinuePrompt, buildPolishPrompt, buildReviewPrompt, buildRewritePrompt, buildStoryTypeSystemPrompt, buildWritingContext, checkOutlineCoverage, cleanAiText, formatRetryNote, stripHeading, validateStoryTypeFormat, wordRangeFromGuides } from "./prompts";
import { splitList } from "./md_docs";

interface ArticleWriterSettings {
	workDir: string; // 写小说的文件夹（对齐 CLI --work_dir / /dir）；空=未初始化，首次用命令时弹选择器
	lastStory: string;
	autoOpenOnCreate: boolean;
	llm?: PluginConfig; // LLM 多组模型配置 + system_prompt/desc_style（替代 ~/.articlewriter/config.json，存插件数据目录 data.json）
}

const DEFAULT_SETTINGS: ArticleWriterSettings = {
	workDir: "",
	lastStory: "",
	autoOpenOnCreate: true,
};

export default class ArticleWriterPlugin extends Plugin {
	settings: ArticleWriterSettings = { ...DEFAULT_SETTINGS };
	manager!: StoryManager;
	private statusRefreshTimer: number | null = null; // 工作目录内文件变更 → 防抖刷新已打开状态面板的定时器

	async onload(): Promise<void> {
		await this.loadSettings();
		this.manager = new StoryManager({ app: this.app, getStoryRoot: () => this.settings.workDir, onStateChanged: () => this.notifyContextChanged() });

		this.addCommand({ id: "set-work-dir", name: "选择工作目录（work_dir，对齐 CLI --work_dir）", callback: () => this.pickWorkDir(false) });
		this.addCommand({ id: "switch-story", name: "切换当前小说（/dir：选书并加载其状态）", callback: () => this.cmdSwitchStory() });

		this.addCommand({ id: "new-story", name: "创建新小说（建书：小说文件夹+模板文档）", callback: () => this.cmdNewStory() });
		this.addCommand({ id: "new-chapter", name: "新建章节（章节目录+正文/大纲等文档）", callback: () => this.cmdNewChapter() });
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
		this.addCommand({ id: "rescan-story", name: "扫描重建小说状态文档（以磁盘为准）", callback: () => this.cmdRescanStory() });
		this.addCommand({ id: "set-style", name: "设置编写类型（网文小说/剧本/普通小说/散文随笔…）", callback: () => this.cmdSetStyle() });
		this.addCommand({ id: "agents-view", name: "查看创作规范 WRITING_GUIDE.md（对齐 CLI /agents view：小说级/用户级/系统级三层）", callback: () => this.cmdAgentsView() });
		this.addCommand({ id: "agents-edit", name: "编辑创作规范 WRITING_GUIDE.md（对齐 CLI /agents edit：小说级/用户级/系统级三层）", callback: () => this.cmdAgentsEdit() });
		this.addCommand({ id: "llm-test", name: "LLM 连接测试（/llm test：GET /models 验证当前激活配置）", callback: () => this.cmdLlmTest() });

		this.addCommand({ id: "write-chapter", name: "创作章节（/write：按大纲+指令 LLM 流式生成，自动去AI味后保存）", callback: () => this.cmdWrite() });
		this.addCommand({ id: "continue-writing", name: "续写当前章（/continue：按两级大纲在正文末尾继续）", callback: () => this.cmdContinueWriting() });
		this.addCommand({ id: "rewrite-chapter", name: "重写本章（/rewrite：基于大纲与旧文整体重构）", callback: () => this.cmdRewriteChapter() });
		this.addCommand({ id: "polish-text", name: "润色当前章（/polish：仅优化文字表达不改情节）", callback: () => this.cmdPolishText() });
		this.addCommand({ id: "deai-clean", name: "去AI味（/deai：含 AI 常用词的句子打回 LLM 重写并原位替换）", callback: () => this.cmdDeaiClean() });
		this.addCommand({ id: "review-chapter", name: "审阅本章（/review：全局视角查逻辑/连贯性问题出报告）", callback: () => this.cmdReviewChapter() });
		this.addCommand({ id: "llm-chat", name: "打开 LLM 对话窗口（常驻面板：多轮流式聊天，可停靠任意区域、切换已保存的模型配置）", callback: () => void this.openLlmPanel() });
		this.addCommand({ id: "status-page", name: "打开工作状态面板（当前书/章节/文件一览，点击小说或章节可切换激活）", callback: () => void this.openStatusPanel() });

		this.registerView(LlmChatView.VIEW_TYPE, (leaf) => new LlmChatView(leaf, () => this.settings.llm, () => this.getChatSystemPrompt(), () => this.getActiveStoryInfo()));
		this.registerView(StatusView.VIEW_TYPE, (leaf) => new StatusView(leaf, () => this.getStatusSnapshot(), (name) => this.statusSwitchStory(name), (story, num) => this.statusActivateChapter(story, num), (a) => this.handleStatusAction(a)));
		this.addRibbonIcon("message-square", "打开 LLM 对话窗口（常驻面板）", () => void this.openLlmPanel());
		this.addRibbonIcon("book-open", "打开工作状态面板（当前书/章节/文件）", () => void this.openStatusPanel());
		this.addSettingTab(new ArticleWriterSettingTab(this));

		// 工作目录内文件变更（编辑器写作自动落盘等）→ 防抖刷新所有已打开状态面板，让章节字数实时跟进写作进度
		const watchFile = (file: TAbstractFile) => {
			if (file instanceof TFile && file.path.endsWith(".md") && this.pathUnderWorkDir(file.path)) this.scheduleStatusPanelRefresh();
		};
		this.registerEvent(this.app.vault.on("modify", watchFile));
		this.registerEvent(this.app.vault.on("create", watchFile));
		this.registerEvent(this.app.vault.on("delete", watchFile));
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
				if (state && state.current_chapter != null) sub += `　当前第${String(state.current_chapter).padStart(2, "0")}章`;
			} catch {
				sub = "（状态读取失败）";
			}
			items.push({ label: s, sub, marker: s === this.settings.lastStory ? "◀ 当前" : undefined });
		}
		const idx = await this.pickAction("切换当前小说（/dir）", items);
		if (idx == null) return;
		this.settings.lastStory = stories[idx];
		await this.saveSettings();
		new Notice(`已切换到：${stories[idx]}`, 6000);
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

	// ---------- 交互辅助 ----------

	private prompt(title: string, placeholder: string): Promise<string | null> {
		return new Promise((resolve) => {
			new TextInputModal(
				this.app,
				title,
				placeholder,
				(value) => resolve(value),
				() => resolve(null)
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
		if (!story) return;
		const chapters = await this.manager.listChapters(story);
		const nextNum = chapters.length ? Math.max(...chapters.map((c) => c.num)) + 1 : 1;
		const numText = await this.prompt("新建章节", `章节号（留空默认 ${nextNum}）`);
		if (numText == null) return;
		const parsed = parseInt(numText, 10);
		const num = Number.isFinite(parsed) && parsed > 0 ? parsed : nextNum;
		const title = await this.prompt(`第${num}章`, "章节标题");
		if (title == null || !title.trim()) return;
		try {
			const bodyPath = await this.manager.createChapter(story, num, title.trim());
			new Notice(`已创建第${String(num).padStart(2, "0")}章-${title.trim()}：章节目录与文档就绪`);
			if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(bodyPath);
		} catch (e) {
			new Notice(`创建失败：${(e as Error).message}`);
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
		new ChapterListModal(
			this.app,
			chapters.map((c) => ({ num: c.num, title: c.title, path: c.dir.path, isCurrent: state?.current_chapter === c.num })),
			async (item) => {
				await this.manager.switchChapter(story, item.num);
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
			...rows.map((r) => `  第${String(r.num).padStart(2, "0")}章 ${r.title}　${r.words} 字`),
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
			`题材：${state.genre || "-"}　编写类型：${state.writing_style || "-"}`,
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
		lines.push(`当前卷：${volName || "-"}　当前场景：${state.current_scene || "-"}`);
		lines.push(`章节数：${chapters.length}　总字数（纯文字）：${total}`);
		lines.push(`创建：${formatLocalDateTime(state.created_at, true)}　更新：${formatLocalDateTime(state.updated_at, true)}`);
		new StatusModal(this.app, lines).open();
	}

	// ---------- 通用交互辅助 ----------

	private chapterLabel(num: number, title?: string): string {
		return `第${String(num).padStart(2, "0")}章${title ? ` ${title}` : ""}`;
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

	/** 无当前章节时弹框询问章节号 */
	private async requireChapterNum(story: string): Promise<number | null> {
		const state = await this.manager.loadState(story);
		if (state?.current_chapter != null) return state.current_chapter;
		const t = await this.prompt("没有当前章节", "请输入章节号");
		if (t == null) return null;
		const n = parseInt(t, 10);
		const chapters = await this.manager.listChapters(story);
		if (!Number.isFinite(n) || !chapters.some((c) => c.num === n)) {
			new Notice(`第${n ?? "?"}章不存在`);
			return null;
		}
		return n;
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
			const lines: Array<string | PanelLine> = [];
			for (const v of vols) {
				lines.push({ text: `${state.current_volume === v.id ? "◀ " : ""}${v.name}`, bold: true });
				if (v.description) lines.push(`　　描述：${v.description}`);
				const assigned = Object.entries(state.chapters)
					.filter(([, m]) => m.volume === v.id)
					.map(([k]) => parseInt(k, 10))
					.sort((a, b) => a - b);
				lines.push(assigned.length ? `　　归属章节：${assigned.map((n) => this.chapterLabel(n)).join("、")}` : "　　暂无归属章节");
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
		const name = await this.prompt("新建卷", "卷名");
		if (name == null || !name.trim()) return;
		const descText = await this.prompt(name.trim(), "卷描述（可留空）");
		if (descText == null) return;
		try {
			const vol = await this.manager.addVolume(story, name.trim(), descText.trim());
			await this.manager.activateVolume(story, vol.id); // 设为当前卷（有章则切到该卷最后一章）
			new Notice(`已创建卷「${vol.name}」(${vol.id})，并设为当前卷`);
			const doChapter = await this.confirmBox("顺带建章", `是否立即创建一个新章节并归属到卷「${vol.name}」？`, "创建");
			if (!doChapter) return;
			const chapters = await this.manager.listChapters(story);
			const nextNum = chapters.length ? Math.max(...chapters.map((c) => c.num)) + 1 : 1;
			const t = await this.prompt(`新建第${nextNum}章`, "章节标题");
			if (t == null) return;
			const title = t.trim() || String(nextNum);
			const bodyPath = await this.manager.createChapter(story, nextNum, title);
			await this.manager.setChapterVolume(story, nextNum, vol.id);
			new Notice(`${this.chapterLabel(nextNum, title)} 已创建并归属卷「${vol.name}」`);
			if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(bodyPath);
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	async cmdVolumeManage(): Promise<void> {
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
			const idx = await this.pickAction(
				"选择要管理的卷",
				vols.map((v) => ({ label: v.name, sub: v.description || v.id, marker: state.current_volume === v.id ? "◀ 当前" : undefined }))
			);
			if (idx == null) return;
			const vol = vols[idx];
			const assignedNums = Object.entries(state.chapters)
				.filter(([, m]) => m.volume === vol.id)
				.map(([k]) => parseInt(k, 10))
				.sort((a, b) => a - b);
			const act = await this.pickAction(`管理卷「${vol.name}」`, [
				{ label: "启用此卷（设为当前卷并切到其最后一章）" },
				{ label: "重命名卷" },
				{ label: "编辑描述" },
				{ label: `把某章节分配到本卷${assignedNums.length ? `（现有 ${assignedNums.length} 章）` : ""}` },
				{ label: "解除本卷中某章节的归属", disabled: !assignedNums.length },
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
					const t = await this.prompt("分配章节", "要分配到本卷的章节号");
					if (t == null) break;
					const num = parseInt(t, 10);
					const chs = await this.manager.listChapters(story);
					if (!Number.isFinite(num) || !chs.some((c) => c.num === num)) {
						new Notice(`第${num ?? "?"}章不存在`);
						break;
					}
					await this.manager.setChapterVolume(story, num, vol.id);
					new Notice(`${this.chapterLabel(num)} 已归属卷「${vol.name}」`);
					break;
				}
				case 4: {
					const ci = await this.pickAction(
						"选择要解除归属的章节",
						assignedNums.map((n) => ({ label: this.chapterLabel(n, state.chapters[String(n)]?.title) }))
					);
					if (ci == null) break;
					await this.manager.unassignChapterVolume(story, assignedNums[ci]);
					new Notice("已解除该章节的卷归属");
					break;
				}
				default: {
					const ok = await this.confirmBox(
						"删除卷？",
						`删除后，其下 ${assignedNums.length} 个章节的卷字段将被清空（章节本身保留）。此操作不可撤销。`,
						"删除"
					);
					if (!ok) break;
					const r = await this.manager.deleteVolume(story, vol.id);
					new Notice(r.deleted ? `已删除，共 ${r.unassignedChapters.length} 章被移出该卷` : "删除失败：卷不存在");
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
			const lines: Array<string | PanelLine> = [];
			for (const s of scenes) {
				lines.push({ text: `${state.current_scene === s.scene_id ? "◀ " : ""}${s.scene_id}`, bold: true });
				const bits = [s.chapter_num === 0 ? "全局" : this.chapterLabel(s.chapter_num), s.characters?.length ? `角色：${s.characters.join("、")}` : "", s.description || ""].filter(Boolean);
				if (bits.length) lines.push(`　　${bits.join("　")}`);
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
		const defChap = state?.current_chapter ?? null;
		const vals = await new Promise<Record<string, string> | null>((resolve) => {
			new MultiFieldModal(
				this.app,
				"新增场景",
				[
					{ key: "id", label: "场景 ID/标题", placeholder: "如：夜半天台" },
					{ key: "desc", label: "简介", placeholder: "一句话说明场景氛围/用途" },
					{ key: "chars", label: "在场角色", placeholder: '多个用「、」分隔' },
					{ key: "chap", label: "归属章节号", placeholder: `留空=${defChap ? `当前第${defChap}章` : "无（全局）"}，0=全局未归属` },
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
		let chapNum = defChap ?? 0;
		const ct = (vals.chap ?? "").trim();
		if (ct !== "") {
			const n = parseInt(ct, 10);
			if (!Number.isFinite(n) || n < 0) {
				new Notice(`无效的章节号：${ct}`);
				return;
			}
			chapNum = n;
			if (n > 0 && !(await this.manager.listChapters(story)).some((c) => c.num === n)) {
				new Notice(`第${n}章不存在`);
				return;
			}
		}
		try {
			await this.manager.addScene(story, {
				scene_id: vals.id.trim(),
				description: vals.desc,
				characters: splitList(vals.chars || ""),
				chapter_num: chapNum,
				notes: vals.notes,
				content,
			});
			new Notice(`已创建场景「${vals.id.trim()}」（${chapNum === 0 ? "全局未归属" : this.chapterLabel(chapNum)}）`);
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
			const idx = await this.pickAction(
				"选择要管理的场景",
				scenes.map((s) => ({ label: s.scene_id, sub: `${s.chapter_num === 0 ? "全局" : this.chapterLabel(s.chapter_num)} · ${s.description || ""}`.trim(), marker: state.current_scene === s.scene_id ? "◀ 当前" : undefined }))
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
						`归属：${scene.chapter_num === 0 ? "全局未归属" : this.chapterLabel(scene.chapter_num)}`,
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
								{ key: "chap", label: "归属章节号", placeholder: `当前=${scene.chapter_num === 0 ? "全局(0)" : scene.chapter_num}，留空不变` },
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
						else if (n === scene.chapter_num) { /* 不变 */ }
						else {
							if (n > 0 && !(await this.manager.listChapters(story)).some((c) => c.num === n)) new Notice(`第${n}章不存在，未移动`);
							else {
								await this.manager.updateScene(story, scene.scene_id, { chapter_num: n });
								new Notice(`已移动到${n === 0 ? "全局" : this.chapterLabel(n)}`);
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
				if (bits.length) lines.push(`　　${bits.join("　")}`);
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
		const defChap = state?.current_chapter ?? null;
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
					{ key: "chap", label: "归属章节号", placeholder: `留空=${defChap ? `当前第${defChap}章` : "无（全局）"}，0=全局` },
				],
				"创建",
				(v) => resolve(v),
				() => resolve(null)
			).open();
		});
		if (!vals || !vals.name.trim()) return;
		let chapNum = defChap ?? 0;
		const ct = (vals.chap ?? "").trim();
		if (ct !== "") {
			const n = parseInt(ct, 10);
			if (!Number.isFinite(n) || n < 0) {
				new Notice(`无效的章节号：${ct}`);
				return;
			}
			chapNum = n;
			if (n > 0 && !(await this.manager.listChapters(story)).some((c) => c.num === n)) {
				new Notice(`第${n}章不存在`);
				return;
			}
		}
		try {
			await this.manager.addCharacter(story, { name: vals.name.trim(), identity: vals.identity, age: vals.age, gender: vals.gender, personality: vals.personality, appearance: vals.appearance, background: vals.background, abilities: vals.abilities, notes: vals.notes, chapter: chapNum });
			new Notice(`已创建人物「${vals.name.trim()}」（${chapNum === 0 ? "全局" : this.chapterLabel(chapNum)}）`);
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
			const idx = await this.pickAction(
				"选择要管理的人物",
				chars.map((c) => ({ label: c.name, sub: `${c.chapter === 0 ? "全局" : this.chapterLabel(c.chapter)} · ${c.identity || ""}`.trim() }))
			);
			if (idx == null) return;
			const char = chars[idx];
			const act = await this.pickAction(`管理人员「${char.name}」`, [
				{ label: "查看详情" },
				{ label: "编辑信息（身份/年龄/性格/外貌/背景/能力等）" },
				{ label: `移动归属章节（当前：${char.chapter === 0 ? "全局" : this.chapterLabel(char.chapter)}）` },
				{ label: "改名（全小说 MD 同步替换并自动备份）" },
				{ label: "删除此人（并清理各场景中的引用）" },
			]);
			if (act == null) return;
			switch (act) {
				case 0: {
					const lines: Array<string | PanelLine> = [{ text: char.name, bold: true }];
					for (const [k, v] of Object.entries({ 归属: char.chapter === 0 ? "全局" : this.chapterLabel(char.chapter), 身份: char.identity, 年龄: char.age, 性别: char.gender, 性格: char.personality, 外貌: char.appearance, 背景: char.background, 能力: char.abilities?.join("、"), 备注: char.notes })) if (v) lines.push(`${k}：${v}`);
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
					const t = await this.prompt("移动归属章节", `新的章节号（0=全局，当前=${char.chapter === 0 ? "全局(0)" : char.chapter}）`);
					if (t == null) break;
					const n = parseInt(t, 10);
					if (!Number.isFinite(n) || n < 0) new Notice(`无效的章节号：${t}`);
					else if (n > 0 && !(await this.manager.listChapters(story)).some((c) => c.num === n)) new Notice(`第${n}章不存在`);
					else {
						await this.manager.updateCharacter(story, char.name, { chapter: n });
						new Notice(`「${char.name}」已移动到${n === 0 ? "全局" : this.chapterLabel(n)}`);
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
			const lines: Array<string | PanelLine> = [];
			items.forEach((it, i) => {
				lines.push({ text: `${it.done ? "✔" : "○"} ${this.chapterLabel(it.chapter)} #${(it.index ?? i) + 1}`, bold: !it.done });
				const bits = [it.character ? `人物：${it.character}` : "", it.reason || ""].filter(Boolean);
				if (bits.length) lines.push(`　　${bits.join("　")}`);
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
		const num = await this.requireChapterNum(story);
		if (num == null) return;
		const character = await this.prompt(`${this.chapterLabel(num)} · 添加伏笔`, "涉及角色（可留空）");
		if (character == null) return;
		const reason = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, `${this.chapterLabel(num)} · 伏笔事由`, "埋了什么、为什么重要…", "", "保存", (v) => resolve(v), () => resolve(null)).open();
		});
		if (reason == null || !reason.trim()) return;
		try {
			const idx = await this.manager.addForeshadow(story, num, character, reason);
			new Notice(`已写入 伏笔.md：${this.chapterLabel(num)} 伏笔 #${idx + 1}`);
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
			const idx = await this.pickAction(
				"选择要管理的伏笔",
				items.map((it, i) => ({ label: `${it.done ? "✔" : "○"} ${this.chapterLabel(it.chapter)} #${(it.index ?? i) + 1}`, sub: [it.character, it.reason].filter(Boolean).join("　") }))
			);
			if (idx == null) return;
			const item = items[idx];
			const act = await this.pickAction(`管理 ${this.chapterLabel(item.chapter)} 伏笔 #${(item.index ?? idx) + 1}`, [
				item.done ? { label: "取消完成标记" } : { label: "标记为已完成" },
				{ label: "删除这条伏笔" },
			]);
			if (act == null) return;
			const pos = item.index ?? idx;
			if (act === 0) {
				const ok = await this.manager.setForeshadowDone(story, item.chapter, pos, !item.done);
				new Notice(ok ? `已${!item.done ? "标记完成" : "取消完成"}` : "操作失败：未找到该条伏笔（可能已被其他操作改动，请重新打开列表）");
			} else {
				const confirmOk = await this.confirmBox("删除伏笔？", `[${[item.character, item.reason].filter(Boolean).join("　") || "无内容"}]`, "删除");
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
		const num = await this.requireChapterNum(story);
		if (num == null) return;
		const content = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, `${this.chapterLabel(num)} · 追加大纲`, "写剧情要点；需要埋伏笔用 [伏]…[/] 包裹，将自动提取到 伏笔.md", "", "保存并追加", (v) => resolve(v), () => resolve(null)).open();
		});
		if (content == null || !content.trim()) return;
		try {
			const r = await this.manager.appendChapterOutline(story, num, content);
			if (!r.appended) new Notice("该内容已存在于本章大纲中，未重复追加");
			else new Notice(`已追加到 ${this.chapterLabel(num)} 的 章节大纲.md${r.foreshadows ? `，并提取 ${r.foreshadows} 条伏笔` : ""}`, 6000);
		} catch (e) {
			this.notifyError("追加失败", e);
		}
	}

	async cmdOpenChapterOutline(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const num = await this.requireChapterNum(story);
		if (num == null) return;
		try {
			const f = await this.manager.chapterBodyFile(story, num);
			if (!f || !f.parent) {
				new Notice(`${this.chapterLabel(num)} 没有正文文档`);
				return;
			}
			const path = `${f.parent.path}/章节大纲.md`;
			const t = (await this.manager.listChapters(story)).find((c) => c.num === num)?.title ?? "";
			await this.manager.ensureDoc(path, chapterOutlineTemplate(num, t));
			await this.manager.openMarkdown(path);
		} catch (e) {
			this.notifyError("打开失败", e);
		}
	}

	// ---------- 章节删除 / 改名 / 重编号（对齐 chapters.py）----------

	private async pickChapterAction(title: string): Promise<{ num: number; title: string } | null> {
		const story = await this.requireStory();
		if (!story) return null;
		const chapters = await this.manager.listChapters(story);
		if (!chapters.length) {
			new Notice("还没有章节");
			return null;
		}
		const state = await this.manager.loadState(story);
		const idx = await this.pickAction(
			title,
			chapters.map((c) => ({ label: this.chapterLabel(c.num, c.title), marker: state?.current_chapter === c.num ? "◀ 当前" : undefined }))
		);
		if (idx == null) return null;
		return { num: chapters[idx].num, title: chapters[idx].title };
	}

	async cmdChapterDelete(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const picked = await this.pickChapterAction("选择要删除的章节");
		if (!picked) return;
		try {
			const ok = await this.confirmBox(`删除${this.chapterLabel(picked.num, picked.title)}？`, "章节目录将移入 Obsidian 回收站，元数据与卷归属一并清理；若为当前章节则回退到最后一章。", "删除");
			if (!ok) return;
			await this.manager.deleteChapter(this.settings.lastStory || (await this.requireStory())!, picked.num);
			new Notice(`${this.chapterLabel(picked.num, picked.title)} 已删除（可在回收站找回）`);
		} catch (e) {
			this.notifyError("删除失败", e);
		}
	}

	async cmdChapterRename(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const picked = await this.pickChapterAction("选择要重命名的章节");
		if (!picked) return;
		const t = await this.prompt(`重命名 ${this.chapterLabel(picked.num)}`, `新标题（当前：${picked.title}）`);
		if (!t?.trim()) return;
		try {
			const newTitle = await this.manager.renameChapter(story, picked.num, t.trim());
			new Notice(`已改名为 ${this.chapterLabel(picked.num, newTitle)}，目录与文档引用已同步`, 6000);
		} catch (e) {
			this.notifyError("改名失败", e);
		}
	}

	async cmdChapterRenumber(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
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
		const specText = await this.prompt("打包章节合集", '范围：留空=当前章；支持 all/全部、区间如 3-7、列表如 1、4、5');
		if (specText == null) return;
		const outText = await this.prompt("输出路径", "留空=存到小说目录下 <书名>-第X-Y章-合集.md");
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

	// ---------- 扫描重建 / 编写类型 ----------

	async cmdRescanStory(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const r = await this.manager.rescanStory(story);
			new Notice(`扫描完成：章节 ${r.chapters} 个，总字数（纯文字）${r.totalWords}${r.createdDocs ? `，补齐缺失模板文档 ${r.createdDocs} 份` : ""}`, 6000);
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

	// 指南层（三层）：文件层带 path；系统级无 path、内容默认存 settings.llm.system_guide，可被 system_guide_path 指向的 vault 文件覆盖
	private getSystemGuidePath(): string {
		return (this.settings.llm?.system_guide_path ?? "").trim();
	}

	/** 解析系统级生效文本：设置了路径且可读→用该文件；否则回落 data.json 内嵌内容（pathMissing=配置了但读不到） */
	private async resolveSystemGuide(): Promise<{ text: string; pathMissing: boolean }> {
		const p = this.getSystemGuidePath();
		if (!p) return { text: this.settings.llm?.system_guide ?? "", pathMissing: false };
		const t = await this.manager.readGuideAt(p);
		if (t != null && t.trim()) return { text: t, pathMissing: false };
		return { text: this.settings.llm?.system_guide ?? "", pathMissing: true };
	}

	private guideLayers(story: string): Array<{ label: string; path?: string }> {
		return [
			{ label: `小说级　${this.manager.bookGuidePath(story)}`, path: this.manager.bookGuidePath(story) },
			{ label: `用户级　${this.manager.userGuidePath()}`, path: this.manager.userGuidePath() },
			{ label: `系统级　${this.getSystemGuidePath() || "插件设置 (data.json)"}` },
		];
	}

	private async readGuideLayer(l: { label: string; path?: string }): Promise<string> {
		if (l.path) return (await this.manager.readGuideAt(l.path)) ?? "";
		return (await this.resolveSystemGuide()).text;
	}

	private async writeGuideLayer(l: { label: string; path?: string }, text: string): Promise<void> {
		if (l.path) await this.manager.writeGuideAt(l.path, text);
		else if (this.getSystemGuidePath()) await this.manager.writeGuideAt(this.getSystemGuidePath(), text); // 配置了路径→直接写该文件（自动建目录）
		else {
			const conf = this.settings.llm ?? buildDefaultLlmConf();
			conf.system_guide = text;
			this.settings.llm = conf;
			await this.saveSettings();
		}
	}

	private async warnIfSystemGuidePathMissing(): Promise<void> {
		const p = this.getSystemGuidePath();
		if (!p) return;
		const r = await this.resolveSystemGuide();
		if (r.pathMissing) new Notice(`系统级指南路径「${p}」不存在或不可读\n已回落 data.json 内嵌内容`, 8000);
	}

	async cmdAgentsView(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		await this.warnIfSystemGuidePathMissing();
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
		await this.warnIfSystemGuidePathMissing();
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
			const dest = target.path ?? (this.getSystemGuidePath() ? `文件 ${this.getSystemGuidePath()}` : "插件设置 data.json");
			new Notice(`创作规范已保存到 ${dest}`, 6000);
		} catch (e) {
			this.notifyError("保存失败", e);
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
			this.notifyError("打开状态面板失败", e);
		}
	}

	// ---------- LLM 写作命令（/write /continue /rewrite /polish /deai /review，对应 Python WritingMixin + writer.py） ----------

	private promptArea(title: string, placeholder: string, initial = ""): Promise<string | null> {
		return new Promise((resolve) => {
			new TextAreaPrompt(this.app, title, placeholder, initial, "确定", (v) => resolve(v), () => resolve(null)).open();
		});
	}

	/** 章节号输入：空=当前章默认；Esc=取消整个命令 */
	private async targetChapterNum(story: string, verb: string): Promise<number | null> {
		const state = await this.manager.loadState(story);
		const cur = state?.current_chapter ?? null;
		const raw = await this.prompt(`要${verb}哪一章`, cur ? `当前第${cur}章，留空即用当前章` : "请输入章节号");
		if (raw == null) return null;
		const parsed = parseInt(raw.trim(), 10);
		const num = Number.isFinite(parsed) && parsed > 0 ? parsed : (cur as number);
		const chapters = await this.manager.listChapters(story);
		if (!Number.isFinite(num) || !chapters.some((c) => c.num === num)) {
			new Notice(`第${String(num)}章不存在`);
			return null;
		}
		return num;
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

	/** 三层创作规范（小说级 > 用户级 > 系统级 data.json，顺序即优先级），含合并后的禁用词类目文本 */
	private async loadWriterGuides(storyName: string): Promise<{ bookText: string; userText: string; systemText: string; guideText: string; bannedGuideText: string }> {
		const bookText = (await this.manager.readGuideAt(this.manager.bookGuidePath(storyName))) ?? "";
		const userText = (await this.manager.readGuideAt(this.manager.userGuidePath())) ?? "";
		const systemText = (await this.resolveSystemGuide()).text; // 路径配置优先，静默回落内嵌内容（写作命令不打扰）
		const layers = [bookText, userText, systemText].filter((t) => t.trim());
		const merged = mergeGuideCategories(layers);
		return { bookText, userText, systemText, guideText: layers.join("\n\n"), bannedGuideText: merged["禁用词"] || "" };
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
	// ---------- 工作状态面板（StatusView）数据与动作 ----------

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
		/** 逐书实时统计的章节字数（num→words）：状态文档里的 words/total_words 可能是过期值（旧数据、CLI 写入或建章后未同步），展示一律以磁盘 MD 为准（同 /count 口径） */
		const liveWordsByStory = new Map<string, Record<number, number>>();
		for (const name of names) {
			let title = name;
			let chapterCount = 0;
			let currentChapter: number | null = null;
			let words = 0;
			try {
				const st = await this.manager.loadState(name);
				if (st) {
					title = st.title || name;
					chapterCount = Object.keys(st.chapters).length;
					currentChapter = st.current_chapter;
					words = st.total_words;
				}
			} catch {
				/* 单本状态读取失败不影响列表其余项 */
			}
			try {
				const rows = await this.manager.countWords(name); // 读各章 章节.md 纯文字计数
				const map: Record<number, number> = {};
				for (const r of rows) map[r.num] = r.words;
				liveWordsByStory.set(name, map);
				words = rows.reduce((s, r) => s + r.words, 0); // 实时值优先，覆盖可能过期的 state 值
			} catch {
				/* 字数统计失败时保留 state 里的旧值兜底 */
			}
			stories.push({ name, title, chapterCount, currentChapter, words, active: name === last });
		}
		// 每本书都预构建详情子树（章节/文件），状态页任意小说行都可展开查看；单本失败不影响其余
		const details: Record<string, StatusDetail> = {};
		for (const name of names) {
			try {
				details[name] = await this.buildStoryDetail(name, liveWordsByStory.get(name));
			} catch {
				/* 该书详情缺失时其行首箭头置灰不可展开 */
			}
		}
		return { workDir: root, stories, details };
	}

	/** 单本书的详情快照：状态字段 + 章节目录（含各章文件）+ 书根全局文档；字数优先用传入的实时磁盘统计 chWords，回退 state 值 */
	private async buildStoryDetail(storyName: string, chWords?: Record<number, number>): Promise<StatusDetail> {
		const state = await this.manager.loadState(storyName);
		const chs = await this.manager.listChapters(storyName);
		const chapters: StatusChapterEntry[] = chs.map((c) => ({
			num: c.num,
			title: c.title,
			words: chWords ? (chWords[c.num] ?? 0) : ((state?.chapters[String(c.num)]?.words as number | undefined) ?? 0),
			active: c.num === state?.current_chapter,
			files: c.dir.children.filter((f): f is TFile => f instanceof TFile).map((f) => ({ path: f.path, name: f.name })).sort((a, b) => a.name.localeCompare(b.name, "zh")),
		}));
		const storyDir = this.app.vault.getAbstractFileByPath(this.manager.storyPath(storyName));
		const globalFiles =
			storyDir instanceof TFolder
				? storyDir.children.filter((f): f is TFile => f instanceof TFile).map((f) => ({ path: f.path, name: f.name })).sort((a, b) => a.name.localeCompare(b.name, "zh"))
				: [];
		return {
			storyName,
			title: state?.title || storyName,
			genre: state?.genre || "",
			writingStyle: state?.writing_style || "",
			currentChapter: state?.current_chapter ?? null,
			totalWords: chWords ? Object.values(chWords).reduce((s, w) => s + w, 0) : ((state?.total_words as number | undefined) ?? 0),
			updatedAt: state?.updated_at || "",
			chapters,
			globalFiles,
		};
	}

	/** 状态页切换当前小说：写回 lastStory（对齐 switch-story 的持久化语义） */
	async statusSwitchStory(name: string): Promise<void> {
		this.settings.lastStory = name;
		await this.saveSettings();
		new Notice(`已切换当前小说：${name}`, 4000);
	}

	/** 状态页激活章节：写回 current_chapter；该章归属卷时同步补激活所属卷（对齐切章约定），返回新的当前章号 */
	async statusActivateChapter(storyName: string, num: number): Promise<number> {
		const state = await this.manager.loadState(storyName);
		if (!state) throw new Error("状态文档缺失，请先执行「重建小说状态」");
		state.current_chapter = num;
		const meta = state.chapters[String(num)];
		if (meta?.volume) state.current_volume = meta.volume;
		await this.manager.saveState(storyName, state);
		return num;
	}

	/** 广播刷新所有已打开的 LLM 对话面板顶部「当前小说 · 章节」行（切书/切章/建章等任何状态或设置变更路径都会经 saveSettings 或 manager.saveState 触发到这里） */
	notifyContextChanged(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(LlmChatView.VIEW_TYPE)) {
			if (leaf.view instanceof LlmChatView) {
				void leaf.view.updateCtxLine(); // 顶部小说·章节行
				void leaf.view.updateSpLabel(); // 「提示词」标签（是否含小说上下文、约字数）
			}
		}
	}

	/** 状态页右键快捷菜单动作执行器（语义与对应命令一致，但直接针对右键所在的小说/章节/目录，不再弹选择器） */
	async handleStatusAction(a: StatusAction): Promise<void> {
		switch (a.kind) {
			case "new-story": {
				await this.cmdNewStory(); // 复用建书三问流程
				return;
			}
			case "delete-story": {
				const folder = this.app.vault.getAbstractFileByPath(this.manager.storyPath(a.name));
				if (!(folder instanceof TFolder)) throw new Error("小说目录不存在或已被移动");
				const ok = await this.confirmBox(`删除小说「${a.name}」？`, "整本书的文件夹（含全部章节与文档）将移入 Obsidian 回收站，可从中找回。", "删除");
				if (!ok) return;
				await this.app.vault.trash(folder, false);
				if ((this.settings.lastStory || "") === a.name) {
					this.settings.lastStory = "";
					await this.saveSettings(); // 同时触发 LLM 面板上下文行刷新
				}
				new Notice(`小说「${a.name}」已删除（可在回收站找回）`);
				return;
			}
			case "new-chapter": {
				const chapters = await this.manager.listChapters(a.story);
				const nextNum = chapters.length ? Math.max(...chapters.map((c) => c.num)) + 1 : 1;
				const numText = await this.prompt("新建章节", `《${a.story}》章节号（留空默认 ${nextNum}）`);
				if (numText == null) return;
				const parsed = parseInt(numText, 10);
				const num = Number.isFinite(parsed) && parsed > 0 ? parsed : nextNum;
				const title = await this.prompt(`第${num}章`, "章节标题");
				if (title == null || !title.trim()) return;
				const bodyPath = await this.manager.createChapter(a.story, num, title.trim());
				new Notice(`已创建第${String(num).padStart(2, "0")}章-${title.trim()}：章节目录与文档就绪`);
				if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(bodyPath);
				return;
			}
			case "rename-chapter": {
				const cur = (await this.manager.loadState(a.story))?.chapters[String(a.num)]?.title ?? "";
				const t = await this.prompt(`重命名 ${this.chapterLabel(a.num)}`, `新标题（当前：${cur || "无"}）`);
				if (!t?.trim()) return;
				const newTitle = await this.manager.renameChapter(a.story, a.num, t.trim()); // 重命名目录并同步各文档中的旧标题引用
				new Notice(`已改名为 ${this.chapterLabel(a.num, newTitle)}，目录与文档引用已同步`, 6000);
				return;
			}
			case "delete-chapter": {
				const st = await this.manager.loadState(a.story);
				const meta = st?.chapters[String(a.num)];
				const ok = await this.confirmBox(`删除第${String(a.num).padStart(2, "0")}章${meta?.title ? " " + meta.title : ""}？`, "章节目录将移入 Obsidian 回收站，元数据与卷归属一并清理；若为当前章节则回退到最后一章。", "删除");
				if (!ok) return;
				await this.manager.deleteChapter(a.story, a.num);
				new Notice("章节已删除（可在回收站找回）");
				return;
			}
			case "new-file": {
				let folder: string;
				if (a.num == null) {
					folder = this.manager.storyPath(a.story);
				} else {
					const ch = (await this.manager.listChapters(a.story)).find((c) => c.num === a.num); // 以磁盘为准取真实章节目录（含章名）
					if (!ch) throw new Error(`第${a.num}章不存在`);
					folder = ch.dir.path;
				}
				const name = await this.prompt("新建文章", `在${a.num == null ? "书根目录" : "该章节目录"}下创建 .md 文件名（留扩展名可自定义）`);
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
				await this.app.vault.trash(f, false);
				new Notice(`${f.name} 已删除（可在回收站找回）`);
				return;
			}
			case "llm-write":
			case "llm-continue":
			case "llm-polish": {
				await this.statusRunWriting(a.kind, a.story, a.num); // 章节行右键的 LLM 写作入口
				return;
			}
		}
	}

	/** 状态面板章节行右键调用 LLM 写作命令：先把目标书/章设为当前（与点章节名激活同语义），再复用对应命令的既有交互流程（创作要点输入、流式预览确认等全部保留） */
	private async statusRunWriting(kind: "llm-write" | "llm-continue" | "llm-polish", story: string, num: number): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		if (((this.settings.lastStory || "") as string).trim() !== story) {
			this.settings.lastStory = story;
			await this.saveSettings(); // 切到目标书：持久化并广播刷新 LLM 面板上下文行
		}
		await this.statusActivateChapter(story, num); // 写回 current_chapter + 同步所属卷
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
			chapterNum = Math.max(1, Number(st?.current_chapter) || 1);
			const ch = (await this.manager.listChapters(s)).find((c) => c.num === chapterNum);
			chapterTitle = ch?.title || "";
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
				const userText = (await this.manager.readGuideAt(this.manager.userGuidePath())) ?? "";
				const systemText = (await this.resolveSystemGuide()).text;
				guideText = [userText, systemText].filter((t) => t.trim()).join("\n\n");
			}
		} catch {
			/* 指南读取失败则不带【创作规范】，不阻断对话 */
		}
		let text = assembleSystemPrompt(CHAT_ASSISTANT_PROMPT, guideText); // 与 CLI _apply_agents 同一拼接规则/措辞
		if (hasStory) {
			try {
				const state = await this.manager.loadState(lastStory!);
				if (state?.title) {
					const chapterNum = Math.max(1, Number(state.current_chapter) || 1);
					const parts: string[] = [];
					try {
						const data = await this.manager.loadWritingData(lastStory!, chapterNum, { includeCurrentSummary: false });
						const ctx = buildWritingContext(data);
						if (ctx) parts.push(ctx);
					} catch {
						/* 写作上下文构建失败不影响当前章节部分 */
					}
					try {
						const content0 = await this.manager.readChapterContent(lastStory!, chapterNum);
						if (content0 && content0.trim()) {
							let content = content0;
							if (content.length > 6000) content = content.slice(0, 6000) + "\n[...内容省略...]";
							parts.push(`\n【当前章节】第${chapterNum}章\n${content}`);
						}
					} catch {
						/* 章节读取失败则只带写作上下文 */
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
	private async streamOnce(cfg: LlmConfigDoc, messages: Message[], modal: StreamingPreviewModal): Promise<string> {
		try {
			return await chatStream(cfg, messages, (d) => modal.append(d), undefined, modal.signal);
		} catch (e) {
			if (modal.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes("输出为空") || msg.includes("未返回内容")) return "";
			throw e;
		}
	}

	/** 生成失败统一提示：用户中断仅通知；其它错误额外在预览框内显示失败态 */
	private genFailure(e: unknown, label: string, modal?: StreamingPreviewModal): void {
		if (e instanceof Error && e.name === "AbortError") {
			new Notice(`已停止生成，${label}未保存`);
			return;
		}
		this.notifyError(`${label}失败`, e);
		modal?.fail((e as Error)?.message || String(e));
	}

	/** 流式生成 + 结果为空自动重试 ×3（对应 cmd 层 max_attempts=3）；失败/中断/全空均返回"" */
	private async streamWithEmptyRetry(
		cfg: LlmConfigDoc,
		buildMessages: () => Message[],
		modal: StreamingPreviewModal,
		label: string
	): Promise<string> {
		for (let attempt = 1; attempt <= 3; attempt++) {
			let content: string;
			try {
				content = await this.streamOnce(cfg, buildMessages(), modal);
			} catch (e) {
				this.genFailure(e, label, modal);
				return "";
			}
			if (content.trim()) return content;
			if (attempt < 3) {
				new Notice(`生成结果为空（第${String(attempt)}次），正在重试…`, 6000);
				modal.reset();
			}
		}
		new Notice(`✗ ${label}失败：连续 3 次生成结果为空`, 12000);
		modal.fail("连续 3 次生成结果为空");
		return "";
	}

	/** 对齐 writer.generate_chapter：最多 3 轮「生成→格式校验→带修正注记重新生成」；中断/异常/全空返回"" */
	private async generateChapterStreamed(
		cfg: LlmConfigDoc,
		systemPrompt: string,
		prompt: string,
		writingStyle: string | undefined,
		modal: StreamingPreviewModal
	): Promise<string> {
		const sysMsg: Message = { role: "system", content: systemPrompt };
		let content = "";
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				content = await this.streamOnce(cfg, [sysMsg, { role: "user" as const, content: prompt }], modal);
			} catch (e) {
				this.genFailure(e, "创作", modal);
				return "";
			}
			if (!content.trim()) break; // 空结果 → 外层统一报错（与 Python break 一致）
			const reason = validateStoryTypeFormat(content, writingStyle);
			if (!reason) return content;
			new Notice(`生成内容不符合【编写类型】（第${String(attempt)}次）：${reason}\n正在附加格式修正要求重新生成…`, 8000);
			modal.reset();
			let retried: string;
			try {
				retried = await this.streamOnce(cfg, [sysMsg, { role: "user" as const, content: prompt + formatRetryNote(writingStyle, reason) }], modal);
			} catch (e) {
				this.genFailure(e, "创作", modal);
				return "";
			}
			const r2 = validateStoryTypeFormat(retried, writingStyle);
			if (retried.trim() && !r2) return retried;
			content = retried;
		}
		if (!content.trim()) {
			new Notice("✗ 创作失败：连续 3 次生成结果为空", 12000);
			modal.fail("连续 3 次生成结果为空");
		}
		return content;
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
		if (!story) return;
		try {
			const state = await this.manager.validatedState(story);
			const scenes = await this.manager.loadAllScenes(story);
			const curSceneId = state.current_scene ?? undefined;
			const curScene = curSceneId ? scenes[curSceneId] : undefined;

			// 目标章节号：当前章 → 当前场景归属章 → 下一章
			let target = state.current_chapter ?? 0;
			if (!target && curScene?.chapter_num) target = curScene.chapter_num;
			if (!target) target = (state.current_chapter ?? 0) + 1;

			const chapters = await this.manager.listChapters(story);
			const chEntry = chapters.find((c) => c.num === target) ?? null;
			const meta = state.chapters[String(target)] ?? null;
			const wasNew = !meta; // 对应 Python is_new（以状态元数据为准）
			const isNewLike = wasNew && !chEntry; // 全新章节（无目录且无元数据）
			const bodyOnDisk = chEntry ? await this.manager.readChapterContent(story, target) : "";
			const outlineOnDisk = chEntry ? await this.manager.readChapterOutlineForPrompt(story, target) : "";
			const hasContent = bodyOnDisk.trim() !== "";

			// 章节标题：已有取磁盘/状态；全新章节询问（Esc=取消）
			let title = ((meta?.title || "").trim()) || (chEntry ? chEntry.title : "") || `第${target}章`;
			if (isNewLike) {
				const t = await this.prompt(`第${target}章标题`, `第${target}章`);
				if (t == null) return;
				title = t.trim() || `第${target}章`;
			}

			// 写作指令交互（对齐 CLI args 语义）
			let instruction = "";
			if (hasContent) {
				const pick = await this.pickAction(`${this.chapterLabel(target, title)} 已有内容（${String(countPureWords(bodyOnDisk))} 字）`, [
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
				const pick = await this.pickAction(`第${target}章还没有正文，也没有大纲`, [
					{ label: "先输入创作要点再开始" },
					{ label: "直接开始（无参考内容）" },
				]);
				if (pick == null) return;
				if (pick === 0) {
					instruction = ((await this.prompt("创作要点（可选）", "如：写主角与反派的初次交锋")) ?? "").trim();
				}
			} else {
				new Notice(`未提供写作指令，按第${target}章大纲自动创作`, 4000); // 有大纲、无正文：直接开写，不弹任何输入框
			}

			let structureReady = !!chEntry;
			let outlineForGen = outlineOnDisk;

			// 全新章节且无指令：从磁盘/询问补充大纲（对应 is_new && !instruction 分支）
			if (!instruction && isNewLike && !outlineOnDisk.trim()) {
				const o = await this.promptArea(`第${target}章大纲（可选）`, "- 情节要点一\n- 情节要点二");
				if (o == null) return;
				outlineForGen = o.trim();
			}

			// 未提供写作指令：有大纲且尚无正文 → 按大纲自动创作；否则只创建/就绪后返回
			if (!instruction) {
				if (!(outlineForGen.trim() !== "" && !hasContent)) {
					if (wasNew && !structureReady) {
						await this.manager.createChapter(story, target, title);
						structureReady = true;
						new Notice(`✓ 已创建 ${this.chapterLabel(target, title)}`, 6000);
					} else {
						new Notice(`✓ 已就绪：${this.chapterLabel(target, title)}`, 6000);
					}
					new Notice("章节已有创作内容时，请给出新的写作指令开始创作\n或使用「续写当前章 (/continue)」继续", 10000);
					return;
				}
			}

			// 追加还是覆盖（对应 a/r 询问，默认追加）
			let mode: "a" | "r" = "a";
			if (hasContent) {
				const m = await this.pickAction(`${this.chapterLabel(target, title)} 已有内容（${String(countPureWords(bodyOnDisk))} 字），如何处理？`, [
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
					await this.manager.createChapter(story, target, title);
					structureReady = true;
				}
				await this.manager.setChapterOutline(story, target, outlineForGen);
				new Notice(`已更新第${target}章大纲并保存`, 4000);
			}

			// 组装提示词与系统提示词
			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			const data = await this.manager.loadWritingData(story, target, { includeCurrentSummary: false });
			const context = buildWritingContext(data);
			const prevNums = Array.from({ length: Math.max(0, target - 1) }, (_, i) => i + 1);
			const prevOutlines = prevNums.length ? await this.manager.readChaptersOutlines(story, prevNums) : {};
			const wordRange = wordRangeFromGuides(guides.bookText, guides.userText);
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const built = buildChapterPrompt({
				chapterNum: target,
				chapterOutlineRaw: outlineForGen,
				userInstruction: instruction || undefined,
				context,
				wordRange,
				descStyle: setup.descStyle,
				storyType: state.writing_style,
				prevOutlines,
			});

			// 流式生成（带编写类型格式校验重试）
			const modal = new StreamingPreviewModal(this.app, `创作 ${this.chapterLabel(target, title)}`);
			modal.open();
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
				await this.manager.createChapter(story, target, title);
				structureReady = true;
			}
			const words = await this.manager.setChapterBody(story, target, content);
			if (wasNew) {
				let finalOutline = outlineForGen;
				if (instruction) finalOutline = appendOutlineInstruction(finalOutline, "创作要点", instruction);
				if (finalOutline.trim()) await this.manager.setChapterOutline(story, target, finalOutline);
			}

			// 当前场景归属该章时同步场景正文
			if (curScene && curScene.chapter_num === target) {
				const old = (curScene.content || "").replace(/\s+$/, "");
				const sceneNew = old ? `${old}\n\n${content}` : content;
				await this.manager.updateScene(story, curScene.scene_id, { content: sceneNew });
				new Notice(`✓ 已同步到场景 '${curScene.scene_id}'`, 6000);
			}

			try {
				const f = await this.manager.chapterBodyFile(story, target);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* 打开失败不影响结果 */ }
			new Notice(`✓ ${this.chapterLabel(target, title)} 创作完成！\n字数：${String(words)}`, 8000);
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
			const current = state.current_chapter ?? 0;
			if (!current) {
				new Notice("还没有章节，请先使用「创作章节 (/write)」创建");
				return;
			}
			const chapters = await this.manager.listChapters(story);
			const chEntry = chapters.find((c) => c.num === current) ?? null;
			const meta = state.chapters[String(current)] ?? null;
			if (!chEntry) {
				if (meta) {
					// 状态中存在但磁盘目录未定位：交给 /write 兜底（有大纲则按大纲自动创作）
					await this.cmdWrite();
					return;
				}
				new Notice(`第${current}章不存在`);
				return;
			}
			const bodyOnDisk = await this.manager.readChapterContent(story, current);
			if (!bodyOnDisk.trim()) {
				new Notice(`第${current}章还没有正文内容，将从章节大纲开始创作…`, 6000);
				await this.cmdWrite();
				return;
			}
			const outlineOnDisk = await this.manager.readChapterOutlineForPrompt(story, current);

			// 续写要点（Esc=取消；留空=按两级大纲自然续写）
			const rawInstr = await this.prompt("续写要点（可选）", "如：写主角与反派的正面对峙");
			if (rawInstr == null) return;
			const instruction = rawInstr.trim();

			// 大纲覆盖率检查：已有内容且全部要点已覆盖、无新指令 → 跳过
			if (outlineOnDisk && !instruction) {
				const cov = checkOutlineCoverage(bodyOnDisk, outlineOnDisk);
				if (cov.allCovered) {
					new Notice(`⚠ 第${current}章大纲要点已全部完成，无需续写\n请给出新的写作纲要后再试`, 10000);
					return;
				}
			}

			// 先把指令并入大纲落盘（对齐 cmd_continue 预合并语义）
			let mergedForGen = outlineOnDisk;
			if (instruction) {
				mergedForGen = appendOutlineInstruction(outlineOnDisk, "续写要点", instruction);
				await this.manager.setChapterOutline(story, current, mergedForGen);
				new Notice(`已更新第${current}章大纲并保存`, 4000);
			}

			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			const data = await this.manager.loadWritingData(story, current, { includeCurrentSummary: true });
			const context = buildWritingContext(data);
			const prevNums = Array.from({ length: Math.max(0, current - 1) }, (_, i) => i + 1);
			const prevOutlines = prevNums.length ? await this.manager.readChaptersOutlines(story, prevNums) : {};
			const wordRange = wordRangeFromGuides(guides.bookText, guides.userText);
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const built = buildContinuePrompt({
				chapterNum: current,
				userInstruction: instruction || undefined,
				context,
				globalOutlineRaw: data.globalOutlineRaw,
				chapterOutlineRaw: mergedForGen,
				prevOutlines,
				descStyle: setup.descStyle,
				storyType: state.writing_style,
				currentSummary: data.summaries[current] ?? "",
				existingContent: bodyOnDisk,
				wordRange,
			});

			const modal = new StreamingPreviewModal(this.app, `续写 ${this.chapterLabel(current, meta?.title || chEntry.title)}`);
			modal.open();
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
			const words = await this.manager.setChapterBody(story, current, newContent);
			try {
				const f = await this.manager.chapterBodyFile(story, current);
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
			const num = await this.targetChapterNum(story, "重写");
			if (num == null) return;
			const bodyOnDisk = await this.manager.readChapterContent(story, num);
			if (!bodyOnDisk.trim()) {
				new Notice(`第${num}章还没有内容，请先使用「创作章节 (/write)」`);
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
			const outlineNums = [num - 1, num, num + 1].filter((n) => n >= 1);
			const chapterOutlines = await this.manager.readChaptersOutlines(story, outlineNums);
			const wordRange = wordRangeFromGuides(guides.bookText, guides.userText);
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const prompt = buildRewritePrompt({
				chapterNum: num,
				userInstruction: instruction || undefined,
				context,
				chapterOutlines,
				oldContent: bodyOnDisk,
				currentSummary: data.summaries[num] ?? "",
				wordRange,
				storyType: state.writing_style,
			});

			const modal = new StreamingPreviewModal(this.app, `重写 ${this.chapterLabel(num)}`);
			modal.open();
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
			const words = await this.manager.setChapterBody(story, num, content); // 全量覆盖
			try {
				const f = await this.manager.chapterBodyFile(story, num);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ 第${num}章已重写（${String(words)} 字）`, 8000);
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
			const current = state.current_chapter ?? 0;
			if (!current) {
				new Notice("还没有章节，请先使用「创作章节 (/write)」创建");
				return;
			}
			const bodyOnDisk = await this.manager.readChapterContent(story, current);
			if (!bodyOnDisk.trim()) {
				new Notice(`第${current}章还没有内容`);
				return;
			}
			const rawStyle = await this.prompt("润色风格（可选）", "如：更简洁有力、更有画面感");
			if (rawStyle == null) return; // Esc=取消
			const style = rawStyle.trim();

			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			const data = await this.manager.loadWritingData(story, current, { includeCurrentSummary: true });
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const prompt = buildPolishPrompt({
				text: bodyOnDisk,
				style: style || undefined,
				summary: data.summaries[current] ?? "",
				storyType: state.writing_style,
			});

			const modal = new StreamingPreviewModal(this.app, `润色 ${this.chapterLabel(current)}`);
			modal.open();
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
			const words = await this.manager.setChapterBody(story, current, content); // 全量覆盖原章节
			try {
				const f = await this.manager.chapterBodyFile(story, current);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ 已保存润色结果到第${current}章（${String(words)} 字）`, 8000);
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
			const num = await this.targetChapterNum(story, "去除 AI 常用词");
			if (num == null) return;
			const bodyOnDisk = await this.manager.readChapterContent(story, num);
			if (!bodyOnDisk.trim()) {
				new Notice(`第${num}章还没有内容`);
				return;
			}
			const hits = findAiWordHits(bodyOnDisk);
			if (!hits.length) {
				new Notice(`✓ 第${num}章未检测到 AI 常用词`, 6000);
				return;
			}
			const setup = await this.loadWriterSetup();
			if (!setup) return;
			const guides = await this.loadWriterGuides(story);
			const baseSp = assembleSystemPrompt(undefined, guides.guideText, setup.systemPrompt); // 去AI味用基础系统提示词

			const n = new Notice(`正在清洗第${num}章的 AI 常用词（${String(hits.length)} 处）…\n逐句打回 LLM 重写，可能需要一点时间`);
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
			const modal = new StreamingPreviewModal(this.app, `去AI味结果 · ${this.chapterLabel(num)}`);
			modal.open();
			modal.append(cleaned);
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（清洗结果仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, num, cleaned); // 全量覆盖
			try {
				const f = await this.manager.chapterBodyFile(story, num);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ 第${num}章已更新（${String(words)} 字）`, 8000);
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
			const num = await this.targetChapterNum(story, "审阅");
			if (num == null) return;
			const bodyOnDisk = await this.manager.readChapterContent(story, num);
			if (!bodyOnDisk.trim()) {
				new Notice(`第${num}章还没有内容，无法审阅`);
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
			const outlineNums = [num - 1, num, num + 1].filter((n) => n >= 1);
			const chapterOutlines = await this.manager.readChaptersOutlines(story, outlineNums);
			const sp = this.writerSystemPrompt(setup.systemPrompt, guides, state.writing_style, state.title, data.characters.map((c) => c.name));
			const prompt = buildReviewPrompt({
				chapterNum: num,
				userInstruction: instruction || undefined,
				context,
				chapterOutlines,
				chapterContent: bodyOnDisk,
			});

			const n = new Notice(`正在从全局视角审阅第${num}章…\n将结合小说大纲、前文与角色设定分析本章逻辑，请耐心等待`);
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

			const modal = new StreamingPreviewModal(this.app, `审阅报告 · ${this.chapterLabel(num)}`);
			modal.open();
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
	private llmSelName = "";

	constructor(plugin: ArticleWriterPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("工作目录（work_dir）")
			.setDesc(
				"写小说的文件夹（vault 内已有文件夹）。首次使用任何命令时会自动弹出选择器让你选定；以后建书/建章/打开文档等全部在该目录下操作。也可在此手动修改路径或点「选择工作目录」命令切换。每个小说是其下一个子文件夹：故事状态.md（YAML 属性存运行态）、大纲.md、第NN章-标题/章节.md 等"
			)
			.addText((text) => {
				text.setValue(this.plugin.settings.workDir).setPlaceholder("首次使用时自动选择").onChange(async (v) => {
					this.plugin.settings.workDir = v.trim().replace(/^\/+|\/+$/g, "");
					this.plugin.settings.lastStory = "";
					await this.plugin.saveSettings();
				});
			})
			.addButton((btn) => btn.setButtonText("重新选择…").onClick(() => this.plugin.pickWorkDir(false)));

		new Setting(containerEl)
			.setName("创建后自动打开文档")
			.setDesc("新建小说/章节后立即在标签页中打开对应正文或大纲")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoOpenOnCreate).onChange(async (v) => {
					this.plugin.settings.autoOpenOnCreate = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("LLM 模型配置")
			.setDesc("多组 OpenAI 兼容配置（base_url/model_name/api_key/采样参数）+ active_llm + 全局系统提示词，存于插件数据目录 data.json（首次运行已预置 local/deepseek/qwen-dashscope 模板）。api_key 明文存放——同步/分享 vault 时注意不要泄露配置文件");
		const llmHolder = containerEl.createDiv();
		this.renderLlm(llmHolder);

		new Setting(containerEl)
			.setName("关于")
			.setDesc(
				"ArticleWriter Obsidian 版：建书/建章、打开文档、保存、字数统计；数据全部为 vault 内 MD 文档，运行态存于各书的「故事状态.md」YAML 文件属性（version 2，旧版 story_state.json 自动迁移备份）。LLM 走 OpenAI 兼容接口（openai SDK），可接 DeepSeek / DashScope / Ollama / LM Studio / llama.cpp 等。",
			);
	}

	/** LLM 配置编辑区（读写插件数据目录 data.json） */
	private renderLlm(holder: HTMLElement): void {
		holder.empty();
		const conf = this.plugin.settings.llm ?? (this.plugin.settings.llm = buildDefaultLlmConf());
		const cfgs = conf.llm_configs ?? [];
		if (!cfgs.length) {
			holder.createEl("div", { text: "没有模型配置。" });
			return;
		}
		if (!cfgs.some((c) => c.name === this.llmSelName)) {
			this.llmSelName = conf.active_llm && cfgs.some((c) => c.name === conf.active_llm) ? conf.active_llm : cfgs[0].name;
		}
		const cfg = cfgs.find((c) => c.name === this.llmSelName)!;

		new Setting(holder).setName("编辑的配置").addDropdown((d) => d.addOptions(Object.fromEntries(cfgs.map((c) => [c.name, c.name]))).setValue(this.llmSelName).onChange((v) => { this.llmSelName = v; this.renderLlm(holder); }));
		new Setting(holder)
			.setName("设为激活（active_llm）")
			.setDesc(conf.active_llm === cfg.name ? "当前激活中" : "保存后，连接测试与写作命令将使用该配置")
			.addToggle((t) => t.setValue(conf.active_llm === cfg.name).onChange((on) => { if (on) conf.active_llm = cfg.name; }));

		const numFields: Array<[keyof LlmConfigDoc, string]> = [["temperature", "温度 temperature"], ["max_tokens", "最大 token max_tokens"]];
		const strFields: Array<[keyof LlmConfigDoc, string, string]> = [
			["base_url", "服务地址 base_url", "如 http://localhost:8509 或 https://api.deepseek.com（已含 /vN 不重复拼接）"],
			["model_name", "模型 model_name", "本地服务可留空（用其已加载模型）"],
			["api_key", "API Key api_key", "明文存于插件数据目录 data.json"],
			["reasoning_effort", "推理强度 reasoning_effort", "low/medium/high（兼容端点支持时生效）"],
		];
		for (const [k, label] of numFields) {
			new Setting(holder).setName(label).addText((t) => {
				t.setValue(cfg[k] != null ? String(cfg[k]) : "").setPlaceholder(String(k)).onChange((v) => { const n = Number(v); (cfg as unknown as Record<string, unknown>)[k] = v.trim() !== "" && !Number.isNaN(n) ? n : undefined; });
			});
		}
		for (const [k, label, ph] of strFields) {
			new Setting(holder).setName(label).setDesc(ph).addText((t) => {
				t.setValue(cfg[k] != null ? String(cfg[k]) : "").setPlaceholder(ph).onChange((v) => { (cfg as unknown as Record<string, unknown>)[k] = v.trim() || undefined; });
			});
		}

		new Setting(holder)
			.setName("写作系统提示词 system_prompt")
			.setDesc("全局基础系统提示词：无编写类型格式块时使用；留空=内置默认。对齐 CLI config.json 的 system_prompt")
			.addTextArea((t) => t.setValue(conf.system_prompt ?? "").setPlaceholder("留空使用内置默认").onChange((v) => { conf.system_prompt = v.trim() || undefined; }));
		new Setting(holder)
			.setName("描述方式 desc_style")
			.setDesc("normal / complete（对齐 CLI）")
			.addDropdown((d) => d.addOptions({ normal: "normal", complete: "complete" }).setValue(conf.desc_style || "normal").onChange((v) => { conf.desc_style = v; }));
		new Setting(holder)
			.setName("系统级指南路径 system_guide_path")
			.setDesc("设置后优先从该 vault 内文件读取/保存系统级写作指南（相对路径，如 Notes/系统写作指南.md），覆盖 data.json 内嵌内容；留空=用内嵌内容。读不到时自动回落并提示")
			.addText((t) => t.setValue(conf.system_guide_path ?? "").setPlaceholder("留空使用内置内容").onChange((v) => { conf.system_guide_path = v.trim() || undefined; }));

		new Setting(holder)
			.addButton((b) => b.setButtonText("测试连接").onClick(() => void this.plugin.runLlmTest(cfg)))
			.addButton((b) => b.setButtonText("保存更改").setCta().onClick(async () => {
				try {
					await this.plugin.saveSettings();
					new Notice("LLM 配置已保存到插件数据目录 data.json", 5000);
				} catch (e) {
					new Notice(`保存失败：${e instanceof Error ? e.message : String(e)}`, 10000);
				}
			}))
			.addButton((b) => b.setButtonText("重新加载").onClick(() => this.renderLlm(holder)));
	}
}
