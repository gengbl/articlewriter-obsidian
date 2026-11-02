import test from "node:test";
import assert from "node:assert/strict";

import { buildVolOutlineChapterPrompt } from "./prompts";

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
