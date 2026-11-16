import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SKILLS } from "./skills_default";
import { applyWordRangeVars, buildBookOutlineContinuePrompt, buildBookOutlineExtendPrompt, buildBookOutlineGenPrompt, buildChapterOutlineExpandPrompt, buildChapterPrompt, buildContinuePrompt, buildPlanningGuideContinuePrompt, buildPlanningGuidePrompt, buildReviewPrompt, buildRewritePrompt, buildStoryTypeSystemPrompt, buildTimelineGenPrompt, buildVolOutlineChapterPrompt, buildVolOutlineDesignPrompt, buildWorldviewGenPrompt, buildChapterRefFixPrompt, CHAPTER_OUTLINE_EXPAND_SYSTEM_PROMPT, CHAPTER_REF_BAN, findChapterRefLeaks, findChapterRefSentences, fixChapterRefs, parseChapterWithSummary, wordTargetHint, withSharedContextPrefix } from "./prompts";

test("default seeded skills preserve every opt-in skill extracted from hardcoded prompts", () => {
	assert.ok(DEFAULT_SKILLS["编写类型与格式规则"], "story type skill must be seeded by default");
	assert.ok(DEFAULT_SKILLS["章节写作指导"], "chapter task skill must be seeded by default");
	assert.match(DEFAULT_SKILLS["编写类型与格式规则"] ?? "", /【编写类型确认】/);
	assert.match(DEFAULT_SKILLS["章节写作指导"] ?? "", /若大纲含「升级反转」/);
	assert.match(DEFAULT_SKILLS["章节写作指导"] ?? "", /^1\. /m); // v0.4.3+ 固定条文序号从 1 起（单独装配块；主清单 1–4 条由代码生成）
	assert.doesNotMatch(DEFAULT_SKILLS["章节写作指导"] ?? "", /\{\{outline_ref_clause\}\}|\{\{chapter_ref_ban\}\}/, "种子只含固定文字条文、不带动态占位符");
});

test("genre / writing-style skill folders are seeded and override the hardcoded type template", () => {
	assert.ok(DEFAULT_SKILLS["题材/玄幻仙侠"], "genre folder skill must be seeded");
	assert.ok(DEFAULT_SKILLS["编写类型/网文小说"], "writing-style folder skill must be seeded");
	const prompt = buildStoryTypeSystemPrompt({
		storyType: "网文小说",
		storyTypeSkillBlock: "【编写类型 · 网文小说】\nSKILL_TYPE",
		genreSkillBlock: "【题材 · 玄幻仙侠】\nSKILL_GENRE",
	});
	assert.match(prompt, /SKILL_TYPE/);
	assert.match(prompt, /SKILL_GENRE/);
	assert.doesNotMatch(prompt, /请严格按网络小说的格式与风格创作/, "skill block should replace the hardcoded STORY_TYPES template");
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
	assert.match(prompt, /本轮拆分必须严格以【当前大纲来源】这一份当前卷大纲为唯一依据/);
	assert.match(prompt, /当前卷大纲/);
	// v0.4.3+ 前缀缓存友好排序：上下文在前、指令压后（逐章变化的内容排在末尾才可复用上下文稳定段）
	assert.ok(prompt.indexOf("【当前大纲来源（本次拆分/写作依据）】") < prompt.indexOf("生成「第2卷」"));
});

test("chapter outline expansion prompt: 1/4 length target, fixed three-part structure, prev-outline block", () => {
	// v0.4.3+：从大纲生成章节的章大纲扩展——输入＝卷大纲拆出的该章段落，输出＝完整章大纲（长度≈该章正文目标字数 1/4）
	const prompt = buildChapterOutlineExpandPrompt({
		chapterNum: 3,
		chapterTitle: "修不完的系统",
		outlineText: "主角接单去修系统。",
		chapterWords: 4000,
		targetWords: 1000,
		contextDocs: "\n【当前大纲来源（本次拆分/写作依据）】\n第3章：主角接单去修系统。",
		prevOutlines: "第2章 试探\n- 本章目标：试探系统边界",
	});
	assert.match(prompt, /第3章《修不完的系统》/);
	assert.match(prompt, /全文约 1000 字（本章正文目标约 4000 字，章大纲长度取其 1\/4）/);
	assert.match(prompt, /- 本章目标：/);
	assert.match(prompt, /- 情节要点：/);
	assert.match(prompt, /3–6 条/);
	assert.match(prompt, /【前文已定稿的相邻章大纲/);
	assert.match(prompt, /【当前大纲来源（本次拆分\/写作依据）】/);
	// v0.4.3+ 前缀缓存友好排序：共享上下文在最前、逐章指令压后（相邻章扩展请求才能复用上下文稳定段）
	const ctxAt = prompt.indexOf("【当前大纲来源（本次拆分/写作依据）】");
	const instrAt = prompt.indexOf("请把上面这段卷大纲里第3章");
	assert.ok(ctxAt >= 0 && instrAt > ctxAt, "上下文块必须排在「请把…扩写成…」指令之前");
	assert.ok(prompt.indexOf("【前文已定稿的相邻章大纲") > instrAt, "逐章变化的前章大纲仍排在指令之后");
	assert.match(CHAPTER_OUTLINE_EXPAND_SYSTEM_PROMPT, /忠实/);
});

test("chapter outline expansion prompt: 上下文缺【当前大纲来源】时仍附上本段原文（引用清单配置缺失兜底）", () => {
	const prompt = buildChapterOutlineExpandPrompt({
		chapterNum: 4,
		outlineText: "主角在码头与旧友重逢。",
		chapterWords: 3500,
		targetWords: 875,
		contextDocs: "【书籍信息】\n书名：测试书",
	});
	assert.match(prompt, /【本章原始段落 · 待扩写】\n主角在码头与旧友重逢。/);
	assert.ok(prompt.indexOf("【书籍信息】") < prompt.indexOf("【本章原始段落 · 待扩写】"));
	// 上下文已含原文时不重复附（避免双份注入）
	const dup = buildChapterOutlineExpandPrompt({
		chapterNum: 4,
		outlineText: "主角在码头与旧友重逢。",
		chapterWords: 3500,
		targetWords: 875,
		contextDocs: "【当前大纲来源（本次拆分/写作依据）】\n主角在码头与旧友重逢。",
	});
	assert.doesNotMatch(dup, /【本章原始段落 · 待扩写】/);
});

test("chapter outline expansion prompt: castAppendix 追加人物/关系附录要求，默认不追加", () => {
	const base = {
		chapterNum: 3,
		chapterTitle: "修不完的系统",
		outlineText: "主角接单去修系统。",
		chapterWords: 4000,
		targetWords: 1000,
	};
	const withCast = buildChapterOutlineExpandPrompt({ ...base, castAppendix: true, knownNames: ["甲", "乙"] });
	assert.match(withCast, /【人物与关系附录（硬性要求，必须输出）】/);
	assert.match(withCast, /===人物关系附录===/);
	assert.match(withCast, /已知规范人名（务必沿用同一写法）：甲、乙/);
	const plain = buildChapterOutlineExpandPrompt(base);
	assert.doesNotMatch(plain, /人物与关系附录/);
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

// ---------- v0.4.3+ 全族提示词排序护栏：上下文在前、逐次易变段居中、指令压尾 ----------

test("all contextDocs builders put shared context before the instruction block (prefix-cache reuse)", () => {
	const ctx = "\n【书籍信息】\n书名：测试书\n\n【世界观设定】\n灵气枯竭。";
	const cases: Array<[string, string, string]> = [
		// [名称, prompt, 指令块里独有的字样]
		["vol-design", buildVolOutlineDesignPrompt({ targetVolumeName: "第1卷", chapterCount: 12, contextDocs: ctx }), "生成【卷设计】段"],
		["vol-chapter", buildVolOutlineChapterPrompt({ targetVolumeName: "第1卷", chapterCount: 12, chapterNum: 2, contextDocs: ctx }), "章节小节"],
		["chapter-expand", buildChapterOutlineExpandPrompt({ chapterNum: 2, outlineText: "第2章：主角进城。", chapterWords: 4000, targetWords: 1000, contextDocs: ctx }), "扩写成可直接指导正文写作"],
		["book-gen", buildBookOutlineGenPrompt({ flatMode: true, chapterCount: 20, contextDocs: ctx }), "生成一份恰好 20 章的书级大纲"],
		["book-continue", buildBookOutlineContinuePrompt({ flatMode: true, chapterCount: 20, contextDocs: ctx, fromChapter: 11, toChapter: 20, bookDesign: "设计", previousChapters: "第10章 …" }), "请继续为本书生成书级大纲的指定章节区间"],
		["book-extend", buildBookOutlineExtendPrompt({ flatMode: false, chapterCount: 0, volumeCount: 5, contextDocs: ctx, fromVolume: 3, toVolume: 5 }), "只追加第 3 卷至第 5 卷"],
		["planning-guide", buildPlanningGuidePrompt({ bookTitle: "测试书", contextDocs: ctx }), "生成一份《策划指南》"],
		["planning-guide-continue", buildPlanningGuideContinuePrompt({ bookTitle: "测试书", contextDocs: ctx }, "一、全书主线\n…", ["二、大事件序列"]), "从截断处继续把《策划指南》写完整"],
		["timeline", buildTimelineGenPrompt({ bookTitle: "测试书", contextDocs: ctx }), "生成一份《时间线》"],
		["worldview", buildWorldviewGenPrompt({ bookTitle: "测试书", premise: "一句话设定", contextDocs: ctx }), "生成一份《世界观》"],
		["review", buildReviewPrompt({ chapterNum: 3, context: ctx, bridge: {}, chapterContent: "正文…" }), "请以全局视角审阅小说第3章"],
	];
	for (const [name, prompt, marker] of cases) {
		const ctxAt = prompt.indexOf("【书籍信息】");
		const instrAt = prompt.indexOf(marker);
		assert.ok(ctxAt >= 0, `${name}: 上下文块必须注入`);
		assert.ok(instrAt > ctxAt, `${name}: 指令块必须排在共享上下文之后（否则前缀缓存逐次分叉）`);
	}
});

test("write / continue / rewrite share the exact writing-context head (cross-command prefix reuse)", () => {
	const context = "【书籍信息】\n书名：测试书\n\n【世界观设定】\n灵气枯竭。";
	const write = buildChapterPrompt({
		chapterNum: 1, chapterKey: "1", context, chapterOutlineRaw: "- 本章目标：进城", wordRange: [2000, 3000],
		prevOutlines: [], storyType: "玄幻",
	});
	const cont = buildContinuePrompt({
		chapterNum: 1, chapterKey: "1", context, chapterOutlineRaw: "- 本章目标：进城", wordRange: [2000, 3000],
		prevOutlines: [], existingContent: "已有正文…", globalOutlineRaw: "",
	});
	const rewrite = buildRewritePrompt({
		chapterNum: 1, context, bridge: {}, oldContent: "原正文…", wordRange: [2000, 3000],
	});
	const head = `以下是写作上下文：\n${context}`;
	for (const [name, prompt] of [["write", write.prompt], ["continue", cont.prompt], ["rewrite", rewrite]] as Array<[string, string]>) {
		assert.ok(prompt.startsWith(`\n${head}`), `${name}: 必须与写作族共用同一上下文头，实际开头：${prompt.slice(0, 40)}`);
	}
});

test("去AI味 前缀复用：清洗请求与刚发出的章节请求共享同一整段前缀（连续编写逐章不断链）", () => {
	const context = "【书籍信息】\n书名：测试书\n\n【世界观设定】\n灵气枯竭之后的修真界，宗门以灵石配额制维系统治。".repeat(20);
	const write = buildChapterPrompt({
		chapterNum: 1, chapterKey: "1", context, chapterOutlineRaw: "- 本章目标：进城", wordRange: [2000, 3000],
		prevOutlines: [], storyType: "玄幻",
	}).prompt;
	const clean = withSharedContextPrefix(context, "请把下面标出的句子改写成更口语的说法，只输出改写结果：\n原文片段…");
	const ctxEnd = write.indexOf(context) + context.length;
	assert.ok(ctxEnd > 600, "上下文要够长才有复用价值（cachePin 的 ≥600 字符门槛）");
	assert.ok(clean.startsWith(write.slice(0, ctxEnd)), "清洗请求必须逐字包含章节请求的「上下文头＋整段上下文」，否则引擎按公共前缀复用时断链");
	assert.ok(clean.indexOf("请把下面标出的句子") > ctxEnd, "清洗指令必须排在上下文之后（钉点落在上下文结束处才有效）");
	assert.match(clean, /不要改写|不要复述/, "要显式禁止模型改写/复述上下文段");
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
	assert.doesNotMatch(defaultPrompt, /4\. 若大纲含「升级反转」/); // 未选章节写作指导时不回落内置 3–13
	assert.doesNotMatch(defaultPrompt, /^3\. /m);

	const injected = buildChapterPrompt({
		...base,
		storyTypeSkillBlock: "【技能 · 编写类型与格式规则】\n【编写类型确认】本小说编写类型为「网文小说」，请严格按该类型输出。",
		taskSkillBlock: "4. 自定义静态要求：单独装配、序号从 1 重排",
	}).prompt;
	assert.match(injected, /【编写类型确认】/);
	assert.match(injected, /^1\. 自定义静态要求/m);
	assert.doesNotMatch(injected, /5\. 每个场景有明确的目标与障碍/);
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
	const chapterInput = {
		chapterNum: 1,
		chapterLabel: "第1章",
		chapterKey: "1",
		chapterOutlineRaw: "主角进入学院。",
		context: "上下文",
		wordRange: [2000, 3000] as [number, number],
		prevOutlines: [],
	};
	const chapter = buildChapterPrompt(chapterInput).prompt;
	assert.ok(!chapter.includes(CHAPTER_REF_BAN), "未选择章节写作指导时不应回落内置 3–13（含第 13 条禁令）");
	const chapterWithTask = buildChapterPrompt({ ...chapterInput, taskSkillBlock: DEFAULT_SKILLS["章节写作指导"] }).prompt;
	assert.ok(chapterWithTask.includes(CHAPTER_REF_BAN));
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

test("word-range placeholders in phase-4 skill text interpolate from book word_range", () => {
	// v0.4.3+：applyWordRangeVars——技能文本 {{word_low}}/{{word_high}}/{{word_range}} 装配时按书级《故事状态.md》word_range 插值；{{word_range}} 口径＝中值宜写±20%
	assert.equal(
		applyWordRangeVars("下限{{word_low}}、上限{{word_high}}、目标{{word_range}}", [3000, 4000]),
		"下限3000、上限4000、目标3000-4000字（以3500字为宜，可上下浮动20%）"
	);
	// wordTargetHint：中值＝(low+high)/2、浮动界＝中值×0.8/×1.2
	assert.deepEqual(wordTargetHint([3000, 4000]), { mid: 3500, flLow: 2800, flHigh: 4200 });
	assert.deepEqual(wordTargetHint([2000, 3000]), { mid: 2500, flLow: 2000, flHigh: 3000 });
	assert.doesNotMatch(DEFAULT_SKILLS["身份加强·编写文章"] ?? "", /字数要求|\{\{word_/, "v0.4.3+ 身份加强·编写文章不带字数要求（字数约束唯一出处＝代码主清单第 2 条）");
	// buildChapterPrompt：主清单第 2 条＝「以中值字为宜（区间中值），可上下浮动20%（约X-Y字）」＋占位符插值
	const built = buildChapterPrompt({ chapterNum: 1, chapterOutlineRaw: "## 第1章 测试", context: "", wordRange: [3000, 4000], prevOutlines: [], taskSkillBlock: "3. 全章 {{word_range}}，上限 {{word_high}} 字" });
	assert.ok(built.prompt.includes("全章 3000-4000字（以3500字为宜，可上下浮动20%），上限 4000 字"), "task skill word vars interpolated");
	assert.match(built.prompt, /2\. 总字数以3500字为宜（区间中值），可上下浮动20%（约2800-4200字）/, "主清单第 2 条＝宜写字数口径");
	assert.doesNotMatch(built.prompt, /严禁超限|严禁超过/, "不再使用硬性上限措辞");
	// 重写命令引导语同口径
	const rewritten = buildRewritePrompt({ chapterNum: 1, chapterLabel: "第1章", context: "", wordRange: [3000, 4000], bridge: {}, currentSummary: "", oldContent: "旧文……" });
	assert.match(rewritten, /总字数以3500字为宜（区间中值），可上下浮动20%（约2800-4200字）/);
});

test("章节写作指导 assembled as standalone block numbered from 1 (v0.4.3+)", () => {
	// 单独装配：主清单补第 3 条（章节号引用禁令；卷结构定位条款已移除），固定条文另起【章节写作指导】块、序号从 1 重排
	const legacy = [
		"3. 先判断本章在卷结构中的位置与功能（铺垫/升级/反转/高潮/收束{{outline_ref_clause}}），强度与叙事重心与之匹配", // 旧动态条款行：跳过
		"4. 与前后文保持连贯，人物性格一致，性格变化要有依据。", // 用户定制条文：原样保留
		"12. {{chapter_ref_ban}}", // 旧禁令行：跳过
	].join("\n");
	const built = buildChapterPrompt({
		chapterNum: 1,
		chapterLabel: "第1章",
		chapterKey: "1",
		chapterOutlineRaw: "主角进入学院。",
		context: "【本卷大纲】……",
		wordRange: [2000, 3000],
		prevOutlines: [],
		taskSkillBlock: legacy,
	}).prompt;
	assert.doesNotMatch(built, /先判断本章在卷结构中的位置与功能/, "卷结构定位条款已移除、不再注入");
	assert.ok(new RegExp(`^3\\. ${CHAPTER_REF_BAN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(built), "主清单第 3 条＝章节号引用禁令");
	assert.match(built, /^【章节写作指导】$/m, "固定条文另起单独块");
	assert.match(built, /^1\. 与前后文保持连贯，人物性格一致，性格变化要有依据。$/m, "固定条文序号从 1 重排、定制文字不动");
	assert.doesNotMatch(built, /\{\{outline_ref_clause\}\}|\{\{chapter_ref_ban\}\}/, "占位符不外泄");
	// 种子端到端：主清单 4＝禁令；单独块条文 1–9
	const seeded = buildChapterPrompt({
		chapterNum: 1,
		chapterLabel: "第1章",
		chapterKey: "1",
		chapterOutlineRaw: "主角进入学院。",
		context: "",
		wordRange: [2000, 3000],
		prevOutlines: [],
		taskSkillBlock: DEFAULT_SKILLS["章节写作指导"],
	}).prompt;
	assert.match(seeded, /^【章节写作指导】\n1\. 若大纲含/m, "种子块内首条＝1");
	assert.match(seeded, /^9\. 通顺与逻辑优先/m, "种子 9 条固定条文收尾于 9");
	// 兜底：非编号形态（散文）原文注入＋头尾补动态条款
	const prose = buildChapterPrompt({
		chapterNum: 1,
		chapterLabel: "第1章",
		chapterKey: "1",
		chapterOutlineRaw: "主角进入学院。",
		context: "",
		wordRange: [2000, 3000],
		prevOutlines: [],
		taskSkillBlock: "本章必须全部用对话推进。",
	}).prompt;
	assert.ok(prose.includes("本章必须全部用对话推进。"), "散文原文注入");
	assert.doesNotMatch(prose, /先判断本章在卷结构中的位置与功能/, "兜底也不再注入卷结构定位条款");
	assert.ok(prose.includes(CHAPTER_REF_BAN), "兜底也补章节号禁令");
});
