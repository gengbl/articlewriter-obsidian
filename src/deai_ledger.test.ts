import test from "node:test";
import assert from "node:assert/strict";

import { DEAI_LEDGER_DOC_NAME, ledgerCounts, MAX_SENTENCES_PER_ENTRY, parseDeaiLedgerDoc, renderDeaiLedger, type DeaiLedger } from "./deai_ledger";

const base: DeaiLedger = { generatedAt: "2026-11-16 23:10", scopeLabel: "全书", writtenChapters: 3, entries: [] };

test("AI 味清单：空登记也出文档头，且明确说明本轮无命中", () => {
	const md = renderDeaiLedger(base);
	assert.match(md, /^# AI 味清单（连续编写）/);
	assert.match(md, /不调 LLM/);
	assert.match(md, /本轮没有检测到 AI 常用词/);
	assert.equal(DEAI_LEDGER_DOC_NAME, "AI味清单.md");
});

test("AI 味清单：状态回填改标题行图标，汇总按已清洗/待处理/未清洗分档计数", () => {
	const l: DeaiLedger = {
		...base,
		entries: [
			{ chKey: "v1|3", label: "第3章 冲突", hits: 7, words: ["值得一提的是", "他顿了顿"], sentences: ["值得一提的是，他眼神变了。"], status: "pending" },
			{ chKey: "v1|4", label: "第4章 追兵", hits: 5, words: ["顿时"], sentences: ["他顿时明白了。"], status: "cleaned", note: "改写后仍剩 1 处" },
			{ chKey: "v1|5", label: "第5章 突围", hits: 2, words: ["缓缓"], sentences: [], status: "stopped", note: "面板已关闭" },
		],
	};
	const md = renderDeaiLedger(l);
	assert.ok(md.includes("⏳ 待统一改写 · 第3章 冲突（命中 7 处）"), "pending 章出待处理标题");
	assert.ok(md.includes("✓ 已统一改写 · 第4章 追兵（命中 5 处）"), "cleaned 章出完成标题");
	assert.ok(md.includes("✋ 未清洗 · 第5章 突围（命中 2 处）"), "stopped 章出未清洗标题");
	assert.ok(md.includes("结果：改写后仍剩 1 处"), "清洗注记写入");
	assert.ok(md.includes("词：值得一提的是、他顿了顿"), "命中词按出现序列出");
	assert.equal(ledgerCounts(l), "登记 3 章 · 命中 14 处 · 已统一改写 1 章 · 待处理 1 章 · 未清洗 1 章");
});

test("AI 味清单：命中句超出上限折叠为「另有 N 条」，句内换行压成空格", () => {
	const many = Array.from({ length: MAX_SENTENCES_PER_ENTRY + 3 }, (_, i) => `第${String(i)}句\n带换行。`);
	const md = renderDeaiLedger({ ...base, entries: [{ chKey: "1", label: "第1章", hits: many.length, words: ["顿时"], sentences: many, status: "pending" }] });
	assert.ok(md.includes(`- …另有 ${String(many.length - MAX_SENTENCES_PER_ENTRY)} 条`), "折叠计数");
	assert.ok(md.includes("- 第0句 带换行。"), "句内换行压平，避免破坏列表结构");
	const rendered = md.split("\n").filter((line) => line.startsWith("- 第")).length;
	assert.equal(rendered, MAX_SENTENCES_PER_ENTRY, "只渲染上限内的句子");
});

test("AI 味清单：渲染→解析回读保住章节键/状态/命中数（「补做去AI味」据此续做未清洗章）", () => {
	const l: DeaiLedger = {
		...base,
		entries: [
			{ chKey: "v1|3", label: "第3章 冲突", hits: 7, words: ["值得一提的是", "他顿了顿"], sentences: ["值得一提的是，他眼神变了。"], status: "pending" },
			{ chKey: "v1|4", label: "第4章 追兵", hits: 5, words: ["顿时"], sentences: ["他顿时明白了。"], status: "cleaned", note: "已写回 1200 字，命中已清零" },
			{ chKey: "12", label: "第12章 突围", hits: 2, words: ["缓缓"], sentences: [], status: "stopped", note: "已停止，未写回" },
		],
	};
	const back = parseDeaiLedgerDoc(renderDeaiLedger(l));
	assert.ok(back);
	assert.deepEqual(
		back.entries.map((e) => ({ chKey: e.chKey, label: e.label, hits: e.hits, status: e.status, words: e.words })),
		[
			{ chKey: "v1|3", label: "第3章 冲突", hits: 7, status: "pending", words: ["值得一提的是", "他顿了顿"] },
			{ chKey: "v1|4", label: "第4章 追兵", hits: 5, status: "cleaned", words: ["顿时"] },
			{ chKey: "12", label: "第12章 突围", hits: 2, status: "stopped", words: ["缓缓"] },
		]
	);
	assert.equal(back.scopeLabel, "全书");
	assert.equal(back.writtenChapters, 3);
	assert.equal(back.entries[2]?.note, "已停止，未写回");
});

test("AI 味清单：句列表/折叠行/注记都能回读，非本插件文档返回 null", () => {
	const many = Array.from({ length: MAX_SENTENCES_PER_ENTRY + 3 }, (_, i) => `第${String(i)}句。`);
	const md = renderDeaiLedger({ ...base, entries: [{ chKey: "9", label: "第9章", hits: many.length, words: ["顿时"], sentences: many, status: "pending" }] });
	const back = parseDeaiLedgerDoc(md);
	assert.ok(back);
	assert.equal(back.entries[0]?.sentences.length, MAX_SENTENCES_PER_ENTRY, "只回读上限内的句子（折叠行不算句子）");
	assert.equal(parseDeaiLedgerDoc("# 别的文档\n\n随便写点。"), null, "不是清单文档→null");
});
