import { ItemView, Setting, WorkspaceLeaf } from "obsidian";

/** v0.2.x+ 生成计时：毫秒时长格式化——<60s →「42s」；≥60s →「3m 07s」（面板状态行/完成行与连续编写总用时共用） */
export function formatElapsedMs(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** LLM 写作命令流式预览的写入端契约（v0.1.4+ 统一生成面板实现；此前由 StreamingPreviewModal 承担）：
 * signal=中断信号 / fullText=当前累积全文 / done=finish() 后用户点「保存/不保存」resolve(keep)，中断或关面板 resolve(false)。
 * appendReasoning=思考型模型的思考增量（delta.reasoning_content），仅展示不落盘，避免正文未开始时面板看似卡死 */
export interface WritingStreamSink {
	readonly signal: AbortSignal;
	fullText: string;
	done: Promise<boolean>;
	append(delta: string): void;
	appendReasoning(delta: string): void;
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
	private reasoningEl?: HTMLElement; // 思考过程展示区（思考型模型；默认隐藏，首个思考增量到达时显示）
	private reasoningText = "";
	private statusEl?: HTMLElement;
	private footerEl?: HTMLElement;
	private streamEls: HTMLElement[] = []; // 当前流式小节创建的元素，下一轮 beginStream 时移除（日志行保留为历史）
	// ---- v0.2.x+ 生成计时 ----
	private streamStartedAt = 0; // 本轮流式会话起点（beginStream 记录；含空结果/格式校验重试与去AI味后处理，直到 finish/fail/finishAuto 收尾）
	private timer?: number; // 流式中每秒刷新状态行「已用时」的定时器（离开 streaming 态自停）
	private statusOverride = ""; // 临时状态文案（连接重试退避/去AI味等 setStatus 注入），非空时计时器不覆盖

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
		this.stopTimer();
		this.built = false; // contentEl 由框架清空 → 重开时重建 UI
	}

	/** v0.2.x+ 计时器：流式中每秒刷新状态行「已用时」；离开 streaming 态自停（收尾路径亦显式调用） */
	private startTimer(): void {
		this.stopTimer();
		this.timer = window.setInterval(() => {
			if (this.streamState !== "streaming") {
				this.stopTimer();
				return;
			}
			this.updateStatus();
		}, 1000);
	}

	private stopTimer(): void {
		if (this.timer != null) {
			window.clearInterval(this.timer);
			this.timer = undefined;
		}
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
		this.reasoningText = "";
		this.statusOverride = "";
		this.streamStartedAt = Date.now(); // v0.2.x+ 计时起点（含后续重试/去AI味，直到本轮收尾）
		this.startTimer();
		const head = this.bodyEl.createDiv({ cls: "aw-gen-line aw-gen-div", text: `—— ${this.stamp()} · ${title} ——` });
		this.reasoningEl = this.bodyEl.createDiv({ cls: "aw-stream-reasoning" });
		this.reasoningEl.addClass("hidden"); // 非思考模型无增量，保持隐藏（Obsidian 内置 .hidden 类，勿直接赋 style）
		this.preEl = this.bodyEl.createDiv({ cls: "aw-stream-pre" });
		this.statusEl = this.bodyEl.createDiv({ cls: "aw-dim aw-gen-status" });
		this.footerEl = this.bodyEl.createDiv({ cls: "aw-gen-footer" });
		this.streamEls.push(head, this.reasoningEl, this.preEl, this.statusEl, this.footerEl);
		new Setting(this.footerEl).addButton((b) => b.setButtonText("停止生成").onClick(() => this.abortStream()));
		this.updateStatus();
		this.scrollBottom();
	}

	append(delta: string): void {
		if (this.submitted || this.streamState !== "streaming") return;
		this.statusOverride = ""; // v0.2.x+ 真实输出已恢复 → 清除临时态（重试退避等），恢复带计时的状态行
		this.fullText += delta;
		if (this.preEl) this.preEl.textContent = this.fullText;
		this.updateStatus();
		this.scrollBottom();
	}

	/** 思考增量（delta.reasoning_content）：仅展示不落盘；正文开始后思考区保留为诊断参考 */
	appendReasoning(delta: string): void {
		if (this.submitted || this.streamState !== "streaming") return;
		this.statusOverride = ""; // v0.2.x+ 同 append：思考增量到达即视为输出恢复
		this.reasoningText += delta;
		if (this.reasoningEl) {
			this.reasoningEl.removeClass("hidden");
			this.reasoningEl.textContent = this.reasoningText;
		}
		this.updateStatus();
		this.scrollBottom();
	}

	reset(): void {
		if (!this.submitted && this.streamState === "streaming") {
			this.fullText = "";
			if (this.preEl) this.preEl.textContent = "";
			this.reasoningText = "";
			if (this.reasoningEl) this.reasoningEl.textContent = "";
			this.setStatus("");
			this.updateStatus();
		}
	}

	setStatus(text: string): void {
		// v0.2.x+ 非空文案视为临时状态（连接重试退避/去AI味等），计时器 tick 不覆盖；空串=清除临时态恢复计时文案
		this.statusOverride = text;
		if (this.statusEl) this.statusEl.setText(text);
	}

	finish(): void {
		if (this.submitted || this.streamState !== "streaming") return;
		this.streamState = "done";
		this.statusOverride = ""; // v0.2.x+ 清除「正在去除 AI 常用词…」等临时态，完成行显示总用时
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
		this.stopTimer(); // v0.2.x+ 失败收尾，计时定格
		if (this.statusEl) {
			this.statusEl.setText(`生成失败：${message}（用时 ${formatElapsedMs(Date.now() - this.streamStartedAt)}）`);
			this.statusEl.classList.remove("aw-dim");
		}
		if (this.footerEl) this.footerEl.empty();
		new Setting(this.footerEl!).addButton((b) => b.setButtonText("关闭").onClick(() => this.end(false)));
		this.scrollBottom();
	}

	/** v0.2.10+「连续编写」自动保存收尾：等价于点「保存」（resolve done(true)、正文保留展示、按钮区换结果行），无需用户确认；仅在流式进行中生效。
	 * v0.2.x+ 结果行附本轮用时（beginStream→此刻，含格式重试与去AI味后处理）；elapsedLabel 自定义用时前缀（默认「本章用时」，卷大纲增量落盘用「段落用时」） */
	finishAuto(message?: string, elapsedLabel = "本章用时"): void {
		if (this.submitted || this.streamState !== "streaming") return;
		this.submitted = true;
		this.resolveDone?.(true);
		this.streamState = "idle";
		this.stopTimer();
		if (this.footerEl) this.footerEl.empty();
		this.appendLine(`${message ?? "✓ 已自动保存"}（${elapsedLabel} ${formatElapsedMs(Date.now() - this.streamStartedAt)}）`, "ok");
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
		if (this.statusOverride) return; // v0.2.x+ 临时状态优先（重试退避/去AI味等），计时器 tick 不覆盖
		const elapsed = `已用时 ${formatElapsedMs(Date.now() - this.streamStartedAt)}`; // v0.2.x+ 生成计时
		if (this.streamState === "streaming") {
			if (this.fullText.trim()) this.statusEl.setText(`生成中…（已 ${String(this.fullText.length)} 字，${elapsed}，Esc/停止可中断）`);
			else if (this.reasoningText.trim()) this.statusEl.setText(`模型思考中…（思考已 ${String(this.reasoningText.length)} 字，正文未开始，${elapsed}，Esc/停止可中断）`);
			else this.statusEl.setText(`等待模型输出…（${elapsed}）`);
		} else if (this.streamState === "done") this.statusEl.setText(`完成（共 ${String(this.fullText.length)} 字，${elapsed}），请选择是否保存。`);
	}

	private scrollBottom(): void {
		this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
	}
}
