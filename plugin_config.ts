// ===== 插件 LLM 配置（对齐 Python 版 ~/.articlewriter/config.json 的 llm 段字段）=====
// 载体为 Obsidian 标准插件数据目录：<vault>/.obsidian/plugins/articlewriter/data.json
// （经 Plugin.saveData/loadData 持久化，与 work_dir/lastStory 等设置同处存放）。
// 注意：本插件依赖桌面端运行环境与 LLM 接口，且 api_key 以明文存于 data.json。
// 为了避免移动端环境/本地服务兼容性问题，插件声明为 desktop-only；请勿将 .obsidian 同步/共享到不可信位置。

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

/** 写作阶段：四阶段独立模型配置 */
export interface WritingPhase {
	name: string; // 阶段显示名（如「策划方案生成」）
	llm_config_name?: string; // 指定使用的模型配置名（留空=回落 active_llm）
}

export interface PluginConfig {
	version: 1;
	active_llm?: string; // 兼容字段：旧版激活态，设置页不再暴露；对话框模型改用 chat_model
	chat_model?: string; // 对话框使用的模型配置名（llm_configs[].name），留空=回落 active_llm
	llm_configs?: LlmConfigDoc[];
	system_prompt?: string; // 写作系统提示词（空=用内置默认）
	desc_style?: string; // "normal" | "complete"
	system_guide?: string; // 系统级写作指南（三层创作规范中最低优先级层，预置 CLI 内置内容）
	system_guide_path?: string; // 系统级指南文件路径（vault 相对路径）；设
	writing_phases?: WritingPhase[]; // 写作阶段模型配置（四阶段独立模型）置且可读时优先于内嵌 system_guide
}

/** 首次运行（data.json 无 llm 段）时预置的标准模板：字段结构与 Python 用户配置文件一致，api_key/model_name 留空待填。
 * 说明：本插件仅支持桌面端使用，原因是它依赖本地或远程 LLM API 端点、文件系统访问与 Obsidian 桌面环境；
 * 任何密钥都应仅保存在本地桌面 vault 的 .obsidian 目录中，不建议同步到共享/不受信任位置。
 */
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
			// local 默认关思考（reasoning_effort:"none"）：本地 llama-server + Qwen 等模板默认开思考，
			// 思考与正文共享 max_tokens 预算，"high" 会耗尽预算致 content 恒空（大纲/长文生成失败根因）。
			// 需要思考的本地模型自行在设置页改回 high/max。
			{ name: "local", provider: "openai", base_url: "http://localhost:8509", model_name: "", ...base, reasoning_effort: "none", openai_extras: ["repeat_penalty"], api_style: "" },
			{ name: "deepseek", provider: "deepseek", api_key: "", base_url: "https://api.deepseek.com", model_name: "", ...base, openai_extras: [], api_style: "responses" },
			{ name: "qwen-dashscope", provider: "openai", api_key: "", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model_name: "", ...base, openai_extras: [], api_style: "" },
		],
		system_prompt: "",
		desc_style: "normal",
		writing_phases: [
			{ name: "策划方案生成", llm_config_name: "" },
			{ name: "书籍大纲和卷级大纲生成", llm_config_name: "" },
			{ name: "文章大纲生成", llm_config_name: "" },
			{ name: "编写文章", llm_config_name: "" },
		],
	};
}
