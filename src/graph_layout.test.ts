import test from "node:test";
import assert from "node:assert/strict";

import {
	adjacencyMap,
	chainOrder,
	curvePoint,
	edgeCurvePath,
	forceLayout,
	hubOf,
	labelFontSize,
	nodeRadius,
	ringLayout,
} from "./graph_layout";
import type { GraphEdgeLike, GraphLayoutNode, GraphRankNode } from "./graph_layout";

const CX = 380;
const CY = 280;
const RX = 250;
const RY = 205;

const dist = (x: number, y: number): number => Math.sqrt(x * x + y * y);
const nums = (d: string): number[] => {
	const m = d.match(/-?\d+(?:\.\d+)?/g);
	if (!m) assert.fail(`path 里没有坐标：${d}`);
	return m.map((s) => Number(s));
};

test("ringLayout 椭圆环从正上方起顺时针均分，度数决定圆点大小", () => {
	const pts = ringLayout(4, CX, CY, RX, RY, [0, 3, 99, 7]);
	assert.deepEqual(pts.map((p) => Math.round(p.x)), [CX, CX + RX, CX, CX - RX]);
	assert.deepEqual(pts.map((p) => Math.round(p.y)), [CY - RY, CY, CY + RY, CY]);
	assert.equal(pts[0].r, nodeRadius(0));
	assert.equal(pts[2].r, nodeRadius(99));
});

test("ringLayout 空数量返回空数组、度数缺项按 0 度", () => {
	assert.deepEqual(ringLayout(0, CX, CY, RX, RY, []), []);
	const one = ringLayout(1, CX, CY, RX, RY, []);
	assert.equal(one.length, 1);
	assert.equal(one[0].r, nodeRadius(0));
});

test("nodeRadius／labelFontSize 随度数递增但都有上限（主次分明又不失控）", () => {
	assert.ok(nodeRadius(0) < nodeRadius(3));
	assert.ok(nodeRadius(3) < nodeRadius(9));
	assert.equal(nodeRadius(99), nodeRadius(50)); // 封顶：超大度数不再无限变大
	assert.ok(labelFontSize(0) < labelFontSize(4));
	assert.equal(labelFontSize(99), labelFontSize(40));
});

test("adjacencyMap 生成对称邻接表", () => {
	const m = adjacencyMap([{ a: "甲", b: "乙" }, { a: "乙", b: "丙" }]);
	assert.deepEqual(Array.from(m.get("甲") ?? []), ["乙"]);
	assert.deepEqual(Array.from(m.get("乙") ?? []).sort(), ["丙", "甲"]);
	assert.equal(m.has("丁"), false); // 没有任何边的人物不出现在邻接表里
});

test("chainOrder 把连线最多的人物排第一，并把有关系的角色排在相邻处", () => {
	const nodes: GraphRankNode[] = [
		{ name: "甲", degree: 1 },
		{ name: "乙", degree: 2 },
		{ name: "丙", degree: 2 },
		{ name: "丁", degree: 1 },
	];
	const edges = [{ a: "甲", b: "乙" }, { a: "乙", b: "丙" }, { a: "丙", b: "丁" }];
	const order = chainOrder(nodes, adjacencyMap(edges));
	assert.equal(order[0].name, "乙"); // 度数最多＝枢纽，旋到链首（链按环使用，旋转不改环序）
	assert.deepEqual(order.map((n) => n.name), ["乙", "丙", "丁", "甲"]); // 一条链上的角色在环序里连续
	assert.equal(order.length, nodes.length);
});

test("hubOf 取连线最多的人物；并列取先出现的；空图返回空串", () => {
	assert.equal(hubOf([{ name: "甲", degree: 1 }, { name: "乙", degree: 3 }]), "乙");
	assert.equal(hubOf([{ name: "甲", degree: 2 }, { name: "乙", degree: 2 }]), "甲");
	assert.equal(hubOf([]), "");
});

test("chainOrder centerName（v0.4.8+）：指定中心人物旋到链首；不存在＝回退度数枢纽", () => {
	const nodes: GraphRankNode[] = [
		{ name: "甲", degree: 1 },
		{ name: "乙", degree: 2 },
		{ name: "丙", degree: 2 },
		{ name: "丁", degree: 1 },
	];
	const linked = adjacencyMap([{ a: "甲", b: "乙" }, { a: "乙", b: "丙" }, { a: "丙", b: "丁" }]);
	assert.equal(chainOrder(nodes, linked, "丁")[0].name, "丁", "度数最少者被指定为中心＝排第一");
	assert.equal(chainOrder(nodes, linked, "不存在")[0].name, "乙", "名字不在点集＝回退度数枢纽");
	assert.equal(chainOrder(nodes, linked, "")[0].name, "乙", "空串＝现状默认");
});

test("chainOrder 星形图：枢纽两侧就是它的至亲；空输入返回空；结果确定可复现", () => {
	const nodes: GraphRankNode[] = [{ name: "主角", degree: 4 }, { name: "甲", degree: 1 }, { name: "乙", degree: 1 }, { name: "丙", degree: 1 }, { name: "丁", degree: 1 }];
	const edges = [{ a: "主角", b: "甲" }, { a: "主角", b: "乙" }, { a: "主角", b: "丙" }, { a: "主角", b: "丁" }];
	const linked = adjacencyMap(edges);
	const order = chainOrder(nodes, linked);
	assert.equal(order[0].name, "主角");
	const names = order.map((n) => n.name);
	assert.ok(linked.get("主角")?.has(names[1]), "枢纽旁边应是它的至亲");
	assert.ok(linked.get("主角")?.has(names[names.length - 1]), "环的另一侧（首尾相接）也该是枢纽的至亲");
	assert.deepEqual(chainOrder(nodes, linked), order); // 同输入同输出
	assert.deepEqual(chainOrder([], new Map()), []);
});

test("forceLayout 确定性：同输入两次结果逐字相同", () => {
	const nodes: GraphRankNode[] = [
		{ name: "主角", degree: 5 },
		{ name: "甲", degree: 2 },
		{ name: "乙", degree: 2 },
		{ name: "丙", degree: 2 },
		{ name: "丁", degree: 2 },
		{ name: "戊", degree: 1 },
	];
	const edges: GraphEdgeLike[] = [
		{ a: "主角", b: "甲", weight: 3 },
		{ a: "主角", b: "乙", weight: 1 },
		{ a: "主角", b: "丙", weight: 2 },
		{ a: "主角", b: "丁", weight: 1 },
		{ a: "甲", b: "乙", weight: 1 },
		{ a: "丙", b: "丁", weight: 1 },
		{ a: "戊", b: "丁", weight: 1 },
	];
	const p = { width: 760, height: 560, pad: 56 };
	assert.deepEqual(forceLayout(nodes, edges, p), forceLayout(nodes, edges, p));
});

test("forceLayout 枢纽排第一且被提到画布中心之上，所有点都留在画布内", () => {
	const nodes: GraphRankNode[] = [
		{ name: "主角", degree: 6 },
		{ name: "甲", degree: 2 },
		{ name: "乙", degree: 2 },
		{ name: "丙", degree: 2 },
		{ name: "丁", degree: 2 },
		{ name: "戊", degree: 1 },
		{ name: "己", degree: 0 }, // 孤立人物也要安排进画布
	];
	const edges: GraphEdgeLike[] = [
		{ a: "主角", b: "甲", weight: 3 },
		{ a: "主角", b: "乙", weight: 1 },
		{ a: "主角", b: "丙", weight: 2 },
		{ a: "主角", b: "丁", weight: 1 },
		{ a: "主角", b: "戊", weight: 1 },
		{ a: "甲", b: "乙", weight: 1 },
		{ a: "丙", b: "丁", weight: 1 },
	];
	const W = 760;
	const H = 560;
	const pad = 56;
	const out = forceLayout(nodes, edges, { width: W, height: H, pad });
	assert.equal(out.length, nodes.length);
	assert.equal(out[0].name, "主角");
	assert.ok(out[0].y < H / 2, `枢纽应在画布中心之上，实测 y=${String(out[0].y)}`);
	assert.ok(Math.abs(out[0].x - W / 2) < 60, `枢纽应横向摆到画布中央附近，实测 x=${String(out[0].x)}`);
	for (const p of out) {
		assert.ok(p.x >= pad && p.x <= W - pad, `${p.name} 横向出界：x=${String(p.x)}`);
		assert.ok(p.y >= pad && p.y <= H - pad, `${p.name} 纵向出界：y=${String(p.y)}`);
		assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
	}
});

test("forceLayout 空节点返回空；没有边也不会 NaN", () => {
	assert.deepEqual(forceLayout([], [], { width: 760, height: 560 }), []);
	const out = forceLayout([{ name: "甲", degree: 0 }, { name: "乙", degree: 0 }], [], { width: 760, height: 560 });
	assert.equal(out.length, 2);
	for (const p of out) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test("forceLayout centerName（v0.4.8+）：指定人物排第一并钉在画布正中；不存在的名字回退度数枢纽", () => {
	const nodes: GraphRankNode[] = [
		{ name: "主角", degree: 6 },
		{ name: "甲", degree: 2 },
		{ name: "乙", degree: 2 },
		{ name: "反派", degree: 1 },
		{ name: "丙", degree: 1 },
		{ name: "丁", degree: 1 },
		{ name: "戊", degree: 1 },
	];
	const edges: GraphEdgeLike[] = [
		{ a: "主角", b: "甲", weight: 3 },
		{ a: "主角", b: "乙", weight: 1 },
		{ a: "甲", b: "乙", weight: 1 },
		{ a: "反派", b: "丙", weight: 1 },
		{ a: "反派", b: "丁", weight: 1 },
		{ a: "丙", b: "丁", weight: 1 },
		{ a: "戊", b: "丙", weight: 1 },
	];
	const W = 760;
	const H = 560;
	const p = { width: W, height: H, pad: 58 };
	const out = forceLayout(nodes, edges, { ...p, centerName: "反派" }); // 度数不高的人物被指定为中心
	assert.equal(out[0].name, "反派", "中心人物旋到链首");
	assert.ok(Math.abs(out[0].x - W / 2) < 1, `中心横向＝正中，实测 x=${String(out[0].x)}`);
	assert.ok(Math.abs(out[0].y - H / 2) < 1, `中心纵向＝正中（不再上提），实测 y=${String(out[0].y)}`);
	const hub = out.find((q) => q.name === "主角") as GraphLayoutNode;
	const dCenter = Math.hypot(out[0].x - hub.x, out[0].y - hub.y); // 原枢纽被挪开但仍在画布内
	assert.ok(dCenter > 1, "原度数枢纽让位");
	const def = forceLayout(nodes, edges, p);
	assert.equal(def[0].name, "主角", "无 centerName＝度数枢纽居首（现状不变）");
	const fb = forceLayout(nodes, edges, { ...p, centerName: "不存在" });
	assert.equal(fb[0].name, "主角", "中心名字不在点集＝回退度数枢纽");
	assert.deepEqual(fb, def, "回退结果与默认逐字一致");
});

test("forceLayout 收尾会消解硬碰撞：圆点之间不互相压着", () => {
	const nodes: GraphRankNode[] = [
		{ name: "主角", degree: 8 },
		{ name: "甲", degree: 3 },
		{ name: "乙", degree: 3 },
		{ name: "丙", degree: 3 },
		{ name: "丁", degree: 3 },
		{ name: "戊", degree: 2 },
		{ name: "己", degree: 2 },
		{ name: "庚", degree: 2 },
		{ name: "辛", degree: 1 },
	];
	const edges: GraphEdgeLike[] = [
		{ a: "主角", b: "甲", weight: 2 },
		{ a: "主角", b: "乙", weight: 1 },
		{ a: "主角", b: "丙", weight: 1 },
		{ a: "主角", b: "丁", weight: 1 },
		{ a: "主角", b: "戊", weight: 1 },
		{ a: "主角", b: "己", weight: 1 },
		{ a: "主角", b: "庚", weight: 1 },
		{ a: "主角", b: "辛", weight: 1 },
		{ a: "甲", b: "乙", weight: 1 },
		{ a: "丙", b: "丁", weight: 1 },
		{ a: "戊", b: "己", weight: 1 },
		{ a: "庚", b: "辛", weight: 1 },
	];
	const out = forceLayout(nodes, edges, { width: 760, height: 560, pad: 58 });
	for (let i = 0; i < out.length; i++) {
		for (let j = i + 1; j < out.length; j++) {
			const need = out[i].r + out[j].r;
			assert.ok(dist(out[i].x - out[j].x, out[i].y - out[j].y) >= need, `${out[i].name} 与 ${out[j].name} 的圆点重叠`);
		}
	}
});

test("edgeCurvePath 生成二次贝塞尔弧（M…Q…），端点不落在节点圆内", () => {
	const pts = ringLayout(8, CX, CY, RX, RY, [1, 0, 0, 0, 0, 0, 0, 3]);
	const a = pts[0];
	const b = pts[3];
	const d = edgeCurvePath(a, b);
	assert.match(d, /^M -?[\d.]+ -?[\d.]+ Q -?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+$/);
	assert.ok(!d.includes("NaN"));
	const n = nums(d);
	const sx = n[0];
	const sy = n[1];
	const ex = n[4];
	const ey = n[5];
	assert.ok(dist(sx - a.x, sy - a.y) >= a.r, "起点应在节点圆周之外");
	assert.ok(dist(ex - b.x, ey - b.y) >= b.r, "终点应在节点圆周之外");
	assert.ok(dist(sx - a.x, sy - a.y) <= a.r + 4, "起点贴着圆周（留白很小）");
});

test("弧线一律向上拱：弧顶在弦中点之上；竖直弦向侧向拱不退化", () => {
	const pts = ringLayout(12, CX, CY, RX, RY, new Array<number>(12).fill(2));
	for (let i = 0; i < pts.length; i++) {
		for (let j = i + 1; j < pts.length; j++) {
			const a = pts[i];
			const b = pts[j];
			const apex = curvePoint(edgeCurvePath(a, b), 0.5);
			if (!apex) assert.fail(`弧顶解析失败：i=${String(i)} j=${String(j)}`);
			const midX = (a.x + b.x) / 2;
			const midY = (a.y + b.y) / 2;
			if (Math.abs(b.x - a.x) > 1) {
				assert.ok(apex.y < midY - 1, `i=${String(i)} j=${String(j)} 弧没有向上拱`);
			} else {
				assert.ok(apex.x > midX + 1, `i=${String(i)} j=${String(j)} 竖直弦应向右拱、不退化成直线`);
			}
		}
	}
});

test("弧顶不顶出画布上边界（靠近顶部的边自动变平）", () => {
	const pts = ringLayout(12, CX, CY, RX, RY, new Array<number>(12).fill(2));
	let flattened = 0;
	for (let i = 0; i < pts.length; i++) {
		for (let j = i + 1; j < pts.length; j++) {
			const apex = curvePoint(edgeCurvePath(pts[i], pts[j]), 0.5);
			if (!apex) assert.fail("弧顶解析失败");
			assert.ok(apex.y >= 25.9, `i=${String(i)} j=${String(j)} 弧顶越界：y=${String(apex.y)}`);
			const midY = (pts[i].y + pts[j].y) / 2;
			if (midY - apex.y < 5) flattened++; // 被上边界夹平（几乎没有拱起）的边数
		}
	}
	assert.ok(flattened < 60, `不该大面积夹平（夹平 ${String(flattened)} 条）`);
});

test("端点顺序不影响弧的侧向（a/b 交换后弧顶重合）", () => {
	const pts = ringLayout(7, CX, CY, RX, RY, [1, 2, 0, 4, 0, 1, 0]);
	for (let i = 0; i < pts.length; i++) {
		for (let j = i + 1; j < pts.length; j++) {
			const p1 = curvePoint(edgeCurvePath(pts[i], pts[j]), 0.5);
			const p2 = curvePoint(edgeCurvePath(pts[j], pts[i]), 0.5);
			if (!p1 || !p2) assert.fail("弧顶解析失败");
			assert.ok(dist(p1.x - p2.x, p1.y - p2.y) < 0.5, `i=${String(i)} j=${String(j)} 交换端点后弧换边了`);
		}
	}
});

test("竖直弦（上下对径）向右拱，且与端点顺序无关", () => {
	const a = { x: CX, y: CY - RY, r: 12 };
	const b = { x: CX, y: CY + RY, r: 12 };
	const p1 = curvePoint(edgeCurvePath(a, b), 0.5);
	const p2 = curvePoint(edgeCurvePath(b, a), 0.5);
	if (!p1 || !p2) assert.fail("弧顶解析失败");
	assert.ok(p1.x > CX + 1, "竖直弦应向右拱");
	assert.ok(Math.abs(p1.y - CY) < 1, "竖直弦的弧顶仍在竖向中点高度");
	assert.ok(dist(p1.x - p2.x, p1.y - p2.y) < 0.5, "交换端点后竖直弦换了边");
});

test("节点重叠时端点不会推过对方圆周（不留扎进圆里的怪线头）", () => {
	const a = { x: 100, y: 300, r: 20 };
	const b = { x: 118, y: 300, r: 20 }; // 两个圆互相压着
	const d = edgeCurvePath(a, b);
	assert.ok(!d.includes("NaN"));
	const n = nums(d);
	assert.ok(dist(n[0] - a.x, n[1] - a.y) <= a.r + 3, "起点的推力应按对方圆周收敛");
	assert.ok(dist(n[4] - b.x, n[5] - b.y) <= b.r + 3, "终点同理");
});

test("重合点与超长弦都不产生 NaN，凸出量按上限收敛", () => {
	const same = { x: CX + 40, y: CY, r: 5 };
	const d0 = edgeCurvePath(same, same);
	assert.ok(!d0.includes("NaN"));
	const far = edgeCurvePath({ x: CX - 2000, y: CY, r: 5 }, { x: CX + 2000, y: CY, r: 5 });
	const apex = curvePoint(far, 0.5);
	if (!apex) assert.fail(`弧顶解析失败：${far}`);
	assert.ok(apex.y <= CY - 20, "超长水平弦应向上拱");
	assert.ok(CY - apex.y <= 26, "凸出量应夹在上限内（弧顶＝控制点偏移的一半）");
});
