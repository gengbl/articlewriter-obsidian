// v0.3.1+：面板画布通用交互设施——时间线面板与事件树面板共用（自 timeline_view 的 setupCanvas/applyTlView 抽出）。
// 结构：bodyEl（overflow:auto 画布容器，原生滚动）→ sizerEl（宽高＝内容×缩放，撑出可滚动范围）→ zoomEl（内容载体，绝对定位＋transform scale，重渲染只清空它）。

export const PANEL_ZOOM_MIN = 0.4; // 画布缩放上下限（同关系面板图面量级，防缩到看不见/大到无意义）
export const PANEL_ZOOM_MAX = 3;

export const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** **「适应全图」的纯算法**（v0.4.9+，node 可测）：把内容矩形 `rect` 装进视口 `vw×vh`（四周留 `pad`）→ 倍率＋虚拟平移偏移。
 *  倍率＝min((vw−2pad)/w, (vh−2pad)/h) 再夹到 `[lo, min(hi,1)]`＝**只缩小不放大**（内容比视口小＝100% 居中，不糊卡片）；
 *  偏移＝包围盒缩放后中心对齐聚中（`pan＝(视口−内容·z)/2 − rect 起点·z`），口径与 `CanvasPanel.toContentPoint` 一致（scroll 取 0）。
 *  尺寸异常（0/NaN/负）＝返回 null，调用方应保持当前视图不动 */
export function fitZoomTo(
	rect: { x: number; y: number; w: number; h: number },
	vw: number,
	vh: number,
	pad: number,
	lo: number,
	hi: number,
): { zoom: number; panX: number; panY: number } | null {
	if (!Number.isFinite(rect.w) || !Number.isFinite(rect.h) || rect.w <= 0 || rect.h <= 0) return null;
	if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return null;
	const z = clampNum(Math.min((vw - pad * 2) / rect.w, (vh - pad * 2) / rect.h), lo, Math.min(hi, 1));
	return { zoom: z, panX: (vw - rect.w * z) / 2 - rect.x * z, panY: (vh - rect.h * z) / 2 - rect.y * z };
}

/** **以屏幕点（＝鼠标所在位置）为中心缩放的纯算法**（v0.4.9+，node 可测）
 *  口径：屏幕映射 `m＝pan＋p·z−scroll`，记**虚拟偏移** `v＝pan−scroll`（⇒ `m＝p·z＋v`，与缩放倍率无关）。
 *  锚点＝鼠标下的内容点 `p`（由 `toContentPoint` 换算），鼠标偏移 `m` **钳进视口** `[0,vw]×[0,vh]`（坐标离谱＝以画面边内一点缩放，不把内容甩飞）。
 *  保持锚点不动 ⇒ 新虚拟偏移 **`v′＝m−p·z′`**（⚠️ 必须从虚拟偏移出发：只按「目标 scroll＝pan＋p·z′−m」补差＝**把缩放前的滚动量当 0**，
 *  视图已滚过时缩放中心会整体偏掉一截——v0.4.9 实测就是这个坑）。
 *  落回两个通道：`scroll′＝clamp(pan−v′, 0, max)`（DOM 只接受 0..max），**余量不够的部分由虚拟平移层补差** `pan′＝v′＋scroll′`。
 *  不变量（`panel_canvas.test.ts` 逐档断言）：`pan′＋p·z′−scroll′ ≡ m(钳后)` 且 `0 ≤ scroll′ ≤ max` */
export function zoomAtPointView(
	p: { x: number; y: number },
	mx: number,
	my: number,
	nz: number,
	panX: number,
	panY: number,
	scrollLeft: number,
	scrollTop: number,
	maxX: number,
	maxY: number,
	vw: number,
	vh: number,
): { panX: number; panY: number; scrollLeft: number; scrollTop: number } {
	const ax = clampNum(mx, 0, Math.max(0, vw));
	const ay = clampNum(my, 0, Math.max(0, vh));
	const vx = ax - p.x * nz;
	const vy = ay - p.y * nz;
	const sl = clampNum(panX - vx, 0, Math.max(0, maxX));
	const st = clampNum(panY - vy, 0, Math.max(0, maxY));
	return { panX: vx + sl, panY: vy + st, scrollLeft: sl, scrollTop: st };
}

/** **元素尺寸跟随的共用实现**（v0.4.9+ 从 CanvasPanel 抽出＝画布面板与人物关系面板图面共用一份口径）：
 *  ResizeObserver 观察元素（面板拖宽/分屏/窗口缩放/移动端抽屉开合都命中，比 ItemView.onResize 可靠——后者在部分分屏场景不触发），
 *  **防抖 120ms**（连续拖动只处理最后一帧）；首帧 0 宽/0 高（面板尚未展开、布局未就绪）不回调。
 *  回调收 `{width, height, widthChanged}`：`widthChanged`＝宽度**真的**变了（调用方据此才重排内容/重渲染）；纯高度变化＝只需重算尺寸与可滚/可拖限位。
 *  返回观察器句柄：`dispose()`（视图关闭时必须调，观察器会持有已移除的 DOM 引用）＋`notify()`（**手动催一次同一套防抖测量**＝
 *  ItemView.onResize 的兜底入口，也是无 ResizeObserver 环境里唯一的触发路径）。 */
export interface ElementSizeWatcher {
	dispose(): void;
	notify(): void;
}

export function watchElementSize(
	el: HTMLElement,
	onSize: (s: { width: number; height: number; widthChanged: boolean }) => void,
): ElementSizeWatcher {
	let timer: number | null = null;
	let lastW = 0;
	const measure = (): void => {
		timer = null;
		const w = el.clientWidth;
		const h = el.clientHeight;
		if (w <= 0 || h <= 0) return;
		const widthChanged = w !== lastW;
		lastW = w;
		onSize({ width: w, height: h, widthChanged });
	};
	const schedule = (): void => {
		if (timer != null) window.clearTimeout(timer);
		timer = window.setTimeout(measure, 120);
	};
	const obs = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
	obs?.observe(el);
	return {
		dispose: () => {
			obs?.disconnect();
			if (timer != null) window.clearTimeout(timer);
			timer = null;
		},
		notify: schedule,
	};
}

/** CanvasPanel 构造参数：三层元素的样式类与 transform 的 CSS 变量名（各面板配色/尺寸独立，行为完全一致） */
/** 视口内偏移（CSS px，相对**视口左上角**）→ **内容坐标系**（＝卡片 `left/top`、场景 `- 位置：x,y` 所用坐标）。
 *  口径与 `CanvasPanel.toContentPoint` 完全一致＝`(scroll + 偏移 − pan)/z`（v0.4.9+ 抽出共用＝
 *  新建场景默认落点「视口左上角 +(50,50)」与空白处右键落点走同一换算；`zoom<=0` 按 1 兜底） */
export function viewPointToContent(
	v: { scrollLeft: number; scrollTop: number; panX: number; panY: number; zoom: number },
	offX: number,
	offY: number,
): { x: number; y: number } {
	const z = v.zoom > 0 ? v.zoom : 1;
	return { x: (v.scrollLeft + offX - v.panX) / z, y: (v.scrollTop + offY - v.panY) / z };
}

export interface CanvasPanelOptions {
	bodyCls: string; // 画布容器类（须含 overflow 布局，如 "aw-st-tree aw-tl-body"）
	sizerCls: string;
	zoomCls: string;
	zoomVar: string; // transform 经此 CSS 变量更新（no-static-styles-assignment 合规）
	zoomLabelCls?: string; // 头部倍率标签类（attachZoomLabel 用）
	zoomLabelTitle?: string; // 倍率标签悬停提示
	min?: number;
	max?: number;
	/** v0.4.3+：画布容器尺寸变化（拖侧栏 / 分屏 / 窗口缩放 / 移动端抽屉）回调——CanvasPanel 已先 apply() 重算画布尺寸，
	 *  调用方在此按新宽度重渲染内容（宽度变化会改变换行、层级列坐标等）；缺省＝只重算画布尺寸不重渲染内容 */
	onResize?: () => void;
}

/** 缩放/平移画布：Ctrl|Shift＋滚轮以鼠标位置为不动点缩放（普通滚轮不拦截、走原生滚动）、左键按住拖动平移（滚动余量内驱动容器滚动、到底后由虚拟平移层继续挪动——内容不超出面板也能挪视野；Alt＋左键/中键＝任意位置平移）、倍率标签点击复位；拖拽后的紧随 click/dblclick 自动吞掉（平移与条目拖拽两种来源） */
export class CanvasPanel {
	readonly bodyEl: HTMLElement;
	readonly sizerEl: HTMLElement;
	readonly panEl: HTMLElement; // v0.4.7+ 虚拟平移层（translate CSS 变量；sizer 与 zoom 之间）
	readonly zoomEl: HTMLElement;

	private zoomLevel = 1; // 缩放倍率（重渲染不清零——筛选切换后视野保持）
	private panX = 0; // 虚拟平移偏移（布局 px，独立于缩放；滚动余量用尽后由拖动继续累加——无滚动条也挪得动视野）
	private panY = 0;
	private zoomLbl: HTMLElement | null = null; // 头部倍率标签（==100% 时隐藏，点击复位）
	private suppressClickUntil = 0; // 条目拖拽结束后需吞掉紧随 click/dblclick 的时间戳上限
	private sizeWatcher: ElementSizeWatcher | null = null; // v0.4.9+ 尺寸观察句柄（共用 watchElementSize；dispose 断开、notify＝ItemView.onResize 兜底）
	private contentW = 0; // 内容真实宽（0＝按视口宽；场景画布等绝对定位内容用它撑出横向可滚动/可拖动范围）

	constructor(parent: HTMLElement, private readonly opts: CanvasPanelOptions) {
		this.bodyEl = parent.createDiv({ cls: opts.bodyCls });
		this.sizerEl = this.bodyEl.createDiv({ cls: opts.sizerCls });
		this.panEl = this.sizerEl.createDiv({ cls: "aw-canvas-pan" });
		this.zoomEl = this.panEl.createDiv({ cls: opts.zoomCls });
		this.setupCanvas();
		this.watchResize(); // v0.4.3+：容器尺寸变化（拖侧栏/分屏/窗口缩放）→ 重算画布尺寸并按需回调视图重渲染
	}

	get zoom(): number {
		return this.zoomLevel;
	}

	/** 头部挂倍率标签（每次头部重建都可重挂；旧标签随头部清空自然废弃） */
	attachZoomLabel(container: HTMLElement): void {
		this.zoomLbl = container.createSpan({ text: "", cls: this.opts.zoomLabelCls ?? "aw-dim aw-panel-zoomlbl", title: this.opts.zoomLabelTitle ?? "Ctrl|Shift＋滚轮缩放 / 普通滚轮滚动 / 左键拖动平移（Alt＋左键或中键＝任意位置平移）；点击复位为 100%" });
		this.zoomLbl.addEventListener("click", () => {
			this.zoomLevel = 1;
			this.panX = 0; // 虚拟平移一并复位（标签＝「复位视图」而不是只复位倍率）
			this.panY = 0;
			this.bodyEl.scrollTo({ left: 0, top: 0 });
			this.apply();
		});
		this.apply(); // 头部重建后按当前缩放状态恢复倍率标签显示
	}

	/** 吞掉紧随条目拖拽松手的 click/dblclick（否则拖完会误开文档/误切折叠；zoomEl 捕获阶段判定） */
	suppressClicks(delayMs = 400): void {
		this.suppressClickUntil = Date.now() + delayMs;
	}

	/** 场景画布等**绝对定位内容**的真实内容宽：>视口宽时 sizer 撑出横向可滚动/可拖动范围（v0.4.7+，否则最右侧卡片与包含框拖不出去也滚不到）。0＝恢复「宽＝视口宽」旧行为 */
	setContentWidth(w: number): void {
		this.contentW = Number.isFinite(w) && w > 0 ? w : 0;
		this.apply();
	}

	/** 当前视图状态（滚动＋虚拟平移＋倍率）＝`viewPointToContent` 的输入（v0.4.9+ 抽出＝三个换算入口共用同一口径） */
	private viewState(): { scrollLeft: number; scrollTop: number; panX: number; panY: number; zoom: number } {
		return { scrollLeft: this.bodyEl.scrollLeft, scrollTop: this.bodyEl.scrollTop, panX: this.panX, panY: this.panY, zoom: this.zoomLevel };
	}

	/** 屏幕点（clientX/clientY）→ **内容坐标系**（＝卡片 `left/top`、场景 `- 位置：x,y` 所用的坐标）：
	 *  同一口径换算＝p＝(scroll + m − pan)/z（与滚轮缩放不动点公式一致，v0.4.9+ 抽出共用＝空白处右键「在此添加场景」的落点） */
	toContentPoint(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.bodyEl.getBoundingClientRect();
		return viewPointToContent(this.viewState(), clientX - rect.left, clientY - rect.top);
	}

	/** **视口左上角 +(offX,offY)**（CSS px）处的内容坐标（v0.4.9+ 用户要求＝新建场景落在当前视口左上角 (50,50) 处） */
	viewPoint(offX: number, offY: number): { x: number; y: number } {
		return viewPointToContent(this.viewState(), offX, offY);
	}

	/** **适应全图**（v0.4.9+）：把内容坐标矩形（＝卡片/内容包围盒）缩放＋平移到「视口刚好包住它」——
	 *  倍率与偏移由纯函数 `fitZoomTo` 算（node 可测）；偏移走虚拟平移层（z≤1 时 `apply()` 把滚动限位成 0，居中只能靠 pan）；
	 *  换算口径同 `toContentPoint`（m＝pan＋p·z−scroll，取 scroll 归零）。
	 *  返回生效倍率；内容/视口尺寸异常＝返回 null 且不动视图 */
	fitToRect(rect: { x: number; y: number; w: number; h: number }, pad: number = 14): number | null {
		const fit = fitZoomTo(rect, this.bodyEl.clientWidth, this.bodyEl.clientHeight, pad, this.opts.min ?? PANEL_ZOOM_MIN, Math.min(this.opts.max ?? PANEL_ZOOM_MAX, 1)); // 适应＝只缩小不放大多余
		if (!fit) return null;
		this.zoomLevel = fit.zoom;
		this.panX = fit.panX;
		this.panY = fit.panY;
		this.bodyEl.scrollTo({ left: 0, top: 0 });
		this.apply();
		return fit.zoom;
	}

	/** 应用画布视图状态：sizer 宽高＝内容×缩放（决定可滚动范围）、transform via CSS var、滚动位置限位、倍率标签 class；构造 / 滚轮缩放 / 点击复位 / 重渲染后共用 */
	apply(): void {
		const w = Math.max(this.bodyEl.clientWidth, this.contentW); // v0.4.7+：内容宽（setContentWidth）大于视口时按内容宽撑开
		this.zoomEl.style.width = `${String(w)}px`; // 内容布局宽（transform 不影响布局，须显式给定）
		const h = this.zoomEl.clientHeight; // 内容布局高（scale=1 时）
		this.sizerEl.style.width = `${Math.round(w * this.zoomLevel)}px`;
		this.sizerEl.style.height = `${Math.round(h * this.zoomLevel)}px`;
		this.zoomEl.style.setProperty(this.opts.zoomVar, `scale(${String(this.zoomLevel)})`);
		// v0.4.7+ 虚拟平移层：translate（布局 px，独立于缩放，加在 scale 之外）——无滚动余量时拖动视野也能挪动。
		// 变量用固定名设在 panEl 自身（每面板一个 panEl，互不冲突；CSS 只需认这一对名字）
		this.panEl.style.setProperty("--aw-canvas-pan-x", `${String(this.panX)}px`);
		this.panEl.style.setProperty("--aw-canvas-pan-y", `${String(this.panY)}px`);
		// 滚动余量口径唯一来源＝maxScrollX/Y（v0.4.9+ 修正：减**视口宽**、不是内容布局宽——
		// 此前写成减 w，场景画布 contentW>视口时 z=1 也算出 maxX=0＝横向原生滚动条/滚轮完全滚不动最右侧卡片，只能靠平移层拖）
		const maxX = this.maxScrollX();
		const maxY = this.maxScrollY();
		if (this.bodyEl.scrollLeft > maxX) this.bodyEl.scrollLeft = maxX; // 缩小时把越界的滚动位置拉回
		if (this.bodyEl.scrollTop > maxY) this.bodyEl.scrollTop = maxY;
		if (!this.zoomLbl) return; // 头部尚未渲染时跳过标签更新
		const pct = Math.round(this.zoomLevel * 100);
		this.zoomLbl.setText(`${pct}%`);
		this.zoomLbl.toggleClass("is-hidden", pct === 100); // toggle class 替代直接设 style.display
	}

	/** v0.4.3+：观察画布容器尺寸（面板拖宽/分屏/窗口缩放/移动端抽屉开合）——观察与防抖口径见共用的 `watchElementSize`（人物关系面板图面也用同一份） */
	private watchResize(): void {
		this.sizeWatcher = watchElementSize(this.bodyEl, ({ widthChanged }) => {
			this.apply(); // zoomEl 布局宽 / sizer 内容×缩放 / 滚动限位都依赖容器宽高，必须先重算
			if (widthChanged) this.opts.onResize?.(); // 宽度变化才需要重渲染内容（纯高度变化 apply 已足够）
		});
	}

	/** 视图关闭时调用：断开尺寸观察器并清防抖定时器（观察器会持有已移除的 DOM 引用） */
	dispose(): void {
		this.sizeWatcher?.dispose();
		this.sizeWatcher = null;
	}

	/** v0.4.9+ 外部（`ItemView.onResize`）告知「容器尺寸可能变了」＝与观察器同一套防抖测量与处理（无 ResizeObserver 环境里这是唯一路径） */
	notifyResize(): void {
		this.sizeWatcher?.notify();
	}

	/** **缩放余量上限**（v0.4.9+ 抽出＝三处共用一个口径）：sizer（内容×缩放）− **视口宽**。
	 *  注意减的是视口宽、**不是内容布局宽**：场景画布 `contentW > 视口` 时若减布局宽，z=1 也算出 0＝横向根本滚不动 */
	private maxScrollX(): number {
		return Math.max(0, this.sizerEl.clientWidth - this.bodyEl.clientWidth);
	}

	private maxScrollY(): number {
		return Math.max(0, this.sizerEl.clientHeight - this.bodyEl.clientHeight);
	}

	/** **以屏幕点（鼠标）为中心缩放**（v0.4.9+，滚轮与任何缩放入口共用）：算法见 `zoomAtPointView`；
	 *  先 `apply()` 撑出新倍率的 sizer，才知道滚动余量的上下限 */
	private zoomAtPoint(p: { x: number; y: number }, mx: number, my: number, nz: number): void {
		const sl = this.bodyEl.scrollLeft; // 缩放前的滚动量也要进算法（＝虚拟偏移 v＝pan−scroll）
		const st = this.bodyEl.scrollTop;
		this.zoomLevel = nz;
		this.apply(); // 先把 sizer 撑成新倍率的尺寸，滚动余量上下限才算得准
		const v = zoomAtPointView(p, mx, my, nz, this.panX, this.panY, sl, st, this.maxScrollX(), this.maxScrollY(), this.bodyEl.clientWidth, this.bodyEl.clientHeight);
		this.panX = v.panX;
		this.panY = v.panY;
		this.bodyEl.scrollLeft = v.scrollLeft;
		this.bodyEl.scrollTop = v.scrollTop;
		this.apply();
	}

	/** 画布交互（建 UI 时挂一次，元素常驻不随 render 重建） */
	private setupCanvas(): void {
		const lo = this.opts.min ?? PANEL_ZOOM_MIN;
		const hi = this.opts.max ?? PANEL_ZOOM_MAX;
		this.bodyEl.addEventListener("wheel", (ev: WheelEvent) => {
			if (!ev.ctrlKey && !ev.shiftKey) return; // 未按修饰键：不 preventDefault，普通滚轮原生滚动内容/页面
			ev.preventDefault(); // 拦截 Ctrl|Shift+滚轮（浏览器默认 Ctrl+滚轮是页面级缩放，这里改为画布内缩放）
			const d = ev.deltaMode === 1 ? ev.deltaY * 32 : ev.deltaY; // 行模式换算成像素量级
			const nz = clampNum(this.zoomLevel * Math.exp(-d * 0.0015), lo, hi);
			if (nz === this.zoomLevel) return;
			const rect = this.bodyEl.getBoundingClientRect();
			const p = this.toContentPoint(ev.clientX, ev.clientY); // 鼠标处的内容坐标（同一换算口径）
			this.zoomAtPoint(p, ev.clientX - rect.left, ev.clientY - rect.top, nz);
		}, { passive: false });

		let dragFrom: { x: number; y: number; sl: number; st: number; px: number; py: number } | null = null;
		let dragged = false; // 本次手势是否真的拖过：用于吃掉松手时紧随的 click/dblclick，避免拖完误打开文档/误切折叠
		// v0.4.7+：中键＝平移（绘图软件习惯）；普通左键照旧＝空白处平移（卡片/包含框/连线各自 stopPropagation 独占自己的手势，能冒泡到 bodyEl 的必是空白处）。
		// Alt＋左键＝任意位置平移：卡片/框的手势遇 altKey 直接让位不 stopPropagation（画布热区被框占满时，按住 Alt 从卡片上就能平移视野）
		const wantsPan = (ev: PointerEvent): boolean => ev.button === 1 || ev.button === 0;
		const onDragMove = (ev: PointerEvent): void => {
			if (!dragFrom) return;
			// v0.4.7+ 混合平移：滚动余量内驱动容器滚动（与滚轮/滚动条/触屏同一套），到底后剩余量转入虚拟平移层（panEl translate）——内容不超出面板也能挪整个视野
			const maxX = this.maxScrollX(); // 口径唯一来源＝maxScrollX/Y（v0.4.9+：减视口宽，原减内容布局宽＝场景画布 z=1 也滚不动）
			const maxY = this.maxScrollY();
			const wantL = dragFrom.sl - (ev.clientX - dragFrom.x);
			const wantT = dragFrom.st - (ev.clientY - dragFrom.y);
			this.bodyEl.scrollLeft = clampNum(wantL, 0, maxX);
			this.bodyEl.scrollTop = clampNum(wantT, 0, maxY);
			// 屏幕位移＝pan − scroll：滚动用不尽的残差要**取反**补给 pan（scroll 多滚＝内容左移，translate 正值＝内容右移）
			this.panX = dragFrom.px - (wantL - this.bodyEl.scrollLeft);
			this.panY = dragFrom.py - (wantT - this.bodyEl.scrollTop);
			this.apply();
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
			document.removeEventListener("pointercancel", endDrag);
			window.setTimeout(() => { dragged = false; }, 0); // 等紧随其后的 click 先被拦下再复位
		};
		this.bodyEl.addEventListener("pointerdown", (ev: PointerEvent) => {
			if (!wantsPan(ev)) return; // 左键/中键都可起手；卡片/框手势已 stopPropagation，冒泡到这里＝空白处或 Alt 让位
			dragFrom = { x: ev.clientX, y: ev.clientY, sl: this.bodyEl.scrollLeft, st: this.bodyEl.scrollTop, px: this.panX, py: this.panY };
			dragged = false;
			document.addEventListener("pointermove", onDragMove);
			document.addEventListener("pointerup", endDrag);
			document.addEventListener("pointercancel", endDrag); // v0.4.7+：取消事件也收尾，防 dragFrom 残留导致后续裸 pointermove 继续拽视野
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
				if (Date.now() > this.suppressClickUntil) return; // 最近没有有效条目拖拽 → 正常放行
				ev.stopPropagation(); // 吞掉拖动紧随的 click/dblclick（否则拖完会误开文档/误切折叠）
				ev.preventDefault();
				this.suppressClickUntil = 0;
			}, true);
		}

		this.apply(); // 首帧兜底（zoomLbl 未挂时 apply 内部已判空）
	}
}
