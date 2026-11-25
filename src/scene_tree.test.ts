import { test } from "node:test";
import assert from "node:assert/strict";

import {
	buildSceneTree,
	flattenSceneTree,
	sceneDescendantIds,
	sceneRowMatches,
	sceneSubtreeCount,
	TREE_PANEL_CHROME,
	TREE_PANEL_LIST_MAX,
	TREE_PANEL_LIST_MIN,
	treePanelPlacement,
} from "./scene_tree";

// 常用样例：城（根）→ 城门/城主府（子）→ 后院（孙）；另有孤儿与自指各一个
const FOREST = [
	{ id: "城", label: "黑石城" },
	{ id: "城门", label: "城门", parent: "城" },
	{ id: "城主府", label: "城主府", parent: "城" },
	{ id: "后院", label: "后院", parent: "城主府" },
	{ id: "野渡", label: "野渡" },
];

void test("buildSceneTree：根按传入顺序、子按出现顺序挂到父下", () => {
	const { roots } = buildSceneTree(FOREST);
	assert.deepEqual(roots.map((r) => r.id), ["城", "野渡"]);
	assert.deepEqual(roots[0].children.map((c) => c.id), ["城门", "城主府"]);
	assert.deepEqual(roots[0].children[1].children.map((c) => c.id), ["后院"]);
});

void test("buildSceneTree：同 id 重复只留首个", () => {
	const { roots } = buildSceneTree([{ id: "a", label: "A" }, { id: "a", label: "AA" }]);
	assert.equal(roots.length, 1);
	assert.equal(roots[0].label, "A");
});

void test("buildSceneTree：parent 指向不存在的 id／等于自身＝当根（孤儿不丢）", () => {
	const { roots } = buildSceneTree([{ id: "x", label: "X", parent: "不存在" }, { id: "s", label: "S", parent: "s" }]);
	assert.deepEqual(roots.map((r) => r.id).sort(), ["s", "x"]);
});

void test("buildSceneTree：手写父链成环（A→B→A）不死循环，断掉回边、整圈标 cyclic", () => {
	const { roots, cyclicIds } = buildSceneTree([
		{ id: "a", label: "A", parent: "b" },
		{ id: "b", label: "B", parent: "a" },
	]);
	// 走到 a→b 时发现「b 的父 a」已在本链上＝回边：断掉 b 那条入边＝b 升为根、a 挂在 b 下
	assert.deepEqual(roots.map((r) => r.id), ["b"]);
	assert.deepEqual(roots[0].children.map((c) => c.id), ["a"]);
	assert.deepEqual([...cyclicIds].sort(), ["a", "b"]); // 两个都不能选＝选了照样写出环
});

void test("sceneDescendantIds：含自身＋全部子孙（跨层递归）", () => {
	const ids = sceneDescendantIds(FOREST, "城");
	assert.deepEqual([...ids].sort(), ["后院", "城", "城主府", "城门"]); // 只核对集合＝出集合顺序是实现细节、不锁死
	assert.deepEqual([...sceneDescendantIds(FOREST, "野渡")], ["野渡"]);
	assert.deepEqual([...sceneDescendantIds(FOREST, "不存在的场景")], ["不存在的场景"]); // 自身恒排除
});

void test("sceneSubtreeCount：含自身的子树规模", () => {
	const { roots } = buildSceneTree(FOREST);
	assert.equal(sceneSubtreeCount(roots[0]), 4);
	assert.equal(sceneSubtreeCount(roots[0].children[1]), 2);
});

void test("flattenSceneTree：DFS 顺序＋depth 缩进＋kidCount＋path 祖先链", () => {
	const rows = flattenSceneTree(FOREST);
	assert.deepEqual(
		rows.map((r) => [r.id, r.depth, r.kidCount, r.path.join("/")]),
		[
			["城", 0, 3, ""],
			["城门", 1, 0, "黑石城"],
			["城主府", 1, 1, "黑石城"],
			["后院", 2, 0, "黑石城/城主府"],
			["野渡", 0, 0, ""],
		]
	);
	assert.deepEqual(rows.map((r) => r.hasKids), [true, false, true, false, false]);
	assert.deepEqual(rows.map((r) => r.ancIds), [[], ["城"], ["城"], ["城", "城主府"], []]); // 祖先 id 链＝调用方把「当前值那条支」默认展开用
});

void test("flattenSceneTree：excludeIds＝整支剪掉（父场景候选防环后不留孤儿子树）", () => {
	const rows = flattenSceneTree(FOREST, { excludeIds: new Set(["城"]) });
	assert.deepEqual(rows.map((r) => r.id), ["野渡"]);
	const one = flattenSceneTree(FOREST, { excludeIds: new Set(["城主府"]) });
	assert.deepEqual(one.map((r) => r.id), ["城", "城门", "野渡"]);
});

void test("flattenSceneTree：搜索＝命中项＋全部祖先保留（保持层级）＋命中项的后代也在", () => {
	const rows = flattenSceneTree(FOREST, { query: "后院" });
	assert.deepEqual(
		rows.map((r) => [r.id, r.depth]),
		[
			["城", 0],
			["城主府", 1],
			["后院", 2],
		]
	);
	const byLabel = flattenSceneTree(FOREST, { query: "黑石" }); // 按显示名搜
	assert.deepEqual(byLabel.map((r) => r.id), ["城", "城门", "城主府", "后院"]); // 命中根＝整支都在
	assert.deepEqual(flattenSceneTree(FOREST, { query: "没有这种东西" }).map((r) => r.id), []);
	assert.equal(flattenSceneTree(FOREST, { query: "  " }).length, 5); // 空白查询＝不过滤
	// 子树规模/命中判定＝记忆化（v0.4.11+ 防 O(n²)）＝口径必须与逐次重算一致：
	// kidCount 恒＝**完整子树规模**（不随搜索剪枝变小）、同一入参重跑结果不变（memo 不跨调用污染）
	assert.deepEqual(rows.map((r) => r.kidCount), [3, 1, 0]);
	assert.deepEqual(flattenSceneTree(FOREST).map((r) => r.kidCount), [3, 0, 1, 0, 0]);
	assert.deepEqual(flattenSceneTree(FOREST, { query: "后院" }).map((r) => r.id), rows.map((r) => r.id));
});

void test("buildSceneTree：自指与「父链通向环」也标 cyclic（链上的普通祖先不受牵连）", () => {
	const { roots, cyclicIds } = buildSceneTree([
		{ id: "root", label: "R" },
		{ id: "mid", label: "M", parent: "root" }, // 正常祖先：其子成环不影响它
		{ id: "s", label: "S", parent: "s" }, // 自指
		{ id: "under", label: "U", parent: "s" }, // 挂在环下
	]);
	assert.deepEqual(roots.map((r) => r.id), ["root", "s"]);
	assert.deepEqual([...cyclicIds].sort(), ["s", "under"]);
	assert.deepEqual(roots[1].children.map((c) => c.id), ["under"]);
});

void test("buildSceneTree：三个节点绕一圈（A→B→C→A）＝只断回边一条、整圈标 cyclic", () => {
	const { roots, cyclicIds } = buildSceneTree([
		{ id: "a", label: "A", parent: "b" },
		{ id: "b", label: "B", parent: "c" },
		{ id: "c", label: "C", parent: "a" },
	]);
	assert.deepEqual(roots.map((r) => r.id), ["c"]); // 回边是「c→a」＝断 c、c 升为根，其余顺边挂（a 挂 c、b 挂 a）
	assert.deepEqual(roots[0].children.map((x) => x.id), ["b"]); // 断掉的回边是「c→a」＝c 升为根，b 挂 c、a 挂 b（顺着各自的父边）
	assert.deepEqual(roots[0].children[0].children.map((x) => x.id), ["a"]);
	assert.deepEqual([...cyclicIds].sort(), ["a", "b", "c"]);
	assert.deepEqual(flattenSceneTree([
		{ id: "a", label: "A", parent: "b" },
		{ id: "b", label: "B", parent: "c" },
		{ id: "c", label: "C", parent: "a" },
	]).map((r) => r.cyclic), [true, true, true]);
});

void test("flattenSceneTree：环数据不炸、只多缩一层不乱排、整支标 cyclic（连「b」也不能选＝选了照样成环）", () => {
	const rows = flattenSceneTree([
		{ id: "a", label: "A", parent: "b" },
		{ id: "b", label: "B", parent: "a" },
		{ id: "c", label: "C", parent: "b" },
	]);
	assert.deepEqual(rows.map((r) => [r.id, r.depth, r.cyclic]), [
		["b", 0, true], // 断掉回边「b→a」＝b 顶到最上，a、c 仍按各自的父挂在下面
		["a", 1, true],
		["c", 1, true],
	]);
});

void test("sceneRowMatches：id 或显示名小写包含、空查询恒真", () => {
	assert.ok(sceneRowMatches({ id: "gate", label: "城门" }, "GATE"));
	assert.ok(sceneRowMatches({ id: "gate", label: "城门" }, "城"));
	assert.ok(!sceneRowMatches({ id: "gate", label: "城门" }, "桥"));
	assert.ok(sceneRowMatches({ id: "gate", label: "城门" }, "   "));
});

// ---------- v0.4.11+ treePanelPlacement（弹窗内「树形候选面板被裁掉」修复的纯算法侧；裁切边界＝.modal-content） ----------

void test("treePanelPlacement：下方空间充裕＝放下方、列表用默认封顶（绝不比 240 更高）", () => {
	const p = treePanelPlacement({ top: 300, bottom: 340 }, { top: 100, bottom: 900 }); // 下方剩 560
	assert.equal(p.flipUp, false);
	assert.equal(p.listMaxH, TREE_PANEL_LIST_MAX);
});

void test("treePanelPlacement：下方放不下（<150）而上方宽裕＝翻上方；两侧都不够＝不翻但列表压到下限（面板仍在＝只剩搜索框最坑）", () => {
	const up = treePanelPlacement({ top: 700, bottom: 740 }, { top: 60, bottom: 800 }); // 下方 60／上方 640
	assert.equal(up.flipUp, true);
	assert.equal(up.listMaxH, TREE_PANEL_LIST_MAX); // 640−46＝594 → 夹回 240
	const tight = treePanelPlacement({ top: 700, bottom: 740 }, { top: 640, bottom: 800 }); // 下方 60／上方 60
	assert.equal(tight.flipUp, false); // 上方不比下方宽裕＝别无谓翻（翻了照样放不下）
	assert.equal(tight.listMaxH, TREE_PANEL_LIST_MIN);
});

void test("treePanelPlacement：可用高卡在中间＝列表按「可用高 − 固定开销」封顶＝行不会被裁进看不见也滚不到的地方", () => {
	const p = treePanelPlacement({ top: 500, bottom: 540 }, { top: 0, bottom: 700 }); // 下方 160 ≥150＝留在下方
	assert.equal(p.flipUp, false);
	assert.equal(p.listMaxH, 700 - 540 - TREE_PANEL_CHROME);
});

void test("treePanelPlacement：尺寸异常（NaN／宿主比边界还大）＝按「下方＋下限」兜底，绝不把面板搞没", () => {
	assert.deepEqual(treePanelPlacement({ top: NaN, bottom: 10 }, { top: 0, bottom: 10 }), { flipUp: false, listMaxH: TREE_PANEL_LIST_MAX });
	const tight = treePanelPlacement({ top: 200, bottom: 300 }, { top: 250, bottom: 260 }); // 宿主比裁切边界还大＝两侧可用高都是 0
	assert.equal(tight.flipUp, false);
	assert.equal(tight.listMaxH, TREE_PANEL_LIST_MIN); // 仍留下限＝面板至少看得见几行
});
