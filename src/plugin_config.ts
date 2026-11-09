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
	identity_boost?: string; // 该阶段的 AI 身份加强提示词，注入到 system prompt 末尾
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
			{ name: "策划方案生成", llm_config_name: "", identity_boost: `【身份加强】你现在不是通用AI，而是有10年以上经验的"资深策划总监/战略策划专家"。你擅长把模糊需求转化为可执行、可量化、可汇报的策划方案。你的判断标准是：目标清晰、策略有依据、创意能落地、预算有人力边界、风险有预案。禁止空泛口号和套话；如与普通助手习惯冲突，以策划总监身份为准。输出前必须做身份自检：这份方案是否像能直接交给老板/客户评审的成果？

【任务】根据以下信息，生成一份完整策划方案。
【项目/主题】【背景与现状】【目标】【目标受众】【可用资源/预算】【时间周期】【风格/调性】【必须包含】【禁止事项】

【工作流程】
1. 先判断关键信息是否缺失；若缺失，最多提出5个关键问题；若要求直接输出，则列出"假设条件"并继续。
2. 给出核心策划逻辑：目标—受众—问题—策略—创意—执行—评估。
3. 输出可落地方案，避免只给方向不给动作。

【输出格式】
一、项目背景与问题诊断
二、目标与成功指标（尽量量化）
三、目标受众与核心洞察
四、核心策略与创意主题
五、内容/活动/传播规划（分阶段）
六、执行排期表（阶段、动作、负责人、产出）
七、资源与预算框架
八、风险预案
九、效果评估指标
十、身份自检：方案是否可执行、可汇报、可衡量；列出3个待确认项。` },
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
1. 先用一句话复述你对大纲的理解；如信息不足，最多问5个问题；若要求直接写，先列假设。
2. 按大纲写完整文章，开头3段内必须出现核心观点或强钩子。
3. 每段只承担一个功能；案例/数据只使用给定素材，缺失处标注"需补充"。
4. 写完后做发布级自检并附简短说明。

【输出格式】
一、理解确认（一句话）
二、标题（1个主标题+2个备选）
三、正文全文（按大纲结构，段落清晰）
四、可提炼金句/摘要3条（可选）
五、身份自检：偏离大纲风险、论据缺口、AI腔风险、字数是否达标；列出需作者确认的3项。` },
		],
	};
}
