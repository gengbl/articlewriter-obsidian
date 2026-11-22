import { ItemView, Menu, Notice, setTooltip, TFile, WorkspaceLeaf, type MarkdownView } from "obsidian";
import { deleteTimelineBlock, insertTimelineBlock, parseTimelineHeading, parseTimelineTime, rewriteTimelineEntryTime, docRelPath, docLocationLabel, timelineTimeText, updateTimelineBlock, type TimelineEntry, type TimelineEntryInput, type TimelinePoint } from "./md_docs";
import { ConfirmModal, EventEditModal, type EventEditResult } from "./modals"; // v0.3.3+ 合并大事件：面板承担原事件树面板的新增/编辑/删除/完成切换
import { buildOutlineTree, countSubtree, type OutlineNode } from "./outline_tree"; // v0.3.1+：轮廓树算法与事件树面板共用
import { CanvasPanel } from "./panel_canvas"; // v0.3.1+：缩放/平移画布设施与事件树面板共用
import { revealEditorLine } from "./editor_nav"; // v0.4.3+：「在编辑器里定位到某一行」与灵感工具包/写字台共用

/** 时间线条目所属层级（书根 / 卷 / 章） */
export type TlScope = "book" | "volume" | "chapter";

/** 面板展示用时间线条目：解析结果 + 稳定标识、层级归属、来源路径与层级标签 */
export interface TlRow extends TimelineEntry {
	id: string; // 稳定标识（来源路径#文档内序号）：折叠状态跨刷新保持、切书重置
	scope: TlScope;
	sourcePath: string; // 来源《时间线.md》的 vault 相对路径
	sourceLabel: string; // 层级标签（书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>），合并展示时随条目显示出处
	lane: string; // v0.4.7+ 多时间线泳道名（默认《时间线.md》＝"默认"、《时间线-战斗线.md》＝"战斗线"）
	laneIndex: number; // v0.4.7+ 泳道序号（按快照 lanes 顺序）：驱动行配色 .tl-l<idx>
}

/** v0.4.9+ 一本书里的**每份时间线文档**（快照带下来＝弹窗「级别」下拉的候选，无需再读盘）：路径＋层级＋泳道＋是否已落盘 */
export interface TlDocRef {
	path: string; // vault 相对路径（《时间线.md》／《时间线-战斗线.md》／章级《01-初见-时间线.md》；未创建时＝新格式候选路径）
	scope: TlScope; // 该文档所属层级（书级／卷级／章级）
	lane: string; // 泳道名（默认时间线＝"默认"）
	exists: boolean; // 磁盘上是否已有该文件（候选路径＝false；章级候选路径动辄几十条，下拉里只列已存在的）
}

/** v0.4.7+ 多时间线泳道：一条时间线（可跨书/卷/章多份同名文档），面板按泳道配色、可单独筛显 */
export interface TlLane {
	name: string; // 泳道名："默认"（时间线.md）或《时间线-xxx.md》里的 xxx
	count: number; // 该泳道的事件条数（各容器同名泳道合并计数）
	paths: string[]; // 该泳道涉及的文档路径（可能多份）
}

/** 合并时间轴的轮廓节点（v0.3.1+ 起复用 outline_tree 通用算法）：条目 + 子节点。**挂父按文档结构**：父＝**同一《时间线.md》内**其前最近一条级别更小的条目（跨文档不挂父）；无更小级别前驱者为根 */
type TlNode = OutlineNode<TlRow>;

/** 渲染趟的扁平时间线节点（v0.3.3+ 折叠修复）：轮廓节点 + 轮廓深度 + 严格祖先链（自根到父，跨文档不挂父）。渲染＝扁平列表按 (年,月,日) 升序逐行输出：缩进/圆点列/层级导引线由 depth 决定（`.tl-d<n>` 类）、可见性＝祖先链任一命中 collapsedIds 即隐藏——子事件无论时间排在何处都挂在结构父名下，折叠结构父必藏全部（可时间上四散的）后代 */
interface TlFlatNode {
	node: TlNode;
	depth: number; // 轮廓深度（根＝0）：行缩进 .tl-d<min(depth,6)>
	ancestors: TlRow[]; // 严格祖先链（不含自身）：折叠判定与筛选祖先显示
}

export interface TlStoryEntry {
	name: string;
	title: string;
	active: boolean;
}

/** 时间线面板快照（main.ts 非交互读取构建，只含展示字段）：各层已合并为单一行列表，**保持文档枚举顺序**（书级 → 未归卷章节 → 各卷及其成员章）；时间点升序仅由面板渲染趟负责 */
export interface TlSnapshot {
	workDir: string;
	stories: TlStoryEntry[];
	activeStory: string | null;
	activeStoryTitle: string;
	useVolumes: boolean; // 有卷/无卷模式（空态文案据此给出对应的建文档位置提示）
	rows: TlRow[]; // 书/卷/章全部条目合并，文档枚举顺序（面板据此按文档结构挂父，再扁平化为时间升序渲染）
	totalCount: number; // 全部层解析出的事件总条数
	bookTimelinePath: string; // 书级《时间线.md》路径（＝头部「＋ 事件」根级新增的写入目标；文件可尚不存在，mutate 时自动创建）
	lanes: TlLane[]; // v0.4.7+ 本书全部时间线泳道（含仅默认一条时），顺序＝行内首次出现序（默认泳道恒最先）
	docs: TlDocRef[]; // v0.4.9+ 本书全部《时间线*.md》文档（含未创建的候选）＝「＋ 事件」级别下拉的候选
	storyDir: string; // 当前书的目录（vault 相对）＝位置文案里要剥掉的仓库前缀（空＝无当前书）
}

/** 某行是否命中筛选词（人物名 + 事件名 + 事件正文匹配） */
/** v0.4.7+ 条目显示名：标题带事件名用事件名；**无名条目（纯时间点标题）把「事件」字段首行当作名字**——面板名称徽章、关联索引/候选、各类文案统一走此口径（不改写文档，标题仍无名） */
function tlRowName(r: { title?: string; event: string }): string {
	const t = (r.title ?? "").trim();
	return t || (r.event ?? "").split("\n")[0].trim();
}

function matchRow(r: TlRow, q: string): boolean {
	return (r.chars.join(" ") + " " + (r.title ?? "") + " " + r.event).toLowerCase().includes(q);
}

const TL_ZOOM_MIN = 0.4; // 画布模式缩放上下限（传入 CanvasPanel；同关系面板图面量级，防缩到看不见/大到无意义）
const TL_ZOOM_MAX = 3;
const TL_DAY_MS = 86_400_000; // 一天的毫秒数（时间点间隔换算用）
const TL_PX_PER_DAY = 5; // 时间比例间距基准比例尺：100% 缩放下每过一天拉开约 5px（密度调节另有 Ctrl|Shift 滚轮缩放）；随画布缩放等比变化
const TL_SPACER_MAX_DAYS = 90; // 比例留白上限（天）：相邻间隔在此内按真实比例出留白；超出压成定高「⋯ 约 N 年 ⋯」时间跳跃标记块——防极端跨度的孤立点（如公元前测试时间点）把画布拉到无法使用
const TL_DRAG_PX_PER_UNIT = 50; // 拖动手势灵敏度：纯年/只含月条目每纵向拖动 50 布局 px 增减 1 年/1 月（含日条目仍按 TL_PX_PER_DAY 逐日）。不能用 TL_PX_PER_DAY 换算拖动——年精度条目 1 年＝365 天要拖 1825px，远超可操作距离，且年间隔被 TL_SPACER_MAX_DAYS 压成定高 skip 块后画面间距与真实天数脱钩
const TL_LANE_COLORS = ["#8a8f98", "#4f8cff", "#e8683a", "#34b37a", "#c9a227", "#b5527d", "#2f9e9e", "#8a63d2", "#a0632b", "#5b7fd4"]; // v0.4.7+ 多时间线泳道配色：索引＝laneIndex % 长度（默认泳道恒 0＝中性灰）；CSS 类 .tl-l<n> 与汇总 chip 内联色同一口径
const TL_LANE_CLASS_MAX = 9; // 泳道配色类封顶（超出取模，避免 CSS 类无限增长）

/** 泳道序号 → 配色（十六进制）与 CSS 类名（`.tl-l<n>`，样式见 styles.css） */
export function tlLaneStyle(index: number): { color: string; cls: string } {
	return { color: TL_LANE_COLORS[index % TL_LANE_COLORS.length], cls: `tl-l${String(Math.min(index, TL_LANE_CLASS_MAX))}` };
}

/** 时间点 → 绝对毫秒时刻（仅用于相邻条目间隔计算与总跨度统计）：缺月按一月、缺日按一号；旧数据小数年份先截断为整年再进 Date.UTC；极端超范围年份得 NaN 时退化为「年 × 365 天」近似，保证结果有限且对升序输入单调不减 */
function tlEpochMs(p: Pick<TimelineEntry, "time" | "month" | "day">): number {
	const y = Math.trunc(p.time);
	const ms = Date.UTC(y, (p.month ?? 1) - 1, p.day ?? 1);
	return Number.isFinite(ms) ? ms : y * 365 * TL_DAY_MS;
}

/**
 * 时间线面板（自定义 ItemView，可停靠任意区域、重载保留位置）：
 * 把当前小说**书根 / 卷目录 / 章节目录三层全部「时间线开头」的文档**（默认《时间线.md》＋扩展《时间线-***.md》，v0.4.7+ 多时间线）合并成一条自上而下的纵向时间轴——条目按时间点（支持 年 / 年-月 / 年-月-日）升序排列，每条带来源层级标签；标题深度即事件级别（#=一级、##=二级、###=三级，可更深）。**父子关系按文档结构**：同一文档内「父＝其前最近一条级别更小的条目」（跨文档不挂父）；轮廓树仅决定嵌套深度与折叠归属，**渲染是扁平的一条时间升序序列**——子事件即使时间排在别的更大事件之后也仍属于结构父，缩进按轮廓深度、圆点固定在主轴。
 * **多时间线（v0.4.7+）**：同容器内《时间线-战斗线.md》之类文档自动并入面板，与默认时间线**按时间合并绘制**；每条泳道一种配色（徽章描边 + 非默认泳道的彩色名称 chip），底部汇总行下给出「时间线」图例（色点＋名称＋条数，点击＝只看该泳道／恢复全部），头部另有时间线下拉；「＋ 事件」写入当前所选泳道的文档（未选＝书级《时间线.md》）。
 * **时间比例间距**：相邻条目的垂直间隔按其时间差成比例拉开（基准 5px/天、90 天内按真实比例出留白，超过 90 天的间隔压成定高「⋯ 约 N 年 ⋯」时间跳跃标记块防极端点拉爆画布；密度另可用 Ctrl|Shift 滚轮缩放调节）；筛选模式下改紧凑堆叠（命中稀疏不成比例）。汇总行附「跨度 N 年 M 月」（最早到最晚的总时长）。
 * 顶部筛选框可按人物/事件关键词过滤（筛选时显示命中条目及其祖先链、忽略折叠状态）。**双击**条目弹出**编辑事件弹窗**（v0.4.9+ 用户要求＝不再在编辑器打开文档＝与场景面板卡片同口径；单击不触发，避免误触）；
 * **点击圆点**切换有子事件条目的折叠状态；**右键条目**弹出节点菜单（编辑/添加子事件/添加同级/完成切换/**打开来源文档**＝在编辑器打开来源《时间线.md》并定位到该时间点标题行，图标 `file-text`／删除）。
 * **事件编辑（v0.3.3+ 合并大事件后由本面板承担，原「大事件」面板已退场）**：头部「＋ 事件」＝书级《时间线.md》文档末尾追加一级节点；条目行右侧动作组（＋／✎／✓○／🗑）＝添加子事件、编辑、完成状态快速切换、删除（删除经 ConfirmModal，根节点＝整棵子树删除）；条目还可带**影响**行（内联小字）与**关联** chip（点击跳到目标事件所在文档标题，并给该条目 1.2s 高亮闪烁）。所有写回按条目 `sourcePath` 定位（updateTimelineBlock/insertTimelineBlock/deleteTimelineBlock），书级文档不存在时自动创建；子事件级别封顶 6（标题深度上限）。
 * **拖动更新时间点**（仅非筛选比例视图、鼠标左键）：按住条目沿轴上下拖过阈值后整棵子树实时平移、**条目自身的时间徽章立即变为新时间点**、光标旁浮标显示天数差（位移÷画布缩放÷基准比例尺＝Δ天）；松手把新时间写回对应《时间线.md》的标题行——精度跟随原写法（含日按天算、只含月按月吸附、纯年份按年取整），经「注释掩码＋原文标题行全文匹配＋旧值反解校验」防误写，成功后由 vault 变更防抖自动重渲染；源文档已变化则放弃并提示刷新。
 * **画布交互**：主体区 overflow:auto——普通滚轮/滚动条/触屏原生滚动（内容放得下时滚动页面），Ctrl|Shift＋滚轮以鼠标位置为不动点缩放（0.4×–3×），左键按住拖动平移（驱动容器滚动位置），头部倍率标签点击复位。
 * 数据经构造注入的 getter 实时读取；文件变更由 main.ts 防抖调 refresh()。
 * 渲染陷阱同 StatusView / RelationshipView：UI 必须建在 onOpen 的 contentEl（本环境不调用 getEmptyStateElement）。
 */
export class TimelineView extends ItemView {
	static readonly VIEW_TYPE = "articlewriter-timeline";
	private getData: () => Promise<TlSnapshot>;
	private getCharOptions: () => Promise<string[]>;
	private built = false;
	private rootEl!: HTMLElement;
	private topEl!: HTMLElement;
	private canvas!: CanvasPanel; // 缩放/平移画布设施（v0.3.1+ 与事件树面板共用；bodyEl/sizerEl/zoomEl 为其元素引用快捷方式）
	private bodyEl!: HTMLElement; // 画布容器：overflow:auto——普通滚轮/触屏原生滚动，Ctrl|Shift+滚轮缩放
	private sizerEl!: HTMLElement; // 定尺寸载体：宽高＝内容×缩放（JS 设置），决定可滚动范围
	private zoomEl!: HTMLElement; // 缩放载体（绝对定位，transform scale，transform-origin 左上角；宽度由 JS 设为视口宽）
	private sumEl!: HTMLElement; // 底部固定汇总行（不参与缩放/平移）
	private busy = false;
	private lastSnap: TlSnapshot | null = null;
	private filterText = "";
	// v0.4.7+ 多时间线：泳道筛选（""＝全部时间线；否则泳道名）＋本次渲染趟的「泳道名→序号」索引（renderBody 每趟重建，条目 laneIndex 与配色/图例同一口径）
	private laneFilter = "";
	private laneNameIdx = new Map<string, number>();
	// 折叠中的条目 id 集合（圆点点击切换；重渲染不清零、切书重置）
	private collapsedIds = new Set<string>();
	private lastStoryKey = "";
	// 事件编辑支撑（v0.3.3+ 合并大事件）：条目 id → 条目行元素（关联 chip 跳转后高亮闪烁定位）；「事件名（小写 trim）→ 行 id」关联索引（renderBody 每趟重建，仅带事件名的条目入索引）
	private nodeEls = new Map<string, HTMLElement>();
	private relatedIndex = new Map<string, string>();
	// 时间比例间距的本次渲染趟状态（renderBody 每趟开头重置，随同步 DFS 渲染逐条推进）：是否启用＋上一条已渲染条目的毫秒时刻
	private tlSpacingOn = false;
	private tlPrevMs: number | null = null;
	// 拖动更新时间点的手势状态（仅非筛选比例视图挂载；元素引用每次 renderRow 重建、不跨渲染持有）：候选 {row,startY,els}／激活标志／最近Δ天数／浮标元素
	private tlDrag: { row: TlRow; startY: number; els: HTMLElement[]; badge: HTMLElement | null } | null = null; // badge＝条目自身时间徽章（.aw-tl-time），拖动中 setText 立即显示新时间点
	private tlDragLive = false; // 本手势是否越过阈值成为有效拖拽（未越界＝普通点击/双击，照常放行）
	private tlDragSteps = 0; // 拖动中最近一次算出的 Δ 步数（步＝条目自身精度单位：含日＝天、只含月＝月、纯年＝年；松手时据此决定是否写回）
	private tlDragLbl: HTMLElement | null = null; // 拖动期间跟随光标的目标时间浮标（挂 rootEl——zoomEl 有 transform 会破坏 position:fixed）

	constructor(leaf: WorkspaceLeaf, getData: () => Promise<TlSnapshot>, getCharOptions: () => Promise<string[]>) {
		super(leaf);
		this.getData = getData;
		this.getCharOptions = getCharOptions; // 事件编辑弹窗的人物候选（该书三层《人物.md》角色名）
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

	async onClose(): Promise<void> {
		this.canvas?.dispose(); // v0.4.3+：断开尺寸观察器（避免观察器持有已移除的 DOM）
	}

	/** v0.4.3+ ItemView 尺寸变化钩子：先重算画布尺寸兜底（内容重渲染由 CanvasPanel 的尺寸观察器在宽度真变化时回调） */
	onResize(): void {
		if (this.built) this.canvas.apply();
	}

	private buildUI(parent: HTMLElement): void {
		this.built = true;
		this.rootEl = parent.createDiv({ cls: "aw-status-view aw-tl-view" }); // 复用写字台的容器/字体/滚动布局样式
		this.topEl = this.rootEl.createDiv({ cls: "aw-st-top" }); // 固定头部：倍率标签 + 筛选框 + 刷新按钮
		this.canvas = new CanvasPanel(this.rootEl, {
			bodyCls: "aw-st-tree aw-tl-body",
			sizerCls: "aw-tl-sizer",
			zoomCls: "aw-tl-zoom",
			zoomVar: "--tl-transform",
			zoomLabelCls: "aw-dim aw-tl-zoomlbl is-hidden",
			min: TL_ZOOM_MIN,
			max: TL_ZOOM_MAX,
			onResize: () => this.onCanvasResize(), // v0.4.3+：面板尺寸变化时按新宽度重渲染内容（画布尺寸已由 CanvasPanel 先 apply）
		}); // 画布主体：overflow:auto 原生滚动＋Ctrl|Shift+滚轮缩放＋左键拖动平移（设施共用）
		this.bodyEl = this.canvas.bodyEl;
		this.sizerEl = this.canvas.sizerEl;
		this.zoomEl = this.canvas.zoomEl;
		this.sumEl = this.rootEl.createDiv({ cls: "aw-dim aw-rel-summary aw-tl-sumrow" }); // 底部固定汇总行
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
			this.zoomElClear();
			this.sumEl.empty();
			this.topEl.createDiv({ text: `加载失败：${e instanceof Error ? e.message : String(e)}`, cls: "aw-st-error" });
		} finally {
			this.busy = false;
		}
	}

	/** v0.4.3+ 面板尺寸变化（拖侧栏 / 分屏 / 窗口缩放 / 移动端抽屉开合）→ 用最近快照同步重渲染内容与布局：
	 *  宽度变化会改变条目换行、层级列坐标与时间比例间距的可用横向空间；不重新读盘（防 resize 触发摘要生成等 IO），
	 *  重渲染只清 zoomEl——缩放倍率、滚动位置、折叠状态都保持。
	 *  拖动更新时间点手势期间跳过：行元素正被拖动逻辑持有，清 DOM 会中断手势。 */
	private onCanvasResize(): void {
		if (!this.built || this.busy || this.tlDrag || !this.lastSnap) return;
		this.render(this.lastSnap);
	}

	/** 重渲染前清主体：条目元素索引与 DOM 同步作废（关联 chip 的旧引用一并失效） */
	private zoomElClear(): void {
		this.nodeEls.clear();
		this.zoomEl.empty();
	}

	private render(snap: TlSnapshot): void {
		this.topEl.empty();
		this.renderTop();
		this.renderBody(snap);
	}

	/** 固定头部：倍率标签（缩放≠100% 时出现、点击复位）+ 筛选输入框 + 「时间线」下拉（v0.4.7+ 多时间线：全部/单条泳道，多条时才出现）+ 「＋ 事件」（新增根级事件，写入当前所选时间线）+ 刷新按钮（不展示工作目录与小说列表，面板只呈现时间线本身） */
	private renderTop(): void {
		const filterRow = this.topEl.createDiv({ cls: "aw-rel-filter-row" }); // 复用关系面板的头部行布局
		this.canvas.attachZoomLabel(filterRow); // 倍率标签（缩放≠100% 时出现、点击复位；类与提示经 CanvasPanel 选项给出，内部已按当前缩放刷新显示）
		const input = filterRow.createEl("input", { type: "text", cls: "aw-rel-filter aw-tl-filter", placeholder: "筛选人物 / 事件…" });
		input.value = this.filterText;
		input.addEventListener("input", () => {
			this.filterText = input.value; // 只重渲染主体区（头部保持不动，输入焦点与光标不丢）
			if (this.lastSnap) this.renderBody(this.lastSnap);
		});
		const lanes = this.lanesOf(this.lastSnap);
		if (lanes.length > 1) { // 只有一条时间线时不出下拉（无意义），多条时可按泳道单独筛显/合并绘制
			const sel = filterRow.createEl("select", { cls: "aw-tl-lanesel" });
			sel.createEl("option", { text: "全部时间线", value: "" });
			for (const l of lanes) sel.createEl("option", { text: `${l.name}（${String(l.count)}）`, value: l.name });
			sel.value = lanes.some((l) => l.name === this.laneFilter) ? this.laneFilter : "";
			setTooltip(sel, "选择要绘制的时间线：默认＝《时间线.md》，其它＝《时间线-***.md》；「＋ 事件」会写入所选时间线的文档");
			sel.addEventListener("change", () => {
				this.laneFilter = sel.value;
				if (this.lastSnap) this.renderBody(this.lastSnap);
			});
		}
		const btns = filterRow.createSpan({ cls: "aw-st-actions" });
		btns.createEl("button", { text: "＋ 事件" }).addEventListener("click", () => void this.openAddRoot()); // 根级新增：追加到当前所选时间线文档末尾（默认＝书级《时间线.md》，不存在则自动创建）
		btns.createEl("button", { text: "刷新" }).addEventListener("click", () => void this.refresh());
	}

	/** v0.4.7+ 快照里的泳道列表（按 laneIndex 序，默认泳道恒最先）；无快照＝空 */
	private lanesOf(snap: TlSnapshot | null): TlLane[] {
		return snap?.lanes ?? [];
	}

	/** 当前「＋ 事件」的写入目标文档：选中某条泳道＝该泳道已有文档（优先书级→卷级→章级首个真实文档），否则书级《时间线.md》 */
	private addTargetPath(snap: TlSnapshot): string {
		if (!this.laneFilter) return snap.bookTimelinePath;
		const inLane = snap.rows.filter((r) => r.lane === this.laneFilter);
		for (const scope of ["book", "volume", "chapter"] as const) {
			const hit = inLane.find((r) => r.scope === scope);
			if (hit) return hit.sourcePath;
		}
		return this.lanesOf(snap).find((l) => l.name === this.laneFilter)?.paths[0] ?? snap.bookTimelinePath;
	}

	/** 某条目/某份文档的**所在位置**（v0.4.9+ 用户要求＝面板与弹窗都要看得到「这条事件在哪份文档」）＝`层级词 · 书内路径`
	 *  （＝场景面板「场景所在位置」同口径：从书籍目录起算、不带《工作目录/<书名>/》前缀；卷名/章名/泳道名本就在目录名与文件名里） */
	private locationOf(scope: TlScope, path: string): string {
		return docLocationLabel(scope, path, this.lastSnap?.storyDir ?? "");
	}

	/** 「＋ 事件」的**级别**候选（v0.4.9+ 用户要求＝新增事件也要有级别信息，同场景弹窗）＝当前所选泳道下的各层《时间线*.md》：
	 *  按**书级 → 卷级 → 章级**排，每项文案＝`层级词 · 书内路径`（＝落哪份文档一目了然）；候选＝快照带来的 snap.docs（含尚未创建的卷/章文档＝写入时自动创建），
	 *  **章级只列磁盘上已存在的文档**（每章的候选路径动辄几十条，全列会淹没下拉）；
	 *  默认选中＝旧口径（`addTargetPath`＝未选泳道＝书级《时间线.md》／选中泳道＝该泳道已有文档）＝行为不变，只是现在看得见、也能改 */
	private levelChoices(snap: TlSnapshot): { options: { value: string; label: string }[]; value: string } {
		const lane = this.laneFilter || "默认";
		const options: { value: string; label: string }[] = [];
		for (const scope of ["book", "volume", "chapter"] as const) {
			for (const d of snap.docs.filter((x) => x.scope === scope && x.lane === lane && (scope !== "chapter" || x.exists))) {
				options.push({ value: d.path, label: docLocationLabel(scope, d.path, snap.storyDir) });
			}
		}
		const def = this.addTargetPath(snap);
		return { options, value: options.some((o) => o.value === def) ? def : options[0]?.value ?? "" };
	}

	/** 主体区：单一合并纵向时间轴（**扁平的一条时间升序序列**、每条带来源标签；缩进＝文档结构轮廓深度、折叠按结构子树整棵隐藏；相邻条目间按时间差插比例间隔——90 天内为留白块 .aw-tl-spacer〔基准 5px/天〕、超出压成定高时间跳跃标记 .aw-tl-skip；筛选模式紧凑堆叠）+ 无有效条目文档的格式提示；汇总行固定显示在底部 sumEl（非筛选视图附「跨度」＝最早到最晚总时长，按可见行 min/max 计算）。
	 *  v0.4.7+ 多时间线：同书全部《时间线.md》/《时间线-***.md》合并绘制，每条泳道一种配色（行 `.tl-l<n>` 类 + 非默认泳道的彩色名称 chip）；头部下拉选单条时间线时只显示该泳道条目（时间线 chip 与图例随可见行变化）。重渲染只清 zoomEl——缩放/滚动位置/折叠状态保持 */
	private renderBody(snap: TlSnapshot): void {
		this.zoomElClear();
		// 本次渲染趟的泳道索引：按快照 lanes 序（默认恒 0），缺失名按出现序补号
		this.laneNameIdx.clear();
		for (const l of this.lanesOf(snap)) this.laneNameIdx.set(l.name, this.laneNameIdx.size);
		for (const r of snap.rows) if (!this.laneNameIdx.has(r.lane)) this.laneNameIdx.set(r.lane, this.laneNameIdx.size);
		const visible = this.laneFilter ? snap.rows.filter((r) => r.lane === this.laneFilter) : snap.rows;
		// 关联 chip 的跳转索引：带事件名（或无名条目按事件字段推导的显示名，tlRowName）的条目入索引（v0.4.7+ 无名条目也可被关联命中）
		this.relatedIndex.clear();
		for (const r of visible) {
			const n = tlRowName(r);
			if (n) this.relatedIndex.set(n.toLowerCase(), r.id);
		}
		const ph = this.placeholderFor(snap);
		if (ph) {
			this.sumEl.empty();
			this.zoomEl.createDiv({ text: ph, cls: "aw-dim aw-st-hint" });
			this.canvas.apply(); // 空态内容尺寸也变了 → 同步 sizer 与滚动限位
			return;
		}
		// 折叠状态按小说隔离：切换当前书时重置，避免上一本书的 id 残留
		const storyKey = snap.activeStory ?? "";
		if (storyKey !== this.lastStoryKey) {
			this.lastStoryKey = storyKey;
			this.collapsedIds.clear();
		}
		const q = this.filterText.trim().toLowerCase();
		const flat = this.buildFlatRows(visible); // 逐文档挂父建树 → 扁平化 → 时间升序（v0.3.3+ 折叠修复，见 buildFlatRows）
		this.tlSpacingOn = q === ""; // 时间比例间距仅非筛选视图（筛选命中稀疏，按真实间隔会拉出荒长空白）
		this.tlPrevMs = null;
		if (q) {
			const matchCount = visible.filter((r) => matchRow(r, q)).length;
			if (!matchCount) {
				this.zoomEl.createDiv({ text: `没有匹配「${this.filterText.trim()}」的时间线条目。`, cls: "aw-dim aw-st-hint" });
			} else {
				const list = this.zoomEl.createDiv({ cls: "aw-tl-list" }); // 纵向时间轴（左侧竖线 + 节点圆点），自上而下按时间点升序
				const ancestorIds = new Set<string>(); // 命中条目的全部祖先 id：可见集合＝命中条目＋祖先链（忽略折叠状态）
				for (const f of flat) if (matchRow(f.node.item, q)) for (const a of f.ancestors) ancestorIds.add(a.id);
				for (const f of flat) if (matchRow(f.node.item, q) || ancestorIds.has(f.node.item.id)) this.renderRow(list, f, q, null);
			}
			this.sumEl.setText(`匹配 ${String(matchCount)} 条（共 ${String(visible.length)} 条）`);
			this.renderLaneLegend(visible);
		} else {
			const list = this.zoomEl.createDiv({ cls: "aw-tl-list" });
			for (const f of flat) {
				if (f.ancestors.some((a) => this.collapsedIds.has(a.id))) continue; // 祖先链任一结构父被折叠 → 隐藏（时间上四散的后代也一并藏）
				let collapsed: number | null = null; // 本条自身折叠且有后代 → 行尾追加「已折叠 N 条」提示
				if (f.node.children.length && this.collapsedIds.has(f.node.item.id)) collapsed = this.descendantCount(f.node);
				this.renderRow(list, f, "", collapsed);
			}
			const perScope: Record<TlScope, number> = { book: 0, volume: 0, chapter: 0 };
			let doneCount = 0;
			for (const r of visible) {
				perScope[r.scope]++;
				if (r.done) doneCount++;
			}
			let spanTxt = "";
			if (visible.length >= 2) {
				// rows 为文档顺序（非时间序）→ min/max 遍历求最早到最晚总时长（缺月日按年初/一号计）
				let lo = Number.POSITIVE_INFINITY;
				let hi = Number.NEGATIVE_INFINITY;
				for (const r of visible) {
					const ms = tlEpochMs(r);
					if (ms < lo) lo = ms;
					if (ms > hi) hi = ms;
				}
				const days = Math.round((hi - lo) / TL_DAY_MS);
				if (days > 0) spanTxt = `｜跨度 ${this.formatTlSpan(days)}`;
			}
			const scopeTotal = this.laneFilter ? `共 ${String(visible.length)} 条（时间线「${this.laneFilter}」）` : `共 ${String(snap.totalCount)} 条`;
			this.sumEl.setText(`${scopeTotal}：书籍级 ${String(perScope.book)} · 卷 ${String(perScope.volume)} · 章 ${String(perScope.chapter)}${doneCount ? `｜已完成 ${String(doneCount)}` : ""}${spanTxt}`);
			this.renderLaneLegend(visible);
		}
		this.canvas.apply(); // 内容尺寸变化 → 同步 sizer 与滚动限位
	}

	/** v0.4.7+ 汇总行之下的时间线图例：可见行涉及的每条泳道一个「色点＋名称＋条数」chip（点击切换为该泳道单独显示／回到全部）；只有一条泳道时不占行 */
	private renderLaneLegend(visible: TlRow[]): void {
		const counts = new Map<string, number>();
		for (const r of visible) counts.set(r.lane, (counts.get(r.lane) ?? 0) + 1);
		if (counts.size < 2) return;
		const row = this.sumEl.createDiv({ cls: "aw-tl-legend" });
		row.createSpan({ text: "时间线", cls: "aw-dim aw-tl-rels-lbl" });
		for (const [name, n] of counts) {
			const chip = row.createSpan({ cls: "aw-tl-lane-chip" });
			chip.createSpan({ cls: "aw-tl-lane-dot" }).style.backgroundColor = tlLaneStyle(this.laneNameIdx.get(name) ?? 0).color;
			chip.createSpan({ text: name === "默认" ? "默认（时间线.md）" : name });
			chip.createSpan({ text: String(n), cls: "aw-dim aw-tl-lane-n" });
			setTooltip(chip, this.laneFilter === name ? "当前只显示这条时间线，点击恢复全部" : `只显示「${name}」这条时间线（合并绘制＝选「全部时间线」）`);
			chip.addEventListener("click", () => {
				this.laneFilter = this.laneFilter === name ? "" : name;
				if (this.lastSnap) this.render(this.lastSnap); // 重渲头部（下拉选中项同步）＋主体
			});
		}
	}

	/** 某节点的全部后代条数（折叠提示用；countSubtree 含自身，减 1） */
	private descendantCount(node: TlNode): number {
		return countSubtree(node) - 1;
	}

	/** 快照 rows（文档枚举顺序）→ 渲染趟扁平时间线：按 **sourcePath 连续段**逐文档 buildOutlineTree 挂父（跨文档不挂父——否则章文档首条会挂到前一书/卷文档末条名下，破坏 addChild/delete 等文档内子树锚点语义），深度优先扁平化为 {node, depth, ancestors}，再按 (年,月,日) 稳定升序——同刻条目保持树序。渲染趟据此逐行输出：缩进＝depth、可见性＝祖先链折叠判定。v0.4.7+ 泳道筛选后的子集仍保持文档连续性（同一文档的条目 lane 相同、枚举上必相邻），挂父语义不变 */
	private buildFlatRows(rows: TlRow[]): TlFlatNode[] {
		const flat: TlFlatNode[] = [];
		let i = 0;
		while (i < rows.length) {
			let j = i + 1;
			while (j < rows.length && rows[j].sourcePath === rows[i].sourcePath) j++; // rows 按文档枚举顺序 → 同文档条目必连续
			for (const root of buildOutlineTree(rows.slice(i, j))) this.flattenTl(flat, root, 0, []);
			i = j;
		}
		return flat.sort((a, b) => a.node.item.time - b.node.item.time || ((a.node.item.month ?? 0) - (b.node.item.month ?? 0)) || ((a.node.item.day ?? 0) - (b.node.item.day ?? 0)));
	}

	/** 深度优先展开一棵轮廓树到扁平数组：children 递归、depth+1、祖先链追加自身 */
	private flattenTl(out: TlFlatNode[], node: TlNode, depth: number, ancestors: TlRow[]): void {
		out.push({ node, depth, ancestors });
		for (const c of node.children) this.flattenTl(out, c, depth + 1, [...ancestors, node.item]);
	}

	/** 切换某条目的折叠状态（圆点点击；仅对有子事件的条目生效） */
	private toggleCollapse(id: string): void {
		if (this.collapsedIds.has(id)) this.collapsedIds.delete(id);
		else this.collapsedIds.add(id);
	}

	/** 轮廓层级导引线（v0.3.3+ 视觉增强）：让扁平时间序里的父子从属关系可见。列 k（1≤k≤min(depth,6)）画一条通高竖细线 `.aw-tl-branch-line`（列横坐标与缩进/圆点列同一公式：--tl-guide-start＋(k-1)×--tl-indent，样式见 styles.css nth-child 映射）——同一祖先支的子行被同一条竖向通道串起。
	 * 条目行（isRow）额外：depth≥1 时肘形接线 `.aw-tl-elbow`（父级列 → 本行圆点，横杆与所有圆点圆心线 top:11px 对齐）；有子事件时子列短桩 `.aw-tl-branch-stub`（列 min(depth,6)+1，自本行圆点下方垂至行尾——子行/间隔块的同列竖线在下方接续）。
	 * 间隔/跳跃块（isRow=false）只画通高竖线：比例留白内层级通道不断线（留白＝流逝时间，通道＝结构从属） */
	private attachTlGuides(el: HTMLElement, depth: number, hasKids: boolean, isRow: boolean): void {
		for (let k = 1; k <= depth; k++) el.createDiv({ cls: "aw-tl-branch-line" });
		if (!isRow) return;
		if (hasKids) el.createDiv({ cls: "aw-tl-branch-stub" });
		if (depth >= 1) el.createDiv({ cls: "aw-tl-elbow" });
	}

	/** 时间比例间距：本条目时刻与上一条已渲染条目之差 Δ，在**当前容器内、本条目之前**插入间隔元素，随后更新 tlPrevMs。Δ≤TL_SPACER_MAX_DAYS 天 → `.aw-tl-spacer` 纯留白定高块（按 TL_PX_PER_DAY px/天 换算，list 的竖线自动贯穿——空白即「故事里流逝的时间」）；Δ＞上限 → `.aw-tl-skip` 定高时间跳跃标记块（居中「⋯ 约 N 年 ⋯」小字），防极端跨度的孤立点把画布拉到无法使用。两类间隔块同样贯穿本行的轮廓导引线（attachTlGuides，depth＝本行轮廓深度）。扁平数组已按 (年,月,日) 升序（tlEpochMs 缺月日按年初/一号＝同序）→ 渲染顺序恒为时间非降序 → Δ≥0；同刻条目不插块自然堆叠；折叠隐藏的条目被跳过后，其兄弟相对条目的间隔＝两者真实时差；筛选趟（tlSpacingOn=false）整体跳过保持紧凑布局 */
	private pushTlSpacer(parent: HTMLElement, row: TlRow, depth: number): void {
		if (!this.tlSpacingOn) return; // 筛选模式紧凑堆叠
		const ms = tlEpochMs(row);
		if (this.tlPrevMs !== null && ms > this.tlPrevMs) {
			const days = (ms - this.tlPrevMs) / TL_DAY_MS;
			if (days > TL_SPACER_MAX_DAYS) {
				const sk = parent.createDiv({ cls: "aw-tl-skip" });
				this.attachTlGuides(sk, depth, false, false);
				sk.createSpan({ text: `⋯ 约 ${String(this.formatTlSpan(Math.round(days)))} ⋯`, cls: "aw-dim aw-tl-skiplbl" });
			} else {
				const px = Math.round(days * TL_PX_PER_DAY);
				if (px > 0) {
					const sp = parent.createDiv({ cls: "aw-tl-spacer" });
					sp.style.height = `${String(px)}px`; // 动态值（与 sizer 宽高同一模式）
					this.attachTlGuides(sp, depth, false, false);
				}
			}
		}
		this.tlPrevMs = ms;
	}

	/** 时间间隔天数人读化（跳跃标记与汇总行跨度共用）：＜90 天→「N 天」；不足一年→「N 个月」（避免出现「0 年 N 月」）；≥一年→「N 年 M 月」近似 */
	private formatTlSpan(days: number): string {
		if (days < 90) return `${String(days)} 天`;
		const y = Math.floor(days / 365);
		const m = Math.floor((days % 365) / 30);
		if (y === 0) return `${String(m)} 个月`;
		return m > 0 ? `${String(y)} 年 ${String(m)} 月` : `${String(y)} 年`;
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
			return `还没有时间线：点头部「＋ 事件」新建，或在${where}手动记录——每条事件一个标题块，标题＝时间点 + 空格 + 事件名（如 \`## 120-06-15 黑市陷阱\`；只写时间点＝无名条目），可带 \`- 人物：A、B\` / \`- 完成：是\` / \`- 事件：…\` / \`- 详情：…\`（旧写法 \`- 描述：\` 也兼容） / \`- 影响：…\` / \`- 关联：标题A、标题B\` 字段行；标题深度即事件级别（\`#\`=一级、\`##\`=二级、\`###\`=三级，可更深＝更细的子事件），面板会把三层合并成一条按时间排序的时间轴并按级别嵌套展示。\n多条时间线：默认那份叫《时间线.md》，其它按《时间线-名字.md》命名（如《时间线-战斗线.md》），放在同一层容器里即自动并入面板、按泳道配色。`;
		}
		return null;
	}

	/** 渲染扁平时间线的一行（v0.3.3+ 折叠修复，取代旧 renderNode 的 .aw-tl-kids 嵌套递归）：整棵树只决定缩进深度与折叠归属，DOM 是 list 下的扁平兄弟行序列。
	 * 条目带 `lv-<级别>` 类（级别＝标题深度，≥5 归入 lv-5）——圆点大小/颜色与正文强调按级别区分；另带 `tl-d<深度>` 类（≥6 归入 6）驱动行缩进与层级列坐标（--tl-d × --tl-indent，样式见 styles.css `.aw-tl-item`）；**圆点落在本行深度列**（根＝主轴、子级逐级右移一列），配合 attachTlGuides 画的通高竖向导引线/肘形接线/短桩，父子从属关系沿竖向通道一眼可辨；有子事件另挂 `.aw-tl-caret` 折叠标识（▾展开/▸折叠，点击切换、Tip 带子事件条数）。
	 * **描述内容（row.desc）只经悬停 Tip 显示、不内联渲染**：desc 非空时用 setTooltip（aria-label 驱动 Obsidian 自绘 .tooltip，可 CSS 定制）给条目与圆点挂同一份 Tip（类 aw-tl-tip，样式见 styles.css）——圆点仅 5–12px，悬停稍有偏差落到条目上也能看到描述；无描述则不挂 Tip。圆点为真实元素 .aw-tl-dot、有子事件时可点击切换折叠状态（折叠隐藏＝全部结构后代，无论其时间排在何处）；**双击**条目在编辑器打开来源文档并定位到该时间点。**拖动更新时间点**（q==="" 时 attachTlDrag 挂载、鼠标左键沿轴上下拖）：该条目＋其全部**已渲染**后代行实时平移＋浮标提示目标时间，松手写回源《时间线.md》标题行。
	 * collapsedCount 非 null（仅非筛选趟、本条折叠且有后代时由 renderBody 给出）→ 行尾追加「（已折叠 N 条子事件）」。
	 * **编辑态元素**：条目行注册进 nodeEls（关联 chip 跳转闪烁定位 + 拖动收集后代行）；有事件名时渲染 `.aw-tl-name` 名称徽章、done 时渲染「✓ 已完成」徽章（`.aw-tl-done`）；有 `- 影响：` 时内联一行 `.aw-tl-impact`；`- 关联：` 每项渲染可点 chip（`.aw-tl-rel`，索引未命中加 `is-tl-dead` 置灰）。动作组 `.aw-tl-acts`（v0.4.7+：不再绝对定位右上角，改为**事件内容下方独占一行**——`.aw-tl-item` 内、`.aw-tl-evwrap` 之后，左缘随条目缩进；CSS 悬停显现＝＋子事件（级别＜6）/✎ 编辑/✓○ 完成切换/🗑 删除）；右键条目弹节点菜单。动作组 pointerdown 阻止冒泡以免进入拖动改时手势。
	 * 渲染顺序＝buildFlatRows 扁平数组序＝时间升序：每行先经 pushTlSpacer 按与上一条**已渲染**条目的时间差插比例间隔块（间隔块一律插在 list 内、该行之前——扁平化后不再跨嵌套容器） */
	private renderRow(parent: HTMLElement, f: TlFlatNode, q: string, collapsedCount: number | null): void {
		const node = f.node;
		const row = node.item;
		const cappedDepth = Math.min(f.depth, 6); // 深度封顶 6（与 tl-d6 深度类同一口径）：缩进、导引线列数、圆点列、短桩列都按它
		const hasKids = node.children.length > 0;
		this.pushTlSpacer(parent, row, cappedDepth); // 时间比例间距（筛选趟/首条为 no-op），随同贯穿本行深度的层级导引线
		const item = parent.createDiv({ cls: `aw-tl-item lv-${String(Math.min(row.level, 5))} tl-d${String(cappedDepth)}${row.done ? " is-tl-done-row" : ""} ${tlLaneStyle(this.laneNameIdx.get(row.lane) ?? row.laneIndex).cls}` }); // 级别类＝圆点样式；深度类＝行缩进＋圆点所在层级列；done 行另挂 is-tl-done-row（条目名弱化样式用，替代 :has 选择器）；v0.4.7+ 泳道类＝该时间线配色（圆点/时间徽章着色）
		this.attachTlGuides(item, cappedDepth, hasKids, true); // 层级导引线必须是 item 的前 cappedDepth 个子元素（styles.css 按 nth-child 映射列坐标），圆点/折叠标在其后
		this.nodeEls.set(row.id, item); // 条目行索引（关联 chip 跳转后高亮闪烁定位；拖动时按结构子树收集后代行）
		const dot = item.createSpan({ cls: "aw-tl-dot" }); // 节点圆点：落在本行深度列的圆心（与竖向层级通道同一坐标），有子事件时可点击切换折叠
		const toggleKids = () => {
			this.toggleCollapse(row.id);
			if (this.lastSnap) this.renderBody(this.lastSnap);
		};
		if (hasKids) {
			dot.addClass("has-kids");
			dot.addEventListener("click", toggleKids);
		}
		if (row.desc) {
			// 描述内容只经悬停 Tip 显示（不内联）：条目与圆点同挂一份——圆点仅 5–12px，悬停稍有偏差即落到条目上，两处一致保证看到的都是描述；无描述则不挂 Tip
			setTooltip(item, row.desc, { classes: ["aw-tl-tip"] });
			setTooltip(dot, row.desc, { classes: ["aw-tl-tip"] });
		}
		if (hasKids) {
			const caret = item.createSpan({ text: this.collapsedIds.has(row.id) ? "▸" : "▾", cls: "aw-tl-caret" }); // 可折叠标识：▾＝展开中 / ▸＝已折叠，排在时间徽章之前（圆点→caret→徽章）、点击与圆点同一切换
			setTooltip(caret, this.collapsedIds.has(row.id) ? `已折叠 ${String(this.descendantCount(node))} 条子事件，点击展开` : "有子事件，点击折叠");
			caret.addEventListener("click", (ev: MouseEvent) => { ev.stopPropagation(); toggleKids(); });
			caret.addEventListener("pointerdown", (ev: PointerEvent) => ev.stopPropagation()); // caret 不进入拖动改时手势
			caret.addEventListener("dblclick", (ev: MouseEvent) => ev.stopPropagation());
		}
		item.createSpan({ text: timelineTimeText(row), cls: "aw-tl-time" }); // 时间徽章紧跟圆点：负 margin 从内容缩进拉回圆点右后侧（几何见 styles.css .aw-tl-time），读作「该圆点＝此时间点」；前有 caret 时由兄弟选择器免掉拉回（.aw-tl-caret + .aw-tl-time）
		const rowName = tlRowName(row); // v0.4.7+ 无名条目把「事件」字段首行当事件名（文档标题仍无名、不改写）
		if (rowName) {
			const nameEl = item.createSpan({ text: rowName, cls: "aw-tl-name" }); // 事件名徽章（无名条目＝事件字段首行，悬停注明出处）
			if (!row.title) setTooltip(nameEl, "该事件没有事件名：以「事件」字段首行作为名称显示");
		}
		if (row.done) item.createSpan({ text: "✓ 已完成", cls: "aw-tl-done" });
		if (row.sourceLabel) {
			// v0.4.9+ 用户要求＝事件要看得到所在文档：默认泳道在标签后补出文档文件名（非默认泳道的标签里已带泳道名），悬停给出完整「层级词 · 书内路径」
			const docName = row.sourcePath.slice(row.sourcePath.lastIndexOf("/") + 1).replace(/\.md$/, "");
			const srcEl = item.createSpan({ text: row.lane === "默认" ? `${row.sourceLabel} · ${docName}` : row.sourceLabel, cls: "aw-dim aw-tl-src" });
			setTooltip(srcEl, this.locationOf(row.scope, row.sourcePath));
		}
		if (row.lane && row.lane !== "默认") { // v0.4.7+ 多时间线：非默认泳道挂彩色名称 chip（默认时间线不占位，配色已由圆点/徽章体现）
			const laneChip = item.createSpan({ text: row.lane, cls: "aw-tl-lane aw-tl-lane-tag" });
			const color = tlLaneStyle(this.laneNameIdx.get(row.lane) ?? row.laneIndex).color;
			laneChip.style.borderColor = color;
			laneChip.style.color = color;
			setTooltip(laneChip, `时间线「${row.lane}」· ${row.sourcePath}`);
		}
		const wrap = item.createDiv({ cls: "aw-tl-evwrap" });
		if (row.chars.length) {
			const chars = wrap.createDiv({ cls: "aw-tl-chars" });
			for (const c of row.chars) chars.createSpan({ text: c, cls: "aw-tl-char" });
		}
		if (row.event) wrap.createDiv({ text: row.event, cls: "aw-tl-event" });
		else if (!row.chars.length && !rowName) wrap.createDiv({ text: "（未填写事件与人物）", cls: "aw-dim aw-st-hint" });
		if (row.impact) wrap.createDiv({ text: `影响：${row.impact}`, cls: "aw-tl-impact" });
		if (row.related?.length) {
			// 关联 chip：事件名命中索引 → 点击跳到该条目所在文档并闪烁高亮；未命中（无名/未找到）→ 置灰不可点
			const rels = wrap.createDiv({ cls: "aw-tl-rels" });
			rels.createSpan({ text: "关联", cls: "aw-dim aw-tl-rels-lbl" });
			for (const name of row.related) {
				const target = this.relatedIndex.get(name.trim().toLowerCase());
				const chip = rels.createSpan({ text: name, cls: target ? "aw-tl-rel" : "aw-tl-rel is-tl-dead" });
				if (target) chip.addEventListener("click", (ev) => { ev.stopPropagation(); void this.jumpToRelated(name, target); });
				else setTooltip(chip, "未在当前时间线中找到同名事件");
			}
		}
		const acts = item.createDiv({ cls: "aw-tl-acts" }); // 动作组（v0.4.7+ 独占一行、排在事件内容最下边；悬停条目显现）：＋子事件 / ✎ 编辑 / ✓○ 完成切换 / 🗑 删除
		acts.addEventListener("pointerdown", (ev: PointerEvent) => ev.stopPropagation()); // 按钮不进入拖动改时手势
		acts.addEventListener("dblclick", (ev: MouseEvent) => ev.stopPropagation());
		if (row.level < 6) {
			const bAdd = acts.createEl("button", { text: "＋", cls: "aw-tl-act" });
			setTooltip(bAdd, "添加子事件");
			bAdd.addEventListener("click", (ev) => { ev.stopPropagation(); void this.openAddChild(row); });
		}
		const bEdit = acts.createEl("button", { text: "✎", cls: "aw-tl-act" });
		setTooltip(bEdit, "编辑事件（与双击条目同）");
		bEdit.addEventListener("click", (ev) => { ev.stopPropagation(); void this.openEdit(row); });
		const bDone = acts.createEl("button", { text: row.done ? "✓" : "○", cls: `aw-tl-act ${row.done ? "is-tl-done-on" : "is-tl-done-off"}` });
		setTooltip(bDone, row.done ? "标记为未完成" : "标记为已完成");
		bDone.addEventListener("click", (ev) => { ev.stopPropagation(); void this.toggleDone(row); });
		const bDel = acts.createEl("button", { text: "🗑", cls: "aw-tl-act is-tl-danger" });
		setTooltip(bDel, node.children.length ? "删除事件及全部子事件" : "删除事件");
		bDel.addEventListener("click", (ev) => { ev.stopPropagation(); this.deleteNode(row, node); });
		item.addEventListener("contextmenu", (ev: MouseEvent) => { ev.preventDefault(); this.openNodeMenu(ev, row, node); }); // 右键菜单＝编辑动作的替代入口（触屏/长按同用）
		item.addEventListener("dblclick", () => void this.openEdit(row)); // v0.4.9+ 用户要求＝双击弹**编辑事件弹窗**（不再在编辑器打开文档＝与场景面板同口径）；打开来源文档＝右键「打开来源文档」。提示文字仍不占用 Tip（Tip 专显描述内容）
		if (q === "") this.attachTlDrag(item, row, node); // 拖动更新时间点仅非筛选比例视图（筛选紧凑布局下位移无比例语义）
		if (collapsedCount !== null) item.createSpan({ text: `（已折叠 ${String(collapsedCount)} 条子事件）`, cls: "aw-dim aw-tl-collapsed-hint" }); // 折叠提示（按结构子树条数，由 renderBody 判定）
	}

	/** 条目右键菜单（编辑动作替代入口）：编辑事件 / 添加子事件（级别＜6 时）/ 添加同级 / 标记完成或未完成 / 打开来源文档（v0.4.9+ 用户要求＝文案由「在编辑器打开」统一改名，图标 `file-text` 不变） / 删除（含子事件时文案注明） */
	private openNodeMenu(ev: MouseEvent, row: TlRow, node: TlNode): void {
		const menu = new Menu();
		menu.addItem((it) => it.setTitle("编辑事件").setIcon("pencil").onClick(() => void this.openEdit(row)));
		if (row.level < 6) menu.addItem((it) => it.setTitle("添加子事件").setIcon("plus").onClick(() => void this.openAddChild(row)));
		menu.addItem((it) => it.setTitle("添加同级事件").setIcon("list-plus").onClick(() => void this.openAddSibling(row)));
		menu.addItem((it) => it.setTitle(row.done ? "标记为未完成" : "标记为已完成").setIcon("check").onClick(() => void this.toggleDone(row)));
		menu.addItem((it) => it.setTitle("打开来源文档").setIcon("file-text").onClick(() => void this.openAt(row))); // v0.4.9+ 用户要求＝菜单项文案由「在编辑器打开」统一为「打开来源文档」（与人物关系／场景面板菜单同词），图标沿用 `file-text`
		menu.addSeparator();
		menu.addItem((it) => it.setTitle(node.children.length ? "删除事件及子事件" : "删除事件").setIcon("trash").onClick(() => this.deleteNode(row, node)));
		menu.showAtPosition({ x: ev.x, y: ev.y });
	}

	/** 给条目行挂「拖动更新时间点」手势（仅非筛选比例视图调用）：左键按下起候选、pointermove 越过 5px 阈值才激活（未越界＝普通点击/双击，语义不受影响），期间该条目＋其全部**已渲染**结构后代行随光标平移＋浮标提示按条目精度单位增减的步数；松手时按位移算出的新时间点≠原值才写回源文档。stopPropagation 使本手势优先于画布平移（bodyEl pointerdown）独占 */
	private attachTlDrag(item: HTMLElement, row: TlRow, node: TlNode): void {
		item.addClass("aw-tl-movable"); // grab 光标提示（样式见 styles.css）
		item.addEventListener("pointerdown", (ev: PointerEvent) => {
			if (ev.button !== 0 || ev.pointerType !== "mouse") return; // 只响应鼠标左键（触屏保持原生滚动手势）
			ev.stopPropagation(); // 拦掉画布平移对本手势的接管
			ev.preventDefault(); // 不触发文字选中等副作用
			this.tlDrag = { row, startY: ev.clientY, els: [item], badge: item.querySelector<HTMLElement>(".aw-tl-time") ?? null };
			this.collectTlDescendantEls(node, this.tlDrag.els); // 结构后代行一并位移（扁平布局下后代行时间上四散，逐行收集）
			this.tlDragLive = false;
			this.tlDragSteps = 0;
			document.addEventListener("pointermove", this.onTlDragMove);
			document.addEventListener("pointerup", this.endTlDrag);
			document.addEventListener("pointercancel", this.endTlDrag);
		});
	}

	/** 拖动位移收集：深度优先遍历结构子树，把**已渲染**（在 nodeEls 中＝未被祖先折叠隐藏）的后代行元素加入位移集合。被折叠的后代不在 DOM，天然跳过；递归只在可见节点内继续 */
	private collectTlDescendantEls(node: TlNode, els: HTMLElement[]): void {
		for (const c of node.children) {
			const el = this.nodeEls.get(c.item.id);
			if (el) {
				els.push(el);
				this.collectTlDescendantEls(c, els);
			}
		}
	}

	/** 条目精度对应的拖动单位：含日＝天（灵敏度沿用比例尺 TL_PX_PER_DAY 逐日）、只含月＝月、纯年＝年（后两者用 TL_DRAG_PX_PER_UNIT，保证正常拖动距离内就能整年/整月增减）。char 供浮标文案 */
	private tlDragUnit(r: TlRow): { char: string; px: number } {
		if (r.day != null) return { char: "天", px: TL_PX_PER_DAY };
		if (r.month != null) return { char: "月", px: TL_DRAG_PX_PER_UNIT };
		return { char: "年", px: TL_DRAG_PX_PER_UNIT };
	}

	/** 拖动移动：屏幕位移÷画布缩放→布局 px，再按条目精度单位的灵敏度（tlDragUnit）换算 Δ 步数。未越阈值不动作；激活后对子树块各元素施加 translateY＋更新浮标（增减步数×单位） */
	private onTlDragMove = (ev: PointerEvent): void => {
		const d = this.tlDrag;
		if (!d) return;
		ev.preventDefault();
		const dyScreen = ev.clientY - d.startY;
		if (!this.tlDragLive) {
			if (Math.abs(dyScreen) < 5) return; // 未越阈值 → 仍属点击手势
			this.tlDragLive = true;
			d.els.forEach((el) => el.addClass("is-dragging"));
			this.tlDragLbl = this.rootEl.createDiv({ cls: "aw-tl-draglbl" });
		}
		const dyLayout = dyScreen / this.canvas.zoom; // 屏幕 px → 画布局部 px（zoomEl transform scale＝画布倍率）
		const unit = this.tlDragUnit(d.row);
		this.tlDragSteps = Math.round(dyLayout / unit.px);
		const ty = `translateY(${String(Math.round(dyLayout))}px)`; // 动态值（与 spacer 高度/sizer 宽高同一模式）
		d.els.forEach((el) => { el.style.transform = ty; });
		const np = this.shiftTlPoint(d.row, this.tlDragSteps);
		d.badge?.setText(timelineTimeText(np)); // 条目自身时间徽章立即变为目标时间点（松手还原；写回成功后 refresh 重建布局）
		if (this.tlDragLbl) {
			this.tlDragLbl.setText(`${this.tlDragSteps > 0 ? "+" : ""}${String(this.tlDragSteps)} ${unit.char}`); // 浮标只给增减量——新日期已由徽章实时显示，不重复
			this.tlDragLbl.style.left = `${String(ev.clientX + 14)}px`;
			this.tlDragLbl.style.top = `${String(ev.clientY - 30)}px`;
		}
	};

	/** 拖动结束：摘监听、移除浮标、复位样式；有效拖拽且算出的新时间点 ≠ 原值 → 写回源文档，否则原地还原（粗精度条目拖动距离不足一个精度单位时新点＝原值，不写回） */
	private endTlDrag = (): void => {
		document.removeEventListener("pointermove", this.onTlDragMove);
		document.removeEventListener("pointerup", this.endTlDrag);
		document.removeEventListener("pointercancel", this.endTlDrag);
		const d = this.tlDrag;
		this.tlDrag = null;
		const lbl = this.tlDragLbl;
		this.tlDragLbl = null;
		lbl?.remove(); // 手势中途视图已关闭时节点不在 DOM——remove() 对未连接节点是安全 no-op
		if (!d) return;
		d.els.forEach((el) => el.removeClass("is-dragging"));
		if (!this.tlDragLive) return; // 点击级手势 → click/dblclick 语义完全不动
		this.canvas.suppressClicks(400); // 吞掉紧随的 click/dblclick（zoomEl 捕获阶段判定）
		d.els.forEach((el) => el.style.removeProperty("transform")); // 拖动中的平移只是手势预览：一律先还原（removeProperty 而非赋空串，no-static-styles-assignment）——写回成功后由 refresh 按新间隔重建布局；未写回或写回失败则保持原位不留残影
		d.badge?.setText(timelineTimeText(d.row)); // 徽章同步还原原值（写回成功时 refresh 会整体重建，此处保证失败路径显示正确）
		const steps = this.tlDragSteps;
		this.tlDragSteps = 0;
		if (steps === 0) return;
		const np = this.shiftTlPoint(d.row, steps);
		if (timelineTimeText(np) === timelineTimeText(d.row)) return; // 时间点没实际移动 → 不写回
		void this.commitTlMove(d.row, np);
	};

	/** Δ 步数（步＝条目自身精度单位）→ 新时间点（保持原条目精度）：含日→按天日期运算；只含月→月份索引算术按整月增减（负年份分解正确）；纯年份→整年加减 */
	private shiftTlPoint(r: TlRow, steps: number): TimelinePoint {
		if (r.day != null) {
			const dt = new Date(tlEpochMs(r) + steps * TL_DAY_MS);
			return { time: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
		}
		if (r.month != null) {
			const nIdx = Math.trunc(r.time) * 12 + (r.month - 1) + steps;
			return { time: Math.floor(nIdx / 12), month: ((nIdx % 12) + 12) % 12 + 1 }; // floor/mod 分解对负年份同样成立
		}
		return { time: r.time + steps };
	}

	/** 拖后写回源《时间线.md》标题行：原文经「注释掩码＋srcHeading 全文匹配＋出现序号」定位、旧值反解校验通过才替换（rewriteTimelineEntryTime）；成功 Notice＋立即重渲染（vault modify 事件的防抖刷新兜底，busy 标志去重）。任一环节不满足 → 放弃并提示刷新重试 */
	private async commitTlMove(row: TlRow, np: TimelinePoint): Promise<void> {
		if (!row.srcHeading || row.srcOrdinal == null) { new Notice("该条目缺少来源定位信息，请先点「刷新」再拖动"); return; }
		const f = this.app.vault.getAbstractFileByPath(row.sourcePath);
		if (!(f instanceof TFile)) { new Notice(`未找到来源文档：${row.sourcePath}`); return; }
		let text: string;
		try { text = await this.app.vault.adapter.read(f.path); } catch (e) { new Notice(`读取来源文档失败：${e instanceof Error ? e.message : String(e)}`); return; }
		const newText = rewriteTimelineEntryTime(text, row.srcHeading, row.srcOrdinal, { time: row.time, month: row.month, day: row.day }, np);
		if (newText === null) { new Notice("写回失败：源文档自面板加载后可能已变化，请点「刷新」后再拖"); return; }
		try { await this.app.vault.adapter.write(f.path, newText); } catch (e) { new Notice(`写入《时间线.md》失败：${e instanceof Error ? e.message : String(e)}`); return; }
		new Notice(`已将「${tlRowName(row) || timelineTimeText(np)}」移至 ${timelineTimeText(np)}（${row.sourceLabel}）`);
		void this.refresh(); // 立即重渲染；vault modify 事件还会触发防抖刷新——双保险
	}

	// ---------- 事件编辑（v0.3.3+ 合并大事件：原事件树面板的增删改/完成切换由本面板承担） ----------

	/** 关联事件候选：当前快照全部条目的显示名（tlRowName：事件名，无名条目＝事件字段首行；去重、去空白；excludeName 排除自身防自关联） */
	private eventOptions(excludeName?: string): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		const ex = (excludeName ?? "").trim().toLowerCase();
		for (const r of this.lastSnap?.rows ?? []) {
			const t = tlRowName(r);
			if (!t) continue;
			const k = t.toLowerCase();
			if (k === ex || seen.has(k)) continue;
			seen.add(k);
			out.push(t);
		}
		return out;
	}

	/** 条目行 → 写回输入（显式逐字段构造，不带上原文定位字段 srcHeading/srcOrdinal）；patch 覆盖被改动的字段 */
	private entryFrom(row: TlRow, patch: Partial<TimelineEntryInput>): TimelineEntryInput {
		return {
			level: patch.level ?? row.level,
			time: patch.time ?? row.time,
			month: patch.month ?? row.month,
			day: patch.day ?? row.day,
			title: patch.title ?? row.title,
			chars: patch.chars ?? row.chars,
			event: patch.event ?? row.event,
			desc: patch.desc ?? row.desc,
			impact: patch.impact ?? row.impact,
			related: patch.related ?? row.related,
			done: patch.done ?? row.done,
		};
	}

	/** 写回统一通道：adapter 读目标《时间线.md》（不存在按空文档处理＝写入即自动创建）→ fn 生成新文本（null＝定位失败，提示刷新）→ adapter 写回 → Notice＋重渲染 */
	private async mutate(okMsg: string, docPath: string, fn: (text: string) => string | null): Promise<void> {
		if (this.busy) { new Notice("正在刷新时间线，请稍候再试"); return; }
		this.busy = true;
		try {
			let text = "";
			try {
				if (await this.app.vault.adapter.exists(docPath)) text = await this.app.vault.adapter.read(docPath);
			} catch (e) {
				new Notice(`读取《时间线.md》失败：${e instanceof Error ? e.message : String(e)}`);
				return;
			}
			const newText = fn(text);
			if (newText === null) { new Notice("写回失败：源文档自面板加载后可能已变化，请点「刷新」后重试"); return; }
			try { await this.app.vault.adapter.write(docPath, newText); } catch (e) {
				new Notice(`写入《时间线.md》失败：${e instanceof Error ? e.message : String(e)}`);
				return;
			}
			new Notice(okMsg);
		} catch (e) {
			new Notice(`写回失败：${e instanceof Error ? e.message : String(e)}`);
			return;
		} finally {
			this.busy = false;
		}
		void this.refresh();
	}

	/** 头部「＋ 事件」＝根级新增：level 1、写**弹窗「级别」下拉所选那份**《时间线*.md》的文档末尾（默认＝旧口径：未筛选泳道＝书级《时间线.md》；选中某条时间线＝该泳道已有文档；文档不存在时经 mutate 自动创建）。不能用 level 2 追加末尾——buildOutlineTree 父＝前最近更小级别条目，会挂成最后一条一级事件的子事件 */
	private async openAddRoot(): Promise<void> {
		const snap = this.lastSnap;
		if (!snap) { new Notice("时间线尚未加载，请先点「刷新」"); return; }
		const lv = this.levelChoices(snap);
		await this.openAddAt(1, "新增事件", this.addTargetPath(snap), null, 0, undefined, undefined, { options: lv.options, value: lv.value });
	}

	/** 添加子事件：级别＝父+1（封顶 6），锚点＝该条目自身（insertTimelineBlock 挂整棵子树末尾）、写回该条目所在文档。缺定位信息的条目退化为文档末尾追加 */
	private async openAddChild(row: TlRow): Promise<void> {
		await this.openAddAt(Math.min(6, row.level + 1), `添加子事件（父：${tlRowName(row) || timelineTimeText(row)}）`, row.sourcePath, row.srcHeading ?? null, row.srcOrdinal ?? 0, row, row, { label: this.locationOf(row.scope, row.sourcePath) }); // v0.4.9+ 级别行只读＝子事件随父同一份文档（时间线的父子按同一文档内的标题序列成立）
	}

	/** 添加同级事件：级别＝该条目级别，锚点＝该条目自身（插到其整棵子树之后＝其后首个同级）、写回该条目所在文档 */
	private async openAddSibling(row: TlRow): Promise<void> {
		await this.openAddAt(row.level, `添加同级事件（同${tlRowName(row) || timelineTimeText(row)}级）`, row.sourcePath, row.srcHeading ?? null, row.srcOrdinal ?? 0, row, row, { label: this.locationOf(row.scope, row.sourcePath) }); // v0.4.9+ 级别行只读＝同级随该条同一份文档
	}

	/** 新增节点公共流程：先取人物候选再开弹窗；弹窗内时间点必填（非法内联报错）；写回按 level/锚点校验——锚点级别必须比新节点浅一级否则标题序列非法（提示先刷新），通过则 insertTimelineBlock 到锚点子树末尾（锚点 null＝文档末尾） */
	private async openAddAt(level: number, label: string, docPath: string, anchorHeading: string | null, anchorOrdinal: number, anchorRow: TlRow | undefined, defaultTimeRow: TlRow | undefined, levelChoice: { options?: readonly { value: string; label: string }[]; value?: string; label?: string } | undefined = undefined): Promise<void> {
		if (anchorHeading !== null && level <= (anchorRow?.level ?? 1)) { new Notice("锚点条目级别与新节点不符，请先点「刷新」后重试"); return; }
		let chars: string[] = [];
		try { chars = await this.getCharOptions(); } catch { /* 人物候选读取失败：弹窗人物区显示「暂无」 */ }
		const related = this.eventOptions(anchorRow ? tlRowName(anchorRow) : undefined);
		const initial: Partial<EventEditResult> = { timeText: defaultTimeRow ? timelineTimeText(defaultTimeRow) : "" };
		const modal = new EventEditModal(this.app, label, initial, chars, related, levelChoice, (res) => { // v0.4.9+ levelChoice＝「＋ 事件」的级别下拉（选写入哪份《时间线.md》）／子事件与同级＝只读的位置行
			const p = parseTimelineTime(res.timeText); // 弹窗已校验；闭包里对 row 的窄化会丢失，这里就地复解析收窄类型
			if (!p) { new Notice(`时间点无效：「${res.timeText}」`); return; }
			const entry: TimelineEntryInput = { level, time: p.time, month: p.month, day: p.day, title: res.title, chars: res.chars, event: res.event, desc: res.desc, impact: res.impact, related: res.related, done: res.done };
			const target = res.scope && res.scope.trim() ? res.scope : docPath; // v0.4.9+ 弹窗「级别」下拉所选文档（只读级别行不带回＝沿用锚点所在文档）
			void this.mutate(`已新增事件「${tlRowName(res) || timelineTimeText(p)}」（${docRelPath(target, this.lastSnap?.storyDir ?? "")}）`, target, (text) => insertTimelineBlock(text, entry, anchorHeading, anchorOrdinal));
		});
		modal.open();
	}

	/** 编辑节点：弹窗预填时间点/事件名/人物/完成/事件/描述/影响/关联（时间点＝该条目规范时间文本），提交经 updateTimelineBlock 只换自块、保留全部子节点 */
	private async openEdit(row: TlRow): Promise<void> {
		if (!row.srcHeading || row.srcOrdinal == null) { new Notice("该条目缺少来源定位信息，请先点「刷新」"); return; }
		let chars: string[] = [];
		try { chars = await this.getCharOptions(); } catch { /* 同上：候选缺失不拦编辑 */ }
		const head = row.srcHeading; // async 回调里 row 的可选字段窄化会丢失——先捕获为 const
		const ord = row.srcOrdinal;
		const initial: EventEditResult = {
			timeText: timelineTimeText(row),
			title: row.title ?? "",
			chars: row.chars,
			done: !!row.done,
			event: row.event,
			desc: row.desc ?? "",
			impact: row.impact ?? "",
			related: row.related ?? [],
		};
		const related = this.eventOptions(tlRowName(row));
		const modal = new EventEditModal(this.app, "编辑事件", initial, chars, related, { label: this.locationOf(row.scope, row.sourcePath) }, (res) => { // v0.4.9+ 级别行只读＝该事件所在位置（层级词 · 书内路径）；跨文档挪块＝去对应《时间线.md》里挪
			const p = parseTimelineTime(res.timeText);
			if (!p) { new Notice(`时间点无效：「${res.timeText}」`); return; }
			const entry: TimelineEntryInput = { level: row.level, time: p.time, month: p.month, day: p.day, title: res.title, chars: res.chars, event: res.event, desc: res.desc, impact: res.impact, related: res.related, done: res.done };
			void this.mutate(`已更新事件「${tlRowName(res) || timelineTimeText(p)}」`, row.sourcePath, (text) => updateTimelineBlock(text, head, ord, entry));
		});
		modal.open();
	}

	/** 完成状态快速切换：保留其余字段原样，只翻转 done（true→写出 `- 完成：是`，false→该行消失） */
	private async toggleDone(row: TlRow): Promise<void> {
		if (!row.srcHeading || row.srcOrdinal == null) { new Notice("该条目缺少来源定位信息，请先点「刷新」"); return; }
		const head = row.srcHeading;
		const ord = row.srcOrdinal;
		const entry = this.entryFrom(row, { done: !row.done });
		void this.mutate(row.done ? "已标记为未完成" : "已标记为已完成", row.sourcePath, (text) => updateTimelineBlock(text, head, ord, entry));
	}

	/** 删除节点（ConfirmModal 二次确认）：有子事件时整棵子树删除（subtree＝children 非空），否则只删自块；根级节点删除即连带全部后代 */
	private deleteNode(row: TlRow, node: TlNode): void {
		if (!row.srcHeading || row.srcOrdinal == null) { new Notice("该条目缺少来源定位信息，请先点「刷新」"); return; }
		const head = row.srcHeading;
		const ord = row.srcOrdinal;
		const name = tlRowName(row) || timelineTimeText(row);
		const kids = countSubtree(node);
		new ConfirmModal(
			this.app,
			"删除事件",
			kids ? `将删除「${name}」及其 ${String(kids)} 条子事件（整棵子树从《时间线.md》移除，不可撤销）。确认删除？` : `将从《时间线.md》删除「${name}」（不可撤销）。确认删除？`,
			"删除",
			() => { void this.mutate(`已删除事件「${name}」${kids ? `（含 ${String(kids)} 条子事件）` : ""}`, row.sourcePath, (text) => deleteTimelineBlock(text, head, ord, row.level, node.children.length > 0)); }
		).open();
	}

	/** 关联 chip 点击：在编辑器打开目标条目所在文档并定位标题行，同时给面板内该条目 1.2s 高亮闪烁（条目不存在＝快照已过期，静默） */
	private async jumpToRelated(name: string, targetId: string): Promise<void> {
		const target = (this.lastSnap?.rows ?? []).find((r) => r.id === targetId);
		if (!target) { new Notice(`未找到关联事件「${name}」`); return; }
		await this.openAt(target);
		this.focusNode(targetId);
	}

	/** 给面板内某条目行加 is-tl-target 高亮 1.2s 后摘除（重渲染会重建 DOM，旧元素上的类随之消失，无需额外清理） */
	private focusNode(id: string): void {
		const el = this.nodeEls.get(id);
		if (!el) return;
		el.addClass("is-tl-target");
		window.setTimeout(() => el.removeClass("is-tl-target"), 1200);
	}

	/** 在编辑器打开来源《时间线.md》并滚动定位到该事件的 ## 标题行（v0.4.9+ 起入口＝右键「打开来源文档」与关联 chip 跳转；双击已改为弹编辑弹窗） */
	private async openAt(row: TlRow): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(row.sourcePath);
		if (!(f instanceof TFile)) return; // 候选路径（文档尚未创建）静默忽略
		const leaf = this.app.workspace.getLeaf(); // getLeaf() 同步返回既有/新建叶子（dts：WorkspaceLeaf），await 非 Promise 会触发 lint
		await leaf.openFile(f);
		this.locateHeading(leaf, row);
	}

	/** 在已打开的 Markdown 视图内定位匹配的时间点标题行（任意深度 ATX 标题；按解析后的值比对，兼容未补零的原始写法；优先条目级别精确匹配、退而求其次任意级别同时间点标题；移动端/内容未就绪则降级为仅打开文档）。首次尝试可能早于编辑器装载完成，250ms 后重试一次 */
	private locateHeading(leaf: WorkspaceLeaf, row: TlRow): void {
		for (const delay of [0, 250]) {
			window.setTimeout(() => {
				const ed = (leaf.view as MarkdownView | null)?.editor;
				if (!ed) return;
				let lines: string[] = [];
				try { lines = ed.getValue().split("\n"); } catch { return; }
				const findIdx = (exactLevel: boolean): number =>
					lines.findIndex((l) => {
						const m = /^(#{1,6})\s+(.*)$/.exec(l.trim());
						if (!m) return false;
						if (exactLevel && m[1].length !== row.level) return false;
						const p = parseTimelineHeading(m[2])?.point; // 标题＝时间点＋可选事件名（旧纯时间点标题同样兼容）
						return !!p && p.time === row.time && (p.month ?? 0) === (row.month ?? 0) && (p.day ?? 0) === (row.day ?? 0);
					});
				const idx = findIdx(true) >= 0 ? findIdx(true) : findIdx(false);
				if (idx < 0) return;
				revealEditorLine(leaf, idx, [0]); // 定位动作共用（editor_nav）：本方法外层已按 [0,250] 重试，故这里只试一次
			}, delay);
		}
	}

}
