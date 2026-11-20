import test from "node:test";
import assert from "node:assert/strict";

import { CHATTER_MAX_CHARS, isPureChatter } from "./chat_intent";

const cases: Array<[string, boolean]> = [
	// 问候／套话＝闲聊
	["hi", true],
	["Hi!", true],
	["你好", true],
	["你好你好", true],
	["您好！！", true],
	["在吗？", true],
	["你是谁", true],
	["你能做什么", true],
	["谢谢", true],
	["thanks", true],
	["再见", true],
	["   ", true],
	// 短句但没动作意图＝闲聊
	["随便聊聊", true],
	["今天天气不错", true],
	["哈哈", true],
	// 承认短句＝含糊许可，不拦（上一轮助手提过建议时用户回「好的」要放行）
	["好的", false],
	["嗯", false],
	["ok", false],
	["行吧", false],
	// 带动作意图＝不是闲聊（短也放行）
	["继续", false],
	["开始吧", false],
	["看看第18章", false],
	["第18章写得怎么样", false],
	["改一下大纲", false],
	["去AI味", false],
	// 长消息一律放行
	["我想先讨论一下主角在第十八章之后的心理变化，再决定要不要往下写", false],
];

test(`isPureChatter（v0.4.7+ 拦弱模型把问候当指令）：${String(cases.length)} 组样例`, () => {
	for (const [text, expected] of cases) {
		assert.equal(isPureChatter(text), expected, `「${text}」应为 ${String(expected)}`);
	}
});

test("CHATTER_MAX_CHARS：超过该长度的短句一律不算闲聊（宁松勿严）", () => {
	const long = "这句话特别长里面没有任何动作意图只是随便说说而已而已";
	assert.ok(long.length > CHATTER_MAX_CHARS);
	assert.equal(isPureChatter(long), false);
});
