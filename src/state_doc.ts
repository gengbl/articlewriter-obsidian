import { parse, stringify } from "yaml";

// ===== 运行态（对齐 Python 版 story_state.json version 2，只存运行态不存文档内容）=====
// 存储载体改为 Obsidian「文件属性」风格的 MD 文档：<书名>/故事状态.md
// YAML frontmatter = 插件管理的运行态；正文可自由写笔记（保存时原样保留）。

export interface ChapterMeta {
	title: string;
	words: number;
	volume?: string;
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
	use_volumes: boolean; // v0.0.16+：工作模式开关——false=无卷模式（纯 书→章 扁平结构）、true=有卷模式；缺省时按是否含卷数据推断（存量有卷书判 true 防回归，新/扁平书默认 false）
	chapters: Record<string, ChapterMeta>; // 键=复合键（见 chKey/parseChKey）
	created_at: string;
	updated_at: string;
}

/** 新格式：Obsidian 文件属性风格的状态文档 */
export const STATE_DOC_NAME = "故事状态.md";
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
