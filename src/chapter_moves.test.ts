import test from "node:test";
import assert from "node:assert/strict";

import { hasAnyGap, planInsert, planRenumber } from "./chapter_moves";

void test("planRenumber: 补洞压缩为 1..N，升序单遍、只挪真正变号的章", () => {
	const plan = planRenumber([{ key: "5", num: 5 }, { key: "1", num: 1 }, { key: "9", num: 9 }, { key: "3", num: 3 }]);
	assert.deepEqual([...plan.map.entries()], [[1, 1], [3, 2], [5, 3], [9, 4]]);
	// 升序单遍：3→2 先走，5→3 的目标位刚被腾出，9→4 同理——任何一步的目标位在彼时必空
	assert.deepEqual(plan.steps, [
		{ key: "3", from: 3, to: 2 },
		{ key: "5", from: 5, to: 3 },
		{ key: "9", from: 9, to: 4 },
	]);
	assert.equal(plan.alreadySequential, false);
});

void test("planRenumber: 已连续则零步（幂等 no-op）", () => {
	const plan = planRenumber([{ key: "1", num: 1 }, { key: "2", num: 2 }]);
	assert.equal(plan.alreadySequential, true);
	assert.equal(plan.steps.length, 0);
});

void test("hasAnyGap: 断档判定（1,2,4＝有洞；1,2,3＝无洞；空＝无洞）", () => {
	assert.equal(hasAnyGap([1, 2, 4]), true);
	assert.equal(hasAnyGap([1, 2, 3]), false);
	assert.equal(hasAnyGap([]), false);
});

void test("planInsert: 空位直插不动任何人；占位则 ≥插入号全体 +1 且降序执行（目标位必空、无临时槽）", () => {
	const free = planInsert([1, 2, 4, 5], 3); // 断档空位
	assert.equal(free.collision, false);
	assert.equal(free.shifts.length, 0);

	const hit = planInsert([1, 2, 3, 4], 3); // 「第3章」被占
	assert.equal(hit.collision, true);
	assert.deepEqual(hit.shifts, [
		{ from: 4, to: 5 },
		{ from: 3, to: 4 },
	]); // 降序：先 4→5 腾空 5，再 3→4——执行序任何时刻目标位无主
});

void test("planInsert: 插到末位之后＝追加不挪动；末尾之前全体顺延", () => {
	assert.equal(planInsert([1, 2, 3], 4).collision, false);
	const p = planInsert([1, 2, 3], 2);
	assert.deepEqual(p.shifts.map((s) => s.from), [3, 2]);
});
