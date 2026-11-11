// 《时间线.md》时间线区（书/卷/章三层通用，v0.3.3+ 合并大事件字段）纯函数测试：解析/序列化往返、旧纯时间点标题兼容、时间点＋事件名标题、字段别名、写回定位（增删改）、时间点改写保留事件名。
import test from "node:test";
import assert from "node:assert/strict";

import {
	deleteTimelineBlock,
	formatTimelineBlock,
	formatTimelines,
	insertTimelineBlock,
	parseTimelineHeading,
	parseTimelines,
	rewriteTimelineEntryTime,
	timelineGenFormatOk,
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
	assert.equal(es[0].event, "甲起事");
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
	assert.equal(es[0].event, "第一行\n第二行自由文本");
	assert.equal(es[0].impact, "影响一\n影响续写");
});

void test("parseTimelines honours desc fence and ignores heading-like lines inside code fences", () => {
	const es = parseTimelines("## 10 围栏事件\n- 描述：\n```text\n# 这行不是标题\n围栏正文\n```\n- 事件：事件行\n");
	assert.equal(es.length, 1);
	assert.equal(es[0].desc, "# 这行不是标题\n围栏正文");
	assert.equal(es[0].event, "事件行");
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
	const e: Tl = { level: 7, time: 100, month: 3, title: " 往返事件 ", chars: ["张三", "李四"], done: true, event: "起头\n续写", desc: "详细描述", impact: "影响一二", related: ["黑石城之围", "旁支丙"] };
	const back = parseTimelines(formatTimelineBlock(e));
	assert.equal(back.length, 1);
	assert.equal(back[0].level, 6); // 序列化钳制到 ######
	assert.equal(back[0].time, 100);
	assert.equal(back[0].month, 3);
	assert.equal(back[0].title, "往返事件");
	assert.deepEqual(back[0].chars, ["张三", "李四"]);
	assert.equal(back[0].done, true);
	assert.equal(back[0].event, "起头\n续写");
	assert.equal(back[0].desc, "详细描述");
	assert.equal(back[0].impact, "影响一二");
	assert.deepEqual(back[0].related, ["黑石城之围", "旁支丙"]);
});

void test("formatTimelineBlock keeps old no-title heading and omits undone done-line (round-trip stable)", () => {
	const plain = formatTimelineBlock({ level: 2, time: 77, chars: [], done: false, event: "经过" });
	assert.ok(plain.startsWith("## 77\n"));
	assert.ok(!plain.includes("- 完成：")); // 未完成不写行（往返稳定）
	const back = parseTimelines(plain);
	assert.equal(back[0].title, undefined);
	assert.equal(back[0].done, undefined);
});

void test("formatTimelines keeps doc title `# 时间线` and all entries parse back", () => {
	const text = formatTimelines([{ level: 1, time: 1, chars: [], event: "一" }, { level: 2, time: 2, title: "二", chars: [], event: "" }]);
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

void test("updateTimelineBlock replaces own block keeping children; null on miss", () => {
	const upd = updateTimelineBlock(doc, "## 120-06", 0, { level: 2, time: 121, month: 1, title: "新名", chars: [], event: "新经过" });
	assert.ok(upd);
	const es = parseTimelines(upd);
	assert.deepEqual(es.map((x) => x.level), [1, 2, 3]);
	assert.equal(es[1].title, "新名");
	assert.ok(upd.includes("### 120-06-15 旁支丙")); // 子块保留

	assert.equal(updateTimelineBlock(doc, "## 不存在", 0, { level: 2, time: 1, chars: [], event: "" }), null);
});

void test("insertTimelineBlock anchors after full subtree (child/sibling) or appends; null on bad anchor", () => {
	const child = insertTimelineBlock(doc, { level: 2, time: 119, title: "新子事件", chars: [], event: "x" }, "# 120 黑石城之围", 0);
	assert.ok(child);
	const es = parseTimelines(child);
	assert.deepEqual(es.map((x) => x.level), [1, 2, 3, 2]); // 挂在一级块子树末尾（原 ##/### 之后）

	const tail = insertTimelineBlock(doc, { level: 2, time: 200, title: "末尾事件", chars: [], event: "" }, null, 0);
	assert.ok(tail);
	const es2 = parseTimelines(tail);
	assert.equal(es2.length, 4);
	assert.equal(es2[3].title, "末尾事件");

	const fromEmpty = insertTimelineBlock("", { level: 2, time: 5, chars: [], event: "" }, null, 0);
	assert.ok(fromEmpty);
	assert.ok(fromEmpty.startsWith("## 5\n"));

	assert.equal(insertTimelineBlock(doc, { level: 2, time: 1, chars: [], event: "" }, "## 不存在", 0), null);
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
		updateTimelineBlock(doc, "## 120-06", 0, { level: 2, time: 120, month: 6, chars: [], event: "" }),
		deleteTimelineBlock(doc, "## 120-06", 0, 2, false),
		insertTimelineBlock(doc, { level: 2, time: 120, month: 7, chars: [], event: "" }, "# 120 黑石城之围", 0),
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
