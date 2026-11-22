import test from "node:test";
import assert from "node:assert/strict";

import { buildOutlineTree, countSubtree, flattenOutlineOrdered, subtreeHas } from "./outline_tree";

/** 测试用条目：只需 level（挂父口径）＋name（断言可读）＋可选 t（时间序断言用） */
type Item = { level: number; name: string; t?: number };

const names = (nodes: Array<{ item: Item }>): string[] => nodes.map((n) => n.item.name);
const timeCmp = (a: Item, b: Item): number => (a.t ?? 0) - (b.t ?? 0);
const rowNames = (rows: Array<{ node: { item: Item } }>): string[] => rows.map((r) => r.node.item.name);
const rowDepths = (rows: Array<{ depth: number }>): number[] => rows.map((r) => r.depth);

void test("buildOutlineTree：父＝其前最近一条级别更小的条目（跳级也算挂在最近的更浅级下）", () => {
	const forest = buildOutlineTree([
		{ level: 1, name: "A" },
		{ level: 2, name: "A1" },
		{ level: 3, name: "A1a" }, // 跳级（父不是 A1 也行）＝仍挂在栈顶 A1 下
		{ level: 2, name: "A2" }, // 级别回落＝弹出到 A 之下，成为 A 的第二个子
		{ level: 1, name: "B" }, // 更高级别出现＝前面的分支收尾，B 自成一棵根
	]);
	assert.deepEqual(names(forest), ["A", "B"], "森林根＝A、B");
	assert.deepEqual(names(forest[0].children), ["A1", "A2"], "A 的两个子＝A1、A2");
	assert.deepEqual(names(forest[0].children[0].children), ["A1a"], "跳级的 A1a 仍挂在 A1 下");
	assert.deepEqual(names(forest[1].children), [], "B 无子（A 的分支不因 B 而挂上去）");
});

void test("buildOutlineTree：序列开头就是深层级时无人可挂＝按根处理（旧数据缺一级标题也不丢条目）", () => {
	const forest = buildOutlineTree([{ level: 3, name: "X" }, { level: 2, name: "Y" }]);
	assert.deepEqual(names(forest), ["X", "Y"], "两条都是根（没有更早的更浅级可当父）");
});

void test("countSubtree：含自身（删除确认「连同 N 条」文案用）", () => {
	const forest = buildOutlineTree([{ level: 1, name: "A" }, { level: 2, name: "A1" }, { level: 3, name: "A1a" }]);
	assert.equal(countSubtree(forest[0]), 3, "A＋A1＋A1a＝3");
	assert.equal(countSubtree(forest[0].children[0]), 2, "A1＋A1a＝2");
});

void test("subtreeHas：自身命中／任一后代命中＝保留该支（v0.4.9+ 树挂视图筛选＝整支不命中才剪掉）", () => {
	const forest = buildOutlineTree([
		{ level: 1, name: "A" },
		{ level: 2, name: "A1" },
		{ level: 3, name: "A1a" },
		{ level: 1, name: "B" },
		{ level: 2, name: "B1" },
	]);
	const [a, b] = forest;
	const hit = (kw: string): ((it: Item) => boolean) => {
		const k = kw.toLowerCase(); // 关键词也转小写（面板 matchRow 同一口径）
		return (it: Item): boolean => it.name.toLowerCase().includes(k);
	};
	assert.ok(subtreeHas(a, hit("a1a")), "只有最深层后代命中＝整条 A 支保留（祖先链跟着出来）");
	assert.ok(subtreeHas(a, hit("A")), "自身命中＝直接为真");
	assert.ok(!subtreeHas(b, hit("a")), "B 支全部不命中＝可整支剪掉（不留一条不命中事件带着空侧枝占屏）");
	assert.ok(subtreeHas(b, hit("b1")), "B 的侧枝里命中＝B 支保留");
});

void test("flattenOutlineOrdered：父事件与子事件一起按时间全局升序（晚于后一条一级事件的子事件不再压在上面）", () => {
	const forest = buildOutlineTree([
		{ level: 1, name: "A", t: 100 },
		{ level: 2, name: "A1", t: 500 }, // A 的子事件晚于 B
		{ level: 1, name: "B", t: 200 },
		{ level: 2, name: "B1", t: 300 },
	]);
	const rows = flattenOutlineOrdered(forest, timeCmp);
	assert.deepEqual(rowNames(rows), ["A", "B", "B1", "A1"], "B（200）插到 A（100）与 A1（500）之间＝Y 值按时间");
	assert.deepEqual(rowDepths(rows), [0, 0, 1, 1], "深度跟着节点走（层级只影响缩进/列，不影响时间序）");
});

void test("flattenOutlineOrdered：子事件时间早于父事件时也严格按时间（不会把早的压在晚的下面）", () => {
	const forest = buildOutlineTree([
		{ level: 1, name: "A", t: 100 },
		{ level: 2, name: "A1", t: 50 }, // 数据异常：子事件早于父事件
		{ level: 1, name: "B", t: 200 },
	]);
	const rows = flattenOutlineOrdered(forest, timeCmp);
	assert.deepEqual(rowNames(rows), ["A1", "A", "B"], "时间序优先：A1（50）在 A（100）之上");
	assert.deepEqual(rowDepths(rows), [1, 0, 0], "A1 仍按结构深度缩进到子级列");
});

void test("flattenOutlineOrdered：同刻条目稳定保持先序（父先于子、兄弟保持文档序）", () => {
	const forest = buildOutlineTree([
		{ level: 1, name: "A", t: 100 },
		{ level: 2, name: "A1", t: 100 },
		{ level: 2, name: "A2", t: 100 },
		{ level: 1, name: "B", t: 100 },
	]);
	const rows = flattenOutlineOrdered(forest, timeCmp);
	assert.deepEqual(rowNames(rows), ["A", "A1", "A2", "B"], "同刻＝稳定排序，父在子前");
});

void test("flattenOutlineOrdered：keep 整支剪枝／descend 保留自身不下钻（筛选与折叠口径）", () => {
	const forest = buildOutlineTree([
		{ level: 1, name: "A", t: 100 },
		{ level: 2, name: "A1", t: 150 },
		{ level: 3, name: "A1a", t: 160 },
		{ level: 2, name: "A2", t: 200 },
		{ level: 1, name: "B", t: 300 },
	]);
	const pruned = flattenOutlineOrdered(forest, timeCmp, { keep: (n) => n.item.name !== "A1" });
	assert.deepEqual(rowNames(pruned), ["A", "A2", "B"], "keep=false 的 A1 连同后代 A1a 整支不出现");
	const folded = flattenOutlineOrdered(forest, timeCmp, { descend: (n) => n.item.name !== "A" });
	assert.deepEqual(rowNames(folded), ["A", "B"], "descend=false 只保留 A 自身，不下钻其子树");
});
