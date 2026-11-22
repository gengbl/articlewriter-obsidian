import { ItemView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import { CanvasPanel } from "./panel_canvas";
import { autoSlotUsable, frameBoxFor, freeAnchorFor, regionFor, relEdgePathD, type ScBox } from "./scene_geometry"; // v0.4.9+ 连线折线几何＋**区域口径 `regionFor`（先按全部子场景算出区域，再派生父卡片的新位置）**＋新建落点判定/避让（纯函数＋node 测试）：渲染与拖动实时重算共用（父子不再连线＝只剩关联线）
import type { SceneDoc } from "./md_docs";
import { sceneTerrainColor } from "./md_docs"; // v0.4.8+ 地形色板/区域色计算（md_docs 共用事实源）

/** 场景所属层级（书根 / 卷 / 章） */
export type SceneScope = "book" | "volume" | "chapter";

/** 面板展示用场景行：SceneDoc ＋ 层级归属与来源文档（路径＝对应层《场景.md》，写回与双击定位都按它） */
export interface SceneRow extends SceneDoc {
	id: string; // 稳定标识＝来源路径#scene_id（刷新前后身份一致）
	scope: SceneScope;
	sourcePath: string;
	sourceLabel: string; // 书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>
	docIndex: number; // 同文档内出现序（文档序展示用）
}

export interface SceneStoryEntry {
	name: string;
	title: string;
	active: boolean;
}

/** 场景面板快照（main.ts getSceneSnapshot 非交互读取构建） */
export interface SceneSnapshot {
	workDir: string;
	stories: SceneStoryEntry[];
	activeStory: string | null;
	activeStoryTitle: string;
	rows: SceneRow[];
	totalCount: number;
	/** v0.4.8+ 卡片「🕐」区的时间线索引：**小写事件名 → 时间点显示文本**（main.ts 由该书全部《时间线.md》快照建表，名字口径＝时间线条目事件名）。
	 *  命中＝事件存在（chip 上带时间徽章、点击跳时间线面板定位）；未命中＝置灰划掉（改名/删除） */
	eventTimes?: Record<string, string>;
}

/** 场景显示名（无「标题」字段时回落 scene_id；面板/编辑弹窗统一口径由本函数单一事实源） */
export function sceneDisplayName(s: { scene_id: string; title?: string }): string {
	return s.title?.trim() || s.scene_id;
}

/** 某行是否命中筛选词（场景名/标题/描述/备注/角色/父场景/关联场景全字段匹配） */
function matchRow(r: SceneRow, q: string): boolean {
	return [r.scene_id, r.title, r.description, r.notes, r.parent, r.characters.join(" "), (r.related ?? []).join(" ")].join(" ").toLowerCase().includes(q);
}

/** 画布自动布局参数（未设 `- 位置：` 的场景按父子树嵌套排布；不落盘） */
const SCENE_MARGIN = 12;
const SCENE_GAP = 16; // 顶层场景块之间的垂直间距
const SCENE_INDENT = 22; // 子场景相对父卡片的缩进
const SCENE_CHILD_GAP = 24; // 父卡片与子卡片块之间的垂直间距（v0.4.9+ 已含包含框外扩 FRAME_PAD(10) 的净空＝子场景的框不会贴到父卡片上）；
// 同一值也用作 regionHeadFor 把父卡片摆到子场景上方那一行时的间距
const FRAME_PAD = 10; // 包含框相对子树包围盒的外扩
const NEW_SCENE_VIEW_OFFSET = 50; // v0.4.9+ 用户要求：头部「＋ 场景」新建的场景落在**当前视口左上角 +(50,50)**（＝不再一律丢进自动布局排到画布尽头）
const NEW_SCENE_CASCADE = 36; // 该落点已被现有卡片占住时，往右下避让的阶梯步长
const GRID_EXTENT = 3000; // v0.4.8+ 网格衬底四向外扩（配合 CSS left/top -3000px）：内容小/平移出界时视野内也始终铺满网格线

/** 渲染中的卡片条目（pass1 建元素测尺寸，pass2 布局写 x/y） */
interface ScItem {
	row: SceneRow;
	card: HTMLElement;
	w: number;
	h: number;
	x: number;
	y: number;
}

/** 一个父场景的包含框＝**该父场景的有效区域**：rounded rect ＋ 该区域的**全部子场景 id**（`ids`，不含父卡片自己）＋ 区域头 id（`headId`＝那张父卡片）。
 *  v0.4.9+ 用户要求的口径＝**区域由子场景决定，父卡片的位置由区域反推**（`scene_geometry.regionFor`＝纯函数＋单测）：
 *  ① 先按 `ids`（全部子场景）当前几何取包围盒 ⇒ ② 派生父卡片新位置（与子场景左对齐、排在子场景上方 `SCENE_CHILD_GAP` 处）⇒
 *  ③ 区域矩形＝包围盒（含派生后的区域头那一行）四边外扩 `FRAME_PAD`。
 *  ⇒ 拖动任一子场景：区域按子场景现算并长/缩，**然后**父卡片被搬到区域左上角；父卡片原来摆在哪不参与区域计算。
 *  框上不挂任何独立文字＝大场景的名字留在它自己的卡片里。 */
interface ScFrame {
	el: SVGRectElement;
	ids: string[]; // 该区域的**子场景**（含嵌套子孙）卡片 id＝区域骨架的唯一来源
	headId: string; // 区域头＝那张父卡片 id（位置由 regionFor 派生，不参与包围盒计算）
	box: { x: number; y: number; w: number; h: number } | null; // v0.4.9+ applyRegion 最近一次算出的区域矩形（内容范围/适应全图都按它算，不回读 DOM）
	color?: string; // v0.4.8+ 地形/颜色字段给的区域色（applyRegion 涂到衬底 fill＋描边；undefined＝默认衬底）
}
// v0.4.9+ 连线路径几何已下沉 src/scene_geometry.ts（纯函数＋node 侧测试）：一律**直角折线**（用户要求），
// 渲染与拖动实时重算共用同一口径（代码重用）；包含框矩形与区域头定位也在该模块（`frameBoxFor`/`regionHeadFor`/`regionFor`）。

/** 一条已画连线（v0.4.9+ 起**只剩「关联」这一种**＝父子之间不再画线，包含关系只由包含框表达）：
 *  path 元素＋两端卡片行 id（from＝声明 `- 关联：` 的那一行）＋几何一律 `relEdgePathD`（moveLive 按此重算）；
 *  labelEl＝联通性说明（`- 关联：甲（官道·三日路程）` 括号文字，v0.4.9+ 起在编辑弹窗里逐行可编辑），画在连线中点、随拖动重定位 */
interface ScEdge {
	path: SVGPathElement;
	fromId: string;
	toId: string;
	labelEl?: SVGTextElement;
}

// v0.4.8+ 地形色板/区域色计算已下沉 md_docs（SCENE_TERRAIN_COLORS/sceneTerrainColor）＝面板着色与编辑弹窗下拉共用（代码重用）

/** v0.4.8+ 把路标文字摆到连线中点（path 测距取半长点位；path 未布局/长度为 0 时不动） */
function placeEdgeLabel(path: SVGPathElement, txt: SVGTextElement): void {
	try {
		const len = path.getTotalLength();
		if (!len) return;
		const pt = path.getPointAtLength(len / 2);
		txt.setAttribute("x", String(Math.round(pt.x * 10) / 10));
		txt.setAttribute("y", String(Math.round(pt.y * 10) / 10));
	} catch { /* 非几何 path（理论上不会）＝保持原位 */ }
}

/** 拖动组成员卡片：卡片元素＋该行＋拖动起点（＝posLive 现值） */
interface ScDragMember {
	row: SceneRow;
	card: HTMLElement;
	baseX: number;
	baseY: number;
}

/** 拖动位置会话（仅鼠标左键；越过 5px 阈值才激活，未越界＝普通点击/双击语义不动）。
 *  组语义＝画布文件夹：**被拖卡片连同其全部子孙场景一起移动**（保持包含结构），松手整组落盘 */
interface ScDrag {
	members: ScDragMember[];
	startX: number;
	startY: number;
	active: boolean;
}

/**
 * 场景面板（自定义 ItemView，v0.4.7+）：汇总当前小说**书/卷/章三层《场景.md》**的场景条目，**卡片画布**展示——
 * 卡片绝对定位（坐标来自场景 `- 位置：x,y` 字段，未设者按**父子树嵌套**自动排布：子场景排在父场景卡片内部下方）、
 * **有 `- 父场景：` 关系的场景才连线/成组**（父解析＝同文档优先→全局首个，同名不同文档不误连；环守卫）、
 * 父场景带**包含框**（子树包围盒圆角矩形衬底，拖动任意成员实时重算），**拖动卡片＝整组（含全部子孙）一起移动**并整组落盘、
 * 画布 Ctrl|Shift＋滚轮缩放／左键拖动平移（CanvasPanel 共用设施）。
 * 数据经构造注入的 getter 实时读取；《场景.md》变更由 main.ts 防抖调 refresh()。
 * 渲染陷阱同 StatusView / RelationshipView：UI 必须建在 onOpen 的 contentEl（本环境不调用 getEmptyStateElement）。
 */
export class SceneView extends ItemView {
	static readonly VIEW_TYPE = "articlewriter-scenes";

	private getData: () => Promise<SceneSnapshot>;
	private onMoveScenes?: (moved: { row: SceneRow; x: number; y: number }[]) => void | Promise<void>; // 拖动松手写回（main.ts：按文档合并 rewriteScenePosition 落盘＋Notice＋刷新；整组拖动一次传多条）
	private onAddScene?: (at?: { x: number; y: number }) => void | Promise<void>; // 头部「＋ 场景」／空白处右键「在此添加场景」（main.ts：SceneEditModal 新建 → insertSceneBlock；v0.4.9+ 写入哪一层《场景.md》由弹窗顶部「级别」下拉决定（默认卷级·当前卷）；at＝画布落点＝新场景 `- 位置：x,y`）
	private onEditScene?: (row: SceneRow) => void | Promise<void>; // 卡片 ✎／右键「编辑场景」（main.ts：SceneEditModal → updateSceneBlock）
	private onDeleteScene?: (row: SceneRow) => void | Promise<void>; // 卡片 🗑／右键「删除」（main.ts：ConfirmModal → deleteSceneBlock）
	private onAddChildScene?: (row: SceneRow, at?: { x: number; y: number }) => void | Promise<void>; // 右键「添加子场景」（main.ts：SceneEditModal 预填父场景 → 写同文档、`- 父场景：` 挂链；v0.4.9+ `at`＝同「＋ 场景」的落点判定（自动布局看不见才给视口左上角））
	private onOpenTimelineEvent?: (eventName: string) => void | Promise<void>; // v0.4.8+ 卡片「🕐」区点击事件＝main.ts 激活时间线面板并按名字定位该条目（闪烁高亮）
	private eventTimes: Record<string, string> = {}; // v0.4.8+ 本次渲染的时间线事件索引（小写名→时间点文本），renderBody 每趟从快照取
	/** v0.4.9+ 当前展开的卡片「🕐」事件列表的收起句柄（同时只可能有一个；未展开＝null）。点画布空白处／右键／按 Esc／重渲染都要走它 */
	private closeEvList: (() => void) | null = null;
	private built = false;
	private needsFit = true; // v0.4.9+：本次面板打开后**首次渲染**自动「适应全图」（包住全部场景），之后保留用户视野
	private rootEl!: HTMLElement;
	private topEl!: HTMLElement;
	private sumEl!: HTMLElement;
	private canvas!: CanvasPanel;
	private busy = false;
	private lastSnap: SceneSnapshot | null = null;
	private filterText = "";
	private drag: ScDrag | null = null;
	private edges: ScEdge[] = []; // 本次渲染画出的父子连线（renderBody 清空重建；拖动中按 posLive 实时重算）
	private posLive = new Map<string, { x: number; y: number; w: number; h: number }>(); // 卡片当前布局坐标（row.id→几何）；拖动中同步移动端点
	private cardsById = new Map<string, ScItem>(); // 本次渲染的卡片条目（组拖动取成员、拖动起点坐标）
	private childIdsById = new Map<string, string[]>(); // 父子树（row.id→直接子行 id）：组拖动与包含框子树收集
	private frames: ScFrame[] = []; // 包含框（每个「有可见子场景的父场景」一个），任一子场景移动后一律现算（区域骨架只由子场景算出，父卡片的新位置随之派生）
	private edgeSvgEl: SVGSVGElement | null = null; // v0.4.9+ 本次渲染的底图 svg（包含框＋关联线）：内容范围变了要跟着改尺寸
	private gridEl: HTMLElement | null = null; // v0.4.9+ 本次渲染的坐标网格衬底（同上）
	private extentRight = 0; // v0.4.9+ 已写入的内容范围（画布坐标右/下边界）＝syncExtent 的现值，变了才动 DOM
	private extentBottom = 0;

	constructor(
		leaf: WorkspaceLeaf,
		getData: () => Promise<SceneSnapshot>,
		onMoveScenes?: (moved: { row: SceneRow; x: number; y: number }[]) => void | Promise<void>,
		onAddScene?: (at?: { x: number; y: number }) => void | Promise<void>, // at＝空白处右键的画布落点（头部按钮不带）
		onEditScene?: (row: SceneRow) => void | Promise<void>,
		onDeleteScene?: (row: SceneRow) => void | Promise<void>,
		onAddChildScene?: (row: SceneRow, at?: { x: number; y: number }) => void | Promise<void>,
		onOpenTimelineEvent?: (eventName: string) => void | Promise<void> // v0.4.8+ 卡片「🕐」区点击事件名＝跳时间线面板并定位该条目
	) {
		super(leaf);
		this.getData = getData;
		this.onMoveScenes = onMoveScenes;
		this.onAddScene = onAddScene;
		this.onEditScene = onEditScene;
		this.onDeleteScene = onDeleteScene;
		this.onAddChildScene = onAddChildScene;
		this.onOpenTimelineEvent = onOpenTimelineEvent;
	}

	getViewType(): string {
		return SceneView.VIEW_TYPE;
	}

	getDisplayText(): string {
		return "场景";
	}

	getIcon(): string {
		return "map";
	}

	async onOpen(): Promise<void> {
		if (!this.built) this.buildUI(this.contentEl);
		void this.refresh();
	}

	async onClose(): Promise<void> {
		this.canvas?.dispose();
		this.needsFit = true; // v0.4.9+ 面板重开＝重新做一次「适应全图」（上次关之前的视野不留存）
	}

	/** v0.4.9+ ItemView 尺寸变化钩子＝催画布走**与尺寸观察器同一套**防抖处理（apply 重算画布尺寸与可滚/可拖限位＋宽度真变化才重渲染内容；无 ResizeObserver 环境里这是唯一路径） */
	onResize(): void {
		this.canvas?.notifyResize();
	}

	/** 面板拖宽/分屏/窗口缩放：按缓存快照重渲染（自动布局依赖画布宽度），不重新读盘；拖动中跳过（防清掉手势持有元素） */
	private handleCanvasResize(): void {
		if (this.busy || this.drag) return;
		if (this.lastSnap) this.render(this.lastSnap);
	}

	private buildUI(parent: HTMLElement): void {
		this.built = true;
		this.rootEl = parent.createDiv({ cls: "aw-status-view aw-scene-view" }); // 复用写字台的容器/字体/滚动布局样式
		this.topEl = this.rootEl.createDiv({ cls: "aw-st-top" }); // 固定头部：筛选框 + 刷新按钮（不显示工作目录/小说列表）
		this.canvas = new CanvasPanel(this.rootEl, {
			bodyCls: "aw-st-tree aw-scene-body",
			sizerCls: "aw-scene-sizer",
			zoomCls: "aw-scene-zoom",
			zoomVar: "--aw-scene-zoom",
			zoomLabelCls: "aw-dim aw-scene-zoomlbl is-hidden",
			onResize: () => this.handleCanvasResize(),
		});
		// v0.4.9+ 点画布**空白处**＝收起展开的卡片事件列表（用户要求）。
		// **capture 阶段**＝卡片上的 pointerdown 即使被拖动/按钮手势 stopPropagation 也照样先看到；列表与它的「🕐 N 个事件」按钮都在 `.aw-scene-card` 内＝不动
		this.canvas.bodyEl.addEventListener("pointerdown", (ev: PointerEvent) => {
			if ((ev.target as HTMLElement | null)?.closest(".aw-scene-card")) return;
			this.closeEventList();
		}, true);
		// v0.4.9+ Esc＝收起展开的事件列表（挂在画布上＝面板有焦点时生效，不影响 Obsidian 其它 Esc 语义）
		this.canvas.bodyEl.addEventListener("keydown", (ev: KeyboardEvent) => {
			if (ev.key === "Escape") this.closeEventList();
		});
		this.sumEl = this.rootEl.createDiv({ cls: "aw-dim aw-rel-summary aw-scene-sumrow" }); // 底部固定汇总行（不参与缩放/平移）
		// v0.4.9+ 画布**空白处右键**菜单（桌面右键／触屏长按同一路径）＝「在此添加场景」（新场景落在点击处的画布坐标）＋「适应全图」＋「刷新」。
		// 卡片自身的 contextmenu 已 stopPropagation（openCardMenu）＝不会两菜单叠加；包含框/网格都是 pointer-events:none＝都算空白处。
		this.canvas.bodyEl.addEventListener("contextmenu", (ev: MouseEvent) => {
			if ((ev.target as HTMLElement | null)?.closest(".aw-scene-card")) return; // 卡片上＝卡片菜单的天下
			this.closeEventList(); // v0.4.9+ 空白处右键（弹出画布菜单）＝顺手收起事件列表
			ev.preventDefault();
			const menu = new Menu();
			const at = this.canvas.toContentPoint(ev.clientX, ev.clientY); // 落点换算与缩放/平移/滚动同一口径
			const loc = { x: Math.round(at.x), y: Math.round(at.y) };
			if (this.onAddScene && this.lastSnap?.activeStory) {
				menu.addItem((it) => it.setSection("aw-scene-canvas").setTitle("在此添加场景").setIcon("plus").onClick(() => void this.onAddScene?.(loc)));
			}
			menu.addItem((it) => it.setSection("aw-scene-canvas").setTitle("适应全图").setIcon("frame").onClick(() => this.fitAll())); // v0.4.9+ 视图跑偏了（或放大后想退回看全貌）＝一键包住全部场景
			menu.addItem((it) => it.setSection("aw-scene-canvas").setTitle("刷新").setIcon("refresh").onClick(() => void this.refresh()));
			menu.showAtPosition({ x: ev.x, y: ev.y });
		});
		// v0.4.8+ 角落罗盘徽章（上北下南左西右东）：固定在面板**左上角**（v0.4.9 用户要求，原右上角）、不随缩放/平移——空白画布上给出全局方位感；纯装饰（pointer-events:none）
		const compass = this.rootEl.createDiv({ cls: "aw-scene-compass" });
		const cSvg = compass.createSvg("svg", { attr: { viewBox: "0 0 60 60", width: "52", height: "52" } });
		cSvg.createSvg("circle", { cls: "aw-scene-compass-ring", attr: { cx: "30", cy: "30", r: "21" } });
		cSvg.createSvg("path", { cls: "aw-scene-compass-needle", attr: { d: "M30 10 L35 32 L30 27 L25 32 Z" } }); // 北针（指向上方）
		cSvg.createSvg("path", { cls: "aw-scene-compass-tail", attr: { d: "M30 50 L25 32 L30 36 L35 32 Z" } }); // 南尾
		for (const [ch, x, y] of [["北", 30, 7], ["东", 54, 32], ["南", 30, 57], ["西", 6, 32]] as const) {
			const dir = cSvg.createSvg("text", { cls: "aw-scene-compass-dir", attr: { x: String(x), y: String(y) } });
			dir.textContent = ch; // SvgElementInfo 无 text 字段（obsidian 类型）＝建好再填
		}
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
			this.canvas.zoomEl.empty();
			this.topEl.createDiv({ text: `加载失败：${e instanceof Error ? e.message : String(e)}`, cls: "aw-st-error" });
		} finally {
			this.busy = false;
		}
	}

	private render(snap: SceneSnapshot): void {
		this.topEl.empty();
		this.renderTop();
		this.renderBody(snap);
	}

	/** 固定头部：筛选输入框 + 倍率标签 + 刷新按钮 */
	private renderTop(): void {
		const filterRow = this.topEl.createDiv({ cls: "aw-rel-filter-row" });
		const input = filterRow.createEl("input", { type: "text", cls: "aw-rel-filter", placeholder: "筛选场景 / 角色…" });
		input.value = this.filterText;
		input.addEventListener("input", () => {
			this.filterText = input.value; // 只重渲染主体区（头部保持不动，输入焦点与光标不丢）
			if (this.lastSnap) this.renderBody(this.lastSnap);
		});
		this.canvas.attachZoomLabel(filterRow);
		const btns = filterRow.createSpan({ cls: "aw-st-actions" });
		if (this.onAddScene) {
			const add = btns.createEl("button", { text: "＋ 场景", attr: { title: "新建场景：弹窗最上方的「级别」下拉选择写进哪一层《场景.md》（默认＝卷级 · 当前卷）；新场景先按自动布局排，排到视口外或压到旧卡片时才放到当前视野左上角" } }); // v0.4.9+ 根级新增＝写入层级由弹窗「级别」下拉决定（书级/卷级/章级；文件缺失自动按 "# 场景" 起底创建）
			add.disabled = !this.lastSnap?.activeStory;
			add.addEventListener("click", () => void this.onAddScene?.(this.newScenePoint())); // v0.4.9+ 落点＝先自动布局；排到视口外／压到旧卡片＝视口左上角 +(50,50)（带阶梯避让）
		}
		btns.createEl("button", { text: "刷新" }).addEventListener("click", () => void this.refresh());
	}

	/** **新建场景的落点**（v0.4.9+ 用户要求＝**先走自动布局**）：按当前已渲染布局推算「这次新增会排在哪」——
	 *  ① 推算结果**整块落在当前视口内**且**没被旧卡片压住**＝返回 `undefined`＝**不写 `- 位置：`**、保持自动布局（文档不被多写一行）；
	 *  ② 否则（排到视口外＝场景常散在画布深处；或那位置已被旧卡片压住）＝改放**当前视口左上角 +(50,50)**，
	 *     并按 `NEW_SCENE_CASCADE` 阶梯避开现有卡片（`freeAnchorFor`＝纯函数＋单测；换算走 `CanvasPanel.viewPoint`＝与右键落点/滚轮缩放同一口径）。
	 *  面板还没渲染过（`lastSnap` 空/视口零尺寸）＝`undefined`＝旧口径（自动布局） */
	private newScenePoint(parent?: SceneRow): { x: number; y: number } | undefined {
		const occupied = [...this.posLive.values()];
		const vp = this.viewportRect();
		const slot = this.autoSlotForNew(parent, occupied);
		if (slot && vp && autoSlotUsable(slot, this.estimateCardSize(occupied), vp, occupied)) return undefined; // 自动布局本身就看得见＝不打扰（不写位置）
		if (!vp) return undefined;
		const p = this.canvas.viewPoint(NEW_SCENE_VIEW_OFFSET, NEW_SCENE_VIEW_OFFSET);
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
		return freeAnchorFor(p, occupied, NEW_SCENE_CASCADE);
	}

	/** 当前视口在**内容坐标系**里的矩形（＝`viewPoint(0,0)`～`viewPoint(视口宽高)`）；未渲染/视口零尺寸＝undefined */
	private viewportRect(): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
		if (!this.lastSnap) return undefined;
		const w = this.canvas.bodyEl.clientWidth;
		const h = this.canvas.bodyEl.clientHeight;
		if (!w || !h) return undefined;
		const a = this.canvas.viewPoint(0, 0);
		const b = this.canvas.viewPoint(w, h);
		if (![a.x, a.y, b.x, b.y].every((v) => Number.isFinite(v))) return undefined;
		return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
	}

	/** **自动布局会把新增场景排在哪**（按当前已渲染布局推算，口径同 `layout()`：子＝所在子树下边界 + `SCENE_CHILD_GAP`、x＝父卡片 x + `SCENE_INDENT`；
	 *  顶层＝全部卡片下边界 + `SCENE_GAP`、x＝`SCENE_MARGIN`＝顶层块追加在最后）。按名挂父但父卡未渲染＝undefined（无从推算＝走视口左上角兜底） */
	private autoSlotForNew(parent: SceneRow | undefined, occupied: ScBox[]): { x: number; y: number } | undefined {
		if (parent) {
			const pl = this.posLive.get(parent.id);
			if (!pl) return undefined;
			let bottom = pl.y + pl.h;
			const walk = (id: string): void => {
				for (const kid of this.childIdsById.get(id) ?? []) {
					const k = this.posLive.get(kid);
					if (k) bottom = Math.max(bottom, k.y + k.h);
					walk(kid);
				}
			};
			walk(parent.id);
			return { x: pl.x + SCENE_INDENT, y: bottom + SCENE_CHILD_GAP };
		}
		let bottom = -Infinity;
		for (const p of occupied) bottom = Math.max(bottom, p.y + p.h);
		if (!Number.isFinite(bottom)) return undefined; // 一张卡都没有＝没有可推算的布局
		return { x: SCENE_MARGIN, y: bottom + SCENE_GAP };
	}

	/** 新卡尺寸估算（判断自动布局落点可不可用总要个宽高＝卡片真实尺寸要渲染后才知道）＝现有卡片平均宽高，无卡片＝200×80 */
	private estimateCardSize(occupied: ScBox[]): { w: number; h: number } {
		if (!occupied.length) return { w: 200, h: 80 };
		let w = 0;
		let h = 0;
		for (const b of occupied) {
			w += b.w;
			h += b.h;
		}
		return { w: w / occupied.length, h: h / occupied.length };
	}

	/** 主体区：卡片画布（pass1 建卡测尺寸 → pass2 布局（有 `- 位置：` 按坐标钉住、没有＝父子嵌套自动排）→ pass2.5 区域锚定 → pass3 落位＋包含框＋连线）＋底部汇总行 */
	private renderBody(snap: SceneSnapshot): void {
		const zoom = this.canvas.zoomEl;
		this.eventTimes = snap.eventTimes ?? {}; // v0.4.8+ 本次渲染的事件索引（卡片「🕐」区解析 `- 事件：` 用）
		this.closeEventList(); // v0.4.9+ 重渲染前收起（列表即将随 zoom.empty() 消失＝别留下过期句柄）
		zoom.empty();
		const ph = this.placeholderFor(snap);
		this.sumEl.empty();
		this.sumEl.toggleClass("is-hidden", !!ph);
		if (ph) {
			zoom.createDiv({ text: ph, cls: "aw-dim aw-st-hint aw-scene-ph" });
			this.canvas.apply();
			return;
		}
		const q = this.filterText.trim().toLowerCase();
		const shown = q ? snap.rows.filter((r) => matchRow(r, q)) : snap.rows;
		const byScope = (s: SceneScope): number => snap.rows.filter((r) => r.scope === s).length;
		if (q) this.sumEl.setText(`匹配 ${String(shown.length)} 条（共 ${String(snap.totalCount)} 条）`);
		else this.sumEl.setText(`共 ${String(snap.totalCount)} 条：书籍级 ${String(byScope("book"))} · 卷级 ${String(byScope("volume"))} · 章级 ${String(byScope("chapter"))}`);
		// —— 父子树：`- 父场景：` 解析＝**同一文档优先**→全局文档序首个（同名场景跨层不误连）；再走链防环（成环者按顶层渲染）——
		const byPathId = new Map<string, SceneRow>();
		const byFirstId = new Map<string, SceneRow>();
		for (const r of shown) {
			byPathId.set(`${r.sourcePath}##${r.scene_id}`, r);
			if (!byFirstId.has(r.scene_id)) byFirstId.set(r.scene_id, r);
		}
		const resolveParent = (r: SceneRow): SceneRow | undefined => {
			if (!r.parent) return undefined;
			const p = byPathId.get(`${r.sourcePath}##${r.parent}`) ?? byFirstId.get(r.parent);
			return p && p !== r ? p : undefined;
		};
		// 关联场景解析（v0.4.7+）：同文档优先→全局首个（口径同 resolveParent），卡片 chip 点击跳转＋关联连线共用
		const relatedOf = new Map<string, { row: SceneRow; cardId: string } | undefined>();
		for (const r of shown) for (const id of r.related ?? []) {
			if (id === r.scene_id) continue; // 自关联忽略
			const t = byPathId.get(`${r.sourcePath}##${id}`) ?? byFirstId.get(id);
			relatedOf.set(`${r.id}##${id}`, t ? { row: t, cardId: t.id } : undefined);
		}
		const relationPairs: Array<{ from: SceneRow; to: SceneRow; label?: string }> = []; // 关联连线端点（from＝声明 `- 关联：` 的行；重复对去重；label＝`（路标）` 文字）
		const relSeen = new Set<string>();
		for (const r of shown) for (const id of r.related ?? []) {
			const t = relatedOf.get(`${r.id}##${id}`);
			if (!t) continue;
			const key = `${r.id}→${t.cardId}`;
			if (relSeen.has(key)) continue;
			relSeen.add(key);
			relationPairs.push({ from: r, to: t.row, label: r.relatedLabels?.[id] });
		}
		const safeParent = (r: SceneRow): SceneRow | undefined => {
			const p0 = resolveParent(r);
			if (!p0) return undefined;
			let cur: SceneRow | undefined = p0;
			const seen = new Set<SceneRow>([r]);
			while (cur) {
				if (seen.has(cur)) return undefined; // 父链成环：断链按顶层，不连线不成组
				seen.add(cur);
				cur = resolveParent(cur);
			}
			return p0;
		};
		const childrenOf = new Map<SceneRow, SceneRow[]>();
		const roots: SceneRow[] = [];
		this.childIdsById = new Map<string, string[]>();
		for (const r of shown) {
			const p = safeParent(r);
			if (p) {
				const arr = childrenOf.get(p);
				if (arr) arr.push(r);
				else childrenOf.set(p, [r]);
				const ids = this.childIdsById.get(p.id);
				if (ids) ids.push(r.id);
				else this.childIdsById.set(p.id, [r.id]);
			} else roots.push(r);
		}
		// v0.4.9+ **有可见子场景的父场景**＝卡片是「区域头」（虚线边框＋子场景计数，名字与详情仍在卡片里），且父子之间不再画线（框本身就表示包含）
		const framedIds = new Set<string>();
		for (const [p, kids] of childrenOf) if (kids.length) framedIds.add(p.id);
		// —— pass1：建卡片元素并测尺寸（绝对定位不影响测量）——
		const gridEl = zoom.createDiv({ cls: "aw-scene-grid" }); // v0.4.8+ 地图坐标网格衬底（纯 CSS 点阵，随缩放/平移走；宽高在 pass3 按内容尺寸给）
		const edgeSvg = zoom.createSvg("svg", { cls: "aw-scene-edges" });
		this.edges = [];
		this.frames = [];
		this.posLive = new Map<string, { x: number; y: number; w: number; h: number }>();
		this.cardsById = new Map<string, ScItem>();
		for (const r of shown) {
			const card = this.renderCard(r, safeParent(r), (relId) => relatedOf.get(`${r.id}##${relId}`)?.row, framedIds.has(r.id));
			this.cardsById.set(r.id, { row: r, card, w: card.offsetWidth, h: card.offsetHeight, x: 0, y: 0 });
		}
		// —— pass2：布局。已存坐标（x/y 同时存在）钉在坐标上；未设者按父子树嵌套——子场景排在父卡片内部下方（缩进递归），顶层块自上而下排。不落盘——
		const bottomById = new Map<string, number>();
		const layout = (r: SceneRow, x: number, y: number): void => {
			const it = this.cardsById.get(r.id);
			if (!it) return;
			if (r.x != null && r.y != null) {
				it.x = r.x;
				it.y = r.y;
			} else {
				it.x = x;
				it.y = y;
			}
			this.posLive.set(r.id, { x: it.x, y: it.y, w: it.w, h: it.h });
			let bottom = it.y + it.h;
			const kids = childrenOf.get(r);
			const gap = SCENE_CHILD_GAP;
			let curY = bottom + gap;
			for (const c of kids ?? []) {
				layout(c, it.x + SCENE_INDENT, curY);
				const cb = bottomById.get(c.id) ?? curY;
				if (cb > bottom) bottom = cb;
				if (cb + gap > curY) curY = cb + gap;
			}
			bottomById.set(r.id, bottom);
		};
		let cy = SCENE_MARGIN + FRAME_PAD; // v0.4.9+ 顶部先让出包含框的外扩量＝最上层大场景的框不会被顶出内容上边界
		for (const r of roots) {
			layout(r, SCENE_MARGIN, cy);
			cy = (bottomById.get(r.id) ?? cy) + SCENE_GAP;
		}
		// v0.4.9+（用户要求＝**顺序不能反**）**有子场景＝先按全部子场景算出区域，再算父卡片的新位置**：
		// 后序遍历拿到「全部子孙卡片几何」⇒ `scene_geometry.regionFor`＝① 子场景包围盒 ② 派生区域头位置（与子场景左对齐、排在子场景上方 SCENE_CHILD_GAP）
		// ⇒ 区域骨架只由子场景决定，父卡片**原来摆在哪儿不参与计算**（pass3 的 applyRegions 用同一函数算框，两处口径一致）
		const subtreeBoxes = (n: SceneRow): ScBox[] => {
			const it = this.cardsById.get(n.id);
			if (!it) return [];
			const desc: ScBox[] = [];
			for (const c of childrenOf.get(n) ?? []) desc.push(...subtreeBoxes(c)); // 先归位子孙（后序），其几何已是最终值
			if (desc.length) {
				const r = regionFor({ w: it.w, h: it.h }, desc, SCENE_CHILD_GAP, FRAME_PAD);
				if (r) {
					it.x = r.head.x;
					it.y = r.head.y;
					const pl = this.posLive.get(n.id);
					if (pl) {
						pl.x = r.head.x;
						pl.y = r.head.y;
					}
				}
			}
			return [...desc, { x: it.x, y: it.y, w: it.w, h: it.h }];
		};
		for (const r of roots) subtreeBoxes(r);
		// —— pass3：落位＋包含框＋连线（框/线都渲在卡片下层底图里；只有有关系的场景才有框线）——
		for (const it of this.cardsById.values()) {
			it.card.style.left = `${Math.round(it.x)}px`;
			it.card.style.top = `${Math.round(it.y)}px`;
			this.attachDrag(it.card, it.row);
		}
		const collectIds = (r: SceneRow, out: string[]): void => {
			out.push(r.id);
			for (const c of childrenOf.get(r) ?? []) collectIds(c, out);
		};
		const buildFrames = (n: SceneRow): void => {
			const kids = childrenOf.get(n);
			if (!kids || !kids.length) return;
			const ids: string[] = [];
			for (const c of kids) collectIds(c, ids); // **只数子场景**（含嵌套子孙）＝区域骨架；父卡片不进 ids（v0.4.9+ 用户要求＝区域不由父卡片位置算出），它记在 headId
			const regionColor = sceneTerrainColor(n); // v0.4.8+ 该区域（父场景自身）的地形/自定义色
			const rect = edgeSvg.createSvg("rect", { cls: "aw-scene-frame", attr: { rx: "10", ry: "10" } }); // v0.4.7+ 纯衬底：不拦截指针（pointer-events:none），框内空白＝画布平移热区；整组挪动＝拖父卡片（attachDrag 已含全部子孙）
			if (regionColor) { // v0.4.8+ 有 `- 地形：`/`- 颜色：`＝衬底涂成对应浅色地理区块（is-terrain 让出 CSS 默认色、属性色生效）
				rect.classList.add("is-terrain");
				rect.setAttribute("fill", regionColor);
				rect.setAttribute("stroke", regionColor);
			}
			this.frames.push({ el: rect, ids, headId: n.id, box: null, color: regionColor }); // v0.4.9+ 框上不再有独立区域标签文字＝名字留在左上角那张父卡片里；矩形紧随其后由 applyRegions 现算
			for (const c of kids) buildFrames(c);
		};
		for (const r of roots) buildFrames(r);
		this.applyRegions();
		// v0.4.9+ **父子之间不再画线**（用户要求）：包含框＋框左上角的区域标签已经把「大场景包小场景」讲清楚了，
		// 再连一条层级线只是重复信息还把画面搞乱；只保留「关联」连线（＝交通路线，不是层级关系）。
		// 关联场景连线（v0.4.7+）：强调色长划折线（区别于层级短划），几何就近选边；拖动中同样按 relEdgePathD 实时重算。
		// v0.4.8+ 带 `（说明）` 的关联＝交通路线：连线中点挂小标签（官道/传送阵…），随拖动重定位；v0.4.9+ 该说明在编辑弹窗「关联场景」行里逐条可编辑
		for (const pr of relationPairs) {
			const a = this.edgeBox(pr.from.id); // v0.4.9+ 端点＝包含框（该场景有可见子场景时）或卡片矩形
			const b = this.edgeBox(pr.to.id);
			if (!a || !b) continue;
			const path = edgeSvg.createSvg("path", { cls: "aw-scene-rel-edge", attr: { d: relEdgePathD(a, b) } });
			const edge: ScEdge = { path, fromId: pr.from.id, toId: pr.to.id };
			if (pr.label?.trim()) {
				const txt = edgeSvg.createSvg("text", { cls: "aw-scene-edge-label" });
				txt.textContent = pr.label.trim(); // SvgElementInfo 无 text 字段＝建好再填
				placeEdgeLabel(path, txt);
				edge.labelEl = txt;
			}
			this.edges.push(edge);
		}
		// 图例（v0.4.9+ 起画布上**只剩关联这一种线**＝强调色长划折线，父子不再连线）：有关联线才出「关联」段，有包含框才出「包含」段
		if (this.edges.length) {
			this.sumEl.createSpan({ text: "─ ─", cls: "aw-scene-legend-mark is-rel" });
			this.sumEl.createSpan({ text: "关联（线上文字＝联通性说明，编辑场景的「关联场景」行可改）", cls: "aw-dim aw-scene-legend" });
		}
		if (this.frames.length) {
			this.sumEl.createSpan({ text: "▢", cls: "aw-scene-legend-mark is-frame" });
			this.sumEl.createSpan({ text: "包含（大场景的框＝含其全部子场景，左上角那张虚线边卡片就是大场景本身）", cls: "aw-dim aw-scene-legend" });
		}
		// v0.4.9+ 内容范围（＝底图 svg／网格／zoom 层高度与横向可滚范围）一律**现算**＝卡片几何∪各区域框矩形。
		// 拖动成员后必须重算：只算一次的旧口径＝区域往下长出来的部分落在旧内容边界外，被滚动视口切掉，
		// 看着就是「子场景下移了、父场景的区域高度却没变」（用户报告），而且那段区域再也滚不到。
		this.edgeSvgEl = edgeSvg;
		this.gridEl = gridEl;
		this.extentRight = 0;
		this.extentBottom = 0;
		this.syncExtent();
		this.canvas.apply();
		// v0.4.9+ **首次渲染自动适应全图**（用户要求）：把视图缩放＋平移到「视口刚好包住所有场景」——
		// 位置坐标常是大负数/远离原点，默认 z=1 视口左上角对着 (0,0) 时第一次打开经常什么都不在视野里。
		// 只在第一次（built 后首帧）做，之后刷新/重渲染/改筛选都保留用户当前视野。
		if (this.needsFit) this.fitAll(true);
	}

	/** **适应全图**（v0.4.9+）：按当前已渲染卡片的包围盒调 `CanvasPanel.fitToRect`（倍率上限 100%＝只缩小不放大）。
	 *  首次渲染自动调一次（`auto`＝视口量不出来时把 needsFit 留给下一帧）；空白处右键菜单「适应全图」手动调（不动 needsFit）。无卡片＝不动视图 */
	private fitAll(auto: boolean = false): void {
		let minX = Infinity;
		let minY = Infinity;
		let maxR = -Infinity;
		let maxB = -Infinity;
		for (const p of this.posLive.values()) {
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x + p.w > maxR) maxR = p.x + p.w;
			if (p.y + p.h > maxB) maxB = p.y + p.h;
		}
		if (!Number.isFinite(minX) || maxR <= minX || maxB <= minY) {
			this.needsFit = false; // 没有卡片可包（空态/筛选没命中）＝别每帧白试
			return;
		}
		// v0.4.9+ 各区域框矩形（`f.box`＝applyRegions 现算的）也计入包围盒＝「适应全图」不会把区域切在画面外
		for (const f of this.frames) {
			const b = f.box;
			if (!b || ![b.x, b.y, b.w, b.h].every((v) => Number.isFinite(v))) continue;
			if (b.x < minX) minX = b.x;
			if (b.y < minY) minY = b.y;
			if (b.x + b.w > maxR) maxR = b.x + b.w;
			if (b.y + b.h > maxB) maxB = b.y + b.h;
		}
		if (this.canvas.fitToRect({ x: minX, y: minY, w: maxR - minX, h: maxB - minY }) == null) {
			this.needsFit = auto; // 视口还没量出来（面板未展开/0 高）＝auto 时把机会留给下一帧（ResizeObserver 会再渲染一次）
			return;
		}
		this.needsFit = false;
	}

	/** 单张场景卡片：名称＋层级/来源标签＋父场景标注＋描述＋角色 chips＋关联场景 chips＋备注（双击打开来源文档；按住拖动＝整组改位置）。
	 *  `hasKids`＝该场景本次渲染**有可见子场景**（v0.4.9+）＝卡片挂 `.is-region`（虚线边框＝区域头）并补一条「N 个子场景」；
	 *  名字与详情**仍在卡片内**（用户要求：不要单独挂在框外空白处）——「在区域左上角」由 `applyRegions`→`regionFor` 把这张卡片摆到区域左上角实现（＝区域先由子场景算出，卡片位置随后派生） */
	private renderCard(r: SceneRow, parent: SceneRow | undefined, resolveRelated: (relId: string) => SceneRow | undefined, hasKids: boolean = false): HTMLElement {
		const card = this.canvas.zoomEl.createDiv({ cls: hasKids ? "aw-scene-card is-region" : "aw-scene-card" }); // v0.4.9+ 有子场景＝该卡片就是「区域头」（虚线边框）：名字与详情**写在卡片里**（用户要求＝不要单独挂在框外的空白处），卡片本身被摆在该区域左上角（`regionFor`＝区域骨架只由子场景算，卡片位置随后派生）
		const regionColor = sceneTerrainColor(r); // v0.4.8+ 地图着色：卡片按本地形/颜色淡染（有包含框的场景同时＝框衬底，两者同色系＝区域一眼可辨）
		if (regionColor) {
			card.classList.add("aw-scene-terrain");
			card.style.setProperty("--aw-scene-terrain", regionColor); // 内联动态值（同 canvas zoom 变量口径）
		}
		const head = card.createDiv({ cls: "aw-scene-head" });
		head.createSpan({ text: sceneDisplayName(r), cls: "aw-scene-name" }); // 所有卡片都写名字（v0.4.9+：有子场景的父场景也一样＝名字留在场景块里，只是这块被钉在区域左上角）
		if (r.title?.trim() && r.title.trim() !== r.scene_id) head.createSpan({ text: r.scene_id, cls: "aw-dim aw-scene-id" });
		head.createSpan({ text: r.sourceLabel, cls: "aw-dim aw-tl-src" });
		if (r.parent) head.createSpan({ text: parent ? `⊂ ${sceneDisplayName(parent)}` : `⊂ ${r.parent}（未找到父场景）`, cls: "aw-dim aw-scene-parent" }); // 解析口径同连线（同文档优先），不再有假“父”
		if (r.terrain) head.createSpan({ text: r.terrain, cls: "aw-dim aw-scene-terrain-tag" }); // v0.4.8+ 地形徽章（森林/海洋/城市…原样显示）
		if (hasKids) head.createSpan({ text: `${(this.childIdsById.get(r.id) ?? []).length} 个子场景`, cls: "aw-dim aw-scene-kids" }); // v0.4.9+ 有子场景的卡片补一条计数（名字/详情仍在卡片内）
		if (r.description) card.createDiv({ text: r.description, cls: "aw-scene-desc" }); // 详情同样留在场景块里
		if (r.characters.length) {
			const chars = card.createDiv({ cls: "aw-tl-chars" });
			for (const c of r.characters) chars.createSpan({ text: c, cls: "aw-tl-char" });
		}
		if (r.related?.length) { // v0.4.7+ 关联场景：v0.4.9+ 起**每条独占一行**＝「⇄ 场景名 · 联通性说明」（点击打开目标场景来源文档，解析不到置灰）
			const rel = card.createDiv({ cls: "aw-tl-chars aw-scene-rels" });
			for (const id of r.related) {
				const t = resolveRelated(id);
				const relNote = r.relatedLabels?.[id]; // 联通性说明（`甲（官道·三日路程）`）＝同一个值也画在连线中点
				const chip = rel.createSpan({ text: `⇄ ${t ? sceneDisplayName(t) : id}${relNote ? ` · ${relNote}` : ""}`, cls: t ? "aw-tl-char aw-scene-rel" : "aw-tl-char aw-scene-rel is-missing" });
				if (t) {
					chip.setAttr("aria-label", `打开场景「${sceneDisplayName(t)}」来源文档${relNote ? `（联通性：${relNote}）` : ""}`);
					chip.addEventListener("click", (ev: MouseEvent) => {
						ev.stopPropagation(); // 别触发卡片拖动/双击语义
						void this.openAt(t);
					});
				} else chip.title = "未找到该关联场景（可能已改名或删除）";
			}
		}
		if (r.notes) card.createDiv({ text: `备注：${r.notes}`, cls: "aw-tl-impact" });
		// v0.4.9+ 「🕐」事件行＝常驻一行、排在 **✎／🗑 动作行的上面**（用户要求）＝卡片内容的最后一行信息，
		// 与动作行同处卡片下缘（动作行 `visibility:hidden` 仍占高度＝两行位置都不会跳）
		if (r.events?.length) this.renderEventArea(card, r);
		// 卡片底部动作组（悬停显现，同时间线 .aw-tl-acts 口径）：✎ 编辑 / 🗑 删除；pointerdown 阻止冒泡以免进入拖动位置手势
		const acts = card.createDiv({ cls: "aw-scene-acts" });
		if (this.onEditScene) {
			const bEdit = acts.createEl("button", { text: "✎", cls: "aw-scene-act" });
			bEdit.setAttr("aria-label", "编辑场景");
			bEdit.addEventListener("click", (ev: MouseEvent) => {
				ev.stopPropagation();
				void this.onEditScene?.(r);
			});
		}
		if (this.onDeleteScene) {
			const bDel = acts.createEl("button", { text: "🗑", cls: "aw-scene-act is-tl-danger" });
			bDel.setAttr("aria-label", "删除场景");
			bDel.addEventListener("click", (ev: MouseEvent) => {
				ev.stopPropagation();
				void this.onDeleteScene?.(r);
			});
		}
		acts.addEventListener("pointerdown", (ev: PointerEvent) => ev.stopPropagation());
		if (this.onEditScene || this.onDeleteScene) {
			card.addEventListener("contextmenu", (ev: MouseEvent) => {
				ev.preventDefault();
				ev.stopPropagation();
				this.openCardMenu(ev, r);
			});
		}
		card.addEventListener("dblclick", (ev: MouseEvent) => {
			ev.stopPropagation();
			// v0.4.8+ 双击＝打开场景编辑弹窗（不再打开来源文档——来源文档入口＝右键「打开来源文档」）
			if (this.onEditScene) void this.onEditScene(r);
			else void this.openAt(r);
		});
		return card;
	}

	/** v0.4.9+ 收起当前展开的卡片事件列表（没有展开＝空操作）。**点画布空白处／卡片右键／Esc／重渲染都走这里** */
	private closeEventList(): void {
		if (!this.closeEvList) return;
		const off = this.closeEvList;
		this.closeEvList = null;
		off();
	}

	/** 卡片「🕐」事件行（v0.4.8+，`- 事件：` 的展示与跳转；**v0.4.9+ 常驻一行、排在 ✎／🗑 动作行的上面**，不跟动作行一起悬停才显现）：
	 *  **单事件**＝行里一枚 chip（「🕐 120-06 黑木崖之战」，时间点来自快照 `eventTimes`），点击＝跳时间线面板并定位该条目；
	 *  **多事件**＝行里显示**第一条事件摘要**（点它＝直接跳过去）＋「N 个事件」数量 chip（▾ 三角**只由 CSS `.is-multi::after` 出**＝文本里绝不再写 ▾，否则两个三角；点它＝在卡片内展开/收起完整列表，每次现建、关闭即移除＝不残留过期数据）；列表项＝时间徽章＋事件名（＋括号备注），点击项＝关闭并跳转；
	 *  名字在该书时间线里查不到（改名/删除）＝置灰划掉＋悬停提示（同关联场景 chip 的防断链口径），仍可点（由 main.ts 提示找不到） */
	private renderEventArea(card: HTMLElement, r: SceneRow): void {
		const names = r.events ?? [];
		const timeOf = (name: string): string | undefined => this.eventTimes[name.trim().toLowerCase()];
		const labelOf = (name: string): string => {
			const t = timeOf(name);
			const note = r.eventLabels?.[name];
			return `${t ? `${t} ` : ""}${name}${note ? `（${note}）` : ""}`;
		};
		const missing = (name: string): boolean => timeOf(name) === undefined;
		const open = (name: string): void => { void this.onOpenTimelineEvent?.(name); };
		// 常驻行（不参与悬停显现）＝按调用位置追加在 ✎／🗑 动作行**之前**＝卡片下缘的信息行；行 `pointerdown` 阻止冒泡＝点事件不进入拖动位置手势
		const row = card.createDiv({ cls: "aw-scene-evrow-line" });
		row.addEventListener("pointerdown", (ev: PointerEvent) => ev.stopPropagation());
		const chipCls = (name: string): string => (missing(name) ? "aw-scene-ev is-missing" : "aw-scene-ev");
		const first = names[0];
		const main = row.createSpan({ text: `🕐 ${labelOf(first)}`, cls: chipCls(first) });
		main.setAttr("aria-label", `在时间线中定位事件「${first}」`);
		if (missing(first)) main.title = "未在当前时间线中找到同名事件（可能已改名或删除）";
		main.addEventListener("click", (ev: MouseEvent) => {
			ev.stopPropagation(); // 别触发卡片拖动/双击语义
			open(first);
		});
		if (names.length === 1) return; // 只有一个事件＝整行就是它，不需要数量 chip
		const btn = row.createSpan({ text: `${String(names.length)} 个事件`, cls: "aw-scene-ev aw-scene-ev-count is-multi" }); // ▾ 由 CSS `.is-multi::after` 画＝文本里不能再带（带了就两个三角）
		btn.setAttr("aria-label", "展开/收起事件列表");
		let panel: HTMLElement | null = null;
		const close = (): void => {
			if (!panel) return;
			panel.remove();
			panel = null;
			btn.removeClass("is-active");
			card.removeClass("is-evopen"); // 列表收起＝卡片不再抬高压在相邻卡片上（v0.4.9+ 事件行本身常驻，不再靠这个类显形）
			if (this.closeEvList === close) this.closeEvList = null; // 摘掉登记（同一次展开的收起句柄）
		};
		btn.addEventListener("click", (ev: MouseEvent) => {
			ev.stopPropagation();
			if (panel) { close(); return; }
			this.closeEventList(); // 同时只开一个列表（别的卡片正开着＝先收掉）
			panel = row.createDiv({ cls: "aw-scene-evlist" }); // v0.4.9+ 用户要求＝浮层挂在**事件行**上（`top:100%`＝紧贴这一行下面），不是挂在卡片下沿
			panel.addEventListener("pointerdown", (ev2: PointerEvent) => ev2.stopPropagation()); // 列表内不进入卡片拖动位置手势
			panel.addEventListener("dblclick", (ev2: MouseEvent) => { ev2.stopPropagation(); close(); }); // 列表上双击＝收起（不弹编辑弹窗）
			for (const name of names) {
				const erow = panel.createDiv({ cls: "aw-scene-evrow" });
				const t = timeOf(name);
				if (t) erow.createSpan({ text: t, cls: "aw-scene-evtime" });
				erow.createSpan({ text: `${name}${r.eventLabels?.[name] ? `（${r.eventLabels[name]}）` : ""}`, cls: missing(name) ? "aw-scene-evname is-missing" : "aw-scene-evname" });
				erow.setAttr("aria-label", `在时间线中定位事件「${name}」`);
				erow.addEventListener("click", (ev2: MouseEvent) => {
					ev2.stopPropagation();
					close();
					open(name);
				});
			}
			btn.addClass("is-active");
			card.addClass("is-evopen");
			this.closeEvList = close; // 登记＝空白处点击/右键/Esc/重渲染都能收掉它
		});
	}

	/** 卡片右键菜单（触屏长按同用）：编辑场景／添加子场景（挂在它下面＝`- 父场景：`）／打开来源文档／删除 */
	private openCardMenu(ev: MouseEvent, r: SceneRow): void {
		const menu = new Menu();
		// 前三项同一 section＝Obsidian 只在 section 变化处画分隔线＝「删除场景」独占一组、组前自动带分隔线，且恒排最后
		const baseSection = "aw-scene-card";
		if (this.onEditScene) menu.addItem((it) => it.setSection(baseSection).setTitle("编辑场景").setIcon("pencil").onClick(() => void this.onEditScene?.(r)));
		if (this.onAddChildScene) menu.addItem((it) => it.setSection(baseSection).setTitle("添加子场景").setIcon("corner-down-right").onClick(() => void this.onAddChildScene?.(r, this.newScenePoint(r)))); // v0.4.9+ 落点判定同「＋ 场景」：排在父卡片下面看得见＝保持自动布局，看不见／压卡＝视口左上角
		menu.addItem((it) => it.setSection(baseSection).setTitle("打开来源文档").setIcon("file-text").onClick(() => void this.openAt(r)));
		if (this.onDeleteScene) menu.addItem((it) => it.setSection("danger").setTitle("删除场景").setIcon("trash").onClick(() => void this.onDeleteScene?.(r)));
		menu.showAtPosition({ x: ev.x, y: ev.y });
	}

	/** 按住卡片拖动调位置（仅鼠标左键，触屏保持原生滚动手势）：越 5px 阈值才激活；**整组语义**＝被拖卡片连同全部子孙场景卡片
	 *  一起实时平移（包含框与连线同步重算），松手把整组新坐标一次写回（onMoveScenes → main.ts 按文档合并落盘）；随后吞掉紧随 click/dblclick 防误开文档。
	 *  v0.4.9+ 用户要求＝**区域随动的大场景也写回**：拖动子场景时 `applyRegions` 会把各层区域头（有子场景的父卡片）搬到区域左上角，
	 *  这些卡片不在被拖组成员里，故按下时先记下它们此刻的坐标（`headStart`），收尾时把「本次真的被挪动过」的头卡片一并放进写回清单
	 *  ＝大场景的 `- 位置：` 与屏幕上看到的位置保持一致（渲染阶段自动派生的位置差不算本次改动、不无辜写回） */
	private attachDrag(card: HTMLElement, row: SceneRow): void {
		card.addEventListener("pointerdown", (ev: PointerEvent) => {
			if (this.drag || ev.button !== 0 || ev.pointerType !== "mouse" || ev.altKey) return; // Alt＋左键＝让位给画布平移（不 stopPropagation，事件冒泡到 bodyEl）
			ev.stopPropagation(); // 本手势优先于画布平移独占
			const members: ScDragMember[] = [];
			const pushSub = (id: string): void => {
				const it = this.cardsById.get(id);
				if (!it) return;
				const p = this.posLive.get(id);
				members.push({ row: it.row, card: it.card, baseX: p?.x ?? it.x, baseY: p?.y ?? it.y });
				for (const kid of this.childIdsById.get(id) ?? []) pushSub(kid);
			};
			pushSub(row.id);
			const d: ScDrag = { members, startX: ev.clientX, startY: ev.clientY, active: false };
			this.drag = d;
			// v0.4.9+ 用户要求＝拖子场景时按区域口径被顺带搬走的**大场景卡片（区域头）也要写回它自己的 `- 位置：`**。
			// 这里先记下各区域头此刻的坐标＝收尾时只写「本次拖动真的挪过」的那些（面板渲染时自动派生的位置差不是本次改动，不写）
			const headStart = new Map<string, { x: number; y: number }>();
			for (const f of this.frames) {
				const p = this.posLive.get(f.headId);
				if (p) headStart.set(f.headId, { x: p.x, y: p.y });
			}
			const onMove = (mv: PointerEvent): void => {
				const dxS = mv.clientX - d.startX;
				const dyS = mv.clientY - d.startY;
				if (!d.active && Math.abs(dxS) + Math.abs(dyS) <= 5) return;
				if (!d.active) {
					d.active = true;
					for (const m of d.members) m.card.classList.add("is-dragging");
				}
				const z = this.canvas.zoom;
				for (const m of d.members) {
					m.card.style.transform = `translate(${Math.round(dxS / z)}px, ${Math.round(dyS / z)}px)`;
					this.moveLive(m.row.id, m.baseX + dxS / z, m.baseY + dyS / z); // 连线连接点与包含框跟随整组实时重算
				}
			};
			// end 里要的是「最后位置」：pointerup 前 mv 已把卡片平移过，起点差由最后 move 决定——track 记录最后坐标
			let lastX = ev.clientX;
			let lastY = ev.clientY;
			const track = (mv: PointerEvent): void => {
				lastX = mv.clientX;
				lastY = mv.clientY;
				onMove(mv);
			};
			const endTracked = (): void => {
				document.removeEventListener("pointermove", track);
				document.removeEventListener("pointerup", endTracked);
				document.removeEventListener("pointercancel", endTracked);
				this.drag = null;
				if (!d.active) return;
				this.canvas.suppressClicks(400);
				const z = this.canvas.zoom;
				const moved: { row: SceneRow; x: number; y: number }[] = [];
				for (const m of d.members) {
					m.card.classList.remove("is-dragging");
					const nx = Math.round((m.baseX + (lastX - d.startX) / z) * 100) / 100;
					const ny = Math.round((m.baseY + (lastY - d.startY) / z) * 100) / 100;
					m.card.style.removeProperty("transform");
					this.moveLive(m.row.id, nx, ny); // 收尾以最终坐标校正连线与包含框（最后一次 move 与 pointerup 可能有微差）
					const live = this.posLive.get(m.row.id); // v0.4.9+ 落位＝**重算后的坐标**（拖的是区域头时＝随后按子场景反推出的新位置）＝写回值与屏幕上的一致
					const fx = live ? live.x : nx;
					const fy = live ? live.y : ny;
					m.card.style.left = `${Math.round(fx)}px`; // 乐观落位：写回成败都由 main.ts 通道刷新校准（失败弹回真实坐标）
					m.card.style.top = `${Math.round(fy)}px`;
					if (fx !== m.row.x || fy !== m.row.y) moved.push({ row: m.row, x: fx, y: fy });
				}
				this.syncExtent(); // v0.4.9+ 收尾＝内容范围收敛到实际值（拖动途中只放大不缩小，这里按最终几何重算一遍）
				// v0.4.9+ 用户要求＝被区域口径顺带搬走的大场景卡片也进写回清单（＝大场景的 `- 位置：` 跟着屏幕上的落位走，嵌套区域逐层各自写回）
				const draggedIds = new Set(d.members.map((m) => m.row.id));
				for (const [id, start] of headStart) {
					if (draggedIds.has(id)) continue; // 它自己就是被拖的那张（组）卡片＝上面已按重算后的落位处理过
					const p = this.posLive.get(id);
					const it = this.cardsById.get(id);
					if (!p || !it) continue; // 区域头本次没渲染（被筛掉）＝不动它
					if (Math.abs(p.x - start.x) < 0.01 && Math.abs(p.y - start.y) < 0.01) continue; // 本次拖动没挪动它＝不无辜写回
					moved.push({ row: it.row, x: p.x, y: p.y });
				}
				if (!moved.length) return; // 原地释放不写回
				void this.onMoveScenes?.(moved);
			};
			document.addEventListener("pointermove", track);
			document.addEventListener("pointerup", endTracked);
			document.addEventListener("pointercancel", endTracked);
		});
	}

	/** **单个区域重算**（v0.4.9+ 用户要求＝顺序不能反）：① 先按**全部子场景**（`f.ids`）当前几何算出区域骨架；
	 *  ② 由它**派生父卡片的新位置**（`scene_geometry.regionFor`＝与子场景左对齐、排在子场景上方 `SCENE_CHILD_GAP` 处）并落进 `posLive`＋卡片；
	 *  ③ 区域矩形＝`frameBoxFor(子场景们 + 派生后的区域头, FRAME_PAD)`，存进 `f.box`（内容范围 `syncExtent` 与「适应全图」都按它算，不回读 DOM）。
	 *  v0.4.9+：拖动中被挪动的区域头由 `attachDrag` 收尾收集进 `onMoveScenes` 清单＝顺带写回它的 `- 位置：`（用户要求）。
	 *  ⇒ 父卡片**存着的坐标不参与区域计算**：拖子场景＝区域跟着长/缩，随后父卡片被搬到区域左上角。
	 *  区域头本次没渲染（被筛掉）＝退化成只按子场景画框、不挪卡。正被拖动的卡片靠 `transform` 平移＝不写 left/top（免双重偏移） */
	private applyRegion(f: ScFrame): void {
		const kids: ScBox[] = [];
		for (const id of f.ids) {
			const p = this.posLive.get(id);
			if (p) kids.push(p);
		}
		const head = this.posLive.get(f.headId);
		const it = this.cardsById.get(f.headId);
		if (!head || !it) {
			const solo = frameBoxFor(kids, FRAME_PAD);
			f.box = solo;
			this.setFrameRect(f, solo);
			return;
		}
		const r = regionFor({ w: head.w, h: head.h }, kids, SCENE_CHILD_GAP, FRAME_PAD);
		f.box = r ? r.box : null;
		this.setFrameRect(f, r ? r.box : null);
		if (!r) return;
		if (Math.abs(r.head.x - head.x) < 0.01 && Math.abs(r.head.y - head.y) < 0.01) return; // 已经在区域左上角＝什么都不写（拖动途中不空抖）
		head.x = r.head.x;
		head.y = r.head.y;
		it.x = r.head.x;
		it.y = r.head.y;
		if (!it.card.classList.contains("is-dragging")) {
			it.card.style.left = `${Math.round(r.head.x)}px`;
			it.card.style.top = `${Math.round(r.head.y)}px`;
		}
	}

	/** 区域矩形写进 SVG 属性（`null`＝本次没有成员＝收成 0×0，不留在旧位置） */
	private setFrameRect(f: ScFrame, fr: { x: number; y: number; w: number; h: number } | null): void {
		if (!fr) {
			f.el.setAttribute("width", "0");
			f.el.setAttribute("height", "0");
			return;
		}
		f.el.setAttribute("x", String(fr.x));
		f.el.setAttribute("y", String(fr.y));
		f.el.setAttribute("width", String(fr.w));
		f.el.setAttribute("height", String(fr.h));
	}

	/** **全部区域一律重算**（＝`applyRegion`）。`frames` 的推入序＝父区域在其子区域之前 ⇒ **倒序遍历＝最深一层先归位**，
	 *  外层区域随后才按「已归位的子孙」算自己的区域与区域头（嵌套区域才不会各算各的） */
	private applyRegions(): void {
		for (let i = this.frames.length - 1; i >= 0; i--) this.applyRegion(this.frames[i]);
	}

	/** **关联线端点用哪个矩形**（v0.4.9+ 用户要求＝关联到「有子场景的场景」时，连接点按**包含所有子场景的包含框边界**算，
	 *  不接到区域头卡片本身）：该场景是某个区域的区域头且框已算出（`f.box`）＝返回**框矩形**；否则＝返回卡片矩形（`posLive`）。
	 *  渲染与拖动实时重算共用这一口径（＝`relEdgePathD` 可能收到一个大矩形，其内部情形由 `containmentRoute` 兜住） */
	private edgeBox(id: string): ScBox | undefined {
		for (const f of this.frames) {
			if (f.headId !== id) continue;
			if (f.box) return f.box;
			break; // 是区域头但本次没有框（没有可见子场景）＝退回卡片矩形
		}
		return this.posLive.get(id);
	}

	/** 拖动中/收尾：更新被拖卡片在 posLive 的现值，**先重算全部包含框**（＝各父场景的有效区域一律按成员当前包围盒现算，区域内父卡片的新位置随之算出），
	 *  再**全量**重算关联线（端点＝包含框或卡片矩形＝`edgeBox`；区域内子场景被拖动＝那块框动了，不经过被拖卡片的线也要跟着改），
	 *  随后 `syncExtent(true)` 让内容范围跟着长出去——区域长到旧边界外时既看得见也滚得到 */
	private moveLive(rowId: string, x: number, y: number): void {
		const p = this.posLive.get(rowId);
		if (!p) return;
		p.x = x;
		p.y = y;
		this.applyRegions(); // v0.4.9+ 顺序改成**先区域后连线**：端点矩形可能就是某块包含框＝框没先归位，线会画在旧边界上
		// v0.4.9+ 端点改成包含框后，**拖动区域内任一子场景都会挪动那块框**＝不经过这条线两端 id 的线也可能变，
		// 所以这里不再只重算「以被拖卡片为端点」的线＝一律全量重算（关联线数量级很小，代价可忽略）
		for (const e of this.edges) {
			const a = this.edgeBox(e.fromId);
			const b = this.edgeBox(e.toId);
			if (!a || !b) continue;
			e.path.setAttribute("d", relEdgePathD(a, b)); // 关联线无方向＝relEdgePathD 按几何定端点，反序调用同一形状
			if (e.labelEl) placeEdgeLabel(e.path, e.labelEl); // v0.4.8+ 路标随连线中点实时重定位
		}
		this.syncExtent(true);
	}

	/** **内容范围**（v0.4.9+ 用户要求：区域要能随子场景长大，那长大出来的部分必须可见可滚）＝
	 *  卡片几何∪各区域框矩形的右/下边界，据此设底图 svg 与网格尺寸、zoom 层高度、`canvas.setContentWidth`（内部已 `apply()` 重算 sizer 与滚动余量）。
	 *  `growOnly`＝拖动途中只放大不缩小（中途缩小会把滚动余量突然收掉＝视图跳动），松手与每次渲染时按实际值收敛。数值没变＝不碰 DOM */
	private syncExtent(growOnly: boolean = false): void {
		let maxRight = 0;
		let maxBottom = 0;
		for (const p of this.posLive.values()) {
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.w) || !Number.isFinite(p.h)) continue;
			if (p.x + p.w > maxRight) maxRight = p.x + p.w;
			if (p.y + p.h > maxBottom) maxBottom = p.y + p.h;
		}
		for (const f of this.frames) {
			const b = f.box;
			if (!b || ![b.x, b.y, b.w, b.h].every((v) => Number.isFinite(v))) continue;
			if (b.x + b.w > maxRight) maxRight = b.x + b.w;
			if (b.y + b.h > maxBottom) maxBottom = b.y + b.h;
		}
		if (growOnly) {
			if (maxRight <= this.extentRight && maxBottom <= this.extentBottom) return;
			maxRight = Math.max(maxRight, this.extentRight);
			maxBottom = Math.max(maxBottom, this.extentBottom);
		}
		if (maxRight === this.extentRight && maxBottom === this.extentBottom) return;
		this.extentRight = maxRight;
		this.extentBottom = maxBottom;
		if (this.edgeSvgEl) {
			this.edgeSvgEl.style.width = `${String(Math.round(maxRight + FRAME_PAD))}px`;
			this.edgeSvgEl.style.height = `${String(Math.round(maxBottom + FRAME_PAD))}px`;
		}
		if (this.gridEl) {
			this.gridEl.style.width = `${String(Math.round(maxRight + FRAME_PAD + GRID_EXTENT * 2))}px`; // 内容＋四向外扩＝任何平移下视野内都铺满（CSS 起点 -3000px）
			this.gridEl.style.height = `${String(Math.round(maxBottom + FRAME_PAD + GRID_EXTENT * 2))}px`;
		}
		this.canvas.zoomEl.style.height = `${String(Math.round(maxBottom + SCENE_MARGIN))}px`; // 绝对定位子元素撑不开容器高度，显式给出内容高（CanvasPanel.apply 据此算 sizer）
		this.canvas.setContentWidth(maxRight + SCENE_MARGIN); // 内容比面板宽时撑出横向可拖动/滚动范围（最右卡片与区域框不再拖不出去）
	}

	/** 双击卡片在编辑器打开来源《场景.md》 */
	private async openAt(r: SceneRow): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(r.sourcePath);
		if (!(f instanceof TFile)) return;
		await this.app.workspace.getLeaf(false).openFile(f);
	}

	/** 空态/引导文案 */
	private placeholderFor(snap: SceneSnapshot): string | null {
		if (!snap.workDir) return "尚未设置工作目录：请在插件设置中选择。";
		if (!snap.stories.length) return "工作目录下没有找到小说。";
		if (!snap.activeStory) return "尚未选择当前小说：请在写字台「书籍列表」或「切换当前小说」命令中选择。";
		if (!snap.totalCount) return `「${snap.activeStoryTitle}」还没有场景记录。\n在书级《案头资料/场景.md》、卷《文档/场景.md》或章节目录《场景.md》里按下面写法记录即可显示：\n## <场景名>\n- 描述：…\n- 角色：甲、乙\n- 关联：另一场景名\n（多行正文用 \`\`\`text 围栏）`;
		return null;
	}
}
