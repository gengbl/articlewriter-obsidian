// ===== 插件 LLM 配置（对齐 Python 版 ~/.articlewriter/config.json 的 llm 段字段）=====
// 载体为 Obsidian 标准插件数据目录：<vault>/.obsidian/plugins/articlewriter/data.json
// （经 Plugin.saveData/loadData 持久化，与 work_dir/lastStory 等设置同处存放）。
// 注意：本插件依赖桌面端运行环境与 LLM 接口，且 api_key 以明文存于 data.json。
// 为了避免移动端环境/本地服务兼容性问题，插件声明为 desktop-only；请勿将 .obsidian 同步/共享到不可信位置。

export const LLM_PROVIDER_OPTIONS = ["openai-compatible", "deepseek", "qwen"] as const;
export type LlmProviderType = (typeof LLM_PROVIDER_OPTIONS)[number];

export function normalizeLlmProvider(value?: string): LlmProviderType {
	const raw = (value ?? "").trim().toLowerCase();
	if (!raw) return "openai-compatible";
	if (raw === "openai" || raw === "openai-compatible" || raw === "openai_compatible" || raw === "openai compatible") return "openai-compatible";
	if (raw === "deepseek" || raw === "deepseek-chat" || raw === "deepseek-chat-reasoning") return "deepseek";
	if (raw === "qwen" || raw === "qwen-dashscope" || raw === "qwen_dashscope" || raw === "dashscope") return "qwen";
	return "openai-compatible";
}

export function defaultBaseUrlForProvider(provider?: string): string | undefined {
	switch (normalizeLlmProvider(provider)) {
		case "deepseek":
			return "https://api.deepseek.com";
		case "qwen":
			return "https://dashscope.aliyuncs.com/compatible-mode/v1";
		default:
			return undefined;
	}
}

export function getVisibleLlmFields(provider?: string): Array<"base_url" | "model_name" | "api_key" | "temperature" | "max_tokens" | "top_p" | "repeat_penalty" | "reasoning_effort" | "thinking"> {
	const normalized = normalizeLlmProvider(provider);
	const common = ["base_url", "model_name", "api_key", "temperature", "max_tokens", "top_p", "repeat_penalty", "reasoning_effort"] as const;
	if (normalized === "deepseek") return [...common, "thinking"]; 
	return [...common];
}

export function isLlmConfigEnabled(config?: { enabled?: boolean } | null): boolean {
	return config?.enabled !== false;
}

export function toggleLlmConfigEnabled<T extends { enabled?: boolean }>(config: T): boolean {
	const nextEnabled = !isLlmConfigEnabled(config);
	config.enabled = nextEnabled;
	return nextEnabled;
}

export function filterEnabledLlmConfigs<T extends { enabled?: boolean }>(configs: T[] = []): T[] {
	return configs.filter((cfg) => isLlmConfigEnabled(cfg));
}

export function selectEnabledLlmName<T extends { name: string; enabled?: boolean }>(configs: T[] = [], preferred?: string): string | undefined {
	const enabled = filterEnabledLlmConfigs(configs);
	if (!enabled.length) return undefined;
	if (preferred && enabled.some((cfg) => cfg.name === preferred)) return preferred;
	return enabled[0].name;
}

export function setLlmConfigEnabled<T extends { name: string; enabled?: boolean }>(conf: Pick<PluginConfig, "chat_model" | "active_llm" | "writing_phases" | "llm_configs"> | undefined, cfg: T, enabled: boolean): void {
	cfg.enabled = enabled;
	if (!conf) return;
	if (!enabled) {
		if (conf.chat_model === cfg.name) conf.chat_model = undefined;
		if (conf.active_llm === cfg.name) conf.active_llm = selectEnabledLlmName(conf.llm_configs ?? [], undefined);
		for (const phase of conf.writing_phases ?? []) {
			if (phase.llm_config_name === cfg.name) phase.llm_config_name = undefined;
		}
		return;
	}
	if (!conf.chat_model && !conf.active_llm) {
		conf.chat_model = cfg.name;
	}
}

export interface LlmConfigDoc {
	name: string;
	enabled?: boolean;
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

/** 写作阶段：五阶段独立模型配置（v0.3.7+：世界观生成居首） */
export interface WritingPhase {
	name: string; // 阶段显示名（如「策划方案生成」）
	llm_config_name?: string; // 指定使用的模型配置名（留空=回落第一个配置 cfgs[0]；active_llm/chat_model 均不参与阶段回退）
	// v0.3.4+：原 identity_boost 字段已 Skill 化移除（当时四段默认文本移入 skills_default.DEFAULT_SKILLS 的「身份加强·<阶段名>」，改由 ref_docs 的 skill: 条目 opt-in；旧 data.json 残留字段由 main.migrateIdentityBoostSkills() 迁移后删除；v0.3.7+ 世界观生成阶段增补第五条，共五条）
	ref_docs?: string[]; // 引用文档配置框（v0.2.25+）：本阶段提示词装配实际注入的引用文档清单。条目 = 内置文档 key（见 PHASE_REF_DOC_CATALOGS）或 "file:<vault 路径>"（用户自选文档）或 "skill:<技能名>"（v0.3.0+，读 <work_dir>/SKILLS/<技能名>.md；「编写文章」阶段技能进 system prompt、其余阶段进上下文文档）。undefined = 该阶段默认清单；[] = 不注入引用文档。
}

/** 五阶段（0–4）规范显示名（v0.3.4+ 唯一词源）：设置页「写作阶段模型配置」tab、书籍 Skill 阶段配置弹窗 tab、导出文档阶段名共用。
 *  v0.3.7+：「世界观生成」头插为阶段 0，原四阶段顺延 1–4（loadSettings 对旧 4 条 writing_phases 做头插迁移，已保存的模型绑定/引用清单随对象整体后移）。
 *  WritingPhase.name 字段为 legacy（无 UI 写入、旧 data.json 残留「阶段1..4」），界面一律不读、以此常量为准。 */
export const WRITING_PHASE_LABELS: string[] = ["世界观生成", "策划方案生成", "书籍大纲和卷级大纲生成", "文章大纲生成", "编写文章"];

/** 写作阶段下标命名常量（＝WRITING_PHASE_LABELS / writing_phases 数组位次）：调用点用它替代裸数字，防阶段增删时漏改。 */
export const PHASE_WORLDVIEW = 0; // 世界观生成（/worldview-generate；auto-book 流水线首阶段）
export const PHASE_PLANNING = 1; // 策划方案生成（/planning-guide-worldview；时间线前置生成）
export const PHASE_OUTLINE = 2; // 书籍大纲和卷级大纲生成（/book-outline-generate /vol-outline-generate /book-outline-to-volumes）
export const PHASE_CHAPTER_OUTLINE = 3; // 文章大纲生成（/vol-outline-to-chapters；AI 拆分兜底）
export const PHASE_WRITING = 4; // 编写文章（/write /continue /rewrite /review /chat 等正文族）

/** 身份加强技能名前缀（v0.3.4+）：技能名＝前缀＋WRITING_PHASE_LABELS[i]（如「身份加强·编写文章」），与 skills_default.DEFAULT_SKILLS 五条内置技能、旧 identity_boost 迁移（main.migrateIdentityBoostSkills）共用同一词源。 */
export const IDENTITY_BOOST_SKILL_PREFIX = "身份加强·";

/** 内置引用文档 key → 界面显示名（全阶段共用词表）。 */
export const REF_DOC_LABELS: Record<string, string> = {
	book_info: "小说基本信息（来自 故事状态.md：书名/题材/风格）",
	tension_rules: "张力规则（张力规则.md）",
	worldview: "世界观（世界观.md）",
	timeline: "时间线（书/卷/章三层《时间线.md》合并时间轴）",
	book_outline: "全书大纲（大纲.md）",
	vol_list: "卷列表（卷列表.md）",
	planning_guide: "策划指南（策划指南.md）",
	outline_source: "当前大纲来源（本次待拆分的大纲文本）",
	book_relations: "书级人物关系（人物关系.md）",
	vol_relations: "本卷人物关系（本卷人物关系.md）",
	prev_vol_outline: "前一卷卷大纲（链式上下文）",
	vol_outline: "大纲（卷模式＝本卷《卷大纲.md》；平铺模式＝书级《大纲.md》；编写文章阶段＝当前章前 N 章/后 N 章节选）",
	chapter_outline: "本章大纲（大纲.md 本章小节）",
	characters: "人物档案（人物/）",
	scenes: "场景档案（场景/）",
	chapter_relations: "本章人物关系（本章小节）",
};

/** 各阶段（0–4）可注入的内置引用文档目录（设置页下拉候选、按阶段裁剪）。 */
export const PHASE_REF_DOC_CATALOGS: Record<string, string>[] = [
	// 阶段 0 世界观生成（/worldview-generate）：世界观.md 是产出目标、不注入自身
	{ book_info: REF_DOC_LABELS.book_info, tension_rules: REF_DOC_LABELS.tension_rules },
	// 阶段 1 策划方案生成（/planning-guide-worldview；自动生成策划指南/时间线前置链路）
	{ book_info: REF_DOC_LABELS.book_info, tension_rules: REF_DOC_LABELS.tension_rules, worldview: REF_DOC_LABELS.worldview, timeline: REF_DOC_LABELS.timeline, book_outline: REF_DOC_LABELS.book_outline, vol_list: REF_DOC_LABELS.vol_list },
	// 阶段 2 书籍大纲和卷级大纲生成（/book-outline-generate /vol-outline-generate /book-outline-to-volumes）
	{
		book_info: REF_DOC_LABELS.book_info, tension_rules: REF_DOC_LABELS.tension_rules, worldview: REF_DOC_LABELS.worldview, timeline: REF_DOC_LABELS.timeline,
		planning_guide: REF_DOC_LABELS.planning_guide, outline_source: REF_DOC_LABELS.outline_source, book_outline: REF_DOC_LABELS.book_outline,
		book_relations: REF_DOC_LABELS.book_relations, vol_relations: REF_DOC_LABELS.vol_relations, vol_list: REF_DOC_LABELS.vol_list,
		prev_vol_outline: REF_DOC_LABELS.prev_vol_outline,
	},
	// 阶段 3 文章大纲生成（/vol-outline-to-chapters）
	{
		book_info: REF_DOC_LABELS.book_info, tension_rules: REF_DOC_LABELS.tension_rules, worldview: REF_DOC_LABELS.worldview, timeline: REF_DOC_LABELS.timeline,
		planning_guide: REF_DOC_LABELS.planning_guide, outline_source: REF_DOC_LABELS.outline_source, book_outline: REF_DOC_LABELS.book_outline,
		book_relations: REF_DOC_LABELS.book_relations, vol_relations: REF_DOC_LABELS.vol_relations, vol_list: REF_DOC_LABELS.vol_list,
		prev_vol_outline: REF_DOC_LABELS.prev_vol_outline,
	},
	// 阶段 4 编写文章（/write /continue /rewrite /review /chat）
	{
		worldview: REF_DOC_LABELS.worldview, timeline: REF_DOC_LABELS.timeline, book_relations: REF_DOC_LABELS.book_relations,
		vol_outline: REF_DOC_LABELS.vol_outline, vol_relations: REF_DOC_LABELS.vol_relations,
		chapter_outline: REF_DOC_LABELS.chapter_outline, characters: REF_DOC_LABELS.characters,
		scenes: REF_DOC_LABELS.scenes, chapter_relations: REF_DOC_LABELS.chapter_relations,
	},
];

/** 禁用词清单技能名（v0.3.6+ 禁用词 Skill 化：词表事实源＝SKILLS/<此名>.md；正文族默认清单与词检测/清洗共用） */
export const BANNED_LIST_SKILL_NAME = "网文高频禁用词清单";

/** 世界观生成方法论技能名（v0.3.7+：方法论种子随世界观阶段默认引用清单播种，内容对齐 prompts.buildWorldviewGenPrompt 的 H2 骨架与红线） */
export const WORLDVIEW_FRAMEWORK_SKILL_NAME = "世界观生成框架";

/** 各阶段（0–4）引用文档默认清单（初始化配置框；用户改动后以保存值为准）。 */
export const PHASE_REF_DOC_DEFAULTS: string[][] = [
	["book_info", "tension_rules", `skill:${WORLDVIEW_FRAMEWORK_SKILL_NAME}`], // 阶段 0 世界观生成默认含方法论技能（v0.3.7+；仅对从未保存过 ref_docs 的配置生效）
	["book_info", "tension_rules", "worldview", "timeline"], // 阶段 1 默认含时间线（书级《时间线.md》无有效条目时自动生成后再继续策划指南；v0.3.3+ 替代旧大事件列表）
	["book_info", "tension_rules", "worldview", "planning_guide"], // 阶段 2 默认只注入前四项；大纲来源/全书大纲/关系/卷列表/前卷大纲保留在下拉目录、可手动添加
	["book_info", "tension_rules", "worldview", "planning_guide", "outline_source", "book_outline", "vol_list", "prev_vol_outline"], // 阶段 3 默认八项；书级/本卷人物关系保留在下拉目录、可手动添加
	["worldview", "book_relations", "vol_outline", "vol_relations", "chapter_outline", "characters", "scenes", "chapter_relations", `skill:${BANNED_LIST_SKILL_NAME}`], // 阶段 4 默认含禁用词清单技能（v0.3.6+：替代旧【禁用词】专用注入块；仅对从未保存过 ref_docs 的配置生效，已定制清单的阶段需自行「添加技能…」）
];

export interface PluginConfig {
	version: 1;
	active_llm?: string; // 兼容字段：旧版激活态，设置页不再暴露；仅作为对话框模型的回落（chat_model 留空时），不影响任何写作阶段
	chat_model?: string; // 对话框使用的模型配置名（llm_configs[].name），留空=回落 active_llm
	llm_configs?: LlmConfigDoc[];
	system_prompt?: string; // 写作系统提示词（空=用内置默认）
	desc_style?: string; // "normal" | "complete"
	writing_phases?: WritingPhase[]; // 写作阶段模型配置（五阶段独立模型）
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
		reasoning_effort: "none",
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
			{ name: "local", enabled: true, provider: "openai-compatible", base_url: "http://localhost:8509", model_name: "", ...base, reasoning_effort: "none", openai_extras: ["repeat_penalty"], api_style: "" },
			{ name: "deepseek", enabled: true, provider: "deepseek", api_key: "", base_url: "https://api.deepseek.com", model_name: "", ...base, openai_extras: [], api_style: "responses" },
			{ name: "qwen-dashscope", enabled: true, provider: "qwen", api_key: "", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model_name: "", ...base, openai_extras: [], api_style: "" },
		],
		system_prompt: "",
		desc_style: "normal",
		writing_phases: WRITING_PHASE_LABELS.map((name) => ({ name, llm_config_name: "" })), // v0.3.7+：由 WRITING_PHASE_LABELS 派生（世界观生成居首），防词源漂移
	};
}
