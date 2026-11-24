import { ItemView, Menu, TFile, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import { docLocationLabel, relationshipStatusKind } from "./md_docs";
import type { RelationshipEntry } from "./md_docs";
import { adjacencyMap, edgeCurvePath, forceLayout, labelFontSize } from "./graph_layout";
import type { GraphLayoutNode } from "./graph_layout";
import { CanvasPanel, PANEL_ZOOM_MAX, PANEL_ZOOM_MIN } from "./panel_canvas"; // v0.4.11+ 图面缩放/平移**整体改用画布共用设施**（与场景/时间线同一份实现，不再自写 transform 数学）

/** 关系所属层级（书根 / 卷 / 章） */
export type RelScope = "book" | "volume" | "chapter";

/** 面板层级词唯一口径（v0.4.9+ 导出＝main.ts「编辑人物」的级别行也用它拼「所在位置」＝与分组标题/卡片标签同一组词）：书籍级／卷级／章级 */
export const REL_SCOPE_WORDS: Record<RelScope, string> = { book: "书籍级", volume: "卷级", chapter: "章级" };

/** 图视图一条边（可能合并多处登记）的写操作入参：供 main.ts 的编辑／删除弹窗定位源文档与预填表单 */
export interface RelEdgeEditInfo {
	a: string;
	b: string;
	type: string;
	status: string;
	desc: string;
	sourcePath: string;
	scope: RelScope;
	count: number; // 同一对角色被合并登记的条数（>1 时写操作只作用于首条，提示里说明）
}

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

/** 图视图缩放范围＝**直接用画布共用常量**（`panel_canvas.ts` 的 `PANEL_ZOOM_MIN`/`PANEL_ZOOM_MAX`＋其滚轮算法，与时间线/场景面板一字不差）
 *  ——v0.4.11+ 用户要求＝「滚动一次重新计算一次（不累加 deltaY）」＋「参考场景面板的放缩」，故废弃旧的固定档位表 `GRAPH_ZOOMS` 与面板内自写的滚轮/平移数学 */

/** 图视图画布尺寸口径（v0.4.11+ 改写）：图按**当前画布可视区**取尺寸（＝viewBox 与真实像素 1:1＝画布设施的滚动/缩放换算与图内坐标同一坐标系，
 *  不再靠 CSS 把固定 760×560 硬塞进面板）；下面两个常量＝**设计上限/默认量级**，另给下限防止面板被压到不可用 */
const GRAPH_BASE_W = 760; // 默认画布宽（面板更宽时也按可视宽取，见 graphBoxSize）
const GRAPH_BASE_H = 560; // 默认画布高
const GRAPH_MIN_W = 320; // 画布下限（窄侧栏也不至于把图挤成一团）
const GRAPH_MIN_H = 260; // 画布下限（短面板时宁可让画布区出滚动条）

/** 力导向布局参数：pad＝四周留白（节点名要落在画布内），hubUp＝枢纽（连线最多的人物≈主角）从画布中心往上提的比例 */
const GRAPH_FORCE_PAD = 58;
const GRAPH_FORCE_ITERS = 340;
const GRAPH_HUB_UP = 0.34;

/** 数值限位（状态区分隔条拖动的高度收敛用；v0.4.11+ 起图面平移不再限位） */
const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 「人物状态」区高度口径（v0.4.11+ 用户要求＝该区**不随选中内容自行改变大小**，只能拖它上缘的分隔条改）：
 *  默认 150px；下限 56px（至少露出「人物状态」标题行＋一行字段）；拖动时给上方图面至少留 CHARINFO_GRAPH_MIN px */
const CHARINFO_H_DEFAULT = 150;
const CHARINFO_H_MIN = 56;
const CHARINFO_GRAPH_MIN = 120;

/** v0.4.11+（「适应全图后一直闪」修正）＝视口宽度变化超过这个量才重排力导向布局：
 *  滚动条出现/消失只带来十几 px 的宽度抖动，低于该阈值就交给 `apply()` 重算尺寸即可（见 `lastGraphBoxW`） */
const GRAPH_RELAYOUT_MIN_DX = 20;

/** 「线型说明」图例行折叠口径（v0.4.11+ 用户要求＝该行可折叠）：收起态只剩线型一句话，
 *  加粗规则与滚轮/拖动/双击等操作说明收进点开部分；默认收起＝把竖直空间还给图面（图尺寸＝固定行之外剩余高度） */
const LEGEND2_SHORT = "线型：实线=进行中 · 虚线=铺垫中 · 点线=已结束";
const LEGEND2_REST = "；加粗=同一对角色在多处登记；Ctrl＋滚轮＝以鼠标为中心缩放（同场景/时间线面板，普通滚轮＝滚动画面）· 按住图面拖动＝平移（拖过边缘也能继续挪，双击空白处＝适应全图）· 空白处右键＝适应全图/刷新 · 头部倍率标签点一下＝回 100% · 鼠标停在人物上＝显示该人物的设定信息，单击＝下方「人物状态」区展示";

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
 * ②图表：环形布局的节点连线图（角色=节点、关系=连线，按类型着色、按状态变线型，悬停高亮邻接）；**节点圆点与旁边的名字文字是同一命中体**（v0.4.11+ 用户要求＝文字行为跟圆点完全一样，事件挂节点 `<g>`、放开 `.aw-rel-gname` 的 `pointer-events`）；图面交互＝**整体由画布共用设施 `CanvasPanel` 承担**（v0.4.11+ 重写＝与场景/时间线面板同一份代码：`Ctrl|Shift＋滚轮` 以鼠标为不动点连续缩放、倍率夹在 `PANEL_ZOOM_MIN/MAX`，普通滚轮＝原生滚动画面；按住拖动＝平移——滚动余量内驱动滚动条、用尽后虚拟平移层继续挪＝**任意方向无限位**，用户要求＝随意拖动；`双击图面空白处`＝适应全图＝`CanvasPanel.resetView()`；空白处右键菜单＝「适应全图／刷新」，照场景面板画布菜单；倍率标签挂在头部由 `attachZoomLabel` 负责）；图表上方不再渲染「角色 N 个 · 关系 M 条 …」统计＋操作说明行（v0.4.11+ 用户要求），口径改写到图下方图例行；**svg／节点／连线一律不挂 `<title>`**＝浏览器原生长条 tooltip 会与自定义方块 tip 同时出现（v0.4.11+ 用户要求＝只留方块那一份）；
 * 两者都支持按角色/类型/状态筛选，**双击**关系卡片/连线在编辑器打开来源文件（单击不触发，避免误触）；
 * **人物**（图表节点、「人物状态」区、卡片里的角色名）上有统一的**右键菜单**（`openCharMenu`＝编辑人物／改名／**合并 N 处登记**（只在该人物登记在两份以上《人物.md》时出现，v0.4.11+）／打开来源文档／设为中心人物／新增人物／**删除恒排最后**）；
 * **双击人物＝只弹编辑人物弹窗**（v0.4.9+，不带动别的响应：旧「以该人物为中心重画」移入右键菜单「设为中心人物」＝`graphCenter`，默认中心＝《人物.md》标注的主角，无标注则连线最多者，几何在 graph_layout.ts `forceLayout` 的 `centerName`；「单击＝选中人物」延后 220ms 落地，双击到达即取消＝双击不会顺带选中与重绘）。
 * 数据经构造注入的 getter 实时读取；文件变更由 main.ts 防抖调 refresh()。
 * 渲染陷阱同 StatusView / LlmChatView：UI 必须建在 onOpen 的 contentEl（本环境不调用 getEmptyStateElement）。
 */
export class RelationshipView extends ItemView {
	static readonly VIEW_TYPE = "articlewriter-relationships";

	private getData: () => Promise<RelSnapshot>;
	private onAddCharacter?: () => void | Promise<void>;
	private onAddRelationship?: (seedName?: string) => void | Promise<void>; // v0.4.11+ 头部「＋ 关系」＝main.ts 的添加人物关系弹窗（seed＝当前选中人物，预填为角色1）
	private onEditRelationship?: (info: RelEdgeEditInfo) => void | Promise<void>; // v0.4.11+ 双击连线／右键「编辑关系」＝同一份编辑弹窗
	private onDeleteRelationship?: (info: RelEdgeEditInfo) => void | Promise<void>; // v0.4.11+ 右键「删除关系」＝main.ts 二次确认后删块落盘
	private onRenameCharacter?: (name: string) => void | Promise<void>;
	private onEditCharacter?: (name: string) => void | Promise<void>; // v0.4.9+ 双击人物／右键「编辑人物」＝main.ts 的人物编辑弹窗（级别＋设定字段）
	private onDeleteCharacter?: (name: string) => void | Promise<void>; // v0.4.9+ 右键「删除人物」＝main.ts 的二次确认删除流程（连带清理场景引用）
	private onMergeCharacter?: (name: string) => void | Promise<void>; // v0.4.11+ 右键「合并人物信息」／状态区「合并」链接＝main.ts 的合并弹窗（选最终存储文档＋逐字段取值）
	private built = false;
	private rootEl!: HTMLElement;
	private topEl!: HTMLElement;
	private treeEl!: HTMLElement;
	/** 图表自定义 tip 浮层（挂在 document.body）＝**人物节点（圆点／名字文字）与关系连线共用同一份、同一样式**（v0.4.11+ 用户要求＝节点不再走 SVG `<title>`） */
	private graphTipEl: HTMLDivElement | null = null;
	/** 当前 tip 的归属（节点 `<g>`／连线 `<g>` 的元素引用）＝共用一份浮层后，节点与连线在交叠处彼此进出时只隐藏「自己那一份」，不会把对方刚显示的 tip 误关掉 */
	private graphTipOwner: Element | null = null;
	private busy = false;
	private lastSnap: RelSnapshot | null = null;
	/** v0.4.11+（「适应全图后一直闪」修正）＝上次建图时画布视口的 clientWidth：观察器回调里宽度变化小于
	 *  `GRAPH_RELAYOUT_MIN_DX` 不重渲染＝滚动条出现/消失带来的十几 px 抖动不再触发「重渲染→再抖动」的反馈环 */
	private lastGraphBoxW = 0;
	/** v0.4.11+ 「线型说明」图例行是否展开（用户要求＝可折叠；会话内保持不落盘，默认收起）＝收起态只留线型一句话，点开补出加粗规则与操作口径；
	 *  切换走整帧重渲染＝图高按新固定行高度重取（力导向确定性＝节点位置不跳，只是画布拉高/压矮） */
	private legendHelpOpen = false;
	private filterText = "";
	/** 分组收起态（会话内保持，不落盘；键 "rel:<scope>"） */
	private collapsed = new Set<string>();
	/** 展示方式（会话内保持，不落盘）：卡片列表 / 节点连线图；v0.4.8+ 默认＝图表 */
	private mode: "list" | "graph" = "graph";
	/** v0.4.11+ **图面缩放/平移整体改用画布共用设施 `CanvasPanel`**（与场景/时间线面板同一份实现：倍率、虚拟平移、滚动、
	 *  以鼠标为不动点的缩放、倍率标签全部由它负责；元素常驻＝不随重渲染销毁，彻底告别旧版「写到已脱离文档的旧 svg」那类坑） */
	private graphCanvas: CanvasPanel | null = null;
	/** v0.4.11+ 画布平移拖拽是否进行中（起拖期间不弹 tip、不高亮，沿用旧口径）；真拖过松手由 `onPanEnd` 回调清残留 */
	private graphPanning = false;
	/** v0.4.11+ 头部筛选行（倍率标签挂它上面；`renderTop` 每次重建时刷新引用） */
	private graphZoomHost: HTMLElement | null = null;
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
	/** v0.4.11+ 「人物状态」区高度（px，会话内保持不落盘）＝用户要求＝**点人物圆圈时状态区大小一律不动**（内容多它在自身内滚动，图不被挤得一跳），
	 *  要改大小只能拖动它上缘的分隔条（见 `beginCharResize`） */
	private charInfoH = CHARINFO_H_DEFAULT;
	/** v0.4.11+ 状态区与拖动分隔条的本次渲染物（`renderGraph` 每次重建；卡片模式与重渲染前置 null＝绝不去碰已脱离文档的旧节点） */
	private charInfoEl: HTMLElement | null = null;
	private charResizerEl: HTMLElement | null = null;
	/** v0.4.11+ 多文档展开态（用户要求＝**每个文档一个展开项**、默认折叠）＝已展开条目的键集合（键＝`sourcePath#该文档内第几条`，会话内保持；
	 *  选中别的人物即清空＝全部回到折叠，同一次选中内逐条各管各的） */
	private charDrawerOpenKeys = new Set<string>();
	/** v0.4.11+ 正在拖动分隔条的手势（起手 Y＋起始高度；document 级 move/up 收尾） */
	private charResize: { startY: number; startH: number } | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		getData: () => Promise<RelSnapshot>,
		onAddCharacter?: () => void | Promise<void>,
		onAddRelationship?: (seedName?: string) => void | Promise<void>,
		onEditRelationship?: (info: RelEdgeEditInfo) => void | Promise<void>,
		onDeleteRelationship?: (info: RelEdgeEditInfo) => void | Promise<void>,
		onRenameCharacter?: (name: string) => void | Promise<void>,
		onEditCharacter?: (name: string) => void | Promise<void>,
		onDeleteCharacter?: (name: string) => void | Promise<void>,
		onMergeCharacter?: (name: string) => void | Promise<void>
	) {
		super(leaf);
		this.getData = getData;
		this.onAddCharacter = onAddCharacter; // v0.2.0+：头部「添加人物」按钮的动作（弹窗由 main.ts 提供，面板不自持业务逻辑）
		this.onAddRelationship = onAddRelationship; // v0.4.11+：头部「＋ 关系」按钮的动作（弹窗同样由 main.ts 提供）
		this.onEditRelationship = onEditRelationship; // v0.4.11+：双击连线／右键菜单「编辑关系」
		this.onDeleteRelationship = onDeleteRelationship; // v0.4.11+：右键菜单「删除关系」
		this.onRenameCharacter = onRenameCharacter; // v0.2.x+：人物状态区「改名」动作（全书同步替换 + 自动备份，由 main.ts 提供）
		this.onEditCharacter = onEditCharacter; // v0.4.9+：双击人物／右键「编辑人物」＝同一弹窗
		this.onDeleteCharacter = onDeleteCharacter; // v0.4.9+：右键「删除人物」（main.ts 里二次确认后才落盘）
		this.onMergeCharacter = onMergeCharacter; // v0.4.11+：右键「合并 N 处登记」／状态区「合并」链接＝main.ts 的合并弹窗（选最终存储文档＋逐字段取值＋备份后块级写回）
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
		this.endCharResize(); // v0.4.11+ 正在拖状态区分隔条就关面板＝摘掉 document 级 move/up（否则残留监听会指向已拆除的分隔条）
		this.graphCanvas?.dispose(); // v0.4.11+ 断开画布尺寸观察器（观察器会持有已移除的 DOM 引用）
		this.graphCanvas = null;
		this.graphTipEl?.remove(); // tip 浮层挂在 document.body（见 buildUI），view 关闭时手动清理
		this.graphTipEl = null;
	}

	/** v0.4.11+ 视图尺寸变化（Obsidian 直接在部分场景仍会调这里）＝交给画布设施同一套防抖测量（sizer 尺寸依赖视口宽高） */
	onResize(): void {
		this.graphCanvas?.notifyResize();
	}

	private buildUI(parent: HTMLElement): void {
		this.built = true;
		this.rootEl = parent.createDiv({ cls: "aw-status-view aw-rel-view" }); // 复用写字台的容器/字体/滚动布局样式
		this.topEl = this.rootEl.createDiv({ cls: "aw-st-top" }); // 固定头部：筛选框 + 刷新按钮（不显示工作目录/小说列表）
		this.treeEl = this.rootEl.createDiv({ cls: "aw-st-tree" }); // 滚动主体：关系分组卡片 / 图表模式的画布容器
		// v0.4.11+ **缩放/平移整体换用 `CanvasPanel`**（用户三轮反馈后重写＝不再自写 transform 数学）：
		//  画布视口＝**独立的 `.aw-rel-canvasbody`**（v0.4.11+ 第四轮改回独立容器：不再 `parentBodyEl` 复用 treeEl＝
		//  sizer 高度随倍率涨缩会把下面的图例行/状态区上下顶动；现在视口是恒定 flex 项，缩放只在视口内出滚动条，固定行纹丝不动＝用户要求）：
		//  滚轮缩放（每次事件独立换算、以鼠标为不动点）、拖动平移（滚动余量内驱动原生滚动、用尽后虚拟平移层继续挪＝无限位）、
		//  倍率标签、尺寸观察全部走与场景/时间线面板**同一份代码**（`panel_canvas.ts`，其纯函数有 node 单测覆盖）。
		this.graphCanvas = new CanvasPanel(this.treeEl, {
			bodyCls: "aw-rel-canvasbody", // 画布视口＝treeEl 的 flex 子项（占剩余高度；卡片模式 display:none 但不销毁＝切模式不丢画布层）
			sizerCls: "aw-rel-sizer",
			zoomCls: "aw-rel-zoom",
			zoomVar: "--aw-rel-transform",
			zoomLabelCls: "aw-dim aw-tl-zoomlbl aw-rel-zoomlbl",
			zoomLabelTitle: "当前缩放倍率（Ctrl|Shift＋滚轮＝以鼠标位置为中心缩放；普通滚轮＝滚动画面）；点一下恢复 100% 并回到原位",
			min: PANEL_ZOOM_MIN,
			max: PANEL_ZOOM_MAX,
			// v0.4.11+ 画布可视区尺寸变了＝重画一次（图尺寸跟着视口走，与场景面板按宽度重排同理）；纯高度变化由 apply() 重算 sizer 已足够。
			//  阈值门卫（「适应全图后一直闪」修正）＝变化不足一个滚动条宽度不重排：否则「100% 贴边→滚动条抖动→widthChanged→重渲染→再抖动」会闪个不停
			onResize: () => {
				if (this.mode !== "graph" || !this.lastSnap) return;
				const w = this.graphCanvas?.bodyEl.clientWidth ?? 0;
				if (Math.abs(w - this.lastGraphBoxW) < GRAPH_RELAYOUT_MIN_DX) return;
				this.renderGraph(this.lastSnap);
			},
			onPanStart: () => { this.graphPanning = true; },
			onPanEnd: (moved) => {
				this.graphPanning = false;
				if (moved) { // v0.4.8+ 起拖期间高亮被抑制→可能残留按下前的那份邻接高亮/边 tip，真拖过就在松手时统一清掉（纯点击不动）
					this.focusGraph(null, null);
					this.hideGraphTip();
				}
			},
		});
		// 图表 tip 浮层（自定义 HTML＝人物节点与连线共用同一份同一样式，不用 SVG <title>）：挂在 document.body 上，避开侧栏祖先的 transform/contain/overflow 把 position:fixed 变成局部定位或裁切导致看不见
		this.graphTipEl = document.body.createDiv({ cls: "aw-rel-gtip" });
		// 主体空白双击＝适应全图的兜底监听（挂在常驻 treeEl＝一次绑定，不随重渲染累加）
		this.treeEl.addEventListener("dblclick", (ev: MouseEvent) => {
			if (this.mode !== "graph") return;
			if (ev.target instanceof Element && ev.target.closest(".aw-rel-graph, .aw-rel-charinfo, .aw-rel-charresizer")) return;
			this.resetGraphView();
		});
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
			this.clearBodyKeepingCanvas(); // 出错也不能销毁常驻画布层（否则下次刷新错误分支后再切图表就再也建不出图）
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
		// v0.4.11+ 头部倍率标签＝画布设施的 `attachZoomLabel`（与场景/时间线完全同一实现：`Math.round(zoom×100)%`、100% 隐藏、点它＝复位视图）
		this.graphZoomHost = this.mode === "graph" ? filterRow : null;
		input.addEventListener("input", () => {
			this.filterText = input.value; // 只重渲染主体区（头部保持不动，输入焦点与光标不丢）
			if (this.lastSnap) this.renderBody(this.lastSnap);
		});
		const btns = filterRow.createSpan({ cls: "aw-st-actions" });
		if (this.onAddRelationship) {
			const addRel = btns.createEl("button", { text: "＋ 关系", cls: "aw-rel-add" });
			addRel.disabled = !this.lastSnap?.activeStory; // 未选小说时无处写入
			setTooltip(addRel, "添加一条人物关系（写入所选层级的《人物关系.md》）");
			addRel.addEventListener("click", () => void this.onAddRelationship?.(this.selectedChar ?? undefined));
		}
		if (this.onAddCharacter) {
			const add = btns.createEl("button", { text: "添加人物" });
			add.disabled = !this.lastSnap?.activeStory; // 未选小说时无处写入
			add.addEventListener("click", () => void this.onAddCharacter?.());
		}
		if (this.mode === "graph") {
			// v0.4.11+ 找回画面的常驻入口（放在头部＝图面被推到哪儿头部一定还在）。名称与图标照场景面板画布菜单＝「适应全图」，
			//  动作＝`CanvasPanel.resetView()`（倍率回 100%＋虚拟平移归零＋滚动回原点；元素常驻，永远不会复位到「已脱离文档的旧节点」上）
			const reset = btns.createEl("button", { text: "适应全图", cls: "aw-rel-reset" });
			setIcon(reset.createSpan({ cls: "aw-rel-btnicon" }), "frame"); // 图标＋文字（与场景面板画布菜单同一项名＝「适应全图」）
			setTooltip(reset, "把图恢复 100% 并回到原位（也可双击图面空白处、或在空白处右键选「适应全图」，或点头部倍率标签）");
			reset.addEventListener("click", () => this.resetGraphView());
		}
		btns.createEl("button", { text: "刷新" }).addEventListener("click", () => void this.refresh());
	}

	/** v0.4.11+ **复位图面视图**＝直接调画布设施的 `resetView()`（倍率回 100%＋虚拟平移归零＋滚动回原点）。
	 *  画布三层元素常驻不随重渲染销毁＝不需要再「重画一次图来兜底」（旧版只往可能已脱离文档的旧 svg 写 transform＝「双击也没回来」的成因，
	 *  换设施后该坑在结构上不存在）。入口＝头部「适应全图」按钮、双击图面空白处、图面空白处右键菜单、头部倍率标签点击 */
	private resetGraphView(): void {
		this.graphCanvas?.resetView();
	}

	/** 主体区按当前展示方式分派：卡片列表（renderTree）或节点连线图（renderGraph） */
	private renderBody(snap: RelSnapshot): void {
		// 图表模式＝画布容器（滚动＋缩放层），卡片模式＝普通纵向滚动列表
		this.treeEl.classList.toggle("is-graph", this.mode === "graph");
		this.charInfoEl = null; // 旧的「人物状态」区与分隔条随主体清空（高度值 charInfoH 本身保留＝大小不会被渲染改变）
		this.charResizerEl = null;
		this.hideGraphTip(); // tip 浮层挂在 document.body＝不随主体清空，重渲染（刷新/筛选/切模式）时旧节点或连线消失前留下的那一套必须主动收掉
		if (this.mode === "graph") this.renderGraph(snap);
		else this.renderTree(snap);
		// v0.4.11+ 倍率标签：头部只在整体刷新时重建（筛选输入不重建＝焦点不丢），所以本地重渲染后也要在这里补挂一次；
		//  `attachZoomLabel` 内部会按当前倍率刷新显示（与场景/时间线面板同一入口）
		if (this.mode === "graph" && this.graphCanvas && this.graphZoomHost) this.graphCanvas.attachZoomLabel(this.graphZoomHost);
	}

	/** 卡片列表主体：汇总行 + 各层级分组（书籍/卷/章） */
	private renderTree(snap: RelSnapshot): void {
		const savedScroll = this.treeEl.scrollTop;
		this.clearBodyKeepingCanvas(); // 卡片模式＝sizer 暂时离档（引用不丢），切回「图表」时再挂回＝卡片↔图表反复切换不会杀死画布层
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
	/** v0.4.11+（第四轮）画布可视区尺寸＝图的实际尺寸（viewBox＝真实像素，1:1）：直接量独立画布视口 `.aw-rel-canvasbody`
	 *  （它是恒定 flex 项＝面板高 − 头部/两行图例/分隔条/状态区，sizer 涨缩不影响它）。
	 *  **前提＝测量前图例/分隔条/状态区已先建好**（flex 分配才到位）。取不到有效值时回落默认 760×560 */
	private graphBoxSize(): { W: number; H: number } {
		const body = this.graphCanvas?.bodyEl;
		const availW = body?.clientWidth ?? 0;
		const availH = body?.clientHeight ?? 0;
		const W = availW > 0 ? Math.max(GRAPH_MIN_W, availW) : GRAPH_BASE_W;
		const H = availH > 0 ? Math.max(GRAPH_MIN_H, availH) : GRAPH_BASE_H;
		return { W, H };
	}

	/** v0.4.11+（用户报告＝「图表看不到图、只有人物状态区、画面拖不动」的事故修正＋第四轮视口独立化）＝**清空主体时绝不销毁常驻画布视口**。
	 *  画布视口 `.aw-rel-canvasbody`（内含 sizer/pan/zoom 三层）是 treeEl 的常驻子项，
	 *  旧写法 `treeEl.empty()` 把它清掉＝svg 写进已脱离文档的 zoomEl（图彻底看不见）、视口脱离后 clientHeight=0（滚动/平移余量全 0＝怎么拖都不动）。
	 *  现在＝视口之外的普通子项（图例/分隔条/状态区/占位文案）全部移除，视口原地留下、只清 zoomEl 里的图内容
	 *  （与场景/时间线面板「重渲染只清 zoomEl」同一口径；卡片模式下视口由 CSS `display:none` 藏起来、同样不销毁） */
	private clearBodyKeepingCanvas(): void {
		const body = this.graphCanvas?.bodyEl ?? null;
		for (const child of Array.from(this.treeEl.children)) if (child !== body) child.remove();
		this.graphCanvas?.zoomEl.empty();
	}

	/** 「线型说明」折叠行的内容重建（▸/▾ caret＋线型一句话＋点开部分）＝renderGraph 建该行时调一次，整行点击切换后走重渲染重建 */
	private renderLegendHelp(row: HTMLElement): void {
		row.empty();
		row.toggleClass("is-open", this.legendHelpOpen);
		row.setAttribute("title", this.legendHelpOpen ? "收起这段说明（把空间还给图面）" : "展开完整说明：加粗规则与滚轮/拖动/双击等操作口径");
		row.createSpan({ cls: "aw-rel-chardrawer-caret aw-rel-glegend-caret", text: this.legendHelpOpen ? "▾" : "▸" });
		const body = row.createSpan({ text: LEGEND2_SHORT });
		if (this.legendHelpOpen) body.appendText(LEGEND2_REST); // 同一 span＝flex gap 不会在句中插出大空隙
		else body.appendText(" …（点开看操作说明）");
	}

	private renderGraph(snap: RelSnapshot): void {
		this.clearBodyKeepingCanvas();
		this.graphNodeEls.clear();
		this.graphEdgeEls = [];
		this.graphAdj.clear();
		const ph = this.placeholderFor(snap);
		if (ph) {
			this.graphCanvas?.setContentWidth(0); // 无图＝sizer 收回视口宽×0 高（空视口不占地方也不出滚动条）
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
			this.graphCanvas?.setContentWidth(0);
			this.treeEl.createDiv({ text: `没有匹配「${this.filterText.trim()}」的关系。`, cls: "aw-dim aw-st-hint" });
			return;
		}
		const centerName = this.graphCenter ?? this.defaultCenterName(nodes, snap);
		// （v0.4.11+ 用户要求＝图表上方那行「角色 N 个 · 关系 M 条 …」说明文字不再展示；
		//  交互口径改写到图下方的图例行；**svg/节点/连线都不挂 `<title>`**＝浏览器原生长条提示会与自定义 tip 同时弹出＝用户明确不要）

		// v0.4.11+（第四轮）＝**先建下面的固定行**（两行图例＋分隔条＋「人物状态」区），再量画布视口建图：
		//  flex 分配此刻已到位＝图尺寸＝视口真实大小；缩放时 sizer 只在视口内部涨缩＝下面的文字与状态区不动（用户要求）
		const used = new Set(edges.map((e) => relationshipTypeClass(e.type)));
		const legend = this.treeEl.createDiv({ cls: "aw-dim aw-rel-glegend" });
		legend.createSpan({ text: "边色：" });
		for (const [cls, label] of TYPE_CLASS_LABELS) {
			if (!used.has(cls)) continue;
			const item = legend.createSpan({ cls: "aw-rel-glegend-item" });
			item.createSpan({ cls: `aw-rel-glegend-swatch ${cls}` });
			item.appendText(label);
		}
		// v0.4.11+（用户要求＝「线型说明」可折叠）＝该行＝折叠头：▸/▾＋线型一句话，点开补出「加粗＝多处登记」与滚轮/拖动/双击等操作口径
		//  （交互口径仍写在这里而不是 svg 的 `<title>`＝不会与自定义 tip 撞成两个悬浮提示；默认收起＝把行高还给图面）
		const legend2 = this.treeEl.createDiv({ cls: "aw-dim aw-rel-glegend aw-rel-glegend-help" });
		this.renderLegendHelp(legend2);
		legend2.addEventListener("click", () => {
			this.legendHelpOpen = !this.legendHelpOpen;
			if (this.lastSnap) this.renderGraph(this.lastSnap); // 整帧重排＝图面尺寸跟着固定行高度变化（CanvasPanel 保留倍率/平移/滚动限位口径）
		});

		// 「人物状态」区：固定在图下方，展示单击选中角色的设定信息（来自《人物.md》，未选中时给引导文案）。
		// v0.4.11+（用户要求）＝该区**高度恒定**（内容多则在自身内滚动）＝选中/取消选中人物时图的大小一律不动；上缘一条分隔条可拖动改高度。
		const resizer = this.treeEl.createDiv({ cls: "aw-rel-charresizer" });
		resizer.setAttribute("title", "拖动改「人物状态」区高度（该区不会自己变大变小）");
		resizer.addEventListener("pointerdown", (ev: PointerEvent) => this.beginCharResize(ev));
		this.charResizerEl = resizer;
		const info = this.treeEl.createDiv({ cls: "aw-rel-charinfo" });
		this.charInfoEl = info;
		this.applyCharInfoHeight();
		this.renderCharInfo(info, snap);

		const NS = "http://www.w3.org/2000/svg";
		const mk = (tag: string): SVGElement => document.createElementNS(NS, tag);
		const { W, H } = this.graphBoxSize(); // v0.4.11+＝图按画布可视区取尺寸（viewBox＝真实像素＝画布换算与力导向坐标同一坐标系）
		this.lastGraphBoxW = this.graphCanvas?.bodyEl.clientWidth ?? 0; // 记住本次建图的视口宽＝观察器阈值门卫的基准
		const cx = W / 2;
		const cy = H / 2;
		const svg = mk("svg");
		svg.setAttribute("class", "aw-rel-graph");
		svg.setAttribute("width", String(W)); // v0.4.11+ **真实像素尺寸＝viewBox 尺寸**（画布设施的 zoom 层宽会设成 max(视口, W)，
		svg.setAttribute("height", String(H)); //  两者在常见侧栏宽度下一致＝内容坐标系与 viewBox 坐标系 1:1＝`toContentPoint`/滚轮不动点直接落在图内坐标上）
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
			// 不用 SVG <title>（浏览器原生 tooltip 截断多行内容、desc 长就显示不全），改用自定义 HTML tip 浮层：position:fixed + 跟手 + 自适应换行（v0.4.11+ 起人物节点也用这同一份浮层＝样式一致）
			g.addEventListener("mouseenter", (ev: MouseEvent) => {
				if (this.graphPanning) return; // v0.4.8+ 按下起拖后不再响应悬停：拖图扫过节点/连线不高亮、不弹 tip
				this.focusGraph(e.a, e.b);
				this.showGraphTip(g, tipText, ev);
			});
			g.addEventListener("mousemove", (ev: MouseEvent) => { if (this.graphPanning) return; this.moveGraphTip(ev); });
			g.addEventListener("mouseleave", () => {
				if (this.graphPanning) return;
				this.focusGraph(null, null);
				this.hideGraphTip(g);
			});
			const editInfo: RelEdgeEditInfo = { a: e.a, b: e.b, type: e.type, status: e.status, desc: e.desc, sourcePath: e.sourcePath, scope: e.scope, count: e.count };
			g.addEventListener("dblclick", (ev: MouseEvent) => {
				ev.preventDefault();
				ev.stopPropagation(); // v0.4.11+ 双击连线＝编辑关系弹窗（不再打开来源文档），也不冒泡到 svg 的拖拽抑制逻辑
				if (this.onEditRelationship) void this.onEditRelationship(editInfo);
				else void this.openFile(e.sourcePath); // 未注入编辑回调时保持旧行为
			});
			g.addEventListener("contextmenu", (ev: MouseEvent) => {
				ev.preventDefault();
				ev.stopPropagation();
				this.hideGraphTip(); // v0.4.11+ 用户要求＝右键时 tip 立刻消失（右键不产生 mouseleave，否则浮层会一直挂在菜单旁边）
				if (!this.onEditRelationship && !this.onDeleteRelationship) return;
				const menu = new Menu();
				const base = "aw-rel-edge";
				if (this.onEditRelationship) menu.addItem((it) => it.setSection(base).setTitle("编辑关系").setIcon("pencil").onClick(() => void this.onEditRelationship?.(editInfo)));
				if (this.onDeleteRelationship) menu.addItem((it) => it.setSection("danger").setTitle("删除关系").setIcon("trash").onClick(() => void this.onDeleteRelationship?.(editInfo)));
				menu.showAtPosition({ x: ev.x, y: ev.y });
			});
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
			// 节点 tip＝与连线**同一份浮层、同一样式**（`.aw-rel-gtip`）。不再挂 SVG `<title>` 子元素（浏览器原生 tooltip 会截断多行、样式也跟连线不一致，v0.4.11+ 用户要求）
			// v0.4.11+ 用户要求＝tip 里只放**人物信息**（《人物.md》里的设定字段），不要「双击＝编辑／右键＝菜单」这类操作口径
			const nodeTip = this.charTipText(n.name, n.degree);
			g.appendChild(dot);
			g.appendChild(label);
			g.addEventListener("mouseenter", (ev: MouseEvent) => {
				if (this.graphPanning) return; // 起拖期间不高亮、不弹 tip
				this.focusGraph(n.name, null);
				this.showGraphTip(g, nodeTip, ev);
			});
			g.addEventListener("mousemove", (ev: MouseEvent) => { if (this.graphPanning) return; this.moveGraphTip(ev); });
			g.addEventListener("mouseleave", () => {
				if (this.graphPanning) return;
				this.focusGraph(null, null);
				this.hideGraphTip(g);
			});
			// 单击＝选中并在下方「人物状态」区展示该角色详情（拖拽平移后的伪点击已被画布容器捕获阶段拦下，不会走到这里）；再次点同一节点保持选中不变。
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
				this.hideGraphTip(); // v0.4.11+ 用户要求＝在圆点／名字文字上右键时 tip 立刻消失
				this.openCharMenu(ev, n.name, n.sources[0]); // v0.4.9+ 用户要求＝右键出菜单
			});
			svg.appendChild(g);
			this.graphNodeEls.set(n.name, g as SVGGElement);
		}
		// v0.4.11+ **缩放/平移全部交给 `CanvasPanel`（用户三轮反馈后整体重写）**：svg 以真实像素尺寸（=viewBox 尺寸）放进 zoom 层，
		//  sizer 撑出「内容×倍率」的可滚动范围，缩放走 transform-origin 左上角＋JS 补偿滚动/虚拟平移＝`panel_canvas` 那套**有单测覆盖**的换算。
		//  旧实现＝svg 自身挂 `translate(pan) scale(z)`（transform-origin 居中）＋面板内手推不动点公式：依赖 `svg.clientWidth`（Blink 对无
		//  width/height 属性的 <svg> 偶尔读到 0＝公式算出荒谬 pan＝画面一步推出视野），且 pan 无限位、没有任何找回机制＝用户投诉的根源。
		//  svg 上不挂任何 `<title>`（浏览器原生长条 tooltip 会与自定义方块 tip 同时弹出＝用户明确不要），交互口径写在图下方图例行。
		if (this.graphCanvas) {
			this.graphCanvas.setContentWidth(W); // 面板比画布窄时也要撑出横向滚动/拖动范围（apply 取 max(视口宽, 内容宽)＝侧栏较窄时图右缘不会滚不到）
			this.graphCanvas.zoomEl.appendChild(svg);
			this.graphCanvas.apply(); // 重渲染后按当前倍率重算 sizer 尺寸（画布视口与三层元素常驻＝倍率与平移在筛选/刷新后保持，跟场景/时间线面板一致）
		}

		// 双击**图面空白处**＝适应全图（`CanvasPanel.resetView()`＝倍率 100%＋平移归零＋滚动回原点）。
		// 挂在冒泡阶段＝只有落在图本身的双击会走到这里（人物节点／连线的 dblclick 各自 stopPropagation，不会误触发复位）；
		//  刚拖完那一下的双击由 `CanvasPanel` 在容器捕获阶段统一吞掉（不需要本面板自己记 `dragged` 标志）
		svg.addEventListener("dblclick", () => this.resetGraphView());

		// v0.4.11+ **图面空白处右键菜单＝照搬场景面板的画布菜单**（「适应全图」＋「刷新」）：视图跑偏或放大后想退回看全貌＝一键找回（与头部按钮同一动作）
		svg.addEventListener("contextmenu", (ev: MouseEvent) => {
			ev.preventDefault();
			this.hideGraphTip(); // 空白处一般没有 tip，但刚离开节点时可能还留着＝一并收掉
			const menu = new Menu();
			menu.addItem((it) => it.setSection("aw-rel-canvas").setTitle("适应全图").setIcon("frame").onClick(() => this.resetGraphView()));
			menu.addItem((it) => it.setSection("aw-rel-canvas").setTitle("刷新").setIcon("refresh").onClick(() => void this.refresh()));
			menu.showAtPosition({ x: ev.x, y: ev.y });
		});

		// v0.4.11+ 复位兜底（用户投诉＝图跑丢后「双击也没回来」）：图面 svg 之外的主体空白（图例行上、图例下方、状态区上方的空隙）双击也复位；
		//  落在图本身／「人物状态」区／分隔条上的双击不算（图自己的 dblclick 已处理，状态区里有「编辑」等各自的手势）
		//  （v0.4.11+ 修＝挂在常驻的 treeEl 上＝只绑一次，不再每帧渲染各加一份监听；见 buildUI）
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

	/** 该人物登记在几份《人物.md》里（＝快照 `chars` 同名条目数）＝右键菜单「合并 N 处登记」与状态区「合并」链接的显示条件（v0.4.11+） */
	private charEntryCount(name: string): number {
		return this.lastSnap ? this.lastSnap.chars.filter((c) => c.name === name).length : 0;
	}

	/** 卡片里的角色名等普通元素挂人物菜单（v0.4.9+）＝右键弹 `openCharMenu`、双击＝编辑人物；名字为空（未命名角色）不挂 */
	private bindCharMenu(el: HTMLElement, name: string, fallbackPath?: string): void {
		const n = name.trim();
		if (!n) return;
		el.setAttribute("title", `双击＝编辑人物（无别的响应）；右键＝菜单（编辑／改名／合并多处登记／打开来源文档／设为中心人物／新增／删除）：${n}`);
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
			this.charDrawerOpenKeys.clear(); // 换人＝全部展开项回到默认折叠（v0.4.11+）
			// v0.4.11+ 局部刷新＝只给节点加选中描边＋重画「人物状态」区。旧口径这里调 `renderBody`＝整张图重建
			// （力导向重跑＋状态区把图挤掉一截）＝用户投诉的「点人物圆圈时下面人物状态的大小在动」＝图与区一起跳
			this.applySelClass();
			this.refreshCharInfo();
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
	 * **设为中心人物**（v0.4.8+ 原「双击节点＝以该人物为中心重画」移到这里；已是中心者这一项变「恢复默认中心」）→
	 * **添加关系（以该人物为角色1）**（v0.4.11+）→ 新增人物（＝头部「添加人物」）→
	 * **删除人物「X」恒排最后**（`danger` 分组＝自动带分隔线且排在末尾，同场景卡片菜单口径）。
	 * 没注入对应写动作回调时那一项自动不出现（＝面板未接线也不报错）。
	 */
	private openCharMenu(ev: MouseEvent, name: string, fallbackPath?: string): void {
		const menu = new Menu();
		const base = "aw-rel-char"; // 前五项同一 section＝中间不画分隔线；「删除」单列 danger 组＝排在最后（scene_view 卡片菜单同口径）
		if (this.onEditCharacter) menu.addItem((it) => it.setSection(base).setTitle(`编辑人物「${name}」`).setIcon("pencil").onClick(() => void this.onEditCharacter?.(name)));
		if (this.onRenameCharacter) menu.addItem((it) => it.setSection(base).setTitle(`改名「${name}」`).setIcon("text-cursor").onClick(() => void this.onRenameCharacter?.(name)));
		const regs = this.charEntryCount(name); // v0.4.11+ 只有**登记在两份以上《人物.md》**的人物才有「合并」可做
		if (this.onMergeCharacter && regs > 1) menu.addItem((it) => it.setSection(base).setTitle(`合并「${name}」的 ${String(regs)} 处登记`).setIcon("git-merge").onClick(() => void this.onMergeCharacter?.(name)));
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
		if (this.onAddRelationship) menu.addItem((it) => it.setSection(base).setTitle(`添加关系（以「${name}」为角色1）`).setIcon("git-branch").onClick(() => void this.onAddRelationship?.(name)));
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
		const entries = snap.chars.filter((c) => c.name === name); // 该人物在各层《人物.md》里的登记（＝多文档判定与下面渲染共用）
		if (this.onRenameCharacter) this.charLink(head, "改名", "全书 MD 同步替换旧名并自动备份", () => void this.onRenameCharacter?.(name));
		if (this.onMergeCharacter && entries.length > 1) {
			this.charLink(head, `合并（${String(entries.length)} 处登记）`, "同名人物在多份《人物.md》里各有一条登记＝合并为一条并选定最终存储文档", () => void this.onMergeCharacter?.(name));
		}
		const close = head.createSpan({ text: "×", cls: "aw-rel-charclose" });
		close.setAttribute("title", "清除选中");
		close.addEventListener("click", () => {
			this.cancelCharPick(); // v0.4.9+ 「单击选中」还在 220ms 等待期就点 ×＝别在背后把人又选回来
			this.selectedChar = null;
			this.charDrawerOpenKeys.clear();
			this.applySelClass(); // v0.4.11+ 局部刷新＝图面一动不动（旧口径 renderBody＝整张图重建）
			this.refreshCharInfo();
		});
		if (!entries.length) {
			parent.createDiv({ text: "《人物.md》里还没有这个人物的设定（可用顶部「添加人物」补录）。", cls: "aw-dim aw-st-hint" });
			return;
		}
		if (entries.length === 1) {
			entries.forEach((e) => this.renderCharEntry(parent, e));
			return;
		}
		// **多份《人物.md》登记＝每个文档一个展开项**（v0.4.11+ 用户要求＝「人物在多个文档时，每个文档一个展开项」）：
		// 逐条各一个折叠条（标题＝该文档所在位置＋「打开文档」/「编辑」），默认全部折叠、点开哪条看哪条＝状态区高度口径始终不变
		const seq = new Map<string, number>(); // 同一文档里同名登记多次时给键加序号（键只在本轮渲染内生成，展开态存 charDrawerOpenKeys）
		for (const e of entries) {
			const n = (seq.get(e.sourcePath) ?? 0) + 1;
			seq.set(e.sourcePath, n);
			this.renderCharDrawer(parent, e, `${e.sourcePath}#${String(n)}`);
		}
	}

	/** v0.4.11+ 状态区里「一个文档 ＝ 一个展开项」：折叠＝只有一条折叠头（▸ ＋ `层级词 · 书内路径` ＋「打开文档」/「编辑」），
	 *  展开＝其下出该文档的设定块（`renderCharEntry`，块内不再重复文档头＝`hideHead`）。点折叠头（圆角箭头或位置文案）＝翻展开态，
	 *  点头上的「打开文档」/「编辑」＝不翻展开态（走各自动作）。展开态按 `charDrawerOpenKeys` 记住（选中别的人物即清空＝默认折叠） */
	private renderCharDrawer(parent: HTMLElement, e: RelCharInfo, key: string): void {
		const open = this.charDrawerOpenKeys.has(key);
		const drawer = parent.createDiv({ cls: "aw-rel-chardrawer" });
		if (open) drawer.addClass("is-open");
		const head = drawer.createDiv({ cls: "aw-rel-chardrawer-head" });
		head.setAttribute("title", open ? "收起该文档的登记" : "展开查看该文档的登记");
		const toggle = (): void => {
			if (open) this.charDrawerOpenKeys.delete(key);
			else this.charDrawerOpenKeys.add(key);
			this.refreshCharInfo(); // 只重画状态区这一块（图面一动不动）
		};
		head.createSpan({ text: open ? "▾" : "▸", cls: "aw-rel-chardrawer-caret" });
		head.createSpan({ text: docLocationLabel(e.scope, e.sourcePath, this.lastSnap?.storyDir ?? "", REL_SCOPE_WORDS), cls: "aw-rel-chardrawer-label" });
		this.charLink(head, "打开文档", e.sourcePath, () => void this.openFile(e.sourcePath));
		if (this.onEditCharacter) {
			this.charLink(head, "编辑", docLocationLabel(e.scope, e.sourcePath, this.lastSnap?.storyDir ?? "", REL_SCOPE_WORDS), () => void this.onEditCharacter?.(e.name));
		}
		head.addEventListener("click", (ev: MouseEvent) => {
			if ((ev.target as HTMLElement | null)?.closest(".aw-rel-openfile")) return; // 点头上的「打开文档」/「编辑」＝走动作、不翻展开态
			toggle(); // 整条折叠头都是热区（箭头与位置文案同样生效）
		});
		if (!open) return; // 默认折叠
		const body = drawer.createDiv({ cls: "aw-rel-chardrawer-body" });
		this.renderCharEntry(body, e, true);
	}

	/** v0.4.11+ 设定字段的**取数口径唯一来源**（未填字段返回空串＝调用方自行跳过；能力多项以顿号连接）＝「人物状态」区与节点 tip 共用（代码重用） */
	private charInfoFields(e: RelCharInfo): Array<[string, string]> {
		const abilities = (e.abilities ?? []).join("、");
		return [
			["身份", e.identity?.trim() ?? ""], ["年龄", e.age?.trim() ?? ""], ["性别", e.gender?.trim() ?? ""],
			["性格", e.personality?.trim() ?? ""], ["外貌", e.appearance?.trim() ?? ""], ["背景", e.background?.trim() ?? ""],
			["能力", abilities], ["备注", e.notes?.trim() ?? ""],
		];
	}

	/** **节点 tip 的正文**（v0.4.11+ 用户要求＝人物身上弹的那份要显示**人物信息**、不要「双击＝编辑／右键＝菜单」这类操作提示）＝
	 *  第一行「名字 · N 条关系」＋《人物.md》里各层登记的设定字段（与「人物状态」区同一套 `charInfoFields` 取数）。
	 *  多文档登记＝每份文档一段（标题＝`层级 · 书内位置`）；单文档不重复标题。字段值过长只截断展示（完整内容在下方「人物状态」区／编辑弹窗里看），
	 *  否则 tip 会拉成一长条；《人物.md》里没有该人物时只给一行提示（操作口径统一写在图下方图例行里） */
	private charTipText(name: string, degree: number): string {
		const entries = this.lastSnap ? this.lastSnap.chars.filter((c) => c.name === name) : [];
		const lines: string[] = [`${name} · ${String(degree)} 条关系`];
		if (!entries.length) {
			lines.push("《人物.md》里还没有这个人物的设定");
			return lines.join("\n");
		}
		const multi = entries.length > 1;
		for (const e of entries) {
			if (multi) lines.push("", `${REL_SCOPE_WORDS[e.scope]} · ${docLocationLabel(e.scope, e.sourcePath, this.lastSnap?.storyDir ?? "", REL_SCOPE_WORDS)}`);
			for (const [k, v] of this.charInfoFields(e)) {
				if (!v) continue;
				lines.push(`${k}：${v.length > 60 ? `${v.slice(0, 60)}…` : v}`);
			}
		}
		return lines.join("\n");
	}

	/** 状态区头部的文字小链接（「打开文档」/「编辑」＝条目头与抽屉头两处共用＝代码重用）；连点两下只当一次双击用（与旧口径一致） */
	private charLink(parent: HTMLElement, text: string, title: string, run: () => void): HTMLElement {
		const el = parent.createSpan({ text, cls: "aw-rel-openfile" });
		el.setAttribute("title", title);
		el.addEventListener("click", (ev: MouseEvent) => {
			if (ev.detail > 1) return;
			run();
		});
		return el;
	}

	/** 「人物状态」区单块：层级标签＋「打开文档」/「编辑」链接＋非空字段行（能力多项以顿号连接）。
	 *  `hideHead`＝多文档展开项里用（文档位置与两个动作已经在折叠头上，块内不再重复一遍） */
	private renderCharEntry(parent: HTMLElement, e: RelCharInfo, hideHead: boolean = false): void {
		const box = parent.createDiv({ cls: "aw-rel-charentry" });
		if (!hideHead) {
			const head = box.createDiv({ cls: "aw-rel-charenty-head" });
			head.createSpan({ text: e.label, cls: "aw-dim aw-rel-charscope" });
			this.charLink(head, "打开文档", e.sourcePath, () => void this.openFile(e.sourcePath)); // 连点两下＝只当双击用（与旧口径一致）
			if (this.onEditCharacter) {
				this.charLink(head, "编辑", docLocationLabel(e.scope, e.sourcePath, this.lastSnap?.storyDir ?? "", REL_SCOPE_WORDS), () => void this.onEditCharacter?.(e.name)); // v0.4.9+ 与双击图表节点／右键「编辑人物」同一个弹窗
			}
		}
		box.addEventListener("contextmenu", (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			this.openCharMenu(ev, e.name, e.sourcePath); // v0.4.9+ 右键这一块的菜单＝与图表节点同一份
		});
		this.renderCharFields(box, e);
	}

	/** 设定块的字段行（未填字段不占位、能力多项以顿号连接）＝普通块与抽屉展开块共用；取数走 `charInfoFields`（与节点 tip 同一口径） */
	private renderCharFields(box: HTMLElement, e: RelCharInfo): void {
		for (const [k, v] of this.charInfoFields(e)) {
			if (!v) continue; // 未填字段不占位（含空数组的能力）
			const row = box.createDiv({ cls: "aw-rel-charfield" });
			row.createSpan({ text: k, cls: "aw-rel-charflabel" });
			row.appendText(v);
		}
	}

	/** v0.4.11+ 状态区高度写进 CSS 变量（styles.css `.aw-st-tree.is-graph > .aw-rel-charinfo` 消费）＝**高度口径唯一来源**。
	 *  只有 `beginCharResize`（拖分隔条）会改 `charInfoH`；任何渲染、选中、内容增减都不动它＝用户要求＝状态区不自己变大变小 */
	private applyCharInfoHeight(): void {
		this.treeEl.style.setProperty("--aw-rel-charinfo-h", `${String(this.charInfoH)}px`);
	}

	/** v0.4.11+ **只重画「人物状态」这一块**（＋节点选中描边），不再整块重渲染主体。
	 *  旧口径＝单击人物走 `renderBody`＝重建整张图（力导向重跑＋状态区把图挤得一跳一大截）＝用户投诉「点人物圆圈时下面人物状态的大小在动」；
	 *  现在图面完全不动（连节点位置都不变），只换状态区内容 */
	private refreshCharInfo(): void {
		const el = this.charInfoEl;
		if (!el || !this.lastSnap) return;
		el.empty();
		this.renderCharInfo(el, this.lastSnap);
	}

	/** v0.4.11+ 只改节点上的选中描边类（与 `refreshCharInfo` 配成「局部刷新」） */
	private applySelClass(): void {
		for (const [name, el] of this.graphNodeEls) el.toggleClass("is-sel", name === this.selectedChar);
	}

	/** v0.4.11+ 拖动状态区上缘分隔条改高度（用户要求＝该区大小只能由用户拖边缘改）：左键按下起手势＋document 级 move/up 收尾。
	 *  限位＝下限 `CHARINFO_H_MIN`（至少露出标题行）、上限＝主体高度 − `CHARINFO_GRAPH_MIN`（给图面留住看得见的部分）。触屏同样可拖（CSS 给分隔条 `touch-action:none`） */
	private beginCharResize(ev: PointerEvent): void {
		if (ev.button !== 0) return; // 右键＝留给菜单语义，不起手势
		ev.preventDefault(); // 不选中文字
		ev.stopPropagation();
		this.charResize = { startY: ev.clientY, startH: this.charInfoH };
		this.charResizerEl?.addClass("is-resizing");
		document.addEventListener("pointermove", this.onCharResizeMove);
		document.addEventListener("pointerup", this.endCharResize);
		document.addEventListener("pointercancel", this.endCharResize);
	}

	private onCharResizeMove = (ev: PointerEvent): void => {
		const s = this.charResize;
		if (!s) return;
		ev.preventDefault();
		this.charInfoH = Math.round(clampNum(s.startH - (ev.clientY - s.startY), CHARINFO_H_MIN, this.charInfoMaxH())); // 向上拖＝区变高、图变矮
		this.applyCharInfoHeight();
	};

	/** 状态区可拖到的上限＝主体高度 − 其余各行（摘要行＋两行图例＋分隔条，实测）− `CHARINFO_GRAPH_MIN`（给图面留住看得见的部分）。
	 *  图本身（`.aw-rel-graph`）与被调的区（`charInfoEl`）都不计入＝两者分摊剩下的空间 */
	private charInfoMaxH(): number {
		let others = 0;
		for (const child of Array.from(this.treeEl.children)) {
			const el = child as HTMLElement;
			// 画布视口（内含 sizer＝图面＋滚动范围，随剩余空间伸缩）与图本身都不计入＝两者分摊剩下的空间；只数图例/分隔条这类固定行
			if (el === this.charInfoEl || el.classList.contains("aw-rel-graph") || el.classList.contains("aw-rel-canvasbody")) continue;
			others += el.offsetHeight;
		}
		return Math.max(CHARINFO_H_MIN, this.treeEl.clientHeight - others - CHARINFO_GRAPH_MIN);
	}

	private endCharResize = (): void => {
		document.removeEventListener("pointermove", this.onCharResizeMove);
		document.removeEventListener("pointerup", this.endCharResize);
		document.removeEventListener("pointercancel", this.endCharResize);
		this.charResize = null;
		this.charResizerEl?.removeClass("is-resizing");
	};

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

	/** 自定义图 tip（人物节点／关系连线共用同一份浮层与样式）：填内容并显示，跟手定位；越界则翻向鼠标左/上避免被视口裁切。必须先 addClass 显示，否则 display:none 下读到的 offsetWidth/Height 恒为 0，翻转判断失效会让长 tip 溢出视口底部看不见。`owner`＝触发它的 `<g>`（记进 `graphTipOwner`，供 `hideGraphTip` 判归属） */
	private showGraphTip(owner: Element, text: string, ev: MouseEvent): void {
		const el = this.graphTipEl;
		if (!el) return;
		el.setText(text);
		el.addClass("is-show"); // 先显示才能读到真实尺寸
		this.graphTipOwner = owner;
		this.moveGraphTip(ev);
	}

	/** 图 tip 跟手：默认放鼠标右下，右侧/下方越界则翻到左/上 */
	private moveGraphTip(ev: MouseEvent): void {
		const el = this.graphTipEl;
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

	/** 隐藏图 tip（节点／连线共用＝同一时刻只会有一份）。传 `owner`＝只有「当前显示的就是它那一套」时才隐藏（节点与连线在交叠处进出时不误伤对方）；不传＝无条件清（拖图松手、右键出菜单、视图卸载） */
	private hideGraphTip(owner?: Element): void {
		if (owner && this.graphTipOwner !== owner) return;
		this.graphTipOwner = null;
		this.graphTipEl?.removeClass("is-show");
	}
}
