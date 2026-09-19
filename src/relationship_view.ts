import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { relationshipStatusKind } from "./md_docs";
import type { RelationshipEntry } from "./md_docs";

/** 关系所属层级（书根 / 卷 / 章） */
export type RelScope = "book" | "volume" | "chapter";

const SCOPE_LABEL: Record<RelScope, string> = { book: "书籍级", volume: "卷级", chapter: "章级" };

/** 面板展示用关系行：解析结果 + 层级归属与来源路径 */
export interface RelRow extends RelationshipEntry {
	scope: RelScope;
	scopeLabel: string;
	sourcePath: string; // 来源《人物关系.md》的 vault 相对路径
}

/** 面板分组：一层关系文档（书根 / 当前卷 / 当前章） */
export interface RelGroup {
	scope: RelScope;
	label: string; // 书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>
	path: string;
	rows: RelRow[];
	hasText: boolean; // 原文非空但解析不出条目时给书写格式提示
}

export interface RelStoryEntry {
	name: string;
	title: string;
	active: boolean;
}

/** 「人物状态」区单条角色设定（来自某一层《人物.md》；同名角色在多层登记时为多条、不合并，由 main.ts 从 manager.loadCharacterEntries 映射） */
export interface RelCharInfo {
	name: string;
	scope: RelScope;
	label: string; // 书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>
	sourcePath: string; // 所在《人物.md》的 vault 相对路径
	identity?: string;
	age?: string;
	gender?: string;
	personality?: string;
	appearance?: string;
	background?: string;
	abilities: string[];
	notes?: string;
}

/** 人物关系面板快照（main.ts 非交互读取构建，只含展示字段） */
export interface RelSnapshot {
	workDir: string;
	stories: RelStoryEntry[];
	activeStory: string | null;
	activeStoryTitle: string;
	groups: RelGroup[];
	relCount: number; // 三层解析出的关系总条数
	chars: RelCharInfo[]; // 全部三层《人物.md》的角色设定条目（「人物状态」区按选中角色名筛选展示）
}

/** 关系类型关键词 → lucide 图标名（首个命中生效；顺序即优先级：「师徒」先于「朋友」以免被 徒/友 抢走，「同伴」先于「朋友」以免 队友 被 友 抢走） */
const TYPE_ICONS: Array<[RegExp, string]> = [
	[/师|徒|传承|授业/, "graduation-cap"],
	[/敌|仇|对立|对手|宿敌|冲突|追杀/, "swords"],
	[/恋|爱慕|情|婚|夫|妻|情侣|暗恋/, "heart"],
	[/父|母|子|女|兄|弟|姐|妹|亲|族|血缘|收养/, "home"],
	[/主仆|上司|下属|雇主|属下|领导|仆/, "briefcase"],
	[/同门|宗门|门派|帮|派系/, "flag"],
	[/队友|同伴|同行|同盟|盟|结伴/, "users"],
	[/友|伙伴|搭档|知己|青梅竹马/, "user-plus"],
];

/** 关系类型 → 图标名（未识别回调 link） */
export function relationshipTypeIcon(type: string): string {
	const t = String(type || "");
	for (const [re, icon] of TYPE_ICONS) if (re.test(t)) return icon;
	return "link";
}

/** 关系类型 → 图视图边色 class（与 TYPE_ICONS 同序同义，仅用于 CSS 着色；未识别 is-other。「同伴」须先于「朋友」：队友/盟友 含「友」字，否则被抢走） */
const TYPE_CLASSES: Array<[RegExp, string]> = [
	[/师|徒|传承|授业/, "is-teach"],
	[/敌|仇|对立|对手|宿敌|冲突|追杀/, "is-enemy"],
	[/恋|爱慕|情|婚|夫|妻|情侣|暗恋/, "is-love"],
	[/父|母|子|女|兄|弟|姐|妹|亲|族|血缘|收养/, "is-family"],
	[/主仆|上司|下属|雇主|属下|领导|仆/, "is-master"],
	[/同门|宗门|门派|帮|派系/, "is-sect"],
	[/队友|同伴|同行|同盟|盟|结伴/, "is-mate"],
	[/友|伙伴|搭档|知己|青梅竹马/, "is-friend"],
];

/** 图视图图例：边色 class → 中文标签（顺序即展示顺序） */
const TYPE_CLASS_LABELS: Array<[string, string]> = [
	["is-teach", "师徒"],
	["is-enemy", "敌对"],
	["is-love", "情缘"],
	["is-family", "亲族"],
	["is-master", "主从"],
	["is-sect", "门派"],
	["is-mate", "同伴"],
	["is-friend", "朋友"],
	["is-other", "其它"],
];

/** 图视图缩放档位（倍数；1＝适应面板宽度，其余为相对基准宽 760px 的百分比） */
const GRAPH_ZOOMS: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** 图视图基准画布（viewBox 尺寸；缩放靠 CSS transform，不重算布局） */
const GRAPH_BASE_W = 760;
const GRAPH_BASE_H = 560;

/** 数值限位（拖动平移的边界收敛用） */
const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 关系类型 → 图视图边色 class */
export function relationshipTypeClass(type: string): string {
	const t = String(type || "");
	for (const [re, cls] of TYPE_CLASSES) if (re.test(t)) return cls;
	return "is-other";
}

/** 状态优先级（图视图合并同一条边的多层登记时取最优者；数字越小越优先） */
const STATUS_RANK: Record<string, number> = { active: 0, pending: 1, ended: 2, unknown: 3 };

/** 图视图节点：三层同名角色合并为一个节点 */
interface GraphNode {
	name: string;
	degree: number; // 相连的关系条数（合并后的边数）
	sources: string[]; // 涉及该角色的来源文档（去重，用于点击打开）
}

/** 图视图边：同一对角色跨层重复登记合并为一条（count 记录原始条数） */
interface GraphEdge {
	a: string;
	b: string;
	type: string;
	status: string;
	kind: string; // relationshipStatusKind 结果（CSS 线型用）
	desc: string; // 首次出现的描述（合并时保留首个非空）
	count: number;
	scope: RelScope; // 首次出现的层级
	sourcePath: string;
}

/** 某行是否命中筛选词（角色名/类型/状态/描述全字段匹配） */
function matchRow(r: RelRow, q: string): boolean {
	return [r.a, r.b, r.type, r.status, r.desc].join(" ").toLowerCase().includes(q);
}

/**
 * 人物关系面板（自定义 ItemView，可停靠任意区域、重载保留位置）：
 * 汇总展示当前小说 书/卷/章 三层《人物关系.md》的关系，**两种展示方式**（顶部「卡片 / 图表」按钮切换，会话内保持、不落盘）——
 * ①卡片：按层级分组的关系卡片（角色对 + 类型徽章 + 状态指示点 + 描述）；
 * ②图表：环形布局的节点连线图（角色=节点、关系=连线，按类型着色、按状态变线型，悬停高亮邻接）；
 * 两者都支持按角色/类型/状态筛选，**双击**条目（卡片 / 节点 / 连线）在编辑器打开来源文件（单击不触发，避免误触）。
 * 数据经构造注入的 getter 实时读取；文件变更由 main.ts 防抖调 refresh()。
 * 渲染陷阱同 StatusView / LlmChatView：UI 必须建在 onOpen 的 contentEl（本环境不调用 getEmptyStateElement）。
 */
export class RelationshipView extends ItemView {
	static readonly VIEW_TYPE = "articlewriter-relationships";

	private getData: () => Promise<RelSnapshot>;
	private onAddCharacter?: () => void | Promise<void>;
	private built = false;
	private rootEl!: HTMLElement;
	private topEl!: HTMLElement;
	private treeEl!: HTMLElement;
	private edgeTipEl: HTMLDivElement | null = null;
	private busy = false;
	private lastSnap: RelSnapshot | null = null;
	private filterText = "";
	/** 分组收起态（会话内保持，不落盘；键 "rel:<scope>"） */
	private collapsed = new Set<string>();
	/** 展示方式（会话内保持，不落盘）：卡片列表 / 节点连线图 */
	private mode: "list" | "graph" = "list";
	/** 图视图缩放倍数（会话内保持，不落盘；1＝适应面板宽度，>1 放大后靠拖动查看） */
	private graphZoom = 1;
	/** 图视图拖动平移偏移（屏幕像素，会话内保持；拖动时更新，限位在 applyView 内收敛） */
	private graphPan = { x: 0, y: 0 };
	/** 图视图渲染物（高亮邻接用；每次重渲染重建） */
	private graphNodeEls = new Map<string, SVGGElement>();
	private graphEdgeEls: Array<{ el: SVGElement; a: string; b: string }> = [];
	private graphAdj = new Map<string, Set<string>>();
	/** 图视图「人物状态」区当前选中角色（会话内保持，不落盘；单击节点设置，× 清除） */
	private selectedChar: string | null = null;

	constructor(leaf: WorkspaceLeaf, getData: () => Promise<RelSnapshot>, onAddCharacter?: () => void | Promise<void>) {
		super(leaf);
		this.getData = getData;
		this.onAddCharacter = onAddCharacter; // v0.2.0+：头部「添加人物」按钮的动作（弹窗由 main.ts 提供，面板不自持业务逻辑）
	}

	getViewType(): string {
		return RelationshipView.VIEW_TYPE;
	}

	getDisplayText(): string {
		return "人物关系";
	}

	getIcon(): string {
		return "users";
	}

	async onOpen(): Promise<void> {
		if (!this.built) this.buildUI(this.contentEl);
		void this.refresh();
	}

	async onClose(): Promise<void> {
		this.edgeTipEl?.remove(); // tip 浮层挂在 document.body（见 buildUI），view 关闭时手动清理
		this.edgeTipEl = null;
	}

	private buildUI(parent: HTMLElement): void {
		this.built = true;
		this.rootEl = parent.createDiv({ cls: "aw-status-view aw-rel-view" }); // 复用写字台的容器/字体/滚动布局样式
		this.topEl = this.rootEl.createDiv({ cls: "aw-st-top" }); // 固定头部：筛选框 + 刷新按钮（不显示工作目录/小说列表）
		this.treeEl = this.rootEl.createDiv({ cls: "aw-st-tree" }); // 滚动主体：关系分组卡片
		// 边 tip 浮层（自定义 HTML，不用 SVG <title>）：挂在 document.body 上，避开侧栏祖先的 transform/contain/overflow 把 position:fixed 变成局部定位或裁切导致看不见
		this.edgeTipEl = document.body.createDiv({ cls: "aw-rel-gtip" });
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

	private render(snap: RelSnapshot): void {
		this.topEl.empty();
		this.renderTop();
		this.renderBody(snap);
	}

	/** 固定头部：展示方式切换 + 筛选输入框 + 刷新按钮（不展示工作目录与小说列表，面板只呈现关系本身） */
	private renderTop(): void {
		const filterRow = this.topEl.createDiv({ cls: "aw-rel-filter-row" });
		const modes = filterRow.createSpan({ cls: "aw-rel-modes" });
		const opts: Array<["list" | "graph", string]> = [["list", "卡片"], ["graph", "图表"]];
		for (const [kind, text] of opts) {
			const btn = modes.createEl("button", { text, cls: "aw-rel-modebtn" + (this.mode === kind ? " is-active" : "") });
			btn.addEventListener("click", () => {
				if (this.mode === kind) return;
				this.mode = kind;
				for (const b of Array.from(modes.children)) b.classList.toggle("is-active", b === btn);
				if (this.lastSnap) this.renderBody(this.lastSnap); // 纯本地切换，不读盘
			});
		}
		const input = filterRow.createEl("input", { type: "text", cls: "aw-rel-filter", placeholder: "筛选角色 / 类型 / 状态…" });
		input.value = this.filterText;
		input.addEventListener("input", () => {
			this.filterText = input.value; // 只重渲染主体区（头部保持不动，输入焦点与光标不丢）
			if (this.lastSnap) this.renderBody(this.lastSnap);
		});
		const btns = filterRow.createSpan({ cls: "aw-st-actions" });
		if (this.onAddCharacter) {
			const add = btns.createEl("button", { text: "添加人物" });
			add.disabled = !this.lastSnap?.activeStory; // 未选小说时无处写入
			add.addEventListener("click", () => void this.onAddCharacter?.());
		}
		btns.createEl("button", { text: "刷新" }).addEventListener("click", () => void this.refresh());
	}

	/** 主体区按当前展示方式分派：卡片列表（renderTree）或节点连线图（renderGraph） */
	private renderBody(snap: RelSnapshot): void {
		// 图表模式主体裁剪、不出滚动条（放大后靠拖拽平移查看），卡片模式保持纵向滚动
		this.treeEl.classList.toggle("is-graph", this.mode === "graph");
		if (this.mode === "graph") this.renderGraph(snap);
		else this.renderTree(snap);
	}

	/** 卡片列表主体：汇总行 + 各层级分组（书籍/卷/章） */
	private renderTree(snap: RelSnapshot): void {
		const savedScroll = this.treeEl.scrollTop;
		this.treeEl.empty();
		const ph = this.placeholderFor(snap);
		if (ph) {
			this.treeEl.createDiv({ text: ph, cls: "aw-dim aw-st-hint" });
			this.treeEl.scrollTop = savedScroll;
			return;
		}
		const q = this.filterText.trim().toLowerCase();
		const groups = snap.groups.map((g) => ({ ...g, rows: q ? g.rows.filter((r) => matchRow(r, q)) : g.rows }));
		const shown = groups.reduce((s, g) => s + g.rows.length, 0);
		const summary = this.treeEl.createDiv({ cls: "aw-dim aw-rel-summary" });
		if (q) summary.setText(`匹配 ${String(shown)} 条（共 ${String(snap.relCount)} 条）`);
		else summary.setText(`共 ${String(snap.relCount)} 条：` + groups.map((g) => `${SCOPE_LABEL[g.scope]} ${String(g.rows.length)}`).join(" · "));
		for (const g of groups) this.renderGroup(g);
		if (!shown) this.treeEl.createDiv({ text: `没有匹配「${this.filterText.trim()}」的关系。`, cls: "aw-dim aw-st-hint" });
		this.treeEl.scrollTop = savedScroll;
	}

	/** 空态/引导文案（卡片与图表两种展示共用）：无可展示数据时返回文案，否则 null */
	private placeholderFor(snap: RelSnapshot): string | null {
		if (!snap.activeStory) {
			if (!snap.workDir) return "未设置工作目录：请先执行「选择工作目录」命令。";
			if (!snap.stories.length) return "该目录下还没有小说，可用「创建新小说」开始。";
			return "尚未选择当前小说：请执行「切换当前小说」命令（或在写字台里点小说）后返回。";
		}
		if (!snap.relCount) return "还没有人物关系：在《人物关系.md》里按模板添加——`## 角色A - 角色B` 加 `- 类型：` `- 状态：` `- 描述：`（描述可用 ```text 围栏）。";
		return null;
	}

	/** 单层分组：命名头（复用章节名行样式，可开合，右侧「打开文档」）+ 关系卡片列表 */
	private renderGroup(g: RelGroup): void {
		const key = `rel:${g.scope}`;
		const open = !this.collapsed.has(key);
		const block = this.treeEl.createDiv({ cls: "aw-rel-group" });
		const head = block.createDiv({ cls: "aw-st-chap" });
		head.createSpan({ text: open ? "▾" : "▸", cls: "aw-st-caret" });
		head.createSpan({ text: `${SCOPE_LABEL[g.scope]}（${String(g.rows.length)}）`, cls: "aw-rel-grouptitle" });
		head.createSpan({ text: g.label, cls: "aw-dim aw-rel-grouplabel" });
		const openDoc = head.createSpan({ text: "打开文档", cls: "aw-rel-openfile" });
		openDoc.addEventListener("click", (e) => {
			e.stopPropagation(); // 点按钮不开合分组
			void this.openFile(g.path);
		});
		head.addEventListener("click", () => {
			if (this.collapsed.has(key)) this.collapsed.delete(key);
			else this.collapsed.add(key);
			if (this.lastSnap) this.renderBody(this.lastSnap);
		});
		if (!open) return;
		const body = block.createDiv({ cls: "aw-st-kids aw-rel-list" });
		if (!g.rows.length) {
			body.createDiv({
				text: g.hasText ? "该文档暂无符合格式的关系条目：需 `## 角色A - 角色B`，或字段式 `## 关系1` + `- 角色1：`/`- 角色2：`。" : "该层还没有《人物关系.md》内容。",
				cls: "aw-dim aw-st-hint",
			});
			return;
		}
		for (const row of g.rows) this.renderCard(body, row);
	}

	/** 单条关系卡片：角色对（带类型图标）+ 类型徽章 + 状态指示点 + 描述；**双击**打开来源文档（单击不触发，避免误触） */
	private renderCard(parent: HTMLElement, row: RelRow): void {
		const card = parent.createDiv({ cls: "aw-rel-card" });
		const line = card.createDiv({ cls: "aw-rel-pair" });
		const icon = line.createSpan({ cls: "aw-rel-typeicon" });
		setIcon(icon, relationshipTypeIcon(row.type));
		line.createSpan({ text: row.a || "（未命名）", cls: "aw-rel-name" });
		if (row.b) {
			line.createSpan({ text: "↔", cls: "aw-dim aw-rel-arrow" });
			line.createSpan({ text: row.b, cls: "aw-rel-name" });
		}
		const meta = card.createDiv({ cls: "aw-rel-meta" });
		meta.createSpan({ text: row.type.trim() || "未标注类型", cls: "aw-rel-badge" + (row.type.trim() ? "" : " is-empty") });
		const kind = relationshipStatusKind(row.status);
		const st = meta.createSpan({ cls: `aw-rel-status is-${kind}` });
		st.createSpan({ cls: "aw-rel-dot" });
		st.appendText(row.status.trim() || "未标注状态");
		meta.createSpan({ text: SCOPE_LABEL[row.scope], cls: "aw-rel-scope" });
		if (row.desc) card.createDiv({ text: row.desc, cls: "aw-rel-desc" });
		card.setAttribute("title", `双击在编辑器中打开来源文档：${row.sourcePath}`);
		card.addEventListener("dblclick", () => void this.openFile(row.sourcePath));
	}

	// ---------- 节点连线图（「图表」展示方式） ----------

	/** 筛选后的关系行 → 节点/边：三层同名角色合并为一个节点，同一对角色重复登记合并为一条边 */
	private buildGraph(rows: RelRow[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
		const nodes = new Map<string, GraphNode>();
		const edges = new Map<string, GraphEdge>();
		const touch = (name: string, path: string): GraphNode => {
			let n = nodes.get(name);
			if (!n) {
				n = { name, degree: 0, sources: [path] };
				nodes.set(name, n);
			} else if (!n.sources.includes(path)) n.sources.push(path);
			return n;
		};
		for (const r of rows) {
			const a = r.a.trim();
			if (!a) continue;
			const na = touch(a, r.sourcePath);
			const b = r.b.trim();
			if (!b) continue; // 单角色条目：只贡献一个孤立节点（无边）
			const nb = touch(b, r.sourcePath);
			const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
			const cur = edges.get(key);
			if (!cur) {
				edges.set(key, {
					a,
					b,
					type: r.type.trim(),
					status: r.status.trim(),
					kind: relationshipStatusKind(r.status),
					desc: r.desc,
					count: 1,
					scope: r.scope,
					sourcePath: r.sourcePath,
				});
				na.degree += 1;
				nb.degree += 1;
				continue;
			}
			cur.count += 1; // 同一对角色在多层/多处登记：合并计数、类型取首个非空、状态取优先级最高者
			if (!cur.type) cur.type = r.type.trim();
			if (!cur.desc) cur.desc = r.desc;
			const kind = relationshipStatusKind(r.status);
			if ((STATUS_RANK[kind] ?? 9) < (STATUS_RANK[cur.kind] ?? 9)) {
				cur.kind = kind;
				cur.status = r.status.trim();
			}
		}
		return {
			nodes: Array.from(nodes.values()).sort((x, y) => y.degree - x.degree || x.name.localeCompare(y.name, "zh")),
			edges: Array.from(edges.values()),
		};
	}

	/**
	 * 图表主体：环形布局的节点连线图（筛选后节点集变化即重排）。
	 * 悬停节点高亮其全部邻接、悬停连线只高亮该条；双击节点/连线在编辑器打开来源文档。
	 * 布局与交互全本地计算（不读盘、不加依赖），沿用 `lastSnap` 重渲染。
	 */
	private renderGraph(snap: RelSnapshot): void {
		this.treeEl.empty();
		this.graphNodeEls.clear();
		this.graphEdgeEls = [];
		this.graphAdj.clear();
		const ph = this.placeholderFor(snap);
		if (ph) {
			this.treeEl.createDiv({ text: ph, cls: "aw-dim aw-st-hint" });
			return;
		}
		const q = this.filterText.trim().toLowerCase();
		const rows: RelRow[] = [];
		for (const g of snap.groups) for (const r of g.rows) if (!q || matchRow(r, q)) rows.push(r);
		const { nodes, edges } = this.buildGraph(rows);
		if (this.selectedChar && !nodes.some((n) => n.name === this.selectedChar)) this.selectedChar = null; // 筛选后选中角色不在图内则清除
		if (!nodes.length) {
			this.treeEl.createDiv({ text: `没有匹配「${this.filterText.trim()}」的关系。`, cls: "aw-dim aw-st-hint" });
			return;
		}
		const summary = this.treeEl.createDiv({ cls: "aw-dim aw-rel-summary" });
		summary.setText(
			`角色 ${String(nodes.length)} 个 · 关系 ${String(edges.length)} 条` +
				(q ? `（筛选自 ${String(snap.relCount)} 条）` : "") +
				"；单击节点在下方人物状态区查看该人物的设定信息（来自《人物.md》），双击节点/连线打开来源文档，滚轮缩放、拖动平移"
		);

		const NS = "http://www.w3.org/2000/svg";
		const mk = (tag: string): SVGElement => document.createElementNS(NS, tag);
		const W = GRAPH_BASE_W;
		const H = GRAPH_BASE_H;
		const cx = W / 2;
		const cy = H / 2;
		const R = Math.min(W, H) / 2 - 88; // 留出节点名文字的位置
		const svg = mk("svg");
		svg.setAttribute("class", "aw-rel-graph");
		svg.setAttribute("viewBox", `0 0 ${String(W)} ${String(H)}`);
		svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
		const pos = new Map<string, { x: number; y: number; r: number }>();
		nodes.forEach((n, i) => {
			const ang = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
			pos.set(n.name, { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), r: 5 + Math.min(7, n.degree * 1.6) });
		});
		for (const e of edges) {
			if (!this.graphAdj.has(e.a)) this.graphAdj.set(e.a, new Set());
			if (!this.graphAdj.has(e.b)) this.graphAdj.set(e.b, new Set());
			this.graphAdj.get(e.a)?.add(e.b);
			this.graphAdj.get(e.b)?.add(e.a);
		}
		for (const e of edges) {
			const pa = pos.get(e.a);
			const pb = pos.get(e.b);
			if (!pa || !pb) continue;
			const g = mk("g");
			g.setAttribute("class", `aw-rel-gedge ${relationshipTypeClass(e.type)} is-${e.kind}${e.count > 1 ? " is-multi" : ""}`);
			const hit = mk("line"); // 透明加粗命中区：细线也易点中
			hit.setAttribute("class", "aw-rel-gedgehit");
			const line = mk("line");
			line.setAttribute("class", "aw-rel-gline");
			for (const el of [hit, line]) {
				el.setAttribute("x1", String(pa.x));
				el.setAttribute("y1", String(pa.y));
				el.setAttribute("x2", String(pb.x));
				el.setAttribute("y2", String(pb.y));
			}
			const tipLines: string[] = [
				`${e.a} ↔ ${e.b}`,
				`类型：${e.type || "未标注"}`,
				`状态：${e.status || "未标注"}`,
				`层级：${SCOPE_LABEL[e.scope]}`,
			];
			if (e.count > 1) tipLines.push(`登记 ${String(e.count)} 处`);
			if (e.desc) tipLines.push("", e.desc); // 描述独立成段，与元数据视觉分开
			const tipText = tipLines.join("\n");
			g.appendChild(hit);
			g.appendChild(line);
			// 不用 SVG <title>（浏览器原生 tooltip 截断多行内容、desc 长就显示不全），改用自定义 HTML tip 浮层：position:fixed + 跟手 + 自适应换行
			g.addEventListener("mouseenter", (ev: MouseEvent) => {
				this.focusGraph(e.a, e.b);
				this.showEdgeTip(tipText, ev);
			});
			g.addEventListener("mousemove", (ev: MouseEvent) => { this.moveEdgeTip(ev); });
			g.addEventListener("mouseleave", () => {
				this.focusGraph(null, null);
				this.hideEdgeTip();
			});
			g.addEventListener("dblclick", () => void this.openFile(e.sourcePath)); // 双击打开（单击不触发）
			svg.appendChild(g);
			this.graphEdgeEls.push({ el: g, a: e.a, b: e.b });
		}
		for (const n of nodes) {
			const p = pos.get(n.name);
			if (!p) continue;
			const g = mk("g");
			g.setAttribute("class", "aw-rel-gnode" + (n.degree ? "" : " is-orphan") + (this.selectedChar === n.name ? " is-sel" : ""));
			const dot = mk("circle");
			dot.setAttribute("cx", String(p.x));
			dot.setAttribute("cy", String(p.y));
			dot.setAttribute("r", String(p.r));
			const dir = p.x >= cx ? 1 : -1;
			const label = mk("text");
			label.setAttribute("class", "aw-rel-gname");
			label.setAttribute("x", String(p.x + dir * (p.r + 6)));
			label.setAttribute("y", String(p.y + 4));
			label.setAttribute("text-anchor", Math.abs(p.x - cx) < 26 ? "middle" : dir > 0 ? "start" : "end");
			label.textContent = n.name.length > 8 ? `${n.name.slice(0, 7)}…` : n.name;
			const tip = mk("title");
			tip.textContent = `${n.name}：${String(n.degree)} 条关系\n双击打开来源文档：${n.sources[0]}`;
			g.appendChild(dot);
			g.appendChild(label);
			g.appendChild(tip);
			g.addEventListener("mouseenter", () => { this.focusGraph(n.name, null); });
			g.addEventListener("mouseleave", () => { this.focusGraph(null, null); });
			// 单击＝选中并在下方「人物状态」区展示该角色详情（拖拽平移后的伪点击已被 svg 捕获阶段拦下，不会走到这里）；再次点同一节点保持选中不变
			g.addEventListener("click", () => {
				if (this.selectedChar === n.name) return;
				this.selectedChar = n.name;
				if (this.lastSnap && this.mode === "graph") this.renderBody(this.lastSnap);
			});
			g.addEventListener("dblclick", () => void this.openFile(n.sources[0])); // 双击打开来源文档
			svg.appendChild(g);
			this.graphNodeEls.set(n.name, g as SVGGElement);
		}
		this.treeEl.appendChild(svg);

		// 缩放与平移都走 CSS transform（保留 viewBox，故图形与角色名文字一起等比缩放、不重算布局、不重建 DOM）：
		// scale 以 svg 自身中心为原点，translate 是屏幕像素偏移；滚轮触发缩放（以鼠标位置为不动点更新 pan，mx 已在 svg layout 内坐标系），按住图面拖动可平移查看被裁部分（容器 overflow:hidden，不出滚动条）。
		const applyView = (): void => {
			const z = this.graphZoom;
			const w = this.treeEl.clientWidth;
			const h = this.treeEl.clientHeight;
			const bw = svg.clientWidth; // 布局尺寸（未 transform），视觉尺寸 = 布局尺寸 × 倍率
			const bh = svg.clientHeight;
			const vw = bw * z;
			const vh = bh * z;
			const baseX = (bw - vw) / 2; // 未平移时视觉框左上角（scale 以 svg 中心为原点）
			const baseY = (bh - vh) / 2;
			const loX = Math.min(-baseX, w - vw - baseX);
			const hiX = Math.max(-baseX, w - vw - baseX);
			const loY = Math.min(-baseY, h - vh - baseY);
			const hiY = Math.max(-baseY, h - vh - baseY);
			this.graphPan.x = clampNum(this.graphPan.x, loX, hiX); // 限位：图形不会被拖到视野外找不回来
			this.graphPan.y = clampNum(this.graphPan.y, loY, hiY);
			svg.style.transform = `translate(${this.graphPan.x.toFixed(1)}px, ${this.graphPan.y.toFixed(1)}px) scale(${String(z)})`;
		};
		// 缩放到下一档并以鼠标位置为不动点更新 pan——保持鼠标下的图点在缩放前后屏幕位置不变。
		// 输入 mxView/myView 是 viewport 坐标（ev.clientX/Y），需先换算到 svg 元素 layout 偏移与 ecX/ecY 同坐标系（都是 layout 像素、与 pan 单位一致），否则 mix viewport + layout 像素会让"鼠标不动点"偏移。
		const zoomAt = (dir: number, mxView: number, myView: number): void => {
			const i = GRAPH_ZOOMS.indexOf(this.graphZoom);
			const cur = i < 0 ? GRAPH_ZOOMS.indexOf(1) : i;
			const nextIdx = Math.min(GRAPH_ZOOMS.length - 1, Math.max(0, cur + dir));
			const next = GRAPH_ZOOMS[nextIdx];
			if (next === this.graphZoom) return;
			const rect = svg.getBoundingClientRect(); // viewport 坐标系下的 svg 盒矩形（视觉尺寸，已包含 scale）
			const bw = svg.clientWidth; // 布局尺寸（不受 transform 影响，与 rect.width 在 z=1 时一致；z!=1 时 rect.width = bw*z）
			const bh = svg.clientHeight;
			const mx = mxView - rect.left; // 鼠标在 svg 元素内的水平 layout 偏移
			const my = myView - rect.top;
			const ecX = bw / 2; // svg 布局中心（layout 坐标）
			const ecY = bh / 2;
			const k = next / this.graphZoom;
			this.graphPan.x = mx - ecX - k * (mx - ecX - this.graphPan.x);
			this.graphPan.y = my - ecY - k * (my - ecY - this.graphPan.y);
			this.graphZoom = next;
			applyView();
		};
		applyView();

		// 滚轮缩放：deltaY 累计 |>= 50| 时切一档（向下滑=缩小、上滑=放大），以鼠标位置为不动点
		let wheelAcc = 0;
		const WHEEL_STEP = 50;
		svg.addEventListener("wheel", (ev: WheelEvent) => {
			ev.preventDefault(); // 防止滚轮冒泡触发 Obsidian 主滚动条跳
			wheelAcc += ev.deltaY;
			if (Math.abs(wheelAcc) < WHEEL_STEP) return;
			zoomAt(wheelAcc > 0 ? -1 : 1, ev.clientX, ev.clientY);
			wheelAcc = 0;
		}, { passive: false });

		// 鼠标拖动平移：按下起拖（记住屏幕起点与当次偏移），pointermove/pointerup 挂到 document 上，拖出面板也跟手
		let dragFrom: { x: number; y: number; tx: number; ty: number } | null = null;
		let dragged = false; // 本次手势是否真的拖过：用于吃掉松手时紧随的 click，避免拖完误打开角色/关系文档
		const onDragMove = (ev: PointerEvent): void => {
			if (!dragFrom) return;
			this.graphPan.x = dragFrom.tx + (ev.clientX - dragFrom.x);
			this.graphPan.y = dragFrom.ty + (ev.clientY - dragFrom.y);
			if (!dragged && Math.abs(ev.clientX - dragFrom.x) + Math.abs(ev.clientY - dragFrom.y) > 3) {
				dragged = true;
				svg.classList.add("is-panning");
			}
			applyView();
		};
		const endDrag = (): void => {
			dragFrom = null;
			svg.classList.remove("is-panning");
			document.removeEventListener("pointermove", onDragMove);
			document.removeEventListener("pointerup", endDrag);
			window.setTimeout(() => { dragged = false; }, 0); // 等紧随其后的 click 先被拦下再复位
		};
		svg.addEventListener("pointerdown", (ev: PointerEvent) => {
			if (ev.button !== 0) return; // 只响应左键
			dragFrom = { x: ev.clientX, y: ev.clientY, tx: this.graphPan.x, ty: this.graphPan.y };
			dragged = false;
			document.addEventListener("pointermove", onDragMove);
			document.addEventListener("pointerup", endDrag);
			ev.preventDefault(); // 拖动期间不选中文字
		});
		svg.addEventListener("click", (ev: MouseEvent) => {
			if (!dragged) return;
			ev.stopPropagation(); // 捕获阶段拦下：拖到一半松手不该被当成点击/双击打开文档
			ev.preventDefault();
			dragged = false;
		}, true);
		svg.addEventListener("dblclick", (ev: MouseEvent) => {
			if (!dragged) return;
			ev.stopPropagation();
			ev.preventDefault();
		}, true);

		const used = new Set(edges.map((e) => relationshipTypeClass(e.type)));
		const legend = this.treeEl.createDiv({ cls: "aw-dim aw-rel-glegend" });
		legend.createSpan({ text: "边色：" });
		for (const [cls, label] of TYPE_CLASS_LABELS) {
			if (!used.has(cls)) continue;
			const item = legend.createSpan({ cls: "aw-rel-glegend-item" });
			item.createSpan({ cls: `aw-rel-glegend-swatch ${cls}` });
			item.appendText(label);
		}
		const legend2 = this.treeEl.createDiv({ cls: "aw-dim aw-rel-glegend" });
		legend2.setText("线型：实线=进行中 · 虚线=铺垫中 · 点线=已结束；加粗=同一对角色在多处登记");

		// 「人物状态」区：固定在图下方，展示单击选中角色的设定信息（来自《人物.md》，未选中时给引导文案）
		this.renderCharInfo(this.treeEl.createDiv({ cls: "aw-rel-charinfo" }), snap);
	}

	/**
	 * 「人物状态」区（图表模式主体底部）：无选中＝标题＋引导文案；有选中＝角色名＋× 清除按钮，
	 * 其下展示该角色的**设定信息**——按名精确匹配快照 chars（全部三层《人物.md》的解析条目），
	 * 同名多层登记时逐条各出一块（层级标签＋「打开文档」＋身份/年龄/性别/性格/外貌/背景/能力/备注字段行）。
	 */
	private renderCharInfo(parent: HTMLElement, snap: RelSnapshot): void {
		const head = parent.createDiv({ cls: "aw-rel-charhead" });
		head.createSpan({ text: "人物状态", cls: "aw-rel-chartitle" });
		const name = this.selectedChar;
		if (!name) {
			parent.createDiv({ text: "点击图表中的角色节点，这里显示该人物的设定信息。", cls: "aw-dim aw-st-hint" });
			return;
		}
		head.createSpan({ text: name, cls: "aw-rel-charselect" });
		const close = head.createSpan({ text: "×", cls: "aw-rel-charclose" });
		close.setAttribute("title", "清除选中");
		close.addEventListener("click", () => {
			this.selectedChar = null;
			if (this.lastSnap && this.mode === "graph") this.renderBody(this.lastSnap);
		});
		const entries = snap.chars.filter((c) => c.name === name);
		if (!entries.length) {
			parent.createDiv({ text: "《人物.md》里还没有这个人物的设定（可用顶部「添加人物」补录）。", cls: "aw-dim aw-st-hint" });
			return;
		}
		for (const e of entries) this.renderCharEntry(parent, e);
	}

	/** 「人物状态」区单块：层级标签＋「打开文档」链接＋非空字段行（能力多项以顿号连接） */
	private renderCharEntry(parent: HTMLElement, e: RelCharInfo): void {
		const box = parent.createDiv({ cls: "aw-rel-charentry" });
		const head = box.createDiv({ cls: "aw-rel-charenty-head" });
		head.createSpan({ text: e.label, cls: "aw-dim aw-rel-charscope" });
		const link = head.createSpan({ text: "打开文档", cls: "aw-rel-openfile" });
		link.setAttribute("title", e.sourcePath);
		link.addEventListener("click", () => void this.openFile(e.sourcePath));
		const abilities = (e.abilities ?? []).join("、");
		const fields: Array<[string, string | undefined]> = [
			["身份", e.identity], ["年龄", e.age], ["性别", e.gender], ["性格", e.personality],
			["外貌", e.appearance], ["背景", e.background], ["能力", abilities || undefined], ["备注", e.notes],
		];
		for (const [k, v] of fields) {
			if (!v?.trim()) continue; // 未填字段不占位（含空数组的能力）
			const row = box.createDiv({ cls: "aw-rel-charfield" });
			row.createSpan({ text: k, cls: "aw-rel-charflabel" });
			row.appendText(v.trim());
		}
	}

	/** 悬停高亮：a=角色名（悬停节点，连带其邻接）或边的两端；两者皆空则复原 */
	private focusGraph(a: string | null, b: string | null): void {
		let hot: Set<string> | null = null;
		if (a) {
			hot = new Set<string>([a]);
			if (b) hot.add(b);
			for (const n of Array.from(hot)) for (const nb of this.graphAdj.get(n) ?? []) hot.add(nb);
		}
		for (const [name, el] of this.graphNodeEls) {
			const on = hot != null && hot.has(name);
			el.classList.toggle("is-hot", on);
			el.classList.toggle("is-fade", hot != null && !on);
		}
		for (const e of this.graphEdgeEls) {
			const on = hot != null && hot.has(e.a) && hot.has(e.b);
			e.el.classList.toggle("is-hot", on);
			e.el.classList.toggle("is-fade", hot != null && !on);
		}
	}

	private async openFile(path: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return;
		await this.app.workspace.getLeaf().openFile(f);
	}

	/** 自定义边 tip：填内容并显示，跟手定位；越界则翻向鼠标左/上避免被视口裁切。必须先 addClass 显示，否则 display:none 下读到的 offsetWidth/Height 恒为 0，翻转判断失效会让长 tip 溢出视口底部看不见 */
	private showEdgeTip(text: string, ev: MouseEvent): void {
		const el = this.edgeTipEl;
		if (!el) return;
		el.setText(text);
		el.addClass("is-show"); // 先显示才能读到真实尺寸
		this.moveEdgeTip(ev);
	}

	/** 边 tip 跟手：默认放鼠标右下，右侧/下方越界则翻到左/上 */
	private moveEdgeTip(ev: MouseEvent): void {
		const el = this.edgeTipEl;
		if (!el || !el.hasClass("is-show")) return;
		const tipW = el.offsetWidth;
		const tipH = el.offsetHeight;
		const margin = 12;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		let x = ev.clientX + margin;
		let y = ev.clientY + margin;
		if (x + tipW + margin > vw) x = ev.clientX - margin - tipW;
		if (y + tipH + margin > vh) y = ev.clientY - margin - tipH;
		if (x < margin) x = margin;
		if (y < margin) y = margin;
		el.style.left = `${String(x)}px`;
		el.style.top = `${String(y)}px`;
	}

	/** 隐藏边 tip */
	private hideEdgeTip(): void {
		this.edgeTipEl?.removeClass("is-show");
	}
}
