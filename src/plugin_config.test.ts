import test from "node:test";
import assert from "node:assert/strict";

import { CHAT_REF_DOC_CATALOG, filterEnabledLlmConfigs, getVisibleLlmFields, IDENTITY_BOOST_SKILL_PREFIX, isLlmConfigEnabled, LEGACY_WRITING_TASK_SKILL_NAMES, normalizeLlmProvider, PHASE_REF_DOC_CATALOGS, PHASE_REF_DOC_DEFAULTS, REF_DOC_KEY_RENAMES, REF_DOC_LABELS, renameLlmConfig, selectEnabledLlmName, setLlmConfigEnabled, TENSION_TOOLBOX_SKILL_NAME, toggleLlmConfigEnabled, WRITING_PHASE_LABELS, WRITING_TASK_SKILL_NAME } from "./plugin_config";
import { DEFAULT_SKILLS } from "./skills_default";

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
		"context_window",
		"chat_tools",
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
		"context_window",
		"chat_tools",
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
		"context_window",
		"chat_tools",
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

void test("renaming a config follows every name reference (chat_model / active_llm / phase mappings)", () => {
	const conf = { active_llm: "local", chat_model: "local", writing_phases: [{ name: "phase", llm_config_name: "local" }, { name: "p2", llm_config_name: "deepseek" }], llm_configs: [
		{ name: "local" },
		{ name: "deepseek" },
	] };
	renameLlmConfig(conf, conf.llm_configs[0], "local-72b");
	assert.equal(conf.llm_configs[0].name, "local-72b");
	assert.equal(conf.chat_model, "local-72b");
	assert.equal(conf.active_llm, "local-72b");
	assert.equal(conf.writing_phases[0].llm_config_name, "local-72b");
	assert.equal(conf.writing_phases[1].llm_config_name, "deepseek"); // 其它配置的引用不动
	renameLlmConfig(conf, conf.llm_configs[1], "deepseek"); // 同名＝无操作
	assert.equal(conf.chat_model, "local-72b");
});

void test("tension_rules built-in key retired in favour of the 张力工具箱 skill", () => {
	assert.equal(TENSION_TOOLBOX_SKILL_NAME, "张力工具箱");
	assert.equal(REF_DOC_KEY_RENAMES.tension_rules, `skill:${TENSION_TOOLBOX_SKILL_NAME}`); // 存量清单原位改写（loadSettings）
	assert.equal(REF_DOC_KEY_RENAMES.events_list, "timeline");
	assert.ok(!Object.keys(REF_DOC_LABELS).includes("tension_rules"));
	for (const catalog of PHASE_REF_DOC_CATALOGS) assert.ok(!Object.keys(catalog).includes("tension_rules"));
	assert.ok(!Object.keys(CHAT_REF_DOC_CATALOG).includes("tension_rules"));
	assert.ok(!PHASE_REF_DOC_DEFAULTS.reduce<string[]>((acc, list) => acc.concat(list), []).includes("tension_rules")); // 不用 flat＝ES2019，见 eslint.config.mjs 黑名单
	for (const phase of [0, 1, 2, 3]) assert.ok(PHASE_REF_DOC_DEFAULTS[phase].includes(`skill:${TENSION_TOOLBOX_SKILL_NAME}`), `phase ${phase} default list`);
});

void test("章节写作任务＋章节创作 merged into single 章节写作指导 skill (v0.4.3+)", () => {
	assert.equal(WRITING_TASK_SKILL_NAME, "章节写作指导");
	assert.deepEqual(LEGACY_WRITING_TASK_SKILL_NAMES, ["章节创作", "章节写作任务"]); // 旧名只用于清单 key 改写与文件清理
	for (const old of LEGACY_WRITING_TASK_SKILL_NAMES) {
		assert.equal(REF_DOC_KEY_RENAMES[`skill:${old}`], `skill:${WRITING_TASK_SKILL_NAME}`); // 存量清单条目原位改写（loadSettings）
		assert.ok(DEFAULT_SKILLS[old] === undefined, `DEFAULT_SKILLS 不应再含旧技能 ${old}`);
	}
	assert.doesNotMatch(DEFAULT_SKILLS[WRITING_TASK_SKILL_NAME] ?? "", /\{\{chapter_ref_ban\}\}|\{\{outline_ref_clause\}\}/, "v0.4.3+ 动态条款（卷结构定位/章节号禁令）移出技能文件、由代码生成");
});

void test("each phase default list carries its identity-boost skill", () => {
	// v0.4.3+：五个「身份加强·<阶段名>」技能内置进各阶段默认清单（名字＝IDENTITY_BOOST_SKILL_PREFIX＋WRITING_PHASE_LABELS，与 DEFAULT_SKILLS 字面键同源）
	WRITING_PHASE_LABELS.forEach((label, i) => {
		assert.ok(PHASE_REF_DOC_DEFAULTS[i].includes(`skill:${IDENTITY_BOOST_SKILL_PREFIX}${label}`), `phase ${i} identity skill`);
		assert.ok(DEFAULT_SKILLS[`${IDENTITY_BOOST_SKILL_PREFIX}${label}`] !== undefined, `DEFAULT_SKILLS key for ${label}`);
	});
});
