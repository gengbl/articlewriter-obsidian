import { ItemView, Notice, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { filterEnabledLlmConfigs, type LlmConfigDoc, type PluginConfig, selectEnabledLlmName } from "./plugin_config";
import { chatStream, describeLlmError, normalizeBaseURL } from "./llm_client";
import type { ChatToolCall, Message } from "./llm_client";
import { CHAT_GENERATION_TOOLS, CHAT_TOOLS_PAYLOAD, CHAT_WRITING_TOOLS, MAX_TOOL_ROUNDS, MAX_TRUNCATION_CONTINUES, TOOL_RESULT_MAX_CHARS } from "./chat_tools";
import { isPureChatter } from "./chat_intent";
import { errMsg } from "./err";
import { ensureParentFolders, SessionPickerModal, type SessionPickerItem } from "./modals";
import {
	type SessionTurn,
	archiveSessionName,
	AUTO_COMPRESS_HYSTERESIS_PCT,
	AUTO_COMPRESS_MAX_PASSES,
	AUTO_COMPRESS_MIN_KEEP_ROUNDS,
	AUTO_COMPRESS_MIN_TURNS,
	autoCompressMinGain,
	buildCompressUserPrompt,
	chatContextWindow,
	compressible,
	COMPRESS_KEEP_ROUNDS,
	COMPRESS_MIN_TURNS,
	COMPRESS_SYSTEM_PROMPT,
	DEFAULT_CHAT_WINDOW,
	estimatePromptTokens,
	estimateTokens,
	formatSession,
	LIVE_SESSION_NAME,
	parseSession,
	SESSION_ARCHIVE_PREFIX,
	sessionChars,
	sessionTimeStamp,
	shouldAutoCompress,
	splitCompressWindow,
} from "./chat_session";

// 自动压缩预算的额外开销：工具定义按实际 JSON 估算；单轮工具结果按上限字符数保守预留（中文≈1 token/字）。
// 工具结果会随工具轮追加进 messages，发送前预算必须为它留出空间。
const CHAT_TOOLS_TOKEN_ESTIMATE = estimateTokens(JSON.stringify(CHAT_TOOLS_PAYLOAD));
const CHAT_TOOL_RESULT_RESERVE = TOOL_RESULT_MAX_CHARS;

type CompressOutcome = { ok: boolean; aborted: boolean; message?: string };
type AutoCompressOutcome = { send: boolean; warning?: string };

/**
 * 常驻 LLM 对话面板（自定义 ItemView，可停靠到任意工作区区域、重载后保留位置）：
 * Enter 发送 / Shift+Enter 换行（含中文输入法合成态保护），助手回复流式逐块显示；
 * 「停止生成」只中断当前一轮、会话保留；顶部下拉切换任意已保存的模型配置（对后续轮次生效）。
 * 每轮请求前置对话专用系统提示词（对齐 CLI chat.py _chat_reply：友好助手身份+当前小说上下文快照），多轮历史用原生 messages 传递。
 * v0.4.6+ 会话持久化：每轮（含中断留存的半截回复）自动保存到当前书《案头资料/AI会话/对话 YYYY-MM-DD HHMM.md》
 * （格式见 src/chat_session.ts）；面板重开自动加载该目录最近会话；「重新加载」从磁盘读回（支持人工编辑后的文件）；
 * 「压缩上下文」把保留窗之外的早期轮次经 LLM 合并成摘要轮（注入系统提示词、不再逐轮重发）；「清空对话」解除会话绑定、下一轮另起新文件。
 * 无当前小说（纯问答模式）时不落盘、仅内存。关闭面板时中断进行中的请求。
 */
export class LlmChatView extends ItemView {
	static readonly VIEW_TYPE = "articlewriter-llm-chat";

	private getConf: () => PluginConfig | undefined;
	private getSystemPrompt?: () => Promise<{ text: string; hasStory: boolean }>;
	private cfgs: LlmConfigDoc[] = [];
	private activeIdx = 0;
	private built = false;
	private bodyEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private statusEl!: HTMLElement;
	private selectEl!: HTMLSelectElement;
	private modelLabelEl!: HTMLElement;
	private spLabelEl!: HTMLElement;
	private ctxLineEl!: HTMLElement;
	private sendBtn!: HTMLButtonElement;
	private stopBtn!: HTMLButtonElement;
	private clearBtn!: HTMLButtonElement;
	private compressBtn!: HTMLButtonElement;
	private reloadBtn!: HTMLButtonElement;
	private sessionLineEl!: HTMLElement;
	private history: SessionTurn[] = [];
	/** v0.4.7+ 双轨分离：history＝显示轨（气泡＋会话文件，完整永不删）；promptTurns＝提示词轨（实际发给模型，压缩只重写这条）。
	 *  不变量：promptTurns ＝ [summary?] ＋ 显示轨末尾若干轮（新轮同时进两轨；触发压缩时旧轮从提示词轨移除并并入摘要）。 */
	private promptTurns: SessionTurn[] = [];
	private ctrl: AbortController | null = null;
	private busy = false;
	// v0.4.6+ 会话持久化：sessionPath＝当前绑定的会话文件（vault 相对路径；null＝未落盘/已清空，下一轮发送新建文件）；
	// sessionCreatedAt/updatedModel 供 frontmatter；sessionDir 每轮取（切书后新会话落新书目录，已绑定文件不动）
	private sessionPath: string | null = null;
	private sessionCreatedAt = "";
	// @ 引用弹窗状态：输入框内键入 @ 后列出 vault 文件，选中插入 @[[路径]]（可再手输 :行号 / :起-止）
	private refPopupEl!: HTMLElement;
	private refOpen = false;
	private refIdx = 0;
	private refPaths: string[] = [];

	private getActiveStory?: () => Promise<{ story: string; chapterNum: number; chapterTitle: string } | null>;
	/** v0.2.0+：切换模型时写回 data.json 的 chat_model（由 main.ts 注入）——对话框此后使用新模型，随 data.json 持久化 */
	private setActiveModel?: (name: string) => void | Promise<void>;
	/** v0.4.6+ 会话目录（由 main.ts 注入）：当前书《案头资料/AI会话》；无当前小说返回 ""（纯问答不落盘） */
	private getChatSessionDir?: () => Promise<string>;
	/** v0.4.6+ 自然提及自动加载（由 main.ts 注入）：从原始输入识别章节/卷/内置文档提及并读盘成「=== 标签 ===」块串；无命中/无书返回空 */
	private getAutoRefBlocks?: (raw: string) => Promise<{ text: string; labels: string[] }>;
	/** v0.4.6+ 工具调用执行器（由 main.ts 注入 chatExecTool）：模型返回 tool_calls 时面板转交执行并把结果续轮回灌（工具定义见 src/chat_tools.ts） */
	private execTool?: (name: string, argsJson: string) => Promise<string>;

	constructor(
		leaf: WorkspaceLeaf,
		getConf: () => PluginConfig | undefined,
		getSystemPrompt?: () => Promise<{ text: string; hasStory: boolean }>,
		getActiveStory?: () => Promise<{ story: string; chapterNum: number; chapterTitle: string } | null>,
		setActiveModel?: (name: string) => void | Promise<void>,
		getChatSessionDir?: () => Promise<string>,
		getAutoRefBlocks?: (raw: string) => Promise<{ text: string; labels: string[] }>,
		execTool?: (name: string, argsJson: string) => Promise<string>
	) {
		super(leaf);
		this.getConf = getConf;
		this.getSystemPrompt = getSystemPrompt;
		this.getActiveStory = getActiveStory;
		this.setActiveModel = setActiveModel;
		this.getChatSessionDir = getChatSessionDir;
		this.getAutoRefBlocks = getAutoRefBlocks;
		this.execTool = execTool;
	}

	getViewType(): string {
		return LlmChatView.VIEW_TYPE;
	}

	getDisplayText(): string {
		return "LLM 对话窗口";
	}

	getIcon(): string {
		return "message-square";
	}

	getEmptyStateElement(): HTMLElement {
		const el = this.app.workspace.containerEl.createDiv(); // UI 实际由 onOpen 建进 contentEl；此处经 Obsidian helper 创建后立刻脱离文档，仅作占位返回
		el.remove();
		return el;
	}

	async onOpen(): Promise<void> {
		if (!this.built) this.buildUI(this.contentEl);
		this.refreshModels(); // 常驻面板可能在设置变更后重新显示，刷新模型列表并尽量保持原选择
		void this.updateCtxLine();
		void this.updateSpLabel();
		if (!this.history.length) void this.loadLiveSession(); // v0.4.7+ 只接回固定的《当前对话.md》（旧版时间戳文件首次打开时改名迁移）
		this.updateSessionLine();
		this.focusInputIfVisible();
	}

	async onClose(): Promise<void> {
		if (this.ctrl) this.ctrl.abort(); // 关闭时中断进行中的请求
	}

	private buildUI(parent: HTMLElement): void {
		this.built = true;
		const root = parent.createDiv({ cls: "aw-chat-view" });
		this.ctxLineEl = root.createDiv({ cls: "aw-dim aw-chat-ctx" });
		this.ctxLineEl.setText("当前小说：加载中…");
		this.sessionLineEl = root.createDiv({ cls: "aw-dim aw-chat-session" }); // v0.4.6+ 会话文件/轮数/压缩状态行（updateSessionLine 维护）
		const head = root.createDiv({ cls: "aw-chat-head" });
		head.appendText("模型：");
		this.selectEl = head.createEl("select");
		this.modelLabelEl = head.createSpan({ cls: "aw-dim" });
		this.selectEl.addEventListener("change", () => {
			this.activeIdx = parseInt(this.selectEl.value, 10) || 0;
			this.updateModelLabel();
			const name = this.cfgs[this.activeIdx]?.name;
			if (name) void this.setActiveModel?.(name); // 同步为「激活模型」：写作命令/连接测试此后使用它，并落盘到 data.json
		});
		this.spLabelEl = root.createDiv({ cls: "aw-dim aw-chat-sp" });
		this.spLabelEl.setText("提示词：加载中…");

		this.bodyEl = root.createDiv({ cls: "aw-chat-body" });
		this.statusEl = root.createDiv({ cls: "aw-dim aw-chat-status is-hidden" }); // 仅动态状态（回复中/错误）时显示，空闲隐藏——操作提示已移入输入框占位文字

		const inputBox = root.createDiv({ cls: "aw-chat-input" });
		this.inputEl = inputBox.createEl("textarea");
		this.inputEl.rows = 3;
		this.inputEl.placeholder = "输入消息 · Enter 发送 · Shift+Enter 换行 · @ 引用文件"; // v0.4.7+ 精简：长说明不再常驻框内（原一长串占位文字把输入框压成半屏），完整用法移到悬停 title 与《使用说明.md》
		this.inputEl.title = "Enter 发送 · Shift+Enter 换行\n@引用 vault 文件（弹窗选择或手输路径），范围可写 :12 / :3-10 或直接紧跟如 @[[x.md]]3-5——发送时替换为对应行的实际内容\n直接提及「第一章 / 第2卷 / 《标题》 / 故事状态 / 人物关系 / 时间线 / 世界观 / 大纲 / 策划指南」也会自动加载对应内容\n模型可按需调用工具（查章 / 查文档 / 搜索 / 审阅 / 续写 / 重写）\n每轮自动携带助手身份＋当前小说上下文；对话固定写入当前书《案头资料/AI会话/当前对话.md》，重开面板只接回这一个文件；「清空对话」把旧内容改名归档为「对话 年-月-日 时分.md」并新建空文件\n详细语法见工作目录《使用说明.md》"; // 悬停看全文（同 status_view 的 chip.title 口径）
		// @ 引用候选弹窗：锚定在输入框上方，键入 @ 触发、随后续字符过滤
		this.refPopupEl = inputBox.createDiv({ cls: "aw-ref-popup" });
		this.inputEl.addEventListener("input", () => this.updateRefPopup());
		this.inputEl.addEventListener("blur", () => window.setTimeout(() => this.hideRefPopup(), 150)); // 延迟收起让点击候选项先落地
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (this.refOpen) {
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					this.refIdx = (this.refIdx + (e.key === "ArrowDown" ? 1 : -1) + this.refPaths.length) % this.refPaths.length;
					this.renderRefList();
					return;
				}
				if ((e.key === "Enter" && !e.isComposing) || e.key === "Tab") {
					e.preventDefault();
					const p = this.refPaths[this.refIdx];
					if (p != null) this.insertRef(p);
					return;
				}
				if (e.key === "Escape") {
					e.preventDefault();
					this.hideRefPopup();
					return;
				}
			}
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				void this.send();
			}
		});

		const btns = root.createDiv({ cls: "aw-chat-btns" }); // v0.4.7+ 按钮行：左组＝压缩上下文/重新加载/清空，右组＝发送/停止生成（`aw-chat-send` 的 margin-left:auto 顶右，见 styles.css）
		this.compressBtn = btns.createEl("button", { text: "压缩上下文" });
		this.compressBtn.addEventListener("click", () => void this.compressContext());
		this.reloadBtn = btns.createEl("button", { text: "重新加载对话" });
		this.reloadBtn.title = `列出当前书《案头资料/AI会话/》里的对话历史（《${LIVE_SESSION_NAME}.md》排最前），选中一个：\n· 它的内容变成新的《${LIVE_SESSION_NAME}.md》并在面板载入\n· 原来的《${LIVE_SESSION_NAME}.md》先改名归档为「对话 年-月-日 时分.md」（空文件则直接删）\n选中《${LIVE_SESSION_NAME}.md》本身＝只从磁盘重读（手工编辑过它后生效）`;
		this.reloadBtn.addEventListener("click", () => void this.reloadSession());
		this.clearBtn = btns.createEl("button", { text: "清空对话" });
		this.clearBtn.addEventListener("click", () => void this.clearChat()); // v0.4.7+ 清空＝异步换文件（归档旧会话＋新建空《当前对话.md》）
		this.sendBtn = btns.createEl("button", { cls: "aw-chat-send", text: "发送" });
		this.sendBtn.classList.add("mod-cta");
		this.sendBtn.addEventListener("click", () => void this.send());
		this.stopBtn = btns.createEl("button", { text: "停止生成" });
		this.stopBtn.disabled = true;
		this.stopBtn.addEventListener("click", () => this.abort());

		this.refreshModels();
		this.setBusy(false);
	}

	/**
	 * 重建模型下拉。选中项**一律以持久化的 `chat_model` 为准**（不再"优先保持原选择"）：
	 * 对话框切换时会写回 chat_model，所以保持原选择的效果自然成立，同时设置页改动对话框模型也能在这里立刻体现——
	 * 两处永远指向同一个模型。public 供 main.ts 在设置变更后同步。
	 */
	refreshModels(): void {
		if (!this.built) return;
		const conf = this.getConf();
		const enabledCfgs = filterEnabledLlmConfigs(conf?.llm_configs ?? []);
		this.cfgs = enabledCfgs.length ? enabledCfgs : [{} as LlmConfigDoc];
		let idx = 0;
		const want = conf?.chat_model || conf?.active_llm;
		const preferred = selectEnabledLlmName(conf?.llm_configs ?? [], want);
		if (preferred) {
			const i = this.cfgs.findIndex((c) => c.name === preferred);
			if (i >= 0) idx = i;
		}
		this.activeIdx = idx;
		this.selectEl.empty();
		this.cfgs.forEach((c, i) => {
			this.selectEl.createEl("option", { value: String(i), text: `${c.name || `配置${i + 1}`}（${c.model_name || "?"}）` });
		});
		this.selectEl.value = String(this.activeIdx);
		this.updateModelLabel();
	}

	private updateModelLabel(): void {
		const c = this.cfgs[this.activeIdx];
		this.modelLabelEl.setText(`→ ${c.name || "?"} @ ${normalizeBaseURL(c.base_url) || "?"}`);
	}

	/** 刷新顶部「当前小说 · 章节」行（非交互读取 lastStory+状态；每轮对话后同步，另由 main.ts `notifyContextChanged()` 在切书/切章等变更后主动调用） */
	async updateCtxLine(): Promise<void> {
		if (!this.built || !this.getActiveStory) return;
		try {
			const info = await this.getActiveStory();
			this.ctxLineEl.setText(
				info ? `当前小说：${info.story} · 第${info.chapterNum}章${info.chapterTitle ? " " + info.chapterTitle : ""}` : "当前小说：无（纯问答模式，不携带小说上下文）",
			);
		} catch {
			this.ctxLineEl.setText("当前小说：读取失败");
		}
	}

	/** 刷新「提示词」来源标签：与发送时同一套组装逻辑（getChatSystemPrompt）；切书后上下文有无/大小会变化，故也随 notifyContextChanged 刷新 */
	async updateSpLabel(): Promise<void> {
		if (!this.built || !this.getSystemPrompt) return;
		try {
			const sp = await this.getSystemPrompt();
			this.spLabelEl.setText(
				`提示词：助手身份${sp.hasStory ? "+当前小说上下文" : ""}（约 ${Math.round(sp.text.length / 1000)}k 字）`,
			);
		} catch {
			this.spLabelEl.setText("提示词：加载失败（本轮将仅按模型默认行为回答，详见控制台）");
		}
	}

	private setStatus(text: string, isError = false): void {
		this.statusEl.setText(text);
		this.statusEl.classList.toggle("is-error", isError);
		this.statusEl.classList.toggle("is-hidden", !text); // 空文本=回到空闲态（提示由输入框占位文字承担）；显隐/配色走 .aw-chat-status 修饰类
	}

	private setBusy(b: boolean): void {
		this.busy = b;
		this.stopBtn.disabled = !b;
		this.sendBtn.disabled = b;
		this.clearBtn.disabled = b;
		this.compressBtn.disabled = b;
		this.reloadBtn.disabled = b;
		if (!b) this.focusInputIfVisible();
	}

	/** 面板可见时才抢焦点，避免停靠在其他区域时打断当前编辑 */
	private focusInputIfVisible(): void {
		try {
			if (this.inputEl && this.containerEl.offsetParent !== null) this.inputEl.focus({ preventScroll: true });
		} catch {
			/* ignore */
		}
	}

	private addMessage(role: SessionTurn["role"], content: string): HTMLElement {
		const cls = role === "user" ? "user" : role === "assistant" ? "assistant" : "summary";
		const wrap = this.bodyEl.createDiv({ cls: `aw-chat-msg ${cls}` });
		wrap.createSpan({ cls: "aw-chat-role", text: role === "user" ? "我" : role === "assistant" ? "助手" : "上下文摘要" });
		const body = wrap.createDiv({ cls: "aw-chat-text" });
		body.textContent = content;
		this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
		return body;
	}

	/** v0.4.6+ 按 history 全量重绘气泡区（加载/重新加载/压缩后调用；摘要轮渲染为 dim 样式「上下文摘要」块） */
	private renderAll(): void {
		this.bodyEl.empty();
		for (const t of this.history) this.addMessage(t.role, t.content);
	}

	/** @ 引用两种形式：①@[[相对路径]]（弹窗插入、可含空格）②@相对路径（手输，不含空白/冒号/方括号）。行范围支持 :行号 / :起-止、「空格+起-止」、紧贴 token 尾的数字「3-5」/「7」（如 ]]3-5；纯文本形式扩展名后紧跟数字同样识别）。[[ ]] 形式先定位 token 本体、再对尾部单独探测范围（parseRangeSuffix），避免单条复杂正则的可选分支问题 */
	static readonly BRACKET_TOKEN_RE = /@\[\[([^\]]+)\]\]/g;
	static readonly PLAIN_REF_RE = /(^|[\s])@([^\s:@[\]]+)(?::(\d+)(?:-(\d+))?)?(?:\s+(\d+)-(\d+))?/g
	/** 探测引用 token 尾部紧随的行范围：:N / :A-B / 空格 A-B / 紧贴数字（须以行尾或标点收尾）。返回 {a,b,len}，len=0 表示未跟范围 */
	private static parseRangeSuffix(suf: string): { a: number | null; b: number | null; len: number } {
		let m = suf.match(/^:(\d{1,4})(?:\s*-\s*(\d{1,4}))?\b/);
		if (m) return { a: parseInt(m[1], 10), b: m[2] ? parseInt(m[2], 10) : null, len: m[0].length };
		m = suf.match(/^\s+(\d{1,4})-(\d{1,4})/);
		if (m) return { a: parseInt(m[1], 10), b: parseInt(m[2], 10), len: m[0].length };
		m = suf.match(/^(\d{1,4})(?:-(\d{1,4}))?(?=$|[\s，。；、！？,.!?])/);
		if (m) return { a: parseInt(m[1], 10), b: m[2] ? parseInt(m[2], 10) : null, len: m[0].length };
		return { a: null, b: null, len: 0 };
	}

	/** 展开消息里的全部 @ 引用为内联内容片段：token 原位替换成「=== 路径（第X–Y行）=== + 带行号正文」；缺失文件保留原 token 并回报 missing */
	private async resolveRefs(text: string): Promise<{ expanded: string; count: number; missing: string[] }> {
		interface Tok { start: number; end: number; path: string; a: number | null; b: number | null }
		const toks: Tok[] = [];
		LlmChatView.BRACKET_TOKEN_RE.lastIndex = 0; // /g 静态正则：扫描前复位，防上次调用残留状态
		let bm: RegExpExecArray | null;
		while ((bm = LlmChatView.BRACKET_TOKEN_RE.exec(text)) !== null) { // [[ ]] 形式恒为显式引用：先取 token 本体，再探测尾部范围
			const tokEnd = bm.index + bm[0].length; // ]] 之后
			const rng = LlmChatView.parseRangeSuffix(text.slice(tokEnd));
			toks.push({ start: bm.index, end: tokEnd + rng.len, path: bm[1].trim(), a: rng.a, b: rng.b });
		}
		LlmChatView.PLAIN_REF_RE.lastIndex = 0;
		let pm: RegExpExecArray | null;
		while ((pm = LlmChatView.PLAIN_REF_RE.exec(text)) !== null) {
			const atIdx = pm.index + pm[1].length; // 跳过前置空白锚定字符
			if (toks.some((t) => atIdx < t.end && atIdx > t.start)) continue; // 与 [[ ]] 形式重叠则不重复计
			let path = pm[2];
			let a = pm[3] || pm[5] ? parseInt(pm[3] || pm[5], 10) : null;
			let b = pm[4] || pm[6] ? parseInt(pm[4] || pm[6], 10) : null;
			if (!a && !b) { // 扩展名后紧贴的数字视为行范围（@a/b.md3-5），从路径尾部拆出
				const mm = path.match(/^(.*\.[A-Za-z0-9]{1,6})(\d{1,4}(?:-(\d{1,4}))?)$/);
				if (mm) { const parts = mm[2].split("-"); path = mm[1]; a = parseInt(parts[0], 10); b = parts.length > 1 ? parseInt(parts[1], 10) : null; }
			}
			if (!path.includes("/") && !/\.[A-Za-z0-9]{1,6}$/.test(path)) continue; // 防误伤邮箱等散文：须含目录分隔符或文件扩展名
			toks.push({ start: atIdx, end: pm.index + pm[0].length, path, a, b });
		}
		if (!toks.length) return { expanded: text, count: 0, missing: [] };
		toks.sort((x, y) => x.start - y.start);
		const missing: string[] = [];
		type Repl = Tok & { snippet: string };
		const repls: Repl[] = [];
		for (const t of toks) {
			const f = this.app.vault.getAbstractFileByPath(t.path); // dts 返回 TAbstractFile|null，须 instanceof 收窄
			if (!(f instanceof TFile)) {
				missing.push(t.path);
				continue; // 缺失保留原 token 文本不替换
			}
			const content = await this.app.vault.read(f);
			let sel: string;
			let note = "";
			if (t.a != null) {
				const lines = content.split(/\r?\n/);
				const sN = Math.max(1, t.a);
				const eN = Math.min(lines.length, t.b != null && t.b >= sN ? t.b : sN);
				sel = lines.slice(sN - 1, eN).map((l, i) => `${sN + i}\t${l}`).join("\n");
				note = `（第${String(sN)}–${String(eN)}行）`;
			} else {
				sel = content; // 未指定行号/范围：整文件入上下文
				note = "（全文）";
			}
			repls.push({ ...t, snippet: `\n=== ${t.path}${note} ===\n${sel}\n` });
		}
		let expanded = ""; // 按 span 原位替换，未识别的 @ 文本原样保留
		let cur = 0;
		for (const r of repls) {
			expanded += text.slice(cur, r.start) + r.snippet;
			cur = r.end;
		}
		return { expanded: (expanded + text.slice(cur)).trim(), count: repls.length, missing };
	}
	/** 依据光标前最近的 @ 刷新候选列表；@ 须位于行首或空白之后、其后未出现换行/方括号（已写完 token 则收起） */
	private updateRefPopup(): void {
		if (this.busy) return this.hideRefPopup();
		const pos = this.inputEl.selectionStart ?? 0;
		const before = this.inputEl.value.slice(0, pos);
		const at = before.lastIndexOf("@");
		if (at < 0 || (at > 0 && !/[\s\n]/.test(before[at - 1]))) return this.hideRefPopup();
		const query = before.slice(at + 1);
		if (/\n/.test(query)) return this.hideRefPopup(); // 跨行的不是本次输入
		if (query.includes("[") || query.includes("]")) return this.hideRefPopup(); // 手动补全 [[ ]]：不再弹提示，避免插入后重复触发
		const all = this.app.vault.getFiles().map((f) => f.path).filter((p) => !/(^|\/)_resources\//.test(p)).sort(); // 排除 _resources 资源目录，不占候选位
		const q = query.trim().toLowerCase();
		const hits = q ? all.filter((p) => p.toLowerCase().includes(q)) : all; // v0.4.3+ 不再截断：候选显示全部匹配文档（此前只列前 200）
		if (!hits.length) return this.hideRefPopup();
		this.refPaths = hits;
		this.refIdx = 0;
		this.renderRefList();
	}

	private renderRefList(): void {
		this.refOpen = true;
		this.refPopupEl.empty();
		for (let i = 0; i < this.refPaths.length; i++) {
			const item = this.refPopupEl.createDiv({ text: this.refPaths[i], cls: "aw-ref-item" + (i === this.refIdx ? " is-selected" : "") });
			item.addEventListener("click", () => this.insertRef(this.refPaths[i]));
		}
		this.refPopupEl.classList.add("is-open"); // .aw-ref-popup 默认 display:none，.is-open 打开
	}

	/** 把光标前 @查询段替换为 @[[路径]]（纯字符串拼接，不依赖 execCommand——失焦时其选区行为不可靠会插出重复 @），光标停在 token 后便于续输 :行号 */
	private insertRef(path: string): void {
		const pos = this.inputEl.selectionStart ?? 0;
		const before = this.inputEl.value.slice(0, pos);
		const at = before.lastIndexOf("@");
		if (at >= 0) {
			const v = this.inputEl.value;
			const token = `@[[${path}]]`;
			this.inputEl.value = v.slice(0, at) + token + v.slice(pos);
			this.inputEl.setSelectionRange(at + token.length, at + token.length);
		}
		this.hideRefPopup();
		this.inputEl.focus();
	}

	private hideRefPopup(): void {
		this.refOpen = false;
		this.refPaths = [];
		this.refIdx = 0;
		this.refPopupEl.classList.remove("is-open");
	}

	private buildMessages(): Message[] {
		const msgs: Message[] = [];
		for (const t of this.promptTurns) { // v0.4.7+ 提示词轨（显示轨不进请求）；摘要轮不折入 messages（已折入系统提示词，见 send）
			if (t.role === "user") msgs.push({ role: "user", content: t.content });
			else if (t.role === "assistant") msgs.push({ role: "assistant", content: t.content });
		}
		return msgs;
	}

	async send(): Promise<void> {
		if (this.busy) return;
		const text = this.inputEl.value.trim();
		if (!text) return;
		const cfg = this.cfgs[this.activeIdx];
		if (!cfg.name && !cfg.base_url) {
			this.setStatus("未找到 LLM 配置：请在 Obsidian 设置 → ArticleWriter 的「LLM 模型配置」区填写", true);
			return;
		}
		// 对话专用系统提示词（对齐 CLI _chat_reply），前置到本轮请求（失败不阻断对话，仅降级为模型默认行为）
		let sysBase = "";
		if (this.getSystemPrompt) {
			try {
				sysBase = (await this.getSystemPrompt())?.text ?? "";
			} catch (e) {
				this.setStatus(`警告：对话提示词加载失败（${errMsg(e)}），本轮按模型默认行为回答`, true);
			}
		}
		// 内联展开消息里的 @ 引用：token 原位替换为指定行的实际内容片段（历史/气泡/请求都用替换后文本，模型直接看到原文）
		const refs = await this.resolveRefs(text);
		if (refs.missing.length) this.setStatus(`引用文件不存在：${refs.missing.join("、")}`, true);
		// v0.4.6+ 自然提及自动加载：输入里提到「第N章/第N卷/《标题》/故事状态/人物关系/时间线/世界观/大纲/策划指南」等
		// → main.ts 读盘拼同款「=== 标签 ===」块，追加进本轮 user 消息（识别见 src/chat_refs.ts；失败/无命中静默跳过、不阻断发送）
		let pending = refs.expanded;
		let autoLabels: string[] = [];
		if (this.getAutoRefBlocks) {
			try {
				const auto = await this.getAutoRefBlocks(text);
				if (auto.text.trim()) pending = `${refs.expanded}\n${auto.text.trim()}`;
				autoLabels = auto.labels;
			} catch (e) {
				this.setStatus(`自动加载检查失败（${errMsg(e)}），本轮按未自动加载发送`, true);
			}
		}
		// v0.4.6+ 发送前自动压缩：完整预算＝系统提示词（含摘要块/工具规则）＋历史 user/assistant 轮＋本轮展开文本＋工具定义＋单轮工具结果预留＋回复预留；
		// 超过窗口阈值先压一轮，压缩后仍超限则自适应保留窗继续压（最多 AUTO_COMPRESS_MAX_PASSES 次）；窗口未知/关闭自动/历史太短则不触发。
		const autoResult = await this.autoCompressIfNeeded(cfg, sysBase, pending);
		if (!autoResult.send) { // 压缩被「停止生成」中止：本轮不发送，避免用户停止后仍继续请求
			this.setStatus("自动压缩已停止，本轮未发送", true);
			return;
		}
		const autoWarn = autoResult.warning ? `${autoResult.warning} · ` : "";
		const sysContent = this.composeSystemPrompt(sysBase); // 压缩后的摘要块立即生效；工具规则一并计入预算
		console.debug("[articlewriter] 对话请求系统提示词", { length: sysContent.length, refs: refs.count, autoRefs: autoLabels.length }); // 排查提示词与引用是否注入
		this.history.push({ role: "user", content: pending }); // 历史/请求用展开后文本（模型看到实际内容；含本轮自动加载块）
		this.promptTurns.push({ role: "user", content: pending }); // v0.4.7+ 新轮同时进提示词轨
		this.addMessage("user", autoLabels.length ? `${text}\n〔自动加载：${autoLabels.join("、")}〕` : text); // 气泡回显原始输入（保留 @ 引用标记不显示替换结果；自动加载只列清单）
		this.inputEl.value = "";
		this.hideRefPopup();
		this.setStatus(`${autoWarn}${sysContent ? `正在回复（${cfg.name || "?"}）· 已注入助手提示词${autoLabels.length ? ` · 自动加载 ${String(autoLabels.length)} 项` : ""} …` : `正在回复（${cfg.name || "?"}）· 未携带提示词${autoLabels.length ? ` · 自动加载 ${String(autoLabels.length)} 项` : ""} …`}`);
		this.setBusy(true);
		this.ctrl = new AbortController();
		const el = this.addMessage("assistant", "");
		let full = "";
		let failed = false; // 出错/中断分支置 true：保留其状态文案；正常完成则清空回空闲态
		let messages: Message[] = sysContent ? [{ role: "system", content: sysContent }, ...this.buildMessages()] : this.buildMessages();
		// v0.4.6+ 工具调用循环：带 CHAT_TOOLS 请求→模型返回 tool_calls 则本地执行（main.ts chatExecTool：读章/读文档/搜索/审阅/续写/重写）→
		// role:"tool" 结果续轮回灌直到给出最终回答。中间工具轮不落会话历史（只存档最终答案）；端点不认 tools 参数时自动去参重试一次。
		let answerAll = ""; // 跨轮最终文本累积（工具轮/截断续写轮都可能先吐一段话）
		let toolsDropped = !this.execTool || (cfg.chat_tools ?? "").trim() === "off"; // 未注入执行器或模型配置「对话工具调用=off」＝从一开始不带 tools（小模型带工具语法约束输出会碎，见 main.ts 设置行注释）
		let toolRounds = 0;
		let truncRounds = 0; // v0.4.7+ finish_reason=length 的自动续写次数
		let finishReason: string | null = null; // 当前流最后给出的结束原因：length＝被 max_tokens 截断
		let truncWarn = ""; // 自动续写达到上限仍被截断时，保留到 finally 显示
		let histTrimmed = false; // v0.4.7+ 碎片自愈第二级：本轮请求已裁过早期历史（防反复裁剪）
		let nudged = false; // 模型只输出「行动宣告」没发 tool_calls 时自动催办一次（治「我先看一下…就停下」）
		const combinedText = (): string => [answerAll, full].filter((s) => s.trim()).join("\n"); // 工具轮/截断续写轮的已输出段合并
		const renderBubble = (): void => {
			el.textContent = combinedText();
			this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
		};
		try {
			for (;;) {
				let toolCalls: ChatToolCall[] = [];
				full = "";
				finishReason = null;
				try {
					full = await chatStream(cfg, messages, (d) => {
						full += d;
						renderBubble();
					}, toolsDropped ? undefined : { tools: CHAT_TOOLS_PAYLOAD }, this.ctrl.signal, undefined, (r) => {
						finishReason = r; // v0.4.7+ 记录 finish_reason：length＝输出被 max_tokens 截断
					}, undefined, (cs) => {
						toolCalls = cs;
					});
				} catch (e) {
					if (!toolsDropped && !this.ctrl.signal.aborted) {
						const em = describeLlmError(e);
						// ① 端点拒绝 tools 参数（老版本本地服务/不支持 function calling）；② 带 tools 时正文为空（实测小模型 GGUF 工具语法约束下 content 全空/碎片）——都去掉 tools 原样重试一次
						if (/\btools?\b|not support|unsupported|invalid|400/i.test(em) || /输出为空|未返回内容/.test(em)) {
							toolsDropped = true;
							this.setStatus(/输出为空|未返回内容/.test(em) ? "该模型带工具调用时正文为空（工具模式异常），已按普通对话重试…" : "当前模型/服务不支持工具调用，已按普通对话继续…", true);
							continue;
						}
					}
					throw e;
				}
				if (!toolCalls.length) {
					// v0.4.7+ 小模型输出崩溃＝回复只剩极短碎片（非 max_tokens 截断）：①带 tools 先去 tools 重发；②已不带 tools 则裁掉最旧历史（仅本轮请求、history 不动）重发；③仍碎则保留输出并给出诊断
					const frag = full.trim() && full.trim().length < 120 && finishReason !== "length" && finishReason !== "max_tokens" && !toolCalls.length;
					if (frag && !toolsDropped && this.execTool && (cfg.chat_tools ?? "").trim() !== "off") {
						toolsDropped = true;
						this.setStatus("该模型带工具调用时回复异常简短（工具模式崩溃），已按普通对话重试…", true);
						continue;
					}
					if (frag && !histTrimmed && this.promptTurns.length > 8) {
						histTrimmed = true;
						const sysMsg = messages[0]?.role === "system" ? [messages[0]] : [];
						messages = [...sysMsg, ...this.buildMessages().slice(-4)]; // 只带最近 4 条历史：把提示词拉回弱模型的有效区间（会话文件仍保存完整历史）
						this.setStatus("模型在长上下文下输出崩溃，已裁剪早期历史重试（会话文件不受影响）…", true);
						continue;
					}
					if (frag && histTrimmed && !truncWarn) {
						truncWarn = "该模型在长提示词下输出崩溃（本地量化小模型的有效上下文常远小于标称窗口）：请到设置页该模型配置把「上下文窗口」填为实际可靠值（如 8192），对话会按它自动压缩；或为对话换更强的模型";
						new Notice(truncWarn, 15000);
					}
					// v0.4.7+ 输出被 max_tokens 截断（OpenAI 兼容端点 finish_reason=length，部分端点写 max_tokens）：把已输出部分作为 assistant 轮续进 messages，
					// 追加「接着中断处继续」指令再流一轮；气泡继续累积显示，最多 MAX_TRUNCATION_CONTINUES 次。
					const truncated = finishReason === "length" || finishReason === "max_tokens";
					if (truncated && full.trim() && truncRounds < MAX_TRUNCATION_CONTINUES) {
						truncRounds++;
						answerAll = answerAll ? `${answerAll}\n${full}` : full;
						messages.push({ role: "assistant", content: full });
						messages.push({ role: "user", content: "上一条回复因输出长度上限被截断。请紧接着中断处继续输出剩余内容：不要重复已输出部分、不要重新开头、不要加解释或前后缀。" });
						this.setStatus(`输出达到 max_tokens 上限，自动续写（第 ${String(truncRounds)}/${String(MAX_TRUNCATION_CONTINUES)} 次）…`);
						continue;
					}
					if (truncated && full.trim() && !truncWarn) {
						truncWarn = `输出被 max_tokens 截断，已自动续写 ${String(truncRounds)} 次仍未结束；请调大该模型配置的「最大 tokens」`;
						new Notice(truncWarn, 12000);
					}
					// 行动宣告未执行兜底：模型说了「我先看一下…」就停（没发 tool_calls）→ 把宣告存进 messages 后续轮催办一次
					// 行动宣告未执行兜底：模型说了「我先看一下…」就停（没发 tool_calls）→ 把宣告存进 messages 后续轮催办一次。
					// v0.4.7+ 收紧三条（防「hi」被催出一次「连续编写」）：①用户这条消息是问候/闲聊＝不催；②只认第一人称行动宣告（裸「查看/确认/检查」会误伤选项菜单，已删）；③以问句结尾＝在等用户回答，不催
					if (!nudged && this.execTool && !toolsDropped && full.trim() && full.length <= 300 && !isPureChatter(text) && !/[?？]\s*$/.test(full.trim()) && /(我先|让我|我来|接下来我|下面我|我将|即将|马上|这就|稍等|先看)/.test(full)) {
						nudged = true;
						messages.push({ role: "assistant", content: full });
						messages.push({ role: "user", content: "请继续：直接调用工具完成你刚才说要做的查看/执行（不要只描述计划）。如当前模型/服务确实发不出工具调用，请说明并基于已有信息直接作答。" });
						this.setStatus("模型宣告了操作但未发起工具调用，已催办续轮…", true);
						continue;
					}
					break;
				}
				toolRounds++;
				if (toolRounds > MAX_TOOL_ROUNDS) {
					this.setStatus(`工具调用已达 ${String(MAX_TOOL_ROUNDS)} 轮上限，按当前结果回答`, true);
					break;
				}
				answerAll = full.trim() ? (answerAll ? `${answerAll}\n${full}` : full) : answerAll;
				const calls = toolCalls.map((c, i) => ({ id: c.id || `aw_call_${String(toolRounds)}_${String(i)}`, type: "function" as const, function: { name: c.name, arguments: c.arguments } }));
				messages.push({ role: "assistant", content: full || null, tool_calls: calls });
				for (const c of calls) {
					// v0.4.7+ 闲聊闸门：用户这条消息只是问候/寒暄（hi、你好、谢谢、你是谁…）时，写作与生成类命令一律不执行——
					// 本地弱模型常把「hi」当指令、擅自启动「连续编写」这类改稿件/跑长流程的重命令；这里不跑执行器，回一段说明让模型转为询问意图
					if ((CHAT_WRITING_TOOLS.includes(c.function.name) || CHAT_GENERATION_TOOLS.includes(c.function.name)) && isPureChatter(text)) {
						this.setStatus(`⛔ 已拦下工具 ${c.function.name}：这条消息只是问候/闲聊，没有执行指令`, true);
						messages.push({
							role: "tool",
							tool_call_id: c.id,
							content: `插件已拦下「${c.function.name}」：用户这条消息只是问候/闲聊，没有下达执行指令，写作与生成类命令（改稿件、跑长流程）不会擅自执行。请简短回应用户，并问清他想做什么，等他明确下指令后再调用工具。`,
						});
						continue;
					}
					this.setStatus(`🔧 正在执行工具 ${c.function.name}（${c.function.arguments.replace(/\s+/g, " ").slice(0, 80)}）…`);
					const res = await (this.execTool?.(c.function.name, c.function.arguments) ?? Promise.resolve("工具执行器未配置"));
					messages.push({ role: "tool", tool_call_id: c.id, content: res });
				}
				full = "";
				renderBubble(); // 等最终回答的新一轮流式
			}
			// 最终文本在 finally 里用 combinedText() 合并，保证中断/失败时 answerAll（工具轮/截断续写轮已输出段）不丢
		} catch (e) {
			const aborted = !!this.ctrl && this.ctrl.signal.aborted;
			const msg = describeLlmError(e); // 带底层 cause/code/HTTP 状态，便于区分连接被拒、超时与 4xx
			const soFar = combinedText();
			if (aborted) {
				if (!soFar.trim()) el.parentElement?.remove(); // 空的中断轮次不留痕
				else { failed = true; this.setStatus("已停止生成"); }
			} else if (msg.includes("输出为空") || msg.includes("未返回内容")) {
				if (!soFar.trim()) {
					el.parentElement?.remove();
					failed = true;
					this.setStatus("模型未返回内容，请重试或检查服务状态", true);
				} else {
					failed = true; // 续写/工具轮空返回：保留前面已输出部分
					this.setStatus(`续写轮未返回内容，已保留前面输出（${msg}）`, true);
				}
			} else {
				{ failed = true; this.setStatus(`请求失败：${msg}`, true); }
			}
		} finally {
			if (!failed) this.setStatus(truncWarn, !!truncWarn); // 正常完成回空闲态；截断续写达上限则保留警告
			const finalText = combinedText();
			if (finalText.trim() && el.parentElement !== null) {
				this.history.push({ role: "assistant", content: finalText });
				this.promptTurns.push({ role: "assistant", content: finalText }); // v0.4.7+ 新轮同时进提示词轨
			}
			await this.saveSession(); // v0.4.6+ 每轮结束（含中断留半截回复/仅用户轮）自动保存会话文件
			this.setBusy(false);
			void this.updateCtxLine(); // 每轮后同步小说/章节行与提示词来源（期间可能执行过写作命令）
			void this.updateSpLabel();
			this.updateSessionLine();
		}
	}

	// ---------- v0.4.6+ 会话持久化（案头资料/AI会话/）· 上下文压缩 · 重新加载 ----------

	/** 逐级创建 path 的全部父目录（会话保存用；实现已提取到 modals.ensureParentFolders，与 main.ts save_content_to_file 工具共用） */
	private async ensureFolders(path: string): Promise<void> {
		await ensureParentFolders(this.app, path);
	}

	/** 会话行：绑定文件路径 · 条目数/字数 · 摘要标记 · 窗口预算/自动压缩状态（无当前小说时发送不落盘，见 saveSession） */
	private updateSessionLine(): void {
		if (!this.built) return;
		const entries = this.history.filter((t) => t.role !== "summary").length;
		const hasSummary = this.promptTurns.some((t) => t.role === "summary"); // v0.4.7+ 摘要活在提示词轨
		const bits = [this.sessionPath ? `会话：${this.sessionPath}` : `会话：发送后写入当前书《案头资料/AI会话/${LIVE_SESSION_NAME}.md》`]; // v0.4.7+ 固定文件名（只有「清空对话」会把它改名归档）
		if (entries) bits.push(`${String(entries)} 条${hasSummary ? "（含上下文摘要）" : ""} · 约 ${String(sessionChars(this.history))} 字`);
		const cfg = this.cfgs[this.activeIdx] ?? {};
		const explicitWin = chatContextWindow(cfg);
		const win = explicitWin ?? DEFAULT_CHAT_WINDOW;
		let tok = 0;
		for (const t of this.promptTurns) tok += estimateTokens(t.content); // v0.4.7+ 按提示词轨估算（压缩后即时反映真实发送量）
		tok += this.toolOverheadTokens(win); // 工具定义＋结果预留（v0.4.7+ 窗口 1/6 封顶，与压缩判定同一套共用件）
		const reserve = this.replyReserveTokens(cfg.max_tokens, win);
		tok += reserve;
		const ratio = this.getConf()?.chat_compress_ratio ?? 75;
		bits.push(ratio > 0 ? `提示词估算 ~${String(tok)} token / 窗口 ${String(win)}${explicitWin ? "" : "（未填，按缺省）"}，≥${String(Math.round(ratio))}% 自动压缩（压到 ${String(Math.round(Math.max(50, ratio - AUTO_COMPRESS_HYSTERESIS_PCT)))}% 以下、可压内容太少则跳过）` : `提示词估算 ~${String(tok)} token / 窗口 ${String(win)} · 自动压缩已关闭`);
		this.sessionLineEl.setText(bits.join(" · "));
	}

	/** 每轮结束整写会话文件（全量重写＝压缩后的文件与内存一致）：未绑定则在会话目录新建《对话 YYYY-MM-DD HHMM.md》（同分钟撞名加 -2 后缀）；
	 *  已绑定始终写回原文件（期间切书不改绑定）；无当前小说（dir=""）纯内存不落盘 */
	private async saveSession(): Promise<void> {
		if (!this.history.length) return;
		const dir = (await this.getChatSessionDir?.()) ?? "";
		if (!dir) {
			this.updateSessionLine();
			return;
		}
		try {
			if (!this.sessionPath) {
				this.sessionPath = this.liveSessionPath(dir); // v0.4.7+ 固定文件名《当前对话.md》：不再按时间戳新建，只有「清空对话」会把它改名归档
				this.sessionCreatedAt = sessionTimeStamp(new Date());
			}
			const now = sessionTimeStamp(new Date());
			await this.writeSessionFile(this.sessionPath, this.sessionCreatedAt || now, now);
		} catch (e) {
			new Notice(`对话会话保存失败：${errMsg(e)}`, 8000);
		}
		this.updateSessionLine();
	}

	/** v0.4.7+ 固定会话文件路径＝`<案头资料/AI会话>/当前对话.md`（面板每次只加载它；「清空对话」把它改名归档后原位重建） */
	private liveSessionPath(dir: string): string {
		return `${dir}/${LIVE_SESSION_NAME}.md`;
	}

	/** 写会话文件的统一出口（每轮保存／「清空对话」新建空骨架共用）：内容＝摘要节（提示词轨状态）＋完整显示轨＋frontmatter（含 prompt_keep）；文件不存在＝ensureFolders＋create，存在＝modify */
	private async writeSessionFile(path: string, createdAt: string, updatedAt: string): Promise<void> {
		const info = await this.getActiveStory?.();
		const summaries = this.promptTurns.filter((t) => t.role === "summary"); // v0.4.7+ 文件＝摘要（提示词轨状态）＋完整显示对话；prompt_keep＝提示词轨保留的末尾轮数
		const content = formatSession(
			{ story: info?.story ?? "", created_at: createdAt, updated_at: updatedAt, model: this.cfgs[this.activeIdx]?.name ?? "", prompt_keep: summaries.length ? this.promptTurns.filter((t) => t.role !== "summary").length : undefined },
			[...summaries, ...this.history],
		);
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) await this.app.vault.modify(f, content);
		else {
			await this.ensureFolders(path);
			await this.app.vault.create(path, content);
		}
	}

	/** v0.4.7+ 会话文件读回→双轨拆分：显示轨＝全部非摘要轮；提示词轨＝摘要轮＋显示轨末尾 prompt_keep 轮（字段缺失＝全量，旧文件兼容） */
	private applyLoadedTurns(turns: SessionTurn[], promptKeep?: number): void {
		const summaries = turns.filter((t) => t.role === "summary");
		const display = turns.filter((t) => t.role !== "summary");
		this.history = display;
		const keep = typeof promptKeep === "number" && promptKeep >= 0 ? Math.min(promptKeep, display.length) : display.length;
		this.promptTurns = [...summaries, ...display.slice(Math.max(0, display.length - keep))];
	}

	/** v0.4.7+ 面板打开＝只接回固定的《当前对话.md》（不再挑「目录里最新的一份」）。该文件不存在时做一次性迁移：
	 *  目录里若有旧版按时间戳命名的会话文件（`对话 ….md`），把 mtime 最新的那份改名成固定名（此后一直用它）；目录空/无旧文件＝false（保持空面板） */
	private async loadLiveSession(): Promise<boolean> {
		const dir = (await this.getChatSessionDir?.()) ?? "";
		if (!dir) return false;
		const folder = this.app.vault.getAbstractFileByPath(dir);
		if (!(folder instanceof TFolder)) return false;
		const livePath = this.liveSessionPath(dir);
		const existing = this.app.vault.getAbstractFileByPath(livePath);
		let target: TFile | null = existing instanceof TFile ? existing : null;
		if (!target) {
			let latest: TFile | null = null;
			for (const child of folder.children) {
				if (child instanceof TFile && child.name.startsWith(SESSION_ARCHIVE_PREFIX) && child.name.endsWith(".md")) {
					if (!latest || child.stat.mtime > latest.stat.mtime) latest = child;
				}
			}
			if (!latest) return false;
			try {
				await this.app.vault.rename(latest, livePath); // 旧版时间戳文件→固定名：内容原样搬迁，Obsidian 顺带改写指向它的链接
				const after = this.app.vault.getAbstractFileByPath(livePath);
				target = after instanceof TFile ? after : null;
				if (target) new Notice(`已把最近一次会话文件改名为《${LIVE_SESSION_NAME}.md》：此后面板每次打开只加载它，只有「清空对话」会把它改名归档`, 8000);
			} catch (e) {
				this.setStatus(`迁移旧会话文件失败：${errMsg(e)}`, true);
				return false;
			}
		}
		if (!target) return false;
		try {
			const turns = await this.applySessionFile(target); // 读取＋灌入两条轨＋绑定状态（与「重新加载」/选历史共用）
			if (turns > 0) this.setStatus(`已接回当前对话：${target.name}`);
			return turns > 0;
		} catch {
			return false;
		}
	}

	/** 「重新加载对话」v0.4.7+：弹出当前书《案头资料/AI会话/》里的**对话历史选择器**（《当前对话.md》排最前，其余归档按时间倒序）。
	 *  选中归档＝换文件：先把当前《当前对话.md》改名归档，再把选中文件改名成《当前对话.md》并载入面板＝两者内容互换（不留重复副本）；
	 *  选中《当前对话.md》＝从磁盘重读（人工在 Obsidian 里编辑过它后生效）。目录里没有归档＝退回旧行为（直接重读/接回固定文件）；无当前小说＝只能重读已绑定文件 */
	private async reloadSession(): Promise<void> {
		if (this.busy) return;
		const dir = (await this.getChatSessionDir?.()) ?? "";
		if (!dir) { await this.reloadBoundSession(); return; }
		const listed = await this.listSessionFiles(dir);
		if (!listed.some((x) => !x.live)) {
			if (await this.loadLiveSession()) this.updateSessionLine();
			else this.setStatus(`没有可加载的对话文件（当前书《案头资料/AI会话/》下没有《${LIVE_SESSION_NAME}.md》，或当前无小说）`, true);
			return;
		}
		new SessionPickerModal(this.app, listed, (p) => this.pickSessionFile(p, dir), () => this.updateSessionLine()).open();
	}

	/** 会话目录里的可选历史：《当前对话.md》（live 标记，排最前）＋ `对话 ….md` 归档（按 mtime 倒序）。
	 *  每项预读文件解析轮数/字数/首句摘要作展示用；读失败仍列入（只少副行信息），不因此丢掉可选项 */
	private async listSessionFiles(dir: string): Promise<Array<SessionPickerItem & { live: boolean }>> {
		const folder = this.app.vault.getAbstractFileByPath(dir);
		if (!(folder instanceof TFolder)) return [];
		const livePath = this.liveSessionPath(dir);
		const rows: Array<{ item: SessionPickerItem; live: boolean; ts: number }> = [];
		for (const child of folder.children) {
			if (!(child instanceof TFile) || !child.name.endsWith(".md")) continue;
			const isLive = child.path === livePath;
			if (!isLive && !child.name.startsWith(SESSION_ARCHIVE_PREFIX)) continue;
			let turns: SessionTurn[] = [];
			let createdAt = "";
			try {
				const parsed = parseSession(await this.app.vault.read(child));
				turns = parsed.turns;
				createdAt = parsed.meta.created_at ?? "";
			} catch { /* 读/解析失败＝按无轮次展示，仍可选择 */ }
			const chat = turns.filter((t) => t.role !== "summary");
			const firstUser = (chat.find((t) => t.role === "user")?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
			const label = `${isLive ? `【当前】${LIVE_SESSION_NAME}` : child.name.replace(/\.md$/, "")} · ${String(chat.length)} 条对话`;
			const sub = `${createdAt ? `${createdAt} · ` : ""}约 ${String(sessionChars(chat))} 字${firstUser ? ` · ${firstUser}` : ""}`;
			rows.push({ item: { path: child.path, label, sub }, live: isLive, ts: child.stat.mtime });
		}
		rows.sort((a, b) => (a.live === b.live ? b.ts - a.ts : a.live ? -1 : 1));
		return rows.map((r) => ({ ...r.item, live: r.live }));
	}

	/** 选择历史会话后的换文件流程：①当前《当前对话.md》有内容→改名归档（空骨架则直接删，不产空归档）②选中文件改名成《当前对话.md》③载入面板。
	 *  ②失败＝回滚①（把归档改回固定名），绝不出现两头落空 */
	private async pickSessionFile(pickedPath: string, dir: string): Promise<void> {
		const livePath = this.liveSessionPath(dir);
		if (pickedPath === livePath) { await this.reloadBoundSession(); return; }
		const picked = this.app.vault.getAbstractFileByPath(pickedPath);
		if (!(picked instanceof TFile)) {
			this.setStatus(`历史会话文件已不存在：${pickedPath}`, true);
			return;
		}
		const live = this.app.vault.getAbstractFileByPath(livePath);
		let archived = "";
		if (live instanceof TFile) {
			let createdAt = "";
			let turnCount = 0;
			let body = "";
			try {
				const raw = await this.app.vault.read(live);
				const parsed = parseSession(raw);
				turnCount = parsed.turns.length;
				createdAt = parsed.meta.created_at ?? "";
				body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim(); // 只剩 frontmatter＝插件建的空骨架
			} catch { /* 读不了＝按有内容处理，保守归档 */ }
			if (!turnCount && !body) await this.app.vault.delete(live);
			else {
				const parent = livePath.slice(0, livePath.lastIndexOf("/"));
				const base = archiveSessionName(createdAt, new Date());
				let target = `${parent}/${base}.md`;
				for (let i = 2; this.app.vault.getAbstractFileByPath(target); i++) target = `${parent}/${base}-${String(i)}.md`;
				try {
					await this.app.vault.rename(live, target);
					archived = target;
				} catch (e) {
					this.setStatus(`当前对话归档失败，已取消载入历史：${errMsg(e)}`, true);
					return;
				}
			}
		}
		try {
			await this.app.vault.rename(picked, livePath); // 选中历史的内容从此写在《当前对话.md》里
		} catch (e) {
			if (archived) {
				const back = this.app.vault.getAbstractFileByPath(archived);
				if (back instanceof TFile) await this.app.vault.rename(back, livePath).catch(() => undefined);
			}
			this.setStatus(`载入历史会话失败${archived ? "（已把归档改回原位）" : ""}：${errMsg(e)}`, true);
			return;
		}
		const after = this.app.vault.getAbstractFileByPath(livePath);
		let turns = 0;
		if (after instanceof TFile) turns = await this.applySessionFile(after);
		this.setStatus(
			archived
				? `已载入「${picked.name.replace(/\.md$/, "")}」：原当前对话归档为 ${archived.slice(archived.lastIndexOf("/") + 1)}`
				: `已载入「${picked.name.replace(/\.md$/, "")}」为《${LIVE_SESSION_NAME}.md》`
		);
		if (!turns) this.setStatus("该历史文件里没有解析到对话轮次（面板显示为空）", true);
		this.updateSessionLine();
	}

	/** 从磁盘重读当前绑定的会话文件（无当前小说的纯问答模式里＝「重新加载」的唯一路径） */
	private async reloadBoundSession(): Promise<void> {
		if (!this.sessionPath) {
			this.setStatus("没有可加载的对话文件（当前无小说：对话只在内存、不落盘）", true);
			return;
		}
		const f = this.app.vault.getAbstractFileByPath(this.sessionPath);
		if (!(f instanceof TFile)) {
			this.setStatus(`对话文件已不存在：${this.sessionPath}（发送新消息会自动新建）`, true);
			return;
		}
		try {
			const n = await this.applySessionFile(f);
			this.setStatus(`已重新加载 ${String(n)} 条对话：${f.name}`);
		} catch (e) {
			this.setStatus(`重新加载失败：${errMsg(e)}`, true);
		}
		this.updateSessionLine();
	}

	/** 读会话文件并灌入面板（显示轨＋提示词轨＋frontmatter 状态）；返回轮数（0＝空文件，面板显示为空） */
	private async applySessionFile(f: TFile): Promise<number> {
		const { meta, turns } = parseSession(await this.app.vault.read(f));
		this.sessionPath = f.path;
		this.sessionCreatedAt = meta.created_at ?? "";
		this.applyLoadedTurns(turns, meta.prompt_keep);
		this.renderAll();
		return turns.length;
	}

	/** 已压缩摘要轮折入系统提示词尾部（摘要只活在提示词轨；显示轨永不受压缩影响） */
	private summaryBlock(): string {
		return this.promptTurns.filter((t) => t.role === "summary").map((t) => t.content).join("\n\n");
	}

	/** 最终系统提示词：base 提示词 + 摘要块 + 工具调用规则；预算与请求使用同一组装结果 */
	private composeSystemPrompt(base: string): string {
		let sys = base;
		const block = this.summaryBlock();
		if (block) sys = `${sys}\n\n【此前对话摘要（更早轮次已压缩，不再逐轮发送）】\n${block}`;
		const ccfg = this.cfgs[this.activeIdx];
		if (this.execTool && (ccfg?.chat_tools ?? "").trim() !== "off") sys = `${sys}\n\n【工具调用规则】①用户这条消息若只是问候/寒暄/闲聊/能力询问（例如「hi」「你好」「谢谢」「你是谁」「你能做什么」），**不得调用任何写作类或生成类命令**（审阅本章、续写当前章、重写本章、按大纲创作章节、润色整章、去 AI 味、连续编写、生成世界观/策划指南/时间线/书籍大纲/卷大纲、从卷大纲生成章节都算）；只简短回应并问清用户想做什么，意图含糊就先问一句、不要先动手。②用户已明确下达动作指令时，需要查看稿件内容或执行写作/生成命令的，必须在本次回复中直接发起工具调用（tool_calls）完成，绝不能只输出「我先看看…」「接下来我将…」之类的意图文字就结束。③违反①的调用会被插件拦下并回一条拒绝结果，别反复重试。④若确实无法调用工具，请如实告知用户当前模型/服务不支持工具调用，并基于已有上下文作答。⑤**只能调用 tools 清单里列出的工具名**，不存在 read_file / list_files / grep / write_file / open 这类通用 agent 工具名（调了会被拦下并回一条候选提示）；要读《时间线.md》《世界观.md》《大纲.md》《人物关系.md》《策划指南.md》《故事状态.md》一律调 read_doc(doc_name=…)。`;
		return sys.trim();
	}

	/** 工具定义＋单轮工具结果上限作为额外开销计入预算（避免工具轮把请求顶出窗口）。
	 *  v0.4.7+ 封顶由窗口 1/3 收到 **1/6**：小窗口（缺省 8192）下 1/3＝2730 token 光预留就把每轮都顶过压缩阈值，用户视角就是「每发一句都压缩一次」 */
	private toolOverheadTokens(win?: number): number {
		if (!this.execTool) return 0;
		return Math.min(CHAT_TOOLS_TOKEN_ESTIMATE + CHAT_TOOL_RESULT_RESERVE, win ? Math.floor(win / 6) : Infinity);
	}

	/** 回复预留：`max_tokens` 与窗口 1/6 取小（v0.4.7+ 同理由由 1/4 收紧；真被截断有「自动续写」兜底） */
	private replyReserveTokens(maxTokens: number | undefined, win: number): number {
		return Math.min(maxTokens ?? 2048, Math.floor(win / 6));
	}

	/** 发送前完整 prompt 预算（不含回复预留）：系统提示词含摘要/工具规则，历史只算 user/assistant 轮；
	 *  工具定义与单轮工具结果上限作为额外开销计入，避免工具轮把请求顶出窗口；开销按窗口 1/6 封顶。 */
	private promptBudgetTokens(base: string, pendingUser: string, win?: number): number {
		return estimatePromptTokens(this.composeSystemPrompt(base), this.promptTurns, pendingUser, this.toolOverheadTokens(win)); // v0.4.7+ 预算按提示词轨估算（显示轨不占模型预算）
	}

	/** v0.4.6+ 发送前自动压缩：完整预算 ≥ 窗口 × chat_compress_ratio%（缺省 75，0＝关闭）时压一轮；
	 *  v0.4.7+ 两处防抖：①**压到阈值下 10 个点**（AUTO_COMPRESS_HYSTERESIS_PCT）为止、不是刚好压线；
	 *  ②待压内容估算 < autoCompressMinGain(窗口) ＝**跳过不压**（省一次 LLM 调用，压了也降不下来）。
	 *  先按保留 2 轮压缩；仍超限则自适应降到保留 1 轮再压，最多 AUTO_COMPRESS_MAX_PASSES 次。
	 *  返回 send=false 仅当压缩被「停止生成」中止；压缩失败/历史太短则照发并带警告。 */
	private async autoCompressIfNeeded(cfg: LlmConfigDoc, baseSys: string, pendingUser: string): Promise<AutoCompressOutcome> {
		const win = chatContextWindow(cfg) ?? DEFAULT_CHAT_WINDOW; // v0.4.7+ 窗口未知按缺省 8192 判定：防止长对话全量历史逐轮重发把提示词滚到崩溃
		const ratio = this.getConf()?.chat_compress_ratio ?? 75;
		if (ratio <= 0) return { send: true };
		const reserve = this.replyReserveTokens(cfg.max_tokens, win);
		const targetRatio = Math.max(50, ratio - AUTO_COMPRESS_HYSTERESIS_PCT); // 触发之后要压到这条线以下才算压够
		const floorHint = `大头是系统提示词（书籍上下文/引用文档/技能）＋工具开销＋回复预留：可减少对话引用文档、关掉「对话工具调用」、或到设置页给该模型填更大的「上下文窗口」`;
		let passes = 0;
		for (let i = 0; i < AUTO_COMPRESS_MAX_PASSES; i++) {
			const promptTok = this.promptBudgetTokens(baseSys, pendingUser, win);
			if (!shouldAutoCompress(promptTok, reserve, win, i === 0 ? ratio : targetRatio)) return { send: true };
			const keepRounds = compressible(this.promptTurns, COMPRESS_MIN_TURNS, COMPRESS_KEEP_ROUNDS)
				? COMPRESS_KEEP_ROUNDS
				: compressible(this.promptTurns, AUTO_COMPRESS_MIN_TURNS, AUTO_COMPRESS_MIN_KEEP_ROUNDS)
					? AUTO_COMPRESS_MIN_KEEP_ROUNDS
					: 0;
			if (!keepRounds) {
				return { send: true, warning: `估算提示词约 ${String(promptTok)} token、接近窗口 ${String(win)} 的 ${String(Math.round(ratio))}%——历史已无可压轮次；${floorHint}` };
			}
			const minTurns = keepRounds === AUTO_COMPRESS_MIN_KEEP_ROUNDS ? AUTO_COMPRESS_MIN_TURNS : COMPRESS_MIN_TURNS;
			const minGain = autoCompressMinGain(win);
			const gain = splitCompressWindow(this.promptTurns, keepRounds).toCompress.reduce((n, t) => n + estimateTokens(t.content), 0);
			if (gain < minGain) {
				return { send: true, warning: passes ? `已压缩 ${String(passes)} 次，剩余可压内容约 ${String(gain)} token（<${String(minGain)}）＝再压换不来空间，本轮照发` : `估算提示词约 ${String(promptTok)} token 接近窗口 ${String(win)} 的 ${String(Math.round(ratio))}%，但可压内容仅约 ${String(gain)} token（<${String(minGain)}）——压了也降不下来，本轮跳过压缩。${floorHint}` };
			}
			this.setStatus(`估算提示词约 ${String(promptTok)} token ≥ 窗口 ${String(win)} 的 ${String(Math.round(ratio))}% —— 自动压缩早期轮次（保留 ${String(keepRounds)} 轮，压到 ${String(Math.round(targetRatio))}% 以下）…`);
			const result = await this.compressContext(keepRounds, minTurns);
			if (result.aborted) return { send: false };
			if (!result.ok) return { send: true, warning: result.message ?? "自动压缩失败" };
			passes++;
		}
		const promptTok = this.promptBudgetTokens(baseSys, pendingUser, win);
		if (shouldAutoCompress(promptTok, reserve, win, ratio)) {
			return { send: true, warning: `已自动压缩 ${String(passes)} 次仍接近窗口 ${String(win)}，本轮照发。${floorHint}` };
		}
		return { send: true };
	}

	/** 「压缩上下文」：默认保留最近 2 轮；自动压缩会传入自适应 keepRounds/minTurns。
	 *  更早轮次连同旧摘要交当前模型合并成新摘要轮（置于会话最前，只折入系统提示词）。
	 *  返回 {ok, aborted, message}；压缩中断/失败/为空＝历史原样不动，调用方决定失败时照发还是中止。 */
	private async compressContext(keepRounds = COMPRESS_KEEP_ROUNDS, minTurns = COMPRESS_MIN_TURNS): Promise<CompressOutcome> {
		if (this.busy) return { ok: false, aborted: false, message: "正在生成/压缩中，未执行" };
		if (!compressible(this.promptTurns, minTurns, keepRounds)) {
			const msg = `对话还不够长：保留最近 ${String(keepRounds)} 轮，需要至少再多 ${String(minTurns)} 条早期消息才值得压缩`;
			this.setStatus(msg, true);
			return { ok: false, aborted: false, message: msg };
		}
		const cfg = this.cfgs[this.activeIdx];
		if (!cfg.name && !cfg.base_url) {
			const msg = "未找到 LLM 配置：请在 Obsidian 设置 → ArticleWriter 的「LLM 模型配置」区填写";
			this.setStatus(msg, true);
			return { ok: false, aborted: false, message: msg };
		}
		const { toCompress, keep } = splitCompressWindow(this.promptTurns, keepRounds);
		const compressCount = toCompress.filter((t) => t.role !== "summary").length;
		this.setBusy(true);
		this.ctrl = new AbortController();
		this.setStatus(`正在压缩 ${String(compressCount)} 条早期对话 …`);
		let summary = "";
		let outcome: CompressOutcome = { ok: false, aborted: false };
		try {
			summary = await chatStream(
				cfg,
				[{ role: "system", content: COMPRESS_SYSTEM_PROMPT }, { role: "user", content: buildCompressUserPrompt(toCompress) }],
				(d) => {
					summary += d;
					this.setStatus(`正在压缩上下文… ${String(summary.length)} 字（可停止，历史不动）`);
				},
				undefined,
				this.ctrl.signal,
			);
			if (summary.trim()) {
				this.promptTurns = [{ role: "summary", content: summary.trim() }, ...keep]; // v0.4.7+ 只重写提示词轨：气泡显示与会话文件的完整对话原样保留
				await this.saveSession();
				this.setStatus("");
				new Notice(`✓ 已把 ${String(compressCount)} 条早期对话压成摘要（约 ${String(summary.trim().length)} 字）——此后每轮只发送摘要＋最近几轮，气泡与会话文件里的完整对话不受影响`, 8000);
				outcome = { ok: true, aborted: false };
			} else {
				const msg = "模型未返回摘要，对话未改动";
				this.setStatus(msg, true);
				outcome = { ok: false, aborted: false, message: msg };
			}
		} catch (e) {
			const aborted = this.ctrl.signal.aborted;
			const msg = aborted ? "已中止压缩，对话未改动" : `压缩失败：${describeLlmError(e)}`;
			this.setStatus(msg, true);
			outcome = { ok: false, aborted, message: msg };
		} finally {
			this.setBusy(false);
			this.updateSessionLine();
		}
		return outcome;
	}

	private abort(): void {
		if (this.busy && this.ctrl) this.ctrl.abort();
	}

	/** v0.4.7+ 「清空对话」＝换会话文件：先把当前会话文件改名归档（`对话 YYYY-MM-DD HHMM.md`，时间取 frontmatter `created_at`，撞名加 `-2`），
	 *  再在原位新建空的《当前对话.md》记录新内容（无当前小说/目录不可用＝只清内存轨）。归档失败＝不新建空文件覆盖，保留原绑定并提示 */
	private async clearChat(): Promise<void> {
		if (this.busy) return;
		if (!this.history.length) {
			this.setStatus("对话已经是空的（无需清空）");
			return; // 空对话不归档：避免案头资料/AI会话/ 里堆空骨架文件
		}
		const dir = (await this.getChatSessionDir?.()) ?? "";
		const livePath = dir ? this.liveSessionPath(dir) : "";
		const curPath = this.sessionPath ?? livePath;
		const cur = curPath ? this.app.vault.getAbstractFileByPath(curPath) : null;
		let archived = "";
		if (cur instanceof TFile) {
			// 归档就地放（在绑定文件所在目录）：会话可能属于另一本书（切书后绑定不变），不搬到当前书的 AI会话/
			const parent = curPath.slice(0, curPath.lastIndexOf("/"));
			const base = archiveSessionName(this.sessionCreatedAt, new Date());
			let target = `${parent}/${base}.md`;
			for (let i = 2; this.app.vault.getAbstractFileByPath(target); i++) target = `${parent}/${base}-${String(i)}.md`;
			try {
				await this.app.vault.rename(cur, target); // Obsidian 改名＝内容原样搬迁并改写指向它的链接
				archived = target;
			} catch (e) {
				new Notice(`归档会话文件失败：${errMsg(e)}（未新建新会话文件，原文件仍在 ${curPath}）`, 8000);
			}
		}
		this.history = [];
		this.promptTurns = [];
		this.bodyEl.empty();
		this.sessionPath = null;
		this.sessionCreatedAt = "";
		const hadFile = cur instanceof TFile;
		if (dir && (!hadFile || archived)) {
			try {
				const now = sessionTimeStamp(new Date());
				await this.writeSessionFile(livePath, now, now); // 空骨架（只有 frontmatter）：下一轮发送往这里写新内容
				this.sessionPath = livePath;
				this.sessionCreatedAt = now;
			} catch (e) {
				new Notice(`新建《${LIVE_SESSION_NAME}.md》失败：${errMsg(e)}（发送新消息时会自动重建）`, 8000);
			}
		}
		this.setStatus(
			archived
				? `对话已清空：原会话归档为 ${archived.slice(archived.lastIndexOf("/") + 1)}，新内容写入《${LIVE_SESSION_NAME}.md》`
				: dir
					? "对话已清空"
					: "对话已清空（当前无小说：对话不落盘）",
		);
		this.updateSessionLine();
	}
}
