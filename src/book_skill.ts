/**
 * v0.3.0+ 自动化建书技能（book skill）：旧技能文件＝<书目录>/案头资料/<名称>.md——
 * frontmatter（`auto_book: true` 标记 + 规模参数）＋ 正文＝一句话设定。
 * v0.4.1+ 建书配置已合并进《故事状态.md》frontmatter 的 auto_book 块（见 state_doc.ts AutoBookConfig），
 * 不再创建/读取技能文件；本模块只保留 parseBookSkill 供旧技能文件一次性迁移（merge 进状态文档后删除文件）。
 * 注意与 SKILLS/ 写作技巧技能（skills_default.ts）、书籍级技能（案头资料/Skill/）区分：那两类都是注入提示词的技能文档，
 * 这里曾用于驱动 auto-book 流水线的建书模板，现仅存量迁移用途。
 * 纯函数（不 import obsidian、不 import yaml——手写单层 frontmatter 解析，测试 ESM 打包零依赖），可被 tests/ 直接断言。
 */
import { PIPELINE_STAGES, type StageId } from "./pipeline";

export interface BookSkillSpec {
	startAt?: StageId; // 起始节点（缺省 worldview）
	endAt?: StageId; // 停止节点（含；缺省＝跑到流水线末尾）。排在 startAt 之前＝非法区间，起跑前拒绝
	mode?: "flat" | "volumes"; // 规模模式（缺省跟随书籍 state.use_volumes）
	flatTotalChapters?: number; // 平铺：全书总章数
	volumeCount?: number; // 分卷：卷数
	chapterCounts?: number[]; // 分卷：各卷章数（长度 1 或卷数；runAutoBook 末值复制兜底）
	overwrite?: boolean; // 已有世界观/策划指南/书级大纲是否重新生成
	premise?: string; // 一句话设定（可选；缺省用正文）
	body: string; // 正文＝一句话设定（frontmatter 之外的全部）
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;
const STAGE_IDS: string[] = PIPELINE_STAGES.map((s) => s.id);

/** 单层 frontmatter 解析（key: value 一行一项，值可带双引号）：出现非法行（无冒号/键不合法）返回 null＝非技能文件。
 *  不支持嵌套/多行值——建书技能只有单层标量，手写解析换取测试零 yaml 依赖 */
function parseFlatFrontmatter(fm: string): Record<string, string> | null {
	const o: Record<string, string> = {};
	for (const line of fm.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		const i = t.indexOf(":");
		if (i < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(t.slice(0, i).trim())) return null;
		o[t.slice(0, i).trim()] = t.slice(i + 1).trim();
	}
	return o;
}

/** 双引号标量解引（JSON 语义，兼容旧 formatBookSkill 用 JSON.stringify 写盘的 premise 标量）；非引号值原样返回 */
function unquote(v: string): string {
	if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
		try {
			const p: unknown = JSON.parse(v);
			return typeof p === "string" ? p : v;
		} catch {
			return v;
		}
	}
	return v;
}

/** 正整数宽松解析（number 或纯数字字符串），非法/非正返回 undefined（视为未设置）。v0.4.1+ 起 state_doc.ts 的 auto_book 配置解析共用 */
export function posInt(v: unknown): number | undefined {
	const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
	return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

/** 各卷章数宽松解析：方括号数组（[10, 10]）或逗号/顿号/空白分隔字符串（"10, 10, 10"）；含非法项则整条丢弃 */
function parseCounts(v: string | undefined): number[] | undefined {
	if (!v) return undefined;
	const inner = v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1) : v;
	const items = inner.split(/[,，、\s]+/).filter(Boolean);
	if (!items.length) return undefined;
	const nums: number[] = [];
	for (const x of items) {
		const n = posInt(x);
		if (n == null) return undefined;
		nums.push(n);
	}
	return nums;
}

/** 解析建书技能文件：非 frontmatter / frontmatter 非法 / 无 auto_book: true 标记 → null（普通案头资料文档）；字段非法各自忽略、不整体报废 */
export function parseBookSkill(raw: string): BookSkillSpec | null {
	const clean = raw.replace(/^\uFEFF/, "");
	const m = FM_RE.exec(clean);
	if (!m) return null;
	const o = parseFlatFrontmatter(m[1]);
	if (!o || o.auto_book !== "true") return null; // 标记须为未加引号的布尔 true（"true" 字符串不算）
	const spec: BookSkillSpec = { body: clean.slice(m[0].length).trim() };
	const start = o.start ? unquote(o.start) : undefined;
	if (start && STAGE_IDS.includes(start)) spec.startAt = start as StageId;
	const end = o.end ? unquote(o.end) : undefined;
	if (end && STAGE_IDS.includes(end)) spec.endAt = end as StageId;
	const mode = o.mode ? unquote(o.mode) : undefined;
	if (mode === "flat" || mode === "volumes") spec.mode = mode;
	spec.flatTotalChapters = posInt(o.chapters);
	spec.volumeCount = posInt(o.volumes);
	spec.chapterCounts = parseCounts(o.chapter_counts);
	if (o.overwrite === "true") spec.overwrite = true;
	else if (o.overwrite === "false") spec.overwrite = false;
	const premise = o.premise ? unquote(o.premise) : undefined;
	if (premise?.trim()) spec.premise = premise.trim();
	return spec;
}

