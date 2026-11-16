import test from "node:test";
import assert from "node:assert/strict";
import { buildCastChapterPrompt, CAST_VARYING_HEAD, castStableChars } from "./cast_analyzer";

// ---------- v0.4.3+ 逐章人物分析的共享前缀口径（前缀缓存锚点落点，见 main.ts cachePinAt）----------

test("castStableChars 落在「逐章变化段」之前：名单行/场景行/章名正文都不计入稳定前缀", () => {
	const p = buildCastChapterPrompt({ chapterLabel: "第1章", content: "正文一。", knownNames: ["林越"], knownSceneIds: ["青石巷"] });
	const stable = castStableChars(p);
	assert.ok(stable > 600, `稳定前缀应够长（实得 ${String(stable)}）`);
	assert.ok(stable < p.indexOf(CAST_VARYING_HEAD) + CAST_VARYING_HEAD.length);
	assert.ok(stable < p.indexOf("\n章节："), "锚点必须落在章名之前");
	assert.ok(!p.slice(0, stable).includes("林越"), "已知名单属逐章变化段，不得落进稳定前缀");
});

test("跨章调用：名单增长只改变化段，稳定前缀逐字不变（这才让第 2..N 章命中同一检查点）", () => {
	const a = buildCastChapterPrompt({ chapterLabel: "第1章", content: "正文一。", knownNames: ["林越"], knownSceneIds: [] });
	const b = buildCastChapterPrompt({ chapterLabel: "第2章", content: "正文二很长。", knownNames: ["林越", "沈默"], knownSceneIds: ["青石巷"] });
	const stable = Math.min(castStableChars(a), castStableChars(b));
	assert.ok(stable > 0);
	assert.equal(a.slice(0, stable), b.slice(0, stable), "两章的稳定前缀必须逐字一致");
	let lcp = 0;
	while (lcp < a.length && lcp < b.length && a[lcp] === b[lcp]) lcp++;
	// 钉点必须落在真实公共前缀之内（名单行开头几个字偶然相同只会让 lcp 略超出稳定段，无害）
	assert.ok(lcp >= stable, `钉点不能超出真实公共前缀（lcp=${String(lcp)} stable=${String(stable)}）`);
	// 章名/正文都在变化段里 → 真实公共前缀必须在那之前就已分叉
	assert.ok(lcp < Math.min(a.indexOf("\n章节："), b.indexOf("\n章节：")), `公共前缀应在变化段内早早分叉（lcp=${String(lcp)}）`);
});
