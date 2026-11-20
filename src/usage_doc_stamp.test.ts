import test from "node:test";
import assert from "node:assert/strict";

import { stampUsageDoc, usageDocNeedsRegen, usageDocVersion } from "./usage_doc_stamp";

test("stampUsageDoc：注释戳＋可见提示行前置，版本可读回", () => {
	const out = stampUsageDoc("# ArticleWriter 使用说明\n\n正文 A\n", "0.4.7");
	assert.ok(out.startsWith("<!-- articlewriter:usage-doc-version 0.4.7 -->"), out.slice(0, 60));
	assert.equal(usageDocVersion(out), "0.4.7");
	assert.ok(out.includes("本文档由 ArticleWriter 自动生成（插件版本 0.4.7）"));
	assert.ok(out.includes("正文 A"));
});

test("重复 stamp 幂等：只保留一行戳与一行提示，正文不被吞", () => {
	const twice = stampUsageDoc(stampUsageDoc("# 说明\n正文 B\n", "0.4.7"), "0.4.8");
	assert.equal(usageDocVersion(twice), "0.4.8");
	assert.equal(twice.match(/articlewriter:usage-doc-version/g)?.length, 1);
	assert.equal(twice.match(/本文档由 ArticleWriter 自动生成/g)?.length, 1);
	assert.ok(twice.includes("正文 B"));
});

test("usageDocVersion：无戳（旧版插件写的/用户自建同名文档）返回 null", () => {
	assert.equal(usageDocVersion("# 手写说明\n没有戳\n"), null);
});

test("usageDocNeedsRegen：缺失/空/无戳/版本不符＝重建，版本一致＝不动", () => {
	assert.equal(usageDocNeedsRegen(null, "0.4.7"), true);
	assert.equal(usageDocNeedsRegen("   \n", "0.4.7"), true);
	assert.equal(usageDocNeedsRegen("# 手写说明\n", "0.4.7"), true);
	assert.equal(usageDocNeedsRegen(stampUsageDoc("正文", "0.4.7"), "0.4.7"), false);
	assert.equal(usageDocNeedsRegen(stampUsageDoc("正文", "0.4.6"), "0.4.7"), true);
});
