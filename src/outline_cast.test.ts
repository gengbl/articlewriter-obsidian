// v0.4.3+ 大纲阶段人物/关系增量分层纯逻辑测试：
// 附录拆分（分隔行容错/无附录/非法 JSON）、附录要求文本、逐章定层与提升（章→卷→书）、
// 目标层不存在时跳过、既有条目字段不被覆盖、既有关系不被动、平铺模式两级。
import test from "node:test";
import assert from "node:assert/strict";

import { OutlineCastTracker, OUTLINE_CAST_APPENDIX_MARK, outlineCastAppendixInstruction, outlineCastLayerKey, splitOutlineCastAppendix } from "./outline_cast";
import type { CastChapterAnalysis } from "./cast_analyzer";
import type { CharacterDoc, RelationshipEntry } from "./md_docs";

const cast = (characters: string[], relationships: Array<[string, string]> = []): CastChapterAnalysis => ({
	characters: characters.map((name) => ({ name, abilities: [] })),
	scenes: [],
	relationships: relationships.map(([a, b]) => ({ a, b })),
});

const emptyLayers = (chapterKeys: string[]): {
	characters: Array<{ ref: { scope: "book" } | { scope: "volume"; volId: string } | { scope: "chapter"; chapterKey: string }; entries: Record<string, CharacterDoc> }>;
	relationships: Array<{ ref: { scope: "book" } | { scope: "volume"; volId: string } | { scope: "chapter"; chapterKey: string }; entries: RelationshipEntry[] }>;
} => ({
	characters: [
		{ ref: { scope: "book" }, entries: {} },
		{ ref: { scope: "volume", volId: "v1" }, entries: {} },
		...chapterKeys.map((chapterKey) => ({ ref: { scope: "chapter" as const, chapterKey }, entries: {} })),
	],
	relationships: [
		{ ref: { scope: "book" }, entries: [] },
		{ ref: { scope: "volume", volId: "v1" }, entries: [] },
		...chapterKeys.map((chapterKey) => ({ ref: { scope: "chapter" as const, chapterKey }, entries: [] })),
	],
});

void test("splitOutlineCastAppendix 拆出正文与附录；无分隔行原样返回；附录非法 JSON 时 cast=null", () => {
	const raw = `## 第2章 桥下\n\n- 本章目标：交易\n\n${OUTLINE_CAST_APPENDIX_MARK}\n{"characters":[{"name":"甲"}],"relationships":[{"a":"甲","b":"乙"}]}`;
	const r = splitOutlineCastAppendix(raw);
	assert.match(r.body, /本章目标：交易/);
	assert.doesNotMatch(r.body, /人物关系附录/);
	assert.equal(r.cast?.characters[0].name, "甲");
	assert.equal(r.cast?.relationships[0].b, "乙");

	const plain = splitOutlineCastAppendix("只有大纲正文");
	assert.equal(plain.body, "只有大纲正文");
	assert.equal(plain.cast, null);

	const bad = splitOutlineCastAppendix(`正文\n**人物关系附录**\n不是 JSON`);
	assert.equal(bad.body, "正文", "装饰写法的分隔行也能识别");
	assert.equal(bad.cast, null);
});

void test("outlineCastAppendixInstruction 含分隔行/字段模板/已知人名约束", () => {
	const text = outlineCastAppendixInstruction(["甲", "乙", "甲"]);
	assert.ok(text.includes(OUTLINE_CAST_APPENDIX_MARK));
	assert.match(text, /"characters"/);
	assert.match(text, /"relationships"/);
	assert.match(text, /已知规范人名（务必沿用同一写法）：甲、乙$/m);
});

void test("同一人物跨章出现：章级 → 卷级提升（原章级副本移除）", () => {
	const layers = emptyLayers(["v1:1", "v1:2"]);
	const tracker = new OutlineCastTracker({ useVolumes: true, ...layers });
	const r1 = tracker.ingest("v1:1", cast(["甲"]));
	const chapterLayer1 = r1.characterWrites.find((l) => outlineCastLayerKey(l.ref) === "chapter:v1:1");
	assert.ok(chapterLayer1?.entries["甲"], "仅 1 章 → 章级");

	const r2 = tracker.ingest("v1:2", cast(["甲"]));
	const volLayer = r2.characterWrites.find((l) => outlineCastLayerKey(l.ref) === "volume:v1");
	const chapter1 = r2.characterWrites.find((l) => outlineCastLayerKey(l.ref) === "chapter:v1:1");
	assert.ok(volLayer?.entries["甲"], "同卷 2 章 → 卷级");
	assert.equal(chapter1?.entries["甲"], undefined, "章级副本被移除");
	assert.equal(r2.writtenCharacters, 1);
});

void test("跨卷出现 → 书级；书级既有条目不降级", () => {
	const layers = emptyLayers(["v1:1"]);
	layers.characters.push({ ref: { scope: "volume", volId: "v2" }, entries: { 甲: { name: "甲", chapter: 0, abilities: [], identity: "旧身份" } } });
	layers.relationships.push({ ref: { scope: "volume", volId: "v2" }, entries: [] });
	const tracker = new OutlineCastTracker({ useVolumes: true, ...layers });
	const r = tracker.ingest("v1:1", cast(["甲"]));
	const book = r.characterWrites.find((l) => outlineCastLayerKey(l.ref) === "book");
	assert.ok(book?.entries["甲"], "两个容器 → 书级");
	assert.equal(book?.entries["甲"].identity, "旧身份", "既有非空字段优先保留");
	assert.ok(r.characterWrites.some((l) => outlineCastLayerKey(l.ref) === "volume:v2" && !l.entries["甲"]), "其他卷副本被移除");

	const bookOnly = emptyLayers(["v1:1"]);
	bookOnly.characters[0].entries["甲"] = { name: "甲", chapter: 0, abilities: [] };
	const t2 = new OutlineCastTracker({ useVolumes: true, ...bookOnly });
	const r2 = t2.ingest("v1:1", cast(["甲"]));
	assert.ok(r2.characterWrites.find((l) => outlineCastLayerKey(l.ref) === "book")?.entries["甲"], "既有书级条目保持书级");
});

void test("平铺模式（无卷）跨章 → 书级，单章 → 章级", () => {
	const layers = emptyLayers(["1", "2"]);
	const tracker = new OutlineCastTracker({ useVolumes: false, ...layers });
	tracker.ingest("1", cast(["甲"]));
	const r = tracker.ingest("2", cast(["甲"]));
	assert.ok(r.characterWrites.find((l) => outlineCastLayerKey(l.ref) === "book")?.entries["甲"]);
	const single = tracker.ingest("2", cast(["乙"]));
	const ch2 = single.characterWrites.find((l) => outlineCastLayerKey(l.ref) === "chapter:2");
	assert.ok(ch2?.entries["乙"]);
});

void test("目标章级层不存在（章节未创建）→ 跳过并保留出现记录，补注册后落盘", () => {
	const layers = emptyLayers([]); // 无章节目录
	const tracker = new OutlineCastTracker({ useVolumes: true, ...layers });
	const r1 = tracker.ingest("v1:1", cast(["甲"]));
	assert.deepEqual(r1.skipped, ["甲"]);
	assert.equal(r1.characterWrites.length, 0);
	tracker.registerChapter("v1:1");
	const r2 = tracker.ingest("v1:1", cast(["甲"]));
	assert.ok(r2.characterWrites.find((l) => outlineCastLayerKey(l.ref) === "chapter:v1:1")?.entries["甲"]);
});

void test("关系：本运行新建可随跨章提升；盘上既有关系保持原层不动", () => {
	const layers = emptyLayers(["v1:1", "v1:2"]);
	layers.relationships[2].entries.push({ a: "丙", b: "丁", type: "旧", status: "", desc: "" }); // 盘上既有（章级）
	const tracker = new OutlineCastTracker({ useVolumes: true, ...layers });
	tracker.ingest("v1:1", cast(["甲", "乙"], [["甲", "乙"], ["丙", "丁"]]));
	const r2 = tracker.ingest("v1:2", cast(["甲", "乙"], [["甲", "乙"], ["丙", "丁"]]));
	const vol = r2.relationshipWrites.find((l) => outlineCastLayerKey(l.ref) === "volume:v1");
	assert.ok(vol?.entries.some((e) => e.a === "甲" && e.b === "乙"), "本运行新建的关系提升到卷级");
	const seeded = r2.relationshipWrites.find((l) => outlineCastLayerKey(l.ref) === "chapter:v1:1");
	assert.ok(seeded?.entries.some((e) => e.a === "丙" && e.b === "丁"), "既有关系不被提升/清除");
});
