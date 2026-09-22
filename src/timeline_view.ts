import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type { TimelineEntry } from "./md_docs";

/** 时间线条目所属层级（书根 / 卷 / 章） */
export type TlScope = "book" | "volume" | "chapter";

const SCOPE_LABEL: Record<TlScope, string> = { book: "书籍级", volume: "卷级", chapter: "章级" };

/** 面板展示用时间线条目：解析结果 + 层级归属与来源路径 */
export interface TlRow extends TimelineEntry {
	scope: TlScope;
	sourcePath: string; // 来源《时间线.md》的 vault 相对路径
}

/** 面板分组节点（可嵌套：有卷模式下卷节点携带其成员章节子组，自上而下构成 书→卷→章 三层树；无卷模式为 书→章 两层平铺） */
export interface TlSection {
	scope: TlScope;
	label: string; // 书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>
	path: string; // 该层《时间线.md》的 vault 相对路径（文档尚不存在时为候选路径，点击静默忽略）
	depth: number; // 缩进层级：0=书籍级、1=卷/平铺章节、2=有卷模式的卷内章节
	rows: TlRow[]; // 已按时间点升序排列
	hasText: boolean; // 原文非空但解析不出条目时给书写格式提示
	children?: TlSection[]; // 仅卷节点携带（其成员章节）
}

export interface TlStoryEntry {
	name: string;
	title: string;
	active: boolean;
}

/** 时间线面板快照（main.ts 非交互读取构建，只含展示字段） */
export interface TlSnapshot {
	workDir: string;
	stories: TlStoryEntry[];
	activeStory: string | null;
	activeStoryTitle: string;
	useVolumes: boolean; // 有卷/无卷模式（空态文案据此给出对应的建文档位置提示）
	sections: TlSection[]; // 顶层序列：书级 →（未归卷章…）→ 各卷(含子章)；无卷模式：书级 → 全部章
	totalCount: number; // 全部层解析出的事件总条数
}

/** 某行是否命中筛选词（人物名 + 事件正文匹配） */
function matchRow(r: TlRow, q: string): boolean {
	return (r.chars.join(" ") + " " + r.event).toLowerCase().includes(q);
}

/** 递归统计分组内（含子孙组）命中的条目数——筛选时整支为 0 的分支不渲染 */
function visibleCount(sec: TlSection, q: string): number {
	let n = sec.rows.filter((r) => matchRow(r, q)).length;
	for (const c of sec.children ?? []) n += visibleCount(c, q);
	return n;
}

/**
 * 时间线面板（自定义 ItemView，可停靠任意区域、重载保留位置）：
 * 自上而下纵向展示当前小说**全部**《时间线.md》的事件流——有卷模式按 书籍→卷→章节 三层嵌套缩进，无卷模式按 书籍→章节 两层平铺。
 * 每组内条目按时间点数值升序排列（时间点为文档标题里的任意数字），支持按人物/事件关键词筛选；分组可开合（会话内保持、不落盘）。
 * **双击**条目在编辑器打开来源文件（单击不触发，避免误触）。数据经构造注入的 getter 实时读取；文件变更由 main.ts 防抖调 refresh()。
 * 渲染陷阱同 StatusView / RelationshipView：UI 必须建在 onOpen 的 contentEl（本环境不调用 getEmptyStateElement）。
 */
export class TimelineView extends ItemView {
	static readonly VIEW_TYPE = "articlewriter-timeline";

	private getData: () => Promise<TlSnapshot>;
	private built = false;
	private rootEl!: HTMLElement;
	private topEl!: HTMLElement;
	private treeEl!: HTMLElement;
	private busy = false;
	private lastSnap: TlSnapshot | null = null;
	private filterText = "";
	/** 分组收起态（会话内保持，不落盘；键 "tl:<path>"） */
	private collapsed = new Set<string>();

	constructor(leaf: WorkspaceLeaf, getData: () => Promise<TlSnapshot>) {
		super(leaf);
		this.getData = getData;
	}

	getViewType(): string {
		return TimelineView.VIEW_TYPE;
	}

	getDisplayText(): string {
		return "时间线";
	}

	getIcon(): string {
		return "history";
	}

	async onOpen(): Promise<void> {
		if (!this.built) this.buildUI(this.contentEl);
		void this.refresh();
	}

	private buildUI(parent: HTMLElement): void {
		this.built = true;
		this.rootEl = parent.createDiv({ cls: "aw-status-view aw-tl-view" }); // 复用写字台的容器/字体/滚动布局样式
		this.topEl = this.rootEl.createDiv({ cls: "aw-st-top" }); // 固定头部：筛选框 + 刷新按钮
		this.treeEl = this.rootEl.createDiv({ cls: "aw-st-tree" }); // 滚动主体：纵向时间轴分组
	}

	/** 重新拉取快照并重渲染（「刷新」按钮与插件侧文件变更防抖都会调到这里） */
	async refresh(): Promise<void> {
		if (this.busy || !this.built) return;
		this.busy = true;
		try {
			const snap = await this.getData();
			this.lastSnap = snap;
			this.render(snap);
		} catch (e) {
			this.lastSnap = null;
			this.topEl.empty();
			this.treeEl.empty();
			this.topEl.createDiv({ text: `加载失败：${e instanceof Error ? e.message : String(e)}`, cls: "aw-st-error" });
		} finally {
			this.busy = false;
		}
	}

	private render(snap: TlSnapshot): void {
		this.topEl.empty();
		this.renderTop();
		this.renderBody(snap);
	}

	/** 固定头部：筛选输入框 + 刷新按钮（不展示工作目录与小说列表，面板只呈现时间线本身） */
	private renderTop(): void {
		const filterRow = this.topEl.createDiv({ cls: "aw-rel-filter-row" }); // 复用关系面板的头部行布局
		const input = filterRow.createEl("input", { type: "text", cls: "aw-rel-filter aw-tl-filter", placeholder: "筛选人物 / 事件…" });
		input.value = this.filterText;
		input.addEventListener("input", () => {
			this.filterText = input.value; // 只重渲染主体区（头部保持不动，输入焦点与光标不丢）
			if (this.lastSnap) this.renderBody(this.lastSnap);
		});
		const btns = filterRow.createSpan({ cls: "aw-st-actions" });
		btns.createEl("button", { text: "刷新" }).addEventListener("click", () => void this.refresh());
	}

	/** 主体区：汇总行 + 各层级分组（自上而下纵向时间轴，卷内章节嵌套缩进） */
	private renderBody(snap: TlSnapshot): void {
		const savedScroll = this.treeEl.scrollTop;
		this.treeEl.empty();
		const ph = this.placeholderFor(snap);
		if (ph) {
			this.treeEl.createDiv({ text: ph, cls: "aw-dim aw-st-hint" });
			this.treeEl.scrollTop = savedScroll;
			return;
		}
		const q = this.filterText.trim().toLowerCase();
		let shown = 0;
		for (const sec of snap.sections) {
			const vc = q ? visibleCount(sec, q) : -1;
			if (vc === 0) continue; // 筛选时整支无命中的分支不渲染
			if (q) shown += vc;
			this.renderSection(sec, q);
		}
		if (!q) shown = snap.totalCount;
		const summary = this.treeEl.createDiv({ cls: "aw-dim aw-rel-summary" });
		if (q) summary.setText(`匹配 ${String(shown)} 条（共 ${String(snap.totalCount)} 条）`);
		else {
			const perScope: Record<TlScope, number> = { book: 0, volume: 0, chapter: 0 };
			const countAll = (sec: TlSection): void => {
				perScope[sec.scope] += sec.rows.length;
				for (const c of sec.children ?? []) countAll(c);
			};
			for (const s of snap.sections) countAll(s);
			summary.setText(`共 ${String(snap.totalCount)} 条：书籍级 ${String(perScope.book)} · 卷 ${String(perScope.volume)} · 章 ${String(perScope.chapter)}`);
		}
		if (q && !shown) this.treeEl.createDiv({ text: `没有匹配「${this.filterText.trim()}」的时间线条目。`, cls: "aw-dim aw-st-hint" });
		this.treeEl.scrollTop = savedScroll;
	}

	/** 空态/引导文案：无可展示数据时返回文案，否则 null */
	private placeholderFor(snap: TlSnapshot): string | null {
		if (!snap.activeStory) {
			if (!snap.workDir) return "未设置工作目录：请先执行「选择工作目录」命令。";
			if (!snap.stories.length) return "该目录下还没有小说，可用「创建新小说」开始。";
			return "尚未选择当前小说：请执行「切换当前小说」命令（或在写字台里点小说）后返回。";
		}
		if (!snap.totalCount) {
			const where = snap.useVolumes
				? "书根 `<书名>/时间线.md`、卷目录 `<卷名>-时间线.md`、章节目录 `<编号>-<标题>-时间线.md`"
				: "书根 `<书名>/时间线.md` 或章节目录 `<编号>-<标题>-时间线.md`";
			return `还没有时间线：在${where}记录——每条事件一个 \`## <时间点>\` 块 + \`- 人物：A、B\` + \`- 事件：…\`（时间点为任意数字）。`;
		}
		return null;
	}

	/** 单个分组节点：命名头（可开合，右侧「打开文档」）+ 纵向时间轴条目列表 + 嵌套子组；mount 缺省挂面板主体、卷内章节传父组主体实现缩进嵌套 */
	private renderSection(sec: TlSection, q: string, mount?: HTMLElement): void {
		const target = mount ?? this.treeEl;
		const key = `tl:${sec.path}`;
		const open = !this.collapsed.has(key);
		const block = target.createDiv({ cls: `aw-tl-group aw-tl-d${String(Math.min(sec.depth, 2))}` });
		const head = block.createDiv({ cls: "aw-st-chap" }); // 复用写字台章节名行样式
		head.createSpan({ text: open ? "▾" : "▸", cls: "aw-st-caret" });
		head.createSpan({ text: `${SCOPE_LABEL[sec.scope]}（${String(sec.rows.length)}）`, cls: "aw-rel-grouptitle" });
		head.createSpan({ text: sec.label, cls: "aw-dim aw-rel-grouplabel" });
		const openDoc = head.createSpan({ text: "打开文档", cls: "aw-rel-openfile" });
		openDoc.addEventListener("click", (e) => {
			e.stopPropagation(); // 点按钮不开合分组
			void this.openFile(sec.path);
		});
		head.addEventListener("click", () => {
			if (this.collapsed.has(key)) this.collapsed.delete(key);
			else this.collapsed.add(key);
			if (this.lastSnap) this.renderBody(this.lastSnap);
		});
		if (!open) return;
		const body = block.createDiv({ cls: "aw-st-kids aw-tl-listwrap" });
		const kids = sec.children ?? [];
		const rows = q ? sec.rows.filter((r) => matchRow(r, q)) : sec.rows;
		if (!rows.length && !kids.length) {
			body.createDiv({
				text: sec.hasText ? "该文档暂无符合格式的时间线条目：需 `## <数字时间点>` 标题 + `- 人物：` / `- 事件：`。" : "该层还没有《时间线.md》内容。",
				cls: "aw-dim aw-st-hint",
			});
			return;
		}
		if (rows.length) {
			const list = body.createDiv({ cls: "aw-tl-list" }); // 纵向时间轴（左侧竖线 + 节点圆点，自上而下按时间点升序）
			for (const row of rows) this.renderItem(list, row);
		}
		for (const c of kids) if (!q || visibleCount(c, q) > 0) this.renderSection(c, q, body);
	}

	/** 单条事件：时间点徽章 + 人物 chips + 事件正文；**双击**打开来源文档（单击不触发，避免误触） */
	private renderItem(parent: HTMLElement, row: TlRow): void {
		const item = parent.createDiv({ cls: "aw-tl-item" });
		item.createSpan({ text: String(row.time), cls: "aw-tl-time" });
		const wrap = item.createDiv({ cls: "aw-tl-evwrap" });
		if (row.chars.length) {
			const chars = wrap.createDiv({ cls: "aw-tl-chars" });
			for (const c of row.chars) chars.createSpan({ text: c, cls: "aw-tl-char" });
		}
		if (row.event) wrap.createDiv({ text: row.event, cls: "aw-tl-event" });
		else if (!row.chars.length) wrap.createDiv({ text: "（未填写事件与人物）", cls: "aw-dim aw-st-hint" });
		item.setAttribute("title", `双击在编辑器中打开来源文档：${row.sourcePath}`);
		item.addEventListener("dblclick", () => void this.openFile(row.sourcePath));
	}

	private async openFile(path: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return; // 候选路径（文档尚未创建）静默忽略
		await this.app.workspace.getLeaf().openFile(f);
	}
}
