import test from "node:test";
import assert from "node:assert/strict";

import {
	appendInspirationBlock,
	DEFAULT_INSPIRATION_NAME,
	ensureInspirationDocHeader,
	inspirationDate,
	inspirationDocHeader,
	inspirationHeading,
	inspirationMatches,
	inspirationPreview,
	normalizeInspirationName,
	parseInspirationDoc,
	parseInspirationHeading,
	removeInspirationBlock,
	renameInspirationBlock,
	renderInspirationBlock,
	renderInspirationBody,
} from "./inspiration";

const TEMPLATE = `# 灵感模板

<!-- 新增灵感时把本文件正文追加到灵感文档末尾；标题行由插件生成。占位符 {{name}}/{{date}}。 -->

## 画面

写一个具体画面：{{name}}（记于 {{date}}）

### 可用位置

-
`;

const doc = `${inspirationDocHeader("测试书")}
## 雨夜追凶 · 2026-11-14

主角在雨里认出凶手的声音。

### 可用位置

- 第 3 章

## 未命名 · 2026-11-16

只有一句话。
`;

test("灵感文档：只按二级标题切块，块内三级标题属于正文，名字/日期分开解析", () => {
	const blocks = parseInspirationDoc(doc);
	assert.equal(blocks.length, 2);
	assert.deepEqual(
		blocks.map((b) => ({ name: b.name, date: b.date, heading: b.heading })),
		[
			{ name: "雨夜追凶", date: "2026-11-14", heading: "雨夜追凶 · 2026-11-14" },
			{ name: "未命名", date: "2026-11-16", heading: "未命名 · 2026-11-16" },
		]
	);
	assert.match(blocks[0].body, /### 可用位置/); // 深层标题留在块内
	assert.ok(!blocks[0].body.includes("未命名")); // 到下一块标题为止
	assert.ok(blocks[0].line > 0 && blocks[0].endLine > blocks[0].line);
});

test("灵感标题：没有日期尾段时整串都是名字；渲染/解析互逆", () => {
	assert.deepEqual(parseInspirationHeading("老桥洞下的信箱"), { name: "老桥洞下的信箱", date: "" });
	assert.deepEqual(parseInspirationHeading(inspirationHeading("老桥洞", "2026-01-02")), { name: "老桥洞", date: "2026-01-02" });
	assert.equal(inspirationHeading("  ", ""), DEFAULT_INSPIRATION_NAME); // 名字空→未命名，无日期就不带日期段
	assert.equal(inspirationDate(new Date(2026, 10, 16)), "2026-11-16");
});

test("灵感名清洗：去掉破坏标题的字符与顺手写的日期尾巴，空名回落「未命名」", () => {
	assert.equal(normalizeInspirationName(""), DEFAULT_INSPIRATION_NAME);
	assert.equal(normalizeInspirationName("  ## 卧底[警察]  \t|卧底  "), "卧底 警察 卧底"); // #、[]、| 都会破坏标题/链接 → 换成空格
	assert.equal(normalizeInspirationName("卧底 · 2026-11-14"), "卧底");
	assert.equal(normalizeInspirationName("x".repeat(60)).length, 40);
});

test("灵感模板渲染：丢文件标题与注释块、一二级标题降为三级、占位符替换", () => {
	const body = renderInspirationBody(TEMPLATE, { name: "雨夜追凶", date: "2026-11-16" });
	assert.ok(!body.includes("# 灵感模板"), "模板自己的 H1 不进块");
	assert.ok(!body.includes("<!--"), "技能头注释不进块");
	assert.ok(body.includes("### 画面"), "模板里的 ## 小节降为 ###，灵感块的二级边界不被破坏");
	assert.ok(body.includes("### 可用位置"), "原本的 ### 保持三级");
	assert.ok(body.includes("写一个具体画面：雨夜追凶（记于 2026-11-16）"));
	const block = renderInspirationBlock("雨夜追凶", "2026-11-16", TEMPLATE);
	assert.ok(block.startsWith("## 雨夜追凶 · 2026-11-16\n\n"));
	assert.deepEqual(parseInspirationDoc(`# 灵感\n\n${block}\n`).map((b) => b.name), ["雨夜追凶"]);
});

test("灵感增删：文末追加→解析→按行删除，剩余块完好（含 CRLF 文件保住换行风格）", () => {
	let md = ensureInspirationDocHeader("", "测试书");
	assert.match(md, /^# 灵感（测试书）/);
	md = appendInspirationBlock(md, renderInspirationBlock("第一条", "2026-11-01", TEMPLATE));
	md = appendInspirationBlock(md, renderInspirationBlock("第二条", "2026-11-02", ""));
	assert.ok(!ensureInspirationDocHeader(md, "测试书").includes("# 灵感\n\n# 灵感"), "已有 H1 时不重复补文档头");
	let blocks = parseInspirationDoc(md);
	assert.deepEqual(blocks.map((b) => b.name), ["第一条", "第二条"]);
	assert.ok(!md.includes("\n\n\n"), "块与块之间最多一层空行");
	md = removeInspirationBlock(md, blocks[0]);
	blocks = parseInspirationDoc(md);
	assert.deepEqual(blocks.map((b) => b.name), ["第二条"]);
	assert.match(md, /# 灵感（测试书）/);
	assert.ok(!md.includes("第一条"));

	const crlf = md.replace(/\n/g, "\r\n");
	const back = removeInspirationBlock(crlf, parseInspirationDoc(crlf)[0]);
	assert.ok(!back.includes("\r\n\r\n\r\n"), "CRLF 文档删除后不出现三层空行");
	assert.equal(parseInspirationDoc(crlf).length, 1);
	assert.ok(back.includes("\r\n"), "删除操作保住 CRLF 换行风格");
});

test("灵感改名：只换标题行，正文原样；重解析拿到新名字与日期", () => {
	const blocks = parseInspirationDoc(doc);
	const renamed = renameInspirationBlock(doc, blocks[0], "雪夜追凶", "2026-12-01");
	const after = parseInspirationDoc(renamed);
	assert.deepEqual(
		after.map((b) => ({ name: b.name, date: b.date })),
		[{ name: "雪夜追凶", date: "2026-12-01" }, { name: "未命名", date: "2026-11-16" }]
	);
	assert.equal(after[0].body, blocks[0].body, "块内正文一字不动");
});

test("灵感弹窗侧：一行摘要压平注释与标记、关键词过滤命中名字或正文", () => {
	assert.equal(inspirationPreview("<!-- 注释 -->\n- 雨夜\n  追凶"), "雨夜 追凶");
	assert.ok(inspirationPreview("字".repeat(200)).length === 71, "超长摘要截断加省略号");
	const b = parseInspirationDoc(doc)[0];
	assert.ok(inspirationMatches(b, "声音"));
	assert.ok(inspirationMatches(b, "雨夜"));
	assert.ok(!inspirationMatches(b, "无关词"));
	assert.ok(inspirationMatches(b, "   "));
});
