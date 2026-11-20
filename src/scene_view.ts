import { ItemView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import { CanvasPanel } from "./panel_canvas";
import type { SceneDoc } from "./md_docs";

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
const SCENE_CHILD_GAP = 12; // 父卡片与子卡片块之间的垂直间距
const FRAME_PAD = 10; // 包含框相对子树包围盒的外扩

/** 渲染中的卡片条目（pass1 建元素测尺寸，pass2 布局写 x/y） */
interface ScItem {
	row: SceneRow;
	card: HTMLElement;
	w: number;
	h: number;
	x: number;
	y: number;
}

/** 一个父场景的包含框：rounded rect ＋ 子树全部卡片 id（拖动成员时按 posLive 重算包围盒，包含关系始终成立） */
interface ScFrame {
	el: SVGRectElement;
	ids: string[];
}

/** 父子连线路径——提为纯函数：渲染与拖动实时重算共用同一口径。
 *  连接边按**相对位置动态选择**：子在下＝父底边中点→子顶边中点；子整体在父上方＝翻转（父顶边→子底边）——
 *  否则线从父底绕大圈回来、连接点看着挂错边。垂向有交叠时按中心上下判定；贝塞尔控制点沿出边法向伸展。 */
function edgePathD(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): string {
	const above = b.y + b.h <= a.y || (b.y + b.h / 2) < (a.y + a.h / 2); // 子整体在上方，或子中心高于父中心＝从上方接入
	const x1 = a.x + a.w / 2;
	const x2 = b.x + b.w / 2;
	if (above) {
		const y1 = a.y; // 父顶边中点出
		const y2 = b.y + b.h; // 子底边中点入
		const mid = Math.max(16, (y1 - y2) / 2);
		return `M ${String(x1)} ${String(y1)} C ${String(x1)} ${String(y1 - mid)}, ${String(x2)} ${String(y2 + mid)}, ${String(x2)} ${String(y2)}`;
	}
	const y1 = a.y + a.h; // 父底边中点出
	const y2 = b.y; // 子顶边中点入
	const mid = Math.max(16, (y2 - y1) / 2);
	return `M ${String(x1)} ${String(y1)} C ${String(x1)} ${String(y1 + mid)}, ${String(x2)} ${String(y2 - mid)}, ${String(x2)} ${String(y2)}`;
}

/** 关联场景连线（无层级语义）：按几何就近选边——竖向不交叠走顶/底边（同层级口径），横向不交叠走左右边中点，近水平时走两底边下垂弧。
 *  提为纯函数：渲染与拖动实时重算共用同一口径 */
function relEdgePathD(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): string {
	if (b.y >= a.y + a.h || a.y >= b.y + b.h) return edgePathD(a, b); // 竖向不交叠：沿用上下朝向
	if (b.x >= a.x + a.w || a.x >= b.x + a.w) { // 横向并排：左右边中点相接，控制点水平外扩
		const lh = b.x > a.x;
		const x1 = lh ? a.x + a.w : a.x;
		const x2 = lh ? b.x : b.x + b.w;
		const y1 = a.y + a.h / 2;
		const y2 = b.y + b.h / 2;
		const mid = Math.max(16, (x2 - x1) / 2);
		return `M ${String(x1)} ${String(y1)} C ${String(x1 + mid)} ${String(y1)}, ${String(x2 - mid)} ${String(y2)}, ${String(x2)} ${String(y2)}`;
	}
	const x1 = a.x + a.w / 2; // 近水平/交叠：两底边下垂弧
	const x2 = b.x + b.w / 2;
	const y1 = a.y + a.h;
	const y2 = b.y + b.h;
	const mid = 24 + Math.abs(x2 - x1) / 3;
	return `M ${String(x1)} ${String(y1)} C ${String(x1)} ${String(y1 + mid)}, ${String(x2)} ${String(y2 + mid)}, ${String(x2)} ${String(y2)}`;
}

/** 一条已画连线：path 元素＋两端卡片行 id＋种类（hierarchy＝父子（edgePathD＋短划虚线）；relation＝关联（relEdgePathD＋点线强调色）——moveLive 重算按种类选口径） */
interface ScEdge {
	path: SVGPathElement;
	parentId: string;
	childId: string;
	kind: "hierarchy" | "relation";
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
	private onAddScene?: () => void | Promise<void>; // 头部「＋ 场景」（main.ts：SceneEditModal 新建 → insertSceneBlock 落书级）
	private onEditScene?: (row: SceneRow) => void | Promise<void>; // 卡片 ✎／右键「编辑场景」（main.ts：SceneEditModal → updateSceneBlock）
	private onDeleteScene?: (row: SceneRow) => void | Promise<void>; // 卡片 🗑／右键「删除」（main.ts：ConfirmModal → deleteSceneBlock）
	private onAddChildScene?: (row: SceneRow) => void | Promise<void>; // 右键「添加子场景」（main.ts：SceneEditModal 预填父场景 → 写同文档、`- 父场景：` 挂链）
	private built = false;
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
	private frames: ScFrame[] = []; // 包含框（每个「有可见子场景的父场景」一个），成员移动时按包围盒重算

	constructor(
		leaf: WorkspaceLeaf,
		getData: () => Promise<SceneSnapshot>,
		onMoveScenes?: (moved: { row: SceneRow; x: number; y: number }[]) => void | Promise<void>,
		onAddScene?: () => void | Promise<void>,
		onEditScene?: (row: SceneRow) => void | Promise<void>,
		onDeleteScene?: (row: SceneRow) => void | Promise<void>,
		onAddChildScene?: (row: SceneRow) => void | Promise<void>
	) {
		super(leaf);
		this.getData = getData;
		this.onMoveScenes = onMoveScenes;
		this.onAddScene = onAddScene;
		this.onEditScene = onEditScene;
		this.onDeleteScene = onDeleteScene;
		this.onAddChildScene = onAddChildScene;
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
		this.sumEl = this.rootEl.createDiv({ cls: "aw-dim aw-rel-summary aw-scene-sumrow" }); // 底部固定汇总行（不参与缩放/平移）
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
			const add = btns.createEl("button", { text: "＋ 场景" }); // 根级新增：写书级《案头资料/场景.md》末尾（不存在自动创建）
			add.disabled = !this.lastSnap?.activeStory;
			add.addEventListener("click", () => void this.onAddScene?.());
		}
		btns.createEl("button", { text: "刷新" }).addEventListener("click", () => void this.refresh());
	}

	/** 主体区：卡片画布（文档序＝自动布局排布序；已存坐标按坐标摆放）＋底部汇总行 */
	private renderBody(snap: SceneSnapshot): void {
		const zoom = this.canvas.zoomEl;
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
		const relationPairs: Array<{ from: SceneRow; to: SceneRow }> = []; // 关联连线端点（from＝声明 `- 关联：` 的行；重复对去重）
		const relSeen = new Set<string>();
		for (const r of shown) for (const id of r.related ?? []) {
			const t = relatedOf.get(`${r.id}##${id}`);
			if (!t) continue;
			const key = `${r.id}→${t.cardId}`;
			if (relSeen.has(key)) continue;
			relSeen.add(key);
			relationPairs.push({ from: r, to: t.row });
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
		// —— pass1：建卡片元素并测尺寸（绝对定位不影响测量）——
		const edgeSvg = zoom.createSvg("svg", { cls: "aw-scene-edges" });
		this.edges = [];
		this.frames = [];
		this.posLive = new Map<string, { x: number; y: number; w: number; h: number }>();
		this.cardsById = new Map<string, ScItem>();
		for (const r of shown) {
			const card = this.renderCard(r, safeParent(r), (relId) => relatedOf.get(`${r.id}##${relId}`)?.row);
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
			let curY = bottom + SCENE_CHILD_GAP;
			for (const c of childrenOf.get(r) ?? []) {
				layout(c, it.x + SCENE_INDENT, curY);
				const cb = bottomById.get(c.id) ?? curY;
				if (cb > bottom) bottom = cb;
				if (cb + SCENE_CHILD_GAP > curY) curY = cb + SCENE_CHILD_GAP;
			}
			bottomById.set(r.id, bottom);
		};
		let cy = SCENE_MARGIN;
		let maxY = 0;
		let maxRight = 0;
		for (const r of roots) {
			layout(r, SCENE_MARGIN, cy);
			cy = (bottomById.get(r.id) ?? cy) + SCENE_GAP;
			if (cy > maxY) maxY = cy;
		}
		for (const p of this.posLive.values()) {
			if (p.x + p.w > maxRight) maxRight = p.x + p.w;
		}
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
			collectIds(n, ids); // **含父卡片自身**：框＝整棵子树（父在上、子在下）的包围盒，也是「父场景区域」的可拖动热区
			this.frames.push({ el: edgeSvg.createSvg("rect", { cls: "aw-scene-frame", attr: { rx: "10", ry: "10" } }), ids }); // v0.4.7+ 纯衬底：不拦截指针（pointer-events:none），框内空白＝画布平移热区；整组挪动＝拖父卡片（attachDrag 已含全部子孙）
			for (const c of kids) buildFrames(c);
		};
		for (const r of roots) buildFrames(r);
		for (const f of this.frames) this.applyFrame(f);
		for (const [r, p] of this.edgesOf(shown)) {
			const pa = this.posLive.get(p.id);
			const cb = this.posLive.get(r.id);
			if (!pa || !cb) continue;
			const path = edgeSvg.createSvg("path", { attr: { d: edgePathD(pa, cb) } });
			this.edges.push({ path, parentId: p.id, childId: r.id, kind: "hierarchy" });
		}
		// 关联场景连线（v0.4.7+）：点线强调色（区别于层级短划虚线），几何就近选边；拖动中同样按 relEdgePathD 实时重算
		for (const pr of relationPairs) {
			const a = this.posLive.get(pr.from.id);
			const b = this.posLive.get(pr.to.id);
			if (!a || !b) continue;
			const path = edgeSvg.createSvg("path", { cls: "aw-scene-rel-edge", attr: { d: relEdgePathD(a, b) } });
			this.edges.push({ path, parentId: pr.from.id, childId: pr.to.id, kind: "relation" });
		}
		// 线型图例（画了线才显示）：层级＝短划虚线、关联＝点线（强调色）——底部汇总行内，不参与缩放
		if (this.edges.length) {
			this.sumEl.createSpan({ text: "──", cls: "aw-scene-legend-mark is-hier" });
			this.sumEl.createSpan({ text: "层级", cls: "aw-dim aw-scene-legend" });
			if (this.edges.some((e) => e.kind === "relation")) {
				this.sumEl.createSpan({ text: "···", cls: "aw-scene-legend-mark is-rel" });
				this.sumEl.createSpan({ text: "关联", cls: "aw-dim aw-scene-legend" });
			}
		}
		edgeSvg.style.width = `${Math.round(maxRight + FRAME_PAD)}px`; // 内联动态值（同 sizer 宽高模式）
		edgeSvg.style.height = `${Math.round(maxY + FRAME_PAD)}px`;
		zoom.style.height = `${Math.round(maxY + SCENE_MARGIN)}px`; // 绝对定位子元素撑不开容器高度，显式给出内容高（CanvasPanel.apply 据此算 sizer）
		this.canvas.setContentWidth(maxRight + SCENE_MARGIN); // v0.4.7+：内容比面板宽时撑出横向可拖动/滚动范围（最右卡片与框不再拖不出去）
		this.canvas.apply();
	}

	/** 连线枚举：child→parent 行对（child 行, 解析出的父行）。由 childIdsById（渲染期父子树）反查 */
	private *edgesOf(rows: SceneRow[]): Generator<[SceneRow, SceneRow]> {
		const idToRow = new Map<string, SceneRow>();
		for (const r of rows) idToRow.set(r.id, r);
		for (const [parentId, kidIds] of this.childIdsById) {
			const p = idToRow.get(parentId);
			if (!p) continue;
			for (const kid of kidIds) {
				const c = idToRow.get(kid);
				if (c) yield [c, p];
			}
		}
	}

	/** 单张场景卡片：名称＋层级/来源标签＋父场景标注＋描述＋角色 chips＋关联场景 chips＋备注（双击打开来源文档；按住拖动＝整组改位置） */
	private renderCard(r: SceneRow, parent: SceneRow | undefined, resolveRelated: (relId: string) => SceneRow | undefined): HTMLElement {
		const card = this.canvas.zoomEl.createDiv({ cls: "aw-scene-card" });
		const head = card.createDiv({ cls: "aw-scene-head" });
		head.createSpan({ text: sceneDisplayName(r), cls: "aw-scene-name" });
		if (r.title?.trim() && r.title.trim() !== r.scene_id) head.createSpan({ text: r.scene_id, cls: "aw-dim aw-scene-id" });
		head.createSpan({ text: r.sourceLabel, cls: "aw-dim aw-tl-src" });
		if (r.parent) head.createSpan({ text: parent ? `⊂ ${sceneDisplayName(parent)}` : `⊂ ${r.parent}（未找到父场景）`, cls: "aw-dim aw-scene-parent" }); // 解析口径同连线（同文档优先），不再有假“父”
		if (r.description) card.createDiv({ text: r.description, cls: "aw-scene-desc" });
		if (r.characters.length) {
			const chars = card.createDiv({ cls: "aw-tl-chars" });
			for (const c of r.characters) chars.createSpan({ text: c, cls: "aw-tl-char" });
		}
		if (r.related?.length) { // v0.4.7+ 关联场景 chip：点击打开目标场景来源文档（解析口径同连线）；解析不到置灰
			const rel = card.createDiv({ cls: "aw-tl-chars aw-scene-rels" });
			rel.createSpan({ text: "⇄", cls: "aw-dim aw-scene-rels-mark" });
			for (const id of r.related) {
				const t = resolveRelated(id);
				const chip = rel.createSpan({ text: t ? sceneDisplayName(t) : id, cls: t ? "aw-tl-char aw-scene-rel" : "aw-tl-char aw-scene-rel is-missing" });
				if (t) {
					chip.setAttr("aria-label", `打开场景「${sceneDisplayName(t)}」来源文档`);
					chip.addEventListener("click", (ev: MouseEvent) => {
						ev.stopPropagation(); // 别触发卡片拖动/双击语义
						void this.openAt(t);
					});
				} else chip.title = "未找到该关联场景（可能已改名或删除）";
			}
		}
		if (r.notes) card.createDiv({ text: `备注：${r.notes}`, cls: "aw-tl-impact" });
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
			void this.openAt(r);
		});
		return card;
	}

	/** 卡片右键菜单（触屏长按同用）：编辑场景／添加子场景（挂在它下面＝`- 父场景：`）／打开来源文档／删除 */
	private openCardMenu(ev: MouseEvent, r: SceneRow): void {
		const menu = new Menu();
		if (this.onEditScene) menu.addItem((it) => it.setTitle("编辑场景").setIcon("pencil").onClick(() => void this.onEditScene?.(r)));
		if (this.onAddChildScene) menu.addItem((it) => it.setTitle("添加子场景").setIcon("corner-down-right").onClick(() => void this.onAddChildScene?.(r)));
		menu.addItem((it) => it.setTitle("打开来源文档").setIcon("file-text").onClick(() => void this.openAt(r)));
		if (this.onDeleteScene) menu.addItem((it) => it.setSection("danger").setTitle("删除场景").setIcon("trash").onClick(() => void this.onDeleteScene?.(r)));
		menu.showAtPosition({ x: ev.x, y: ev.y });
	}

	/** 按住卡片拖动调位置（仅鼠标左键，触屏保持原生滚动手势）：越 5px 阈值才激活；**整组语义**＝被拖卡片连同全部子孙场景卡片
	 *  一起实时平移（包含框与连线同步重算），松手把整组新坐标一次写回（onMoveScenes → main.ts 按文档合并落盘）；随后吞掉紧随 click/dblclick 防误开文档 */
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
					m.card.style.left = `${Math.round(nx)}px`; // 乐观落位：写回成败都由 main.ts 通道刷新校准（失败弹回真实坐标）
					m.card.style.top = `${Math.round(ny)}px`;
					this.moveLive(m.row.id, nx, ny); // 收尾以最终坐标校正连线与包含框（最后一次 move 与 pointerup 可能有微差）
					if (nx !== m.row.x || ny !== m.row.y) moved.push({ row: m.row, x: nx, y: ny });
				}
				if (!moved.length) return; // 原地释放不写回
				void this.onMoveScenes?.(moved);
			};
			document.addEventListener("pointermove", track);
			document.addEventListener("pointerup", endTracked);
			document.addEventListener("pointercancel", endTracked);
		});
	}

	/** 包含框＝子树全部卡片包围盒＋外扩（FRAME_PAD）；每次成员移动后重设，包含关系视觉始终成立 */
	private applyFrame(f: ScFrame): void {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const id of f.ids) {
			const p = this.posLive.get(id);
			if (!p) continue;
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x + p.w > maxX) maxX = p.x + p.w;
			if (p.y + p.h > maxY) maxY = p.y + p.h;
		}
		if (!isFinite(minX)) return;
		f.el.setAttribute("x", String(Math.round(minX - FRAME_PAD)));
		f.el.setAttribute("y", String(Math.round(minY - FRAME_PAD)));
		f.el.setAttribute("width", String(Math.round(maxX - minX + FRAME_PAD * 2)));
		f.el.setAttribute("height", String(Math.round(maxY - minY + FRAME_PAD * 2)));
	}

	/** 拖动中/收尾：更新被拖卡片在 posLive 的现值，重算所有以它为端点的连线 d 与其所属包含框——连接点与框跟随卡片移动 */
	private moveLive(rowId: string, x: number, y: number): void {
		const p = this.posLive.get(rowId);
		if (!p) return;
		p.x = x;
		p.y = y;
		for (const e of this.edges) {
			if (e.parentId !== rowId && e.childId !== rowId) continue;
			const a = this.posLive.get(e.parentId);
			const b = this.posLive.get(e.childId);
			if (!a || !b) continue;
			e.path.setAttribute("d", e.kind === "hierarchy" ? edgePathD(a, b) : relEdgePathD(a, b));
		}
		for (const f of this.frames) {
			if (f.ids.includes(rowId)) this.applyFrame(f);
		}
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
