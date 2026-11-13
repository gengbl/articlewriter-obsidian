import test from "node:test";
import assert from "node:assert/strict";

import { parseBookSkill } from "./book_skill";

void test("parseBookSkill returns null for non-skill docs (no frontmatter / no marker / bad yaml)", () => {
	assert.equal(parseBookSkill("# 普通案头资料\n正文"), null);
	assert.equal(parseBookSkill("---\ntitle: 世界观\n---\n正文"), null); // 有 frontmatter 但无 auto_book 标记
	assert.equal(parseBookSkill("---\nauto_book: true\n[oops\n---\n正文"), null); // yaml 非法
	assert.equal(parseBookSkill("---\nauto_book: \"true\"\n---\n正文"), null); // 标记非布尔 true
});

void test("parseBookSkill reads all fields and body; invalid fields are ignored individually", () => {
	const spec = parseBookSkill(`---
auto_book: true
start: book-outline
end: volumes
mode: volumes
chapters: 30
volumes: 3
chapter_counts: 8, 10, 12
overwrite: true
premise: "少年能看见死期"
---
正文一句话设定
第二行
`);
	assert.ok(spec);
	assert.equal(spec.startAt, "book-outline");
	assert.equal(spec.endAt, "volumes");
	assert.equal(spec.mode, "volumes");
	assert.equal(spec.flatTotalChapters, 30);
	assert.equal(spec.volumeCount, 3);
	assert.deepEqual(spec.chapterCounts, [8, 10, 12]);
	assert.equal(spec.overwrite, true);
	assert.equal(spec.premise, "少年能看见死期");
	assert.equal(spec.body, "正文一句话设定\n第二行");
	// 非法字段各自忽略、不整体报废
	const loose = parseBookSkill("---\nauto_book: true\nstart: nope\nend: nope\nmode: weird\nchapters: -5\nvolumes: abc\nchapter_counts: 10, x\noverwrite: yes\n---\n正文");
	assert.ok(loose);
	assert.equal(loose.startAt, undefined);
	assert.equal(loose.endAt, undefined);
	assert.equal(loose.mode, undefined);
	assert.equal(loose.flatTotalChapters, undefined);
	assert.equal(loose.volumeCount, undefined);
	assert.equal(loose.chapterCounts, undefined); // 含非法项整条丢弃
	assert.equal(loose.overwrite, undefined);
	assert.equal(loose.body, "正文");
});

void test("parseBookSkill accepts chapter_counts as yaml array or comma string", () => {
	const arr = parseBookSkill("---\nauto_book: true\nchapter_counts: [8, 10, 12]\n---\n");
	assert.deepEqual(arr?.chapterCounts, [8, 10, 12]);
	const str = parseBookSkill("---\nauto_book: true\nchapter_counts: 8，10 12\n---\n"); // 顿号/逗号/空白混用
	assert.deepEqual(str?.chapterCounts, [8, 10, 12]);
});

void test("parseBookSkill parses legacy skill docs for one-time migration (v0.4.1+)", () => {
	// premise 含冒号（旧 formatBookSkill 用 JSON 双引号标量写盘）——迁移解析须还原
	const spec = parseBookSkill('---\nauto_book: true\nmode: flat\nchapters: 10\npremise: "a: b"\n---\n');
	assert.ok(spec);
	assert.equal(spec.mode, "flat");
	assert.equal(spec.flatTotalChapters, 10);
	assert.equal(spec.premise, "a: b");
	assert.equal(spec.body, "");
});
