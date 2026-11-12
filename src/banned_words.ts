// 移植自 Python 版 story_types.py：禁用词清单解析（事实源＝<work_dir>/SKILLS/网文高频禁用词清单.md，v0.3.6+ Skill 化；
// 由 parseBannedWordsMd 解析为 BannedWordsData）、否定对比/重复强调句式简化、
// AI 常用词检测与标红。
// 纯函数层，不接触 Vault / LLM。（正则不用 lookbehind 断言——iOS Safari <16.4 不支持、会直接抛 SyntaxError；前置否定改用「(?:^|[^X])」前缀字符替代，替换规则中经 $N 回补该字符）

// ===== 禁用词数据（事实源＝SKILLS 技能文件；解析与检测在此，提示词注入走技能块、不再有专用注入函数——v0.3.6+ 已删 buildBannedWordsBlock/buildMergedBannedBlock）=====

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
 * 解析禁用词清单 Markdown（现读 SKILLS/网文高频禁用词清单.md，旧 BANNED_WORDS.md 同格式）内容为 BannedWordsData。
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


