import test from "node:test";
import assert from "node:assert/strict";

import { autoSlotUsable, frameBoxFor, freeAnchorFor, polylineMidpoint, regionFor, regionHeadFor, relEdgePathD } from "./scene_geometry";
import type { ScBox } from "./scene_geometry";

/** d 属性 → 折线点位数组（同时校验：只允许 M/L＝没有曲线命令） */
const pts = (d: string): Array<{ x: number; y: number }> => {
	assert.ok(!/[CQSAT]/.test(d), `折线不应出现曲线命令：${d}`);
	const nums = (d.replace(/[ML]/g, " ").match(/-?[0-9.]+/g) ?? []).map(Number);
	const out: Array<{ x: number; y: number }> = [];
	for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
	return out;
};

const A: ScBox = { x: 100, y: 100, w: 200, h: 80 }; // 中心 x=200，顶边 y=100、底边 y=180
const B: ScBox = { x: 300, y: 300, w: 100, h: 60 }; // 中心 x=350，顶边 y=300、底边 y=360

// v0.4.9+：父子（`- 父场景：`）之间**不再画线**（包含关系＝包含框＋框左上角区域标签），
// 原父子连线口径 edgePathD 已下线，本文件只测「关联」连线（画布上现在仅剩这一种线）。

void test("relEdgePathD：竖向不交叠＝上下折线（上卡底边中点出 → 中间水平线 → 下卡顶边中点入）", () => {
	const down: ScBox = { x: 120, y: 400, w: 100, h: 60 };
	const p = pts(relEdgePathD(A, down));
	assert.deepEqual(p[0], { x: 200, y: 180 }, "起点＝上卡底边中点");
	assert.deepEqual(p[p.length - 1], { x: 170, y: 400 }, "终点＝下卡顶边中点");
	assert.equal(p.length, 4, "上下错开＝四点多折线（两拐点）");
	assert.equal(p[1].x, p[0].x, "第一段竖直");
	assert.equal(p[1].y, p[2].y, "第二段水平（拐点同 Y）");
	assert.equal(p[3].x, p[2].x, "末段竖直");
	assert.ok(p[1].y > 180 && p[1].y < 400, "水平段落在两卡片之间");
});

void test("relEdgePathD：竖向不交叠且中轴对齐＝退化为一条直线段（不留重复拐点）", () => {
	const b: ScBox = { x: 150, y: 300, w: 100, h: 60 }; // 中心 x=200＝与 A 同轴
	assert.deepEqual(pts(relEdgePathD(A, b)), [{ x: 200, y: 180 }, { x: 200, y: 300 }]);
});

void test("relEdgePathD：横向并排＝走左右边中点的折线（左右边中点相接、中间一条竖线）", () => {
	const R: ScBox = { x: 400, y: 120, w: 120, h: 60 }; // 与 A 横向并排（A 右边 300 < 400）
	const p = pts(relEdgePathD(A, R));
	assert.deepEqual(p[0], { x: 300, y: 140 }, "起点＝左卡右边中点");
	assert.deepEqual(p[p.length - 1], { x: 400, y: 150 }, "终点＝右卡左边中点");
	assert.equal(p[1].y, p[0].y, "第一段水平");
	assert.equal(p[1].x, p[2].x, "第二段竖直");
	assert.ok(p[1].x > 300 && p[1].x < 400, "竖段落在两卡片之间");
});

void test("relEdgePathD：方向按几何不按调用序＝反序调用画出同一条线（关联无方向）", () => {
	const down: ScBox = { x: 120, y: 400, w: 100, h: 60 };
	const fwd = pts(relEdgePathD(A, down));
	const rev = pts(relEdgePathD(down, A));
	assert.deepEqual(rev, fwd, "反序调用＝同一条折线（不该两条线长得不一样）");
	const side1: ScBox = { x: 400, y: 120, w: 120, h: 60 };
	assert.deepEqual(pts(relEdgePathD(side1, A)), pts(relEdgePathD(A, side1)), "横向并排同样对称");
});

void test("relEdgePathD：上下只留 1px 间隙＝拐点仍按最小 12px 外扩，不把折角塞进两卡之间", () => {
	const near: ScBox = { x: 320, y: 181, w: 100, h: 60 }; // 顶边 y=181＝距 A 底边 180 只差 1px，左右不交叠
	const p = pts(relEdgePathD(A, near));
	assert.deepEqual(p[0], { x: 200, y: 180 }, "起点＝上卡底边中点");
	assert.ok(p[1].y >= 180 + 12, `水平段至少到上卡底边外 12px：${String(p[1].y)}`);
	assert.ok(p[1].y <= 181 + 12, "也不会绕大圈（间隙不足 12px 时最多压到下卡顶边外 12px 处）");
	assert.deepEqual(p[p.length - 1], { x: 370, y: 181 }, "终点＝下卡顶边中点");
});

void test("relEdgePathD：两轴都交叠（近水平/重叠摆放）＝绕到两卡片下方再横移", () => {
	const near: ScBox = { x: 240, y: 110, w: 120, h: 60 }; // 与 A 两轴都交叠
	const p = pts(relEdgePathD(A, near));
	assert.deepEqual(p[0], { x: 200, y: 180 }, "起点＝A 底边中点");
	assert.deepEqual(p[p.length - 1], { x: 300, y: 170 }, "终点＝另一卡底边中点");
	assert.ok(p[1].y > 180 && p[1].y > 170, "水平段在两卡片下方");
	assert.equal(p[1].y, p[2].y, "下方那条是水平段");
});

void test("polylineMidpoint：折线按总段长取半＝与按点位累计算出的中点一致（联通性说明挂靠点核验）", () => {
	const d = relEdgePathD(A, B);
	const p = pts(d);
	const mid = polylineMidpoint(d);
	assert.ok(mid, "有中点");
	let total = 0;
	for (let i = 1; i < p.length; i++) total += Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y);
	assert.ok(total > 0);
	let target = total / 2;
	let expect = p[0];
	for (let i = 1; i < p.length; i++) {
		const len = Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y);
		if (target > len) {
			target -= len;
			expect = p[i];
			continue;
		}
		const ratio = len === 0 ? 0 : target / len;
		expect = { x: p[i - 1].x + (p[i].x - p[i - 1].x) * ratio, y: p[i - 1].y + (p[i].y - p[i - 1].y) * ratio };
		break;
	}
	assert.ok(Math.abs(mid.x - expect.x) < 0.01 && Math.abs(mid.y - expect.y) < 0.01, `半长点位一致：${JSON.stringify(mid)} vs ${JSON.stringify(expect)}`);
	assert.ok(mid.y >= 180 && mid.y <= 360, "标签落在两卡片之间（含水平段）");
});

void test("polylineMidpoint：单点＝无中点；两点直线段＝取线段中点", () => {
	assert.equal(polylineMidpoint("M 0 0"), null, "单点＝无中点");
	assert.deepEqual(polylineMidpoint("M 0 0 L 0 100"), { x: 0, y: 50 });
});

// v0.4.9+（用户要求＝顺序不能反）**区域由子场景决定**：先按全部子场景算出区域，再算父卡片的新位置
// ⇒ 区域头位置纯派生自子场景包围盒，与它自己原来摆在哪无关（`regionHeadFor` 连父卡片旧坐标都不吃）
const KIDS = { minX: 400, minY: 500, maxX: 900, maxY: 800 };

void test("regionHeadFor：区域头＝与子场景左对齐、排在子场景上方 gap 处（负坐标同口径）", () => {
	const a = regionHeadFor({ w: 200, h: 90 }, KIDS, 56);
	assert.ok(a);
	assert.deepEqual(a, { x: 400, y: 500 - 90 - 56 });
	const b = regionHeadFor({ w: 200, h: 90 }, { minX: -800, minY: -600, maxX: -400, maxY: -300 }, 24);
	assert.ok(b);
	assert.deepEqual(b, { x: -800, y: -600 - 90 - 24 }, "场景坐标常是远离原点的负值＝同口径");
});

void test("regionHeadFor：平移全部子场景＝区域头同步平移（拖整组子场景不会被弹回）", () => {
	const a = regionHeadFor({ w: 200, h: 90 }, KIDS, 24);
	const b = regionHeadFor({ w: 200, h: 90 }, { minX: 280, minY: 580, maxX: 780, maxY: 880 }, 24); // 整组左移 120、下移 80
	assert.ok(a && b);
	assert.deepEqual(b, { x: a.x - 120, y: a.y + 80 });
});

void test("regionHeadFor：gap<0 按 0；无子场景（null）/缺几何＝null（调用方既不画框也不挪卡）", () => {
	const a = regionHeadFor({ w: 200, h: 90 }, KIDS, -10);
	assert.ok(a);
	assert.deepEqual(a, { x: 400, y: 500 - 90 }, "gap<0＝按 0");
	assert.equal(regionHeadFor({ w: 200, h: 90 }, null, 24), null, "本次没有可见子场景");
	assert.equal(regionHeadFor({ w: Number.NaN, h: 90 }, KIDS, 24), null, "卡片宽缺失＝不派生");
});

// ---------- v0.4.9+ frameBoxFor（包含框＝父场景的有效区域：一律由成员当前包围盒现算，成员挪动＝区域尺寸跟着变） ----------

const covers = (b: { x: number; y: number; w: number; h: number }, m: ScBox, pad: number): boolean =>
	b.x <= m.x - pad && b.y <= m.y - pad && b.x + b.w >= m.x + m.w + pad && b.y + b.h >= m.y + m.h + pad;

void test("frameBoxFor：四边外扩 pad＝每个成员恒在框内（通用包围盒，区域调用方传子场景＋派生后的区域头）", () => {
	const parent = { x: 0, y: 0, w: 200, h: 90 };
	const kid = { x: 22, y: 114, w: 200, h: 80 };
	const b = frameBoxFor([parent, kid], 10);
	assert.ok(b);
	assert.deepEqual(b, { x: -10, y: -10, w: 242, h: 214 });
	for (const m of [parent, kid]) assert.ok(covers(b, m, 10), `成员必须被框住：${JSON.stringify(m)}`);
});

void test("frameBoxFor：子场景往下挪＝区域高度跟着长（同一区域重算第二次比第一次更高）", () => {
	const parent = { x: 0, y: 0, w: 200, h: 90 };
	const kidTop = { x: 22, y: 114, w: 200, h: 80 }; // 子场景底边 194
	const before = frameBoxFor([parent, kidTop], 10)!;
	const kidDown = { x: 22, y: 600, w: 200, h: 80 }; // 同一子场景下移到 680
	const after = frameBoxFor([parent, kidDown], 10)!;
	assert.ok(after.h > before.h, "子场景下移＝区域高度必须变大");
	assert.equal(after.y, before.y, "最上层成员没动＝框顶不动");
	assert.equal(after.y + after.h, 680 + 10, "框底＝最下成员底边＋pad");
	assert.ok(covers(after, kidDown, 10));
});

void test("frameBoxFor：成员上移／缩小区间＝区域高度跟着缩（不留旧尺寸残留）", () => {
	const parent = { x: -800, y: -1200, w: 200, h: 90 }; // 负坐标（场景坐标常远离原点）
	const kidFar = { x: -778, y: -1000, w: 200, h: 80 };
	const kidNear = { x: -778, y: -1090, w: 200, h: 40 }; // 上移＋变矮
	const a = frameBoxFor([parent, kidFar], 10)!;
	const b = frameBoxFor([parent, kidNear], 10)!;
	assert.ok(b.h < a.h && b.w <= a.w, "区域要能缩＝严格按当前包围盒");
	assert.ok(covers(b, parent, 10) && covers(b, kidNear, 10));
});

void test("frameBoxFor：无成员＝null；缺几何（NaN）的成员不进包围盒；pad<0＝按 0", () => {
	assert.equal(frameBoxFor([], 10), null);
	const only = { x: 5, y: 5, w: 10, h: 10 };
	const bad = { x: Number.NaN, y: 0, w: 10, h: 10 };
	assert.deepEqual(frameBoxFor([only, bad], 0), { x: 5, y: 5, w: 10, h: 10 }, "NaN 成员被跳过＝框仍由有效成员决定");
	assert.equal(frameBoxFor([bad], 10), null, "全都缺几何＝null");
	const p0 = frameBoxFor([only], -5)!;
	assert.deepEqual(p0, { x: 5, y: 5, w: 10, h: 10 }, "pad<0＝按 0（不外扩也不内缩）");
});

// ---------- v0.4.9+ regionFor（用户要求＝先按全部子场景算出区域，**再**算父卡片的新位置；区域计算不吃父卡片旧坐标） ----------

void test("regionFor：区域左/右/下三边只由子场景决定；顶边为区域头让出一行，区域头与子场景左对齐", () => {
	const kids: ScBox[] = [{ x: 400, y: 500, w: 200, h: 90 }, { x: 700, y: 620, w: 200, h: 90 }]; // 子场景包围盒 400..900 × 500..710
	const r = regionFor({ w: 200, h: 90 }, kids, 24, 10);
	assert.ok(r);
	assert.deepEqual(r.head, { x: 400, y: 500 - 90 - 24 }, "区域头＝与子场景左对齐、排在子场景上方 gap 处");
	assert.equal(r.box.x, 390, "左边＝子场景最左外扩（不由父卡片决定）");
	assert.equal(r.box.x + r.box.w, 910, "右边＝子场景最右外扩");
	assert.equal(r.box.y + r.box.h, 720, "下边＝子场景最下外扩");
	assert.equal(r.box.y, r.head.y - 10, "顶边＝区域头之上再外扩＝只有顶部为区域头让出");
	for (const m of [...kids, { x: r.head.x, y: r.head.y, w: 200, h: 90 }]) assert.ok(covers(r.box, m, 10), `不变量＝每个成员恒在框内：${JSON.stringify(m)}`);
});

void test("regionFor：拖动某个子场景挪远＝区域宽/高跟着长（区域头仍按新的子场景包围盒重排＝旧坐标不参与）", () => {
	const kidA: ScBox = { x: 0, y: 114, w: 200, h: 80 };
	const kidsBefore: ScBox[] = [kidA, { x: 22, y: 214, w: 200, h: 80 }]; // 子场景包围盒 0..222 × 114..294
	const before = regionFor({ w: 200, h: 90 }, kidsBefore, 24, 10);
	const kidsAfter: ScBox[] = [kidA, { x: 220, y: 900, w: 200, h: 80 }]; // 同一个子场景被拖到右下
	const after = regionFor({ w: 200, h: 90 }, kidsAfter, 24, 10);
	assert.ok(before && after);
	assert.ok(after.box.w > before.box.w && after.box.h > before.box.h, "子场景挪远＝区域宽与高都跟着长");
	assert.deepEqual(before.head, { x: 0, y: 114 - 90 - 24 });
	assert.deepEqual(after.head, { x: 0, y: 114 - 90 - 24 }, "最左/最上的子场景没动＝区域头不动");
	assert.equal(after.box.y + after.box.h, 980 + 10, "框底＝最下子场景底边＋pad");
	for (const m of [...kidsAfter, { x: after.head.x, y: after.head.y, w: 200, h: 90 }]) assert.ok(covers(after.box, m, 10));
});

void test("regionFor：子场景被拖到最上/最左＝区域整体让位、区域头随之搬过去（＝区域头由子场景反推，不被自己旧位置钉死）", () => {
	const kidsBefore: ScBox[] = [{ x: 100, y: 200, w: 200, h: 80 }];
	const after = regionFor({ w: 200, h: 90 }, [{ x: -500, y: -300, w: 200, h: 80 }], 24, 10);
	assert.ok(after);
	assert.deepEqual(after.head, { x: -500, y: -300 - 90 - 24 }, "区域头跟着新的子场景走");
	assert.equal(after.box.x, -510, "左边＝子场景最左外扩");
	assert.equal(after.box.y, after.head.y - 10, "顶边＝区域头之上再外扩");
	const before = regionFor({ w: 200, h: 90 }, kidsBefore, 24, 10);
	assert.ok(before);
	assert.equal(before.box.w, after.box.w, "只有一张子场景时＝平移它＝区域同步平移（宽不变）");
});

void test("regionFor：没有子场景＝null（不画框也不搬父卡片）；子场景全缺几何＝同样 null", () => {
	assert.equal(regionFor({ w: 200, h: 90 }, [], 24, 10), null);
	assert.equal(regionFor({ w: 200, h: 90 }, [{ x: Number.NaN, y: 0, w: 10, h: 10 }], 24, 10), null);
});

void test("regionFor：区域头比子场景宽＝只有右边为它让路，左/下边仍由子场景说了算", () => {
	const kids: ScBox[] = [{ x: 100, y: 100, w: 60, h: 40 }]; // 子场景包围盒 100..160 × 100..140
	const r = regionFor({ w: 400, h: 90 }, kids, 24, 10);
	assert.ok(r);
	assert.equal(r.box.x, 90, "左边＝子场景最左外扩（不是区域头左边）");
	assert.equal(r.box.x + r.box.w, 510, "右边＝更宽的区域头外扩");
	assert.equal(r.box.y + r.box.h, 150, "下边＝子场景最下外扩");
	assert.equal(r.box.y, 100 - 90 - 24 - 10, "顶边＝区域头之上再外扩");
});

// ---------- v0.4.9+ 新建场景落点判定（先自动布局；看不见／压到旧卡片才改放视口左上角） ----------

const VP = { minX: -1000, minY: -800, maxX: -400, maxY: -400 }; // 内容坐标系里的视口矩形（场景坐标常是远离原点的负值）
const CARD = { w: 200, h: 90 };

void test("autoSlotUsable：整块落在视口内且不与任何旧卡相交＝可用（保持自动布局、不写位置）", () => {
	const slot = { x: -980, y: -780 };
	assert.ok(autoSlotUsable(slot, CARD, VP, [{ x: -600, y: -700, w: 200, h: 90 }]));
	assert.ok(autoSlotUsable(slot, CARD, VP, []), "一张卡都没有＝当然可用");
});

void test("autoSlotUsable：新卡越出视口任一边＝不可用（默认 pad 8＝刚好压边也不算看得见）", () => {
	assert.ok(!autoSlotUsable({ x: -1005, y: -780 }, CARD, VP, []), "左边越界");
	assert.ok(!autoSlotUsable({ x: -980, y: -805 }, CARD, VP, []), "顶边越界");
	assert.ok(!autoSlotUsable({ x: -410, y: -780 }, CARD, VP, []), "右边越界（-410+200 > -400）");
	assert.ok(!autoSlotUsable({ x: -980, y: -495 }, CARD, VP, []), "底边越界（-495+90 > -400）");
	assert.ok(autoSlotUsable({ x: -992, y: -792 }, CARD, VP, [], 0), "pad=0＝贴边算可用");
});

void test("autoSlotUsable：落点与旧卡片矩形相交＝不可用（相交一格也算）", () => {
	const old = { x: -900, y: -700, w: 200, h: 90 }; // 占 -900..-700 × -700..-610
	assert.ok(!autoSlotUsable({ x: -950, y: -720 }, CARD, VP, [old]), "完全压住旧卡");
	assert.ok(!autoSlotUsable({ x: -890, y: -690 }, CARD, VP, [old]), "右下角只交一小块");
	assert.ok(autoSlotUsable({ x: -700, y: -610 }, CARD, VP, [old]), "刚好贴边不相交＝可用");
});

void test("autoSlotUsable：NaN 几何＝不可用（调用方据此走视口左上角兜底）", () => {
	assert.ok(!autoSlotUsable({ x: Number.NaN, y: 0 }, CARD, VP, []));
	assert.ok(!autoSlotUsable({ x: 0, y: 0 }, { w: Number.NaN, h: 90 }, VP, []));
});

void test("freeAnchorFor：落点空闲＝原样；被卡片占住＝按阶梯往右下逐级避让", () => {
	const old = { x: 100, y: 100, w: 200, h: 90 };
	assert.deepEqual(freeAnchorFor({ x: 50, y: 50 }, [old], 36), { x: 50, y: 50 }, "点不在卡片内＝不动");
	const a = freeAnchorFor({ x: 150, y: 150 }, [old], 36);
	assert.deepEqual(a, { x: 222, y: 222 }, "级联避让＝一级不够就继续往右下（(186,186) 仍在卡内→再到 (222,222)）");
	assert.ok(![a].some((p) => p.x >= old.x && p.x < old.x + old.w && p.y >= old.y && p.y < old.y + old.h), "避让后不再被那张卡占据");
});

void test("freeAnchorFor：一排卡片连着占＝连避多级，tries 用尽＝返回最后一级（不落回原处）", () => {
	const row: ScBox[] = [];
	for (let i = 0; i < 4; i++) row.push({ x: 0, y: i * 10, w: 400, h: 10 }); // 一条 0..40 高的带子，阶梯 10
	const p = freeAnchorFor({ x: 5, y: 5 }, row, 10, 4);
	assert.deepEqual(p, { x: 45, y: 45 }, "tries=4＝走满四级");
	const p2 = freeAnchorFor({ x: 5, y: 5 }, row, 10);
	assert.ok(p2.y >= 40, "默认 tries 足够躲开这条带子");
});
