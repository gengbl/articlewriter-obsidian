import test from "node:test";
import assert from "node:assert/strict";
import { cacheStatsText, readCacheStats, retryTurnMessages } from "./llm_client";

// ---------- v0.4.3+ 前缀缓存复用读数（面板状态行/console 日志共用）----------
// 口径陷阱：serve 的 timings.prompt_n 是**本次真正 read 的 token 数**（不含命中缓存的部分），
// 总 prompt 长度只有 usage.prompt_tokens 或 cache_n＋prompt_n 才给得出——直接拿 prompt_n 当分母会把复用率算错。

test("本地 Strata serve：timings.cache_n/prompt_n（无 usage 时总数＝cache_n＋prompt_n）", () => {
	const s = readCacheStats({ timings: { cache_n: 6298, prompt_n: 10, prompt_ms: 170.2 } });
	assert.ok(s);
	assert.deepEqual(s, { reused: 6298, prompt: 6308 });
	assert.equal(cacheStatsText(s), "前缀缓存复用 6298/6308 tokens（100%）");
});

test("serve 同时给 timings 与 usage：reused 取 cache_n、总数取 usage.prompt_tokens", () => {
	const s = readCacheStats({
		timings: { cache_n: 0, prompt_n: 11431 },
		usage: { prompt_tokens: 11431, completion_tokens: 671, prompt_tokens_details: { cached_tokens: 0 } },
	});
	assert.ok(s); // 首个请求（KV 冷）也是有效读数，不能被当成「无数据」丢掉
	assert.deepEqual(s, { reused: 0, prompt: 11431 });
	assert.equal(cacheStatsText(s), "前缀缓存复用 0/11431 tokens（0%）");
});

test("云端 OpenAI 口径：只有 usage.prompt_tokens_details.cached_tokens", () => {
	const s = readCacheStats({ usage: { prompt_tokens: 9000, prompt_tokens_details: { cached_tokens: 8192 } } });
	assert.ok(s);
	assert.deepEqual(s, { reused: 8192, prompt: 9000 });
});

test("端点未给任何缓存字段 → undefined（调用方静默跳过，面板不显示缓存后缀）", () => {
	assert.equal(readCacheStats({ choices: [] }), undefined);
	assert.equal(readCacheStats({ usage: { prompt_tokens: 120 } }), undefined); // 有 usage 但无 cached_tokens 明细
	assert.equal(readCacheStats({ timings: { prompt_n: 10 } }), undefined); // 无 cache_n
	assert.equal(readCacheStats(null), undefined);
	assert.equal(readCacheStats("strata"), undefined);
	assert.equal(readCacheStats({ timings: { cache_n: "6298", prompt_n: 10 } }), undefined); // 非数值不采信
});

test("异常响应：总数不小于 reused、零分母不出 NaN", () => {
	const odd = readCacheStats({ timings: { cache_n: 500, prompt_n: 0 }, usage: { prompt_tokens: 120 } });
	assert.ok(odd);
	assert.deepEqual(odd, { reused: 500, prompt: 500 });
	const zero = readCacheStats({ timings: { cache_n: 0, prompt_n: 0 } });
	assert.ok(zero);
	assert.equal(cacheStatsText(zero), "前缀缓存复用 0/0 tokens（0%）");
});

// ---------- v0.4.3+ 纠错重试的会话续轮形状（前缀缓存复用依赖它，形状变了 reused 直接归零）----------
// 关键不变量：前两条消息必须与首次请求逐字相同（引擎按会话前缀匹配），上次输出作 assistant 轮、纠错注记单独成轮。

test("retryTurnMessages：前缀逐字保持 + 上次输出成 assistant 轮 + 注记独立成轮", () => {
	const sys = { role: "system", content: "系统提示词" } as const;
	const msgs = retryTurnMessages(sys, "原提示词\n\n正文……", "  上次的非法输出\n", "\n\n【格式修正要求】请按格式重写。\n");
	assert.equal(msgs.length, 4);
	assert.deepEqual(msgs[0], sys);
	assert.deepEqual(msgs[1], { role: "user", content: "原提示词\n\n正文……" });
	assert.equal(msgs[2]?.role, "assistant");
	assert.equal(msgs[2]?.content, "上次的非法输出");
	assert.equal(msgs[3]?.role, "user");
	assert.equal(msgs[3]?.content, "【格式修正要求】请按格式重写。"); // 注记首尾换行剥掉，不再拼回原提示词尾部
});

test("retryTurnMessages：上次输出为空时退化为只追加注记轮（前缀仍逐字保持）", () => {
	const sys = { role: "system", content: "S" } as const;
	const msgs = retryTurnMessages(sys, "P", "   ", "纠错注记");
	assert.equal(msgs.length, 3);
	assert.deepEqual(msgs.map((m) => m.role), ["system", "user", "user"]);
	assert.equal(msgs[2]?.content, "纠错注记");
});
