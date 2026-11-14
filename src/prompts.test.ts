import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SKILLS } from "./skills_default";
import { buildBookOutlineExtendPrompt, buildBookOutlineGenPrompt, buildChapterPrompt, buildContinuePrompt, buildRewritePrompt, buildVolOutlineChapterPrompt, buildChapterRefFixPrompt, CHAPTER_REF_BAN, findChapterRefLeaks, findChapterRefSentences, fixChapterRefs, parseChapterWithSummary } from "./prompts";

test("default seeded skills preserve every opt-in skill extracted from hardcoded prompts", () => {
	assert.ok(DEFAULT_SKILLS["编写类型与格式规则"], "story type skill must be seeded by default");
	assert.ok(DEFAULT_SKILLS["章节写作任务"], "chapter task skill must be seeded by default");
	assert.match(DEFAULT_SKILLS["编写类型与格式规则"] ?? "", /【编写类型确认】/);
	assert.match(DEFAULT_SKILLS["章节写作任务"] ?? "", /请创作本章内容/);
});

test("strictCurrentOutlineOnly keeps the prompt anchored to the current volume outline only", () => {
	const prompt = buildVolOutlineChapterPrompt({
		targetVolumeName: "第2卷",
		chapterCount: 3,
		strictCurrentOutlineOnly: true,
		chapterNum: 1,
		contextDocs: "\n【当前大纲来源（本次拆分/写作依据）】\n卷2大纲：主角潜入学院，寻找失踪的钥匙。",
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
		targetVolumeName: "第2卷",
		chapterCount: 2,
		chapterNum: 1,
		contextDocs: "\n【当前大纲来源（本次拆分/写作依据）】\n卷2大纲：主角潜入学院，寻找失踪的钥匙。\n\n【全书大纲】\n全书主线：主角要去完成大反派任务。\n\n【前一卷卷大纲 · 仅参考】\n上一卷：主角刚离开都市。",
	});

	assert.match(prompt, /【全书大纲】/);
	assert.match(prompt, /【前一卷卷大纲 · 仅参考】/);
	assert.doesNotMatch(prompt, /【目标卷现有大纲 · /); // 目标文档不进生成提示词（回归护栏）
});

test("vol outline chapter prompt never injects existing-chapter anchor blocks", () => {
	const base = {
		targetVolumeName: "第2卷",
		chapterCount: 5,
		chapterNum: 3,
		supplementMode: true,
		contextDocs: "\n【当前大纲来源（本次拆分/写作依据）】\n卷2大纲：主角潜入学院，寻找失踪的钥匙。",
	};
	const prompt = buildVolOutlineChapterPrompt(base);
	// 回归护栏：已有章节一律不进大纲提示词（补全/继续模式亦然），只依据世界观＋策划指南等既定事实
	assert.doesNotMatch(prompt, /【前序已有章 · 衔接参考】/);
	assert.doesNotMatch(prompt, /【后续已有章 · 衔接参考】/);
	assert.doesNotMatch(prompt, /【本卷最近已有章 · 衔接参考】/);
	assert.doesNotMatch(prompt, /【目标卷现有大纲 · /);
});

test("book outline extend prompt never injects last volume declaration anchor", () => {
	const base = { flatMode: false, chapterCount: 10, fromVolume: 3, toVolume: 5 };
	const prompt = buildBookOutlineExtendPrompt(base);
	// 回归护栏：续写不再注入最后一卷声明锚点，接续依据世界观＋策划指南等既定事实
	assert.doesNotMatch(prompt, /【最后一卷声明 · 衔接锚点】/);
});

test("book outline gen prompt (volume mode) plans by volume, no chapter markers or ranges", () => {
	const prompt = buildBookOutlineGenPrompt({ flatMode: false, chapterCount: 40, volumeCount: 3 });
	assert.match(prompt, /恰好 3 卷/);
	assert.match(prompt, /## 第X卷·卷名/);
	assert.match(prompt, /- 第X卷·卷名：一句话定位/);
	// 卷级规划不含章号区间注记、不写逐章标记
	assert.doesNotMatch(prompt, /（第A-B章）/);
	assert.match(prompt, /不写逐章标记/);
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

test("writing rules and chapter task are skill-gated and only appear when injected", () => {
	const base = {
		chapterNum: 1,
		chapterLabel: "第1章",
		chapterKey: "1",
		chapterOutlineRaw: "主角进入学院。",
		context: "上下文",
		wordRange: [2000, 3000] as [number, number],
		prevOutlines: [],
	};
	const defaultPrompt = buildChapterPrompt(base).prompt;
	assert.doesNotMatch(defaultPrompt, /【编写类型确认】/);
	assert.doesNotMatch(defaultPrompt, /请创作本章内容/);

	const injected = buildChapterPrompt({
		...base,
		storyTypeSkillBlock: "【技能 · 编写类型与格式规则】\n【编写类型确认】本小说编写类型为「网文小说」，请严格按该类型输出。",
		taskSkillBlock: "【技能 · 章节写作任务】\n请创作本章内容，要求：按大纲执行。",
	}).prompt;
	assert.match(injected, /【编写类型确认】/);
	assert.match(injected, /请创作本章内容/);
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

test("findChapterRefSentences locates sentences with offsets, skips title lines, dedupes multi-hit sentences", () => {
	const content = [
		"# 第五章 风起", // MD 标题行 → 豁免
		"第五章：风起", // 纯文本章题行 → 豁免
		"他想起第5章。然后到了。", // 首句命中
		"伏笔早在第十二章就埋下了，第13章才揭晓。", // 同句两处命中 → 只记一次
	].join("\n");
	assert.deepEqual(findChapterRefSentences(content), [
		{ start: 16, end: 23, sentence: "他想起第5章。", match: "第5章", line: 3 },
		{ start: 29, end: 50, sentence: "伏笔早在第十二章就埋下了，第13章才揭晓。", match: "第十二章", line: 4 },
	]);
	assert.deepEqual(findChapterRefSentences(""), []);
	const many = Array.from({ length: 12 }, (_, i) => `第${i + 1}章又出现了。`).join("\n");
	assert.equal(findChapterRefSentences(many).length, 10);
});

test("buildChapterRefFixPrompt lists each hit sentence with context and strict output format", () => {
	const text = "他想起第5章。然后到了。\n伏笔早在第十二章就埋下了。";
	const prompt = buildChapterRefFixPrompt(text, findChapterRefSentences(text));
	assert.ok(prompt.includes("章节编号引用修复"));
	assert.ok(prompt.includes("「第5章」"));
	assert.ok(prompt.includes("「第十二章」"));
	assert.ok(prompt.includes("他想起第5章。"));
	assert.ok(prompt.includes("1：改写后的句子"));
});

test("fixChapterRefs replaces sentences in place (back to front) after a single LLM round", async () => {
	const text = "他想起第5章。然后到了。\n伏笔早在第十二章就埋下了。";
	let calls = 0;
	const r = await fixChapterRefs(text, async () => {
		calls++;
		return "1：他想起那场雨夜的对峙。\n2：伏笔早在雪夜的密谈里就埋下了。";
	});
	assert.equal(calls, 1);
	assert.equal(r.text, "他想起那场雨夜的对峙。然后到了。\n伏笔早在雪夜的密谈里就埋下了。");
	assert.deepEqual(r.report.replaced, [
		["伏笔早在第十二章就埋下了。", "伏笔早在雪夜的密谈里就埋下了。"],
		["他想起第5章。", "他想起那场雨夜的对峙。"],
	]);
	assert.deepEqual(r.report.skipped, []);
});

test("fixChapterRefs keeps original when rewrite is empty or still contains a chapter ref", async () => {
	const text = "他想起第5章。然后到了。\n伏笔早在第十二章就埋下了。";
	const r = await fixChapterRefs(text, async () => "2：伏笔早在第12章就埋下了。");
	assert.equal(r.text, text);
	assert.deepEqual(r.report.replaced, []);
	assert.deepEqual(r.report.skipped, ["伏笔早在第十二章就埋下了。", "他想起第5章。"]);
});

test("fixChapterRefs is a no-op when no chapter refs are found", async () => {
	let called = false;
	const r = await fixChapterRefs("一切如常，没有编号引用。", async () => {
		called = true;
		return "";
	});
	assert.equal(called, false);
	assert.equal(r.text, "一切如常，没有编号引用。");
	assert.deepEqual(r.report, { replaced: [], skipped: [] });
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
