import { test } from "node:test";
import assert from "node:assert/strict";
import { countNonSpace, diffStats, segmentStartOf, nextSegmentStart, segmentPauseMs, pauseMsInWindow, segActiveMs, durText, speedText, renderStatsRow, segNetChars, SEGMENT_MS, normalizeSegmentMinutes, segmentMs, liveSegStats, parseDurText, parseStatsRow, summarizeStatsFile, TYPE_STATS_HEADER, type TypeSeg } from "./typing_stats";

test("countNonSpace：空白（空格/换行/制表/全角空格）一律不计", () => {
	assert.equal(countNonSpace("你好 world\t！\n 　"), 8); // 你好world！
});

test("diffStats：触碰区非空白增删计数（中文插入/删除/纯空白增删/同文）", () => {
	assert.deepEqual(diffStats("从前有座山，山里有座庙。", "从前有座山，山里有个洞窟。"), { added: 3, deleted: 2 }); // 新增区「个洞窟」、删除区「座庙」（后缀「。」对齐）
	assert.deepEqual(diffStats("abc", "aXXbc"), { added: 2, deleted: 0 });
	assert.deepEqual(diffStats("aXXbc", "abc"), { added: 0, deleted: 2 });
	assert.deepEqual(diffStats("a b", "a\n\nb"), { added: 0, deleted: 0 }); // 空白增删不计
	assert.deepEqual(diffStats("same", "same"), { added: 0, deleted: 0 });
	assert.deepEqual(diffStats("", "你好"), { added: 2, deleted: 0 }); // 空基线→全文新增（缓存首见由调用方兜底）
});

test("segmentStartOf：epoch 按段长对齐且包含原时刻（缺省 10 分钟／自定义 5 分钟）", () => {
	const t = 1_234_567_890_123;
	const s = segmentStartOf(t);
	assert.equal(s % SEGMENT_MS, 0);
	assert.ok(s <= t && t - s < SEGMENT_MS);
	assert.equal(segmentStartOf(s), s);
	assert.equal(segmentStartOf(s + SEGMENT_MS - 1), s);
	const f5 = segmentStartOf(t, 5 * 60_000); // 自定义段长：同一时刻落进 5 分钟桶
	assert.equal(f5 % (5 * 60_000), 0);
	assert.ok(f5 <= t && t - f5 < 5 * 60_000);
	assert.equal(segmentStartOf(f5, 5 * 60_000), f5);
});

test("normalizeSegmentMinutes / segmentMs：段长设置项口径（缺省 10、越界与非法回落）", () => {
	assert.equal(normalizeSegmentMinutes(undefined), 10);
	assert.equal(normalizeSegmentMinutes(null), 10);
	assert.equal(normalizeSegmentMinutes(""), 10);
	assert.equal(normalizeSegmentMinutes("abc"), 10);
	assert.equal(normalizeSegmentMinutes("7"), 7);
	assert.equal(normalizeSegmentMinutes(3.7), 3);
	assert.equal(normalizeSegmentMinutes(1), 1);
	assert.equal(normalizeSegmentMinutes(120), 120);
	assert.equal(normalizeSegmentMinutes(0), 10); // 越界（<1）回落缺省
	assert.equal(normalizeSegmentMinutes(121), 10); // 越界（>120）回落缺省
	assert.equal(normalizeSegmentMinutes(-5), 10);
	assert.equal(segmentMs(5), 300_000);
	assert.equal(segmentMs(undefined), SEGMENT_MS);
	assert.equal(segmentMs(999), SEGMENT_MS);
});

const mk = (start: number, edits: number[], chars: number, deleted: number = 0): TypeSeg => ({ start, edits, chars, deleted });

test("segmentPauseMs：段首空档/键入间隔/段尾三段同口径，>30s 的超出部分才计", () => {
	// 段首 10s（≤30s 宽限）不计；键入 10s→60s 间隔 50s → 停顿 20s；flush 于 100s、尾距 40s → +10s；共 30s
	assert.equal(segmentPauseMs(mk(0, [10_000, 60_000], 5), 100_000), 30_000);
	// **段首空档也计停顿**：首键入 90s → +60s；尾距恰 30s（未超阈值）→ 不再加
	assert.equal(segmentPauseMs(mk(0, [90_000], 1), 120_000), 60_000);
	// 段首＋段尾两头空：10 分钟段只在 8 分钟处敲一下 → (480−30)＋(120−30)＝540s，活跃只剩 60s
	assert.equal(segmentPauseMs(mk(0, [480_000], 30), 600_000), 540_000);
	assert.equal(segmentPauseMs(mk(0, [], 0), 600_000), 0); // 无键入事件＝无写作会话
});

test("durText：秒 / 分秒 / 时分三档", () => {
	assert.equal(durText(45_000), "45 秒");
	assert.equal(durText(150_000), "2 分 30 秒");
	assert.equal(durText(120_000), "2 分");
	assert.equal(durText(3_720_000), "1 时 2 分");
});

test("speedText：按活跃时长外推到小时；零字数或零活跃 →「—」", () => {
	assert.equal(speedText(600, 600_000), "3600 字/小时");
	assert.equal(speedText(0, 600_000), "—");
	assert.equal(speedText(100, 0), "—");
});

test("renderStatsRow：五列行（日期/时间段/字数/停顿/速度），停顿含段首空档→活跃＝真正敲字时间", () => {
	const start = segmentStartOf(new Date(2026, 10, 16, 14, 0, 0).getTime());
	const row = renderStatsRow(mk(start, [start + 60_000], 812), start + SEGMENT_MS);
	// 单事件在 60s 处：段首空档 60s→+30s、尾距 540s→+510s → 停顿 540s（9 分）；活跃 60s → 812×3600/60＝48720
	assert.equal(row, `| 2026-11-16 | 14:00–14:10 | 812 | ${durText(540_000)} | 48720 字/小时 |`);
	const quiet = renderStatsRow(mk(start, [start + 590_000], 100), start + SEGMENT_MS); // 首键入 590s→+560s、尾距 10s→0 → 停顿 560s、活跃 40s
	assert.equal(quiet, `| 2026-11-16 | 14:00–14:10 | 100 | ${durText(560_000)} | 9000 字/小时 |`);
});

test("TYPE_STATS_HEADER：标题＋表头起始、换行收尾（追加行直接拼接）", () => {
	assert.ok(TYPE_STATS_HEADER.startsWith("# 码字记录"));
	assert.ok(TYPE_STATS_HEADER.includes("| 日期 | 时间段 | 净增字数 | 停顿 | 码字速度 |"));
	assert.ok(TYPE_STATS_HEADER.endsWith("\n"));
});

test("净增字数：删除不算码字，且抵掉先前敲入的字（新增−删除，下限 0）", () => {
	assert.equal(segNetChars(mk(0, [5_000], 100, 80)), 20); // 写 100 又删 80 → 20
	assert.equal(segNetChars(mk(0, [5_000], 30, 90)), 0); // 删得比写得多 → 0（不为负）
	assert.equal(segNetChars(mk(0, [5_000], 30)), 30);
	const cells = renderStatsRow(mk(0, [5_000, 20_000], 100, 80), 60_000).split("|").map((c) => c.trim());
	assert.equal(cells[3], "20"); // 字数列＝净增
	assert.equal(cells[4], durText(10_000)); // 尾距 40s → 停顿 10s
	assert.equal(cells[5], speedText(20, 50_000)); // 速度也按净增核算
	assert.deepEqual(liveSegStats(mk(0, [5_000], 100, 80), 30_000, 600_000), { chars: 20, pauseMs: 0, activeMs: 30_000 });
});

test("parseDurText：durText 的逆解析（「无」/空=0，三档格式，无法识别→null）", () => {
	assert.equal(parseDurText("无"), 0);
	assert.equal(parseDurText(""), 0);
	assert.equal(parseDurText("45 秒"), 45_000);
	assert.equal(parseDurText("2 分"), 120_000);
	assert.equal(parseDurText("2 分 30 秒"), 150_000);
	assert.equal(parseDurText("1 时 2 分"), 3_720_000);
	assert.equal(parseDurText("—"), null);
	assert.equal(parseDurText("30s"), null);
	for (const ms of [0, 45_000, 120_000, 150_000, 3_720_000, 510_000]) {
		const back = parseDurText(ms === 0 ? "无" : durText(ms)); // 往返一致（整分省秒也可解析）
		assert.equal(back, ms === 0 ? 0 : ms, `往返 ${ms}`);
	}
});

test("parseStatsRow：五列表格行→起止/字数/停顿/活跃；表头与无效行→null；跨零点段加一天", () => {
	const header = "| 日期 | 时间段 | 有效字数 | 停顿 | 码字速度 |";
	assert.equal(parseStatsRow(header), null);
	assert.equal(parseStatsRow("| --- | --- | --- | --- | --- |"), null);
	assert.equal(parseStatsRow("一些手写正文"), null);
	const r = parseStatsRow("| 2026-11-16 | 14:00–14:10 | 812 | 8 分 30 秒 | 32480 字/小时 |");
	assert.ok(r);
	const base = new Date(2026, 10, 16, 14, 0, 0).getTime();
	assert.equal(r?.start, base);
	assert.equal(r?.end, base + 600_000);
	assert.equal(r?.chars, 812);
	assert.equal(r?.pauseMs, 510_000);
	assert.equal(r?.activeMs, 90_000);
	const night = parseStatsRow("| 2026-11-16 | 23:55–00:05 | 100 | 无 | 6000 字/小时 |");
	assert.equal(night?.end, (night?.start ?? 0) + 600_000); // 过零点
	const bad = parseStatsRow("| 2026-11-16 | 14:00–14:10 | 812 | 八分钟 | — |");
	assert.equal(bad, null); // 停顿列无法解析 → 整行跳过
});

test("summarizeStatsFile：逐行汇总（无效行/表头跳过）；空文本全 0", () => {
	assert.deepEqual(summarizeStatsFile(""), { segments: 0, chars: 0, pauseMs: 0, activeMs: 0 });
	const text = `${TYPE_STATS_HEADER}| 2026-11-16 | 14:00–14:10 | 812 | 8 分 30 秒 | 32480 字/小时 |\n| 2026-11-16 | 14:10–14:20 | 500 | 无 | 3000 字/小时 |\n随手写的一行\n`;
	assert.deepEqual(summarizeStatsFile(text), { segments: 2, chars: 1312, pauseMs: 510_000, activeMs: 600_000 + 90_000 });
});

test("窗口口径：锚点晚于段起点时只计锚点之后（pauseMsInWindow／segActiveMs／liveSegStats 的 from 形参）", () => {
	const seg = mk(0, [20_000, 40_000, 50_000], 60); // 段 0–600s，三次键入
	assert.equal(segActiveMs(seg, 60_000), 60_000); // 全窗口：首空档/间隔/尾距均 ≤30s → 无停顿
	assert.equal(segActiveMs(seg, 60_000, 30_000), 30_000); // 锚点 30s：窗口 30–60s，锚点前的键入不参与
	assert.equal(segActiveMs(seg, 400_000, 30_000), 50_000); // 窗口内尾距 350s → 停顿 320s、活跃 50s
	assert.equal(segActiveMs(seg, 400_000, 300_000), 0); // 窗口内没有键入＝没有写作会话
	assert.equal(pauseMsInWindow([20_000], 0, 100_000), 50_000); // 首空档 20s 不计、尾距 80s→超出 50s
	assert.equal(pauseMsInWindow([], 0, 100_000), 0);
	const seg0 = mk(0, [20_000, 40_000], 9);
	assert.equal(segmentPauseMs(seg0, 100_000), pauseMsInWindow(seg0.edits, seg0.start, 100_000)); // 段版＝窗口版在 from=段起点时同值
	assert.deepEqual(liveSegStats(seg, 60_000, 600_000, 30_000), { chars: 60, pauseMs: 0, activeMs: 30_000 });
	assert.deepEqual(liveSegStats(seg, 60_000, 600_000, 300_000), { chars: 60, pauseMs: 0, activeMs: 0 }); // 锚点晚于最后一次键入→活跃 0
});

test("liveSegStats：进行中段写到此刻的字数/停顿/活跃；停笔后活跃不再增长", () => {
	const start = 0;
	const seg = mk(start, [10_000, 60_000], 42);
	const a = liveSegStats(seg, 100_000, 600_000); // 此刻 100s：间隔 50s→20s 停顿、尾距 40s→10s → 停顿 30s、活跃 70s
	assert.deepEqual(a, { chars: 42, pauseMs: 30_000, activeMs: 70_000 });
	const b = liveSegStats(seg, 300_000, 600_000); // 继续停笔：停顿涨、活跃不变
	assert.deepEqual(b, { chars: 42, pauseMs: 230_000, activeMs: 70_000 });
	const c = liveSegStats(mk(start, [], 0), 300_000, 600_000); // 无键入事件
	assert.deepEqual(c, { chars: 0, pauseMs: 0, activeMs: 0 });
	const d = liveSegStats(mk(0, [590_000], 7), 700_000, 600_000); // 此刻越过段末→夹到段末；段首空档 590s→停顿 560s、活跃只剩 40s
	assert.deepEqual(d, { chars: 7, pauseMs: 560_000, activeMs: 40_000 });
});

test("nextSegmentStart：改段长后新段起点不回溯到上一段末之前（防区间重叠、时长双计）", () => {
	const grid30 = new Date(2026, 10, 16, 20, 30, 0).getTime();
	const prevEnd = new Date(2026, 10, 16, 20, 35, 0).getTime(); // 5 分钟段 20:30–20:35 已结算落盘
	const now = new Date(2026, 10, 16, 20, 36, 0).getTime();
	// 改成 30 分钟段：网格回溯到 20:30 会与刚落盘那段重叠 5 分钟（那 5 分钟两段各算一次活跃）→ 夹到上一段末
	assert.equal(nextSegmentStart(now, 30 * 60_000, prevEnd), prevEnd);
	assert.equal(nextSegmentStart(now, 30 * 60_000, 0), grid30); // 无上一段（换书/首次）＝纯网格对齐
	assert.equal(nextSegmentStart(now, 5 * 60_000, prevEnd), prevEnd); // 同段长顺次推进，夹取无副作用
	const row = renderStatsRow(mk(prevEnd, [prevEnd + 60_000], 100), prevEnd + 5 * 60_000); // 夹取后 20:35 起手，非整网格
	assert.ok(row.includes("20:35–20:40"));
});

test("段首空档不再被算进码字时长：跨度＝停顿＋活跃，读回同样自洽", () => {
	const start = segmentStartOf(new Date(2026, 10, 16, 22, 0, 0).getTime(), 30 * 60_000);
	const end = start + 30 * 60_000;
	const seg = mk(start, [start + 8 * 60_000], 79); // 22:08 敲了 79 字就走；22:00–22:08 的发呆以前算在活跃里
	const row = renderStatsRow(seg, end);
	assert.equal(row.split("|").map((c) => c.trim())[4], durText(1_740_000)); // (480−30)＋(1320−30)＝1740s
	const r = parseStatsRow(row);
	assert.ok(r);
	assert.equal(r?.chars, 79);
	assert.equal(r?.activeMs, 60_000); // 活跃只剩段首/段尾两段 30s 宽限＝60s（修复前虚增成 510s）
	assert.equal((r?.end ?? 0) - (r?.start ?? 0), (r?.pauseMs ?? 0) + (r?.activeMs ?? 0));
});

test("净增 0 的段仍写出有效行（字数 0、速度「—」），时长读回不丢＝时长守恒", () => {
	const seg = mk(0, [5_000, 40_000], 100, 100); // 写 100 又全删回去
	assert.equal(segNetChars(seg), 0);
	const row = renderStatsRow(seg, 120_000);
	const cells = row.split("|").map((c) => c.trim());
	assert.equal(cells[3], "0");
	assert.equal(cells[5], "—");
	const sum = summarizeStatsFile(`${row}\n`);
	assert.deepEqual(sum, { segments: 1, chars: 0, pauseMs: segmentPauseMs(seg, 120_000), activeMs: 120_000 - segmentPauseMs(seg, 120_000) });
	assert.ok(sum.activeMs > 0); // 这段时间仍计入「写作总时长」，落盘前后不跳变
});
