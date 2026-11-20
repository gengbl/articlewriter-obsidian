/**
 * LLM 对话会话持久化（v0.4.6+）：纯模块——会话 Markdown 的格式化/解析、上下文压缩窗口切分与压缩提示词组装。
 * 会话落盘位置＝当前书《案头资料/AI会话/》：面板固定读写《当前对话.md》（v0.4.7+），「清空对话」时旧文件改名归档为《对话 YYYY-MM-DD HHMM.md》；
 * 文件是普通 Markdown，可人工编辑，面板「重新加载」按本模块 parseSession 读回。LlmChatView 只做 UI 与 LLM 调用，格式细节全在这里。
 */

/** 一轮对话条目：role=summary 为「上下文压缩」产生的摘要轮（始终位于会话开头，只注入系统提示词、不进气泡历史原样重发） */
export interface SessionTurn {
	role: "user" | "assistant" | "summary";
	content: string;
}

export interface SessionMeta {
	story: string;
	created_at: string;
	updated_at: string;
	model: string;
	/** v0.4.7+ 提示词轨保留窗：提示词轨＝摘要轮＋显示轨末尾 N 轮（显示与会话文件始终存完整对话，压缩只重写提示词轨）。
	 *  缺省（字段缺失）＝提示词轨含全部轮次（旧文件/未压缩）。 */
	prompt_keep?: number;
}

/** 会话文件的章节标记：任何「## <名>」行都是段落边界——`我`/`助手`/`摘要（上下文压缩）` 为会话轮，
 *  其余 H2（人工加的注释标题等）视为边界但内容丢弃；正文逐字保留，读回时 trim 首尾空白 */
const SECTION_RE = /^## (.+?)[^\S\r\n]*$/gm;
export const SUMMARY_HEADER = "摘要（上下文压缩）";

/** frontmatter 极简 YAML（仅本模块写出的四个字符串键，值带双引号） */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function escVal(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** 序列化为「frontmatter + H2 章节」；空会话也写 frontmatter（占位可读） */
export function formatSession(meta: SessionMeta, turns: SessionTurn[]): string {
	const lines = [
		"---",
		"type: aw-chat",
		`story: "${escVal(meta.story)}"`,
		`created_at: "${escVal(meta.created_at)}"`,
		`updated_at: "${escVal(meta.updated_at)}"`,
		`model: "${escVal(meta.model)}"`,
		...(typeof meta.prompt_keep === "number" && Number.isSafeInteger(meta.prompt_keep) && meta.prompt_keep >= 0 ? [`prompt_keep: ${String(meta.prompt_keep)}`] : []),
		"---",
		"",
	];
	for (const t of turns) {
		const header = t.role === "summary" ? SUMMARY_HEADER : t.role === "user" ? "我" : "助手";
		lines.push(`## ${header}`, "", t.content.trim(), "");
	}
	return lines.join("\n");
}

/** 容错解析（人工编辑过的文件同样读）：无 frontmatter/无章节＝空会话；未识别的 H1/段落忽略 */
export function parseSession(raw: string): { meta: Partial<SessionMeta>; turns: SessionTurn[] } {
	const clean = raw.replace(/^\uFEFF/, "");
	const meta: Partial<SessionMeta> = {};
	let body = clean;
	const fm = FM_RE.exec(clean);
	if (fm) {
		body = clean.slice(fm[0].length);
		for (const line of fm[1].split(/\r?\n/)) {
			const m = line.match(/^(story|created_at|updated_at|model|prompt_keep):\s*(.*)$/);
			if (!m) continue;
			let v = m[2].trim();
			if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
			const mk = m[1];
			if (mk === "prompt_keep") { const n = Number(v); if (Number.isSafeInteger(n) && n >= 0) meta.prompt_keep = n; continue; }
			if (mk === "story" || mk === "created_at" || mk === "updated_at" || mk === "model") meta[mk] = v;
		}
	}
	const turns: SessionTurn[] = [];
	const marks: Array<{ idx: number; end: number; role: SessionTurn["role"] | null }> = [];
	SECTION_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = SECTION_RE.exec(body)) !== null) {
		const name = m[1].trim();
		const role = name === "我" ? "user" : name === "助手" ? "assistant" : name === SUMMARY_HEADER ? "summary" : null;
		marks.push({ idx: m.index, end: m.index + m[0].length, role });
	}
	for (let i = 0; i < marks.length; i++) {
		const mk = marks[i];
		if (mk.role === null) continue; // 未识别 H2：段落边界、内容丢弃
		const next = i + 1 < marks.length ? marks[i + 1].idx : body.length;
		const content = body.slice(mk.end, next).trim();
		if (content) turns.push({ role: mk.role, content });
	}
	return { meta, turns };
}

/** 上下文压缩参数：保留最近 keepRounds 轮（user+assistant 配对）原样，更早的 user/assistant 轮连同旧摘要一并送 LLM 合并成新摘要；
 *  可压缩的 user/assistant 轮不足 minCompress 时不值得压（一次 LLM 调用换不了多少空间） */
export const COMPRESS_KEEP_ROUNDS = 2;
export const COMPRESS_MIN_TURNS = 4;

/** 自动压缩的自适应下限：预算仍超限时可只保留最近 1 轮（2 条），再把更早的 2 条并入摘要；
 *  手动「压缩上下文」仍走 COMPRESS_MIN_TURNS=4 的保守门槛。 */
export const AUTO_COMPRESS_MIN_TURNS = 2;
export const AUTO_COMPRESS_MIN_KEEP_ROUNDS = 1;
export const AUTO_COMPRESS_MAX_PASSES = 3;

/** v0.4.7+ 自动压缩防抖：首轮按 `chat_compress_ratio%` 触发，一旦开始压就要求压到「阈值 − 本值」以下（下限 50），
 *  一次多腾一段喘息空间，避免「压完刚好在线下、下一轮又超」的每轮刷屏式压缩 */
export const AUTO_COMPRESS_HYSTERESIS_PCT = 10;

/** v0.4.7+ 「不值得压」下限：待压切片估算不足 max(200, 窗口/24) token 就跳过自动压缩——省一次 LLM 调用，也不糟蹋上下文。
 *  典型触发场景：本地模型没填 `context_window`（按缺省 8192 算）时，系统提示词＋工具开销＋回复预留就把预算顶到阈值附近，
 *  而对话本身还很短，压了也降不下来（用户视角＝「压缩得太频繁」）。 */
export function autoCompressMinGain(windowTokens: number): number {
	return Math.max(200, Math.floor(windowTokens / 24));
}

/** 切分压缩窗口：返回 { toCompress（含旧摘要轮，送压缩）, keep（原样保留的尾部） }；无摘要轮时新摘要由调用方插到最前 */
export function splitCompressWindow(turns: SessionTurn[], keepRounds = COMPRESS_KEEP_ROUNDS): { toCompress: SessionTurn[]; keep: SessionTurn[] } {
	const chatIdx: number[] = [];
	for (let i = 0; i < turns.length; i++) if (turns[i].role !== "summary") chatIdx.push(i);
	const keepCount = Math.min(chatIdx.length, keepRounds * 2);
	const keepFrom = chatIdx.length - keepCount;
	const boundary = chatIdx.length ? chatIdx[Math.max(0, keepFrom)] : 0; // 首个保留 chat 轮在原数组的位置；其前的摘要轮并入 toCompress
	return { toCompress: turns.slice(0, boundary), keep: turns.slice(boundary) };
}

/** 会话是否值得压缩（可压缩 user/assistant 轮是否达标） */
export function compressible(turns: SessionTurn[], minTurns = COMPRESS_MIN_TURNS, keepRounds = COMPRESS_KEEP_ROUNDS): boolean {
	const chatCount = turns.filter((t) => t.role !== "summary").length;
	return chatCount - Math.min(chatCount, keepRounds * 2) >= minTurns;
}

/** 长对话软提醒阈值（历史总字数超过即提示可压缩；不自动发起 LLM 调用） */
export const LONG_CHAT_HINT_CHARS = 20000;

export function sessionChars(turns: SessionTurn[]): number {
	let n = 0;
	for (const t of turns) n += t.content.length;
	return n;
}

/** 压缩请求的 system 提示词 */
export const COMPRESS_SYSTEM_PROMPT =
	"你是长对话的历史压缩器。把给定的对话历史压缩成要点式中文摘要，必须保留：①用户的目标与尚未完成的请求；②已确认的事实、决定与约束；③提到的文件路径、章节号与数字；④关键创意设定与人物信息；⑤助手给出的重要建议与结论。删除寒暄、重复与过程性内容。只输出摘要正文本身，不要评论或前后缀。";

/** 压缩请求的 user 内容：旧摘要（若有，要求合并）＋逐轮转录 */
export function buildCompressUserPrompt(toCompress: SessionTurn[]): string {
	const parts: string[] = [];
	const prev = toCompress.filter((t) => t.role === "summary").map((t) => t.content);
	if (prev.length) parts.push(`【已有摘要（请合并进新摘要）】\n${prev.join("\n\n")}`);
	const transcript = toCompress
		.filter((t) => t.role !== "summary")
		.map((t) => `${t.role === "user" ? "我" : "助手"}：${t.content.trim()}`)
		.join("\n\n");
	if (transcript) parts.push(`【待压缩对话】\n${transcript}`);
	parts.push("请输出合并后的新摘要。");
	return parts.join("\n\n");
}

/** 粗略 token 估算（自动压缩判定用，不追求精确）：CJK 字符≈1 token/字，其余字符≈4 字符/token；
 *  对提示词预算判定这个精度足够（触发阈值本身就有 25% 裕量） */
export function estimateTokens(s: string): number {
	const cjk = (s.match(/[\u3400-\u4DBF\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/g) ?? []).length;
	return cjk + Math.ceil((s.length - cjk) / 4);
}

/** 估算一整轮请求的 prompt 预算：系统提示词（含摘要块/工具规则）＋历史中的 user/assistant 轮＋本轮展开文本＋额外开销。
 *  摘要轮不重复计入——它只折入系统提示词、不以原生 message 重发（见 LlmChatView.buildMessages）。 */
export function estimatePromptTokens(sysContent: string, turns: SessionTurn[], pendingUser: string, extraTokens = 0): number {
	let n = estimateTokens(sysContent) + estimateTokens(pendingUser) + extraTokens;
	for (const t of turns) if (t.role !== "summary") n += estimateTokens(t.content);
	return n;
}

/** 模型上下文窗口（token）：显式 context_window > 模型名 NNK 后缀启发式（`-128k`、`(128k)` 等；不匹配 72b 之类参数规模）> null（未知，不自动压缩） */
export function chatContextWindow(cfg: { context_window?: number; model_name?: string }): number | null {
	if (typeof cfg.context_window === "number" && Number.isSafeInteger(cfg.context_window) && cfg.context_window > 0) return cfg.context_window;
	const m = /(\d{2,4})k\b/i.exec(cfg.model_name ?? "");
	return m ? Number(m[1]) * 1000 : null;
}

/** v0.4.7+ 窗口未知（context_window 未填且模型名无 NNK 后缀）时自动压缩的缺省窗口假设：
 *  宁小勿大——不假设就无法防「长对话全量历史逐轮重发」把提示词无限滚大（实测本地量化模型 ~10k token 即输出崩溃）。
 *  模型实际窗口更大时到设置页填 context_window 即可关闭该缺省。 */
export const DEFAULT_CHAT_WINDOW = 8192;

/** 自动压缩判定：提示词估算 token＋预留回复预算 是否超过 窗口×阈值比例（ratio 取 1–100，≤0＝关闭） */
export function shouldAutoCompress(promptTokens: number, reserveTokens: number, windowTokens: number, ratioPct: number): boolean {
	if (!(windowTokens > 0) || !(ratioPct > 0)) return false;
	return promptTokens + reserveTokens > windowTokens * Math.min(ratioPct, 100) / 100;
}

/** 会话文件名（不含扩展名）：`对话 YYYY-MM-DD HHMM`；同分钟撞名由调用方加 `-2` 后缀 */export function sessionFileName(now: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `对话 ${String(now.getFullYear())}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`;
}

/** v0.4.7+ 固定「当前会话」文件名（不含扩展名）：LLM 面板每次打开只加载这一个文件；
 *  「清空对话」＝把它改名归档（`对话 YYYY-MM-DD HHMM.md`）并在原位新建同名空文件。 */
export const LIVE_SESSION_NAME = "当前对话";

/** 归档会话文件的前缀（＝旧式会话文件命名，也是「旧版遗留会话」的识别前缀） */
export const SESSION_ARCHIVE_PREFIX = "对话 ";

/** 「清空对话」归档名：由 frontmatter `created_at`（`YYYY-MM-DD HHMMSS`）前 16 字符推出 `对话 YYYY-MM-DD HHMM`；
 *  字段缺失/格式不符（旧文件、手工编辑过）回落按当前时刻 `sessionFileName(fallback)` */
export function archiveSessionName(createdAt: string, fallback: Date): string {
	const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})/.exec(createdAt);
	return m ? `对话 ${m[1]}-${m[2]}-${m[3]} ${m[4]}${m[5]}` : sessionFileName(fallback);
}

/** 会话时间戳（frontmatter created_at/updated_at）：本地可读 `YYYY-MM-DD HHMMSS` */
export function sessionTimeStamp(now: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
