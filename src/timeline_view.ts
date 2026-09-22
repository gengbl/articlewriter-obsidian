import { ItemView, TFile, WorkspaceLeaf, type MarkdownView } from "obsidian";
import { parseTimelineTime, timelineTimeText, type TimelineEntry } from "./md_docs";

/** 时间线条目所属层级（书根 / 卷 / 章） */
export type TlScope = "book" | "volume" | "chapter";

/** 面板展示用时间线条目：解析结果 + 层级归属、来源路径与层级标签 */
export interface TlRow extends TimelineEntry {
	scope: TlScope;
	sourcePath: string; // 来源《时间线.md》的 vault 相对路径
	sourceLabel: string; // 层级标签（书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>），合并展示时随条目显示出处
}

export interface TlStoryEntry {
	name: string;
	title: string;
	active: boolean;
}

/** 时间线面板快照（main.ts 非交互读取构建，只含展示字段）：各层已合并为单一按时间点升序的行列表 */
export interface TlSnapshot {
	workDir: string;
	stories: TlStoryEntry[];
	activeStory: string | null;
	activeStoryTitle: string;
	useVolumes: boolean; // 有卷/无卷模式（空态文案据此给出对应的建文档位置提示）
	rows: TlRow[]; // 书/卷/章全部条目合并，(年,月,日) 升序；同值保持文档枚举顺序
	totalCount: number; // 全部层解析出的事件总条数
	unparsedDocs: Array<{ label: string; path: string }>; // 原文非空但零有效条目的文档（格式提示 + 可点开查看）
}

/** 某行是否命中筛选词（人物名 + 事件正文匹配） */
function matchRow(r: TlRow, q: string): boolean {
	return (r.chars.join(" ") + " " + r.event).toLowerCase().includes(q);
}

/**
 * 时间线面板（自定义 ItemView，可停靠任意区域、重载保留位置）：
 * 把当前小说**书根 / 卷目录 / 章节目录三层《时间线.md》**合并成一条自上而下的纵向时间轴——条目按时间点（支持 年 / 年-月 / 年-月-日）升序排列，每条带来源层级标签。
 * 顶部筛选框可按人物/事件关键词过滤。**双击**条目在编辑器打开来源文件并定位到该时间点的 `##` 标题行（单击不触发，避免误触）。
 * 数据经构造注入的 getter 实时读取；文件变更由 main.ts 防抖调 refresh()。
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
		this.treeEl = this.rootEl.createDiv({ cls: "aw-st-tree" }); // 滚动主体：合并后的纵向时间轴
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

	/** 主体区：单一合并纵向时间轴（时间点升序、每条带来源标签）+ 无有效条目文档的格式提示 + 汇总行 */
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
		const rows = q ? snap.rows.filter((r) => matchRow(r, q)) : snap.rows;
		if (rows.length) {
			const list = this.treeEl.createDiv({ cls: "aw-tl-list" }); // 纵向时间轴（左侧竖线 + 节点圆点），自上而下按时间点升序
			for (const row of rows) this.renderItem(list, row);
		} else {
			this.treeEl.createDiv({ text: `没有匹配「${this.filterText.trim()}」的时间线条目。`, cls: "aw-dim aw-st-hint" });
		}
		if (snap.unparsedDocs.length) this.renderUnparsed(snap.unparsedDocs);
		const summary = this.treeEl.createDiv({ cls: "aw-dim aw-rel-summary" });
		if (q) {
			summary.setText(`匹配 ${String(rows.length)} 条（共 ${String(snap.totalCount)} 条）`);
		} else {
			const perScope: Record<TlScope, number> = { book: 0, volume: 0, chapter: 0 };
			for (const r of snap.rows) perScope[r.scope]++;
			summary.setText(`共 ${String(snap.totalCount)} 条：书籍级 ${String(perScope.book)} · 卷 ${String(perScope.volume)} · 章 ${String(perScope.chapter)}`);
		}
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
			return `还没有时间线：在${where}记录——每条事件一个 \`## <时间点>\` 块（\`年\` / \`年-月\` / \`年-月-日\`，如 \`-129-06-15\`）+ \`- 人物：A、B\` + \`- 事件：…\`；面板会把三层合并成一条按时间排序的时间轴展示。`;
		}
		return null;
	}

	/** 有内容但零有效条目的文档提示行：列出层级标签（可点击打开对应《时间线.md》检查格式） */
	private renderUnparsed(docs: Array<{ label: string; path: string }>): void {
		const line = this.treeEl.createDiv({ cls: "aw-dim aw-st-hint" });
		line.createSpan({ text: "以下《时间线.md》有内容但没有有效条目（需 ## <时间点> 标题）：" });
		docs.forEach((d, i) => {
			if (i) line.createSpan({ text: "、" });
			const s = line.createSpan({ text: d.label, cls: "aw-tl-unparsed" });
			s.addEventListener("click", () => void this.openFile(d.path));
		});
	}

	/** 单条事件：时间点徽章（年-月-日规范形式）+ 来源层级标签 + 人物 chips + 事件正文；**双击**在编辑器打开来源文档并定位到该时间点 */
	private renderItem(parent: HTMLElement, row: TlRow): void {
		const item = parent.createDiv({ cls: "aw-tl-item" });
		item.createSpan({ text: timelineTimeText(row), cls: "aw-tl-time" });
		if (row.sourceLabel) item.createSpan({ text: row.sourceLabel, cls: "aw-dim aw-tl-src" });
		const wrap = item.createDiv({ cls: "aw-tl-evwrap" });
		if (row.chars.length) {
			const chars = wrap.createDiv({ cls: "aw-tl-chars" });
			for (const c of row.chars) chars.createSpan({ text: c, cls: "aw-tl-char" });
		}
		if (row.event) wrap.createDiv({ text: row.event, cls: "aw-tl-event" });
		else if (!row.chars.length) wrap.createDiv({ text: "（未填写事件与人物）", cls: "aw-dim aw-st-hint" });
		item.setAttribute("title", `双击在编辑器中打开并定位到该时间点：${row.sourcePath}`);
		item.addEventListener("dblclick", () => void this.openAt(row));
	}

	/** 双击条目：在编辑器打开来源《时间线.md》并滚动定位到该事件的 ## 标题行 */
	private async openAt(row: TlRow): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(row.sourcePath);
		if (!(f instanceof TFile)) return; // 候选路径（文档尚未创建）静默忽略
		const leaf = await this.app.workspace.getLeaf();
		await leaf.openFile(f);
		this.locateHeading(leaf, row);
	}

	/** 在已打开的 Markdown 视图内定位匹配的时间点标题行（按解析后的值比对，兼容未补零的原始写法；移动端/内容未就绪则降级为仅打开文档）。首次尝试可能早于编辑器装载完成，250ms 后重试一次 */
	private locateHeading(leaf: WorkspaceLeaf, row: TlRow): void {
		for (const delay of [0, 250]) {
			window.setTimeout(() => {
				const ed = (leaf.view as MarkdownView | null)?.editor;
				if (!ed) return;
				let lines: string[] = [];
				try { lines = ed.getValue().split("\n"); } catch { return; }
				const idx = lines.findIndex((l) => {
					const m = /^##\s+(.*)$/.exec(l.trim());
					if (!m) return false;
					const p = parseTimelineTime(m[1]);
					return !!p && p.time === row.time && (p.month ?? 0) === (row.month ?? 0) && (p.day ?? 0) === (row.day ?? 0);
				});
				if (idx < 0) return;
				const pos = { line: idx, ch: 0 };
				ed.setCursor(pos);
				ed.scrollIntoView({ from: pos, to: pos }, true); // center=true：定位行滚到视口中央
			}, delay);
		}
	}

	private async openFile(path: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return; // 候选路径（文档尚未创建）静默忽略
		await this.app.workspace.getLeaf().openFile(f);
	}
}
