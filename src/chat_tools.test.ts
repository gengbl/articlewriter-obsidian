import test from "node:test";
import assert from "node:assert/strict";

import { CHAT_TOOLS, CHAT_TOOLS_PAYLOAD, CHAPTER_NUM_ARG_KEYS, DOC_NAME_ARG_KEYS, MAX_TOOL_ROUNDS, normalizeDocName, nearestToolNames, parseToolArgs, pickNumberArg, pickStringArg, resolveToolName, TOOL_NAME_ALIASES, TOOL_RESULT_MAX_CHARS, unknownToolHint } from "./chat_tools";

test("parseToolArgs：合法 JSON/空串/非法 JSON/数组与非对象均安全", () => {
	assert.deepEqual(parseToolArgs('{"chapter_num": 3}'), { chapter_num: 3 });
	assert.deepEqual(parseToolArgs(""), {});
	assert.deepEqual(parseToolArgs("{坏 JSON"), {});
	assert.deepEqual(parseToolArgs("[1,2]"), {});
	assert.deepEqual(parseToolArgs('"字符串"'), {});
	assert.deepEqual(parseToolArgs("null"), {});
});

test("工具清单：名字唯一、均带 object 参数模式与描述（function calling 契约形状）", () => {
	const names = CHAT_TOOLS.map((t) => t.name);
	assert.equal(new Set(names).size, names.length);
	for (const t of CHAT_TOOLS) {
		assert.ok(t.description.length > 10, t.name);
		assert.equal(t.parameters.type, "object");
	}
	assert.deepEqual(
		names,
		["read_chapter", "read_doc", "list_chapters", "search_vault", "review_chapter", "continue_writing", "rewrite_chapter", "write_chapter", "polish_chapter", "deai_chapter", "read_chapter_outline", "read_volume_outline", "set_current_chapter", "save_content_to_file", "generate_worldview", "generate_planning_guide", "generate_timeline", "generate_book_outline", "generate_vol_outline", "outline_to_chapters", "write_chapters_consecutive"]
	);
});

test("轮次与结果上限常量在合理区间", () => {
	assert.equal(MAX_TOOL_ROUNDS, 5);
	assert.ok(TOOL_RESULT_MAX_CHARS >= 4000 && TOOL_RESULT_MAX_CHARS <= 20000);
});

test("CHAT_TOOLS_PAYLOAD：OpenAI function calling 包裹形状与登记表一致", () => {
	assert.equal(CHAT_TOOLS_PAYLOAD.length, CHAT_TOOLS.length);
	CHAT_TOOLS_PAYLOAD.forEach((p, i) => {
		assert.equal(p.type, "function");
		assert.equal(p.function.name, CHAT_TOOLS[i].name);
		assert.equal(typeof p.function.parameters, "object");
	});
});

test("TOOL_NAME_ALIASES（v0.4.7+ 工具名容错）：别名一律指向登记表里真实存在的工具", () => {
	const real = new Set(CHAT_TOOLS.map((d) => d.name));
	for (const [from, to] of Object.entries(TOOL_NAME_ALIASES)) {
		assert.ok(real.has(to), `别名「${from}」指向不存在的工具「${to}」`);
		assert.ok(!real.has(from), `别名「${from}」本身就是真工具名（应删该条）`);
	}
});

test("resolveToolName：真名原样、别名改派、未知原样返回", () => {
	assert.deepEqual(resolveToolName("read_doc"), { name: "read_doc", mapped: false });
	assert.deepEqual(resolveToolName("read_file"), { name: "read_doc", mapped: true });
	assert.deepEqual(resolveToolName("GREP"), { name: "search_vault", mapped: true });
	assert.deepEqual(resolveToolName("teleport"), { name: "teleport", mapped: false });
});

test("nearestToolNames/unknownToolHint：read_file 的候选指向 read_doc/read_chapter，提示里带全量名单", () => {
	const c = nearestToolNames("read_file");
	assert.ok(c.length >= 2);
	assert.equal(c[0], "read_doc");
	assert.ok(c.includes("read_chapter"));
	const hint = unknownToolHint("read_file");
	assert.ok(hint.includes("没有名为「read_file」的工具"));
	assert.ok(hint.includes("read_doc"));
	assert.ok(hint.includes("可用工具："));
	assert.ok(unknownToolHint("teleportzzz").includes("可用工具："));
});

test("normalizeDocName：去《》/.md/目录前缀＋同义表", () => {
	assert.equal(normalizeDocName("《时间线.md》"), "时间线");
	assert.equal(normalizeDocName("我的工作/写书计划/书/案头资料/世界观.md"), "世界观");
	assert.equal(normalizeDocName("书籍大纲"), "大纲");
	assert.equal(normalizeDocName("年表"), "时间线");
	assert.equal(normalizeDocName(" 故事状态 "), "故事状态");
	assert.equal(normalizeDocName("瞎写的"), "瞎写的");
	assert.equal(normalizeDocName(""), "");
});

test("pickStringArg/pickNumberArg：参数键与写法都宽松", () => {
	assert.equal(pickStringArg({ path: "时间线" }, DOC_NAME_ARG_KEYS), "时间线");
	assert.equal(pickStringArg({ name: " 世界观 ", doc_name: "" }, DOC_NAME_ARG_KEYS), "世界观");
	assert.equal(pickStringArg({}, DOC_NAME_ARG_KEYS), "");
	assert.equal(pickNumberArg({ chapter_num: 3 }, CHAPTER_NUM_ARG_KEYS), 3);
	assert.equal(pickNumberArg({ chapter: "第18章" }, CHAPTER_NUM_ARG_KEYS), 18);
	assert.equal(pickNumberArg({ n: "12" }, CHAPTER_NUM_ARG_KEYS), 12);
	assert.ok(Number.isNaN(pickNumberArg({ foo: "abc" }, CHAPTER_NUM_ARG_KEYS)));
});
