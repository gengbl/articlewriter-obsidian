import test from "node:test";
import assert from "node:assert/strict";

import { parseBannedWordsMd } from "./banned_words";
import { applySensitiveMarks, findSensitiveHits, groupSensitiveHits, renderSensitiveReportSection } from "./sensitive_words";

const LIST = [
	"# 敏感词清单",
	"",
	"## 色情低俗",
	"",
	"- 「啪啪」：低俗用语",
	"- 「上床」：直白性描写",
	"## 暴力血腥",
	"- 「割喉」：血腥方式细节",
	"## 变体正则",
	"- `吸\\s*毒` → 吸毒",
	"",
].join("\n");

void test("findSensitiveHits: 逐词多命中带分类/行号/片段，按位置排序", () => {
	const data = parseBannedWordsMd(LIST);
	const text = "第一行正常。\n他掐住她的脖子，说要在床上上床。\n刀光一闪，割喉倒地，割喉收尾。";
	const hits = findSensitiveHits(text, data);
	assert.equal(hits.length, 3); // 上床×1 + 割喉×2
	assert.deepEqual(hits.map((h) => h.word), ["上床", "割喉", "割喉"]);
	assert.equal(hits[0].category, "色情低俗");
	assert.equal(hits[1].category, "暴力血腥");
	assert.equal(hits[0].line, 2);
	assert.equal(hits[1].line, 3);
	assert.ok(hits[1].excerpt.includes("割喉倒地"), "片段含命中上下文");
});

void test("findSensitiveHits: 变体正则节命中归「变体正则」分类", () => {
	const data = parseBannedWordsMd(LIST);
	const hits = findSensitiveHits("他在吸 毒。", data);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].category, "变体正则");
	assert.equal(hits[0].word, "吸毒");
});

void test("applySensitiveMarks: 从后往前包 span，落盘→剥离往返无损（span 形状与 stripAiWordMarks 同步）", () => {
	const data = parseBannedWordsMd(LIST);
	const text = "上床与割喉";
	const hits = findSensitiveHits(text, data);
	const marked = applySensitiveMarks(text, hits, data);
	// 形状与 story_types.stripAiWordMarks 新增剥离正则一致（此处用同款正则断言，防两侧漂移）
	const stripped = marked
		.replace(/<span style="background-color:#f2b8b5"(?:\s+title="[^"]*")?>/g, "")
		.replace(/<\/span>/g, "");
	assert.equal(stripped, text);
	assert.ok(marked.includes('<span style="background-color:#f2b8b5" title="色情低俗：直白性描写">上床</span>'));
	assert.ok(marked.indexOf("title=\"暴力血腥") > marked.indexOf("上床</span>"), "两处命中各自带分类 title");
});

void test("groupSensitiveHits: 分类计数保持出现序", () => {
	const data = parseBannedWordsMd(LIST);
	const hits = findSensitiveHits("上床上床上床，割喉", data);
	assert.deepEqual(groupSensitiveHits(hits), [
		{ category: "色情低俗", count: 3 },
		{ category: "暴力血腥", count: 1 },
	]);
});

void test("renderSensitiveReportSection: 零命中/有命中两形态均为可追加 md 节", () => {
	const empty = renderSensitiveReportSection("测试书", "2026-11-18 12:00", 3, [], 0);
	assert.ok(empty.includes("命中合计：**0 处**") && empty.includes("未命中任何敏感词"));
	const sec = renderSensitiveReportSection("测试书", "2026-11-18 12:00", 2, [
		{ label: "第一卷第二章 试探", hits: 2, groups: [{ category: "色情低俗", count: 2 }] },
		{ label: "第三章 血战", hits: 1, groups: [{ category: "暴力血腥", count: 1 }] },
	], 3);
	assert.ok(sec.includes("| 第三章 血战 | 1 | 暴力血腥×1 |"));
	assert.ok(sec.includes("命中合计：**3 处**"));
});
