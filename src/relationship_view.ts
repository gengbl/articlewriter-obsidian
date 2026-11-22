import { ItemView, Menu, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { docLocationLabel, relationshipStatusKind } from "./md_docs";
import type { RelationshipEntry } from "./md_docs";
import { adjacencyMap, edgeCurvePath, forceLayout, labelFontSize } from "./graph_layout";
import type { GraphLayoutNode } from "./graph_layout";

/** 关系所属层级（书根 / 卷 / 章） */
export type RelScope = "book" | "volume" | "chapter";

/** 面板层级词唯一口径（v0.4.9+ 导出＝main.ts「编辑人物」的级别行也用它拼「所在位置」＝与分组标题/卡片标签同一组词）：书籍级／卷级／章级 */
export const REL_SCOPE_WORDS: Record<RelScope, string> = { book: "书籍级", volume: "卷级", chapter: "章级" };

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
	storyDir: string; // v0.4.9+ 当前书的书籍目录＝「所在位置」文案要剥掉的前缀（同场景／时间线面板口径；没选小说＝空串）
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

/** 力导向布局参数：pad＝四周留白（节点名要落在画布内），hubUp＝枢纽（连线最多的人物≈主角）从画布中心往上提的比例 */
const GRAPH_FORCE_PAD = 58;
const GRAPH_FORCE_ITERS = 340;
const GRAPH_HUB_UP = 0.34;

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
 * 两者都支持按角色/类型/状态筛选，**双击**关系卡片/连线在编辑器打开来源文件（单击不触发，避免误触）；
 * **人物**（图表节点、「人物状态」区、卡片里的角色名）上有统一的**右键菜单**（`openCharMenu`＝编辑人物／改名／打开来源文档／设为中心人物／新增人物／**删除恒排最后**）；
 * **双击人物＝只弹编辑人物弹窗**（v0.4.9+，不带动别的响应：旧「以该人物为中心重画」移入右键菜单「设为中心人物」＝`graphCenter`，默认中心＝《人物.md》标注的主角，无标注则连线最多者，几何在 graph_layout.ts `forceLayout` 的 `centerName`；「单击＝选中人物」延后 220ms 落地，双击到达即取消＝双击不会顺带选中与重绘）。
 * 数据经构造注入的 getter 实时读取；文件变更由 main.ts 防抖调 refresh()。
 * 渲染陷阱同 StatusView / LlmChatView：UI 必须建在 onOpen 的 contentEl（本环境不调用 getEmptyStateElement）。
 */
export class RelationshipView extends ItemView {
	static readonly VIEW_TYPE = "articlewriter-relationships";

	private getData: () => Promise<RelSnapshot>;
	private onAddCharacter?: () => void | Promise<void>;
	private onRenameCharacter?: (name: string) => void | Promise<void>;
	private onEditCharacter?: (name: string) => void | Promise<void>; // v0.4.9+ 双击人物／右键「编辑人物」＝main.ts 的人物编辑弹窗（级别＋设定字段）
	private onDeleteCharacter?: (name: string) => void | Promise<void>; // v0.4.9+ 右键「删除人物」＝main.ts 的二次确认删除流程（连带清理场景引用）
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
	/** 展示方式（会话内保持，不落盘）：卡片列表 / 节点连线图；v0.4.8+ 默认＝图表 */
	private mode: "list" | "graph" = "graph";
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
	/** v0.4.8+ 图视图中心人物（会话内保持）：v0.4.9+ 由右键菜单「设为中心人物」设置、「恢复默认中心」清除；默认中心＝主角（见 defaultCenterName） */
	private graphCenter: string | null = null;
	/** v0.4.9+ 「单击选中」的延后定时器（＝用户要求＝**双击人物只响应编辑弹窗**：选中＋重绘先压一拍，双击到达即取消；再次点击/面板关闭时清掉） */
	private charPickTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		getData: () => Promise<RelSnapshot>,
		onAddCharacter?: () => void | Promise<void>,
		onRenameCharacter?: (name: string) => void | Promise<void>,
		onEditCharacter?: (name: string) => void | Promise<void>,
		onDeleteCharacter?: (name: string) => void | Promise<void>
	) {
		super(leaf);
		this.getData = getData;
		this.onAddCharacter = onAddCharacter; // v0.2.0+：头部「添加人物」按钮的动作（弹窗由 main.ts 提供，面板不自持业务逻辑）
		this.onRenameCharacter = onRenameCharacter; // v0.2.x+：人物状态区「改名」动作（全书同步替换 + 自动备份，由 main.ts 提供）
		this.onEditCharacter = onEditCharacter; // v0.4.9+：双击人物／右键「编辑人物」＝同一弹窗
		this.onDeleteCharacter = onDeleteCharacter; // v0.4.9+：右键「删除人物」（main.ts 里二次确认后才落盘）
	}

	/** 角色改名成功后同步「人物状态」区的选中名（避免刷新后仍按旧名筛选而显示为空）；数据刷新由 main.ts 统一调度 */
	handleRenamed(oldName: string, newName: string): void {
		if (this.selectedChar === oldName) this.selectedChar = newName;
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
		this.cancelCharPick(); // 「单击选中」还没落地就关面板＝别在背后重渲染
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
		else summary.setText(`共 ${String(snap.relCount)} 条：` + groups.map((g) => `${REL_SCOPE_WORDS[g.scope]} ${String(g.rows.length)}`).join(" · "));
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
		head.createSpan({ text: `${REL_SCOPE_WORDS[g.scope]}（${String(g.rows.length)}）`, cls: "aw-rel-grouptitle" });
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
		const nameA = line.createSpan({ text: row.a || "（未命名）", cls: "aw-rel-name" });
		this.bindCharMenu(nameA, row.a, row.sourcePath); // v0.4.9+ 卡片里的角色名右键＝与图表节点同一份人物菜单（卡片模式没有节点，菜单照样用得上）
		if (row.b) {
			line.createSpan({ text: "↔", cls: "aw-dim aw-rel-arrow" });
			const nameB = line.createSpan({ text: row.b, cls: "aw-rel-name" });
			this.bindCharMenu(nameB, row.b, row.sourcePath);
		}
		const meta = card.createDiv({ cls: "aw-rel-meta" });
		meta.createSpan({ text: row.type.trim() || "未标注类型", cls: "aw-rel-badge" + (row.type.trim() ? "" : " is-empty") });
		const kind = relationshipStatusKind(row.status);
		const st = meta.createSpan({ cls: `aw-rel-status is-${kind}` });
		st.createSpan({ cls: "aw-rel-dot" });
		st.appendText(row.status.trim() || "未标注状态");
		meta.createSpan({ text: REL_SCOPE_WORDS[row.scope], cls: "aw-rel-scope" });
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
	 * 图表主体：力导向布局的节点连线图（筛选后节点集变化即重排）。
	 * 布局与分级全在 graph_layout.ts（`forceLayout` 出坐标：枢纽≈主角居中偏上、按连线数放大圆点与字号；`edgeCurvePath` 出弧线 path），
	 * 本方法只负责建 SVG 与挂交互。悬停节点高亮其全部邻接、悬停连线只高亮该条；双击节点/连线在编辑器打开来源文档。
	 * 节点按邻接链**倒序**绘制，让枢纽叠在最上层；邻接表 `graphAdj` 改由共用的 `adjacencyMap` 生成。
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
		if (this.graphCenter && !nodes.some((n) => n.name === this.graphCenter)) this.graphCenter = null; // 中心人物被筛掉＝回默认
		if (!nodes.length) {
			this.treeEl.createDiv({ text: `没有匹配「${this.filterText.trim()}」的关系。`, cls: "aw-dim aw-st-hint" });
			return;
		}
		const centerName = this.graphCenter ?? this.defaultCenterName(nodes, snap);
		const summary = this.treeEl.createDiv({ cls: "aw-dim aw-rel-summary" });
		summary.setText(
			`角色 ${String(nodes.length)} 个 · 关系 ${String(edges.length)} 条` +
				(q ? `（筛选自 ${String(snap.relCount)} 条）` : "") +
				"；圆点／名字越大＝关系越多" +
				`；现在居中的人物＝${centerName || "（连线最多者）"}` +
				"；双击人物＝编辑人物（不带动别的响应），右键人物＝菜单（编辑／改名／打开来源文档／设为中心人物／新增／删除），双击连线打开来源文档，滚轮缩放、拖动平移"
		);

		const NS = "http://www.w3.org/2000/svg";
		const mk = (tag: string): SVGElement => document.createElementNS(NS, tag);
		const W = GRAPH_BASE_W;
		const H = GRAPH_BASE_H;
		const cx = W / 2;
		const cy = H / 2;
		const svg = mk("svg");
		svg.setAttribute("class", "aw-rel-graph");
		svg.setAttribute("viewBox", `0 0 ${String(W)} ${String(H)}`);
		svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
		// 力导向布局（几何全在 graph_layout.ts）：中心人物（双击选定，默认＝主角）钉在画布正中、至亲聚在身边、次要人物散到外圈
		const layout = forceLayout(
			nodes.map((n) => ({ name: n.name, degree: n.degree })),
			edges.map((e) => ({ a: e.a, b: e.b, weight: e.count })),
			{ width: W, height: H, pad: GRAPH_FORCE_PAD, iterations: GRAPH_FORCE_ITERS, hubUp: GRAPH_HUB_UP, centerName },
		);
		const pos = new Map<string, GraphLayoutNode>();
		for (const p of layout) pos.set(p.name, p);
		const hubName = layout.length ? layout[0].name : ""; // forceLayout 的第一位＝生效中心（centerName 存在时＝中心人物，否则连线最多者）
		this.graphAdj = adjacencyMap(edges); // 悬停高亮用的邻接表（与排序同一份口径）
		for (const e of edges) {
			const pa = pos.get(e.a);
			const pb = pos.get(e.b);
			if (!pa || !pb) continue;
			const g = mk("g");
			g.setAttribute("class", `aw-rel-gedge ${relationshipTypeClass(e.type)} is-${e.kind}${e.count > 1 ? " is-multi" : ""}`);
			const d = edgeCurvePath(pa, pb); // 向上拱的二次贝塞尔弧（见 graph_layout.ts）
			const hit = mk("path"); // 透明加粗命中区：弧线也易点中
			hit.setAttribute("class", "aw-rel-gedgehit");
			hit.setAttribute("d", d);
			const curve = mk("path");
			curve.setAttribute("class", "aw-rel-gline"); // 类名沿用 gline（配色/线型/高亮规则全挂在它上面）
			curve.setAttribute("d", d);
			const tipLines: string[] = [
				`${e.a} ↔ ${e.b}`,
				`类型：${e.type || "未标注"}`,
				`状态：${e.status || "未标注"}`,
				`层级：${REL_SCOPE_WORDS[e.scope]}`,
			];
			if (e.count > 1) tipLines.push(`登记 ${String(e.count)} 处`);
			if (e.desc) tipLines.push("", e.desc); // 描述独立成段，与元数据视觉分开
			const tipText = tipLines.join("\n");
			g.appendChild(hit);
			g.appendChild(curve);
			// 不用 SVG <title>（浏览器原生 tooltip 截断多行内容、desc 长就显示不全），改用自定义 HTML tip 浮层：position:fixed + 跟手 + 自适应换行
			g.addEventListener("mouseenter", (ev: MouseEvent) => {
				if (dragFrom) return; // v0.4.8+ 按下起拖后不再响应悬停：拖图扫过节点/连线不高亮、不弹边 tip
				this.focusGraph(e.a, e.b);
				this.showEdgeTip(tipText, ev);
			});
			g.addEventListener("mousemove", (ev: MouseEvent) => { if (dragFrom) return; this.moveEdgeTip(ev); });
			g.addEventListener("mouseleave", () => {
				if (dragFrom) return;
				this.focusGraph(null, null);
				this.hideEdgeTip();
			});
			g.addEventListener("dblclick", () => void this.openFile(e.sourcePath)); // 双击打开（单击不触发）
			svg.appendChild(g);
			this.graphEdgeEls.push({ el: g, a: e.a, b: e.b });
		}
		const byName = new Map<string, GraphNode>();
		for (const n of nodes) byName.set(n.name, n);
		// 按邻接链的**倒序**画节点：链首＝枢纽（连线最多的人物）最后画 → 叠在所有节点最上层，不被别人压住
		for (let i = layout.length - 1; i >= 0; i--) {
			const p = layout[i];
			const n = byName.get(p.name);
			if (!n) continue;
			const g = mk("g");
			g.setAttribute(
				"class",
				"aw-rel-gnode" + (n.degree ? "" : " is-orphan") + (p.name === hubName ? " is-hub" : "") + (this.selectedChar === n.name ? " is-sel" : ""),
			);
			const dot = mk("circle");
			dot.setAttribute("cx", String(p.x));
			dot.setAttribute("cy", String(p.y));
			dot.setAttribute("r", String(p.r));
			const fs = labelFontSize(n.degree); // 字号随重要度分级（枢纽最大）
			const label = mk("text");
			label.setAttribute("class", "aw-rel-gname");
			label.style.fontSize = `${String(fs)}px`;
			const dir = p.x >= cx ? 1 : -1;
			const stacked = Math.abs(p.x - cx) < 34; // 居中竖带上的节点（含枢纽）：名字放到上/下方，不压左右伸出的连线
			label.setAttribute("x", String(stacked ? p.x : p.x + dir * (p.r + 6)));
			label.setAttribute("y", String(stacked ? (p.y >= cy ? p.y + p.r + fs + 1 : p.y - p.r - 7) : p.y + fs * 0.36));
			label.setAttribute("text-anchor", stacked ? "middle" : dir > 0 ? "start" : "end");
			label.textContent = n.name.length > 8 ? `${n.name.slice(0, 7)}…` : n.name;
			const tip = mk("title");
			tip.textContent = `${n.name}：${String(n.degree)} 条关系\n双击＝编辑人物（无别的响应）；右键＝菜单（编辑／改名／打开来源文档／设为中心人物／新增／删除）`;
			g.appendChild(dot);
			g.appendChild(label);
			g.appendChild(tip);
			g.addEventListener("mouseenter", () => { if (dragFrom) return; this.focusGraph(n.name, null); }); // v0.4.8+ 起拖期间不高亮
			g.addEventListener("mouseleave", () => { if (dragFrom) return; this.focusGraph(null, null); });
			// 单击＝选中并在下方「人物状态」区展示该角色详情（拖拽平移后的伪点击已被 svg 捕获阶段拦下，不会走到这里）；再次点同一节点保持选中不变。
			// v0.4.9+ 用户要求＝**双击人物只响应编辑弹窗**＝选中（含整图重绘）压 220ms，双击到达时取消＝双击不会顺带选中/重画，也不会触发浏览器选中文字
			g.addEventListener("click", (ev: MouseEvent) => {
				if (ev.detail > 1) return; // 双击的第二下不再排一次选中
				this.pickCharLater(n.name);
			});
			g.addEventListener("dblclick", (ev: MouseEvent) => {
				ev.preventDefault();
				ev.stopPropagation(); // 只弹编辑弹窗：不再触发选中/重绘，也不冒泡到 svg
				this.cancelCharPick();
				this.editChar(n.name);
			});
			g.addEventListener("contextmenu", (ev: MouseEvent) => {
				ev.preventDefault();
				ev.stopPropagation(); // 别一路冒泡到 svg／面板（那里另有空白处菜单语义时也不叠加）
				this.openCharMenu(ev, n.name, n.sources[0]); // v0.4.9+ 用户要求＝右键出菜单
			});
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
			if (dragged) { // v0.4.8+ 起拖期间高亮被抑制→可能残留按下前的那份邻接高亮/边 tip，真拖过就在松手时统一清掉（纯点击不动）
				this.focusGraph(null, null);
				this.hideEdgeTip();
			}
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
	 * 默认中心人物（v0.4.8+）：三层《人物.md》里**身份/备注含「主角/主人公/男主角/女主角」**、且出现在当前图节点里的第一个角色；
	 * 没有这种标记＝返回空串（forceLayout 回退「连线最多者≈主角」居中枢轴）。
	 */
	private defaultCenterName(nodes: GraphNode[], snap: RelSnapshot): string {
		const names = new Set(nodes.map((n) => n.name));
		for (const c of snap.chars) {
			if (!names.has(c.name)) continue;
			if (/主角|主人公/.test(`${c.identity ?? ""} ${c.notes ?? ""}`)) return c.name;
		}
		return "";
	}

	/**
	 * 「人物状态」区（图表模式主体底部）：无选中＝标题＋引导文案；有选中＝角色名＋× 清除按钮，
	 * 其下展示该角色的**设定信息**——按名精确匹配快照 chars（全部三层《人物.md》的解析条目），
	 * 同名多层登记时逐条各出一块（层级标签＋「打开文档」＋身份/年龄/性别/性格/外貌/背景/能力/备注字段行）。
	 */
	/** v0.4.9+ 快照里该人物的设定条目（按名精确匹配，多层登记时取第一条＝与「人物状态」区同口径）；查不到＝undefined */
	private charEntry(name: string): RelCharInfo | undefined {
		return this.lastSnap?.chars.find((c) => c.name === name);
	}

	/** 该人物所在《人物.md》的路径（＝「打开来源文档」的目标；《人物.md》里没登记＝null，调用方回退到关系文档） */
	private charDocPathOf(name: string): string | null {
		return this.charEntry(name)?.sourcePath ?? null;
	}

	/** 卡片里的角色名等普通元素挂人物菜单（v0.4.9+）＝右键弹 `openCharMenu`、双击＝编辑人物；名字为空（未命名角色）不挂 */
	private bindCharMenu(el: HTMLElement, name: string, fallbackPath?: string): void {
		const n = name.trim();
		if (!n) return;
		el.setAttribute("title", `双击＝编辑人物（无别的响应）；右键＝菜单（编辑／改名／打开来源文档／设为中心人物／新增／删除）：${n}`);
		el.addEventListener("contextmenu", (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation(); // 不叠加到卡片/面板
			this.openCharMenu(ev, n, fallbackPath);
		});
		el.addEventListener("dblclick", (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation(); // **只**弹编辑弹窗：卡片本身的「双击打开来源文档」与文字选中都不跟着触发
			this.editChar(n);
		});
	}

	/** **双击人物**（v0.4.9+ 用户要求）＝**只**弹人物编辑弹窗（图表节点与卡片里的角色名共用＝代码重用），不做别的响应 */
	private editChar(name: string): void {
		void this.onEditCharacter?.(name);
	}

	/** 单击选中人物（延后 220ms 落地＝给双击留出取消窗口，见 `editChar`）；同一节点重复点击＝保持选中不变、不重绘 */
	private pickCharLater(name: string): void {
		this.cancelCharPick();
		this.charPickTimer = window.setTimeout(() => {
			this.charPickTimer = null;
			if (this.selectedChar === name) return;
			this.selectedChar = name;
			if (this.lastSnap && this.mode === "graph") this.renderBody(this.lastSnap);
		}, 220);
	}

	/** 取消尚未落地的「单击选中」（双击／面板关闭／重新渲染时调用） */
	private cancelCharPick(): void {
		if (this.charPickTimer !== null) {
			window.clearTimeout(this.charPickTimer);
			this.charPickTimer = null;
		}
	}

	/**
	 * **人物右键菜单**（v0.4.9+ 用户要求＝图表节点、「人物状态」区、卡片里的角色名同一份菜单，代码重用；菜单顺序也照用户要求定）＝
	 * **编辑人物「X」**（第一项）→ 改名「X」（全书 MD 同步替换＋自动备份，与「角色改名」命令同流程）→ 打开来源文档（该人物的《人物.md》，没登记则回退关系文档）→
	 * **设为中心人物**（v0.4.8+ 原「双击节点＝以该人物为中心重画」移到这里；已是中心者这一项变「恢复默认中心」）→ 新增人物（＝头部「添加人物」）→
	 * **删除人物「X」恒排最后**（`danger` 分组＝自动带分隔线且排在末尾，同场景卡片菜单口径）。
	 * 没注入对应写动作回调时那一项自动不出现（＝面板未接线也不报错）。
	 */
	private openCharMenu(ev: MouseEvent, name: string, fallbackPath?: string): void {
		const menu = new Menu();
		const base = "aw-rel-char"; // 前五项同一 section＝中间不画分隔线；「删除」单列 danger 组＝排在最后（scene_view 卡片菜单同口径）
		if (this.onEditCharacter) menu.addItem((it) => it.setSection(base).setTitle(`编辑人物「${name}」`).setIcon("pencil").onClick(() => void this.onEditCharacter?.(name)));
		if (this.onRenameCharacter) menu.addItem((it) => it.setSection(base).setTitle(`改名「${name}」`).setIcon("text-cursor").onClick(() => void this.onRenameCharacter?.(name)));
		const docPath = this.charDocPathOf(name) ?? fallbackPath ?? "";
		if (docPath) menu.addItem((it) => it.setSection(base).setTitle("打开来源文档").setIcon("file-text").onClick(() => void this.openFile(docPath))); // 图标＝`file-text`（与场景/时间线面板同一份「打开来源文档」图标口径）
		const isCenter = this.graphCenter === name;
		menu.addItem((it) =>
			it
				.setSection(base)
				.setTitle(isCenter ? "恢复默认中心" : "设为中心人物")
				.setIcon(isCenter ? "undo-2" : "crosshair")
				.onClick(() => {
					this.graphCenter = isCenter ? null : name; // 会话内保持（与旧双击口径一致），清除＝回默认中心＝主角／连线最多者
					if (this.lastSnap) this.renderBody(this.lastSnap);
				})
		);
		if (this.onAddCharacter) menu.addItem((it) => it.setSection(base).setTitle("新增人物").setIcon("user-plus").onClick(() => void this.onAddCharacter?.()));
		if (this.onDeleteCharacter) menu.addItem((it) => it.setSection("danger").setTitle(`删除人物「${name}」`).setIcon("trash").onClick(() => void this.onDeleteCharacter?.(name)));
		menu.showAtPosition({ x: ev.x, y: ev.y });
	}

	private renderCharInfo(parent: HTMLElement, snap: RelSnapshot): void {
		const head = parent.createDiv({ cls: "aw-rel-charhead" });
		head.createSpan({ text: "人物状态", cls: "aw-rel-chartitle" });
		const name = this.selectedChar;
		if (!name) {
			parent.createDiv({ text: "点击图表中的角色节点，这里显示该人物的设定信息。", cls: "aw-dim aw-st-hint" });
			return;
		}
		head.createSpan({ text: name, cls: "aw-rel-charselect" });
		if (this.onRenameCharacter) {
			const rename = head.createSpan({ text: "改名", cls: "aw-rel-openfile" });
			rename.setAttribute("title", "全书 MD 同步替换旧名并自动备份");
			rename.addEventListener("click", (ev: MouseEvent) => {
				if (ev.detail > 1) return; // 连点两下＝只当双击用＝只弹一次改名输入框
				void this.onRenameCharacter?.(name);
			});
		}
		const close = head.createSpan({ text: "×", cls: "aw-rel-charclose" });
		close.setAttribute("title", "清除选中");
		close.addEventListener("click", () => {
			this.cancelCharPick(); // v0.4.9+ 「单击选中」还在 220ms 等待期就点 ×＝别在背后把人又选回来
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
		link.addEventListener("click", (ev: MouseEvent) => {
			if (ev.detail > 1) return; // 连点两下＝只当双击用（＝只弹一次编辑弹窗，见下面「编辑」链接）
			void this.openFile(e.sourcePath);
		});
		if (this.onEditCharacter) {
			const edit = head.createSpan({ text: "编辑", cls: "aw-rel-openfile" }); // v0.4.9+ 与双击图表节点／右键「编辑人物」同一个弹窗（卡片模式也用得上）
			edit.setAttribute("title", docLocationLabel(e.scope, e.sourcePath, this.lastSnap?.storyDir ?? "", REL_SCOPE_WORDS)); // 悬停给出「书籍级/卷级/章级 · 书内路径」
			edit.addEventListener("click", (ev: MouseEvent) => {
				if (ev.detail > 1) return; // 双击这里＝只弹一个编辑弹窗（第二下不再叠一个）
				void this.onEditCharacter?.(e.name);
			});
		}
		box.addEventListener("contextmenu", (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			this.openCharMenu(ev, e.name, e.sourcePath); // v0.4.9+ 右键这一块的菜单＝与图表节点同一份
		});
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
