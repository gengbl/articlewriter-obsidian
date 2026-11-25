// v0.4.11+：触屏（手机／平板）Tip 通道的**判定口径**（纯函数模块＝node 可测；DOM 接线在 main.ts `attachTouchTipChannel`）
//
// 事实（从安装包 `obsidian.asar` 内核核对，不是猜）：
//  ① `setTooltip` 只是把文案写进 `aria-label` ＋ `data-tooltip-*` 属性，**显示**由内核挂在 `body` 上的委托驱动：
//     `body.on("pointerover","[aria-label]", …)`／`body.on("pointerout", …)` ＋ `document.addEventListener("pointerup", 收起)`；
//  ② 该 `pointerover` 处理函数首行就**主动放过非鼠标指针**（内核 `Hr(ev)`＝`PointerEvent.pointerType !== "mouse"` 即 true → return）
//     ＝平板／手机上悬停类 Tip **根本弹不出来**（不是「收不掉」，而是从未出现）；
//  ③ 内核每次 `pointerup` 无条件收起当前 Tip。
//
// 补的通道（main.ts 里装）：`pointerup`（注册晚于内核＝排在内核收起之后，同节点同阶段按注册顺序执行）里，用
// `activeDocument.elementFromPoint`（＝抬手时手指正下方的元素，避免 EventTarget 上没法用内核跨窗口 instanceOf）找到其
// `[aria-label]` 宿主，用公开 API `displayTooltip`（内核 1.8.7+ 导出）把该元素自己的 `aria-label` 弹出来；
// 下一次点按别处＝内核那次 `pointerup` 自动收＝不用自管定时器。
//
// 口径／坑位：
//  - 只服务**内容型**元素＝跳过按钮／输入框这类交互件（它们的 `aria-label` 就是按钮名，点它已执行动作，再弹 Tip＝噪音）；
//     ＝手指元素到宿主之间链上任一交互件命中（`closest(TOUCH_TIP_SKIP_SELECTOR)`）即豁免；
//  - 点 Tip 自己＝不重挂（Tip 是 body 下的浮层，重挂会跳位）；
//  - 鼠标指针一律交回核心悬停通道（本通道对桌面零影响）；
//  - 原生 `title` 属性在触屏上永不显示＝**面板里要给人读的信息一律走 `setTooltip`**（例：场景树行的完整父链），别用 `.title`。

import type { TooltipOptions } from "obsidian";

/** 交互件＝aria-label 是「按钮名」而非内容，点按已触发动作＝不再弹 Tip */
export const TOUCH_TIP_SKIP_SELECTOR =
	"button, input, select, textarea, a, summary, label, .clickable-icon, .checkbox, .checkbox-container, [role='button']";

/** 一次点按该不该弹 Tip（纯口径）。入参都由调用方从事件与元素上取好＝这里只做判定 */
export function touchTipShouldShow(input: {
	pointerType: string;
	inTooltip: boolean;
	interactive: boolean;
	label: string | null;
	connected: boolean;
}): boolean {
	if (input.pointerType === "mouse") return false; // 桌面＝核心悬停通道已够用
	if (input.inTooltip || input.interactive) return false;
	if (!input.label || input.label.trim().length === 0) return false;
	return input.connected;
}

/** 读内核自己挂在元素上的 `data-tooltip-*`（＝内核显示时用过的同一套参数）；placement 用枚举窄化代替类型断言 */
export function touchTipOptions(host: { getAttribute(name: string): string | null }): TooltipOptions {
	const opts: TooltipOptions = {};
	const place = host.getAttribute("data-tooltip-position");
	if (place === "top" || place === "bottom" || place === "left" || place === "right") opts.placement = place;
	const cls = host.getAttribute("data-tooltip-classes");
	if (cls) {
		const list = cls.split(" ").filter((s) => s.length > 0);
		if (list.length) opts.classes = list;
	}
	const gap = host.getAttribute("data-tooltip-gap");
	if (gap) {
		const n = parseFloat(gap);
		if (Number.isFinite(n)) opts.gap = n;
	}
	return opts;
}
