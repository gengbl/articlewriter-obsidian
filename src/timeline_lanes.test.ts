import test from "node:test";
import assert from "node:assert/strict";
import { assignTlLaneXs, type TlLaneInterval } from "./timeline_lanes";

// v0.4.11+ 子时间线轨道通道分配（用户要求＝「连续轨道＋小出针」＋处理「不同一级事件的子时间线在时间上重叠」）
const it = (id: string, parentId: string | null, top: number, bottom: number): TlLaneInterval => ({ id, parentId, top, bottom });

test("一级事件的子轨道＝主轴 X ＋ 一个列距", () => {
	const m = assignTlLaneXs([it("a", null, 100, 300)], 4, 56, 8);
	assert.equal(m.get("a"), 60);
});

test("时间上互不重叠的两棵子树复用同一条通道（不无谓右移）", () => {
	const m = assignTlLaneXs([it("a", null, 0, 100), it("b", null, 200, 320)], 4, 56, 8);
	assert.equal(m.get("a"), 60);
	assert.equal(m.get("b"), 60);
});

test("时间上重叠的两棵子树各占一条通道（用户要求＝不同一级事件的子时间线不得糊成一条）", () => {
	const m = assignTlLaneXs([it("a", null, 0, 300), it("b", null, 100, 400)], 4, 56, 8);
	assert.equal(m.get("a"), 60);
	assert.equal(m.get("b"), 116);
});

test("纵向间距小于安全间距 vgap 也算重叠（两段几乎相接的同列线＝视觉上仍是一条）", () => {
	const tight = assignTlLaneXs([it("a", null, 0, 100), it("b", null, 105, 200)], 4, 56, 8);
	assert.equal(tight.get("b"), 116);
	const loose = assignTlLaneXs([it("a", null, 0, 100), it("b", null, 110, 200)], 4, 56, 8);
	assert.equal(loose.get("b"), 60);
});

test("更深一层以父轨道为基准递推（先序传入＝父的已分配 X 可用）", () => {
	const m = assignTlLaneXs([it("a", null, 0, 400), it("a1", "a", 50, 400)], 4, 56, 8);
	assert.equal(m.get("a"), 60);
	assert.equal(m.get("a1"), 116); // 60 ＋ step
});

test("三条互相重叠的轨道依次右移一个列距", () => {
	const m = assignTlLaneXs([it("a", null, 0, 300), it("b", null, 50, 350), it("c", null, 100, 400)], 4, 56, 8);
	assert.equal(m.get("a"), 60);
	assert.equal(m.get("b"), 116);
	assert.equal(m.get("c"), 172);
});

test("先占用的窄通道不会把后来者无限右推（局部性＝只与同 X 上已放置的轨道比较）", () => {
	const m = assignTlLaneXs([it("a", null, 0, 300), it("b", null, 50, 120), it("c", null, 400, 500)], 4, 56, 8);
	assert.equal(m.get("a"), 60);
	assert.equal(m.get("b"), 116);
	assert.equal(m.get("c"), 60); // a 的区间早已结束、b 在另一条 X 上 ⇒ c 复用 60
});

test("空输入＝空映射（全是叶子事件时不产生任何轨道）", () => {
	assert.equal(assignTlLaneXs([], 4, 56, 8).size, 0);
});
