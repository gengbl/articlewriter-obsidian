import { parse, stringify } from "yaml";

import { PIPELINE_STAGES, type StageId } from "./pipeline";
import { posInt } from "./book_skill"; // 正整数宽松解析共用（旧技能文件解析与 auto_book 配置同一口径）

// ===== 运行态（对齐 Python 版 story_state.json version 2，只存运行态不存文档内容）=====
// 存储载体改为 Obsidian「文件属性」风格的 MD 文档：<书名>/故事状态.md
// YAML frontmatter = 插件管理的运行态；正文可自由写笔记（保存时原样保留）。

export interface ChapterMeta {
	title: string;
	words: number;
	volume?: string;
}

/** v0.4.1+ 全自动建书配置（auto-book 流水线参数）：存于《故事状态.md》frontmatter 的 auto_book 嵌套块，
 *  取代旧「案头资料/自动建书.md」独立技能文档。规模模式复用 use_volumes（false=平铺）、一句话设定复用 one_line，
 *  此处只存执行范围与规模参数；legacy 技能文件由各命令入口自动迁移合并进来。 */
export interface AutoBookConfig {
	start?: StageId; // 起始节点（缺省 worldview）
	end?: StageId; // 停止节点（含；缺省＝跑到流水线末尾「连续编写正文」）
	chapters?: number; // 平铺（use_volumes:false）：全书总章数
	volumes?: number; // 分卷（use_volumes:true）：卷数
	chapter_counts?: number[]; // 分卷：各卷章数（长度＝volumes 或 1；runAutoBook 末值复制兜底）
	overwrite?: boolean; // 已有世界观/策划指南/书级大纲是否重新生成
}

/** 章节复合键：根域（未归属）"N"，卷域 "volId:N"。卷 id 禁止含冒号（addVolume 校验）。 */
export function chKey(vol: string | null | undefined, num: number): string {
	return vol ? `${vol}:${num}` : String(num);
}

export function parseChKey(key: string): { vol: string | null; num: number } {
	const i = key.indexOf(":");
	if (i < 0) return { vol: null, num: parseInt(key, 10) };
	return { vol: key.slice(0, i), num: parseInt(key.slice(i + 1), 10) };
}

export interface StoryState {
	version: 2;
	title: string;
	genre: string;
	writing_style: string;
	current_chapter: string | null; // v0.0.15 起为复合键字符串（旧版纯数字解析时自动归一化）
	current_scene?: string;
	current_volume?: string;
	total_words: number;
	use_summaries: boolean;
	use_volumes: boolean; // v0.0.16+：工作模式开关——false=无卷
	prev_chapters?: number; // v0.2.x+：本书级「使用章节摘要数量组装提示词」（前文窗口章数 N）；显式设置时优先于全局 data.json settings.prevChapters
	next_chapters?: number; // v0.4.3+：本书级「后续参考章数」（后文窗口章数 N，0=不注入后章）——编写文章阶段的大纲块按前 prev_chapters／后 next_chapters 只注入当前章前后若干章的大纲节选；显式设置时优先于全局 data.json settings.nextChapters
	include_volume_summary?: boolean; // v0.2.x+：本书级「是否使用前卷摘要组织提示词」；显式设置时优先于全局 data.json settings.includeVolumeSummary模式（纯 书→章 扁平结构）、true=有卷模式；缺省时按是否含卷数据推断（存量有卷书判 true 防回归，新/扁平书默认 false）
	word_range?: [number, number]; // v0.3.5+：本书级正文字数区间 [下限,上限]（取代旧 WRITING_GUIDE 指南「字数配置」注释）；显式配置时优先于全局默认 [4000,5000]，非法（下限≤0 或下限>上限）按未配置处理
	one_line?: string; // v0.3.0+：全自动流水线（auto-book）的一句话设定——/auto-book 弹窗填入后持久化，「生成世界观」命令读取作 premise；仅显式设置时写回
	auto_book?: AutoBookConfig; // v0.4.1+：全自动建书配置（执行范围＋规模参数）——旧「案头资料/自动建书.md」技能文档合并进状态文档；仅显式配置时写回
	book_skills?: Record<BookSkillPhase, string[]>; // v0.3.4+：本书选用的书籍级技能（技能名数组，读 <书>/案头资料/Skill/<名>.md）。键=阶段 key（BOOK_SKILL_PHASE_KEYS）；仅显式配置时写回
	chapters: Record<string, ChapterMeta>; // 键=复合键（见 chKey/parseChKey）
	created_at: string;
	updated_at: string;
}

/** 新格式：Obsidian 文件属性风格的状态文档 */
export const STATE_DOC_NAME = "故事状态.md";

/** 书籍技能阶段键（v0.3.4+）：与 settings.llm.writing_phases 数组下标 0–4 一一对应（阶段本身无规范 key 字符串，此处自定义稳定键）。
 *  v0.3.7+：「世界观生成」头插为阶段 0——旧四键整体后移，旧 故事状态.md book_skills 各阶段选用随语义键保留、无需迁移。 */
export const BOOK_SKILL_PHASE_KEYS = ["worldview", "planning", "outline", "volume_outline", "writing"] as const;
export type BookSkillPhase = (typeof BOOK_SKILL_PHASE_KEYS)[number];

/** 阶段下标 → 书籍技能键（越界返回 undefined）。 */
export function bookSkillPhaseKey(phaseIdx: number): BookSkillPhase | undefined {
	return BOOK_SKILL_PHASE_KEYS[phaseIdx];
}
/** 旧格式：Python CLI 兼容的 JSON（仅用于读取与一次性迁移备份） */
export const LEGACY_STATE_JSON = "story_state.json";

export const STATE_DOC_BODY = `<!-- 本文档由 ArticleWriter 插件自动维护：全部运行态存于上方的 YAML 文件属性中。
请勿手工修改上方属性值，如需变更请使用插件对应命令（章节/卷/字数等以磁盘 MD 为准、可用「扫描重建」刷新）。
本注释下方的正文可自由书写笔记，插件保存时不会改动它。 -->`;

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function asStr(v: unknown): string {
	return v == null ? "" : String(v);
}

function normalizeChapter(raw: unknown): ChapterMeta | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	const words = Number(o.words);
	return {
		title: asStr(o.title),
		words: Number.isFinite(words) ? words : 0,
		volume: asStr(o.volume) || undefined,
	}; // tags/note 已精简：无消费方，标签/备注只属于《章节信息.md》（旧文档里残留的这两个键解析时忽略、下次保存自然消失）
}

/** 正文字数区间全局缺省值（v0.3.5+）：书级《故事状态.md》word_range 未配置/非法时的回落（取代旧三层指南「字数配置」注释的内置回落）。 */
export const WORD_RANGE_DEFAULT: [number, number] = [4000, 5000];

/** 前后章窗口章数（v0.4.3+）：prev_chapters／next_chapters 共用的非负整数清洗；非整数/负数/非数字返回 undefined（视为未配置）。
 *  注意与 prev_chapters 历史口径一致：只认 YAML 数字，字符串数字按未配置处理（手改 frontmatter 时须写 `next_chapters: 3` 而非 `"3"`）。 */
function normalizeNonNegInt(raw: unknown): number | undefined {
	return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

/** 字数区间（v0.3.5+）：只认 [lo,hi] 两元素数组（或空格/逗号分隔字符串，容错手改 frontmatter），lo>0 且 lo<=hi 才有效；非法返回 undefined 视为未配置。 */
function normalizeWordRange(raw: unknown): [number, number] | undefined {
	let pair: unknown[] | undefined;
	if (Array.isArray(raw)) pair = raw;
	else if (typeof raw === "string") {
		const m = /^\s*(\d+)\s*(?:[-~～至到]|,|\s)\s*(\d+)\s*$/.exec(raw);
		if (m) pair = [m[1], m[2]];
	}
	if (!pair || pair.length !== 2) return undefined;
	const lo = Number(pair[0]);
	const hi = Number(pair[1]);
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
	const a = Math.round(lo);
	const b = Math.round(hi);
	if (a <= 0 || a > b) return undefined;
	return [a, b];
}

/** 书籍技能（v0.3.4+）：只认 BOOK_SKILL_PHASE_KEYS 白名单键、值为非空技能名字符串数组（去重、trim、非法条目丢弃）。无任何有效阶段条目返回 undefined（视为未配置）。 */
function normalizeBookSkills(raw: unknown): Record<BookSkillPhase, string[]> | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const o = raw as Record<string, unknown>;
	const out = {} as Record<BookSkillPhase, string[]>;
	let any = false;
	for (const k of BOOK_SKILL_PHASE_KEYS) {
		const v = o[k];
		if (!Array.isArray(v)) continue;
		const names: string[] = [];
		for (const item of v) {
			if (typeof item !== "string" && typeof item !== "number") continue; // 对象/布尔/null 等非法条目丢弃（number 兼容 YAML 裸数字技能名，如 123 → "123"）
			const s = asStr(item).trim();
			if (s && !names.includes(s)) names.push(s);
		}
		if (names.length) {
			out[k] = names;
			any = true;
		}
	}
	return any ? out : undefined;
}

/** 全自动建书配置（v0.4.1+）：只认 AutoBookConfig 白名单键——start/end 须为合法 StageId、chapters/volumes 正整数、
 *  chapter_counts 正整数数组（手改 frontmatter 容错逗号/顿号/空白分隔字符串，含非法项整条丢弃）、overwrite 布尔；
 *  非法字段各自忽略、不整体报废；无任何有效条目返回 undefined（视为未配置）。 */
export function normalizeAutoBook(raw: unknown): AutoBookConfig | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const o = raw as Record<string, unknown>;
	const out: AutoBookConfig = {};
	const stageIds: string[] = PIPELINE_STAGES.map((s) => s.id);
	if (typeof o.start === "string" && stageIds.includes(o.start)) out.start = o.start as StageId;
	if (typeof o.end === "string" && stageIds.includes(o.end)) out.end = o.end as StageId;
	const chapters = posInt(o.chapters);
	if (chapters != null) out.chapters = chapters;
	const volumes = posInt(o.volumes);
	if (volumes != null) out.volumes = volumes;
	if (Array.isArray(o.chapter_counts)) {
		const nums: number[] = [];
		for (const item of o.chapter_counts) {
			const n = posInt(item);
			if (n == null) break; // 含非法项整条丢弃（与旧技能文件解析同口径）
			nums.push(n);
		}
		if (nums.length === o.chapter_counts.length) out.chapter_counts = nums;
	} else if (typeof o.chapter_counts === "string") {
		const inner = o.chapter_counts.startsWith("[") && o.chapter_counts.endsWith("]") ? o.chapter_counts.slice(1, -1) : o.chapter_counts;
		const items = inner.split(/[,，、\s]+/).filter(Boolean);
		const nums: number[] = [];
		for (const x of items) {
			const n = posInt(x);
			if (n == null) break;
			nums.push(n);
		}
		if (items.length && nums.length === items.length) out.chapter_counts = nums;
	} else {
		const n = posInt(o.chapter_counts); // 标量单值＝各卷同章数（与旧技能文件同口径）
		if (n != null) out.chapter_counts = [n];
	}
	if (typeof o.overwrite === "boolean") out.overwrite = o.overwrite;
	return Object.keys(out).length ? out : undefined;
}

/** 全自动写书免交互开跑所需参数是否齐全：返回缺失项中文说明（空数组＝可直接开跑范围确认）。
 *  premise 取 state.one_line；规模模式由 use_volumes 决定（flatMode=true＝平铺看 chapters，false＝分卷看 volumes＋chapter_counts）；
 *  仅起始节点＝worldview 时才要求一句话设定（从后续节点起跑不必重新建世界观） */
export function autoBookMissing(premise: string | undefined, cfg: AutoBookConfig | undefined, flatMode: boolean, startAt: StageId): string[] {
	const miss: string[] = [];
	if (startAt === "worldview" && !(premise ?? "").trim()) miss.push("一句话设定（one_line）");
	if (flatMode) {
		if (cfg?.chapters == null) miss.push("全书总章数（auto_book.chapters）");
	} else {
		if (cfg?.volumes == null) miss.push("卷数（auto_book.volumes）");
		if (!cfg?.chapter_counts?.length) miss.push("各卷章数（auto_book.chapter_counts）");
	}
	return miss;
}

/**
 * 解析状态文档：frontmatter → StoryState；返回正文与用户自定义属性（extra，保存时原样保留）。
 * frontmatter 缺失/非法时 state=null（body 为全文）。
 */
export function parseStateDoc(
	raw: string
): { state: StoryState | null; body: string; extra?: Record<string, unknown> } {
	const clean = raw.replace(/^\uFEFF/, "");
	const m = FM_RE.exec(clean);
	if (!m) return { state: null, body: clean };
	let data: unknown;
	try {
		data = parse(m[1]);
	} catch {
		return { state: null, body: raw };
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return { state: null, body: clean.slice(m[0].length) };
	}
	const o = data as Record<string, unknown>;
	const chapters: Record<string, ChapterMeta> = {};
	if (o.chapters && typeof o.chapters === "object" && !Array.isArray(o.chapters)) {
		for (const [k, v] of Object.entries(o.chapters as Record<string, unknown>)) {
			const meta = normalizeChapter(v);
			if (!meta) continue;
			let key: string;
			if (/^\d+$/.test(k)) {
				// 旧格式纯数字键：按卷归属字段重映射（有卷→vol:N，无卷→根域 N）
				key = chKey(meta.volume || null, Number(k));
			} else if (/^[^:\s]+:\d+$/.test(k)) {
				key = k; // 新格式复合键：键优先，回填/校正 volume 字段保持同源
				meta.volume = parseChKey(k).vol || undefined;
			} else {
				continue;
			}
			chapters[key] = meta;
		}
	}
	// current_chapter：字符串=复合键直接校验存在；纯数字=旧格式，按 num 唯一匹配归一化
	let cur: string | null = null;
	const rawCur = o.current_chapter;
	if (typeof rawCur === "string" && /^[^:\s]+:\d+$/.test(rawCur)) {
		if (chapters[rawCur]) cur = rawCur;
	} else if (typeof rawCur === "number" && Number.isInteger(rawCur) && rawCur > 0) {
		const hits = Object.keys(chapters).filter((k) => parseChKey(k).num === rawCur);
		cur = hits.length === 1 ? hits[0] : null;
	} else if (typeof rawCur === "string" && /^\d+$/.test(rawCur)) {
		const n = parseInt(rawCur, 10);
		const hits = Object.keys(chapters).filter((k) => parseChKey(k).num === n);
		cur = hits.length === 1 ? hits[0] : null;
	}
	const extraKeys = new Set([
		"version", "title", "genre", "writing_style", "current_chapter", "current_scene",
		"current_volume", "total_words", "use_summaries", "use_volumes", "chapters", "created_at", "updated_at",
		"prev_chapters", "next_chapters", "include_volume_summary", "word_range", "one_line", "auto_book", "book_skills",
	]);
	const extra: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(o)) if (!extraKeys.has(k)) extra[k] = v;
	return {
		state: {
			version: 2,
			title: asStr(o.title),
			genre: asStr(o.genre),
			writing_style: asStr(o.writing_style),
			current_chapter: cur,
			current_scene: asStr(o.current_scene) || undefined,
			current_volume: asStr(o.current_volume) || undefined,
			total_words: Number(o.total_words) || 0,
			use_summaries: Boolean(o.use_summaries),
			// 缺省推断：显式布尔值优先；否则按「是否含卷数据」判定——存量有卷书判 true（防把现有有卷书误锁成无卷），新/扁平书默认 false（无卷模式）
			use_volumes: typeof o.use_volumes === "boolean"
				? o.use_volumes
				: Object.keys(chapters).some((k) => parseChKey(k).vol != null) || !!asStr(o.current_volume),
			// v0.2.x+：本书级提示词组装选项——仅显式设置时保留（非法值视为未设置），否则回落全局 data.json 设置
			prev_chapters: normalizeNonNegInt(o.prev_chapters),
			next_chapters: normalizeNonNegInt(o.next_chapters),
			include_volume_summary: typeof o.include_volume_summary === "boolean" ? o.include_volume_summary : undefined,
			word_range: normalizeWordRange(o.word_range), // v0.3.5+：书级字数区间（非法/未设置为 undefined，消费方回落 WORD_RANGE_DEFAULT）
			one_line: asStr(o.one_line).trim() || undefined, // v0.3.0+：一句话设定（空串视为未设置）
			auto_book: normalizeAutoBook(o.auto_book), // v0.4.1+：全自动建书配置（非法/空结构视为未配置）
			book_skills: normalizeBookSkills(o.book_skills), // v0.3.4+：书籍技能阶段配置（非法/空结构视为未配置）
			chapters,
			created_at: asStr(o.created_at),
			updated_at: asStr(o.updated_at),
		},
		body: clean.slice(m[0].length),
		extra: Object.keys(extra).length ? extra : undefined,
	};
}

/** 序列化为「frontmatter + 正文」；key 顺序固定，空可选字段省略 */
export function formatStateDoc(
	state: StoryState,
	opts?: { body?: string; extra?: Record<string, unknown> }
): string {
	const o: Record<string, unknown> = { version: state.version };
	o["title"] = state.title;
	o["genre"] = state.genre;
	o["writing_style"] = state.writing_style;
	if (state.current_chapter != null) o["current_chapter"] = state.current_chapter;
	if (state.current_scene) o["current_scene"] = state.current_scene;
	if (state.current_volume) o["current_volume"] = state.current_volume;
	o["total_words"] = state.total_words;
	o["use_summaries"] = state.use_summaries;
	o["use_volumes"] = state.use_volumes; // 恒显式写出，保存后行为确定（不再依赖缺省推断）
	// v0.2.x+：本书级提示词组装选项——仅显式设置时写回（未设置的存量文档保持原样、继续走全局设置）
	if (state.prev_chapters != null) o["prev_chapters"] = state.prev_chapters;
	if (state.next_chapters != null) o["next_chapters"] = state.next_chapters; // v0.4.3+：书级后 N 章（未配置不写，走全局 settings.nextChapters）
	if (state.include_volume_summary != null) o["include_volume_summary"] = state.include_volume_summary;
	if (state.word_range) o["word_range"] = [state.word_range[0], state.word_range[1]]; // v0.3.5+：书级字数区间（YAML 数组写回；未配置不写）
	if (state.one_line) o["one_line"] = state.one_line; // v0.3.0+：一句话设定（auto-book），仅非空时写回
	// v0.4.1+：全自动建书配置——仅含有效条目时写回，按固定键序（start/end/chapters/volumes/chapter_counts/overwrite）
	if (state.auto_book) {
		const ab = normalizeAutoBook(state.auto_book) ?? {};
		const blk: Record<string, unknown> = {};
		if (ab.start) blk["start"] = ab.start;
		if (ab.end) blk["end"] = ab.end;
		if (ab.chapters != null) blk["chapters"] = ab.chapters;
		if (ab.volumes != null) blk["volumes"] = ab.volumes;
		if (ab.chapter_counts?.length) blk["chapter_counts"] = [...ab.chapter_counts];
		if (ab.overwrite != null) blk["overwrite"] = ab.overwrite;
		if (Object.keys(blk).length) o["auto_book"] = blk;
	}
	// v0.3.4+：书籍技能阶段配置——仅含有效条目时写回，按 BOOK_SKILL_PHASE_KEYS 固定键序、空数组阶段省略
	if (state.book_skills) {
		const bs: Record<string, string[]> = {};
		for (const k of BOOK_SKILL_PHASE_KEYS) {
			const v = state.book_skills[k];
			if (Array.isArray(v) && v.length) bs[k] = [...v];
		}
		if (Object.keys(bs).length) o["book_skills"] = bs;
	}
	if (state.created_at) o["created_at"] = state.created_at;
	if (state.updated_at) o["updated_at"] = state.updated_at;
	const chapters: Record<string, unknown> = {};
	// 确定性排序：根域（按章号）在前，其余卷组按 id、组内按章号
	const groups = new Map<string, number[]>();
	for (const k of Object.keys(state.chapters)) {
		const { vol, num } = parseChKey(k);
		if (!Number.isInteger(num)) continue; // 允许 0（序章「第0章」合法存在）：丢弃会导致其 current_chapter/条目在保存后消失、激活不生效
		const g = vol ?? "";
		if (!groups.has(g)) groups.set(g, []);
		groups.get(g)!.push(num);
	}
	for (const [g, nums] of [...groups.entries()].sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0])))) {
		nums.sort((x, y) => x - y).forEach((n) => {
			const meta = state.chapters[chKey(g || null, n)];
			if (!meta) return;
			const c: Record<string, unknown> = { title: meta.title, words: meta.words };
			if (meta.volume) c["volume"] = meta.volume;
			chapters[chKey(g || null, n)] = c;
		});
	}
	if (Object.keys(chapters).length) o["chapters"] = chapters;
	if (opts?.extra) Object.assign(o, opts.extra);
	const yamlText = stringify(o, { lineWidth: Infinity });
	let text = `---\n${yamlText}---\n${(opts?.body ?? STATE_DOC_BODY).replace(/\n+$/, "")}`;
	if (!text.endsWith("\n")) text += "\n";
	return text;
}
