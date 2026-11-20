/**
 * LLM 对话面板工具调用（v0.4.6+）：纯模块——OpenAI function calling 的工具清单与参数解析。
 * 定义在此、执行在 main.ts chatExecTool（书级读盘＋写作命令复用），面板只负责把 tool_calls 转交给注入的执行器并续轮。
 * 写类工具（审阅/续写/重写）走各命令同款流程：结果先在「生成过程」面板预览、用户点「保存/不保存」才落盘——工具只把产出回灌给模型做后续推理。
 */

export interface ChatToolDef {
	name: string;
	description: string;
	parameters: Record<string, unknown>; // JSON Schema（OpenAI function 格式）
}

const numParam = { type: "number", description: "章节号（阿拉伯数字，如 3）" };
const instrParam = { type: "string", description: "补充要求/要点（可留空）" };

export const CHAT_TOOLS: ChatToolDef[] = [
	{
		name: "read_chapter",
		description: "读取小说某章正文全文。chapter_num 为章节号；同书多卷时默认取当前卷/最先出现的同号章。",
		parameters: { type: "object", properties: { chapter_num: numParam }, required: ["chapter_num"] },
	},
	{
		name: "read_doc",
		description: "读取书级内置文档：doc_name 取 世界观 / 大纲（全书大纲）/ 人物关系 / 时间线 / 策划指南 / 故事状态（进度摘要）。",
		parameters: {
			type: "object",
			properties: { doc_name: { type: "string", enum: ["世界观", "大纲", "人物关系", "时间线", "策划指南", "故事状态"] } },
			required: ["doc_name"],
		},
	},
	{
		name: "list_chapters",
		description: "列出当前小说全部章节（章节号、标题、字数、所属卷）。",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "search_vault",
		description: "在当前小说目录内按关键词搜索（返回命中文件与上下文行，用于找设定/人物出现处）。keyword 为要搜的词或短语。",
		parameters: {
			type: "object",
			properties: { keyword: { type: "string", description: "搜索关键词/短语" }, limit: { type: "number", description: "最多返回条数（默认 20，上限 50）" } },
			required: ["keyword"],
		},
	},
	{
		name: "review_chapter",
		description: "调用「审阅本章」写作命令：全局视角审阅某章逻辑/连贯性并出报告（结果展示在生成过程面板）。chapter_num 指定章。",
		parameters: { type: "object", properties: { chapter_num: numParam, instruction: instrParam }, required: ["chapter_num"] },
	},
	{
		name: "continue_writing",
		description: "调用「续写当前章」写作命令：在该章正文末尾按大纲继续生成（结果进生成过程面板，用户确认保存）。chapter_num 指定章（会先设为当前章）。",
		parameters: { type: "object", properties: { chapter_num: numParam, instruction: instrParam }, required: ["chapter_num"] },
	},
	{
		name: "rewrite_chapter",
		description: "调用「重写本章」写作命令：基于大纲与旧文整体重构该章（结果进生成过程面板，用户确认保存）。chapter_num 指定章（会先设为当前章）。",
		parameters: { type: "object", properties: { chapter_num: numParam, instruction: instrParam }, required: ["chapter_num"] },
	},
	{
		name: "write_chapter",
		description: "调用「创作章节 (/write)」命令：按该章《章节大纲》写整章正文（结果进生成过程面板，用户确认保存）。chapter_num 指定章（会先设为当前章；全新章节可能弹标题输入框）。",
		parameters: { type: "object", properties: { chapter_num: numParam, instruction: instrParam }, required: ["chapter_num"] },
	},
	{
		name: "polish_chapter",
		description: "调用「润色」命令：对某章全文按风格要求润色重写（结果进生成过程面板，用户确认保存）。chapter_num 指定章（会先设为当前章）。",
		parameters: { type: "object", properties: { chapter_num: numParam, style: { type: "string", description: "润色风格要求，如「更简洁有力、更有画面感」（可留空）" } }, required: ["chapter_num"] },
	},
	{
		name: "deai_chapter",
		description: "调用「去 AI 味」命令：检测并清洗某章正文里的 AI 常用词（结果进生成过程面板，用户确认保存）。chapter_num 指定章。",
		parameters: { type: "object", properties: { chapter_num: numParam }, required: ["chapter_num"] },
	},
	{
		name: "read_chapter_outline",
		description: "读取某章的《章节大纲》全文（写作要点/情节点），用于判断该章要写什么或已写了什么要点。",
		parameters: { type: "object", properties: { chapter_num: numParam }, required: ["chapter_num"] },
	},
	{
		name: "read_volume_outline",
		description: "读取某卷的《卷大纲》全文。volume_name 为卷名（留空＝当前卷；平铺结构无卷大纲）。",
		parameters: { type: "object", properties: { volume_name: { type: "string", description: "卷名（可留空取当前卷）" } } },
	},
	{
		name: "set_current_chapter",
		description: "把某章设为「当前章」（影响后续续写/润色/编写与面板上下文）。用户明确要切章时使用。",
		parameters: { type: "object", properties: { chapter_num: numParam }, required: ["chapter_num"] },
	},
	{
		name: "save_content_to_file",
		description: "把给出的 content 保存为 vault 内 Markdown 文件：会弹「保存到文件」确认框由用户定路径/覆盖，未经用户确认不会落盘。suggested_path 为建议路径（相对 vault，可留空默认当前书目录）。",
		parameters: {
			type: "object",
			properties: {
				content: { type: "string", description: "要保存的完整文件内容（Markdown）" },
				suggested_path: { type: "string", description: "建议保存路径（vault 相对路径，无扩展名自动补 .md），可留空" },
			},
			required: ["content"],
		},
	},
	{
		name: "generate_worldview",
		description: "调用「生成世界观」命令：以一句话设定为种子 AI 生成书级《世界观.md》（结果进生成过程面板，用户确认保存）。premise 给一句话设定（主角是谁/为何行动/阻碍来自什么）；留空则弹输入框由用户提供。",
		parameters: { type: "object", properties: { premise: { type: "string", description: "一句话设定（生成种子）" } } },
	},
	{
		name: "generate_planning_guide",
		description: "调用「生成策划指南」命令：依据世界观/设定 AI 生成书级《策划指南.md》（流式生成，结果进生成过程面板，用户确认保存；所需输入会弹窗向用户询问）。",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "generate_timeline",
		description: "调用「生成时间线」命令：以书籍信息与世界观为上下文 AI 生成书级《时间线.md》（已有有效条目会先弹确认再覆盖；生成参数弹窗由用户回答）。",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "generate_book_outline",
		description: "调用「生成书籍大纲」命令：依据全局设定与已有章节 AI 生成书级《大纲.md》（生成模式与目标章数等弹窗由用户回答；结果进生成过程面板，用户确认保存）。",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "generate_vol_outline",
		description: "调用「自动生成卷大纲」命令：依据全局设定 AI 生成目标卷的 N 章《卷大纲.md》（目标卷/模式/章数弹窗由用户回答；无卷时会按书级大纲自动建卷逐卷生成）。",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "outline_to_chapters",
		description: "调用「从卷大纲生成章节」命令：按卷大纲里的「第N章」标记拆章、自动创建缺失章节并写入各章《章节大纲》；若上次中断会弹「继续/清理重生成」由用户选择。volume_name 指定卷名（留空＝按命令默认：当前卷/书级大纲）。",
		parameters: { type: "object", properties: { volume_name: { type: "string", description: "卷名（可留空）" } } },
	},
	{
		name: "write_chapters_consecutive",
		description: "调用「连续编写」命令：按阅读顺序逐章自动写作「已有章节大纲但正文为空」的章节（每章自动保存、免逐个确认，整轮结束后统一去 AI 味；已有正文的章自动跳过）。用户说「连续编写/继续写下去/把后面的章写完」时使用。volume_name 指定卷名（留空＝全书范围）。",
		parameters: { type: "object", properties: { volume_name: { type: "string", description: "卷名（可留空＝全书）" } } },
	},
];

/** 走「命令代跑」路径的写作类工具（main.ts runChatWritingTool：chatToolCtx 接缝＋生成面板确认） */
export const CHAT_WRITING_TOOLS = ["review_chapter", "continue_writing", "rewrite_chapter", "write_chapter", "polish_chapter", "deai_chapter"];

/** 书级生成类命令工具（main.ts runChatGenerationTool：弹窗交互默认留给用户，仅 worldview 可预答一句话设定） */
export const CHAT_GENERATION_TOOLS = ["generate_worldview", "generate_planning_guide", "generate_timeline", "generate_book_outline", "generate_vol_outline", "outline_to_chapters", "write_chapters_consecutive"];

/** 发给端点的 tools 参数形状（OpenAI function calling：每项 {type:"function", function:{…}}；CHAT_TOOLS 是平铺登记表） */
export const CHAT_TOOLS_PAYLOAD = CHAT_TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));

/** 一轮对话最多执行几轮工具调用（防模型反复调用不收口） */
export const MAX_TOOL_ROUNDS = 5;

/** 面板回答被输出上限截断（finish_reason=length）时自动续写的最多次数（再截断则提示调大 max_tokens） */
export const MAX_TRUNCATION_CONTINUES = 3;

/** 工具结果回灌给模型前的截断上限（字符）——章正文/搜索结果可能很长，防单条 tool 消息炸窗口 */
export const TOOL_RESULT_MAX_CHARS = 12000;

/** 宽松解析 tool_calls 的 arguments（模型偶发输出非法 JSON/空串）；失败返回 {} */
export function parseToolArgs(raw: string): Record<string, unknown> {
	const t = (raw ?? "").trim();
	if (!t) return {};
	try {
		const v: unknown = JSON.parse(t);
		return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** ---------- v0.4.7+ 工具名与参数容错（模型训练语料里通用 agent 都叫 read_file/grep/write_file，容易串名） ---------- */

/** 常见幻觉工具名 → 本插件真实工具名。命中＝改派（参数由各工具自己宽松接收）。
 *  **只映射无破坏性后果的**：删除/移动类幻觉名一律不改派，走 unknownToolHint 让模型自己改名重试。 */
export const TOOL_NAME_ALIASES: Record<string, string> = {
	read_file: "read_doc",
	read: "read_doc",
	view_file: "read_doc",
	open_file: "read_doc",
	cat: "read_doc",
	show_file: "read_doc",
	list_files: "list_chapters",
	list_documents: "list_chapters",
	grep: "search_vault",
	glob: "search_vault",
	find: "search_vault",
	search: "search_vault",
	search_files: "search_vault",
	write_file: "save_content_to_file",
	create_file: "save_content_to_file",
	save_file: "save_content_to_file",
	append_file: "save_content_to_file",
	edit_file: "save_content_to_file",
};

/** 工具名解析：真名原样返回；命中别名→改派（mapped=true，供状态行标注）；未知→原样返回（调用方走 unknownToolHint） */
export function resolveToolName(raw: string): { name: string; mapped: boolean } {
	const t = (raw ?? "").trim();
	if (CHAT_TOOLS.some((d) => d.name === t)) return { name: t, mapped: false };
	const alias = TOOL_NAME_ALIASES[t.toLowerCase()];
	return alias ? { name: alias, mapped: true } : { name: t, mapped: false };
}

function levenshtein(a: string, b: string): number {
	const prev: number[] = [];
	for (let j = 0; j <= b.length; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0];
		prev[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const up = prev[j];
			prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
			diag = up;
		}
	}
	return prev[b.length];
}

/** 拼错/串名时按编辑距离给候选（含前缀共享加分），用于纠正提示里列「最接近的工具」 */
export function nearestToolNames(raw: string, limit = 3): string[] {
	const t = (raw ?? "").trim().toLowerCase();
	if (!t) return [];
	const scored = CHAT_TOOLS.map((d) => {
		const n = d.name.toLowerCase();
		const base = 1 - levenshtein(t, n) / Math.max(t.length, n.length);
		const bonus = n.startsWith(t) || t.startsWith(n.slice(0, n.indexOf("_") + 1)) ? 0.25 : 0;
		return { name: d.name, score: base + bonus };
	})
		.filter((x) => x.score >= 0.4)
		.sort((a, b) => b.score - a.score);
	return scored.slice(0, Math.max(0, limit)).map((x) => x.name);
}

/** 未知工具名的纠正型 tool 结果：列候选＋全量名单，让下一轮自己改对（比「未知工具：x」这种死胡同强） */
export function unknownToolHint(raw: string): string {
	const cands = nearestToolNames(raw, 3)
		.map((n) => {
			const d = CHAT_TOOLS.find((x) => x.name === n);
			return d ? `${n}（${d.description.slice(0, 70)}）` : n;
		})
		.join("；");
	const all = CHAT_TOOLS.map((d) => d.name).join("、");
	return `没有名为「${raw}」的工具，这次调用未执行。${cands ? `\n最接近的候选：${cands}` : ""}\n可用工具：${all}。请按这些名字和参数重新调用——不存在 read_file / list_files / grep / write_file 这类通用工具名。`;
}

/** read_doc 文档名的常见参数键（模型爱写成 name/path/file） */
export const DOC_NAME_ARG_KEYS = ["doc_name", "docName", "doc", "docname", "name", "doc_type", "file", "filename", "file_name", "path"];

/** 章节号类参数的常见键 */
export const CHAPTER_NUM_ARG_KEYS = ["chapter_num", "chapter", "chapter_number", "chapterNo", "num", "n", "chapter_id"];

/** 卷名类参数的常见键 */
export const VOL_NAME_ARG_KEYS = ["volume_name", "volume", "volumeName", "vol", "vol_name", "name"];

/** 取第一个非空字符串参数（键名宽松） */
export function pickStringArg(args: Record<string, unknown>, keys: string[]): string {
	for (const k of keys) {
		const v = args[k];
		if (typeof v === "string" && v.trim()) return v.trim();
	}
	return "";
}

/** 取第一个可转成正整数的参数（接受 "18"、"第18章"、"chapter 18" 这类写法）；取不到返回 NaN */
export function pickNumberArg(args: Record<string, unknown>, keys: string[]): number {
	for (const k of keys) {
		const v = args[k];
		if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
		if (typeof v === "string" && v.trim()) {
			const digits = v.replace(/[^\d]/g, "");
			if (digits) {
				const n = Number(digits);
				if (Number.isFinite(n)) return n;
			}
		}
	}
	return NaN;
}

/** 内置文档名同义写法（含模型常写的文件名形式） */
export const DOC_NAME_SYNONYMS: Record<string, string> = {
	世界设定: "世界观",
	设定: "世界观",
	书籍大纲: "大纲",
	全书大纲: "大纲",
	总大纲: "大纲",
	book_outline: "大纲",
	目录: "大纲",
	关系: "人物关系",
	人物: "人物关系",
	年表: "时间线",
	timeline: "时间线",
	指南: "策划指南",
	规划指南: "策划指南",
	状态: "故事状态",
	进度: "故事状态",
	story_state: "故事状态",
};

/** 文档名归一：去《》〔〕引号与 .md 与目录前缀，再过同义表；结果仍可能是原词（交给调用方判有效） */
export function normalizeDocName(raw: string): string {
	let s = (raw ?? "").replace(/[《》【】\[\]"'`「」]/g, "").trim();
	s = s.replace(/\.md$/i, "");
	const slash = s.lastIndexOf("/");
	if (slash >= 0) s = s.slice(slash + 1);
	s = s.trim();
	return DOC_NAME_SYNONYMS[s] ?? DOC_NAME_SYNONYMS[s.toLowerCase()] ?? s;
}
