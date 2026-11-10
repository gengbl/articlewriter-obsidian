// 移植自 Python 版 story_types.py：禁用词清单解析（运行时唯一来源＝插件数据目录 BANNED_WORDS.md，
// 由 parseBannedWordsMd 解析为 BannedWordsData）、否定对比/重复强调句式简化、
// AI 常用词检测与标红、写作指南分类解析合并。
// 纯函数层，不接触 Vault / LLM。（正则不用 lookbehind 断言——iOS Safari <16.4 不支持、会直接抛 SyntaxError；前置否定改用「(?:^|[^X])」前缀字符替代，替换规则中经 $N 回补该字符）

// ===== 禁用词数据（运行时唯一来源＝插件数据目录 BANNED_WORDS.md；内置词仅在文件缺失时作播种内容参考）=====

/** 变体正则条目：re=匹配正则（禁用 lookbehind 断言——iOS Safari <16.4 不支持），word=展示词（高亮/报告用） */
export interface BannedPattern {
	re: RegExp;
	word: string;
}

/** 解析后的禁用词数据：词组（组名 → [词, 说明]）＋ 变体正则列表 */
export interface BannedWordsData {
	words: Record<string, Array<[string, string]>>;
	patterns: BannedPattern[];
}

/** 变体正则节的固定标题名（解析器将其与词组节区别对待） */
const BANNED_PATTERN_SECTION = "变体正则";
const BANNED_WORD_LINE_RE = /^-\s*「([^」]+)」\s*[:：]\s*(.+?)\s*$/; // 词组条目：- 「词」：说明
const BANNED_PATTERN_LINE_RE = /^-\s*`([^`]+)`\s*(?:→|->)\s*(.+?)\s*$/; // 变体正则条目：- `正则源` → 展示词

/**
 * 解析 BANNED_WORDS.md 内容为 BannedWordsData。
 * 格式：`## 组名` 标题 + `- 「词」：说明` 条目；固定标题 `## 变体正则` 下为 `` - `正则源` → 展示词 `` 条目。
 * 空行/注释行/不符合格式的行忽略；无效正则按行跳过（console.warn），不影响其他条目。
 */
export function parseBannedWordsMd(md: string): BannedWordsData {
	const words: Record<string, Array<[string, string]>> = {};
	const patterns: BannedPattern[] = [];
	let group: string | null = null;
	for (const rawLine of (md || "").split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const h = /^##\s+(.+?)\s*$/.exec(line);
		if (h) {
			group = h[1];
			if (group !== BANNED_PATTERN_SECTION && !words[group]) words[group] = [];
			continue;
		}
		if (group === null) continue; // 首个组标题之前的内容忽略
		if (group === BANNED_PATTERN_SECTION) {
			const pm = BANNED_PATTERN_LINE_RE.exec(line);
			if (!pm) continue;
			try {
				patterns.push({ re: new RegExp(pm[1]), word: pm[2] });
			} catch (e) {
				console.warn("[ArticleWriter] 跳过无效禁用词变体正则:", pm[1], e);
			}
			continue;
		}
		const wm = BANNED_WORD_LINE_RE.exec(line);
		if (!wm) continue;
		words[group].push([wm[1], wm[2]]);
	}
	return { words, patterns };
}

// 「也」及其否定组合（用 \u 转义拼接构造，避免长字面量笔误）：
//   YE_MEI    = 「也」+「没」（两段式 lookahead 排除项）
//   YE_MEIYOU = 「也」+「没有」（三段式否定中间段）
const Y = "\u4e5f"; // 也
export const YE_MEI = Y + "\u6ca1"; // 也没
export const YE_MEIYOU = Y + "\u6ca1\u6709"; // 也没有
export const YE_BU_SHI = Y + "\u4e0d\u662f"; // 「也」+「不」+「是」（三段式否定中间段）

/** 生成禁用词提示块（注入网文类型模板）；数据为空（无词且无变体）时返回空串 */
export function buildBannedWordsBlock(data: BannedWordsData): string {
	const totalWords = Object.values(data.words).reduce((s, g) => s + g.length, 0);
	if (!totalWords && !data.patterns.length) return "";
	const lines = ["【网文高频禁用词（必须遵守）】", "以下词汇/句式属于高频AI腔，生成正文时**禁止使用**："];
	const shown = new Set<string>(); // 组内已列出的精确词——变体表中再出现同一字符串即跳过（纯展示层去重，不影响检测）
	for (const [group, words] of Object.entries(data.words)) {
		lines.push(`\n${group}：`);
		lines.push(words.map(([w]) => `「${w}」`).join("、"));
		for (const [w] of words) shown.add(w);
	}
	const variants = data.patterns.map((p) => p.word).filter((w, i, arr) => !shown.has(w) && arr.indexOf(w) === i);
	if (variants.length) {
		lines.push("\n\n同时警惕以下AI腔变体（出现同样不合格）：");
		lines.push(variants.map((w) => `「${w}」`).join("、"));
	}
	lines.push(
		"\n要求：如出现以上任一词汇/句式或其变体，即为不合格；用具体动作、细节或大白话替代。"
	);
	return lines.join("\n");
}

// ===== 否定对比句式简化 =====
// 不是X，是Y → 是Y；不是X，而是Y → 是Y；不是X，也没Y，而是Z → 是Z
// 不像X，像Y → 像Y；不像X，倒像Y → 倒像Y
// 没有X，也没有Y，就是/只是/就像Z → 就是/只是/就像Z（「也」字用 YE_MEIYOU 拼接）
// 删掉否定列举部分，只保留肯定内容，比整句打回重写更简洁可靠。
const SEP = "[，,；;、]?"; // 可选分隔符
const NEGATION_CONTRAST_RULES: Array<{ re: () => RegExp; repl: string }> = [
	// 三段式：不是A，也没B，而是/是C → 是C（先于二段式规则，整段一次吞掉）
	// (^|([^要可])) 前缀捕获组替代 lookbehind：边界字符被消耗进匹配，替换串 "$1是" 回补该字符（行首时 $1 为空）
	{ re: () => new RegExp("(^|([^要可]))不是([^。！？\\n]{1,24}?)" + SEP + YE_BU_SHI + "([^。！？\\n]{1,24}?)" + SEP + "(?:而)?是", "g"), repl: "$1是" },
	// 三段式：没有A，也有B，就是/只是/就像C → 就是/只是/就像C
	{ re: () => new RegExp("没有([^。！？\\n]{1,24}?)" + SEP + YE_MEIYOU + "([^。！？\\n]{1,24}?)" + SEP + "就是", "g"), repl: "就是" },
	{ re: () => new RegExp("没有([^。！？\\n]{1,24}?)" + SEP + YE_MEIYOU + "([^。！？\\n]{1,24}?)" + SEP + "只是", "g"), repl: "只是" },
	{ re: () => new RegExp("没有([^。！？\\n]{1,24}?)" + SEP + YE_MEIYOU + "([^。！？\\n]{1,24}?)" + SEP + "就像", "g"), repl: "就像" },
	// 二段式：不像A，倒像B → 倒像B；不像A，像B → 像B
	{ re: () => /不像([^像]{1,16}?)[，,；;、]?(?:反?倒)像/g, repl: "倒像" },
	// 尾段以「分隔符」或「非像非倒字」收尾（替代 (?<!倒) lookbehind）
	{ re: () => /不像(?:[^像]{1,16}?[，,；;、]|[^像]{0,15}[^像倒])像/g, repl: "像" },
	// 二段式：不是A，而是/是B → 是B（尾段须以非「不」字收尾防误吞「也不是」；前置否定用 (^|([^要可])) 捕获组替代 lookbehind，替换串经 $1 回补边界字符）
	{ re: () => /(^|([^要可]))不是(?:[^是]{1,16}?[，,；;、]|[^是]{0,15}[^是不])是/g, repl: "$1是" },
];

/**
 * 把否定对比句式简化为肯定形式（确定性替换，不依赖 LLM）：
 *   不是A，是B → 是B；不是A，而是B → 是B
 *   不像A，像B → 像B；不像A，倒像B → 倒像B
 *   不是A，也没B，而是C → 是C
 *   没有A，也有B，就是/只是/就像C → 就是/只是/就像C
 * 返回 [新文本, [(原片段, 新片段), ...]]；无命中时返回 [原文, []]。
 */
export function simplifyNegationContrast(text: string): [string, Array<[string, string]>] {
	if (!text) return [text, []];
	let current = text;
	const pairs: Array<[string, string]> = [];
	for (const rule of NEGATION_CONTRAST_RULES) {
		const re = rule.re();
		re.lastIndex = 0;
		const parts: string[] = [];
		let pos = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(current)) !== null) {
			const hit = m; // 捕获为非空局部量，供替换回调引用（TS 不跨闭包保留 let 的判空收窄）
			const replText = rule.repl.replace(/\$(\d)/g, (_, d) => hit[Number(d)] ?? ""); // $N → 捕获组（用于回补被消耗的前缀边界字符）
			parts.push(current.slice(pos, m.index));
			parts.push(replText);
			pairs.push([m[0].trim(), replText]);
			pos = m.index + m[0].length;
			if (m[0].length === 0) re.lastIndex++; // 防御零长匹配死循环
		}
		parts.push(current.slice(pos));
		current = parts.join("");
	}
	return [current, pairs];
}

// ===== 重复强调句式简化 =====
// 那种X，<修饰>的X → 那种<修饰>的X（删掉逗号前的重复词，合并为一句）
// 仅当重复词紧跟在「那种」后时确定性合并（中间有其它成分的交给 LLM 改写轮），
// 避免「那种说不出的痛，撕心裂肺的痛」这类被错误拼成不通顺的句子。
// 编号捕获组 + \1 反向引用（与全文件「无 lookbehind」规则风格统一）：m[1]=重复词 x1、m[2]=填充 fill
const EMPHATIC_REPETITION_RULE = () => /那种([^，。！？\n]{1,6}?)[，,]([^。！？\n]{0,12}?)的\1/g;

/**
 * 把「那种X，<修饰>的X」重复强调句式合并为「那种<修饰>的X」
 * （确定性替换，不依赖 LLM）：那种痛，撕心裂肺的痛 → 那种撕心裂肺的痛。
 */
export function simplifyEmphaticRepetition(text: string): [string, Array<[string, string]>] {
	if (!text) return [text, []];
	const re = EMPHATIC_REPETITION_RULE();
	re.lastIndex = 0;
	const parts: string[] = [];
	const pairs: Array<[string, string]> = [];
	let pos = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		parts.push(text.slice(pos, m.index));
		const newS = `那种${m[2] ?? ""}的${m[1] ?? ""}`; // m[1]=重复词、m[2]=填充（编号捕获组）
		parts.push(newS);
		pairs.push([m[0].trim(), newS]);
		pos = m.index + m[0].length;
		if (m[0].length === 0) re.lastIndex++;
	}
	if (!pairs.length) return [text, []];
	parts.push(text.slice(pos));
	return [parts.join(""), pairs];
}

// ===== AI 常用词检测（精确词表 + 变体正则双通道）=====

export interface AiHit {
	start: number;
	end: number;
	word: string;
}

/**
 * 检测文本中的 AI 常用词。返回命中列表，按出现位置排序；同一词多处命中会重复返回。
 * 用于生成结果展示时高亮标注，不参与重试判定。
 */
export function findAiWordHits(text: string, data: BannedWordsData): AiHit[] {
	if (!text) return [];
	const hits: AiHit[] = [];
	for (const group of Object.values(data.words)) {
		for (const w of group.map((p) => p[0])) {
			let start = 0;
			while (true) {
				const idx = text.indexOf(w, start);
				if (idx < 0) break;
				hits.push({ start: idx, end: idx + w.length, word: w });
				start = idx + w.length;
			}
		}
	}
	for (const pat of data.patterns) {
		const re = new RegExp(pat.re.source, "g");
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			hits.push({ start: m.index, end: m.index + m[0].length, word: pat.word });
			if (m[0].length === 0) re.lastIndex++;
		}
	}
	hits.sort((a, b) => a.start - b.start || a.end - b.end);
	return hits;
}

// ===== AI 常用词句子级定位（按句末标点切分，行内连续成句）=====
// 句末标点切分用（含可选的右引号/右括号收尾，避免把引号内的感叹句切碎）。
// sticky(y) 对齐 Python pattern.match(line, pos)：只在指定位置锚定尝试。
const SENTENCE_END_RE = () => /[^。！？…!?;；]*[。！？…!?;；]+["'」』]?/y;

export interface AiSentence {
	start: number; // 全文偏移（含换行）
	end: number;
	sentence: string;
	hits: AiHit[]; // chunk 相对偏移
}

/**
 * 检测包含 AI 常用词的句子。返回按位置排序且互不重叠的结果，
 * 跳过以 # 开头的标题行。用于"打回重写"：把命中的句子整句重写后原位替换。
 */
export function findAiSentences(text: string, data: BannedWordsData): AiSentence[] {
	if (!text) return [];
	const results: AiSentence[] = [];
	let lineStart = 0;
	for (const line of text.split("\n")) {
		if (/^\s*#/.test(line)) {
			lineStart += line.length + 1;
			continue;
		}
		let pos = 0;
		while (pos < line.length) {
			const re = SENTENCE_END_RE();
			re.lastIndex = pos;
			const m = re.exec(line);
			const end = m ? m.index + m[0].length : line.length;
			const chunk = line.slice(pos, end);
			if (chunk.trim()) {
				const hits = findAiWordHits(chunk, data);
				if (hits.length) {
					results.push({ start: lineStart + pos, end: lineStart + end, sentence: chunk, hits });
				}
			}
			pos = end;
		}
		lineStart += line.length + 1;
	}
	return results;
}

/** 定位行内包含指定位置的句子边界 [start, end)（按句末标点切分，与 findAiSentences 同口径；pos 越界时钳制到行尾） */
export function sentenceBoundsInLine(line: string, pos: number): { start: number; end: number } {
	let p = 0;
	while (p < line.length) {
		const re = SENTENCE_END_RE();
		re.lastIndex = p;
		const m = re.exec(line);
		const end = m ? m.index + m[0].length : line.length;
		if (pos < end) return { start: p, end };
		p = end;
	}
	return { start: Math.min(pos, line.length), end: line.length };
}

// ===== AI 用语标红标记（写入 MD 文件用）=====
export const AI_WORD_MARK_OPEN = '<span style="color:red">';
export const AI_WORD_MARK_CLOSE = "</span>";

/**
 * 把文本中命中的 AI 常用词用红色 span 包裹（写入 MD 文件时调用）。
 * 重叠/相邻命中合并为一个 span，避免产生嵌套标签。
 */
export function markAiWordsHtml(text: string, data: BannedWordsData): string {
	if (!text) return text;
	const hits = findAiWordHits(text, data);
	if (!hits.length) return text;
	const merged: Array<[number, number]> = [];
	for (const h of hits) {
		if (merged.length && h.start <= merged[merged.length - 1][1]) {
			merged[merged.length - 1] = [merged[merged.length - 1][0], Math.max(h.end, merged[merged.length - 1][1])];
		} else {
			merged.push([h.start, h.end]);
		}
	}
	const parts: string[] = [];
	let prev = 0;
	for (const [start, end] of merged) {
		parts.push(text.slice(prev, start));
		parts.push(AI_WORD_MARK_OPEN + text.slice(start, end) + AI_WORD_MARK_CLOSE);
		prev = end;
	}
	parts.push(text.slice(prev));
	return parts.join("");
}

/** 剥离写入 MD 文件时加的红色标红标签，恢复纯净正文（读回内存时调用） */
export function stripAiWordMarks(text: string): string {
	if (!text) return text;
	return text.split(AI_WORD_MARK_OPEN).join("").split(AI_WORD_MARK_CLOSE).join("");
}

// ===== 写作指南分类（多层指南按分类分开保存、生成时去重合并）=====
// 分类块格式（写在指南文件中，人类可编辑，程序解析时剥离）：
//     <!-- 写作指南分类:禁用词 -->
//     ...内容...
//     <!-- /写作指南分类 -->
// 未包在任何分类块里的内容归入"通用"。
export const GUIDE_CATEGORY_NAMES = ["禁用词", "故事风格", "个人特色"] as const;

const CAT_BLOCK_SOURCE = "<!--\\s*写作指南分类\\s*[:：]\\s*([^>]+?)\\s*-->(.*?)<!--\\s*/?\\s*写作指南分类\\s*-->";
const CAT_TYPE_BLOCK_RE = () => /<!--\s*编写类型\s*[:：].*?<!--\s*\/\s*编写类型\s*-->/gs;
const HTML_COMMENT_RE = () => /<!--[\s\S]*?-->/g; // 必须跨行——汇总文件里 commentOutEmptySections 产出多行注释，单行正则会让 <!-- --> 残行泄漏进正文、round-trip 不幂等
const BANNED_TOKEN_RE = () => /[「`]([^」`]+)[」`]/g; // 闭合类必须含 CJK 直角引号 」——曾误写为 »(U+00BB)，致对代码内置块（「」书写）提取 0 token、buildMergedBannedBlock 纯列表行过滤全程失效

/**
 * v0.2.x+ 指南原文直注入清洗（提示词文件组装路径用）：整块剥离「禁用词」分类块（含标记与内容——
 * 禁用词内容由禁用词块 buildMergedBannedBlock 单独承载，防双份）与「编写类型」块（由【编写类型】块承载），
 * 再剥离其余分类标记行（保留块内内容）与全部 HTML 注释。口径对齐 extractGuideCategories 的剔除规则，
 * 但不做跨层合并去重——三层指南作为独立块按优先级顺序注入，由组装器做块级去重。
 * 注意：必须在组装器 stripComments 之前跑（本函数自带注释剥离），条目应设 stripComments:false。
 */
export function stripGuideCategoryBlock(text: string): string {
	if (!text) return "";
	let t = text.replace(CAT_TYPE_BLOCK_RE(), "");
	const re = new RegExp(CAT_BLOCK_SOURCE, "gs");
	t = t.replace(re, (whole: string, name: string) => ((name || "").trim() === "禁用词" ? "" : whole));
	t = t.replace(/<!--\s*\/?\s*写作指南分类\s*[^>]*-->/g, "");
	return t.replace(HTML_COMMENT_RE(), "").trim();
}

/**
 * 按分类块拆分写作指南，返回 {通用, 禁用词, 故事风格, 个人特色} 的文本。
 * 多个同名分类块内容会拼接；未包裹内容归入"通用"。
 * 编写类型区块（<!-- 编写类型:xxx -->）从分类内容中剔除，只在原始文本中供
 * getStoryTypeGuide 提取，避免与【编写类型】块重复注入。
 * 其余 HTML 注释（人类备注/文档说明）一并剥离，不进入提示词。
 */
export function extractGuideCategories(text: string): Record<string, string> {
	const keys = ["通用", ...GUIDE_CATEGORY_NAMES];
	const buckets: Record<string, string[]> = {};
	for (const k of keys) buckets[k] = [];
	if (text) {
		let t = text.replace(CAT_TYPE_BLOCK_RE(), "");
		const re = new RegExp(CAT_BLOCK_SOURCE, "gs");
		re.lastIndex = 0;
		let pos = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(t)) !== null) {
			buckets["通用"].push(t.slice(pos, m.index));
			const name = (m[1] || "").trim();
			if (name in buckets) buckets[name].push(m[2]);
			else buckets["通用"].push(m[0]);
			pos = m.index + m[0].length;
		}
		buckets["通用"].push(t.slice(pos));
	}
	const result: Record<string, string> = {};
	for (const k of keys) {
		result[k] = buckets[k].join("\n").trim().replace(HTML_COMMENT_RE(), "").trim();
	}
	return result;
}

/** 指南块：level=起始标题级别（0=首个标题前的前言），title=标题文本（去 # 号后 trim），lines=块内全部原始行 */
interface GuideBlock {
	level: number;
	title: string;
	lines: string[];
}

/**
 * 把指南文本拆成块：遇到「级别 ≤ 当前块级别」的标题开新块，更深的子标题留在父块内；
 * 首个标题之前的内容归入前言块 (level 0, title "")。代码围栏（``` / ~~~）内的 # 行不当标题。
 */
function splitGuideBlocks(text: string): GuideBlock[] {
	const blocks: GuideBlock[] = [];
	let cur: GuideBlock | null = null;
	let fence = false;
	for (const line of String(text || "").split("\n")) {
		const t = line.trim();
		if (/^(`{3,}|~{3,})/.test(t)) fence = !fence; // 围栏开关行本身作为普通内容行
		const m = fence ? null : /^(#{1,6})(?:\s|$)/.exec(t);
		if (m && (!cur || m[1].length <= cur.level)) {
			cur = { level: m[1].length, title: t.slice(m[1].length).trim(), lines: [line] };
			blocks.push(cur);
		} else if (cur) {
			cur.lines.push(line);
		} else {
			cur = { level: 0, title: "", lines: [line] };
			blocks.push(cur);
		}
	}
	return blocks;
}

/**
 * 合并多层写作指南（layers 顺序即优先级：故事层 > 用户层 > 系统层）。
 * - 通用 / 禁用词：块级分组合并——按「标题级别 + 标题文本」把各层同名小节归为一节，
 *   节内按优先级依次拼接各行、逐行去重；每类别独立去重集，避免跨类别同名标题误吞
 *   （曾致用户层禁用词骨架标题吞掉系统层通用同名标题、正文失去小节结构）；
 *   节序按优先级首次出现排列。禁用词的词级去重在 buildMergedBannedBlock 中再完成。
 * - 故事风格 / 个人特色：高优先级层有内容则采用，跳过其余层（避免风格冲突与重复）
 * - 「作者身份」小节（标题含此四字）在通用类内置顶：各层小节按优先级首次出现排列，身份块只在
 *   系统层存在时会排到全部书籍/用户层小节之后（曾致其落到【创作规范】中段、用户以为未注入提示词），
 *   按原意图（作者强化信息位于创作规范最前方、每次生成前先生效）把该块抬到通用类最前。
 */
export function mergeGuideCategories(layers: string[]): Record<string, string> {
	const extracted = layers.map((l) => extractGuideCategories(l));
	const merged: Record<string, string> = { 通用: "", "故事风格": "", "个人特色": "", 禁用词: "" };
	for (const cat of ["通用", "禁用词"] as const) {
		const seen = new Set<string>();
		const slots: GuideBlock[] = [];
		const slotIndex = new Map<string, number>();
		for (const cats of extracted) {
			for (const block of splitGuideBlocks(cats[cat] || "")) {
				const key = `${block.level}\u0000${block.title}`;
				let idx = slotIndex.get(key);
				if (idx === undefined) {
					idx = slots.length;
					slotIndex.set(key, idx);
					slots.push({ level: block.level, title: block.title, lines: [] });
				}
				for (const line of block.lines) {
					const k = line.trim();
					if (!k || seen.has(k)) continue;
					seen.add(k);
					slots[idx].lines.push(line);
				}
			}
		}
		const out: string[] = [];
		// 「作者身份」块置顶（保持多个同名块相对顺序）：它通常只在系统层存在，按首现排列会落到最后
		const idIdx: number[] = [];
		for (let i = 0; i < slots.length; i++) if (slots[i].title.includes("作者身份")) idIdx.push(i);
		for (let k = idIdx.length - 1; k >= 0; k--) slots.unshift(slots.splice(idIdx[k], 1)[0]);
		for (const s of slots) out.push(...s.lines);
		merged[cat] = out.join("\n").trim();
	}
	for (const cats of extracted) {
		for (const name of ["故事风格", "个人特色"]) {
			if (!merged[name] && (cats[name] || "").trim()) merged[name] = cats[name].trim();
		}
	}
	return merged;
}

// 禁用词提取：兼容「词」与 `词` 两种书写
function extractBannedTokens(text: string): string[] {
	const tokens: string[] = [];
	const seen = new Set<string>();
	const re = BANNED_TOKEN_RE();
	re.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text || "")) !== null) {
		const w = m[1].trim();
		if (w && !seen.has(w)) {
			seen.add(w);
			tokens.push(w);
		}
	}
	return tokens;
}

const CN_CHAR_RE = () => /[\u4e00-\u9fff]/g;
const countCnChars = (s: string): number => (s.match(CN_CHAR_RE()) || []).length;

/**
 * 生成唯一的禁用词提示块：BANNED_WORDS.md 清单（buildBannedWordsBlock）+ 各层指南
 * "禁用词"分类中的补充内容；指南中与清单完全重复的纯词列表行、以及与清单
 * 同题的标题行（如「## 十、网文高频禁用词清单…」，含书籍级空骨架的同名标题）跳过（防重复），
 * 保留说明文字（即使其中提到清单已有的词）与清单没有的补充词。
 */
export function buildMergedBannedBlock(guideBannedText: string, data: BannedWordsData): string {
	const codeBlock = buildBannedWordsBlock(data);
	const guide = (guideBannedText || "").trim();
	if (!guide) return codeBlock;
	const codeTokens = new Set(extractBannedTokens(codeBlock));
	const keepLines: string[] = [];
	for (const rawLine of guide.split("\n")) {
		const stripped = rawLine.trim();
		if (!stripped) continue;
		// 与清单同题的标题行 → 结构标题而非补充规则 → 跳过（否则会在【指南补充】里再出现一个近同名段）
		if (/^#{1,6}\s/.test(stripped) && stripped.includes("网文高频禁用词")) continue;
		const lineTokens = extractBannedTokens(stripped);
		if (lineTokens.length >= 2 && lineTokens.every((t) => codeTokens.has(t))) {
			// 纯列表行（去掉词后几乎无其他汉字）→ 跳过；说明性句子（含汉字较多）→ 保留
			const tokenCn = lineTokens.reduce((s, t) => s + countCnChars(t), 0);
			const totalCn = countCnChars(stripped);
			if (totalCn && tokenCn / totalCn >= 0.5) continue;
		}
		keepLines.push(stripped);
	}
	const parts: string[] = [];
	if (codeBlock) parts.push(codeBlock);
	if (keepLines.length) parts.push("【指南补充：去AI腔规则】\n" + keepLines.join("\n"));
	return parts.join("\n\n");
}


