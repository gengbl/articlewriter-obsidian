/**
 * v0.4.6+ 敏感词检测纯模块（无 DOM/无 vault，仿 banned_words/typing_stats 范式）。
 * 词表事实源＝SKILLS/敏感词清单.md，解析复用 parseBannedWordsMd（同格式：`## 分类`＋`- 「词」：说明`＋`## 变体正则`节）。
 * 检测＝零 LLM 确定性扫描：逐词 indexOf＋变体正则，命中带分类与行号；正文标色 span 用与错别字下划线/ AI 标红不同的
 * 背景色形状（stripAiWordMarks 同步扩展剥离），落盘/读回往返无损。单测：src/sensitive_words.test.ts。
 */

import type { BannedWordsData } from "./banned_words";

export interface SensitiveHit {
	start: number;
	end: number;
	word: string; // 命中词（变体正则用展示词）
	category: string; // 词表分类名（`## 分类` 标题）
	line: number; // 1-based 行号（正文定位用）
	excerpt: string; // 所在行片段（截断，Notice/报告展示）
}

/** 正文标色 span（与错别字下划线、AI 标红并列的第三种标记；title 带「分类：说明」） */
export const SENSITIVE_SPAN_OPEN = '<span style="background-color:#f2b8b5"';

/** 词表条目说明查找：分类+词 → 说明（变体正则命中取展示词，说明空） */
function descOf(data: BannedWordsData, category: string, word: string): string {
	const g = data.words[category];
	if (!g) return "";
	const hit = g.find((p) => p[0] === word);
	return hit ? hit[1] : "";
}

function excerptAt(text: string, idx: number): { line: number; excerpt: string } {
	const before = text.slice(0, idx);
	const line = before.split("\n").length;
	const lineStart = before.lastIndexOf("\n") + 1;
	const lineEnd = text.indexOf("\n", idx);
	const raw = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).trim();
	const cut = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
	return { line, excerpt: cut };
}

/** 敏感词扫描：literal 词（按分类）＋变体正则节，命中按位置排序；重叠命中全保留（与 findAiWordHits 口径一致） */
export function findSensitiveHits(text: string, data: BannedWordsData): SensitiveHit[] {
	if (!text) return [];
	const hits: SensitiveHit[] = [];
	for (const [category, entries] of Object.entries(data.words)) {
		for (const w of entries.map((p) => p[0])) {
			let start = 0;
			for (;;) {
				const idx = text.indexOf(w, start);
				if (idx < 0) break;
				const { line, excerpt } = excerptAt(text, idx);
				hits.push({ start: idx, end: idx + w.length, word: w, category, line, excerpt });
				start = idx + w.length;
			}
		}
	}
	for (const pat of data.patterns) {
		const re = new RegExp(pat.re.source, "g");
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			const { line, excerpt } = excerptAt(text, m.index);
			hits.push({ start: m.index, end: m.index + m[0].length, word: pat.word, category: "变体正则", line, excerpt });
			if (m[0].length === 0) re.lastIndex++;
		}
	}
	hits.sort((a, b) => a.start - b.start || a.end - b.end);
	return hits;
}

/** 按分类聚合命中数（汇总展示/报告行用；保持词表分类出现序，变体正则恒排最后若有） */
export function groupSensitiveHits(hits: SensitiveHit[]): Array<{ category: string; count: number }> {
	const order: string[] = [];
	const counts = new Map<string, number>();
	for (const h of hits) {
		if (!counts.has(h.category)) order.push(h.category);
		counts.set(h.category, (counts.get(h.category) ?? 0) + 1);
	}
	return order.map((category) => ({ category, count: counts.get(category) ?? 0 }));
}

/** 把命中处包成标色 span（从后往前替换避免位移；title＝「分类：说明」，title 属性可缺省——stripAiWordMarks 两种形状都剥） */
export function applySensitiveMarks(text: string, hits: SensitiveHit[], data: BannedWordsData): string {
	let out = text;
	for (let i = hits.length - 1; i >= 0; i--) {
		const h = hits[i];
		const desc = descOf(data, h.category, h.word);
		const titleAttr = desc || h.category !== "变体正则" ? ` title="${`${h.category}${desc ? `：${desc}` : ""}`.replace(/"/g, "&quot;")}"` : "";
		out = out.slice(0, h.start) + `${SENSITIVE_SPAN_OPEN}${titleAttr}>${out.slice(h.start, h.end)}</span>` + out.slice(h.end);
	}
	return out;
}

/** 全书汇总报告一节（追加进《案头资料/敏感词报告.md》；每次扫描一节带时间戳，天然形成「当日汇总」历史） */
export function renderSensitiveReportSection(
	storyName: string,
	scannedAt: string,
	chapterCount: number,
	perChapter: Array<{ label: string; hits: number; groups: Array<{ category: string; count: number }> }>,
	totalHits: number
): string {
	const lines = [
		`## ${scannedAt} 扫描《${storyName}》`,
		"",
		`- 扫描章节：${String(chapterCount)} 章；命中合计：**${String(totalHits)} 处**`,
		"",
	];
	if (totalHits === 0) {
		lines.push("未命中任何敏感词。", "");
		return lines.join("\n");
	}
	lines.push("| 章节 | 命中 | 分类分布 |", "| --- | --- | --- |");
	for (const c of perChapter) {
		lines.push(`| ${c.label} | ${String(c.hits)} | ${c.groups.map((g) => `${g.category}×${String(g.count)}`).join("、") || "—"} |`);
	}
	lines.push("", "命中细节在对应章正文中以底色标出（运行该章「检测敏感词」可落标记）。", "");
	return lines.join("\n");
}
