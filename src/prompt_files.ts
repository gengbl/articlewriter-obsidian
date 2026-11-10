/**
 * v0.2.x+ 提示词文件组装封装：统一入口 = 「有序条目数组」（PromptSpec[]）。
 * - 每个调用者（各 LLM 命令）按自己的需要声明所需提示词存储文件的顺序列表；
 * - 本模块按声明顺序读取文件（经注入的 reader，vault 文档与插件数据文件双后端）、清洗（去注释/去标题行/自定义 transform）、
 *   去重（文件路径去重 + 清洗后内容去重，先到先赢——数组顺序即优先级）、按 header 分节包装，最终 join 成完整提示词块串；
 * - 内联动态块（【书籍信息】/【卷列表】等调用方计算文本）以 text 条目混排进同一列表，享受同一套去重与包装。
 * 汇总《写作指南汇总.md》不再进运行时提示词（仅留作用户查看产物）：调用方直接列出三层指南原文文件。
 */
import { stripComments } from "./md_docs";

/** 文件读取器：按路径取原文；缺失/不可读返回 null（undefined 同义）。由调用方注入（main.ts：vault 文档走 readVaultDoc、插件数据文件走 readPluginFile） */
export type PromptFileReader = (file: string) => Promise<string | null | undefined>;

export interface PromptSpec {
	/** 文件路径（与 text 二选一；同时提供时按 file 读、读不到用 text 兜底）。作为路径去重键 */
	file?: string;
	/** 内联动态文本块（调用方计算：书籍信息 / 卷列表 / 用户输入大纲等） */
	text?: string;
	/** 分节标题；缺省 = 只输出正文（由调用方并入自己的包装，如【创作规范】由 assembleSystemPrompt 包装） */
	header?: string;
	/** 去 HTML 注释（文件条目默认 true；false = 原样保留） */
	stripComments?: boolean;
	/** 剥文件起始的连续标题行（#… 与纯文本「第N章」题行；默认 false） */
	stripHeading?: boolean;
	/** 清洗后、join 前的派生处理（剥 [伏] 标记、剥指南禁用词类目块等） */
	transform?: (text: string) => string;
	/** 文件缺失/空内容时的替代文本（系统级指南回落内置默认等）；仍走 stripComments/transform 管线 */
	fallback?: string;
	/** true = 本条目不注入（调用方按条件停用时保留声明位置，可读） */
	skip?: boolean;
	/** 分组标签：结果按组取用（如写作上下文的 book / vol / chapter 三层），组间顺序仍按声明顺序 */
	group?: string;
}

export interface PromptBlock {
	file: string;
	header: string;
	text: string;
	group: string;
}

export interface AssembledPrompt {
	/** 全部注入块（声明顺序） */
	readonly blocks: PromptBlock[];
	/** 某组块的拼接文本（组内按声明顺序，块间空行分隔；无块 = 空串） */
	groupText(name: string): string;
	/** 全部块按声明顺序拼接（不分组） */
	readonly text: string;
}

const joinBlocks = (blocks: PromptBlock[]): string =>
	blocks.map((b) => (b.header ? `${b.header}\n${b.text}` : b.text)).join("\n\n");

/** 文件起始标题行：MD 标题（#…）或纯文本「第N章/回」题行（对齐 prompts.stripHeading 口径） */
const HEADING_LINE_RE = /^\s*(?:#{1,6}(?:\s|$)|第[0-9一二三四五六七八九十百千零两]+[章回](?:[：:\s]|$))/;

function stripLeadingHeadings(text: string): string {
	const lines = text.split("\n");
	while (lines.length && (!lines[0].trim() || HEADING_LINE_RE.test(lines[0]))) lines.shift();
	return lines.join("\n").trim();
}

/**
 * 按声明顺序加载→清洗→去重→包装→join。
 * 去重规则（先到先赢，数组顺序即优先级）：
 * 1) 同一 file 只装载第一次（后续条目整体跳过，含其 header——调用方靠顺序表达优先级）；
 * 2) 清洗后正文与前面任一已注入块正文相同 → 跳过（跨文件同内容防双份，如卷大纲==当前大纲来源）。
 */
export async function assemblePromptFiles(reader: PromptFileReader, specs: PromptSpec[]): Promise<AssembledPrompt> {
	const blocks: PromptBlock[] = [];
	const seenFiles = new Set<string>();
	const seenTexts = new Set<string>();
	for (const spec of specs) {
		if (spec.skip) continue;
		if (spec.file) {
			if (seenFiles.has(spec.file)) continue;
			seenFiles.add(spec.file); // 读不到也记名——同路径不重试注入（缺失即缺失）
		}
		let raw: string | null | undefined;
		if (spec.file) {
			try {
				raw = await reader(spec.file);
			} catch {
				raw = null; // 读取失败按缺失处理（fallback 兜底）
			}
		}
		let text = (raw ?? "").trim() || (spec.fallback ?? "").trim() || (spec.text ?? "").trim();
		if (!text) continue;
		if (spec.file && spec.stripComments !== false) text = stripComments(text);
		if (spec.file && spec.stripHeading) text = stripLeadingHeadings(text);
		if (spec.transform) text = spec.transform(text);
		text = (text || "").trim();
		if (!text) continue;
		if (seenTexts.has(text)) continue;
		seenTexts.add(text);
		blocks.push({ file: spec.file ?? "", header: (spec.header ?? "").trim(), text, group: spec.group ?? "" });
	}
	return {
		blocks,
		groupText: (name: string) => joinBlocks(blocks.filter((b) => b.group === name)),
		get text() {
			return joinBlocks(blocks);
		},
	};
}
