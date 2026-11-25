import test from "node:test";
import assert from "node:assert/strict";

import { clampNum, fitZoomTo, pinchNextZoom, viewPointToContent, zoomAtPointView } from "./panel_canvas";

// v0.4.9+ 「首次打开自动适应全图」与「以鼠标为中心缩放」共用的换算口径（纯算法侧，DOM 侧靠同一函数）

void test("fitZoomTo：内容大于视口＝缩小包住，包围盒中心对齐聚中", () => {
	const fit = fitZoomTo({ x: -200, y: 100, w: 1200, h: 500 }, 600, 400, 14, 0.4, 3);
	assert.ok(fit);
	assert.ok(Math.abs(fit.zoom - 0.4767) < 0.001, `受高度限制＝(400−28)/500：${String(fit.zoom)}`);
	const left = fit.panX + -200 * fit.zoom; // 内容四角 → 屏幕位置
	const right = fit.panX + 1000 * fit.zoom;
	const top = fit.panY + 100 * fit.zoom;
	const bottom = fit.panY + 600 * fit.zoom;
	assert.ok(Math.abs(left - (600 - 1200 * fit.zoom) / 2) < 0.01, `左右居中：${String(left)}`);
	assert.ok(Math.abs(top - (400 - 500 * fit.zoom) / 2) < 0.01, `上下居中：${String(top)}`);
	assert.ok(left >= 0 && top >= 14 && right <= 600 && bottom <= 400 - 14, `全图落在视口内（高度方向＝留白刚好用完）：${String(left)},${String(top)},${String(right)},${String(bottom)}`);
});

void test("fitZoomTo：内容比视口小＝100% 居中，不放大糊卡片", () => {
	const fit = fitZoomTo({ x: 1000, y: 500, w: 200, h: 100 }, 600, 400, 14, 0.4, 3);
	assert.ok(fit);
	assert.equal(fit.zoom, 1);
	assert.equal(fit.panX, (600 - 200) / 2 - 1000); // 内容 (1000,500) → 屏幕 (200,150)＝居中
	assert.equal(fit.panY, (400 - 100) / 2 - 500);
});

void test("fitZoomTo：倍率夹到画布下限（内容极宽也不会缩成 0）", () => {
	const fit = fitZoomTo({ x: 0, y: 0, w: 100000, h: 10 }, 600, 400, 14, 0.4, 3);
	assert.ok(fit);
	assert.equal(fit.zoom, 0.4);
});

void test("fitZoomTo：尺寸异常（0 宽/负视口）＝返回 null，调用方不动视图", () => {
	assert.equal(fitZoomTo({ x: 0, y: 0, w: 0, h: 100 }, 600, 400, 14, 0.4, 3), null);
	assert.equal(fitZoomTo({ x: 0, y: 0, w: 100, h: 100 }, 0, 400, 14, 0.4, 3), null);
	assert.equal(fitZoomTo({ x: 0, y: 0, w: Number.NaN, h: 100 }, 600, 400, 14, 0.4, 3), null);
});

void void test("fitZoomTo 与 toContentPoint 同一口径：适应后内容矩形左上角落在 pad 处", () => {
	const rect = { x: -350, y: 80, w: 900, h: 500 };
	const fit = fitZoomTo(rect, 800, 600, 20, 0.4, 3);
	assert.ok(fit);
	// CanvasPanel.toContentPoint 的逆运算＝m＝pan＋p·z−scroll（scroll 已归零）
	const screenX = fit.panX + rect.x * fit.zoom;
	const screenY = fit.panY + rect.y * fit.zoom;
	assert.ok(screenX >= 20 - 0.001 && screenY >= 20 - 0.001, `左上角不越出留白：${String(screenX)},${String(screenY)}`);
	assert.ok(clampNum(screenX, 0, 800) === screenX, "左上角落在视口内");
});

// —— 以鼠标所在位置为中心缩放（v0.4.9+）：屏幕映射 m＝pan＋p·z−scroll，虚拟偏移 v＝pan−scroll ⇒ m＝p·z＋v；
//    保持锚点（鼠标下的内容点）不动 ⇒ v′＝m−p·z′，再分回 scroll（钳 0..max）与 pan（补差）。
//    纯函数入参口径＝(p, mx, my, nz, panX, panY, scrollLeft, scrollTop, maxX, maxY, vw, vh)
const onScreen = (pan: number, p: number, z: number, scroll: number): number => pan + p * z - scroll;
const toContent = (m: number, pan: number, scroll: number, z: number): number => (scroll + m - pan) / z; // CanvasPanel.toContentPoint 的算法

void test("zoomAtPointView：有滚动余量＝鼠标下的内容点缩放前后不动", () => {
	const p = { x: 400, y: 300 };
	const v = zoomAtPointView(p, 250, 180, 2, 0, 0, 0, 0, 900, 600, 600, 400);
	assert.equal(onScreen(v.panX, p.x, 2, v.scrollLeft), 250); // 锚点仍在鼠标处
	assert.equal(v.panX, 0); // 滚动够用＝不需要平移层补差
	assert.ok(v.scrollLeft > 0 && v.scrollLeft <= 900, `滚动落在余量内：${String(v.scrollLeft)}`);
});

void test("zoomAtPointView：视图已滚过一段再缩放＝中心仍在鼠标处（漏算 scroll 会整体偏一截）", () => {
	const m = { x: 250, y: 180 };
	const z = 1;
	const scroll = 100; // 已经往右/往下滚过
	const pan = 0;
	const p = { x: toContent(m.x, pan, scroll, z), y: toContent(m.y, pan, scroll, z) };
	const v = zoomAtPointView(p, m.x, m.y, 1.5, pan, 0, scroll, scroll, 900, 600, 600, 400);
	assert.equal(onScreen(v.panX, p.x, 1.5, v.scrollLeft), m.x);
	assert.equal(onScreen(v.panY, p.y, 1.5, v.scrollTop), m.y);
	assert.ok(v.scrollLeft > scroll, `放大＝多滚一点：${String(v.scrollLeft)}`);
});

void test("zoomAtPointView：内容比视口窄（无滚动余量）＝平移层补差，中心仍钉在鼠标处", () => {
	const m = { x: 400, y: 200 };
	const z = 1;
	const pan = -30;
	const scroll = 0;
	const p = { x: toContent(m.x, pan, scroll, z), y: toContent(m.y, pan, scroll, z) };
	const v = zoomAtPointView(p, m.x, m.y, 1.5, pan, 0, scroll, 0, 0, 0, 600, 400); // maxX/maxY＝0＝一点滚动余量都没有
	assert.equal(v.scrollLeft, 0);
	assert.notEqual(v.panX, pan); // 补差发生在平移层
	assert.equal(onScreen(v.panX, p.x, 1.5, v.scrollLeft), m.x);
	assert.equal(onScreen(v.panY, p.y, 1.5, v.scrollTop), m.y);
});

void test("zoomAtPointView：目标滚动越界＝钳到 0/max，差额转进平移层（不越界、中心不漂）", () => {
	const v = zoomAtPointView({ x: -800, y: 50 }, 100, 100, 1, 0, 0, 0, 0, 500, 500, 600, 400);
	assert.equal(v.scrollLeft, 0); // v′＝900 → scroll＝pan−v′＝−900＝钳到下限
	assert.equal(v.panX, 900);
	assert.equal(onScreen(v.panX, -800, 1, v.scrollLeft), 100);
	const v2 = zoomAtPointView({ x: 900, y: 0 }, 10, 10, 3, 0, 0, 0, 0, 100, 100, 600, 400);
	assert.equal(v2.scrollLeft, 100); // v′＝−2690 → scroll＝2690＝钳到上限
	assert.equal(v2.panX, -2590);
	assert.equal(onScreen(v2.panX, 900, 3, v2.scrollLeft), 10);
});

void test("zoomAtPointView：连滚多档不漂＋鼠标在容器外＝钳到视口边内一点", () => {
	let pan = 0;
	let scroll = 100;
	let z = 1;
	for (const nz of [1.2, 1.45, 1.75, 0.9, 0.55]) {
		const p = { x: toContent(300, pan, scroll, z), y: toContent(200, pan, scroll, z) }; // 每档按当前状态重新换算鼠标下的内容点（＝滚轮事件的真实做法）
		const v = zoomAtPointView(p, 300, 200, nz, pan, 0, scroll, 200, 200, 200, 600, 400);
		pan = v.panX;
		scroll = v.scrollLeft;
		z = nz;
		assert.ok(Math.abs(onScreen(pan, p.x, z, scroll) - 300) < 1e-9, `第 ${String(nz)} 档锚点漂移`);
		assert.ok(scroll >= 0 && scroll <= 200, `滚动不越界：${String(scroll)}`);
	}
	const outside = zoomAtPointView({ x: 100, y: 100 }, 5000, -500, 2, 0, 0, 0, 0, 999, 999, 600, 400); // 鼠标坐标离谱＝按视口边角内一点算
	assert.equal(onScreen(outside.panX, 100, 2, outside.scrollLeft), 600);
	assert.equal(onScreen(outside.panY, 100, 2, outside.scrollTop), 0);
});

// ---------- v0.4.9+ viewPointToContent（视口内偏移 → 内容坐标＝新建场景落点与右键落点共用口径） ----------

void test("viewPointToContent：无滚动无平移＝偏移÷倍率（视口左上角 +(50,50) 在 z=2 时＝内容坐标 25,25）", () => {
	assert.deepEqual(viewPointToContent({ scrollLeft: 0, scrollTop: 0, panX: 0, panY: 0, zoom: 1 }, 50, 50), { x: 50, y: 50 });
	assert.deepEqual(viewPointToContent({ scrollLeft: 0, scrollTop: 0, panX: 0, panY: 0, zoom: 2 }, 50, 50), { x: 25, y: 25 });
});

void test("viewPointToContent：滚动与虚拟平移都补偿（负 pan／大滚动＝落在画布深处的内容坐标），zoom<=0 兜底按 1", () => {
	const v = { scrollLeft: 300, scrollTop: 120, panX: -400, panY: 80, zoom: 1.5 };
	assert.deepEqual(viewPointToContent(v, 50, 50), { x: (300 + 50 + 400) / 1.5, y: (120 + 50 - 80) / 1.5 });
	const bad = viewPointToContent({ scrollLeft: 10, scrollTop: 10, panX: 0, panY: 0, zoom: 0 }, 20, 20);
	assert.deepEqual(bad, { x: 30, y: 30 }, "zoom=0＝按 1 算（不出现 Infinity）");
});

// ---------- v0.4.11+ pinchNextZoom（手机端双指捏合＝一步倍率推进，DOM 侧靠同一函数） ----------

void test("pinchNextZoom：倍率＝当前×两指距离比；夹进上下限（捏过头不会无限放大/缩没）", () => {
	assert.equal(pinchNextZoom(1, 1.25, 0.4, 3), 1.25); // 两指拉开 25% ＝放大一档
	assert.equal(pinchNextZoom(2, 0.5, 0.4, 3), 1); // 两指收拢一半＝倍率减半
	assert.equal(pinchNextZoom(2.8, 4, 0.4, 3), 3); // 拉过头＝钳到上限 300%
	assert.equal(pinchNextZoom(0.5, 0.1, 0.4, 3), 0.4); // 捏过头＝钳到下限 40%
	assert.equal(pinchNextZoom(1.5, 1, 0.4, 3), 1.5); // 距离不变＝倍率不动
});
