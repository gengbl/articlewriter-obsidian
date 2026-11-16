/**
 * v0.4.3+ 「连续编写」AI 味登记表（书级《案头资料/AI味清单.md》）——纯数据结构 + 纯渲染，不做 IO。
 *
 * 为什么要登记表：连续编写如果每写完一章就立刻调 LLM「打回重写」去 AI 味，那一章之后的清洗请求会把引擎 slot 里
 * 刚写好的那条会话覆盖掉（引擎的前缀复用只认「当前会话的公共前缀」，跨会话停放又常被 `skip parking` 拒），
 * 整轮逐章请求的 reused 就全成 0。因此连续编写改成：写完一章只用禁用词表**本地检测**（不花 LLM 调用）并把命中
 * 登记进本表，全部章节写完后统一清洗、回填状态。单章命令（创作本章 / 继续写作 / 重写本章）仍写完立即清洗。
 */

export type DeaiEntryStatus = "pending" | "cleaned" | "stopped"; // pending＝本轮已登记、尚未清洗；stopped＝清洗阶段被停止/未执行

export interface DeaiLedgerEntry {
	chKey: string; // 章节复合键（清洗回读正文用）
	label: string; // 展示用章名（keyLabel 结果）
	hits: number; // 禁用词命中总数（同一词多处出现按多次计）
	words: string[]; // 命中词（按出现序去重）
	sentences: string[]; // 命中整句（逐条，文档只渲染前 MAX_SENTENCES_PER_ENTRY 条）
	status: DeaiEntryStatus;
	note?: string; // 清洗结果注记（如「改写后仍剩 3 处」「面板已关闭，未清洗」）
}

export interface DeaiLedger {
	generatedAt: string; // 渲染用时间串（调用方给本地时间）
	scopeLabel: string; // 本轮范围：卷名或「全书」
	writtenChapters: number; // 本轮实际写入章数（登记只统计其中命中 AI 味的章）
	entries: DeaiLedgerEntry[];
}

/** 登记表文件名（写到书级《案头资料/》下，写字台「案头资料」节可直接点开） */
export const DEAI_LEDGER_DOC_NAME = "AI味清单.md";

/** 每章在文档里最多列出的命中句数，超出折叠为「…另有 N 条」 */
export const MAX_SENTENCES_PER_ENTRY = 8;

const STATUS_LABEL: Record<DeaiEntryStatus, string> = {
	pending: "⏳ 待统一改写",
	cleaned: "✓ 已统一改写",
	stopped: "✋ 未清洗",
};

/** 汇总行（Notice 与文档头共用口径）：登记 X 章 · 命中 Y 处（＋已清洗/待处理计数） */
export function ledgerCounts(l: DeaiLedger): string {
	const hits = l.entries.reduce((s, e) => s + e.hits, 0);
	const parts = [`登记 ${String(l.entries.length)} 章 · 命中 ${String(hits)} 处`];
	const cleaned = l.entries.filter((e) => e.status === "cleaned").length;
	const pending = l.entries.filter((e) => e.status === "pending").length;
	const stopped = l.entries.filter((e) => e.status === "stopped").length;
	if (cleaned) parts.push(`已统一改写 ${String(cleaned)} 章`);
	if (pending) parts.push(`待处理 ${String(pending)} 章`);
	if (stopped) parts.push(`未清洗 ${String(stopped)} 章`);
	return parts.join(" · ");
}

/** 渲染整份 Markdown 文档（覆盖写入）：文档头说明＋汇总，随后每章一节 */
export function renderDeaiLedger(l: DeaiLedger): string {
	const parts: string[] = [
		"# AI 味清单（连续编写）",
		"",
		"> 「连续编写」每写完一章只用禁用词表本地检测（不调 LLM），命中就登记在这里；全部章节写完后统一打回重写并回填状态。",
		"> 单章命令（创作本章 / 继续写作 / 重写本章）仍是写完立即清洗，不写本文件。",
		"> 本文件由插件覆盖写入；手工删改仅供自己看，下一轮连续编写会重写。",
		"",
		`- 生成时间：${l.generatedAt}`,
		`- 本轮范围：${l.scopeLabel} · 写入 ${String(l.writtenChapters)} 章`,
		`- ${ledgerCounts(l)}`,
	];
	if (!l.entries.length) {
		parts.push("", "本轮没有检测到 AI 常用词。");
		return `${parts.join("\n")}\n`;
	}
	for (const e of l.entries) {
		parts.push("", `## ${STATUS_LABEL[e.status]} · ${e.label}（命中 ${String(e.hits)} 处）`);
		parts.push("", `<!-- aw-deai-key:${e.chKey} -->`); // 机器可读章节键：「补做去AI味」命令据此回读正文（label 只给人看）
		if (e.note) parts.push("", `结果：${e.note}`);
		if (e.words.length) parts.push("", `词：${e.words.join("、")}`);
		if (e.sentences.length) {
			parts.push("", "句：");
			for (const s of e.sentences.slice(0, MAX_SENTENCES_PER_ENTRY)) parts.push(`- ${s.replace(/\s+/g, " ").trim()}`);
			const rest = e.sentences.length - MAX_SENTENCES_PER_ENTRY;
			if (rest > 0) parts.push(`- …另有 ${String(rest)} 条`);
		}
	}
	return `${parts.join("\n")}\n`;
}

/** 每节标题下的机器可读键行前缀（渲染/解析共用） */
const KEY_LINE_PREFIX = "<!-- aw-deai-key:";

const ICON_TO_STATUS: Record<string, DeaiEntryStatus> = { "⏳": "pending", "✓": "cleaned", "✋": "stopped" };

/**
 * 解析《AI味清单.md》（「补做去AI味」命令的回读入口，v0.4.3+）：按 `renderDeaiLedger` 的格式回收每章的
 * chKey/label/hits/status/命中词/命中句/结果注记。状态映射 ⏳→pending、✋→stopped、✓→cleaned——前两者都是「还没清洗」，
 * 补做命令都要处理。旧版文档没有 `<!-- aw-deai-key:… -->` 行时 chKey 返回 ""，由调用方按 label 反查章节键。
 * 句列表按渲染上限只回读到前 `MAX_SENTENCES_PER_ENTRY` 条（清洗时按正文重新检测，不依赖这里）。
 * 不是本插件生成的文档（无 H1 标题）→ null。
 */
export function parseDeaiLedgerDoc(md: string): DeaiLedger | null {
	if (!/^#\s*AI\s*味清单/m.test(md)) return null;
	const lines = md.split(/\r?\n/);
	const l: DeaiLedger = { generatedAt: "", scopeLabel: "", writtenChapters: 0, entries: [] };
	for (const line of lines) {
		const gen = /^-\s*生成时间：(.*)$/.exec(line);
		if (gen) { l.generatedAt = gen[1].trim(); continue; }
		const scope = /^-\s*本轮范围：(.*?)·\s*写入\s*(\d+)\s*章/.exec(line);
		if (scope) { l.scopeLabel = scope[1].trim(); l.writtenChapters = Number(scope[2]) || 0; }
	}
	let cur: DeaiLedgerEntry | null = null;
	let inSentences = false;
	for (const raw of lines) {
		const line = raw.trimEnd();
		const head = /^##\s*(⏳|✓|✋)\s*(?:待统一改写|已统一改写|未清洗)\s*·\s*(.+?)（命中\s*(\d+)\s*处）\s*$/.exec(line.trim());
		if (head) {
			if (cur) l.entries.push(cur);
			cur = { chKey: "", label: head[2].trim(), hits: Number(head[3]) || 0, words: [], sentences: [], status: ICON_TO_STATUS[head[1]] ?? "pending" };
			inSentences = false;
			continue;
		}
		if (!cur) continue;
		if (line.startsWith(KEY_LINE_PREFIX)) {
			cur.chKey = line.slice(KEY_LINE_PREFIX.length).replace(/-->.*$/, "").trim();
			inSentences = false;
			continue;
		}
		const note = /^结果：(.*)$/.exec(line.trim());
		if (note) { cur.note = note[1].trim(); inSentences = false; continue; }
		const words = /^词：(.*)$/.exec(line.trim());
		if (words) { cur.words = words[1].split("、").map((w) => w.trim()).filter(Boolean); inSentences = false; continue; }
		if (line.trim() === "句：") { inSentences = true; continue; }
		if (inSentences) {
			const s = /^-\s*(.+)$/.exec(line.trim());
			if (!s) { inSentences = false; continue; }
			if (/^…另有\s*\d+\s*条$/.test(s[1].trim())) continue;
			cur.sentences.push(s[1].trim());
		}
	}
	if (cur) l.entries.push(cur);
	return l;
}
