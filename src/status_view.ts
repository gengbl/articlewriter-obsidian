import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { formatLocalDateTime } from "./story_types";

/** 状态页数据快照（main.ts 非交互读取构建；只含展示字段与 vault 相对路径） */
export interface StatusFileEntry {
	path: string;
	name: string;
}
export interface StatusChapterEntry {
	num: number;
	title: string;
	words: number;
	active: boolean;
	files: StatusFileEntry[];
}
export interface StatusDetail {
	storyName: string;
	title: string;
	genre: string;
	writingStyle: string;
	currentChapter: number | null;
	totalWords: number;
	updatedAt: string;
	chapters: StatusChapterEntry[];
	globalFiles: StatusFileEntry[];
}
export interface StatusStoryEntry {
	name: string;
	title: string;
	chapterCount: number;
	currentChapter: number | null;
	words: number;
	active: boolean;
}
export interface StatusSnapshot {
	workDir: string;
	stories: StatusStoryEntry[];
	/** 每本书的详情（章节/文件树），供任意小说行展开时渲染；构建失败的书缺省 */
	details: Record<string, StatusDetail>;
}

/** 状态页右键快捷菜单触发的写操作（由 main.ts handleStatusAction 执行，语义与对应命令一致） */
export type StatusAction =
	| { kind: "new-story" }
	| { kind: "delete-story"; name: string }
	| { kind: "new-chapter"; story: string }
	| { kind: "rename-chapter"; story: string; num: number } // 改写章名：重命名目录并同步文档引用（对齐 /chapter rename）
	| { kind: "delete-chapter"; story: string; num: number }
	| { kind: "new-file"; story: string; num: number | null } // num=null → 书根目录；否则该章节目录
	| { kind: "delete-file"; path: string }
	| { kind: "llm-write" | "llm-continue" | "llm-polish"; story: string; num: number }; // 章节行右键调用 LLM 写作命令（先激活该书/章，再走对应命令交互流程）

/**
 * 工作状态面板（自定义 ItemView，可停靠任意区域、重载保留位置）：
 * 显示工作目录、全部小说列表（点击切换当前小说）、当前小说的运行状态（题材/编写类型/总字数/更新时间），
 * 章节列表（点击激活该章并同步所属卷）与各文件（点击在编辑器中打开）。
 * 数据经构造注入的 getter 实时读取；写操作（切书/切章）由 main.ts 回盘后刷新本视图。
 */
export class StatusView extends ItemView {
	static readonly VIEW_TYPE = "articlewriter-status";

	private getData: () => Promise<StatusSnapshot>;
	private onSwitchStory: (name: string) => Promise<void>;
	private onActivateChapter: (storyName: string, num: number) => Promise<number>;
	private onAction: (a: StatusAction) => Promise<void>;
	private built = false;
	private rootEl!: HTMLElement;
	/** 固定头部区（工作目录行 + 小说状态 + 书籍列表标题行含下拉框）：不随滚动移动 */
	private topEl!: HTMLElement;
	/** 可滚动树主体区（全局文档 / 章节小节）：仅此区域内部滚动 */
	private treeEl!: HTMLElement;
	private busy = false;
	/** 折叠状态（会话内保持，不落盘；各书小节/章节键均带书名前缀互不连动）：collapsed 键="stories"/"gdocs:<书名>"/"chapters:<书名>"（分组标题收起态），expanded 键="c:<书名>:<章号>"（章节文件列表，默认折叠）。小说切换只走「书籍列表」标题行下拉框，组内仅渲染当前激活小说的小节 */
	private collapsed = new Set<string>();
	private expanded = new Set<string>();
	private menuEl: HTMLElement | null = null;
	private docMouseHandler = (e: Event): void => {
		if (this.menuEl && !this.menuEl.contains(e.target as Node)) this.closeMenu();
	};
	private escKeyHandler = (e: KeyboardEvent): void => {
		if (e.key === "Escape") this.closeMenu();
	};

	constructor(leaf: WorkspaceLeaf, getData: () => Promise<StatusSnapshot>, onSwitchStory: (name: string) => Promise<void>, onActivateChapter: (storyName: string, num: number) => Promise<number>, onAction: (a: StatusAction) => Promise<void>) {
		super(leaf);
		this.getData = getData;
		this.onSwitchStory = onSwitchStory;
		this.onActivateChapter = onActivateChapter;
		this.onAction = onAction;
	}

	getViewType(): string {
		return StatusView.VIEW_TYPE;
	}

	getDisplayText(): string {
		return "工作状态";
	}

	getIcon(): string {
		return "book-open";
	}

	async onOpen(): Promise<void> {
		if (!this.built) this.buildUI(this.contentEl);
		void this.refresh();
	}

	async onClose(): Promise<void> {
		this.closeMenu();
	}

	private buildUI(parent: HTMLElement): void {
		this.built = true;
		this.rootEl = parent.createDiv({ cls: "aw-status-view" }); // 「刷新」按钮随工作目录行在 render() 中创建
		this.topEl = this.rootEl.createDiv({ cls: "aw-st-top" }); // 固定头部：工作目录行 / 小说状态 / 书籍列表标题行（含下拉框）
		this.treeEl = this.rootEl.createDiv({ cls: "aw-st-tree" }); // 滚动主体：全局文档 / 章节树，仅此区域内部滚动
		// 小说级及以上的兜底菜单（面板空白处、无专属右键的区域）：仅「新建小说…」；删除只出现在被点中的具体条目上，各下层区域有自己的菜单并 stopPropagation
		this.rootEl.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.showContextMenu(e, [{ label: "新建小说…", run: () => this.runStatusAction({ kind: "new-story" }) }]);
		});
	}

	/** 某目录下「新建」类右键项（标签不带位置提示；文章级与章节级之间用横线隔开；不含任何删除——删除只挂在被点中的条目自身） */
	private createItems(story: string, num: number | null): Array<{ label: string; run: () => void } | { sep: true }> {
		return [
			{ label: "新建文章…", run: () => this.runStatusAction({ kind: "new-file", story, num }) },
			{ sep: true },
			{ label: "新建章节…", run: () => this.runStatusAction({ kind: "new-chapter", story }) },
		];
	}

	/** 重新拉取快照并重渲染；「刷新」按钮与插件侧的文件变更防抖（写作落盘后字数实时跟进）都会调到这里 */
	async refresh(): Promise<void> {
		if (this.busy || !this.built) return;
		this.busy = true;
		try {
			const snap = await this.getData();
			this.render(snap);
		} catch (e) {
			this.topEl.empty();
			this.treeEl.empty();
			this.topEl.createDiv({ text: `加载失败：${e instanceof Error ? e.message : String(e)}`, cls: "aw-st-error" });
		} finally {
			this.busy = false;
		}
	}

	private render(snap: StatusSnapshot): void {
		const savedScroll = this.treeEl.scrollTop; // 自动刷新重渲染后恢复树区滚动位置，不打断用户浏览
		this.topEl.empty(); // 固定头部与工作目录行、小说状态、书籍列表标题行（含下拉框）
		this.treeEl.empty(); // 滚动主体与全局文档 / 章节树
		// 工作目录行常驻（未设置/无小说时也保留，路径缺省显「-」），右侧「刷新」按钮始终可用；异常状态提示统一放在该行下方
		const wd = this.topEl.createDiv({ cls: "aw-st-workdir" });
		wd.createSpan({ text: "工作目录：", cls: "aw-st-wd-label" });
		wd.createSpan({ text: snap.workDir || "-", cls: "aw-st-wd-path" + (snap.workDir ? "" : " aw-dim") });
		const btns = wd.createSpan({ cls: "aw-st-actions" });
		btns.createEl("button", { text: "刷新" }).addEventListener("click", () => void this.refresh());
		if (!snap.workDir) {
			this.topEl.createDiv({ text: "未设置工作目录：请先执行「选择工作目录」命令。", cls: "aw-dim aw-st-hint" });
			this.treeEl.scrollTop = savedScroll;
			return;
		}

		// 「小说状态」区：仅展示当前激活书的概要信息行，与工作目录行、小说列表各以横线分隔；切书后随刷新更新
		const active = snap.stories.find((s) => s.active);
		const ad = active ? snap.details[active.name] : undefined;
		const statBox = this.topEl.createDiv({ cls: "aw-st-status" });
		if (!ad) {
			statBox.createDiv({ text: active ? `未能加载「${active.title}」的状态` : "暂无当前小说：用下方「书籍列表」标题行右侧的下拉框选择激活。", cls: "aw-dim aw-st-hint" });
		} else {
			this.renderStatusLines(statBox, ad);
		}

		// 「书籍列表」分组：标题行右侧下拉框占满剩余空间，选择即激活该小说；组内只展示当前激活小说的「全局文档/章节」两个小节（不再枚举全部书名树）
		const headItems = (): Array<{ label: string; danger?: boolean; run: () => void } | { sep: true }> => {
			const arr: Array<{ label: string; danger?: boolean; run: () => void } | { sep: true }> = [
				{ label: "新建小说…", run: () => this.runStatusAction({ kind: "new-story" }) },
			];
			if (active) {
				arr.push({ sep: true }, { label: `删除小说「${active.name}」`, danger: true, run: () => this.runStatusAction({ kind: "delete-story", name: active.name }) });
			}
			return arr;
		};
		const storyBody = this.sectionHead(this.topEl, `书籍列表（${String(snap.stories.length)}）`, "stories", (e) => this.showContextMenu(e, headItems()), (head) => {
			if (!snap.stories.length) return;
			const sel = head.createEl("select", { cls: "aw-st-select" }); // 下拉框占满标题行剩余空间，选择即激活该小说（已选中项再选不重复切换）
			for (const s of snap.stories) {
				const o = sel.createEl("option");
				o.setText(s.title);
				o.value = s.name;
				if (s.active) o.selected = true;
			}
			sel.addEventListener("click", (e) => e.stopPropagation()); // 操作下拉框不触发分组折叠/展开与右键菜单
			sel.addEventListener("contextmenu", (e) => e.stopPropagation());
			sel.addEventListener("change", () => {
				const name = sel.value;
				const cur = snap.stories.find((x) => x.active)?.name;
				if (name && name !== cur) void this.doSwitchStory(name);
			});
		});
		if (storyBody) {
			this.treeEl.appendChild(storyBody); // 标题行留在固定头部，组内树体移入可滚动区域
			if (!snap.stories.length) {
				storyBody.createDiv({ text: "该目录下还没有小说，可用「创建新小说」开始。", cls: "aw-dim aw-st-hint" });
			} else if (!ad) {
				storyBody.createDiv({ text: active ? `未能加载「${active.title}」的状态` : "暂无当前小说：用上方标题行的下拉框选择激活。", cls: "aw-dim aw-st-hint" });
			} else {
				this.renderStorySections(storyBody, ad, true); // 「全局文档」「章节」两个小节（原结构）
			}
		}
		this.treeEl.scrollTop = savedScroll;
	}

	/** 「小说状态」区的概要信息行（书名 + 题材/编写类型 + 章数·当前章·总字数·更新时间） */
	private renderStatusLines(parent: HTMLElement, d: StatusDetail): void {
		// 书名行：名称左对齐 + 更新时间右对齐（本地时间含年份），flex space-between
		const titleRow = parent.createDiv({ cls: "aw-st-status-title" });
		titleRow.createSpan({ text: `${d.title}（${d.storyName}）` });
		titleRow.createSpan({ text: d.updatedAt ? `更新 ${formatLocalDateTime(d.updatedAt, true)}` : "-", cls: "aw-dim aw-st-status-time" });
		parent.createDiv({ text: `题材：${d.genre || "-"}　编写类型：${d.writingStyle || "-"}`, cls: "aw-dim aw-st-info-line" });
		parent.createDiv({
			text: `${String(d.chapters.length)}章 · ${d.currentChapter != null ? `第${d.currentChapter}章` : "无当前章"} · 总字数 ${d.totalWords.toLocaleString()}字`,
			cls: "aw-dim aw-st-info-line",
		});
	}

	/** 「全局文档」「章节」两个小节；isActive=该书是否为当前激活小说（仅其下章节可被 Radio 选中激活） */
	private renderStorySections(parent: HTMLElement, d: StatusDetail, isActive: boolean): void {
		if (d.globalFiles.length) {
			// 全局文档分组：标题行与组内空白右键均为「书根目录新建文章 / 新建章节」（不含删除）
			const gItems = () => this.createItems(d.storyName, null);
			const gBody = this.sectionHead(parent, `全局文档（${String(d.globalFiles.length)}）`, `gdocs:${d.storyName}`, (e) => this.showContextMenu(e, gItems()));
			if (gBody) {
				gBody.addClass("aw-st-kids"); // 展开后文件列表带左侧指示线
				gBody.addEventListener("contextmenu", (e) => {
					e.stopPropagation();
					this.showContextMenu(e, gItems());
				});
				for (const f of d.globalFiles) this.appendFileRow(gBody, f, { story: d.storyName, num: null });
			}
		}

		const chBody = this.sectionHead(parent, `章节（${String(d.chapters.length)}）`, `chapters:${d.storyName}`, (e) =>
			this.showContextMenu(e, [{ label: "新建章节…", run: () => this.runStatusAction({ kind: "new-chapter", story: d.storyName }) }]), // 右键「章节」分组标题→直接对该书建章
		);
		if (chBody) {
			if (!d.chapters.length) {
				chBody.createDiv({ text: "还没有章节，可用「新建章节」创建。", cls: "aw-dim aw-st-hint" });
			}
			for (const c of d.chapters) {
				const block = chBody.createDiv({ cls: "aw-st-chap-block" }); // 每章一个容器：行+文件行的组内空白右键=该目录新建项（不含删除）
				block.addEventListener("contextmenu", (e) => {
					e.stopPropagation();
					this.showContextMenu(e, this.createItems(d.storyName, c.num));
				});
				this.renderChapter(block, d.storyName, c, isActive);
			}
		}
	}

	private renderChapter(parent: HTMLElement, storyName: string, c: StatusChapterEntry, isActiveStory: boolean): void {
		const key = `c:${storyName}:${String(c.num)}`; // 含书名：不同书的同号章节互不连动
		// 章节的文件列表默认折叠（expanded 记手动展开态）
		const open = this.expanded.has(key);
		const row = parent.createDiv({ cls: "aw-st-chap" + (c.active ? " is-active" : "") });
		row.createSpan({ text: open && c.files.length ? "▾" : "▸", cls: "aw-st-caret" }).addEventListener("click", (e) => {
			e.stopPropagation(); // 点箭头只展开/折叠文件列表，不激活章节
			this.toggleChapFiles(key, open, c.files.length > 0);
		});
		row.appendText(`第${String(c.num).padStart(2, "0")}章 ${c.title}`); // 激活态仅用灰底+选中Radio标识
		row.createSpan({ text: `${c.words.toLocaleString()}字`, cls: "aw-dim" });
		// RadioButton 放在行尾右对齐：选中它才激活该章（写回 current_chapter）；点它不触发行的树状开合
		const radio = row.createEl("input", { type: "radio", cls: "aw-st-radio" }) as HTMLInputElement;
		radio.name = `aw-chap-${storyName}`; // 同名互斥：一本书内只有一个当前章
		radio.checked = c.active && isActiveStory;
		radio.addEventListener("click", (e) => e.stopPropagation());
		radio.addEventListener("change", () => {
			if (!isActiveStory || c.active) return;
			void this.doActivateChapter(storyName, c.num);
		});
		row.addEventListener("click", () => {
			// 树状结构：点行（含章节名）只展开/折叠本章文件列表，激活一律走行首 Radio
			this.toggleChapFiles(key, open, c.files.length > 0);
		});
		row.addEventListener("contextmenu", (e) => {
			e.stopPropagation(); // 不透传到所在章节块/面板空白处菜单；右键永不触发切换/激活
				this.showContextMenu(e, [
					...this.createItems(storyName, c.num),
					{ sep: true },
					{ label: "编写本章…", run: () => this.runStatusAction({ kind: "llm-write", story: storyName, num: c.num }) }, // /write：先激活该书/章再走创作流程
					{ label: "续写本章…", run: () => this.runStatusAction({ kind: "llm-continue", story: storyName, num: c.num }) }, // /continue
					{ label: "润色本章…", run: () => this.runStatusAction({ kind: "llm-polish", story: storyName, num: c.num }) }, // /polish
					{ sep: true },
					{ label: "重命名本章…", run: () => this.runStatusAction({ kind: "rename-chapter", story: storyName, num: c.num }) }, // /chapter rename：改写章名，同步目录与文档引用
					{ label: `删除本章（第${String(c.num)}章）`, danger: true, run: () => this.runStatusAction({ kind: "delete-chapter", story: storyName, num: c.num }) }, // 删除只作用于被点中的这一章
				]);
		});
		if (open) {
			const kids = parent.createDiv({ cls: "aw-st-kids" }); // 展开后文件列表缩进并带左侧指示线
			for (const f of c.files) this.appendFileRow(kids, f, { story: storyName, num: c.num });
		}
	}

	/** 章节文件列表开合（点行与点箭头共用）：expanded 记手动展开态，无文件的章不可展开 */
	private toggleChapFiles(key: string, open: boolean, hasFiles: boolean): void {
		if (open) this.expanded.delete(key);
		else if (hasFiles) this.expanded.add(key); // 收起且无文件时点了也不变
		void this.refresh();
	}

	/** 可折叠小节标题行：点击整行切换展开/折叠；onContext 提供时为标题行挂右键菜单（stopPropagation 不落到面板兜底菜单）；返回子项容器（已折叠时返回 null，调用方跳过构建） */
	private sectionHead(parent: HTMLElement, label: string, key: string, onContext?: (e: MouseEvent) => void, afterLabel?: (head: HTMLElement) => void): HTMLElement | null {
		const head = parent.createDiv({ cls: "aw-st-section-head" + (key === "stories" ? " aw-st-section" : " aw-st-subsection") }); // 「小说列表」为顶层分组加粗，「全局文档」「章节」用常规字重
		head.createSpan({ text: this.collapsed.has(key) ? "▸" : "▾", cls: "aw-st-caret" });
		head.appendText(label);
		if (afterLabel) afterLabel(head);
		head.addEventListener("click", () => {
			this.toggleCollapse(key);
			void this.refresh();
		});
		if (onContext) {
			head.addEventListener("contextmenu", (e) => {
				e.stopPropagation();
				onContext(e);
			});
		}
		return this.collapsed.has(key) ? null : parent.createDiv();
	}

	private toggleCollapse(key: string): void {
		if (this.collapsed.has(key)) this.collapsed.delete(key);
		else this.collapsed.add(key);
	}

	private appendFileRow(parent: HTMLElement, f: StatusFileEntry, ctx?: { story: string; num: number | null }): void {
		const el = parent.createDiv({ cls: "aw-st-file" });
		el.setText(f.name);
		el.addEventListener("click", (e) => {
			e.stopPropagation(); // 点文件不触发所在章节行的激活
			void this.openFile(f.path);
		});
		if (ctx) {
			el.addEventListener("contextmenu", (e) => {
				e.stopPropagation(); // 不透传到所在分组/章节块的菜单
				this.showContextMenu(e, [
					{ label: "新建文章…", run: () => this.runStatusAction({ kind: "new-file", story: ctx.story, num: ctx.num }) },
					{ label: `删除 ${f.name}`, danger: true, run: () => this.runStatusAction({ kind: "delete-file", path: f.path }) },
				]);
			});
		}
	}

	/** 执行右键菜单动作（main.ts handleStatusAction），完成后刷新视图；失败追加错误行 */
	private runStatusAction(a: StatusAction): void {
		void (async () => {
			try {
				await this.onAction(a);
				await this.refresh();
			} catch (e) {
				this.treeEl.createDiv({ text: `操作失败：${e instanceof Error ? e.message : String(e)}`, cls: "aw-st-error" }); // 错误提示放滚动区，不撑破固定头部布局
			}
		})();
	}

	/** 简易右键上下文菜单：fixed 定位跟随鼠标，点外部/Esc/关闭面板时收起；`{ sep: true }` 项渲染为横线分隔（用于隔开不同级别的菜单项） */
	private showContextMenu(e: MouseEvent, items: Array<{ label: string; danger?: boolean; run: () => void } | { sep: true }>): void {
		if (!items.length) return;
		this.closeMenu();
		e.preventDefault();
		const menu = document.body.createDiv({ cls: "aw-st-menu" });
		for (const it of items) {
			if ("sep" in it) {
				menu.createDiv({ cls: "aw-st-menu-sep" });
				continue;
			}
			const el = menu.createDiv({ cls: "aw-st-menu-item" + (it.danger ? " is-danger" : "") });
			el.setText(it.label);
			el.addEventListener("click", () => {
				this.closeMenu();
				it.run();
			});
		}
		menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8))}px`;
		menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8))}px`;
		this.menuEl = menu;
		document.addEventListener("mousedown", this.docMouseHandler, true);
		document.addEventListener("keydown", this.escKeyHandler, true);
	}

	private closeMenu(): void {
		if (!this.menuEl) return;
		this.menuEl.remove();
		this.menuEl = null;
		document.removeEventListener("mousedown", this.docMouseHandler, true);
		document.removeEventListener("keydown", this.escKeyHandler, true);
	}

	private async doSwitchStory(name: string): Promise<void> {
		try {
			await this.onSwitchStory(name);
			await this.refresh();
		} catch (e) {
			this.treeEl.createDiv({ text: `切换小说失败：${e instanceof Error ? e.message : String(e)}`, cls: "aw-st-error" }); // 错误提示放滚动区，不撑破固定头部布局
		}
	}

	private async doActivateChapter(storyName: string, num: number): Promise<void> {
		try {
			await this.onActivateChapter(storyName, num);
			await this.refresh();
		} catch (e) {
			this.treeEl.createDiv({ text: `激活章节失败：${e instanceof Error ? e.message : String(e)}`, cls: "aw-st-error" }); // 错误提示放滚动区，不撑破固定头部布局
		}
	}

	private async openFile(path: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return;
		await this.app.workspace.getLeaf().openFile(f);
	}
}
