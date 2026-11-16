import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SKILLS, TENSION_TOOLBOX_TAIL } from "./skills_default";
import { renderInspirationBody } from "./inspiration"; // v0.4.3+ 灵感工具包：内置「灵感模板」技能与渲染器的口径一致性

void test("张力工具箱 skill carries the merged tension-rules sections", () => {
	const toolbox = DEFAULT_SKILLS["张力工具箱"] ?? "";
	assert.ok(toolbox.startsWith("# 张力工具箱\n"));
	// 合并版＝原 A–G 手法 + 张力规则独有的「节奏控制」与「用法建议」（旧 TENSION_RULES.md / 书级《张力规则.md》并入）
	for (const heading of ["### A. 赌注升级", "### B. 时间压力", "### C. 盟友变数", "### D. 两难选择", "### E. 悬念反转", "### F. 章末钩子", "### G. 反派塑造", "### H. 节奏控制", "### 用法建议"]) {
		assert.ok(toolbox.includes(heading), `missing heading: ${heading}`);
	}
	assert.ok(toolbox.endsWith(TENSION_TOOLBOX_TAIL), "内置合并版应以 TENSION_TOOLBOX_TAIL 收尾（存量文件补齐与播种共用同一事实源）");
});

void test("张力规则旧条目在合并版里逐条留存", () => {
	const toolbox = DEFAULT_SKILLS["张力工具箱"] ?? "";
	// 旧《张力规则.md》七、节奏控制三条＋用法建议（其余 27 条与 A–G 逐字相同，不重复断言）
	for (const line of ["三章一小紧，十章一大紧", "高潮前让主角失去最重要的东西", "让主角的最低点发生在他最自信的时候", "贯穿全书：", "中期轮换：", "高潮前密集用：", "每章必用："]) {
		assert.ok(toolbox.includes(line), `missing merged line: ${line}`);
	}
	// 追加到用户改写过的精简版也不指空：用法建议一律用手法名、不用 A1/F5 之类段落编号
	assert.ok(!/（A\d|（F\d|第\d+条/.test(TENSION_TOOLBOX_TAIL));
});

void test("内置「灵感模板」技能与灵感工具包渲染口径一致：正文不含一二级标题、占位符全替换", () => {
	const tpl = DEFAULT_SKILLS["灵感模板"] ?? "";
	assert.ok(tpl.startsWith("# 灵感模板\n"), "SKILLS/灵感模板.md 播种文本以 H1 开头（渲染时丢弃）");
	const body = renderInspirationBody(tpl, { name: "雨夜追凶", date: "2026-11-16" });
	assert.ok(body.trim(), "内置模板要渲染出非空正文（新增灵感不该写出只有标题的空块）");
	assert.ok(!/^#{1,2}\s/m.test(body), "模板正文里不能有一/二级标题——灵感块的 ## 边界会被破坏（渲染器也会降为 ###）");
	assert.ok(!body.includes("<!--") && !body.includes("{{"), "技能头注释不进块、占位符全部替换");
	assert.ok(body.includes("雨夜追凶"), "{{name}} 由插件替换（日期已经写在块标题里，模板正文不必重复）");
});
