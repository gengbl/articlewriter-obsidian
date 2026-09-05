import {
	CharacterDoc,
	ForeshadowItem,
	SceneDoc,
	WorldSettingDoc,
	extractForeshadows,
	stripComments,
	stripForeshadowMarks,
} from "./md_docs";
import {
	AiHit,
	AiSentence,
	buildMergedBannedBlock,
	findAiSentences,
	findAiWordHits,
	simplifyEmphaticRepetition,
	simplifyNegationContrast,
} from "./banned_words";
import { DEFAULT_STORY_TYPE, getStoryTypeGuide } from "./story_types";

// ---------- 大纲详略标记（对应 writer.py OUTLINE_MARKERS / extract_outline_markers） ----------

export const OUTLINE_MARKERS: Record<string, string> = {
	"[详]": "详写",
	"[扩]": "扩写",
	"[补]": "补充",
	"[略]": "略写",
	"[跳]": "跳过",
};

export const OUTLINE_END_MARKERS: string[] = ["[/]", "[/详]", "[/扩]", "[/补]", "[/略]", "[/跳]"];

const MARKER_CATEGORY_ORDER: Array<[string, string]> = [
	["详写", "[详]"],
	["扩写", "[扩]"],
	["补充", "[补]"],
	["略写", "[略]"],
	["跳过", "[跳]"],
];

const OUTLINE_ITEM_TRIM_CLASS = " \\t，,。;；:：\\-–—|、()（）";

function cleanOutlineItem(seg: string): string {
	let item = seg;
	for (const mark of Object.keys(OUTLINE_MARKERS)) {
		item = item.split(mark).join("");
	}
	item = item.replace(/\s+/g, " ");
	return item.replace(new RegExp(`^[${OUTLINE_ITEM_TRIM_CLASS}]+|[${OUTLINE_ITEM_TRIM_CLASS}]+$`, "g"), "");
}

/** 按行解析大纲中的 [详]/[扩]/[补]/[略]/[跳] 标记及其作用域 */
export function extractOutlineMarkers(outline: string): Record<string, string[]> {
	const result: Record<string, string[]> = { 详写: [], 扩写: [], 补充: [], 略写: [], 跳过: [] };
	if (!outline) return result;
	for (const raw of outline.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		for (const segment of line.split(/\[\/(?:详|扩|补|略|跳)?\]/)) {
			const seg = segment.trim();
			if (!seg) continue;
			for (const [key, mark] of MARKER_CATEGORY_ORDER) {
				if (seg.includes(mark)) {
					const item = cleanOutlineItem(seg);
					if (item) result[key].push(item);
					break;
				}
			}
		}
	}
	return result;
}

/** 生成【大纲详略标记】提示块（无标记时返回空串） */
export function buildOutlineMarkerGuide(outline: string): string {
	const markers = extractOutlineMarkers(outline);
	const parts: string[] = [];
	for (const [key, intro] of [
		["详写", "【需详写的要点（[详]）】"],
		["扩写", "【需扩写的要点（[扩]）】"],
		["补充", "【需补充的要点（[补]）】"],
		["略写", "【需略写的要点（[略]）】"],
		["跳过", "【可跳过的要点（[跳]）】"],
	] as Array<[string, string]>) {
		if (markers[key].length) {
			parts.push(intro + "\n" + markers[key].map((i) => "- " + i).join("\n"));
		}
	}
	if (!parts.length) return "";
	return (
		"【大纲详略标记】\n" +
		parts.join("\n\n") +
		"\n\n标记含义：[详]重点展开、详细描写；[扩]扩展补充情节与细节；" +
		"[补]在不偏离主线的前提下，补充大纲没提到的细节或小情节；" +
		"[略]简略带过、几句话交代；[跳]可跳过不写。" +
		"标记默认作用于整行；用 [/]（或 [/详] [/扩] [/补] [/略] [/跳]）结束作用域，可在同一行内分段控制详略。" +
		"请严格按标记控制各要点篇幅：详写/扩写/补充的要点重点占用篇幅，略写/跳过的要点点到即止。"
	);
}

export const DESC_STYLE_GUIDE_COMPLETE =
	"【语言描述方式】\n" +
	"描写人物、场景、事物时，把要说的话按正常语序放在一句话里说完，" +
	"例如「荒野中有一座破败的小镇」「他疲惫不堪地站在门口」；\n" +
	"不要为了突出某个词而把一句话拆开说：减少「小镇，破败的，在荒野中」" +
	"「他，疲惫地，站在门口」这类“先抛核心词、再补修饰语”的破碎写法，" +
	"也减少「他。疲惫。站在门口。」这类短句碎片堆叠；\n" +
	"这里只约束一句话内部的语序与完整性，不涉及留白、信息取舍等其它写作约定。";

/** 生成【大纲角色/场景描写要求】提示块（对应 writer.py build_role_scene_guide） */
export function buildRoleSceneGuide(outline: string): string {
	if (!outline) return "";
	const markReSrc = "<角色\\s*[：:]\\s*([^>]+)>|<场景\\s*[：:]\\s*([^>]+)>";
	const splitRe = /[、，,;；/|]/;
	const items: Array<[string, string[], string[]]> = [];
	for (const raw of outline.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		const re = new RegExp(markReSrc, "g");
		const marks: RegExpExecArray[] = [];
		let m: RegExpExecArray | null;
		while ((m = re.exec(line)) !== null) marks.push(m);
		if (!marks.length) continue;
		const chars: string[] = [];
		const scenes: string[] = [];
		for (const mm of marks) {
			if (mm[1]) for (const n of mm[1].split(splitRe)) if (n && n.trim()) chars.push(n.trim());
			if (mm[2]) for (const n of mm[2].split(splitRe)) if (n && n.trim()) scenes.push(n.trim());
		}
		if (!chars.length && !scenes.length) continue;
		const item = cleanOutlineItem(line.replace(new RegExp(markReSrc, "g"), ""));
		items.push([item || "（大纲标记处）", [...new Set(chars)], [...new Set(scenes)]]);
	}
	if (!items.length) return "";
	const lines = [
		"【大纲角色/场景描写要求】",
		"以下大纲要点带有角色/场景标记，请在写到对应位置时，简单描写涉及的角色与场景（描写简明自然、融入行文，不要大段堆砌）：",
	];
	for (const [item, chars, scenes] of items) {
		const parts = [`- 要点「${item}」`];
		if (chars.length) parts.push("涉及角色：" + chars.join("、"));
		if (scenes.length) parts.push("涉及场景：" + scenes.join("、"));
		lines.push(parts.join("；"));
	}
	lines.push(
		"要求：角色描写侧重外貌/神态/性格/动作等特征，场景描写侧重环境/布局/氛围/光线等；" +
			"描写出现在标记对应的情节位置附近。"
	);
	return lines.join("\n");
}

// ---------- 上下文裁剪辅助（对应 story/context_builder.py） ----------

const OUTLINE_RANGE_RE_SRC = "第\\s*(\\d+)\\s*[-~—至到]\\s*(\\d+)\\s*章";
const OUTLINE_CHAP_RE_SRC = "第\\s*(\\d+)\\s*章";

function findOutlineMatches(line: string, src: string): Array<{ s: number; e: number; n: number }> {
	const out: Array<{ s: number; e: number; n: number }> = [];
	const re = new RegExp(src, "g");
	let m: RegExpExecArray | null;
	while ((m = re.exec(line)) !== null) {
		out.push({ s: m.index, e: m.index + m[0].length, n: parseInt(m[1], 10) });
	}
	return out;
}

/** 截取全局大纲中「目标章节之前」的部分。v0.0.15：chapterNum 传阅读序位置；多卷书本地章号跨卷重复时锚点匹配放宽为包含式（宁多勿漏，仅影响提及名检测）。 */
export function outlineUpToChapter(text: string, chapterNum: number): string {
	if (!text || chapterNum <= 0) return text;
	const lines = text.split("\n");
	const anchors: number[] = [];
	const bounds: number[] = [];
	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx];
		const ranges = findOutlineMatches(line, OUTLINE_RANGE_RE_SRC);
		if (ranges.some((r) => r.n <= chapterNum)) anchors.push(idx);
		if (ranges.some((r) => r.n > chapterNum)) bounds.push(idx);
		for (const cm of findOutlineMatches(line, OUTLINE_CHAP_RE_SRC)) {
			if (ranges.some((r) => r.s <= cm.s && cm.s < r.e)) continue;
			if (cm.n <= chapterNum) anchors.push(idx);
			else bounds.push(idx);
		}
	}
	if (!bounds.length) return text;
	const base = anchors.length ? Math.max(...anchors) : -1;
	const cut = bounds.find((b) => b > base);
	if (cut === undefined) return text;
	return lines.slice(0, cut).join("\n").trim();
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 判断名字是否出现在文本中（单字名要求前后不是字母/数字/下划线/汉字） */
export function nameInText(name: string, text: string): boolean {
	if (!name || !text) return false;
	if (name.length >= 2) return text.includes(name);
	const wordClass = "A-Za-z0-9_\\u4e00-\\u9fff\\u3400-\\u4dbf";
	// 前置否定用「(?:^|[^…])」前缀字符替代 lookbehind（iOS Safari <16.4 不支持）；仅用于存在性检测，消耗一个边界字符无副作用
	return new RegExp(`(?:^|[^${wordClass}])` + escapeRegExp(name) + `(?![${wordClass}])`).test(text);
}

/** 提取大纲 <角色：...>/<场景：...> 标记中的名字集合 */
export function extractMarkedNames(text: string, kind: "角色" | "场景"): Set<string> {
	const names = new Set<string>();
	if (!text) return names;
	const re = new RegExp(`<${kind}[:：]\\s*([^>]+)>`, "g");
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		for (let part of m[1].split(/[、，,;\s]+/)) {
			part = part.trim().replace(/^[（()）]+|[（()）]+$/g, "");
			if (part) names.add(part);
		}
	}
	return names;
}

export interface MentionedNamesInput {
	globalOutlineRaw: string;
	chapterOutlineText: string;
	characters: CharacterDoc[];
	scenes: SceneDoc[];
	chapterNum: number;
}

/** 计算本章涉及的角色名与场景 id（标记优先，其次名称匹配） */
export function computeMentionedNames(input: MentionedNamesInput): { charNames: Set<string>; sceneIds: Set<string> } {
	const texts: string[] = [];
	if (input.globalOutlineRaw) {
		const scoped = outlineUpToChapter(input.globalOutlineRaw, input.chapterNum);
		if (scoped) texts.push(scoped);
	}
	if (input.chapterOutlineText) texts.push(input.chapterOutlineText);
	const text = texts.join("\n");
	const markedChars = extractMarkedNames(text, "角色");
	const markedScenes = extractMarkedNames(text, "场景");
	const charNames = new Set(markedChars);
	for (const c of input.characters) if (nameInText(c.name, text)) charNames.add(c.name);
	const sceneIds = new Set<string>();
	for (const s of input.scenes) {
		const title = s.title || "";
		if (markedScenes.has(s.scene_id) || (title && markedScenes.has(title))) {
			sceneIds.add(s.scene_id);
			continue;
		}
		if (nameInText(s.scene_id, text) || (title && nameInText(title, text))) sceneIds.add(s.scene_id);
	}
	return { charNames, sceneIds };
}

/** 去掉大纲中的伏笔标记与详略标记，压缩空白 */
export function stripOutlineMarkers(text: string): string {
	if (!text) return "";
	let t = stripForeshadowMarks(text);
	for (const mark of [...Object.keys(OUTLINE_MARKERS), ...OUTLINE_END_MARKERS]) {
		t = t.split(mark).join("");
	}
	return t.replace(/\s+/g, " ").trim();
}

// ---------- 字数配置（对应 writer.py _word_range） ----------

const WORD_RANGE_RE = /<!--\s*字数配置\s*[:：]\s*(\d+)\s*[-~～至到]\s*(\d+)\s*-->/;

/** 从写作指南文本中提取 [min,max]，未找到时默认 [4000,5000]；按传入顺序取第一个命中 */
export function wordRangeFromGuides(...guides: Array<string | undefined>): [number, number] {
	for (const g of guides) {
		if (!g) continue;
		const m = WORD_RANGE_RE.exec(g);
		if (m) {
			const lo = parseInt(m[1], 10);
			const hi = parseInt(m[2], 10);
			if (lo > 0 && lo <= hi) return [lo, hi];
		}
	}
	return [4000, 5000];
}

// ---------- 章节文件夹文档（对应 story/context_builder.py get_chapter_folder_docs） ----------

const CHAPTER_DOC_LABELS: Record<string, string> = {
	"章节大纲.md": "【本章大纲】",
	"人物.md": "【本章人物设定】",
	"人物关系.md": "【本章人物关系】",
	"场景.md": "【本章场景】",
	"章节信息.md": "【本章章节信息】",
};

export interface ChapterFolderDocEntry {
	file: string;
	text: string;
}

/** 组装章节文件夹内各 md 的上下文块，并抽取大纲中的伏笔（v0.0.15：defaultScopeKey=复合键，作为 [伏] 标记默认归属容器） */
export function buildChapterFolderDocs(
	entries: ChapterFolderDocEntry[],
	defaultScopeKey?: string
): { docs: string; foreshadows: ForeshadowItem[] } {
	let allForeshadows: ForeshadowItem[] = [];
	const parts: string[] = [];
	for (const fname of Object.keys(CHAPTER_DOC_LABELS)) {
		const entry = entries.find((e) => e.file === fname);
		if (!entry || !entry.text.trim()) continue;
		let lines = entry.text.split("\n");
		if (lines.length && /^#\s*第\s*\d+\s*章/.test(lines[0])) lines.shift();
		let text = stripComments(lines.join("\n").trim()).trim();
		if (!text) continue;
		if (fname === "章节大纲.md") {
			if (defaultScopeKey) allForeshadows.push(...extractForeshadows(text, defaultScopeKey));
			text = stripForeshadowMarks(text);
		}
		parts.push(`${CHAPTER_DOC_LABELS[fname]}\n${text}`);
	}
	return { docs: parts.join("\n\n"), foreshadows: allForeshadows };
}

/** 清洗人物关系文档（去一级标题行与注释；书/卷/章三层通用） */
export function cleanRelationshipsDoc(rawText: string): string {
	const t = (rawText || "").trim();
	if (!t) return "";
	const lines = t.split("\n");
	if (lines.length && lines[0].trim().startsWith("# ")) lines.shift();
	return stripComments(lines.join("\n").trim()).trim();
}

/** 单行人物关系文本归一化（去行首列表标记、折叠空白），供跨层逐行比对 */
function normalizeRelLine(line: string): string {
	return line.replace(/^\s*[-*+]\s*/, "").replace(/\s+/g, " ").trim();
}

/** v0.0.15 三层上下文·跨层去重：剔除已在更高优先级层出现过的相同行（优先级 章 > 卷 > 书，higherTexts 按高→低传） */
export function dedupeLinesAgainst(text: string, ...higherTexts: Array<string | undefined>): string {
	const body = (text || "").trim();
	if (!body) return "";
	const seen = new Set<string>();
	for (const h of higherTexts) {
		if (!h) continue;
		for (const ln of h.split("\n")) {
			const n = normalizeRelLine(ln);
			if (n) seen.add(n);
		}
	}
	if (!seen.size) return body;
	return body.split("\n").filter((ln) => !seen.has(normalizeRelLine(ln))).join("\n").trim();
}

// ---------- 写作上下文组装（对应 story/context_builder.py get_context_for_writing） ----------

export interface PrevChapterRef {
	num: number; // v0.0.15：阅读序位置（ordinal，跨卷连续），非容器内本地章号
	key?: string; // 复合键「N」或「volId:N」
	label?: string; // 展示标签（跨卷时含卷名，如「第二卷·第3章」）
	title?: string;
	content: string;
}

export interface PlotNodeRef {
	id: string;
	chapter: number;
	status?: string;
	description?: string;
}

export interface WritingContextInput {
	chapterNum: number; // v0.0.15：阅读序位置（ordinal，跨卷连续）；本地章号仅用于落盘与容器内引用
	localNum?: number; // 本章在所属容器的本地章号
	volumeName?: string; // 当前卷名（空/缺省 = 书根）
	volOutlineText?: string; // 当前卷《卷大纲》清洗后文本
	chapterRanks?: Record<string, number>; // 复合键→阅读序位置；角色/场景可见性按容器排名判定
	volumeNames?: Record<string, string>; // 卷id→卷名；伏笔等复合键展示用
	title?: string;
	genre?: string;
	writingStyle?: string;
	currentSceneId?: string;
	globalOutlineRaw: string;
	chapterOutlineText: string;
	characters: CharacterDoc[];
	/** v0.0.15 三层上下文：人物关系分书/卷/章三份清洗文本（跨层逐行去重在 buildWritingContext 内做，优先级 章 > 卷 > 书） */
	bookRelationships?: string;
	volRelationships?: string;
	chapterRelationships?: string;
	activeVolId?: string; // 当前章所属卷 id；空 = 书根（无卷级小节）
	excludeCharNames?: string[]; // 本章目录《人物.md》归属角色名——folderDocs【本章人物设定】已全文渲染，结构化列表排除避免重复
	excludeSceneIds?: string[]; // 本章目录《场景.md》归属场景 id——同上
	volSummary?: string; // 最新卷摘要（<volDir>/卷摘要.md 内容哈希校验通过时非空）
	prevVolSummaries?: Array<{ name: string; text: string }>; // v0.1.4+：前文窗口跨卷缺口——以最近各前卷的新鲜《卷摘要》填充（仅卷模式、本卷内不足 prevN 章时出现，按阅读序由近及远）
	prevChapters: PrevChapterRef[];
	summaries: Record<number, string>;
	prevN?: number;
	world?: WorldSettingDoc | null;
	scenes: SceneDoc[];
	foreshadows: ForeshadowItem[];
	plots?: PlotNodeRef[];
	folderDocs: string;
	includeOutline?: boolean;
}

/** 写字台展示口径：各级别中会进入写作提示词的模板文档文件名（story_manager.loadWritingData 的读取面）——写字台文件行对命中者加粗显示、新建文档时优先列出 */
export const PROMPT_DOCS_ROOT = new Set(["大纲.md", "世界观.md", "伏笔.md", "人物.md", "人物关系.md", "角色关系.md", "场景.md"]); // 《笔记.md》《卷.md》《故事状态.md》不参与
export const PROMPT_DOCS_VOLUME = new Set(["卷大纲.md", "人物.md", "人物关系.md", "场景.md"]); // 《卷摘要.md》仅在 includeVolumeSummary 开关开启时注入，默认不算
export const PROMPT_DOCS_CHAPTER = new Set(["章节.md", "章节大纲.md", "人物.md", "人物关系.md", "场景.md", "章节信息.md"]); // 建章播种六件全部参与

/** 复合键「N」或「volId:N」的展示标签 */
export function chapterKeyLabel(key: string, volumeNames?: Record<string, string>): string {
	const i = key.indexOf(":");
	if (i < 0) return `第${key}章`;
	const volId = key.slice(0, i);
	return `${volumeNames?.[volId] || volId}·第${key.slice(i + 1)}章`;
}

/**
 * 纯函数版 get_context_for_writing：所有磁盘读取由调用方完成。
 * v0.0.15 三层结构——故事情况分「书籍级 / 卷级 / 章级」小节渲染：
 * - 人物/场景按归属分层（当前卷内 → 卷级；其余 → 书级），本章目录归属的条目已由 folderDocs 原文渲染、此处排除避免重复
 * - 人物关系三层各自成块并跨层逐行去重（优先级 章 > 卷 > 书，高优先级层的行在低层级剔除）
 */
export function buildWritingContext(input: WritingContextInput): string {
	const parts: string[] = [];
	if (input.title) parts.push(`【小说标题】${input.title}`);
	if (input.genre) parts.push(`【小说类型】${input.genre}`);
	if (input.writingStyle) parts.push(`【编写类型】${input.writingStyle}`);

	const activeVolId = input.activeVolId || "";
	const inVolume = Boolean(activeVolId);
	const chLabel = input.localNum != null ? `第${input.localNum}章` : `第${input.chapterNum}章`;
	const volTitle = input.volumeName || activeVolId;

	// ---- 人物关系跨层去重（优先级 章 > 卷 > 书）----
	const chRel = (input.chapterRelationships || "").trim();
	const volRel = inVolume ? dedupeLinesAgainst((input.volRelationships || "").trim(), chRel) : "";
	const bookRel = dedupeLinesAgainst((input.bookRelationships || "").trim(), chRel, volRel);

	const renderCharBlock = (heading: string, list: CharacterDoc[]): void => {
		if (!list.length) return;
		parts.push(`\n${heading}`);
		for (const char of list) {
			let info = `  - ${char.name}`;
			if (char.identity) info += `（${char.identity}）`;
			if (char.age) info += `，年龄：${char.age}`;
			if (char.gender) info += `，性别：${char.gender}`;
			parts.push(info);
			if (char.personality) parts.push(`    性格：${char.personality}`);
			if (char.appearance) parts.push(`    外貌：${char.appearance}`);
			if (char.background) parts.push(`    背景：${char.background}`);
			if (char.abilities && char.abilities.length) parts.push(`    能力：${char.abilities.join("；")}`);
			if (char.notes) parts.push(`    备注：${char.notes}`);
		}
	};

	const outline = input.globalOutlineRaw || "";
	const mentioned = computeMentionedNames({
		globalOutlineRaw: outline,
		chapterOutlineText: input.chapterOutlineText || "",
		characters: input.characters,
		scenes: input.scenes,
		chapterNum: input.chapterNum,
	});
	let chars = [...input.characters];
	if (mentioned.charNames.size) {
		chars = chars.filter((c) => mentioned.charNames.has(c.name));
	} else if (input.chapterRanks) {
		// v0.0.15：角色可见性按「归属章节的阅读序位置 ≤ 当前 ordinal」判定（跨卷自然延续）
		const ranks = input.chapterRanks;
		chars = chars.filter((c) => {
			if (!c.chapter || c.chapter <= 0) return true; // 全局角色恒可见
			return (ranks[`${c.vol ? c.vol + ":" : ""}${c.chapter}`] ?? Number.POSITIVE_INFINITY) <= input.chapterNum;
		});
	} else {
		chars = chars.filter((c) => (c.chapter || 0) <= input.chapterNum);
	}
	// 本章目录《人物.md》归属的角色已由 folderDocs【本章人物设定】原文渲染，结构化列表排除避免重复
	const exclChars = new Set(input.excludeCharNames || []);
	chars = chars.filter((c) => !exclChars.has(c.name));
	const volChars = inVolume ? chars.filter((c) => c.vol === activeVolId) : [];
	const bookChars = chars.filter((c) => !(inVolume && c.vol === activeVolId));

	parts.push("\n== 故事情况 · 书籍级 ==");
	if ((input.includeOutline !== false) && outline) {
		parts.push(`\n【全书大纲】\n${stripForeshadowMarks(outline)}`);
		if (/<角色\s*[：:]|<场景\s*[：:]/.test(outline)) {
			parts.push("（大纲中 <角色：...>/<场景：...> 标记处，需在对应情节简单描写该角色与场景）");
		}
	}
	renderCharBlock("【书籍角色设定】", bookChars);
	if (bookRel) parts.push(`\n【书籍人物关系】\n${bookRel}`);

	// v0.1.4+：前文窗口跨卷缺口——本卷内不足 prevN 章时以最近各前卷《卷摘要》填充（由近及远），不拉取他卷章节细节
	if ((input.prevN ?? 3) > 0 && (input.chapterNum > 1) && (input.prevVolSummaries?.length)) {
		for (const pv of input.prevVolSummaries) parts.push(`\n【前卷摘要 · ${pv.name}】\n${pv.text}`);
	}

	const prevN = input.prevN ?? 3;
	if (input.chapterNum > 1 && prevN > 0) {
		const labelAt = (i: number): string => input.prevChapters.find((p) => p.num === i)?.label || `第${i}章`;
		// v0.1.4+：窗口可能因跨卷限制/空章出现缺口——标题与遍历范围按实际收录章节的 min/max ordinal，缺位自动跳过
		const present = input.prevChapters.filter((p) => p.content.trim());
		if (present.length) {
			const first = Math.min(...present.map((p) => p.num));
			const last = Math.max(...present.map((p) => p.num));
			parts.push(`\n【前文内容】（${labelAt(first)}至${labelAt(last)}）`);
			for (let i = first; i <= last; i++) {
				const prev = input.prevChapters.find((p) => p.num === i);
				if (!prev || !prev.content) continue;
				const summary = ((input.summaries[i] || "")).trim();
				parts.push(`\n--- ${labelAt(i)} ${prev.title || ""} ---`);
				if (summary) {
					parts.push(`[摘要] ${summary}`);
				} else {
					const preview = prev.content.slice(0, 500);
					parts.push(preview);
					if (prev.content.length > 500) parts.push("[...内容省略...]");
				}
			}
		}
	}

	const ws = input.world;
	if (ws && (ws.name || ws.world_type || (ws.rules?.length) || (ws.factions?.length) || (ws.locations?.length) || ws.history || ws.magic_system)) {
		parts.push("\n【世界观设定】");
		if (ws.name) parts.push(`  世界：${ws.name}`);
		if (ws.world_type) parts.push(`  类型：${ws.world_type}`);
		if (ws.rules?.length) parts.push(`  规则：${ws.rules.join("；")}`);
		if (ws.factions?.length) parts.push(`  势力：${ws.factions.join("；")}`);
		if (ws.locations?.length) parts.push(`  地点：${ws.locations.join("；")}`);
		if (ws.history) parts.push(`  历史：${ws.history}`);
		if (ws.magic_system) parts.push(`  力量体系：${ws.magic_system}`);
	}

	const allScenes = new Map(input.scenes.map((s) => [s.scene_id, s]));
	const exclScenes = new Set(input.excludeSceneIds || []); // 本章目录《场景.md》归属者已由 folderDocs【本章场景】原文渲染
	const sceneList: SceneDoc[] = [];
	for (const sid of Array.from(mentioned.sceneIds).sort()) {
		const sc = allScenes.get(sid);
		if (sc && !exclScenes.has(sc.scene_id)) sceneList.push(sc);
	}
	if (input.currentSceneId) {
		const cur = allScenes.get(input.currentSceneId);
		if (cur && !exclScenes.has(cur.scene_id) && !sceneList.some((s) => s.scene_id === cur.scene_id)) sceneList.push(cur);
	}
	const renderSceneBlock = (heading: string, list: SceneDoc[], multiple: boolean): void => {
		if (!list.length) return;
		parts.push(`\n${heading}`);
		for (const scene of list) {
			let indent: string;
			if (multiple) {
				const marker = scene.scene_id === input.currentSceneId ? "（当前场景）" : "";
				parts.push(`  - ${scene.scene_id}${marker}`);
				indent = "    ";
			} else {
				parts.push(`  ${scene.scene_id}`);
				indent = "  ";
			}
			if (scene.description) parts.push(`${indent}描述：${scene.description}`);
			if (scene.characters?.length) parts.push(`${indent}角色：${scene.characters.join("、")}`);
			if (scene.content) parts.push(`${indent}场景正文：${scene.content.slice(0, 500)}`);
		}
	};
	const multiScenes = sceneList.length > 1;
	const volScenes = inVolume ? sceneList.filter((s) => s.vol === activeVolId) : [];
	const bookScenes = sceneList.filter((s) => !(inVolume && s.vol === activeVolId));
	renderSceneBlock(inVolume ? "【书籍场景】" : multiScenes ? "【场景】" : "【当前场景】", bookScenes, multiScenes);

	if (inVolume) {
		parts.push(`\n== 故事情况 · 卷级（${volTitle}） ==`);
		if (input.volOutlineText && input.includeOutline !== false) parts.push(`\n【本卷大纲】\n${stripForeshadowMarks(input.volOutlineText)}`);
		const vs = (input.volSummary || "").trim();
		if (vs) parts.push(`\n【卷摘要】\n${vs}`);
		if (volRel) parts.push(`\n【本卷人物关系】\n${volRel}`);
		renderCharBlock("【本卷角色设定】", volChars);
		renderSceneBlock("【本卷场景】", volScenes, multiScenes);
	}

	const undone = (input.foreshadows || []).filter((f) => !f.done);
	const plots = (input.plots || []).slice().sort((a, b) => a.chapter - b.chapter);
	if (undone.length || plots.length) {
		parts.push("\n【伏笔提示（未完成，次要内容，可暂不处理）】");
		for (const f of undone) {
			const who = f.character || "（未注明人物）";
			parts.push(`  - ${chapterKeyLabel(f.chapter, input.volumeNames)} ${who}：${f.reason ?? ""}`);
		}
		for (const p of plots) {
			if ((p.status ?? "") !== "completed") parts.push(`  - ${p.id}（第${p.chapter}章）：${p.description ?? ""}`);
		}
	}

	// 章级小节：本章目录文档（调用方已从 folderDocs 剔除《人物关系.md》，改经 chapterRelationships 单独传入以参与跨层去重）
	const chFolder = (input.folderDocs || "").trim();
	if (chFolder || chRel) {
		parts.push(`\n== 故事情况 · 章级（${inVolume ? `${volTitle}·` : ""}${chLabel}） ==`);
		if (chFolder) parts.push(`\n${chFolder}`);
		if (chRel) parts.push(`\n【本章人物关系】\n${chRel}`);
	}
	return parts.join("\n");
}

// ---------- 编写类型系统提示词（对应 writer.py _story_type_system_prompt / _story_type_confirm_line） ----------

export function storyTypeOf(writingStyle?: string): string {
	return (writingStyle || "").trim() || DEFAULT_STORY_TYPE;
}

export interface StoryTypePromptInput {
	storyType?: string;
	guideText?: string;
	title?: string;
	charNames?: Array<string | null>;
	bannedGuideText?: string;
	skillsBlock?: string;
}

/** 组装「编写类型 + 禁用词 + skills」系统提示词块 */
export function buildStoryTypeSystemPrompt(input: StoryTypePromptInput): string {
	const storyType = storyTypeOf(input.storyType);
	const block = getStoryTypeGuide(storyType, input.guideText || "", input.title || "", input.charNames);
	const bannedBlock = buildMergedBannedBlock(input.bannedGuideText || "");
	const parts: string[] = [];
	if (block) parts.push(block);
	if (bannedBlock) parts.push(bannedBlock);
	if (input.skillsBlock) parts.push(input.skillsBlock);
	if (!parts.length) return "";
	const head = parts.join("\n\n");
	const tail =
		"\n\n【强制要求】\n" +
		`本小说确定的编写类型是「${storyType}」。你必须严格按照上面的【编写类型】格式要求输出，这是不可违背的硬性规定：\n` +
		"1. 输出格式必须完全符合该类型（网文=分段叙述、剧本=场景标题+角色名+台词+舞台指示、普通小说=散文叙事、散文随笔=写意随笔），不得混用其它文体格式\n" +
		"2. 若生成内容不符合该类型的格式特征，即为不合格，需要重写\n" +
		"3. 写作指南（创作规范）中与该类型要求冲突的条目，以本【编写类型】为准\n" +
		"4. 开始输出前先在脑中对照该类型的格式清单，确认每一段都符合";
	return storyType ? head + tail : head;
}

export function storyTypeConfirmLine(storyType?: string): string {
	const t = storyTypeOf(storyType);
	if (!t) return "";
	return `【编写类型确认】本小说编写类型为「${t}」，请严格按该类型的格式输出（完整格式要求见系统提示词）。`;
}

// ---------- 编写类型格式校验与重试（对应 writer.py _validate_story_type_format / format_retry_note） ----------

/** 返回空串表示通过；否则返回不合规原因 */
export function validateStoryTypeFormat(content: string, writingStyle?: string): string {
	const storyType = storyTypeOf(writingStyle);
	content = content || "";
	if (storyType === "剧本") {
		const hasSceneTitle = /(?:第[一二三四五六七八九十百\d]+[幕场])|【场景|【第/.test(content);
		const hasDialogueMark = /^[^\n：]{1,8}：[^\n]{2,}/m.test(content);
		if (!(hasSceneTitle || hasDialogueMark)) {
			return "输出缺少剧本格式特征（场景标题/角色名+台词），不是标准剧本体";
		}
		return "";
	}
	if (storyType === "网文小说") {
		const scriptLike = /【第[一二三四五六七八九十百\d]+幕】|【场景|（[^\n]{2,30}）[：:]/.test(content);
		if (scriptLike) return "输出混用了剧本/舞台格式，网文小说应使用连续叙述段落";
		return "";
	}
	return "";
}

export function formatRetryNote(writingStyle: string | undefined, reason: string): string {
	return (
		"\n\n【格式修正要求】\n" +
		`你上次的输出不符合编写类型「${storyTypeOf(writingStyle)}」：${reason}\n` +
		"请严格按照【编写类型】格式要求重新输出，不要重复上次的错误格式。"
	);
}

// ---------- 描写风格指南开关（对应 writer.py _desc_style_guide） ----------

/** desc_style == "complete" 时返回完整描写风格要求 */
export function descStyleGuide(descStyle?: string): string {
	return ((descStyle || "").trim().toLowerCase() === "complete") ? DESC_STYLE_GUIDE_COMPLETE : "";
}

// ---------- 大纲块辅助（对应 writer.py _chapter_outline_one_line / _prev_outlines_block / _outline_bridge_block） ----------

/** v0.0.15：阅读序大纲条目展示引用（label=容器内展示名，如「第5章」「第二卷·第3章」） */
export interface OutlineRef {
	label: string;
	text?: string;
}

function outlineOneLine(ref: OutlineRef | undefined): string {
	if (!ref) return "";
	const stripped = stripOutlineMarkers(ref.text || "");
	if (!stripped) return "";
	return `- ${ref.label}大纲：${stripped}`;
}

export function buildPrevOutlinesBlock(prevs: OutlineRef[]): string {
	const items = prevs.map(outlineOneLine).filter(Boolean);
	if (!items.length) return "";
	return "【前提提要（前文各章大纲）】\n" + items.join("\n");
}

export function buildOutlineBridgeBlock(refs: { prev?: OutlineRef; cur?: OutlineRef; nxt?: OutlineRef }): string {
	const parts: string[] = [];
	const prev = outlineOneLine(refs.prev);
	const cur = outlineOneLine(refs.cur);
	const nxt = outlineOneLine(refs.nxt);
	if (prev && refs.prev) parts.push(`【前情提要（${refs.prev.label}大纲）】\n${prev}`);
	if (cur && refs.cur) parts.push(`【当前情节（${refs.cur.label}大纲）】\n${cur}`);
	if (nxt && refs.nxt) parts.push(`【后续发展（${refs.nxt.label}大纲）】\n${nxt}`);
	return parts.join("\n\n");
}

// ---------- /write 章节提示词（对应 writer.py _build_chapter_prompt） ----------

/** 去掉伏笔标记，返回干净大纲与抽取出的伏笔（v0.0.15：scopeKey=复合键，未提供时不归属任何容器） */
export function prepareOutlineForPrompt(
	outline: string,
	scopeKey?: string
): { cleaned: string; foreshadows: ForeshadowItem[] } {
	if (!outline) return { cleaned: "", foreshadows: [] };
	const foreshadows = scopeKey ? extractForeshadows(outline, scopeKey) : [];
	return { cleaned: stripForeshadowMarks(outline), foreshadows };
}

export interface ChapterPromptInput {
	chapterNum: number; // v0.0.15：阅读序位置（ordinal）
	chapterLabel?: string; // 目标章展示名（含卷前缀），缺省「第N章」
	chapterKey?: string; // 复合键；[伏] 标记默认归属容器
	chapterOutlineRaw: string;
	userInstruction?: string;
	context: string;
	wordRange: [number, number];
	descStyle?: string;
	storyType?: string;
	prevOutlines: OutlineRef[];
}

export function buildChapterPrompt(input: ChapterPromptInput): { prompt: string; foreshadows: ForeshadowItem[] } {
	const prepared = prepareOutlineForPrompt(input.chapterOutlineRaw || "", input.chapterKey);
	const chapterOutline = prepared.cleaned;
	const label = (input.chapterLabel || `第${input.chapterNum}章`).trim();
	const [wordLow, wordHigh] = input.wordRange;
	const parts: string[] = [];
	parts.push(`请创作${label}`);
	if (chapterOutline) {
		parts.push(`章节大纲：${chapterOutline}`);
		const markerGuide = buildOutlineMarkerGuide(chapterOutline);
		if (markerGuide) parts.push(markerGuide);
		const roleSceneGuide = buildRoleSceneGuide(chapterOutline);
		if (roleSceneGuide) parts.push(roleSceneGuide);
		parts.push(
			"【大纲约束】必须严格按以上章节大纲创作：大纲中的每个情节要点都必须写到，" +
			"不得遗漏、不得合并或跳过（除非大纲标注[跳]）；情节顺序遵循大纲，" +
			"不得自行调换或偏离大纲走向；不得擅自添加与大纲无关的大段情节或角色，" +
			"细节补充只能服务于大纲要点；除非用户明确要求调整，否则以大纲为准。"
		);
	}
	const prevOutlines = buildPrevOutlinesBlock(input.prevOutlines || []);
	if (prevOutlines) parts.push(prevOutlines);
	if (input.userInstruction) parts.push(`用户要求：${input.userInstruction}`);
	const descGuide = descStyleGuide(input.descStyle);
	if (descGuide) parts.push(descGuide);
	parts.push(`\n以下是写作上下文：\n${input.context}`);
	const storyType = storyTypeOf(input.storyType);
	if (storyType) {
		parts.push("\n" + storyTypeConfirmLine(storyType));
	}
	parts.push(
		"\n请创作本章内容，要求：" +
		`\n1. 严格按【章节大纲】创作：大纲中的每个情节要点都必须写到，顺序遵循大纲，不得遗漏、不得偏离主线，不得自行添加大段无关情节\n` +
		`2. 总字数严格控制在${wordHigh}字以内（目标${wordLow}-${wordHigh}字）：不足${wordLow}字继续充实，达到${wordHigh}字必须收尾，严禁超限\n` +
		"3. 与前后文保持连贯\n4. 人物性格一致\n5. 情节合理推进\n6. 适当使用对话、描写、心理活动\n7. 章节结尾自然收束\n8. 文风自然平实，画面感来自具体细节，避免华丽形容词堆砌\n9. 不要使用常见的比喻（如\"像……一样\"\"如……般\"\"仿佛……\"），表达方式要普通，能直说就直说\n\n请直接输出正文内容，不要包含任何标题或额外说明。"
	);
	return { prompt: parts.join("\n"), foreshadows: prepared.foreshadows };
}

// ---------- /continue 续写提示词（对应 writer.py _build_continue_prompt） ----------

export interface ContinuePromptInput {
	chapterNum: number; // v0.0.15：阅读序位置（ordinal）
	chapterLabel?: string; // 目标章展示名（含卷前缀），缺省「第N章」
	chapterKey?: string; // 复合键；[伏] 标记默认归属容器
	userInstruction?: string;
	context: string;
	globalOutlineRaw: string;
	chapterOutlineRaw: string;
	prevOutlines: OutlineRef[];
	descStyle?: string;
	storyType?: string;
	currentSummary?: string;
	existingContent: string;
	wordRange: [number, number];
}

export function buildContinuePrompt(input: ContinuePromptInput): { prompt: string; foreshadows: ForeshadowItem[] } {
	const globalPrep = prepareOutlineForPrompt(input.globalOutlineRaw || "", input.chapterKey);
	const chapterPrep = prepareOutlineForPrompt(input.chapterOutlineRaw || "", input.chapterKey);
	const label = (input.chapterLabel || `第${input.chapterNum}章`).trim();
	// v0.0.15：全局/本章大纲全文已由写作上下文（三层结构）注入，此处不再重复；仅保留标记语义说明与伏笔抽取
	const chapterOutline = chapterPrep.cleaned;
	const prevBlock = buildPrevOutlinesBlock(input.prevOutlines || []);
	const descGuide = descStyleGuide(input.descStyle);
	const confirmLine = storyTypeConfirmLine(input.storyType);
	const tail1000 = (input.existingContent || "").slice(-1000);
	const [wordLow, wordHigh] = input.wordRange;
	const prompt = `
${confirmLine}
以下是${label}的已有内容，请继续续写：

 ${input.context}

 ${!globalPrep.cleaned && !chapterPrep.cleaned ? "【大纲提示】当前尚无全局大纲或本章大纲，请按前文脉络自然续写。\n\n" : ""}${buildOutlineMarkerGuide(chapterOutline)}

${buildRoleSceneGuide(chapterOutline)}

${prevBlock}

${descGuide}

【本章已有内容摘要】
${input.currentSummary || "（无）"}

【已有内容（末尾1000字，保持衔接）】
${tail1000}

${input.userInstruction ? `【续写要求】${input.userInstruction}` : "请按两级大纲自然续写，保持文风一致。"}

请续写约${Math.trunc(wordLow * 0.3)}-${Math.trunc(wordHigh * 0.4)}字（单次续写不要超过${wordHigh}字），注意：
1. 严格按全局大纲与本章大纲续写：大纲列出的情节要点必须写到，不得自行扩展与大纲无关的大段内容
2. 与前文自然衔接
3. 保持人物性格一致
4. 适当使用对话和描写
5. 不要使用常见的比喻，表达方式要普通，直接说`;
	const foreshadows = [...globalPrep.foreshadows, ...chapterPrep.foreshadows];
	return { prompt, foreshadows };
}

// ---------- 卷摘要（v0.0.15+：随章节增加自动增量提取；插件特有，CLI 无对应概念） ----------

export const VOL_SUMMARY_SYSTEM_PROMPT = "你是小说创作助理，负责依据整卷各章节的摘要生成完整的卷级摘要。";

export interface VolRebuildChapterLine {
	label: string; // 展示标签（含卷名前缀），如「第2卷·第3章」
	title?: string; // 章节标题
	summary: string; // 该章 AI 摘要文本
}

/** v0.1.4+ 卷摘要全量重建提示词——以本卷全部成员章的新鲜 AI 摘要为唯一输入按阅读序重建（取代旧「最新章节增量合并」滚动法：多轮有损压缩会丢失早期章节信息）。上下文组装时延迟触发 */
export function buildVolRebuildPrompt(volumeName: string, chapterLines: Array<VolRebuildChapterLine>): string {
	const blocks = chapterLines.map((c) => `--- ${c.label}${c.title ? ` ${c.title}` : ""} ---\n${c.summary}`).join("\n\n");
	return `请根据下面「${volumeName}」全部 ${chapterLines.length} 个章节的摘要（按阅读顺序排列），为该卷生成一份完整的卷级摘要。要求：
- 完整覆盖全卷情节主线与关键转折，不要遗漏任何一章的核心事件
- 梳理主要人物在全卷中的状态/关系变化轨迹（从开卷到当前）
- 保留本卷尚未回收的伏笔与悬念
- 控制在 400~600 字；只保留对后续创作有用的信息
直接输出新的卷摘要正文，不要标题、解释或任何格式标记。

【各章摘要 · 阅读序】
${blocks}`;
}

// ---------- 章节摘要（对齐 CLI writer.py _summarize_chapter：正文写盘后/上下文组装时缺失即生成，落 <章目录>/章节摘要.md）----------

export const CHAPTER_SUMMARY_SYSTEM_PROMPT = "你是小说创作助理，负责为小说章节提炼简洁、信息完整的摘要。";

/** 章节摘要生成提示词（逐字对齐 CLI `_summarize_chapter`；无正文时按大纲概括并加标注） */
export function buildChapterSummaryPrompt(chapterLabel: string, sourceText: string, viaOutline?: boolean): string {
	return `请把下面这章小说压缩成 200~300 字的章节摘要，只保留对后续创作有用的信息：
- 关键情节：本章发生了什么事，章末落点是什么
- 人物状态：出场角色的处境、情绪、关系变化
- 伏笔与悬念：埋下的伏笔、未解决的悬念
- 新增信息：揭示的世界观、设定或线索

直接输出摘要正文，不要标题、不要解释、不要任何格式标记。

章节：${chapterLabel}${viaOutline ? "（暂无正文，依据本章大纲概括）" : ""}
---
${sourceText}`;
}

// ---------- /rewrite 重写提示词（对应 writer.py rewrite_chapter 的 f-string） ----------

export interface RewritePromptInput {
	chapterNum: number; // v0.0.15：阅读序位置（ordinal）
	chapterLabel?: string; // 目标章展示名（含卷前缀），缺省「第N章」
	userInstruction?: string;
	context: string;
	bridge: { prev?: OutlineRef; cur?: OutlineRef; nxt?: OutlineRef };
	oldContent: string;
	currentSummary?: string;
	wordRange: [number, number];
	storyType?: string;
}

export function buildRewritePrompt(input: RewritePromptInput): string {
	const bridge = buildOutlineBridgeBlock(input.bridge || {});
	const label = (input.chapterLabel || `第${input.chapterNum}章`).trim();
	const oldContent = input.oldContent || "";
	const summaryBlock = oldContent ? `【本章摘要】\n${input.currentSummary || "（无）"}` : "（本章暂无内容）";
	const oldContentBlock = oldContent ? `【原章节内容（仅作为参考起点）】\n${oldContent.slice(0, 4500)}` : "";
	const confirmLine = storyTypeConfirmLine(input.storyType);
	const [wordLow, wordHigh] = input.wordRange;
	return `
${confirmLine}
这是 /rewrite 命令——**重构改写**当前章节。你可以大幅调整情节走向、结构安排和叙事方式，与原内容可以完全不同。

请重写${label}。

【写作上下文】
${input.context}

${bridge || "（暂无章节大纲）"}

${summaryBlock}

${oldContentBlock}

${input.userInstruction ? `【重写要求】${input.userInstruction}` : "请严格按本章大纲创作：大纲中的情节要点必须全部保留并逐一呈现，不得遗漏；在不偏离大纲走向的前提下，可自由调整表达与结构，不必受原文限制。"}

请创作本章正文，总字数严格控制在${wordHigh}字以内（目标${wordLow}-${wordHigh}字）：不足${wordLow}字继续充实细节；接近${wordHigh}字必须精简收尾，严禁超过${wordHigh}字。要求：
- **如果用户有具体重写方向**：严格遵循其指示（如"改为反派视角""增加反转""压缩节奏"等），可完全改变情节走向
- **如果没有特殊要求**：基于大纲自由发挥，但尽量与原文风格一致
- **必须保留的**：角色性格一致性、本章与全局大纲约束（大纲要点不得遗漏）、与前文/后文的衔接逻辑
- **可以改变的**：事件顺序、描写详略、对话比重、叙事角度、悬念设置

请直接输出正文内容，不要包含额外说明。`;
}

// ---------- /review 审阅提示词（对应 writer.py review_chapter 的 f-string） ----------

export interface ReviewPromptInput {
	chapterNum: number; // v0.0.15：阅读序位置（ordinal）
	chapterLabel?: string; // 目标章展示名（含卷前缀），缺省「第N章」
	userInstruction?: string;
	context: string;
	bridge: { prev?: OutlineRef; cur?: OutlineRef; nxt?: OutlineRef };
	chapterContent: string;
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
	const bridge = buildOutlineBridgeBlock(input.bridge || {});
	const label = (input.chapterLabel || `第${input.chapterNum}章`).trim();
	return `请以全局视角审阅小说${label}，找出其中不合逻辑之处与剧情问题。

【写作上下文（含全局大纲、角色设定、前文摘要、世界观）】
${input.context}

${bridge || "（暂无章节大纲）"}

【本章全文】
${(input.chapterContent || "").slice(0, 6000)}

${input.userInstruction ? `【重点审阅要求】${input.userInstruction}` : ""}

请输出审阅报告，包含以下部分：
1. **本章概述**：本章讲了什么，在全局中的位置与作用（一两句话）
2. **逻辑问题**：时间线、因果、设定前后矛盾、人物行为不合常理之处（逐条列出，说明问题与依据）
3. **小说连贯性**：与前后章衔接、伏笔呼应、全局大纲推进是否符合
4. **人物一致性**：性格、能力、动机是否与角色设定及前文一致
5. **建议**：针对每个问题给出具体修改建议

要求：只做分析和建议，不重写正文；以清晰的 Markdown 列表输出。`;
}

// ---------- /polish 润色提示词（对应 writer.py polish_chapter 的 f-string） ----------

export interface PolishPromptInput {
	text: string;
	style?: string;
	summary?: string;
	storyType?: string;
}

export function buildPolishPrompt(input: PolishPromptInput): string {
	const summaryBlock = input.summary ? `【本章摘要】\n${input.summary}` : "";
	return `
${storyTypeConfirmLine(input.storyType)}
这是 /polish 命令——**仅润色编辑文字表达**。不改变情节走向、人物行为或小说内容。

${input.style ? `【风格要求】${input.style}` : ""}

${summaryBlock}

【原文】
${(input.text || "").slice(0, 4500)}

请按以下规则执行：
- **可以做的**：优化措辞、调整句式、让语言更自然流畅、统一文风、修复语病、改善节奏
- **不能做的**：删减/增加小说情节、改变角色行为动机、改动场景设定、新增或删除关键信息
- **必须保留的**：所有事件顺序、角色对话的核心含义、设定的细节、章节的节奏结构

请直接输出润色后的正文，不要添加任何标题、说明或格式标记（如 # Title）。
只输出纯文本正文。`;
}

// ---------- /deai 去AI味（对应 writer.py _rewrite_ai_sentences + clean_ai_phrases） ----------

/** LLM 改写调用注入点 */
export type AiRewriteFn = (prompt: string, maxTokens: number) => Promise<string>;

function aiLineContext(text: string, start: number, end: number): string {
	const lineStartIdx = start === 0 ? -1 : text.lastIndexOf("\n", start - 1);
	const lineEndRaw = text.indexOf("\n", end);
	const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
	return text.slice(lineStartIdx + 1, lineEnd).trim() || text.slice(start, end);
}

/** 组装逐句去AI味的改写提示词 */
export function buildDeaiPrompt(text: string, sentences: AiSentence[]): string {
	const items: string[] = [];
	sentences.forEach((s, i) => {
		const desc = [...new Set(s.hits.map((h) => h.word))].join("、") || "AI腔表达";
		items.push(`${i + 1}. 上下文：${aiLineContext(text, s.start, s.end)}\n   句子（含AI腔：「${desc}」）：${s.sentence}`);
	});
	return (
		"这是小说正文的「去AI味」改写任务。下面每一句都包含 AI 常用词/套话" +
		"（如「只见」「顿时」「眼中闪过一丝」「嘴角勾起一抹」「瞳孔猛地一缩」" +
		"「倒吸一口凉气」「心头一震」「化作」等），需要逐句改写。\n\n" +
		"改写规则：\n" +
		"1. 只替换或删掉句中的 AI 腔表达，用具体动作、细节或大白话替代\n" +
		"2. 保留原句含义、情节信息、人物与叙述视角，不增删剧情信息\n" +
		"3. 否定对比句式删掉否定列举，只留肯定内容：「不是…是…」「不像…像…」「不像…倒像…」" +
		"只留「是/像」后面；「不是…也不是…而是…」只留「而是」后面；" +
		"「没有…也没有…就是/只是/就像…」只留「就是/只是/就像」后面\n" +
		"4. 「那种…，…的…」类重复强调句式：删掉逗号前的重复词，合并为一句" +
		"（如「那种痛，撕心裂肺的痛」→「那种撕心裂肺的痛」）\n" +
		"5. 不合并、不拆分句子；对话与引号、标点保持完整\n" +
		"6. 句子本身没有 AI 腔时原样输出\n" +
		"7. 改写后要与上下文衔接自然，保持原写作风格\n\n" +
		"【待改写句子】\n" + items.join("\n") +
		"\n\n请严格按以下格式逐条输出，每行一条：\n" +
		"1：改写后的句子\n2：改写后的句子\n……\n" +
		"只输出编号行，不要任何解释或多余内容。"
	);
}

/** 解析 LLM 返回的「N：改写句」列表；无编号行时回退为按行取值 */
export function parseAiRewrites(raw: string, count: number): Record<number, string> {
	const result: Record<number, string> = {};
	if (!raw || !raw.trim()) return result;
	const parsed: Array<[string, string]> = [];
	const re = /^\s*(\d{1,3})\s*[:：]\s*(.+?)\s*$/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw)) !== null) parsed.push([m[1], m[2]]);
	if (parsed.length) {
		for (const [numS, content] of parsed) {
			const idx = parseInt(numS, 10) - 1;
			if (idx >= 0 && idx < count) result[idx] = content.trim();
		}
		return result;
	}
	raw.split("\n")
		.map((ln) => ln.trim())
		.filter(Boolean)
		.slice(0, count)
		.forEach((ln, idx) => {
			result[idx] = ln;
		});
	return result;
}

export interface CleanReport {
	rounds: number;
	simplified: Array<[string, string]>;
	replaced: Array<[string, string]>;
	remaining: AiHit[];
	errors: string[];
}

/** 去AI味主流程：先做句式简化，再最多 maxRounds 轮 LLM 逐句改写 */
export async function cleanAiText(text: string, rewrite: AiRewriteFn, maxRounds = 2): Promise<{ text: string; report: CleanReport }> {
	const emptyReport: CleanReport = { rounds: 0, simplified: [], replaced: [], remaining: [], errors: [] };
	if (!text || !text.replace(/\s/g, "")) return { text, report: emptyReport };
	let current = text;
	const report: CleanReport = { rounds: 0, simplified: [], replaced: [], remaining: [], errors: [] };
	const [simp1, simPairs] = simplifyNegationContrast(current);
	if (simPairs.length) {
		report.simplified.push(...simPairs);
		current = simp1;
	}
	const [merged, repPairs] = simplifyEmphaticRepetition(current);
	if (repPairs.length) {
		report.simplified.push(...repPairs);
		current = merged;
	}
	for (let rnd = 1; rnd <= maxRounds; rnd++) {
		const sentences = findAiSentences(current);
		if (!sentences.length) break;
		report.rounds = rnd;
		const prompt = buildDeaiPrompt(current, sentences);
		const maxTokens = Math.min(8192, sentences.length * 300 + 1024);
		const raw = await rewrite(prompt, maxTokens);
		const rewriteMap = parseAiRewrites(raw || "", sentences.length);
		for (let idx = sentences.length - 1; idx >= 0; idx--) {
			const s = sentences[idx];
			const newS = ((rewriteMap[idx] || "")).trim();
			if (!newS) {
				report.errors.push(s.sentence);
				continue;
			}
			if (newS === s.sentence) continue;
			current = current.slice(0, s.start) + newS + current.slice(s.end);
			report.replaced.push([s.sentence, newS]);
		}
	}
	report.remaining = findAiWordHits(current);
	return { text: current, report };
}

/** 对齐 Python WritingMixin._strip_heading：剥离 LLM 输出开头的 MD 标题行与纯文本章节名（追加前防重复标题） */
export function stripHeading(content: string): string {
	let result = content || "";
	const mdPattern = /^\s*#+\s+.+?(?=\n|$)/m;
	for (let i = 0; i < 10; i++) {
		const next = result.replace(mdPattern, "");
		if (next === result) break;
		result = next;
	}
	const plainPattern = /^[第]?[一二三四五六七八九十百\d]+[章回][：:\s]*.+?(?=\n|$)/m;
	for (let i = 0; i < 10; i++) {
		const next = result.replace(plainPattern, "");
		if (next === result) break;
		result = next;
	}
	return result.replace(/^\s*\n+/, "").trim();
}

/** 对齐 cmd_write/cmd_continue 的要点合并语义：`- {label}：{instruction}`，已存在同内容则不重复追加 */
export function appendOutlineInstruction(outline: string, label: string, instruction: string): string {
	const line = `- ${label}：${instruction}`;
	const bare = line.replace(/^[- ]*/, "");
	const lines = outline ? [outline] : [];
	if (!lines.some((l) => l.includes(bare) || l.includes(line))) lines.push(line);
	return lines.filter((l) => l.trim()).join("\n");
}

// ---------- 大纲覆盖率检查（对应 WritingMixin._check_outline_coverage） ----------

/** 检查正文是否已覆盖大纲全部要点；返回 [allCovered, 未覆盖要点列表]。无 bullet 时按非空行整体判断 */
export function checkOutlineCoverage(content: string, outline: string): { allCovered: boolean; uncovered: string[] } {
	if (!content || !outline) return { allCovered: false, uncovered: [] };
	const BULLET_LINE_RE = /^[-*•]\s+(.+)$/gm; // 函数内局部正则：每次调用全新实例，无 lastIndex 残留
	const bulletsRaw: string[] = [];
	let bl: RegExpExecArray | null;
	while ((bl = BULLET_LINE_RE.exec(String(outline))) !== null) { // exec 循环替代 matchAll(ES2020)，/m 行语义与旧版逐位一致
		bulletsRaw.push(bl[1].trim());
	}
	const bullets = bulletsRaw.length ? bulletsRaw : String(outline).split("\n").map((l) => l.trim()).filter(Boolean);
	if (!bullets.length) return { allCovered: false, uncovered: [] };
	const checkBullet = (bullet: string, text: string): boolean => {
		const chineseWords = bullet.match(/[一-鿿]{2,}/g) ?? [];
		if (!chineseWords.length) return false;
		const matchedCount = chineseWords.filter((w) => text.includes(w)).length;
		if (matchedCount === chineseWords.length) return true;
		const threshold = Math.max(Math.floor(chineseWords.length / 2) + 1, 2);
		if (matchedCount >= threshold) return true;
		// 单长串子短语兜底（最长到最短）
		if (chineseWords.length === 1 && chineseWords[0].length >= 5) {
			const n = chineseWords[0].length;
			for (let length = Math.min(n, 6); length > 2; length--) {
				const step = Math.max(Math.floor(length / 3), 1);
				for (let i = 0; i <= n - length; i += step) {
					if (text.includes(chineseWords[0].slice(i, i + length))) return true;
				}
			}
		}
		// 策略2：bullet 长度>=3 的子串逐一匹配兜底
		const n = bullet.length;
		for (let length = Math.min(n, 8); length > 2; length--) {
			const step = Math.max(Math.floor(length / 3), 1);
			for (let i = 0; i <= n - length; i += step) {
				const sub = bullet.slice(i, i + length);
				if (sub && text.includes(sub)) return true;
			}
		}
		return false;
	};
	const uncovered: string[] = [];
	for (const b of bullets) if (!checkBullet(b, content)) uncovered.push(b);
	return { allCovered: uncovered.length === 0, uncovered };
}

// ---------- 三层创作规范：空模板生成 + 汇总文件序列化（纯函数）----------

/**
 * 由既有指南文本抽出「骨架」作为新建空模板：保留顶部多行说明注释块、结构性标记
 * （字数配置 / 写作指南分类±close / 编写类型±close）与全部 ##/### 段名，正文与各条
 * 备注一律清空。三级指南共用同一格式，故以系统级默认文本为唯一来源。
 */
export function buildEmptyGuideTemplate(src: string): string {
	const MARK = /^(?:字数配置|写作指南分类|\/写作指南分类|编写类型|\/编写类型)/; // CJK 非 \w，勿加 \b
	const isMarker = (c: string): boolean => {
		if (!/^<!--[^]*-->/.test(c.trim())) return false;
		const inner = c.replace(/^<!--\s*/, "").replace(/\s*-->\s*$/, "");
		return MARK.test(inner.trim());
	};
	const out: string[] = [];
	let inComment = false;
	for (const line of String(src || "").split("\n")) {
		const t = line.trim();
		if (!inComment) {
			if (t.startsWith("<!--")) {
				if (t.endsWith("-->") && t.length > 4) {
					if (isMarker(line)) out.push(line);
				} else {
					inComment = true;
					out.push(line);
				}
			} else if (/^#{1,6}\s/.test(t)) {
				out.push(line);
			}
		} else {
			out.push(line);
			if (t.includes("-->")) inComment = false;
		}
	}
	return out.join("\n").replace(/\s+$/, "") + "\n";
}

/** 汇总文件标题（书籍目录下《写作指南汇总.md》首行） */
export const AGG_TITLE = "# 写作指南汇总";

/**
 * 把正文里「空指示段」（标题之下到下一个同级/更高级标题之间没有任何内容行的 Markdown 小节）
 * 整体注释掉，并在连续成片的空段上方加一行提示注释——引导用户去 WRITING_GUIDE.md 填写；
 * 注入提示词前 stripComments 会剥掉全部 HTML 注释，故这些段落不参与生成。
 * - 代码围栏（``` / ~~~）内的 # 行不当标题；水平线（---/***）不算内容
 * - 父节为空时整块（含其下嵌套子标题）一次注释，不逐个子节重复提示
 */
export function commentOutEmptySections(text: string): string {
	const lines = String(text || "").split("\n");
	const n = lines.length;
	const levelAt: number[] = [];
	let fence = false;
	for (let i = 0; i < n; i++) {
		levelAt[i] = 0;
		const t = lines[i].trim();
		if (/^(`{3,}|~{3,})/.test(t)) { fence = !fence; continue; } // 围栏开关行本身也不参与判定
		if (!fence) {
			const m = /^(#{1,6})(?:\s|$)/.exec(t);
			if (m) levelAt[i] = m[1].length;
		}
	}
	const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
	const endOf = (i: number): number => { // 小节范围 [i, end)，止于下一个同级或更高级标题
		const lv = levelAt[i];
		for (let j = i + 1; j < n; j++) if (levelAt[j] > 0 && levelAt[j] <= lv) return j;
		return n;
	};
	const hasContent = (a: number, b: number): boolean => {
		for (let k = a + 1; k < b; k++) {
			const t = lines[k].trim();
			if (!t || levelAt[k] > 0 || HR_RE.test(t)) continue;
			return true;
		}
		return false;
	};
	type Claim = { start: number; end: number };
	const claims: Claim[] = [];
	let claimedEnd = -1;
	for (let i = 0; i < n; i++) {
		if (!levelAt[i] || i < claimedEnd) continue; // 已被空父节整块注释的嵌套子标题跳过
		const e = endOf(i);
		if (!hasContent(i, e)) {
			const prev = claims[claims.length - 1];
			if (prev && prev.end === i) prev.end = e; // 相邻空段合并成一片，共用一条提示
			else claims.push({ start: i, end: e });
			claimedEnd = e;
		}
	}
	const HINT = "<!-- 以下段落暂无内容：请在 WRITING_GUIDE.md（小说级/用户级）对应章节填入写作要求；保存后本汇总自动刷新，这些段落即参与提示词生成 -->";
	for (let c = claims.length - 1; c >= 0; c--) {
		const cl = claims[c];
		const body = lines.slice(cl.start, cl.end).join("\n").replace(/\s+$/, ""); // 去掉尾随空行再包注释
		lines.splice(cl.start, cl.end - cl.start, HINT, "<!--", body, "-->");
	}
	return lines.join("\n");
}

/**
 * 把 mergeGuideCategories 的合并结果序列化为可再次解析的 MD：通用内容裸放，其余分类用
 * 「<!-- 写作指南分类:X -->…<!-- /写作指南分类 -->」包裹——与三层原格式一致，喂回
 * extractGuideCategories/mergeGuideCategories 即幂等。空分类不输出对应块。
 * 各分类先经 commentOutEmptySections：空指示段整体转 HTML 注释并在上方加填写提示
 * （注入前 stripComments 剥掉，不参与提示词）。
 */
export function serializeAggregateGuide(m: Record<string, string>): string {
	const parts: string[] = [];
	const general = commentOutEmptySections(String(m["通用"] || "")).trim();
	if (general) parts.push(general);
	for (const name of ["故事风格", "个人特色"]) {
		const v = commentOutEmptySections(String(m[name] || "")).trim();
		if (v) parts.push(`<!-- 写作指南分类:${name} -->\n${v}\n<!-- /写作指南分类 -->`);
	}
	const banned = commentOutEmptySections(String(m["禁用词"] || "")).trim();
	if (banned) parts.push(`<!-- 写作指南分类:禁用词 -->\n${banned}\n<!-- /写作指南分类 -->`);
	return AGG_TITLE + "\n\n" + parts.join("\n\n") + "\n";
}

/** 变更检测头（HTML 注释，注入前会被 stripComments 剥掉）：记录三层原文 md5 */
export interface AggHashes { b: string; u: string; s: string }
export function aggHashLine(h: AggHashes): string {
	return `<!-- agg-hash: b=${h.b} u=${h.u} s=${h.s} -->`;
}
export function embedAggHash(body: string, h: AggHashes): string {
	return aggHashLine(h) + "\n" + body;
}
const AGG_HASH_RE = /^<!--\s*agg-hash:\s*b=([0-9a-f]+)\s+u=([0-9a-f]+)\s+s=([0-9a-f]+)\s*-->/m;
export function parseAggHash(text: string): AggHashes | null {
	const m = AGG_HASH_RE.exec(String(text || ""));
	if (!m) return null;
	return { b: m[1], u: m[2], s: m[3] };
}
