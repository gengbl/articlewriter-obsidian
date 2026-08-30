// 移植自 Python 版 story_types.py：网文高频禁用词表、AI腔变体规则、
// 否定对比/重复强调句式简化、AI 常用词检测与标红、写作指南分类解析合并。
// 纯函数层，不接触 Vault / LLM。（正则不用 lookbehind 断言——iOS Safari <16.4 不支持、会直接抛 SyntaxError；前置否定改用「(?:^|[^X])」前缀字符替代，替换规则中经 $N 回补该字符）

// ===== 网文高频禁用词表（按类别分组）=====
// 每项为 [禁用词, 说明/替代建议]
export const WEB_NOVEL_BANNED_WORDS: Record<string, Array<[string, string]>> = {
	套话副词: [
		["只见", "高频AI开场词，直接写动作/画面"],
		["不由得", "AI万能过渡，直接写反应"],
		["心中暗道", "心理描写套话，用具体念头替代"],
		["暗暗吃惊", "情绪套话，用动作/细节表现吃惊"],
		["心中一凛", "烂大街的警觉套话"],
		["不禁", "AI高频，能删则删"],
		["猛地", "动作副词滥用，换具体动词"],
		["瞬间", "万能时间词，换成具体过程"],
		["顿时", "AI高频过渡词"],
		["仿佛", "比喻句高频引导词，能直说就直说"],
		["似乎", "含糊词，少用"],
		["好像", "含糊词，少用"],
	],
	情绪模板词: [
		["眼眸中闪过一丝", "AI式情绪描写模板"],
		["眼中闪过一丝", "同上，重复桥段"],
		["嘴角勾起一抹", "AI高频表情模板"],
		["嘴角上扬", "过度使用的表情描写"],
		["瞳孔猛地一缩", "AI高频震惊模板"],
		["倒吸一口凉气", "烂大街的震惊动作"],
		["心头一震", "AI高频情绪词"],
		["心头一紧", "同上"],
		["一股暖流", "感动/情绪模板词"],
		["骨子里", "AI高频性格/气质套话，用具体言行替代"],
	],
	"特效/设定词": [
		["紫红色电蛇", "色彩+名词+动作固定搭配泛滥"],
		["金光化作", "特效模板"],
		["灵光一闪", "仙侠AI高频"],
		["金光闪闪", "特效堆砌"],
		["流光溢彩", "华丽堆砌"],
		["仙气飘飘", "仙侠AI高频"],
		["灵力涌动", "仙侠设定套话"],
		["神识一扫", "仙侠AI高频动作"],
		["元婴期", "网文等级套话（除非剧情需要）"],
		["斗气", "玄幻等级套话（除非剧情需要）"],
		["法宝", "仙侠物品套话（除非剧情需要）"],
	],
	AI腔句式: [
		["综上所述", "过度总结"],
		["总之", "过度总结"],
		["由此可见", "过度总结"],
		["众所周知", "AI论证腔"],
		["值得一提的是", "AI过渡腔"],
		["不难发现", "AI论证腔"],
	],
};

// 禁用词表对应的写作指南章节标题（与 WRITING_GUIDE.md 保持一致）
export const BANNED_WORDS_GUIDE_SECTION = "网文高频禁用词";

// ===== 网文高频AI腔变体规则（子串/组合匹配，拦截精确词表之外的绕开写法）=====
// 每项为 { re, word }。命中即视为禁用，用于检测"眸光一凝""化作""腥甜"等
// 绕开精确词表的变体。
export interface BannedPattern {
	re: RegExp;
	word: string;
}

// 「也」及其否定组合（用 \u 转义拼接构造，避免长字面量笔误）：
//   YE_MEI    = 「也」+「没」（两段式 lookahead 排除项）
//   YE_MEIYOU = 「也」+「没有」（三段式否定中间段）
const Y = "\u4e5f"; // 也
export const YE_MEI = Y + "\u6ca1"; // 也没
export const YE_MEIYOU = Y + "\u6ca1\u6709"; // 也没有
export const YE_BU_SHI = Y + "\u4e0d\u662f"; // 「也」+「不」+「是」（三段式否定中间段）

const P = (re: RegExp, word: string): BannedPattern => ({ re, word });

// 两段式否定转折公共前缀：(?:^|[^也])没(?:有)? + lookahead 排除三段式开头「也没…」
// （不用 lookbehind——iOS Safari <16.4 不支持；前置字符被消耗进匹配，检测用途可接受）
// （用字符串拼接构造，避免长正则字面量）
const NO_TWO_PREFIX = "(?:^|[^也])没(?:有)?(?:(?!";
const NO_TWO_MID = ")[^。！？\\n]){0,16}?[，,；;、]?";
const RE_NO_JIZHI = new RegExp(NO_TWO_PREFIX + "也没" + NO_TWO_MID + "只是");
const RE_NO_ERSHI = new RegExp(NO_TWO_PREFIX + "也没" + NO_TWO_MID + "而是");

export const WEB_NOVEL_BANNED_PATTERNS: BannedPattern[] = [
	// 情绪模板变体
	P(/眸光.{0,4}(?:一凝|一凛|微凝|沉)/, "眸光一凝/微凝"),
	P(/目光.{0,4}(?:一凝|一凛)/, "目光一凝"),
	P(/(?:眼中|眼底).{0,4}(?:闪过一丝|掠过一丝|划过)/, "眼中闪过一丝"),
	P(/嘴角.{0,4}(?:勾起|扬起|扯起).{0,4}(?:一抹|一丝|弧度)/, "嘴角勾起一抹"),
	P(/瞳孔.{0,4}(?:一缩|骤缩|紧缩|放大)/, "瞳孔一缩"),
	P(/倒吸.{0,4}(?:一口)?凉气/, "倒吸一口凉气"),
	P(/心头.{0,4}(?:一震|一颤|一紧|微颤)/, "心头一震"),
	P(/(?:一股|一丝).{0,4}(?:暖流|寒意|凉意)/, "一股暖流/寒意"),
	P(/骨子里.{0,4}(?:透着|透出|带着|藏着|渗着)/, "骨子里透着"),
	// 特效/动作变体
	P(/化作/, "化作"),
	P(/(?:金光|银光|紫光).{0,4}(?:一闪|乍现|大盛|流转)/, "金光一闪"),
	P(/灵光.{0,4}一闪/, "灵光一闪"),
	P(/(?:神识|神念).{0,4}(?:一扫|一动|锁定)/, "神识一扫"),
	P(/流光.{0,4}(?:溢彩|闪烁)/, "流光溢彩"),
	P(/仙气.{0,4}(?:飘飘|缭绕|弥漫)/, "仙气飘飘"),
	P(/灵力.{0,4}(?:涌动|奔涌|激荡)/, "灵力涌动"),
	P(/腥甜.{0,4}(?:翻涌|上涌|涌上)/, "喉间腥甜"),
	P(/(?:喉间|喉咙).{0,4}(?:腥甜|一甜)/, "喉间腥甜"),
	P(/(?:眼前|视线).{0,4}(?:一黑|发黑|模糊)/, "眼前一黑"),
	P(/磅礴.{0,4}(?:气势|灵力|威压)/, "磅礴气势/威压"),
	P(/威压.{0,4}(?:扑面|笼罩|碾来)/, "威压扑面"),
	// 「死死…」动作套话（盯着/咬住/攥住等）
	P(
		new RegExp("死死(?!活)[^。！？\\n]{0,4}?(?:盯|咬|抓|拽|攥|抱|搂|捂|按|捏|握|掐|勒|锁|揪|缠|压|拖|扯|扒|抠|摁|箍|钳|卡)"),
		"死死盯着",
	),
	// 套话副词变体
	P(/(?:只|却)见/, "只见/却见"),
	P(/不由得|不自觉地/, "不由得"),
	P(/心中.{0,3}(?:暗道|暗想|默念)/, "心中暗道"),
	P(/暗暗.{0,3}(?:吃惊|心惊|咬牙|发狠)/, "暗暗吃惊"),
	P(/不禁.{0,2}(?:心头|想起|倒吸)/, "不禁"),
	// AI腔句式变体
	P(/总而言之|综上/, "总而言之/综上"),
	P(/众所周知|不言而喻/, "众所周知/不言而喻"),
	P(/值得一提/, "值得一提"),
	P(/不难发现|显而易见/, "不难发现/显而易见"),
	// 三段式否定对比句式变体（AI 腔排比式否定强调）
	P(
		new RegExp("没有[^。！？\\n]{0,16}?也没有[^。！？\\n]{0,16}?(?:就是|只是|就像)"),
		"没有…也没有…就是/只是/就像",
	),
	P(
		new RegExp("(?:^|[^要可])不是[^。！？\\n]{0,16}?也不是[^。！？\\n]{0,16}?(?:而)?是"),
		"不是…也不是…而是/是",
	),
	// 两段式否定转折变体：没/没有A，只是B / 而是B（AI 腔否定转折）
	// (?:^|[^也]) 避免从「也没有」内部的「没有」开始误匹配三段式（前缀字符被消耗进匹配，仅检测用途）；
	// lookahead (?!也没…) 排除后接「也没」的三段式开头
	P(RE_NO_JIZHI, "没/没有…，只是…"),
	P(RE_NO_ERSHI, "没/没有…，而是…"),
	// 拖延式写法变体：久久没有X（AI 腔拖延感）
	P(/久久(?:地)?没有[^。！？\n]{0,6}/, "久久没有…"),
	// 重复强调句式变体（那种X，…的X / 那种X，X的…，AI 腔排比式强调）
	P(/那种[^，。！？\n]{0,10}?([^，。！？\n]{1,6}?)[，,][^。！？\n]{0,12}?的\1/, "那种…，…的…（重复强调）"),
	P(/那种[^，。！？\n]{0,10}?([^，。！？\n]{2,4}?)[，,]\1的/, "那种…，…的…（重复强调）"),
	// 转折对比句式变体（AI 腔论证式对比）
	P(/不是.{0,16}?而是/, "不是…而是…"),
	P(/并非.{0,16}?而是/, "并非…而是…"),
	P(/不是.{0,16}?反而/, "不是…反而…"),
	// 「不是…是…」：尾段须以「分隔符」或「非是非而字」收尾（替代 (?<!而) lookbehind）
	P(/(?:^|[^要可])不是(?:[^是]{0,16}?[，,；;、]|[^是]{0,15}[^是而])是/, "不是…是…"),
	// 「不像…像…」：同理替代 (?<!倒) lookbehind
	P(/不像(?:[^像]{0,16}?[，,；;、]|[^像]{0,15}[^像倒])像/, "不像…像…"),
	P(/不像[^像]{0,16}?[，,；;、]?(?:反?倒)像/, "不像…倒像…"),
	// 越是…越…式平行强调句式（AI 腔排比强调）
	P(/越是.{0,16}?越(?:是)?/, "越是…越…"),
];

/** 生成禁用词提示块（注入网文类型模板） */
export function buildBannedWordsBlock(): string {
	const lines = ["【网文高频禁用词（必须遵守）】", "以下词汇/句式属于高频AI腔，生成正文时**禁止使用**："];
	for (const [group, words] of Object.entries(WEB_NOVEL_BANNED_WORDS)) {
		lines.push(`\n${group}：`);
		lines.push(words.map(([w]) => `「${w}」`).join("、"));
	}
	lines.push("\n\n同时警惕以下AI腔变体（出现同样不合格）：");
	lines.push(WEB_NOVEL_BANNED_PATTERNS.map((p) => `「${p.word}」`).join("、"));
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
export function findAiWordHits(text: string): AiHit[] {
	if (!text) return [];
	const hits: AiHit[] = [];
	for (const group of Object.values(WEB_NOVEL_BANNED_WORDS)) {
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
	for (const pat of WEB_NOVEL_BANNED_PATTERNS) {
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
export function findAiSentences(text: string): AiSentence[] {
	if (!text) return [];
	const results: AiSentence[] = [];
	let lineStart = 0;
	for (const line of text.split("\n")) {
		if (line.trimStart().startsWith("#")) {
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
				const hits = findAiWordHits(chunk);
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

// ===== AI 用语标红标记（写入 MD 文件用）=====
export const AI_WORD_MARK_OPEN = '<span style="color:red">';
export const AI_WORD_MARK_CLOSE = "</span>";

/**
 * 把文本中命中的 AI 常用词用红色 span 包裹（写入 MD 文件时调用）。
 * 重叠/相邻命中合并为一个 span，避免产生嵌套标签。
 */
export function markAiWordsHtml(text: string): string {
	if (!text) return text;
	const hits = findAiWordHits(text);
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
const HTML_COMMENT_RE = () => /<!--.*?-->/g;
const BANNED_TOKEN_RE = () => /[「`]([^」`]+)[»`]/g;

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

/**
 * 合并多层写作指南（layers 顺序即优先级：故事层 > 用户层）。
 * - 通用：跨层逐行去重合并
 * - 故事风格 / 个人特色：高优先级层有内容则采用，跳过其余层（避免风格冲突与重复）
 * - 禁用词：跨层逐行去重合并（词级去重在 buildMergedBannedBlock 中再完成）
 */
export function mergeGuideCategories(layers: string[]): Record<string, string> {
	const merged: Record<string, string | string[]> = { 通用: [], "故事风格": "", "个人特色": "", "禁用词": [] };
	const seen = new Set<string>();
	for (const layer of layers) {
		const cats = extractGuideCategories(layer);
		for (const line of (cats["通用"] || "").split("\n")) {
			const key = line.trim();
			if (!key || seen.has(key)) continue;
			seen.add(key);
			(merged["通用"] as string[]).push(line);
		}
		for (const name of ["故事风格", "个人特色"]) {
			if (!(merged[name] as string) && (cats[name] || "").trim()) {
				merged[name] = cats[name].trim();
			}
		}
		for (const line of (cats["禁用词"] || "").split("\n")) {
			const key = line.trim();
			if (key && !seen.has(key)) {
				seen.add(key);
				(merged["禁用词"] as string[]).push(line);
			}
		}
	}
	return {
		"通用": ((merged["通用"] as string[]) ?? []).join("\n").trim(),
		"故事风格": merged["故事风格"] as string,
		"个人特色": merged["个人特色"] as string,
		"禁用词": ((merged["禁用词"] as string[]) ?? []).join("\n").trim(),
	};
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
 * 生成唯一的禁用词提示块：代码内置表（buildBannedWordsBlock）+ 各层指南
 * "禁用词"分类中的补充内容；指南中与代码表完全重复的纯词列表行跳过（防重复），
 * 保留说明文字（即使其中提到代码表已有的词）与代码表没有的补充词。
 */
export function buildMergedBannedBlock(guideBannedText = ""): string {
	const codeBlock = buildBannedWordsBlock();
	const guide = (guideBannedText || "").trim();
	if (!guide) return codeBlock;
	const codeTokens = new Set(extractBannedTokens(codeBlock));
	const keepLines: string[] = [];
	for (const rawLine of guide.split("\n")) {
		const stripped = rawLine.trim();
		if (!stripped) continue;
		const lineTokens = extractBannedTokens(stripped);
		if (lineTokens.length >= 2 && lineTokens.every((t) => codeTokens.has(t))) {
			// 纯列表行（去掉词后几乎无其他汉字）→ 跳过；说明性句子（含汉字较多）→ 保留
			const tokenCn = lineTokens.reduce((s, t) => s + countCnChars(t), 0);
			const totalCn = countCnChars(stripped);
			if (totalCn && tokenCn / totalCn >= 0.5) continue;
		}
		keepLines.push(stripped);
	}
	if (!keepLines.length) return codeBlock;
	return codeBlock + "\n\n【指南补充：去AI腔规则】\n" + keepLines.join("\n");
}


