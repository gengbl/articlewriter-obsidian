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
}

/** 缩放/平移画布：Ctrl|Shift＋滚轮以鼠标位置为不动点缩放（普通滚轮不拦截、走原生滚动）、左键按住拖动平移（驱动容器滚动位置）、倍率标签点击复位；拖拽后的紧随 click/dblclick 自动吞掉（平移与条目拖拽两种来源） */
export class CanvasPanel {
	readonly bodyEl: HTMLElement;
	readonly sizerEl: HTMLElement;
	readonly zoomEl: HTMLElement;

	private zoomLevel = 1; // 缩放倍率（重渲染不清零——筛选切换后视野保持）
	private zoomLbl: HTMLElement | null = null; // 头部倍率标签（==100% 时隐藏，点击复位）
	private suppressClickUntil = 0; // 条目拖拽结束后需吞掉紧随 click/dblclick 的时间戳上限

	constructor(parent: HTMLElement, private readonly opts: CanvasPanelOptions) {
		this.bodyEl = parent.createDiv({ cls: opts.bodyCls });
		this.sizerEl = this.bodyEl.createDiv({ cls: opts.sizerCls });
		this.zoomEl = this.sizerEl.createDiv({ cls: opts.zoomCls });
		this.setupCanvas();
	}

	get zoom(): number {
		return this.zoomLevel;
	}

	/** 头部挂倍率标签（每次头部重建都可重挂；旧标签随头部清空自然废弃） */
	attachZoomLabel(container: HTMLElement): void {
		this.zoomLbl = container.createSpan({ text: "", cls: this.opts.zoomLabelCls ?? "aw-dim aw-panel-zoomlbl", title: this.opts.zoomLabelTitle ?? "Ctrl|Shift＋滚轮缩放 / 普通滚轮滚动 / 左键拖动平移；点击复位为 100%" });
		this.zoomLbl.addEventListener("click", () => {
			this.zoomLevel = 1;
			this.bodyEl.scrollTo({ left: 0, top: 0 });
			this.apply();
		});
		this.apply(); // 头部重建后按当前缩放状态恢复倍率标签显示
	}

	/** 吞掉紧随条目拖拽松手的 click/dblclick（否则拖完会误开文档/误切折叠；zoomEl 捕获阶段判定） */
	suppressClicks(delayMs = 400): void {
		this.suppressClickUntil = Date.now() + delayMs;
	}

	/** 应用画布视图状态：sizer 宽高＝内容×缩放（决定可滚动范围）、transform via CSS var、滚动位置限位、倍率标签 class；构造 / 滚轮缩放 / 点击复位 / 重渲染后共用 */
	apply(): void {
		const w = this.bodyEl.clientWidth;
		this.zoomEl.style.width = `${String(w)}px`; // 内容布局宽＝视口宽（transform 不影响布局，须显式给定）
		const h = this.zoomEl.clientHeight; // 内容布局高（scale=1 时）
		this.sizerEl.style.width = `${Math.round(w * this.zoomLevel)}px`;
		this.sizerEl.style.height = `${Math.round(h * this.zoomLevel)}px`;
		this.zoomEl.style.setProperty(this.opts.zoomVar, `scale(${String(this.zoomLevel)})`);
		const maxX = Math.max(0, this.sizerEl.clientWidth - w);
		const maxY = Math.max(0, this.sizerEl.clientHeight - this.bodyEl.clientHeight);
		if (this.bodyEl.scrollLeft > maxX) this.bodyEl.scrollLeft = maxX; // 缩小时把越界的滚动位置拉回
		if (this.bodyEl.scrollTop > maxY) this.bodyEl.scrollTop = maxY;
		if (!this.zoomLbl) return; // 头部尚未渲染时跳过标签更新
		const pct = Math.round(this.zoomLevel * 100);
		this.zoomLbl.setText(`${pct}%`);
		this.zoomLbl.toggleClass("is-hidden", pct === 100); // toggle class 替代直接设 style.display
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
			// 以鼠标位置为不动点：鼠标下的内容点 p=(scroll+m)/z 缩放后仍停在屏幕 m 处 → scroll′ = p·z′ − m
			const rect = this.bodyEl.getBoundingClientRect();
			const mx = ev.clientX - rect.left;
			const my = ev.clientY - rect.top;
			const px = (this.bodyEl.scrollLeft + mx) / this.zoomLevel;
			const py = (this.bodyEl.scrollTop + my) / this.zoomLevel;
			this.zoomLevel = nz;
			this.bodyEl.scrollLeft = px * nz - mx;
			this.bodyEl.scrollTop = py * nz - my;
			this.apply();
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
				if (Date.now() > this.suppressClickUntil) return; // 最近没有有效条目拖拽 → 正常放行
				ev.stopPropagation(); // 吞掉拖动紧随的 click/dblclick（否则拖完会误开文档/误切折叠）
				ev.preventDefault();
				this.suppressClickUntil = 0;
			}, true);
		}

		this.apply(); // 首帧兜底（zoomLbl 未挂时 apply 内部已判空）
	}
}
