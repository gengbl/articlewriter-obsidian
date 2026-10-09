import { ItemView, Notice, setTooltip, TFile, WorkspaceLeaf, type MarkdownView } from "obsidian";
import { parseTimelineTime, rewriteTimelineEntryTime, timelineTimeText, type TimelineEntry, type TimelinePoint } from "./md_docs";

/** 时间线条目所属层级（书根 / 卷 / 章） */
export type TlScope = "book" | "volume" | "chapter";

/** 面板展示用时间线条目：解析结果 + 稳定标识、层级归属、来源路径与层级标签 */
export interface TlRow extends TimelineEntry {
	id: string; // 稳定标识（来源路径#文档内序号）：折叠状态跨刷新保持、切书重置
	scope: TlScope;
	sourcePath: string; // 来源《时间线.md》的 vault 相对路径
	sourceLabel: string; // 层级标签（书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>），合并展示时随条目显示出处
}

/** 合并时间轴的轮廓节点：条目 + 子节点（父＝其前最近一条级别更小的条目，跨层统一规则；无更小级别前驱者为根） */
interface TlNode {
	row: TlRow;
	children: TlNode[];
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

const TL_ZOOM_MIN = 0.4; // 画布模式缩放上下限（同关系面板图面量级，防缩到看不见/大到无意义）
const TL_ZOOM_MAX = 3;
const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const TL_DAY_MS = 86_400_000; // 一天的毫秒数（时间点间隔换算用）
const TL_PX_PER_DAY = 5; // 时间比例间距基准比例尺：100% 缩放下每过一天拉开约 5px（密度调节另有 Ctrl|Shift 滚轮缩放）；随画布缩放等比变化
const TL_SPACER_MAX_DAYS = 90; // 比例留白上限（天）：相邻间隔在此内按真实比例出留白；超出压成定高「⋯ 约 N 年 ⋯」时间跳跃标记块——防极端跨度的孤立点（如公元前测试时间点）把画布拉到无法使用

/** 时间点 → 绝对毫秒时刻（仅用于相邻条目间隔计算与总跨度统计）：缺月按一月、缺日按一号；旧数据小数年份先截断为整年再进 Date.UTC；极端超范围年份得 NaN 时退化为「年 × 365 天」近似，保证结果有限且对升序输入单调不减 */
function tlEpochMs(p: Pick<TimelineEntry, "time" | "month" | "day">): number {
	const y = Math.trunc(p.time);
	const ms = Date.UTC(y, (p.month ?? 1) - 1, p.day ?? 1);
	return Number.isFinite(ms) ? ms : y * 365 * TL_DAY_MS;
}

/**
 * 时间线面板（自定义 ItemView，可停靠任意区域、重载保留位置）：
 * 把当前小说**书根 / 卷目录 / 章节目录三层《时间线.md》**合并成一条自上而下的纵向时间轴——条目按时间点（支持 年 / 年-月 / 年-月-日）升序排列，每条带来源层级标签；标题深度即事件级别（#=一级、##=二级、###=三级，可更深），面板按「父＝其前最近一条级别更小的条目」嵌套成轮廓树。
 * **时间比例间距**：相邻条目的垂直间隔按其时间差成比例拉开（基准 5px/天、90 天内按真实比例出留白，超过 90 天的间隔压成定高「⋯ 约 N 年 ⋯」时间跳跃标记块防极端点拉爆画布；密度另可用 Ctrl|Shift 滚轮缩放调节）；筛选模式下改紧凑堆叠（命中稀疏不成比例）。汇总行附「跨度 N 年 M 月」（最早到最晚的总时长）。
 * 顶部筛选框可按人物/事件关键词过滤（筛选时显示命中条目及其祖先链、忽略折叠状态）。**双击**条目在编辑器打开来源文件并定位到该时间点标题行（单击不触发，避免误触）；**点击圆点**切换有子事件条目的折叠状态。
 * **拖动更新时间点**（仅非筛选比例视图、鼠标左键）：按住条目沿轴上下拖过阈值后整棵子树实时平移、**条目自身的时间徽章立即变为新时间点**、光标旁浮标显示天数差（位移÷画布缩放÷基准比例尺＝Δ天）；松手把新时间写回对应《时间线.md》的标题行——精度跟随原写法（含日按天算、只含月按月吸附、纯年份按年取整），经「注释掩码＋原文标题行全文匹配＋旧值反解校验」防误写，成功后由 vault 变更防抖自动重渲染；源文档已变化则放弃并提示刷新。
 * **画布交互**：主体区 overflow:auto——普通滚轮/滚动条/触屏原生滚动（内容放得下时滚动页面），Ctrl|Shift＋滚轮以鼠标位置为不动点缩放（0.4×–3×），左键按住拖动平移（驱动容器滚动位置），头部倍率标签点击复位。
 * 数据经构造注入的 getter 实时读取；文件变更由 main.ts 防抖调 refresh()。
 * 渲染陷阱同 StatusView / RelationshipView：UI 必须建在 onOpen 的 contentEl（本环境不调用 getEmptyStateElement）。
 */
export class TimelineView extends ItemView {
	static readonly VIEW_TYPE = "articlewriter-timeline";

	private getData: () => Promise<TlSnapshot>;
	private built = false;
	private rootEl!: HTMLElement;
	private topEl!: HTMLElement;
	private bodyEl!: HTMLElement; // 画布容器：overflow:auto——普通滚轮/触屏原生滚动，Ctrl|Shift+滚轮缩放
	private sizerEl!: HTMLElement; // 定尺寸载体：宽高＝内容×缩放（JS 设置），决定可滚动范围
	private zoomEl!: HTMLElement; // 缩放载体（绝对定位，transform scale，transform-origin 左上角；宽度由 JS 设为视口宽）
	private sumEl!: HTMLElement; // 底部固定汇总行（不参与缩放/平移）
	private zoomLbl!: HTMLElement; // 头部倍率标签（==100% 时隐藏，点击复位）
	private busy = false;
	private lastSnap: TlSnapshot | null = null;
	private filterText = "";
	// 画布视图状态：缩放倍率（重渲染不清零——筛选切换后视野保持）；平移即容器原生滚动位置（DOM 天然保持）
	private tlZ = 1;
	// 折叠中的条目 id 集合（圆点点击切换；重渲染不清零、切书重置）
	private collapsedIds = new Set<string>();
	private lastStoryKey = "";
	// 时间比例间距的本次渲染趟状态（renderBody 每趟开头重置，随同步 DFS 渲染逐条推进）：是否启用＋上一条已渲染条目的毫秒时刻
	private tlSpacingOn = false;
	private tlPrevMs: number | null = null;
	// 拖动更新时间点的手势状态（仅非筛选比例视图挂载；元素引用每次 renderNode 重建、不跨渲染持有）：候选 {row,startY,els}／激活标志／最近Δ天数／浮标元素
	private tlDrag: { row: TlRow; startY: number; els: HTMLElement[]; badge: HTMLElement | null } | null = null; // badge＝条目自身时间徽章（.aw-tl-time），拖动中 setText 立即显示新时间点
	private tlDragLive = false; // 本手势是否越过阈值成为有效拖拽（未越界＝普通点击/双击，照常放行）
	private tlDragDd = 0; // 拖动中最近一次算出的 Δ 天数（松手时据此决定是否写回）
	private tlDragLbl: HTMLElement | null = null; // 拖动期间跟随光标的目标时间浮标（挂 rootEl——zoomEl 有 transform 会破坏 position:fixed）
	private tlSuppressClickUntil = 0; // 有效拖拽结束后需吞掉紧随 click/dblclick 的时间戳上限（与平移的 dragged 同语义，防拖完误开文档/误切折叠）

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
		this.topEl = this.rootEl.createDiv({ cls: "aw-st-top" }); // 固定头部：倍率标签 + 筛选框 + 刷新按钮
		this.bodyEl = this.rootEl.createDiv({ cls: "aw-st-tree aw-tl-body" }); // 画布主体：overflow:auto，普通滚轮/滚动条/触屏原生滚动＋Ctrl|Shift+滚轮缩放＋左键拖动平移
		this.sizerEl = this.bodyEl.createDiv({ cls: "aw-tl-sizer" }); // 定尺寸载体：宽高＝内容×缩放（JS 设置），撑出可滚动范围
		this.zoomEl = this.sizerEl.createDiv({ cls: "aw-tl-zoom" }); // 内容载体（绝对定位；重渲染只清空它，transform 与宽度由 JS 经 CSS var/style 更新、事件监听常驻）
		this.sumEl = this.rootEl.createDiv({ cls: "aw-dim aw-rel-summary aw-tl-sumrow" }); // 底部固定汇总行
		this.setupCanvas();
	}

	/** 画布交互（建 UI 时挂一次，元素常驻不随 render 重建）：Ctrl|Shift＋滚轮以鼠标位置为不动点缩放、普通滚轮不拦截走原生滚动、左键按住拖动平移（驱动容器滚动位置） */
	private setupCanvas(): void {
		this.bodyEl.addEventListener("wheel", (ev: WheelEvent) => {
			if (!ev.ctrlKey && !ev.shiftKey) return; // 未按修饰键：不 preventDefault，普通滚轮原生滚动内容/页面
			ev.preventDefault(); // 拦截 Ctrl|Shift+滚轮（浏览器默认 Ctrl+滚轮是页面级缩放，这里改为画布内缩放）
			const d = ev.deltaMode === 1 ? ev.deltaY * 32 : ev.deltaY; // 行模式换算成像素量级
			const nz = clampNum(this.tlZ * Math.exp(-d * 0.0015), TL_ZOOM_MIN, TL_ZOOM_MAX);
			if (nz === this.tlZ) return;
			// 以鼠标位置为不动点：鼠标下的内容点 p=(scroll+m)/z 缩放后仍停在屏幕 m 处 → scroll′ = p·z′ − m
			const rect = this.bodyEl.getBoundingClientRect();
			const mx = ev.clientX - rect.left;
			const my = ev.clientY - rect.top;
			const px = (this.bodyEl.scrollLeft + mx) / this.tlZ;
			const py = (this.bodyEl.scrollTop + my) / this.tlZ;
			this.tlZ = nz;
			this.bodyEl.scrollLeft = px * nz - mx;
			this.bodyEl.scrollTop = py * nz - my;
			this.applyTlView();
		}, { passive: false });

		let dragFrom: { x: number; y: number; sl: number; st: number } | null = null;
		let dragged = false; // 本次手势是否真的拖过：用于吃掉松手时紧随的 click/dblclick，避免拖完误打开文档/误切折叠
		const onDragMove = (ev: PointerEvent): void => {
			if (!dragFrom) return;
			this.bodyEl.scrollLeft = dragFrom.sl - (ev.clientX - dragFrom.x); // 拖动＝驱动容器滚动位置（与滚轮/滚动条/触屏同一套滚动）
			this.bodyEl.scrollTop = dragFrom.st - (ev.clientY - dragFrom.y);
			if (!dragged && Math.abs(ev.clientX - dragFrom.x) + Math.abs(ev.clientY - dragFrom.y) > 3) {
				dragged = true;
				this.bodyEl.classList.add("is-panning");
			}
		};
		const endDrag = (): void => {
			dragFrom = null;
			this.bodyEl.classList.remove("is-panning");
			document.removeEventListener("pointermove", onDragMove);
			document.removeEventListener("pointerup", endDrag);
			window.setTimeout(() => { dragged = false; }, 0); // 等紧随其后的 click 先被拦下再复位
		};
		this.bodyEl.addEventListener("pointerdown", (ev: PointerEvent) => {
			if (ev.button !== 0) return; // 只响应左键（触屏单指平移走原生滚动，touch-action 放行后 pointer 手势会被浏览器接管）
			dragFrom = { x: ev.clientX, y: ev.clientY, sl: this.bodyEl.scrollLeft, st: this.bodyEl.scrollTop };
			dragged = false;
			document.addEventListener("pointermove", onDragMove);
			document.addEventListener("pointerup", endDrag);
			if (ev.pointerType === "mouse") ev.preventDefault(); // 鼠标拖动不选中文字；触屏保持原生滚动手势
		});
		for (const type of ["click", "dblclick"] as const) {
			this.bodyEl.addEventListener(type, (ev: MouseEvent) => {
				if (!dragged) return;
				ev.stopPropagation(); // 捕获阶段拦下：拖到一半松手不该被当成点击/双击打开文档
				ev.preventDefault();
				dragged = false;
			}, true);
		}
		for (const type of ["click", "dblclick"] as const) {
			this.zoomEl.addEventListener(type, (ev: MouseEvent) => {
				if (Date.now() > this.tlSuppressClickUntil) return; // 最近没有有效条目拖拽 → 正常放行
				ev.stopPropagation(); // 吞掉拖动更新时间点紧随的 click/dblclick（否则拖完会误开文档/误切折叠）
				ev.preventDefault();
				this.tlSuppressClickUntil = 0;
			}, true);
		}

		if (this.built) this.applyTlView(); // 首帧兜底（zoomLbl 在首次 renderTop 才建，内部已判空）
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
			this.zoomEl.empty();
			this.sumEl.empty();
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

	/** 固定头部：倍率标签（缩放≠100% 时出现、点击复位）+ 筛选输入框 + 刷新按钮（不展示工作目录与小说列表，面板只呈现时间线本身） */
	private renderTop(): void {
		const filterRow = this.topEl.createDiv({ cls: "aw-rel-filter-row" }); // 复用关系面板的头部行布局
		this.zoomLbl = filterRow.createSpan({ text: "", cls: "aw-dim aw-tl-zoomlbl is-hidden", title: "Ctrl|Shift＋滚轮缩放 / 普通滚轮滚动 / 左键拖动平移；点击复位为 100%" });
		this.zoomLbl.addEventListener("click", () => { this.tlZ = 1; this.bodyEl.scrollTo({ left: 0, top: 0 }); this.applyTlView(); });
		const input = filterRow.createEl("input", { type: "text", cls: "aw-rel-filter aw-tl-filter", placeholder: "筛选人物 / 事件…" });
		input.value = this.filterText;
		input.addEventListener("input", () => {
			this.filterText = input.value; // 只重渲染主体区（头部保持不动，输入焦点与光标不丢）
			if (this.lastSnap) this.renderBody(this.lastSnap);
		});
		const btns = filterRow.createSpan({ cls: "aw-st-actions" });
		btns.createEl("button", { text: "刷新" }).addEventListener("click", () => void this.refresh());
		this.applyTlView(); // 头部重建后按当前缩放状态恢复倍率标签显示
	}

	/** 应用画布视图状态：sizer 宽高＝内容×缩放（决定可滚动范围）、transform via CSS var、滚动位置限位、倍率标签 class；setupCanvas / 滚轮缩放 / 点击复位 / 重渲染后共用 */
	private applyTlView(): void {
		const w = this.bodyEl.clientWidth;
		this.zoomEl.style.width = `${String(w)}px`; // 内容布局宽＝视口宽（transform 不影响布局，须显式给定）
		const h = this.zoomEl.clientHeight; // 内容布局高（scale=1 时）
		this.sizerEl.style.width = `${Math.round(w * this.tlZ)}px`;
		this.sizerEl.style.height = `${Math.round(h * this.tlZ)}px`;
		this.zoomEl.style.setProperty("--tl-transform", `scale(${String(this.tlZ)})`); // 通过 CSS var 更新 transform（no-static-styles-assignment）
		const maxX = Math.max(0, this.sizerEl.clientWidth - w);
		const maxY = Math.max(0, this.sizerEl.clientHeight - this.bodyEl.clientHeight);
		if (this.bodyEl.scrollLeft > maxX) this.bodyEl.scrollLeft = maxX; // 缩小时把越界的滚动位置拉回
		if (this.bodyEl.scrollTop > maxY) this.bodyEl.scrollTop = maxY;
		if (!this.zoomLbl) return; // setupCanvas 首帧调用时头部尚未渲染（zoomLbl 在首次 renderTop 创建）
		const pct = Math.round(this.tlZ * 100);
		this.zoomLbl.setText(`${pct}%`);
		this.zoomLbl.toggleClass("is-hidden", pct === 100); // toggle class 替代直接设 style.display
	}

	/** 主体区：单一合并纵向时间轴（时间点升序、每条带来源标签，按级别嵌套成轮廓树；相邻条目间按时间差插比例间隔——90 天内为留白块 .aw-tl-spacer〔基准 5px/天〕、超出压成定高时间跳跃标记 .aw-tl-skip；筛选模式紧凑堆叠）+ 无有效条目文档的格式提示；汇总行固定显示在底部 sumEl（非筛选视图附「跨度」＝最早到最晚总时长）。重渲染只清 zoomEl——缩放/滚动位置/折叠状态保持 */
	private renderBody(snap: TlSnapshot): void {
		this.zoomEl.empty();
		const ph = this.placeholderFor(snap);
		if (ph) {
			this.sumEl.empty();
			this.zoomEl.createDiv({ text: ph, cls: "aw-dim aw-st-hint" });
			this.applyTlView(); // 空态内容尺寸也变了 → 同步 sizer 与滚动限位
			return;
		}
		// 折叠状态按小说隔离：切换当前书时重置，避免上一本书的 id 残留
		const storyKey = snap.activeStory ?? "";
		if (storyKey !== this.lastStoryKey) {
			this.lastStoryKey = storyKey;
			this.collapsedIds.clear();
		}
		const q = this.filterText.trim().toLowerCase();
		const roots = this.buildTree(snap.rows);
		this.tlSpacingOn = q === ""; // 时间比例间距仅非筛选视图（筛选命中稀疏，按真实间隔会拉出荒长空白）
		this.tlPrevMs = null;
		if (q) {
			const matchCount = snap.rows.filter((r) => matchRow(r, q)).length;
			if (!matchCount) {
				this.zoomEl.createDiv({ text: `没有匹配「${this.filterText.trim()}」的时间线条目。`, cls: "aw-dim aw-st-hint" });
			} else {
				const list = this.zoomEl.createDiv({ cls: "aw-tl-list" }); // 纵向时间轴（左侧竖线 + 节点圆点），自上而下按时间点升序
				for (const n of roots) if (this.subtreeHit(n, q)) this.renderNode(list, n, q); // 命中条目连同祖先链展示（忽略折叠状态）
			}
			this.sumEl.setText(`匹配 ${String(matchCount)} 条（共 ${String(snap.totalCount)} 条）`);
		} else {
			const list = this.zoomEl.createDiv({ cls: "aw-tl-list" });
			for (const n of roots) this.renderNode(list, n, "");
			const perScope: Record<TlScope, number> = { book: 0, volume: 0, chapter: 0 };
			for (const r of snap.rows) perScope[r.scope]++;
			let spanTxt = "";
			if (snap.rows.length >= 2) {
				// rows 全局按时间升序 → 末条 − 首条＝最早到最晚的时间总长（缺月日按年初/一号计）
				const days = Math.round((tlEpochMs(snap.rows[snap.rows.length - 1]) - tlEpochMs(snap.rows[0])) / TL_DAY_MS);
				if (days > 0) spanTxt = `｜跨度 ${this.formatTlSpan(days)}`;
			}
			this.sumEl.setText(`共 ${String(snap.totalCount)} 条：书籍级 ${String(perScope.book)} · 卷 ${String(perScope.volume)} · 章 ${String(perScope.chapter)}${spanTxt}`);
		}
		if (snap.unparsedDocs.length) this.renderUnparsed(snap.unparsedDocs);
		this.applyTlView(); // 内容尺寸变化 → 同步 sizer 与滚动限位
	}

	/** 由合并后按时间升序的行列表建轮廓树：每条目的父＝其前最近一条级别更小的条目（跨层统一规则）；无更小级别前驱者为根 */
	private buildTree(rows: TlRow[]): TlNode[] {
		const roots: TlNode[] = [];
		const stack: TlNode[] = [];
		for (const row of rows) {
			const node: TlNode = { row, children: [] };
			while (stack.length && stack[stack.length - 1].row.level >= row.level) stack.pop();
			if (stack.length) stack[stack.length - 1].children.push(node);
			else roots.push(node);
			stack.push(node);
		}
		return roots;
	}

	/** 某节点的全部后代条数（折叠提示用） */
	private descendantCount(node: TlNode): number {
		let n = 0;
		for (const c of node.children) n += 1 + this.descendantCount(c);
		return n;
	}

	/** 筛选模式：该节点自身或任一后代是否命中筛选词（命中则连同祖先链一起展示） */
	private subtreeHit(node: TlNode, q: string): boolean {
		if (matchRow(node.row, q)) return true;
		return node.children.some((c) => this.subtreeHit(c, q));
	}

	/** 切换某条目的折叠状态（圆点点击；仅对有子事件的条目生效） */
	private toggleCollapse(id: string): void {
		if (this.collapsedIds.has(id)) this.collapsedIds.delete(id);
		else this.collapsedIds.add(id);
	}

	/** 时间比例间距：本条目时刻与上一条已渲染条目之差 Δ，在**当前容器内、本条目之前**插入间隔元素，随后更新 tlPrevMs。Δ≤TL_SPACER_MAX_DAYS 天 → `.aw-tl-spacer` 纯留白定高块（按 TL_PX_PER_DAY px/天 换算，list/kids 的竖线自动贯穿——空白即「故事里流逝的时间」）；Δ＞上限 → `.aw-tl-skip` 定高时间跳跃标记块（居中「⋯ 约 N 年 ⋯」小字），防极端跨度的孤立点把画布拉到无法使用。rows 全局按时间升序 → DFS 渲染顺序恒为时间非降序 → Δ≥0；同刻条目不插块自然堆叠；折叠的子树被跳过后其兄弟相对父条目的间隔＝两者真实时差；筛选趟（tlSpacingOn=false）整体跳过保持紧凑布局 */
	private pushTlSpacer(parent: HTMLElement, row: TlRow): void {
		if (!this.tlSpacingOn) return; // 筛选模式紧凑堆叠
		const ms = tlEpochMs(row);
		if (this.tlPrevMs !== null && ms > this.tlPrevMs) {
			const days = (ms - this.tlPrevMs) / TL_DAY_MS;
			if (days > TL_SPACER_MAX_DAYS) {
				parent.createDiv({ cls: "aw-tl-skip" }).createSpan({ text: `⋯ 约 ${String(this.formatTlSpan(Math.round(days)))} ⋯`, cls: "aw-dim aw-tl-skiplbl" });
			} else {
				const px = Math.round(days * TL_PX_PER_DAY);
				if (px > 0) {
					const sp = parent.createDiv({ cls: "aw-tl-spacer" });
					sp.style.height = `${String(px)}px`; // 动态值（与 sizer 宽高同一模式）
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
			return `还没有时间线：在${where}记录——每条事件一个标题块，标题＝时间点（\`年\` / \`年-月\` / \`年-月-日\`，如 \`-129-06-15\`）+ \`- 人物：A、B\` + \`- 事件：…\`；标题深度即事件级别（\`#\`=一级、\`##\`=二级、\`###\`=三级，可更深＝更细的子事件），面板会把三层合并成一条按时间排序的时间轴并按级别嵌套展示。`;
		}
		return null;
	}

	/** 有内容但零有效条目的文档提示行：列出层级标签（可点击打开对应《时间线.md》检查格式） */
	private renderUnparsed(docs: Array<{ label: string; path: string }>): void {
		const line = this.zoomEl.createDiv({ cls: "aw-dim aw-st-hint" });
		line.createSpan({ text: "以下《时间线.md》有内容但没有有效条目（需 #/##/### <时间点> 标题）：" });
		docs.forEach((d, i) => {
			if (i) line.createSpan({ text: "、" });
			const s = line.createSpan({ text: d.label, cls: "aw-tl-unparsed" });
			s.addEventListener("click", () => void this.openFile(d.path));
		});
	}

	/** 渲染一个轮廓节点：条目行 + （未折叠时）子容器 .aw-tl-kids 递归。
	 * 条目带 `lv-<级别>` 类（级别＝标题深度，≥5 归入 lv-5）——圆点大小/颜色与正文强调按级别区分（样式见 styles.css `.aw-tl-item.lv-*`）。
	 * **描述内容（row.desc）只经悬停 Tip 显示、不内联渲染**：desc 非空时用 setTooltip（aria-label 驱动 Obsidian 自绘 .tooltip，可 CSS 定制）给条目与圆点挂同一份 Tip（类 aw-tl-tip，样式见 styles.css）——圆点仅 5–12px，悬停稍有偏差落到条目上也能看到描述；无描述则不挂 Tip。圆点为真实元素 .aw-tl-dot、有子事件时可点击切换折叠状态；**双击**条目在编辑器打开来源文档并定位到该时间点。**拖动更新时间点**（q==="" 时 attachTlDrag 挂载、鼠标左键沿轴上下拖）：整棵子树块实时平移＋浮标提示目标时间，松手写回源《时间线.md》标题行。
	 * 筛选模式（q 非空）显示整条祖先链且忽略折叠状态，保证命中条目可见。
	 * 渲染顺序即文档流＝时间升序：每条先经 pushTlSpacer 按与上一条的时间差插比例间隔块，再建条目行（跨嵌套容器边界同样成立——间隔块始终插在**当前条目所在容器**内、该条目之前） */
	private renderNode(parent: HTMLElement, node: TlNode, q: string): void {
		const row = node.row;
		this.pushTlSpacer(parent, row); // 时间比例间距（筛选趟/首条为 no-op）
		const item = parent.createDiv({ cls: `aw-tl-item lv-${String(Math.min(row.level, 5))}` });
		const dot = item.createSpan({ cls: "aw-tl-dot" }); // 节点圆点（替代旧 ::before 伪元素，可点击）
		if (node.children.length) {
			dot.addClass("has-kids");
			dot.addEventListener("click", () => {
				this.toggleCollapse(row.id);
				if (this.lastSnap) this.renderBody(this.lastSnap);
			});
		}
		if (row.desc) {
			// 描述内容只经悬停 Tip 显示（不内联）：条目与圆点同挂一份——圆点仅 5–12px，悬停稍有偏差即落到条目上，两处一致保证看到的都是描述；无描述则不挂 Tip
			setTooltip(item, row.desc, { classes: ["aw-tl-tip"] });
			setTooltip(dot, row.desc, { classes: ["aw-tl-tip"] });
		}
		item.createSpan({ text: timelineTimeText(row), cls: "aw-tl-time" });
		if (row.sourceLabel) item.createSpan({ text: row.sourceLabel, cls: "aw-dim aw-tl-src" });
		const wrap = item.createDiv({ cls: "aw-tl-evwrap" });
		if (row.chars.length) {
			const chars = wrap.createDiv({ cls: "aw-tl-chars" });
			for (const c of row.chars) chars.createSpan({ text: c, cls: "aw-tl-char" });
		}
		if (row.event) wrap.createDiv({ text: row.event, cls: "aw-tl-event" });
		else if (!row.chars.length) wrap.createDiv({ text: "（未填写事件与人物）", cls: "aw-dim aw-st-hint" });
		item.addEventListener("dblclick", () => void this.openAt(row)); // 双击定位功能保留；提示文字不再占用 Tip（Tip 专显描述内容）
		if (q === "") this.attachTlDrag(item, row); // 拖动更新时间点仅非筛选比例视图（筛选紧凑布局下位移无比例语义）
		if (node.children.length) {
			if (q === "" && this.collapsedIds.has(row.id)) {
				item.createSpan({ text: `（已折叠 ${String(this.descendantCount(node))} 条子事件）`, cls: "aw-dim aw-tl-collapsed-hint" });
			} else {
				const kids = parent.createDiv({ cls: "aw-tl-kids" }); // 子事件容器：再缩进一级 + 自己的竖线
				for (const c of node.children) {
					if (q === "" || this.subtreeHit(c, q)) this.renderNode(kids, c, q);
				}
			}
		}
	}

	/** 给条目行挂「拖动更新时间点」手势（仅非筛选比例视图调用）：左键按下起候选、pointermove 越过 5px 阈值才激活（未越界＝普通点击/双击，语义不受影响），期间整棵子树块随光标平移＋浮标提示目标时间与增减天数；松手 Δ≠0 时写回源文档。stopPropagation 使本手势优先于画布平移（bodyEl pointerdown）独占 */
	private attachTlDrag(item: HTMLElement, row: TlRow): void {
		item.addClass("aw-tl-movable"); // grab 光标提示（样式见 styles.css）
		item.addEventListener("pointerdown", (ev: PointerEvent) => {
			if (ev.button !== 0 || ev.pointerType !== "mouse") return; // 只响应鼠标左键（触屏保持原生滚动手势）
			ev.stopPropagation(); // 拦掉画布平移对本手势的接管
			ev.preventDefault(); // 不触发文字选中等副作用
			this.tlDrag = { row, startY: ev.clientY, els: [item], badge: item.querySelector<HTMLElement>(".aw-tl-time") ?? null };
			const kids = item.nextElementSibling; // 紧随其后的子事件容器（renderNode 顺序构建）一并位移 → 整棵子树同移
			if (kids instanceof HTMLElement && kids.classList.contains("aw-tl-kids")) this.tlDrag.els.push(kids);
			this.tlDragLive = false;
			this.tlDragDd = 0;
			document.addEventListener("pointermove", this.onTlDragMove);
			document.addEventListener("pointerup", this.endTlDrag);
			document.addEventListener("pointercancel", this.endTlDrag);
		});
	}

	/** 拖动移动：屏幕位移÷画布缩放→布局 px，再按基准比例尺 TL_PX_PER_DAY 换算 Δ 天。未越阈值不动作；激活后对子树块各元素施加 translateY＋更新浮标（目标时间±天数） */
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
		const dyLayout = dyScreen / this.tlZ; // 屏幕 px → 画布局部 px（zoomEl transform scale＝tlZ）
		this.tlDragDd = Math.round(dyLayout / TL_PX_PER_DAY);
		const ty = `translateY(${String(Math.round(dyLayout))}px)`; // 动态值（与 spacer 高度/sizer 宽高同一模式）
		d.els.forEach((el) => { el.style.transform = ty; });
		const np = this.shiftTlPoint(d.row, this.tlDragDd);
		d.badge?.setText(timelineTimeText(np)); // 条目自身时间徽章立即变为目标时间点（松手还原；写回成功后 refresh 重建布局）
		if (this.tlDragLbl) {
			this.tlDragLbl.setText(`${this.tlDragDd > 0 ? "+" : ""}${String(this.tlDragDd)} 天`); // 浮标只给天数差——新日期已由徽章实时显示，不重复
			this.tlDragLbl.style.left = `${String(ev.clientX + 14)}px`;
			this.tlDragLbl.style.top = `${String(ev.clientY - 30)}px`;
		}
	};

	/** 拖动结束：摘监听、移除浮标、复位样式；有效拖拽且 Δ≠0 → 写回源文档，Δ=0 → 原地还原 */
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
		this.tlSuppressClickUntil = Date.now() + 400; // 吞掉紧随的 click/dblclick（zoomEl 捕获阶段判定）
		d.els.forEach((el) => { el.style.transform = ""; }); // 拖动中的平移只是手势预览：一律先还原——Δ≠0 且写回成功后由 refresh 按新间隔重建布局；Δ==0 或写回失败则保持原位不留残影
		d.badge?.setText(timelineTimeText(d.row)); // 徽章同步还原原值（写回成功时 refresh 会整体重建，此处保证失败路径显示正确）
		const dd = this.tlDragDd;
		this.tlDragDd = 0;
		if (dd !== 0) void this.commitTlMove(d.row, dd);
	};

	/** 拖动 Δ天数 → 新时间点（保持原条目精度）：含日→按天日期运算；只含月→按 ~30.44 天/月吸附到月（月份索引算术，负年份分解正确）；纯年份→按 365 天取整 */
	private shiftTlPoint(r: TlRow, dd: number): TimelinePoint {
		if (r.day != null) {
			const dt = new Date(tlEpochMs(r) + dd * TL_DAY_MS);
			return { time: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
		}
		if (r.month != null) {
			const nIdx = Math.trunc(r.time) * 12 + (r.month - 1) + Math.round(dd / 30.4375);
			return { time: Math.floor(nIdx / 12), month: ((nIdx % 12) + 12) % 12 + 1 }; // floor/mod 分解对负年份同样成立
		}
		return { time: r.time + Math.round(dd / 365) };
	}

	/** 拖后写回源《时间线.md》标题行：原文经「注释掩码＋srcHeading 全文匹配＋出现序号」定位、旧值反解校验通过才替换（rewriteTimelineEntryTime）；成功 Notice＋立即重渲染（vault modify 事件的防抖刷新兜底，busy 标志去重）。任一环节不满足 → 放弃并提示刷新重试 */
	private async commitTlMove(row: TlRow, dd: number): Promise<void> {
		if (!row.srcHeading || row.srcOrdinal == null) { new Notice("该条目缺少来源定位信息，请先点「刷新」再拖动"); return; }
		const np = this.shiftTlPoint(row, dd);
		const f = this.app.vault.getAbstractFileByPath(row.sourcePath);
		if (!(f instanceof TFile)) { new Notice(`未找到来源文档：${row.sourcePath}`); return; }
		let text: string;
		try { text = await this.app.vault.adapter.read(f.path); } catch (e) { new Notice(`读取来源文档失败：${e instanceof Error ? e.message : String(e)}`); return; }
		const newText = rewriteTimelineEntryTime(text, row.srcHeading, row.srcOrdinal, { time: row.time, month: row.month, day: row.day }, np);
		if (newText === null) { new Notice("写回失败：源文档自面板加载后可能已变化，请点「刷新」后再拖"); return; }
		try { await this.app.vault.adapter.write(f.path, newText); } catch (e) { new Notice(`写入《时间线.md》失败：${e instanceof Error ? e.message : String(e)}`); return; }
		new Notice(`已将「${(row.event || "").split("\n")[0] || timelineTimeText(np)}」移至 ${timelineTimeText(np)}（${row.sourceLabel}）`);
		void this.refresh(); // 立即重渲染；vault modify 事件还会触发防抖刷新——双保险
	}

	/** 双击条目：在编辑器打开来源《时间线.md》并滚动定位到该事件的 ## 标题行 */
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
						const p = parseTimelineTime(m[2]);
						return !!p && p.time === row.time && (p.month ?? 0) === (row.month ?? 0) && (p.day ?? 0) === (row.day ?? 0);
					});
				const idx = findIdx(true) >= 0 ? findIdx(true) : findIdx(false);
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
