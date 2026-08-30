import { parse, stringify } from "yaml";

// ===== 运行态（对齐 Python 版 story_state.json version 2，只存运行态不存文档内容）=====
// 存储载体改为 Obsidian「文件属性」风格的 MD 文档：<书名>/故事状态.md
// YAML frontmatter = 插件管理的运行态；正文可自由写笔记（保存时原样保留）。

export interface ChapterMeta {
	title: string;
	words: number;
	volume?: string;
	tags?: string[];
	note?: string;
}

export interface StoryState {
	version: 2;
	title: string;
	genre: string;
	writing_style: string;
	current_chapter: number | null;
	current_scene?: string;
	current_volume?: string;
	total_words: number;
	use_summaries: boolean;
	chapters: Record<string, ChapterMeta>;
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
		tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map((t) => asStr(t)).filter(Boolean) : undefined,
		note: asStr(o.note) || undefined,
	};
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
			const num = Number(k);
			if (!Number.isInteger(num) || num <= 0) continue;
			const meta = normalizeChapter(v);
			if (meta) chapters[String(num)] = meta;
		}
	}
	const cur = o.current_chapter == null ? NaN : Number(o.current_chapter);
	const extraKeys = new Set([
		"version", "title", "genre", "writing_style", "current_chapter", "current_scene",
		"current_volume", "total_words", "use_summaries", "chapters", "created_at", "updated_at",
	]);
	const extra: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(o)) if (!extraKeys.has(k)) extra[k] = v;
	return {
		state: {
			version: 2,
			title: asStr(o.title),
			genre: asStr(o.genre),
			writing_style: asStr(o.writing_style),
			current_chapter: Number.isFinite(cur) && cur > 0 ? Math.trunc(cur) : null,
			current_scene: asStr(o.current_scene) || undefined,
			current_volume: asStr(o.current_volume) || undefined,
			total_words: Number(o.total_words) || 0,
			use_summaries: Boolean(o.use_summaries),
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
	if (state.created_at) o["created_at"] = state.created_at;
	if (state.updated_at) o["updated_at"] = state.updated_at;
	const chapters: Record<string, unknown> = {};
	for (const num of Object.keys(state.chapters).map(Number).sort((a, b) => a - b)) {
		const meta = state.chapters[String(num)];
		if (!meta) continue;
		const c: Record<string, unknown> = { title: meta.title, words: meta.words };
		if (meta.volume) c["volume"] = meta.volume;
		if (meta.tags && meta.tags.length) c["tags"] = [...meta.tags];
		if (meta.note) c["note"] = meta.note;
		chapters[String(num)] = c;
	}
	if (Object.keys(chapters).length) o["chapters"] = chapters;
	if (opts?.extra) Object.assign(o, opts.extra);
	const yamlText = stringify(o, { lineWidth: Infinity });
	let text = `---\n${yamlText}---\n${(opts?.body ?? STATE_DOC_BODY).replace(/\n+$/, "")}`;
	if (!text.endsWith("\n")) text += "\n";
	return text;
}
