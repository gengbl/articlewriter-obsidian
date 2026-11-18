import test from "node:test";
import assert from "node:assert/strict";

import { CHAT_TOOLS, CHAT_TOOLS_PAYLOAD, MAX_TOOL_ROUNDS, parseToolArgs, TOOL_RESULT_MAX_CHARS } from "./chat_tools";

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
