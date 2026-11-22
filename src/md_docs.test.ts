// 《时间线.md》时间线区（书/卷/章三层通用，v0.3.3+ 合并大事件字段）纯函数测试：解析/序列化往返、旧纯时间点标题兼容、时间点＋事件名标题、字段别名、写回定位（增删改）、时间点改写保留事件名。
import test from "node:test";
import assert from "node:assert/strict";

import {
	deleteRelationshipBlock,
	deleteTimelineBlock,
	docLocationLabel,
	docRelPath,
	formatTimelineBlock,
	formatTimelines,
	insertTimelineBlock,
	isTimelineDocName,
	parseRelationships,
	parseTimelineHeading,
	parseTimelines,
	rewriteTimelineEntryTime,
	rewriteTimelineEntryTimes,
	shiftTimelinePointBy,
	sliceVolOutlineChapters,
	timelineGenFormatOk,
	timelineLaneOf,
	updateRelationshipBlock,
	updateTimelineBlock,
	type TimelineEntryInput,
} from "./md_docs";

type Tl = TimelineEntryInput;

const doc = `# 时间线

# 120 黑石城之围
- 人物：张三、李四
- 事件：甲起事

## 120-06
- 事件：经过一

### 120-06-15 旁支丙
- 影响：代价大
- 关联：黑石城之围、经过二
`;

void test("parseTimelines reads levels, title, fields and src location; H1 doc title ignored", () => {
	const es = parseTimelines(doc);
	assert.equal(es.length, 3);
	assert.equal(es[0].level, 1);
	assert.equal(es[0].title, "黑石城之围");
	assert.equal(es[0].time, 120);
	assert.deepEqual(es[0].chars, ["张三", "李四"]);
	assert.equal(es[0].desc, "甲起事"); // 旧 `- 事件：` 内容已并入详情
	assert.equal(es[0].srcHeading, "# 120 黑石城之围");
	assert.equal(es[0].srcOrdinal, 0);
	assert.equal(es[0].done, undefined); // 无 `- 完成：` 行＝字段缺省（往返稳定）
	assert.equal(es[1].title, undefined); // 旧纯时间点标题＝无名
	assert.equal(es[1].month, 6);
	assert.equal(es[1].day, undefined);
	assert.equal(es[2].level, 3);
	assert.equal(es[2].month, 6);
	assert.equal(es[2].day, 15);
	assert.equal(es[2].impact, "代价大");
	assert.deepEqual(es[2].related, ["黑石城之围", "经过二"]);
});

void test("parseTimelineHeading: bare point, point+title, legacy decimals, invalid first token", () => {
	assert.deepEqual(parseTimelineHeading("120"), { point: { time: 120 } });
	assert.deepEqual(parseTimelineHeading("-129-06-15"), { point: { time: -129, month: 6, day: 15 } });
	assert.deepEqual(parseTimelineHeading("120-06-15 黑市陷阱"), { point: { time: 120, month: 6, day: 15 }, title: "黑市陷阱" });
	assert.deepEqual(parseTimelineHeading("1.5 旧写法事件名"), { point: { time: 1.5 }, title: "旧写法事件名" });
	assert.equal(parseTimelineHeading("时间线"), null);
	assert.equal(parseTimelineHeading("概述 里混的数字"), null);
	assert.equal(parseTimelineHeading("120-13 月份越界"), null); // 首 token 非法月份＝整行非时间点标题
	assert.equal(parseTimelineHeading("120-06-32 日越界"), null);
});

void test("parseTimelines honours field aliases and folds free text into nearest field", () => {
	const es = parseTimelines("### -5-03 旧事件\n经过：第一行\n第二行自由文本\n后果：影响一\n影响续写\n- 发生章节：第三章\n- 裸列表项不算正文\n");
	assert.equal(es.length, 1);
	assert.equal(es[0].desc, "第一行\n第二行自由文本"); // 旧「经过」别名并入详情
	assert.equal(es[0].impact, "影响一\n影响续写");
});

void test("parseTimelines honours desc fence and ignores heading-like lines inside code fences", () => {
	const es = parseTimelines("## 10 围栏事件\n- 描述：\n```text\n# 这行不是标题\n围栏正文\n```\n- 事件：事件行\n");
	assert.equal(es.length, 1);
	assert.equal(es[0].desc, "# 这行不是标题\n围栏正文\n事件行"); // 旧 `- 事件：` 与描述围栏同归详情
});

void test("parseTimelines disambiguates identical heading lines via srcOrdinal", () => {
	const es = parseTimelines("## 90 同名\n- 事件：一\n## 90 同名\n- 事件：二\n");
	assert.equal(es.length, 2);
	assert.equal(es[0].srcOrdinal, 0);
	assert.equal(es[1].srcOrdinal, 1);
});

void test("parseTimelines reads done field (aliases and values); empty value counts as checked", () => {
	const es = parseTimelines("# 8 甲\n- 完成：是\n## 9 乙\n- 状态：否\n### 10 丙\n- 完成：\n#### 11 丁\n- 完成状态：已完成\n");
	assert.deepEqual(es.map((x) => x.done), [true, undefined, true, true]); // 「否」＝显式未完成，字段仍缺省（往返稳定）
});

void test("formatTimelineBlock round-trips through parseTimelines (title, fields, level clamp)", () => {
	const e: Tl = { level: 7, time: 100, month: 3, title: " 往返事件 ", chars: ["张三", "李四"], done: true, desc: "起头\n续写", impact: "影响一二", related: ["黑石城之围", "旁支丙"] };
	const back = parseTimelines(formatTimelineBlock(e));
	assert.equal(back.length, 1);
	assert.equal(back[0].level, 6); // 序列化钳制到 ######
	assert.equal(back[0].time, 100);
	assert.equal(back[0].month, 3);
	assert.equal(back[0].title, "往返事件");
	assert.deepEqual(back[0].chars, ["张三", "李四"]);
	assert.equal(back[0].done, true);
	assert.equal(back[0].desc, "起头\n续写");
	assert.equal(back[0].impact, "影响一二");
	assert.deepEqual(back[0].related, ["黑石城之围", "旁支丙"]);
});

void test("旧 `- 事件：`／`- 描述：` 解析时并入详情，写回只出 `- 详情：`", () => {
	const old = "# 时间线\n\n## 120 甲\n- 人物：A\n- 事件：旧简述\n- 描述：旧详细\n- 影响：代价\n";
	const es = parseTimelines(old);
	assert.equal(es.length, 1);
	assert.equal(es[0].desc, "旧简述\n旧详细"); // 两个旧字段按文档顺序合并
	assert.ok(!("event" in es[0]), "解析结果不再有独立 event 字段");
	const upd = updateTimelineBlock(old, "## 120 甲", 0, { level: 2, time: 120, chars: ["A"], desc: es[0].desc, impact: "代价" });
	assert.ok(upd);
	assert.ok(upd.includes("- 详情："));
	assert.ok(!upd.includes("- 事件："), "写回不再落盘事件字段");
	assert.ok(!upd.includes("- 描述："));
	assert.equal(parseTimelines(upd)[0].desc, "旧简述\n旧详细"); // 往返内容不丢
});

void test("formatTimelineBlock keeps old no-title heading and omits undone done-line (round-trip stable)", () => {
	const plain = formatTimelineBlock({ level: 2, time: 77, chars: [], done: false, desc: "详情内容" });
	assert.ok(plain.startsWith("## 77\n"));
	assert.ok(!plain.includes("- 完成：")); // 未完成不写行（往返稳定）
	assert.ok(plain.includes("- 详情：")); // 唯一正文内容字段
	assert.ok(!plain.includes("- 事件："));
	const back = parseTimelines(plain);
	assert.equal(back[0].title, undefined);
	assert.equal(back[0].done, undefined);
});

void test("formatTimelines keeps doc title `# 时间线` and all entries parse back", () => {
	const text = formatTimelines([{ level: 1, time: 1, chars: [], desc: "一" }, { level: 2, time: 2, title: "二", chars: [], desc: "" }]);
	assert.ok(text.startsWith("# 时间线\n"));
	const es = parseTimelines(text);
	assert.equal(es.length, 2);
	assert.equal(es[1].title, "二");
});

void test("rewriteTimelineEntryTime replaces point and keeps event name; null on stale snapshot", () => {
	const upd = rewriteTimelineEntryTime(doc, "## 120-06", 0, { time: 120, month: 6 }, { time: 130, month: 7, day: 3 });
	assert.ok(upd);
	assert.ok(upd.includes("## 130-07-03")); // 旧纯时间点标题：只换时间点

	const named = rewriteTimelineEntryTime(doc, "# 120 黑石城之围", 0, { time: 120 }, { time: 121 });
	assert.ok(named);
	assert.ok(named.includes("# 121 黑石城之围")); // 事件名保留

	assert.equal(rewriteTimelineEntryTime(doc, "# 120 黑石城之围", 0, { time: 999 }, { time: 121 }), null); // 快照过期
	assert.equal(rewriteTimelineEntryTime(doc, "# 不存在", 0, { time: 120 }, { time: 121 }), null);
});

void test("shiftTimelinePointBy：按父事件精度单位平移、子事件保持自身精度（含月末夹取）", () => {
	// 天单位：日精度→精确日期（跨月/跨年自动进位），月精度→落到目标月，年精度→只动年份
	assert.deepEqual(shiftTimelinePointBy({ time: 120, month: 1, day: 31 }, "day", 1), { time: 120, month: 2, day: 1 });
	assert.deepEqual(shiftTimelinePointBy({ time: 120, month: 12, day: 31 }, "day", 1), { time: 121, month: 1, day: 1 });
	assert.deepEqual(shiftTimelinePointBy({ time: 120, month: 6 }, "day", 40), { time: 120, month: 7 }); // 月精度不补日
	assert.deepEqual(shiftTimelinePointBy({ time: 120 }, "day", 400), { time: 121 }); // 年精度只取结果年份
	// 月单位：整月算术（负年份分解正确），月末夹到目标月最后一天
	assert.deepEqual(shiftTimelinePointBy({ time: 120, month: 12 }, "month", 1), { time: 121, month: 1 });
	assert.deepEqual(shiftTimelinePointBy({ time: -1, month: 1 }, "month", -1), { time: -2, month: 12 });
	assert.deepEqual(shiftTimelinePointBy({ time: 121, month: 1, day: 31 }, "month", 1), { time: 121, month: 2, day: 28 });
	assert.deepEqual(shiftTimelinePointBy({ time: 120, month: 3, day: 31 }, "month", -1), { time: 120, month: 2, day: 29 }); // 闰年 2 月 29
	assert.deepEqual(shiftTimelinePointBy({ time: 120 }, "month", 13), { time: 121 }); // 年精度只取年份
	// 年单位：整年加减，闰日夹到平年 2 月 28
	assert.deepEqual(shiftTimelinePointBy({ time: 120, month: 2, day: 29 }, "year", 1), { time: 121, month: 2, day: 28 });
	assert.deepEqual(shiftTimelinePointBy({ time: 120, month: 6 }, "year", 2), { time: 122, month: 6 });
	assert.deepEqual(shiftTimelinePointBy({ time: 120 }, "year", 3), { time: 123 });
	// steps=0 原样返回（含精度字段）
	assert.deepEqual(shiftTimelinePointBy({ time: 120, month: 6, day: 15 }, "year", 0), { time: 120, month: 6, day: 15 });
});

void test("rewriteTimelineEntryTimes：一次批量改写多条（含同名重复标题按出现序号消歧），任一失败整批放弃", () => {
	const dup = `# 时间线\n\n## 120-06\n- 事件：一\n\n## 120-06\n- 事件：二\n`;
	// 两条同名标题：序号 0/1 分别定位到第一/第二条；批量改写不会因先改一条而让另一条的序号漂移
	const both = rewriteTimelineEntryTimes(dup, [
		{ srcHeading: "## 120-06", srcOrdinal: 1, expectOld: { time: 120, month: 6 }, newPoint: { time: 121, month: 7 } },
		{ srcHeading: "## 120-06", srcOrdinal: 0, expectOld: { time: 120, month: 6 }, newPoint: { time: 122, month: 8 } },
	]);
	assert.ok(both);
	const es = parseTimelines(both);
	assert.deepEqual(es.map((x) => [x.time, x.month]), [[122, 8], [121, 7]], "按原序号各自改到正确位置");
	assert.deepEqual(es.map((x) => x.desc), ["一", "二"], "正文不动（旧 - 事件：已并入详情）");
	// 父子同步：父＋两个子事件一起平移
	const tree = rewriteTimelineEntryTimes(doc, [
		{ srcHeading: "# 120 黑石城之围", srcOrdinal: 0, expectOld: { time: 120 }, newPoint: { time: 121 } },
		{ srcHeading: "## 120-06", srcOrdinal: 0, expectOld: { time: 120, month: 6 }, newPoint: { time: 121, month: 6 } },
		{ srcHeading: "### 120-06-15 旁支丙", srcOrdinal: 0, expectOld: { time: 120, month: 6, day: 15 }, newPoint: { time: 121, month: 6, day: 15 } },
	]);
	assert.ok(tree);
	assert.ok(tree.includes("# 121 黑石城之围") && tree.includes("## 121-06\n") && tree.includes("### 121-06-15 旁支丙"));
	// 任一条定位失败/旧值不符/重复目标 → 整批 null（不做部分写回）
	assert.equal(rewriteTimelineEntryTimes(doc, [
		{ srcHeading: "## 120-06", srcOrdinal: 0, expectOld: { time: 120, month: 6 }, newPoint: { time: 121, month: 6 } },
		{ srcHeading: "## 不存在", srcOrdinal: 0, expectOld: { time: 120 }, newPoint: { time: 121 } },
	]), null);
	assert.equal(rewriteTimelineEntryTimes(doc, [
		{ srcHeading: "## 120-06", srcOrdinal: 0, expectOld: { time: 999 }, newPoint: { time: 121, month: 6 } },
	]), null);
	assert.equal(rewriteTimelineEntryTimes(doc, [
		{ srcHeading: "## 120-06", srcOrdinal: 0, expectOld: { time: 120, month: 6 }, newPoint: { time: 121, month: 6 } },
		{ srcHeading: "## 120-06", srcOrdinal: 0, expectOld: { time: 120, month: 6 }, newPoint: { time: 122, month: 6 } },
	]), null);
	assert.equal(rewriteTimelineEntryTimes(doc, []), doc, "空批次＝原样返回");
});

void test("updateTimelineBlock replaces own block keeping children; null on miss", () => {
	const upd = updateTimelineBlock(doc, "## 120-06", 0, { level: 2, time: 121, month: 1, title: "新名", chars: [], desc: "新详情" });
	assert.ok(upd);
	const es = parseTimelines(upd);
	assert.deepEqual(es.map((x) => x.level), [1, 2, 3]);
	assert.equal(es[1].title, "新名");
	assert.ok(upd.includes("### 120-06-15 旁支丙")); // 子块保留

	assert.equal(updateTimelineBlock(doc, "## 不存在", 0, { level: 2, time: 1, chars: [], desc: "" }), null);
});

void test("insertTimelineBlock anchors after full subtree (child/sibling) or appends; null on bad anchor", () => {
	const child = insertTimelineBlock(doc, { level: 2, time: 119, title: "新子事件", chars: [], desc: "x" }, "# 120 黑石城之围", 0);
	assert.ok(child);
	const es = parseTimelines(child);
	assert.deepEqual(es.map((x) => x.level), [1, 2, 3, 2]); // 挂在一级块子树末尾（原 ##/### 之后）

	const tail = insertTimelineBlock(doc, { level: 2, time: 200, title: "末尾事件", chars: [], desc: "" }, null, 0);
	assert.ok(tail);
	const es2 = parseTimelines(tail);
	assert.equal(es2.length, 4);
	assert.equal(es2[3].title, "末尾事件");

	const fromEmpty = insertTimelineBlock("", { level: 2, time: 5, chars: [], desc: "" }, null, 0);
	assert.ok(fromEmpty);
	assert.ok(fromEmpty.startsWith("## 5\n"));

	assert.equal(insertTimelineBlock(doc, { level: 2, time: 1, chars: [], desc: "" }, "## 不存在", 0), null);
});

void test("deleteTimelineBlock removes subtree or own block only; null on miss", () => {
	const whole = deleteTimelineBlock(doc, "## 120-06", 0, 2, true);
	assert.ok(whole);
	assert.ok(!whole.includes("### 120-06-15 旁支丙")); // 后代同删
	assert.deepEqual(parseTimelines(whole).map((x) => x.title), ["黑石城之围"]);

	const root = deleteTimelineBlock(doc, "# 120 黑石城之围", 0, 1, true); // 根＝全部（其余都是后代）
	assert.ok(root);
	assert.equal(parseTimelines(root).length, 0);

	const self = deleteTimelineBlock(doc, "## 120-06", 0, 2, false);
	assert.ok(self);
	assert.ok(!self.includes("\n## 120-06\n")); // 整行判定：### 120-06-15 含同名子串
	assert.deepEqual(parseTimelines(self).map((x) => x.level), [1, 3]);

	assert.equal(deleteTimelineBlock(doc, "## 不存在", 0, 2, true), null);
});

void test("write-back results keep single blank line between blocks and trailing newline", () => {
	for (const res of [
		updateTimelineBlock(doc, "## 120-06", 0, { level: 2, time: 120, month: 6, chars: [], desc: "" }),
		deleteTimelineBlock(doc, "## 120-06", 0, 2, false),
		insertTimelineBlock(doc, { level: 2, time: 120, month: 7, chars: [], desc: "" }, "# 120 黑石城之围", 0),
	]) {
		assert.ok(res);
		assert.ok(!res.includes("\n\n\n"));
		assert.ok(res.endsWith("\n"));
	}
});

void test("timelineGenFormatOk: point headings pass; non-point bodies and fenced headings fail", () => {
	assert.equal(timelineGenFormatOk(doc), true);
	assert.equal(timelineGenFormatOk("# 时间线\n概述说明\n## 无时间点标题\n"), false);
	assert.equal(timelineGenFormatOk("# 时间线\n```text\n## 120 围栏里的不算\n```\n"), false);
	assert.equal(timelineGenFormatOk("## 120-06-15 黑市陷阱\n- 事件：甲\n"), true);
	assert.equal(timelineGenFormatOk(""), false);
});

// v0.4.3+：编写文章阶段「前后 N 章大纲节选」切片——前言恒保留、窗口外章块丢弃、标记行原样保留
void test("sliceVolOutlineChapters：按章号窗口取块，前言恒保留，章标记行与围栏内容逐字保留", () => {
	const outline = [
		"# 第一卷 风起 卷大纲",
		"",
		"## 卷设计",
		"本卷从低谷走向反击，止于初次正面交锋。",
		"",
		"## 第1章 开局",
		"主角失业。",
		"",
		"## 第2章 相遇",
		"雨夜相遇。",
		"",
		"## 第3章 交锋",
		"```text",
		"第9章 围栏里的不算标记",
		"```",
		"",
		"## 第4章 低潮",
		"计划失败。",
	].join("\n");
	assert.equal(
		sliceVolOutlineChapters(outline, 2, 3),
		[
			"# 第一卷 风起 卷大纲",
			"",
			"## 卷设计",
			"本卷从低谷走向反击，止于初次正面交锋。",
			"",
			"## 第2章 相遇",
			"雨夜相遇。",
			"",
			"## 第3章 交锋",
			"```text",
			"第9章 围栏里的不算标记",
			"```",
		].join("\n"),
		"窗口 [2,3]：保留前言与第 2/3 章块，第 1/4 章丢弃，围栏内「第9章」不被当作标记",
	);
	assert.equal(sliceVolOutlineChapters(outline, 1, 4), outline.trim(), "窗口覆盖全书 → 与原文等价（调用方据此回退整份）");
	assert.equal(sliceVolOutlineChapters(outline, 9, 12), "# 第一卷 风起 卷大纲\n\n## 卷设计\n本卷从低谷走向反击，止于初次正面交锋。", "窗口无章块 → 只剩前言");
	assert.equal(sliceVolOutlineChapters("## 第1章 甲\n内容\n", 2, 3), "", "无前言且窗口无章块 → 空串");
});

test("多时间线命名口径（v0.4.7+）：时间线开头文档识别与泳道名解析", () => {
	assert.equal(isTimelineDocName("时间线.md"), true, "默认时间线");
	assert.equal(isTimelineDocName("时间线-战斗线.md"), true, "扩展时间线");
	assert.equal(isTimelineDocName("时间线-.md"), false, "「时间线-」后无名字不算");
	assert.equal(isTimelineDocName("章节时间线.md"), false, "非「时间线」开头不算");
	assert.equal(isTimelineDocName("时间线.md.bak"), false, "非 .md 不算");
	assert.equal(timelineLaneOf("时间线.md"), "默认");
	assert.equal(timelineLaneOf("时间线-战斗线.md"), "战斗线");
	assert.equal(timelineLaneOf("01-初见-时间线.md", ["01-初见"]), "默认", "章节目录旧命名剥前缀后为默认泳道");
	assert.equal(timelineLaneOf("01-初见-时间线-感情线.md", ["01-初见"]), "感情线", "旧命名带泳道名");
	assert.equal(timelineLaneOf("风起-时间线-支线.md", ["风起"]), "支线", "卷目录旧前缀");
	assert.equal(timelineLaneOf("时间线-卷首-序.md"), "卷首-序", "名字里仍可含连字符（只剥第一段前缀）");
});

test("时间线字段收敛到详情（v0.4.11+）：旧 事件／描述 兼容解析、写回统一出 `- 详情：`", () => {
	const legacy = ["## 120 黑市陷阱", "- 人物：张三", "- 事件：潜入黑市", "- 描述：", "```text", "旧式描述正文", "```"].join("\n");
	const [e] = parseTimelines(legacy);
	assert.equal(e.desc, "潜入黑市\n旧式描述正文", "旧 `- 事件：` 与 `- 描述：` 都并入详情");
	const out = formatTimelineBlock(e);
	assert.ok(out.includes("- 详情："), "写回统一输出 `- 详情：`");
	assert.ok(!out.includes("- 描述：") && !out.includes("- 事件："), "不再输出两个旧字段名");
	const back = parseTimelines(out);
	assert.equal(back[0].desc, "潜入黑市\n旧式描述正文", "新格式解析往返一致");
	const e2 = parseTimelines("## 121 甲\n- 事件：旧事件内容\n- 详情：详情走详情字段\n");
	assert.equal(e2[0].desc, "旧事件内容\n详情走详情字段", "旧「事件」与「详情」同归详情字段（按出现顺序合并）");
});

void test("updateRelationshipBlock/deleteRelationshipBlock：双击连线编辑/右键删除只改目标块（含旧值校验）", () => {
	const doc = [
		"# 人物关系",
		"",
		"## 林川 - 苏晚",
		"- 类型：师徒",
		"- 状态：进行中",
		"- 描述：",
		"```text",
		"初见",
		"```",
		"",
		"## 甲 - 乙",
		"- 类型：朋友",
		"",
	].join("\n");
	const old = { a: "林川", b: "苏晚", type: "师徒", status: "进行中", desc: "初见" };
	const upd = updateRelationshipBlock(doc, old, { ...old, type: "恋人", status: "已结束", desc: "后来" });
	assert.ok(upd);
	const es = parseRelationships(upd);
	assert.equal(es.length, 2, "另一条关系块保留");
	assert.deepEqual([es[0].a, es[0].b, es[0].type, es[0].status, es[0].desc], ["林川", "苏晚", "恋人", "已结束", "后来"]);
	assert.equal(es[1].type, "朋友");
	assert.equal(updateRelationshipBlock(doc, { ...old, a: "不存在" }, old), null, "定位失败返回 null（防快照过期误写）");

	const del = deleteRelationshipBlock(doc, old);
	assert.ok(del);
	const left = parseRelationships(del);
	assert.equal(left.length, 1);
	assert.deepEqual([left[0].a, left[0].b], ["甲", "乙"]);
	assert.equal(deleteRelationshipBlock(doc, { ...old, b: "不存在" }), null);
});

// ---------- v0.4.9+ 「级别／所在文档」文案（场景／时间线／人物关系三个面板的弹窗与行上出处标签共用口径） ----------

void test("docRelPath：剥掉书目录前缀＝从书籍目录起算的位置（不带《工作目录/<书名>/》）", () => {
	const dir = "我的工作/写书计划/曜尽溟回";
	assert.equal(docRelPath(`${dir}/案头资料/时间线.md`, dir), "案头资料/时间线.md");
	assert.equal(docRelPath(`${dir}/书稿/风起-时间线.md`, dir), "书稿/风起-时间线.md");
	assert.equal(docRelPath(`${dir}/案头资料/人物.md`, dir), "案头资料/人物.md", "任何文档同一口径");
});

void test("docRelPath：bookDir 空／路径不在该书目录下＝原样返回（不把异常路径吞成相对）", () => {
	const pth = "我的工作/写书计划/曜尽溟回/案头资料/时间线.md";
	assert.equal(docRelPath(pth, ""), pth, "无书目录＝原样");
	assert.equal(docRelPath(pth, "我的工作/写书计划/别的书"), pth, "书目录对不上＝原样");
	assert.equal(docRelPath(pth, pth), pth, "路径恰等于书目录＝原样（不是其子路径）");
});

void test("docLocationLabel：层级词 · 书内路径（默认书级／卷级／章级＋文件名都在文案里）", () => {
	const dir = "我的工作/写书计划/曜尽溟回";
	assert.equal(docLocationLabel("book", `${dir}/案头资料/时间线.md`, dir), "书级 · 案头资料/时间线.md");
	assert.equal(docLocationLabel("volume", `${dir}/书稿/第一卷 风起/文档/时间线-战斗线.md`, dir), "卷级 · 书稿/第一卷 风起/文档/时间线-战斗线.md");
	assert.equal(docLocationLabel("chapter", `${dir}/书稿/01-初见/01-初见-时间线.md`, dir), "章级 · 书稿/01-初见/01-初见-时间线.md");
});

void test("docLocationLabel：面板自带层级词（人物关系面板＝书籍级）＝同一拼法、换词不换口径", () => {
	const dir = "我的工作/写书计划/曜尽溟回";
	const words = { book: "书籍级", volume: "卷级", chapter: "章级" };
	assert.equal(docLocationLabel("book", `${dir}/案头资料/人物.md`, dir, words), "书籍级 · 案头资料/人物.md");
	assert.equal(docLocationLabel("volume", `${dir}/书稿/第一卷 风起/人物.md`, dir, words), "卷级 · 书稿/第一卷 风起/人物.md");
});
