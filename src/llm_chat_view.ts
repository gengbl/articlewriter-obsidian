import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type { LlmConfigDoc, PluginConfig } from "./plugin_config";
import { chatStream, normalizeBaseURL } from "./llm_client";
import type { Message } from "./llm_client";

interface ChatTurn {
	role: "user" | "assistant";
	content: string;
}

/**
 * 常驻 LLM 对话面板（自定义 ItemView，可停靠到任意工作区区域、重载后保留位置）：
 * Enter 发送 / Shift+Enter 换行（含中文输入法合成态保护），助手回复流式逐块显示；
 * 「停止生成」只中断当前一轮、会话保留；顶部下拉切换任意已保存的模型配置（对后续轮次生效）。
 * 每轮请求前置对话专用系统提示词（对齐 CLI chat.py _chat_reply：友好助手身份+【创作规范】指南+当前小说上下文快照），多轮历史用原生 messages 传递；历史不落盘。
 * 关闭面板时中断进行中的请求。
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
	private history: ChatTurn[] = [];
	private ctrl: AbortController | null = null;
	private busy = false;
	// @ 引用弹窗状态：输入框内键入 @ 后列出 vault 文件，选中插入 @[[路径]]（可再手输 :行号 / :起-止）
	private refPopupEl!: HTMLElement;
	private refOpen = false;
	private refIdx = 0;
	private refPaths: string[] = [];

	private getActiveStory?: () => Promise<{ story: string; chapterNum: number; chapterTitle: string } | null>;

	constructor(leaf: WorkspaceLeaf, getConf: () => PluginConfig | undefined, getSystemPrompt?: () => Promise<{ text: string; hasStory: boolean }>, getActiveStory?: () => Promise<{ story: string; chapterNum: number; chapterTitle: string } | null>) {
		super(leaf);
		this.getConf = getConf;
		this.getSystemPrompt = getSystemPrompt;
		this.getActiveStory = getActiveStory;
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
		const head = root.createDiv({ cls: "aw-chat-head" });
		head.appendText("模型：");
		this.selectEl = head.createEl("select");
		this.modelLabelEl = head.createSpan({ cls: "aw-dim" });
		this.selectEl.addEventListener("change", () => {
			this.activeIdx = parseInt(this.selectEl.value, 10) || 0;
			this.updateModelLabel();
		});
		this.spLabelEl = root.createDiv({ cls: "aw-dim aw-chat-sp" });
		this.spLabelEl.setText("提示词：加载中…");

		this.bodyEl = root.createDiv({ cls: "aw-chat-body" });
		this.statusEl = root.createDiv({ cls: "aw-dim aw-chat-status is-hidden" }); // 仅动态状态（回复中/错误）时显示，空闲隐藏——操作提示已移入输入框占位文字

		const inputBox = root.createDiv({ cls: "aw-chat-input" });
		this.inputEl = inputBox.createEl("textarea");
		this.inputEl.rows = 3;
		this.inputEl.placeholder = "Enter 发送 · Shift+Enter 换行；@引用vault文件（弹窗选择或手输路径），范围可写 :12 / :3-10 或直接紧跟如 @[[x.md]]3-5——发送时替换为对应行的实际内容；每轮自动携带助手身份+创作规范+当前小说上下文；历史不落盘"; // 空时显示的提示在框内，输入即消失
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

		const btns = root.createDiv();
		this.sendBtn = btns.createEl("button", { text: "发送" });
		this.sendBtn.classList.add("mod-cta");
		this.sendBtn.addEventListener("click", () => void this.send());
		this.stopBtn = btns.createEl("button", { text: "停止生成" });
		this.stopBtn.disabled = true;
		this.stopBtn.addEventListener("click", () => this.abort());
		this.clearBtn = btns.createEl("button", { text: "清空对话" });
		this.clearBtn.addEventListener("click", () => this.clearChat());

		this.refreshModels();
		this.setBusy(false);
	}

	private refreshModels(): void {
		if (!this.built) return;
		const conf = this.getConf();
		const prevName = this.cfgs[this.activeIdx]?.name;
		this.cfgs = (conf?.llm_configs ?? []).length ? (conf!.llm_configs as LlmConfigDoc[]) : [{} as LlmConfigDoc];
		let idx = 0;
		if (prevName) {
			const i = this.cfgs.findIndex((c) => c.name === prevName);
			if (i >= 0) idx = i;
		} else if (conf?.active_llm) {
			const i = this.cfgs.findIndex((c) => c.name === conf.active_llm);
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
				`提示词：助手身份+创作规范${sp.hasStory ? "+当前小说上下文" : ""}（约 ${Math.round(sp.text.length / 1000)}k 字）`,
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

	private addMessage(role: ChatTurn["role"], content: string): HTMLElement {
		const wrap = this.bodyEl.createDiv({ cls: `aw-chat-msg ${role === "user" ? "user" : "assistant"}` });
		wrap.createSpan({ cls: "aw-chat-role", text: role === "user" ? "我" : "助手" });
		const body = wrap.createDiv({ cls: "aw-chat-text" });
		body.textContent = content;
		this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
		return body;
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
		const hits = (q ? all.filter((p) => p.toLowerCase().includes(q)) : all).slice(0, 200);
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
		return this.history.map((t) => ({ role: t.role, content: t.content }));
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
		let sysContent = "";
		if (this.getSystemPrompt) {
			try {
				sysContent = (await this.getSystemPrompt())?.text ?? "";
			} catch (e) {
				this.setStatus(`警告：对话提示词加载失败（${e instanceof Error ? e.message : String(e)}），本轮按模型默认行为回答`, true);
			}
		}
		// 内联展开消息里的 @ 引用：token 原位替换为指定行的实际内容片段（历史/气泡/请求都用替换后文本，模型直接看到原文）
		const refs = await this.resolveRefs(text);
		if (refs.missing.length) this.setStatus(`引用文件不存在：${refs.missing.join("、")}`, true);
		console.debug("[articlewriter] 对话请求系统提示词", { length: sysContent.length, refs: refs.count }); // 排查提示词与引用是否注入
		this.history.push({ role: "user", content: refs.expanded }); // 历史/请求用展开后文本（模型看到实际内容）
		this.addMessage("user", text); // 气泡回显原始输入（保留 @ 引用标记，不显示替换结果）
		this.inputEl.value = "";
		this.hideRefPopup();
		this.setStatus(sysContent ? `正在回复（${cfg.name || "?"}）· 已注入创作规范提示词 …` : `正在回复（${cfg.name || "?"}）· 未携带提示词 …`);
		this.setBusy(true);
		this.ctrl = new AbortController();
		const el = this.addMessage("assistant", "");
		let full = "";
		let failed = false; // 出错/中断分支置 true：保留其状态文案；正常完成则清空回空闲态
		const messages: Message[] = sysContent ? [{ role: "system", content: sysContent }, ...this.buildMessages()] : this.buildMessages();
		try {
			full = await chatStream(cfg, messages, (d) => {
				full += d;
				el.textContent = full;
				this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
			}, undefined, this.ctrl.signal);
		} catch (e) {
			const aborted = !!this.ctrl && this.ctrl.signal.aborted;
			const msg = e instanceof Error ? e.message : String(e);
			if (aborted) {
				if (!full.trim()) el.parentElement?.remove(); // 空的中断轮次不留痕
				else { failed = true; this.setStatus("已停止生成"); }
			} else if (msg.includes("输出为空") || msg.includes("未返回内容")) {
				el.parentElement?.remove();
				{ failed = true; this.setStatus("模型未返回内容，请重试或检查服务状态", true); }
			} else {
				{ failed = true; this.setStatus(`请求失败：${msg}`, true); }
			}
		} finally {
			if (!failed) this.setStatus(""); // 正常完成回到空闲态（输入框占位提示重新可见）
			if (full.trim() && el.parentElement !== null) {
				this.history.push({ role: "assistant", content: full });
			}
			this.setBusy(false);
			void this.updateCtxLine(); // 每轮后同步小说/章节行与提示词来源（期间可能执行过写作命令）
			void this.updateSpLabel();
		}
	}

	private abort(): void {
		if (this.busy && this.ctrl) this.ctrl.abort();
	}

	private clearChat(): void {
		if (this.busy) return;
		this.history = [];
		this.bodyEl.empty();
		this.setStatus("对话已清空");
	}
}
