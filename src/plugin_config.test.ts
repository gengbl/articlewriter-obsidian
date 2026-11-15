import test from "node:test";
import assert from "node:assert/strict";

import { filterEnabledLlmConfigs, getVisibleLlmFields, isLlmConfigEnabled, normalizeLlmProvider, selectEnabledLlmName, setLlmConfigEnabled, toggleLlmConfigEnabled } from "./plugin_config";

void test("normalizeLlmProvider maps legacy values to canonical model types", () => {
	assert.equal(normalizeLlmProvider("openai"), "openai-compatible");
	assert.equal(normalizeLlmProvider("deepseek"), "deepseek");
	assert.equal(normalizeLlmProvider("qwen"), "qwen");
	assert.equal(normalizeLlmProvider("qwen-dashscope"), "qwen");
	assert.equal(normalizeLlmProvider("openai-compatible"), "openai-compatible");
	assert.equal(normalizeLlmProvider("unknown"), "openai-compatible");
});

void test("visible fields vary by model type and hide irrelevant settings", () => {
	assert.deepEqual(getVisibleLlmFields("openai-compatible"), [
		"base_url",
		"model_name",
		"api_key",
		"temperature",
		"max_tokens",
		"top_p",
		"repeat_penalty",
		"reasoning_effort",
	]);
	assert.deepEqual(getVisibleLlmFields("deepseek"), [
		"base_url",
		"model_name",
		"api_key",
		"temperature",
		"max_tokens",
		"top_p",
		"repeat_penalty",
		"reasoning_effort",
		"thinking",
	]);
	assert.deepEqual(getVisibleLlmFields("qwen"), [
		"base_url",
		"model_name",
		"api_key",
		"temperature",
		"max_tokens",
		"top_p",
		"repeat_penalty",
		"reasoning_effort",
	]);
});

void test("disabled llm configs are filtered out and default reasoning is off", () => {
	assert.equal(isLlmConfigEnabled({ enabled: false }), false);
	assert.equal(isLlmConfigEnabled({ enabled: true }), true);
	assert.equal(isLlmConfigEnabled({}), true);
	assert.equal(toggleLlmConfigEnabled({ enabled: true }), false);
	assert.equal(toggleLlmConfigEnabled({ enabled: false }), true);
	assert.equal(toggleLlmConfigEnabled({}), false);
	assert.deepEqual(filterEnabledLlmConfigs([
		{ name: "enabled", enabled: true },
		{ name: "disabled", enabled: false },
		{ name: "implicit" },
	]), [
		{ name: "enabled", enabled: true },
		{ name: "implicit" },
	]);
	assert.equal(selectEnabledLlmName([
		{ name: "enabled", enabled: true },
		{ name: "disabled", enabled: false },
	], "disabled"), "enabled");
	assert.equal(selectEnabledLlmName([
		{ name: "enabled", enabled: true },
		{ name: "disabled", enabled: false },
	], "missing"), "enabled");
	const conf = { active_llm: "disabled", chat_model: "disabled", writing_phases: [{ name: "phase", llm_config_name: "disabled" }], llm_configs: [
		{ name: "enabled", enabled: true },
		{ name: "disabled", enabled: true },
	] };
	setLlmConfigEnabled(conf, conf.llm_configs[1], false);
	assert.equal(conf.chat_model, undefined);
	assert.equal(conf.active_llm, "enabled");
	assert.equal(conf.writing_phases[0].llm_config_name, undefined);
});
