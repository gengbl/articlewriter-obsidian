import { App, Component, MarkdownRenderer, Modal, SuggestModal, Setting, TFolder } from "obsidian";

/** 单行文本输入框；提交回调收到值（空串视为取消） */
export class TextInputModal extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private placeholderText: string,
		private onSubmit: (value: string) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		new Setting(this.contentEl).addText((text) => {
			text.setPlaceholder(this.placeholderText);
			text.inputEl.focus();
			text.inputEl.addEventListener("keydown", async (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					const value = text.inputEl.value.trim();
					this.submitted = true;
					this.close();
					await this.onSubmit(value);
				} else if (e.key === "Escape") {
					this.close(); // onClose 触发 onCancel
				}
			});
		});
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** 新书创建：标题 / 题材类型 / 编写类型（对齐 Python /new 三项询问） */
export interface NewStoryInput {
	title: string;
	genre: string;
	style: string;
}

const PRESET_STYLES = ["网文小说", "剧本", "普通小说", "散文随笔"];

export class NewStoryModal extends Modal {
	private submitted = false;

	constructor(app: App, private onSubmit: (input: NewStoryInput) => void | Promise<void>, private onCancel?: () => void) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "创建新小说" });
		let title = "";
		let genre = "网文小说";
		let style = "网文小说";

		new Setting(this.contentEl).setName("标题").addText((text) => {
			text.setPlaceholder("书名");
			text.onChange((v) => (title = v));
			text.inputEl.focus();
		});
		new Setting(this.contentEl).setName("题材类型").addText((text) => {
			text.setValue(genre);
			text.onChange((v) => (genre = v));
		});
		new Setting(this.contentEl)
			.setName("编写类型")
			.addDropdown((drop) => {
				for (const s of PRESET_STYLES) drop.addOption(s, s);
				drop.setValue(style).onChange((v) => (style = v));
			})
			.addText((text) => {
				text.setPlaceholder("或输入自定义类型名");
				text.onChange((v) => (style = v || style));
			});

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("创建").setCta().onClick(async () => {
				if (!title.trim()) return;
				this.submitted = true;
				this.close();
				await this.onSubmit({ title: title.trim(), genre: genre.trim() || "网文小说", style: style.trim() || "网文小说" });
			})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

/** 章节列表（点击打开正文，对齐 /chapter list + /open） */
export interface ChapterItem {
	num: number;
	title: string;
	path: string; // 章节目录路径
	isCurrent: boolean;
}

export class ChapterListModal extends SuggestModal<ChapterItem> {
	constructor(app: App, private items: ChapterItem[], private onOpenBody: (item: ChapterItem) => void | Promise<void>) {
		super(app);
		this.inputEl.placeholder = "选择章节打开正文…";
	}

	getSuggestions(): ChapterItem[] {
		return this.items;
	}

	renderSuggestion(item: ChapterItem, el: HTMLElement): void {
		el.createSpan({ text: `第${String(item.num).padStart(2, "0")}章 ${item.title}` });
		if (item.isCurrent) el.createSpan({ text: "　（当前）", cls: "aw-dim" });
	}

	async onChooseSuggestion(item: ChapterItem): Promise<void> {
		await this.onOpenBody(item);
	}
}

// ---------- work_dir 文件夹选择器 ----------

function collectFolders(app: App): string[] {
	const result: string[] = [];
	const walk = (folder: TFolder, depth: number) => {
		if (depth > 3 || result.length >= 500) return;
		for (const child of folder.children) {
			if (!(child instanceof TFolder)) continue;
			if (child.name.startsWith(".")) continue; // .obsidian 等隐藏目录
			result.push(child.path);
			walk(child, depth + 1);
		}
	};
	walk(app.vault.getRoot(), 0);
	return result.sort((a, b) => a.localeCompare(b, "zh"));
}

/** 选择 vault 内已有文件夹作为工作目录（work_dir）；留空输入=vault 根 */
export class FolderPickerModal extends SuggestModal<string> {
	private submitted = false;

	constructor(app: App, private onPick: (path: string) => void | Promise<void>, private onCancel?: () => void) {
		super(app);
		this.inputEl.placeholder = "选择写小说的文件夹（work_dir），支持模糊搜索…";
	}

	getSuggestions(query: string): string[] {
		const all = collectFolders(this.app);
		if (!query.trim()) return all;
		const q = query.trim().toLowerCase();
		return all.filter((p) => p.toLowerCase().includes(q));
	}

	renderSuggestion(path: string, el: HTMLElement): void {
		el.setText(path);
	}

	override onClose(): void {
		super.onClose();
		if (!this.submitted && this.onCancel) this.onCancel();
	}

	async onChooseSuggestion(path: string): Promise<void> {
		this.submitted = true;
		this.close();
		await this.onPick(path);
	}
}

/** 多小说选择器 */
export class StoryPickerModal extends SuggestModal<string> {
	private submitted = false;

	constructor(app: App, private stories: string[], private onPick: (name: string) => void | Promise<void>, private onCancel?: () => void) {
		super(app);
		this.inputEl.placeholder = "选择要操作的小说…";
	}

	getSuggestions(): string[] {
		return this.stories;
	}

	renderSuggestion(name: string, el: HTMLElement): void {
		el.setText(name);
	}

	override onClose(): void {
		super.onClose();
		if (!this.submitted && this.onCancel) this.onCancel();
	}

	async onChooseSuggestion(name: string): Promise<void> {
		this.submitted = true;
		this.close();
		await this.onPick(name);
	}
}

// ---------- 通用操作菜单（卷/场景/角色/伏笔等管理入口）----------

export interface ActionItem {
	label: string;
	sub?: string;
	marker?: string; // 如 "◀ 当前"
	disabled?: boolean;
}

/** 可点击的动作列表；回车选择高亮项，Esc 取消 */
export class ActionMenuModal extends Modal {
	private submitted = false;
	private selected = 0;

	constructor(
		app: App,
		private title: string,
		private items: ActionItem[],
		private onSelect: (index: number) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		const list = this.contentEl.createDiv({ cls: "aw-action-list" });
		list.style.maxHeight = "60vh";
		list.style.overflowY = "auto";
		this.renderList(list);
		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("确认").setCta().onClick(() => this.choose())
		);
		this.contentEl.addEventListener("keydown", async (e) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				this.selected = Math.min(this.selected + 1, this.enabledCount() - 1);
				this.refreshHighlight();
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				this.selected = Math.max(this.selected - 1, 0);
				this.refreshHighlight();
			} else if (e.key === "Enter") {
				e.preventDefault();
				await this.choose();
			} else if (e.key === "Escape") {
				this.close();
			}
		});
	}

	private enabledCount(): number {
		return this.items.filter((i) => !i.disabled).length;
	}

	private renderList(list: HTMLElement): void {
		list.empty();
		this.items.forEach((item, i) => {
			const row = list.createDiv({ cls: `aw-action-row${i === this.selected ? " aw-selected" : ""}` });
			row.style.cursor = item.disabled ? "default" : "pointer";
			if (item.marker) row.createSpan({ text: `${item.marker} `, cls: "aw-accent" });
			row.createSpan({ text: item.label });
			if (item.sub) row.createSpan({ text: `　${item.sub}`, cls: "aw-dim" });
			if (!item.disabled) {
				row.addEventListener("click", async () => {
					this.selected = i;
					await this.choose();
				});
			}
		});
	}

	private refreshHighlight(): void {
		const rows = Array.from(this.contentEl.querySelectorAll<HTMLElement>(".aw-action-row"));
		rows.forEach((r, i) => r.classList.toggle("aw-selected", i === this.selected));
	}

	private async choose(): Promise<void> {
		const item = this.items[this.selected];
		if (!item || item.disabled) return;
		this.submitted = true;
		this.close();
		await this.onSelect(this.selected);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- 多行文本输入（场景正文/世界观历史/大纲追加等）----------

export class TextAreaPrompt extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private placeholderText: string,
		private initialValue: string,
		private submitLabel: string,
		private onSubmit: (value: string) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		let value = this.initialValue ?? "";
		const ta = this.contentEl.createEl("textarea") as HTMLTextAreaElement;
		ta.placeholder = this.placeholderText;
		ta.value = this.initialValue ?? "";
		ta.style.width = "100%";
		ta.style.minHeight = "240px";
		ta.focus();
		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText(this.submitLabel || "保存").setCta().onClick(async () => {
				value = ta.value.trim();
				this.submitted = true;
				this.close();
				await this.onSubmit(value);
			})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- 只读文本面板（show 类命令：世界观/伏笔列表/角色详情等）----------

export interface PanelLine {
	text: string;
	cls?: string; // "aw-dim" / "aw-accent"
	bold?: boolean;
}

/** 展示多行预格式化文本；点击任意处或 Esc 关闭 */
export class TextPanelModal extends Modal {
	constructor(app: App, private title: string, private lines: Array<string | PanelLine>) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		const body = this.contentEl.createDiv();
		body.style.maxHeight = "65vh";
		body.style.overflowY = "auto";
		for (const line of this.lines) {
			const item: PanelLine = typeof line === "string" ? { text: line } : line;
			if (!item.text.trim()) {
				body.append("\n");
				continue;
			}
			const el = body.createEl(item.bold ? "p" : "div", { cls: item.cls });
			el.setText(item.text);
			if (item.bold) el.style.fontWeight = "bold";
		}
		this.contentEl.createDiv({ text: "（Esc 或点击关闭）", cls: "aw-dim" }).style.marginTop = "8px";
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ---------- 多字段表单（角色/场景等录入）----------

export interface FieldDef {
	key: string;
	label: string;
	placeholder?: string;
}

/** 多个单行文本字段的表单；提交回调收到 {key: value} */
export class MultiFieldModal extends Modal {
	private submitted = false;

	constructor(
		app: App,
		private title: string,
		private fields: FieldDef[],
		private submitLabel: string,
		private onSubmit: (values: Record<string, string>) => void | Promise<void>,
		private onCancel?: () => void,
		private initialValues?: Record<string, string>
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		const values: Record<string, string> = {};
		for (const field of this.fields) {
			new Setting(this.contentEl).setName(field.label).addText((text) => {
				if (field.placeholder) text.setPlaceholder(field.placeholder);
				if (this.initialValues?.[field.key]) text.setValue(this.initialValues[field.key]);
				text.onChange((v) => (values[field.key] = v.trim()));
			});
		}
		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText(this.submitLabel || "保存").setCta().onClick(async () => {
				this.submitted = true;
				this.close();
				await this.onSubmit(values);
			})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted && this.onCancel) this.onCancel();
	}
}

// ---------- 确认框（删除等危险操作）----------

export class ConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private title: string,
		private message: string,
		private confirmLabel?: string,
		private onConfirm?: () => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: this.title });
		const p = this.contentEl.createEl("p");
		p.setText(this.message);
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText(this.confirmLabel || "确认").setCta().onClick(() => this.do(true)))
			.addButton((btn) => btn.setButtonText("取消").onClick(() => this.do(false)));
	}

	private async do(ok: boolean): Promise<void> {
		this.resolved = true;
		this.close();
		if (ok && this.onConfirm) await this.onConfirm();
		else if (!ok && this.onCancel) this.onCancel();
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.resolved && this.onCancel) this.onCancel(); // Esc / 关闭按钮：视为取消
	}
}

// ---------- LLM 流式生成预览（打字机效果 + 停止/保存/放弃）----------

/**
 * LLM 写作命令的流式预览窗：append() 逐块追加并自动滚底；finish() 后出现「保存/不保存」，
 * fail(msg) 保留已生成内容与错误提示。Esc / 「停止生成」 = abort（signal 传给 chatStream），done 以 false 结束。
 */
export class StreamingPreviewModal extends Modal {
	private ctrl = new AbortController();
	private submitted = false;
	private state: "streaming" | "done" | "failed" = "streaming";
	fullText = "";
	done: Promise<boolean>;
	private resolveDone!: (keep: boolean) => void;
	private bodyEl!: HTMLElement;
	private preEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private footerEl!: HTMLElement;

	constructor(app: App, private title: string) {
		super(app);
		this.done = new Promise((res) => (this.resolveDone = res));
	}

	get signal(): AbortSignal {
		return this.ctrl.signal;
	}

	onOpen(): void {
		this.modalEl.style.width = "min(720px, 90vw)";
		this.contentEl.createEl("h3", { text: this.title });
		const body = this.contentEl.createDiv({ cls: "aw-stream-body" });
		body.style.maxHeight = "65vh";
		body.style.overflowY = "auto";
		this.bodyEl = body;
		this.preEl = body.createEl("div");
		this.preEl.style.whiteSpace = "pre-wrap";
		this.statusEl = this.contentEl.createDiv({ cls: "aw-dim" });
		this.footerEl = this.contentEl.createDiv({ cls: "aw-stream-footer" });
		new Setting(this.footerEl).addButton((btn) => btn.setButtonText("停止生成").onClick(() => this.abort()));
		this.updateStatus();
	}

	append(delta: string): void {
		if (this.state !== "streaming") return;
		this.fullText += delta;
		this.preEl.textContent = this.fullText;
		this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
		this.updateStatus();
	}

	/** 重试前清空已显示内容（仅流式进行中可用；abort 与重置互斥，无需重建 AbortController） */
	reset(): void {
		if (this.submitted || this.state !== "streaming") return;
		this.fullText = "";
		this.preEl.textContent = "";
		this.updateStatus();
	}

	/** 更新进度提示文案（如「正在去AI味…」），不改变状态机 */
	setStatus(text: string): void {
		this.statusEl.setText(text);
	}

	finish(): void {
		if (this.state !== "streaming") return;
		this.state = "done";
		this.updateStatus();
		this.footerEl.empty();
		const s = new Setting(this.footerEl);
		s.addButton((b) => b.setButtonText("保存").setCta().onClick(() => this.end(true)));
		s.addButton((b) => b.setButtonText("不保存").onClick(() => this.end(false)));
	}

	fail(message: string): void {
		if (this.state === "failed") return;
		this.state = "failed";
		this.statusEl.setText(`生成失败：${message}`);
		this.statusEl.classList.remove("aw-dim");
		this.footerEl.empty();
		new Setting(this.footerEl).addButton((b) => b.setButtonText("关闭").onClick(() => this.end(false)));
	}

	private updateStatus(): void {
		if (this.state === "streaming") this.statusEl.setText(`生成中…（已 ${this.fullText.length} 字，Esc/停止可中断）`);
		else if (this.state === "done") this.statusEl.setText(`完成（共 ${this.fullText.length} 字），请选择是否保存。`);
	}

	private abort(): void {
		if (this.state !== "streaming" || this.submitted) return;
		this.ctrl.abort();
		this.end(false);
	}

	private end(keep: boolean): void {
		if (this.submitted) return;
		this.submitted = true;
		this.close();
		this.resolveDone(keep);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.submitted) {
			this.submitted = true;
			this.ctrl.abort(); // Esc / 关闭按钮：视为放弃并中断请求
			this.resolveDone(false);
		}
	}
}

// LLM 多轮对话窗已改为常驻 ItemView（src/llm_chat_view.ts），不再使用 Modal。

/** 只读 Markdown 展示面板（用于无 vault 文件载体的内容，如系统级创作规范） */
export class MarkdownViewerModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private markdown: string,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.title });
		const body = contentEl.createDiv({ cls: "aw-md-viewer" });
		void MarkdownRenderer.render(this.app, this.markdown, body, "", new Component()); // 本地 dts 中 Modal 非 Component，用独立组件承载渲染清理
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
