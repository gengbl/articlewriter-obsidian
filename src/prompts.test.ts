import test from "node:test";
import assert from "node:assert/strict";

import { buildBookOutlineContinuePrompt, buildChapterPrompt, buildContinuePrompt, buildRewritePrompt, buildVolOutlineChapterPrompt, CHAPTER_REF_BAN, compactOutlineIndex, findChapterRefLeaks, parseChapterWithSummary } from "./prompts";

test("strictCurrentOutlineOnly keeps the prompt anchored to the current volume outline only", () => {
	const prompt = buildVolOutlineChapterPrompt({
		bookTitle: "测试书名",
		globalOutline: "全书主线：主角要去完成大反派任务。",
		sourceOutline: "卷2大纲：主角潜入学院，寻找失踪的钥匙。",
		strictCurrentOutlineOnly: true,
		planningGuide: "必须遵守当前卷的情节线索。",
		bookRelationships: "角色关系：主角与导师有矛盾。",
		volRelationships: "卷2角色关系：主角与导师仍然是对立。",
		volumes: [
			{ name: "第1卷", description: "开篇" },
			{ name: "第2卷", description: "关键卷" },
		],
		targetVolumeName: "第2卷",
		prevVolumeOutline: "上一卷：主角刚离开都市。",
		existingOutline: "现有卷大纲：1. 进入学院 2. 暗中调查 3. 遭遇反转",
		chapterCount: 3,
		chapterNum: 1,
	});

	assert.match(prompt, /【当前大纲来源（本次拆分\/写作依据）】/);
	assert.doesNotMatch(prompt, /【全书大纲】/);
	assert.doesNotMatch(prompt, /【前一卷卷大纲 · 仅参考】/);
	assert.doesNotMatch(prompt, /【目标卷现有大纲 · /);
	assert.match(prompt, /本轮拆分必须严格以\【当前大纲来源\】这一份当前卷大纲为唯一依据/);
	assert.match(prompt, /当前卷大纲/);
});

test("non-strict mode still includes broader context for normal generation", () => {
	const prompt = buildVolOutlineChapterPrompt({
		bookTitle: "测试书名",
		globalOutline: "全书主线：主角要去完成大反派任务。",
		sourceOutline: "卷2大纲：主角潜入学院，寻找失踪的钥匙。",
		planningGuide: "必须遵守本书总规划。",
		bookRelationships: "角色关系：主角与导师有矛盾。",
		volRelationships: "卷2角色关系：主角与导师仍然是对立。",
		volumes: [{ name: "第1卷" }, { name: "第2卷" }],
		targetVolumeName: "第2卷",
		prevVolumeOutline: "上一卷：主角刚离开都市。",
		existingOutline: "现有卷大纲：1. 进入学院 2. 暗中调查 3. 遭遇反转",
		chapterCount: 2,
		chapterNum: 1,
	});

	assert.match(prompt, /【全书大纲】/);
	assert.match(prompt, /【前一卷卷大纲 · 仅参考】/);
	assert.match(prompt, /【目标卷现有大纲 · /);
});

test("compactOutlineIndex keeps preamble + per-chapter heading and main-line line only", () => {
	const outline = [
		"【全书设计】",
		"全书主线：主角追查真相。",
		"",
		"## 第1章 开端",
		"主线：主角进入学院，遭遇第一次异常。",
		"因果衔接：无前章。",
		"升级/反转：暗线出现。",
		"人物变化：主角决定独自调查。",
		"章末钩子：神秘信件到来。",
		"",
		"## 第2章 信件",
		"主线：主角拆开信件，发现一张旧照片。",
		"章末钩子：照片中的人是导师。",
	].join("\n");
	const idx = compactOutlineIndex(outline);
	assert.match(idx, /【全书设计】/);
	assert.match(idx, /全书主线：主角追查真相。/);
	assert.match(idx, /^## 第1章 开端$/m);
	assert.match(idx, /主线：主角进入学院，遭遇第一次异常。/);
	assert.match(idx, /^## 第2章 信件$/m);
	assert.match(idx, /主线：主角拆开信件，发现一张旧照片。/);
	assert.doesNotMatch(idx, /因果衔接/);
	assert.doesNotMatch(idx, /章末钩子/);
});

test("compactOutlineIndex returns original text when no chapter markers are found", () => {
	const t = "自由文本大纲，没有章标记。";
	assert.equal(compactOutlineIndex(t), t);
});

test("buildBookOutlineContinuePrompt injects compact index only when existingOutlineCompact is set", () => {
	const full = [
		"## 第1章 开端",
		"主线：A。",
		"因果衔接：B。",
		"升级/反转：C。",
		"人物变化：D。",
		"章末钩子：E。",
		"## 第2章 信件",
		"主线：F。",
		"章末钩子：G。",
	].join("\n");
	const base = { bookTitle: "测试书名", flatMode: true, chapterCount: 4, fromChapter: 3, toChapter: 4, existingOutline: full };
	const compacted = buildBookOutlineContinuePrompt({ ...base, existingOutlineCompact: true });
	assert.match(compacted, /【现有书级大纲 · 避免重复】/);
	assert.match(compacted, /## 第1章 开端/);
	assert.doesNotMatch(compacted, /因果衔接：B。/);
	const fullInjected = buildBookOutlineContinuePrompt(base);
	assert.match(fullInjected, /因果衔接：B。/);
});

// ---------- v0.2.21+ 写作命令「正文＋<SUMMARY> 块」解析与提示词协议 ----------

test("parseChapterWithSummary extracts trailing summary block and keeps body", () => {
	const raw = "主角走进学院，夜色正浓。\n\n<SUMMARY>\n关键情节：主角进入学院。\n人物状态：警惕。\n伏笔：地下室的门。\n</SUMMARY>";
	const parsed = parseChapterWithSummary(raw);
	assert.equal(parsed.summary, "关键情节：主角进入学院。\n人物状态：警惕。\n伏笔：地下室的门。");
	assert.equal(parsed.body, "主角走进学院，夜色正浓。");
});

test("parseChapterWithSummary treats whole text as body when no complete block", () => {
	const parsed = parseChapterWithSummary("只有正文，没有任何标记。");
	assert.equal(parsed.summary, null);
	assert.equal(parsed.body, "只有正文，没有任何标记。");
});

test("parseChapterWithSummary tolerates reversed order by taking the longer side as body", () => {
	const raw = "<SUMMARY>\n摘要内容。\n</SUMMARY>\n\n这是写在前面的正文，比摘要长得多，所以会被判定为正文一侧。";
	const parsed = parseChapterWithSummary(raw);
	assert.equal(parsed.summary, "摘要内容。");
	assert.match(parsed.body, /这是写在前面的正文/);
});

test("parseChapterWithSummary backtracks over an empty last block to an earlier one", () => {
	const raw = "这是一段足够长的正文文本，主角进入学院并遭遇危机，随后决定深入调查真相。\n<SUMMARY>\n关键情节。\n</SUMMARY>\n<SUMMARY>\n\n</SUMMARY>";
	const parsed = parseChapterWithSummary(raw);
	assert.equal(parsed.summary, "关键情节。");
	assert.match(parsed.body, /这是一段足够长的正文文本/);
});

test("parseChapterWithSummary takes the last complete block when several exist", () => {
	const raw = "正文。\n<SUMMARY>\n第一份摘要\n</SUMMARY>\n<SUMMARY>\n第二份摘要\n</SUMMARY>";
	const parsed = parseChapterWithSummary(raw);
	assert.equal(parsed.summary, "第二份摘要");
	assert.equal(parsed.body, "正文。");
});

test("parseChapterWithSummary returns null summary for unclosed tag", () => {
	const parsed = parseChapterWithSummary("正文。\n<SUMMARY>\n未写完的摘要");
	assert.equal(parsed.summary, null);
	assert.equal(parsed.body, "正文。\n<SUMMARY>\n未写完的摘要");
});

test("buildChapterPrompt appends summary protocol only when withSummary is set", () => {
	const base = {
		chapterNum: 1,
		chapterLabel: "第1章",
		chapterKey: "1",
		chapterOutlineRaw: "主角进入学院。",
		context: "上下文",
		wordRange: [2000, 3000] as [number, number],
		prevOutlines: [],
	};
	const withTail = buildChapterPrompt({ ...base, withSummary: true }).prompt;
	assert.match(withTail, /【摘要】本章正文写完后另起一行输出 <SUMMARY>/);
	assert.match(withTail, /<\/SUMMARY> 收尾/);
	const withoutTail = buildChapterPrompt(base).prompt;
	assert.doesNotMatch(withoutTail, /<SUMMARY>/);
});

test("buildContinuePrompt appends summary protocol only when withSummary is set", () => {
	const base = {
		chapterNum: 1,
		chapterLabel: "第1章",
		chapterKey: "1",
		context: "上下文",
		globalOutlineRaw: "",
		chapterOutlineRaw: "",
		prevOutlines: [],
		existingContent: "已有正文……",
		wordRange: [2000, 3000] as [number, number],
	};
	const withTail = buildContinuePrompt({ ...base, withSummary: true }).prompt;
	assert.match(withTail, /【摘要】新续写部分写完后另起一行输出 <SUMMARY>/);
	const withoutTail = buildContinuePrompt(base).prompt;
	assert.doesNotMatch(withoutTail, /<SUMMARY>/);
});

test("buildRewritePrompt appends summary protocol only when withSummary is set", () => {
	const base = {
		chapterNum: 1,
		chapterLabel: "第1章",
		context: "上下文",
		bridge: {},
		oldContent: "旧正文",
		currentSummary: "",
		wordRange: [2000, 3000] as [number, number],
	};
	const withTail = buildRewritePrompt({ ...base, withSummary: true });
	assert.match(withTail, /【摘要】重写后的本章正文写完后另起一行输出 <SUMMARY>/);
	assert.doesNotMatch(buildRewritePrompt(base), /<SUMMARY>/);
});

test("findChapterRefLeaks flags chapter-number references in prose but skips title lines", () => {
	const content = [
		"# 第五章 风起", // MD 标题行 → 豁免
		"第五章：风起", // 纯文本章题行 → 豁免
		"第五章", // 裸章题行 → 豁免
		"他想起第5章，他终于到了。", // 阿拉伯数字正文引用 → 命中
		"伏笔早在第十二章就埋下了。", // 中文数字正文引用 → 命中
	].join("\n");
	assert.deepEqual(findChapterRefLeaks(content), [
		{ line: 4, snippet: "第5章" },
		{ line: 5, snippet: "第十二章" },
	]);
});

test("findChapterRefLeaks returns empty for clean text and caps at 10 hits", () => {
	assert.deepEqual(findChapterRefLeaks(""), []);
	assert.deepEqual(findChapterRefLeaks("# 第一章\n一切如常，没有编号引用。"), []);
	const many = Array.from({ length: 12 }, (_, i) => `第${i + 1}章又出现了。`).join("\n");
	const leaks = findChapterRefLeaks(many);
	assert.equal(leaks.length, 10);
	assert.equal(leaks[0].line, 1);
	assert.equal(leaks[9].line, 10);
});

test("writing prompts all carry the chapter-ref ban clause", () => {
	const chapter = buildChapterPrompt({
		chapterNum: 1,
		chapterLabel: "第1章",
		chapterKey: "1",
		chapterOutlineRaw: "主角进入学院。",
		context: "上下文",
		wordRange: [2000, 3000] as [number, number],
		prevOutlines: [],
	}).prompt;
	assert.ok(chapter.includes(CHAPTER_REF_BAN));
	const continued = buildContinuePrompt({
		chapterNum: 1,
		chapterLabel: "第1章",
		chapterKey: "1",
		context: "上下文",
		globalOutlineRaw: "",
		chapterOutlineRaw: "",
		prevOutlines: [],
		existingContent: "已有正文……",
		wordRange: [2000, 3000] as [number, number],
	}).prompt;
	assert.ok(continued.includes(CHAPTER_REF_BAN));
	const rewritten = buildRewritePrompt({
		chapterNum: 1,
		chapterLabel: "第1章",
		context: "上下文",
		bridge: {},
		oldContent: "旧正文",
		currentSummary: "",
		wordRange: [2000, 3000] as [number, number],
	});
	assert.ok(rewritten.includes(CHAPTER_REF_BAN));
});
