import test from "node:test";
import assert from "node:assert/strict";

import { PIPELINE_STAGES, requirementsFor, stageById, stagesFrom, type StageId } from "./pipeline";

void test("PIPELINE_STAGES lists the six stages in execution order", () => {
	const ids = PIPELINE_STAGES.map((s) => s.id);
	assert.deepEqual(ids, ["worldview", "planning", "book-outline", "volumes", "chapter-outlines", "bodies"]);
	for (const s of PIPELINE_STAGES) assert.ok(s.name.length > 0 && s.command.length > 0);
});

void test("stagesFrom returns the tail sequence from the given start node (inclusive)", () => {
	assert.deepEqual(stagesFrom("worldview").map((s) => s.id), ["worldview", "planning", "book-outline", "volumes", "chapter-outlines", "bodies"]);
	assert.deepEqual(stagesFrom("chapter-outlines").map((s) => s.id), ["chapter-outlines", "bodies"]);
	assert.deepEqual(stagesFrom("bodies").map((s) => s.id), ["bodies"]);
});

void test("stagesFrom honours stopAt (inclusive); stop before start yields empty", () => {
	assert.deepEqual(stagesFrom("worldview", "planning").map((s) => s.id), ["worldview", "planning"]);
	assert.deepEqual(stagesFrom("book-outline", "book-outline").map((s) => s.id), ["book-outline"]);
	assert.deepEqual(stagesFrom("volumes", "bodies").map((s) => s.id), ["volumes", "chapter-outlines", "bodies"]);
	assert.deepEqual(stagesFrom("planning", "worldview"), []); // 停止节点排在起始节点之前＝空序列
});

void test("requirementsFor filters when=modes and returns only the start stage's requirements", () => {
	// 分卷模式：volumes 需求含卷声明检查、不含平铺拆书级大纲检查
	const volReqs = requirementsFor("volumes", false).map((r) => r.id);
	assert.ok(volReqs.includes("worldview") && volReqs.includes("book-outline") && volReqs.includes("book-outline-volume-decls"));
	assert.ok(!volReqs.includes("book-outline-chapters"));
	// 平铺模式：chapter-outlines 需求查书级大纲章标记、不查各卷卷大纲
	const flatReqs = requirementsFor("chapter-outlines", true).map((r) => r.id);
	assert.ok(flatReqs.includes("book-outline-chapters") && flatReqs.includes("worldview"));
	assert.ok(!flatReqs.includes("volumes"));
	// worldview 无前置：任何模式都可直接开始
	assert.deepEqual(requirementsFor("worldview", false), []);
	assert.deepEqual(requirementsFor("worldview", true), []);
});

void test("stageById throws on unknown id, every declared stage id resolves", () => {
	assert.equal(stageById("bodies").name, "连续编写正文");
	for (const id of ["worldview", "planning", "book-outline", "volumes", "chapter-outlines", "bodies"] as StageId[]) {
		assert.equal(stageById(id).id, id);
	}
	assert.throws(() => stageById("nope" as StageId), /未知流水线阶段/);
});
