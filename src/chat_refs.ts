/**
 * LLM 对话「自然语言自动引用」（v0.4.6+）：纯模块——从用户输入文本中识别对章节/卷/内置文档的自然提及，
 * 产出结构化 AutoRefSpec 清单；main.ts 据此读盘装配内容块注入本轮上下文。
 * 识别规则（无需「加载/看/评价」等动词，直接提及即触发）：
 *  - `第N章`/`第A到B章`（阿拉伯与中文数字混合皆可；范围自动展开、上限 MAX_CHAPTER_REFS 章）
 *  - `第N卷`（→该卷《卷大纲.md》）
 *  - `《标题》` 与「章节标题原文出现在句子里」（两者都按章标题模糊解析，解不到章再试内置文档名/同名文档）
 *  - 关键词：故事状态/策划指南/人物关系/时间线/世界观/全书大纲/大纲 →对应内置文档
 * 手动 @ 引用 token 先掩掉，避免同一文件既手引又自动加载。
 */

import { cnToNum } from "./md_docs";

export type AutoRefKind = "chapter" | "volume" | "title" | "doc";

export interface AutoRefSpec {
	kind: AutoRefKind;
	/** chapter：章号列表（范围已展开）；volume：单个卷号；其余为空 */
	nums: number[];
	/** doc：内置文档 key（见 DOC_KEYWORDS） */
	docKey?: string;
	/** title：《X》或章节标题文本（由 main.ts 解析成章/文档） */
	title?: string;
	/** 状态行与气泡「自动加载：…」清单用的短标签 */
	label: string;
}

/** 范围展开与本轮章加载总量上限（防「第1到200章」炸上下文） */
export const MAX_CHAPTER_REFS = 10;

/** 关键词 → 内置文档 key：按「长词优先」排列（人物关系 先于裸人物类；全书大纲 先于 大纲），同一 key 只取先命中的长词 */
export const DOC_KEYWORDS: Array<[string, string]> = [
	["故事状态", "story_state"],
	["策划指南", "planning_guide"],
	["人物关系", "book_relations"],
	["时间线", "timeline"],
	["世界观", "worldview"],
	["全书大纲", "book_outline"],
	["大纲", "book_outline"],
];

const NUM = "[0-9零一二两三四五六七八九十百千〇]+";

/** 掩掉手动 @ 引用 token（`@[[..]]` 与裸 `@路径`），替换为等长空格保持其余文本位置不变 */
export function maskManualRefs(text: string): string {
	return text.replace(/@\[\[[^\]]*\]\][^\s]*/g, (m) => " ".repeat(m.length)).replace(/@[^\s]+/g, (m) => " ".repeat(m.length));
}

/** 从（原始）输入文本提取自动引用清单；chapterTitles＝当前书全部章标题（标题包含匹配用，短于 2 字的忽略） */
export function detectChatAutoRefs(raw: string, chapterTitles: string[]): AutoRefSpec[] {
	const text = maskManualRefs(raw);
	const specs: AutoRefSpec[] = [];
	const consumed: Array<[number, number]> = [];
	const overlaps = (s: number, e: number) => consumed.some(([a, b]) => s < b && a < e);
	const eat = (s: number, e: number) => consumed.push([s, e]);

	// ① 章范围（先行吃掉 span，单章匹配不再重复命中）：第1到3章 / 第一章到第三章 / 第1章至第3章
	const rangeRe = new RegExp(`第(${NUM})[章回]?[到至][第]?(${NUM})[章回]`, "g");
	for (let m: RegExpExecArray | null; (m = rangeRe.exec(text)); ) {
		const a = cnToNum(m[1]);
		const b = cnToNum(m[2]);
		if (a == null || b == null) continue;
		const lo = Math.min(a, b);
		const hi0 = Math.max(a, b);
		const hi = Math.min(hi0, lo + MAX_CHAPTER_REFS - 1);
		const nums: number[] = [];
		for (let n = lo; n <= hi; n++) nums.push(n);
		eat(m.index, m.index + m[0].length);
		specs.push({ kind: "chapter", nums, label: lo === hi0 ? `第${String(lo)}章` : `第${String(lo)}–${String(hi)}章${hi < hi0 ? "（截前10章）" : ""}` });
	}

	// ② 单章：第N章（中文/阿拉伯数字）；已在范围 span 内或已见过的章号跳过
	const seenNums = new Set<number>();
	let chapterTotal = 0;
	const oneRe = new RegExp(`第(${NUM})[章回]`, "g");
	for (let m: RegExpExecArray | null; (m = oneRe.exec(text)); ) {
		if (overlaps(m.index, m.index + m[0].length)) continue;
		const n = cnToNum(m[1]);
		if (n == null || n <= 0 || seenNums.has(n) || chapterTotal >= MAX_CHAPTER_REFS) continue;
		eat(m.index, m.index + m[0].length);
		seenNums.add(n);
		chapterTotal++;
		specs.push({ kind: "chapter", nums: [n], label: `第${String(n)}章` });
	}

	// ③ 卷：第N卷 → 该卷《卷大纲.md》
	const volRe = new RegExp(`第(${NUM})卷`, "g");
	const seenVols = new Set<number>();
	for (let m: RegExpExecArray | null; (m = volRe.exec(text)); ) {
		if (overlaps(m.index, m.index + m[0].length)) continue;
		const n = cnToNum(m[1]);
		if (n == null || n <= 0 || seenVols.has(n)) continue;
		eat(m.index, m.index + m[0].length);
		seenVols.add(n);
		specs.push({ kind: "volume", nums: [n], label: `第${String(n)}卷大纲` });
	}

	// ④ 《标题》：章标题/内置文档/同名文档解析交给 main.ts
	const seenTitles = new Set<string>();
	const bookRe = /《([^》\n]{1,40})》/g;
	for (let m: RegExpExecArray | null; (m = bookRe.exec(text)); ) {
		const t = m[1].trim();
		if (!t || seenTitles.has(t)) continue;
		eat(m.index, m.index + m[0].length);
		seenTitles.add(t);
		specs.push({ kind: "title", nums: [], title: t, label: `《${t}》` });
	}

	// ⑤ 章节标题直接出现在句子里（如「评价雨夜刺杀写得怎么样」）：取最长命中标题，跳过与其它 span 重叠的短标题
	const hits = chapterTitles
		.filter((t) => t.length >= 2 && text.includes(t))
		.sort((a, b) => b.length - a.length);
	for (const t of hits) {
		if (seenTitles.has(t)) continue;
		const idx = text.indexOf(t);
		if (overlaps(idx, idx + t.length)) continue;
		eat(idx, idx + t.length);
		seenTitles.add(t);
		specs.push({ kind: "title", nums: [], title: t, label: `章节《${t}》` });
		if (seenTitles.size >= 5) break;
	}

	// ⑥ 关键词 → 内置文档（长词优先、同 key 去重）
	const seenDoc = new Set<string>();
	for (const [kw, key] of DOC_KEYWORDS) {
		if (seenDoc.has(key)) continue;
		const idx = text.indexOf(kw);
		if (idx < 0) continue;
		specs.push({ kind: "doc", nums: [], docKey: key, label: `【${kw}】` });
		seenDoc.add(key);
	}
	return specs;
}
