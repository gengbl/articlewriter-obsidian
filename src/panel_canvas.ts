// v0.3.1+：面板画布通用交互设施——时间线面板与事件树面板共用（自 timeline_view 的 setupCanvas/applyTlView 抽出）。
// 结构：bodyEl（overflow:auto 画布容器，原生滚动）→ sizerEl（宽高＝内容×缩放，撑出可滚动范围）→ zoomEl（内容载体，绝对定位＋transform scale，重渲染只清空它）。

export const PANEL_ZOOM_MIN = 0.4; // 画布缩放上下限（同关系面板图面量级，防缩到看不见/大到无意义）
export const PANEL_ZOOM_MAX = 3;

export const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** CanvasPanel 构造参数：三层元素的样式类与 transform 的 CSS 变量名（各面板配色/尺寸独立，行为完全一致） */
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
	private resizeObs: ResizeObserver | null = null; // v0.4.3+：画布容器尺寸观察器（撑满布局后宽度变化即重算尺寸）
	private resizeTimer: number | null = null; // 尺寸变化防抖定时器（连续拖动只处理最后一帧）
	private lastBoxW = 0; // 上次处理时的容器宽（宽度真变化才回调 onResize 重渲染内容）
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
		const maxX = Math.max(0, this.sizerEl.clientWidth - w);
		const maxY = Math.max(0, this.sizerEl.clientHeight - this.bodyEl.clientHeight);
		if (this.bodyEl.scrollLeft > maxX) this.bodyEl.scrollLeft = maxX; // 缩小时把越界的滚动位置拉回
		if (this.bodyEl.scrollTop > maxY) this.bodyEl.scrollTop = maxY;
		if (!this.zoomLbl) return; // 头部尚未渲染时跳过标签更新
		const pct = Math.round(this.zoomLevel * 100);
		this.zoomLbl.setText(`${pct}%`);
		this.zoomLbl.toggleClass("is-hidden", pct === 100); // toggle class 替代直接设 style.display
	}

	/** v0.4.3+：观察画布容器尺寸（面板拖宽/分屏/窗口缩放/移动端抽屉开合）——ResizeObserver 比 ItemView.onResize 可靠（后者在部分分屏场景不触发） */
	private watchResize(): void {
		if (typeof ResizeObserver === "undefined") return; // 环境无观察器：退回视图自身 onResize 兜底
		this.resizeObs = new ResizeObserver(() => this.onBoxResize());
		this.resizeObs.observe(this.bodyEl);
	}

	/** 尺寸变化处理：防抖 120ms（连续拖侧栏只算最后一帧）→ 先 apply() 对齐画布尺寸，宽度真变化再回调视图重渲染内容 */
	private onBoxResize(): void {
		if (this.resizeTimer != null) window.clearTimeout(this.resizeTimer);
		this.resizeTimer = window.setTimeout(() => {
			this.resizeTimer = null;
			const w = this.bodyEl.clientWidth;
			if (w <= 0) return; // 面板未展开/布局未就绪（观察器首帧常见 0 宽）
			const widthChanged = w !== this.lastBoxW;
			this.lastBoxW = w;
			this.apply(); // zoomEl 布局宽 / sizer 内容×缩放 / 滚动限位都依赖容器宽高，必须先重算
			if (widthChanged) this.opts.onResize?.(); // 宽度变化才需要重渲染内容（纯高度变化 apply 已足够）
		}, 120);
	}

	/** 视图关闭时调用：断开尺寸观察器并清防抖定时器（观察器会持有已移除的 DOM 引用） */
	dispose(): void {
		this.resizeObs?.disconnect();
		this.resizeObs = null;
		if (this.resizeTimer != null) {
			window.clearTimeout(this.resizeTimer);
			this.resizeTimer = null;
		}
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
			// 以鼠标位置为不动点：屏幕点 m＝pan＋p·z−scroll（v0.4.7+ 含虚拟平移层）→ p＝(m+scroll−pan)/z，缩放后 scroll′＝pan＋p·z′−m
			const rect = this.bodyEl.getBoundingClientRect();
			const mx = ev.clientX - rect.left;
			const my = ev.clientY - rect.top;
			const px = (this.bodyEl.scrollLeft + mx - this.panX) / this.zoomLevel;
			const py = (this.bodyEl.scrollTop + my - this.panY) / this.zoomLevel;
			this.zoomLevel = nz;
			this.bodyEl.scrollLeft = this.panX + px * nz - mx;
			this.bodyEl.scrollTop = this.panY + py * nz - my;
			this.apply();
		}, { passive: false });

		let dragFrom: { x: number; y: number; sl: number; st: number; px: number; py: number } | null = null;
		let dragged = false; // 本次手势是否真的拖过：用于吃掉松手时紧随的 click/dblclick，避免拖完误打开文档/误切折叠
		// v0.4.7+：中键＝平移（绘图软件习惯）；普通左键照旧＝空白处平移（卡片/包含框/连线各自 stopPropagation 独占自己的手势，能冒泡到 bodyEl 的必是空白处）。
		// Alt＋左键＝任意位置平移：卡片/框的手势遇 altKey 直接让位不 stopPropagation（画布热区被框占满时，按住 Alt 从卡片上就能平移视野）
		const wantsPan = (ev: PointerEvent): boolean => ev.button === 1 || ev.button === 0;
		const onDragMove = (ev: PointerEvent): void => {
			if (!dragFrom) return;
			// v0.4.7+ 混合平移：滚动余量内驱动容器滚动（与滚轮/滚动条/触屏同一套），到底后剩余量转入虚拟平移层（panEl translate）——内容不超出面板也能挪整个视野
			const maxX = Math.max(0, this.sizerEl.clientWidth - this.bodyEl.clientWidth);
			const maxY = Math.max(0, this.sizerEl.clientHeight - this.bodyEl.clientHeight);
			const wantL = dragFrom.sl - (ev.clientX - dragFrom.x);
			const wantT = dragFrom.st - (ev.clientY - dragFrom.y);
			this.bodyEl.scrollLeft = clampNum(wantL, 0, maxX);
			this.bodyEl.scrollTop = clampNum(wantT, 0, maxY);
			this.panX = dragFrom.px + (wantL - this.bodyEl.scrollLeft);
			this.panY = dragFrom.py + (wantT - this.bodyEl.scrollTop);
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
