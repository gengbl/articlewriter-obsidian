// ===== 插件 LLM 配置（对齐 Python 版 ~/.articlewriter/config.json 的 llm 段字段）=====
// 载体为 Obsidian 标准插件数据目录：<vault>/.obsidian/plugins/articlewriter/data.json
// （经 Plugin.saveData/loadData 持久化，与 work_dir/lastStory 等设置同处存放）。
// 注意：api_key 以明文存于 data.json，请勿将 .obsidian 同步/共享到不可信位置。

export interface LlmConfigDoc {
	name: string;
	provider?: string;
	api_key?: string;
	base_url?: string;
	model_name?: string;
	temperature?: number;
	max_tokens?: number;
	top_p?: number;
	repeat_penalty?: number;
	thinking?: string;
	reasoning_effort?: string;
	openai_extras?: string[];
	api_style?: string;
	retry_times?: number;
	retry_delay?: number;
}

export interface PluginConfig {
	version: 1;
	active_llm?: string; // 当前激活的模型配置名（llm_configs[].name）
	llm_configs?: LlmConfigDoc[];
	system_prompt?: string; // 写作系统提示词（空=用内置默认）
	desc_style?: string; // "normal" | "complete"
	system_guide?: string; // 系统级写作指南（三层创作规范中最低优先级层，预置 CLI 内置内容）
	system_guide_path?: string; // 系统级指南文件路径（vault 相对路径）；设置且可读时优先于内嵌 system_guide
}

/** 首次运行（data.json 无 llm 段）时预置的标准模板：字段结构与 Python 用户配置文件一致，api_key/model_name 留空待填 */
export function buildDefaultLlmConf(): PluginConfig {
	const base = {
		temperature: 0.8,
		max_tokens: 65535,
		top_p: 0.9,
		repeat_penalty: 1.1,
		thinking: "",
		reasoning_effort: "high",
		retry_times: 3,
		retry_delay: 3,
	};
	return {
		version: 1,
		active_llm: "local",
		llm_configs: [
			{ name: "local", provider: "openai", base_url: "http://localhost:8509", model_name: "", ...base, openai_extras: ["repeat_penalty"], api_style: "" },
			{ name: "deepseek", provider: "deepseek", api_key: "", base_url: "https://api.deepseek.com", model_name: "", ...base, openai_extras: [], api_style: "responses" },
			{ name: "qwen-dashscope", provider: "openai", api_key: "", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model_name: "", ...base, openai_extras: [], api_style: "" },
		],
		system_prompt: "",
		desc_style: "normal",
	};
}
