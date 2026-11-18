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

export function getVisibleLlmFields(provider?: string): Array<"base_url" | "model_name" | "api_key" | "temperature" | "max_tokens" | "top_p" | "repeat_penalty" | "reasoning_effort" | "context_window" | "thinking"> {
	const normalized = normalizeLlmProvider(provider);
	const common = ["base_url", "model_name", "api_key", "temperature", "max_tokens", "top_p", "repeat_penalty", "reasoning_effort", "context_window"] as const;
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

/**
 * 模型配置改名：把「按名字引用配置」的地方一次性全部跟上——配置自身 `name`、`active_llm`、`chat_model`、各写作阶段 `llm_config_name`。
 * 只做数据同步（空名/重名的拒绝在设置页改名输入框里），改名后 UI 侧另需重刷已渲染的下拉框：
 * 已打开的 LLM 对话框走 `main.ts syncChatModelSelect()`，设置页内各「模型配置」下拉走 `ArticleWriterSettingTab.refreshLlmNameSelects()`。
 */
export function renameLlmConfig<T extends { name: string }>(conf: Pick<PluginConfig, "chat_model" | "active_llm" | "writing_phases" | "llm_configs"> | undefined, cfg: T, newName: string): void {
	const oldName = cfg.name;
	if (!oldName || oldName === newName) return;
	cfg.name = newName;
	if (!conf) return;
	if (conf.chat_model === oldName) conf.chat_model = newName;
	if (conf.active_llm === oldName) conf.active_llm = newName;
	for (const phase of conf.writing_phases ?? []) {
		if (phase.llm_config_name === oldName) phase.llm_config_name = newName;
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
	/** v0.4.6+ 模型支持的上下文窗口（token 数，如 128000）——LLM 对话面板「自动上下文压缩」判定预算用；
	 *  留空回落模型名 NNK 后缀启发式（如 llama-3.1-8b-instruct-128k）；两者皆无＝窗口未知、自动压缩不启用（仍可手动压缩） */
	context_window?: number;
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
	// 阶段 0 世界观生成（/worldview-generate）：世界观.md 是产出目标、不注入自身；张力/节奏手法走 skill:张力工具箱（v0.4.3+，默认清单已含，目录里没有内置文档项）
	{ book_info: REF_DOC_LABELS.book_info },
	// 阶段 1 策划方案生成（/planning-guide-worldview；自动生成策划指南/时间线前置链路）
	{ book_info: REF_DOC_LABELS.book_info, worldview: REF_DOC_LABELS.worldview, timeline: REF_DOC_LABELS.timeline, book_outline: REF_DOC_LABELS.book_outline, vol_list: REF_DOC_LABELS.vol_list },
	// 阶段 2 书籍大纲和卷级大纲生成（/book-outline-generate /vol-outline-generate /book-outline-to-volumes）
	{
		book_info: REF_DOC_LABELS.book_info, worldview: REF_DOC_LABELS.worldview, timeline: REF_DOC_LABELS.timeline,
		planning_guide: REF_DOC_LABELS.planning_guide, outline_source: REF_DOC_LABELS.outline_source, book_outline: REF_DOC_LABELS.book_outline,
		book_relations: REF_DOC_LABELS.book_relations, vol_relations: REF_DOC_LABELS.vol_relations, vol_list: REF_DOC_LABELS.vol_list,
		prev_vol_outline: REF_DOC_LABELS.prev_vol_outline,
	},
	// 阶段 3 文章大纲生成（/vol-outline-to-chapters）
	{
		book_info: REF_DOC_LABELS.book_info, worldview: REF_DOC_LABELS.worldview, timeline: REF_DOC_LABELS.timeline,
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

/** v0.4.6+ 敏感词检测词表事实源技能名（SKILLS/敏感词清单.md，与禁用词清单同格式；不注入提示词，仅供确定性检测） */
export const SENSITIVE_LIST_SKILL_NAME = "敏感词清单";

/** 世界观生成方法论技能名（v0.3.7+：方法论种子随世界观阶段默认引用清单播种，内容对齐 prompts.buildWorldviewGenPrompt 的 H2 骨架与红线） */
export const WORLDVIEW_FRAMEWORK_SKILL_NAME = "世界观生成框架";

/** 张力工具箱技能名（v0.4.3+ 张力规则并入张力工具箱：张力/节奏手法唯一载体＝系统技能 `SKILLS/张力工具箱.md`，
 *  经各阶段引用清单的 `skill:` 条目注入；旧书级《案头资料/张力规则.md》与内置 key `tension_rules` 退役、不再自动注入） */
export const TENSION_TOOLBOX_SKILL_NAME = "张力工具箱";

/** 写作任务技能名（v0.4.3+ 「章节写作任务」「章节创作」两份合并为唯一一份＝系统技能 `SKILLS/章节写作指导.md`，
 *  「编写文章」阶段清单选中后经 taskSkillBlock 注入第 3–13 条静态要求）；旧名仅存于迁移/清理逻辑 */
export const WRITING_TASK_SKILL_NAME = "章节写作指导";
export const LEGACY_WRITING_TASK_SKILL_NAMES: string[] = ["章节创作", "章节写作任务"];

/** 存量引用清单（ref_docs / chat_ref_docs）内置 key 的静默迁移表（loadSettings 套用：保原位置、去重、落盘）：
 *  events_list→timeline（v0.3.3+）、tension_rules→skill:张力工具箱（v0.4.3+ 张力规则并入张力工具箱）、
 *  skill:章节创作 / skill:章节写作任务→skill:章节写作指导（v0.4.3+ 两技能合并；旧清单条目原位改写）。 */
export const REF_DOC_KEY_RENAMES: Record<string, string> = {
	events_list: "timeline",
	tension_rules: `skill:${TENSION_TOOLBOX_SKILL_NAME}`,
	[`skill:${LEGACY_WRITING_TASK_SKILL_NAMES[0]}`]: `skill:${WRITING_TASK_SKILL_NAME}`,
	[`skill:${LEGACY_WRITING_TASK_SKILL_NAMES[1]}`]: `skill:${WRITING_TASK_SKILL_NAME}`,
};

/** 各阶段（0–4）引用文档默认清单（初始化配置框；用户改动后以保存值为准）。
 *  v0.4.3+ 张力规则并入张力工具箱：阶段 0–3 原内置条目 `tension_rules` 改为 `skill:${TENSION_TOOLBOX_SKILL_NAME}`
 *  （默认仍注入，只是载体换成系统技能文件；已保存过 ref_docs 的旧清单由 loadSettings 按 REF_DOC_KEY_RENAMES 原位改写）。 */
export const PHASE_REF_DOC_DEFAULTS: string[][] = [
	["book_info", `skill:${IDENTITY_BOOST_SKILL_PREFIX}${WRITING_PHASE_LABELS[0]}`, `skill:${TENSION_TOOLBOX_SKILL_NAME}`, `skill:${WORLDVIEW_FRAMEWORK_SKILL_NAME}`], // 阶段 0 世界观生成默认含方法论技能（v0.3.7+）与身份加强技能（v0.4.3+：五阶段内置默认恒含 `skill:身份加强·<阶段名>`；仅对从未保存过 ref_docs 的配置生效）
	["book_info", `skill:${IDENTITY_BOOST_SKILL_PREFIX}${WRITING_PHASE_LABELS[1]}`, `skill:${TENSION_TOOLBOX_SKILL_NAME}`, "worldview", "timeline"], // 阶段 1 默认含时间线（书级《时间线.md》无有效条目时自动生成后再继续策划指南；v0.3.3+ 替代旧大事件列表）
	["book_info", `skill:${IDENTITY_BOOST_SKILL_PREFIX}${WRITING_PHASE_LABELS[2]}`, `skill:${TENSION_TOOLBOX_SKILL_NAME}`, "worldview", "planning_guide"], // 阶段 2 默认只注入前五项；大纲来源/全书大纲/关系/卷列表/前卷大纲保留在下拉目录、可手动添加
	["book_info", `skill:${IDENTITY_BOOST_SKILL_PREFIX}${WRITING_PHASE_LABELS[3]}`, `skill:${TENSION_TOOLBOX_SKILL_NAME}`, "worldview", "planning_guide", "outline_source", "book_outline", "vol_list", "prev_vol_outline"], // 阶段 3 默认九项；书级/本卷人物关系保留在下拉目录、可手动添加
	["worldview", "book_relations", "vol_outline", "vol_relations", "chapter_outline", "characters", "scenes", "chapter_relations", `skill:${IDENTITY_BOOST_SKILL_PREFIX}${WRITING_PHASE_LABELS[4]}`, `skill:${BANNED_LIST_SKILL_NAME}`], // 阶段 4 默认含禁用词清单技能（v0.3.6+：替代旧【禁用词】专用注入块）与身份加强技能（v0.4.3+；仅对从未保存过 ref_docs 的配置生效，已定制清单的阶段需自行「添加技能…」）
];

/** 对话窗口可注入的内置引用文档目录（v0.4.3+：设置页对话配置框下拉候选，书级背景文档，写作上下文已含的标题/人物/场景/当前章不重复列）。 */
export const CHAT_REF_DOC_CATALOG: Record<string, string> = {
	book_info: REF_DOC_LABELS.book_info,
	worldview: REF_DOC_LABELS.worldview,
	timeline: REF_DOC_LABELS.timeline,
	book_outline: REF_DOC_LABELS.book_outline,
	planning_guide: REF_DOC_LABELS.planning_guide,
	book_relations: REF_DOC_LABELS.book_relations,
};

/** 对话窗口引用文档默认清单（v0.4.3+）：恒空＝不追加额外内置文档，保持既有对话上下文行为不变；用户按需「添加引用文档／技能／vault 文档」自选。 */
export const CHAT_REF_DOC_DEFAULTS: string[] = [];

export interface PluginConfig {
	version: 1;
	active_llm?: string; // 兼容字段：旧版激活态，设置页不再暴露；仅作为对话框模型的回落（chat_model 留空时），不影响任何写作阶段
	chat_model?: string; // 对话框使用的模型配置名（llm_configs[].name），留空=回落 active_llm
	llm_configs?: LlmConfigDoc[];
	// v0.4.3+：system_prompt 已废弃删除（写作系统提示词输入框退役，身份改经「对话助手身份」任务段与引用技能/文档装配）
	desc_style?: string; // "normal" | "complete"
	chat_ref_docs?: string[]; // v0.4.3+ 对话窗口引用文档清单（机制同阶段 ref_docs）：内置 key（见 CHAT_REF_DOC_CATALOG）或 "file:<vault 路径>" 或 "skill:<技能名>"；undefined/[]＝不追加额外文档
	/** v0.4.6+ 对话自动压缩触发阈值（占模型上下文窗口的百分比 1–100，缺省 75）：发送前估算提示词 token，
	 *  超过 窗口×比例 即先自动压缩早期轮次再发送；0＝关闭自动压缩（仅手动按钮）。依赖模型配置的 context_window（见 LlmConfigDoc） */
	chat_compress_ratio?: number;
	writing_phases?: WritingPhase[]; // 写作阶段模型配置（五阶段独立模型）
}

/** 首次运行（data.json 无 llm 段）时预置的标准模板：字段结构与 Python 用户配置文件一致，api_key/model_name 留空待填。
 * 插件支持桌面＋移动双端（manifest isDesktopOnly=false，见 l1-overview 设计决策⑤），端点走本地或远程 LLM API。
 * 任何密钥都应仅保存在本地 vault 的 .obsidian 目录中，不建议同步到共享/不受信任位置。
 * v0.4.6+ 修 C3：max_tokens 按端点分档——本地（llama-server 类）保持 65535（思考与正文共享预算，需大）；
 * 云端模板（deepseek/qwen-dashscope）改 8192：这些 API 输出上限普遍 8K 档，发 65535 首跑必吃 400 参数错。 */
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
	const cloud = { max_tokens: 8192 }; // 云端模板覆盖：见上方注释（v0.4.6+ C3）
	return {
		version: 1,
		active_llm: "local",
		llm_configs: [
			// local 默认关思考（reasoning_effort:"none"）：本地 llama-server + Qwen 等模板默认开思考，
			// 思考与正文共享 max_tokens 预算，"high" 会耗尽预算致 content 恒空（大纲/长文生成失败根因）。
			// 需要思考的本地模型自行在设置页改回 high/max。
			{ name: "local", enabled: true, provider: "openai-compatible", base_url: "http://localhost:8509", model_name: "", ...base, reasoning_effort: "none", openai_extras: ["repeat_penalty"], api_style: "" },
			{ name: "deepseek", enabled: true, provider: "deepseek", api_key: "", base_url: "https://api.deepseek.com", model_name: "", ...base, ...cloud, openai_extras: [], api_style: "responses" },
			{ name: "qwen-dashscope", enabled: true, provider: "qwen", api_key: "", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model_name: "", ...base, ...cloud, openai_extras: [], api_style: "" },
		],
		desc_style: "normal",
		writing_phases: WRITING_PHASE_LABELS.map((name) => ({ name, llm_config_name: "" })), // v0.3.7+：由 WRITING_PHASE_LABELS 派生（世界观生成居首），防词源漂移
	};
}
