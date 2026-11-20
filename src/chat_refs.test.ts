import test from "node:test";
import assert from "node:assert/strict";

import { detectChatAutoRefs, maskManualRefs, MAX_CHAPTER_REFS } from "./chat_refs";

const labels = (raw: string, titles: string[] = []): string[] => detectChatAutoRefs(raw, titles).map((s) => s.label);

test("第N章：阿拉伯与中文数字、去重、动词无关", () => {
	assert.deepEqual(labels("看看第一章"), ["第1章"]);
	assert.deepEqual(labels("第3章 和 第三章"), ["第3章"]); // 同章号中文/阿拉伯去重
	assert.deepEqual(labels("说说第12章的剧情"), ["第12章"]);
	assert.deepEqual(labels("第十二章"), ["第12章"]); // 中文十二
	assert.deepEqual(labels("第二百章"), ["第200章"]);
});

test("第A到B章范围展开：中文数字、至、逆序交换、跨span不重复单章", () => {
	assert.deepEqual(labels("第1到3章"), ["第1–3章"]);
	assert.deepEqual(labels("第一章至第三章"), ["第1–3章"]);
	assert.deepEqual(labels("第5到2章"), ["第2–5章"]);
	// 范围已吃 span，内部不再拆单章（不用 flatMap＝ES2019，见 eslint.config.mjs 黑名单）
	const spanNums: number[] = [];
	for (const s of detectChatAutoRefs("第1到3章", [])) spanNums.push(...s.nums);
	assert.deepEqual(spanNums, [1, 2, 3]);
});

test("范围与总量上限 MAX_CHAPTER_REFS：超长范围截断", () => {
	const specs = detectChatAutoRefs("第1到200章", []);
	assert.equal(specs.length, 1);
	assert.equal(specs[0].nums.length, MAX_CHAPTER_REFS);
	assert.ok(specs[0].label.includes("截前10章"));
	const many = detectChatAutoRefs("第1章 第2章 第3章 第4章 第5章 第6章 第7章 第8章 第9章 第10章 第11章", []);
	assert.equal(many.length, MAX_CHAPTER_REFS);
});

test("第N卷 → 卷大纲；重复卷号去重", () => {
	assert.deepEqual(labels("第2卷讲了什么，再看看第二卷"), ["第2卷大纲"]);
});

test("《标题》与章节标题包含匹配：去重、短标题跳过", () => {
	assert.deepEqual(labels("评价《雨夜刺杀》"), ["《雨夜刺杀》"]);
	assert.deepEqual(labels("评价雨夜刺杀写得怎么样", ["雨夜刺杀", "刺杀"]), ["章节《雨夜刺杀》"]); // 长标题优先且短标题被span吃掉
	assert.deepEqual(labels("《雨夜刺杀》里 雨夜刺杀", ["雨夜刺杀"]), ["《雨夜刺杀》"]); // 同标题去重
	assert.deepEqual(labels("你好啊", ["你"]), []); // <2 字标题不参与
});

test("关键词 → 内置文档 key：长词优先、同 key 去重", () => {
	const s1 = detectChatAutoRefs("说说故事状态", []);
	assert.deepEqual(s1.map((s) => s.docKey), ["story_state"]);
	const s2 = detectChatAutoRefs("人物关系和时间线梳理一下", []);
	assert.deepEqual(s2.map((s) => s.docKey), ["book_relations", "timeline"]);
	const s3 = detectChatAutoRefs("看看全书大纲", []);
	assert.deepEqual(s3.map((s) => s.docKey), ["book_outline"]);
	assert.deepEqual(detectChatAutoRefs("加载策划指南、世界观", []).map((s) => s.docKey), ["planning_guide", "worldview"]);
});

test("maskManualRefs：手动 @ token 掩掉、防自动重复加载", () => {
	const masked = maskManualRefs("看 @[[书/第一章.md]] 和第1章");
	assert.ok(!masked.includes("@"));
	assert.ok(!masked.includes("第一章"));
	assert.ok(masked.includes("第1章"));
	// 手动 @[[...]] 里的「第一章」不会被自动识别，句尾裸提的第1章仍会加载
	assert.deepEqual(detectChatAutoRefs("@[[书/第一章.md]] 第1章", []).map((s) => s.label), ["第1章"]);
	assert.deepEqual(detectChatAutoRefs("看 @[[书/第一章.md]]", []).map((s) => s.label), []);
});

test("混合输入：章+卷+文档+标题一次全出", () => {
	const specs = detectChatAutoRefs("对比第五章和第2卷，再说说故事状态和《雨夜刺杀》", ["雨夜刺杀"]);
	assert.deepEqual(specs.map((s) => s.label), ["第5章", "第2卷大纲", "《雨夜刺杀》", "【故事状态】"]);
});
