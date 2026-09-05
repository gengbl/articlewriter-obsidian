import { ItemView, Setting, WorkspaceLeaf } from "obsidian";

/** LLM 写作命令流式预览的写入端契约（v0.1.4+ 统一生成面板实现；此前由 StreamingPreviewModal 承担）：
 * signal=中断信号 / fullText=当前累积全文 / done=finish() 后用户点「保存/不保存」resolve(keep)，中断或关面板 resolve(false) */
export interface WritingStreamSink {
	readonly signal: AbortSignal;
	fullText: string;
	done: Promise<boolean>;
	append(delta: string): void;
	reset(): void;
	setStatus(text: string): void;
	finish(): void;
	fail(message: string): void;
}

/** 统一生成过程面板（自定义 ItemView，可停靠任意区域、重载保留位置）。双阶段复用同一实例：
 * ① 摘要延迟生成日志阶段——main.ts notifyGenProgress 驱动，每个 LLM 任务一行带时间戳的工作日志实时追加并自动滚底；
 * ② 章节正文/报告流式阶段——beginStream(title) 进入，实现 WritingStreamSink 契约（原独立 StreamingPreviewModal 的全部语义并入此处），
 *    先展示摘要生成过程、完成后在同一面板内继续流式展示章节生成过程与「保存/不保存」决定。Esc=停止生成（等同放弃） */
export class GenProgressView extends ItemView implements WritingStreamSink {
	static readonly VIEW_TYPE = "articlewriter-gen-progress";

	private built = false;
	private bodyEl!: HTMLElement;
	/** 本轮是否已开始（main.ts 侧同步维护；用于区分「新一轮首条」与「同轮后续消息」） */
	runOpen = false;

	// ---- 流式会话状态（对齐原 StreamingPreviewModal 语义）----
	private ctrl = new AbortController();
	private submitted = false;
	private streamState: "idle" | "streaming" | "done" | "failed" = "idle";
	fullText = "";
	done: Promise<boolean> = new Promise(() => {}); // beginStream 前占位；每次 beginStream 换新 Promise
	private resolveDone!: (keep: boolean) => void;
	private preEl?: HTMLElement;
	private statusEl?: HTMLElement;
	private footerEl?: HTMLElement;
	private streamEls: HTMLElement[] = []; // 当前流式小节创建的元素，下一轮 beginStream 时移除（日志行保留为历史）

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return GenProgressView.VIEW_TYPE;
	}

	getDisplayText(): string {
		return "生成过程";
	}

	getIcon(): string {
		return "loader";
	}

	async onOpen(): Promise<void> {
		if (!this.built) this.buildUI(this.contentEl);
	}

	async onClose(): Promise<void> {
		// 关面板=中断未决的流式会话并视为放弃（对齐原 Modal onClose→abort+resolve(false)）
		if (this.streamState !== "idle" && !this.submitted) {
			this.submitted = true;
			this.ctrl.abort();
			this.resolveDone?.(false);
		}
		this.built = false; // contentEl 由框架清空 → 重开时重建 UI
	}

	private buildUI(parent: HTMLElement): void {
		this.built = true;
		const root = parent.createDiv({ cls: "aw-gen-view" });
		root.createDiv({ text: "生成过程", cls: "aw-gen-title" });
		this.bodyEl = root.createDiv({ cls: "aw-gen-body" });
		// Esc=停止当前流式生成（仅流式中且未提交决定时生效；视图卸载自动解绑）
		this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
			if (e.key === "Escape") this.abortStream();
		});
	}

	/** 新一轮摘要阶段开始：清空旧内容并写入分隔行 */
	startRun(storyName?: string): void {
		this.runOpen = true;
		this.bodyEl.empty();
		this.appendLine(`—— ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}${storyName ? ` · ${storyName}` : ""} ——`, "div");
	}

	/** 追加一行工作日志（kind=step 普通步骤带时间戳 / ok 完成行带时间戳 / div 轮次分隔行原样显示）；自动滚到底部 */
	appendLine(text: string, kind: "step" | "ok" | "div" = "step"): void {
		this.bodyEl.createDiv({ cls: `aw-gen-line aw-gen-${kind}`, text: kind === "div" ? text : `${this.stamp()} ${text}` });
		this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
	}

	/** 摘要阶段结束：追加分隔完成行（随后 main.ts beginWritingPanel→beginStream 在同一面板继续流式章节正文） */
	finishRun(): void {
		this.runOpen = false;
		this.appendLine("✓ 摘要就绪，开始生成…", "ok");
	}

	private stamp(): string {
		return new Date().toLocaleTimeString("zh-CN", { hour12: false });
	}

	// ---- 流式阶段（WritingStreamSink 实现）----

	get signal(): AbortSignal {
		return this.ctrl.signal;
	}

	/** 进入流式小节：未决的上一会话先按「中断放弃」收尾；移除上轮的正文/状态/按钮元素（日志行保留），新建本轮三件套 */
	beginStream(title: string): void {
		if (this.streamState !== "idle" && !this.submitted) {
			this.submitted = true;
			this.ctrl.abort();
			this.resolveDone?.(false);
		}
		for (const el of this.streamEls) el.remove();
		this.streamEls = [];
		this.fullText = "";
		this.submitted = false;
		this.ctrl = new AbortController();
		this.done = new Promise<boolean>((res) => (this.resolveDone = res));
		this.streamState = "streaming";
		const head = this.bodyEl.createDiv({ cls: "aw-gen-line aw-gen-div", text: `—— ${this.stamp()} · ${title} ——` });
		this.preEl = this.bodyEl.createDiv({ cls: "aw-stream-pre" });
		this.statusEl = this.bodyEl.createDiv({ cls: "aw-dim aw-gen-status" });
		this.footerEl = this.bodyEl.createDiv({ cls: "aw-gen-footer" });
		this.streamEls.push(head, this.preEl, this.statusEl, this.footerEl);
		new Setting(this.footerEl).addButton((b) => b.setButtonText("停止生成").onClick(() => this.abortStream()));
		this.updateStatus();
		this.scrollBottom();
	}

	append(delta: string): void {
		if (this.submitted || this.streamState !== "streaming") return;
		this.fullText += delta;
		if (this.preEl) this.preEl.textContent = this.fullText;
		this.updateStatus();
		this.scrollBottom();
	}

	reset(): void {
		if (!this.submitted && this.streamState === "streaming") {
			this.fullText = "";
			if (this.preEl) this.preEl.textContent = "";
			this.setStatus("");
			this.updateStatus();
		}
	}

	setStatus(text: string): void {
		if (this.statusEl) this.statusEl.setText(text);
	}

	finish(): void {
		if (this.submitted || this.streamState !== "streaming") return;
		this.streamState = "done";
		this.updateStatus();
		if (this.footerEl) this.footerEl.empty();
		new Setting(this.footerEl!).addButton(
			(b) => b.setButtonText("保存").setCta().onClick(() => this.end(true))
		).addButton((b) => b.setButtonText("不保存").onClick(() => this.end(false)));
		this.scrollBottom();
	}

	fail(message: string): void {
		if (this.submitted || this.streamState === "failed") return;
		this.streamState = "failed";
		if (this.statusEl) {
			this.statusEl.setText(`生成失败：${message}`);
			this.statusEl.classList.remove("aw-dim");
		}
		if (this.footerEl) this.footerEl.empty();
		new Setting(this.footerEl!).addButton((b) => b.setButtonText("关闭").onClick(() => this.end(false)));
		this.scrollBottom();
	}

	private abortStream(): void {
		if (!this.submitted && this.streamState === "streaming") this.ctrl.abort();
	}

	/** 会话收尾（保存/放弃/失败关闭）：resolve done，正文保留展示，按钮区换成结果行 */
	private end(keep: boolean): void {
		if (this.submitted || this.streamState === "idle") return;
		this.submitted = true;
		this.resolveDone?.(keep);
		this.streamState = "idle";
		if (this.footerEl) this.footerEl.empty();
		this.appendLine(keep ? "✓ 已保存" : "— 未保存 —", keep ? "ok" : "div");
	}

	private updateStatus(): void {
		if (!this.statusEl) return;
		if (this.streamState === "streaming")
			this.statusEl.setText(this.fullText.trim() ? `生成中…（已 ${String(this.fullText.length)} 字，Esc/停止可中断）` : "等待模型输出…");
		else if (this.streamState === "done") this.statusEl.setText(`完成（共 ${String(this.fullText.length)} 字），请选择是否保存。`);
	}

	private scrollBottom(): void {
		this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
	}
}
