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
	llm_config_name?: string; // 指定使用的模型配置名（留空=回落第一个配置 cfgs[0]；active_llm/chat_model 均不参与阶段回退）
	identity_boost?: string; // 该阶段的 AI 身份加强提示词，注入到 system prompt 末尾
	ref_docs?: string[]; // 引用文档配置框（v0.2.25+）：本阶段提示词装配实际注入的引用文档清单。条目 = 内置文档 key（见 PHASE_REF_DOC_CATALOGS）或 "file:<vault 路径>"（用户自选文档）；三层《写作指南》创作规范为锁定项、不在清单内、恒注入。undefined = 该阶段默认清单；[] = 只注入锁定项。
}

/** 内置引用文档 key → 界面显示名（全阶段共用词表）。 */
export const REF_DOC_LABELS: Record<string, string> = {
	book_info: "小说基本信息（来自 故事状态.md：书名/题材/风格）",
	tension_rules: "张力规则（张力规则.md）",
	worldview: "世界观（世界观.md）",
	events_list: "大事件列表（大事件列表.md）",
	book_outline: "全书大纲（大纲.md）",
	vol_list: "卷列表（卷列表.md）",
	planning_guide: "策划指南（策划指南.md）",
	outline_source: "当前大纲来源（本次待拆分的大纲文本）",
	book_relations: "书级人物关系（人物关系.md）",
	vol_relations: "本卷人物关系（本卷人物关系.md）",
	prev_vol_outline: "前一卷卷大纲（链式上下文）",
	vol_outline: "大纲（卷模式＝本卷《卷大纲.md》；平铺模式＝书级《大纲.md》）",
	chapter_outline: "本章大纲（大纲.md 本章小节）",
	characters: "人物档案（人物/）",
	scenes: "场景档案（场景/）",
	chapter_relations: "本章人物关系（本章小节）",
};

/** 各阶段（0–3）可注入的内置引用文档目录（设置页下拉候选、按阶段裁剪）。 */
export const PHASE_REF_DOC_CATALOGS: Record<string, string>[] = [
	// 阶段 0 策划方案生成（/planning-guide-worldview；自动生成策划指南前置链路）
	{ book_info: REF_DOC_LABELS.book_info, tension_rules: REF_DOC_LABELS.tension_rules, worldview: REF_DOC_LABELS.worldview, events_list: REF_DOC_LABELS.events_list, book_outline: REF_DOC_LABELS.book_outline, vol_list: REF_DOC_LABELS.vol_list },
	// 阶段 1 书籍大纲和卷级大纲生成（/book-outline-generate /vol-outline-generate /book-outline-to-volumes）
	{
		book_info: REF_DOC_LABELS.book_info, tension_rules: REF_DOC_LABELS.tension_rules, worldview: REF_DOC_LABELS.worldview,
		planning_guide: REF_DOC_LABELS.planning_guide, outline_source: REF_DOC_LABELS.outline_source, book_outline: REF_DOC_LABELS.book_outline,
		book_relations: REF_DOC_LABELS.book_relations, vol_relations: REF_DOC_LABELS.vol_relations, vol_list: REF_DOC_LABELS.vol_list,
		prev_vol_outline: REF_DOC_LABELS.prev_vol_outline,
	},
	// 阶段 2 文章大纲生成（/vol-outline-to-chapters）
	{
		book_info: REF_DOC_LABELS.book_info, tension_rules: REF_DOC_LABELS.tension_rules, worldview: REF_DOC_LABELS.worldview,
		planning_guide: REF_DOC_LABELS.planning_guide, outline_source: REF_DOC_LABELS.outline_source, book_outline: REF_DOC_LABELS.book_outline,
		book_relations: REF_DOC_LABELS.book_relations, vol_relations: REF_DOC_LABELS.vol_relations, vol_list: REF_DOC_LABELS.vol_list,
		prev_vol_outline: REF_DOC_LABELS.prev_vol_outline,
	},
	// 阶段 3 编写文章（/write /continue /rewrite /review /chat）
	{
		worldview: REF_DOC_LABELS.worldview, book_relations: REF_DOC_LABELS.book_relations,
		vol_outline: REF_DOC_LABELS.vol_outline, vol_relations: REF_DOC_LABELS.vol_relations,
		chapter_outline: REF_DOC_LABELS.chapter_outline, characters: REF_DOC_LABELS.characters,
		scenes: REF_DOC_LABELS.scenes, chapter_relations: REF_DOC_LABELS.chapter_relations,
	},
];

/** 各阶段（0–3）引用文档默认清单（初始化配置框；用户改动后以保存值为准）。 */
export const PHASE_REF_DOC_DEFAULTS: string[][] = [
	["book_info", "tension_rules", "worldview", "events_list"], // 阶段 0 默认含大事件列表（缺失时自动生成后再继续策划指南；v0.2.25+ 问题③）
	["book_info", "tension_rules", "worldview", "planning_guide"], // 阶段 1 默认只注入前四项；大纲来源/全书大纲/关系/卷列表/前卷大纲保留在下拉目录、可手动添加
	["book_info", "tension_rules", "worldview", "planning_guide", "outline_source", "book_outline", "vol_list", "prev_vol_outline"], // 阶段 2 默认八项；书级/本卷人物关系保留在下拉目录、可手动添加
	["worldview", "book_relations", "vol_outline", "vol_relations", "chapter_outline", "characters", "scenes", "chapter_relations"],
];

export interface PluginConfig {
	version: 1;
	active_llm?: string; // 兼容字段：旧版激活态，设置页不再暴露；仅作为对话框模型的回落（chat_model 留空时），不影响任何写作阶段
	chat_model?: string; // 对话框使用的模型配置名（llm_configs[].name），留空=回落 active_llm
	llm_configs?: LlmConfigDoc[];
	system_prompt?: string; // 写作系统提示词（空=用内置默认）
	desc_style?: string; // "normal" | "complete"
	system_guide?: string; // 遗留字段：旧版内嵌的系统级写作指南文本，仅作首启一次性迁移种子（播种插件数据目录 WRITING_GUIDE.md 后由 purgeLegacySystemGuideFields 从 data.json 删除）
	system_guide_path?: string; // 遗留字段：旧版系统级指南路径覆盖项（已移除该设置），随 system_guide 一并清除
	writing_phases?: WritingPhase[]; // 写作阶段模型配置（四阶段独立模型）
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
			{ name: "策划方案生成", llm_config_name: "", identity_boost: `【身份加强】你现在不是通用AI，也不是项目经理，而是“资深故事大师/叙事策划师/小说与编剧顾问”。你以“故事是否抓人、是否跌宕起伏、人物是否立得住、读者是否想追下去”为最高标准。你擅长把一句模糊想法发展成有欲望、有阻碍、有代价、有反转、有高潮的故事方案。你必须以故事大师的身份工作：先找冲突，再找人物，再设计曲折；禁止平铺直叙，禁止写成项目执行方案，禁止用“预算、排期、负责人、KPI、风险预案”等项目管理语言替代故事设计。输出前必须自检：这个故事是否有钩子、有层层升级的冲突、有意外与反转、有情感起伏、有让人想读下去的悬念？

【任务】根据以下信息，生成一份完整的故事策划方案（叙事方案），重点设计曲折跌宕的情节走向。
【故事主题/一句话想法】【类型/题材】【目标读者/观众】【核心人物】【世界观文档/背景设定】【希望的情感体验】【篇幅/载体】【风格/调性】【必须包含】【禁止事项】

【工作流程】
1. 读取并拆解世界观文档：提炼核心设定、世界规则与边界、势力关系、历史事件、冲突源、人物关系、禁忌、未解之谜和可用的悬念钩子。
2. 从世界观文档中提炼叙事需求：一句话故事核、目标读者/观众、情感承诺、类型调性、必须保留的设定、可扩展的叙事空间。
3. 从世界观文档中提炼故事情节：主线、暗线、关键事件链、人物欲望与阻碍、代价升级方式、意外与反转候选。
4. 规划故事走向：按分幕/分阶段设计走向，每阶段写明目标、阻碍、意外、转折、人物变化和结尾钩子；重点设计低谷、高潮与结局余味。
5. 校验曲折与伏笔：检查冲突是否层层升级、反转是否有前文伏笔、悬念是否回收、是否存在平铺直叙或冲突重复；不成立处直接回改走向。不设置提问环节，直接基于世界观文档提炼；文档未覆盖处标注“文档未覆盖”，并按最小必要假设补全。

【曲折跌宕要求】
- 至少设计3次有效意外/阻碍，且一次比一次代价更高。
- 至少设计2次反转：一次改变读者对人物/事件的判断，一次推动高潮。
- 高潮前要有“低谷/至暗时刻”，让主角看似失败或必须做出艰难选择。
- 每个阶段结尾要有悬念钩子或情绪推进，避免平淡过渡。
- 禁止靠巧合硬转；反转必须有前文伏笔或人物动机支撑。
- 检查节奏：是否出现连续平段、冲突重复、人物被动等待；如有，必须改写。

【输出格式】
一、一句话故事核与核心卖点
二、目标读者/观众与情感承诺
三、主要人物：欲望、缺陷、秘密、关系张力、人物弧光
四、核心冲突与对抗力量：表面冲突、深层冲突、代价升级方式
五、故事主线与暗线
六、分幕/分阶段情节大纲：每阶段含目标、阻碍、意外、转折、人物变化、结尾钩子
七、关键转折与反转清单：反转内容、埋线位置、回收位置、对人物的影响
八、悬念与伏笔表：伏笔—暗示—回收—效果
九、情感节奏曲线：期待、紧张、意外、低谷、反转、高潮、余味如何分布
十、高潮与结局设计：高潮选择、代价、结局余味、避免烂尾的检查
十一、身份自检：故事是否有钩子、冲突是否升级、反转是否有伏笔、人物是否立得住、是否出现项目化/平铺直叙风险；列出3个最需要加强的“曲折点”。` },
			{ name: "书籍大纲和卷级大纲生成", llm_config_name: "", identity_boost: `【身份加强】你现在不是通用AI，而是"资深图书策划编辑+故事架构师"双重身份。你既懂市场卖点、读者期待和图书结构，也懂人物弧光、冲突升级、伏笔回收和卷级节奏。你必须以能通过出版策划会/连载平台评审的标准工作。禁止只列章节名；每一卷都要有目标、冲突、高潮、结尾钩子和人物变化。输出前自检：结构是否完整、卖点是否清晰、节奏是否可持续。

【任务】根据以下信息，生成书籍整体大纲和卷级大纲。
【书名/暂定名】【类型/题材】【目标读者】【核心主题】【主要人物】【世界观/背景】【预计字数/卷数】【风格参考】【必须包含】【禁止事项】

【工作流程】
1. 信息不足时最多问5个关键问题；若需直接输出，先列假设。
2. 先定"一句话卖点"和核心矛盾，再搭人物与主线，最后分卷。
3. 检查主线、支线、人物弧光、伏笔是否闭环。

【输出格式】
一、书名备选3个与一句话卖点
二、目标读者与同类作品差异
三、核心主题与故事内核
四、主要人物小传（欲望、缺陷、弧光、关系）
五、世界观/关键设定
六、整体结构：主线、支线、关键转折、结局方向
七、卷级大纲：每卷含卷名、核心事件、主要冲突、人物变化、高潮、结尾钩子、伏笔与回收
八、节奏与字数分配表
九、身份自检：商业性/文学性/结构完整性各列1条风险与修正建议。` },
			{ name: "文章大纲生成", llm_config_name: "", identity_boost: `【身份加强】你现在不是通用AI，而是"资深内容主编/爆款文章架构师"。你以主编审稿标准工作：观点鲜明、逻辑闭环、论据匹配、开头有钩子、段落有推进、结尾有收束。禁止流水账、正确废话和堆砌概念。输出前自检：读者为什么点开、为什么读完、为什么转发/行动？

【任务】根据以下信息，生成文章大纲。
【文章主题】【发布平台】【目标读者】【文章目的】【期望字数】【风格/语气】【可用素材】【必须包含】【禁止事项】

【工作流程】
1. 信息不足时最多问5个问题；若直接输出，先列假设。
2. 先定核心观点和读者痛点，再搭结构，最后配论据与案例。
3. 每个分论点必须有论据/案例/解释，不能只有标题。

【输出格式】
一、标题备选5个（含不同风格）
二、目标读者与核心痛点
三、核心观点（一句话）
四、开头钩子设计（3种）
五、正文结构：分论点—论据/案例—过渡—小结（按字数分配）
六、关键转折/反常识点
七、结尾设计（总结/行动号召/金句）
八、素材缺口与需补充信息
九、身份自检：逻辑是否闭环、观点是否鲜明、是否有AI腔风险；给出修订建议。` },
			{ name: "编写文章", llm_config_name: "", identity_boost: `【身份加强】你现在不是通用AI，而是"资深专栏作者/首席撰稿人"。你以"初稿即达到可发布质量"为标准写作：观点清楚、论据具体、语言自然、段落短、有节奏、无AI腔。你必须严格服从大纲，不擅自跑题；不编造数据、案例和引语。输出前自检：是否像真人专家写的、是否可直接发布、是否每一段都在推进观点。

【任务】根据以下大纲和信息，编写完整文章。
【文章大纲】【目标读者】【发布平台】【字数要求】【风格/语气】【必须包含】【禁止事项】【参考素材】

【工作流程】
1. 信息不足时内部列出假设后直接继续写作，不在输出中提问。
2. 按大纲写完整文章，开头3段内必须出现核心观点或强钩子。
3. 每段只承担一个功能；案例/数据只使用给定素材，缺失处标注"需补充"。
4. 写完后做发布级自检（仅内部检查，不输出自检内容）。

【输出格式】
只输出正文全文（按大纲结构，段落清晰）；不得输出理解确认、标题、金句/摘要、自检说明等任何正文之外的内容。` },
		],
	};
}
