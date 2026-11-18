import test from "node:test";
import assert from "node:assert/strict";

import {
	buildCompressUserPrompt,
	chatContextWindow,
	compressible,
	estimateTokens,
	formatSession,
	parseSession,
	sessionChars,
	sessionFileName,
	sessionTimeStamp,
	shouldAutoCompress,
	splitCompressWindow,
	type SessionTurn,
} from "./chat_session";

const T = (role: SessionTurn["role"], content: string): SessionTurn => ({ role, content });

test("formatSession → parseSession 往返：三种角色与多行正文逐字保留", () => {
	const meta = { story: '试验"书', created_at: "2026-11-18 100000", updated_at: "2026-11-18 103000", model: "deepseek" };
	const turns = [
		T("user", "第一行\n第二行 含 #井号 与 --- 分隔线"),
		T("assistant", "回复正文\n```md\n围栏中的 ## 我 不应被当章节标记\n```"),
		T("summary", "摘要：用户要 X；决定 Y。"),
	];
	const raw = formatSession(meta, turns);
	const got = parseSession(raw);
	assert.deepEqual(got.turns.map((t) => t.role), ["user", "assistant", "summary"]);
	assert.equal(got.turns[0].content, turns[0].content);
	assert.equal(got.turns[1].content, turns[1].content);
	assert.equal(got.turns[2].content, turns[2].content);
	assert.equal(got.meta.story, '试验"书');
	assert.equal(got.meta.model, "deepseek");
	assert.equal(got.meta.created_at, "2026-11-18 100000");
});

test("parseSession 容错：无 frontmatter、未识别段落、空章节", () => {
	const raw = ["# 某会话导出", "", "## 我", "", "你好", "", "## 助手", "", "   ", "", "## 其他", "忽略", ""].join("\n");
	const got = parseSession(raw);
	assert.deepEqual(got.turns, [T("user", "你好")]);
	assert.deepEqual(got.meta, {});
});

test("splitCompressWindow 保留最近 keepRounds 轮、旧摘要并入待压段", () => {
	const turns = [
		T("summary", "旧摘要"),
		T("user", "u1"), T("assistant", "a1"),
		T("user", "u2"), T("assistant", "a2"),
		T("user", "u3"), T("assistant", "a3"),
	];
	const { toCompress, keep } = splitCompressWindow(turns, 2);
	assert.deepEqual(toCompress.map((t) => t.content), ["旧摘要", "u1", "a1"]);
	assert.deepEqual(keep.map((t) => t.content), ["u2", "a2", "u3", "a3"]);
	// 轮数不足：全部保留、无可压段
	const small = splitCompressWindow([T("user", "u1"), T("assistant", "a1")], 2);
	assert.deepEqual(small.toCompress, []);
	assert.equal(small.keep.length, 2);
});

test("compressible：达标判定（保留窗之外的 user/assistant 轮数 ≥ min）", () => {
	const chat = (n: number): SessionTurn[] => Array.from({ length: n }, (_, i) => T(i % 2 ? "assistant" : "user", `t${i}`));
	assert.equal(compressible([...chat(3)]), false); // 3 轮条目 − 保留 4 → 0 < 4
	assert.equal(compressible([...chat(8)]), true); // 8 − 4 = 4 ≥ 4
	assert.equal(compressible([T("summary", "s"), ...chat(8)]), true); // 摘要轮不计数
});

test("buildCompressUserPrompt：旧摘要合并指令与转录顺序", () => {
	const p = buildCompressUserPrompt([T("summary", "旧摘要文本"), T("user", "u1"), T("assistant", "a1")]);
	assert.ok(p.includes("【已有摘要（请合并进新摘要）】\n旧摘要文本"));
	assert.ok(p.includes("【待压缩对话】\n我：u1\n\n助手：a1"));
	assert.ok(p.endsWith("请输出合并后的新摘要。"));
});

test("sessionChars 与命名/时间戳格式", () => {
	assert.equal(sessionChars([T("user", "abc"), T("summary", "de")]), 5);
	const d = new Date(2026, 10, 18, 9, 5, 3);
	assert.equal(sessionFileName(d), "对话 2026-11-18 0905");
	assert.equal(sessionTimeStamp(d), "2026-11-18 090503");
});

test("estimateTokens：CJK 按字计、其余按 4 字符/token 向上取整", () => {
	assert.equal(estimateTokens("你好世界"), 4);
	assert.equal(estimateTokens("abcd"), 1);
	assert.equal(estimateTokens("你好 abcd"), 4); // 2 字 + ceil(5/4)=2
});

test("chatContextWindow：显式配置 > 模型名 NNK 后缀 > null；不误匹配参数规模 72b", () => {
	assert.equal(chatContextWindow({ context_window: 128000, model_name: "x-128k" }), 128000);
	assert.equal(chatContextWindow({ context_window: 0, model_name: "llama-3.1-8b-instruct-128k" }), 128000);
	assert.equal(chatContextWindow({ model_name: "GLM-4 (128k)" }), 128000);
	assert.equal(chatContextWindow({ model_name: "qwen2.5-72b-instruct" }), null); // 参数规模不算窗口
	assert.equal(chatContextWindow({}), null);
});

test("shouldAutoCompress：窗口×比例阈值与关闭语义", () => {
	assert.equal(shouldAutoCompress(90000, 2048, 128000, 75), false); // 92048 ≤ 96000
	assert.equal(shouldAutoCompress(95000, 2048, 128000, 75), true); // 97048 > 96000
	assert.equal(shouldAutoCompress(999999, 0, 128000, 0), false); // ratio=0 关闭
	assert.equal(shouldAutoCompress(999999, 0, 0, 75), false); // 窗口未知
	assert.equal(shouldAutoCompress(999999, 0, 128000, 150), true); // ratio 按 100 夹取
});
