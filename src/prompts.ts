import {
	CharacterDoc,
	ForeshadowItem,
	SceneDoc,
	extractForeshadows,
	stripComments,
	stripForeshadowMarks,
} from "./md_docs";
import {
	AiHit,
	AiSentence,
	BannedWordsData,
	findAiSentences,
	findAiWordHits,
	sentenceBoundsInLine,
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


/** 清洗人物关系文档（去一级标题行与注释；书/卷/章三层通用） */
export function cleanRelationshipsDoc(rawText: string): string {
	const t = (rawText || "").trim();
	if (!t) return "";
	const lines = t.split("\n");
	if (lines.length && lines[0].trim().startsWith("# ")) lines.shift();
	return stripComments(lines.join("\n").trim()).trim();
}


// ---------- 写作上下文组装（对应 story/context_builder.py get_context_for_writing） ----------

export interface PrevChapterRef {
	num: number; // v0.0.15：阅读序位置（ordinal，跨卷连续），非容器内本地章号
	key?: string; // 复合键「N」或「volId:N」
	label?: string; // 展示标签（跨卷时含卷名，如「第二卷·第3章」）
	title?: string;
	content: string;
}

/** v0.2.24+ 提示词文件装配改造：写作上下文的文档原文改由调用方经 assemblePromptFiles 按层级装配（bookDocs/volDocs/chapterDocs 三组块串），本输入只保留派生数据与结构化列表 */
export interface WritingContextInput {
	chapterNum: number; // v0.0.15：阅读序位置（ordinal，跨卷连续）；本地章号仅用于落盘与容器内引用
	localNum?: number; // 本章在所属容器的本地章号
	volumeName?: string; // 当前卷名（空/缺省 = 书根）
	chapterRanks?: Record<string, number>; // 复合键→阅读序位置；角色/场景可见性按容器排名判定
	title?: string;
	genre?: string;
	writingStyle?: string;
	currentSceneId?: string;
	globalOutlineRaw: string; // 全书大纲清洗全文（v0.2.25+ 起不再注入【全书大纲】块，仅供提及名检测；大纲标记提示改按实际注入文本判定）
	chapterOutlineText: string;
	characters: CharacterDoc[];
	scenes: SceneDoc[];
	activeVolId?: string; // 当前章所属卷 id；空 = 书根（无卷级小节）
	bookDocs?: string; // 书籍级文档装配组串（案头资料：世界观/大纲/人物关系…调用方 spec 顺序）
	volDocs?: string; // 卷级文档装配组串（卷大纲/卷人物关系…）
	chapterDocs?: string; // 章级文档装配组串（本章大纲/人物/场景/人物关系）
	excludeCharNames?: string[]; // 本章目录《人物.md》归属角色名——章级组串【本章人物设定】已全文渲染，结构化列表排除避免重复
	excludeSceneIds?: string[]; // 本章目录《场景.md》归属场景 id——同上
	volSummary?: string; // 最新卷摘要（<volDir>/卷摘要.md 内容哈希校验通过时非空）
	prevVolSummaries?: Array<{ name: string; text: string }>; // v0.1.4+：前文窗口跨卷缺口——以最近各前卷的新鲜《卷摘要》填充（仅卷模式、本卷内不足 prevN 章时出现，按阅读序由近及远）
	prevChapters: PrevChapterRef[];
	summaries: Record<number, string>;
	prevN?: number;
}

/** 写字台展示口径：各级别中会进入写作提示词的模板文档文件名（story_manager.loadWritingData 的读取面）——写字台文件行对命中者加粗显示、新建文档时优先列出 */
export const PROMPT_DOCS_ROOT = new Set(["大纲.md", "世界观.md", "人物.md", "人物关系.md", "角色关系.md", "场景.md"]); // 《笔记.md》《卷.md》《故事状态.md》《伏笔.md》不参与（v0.2.24+：伏笔不再注入写作上下文）
export const PROMPT_DOCS_VOLUME = new Set(["卷大纲.md", "人物.md", "人物关系.md", "场景.md"]); // 《卷摘要.md》仅在 includeVolumeSummary 开关开启时注入，默认不算
export const PROMPT_DOCS_CHAPTER = new Set(["章节.md", "章节大纲.md", "人物.md", "人物关系.md", "场景.md"]); // v0.2.23+：建章播种六件中除《章节信息》外全部参与（其不再注入写作上下文，v0.2.24+ 注入面改由调用方 PromptSpec 列表声明）

/** v0.4.x+ 前缀缓存锚点回传容器：调用方传入空对象，buildWritingContext 写入「稳定段字符数」（提示词中与逐章请求无关的前缀长度） */
export interface StableSink {
	stableChars?: number;
}

/**
 * 纯函数版 get_context_for_writing：所有磁盘读取与文档装配由调用方完成。
 * v0.0.15 三层结构——故事情况分「书籍级 / 卷级 / 章级」小节渲染：
 * - 文档原文（世界观/大纲/人物关系等）由调用方经 assemblePromptFiles 按层装配为组串传入（bookDocs/volDocs/chapterDocs），本函数只负责分节渲染与结构化列表
 * - 人物/场景按归属分层（当前卷内 → 卷级；其余 → 书级），本章目录归属的条目已由章级组串原文渲染、此处排除避免重复
 */
export function buildWritingContext(input: WritingContextInput, out?: StableSink): string {
	const parts: string[] = [];
	if (input.title) parts.push(`【小说标题】${input.title}`);
	if (input.genre) parts.push(`【小说类型】${input.genre}`);
	if (input.writingStyle) parts.push(`【编写类型】${input.writingStyle}`);

	const activeVolId = input.activeVolId || "";
	const inVolume = Boolean(activeVolId);
	const chLabel = input.localNum != null ? `第${input.localNum}章` : `第${input.chapterNum}章`;
	const volTitle = input.volumeName || activeVolId;

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
	// 本章目录《人物.md》归属的角色已由章级组串【本章人物设定】原文渲染，结构化列表排除避免重复
	const exclChars = new Set(input.excludeCharNames || []);
	chars = chars.filter((c) => !exclChars.has(c.name));
	const volChars = inVolume ? chars.filter((c) => c.vol === activeVolId) : [];
	const bookChars = chars.filter((c) => !(inVolume && c.vol === activeVolId));

	// v0.3.8+ 前缀缓存友好排序：稳定块（书级文档→前卷摘要→卷级文档）全部排前，按本章提及过滤的角色/场景列表与逐章滑动的【前文内容】窗口压后，
	// 再叠章级块——相邻章节请求的稳定公共前缀＝system＋标题/类型＋书级文档＋前卷摘要＋卷级文档，可整段命中缓存（此前易变块夹在稳定块中间，缓存只吃到 system）
	parts.push("\n== 故事情况 · 书籍级 ==");
	const bookDocs = (input.bookDocs || "").trim();
	if (bookDocs) parts.push(`\n${bookDocs}`);

	// v0.1.4+：前文窗口跨卷缺口——本卷内不足 prevN 章时以最近各前卷《卷摘要》填充（由近及远），不拉取他卷章节细节
	// v0.3.8+：随缓存友好排序上移到书级文档之后（卷内逐章不变）
	if ((input.prevN ?? 3) > 0 && (input.chapterNum > 1) && (input.prevVolSummaries?.length)) {
		for (const pv of input.prevVolSummaries) parts.push(`\n【前卷摘要 · ${pv.name}】\n${pv.text}`);
	}

	// v0.4.x+ 前缀缓存锚点：稳定段＝标题/类型＋书籍级文档＋前卷摘要（+ 卷级标题与卷级文档）。
	// 卷摘要及之后的角色/场景列表、前文内容、章级块都是逐章易变项，一律不计入。
	let stableEnd = parts.length;
	if (inVolume) {
		parts.push(`\n== 故事情况 · 卷级（${volTitle}） ==`);
		const volDocs = (input.volDocs || "").trim();
		if (volDocs) parts.push(`\n${volDocs}`);
		stableEnd = parts.length;
		const vs = (input.volSummary || "").trim();
		if (vs) parts.push(`\n【卷摘要】\n${vs}`);
	}

	// v0.2.25+：不再注入【全书大纲】全文（用户定稿：阶段 3 写作上下文只依赖本卷/本章大纲）；标记提示只看实际注入的大纲文本（本章大纲 + 三层组串），不再悬空指向未注入的全书大纲
	const markerText = [input.chapterOutlineText || "", bookDocs, input.volDocs || "", input.chapterDocs || ""].join("\n");
	if (/<角色\s*[：:]|<场景\s*[：:]/.test(markerText)) {
		parts.push("（大纲中 <角色：...>/<场景：...> 标记处，需在对应情节简单描写该角色与场景）");
	}
	renderCharBlock("【书籍角色设定】", bookChars);

	const allScenes = new Map(input.scenes.map((s) => [s.scene_id, s]));
	const exclScenes = new Set(input.excludeSceneIds || []); // 本章目录《场景.md》归属者已由章级组串【本章场景】原文渲染
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
		renderCharBlock("【本卷角色设定】", volChars);
		renderSceneBlock("【本卷场景】", volScenes, multiScenes);
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

	// v0.2.24+：《伏笔.md》不再注入写作上下文——伏笔仅由大纲内 [伏]…[/] 标记驱动（buildChapterPrompt 要求第 8 条），文档本身仍由 foreshadow-* 命令管理入库

	// 章级小节：本章目录文档（本章大纲/人物/场景/人物关系）由调用方经 assemblePromptFiles 装配为组串传入
	const chapterDocs = (input.chapterDocs || "").trim();
	if (chapterDocs) {
		parts.push(`\n== 故事情况 · 章级（${inVolume ? `${volTitle}·` : ""}${chLabel}） ==`);
		parts.push(`\n${chapterDocs}`);
	}
	const text = parts.join("\n");
	if (out) out.stableChars = parts.slice(0, stableEnd).join("\n").length;
	return text;
}

// ---------- 编写类型系统提示词（对应 writer.py _story_type_system_prompt / _story_type_confirm_line） ----------

export function storyTypeOf(writingStyle?: string): string {
	return (writingStyle || "").trim() || DEFAULT_STORY_TYPE;
}

export interface StoryTypePromptInput {
	storyType?: string;
	title?: string;
	charNames?: Array<string | null>;
	skillsBlock?: string; // v0.3.6+：bannedData/【禁用词】注入块已随禁用词 Skill 化移除——词表经阶段 3 技能块（skillsBlock）注入
}

/** 组装「编写类型 + skills」系统提示词块（v0.3.6+：禁用词不再单独注入，词表走 SKILLS 技能块） */
export function buildStoryTypeSystemPrompt(input: StoryTypePromptInput): string {
	const storyType = storyTypeOf(input.storyType);
	const block = getStoryTypeGuide(storyType, input.title || "", input.charNames);
	const parts: string[] = [];
	if (block) parts.push(block);
	if (input.skillsBlock) parts.push(input.skillsBlock);
	if (!parts.length) return "";
	const head = parts.join("\n\n");
	const tail =
		"\n\n【强制要求】\n" +
		`本小说确定的编写类型是「${storyType}」。你必须严格按照上面的【编写类型】格式要求输出，这是不可违背的硬性规定：\n` +
		"1. 输出格式必须完全符合该类型（网文=分段叙述、剧本=INT./EXT. 场景头 + 动作段 + 角色名独立一行 + 台词另起一段 + CUT TO: / CONTINUOUS / INTERCUT 等转场、普通小说=散文叙事、散文随笔=写意随笔），不得混用其它文体格式\n" +
		"2. 若生成内容不符合该类型的格式特征，即为不合格，需要重写；剧本不能出现长篇小说叙述、作者旁白、心理分析、总结性说明、大纲式标题、章节导航或任何说明性段落\n" +
		"3. 剧本必须以 INT./EXT. / FADE IN: / CUT TO: / CONTINUOUS / INTERCUT 等脚本标记开头；每一场必须按：动作段 → 角色名 → 台词 的顺序组织，角色名与台词必须分两行，不能混成一句\n" +
		"4. 对白必须只是角色发言，场景环境和动作必须写成镜头描述；禁止写 ‘他想、她觉得、忽然、顿时、只见、作者写道、心中、内心、仿佛、似乎、意识到、明白了’ 这类小说性叙述句式\n" +
		"5. 所有环境描写、人物情绪、心理状态、背景信息都必须转换成可视化的镜头动作/场景信号，例如：‘雨声敲在玻璃上’、‘手心渗出汗，指节发白’、‘她盯着门把手，没动’；绝不允许写‘他心里很慌’或‘她觉得很难受’\n" +
		"6. 允许用括号附注动作，如：老韩（低头） / 周远航（停住），但只能用于极短动作提示，不能扩展成小说式描述段落\n" +
		"7. 时间推进必须明确交代：若镜头跨时段、跨天、跨几小时或几天，必须更新场景头时间为 DAY / NIGHT / LATER / NEXT DAY / DAYS LATER 等；严禁多个相邻场景连续都写成 DAY，造成全片像同一时点发生\n" +
		"8. 场景转换必须明确写出 CUT TO:、FADE OUT:、FADE IN:、CONTINUOUS、INTERCUT、LATER、NEXT DAY、DAYS LATER 等脚本标记；不能直接连写成小说章节\n" +
		"9. 引用文档或技能中与本类型冲突的条目，以【编写类型】为准\n" +
		"10. 开始输出前先检查：每一段是不是 scene heading / action / character / dialogue / transition；环境、情绪和心理都必须改写成脚本镜头。绝对不要退回到小说正文写法";
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
		const hasSceneHeader = /(?:^|\n)(?:INT\.|EXT\.|INT\/EXT\.|FADE IN:|FADE OUT:|CUT TO:|CONTINUOUS|INTERCUT|内景|外景)\s*.*(?:-|\s)(?:NIGHT|DAY|DUSK|DAWN|LATER|NEXT DAY|DAYS LATER|夜|日|晨|暮|午|上午|下午|晚上)/i.test(content);
		const hasCharacterCue = /(?:^|\n)(?:[A-Z][A-Z0-9 _()-]{0,24}|[\u4e00-\u9fffA-Za-z][^\n：]{0,18})\s*\n\s*[^\n]{2,}/m.test(content);
		const hasDialogueLine = /^(?:[A-Z][A-Z0-9 _()-]{0,24}|[\u4e00-\u9fffA-Za-z][^\n：]{0,18})\s*$\n\s*[^\n]{2,}/m.test(content);
		const hasTransition = /(?:^|\n)(?:CUT TO:|FADE IN:|FADE OUT:|CONTINUOUS|INTERCUT|NEXT DAY|DAYS LATER|LATER)/.test(content);
		const hasScriptMarkers = hasSceneHeader || hasTransition || hasCharacterCue || hasDialogueLine;
		if (!hasScriptMarkers) {
			return "输出缺少剧本格式特征（INT./EXT. / CUT TO: / 角色名独立一行 + 台词另起一段），不是标准 screenplay";
		}
		const SCENE_HEADER_RE = /(?:^|\n)(?:INT\.|EXT\.|INT\/EXT\.|FADE IN:|FADE OUT:|CUT TO:|CONTINUOUS|INTERCUT|内景|外景)\s*.*?(?:-|\s)(NIGHT|DAY|DUSK|DAWN|LATER|NEXT DAY|DAYS LATER|夜|日|晨|暮|午|上午|下午|晚上)/gi; // 函数内局部正则：每次调用全新实例，无 lastIndex 残留
		const sceneHeaders: string[] = [];
		let sh: RegExpExecArray | null;
		while ((sh = SCENE_HEADER_RE.exec(content)) !== null) { // exec 循环替代 matchAll(ES2020)：外部检查器类型环境缺 @types/node 传递的 es2020 lib，matchAll 会退化为 any 触发 no-unsafe-*
			sceneHeaders.push((sh[1] || "").toUpperCase());
		}
		const repeatedDayLike = sceneHeaders.length >= 3 && sceneHeaders.every((tag) => tag === "DAY" || tag === "NIGHT" || tag === "日" || tag === "夜");
		const hasTimeProgression = /(?:^|\n)(?:LATER|NEXT DAY|DAYS LATER)/i.test(content);
		if (repeatedDayLike && !hasTimeProgression) {
			return "时间线模糊：连续多个场景都使用同一时间标签，若跨时段、跨天推进，必须改用 LATER / NEXT DAY / DAYS LATER 做明显时间流逝交代";
		}
		const proseLike = /(?:心里|内心|忽然|顿时|不由得|只见|只听见|似乎|仿佛|觉得|想起|意识到|明白|知道|不禁|惊觉|作者|章节|第[一二三四五六七八九十百\d]+章|【第)/.test(content);
		if (proseLike && !hasSceneHeader && !hasTransition) {
			return "输出更像小说叙述，不符合标准 screenplay；所有环境、情绪和心理都必须改写成镜头动作/现场反应";
		}
		return "";
	}
	if (storyType === "网文小说") {
		const scriptLike = /【第[一二三四五六七八九十百\d]+幕】|【场景|(?:^|\n)(?:INT\.|EXT\.|FADE IN:|CUT TO:|CONTINUOUS|内景|外景)\s*.*(?:-|\s)(?:NIGHT|DAY|DUSK|DAWN|夜|日|晨|暮|午)/i.test(content);
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

// ---------- v0.2.21+：正文「第N章」章节编号引用——提示词禁令 + 确定性检测 ----------

/** 注入三个写作提示词（/write /continue /rewrite）的禁令条款：正文不得出现「第N章」类元引用（标题行除外） */
export const CHAPTER_REF_BAN = "正文中不得出现「第N章」这类章节编号的元引用（如\"第5章\"\"第十二章\"）：提及前文事件或伏笔时改用具体内容（人物、事件）指代，章节编号只允许出现在标题行";

/** 确定性检测正文中的「第N章」类章节编号引用（阿拉伯＋中文数字；标题行除外——MD 标题行与 stripHeading 同口径的纯文本章题行）。返回至多 10 处命中（1 基行号），供生成后非阻断提醒 */
export function findChapterRefLeaks(content: string): Array<{ line: number; snippet: string }> {
	const leaks: Array<{ line: number; snippet: string }> = [];
	if (!content) return leaks;
	const re = /第[0-9一二三四五六七八九十百千零两]+章/g;
	// 纯文本章题行：整行恰为「第N章」或「第N章：/第N章␣…」开头（对齐 stripHeading 的 plainPattern 口径，另放宽裸章题行）
	const titleLine = /^[第]?[一二三四五六七八九十百\d]+[章回](?:[：:\s].*)?$/;
	const lines = content.split("\n");
	for (let i = 0; i < lines.length && leaks.length < 10; i++) {
		const line = lines[i];
		if (/^\s*#/.test(line)) continue; // MD 标题行
		if (titleLine.test(line.trim())) continue; // 纯文本章题行
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(line))) {
			leaks.push({ line: i + 1, snippet: m[0] });
			if (leaks.length >= 10) break;
		}
	}
	return leaks;
}

/** 含「第N章」引用的正文句子（全文偏移 + 命中片段 + 1 基行号），供手动检测修复命令逐句重写 */
export interface ChapterRefSentence {
	start: number; // 全文偏移（含换行）
	end: number;
	sentence: string;
	match: string; // 命中的「第N章」片段
	line: number; // 1 基行号
}

/** 确定性定位含「第N章」类章节编号引用的句子（豁免口径同 findChapterRefLeaks：MD 标题行与纯文本章题行跳过）。返回按位置排序、互不重叠的结果，至多 10 句；同一句多处命中只记一次 */
export function findChapterRefSentences(content: string): ChapterRefSentence[] {
	const out: ChapterRefSentence[] = [];
	if (!content) return out;
	const re = /第[0-9一二三四五六七八九十百千零两]+章/g;
	const titleLine = /^[第]?[一二三四五六七八九十百\d]+[章回](?:[：:\s].*)?$/;
	let lineStart = 0;
	const lines = content.split("\n");
	for (let i = 0; i < lines.length && out.length < 10; i++) {
		const line = lines[i];
		if (!/^\s*#/.test(line) && !titleLine.test(line.trim())) {
			re.lastIndex = 0;
			let lastStart = -1;
			let m: RegExpExecArray | null;
			while ((m = re.exec(line)) !== null && out.length < 10) {
				const b = sentenceBoundsInLine(line, m.index);
				if (b.start === lastStart) continue; // 同句多处命中，已记录
				lastStart = b.start;
				out.push({ start: lineStart + b.start, end: lineStart + b.end, sentence: line.slice(b.start, b.end), match: m[0], line: i + 1 });
			}
		}
		lineStart += line.length + 1;
	}
	return out;
}

/** 组装「第N章」引用逐句修复的改写提示词 */
export function buildChapterRefFixPrompt(text: string, sentences: ChapterRefSentence[]): string {
	const items: string[] = [];
	sentences.forEach((s, i) => {
		items.push(`${i + 1}. 上下文：${aiLineContext(text, s.start, s.end)}\n   句子（含章节编号引用：「${s.match}」）：${s.sentence}`);
	});
	return (
		"这是小说正文的「章节编号引用修复」改写任务。下面每一句都包含「第N章」这类章节编号的元引用" +
		"（如\"第5章\"\"第十二章\"），需要逐句改写。\n\n" +
		"改写规则：\n" +
		"1. 把章节编号引用替换为具体内容（人物、事件、情节点）指代，让读者无需查章节编号也能理解所指\n" +
		"2. 保留原句含义、情节信息、人物与叙述视角，不增删剧情信息\n" +
		"3. 不合并、不拆分句子；对话与引号、标点保持完整\n" +
		"4. 改写后的句子不得再出现任何「第N章」类章节编号引用\n" +
		"5. 句子本身没有章节编号引用时原样输出\n" +
		"6. 改写后要与上下文衔接自然，保持原写作风格\n\n" +
		"【待改写句子】\n" + items.join("\n") +
		"\n\n请严格按以下格式逐条输出，每行一条：\n" +
		"1：改写后的句子\n2：改写后的句子\n……\n" +
		"只输出编号行，不要任何解释或多余内容。"
	);
}

export interface ChapterRefFixReport {
	replaced: Array<[string, string]>; // [原句, 改写句]
	skipped: string[]; // 改写为空或仍含章节编号引用而跳过（保留原文）的句子
}

/** 「第N章」引用修复主流程：单轮 LLM 逐句重写后从后往前确定性原位替换（改写为空或仍含「第N章」则跳过保留原文） */
export async function fixChapterRefs(text: string, rewrite: AiRewriteFn): Promise<{ text: string; report: ChapterRefFixReport }> {
	const emptyReport: ChapterRefFixReport = { replaced: [], skipped: [] };
	if (!text) return { text, report: emptyReport };
	const sentences = findChapterRefSentences(text);
	if (!sentences.length) return { text, report: emptyReport };
	const prompt = buildChapterRefFixPrompt(text, sentences);
	const maxTokens = Math.min(8192, sentences.length * 300 + 1024);
	const raw = await rewrite(prompt, maxTokens);
	const rewriteMap = parseAiRewrites(raw || "", sentences.length);
	const refRe = /第[0-9一二三四五六七八九十百千零两]+章/;
	let current = text;
	const report: ChapterRefFixReport = { replaced: [], skipped: [] };
	for (let idx = sentences.length - 1; idx >= 0; idx--) {
		const s = sentences[idx];
		const newS = ((rewriteMap[idx] || "")).trim();
		if (!newS || refRe.test(newS)) {
			report.skipped.push(s.sentence);
			continue;
		}
		if (newS === s.sentence) continue;
		current = current.slice(0, s.start) + newS + current.slice(s.end);
		report.replaced.push([s.sentence, newS]);
	}
	return { text: current, report };
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

/** v0.2.25+ 大纲措辞按实际注入块解析：卷模式上下文含【本卷大纲】、平铺模式含【全书大纲】；无大纲块返回空串（措辞退化为泛指） */
function outlineBlockNameOf(context: string | undefined): "" | "本卷大纲" | "全书大纲" {
	const ctx = context || "";
	if (ctx.includes("【本卷大纲】")) return "本卷大纲";
	if (ctx.includes("【全书大纲】")) return "全书大纲";
	return "";
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
	withSummary?: boolean; // v0.2.21+：要求同响应末尾输出 <SUMMARY> 摘要块（插件确定性解析后分别落盘）
}

export function buildChapterPrompt(input: ChapterPromptInput): { prompt: string; foreshadows: ForeshadowItem[] } {
	const prepared = prepareOutlineForPrompt(input.chapterOutlineRaw || "", input.chapterKey);
	const chapterOutline = prepared.cleaned;
	const label = (input.chapterLabel || `第${input.chapterNum}章`).trim();
	const [wordLow, wordHigh] = input.wordRange;
	const parts: string[] = [];
	// v0.3.8+ 前缀缓存友好排序：【写作上下文】整块提到 user 消息最前（书级/卷级稳定文档在前、易变块在其后），
	// 「请创作第N章＋章节大纲＋约束＋用户要求」等逐章必变内容与其后的要求清单全部压到末尾——相邻章节请求可复用「上下文稳定段」整段前缀；
	// 任务指令后置同样符合「指令压轴」惯例，不削弱约束效力
	parts.push(`\n以下是写作上下文：\n${input.context}`);
	parts.push(`\n请创作${label}`);
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
	const storyType = storyTypeOf(input.storyType);
	if (storyType) {
		parts.push("\n" + storyTypeConfirmLine(storyType));
	}
	// v0.2.11+：要求清单升级为故事情节设计工艺版——卷内位置意识/结构化大纲字段落地/章末钩子/场景工艺/知识状态/章内因果链/伏笔条款（替代原泛化的「情节合理推进」「章节结尾自然收束」）；v0.2.12+ 第4条章末收束改为「自然终点＋有大纲钩子才落钩子」（原「必须落在钩子悬念点、禁平静收尾」过刚），并新增第12条「通顺与逻辑优先」兜底（原11条工艺项）
	// v0.2.25+ 引用文档配置框：vol_outline 可被移出阶段 3 清单——「参照【大纲】」措辞按上下文中实际注入的大纲块门控（卷模式＝【本卷大纲】、平铺模式＝【全书大纲】、无块＝泛指）
	const outlineBlock = outlineBlockNameOf(input.context);
	const req3 = `3. 先判断本章在卷结构中的位置与功能（铺垫/升级/反转/高潮/收束${outlineBlock ? `——参照【${outlineBlock}】${outlineBlock === "本卷大纲" ? "及其【卷设计】" : ""}` : ""})，强度与叙事重心与之匹配：反转前的章节持续加压，反转章必须把转折写成具体场景，反转后的章节体现主角状态变化\n`;
	parts.push(
		"\n请创作本章内容，要求：" +
		`\n1. 严格按【章节大纲】及上方【大纲约束】执行：要点全部写到、顺序遵循、不偏离主线、不添加大段无关情节\n` +
		`2. 总字数严格控制在${wordHigh}字以内（目标${wordLow}-${wordHigh}字）：不足${wordLow}字继续充实，达到${wordHigh}字必须收尾，严禁超限\n` +
		req3 +
		"4. 若大纲含「升级反转」「人物变化」「章末钩子」条目，必须写成具体的场景、转折或变化，不得一笔带过；章节结尾以本章情节的自然终点收束——大纲给出「章末钩子」时落在钩子的悬念点上，未给时不强求爆点，但禁止以总结段或感悟段收尾\n" +
		"5. 每个场景有明确的目标与障碍；对话承载冲突或信息增量，不写寒暄注水；关键转折用动作、对话和细节演出来，不用叙述概括\n" +
		"6. 人物的行动与决定只能依赖其在前文中已知悉的信息，不得使用其不可能知道的信息；配角按其自身目标与逻辑行动，不做主角的工具\n" +
		"7. 章内场景之间以「因此/但是」因果衔接，而非按时间顺序排列；主角的目标、认知或关系较章初至少推进一步（除非大纲明确说明）\n" +
		"8. 若本章大纲明确要求埋设或回收某伏笔，必须具体写出；不要主动提及与之无关的未完成伏笔\n" +
		"9. 与前后文保持连贯，人物性格一致\n" +
		"10. 文风自然平实，画面感来自具体细节，避免华丽形容词堆砌\n" +
		"11. 不要使用常见的比喻（如\"像……一样\"\"如……般\"\"仿佛……\"），表达方式要普通，能直说就直说\n" +
		"12. 通顺与逻辑优先于一切风格手法：每句话成分完整、语序正常，读一遍就懂；每个行动都有动机和缘由，前后信息不断链——不得为追求风格写出病句、乱序或逻辑断裂的段落\n" +
		`13. ${CHAPTER_REF_BAN}\n\n请直接输出正文内容，不要包含任何标题或额外说明` + (input.withSummary ? "（末尾要求的摘要块除外）。" + summaryTailInstruction("本章正文") : "。")
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
	withSummary?: boolean; // v0.2.21+：要求同响应末尾输出 <SUMMARY> 摘要块（只覆盖新续写部分）
}

export function buildContinuePrompt(input: ContinuePromptInput): { prompt: string; foreshadows: ForeshadowItem[] } {
	const globalPrep = prepareOutlineForPrompt(input.globalOutlineRaw || "", input.chapterKey);
	const chapterPrep = prepareOutlineForPrompt(input.chapterOutlineRaw || "", input.chapterKey);
	const label = (input.chapterLabel || `第${input.chapterNum}章`).trim();
	// v0.0.15：本章大纲全文已由写作上下文（三层结构）注入，此处不再重复；仅保留标记语义说明与伏笔抽取（v0.2.25+：全局大纲已不注入写作上下文，globalPrep 只用于伏笔抽取）
	const chapterOutline = chapterPrep.cleaned;
	// v0.2.25+ 平铺模式大纲块＝【全书大纲】：续写措辞按实际注入块引用（无块时泛指「大纲」）
	const outlineBlock = outlineBlockNameOf(input.context);
	const outlineRef = outlineBlock ? `【${outlineBlock}】` : "大纲";
	const prevBlock = buildPrevOutlinesBlock(input.prevOutlines || []);
	const descGuide = descStyleGuide(input.descStyle);
	const confirmLine = storyTypeConfirmLine(input.storyType);
	const tail1000 = (input.existingContent || "").slice(-1000);
	const [wordLow, wordHigh] = input.wordRange;
	// v0.3.8+ 前缀缓存友好排序：写作上下文块提到最前（其内部已按稳定→易变排序），带章号的引导语与逐章/逐次易变段全部压后，
	// 同一章多次续写及相邻章续写请求都能复用「上下文稳定段」整段前缀
	const prompt = `
${input.context}

${confirmLine}
以下是${label}的已有内容，请继续续写：

 ${!chapterPrep.cleaned ? `【大纲提示】当前尚无本章大纲，请按前文脉络与${outlineRef}自然续写。\n\n` : ""}${buildOutlineMarkerGuide(chapterOutline)}

${buildRoleSceneGuide(chapterOutline)}

${prevBlock}

${descGuide}

【本章已有内容摘要】
${input.currentSummary || "（无）"}

【已有内容（末尾1000字，保持衔接）】
${tail1000}

${input.userInstruction ? `【续写要求】${input.userInstruction}` : `请按${outlineRef}与本章大纲自然续写，保持文风一致。`}

请续写约${Math.trunc(wordLow * 0.3)}-${Math.trunc(wordHigh * 0.4)}字（单次续写不要超过${wordHigh}字），注意：
1. 严格按${outlineRef}与本章大纲续写：大纲列出的情节要点必须写到，不得自行扩展与大纲无关的大段内容
2. 与前文自然衔接
3. 保持人物性格一致
4. 适当使用对话和描写
5. 继续推进大纲的下一个情节要点，不要提前收束本章（除非大纲已写完）；大纲含「章末钩子」且字数允许时，为其留出落点
6. 人物的行动与决定只能依赖其在前文中已知悉的信息
7. 若本章大纲明确要求埋设或回收某伏笔，必须具体写出；不要主动提及与之无关的未完成伏笔
8. 不要使用常见的比喻，表达方式要普通，直接说
9. 通顺与逻辑优先于一切风格手法：每句话成分完整、语序正常，读一遍就懂；每个行动都有动机和缘由，前后信息不断链——不得为追求风格写出病句、乱序或逻辑断裂的段落
10. ${CHAPTER_REF_BAN}` + (input.withSummary ? summaryTailInstruction("新续写部分") : "");
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

// ---------- v0.2.x+ 大纲族共享条款（卷级大纲与平铺书级大纲同源，防多处措辞漂移） ----------

/** 逐章固定五项结构（vol-outline-generate 逐章 prompt 与 book-outline-generate 平铺分支共用同一事实源） */
export const OUTLINE_CHAPTER_FIVE_ITEMS = "每个章标记之后按固定结构写本章大纲（每项一行、简洁具体、避免空话）：\n   - 主线：本章发生什么（具体场景与行动）\n   - 因果衔接：上一章如何导致本章（一句话）\n   - 升级/反转：本章引入的新代价、风险或转折\n   - 人物变化：某角色处境或认知/关系的改变\n   - 章末钩子：章末留下的悬念或新问题\n   （主线与章末钩子每章必写；其余三项视情况覆盖）";

/** 节奏与反转落位条款（scope＝「全书」/「本卷」，两族同口径） */
function outlineRhythmClause(scope: "全书" | "本卷"): string {
	return `节奏：${scope}张力松紧交替，不连续堆叠高强度章；${scope}至少 2 次实质性反转（其一为中段最大反转）；高潮落在后三分之一，末章收束到${scope === "全书" ? "全书" : "卷级"}目标`;
}

/** 自然收束条款骨架（scope＋收束内容＋目标末单元序号＋单元单位「章」/「卷」；「不得留下新的悬念或续集钩子」两族共用） */
function outlineClosingClause(scope: string, n: number, close: string, unit: "章" | "卷" = "章"): string {
	return `${scope}故事须在恰好第 ${String(n)} ${unit}自然收束结尾：${close}，不得留下新的悬念或续集钩子`;
}

// ---------- v0.2.11+ 自动生成卷大纲 (/vol-outline-generate) ----------

export const VOL_OUTLINE_GEN_SYSTEM_PROMPT = `你是资深小说策划，擅长卷级情节设计。你的大纲将作为后续逐章写作的依据，必须具体可执行。
你产出的每份大纲都要满足四条硬标准：
1. 因果——每一章由上一章「因此/但是」推出，而非按时间顺序「然后」排列；禁止巧合推动剧情。
2. 升级——赌注与代价逐章抬升，张力有松有紧；最大反转落在本卷中段附近，高潮落在后三分之一。
3. 转变——卷末主角的目标、认知或关系必须较卷初发生实质变化，且变化由其在压力下的选择驱动，而非纯外部事件。
4. 新意——先想这个剧情最可预测的版本，再在 1–2 个关键处刻意打破它；所有反转须在前文埋过伏笔（回收），禁止机械降神。`;

/** v0.2.24+ 提示词文件装配改造：上下文块（书籍信息/张力规则/世界观/策划规范/大纲/人物关系/卷列表等）改由调用方经 assemblePromptFiles 装配为组串传入 */
export interface VolOutlineGenInput {
	targetVolumeName: string; // 目标卷名（首句「为「X」生成」用）
	chapterCount: number; // 目标章数（恰好 N 章）
	strictCurrentOutlineOnly?: boolean; // v0.2.x+：强制本次拆分仅依赖当前卷大纲，不允许把全书大纲/前卷线索当成拆分依据（调用方据此决定 specs skip）
	hasPlanningGuide?: boolean; // v0.2.25+ 引用文档配置框：组串含【策划规范】块——驱动提示词【策划规范】措辞（无块改泛指、不悬空引用）
	contextDocs?: string; // 调用方装配的上下文块串（【书籍信息】→【张力规则】→【世界观设定】→【策划规范】→【当前大纲来源】→【全书大纲】→【书籍/本卷人物关系】→【卷列表 · 阅读序】→【前一卷卷大纲 · 仅参考】）
}

/** v0.2.24+ 把调用方经 assemblePromptFiles 装配的上下文组串追加进 prompt 分段（trim 后非空才追加，前置换行对齐旧 contextParts 各块口径） */
function pushContextDocs(parts: string[], docs?: string): void {
	const cd = (docs ?? "").trim();
	if (cd) parts.push(`\n${cd}`);
}

/** v0.2.24+ 【书籍信息】块正文（供调用方作 text 条目混排进 specs，header 由调用方给出）：书名 + 可选题材/基调风格行 */
export function bookInfoText(title: string, genre?: string, writingStyle?: string): string {
	const info: string[] = [`书名：${title}`];
	const g = (genre ?? "").trim();
	const s = (writingStyle ?? "").trim();
	if (g) info.push(`题材：${g}`);
	if (s) info.push(`基调/风格：${s}`);
	return info.join("\n");
}

/** v0.2.24+ 【卷列表 · 阅读序】块正文（供调用方作 text 条目混排进 specs）：`N. 卷名（描述）` 行串；传 targetName 时目标卷行尾标 ` ← 目标卷` */
export function volumeListText(volumes: Array<{ name: string; description?: string }>, targetName?: string): string {
	return volumes.map((v, i) => {
		const desc = (v.description ?? "").trim();
		return `${i + 1}. ${v.name}${desc ? `（${desc}）` : ""}${v.name === targetName ? " ← 目标卷" : ""}`;
	}).join("\n");
}

/** v0.2.x+ 增量生成卷大纲 · 第 0 步：只生成【卷设计】段（≤8 行），不输出任何章标记；后续每章提示词会带上本段作为设计依据 */
export function buildVolOutlineDesignPrompt(input: VolOutlineGenInput): string {
	const n = input.chapterCount;
	const reqs: string[] = [
		`不要输出任何章标记或章节内容，只写一段【卷设计】（不超过 8 行），覆盖：核心冲突；升级路径（赌注如何一步步抬高）；主角转变（卷初状态 → 卷末状态，由哪个选择驱动）；最大反转（大致在第几章、伏笔埋在哪几章）；新意点（本卷如何以不同于该题材最可预测版本的方式兑现其核心爽点/情感核）`,
		// v0.2.25+ 引用文档配置框：【策划规范】措辞按块是否实际注入门控（用户可从阶段 1 清单移除策划指南），无块时改泛指、不悬空引用
		input.hasPlanningGuide
			? "本卷整体走向须承接【策划规范】的全书规划与前卷进展：本卷开头主角状态须接住前卷结尾状态；前卷遗留的未解线头或伏笔，本卷至少推进或回收其一；不得违背世界观设定（世界规则 / 势力 / 力量体系）"
			: "本卷整体走向须承接全书规划与前卷进展：本卷开头主角状态须接住前卷结尾状态；前卷遗留的未解线头或伏笔，本卷至少推进或回收其一；不得违背世界观设定（世界规则 / 势力 / 力量体系）",
	];
	reqs.push(outlineClosingClause("本卷", n, "卷末须解决本卷核心冲突、完成主角转变、回收最大反转")); // v0.2.x+：按给定章节号自然收束——与平铺书级大纲收束条款同骨架
	reqs.push("只输出大纲正文本身，不要解释、前言说明或代码块包裹");
	const parts: string[] = [`请根据下面的书籍设定，为「${input.targetVolumeName}」（共 ${n} 章）生成【卷设计】段。\n\n要求：\n${reqs.map((r, i) => `${i + 1}. ${r}`).join("\n")}`];
	pushContextDocs(parts, input.contextDocs);
	return parts.join("\n");
}

/** v0.2.x+ 增量生成卷大纲 · 第 1..N 步：每次恰好生成一个 `## 第N章` 小节 */
export interface VolOutlineChapterInput extends VolOutlineGenInput {
	chapterNum: number; // 本次生成的章号（阿拉伯数字）
	volumeDesign?: string; // 第 0 步生成的【卷设计】段（完整模式）
	generatedSoFar?: string; // 本轮已生成的各段拼接文本（供因果衔接参考）
	supplementMode?: boolean; // 补全模式（从书级大纲生成卷）：无设计步、只补缺失章
}

/** v0.2.x+ 增量生成卷大纲 · 单章提示词：恰好输出一个章标记 + 固定五项结构；带共享书籍上下文 + 本轮【卷设计】与已生成章节，保证跨段因果链 */
export function buildVolOutlineChapterPrompt(input: VolOutlineChapterInput): string {
	const n = input.chapterCount;
	const num = input.chapterNum;
	const supplement = !!input.supplementMode;
	const isFirst = num === 1;
	const reqs: string[] = [
		`恰好输出一个章标记「## 第${num}章 <标题>」（N 为阿拉伯数字 ${num}，不要写成「第一章」这类中文序号），<标题> 是该章的简短标题`,
	];
	if (input.strictCurrentOutlineOnly) {
		reqs.push("本轮拆分必须严格以【当前大纲来源】这一份当前卷大纲为唯一依据，不得参考任何全书大纲、前卷大纲或其他卷的剧情线索；不能把上一卷或全书线索当成本卷拆分的依赖。");
		reqs.push("本章的因果必须从当前卷大纲中已经确定的情节推进，不得把上一卷结尾的线索拿来作为本卷章节切分的依据。");
	} else {
		reqs.push(OUTLINE_CHAPTER_FIVE_ITEMS); // v0.2.x+：与平铺书级大纲共用同一五项结构事实源（旧写法在非 strict 分支重复推入两遍，一并修正）
	}
	reqs.push(
		supplement
			? "节奏：本章张力松紧须与全卷节奏协调，不连续堆叠高强度章；若本章恰处本卷高潮或收束位置，按其位置要求落位"
			: `${outlineRhythmClause("本卷")}${isFirst ? `；开篇章须接住前卷结尾状态（无前卷则接${input.hasPlanningGuide ? "【策划规范】的" : ""}全书开篇）` : ""}`, // v0.2.x+：节奏/反转落位与平铺书级大纲同口径（补全模式仍按逐章节奏协调措辞）
		supplement
			? "承接：本章须由前文情节「因此/但是」推出，保持因果链完整；章末钩子须能为后续章节留出推进空间"
			: isFirst
				? `承接：本章为本卷开篇，主角状态须接住前卷结尾状态（无前卷则接${input.hasPlanningGuide ? "【策划规范】的" : ""}全书开篇），不得凭空开场`
				: "承接：本章须由上一章「因此/但是」推出，而非按时间顺序「然后」排列；禁止巧合推动剧情",
		"反套路：反派/阻碍按其自身目标与逻辑行动，不是主角的道具；主角的挫折须源于其自身选择或性格缺陷，而非纯运气差",
	);
	if (num === n) reqs.push("本章为本卷末章：主线须在此自然收束结尾——解决本卷核心冲突、完成主角转变、回收最大反转；章末不得留下新的悬念或续集钩子"); // v0.2.x+：按给定章节号自然收束——末章即收束章
	reqs.push("只输出大纲正文本身，不要解释、前言说明或代码块包裹");
	const parts: string[] = [`${supplement ? "补全" : "生成"}「${input.targetVolumeName}」（共 ${n} 章）的第 ${num} 章章节小节。\n\n要求：\n${reqs.map((r, i) => `${i + 1}. ${r}`).join("\n")}`];
	pushContextDocs(parts, input.contextDocs);
	const design = (input.volumeDesign ?? "").trim();
	if (design) parts.push(`\n【卷设计 · 本轮】\n${design}`);
	const soFar = (input.generatedSoFar ?? "").trim();
	if (soFar) parts.push(`\n【已生成章节 · 本轮】\n${soFar}`);
	return parts.join("\n");
}

// ---------- v0.2.x+ 生成书籍大纲 (/book-outline-generate) ----------

export const BOOK_OUTLINE_GEN_SYSTEM_PROMPT = `你是资深小说策划，擅长全书结构设计。你产出的书级大纲是整部作品的主蓝图，必须具体可执行。
你产出的每份大纲都要满足四条硬标准：
1. 因果——每一卷/每一章由前文「因此/但是」推出，而非按时间顺序「然后」排列；禁止巧合推动剧情。
2. 升级——赌注与代价在全书范围内逐步抬升，张力有松有紧；最大反转落在全书中段附近，高潮落在后三分之一。
3. 转变——全书结束时主角的目标、认知或关系必须较开篇发生实质变化，且变化由其在压力下的选择驱动，而非纯外部事件。
4. 新意——先想这个故事最可预测的版本，再在 1–2 个关键处刻意打破它；所有反转须在前文埋过伏笔（回收），禁止机械降神。`;

/** v0.2.24+ 提示词文件装配改造：上下文块改由调用方经 assemblePromptFiles 装配为组串传入；gen/extend prompt 的条件要求行改由旗标驱动（调用方装配时对应块非空即置 true） */
export interface BookOutlineGenInput {
	flatMode: boolean; // 平铺（无卷）模式 → 逐章规划（## 第N章 标记）；有卷模式 → 卷声明格式
	chapterCount: number; // 目标章数（平铺=恰好 N 章；有卷模式不用——卷级规划不含章号，调用方传 0）
	volumeCount?: number; // v0.2.x+ 有卷模式：弹窗输入的本书计划卷数（恰好 N 卷、每卷一个小节做卷级规划）；undefined＝未指定
	hasVolumes?: boolean; // 组串含【卷列表 · 阅读序】块（仅有卷模式注入）——驱动「分卷须与现有卷对齐」要求行（仍含 !flatMode 判定）
	hasPlanningGuide?: boolean; // 组串含【策划规范】块——驱动策划约束要求行
	hasBookRelationships?: boolean; // 组串含【书籍人物关系】块——驱动人物关系要求行
	hasVolRelationships?: boolean; // 组串含【本卷人物关系】块——驱动卷内关系基线要求行
	contextDocs?: string; // 调用方装配的上下文块串（【书籍信息】→【张力规则】→【世界观设定】→【策划规范】→【书籍人物关系】→【本卷人物关系】→【卷列表 · 阅读序】）
}

/** v0.2.x+「生成书籍大纲」prompt：依据全局设定（世界观＋策划指南）生成书级《大纲.md》。两种输出形态：
 * - 平铺（无卷）模式：先写【全书设计】块，再逐章规划恰好 N 章、每章以 `## 第N章 <标题>` 标记（阿拉伯数字 1..N，与「从卷大纲生成章节」同一解析器兼容），其后按固定结构写各章大纲；
 * - 有卷模式：写全书主线 + 按卷小节（每卷「## 第X卷·卷名」标题，小节内首行 `- 第X卷·卷名：一句话定位` 声明行，可被「从书级大纲生成卷」解析；其后是该卷的卷级规划——按卷划分事件与情节，不含章号区间）+ 结局，不写逐章标记。 */
export function buildBookOutlineGenPrompt(input: BookOutlineGenInput): string {
	const n = input.chapterCount;
	const v = input.volumeCount ?? 0; // 有卷模式：弹窗输入的卷数（0＝未指定，回落为「按需分卷」）
	const reqs: string[] = [];
	if (input.flatMode) {
		reqs.push("本书为平铺（无卷）模式：不得输出任何卷划分、卷声明行（如「- 第X卷·卷名：描述」）或卷引用，全书逐章规划"); // v0.2.x+：显式禁卷——防注入的策划规范含卷结构时模型跟随输出卷划分
		reqs.push(`恰好输出 ${n} 个章标记，每行一个、形如「## 第N章 <标题>」，N 为阿拉伯数字从 1 连续递增到 ${n}（如「## 第1章」，不要写成「第一章」）；<标题> 是该章的简短标题`);
		reqs.push("在首个章标记之前先写一段【全书设计】（不超过 8 行），覆盖：全书主线；升级路径（赌注如何一步步抬高）；主角转变（开篇状态 → 结局状态，由哪个选择驱动）；最大反转（大致在第几章、伏笔埋在哪几章）；新意点（本书如何以不同于该题材最可预测版本的方式兑现其核心爽点/情感核）");
		reqs.push(OUTLINE_CHAPTER_FIVE_ITEMS); // v0.2.x+：与卷级大纲共用同一五项结构事实源
		reqs.push(outlineRhythmClause("全书"));
		reqs.push(`${outlineClosingClause("全书", n, `主线必须在第 ${String(n)} 章内全部闭合（主角最终状态、最大反转回收）`)}；大纲内容不得延伸到第 ${String(n)} 章之后`); // v0.2.x+：按给定章节号自然收束——让故事在目标章数处结束
	} else {
		reqs.push(`本书为分卷模式：${v > 0 ? `恰好 ${v} 卷（第 1 卷到第 ${v} 卷），不得多也不得少` : "按需分卷（通常 1–5 卷）"}；本大纲只做卷级规划——不写逐章标记（## 第N章），不写章号区间注记（如「（第1-20章）」）`);
		reqs.push(`每卷一个小节，小节标题形如「## 第X卷·卷名」（X 为阿拉伯数字从 1 连续递增${v > 0 ? `到 ${v}` : ""}，卷名为该卷的简短标题）`);
		reqs.push("每个小节的第一行是一条卷声明 bullet，形如「- 第X卷·卷名：一句话定位」（该行的卷序号与卷名须与本小节标题完全一致，冒号后一句话概括本卷主要内容）");
		reqs.push("声明行之后按固定结构写本卷的卷级规划（每项一行、简洁具体、避免空话）：\n   - 主线：本卷发生什么（具体场景与行动）\n   - 因果衔接：上一卷如何导致本卷（一句话；首卷写全书如何起手）\n   - 大事件：本卷 2–4 个关键事件，按因果顺序列出（各自带来什么新代价、风险或转折）\n   - 人物变化：某角色处境或认知/关系的改变\n   - 卷末状态：本卷结尾的状态与留给下一卷的新问题（末卷写结局落点）");
		reqs.push("除卷声明行外，不得再出现任何以「第X卷」开头的行（会被误认成卷声明）；小节内其他 bullet 用上述项目名开头");
		reqs.push("结构：先写全书主线（数句，说清主角目标、核心冲突、结局走向），再按卷写上述卷小节（第 1 卷在前、依阅读序排列），最后写一段【结局】（主线如何收束、主角最终状态）");
		reqs.push("节奏：全书张力松紧交替，卷与卷之间赌注逐级抬高；全书至少 2 次实质性反转（其一为中段最大反转）；高潮落在后三分之一；每卷有自己的中段反转与卷末收束");
		reqs.push(v > 0
			? `${outlineClosingClause("全书", v, "末卷须完成主线闭合（主角最终状态、最大反转回收）", "卷")}；大纲内容不得延伸到第 ${String(v)} 卷之后` // v0.2.x+：有卷模式按卷收束——故事在最后一卷结尾
			: "全书故事须在最后一卷自然收束结尾：末卷须完成主线闭合（主角最终状态、最大反转回收），不得留下新的悬念或续集钩子");
	}
	reqs.push("反套路：反派/阻碍按其自身目标与逻辑行动，不是主角的道具；主角的挫折须源于其自身选择或性格缺陷，而非纯运气差");
	if (!input.flatMode && input.hasVolumes) {
		reqs.push("分卷须与现有卷对齐（见【卷列表 · 阅读序】）：保留现有卷名与顺序、可在末尾追加新卷");
	}
	if (input.hasPlanningGuide) reqs.push(`书级《策划指南》（见【策划规范 · 本书既定规划】）是本书的既定规划约束：主线、大事件序列、升级路径、主角转变、反转与伏笔规划、新意点、节奏、人物行动逻辑、信息与知识状态、世界观红线均须与其一致，不得违背${input.flatMode ? "；若其中含卷划分/卷引用，忽略其卷结构、仅按章号规划" : ""}`);
	if (input.hasBookRelationships) reqs.push("人物关系已知：需优先遵循【书籍人物关系】中的既定关系状态与变化线索，确保全书规划与角色关系一致");
	if (input.hasVolRelationships) reqs.push("若目标卷存在【本卷人物关系】，其内容是本卷的人物关系基线，分卷/章节安排须服从该卷内的已定关系状态与冲突");
	reqs.push("不得违背世界观设定（世界规则 / 势力 / 力量体系）");
	reqs.push("只输出大纲正文本身，不要解释、前言说明或代码块包裹");

	const parts: string[] = [`${input.flatMode ? `请根据下面的书籍设定，生成一份恰好 ${n} 章的书级大纲。` : `请根据下面的书籍设定，为本书生成一份书级大纲：按卷划分事件与情节${v > 0 ? `，恰好 ${v} 卷` : ""}。`}\n\n要求：\n${reqs.map((r, i) => `${i + 1}. ${r}`).join("\n")}`];
	pushContextDocs(parts, input.contextDocs);
	return parts.join("\n");
}

/** v0.2.x+ 平铺书级大纲分段续写输入：单次输出被 max_tokens 截断时，从 fromChapter 继续到 toChapter */
export interface BookOutlineContinueInput extends BookOutlineGenInput {
	fromChapter: number; // 本次续写的起始章号（含）
	toChapter: number; // 本次续写的结束章号（含）
	bookDesign?: string; // 首轮生成在首个章标记之前的【全书设计】段（后续分块必须遵循）
	previousChapters?: string; // 已生成章节的末尾节选（衔接参考，避免断层/重复）
}

/** v0.2.x+ 平铺书级大纲分段续写 prompt：复用生成书籍大纲的完整上下文，但只要求输出指定章号区间的章小节（不重复前文、不再输出【全书设计】）。
 * 用于目标章数很大（单次输出超出 max_tokens）时由主流程自动续写，直到覆盖 1..N 或无法继续。 */
export function buildBookOutlineContinuePrompt(input: BookOutlineContinueInput): string {
	const from = input.fromChapter;
	const to = input.toChapter;
	const total = input.chapterCount;
	const reqs: string[] = [
		`本次只续写第 ${String(from)} 章至第 ${String(to)} 章（全书共 ${String(total)} 章）：不要重复第 1–${String(Math.max(0, from - 1))} 章，不要输出【全书设计】、前言、解释或代码块包裹`,
		"章号连续：每章一个「## 第N章 <标题>」标记（N 用阿拉伯数字），从起始章号递增到结束章号",
		"每章标记后按固定五项结构写：主线 / 因果衔接 / 升级反转 / 人物变化 / 章末钩子（主线与章末钩子必写）",
		"必须承接【已生成章节 · 末尾衔接参考】的剧情与人物状态，保持因果链，不得重复或矛盾",
		"张力松紧交替，不连续堆叠高强度章；只输出大纲正文本身",
	];
	if (to === total) reqs.push(`这是全书最后一段：故事须在恰好第 ${String(total)} 章自然收束结尾——末章须完成主线闭合（主角最终状态、最大反转回收），不得留下新的悬念或续集钩子`); // v0.2.x+：按给定章节号自然收束
	const parts: string[] = [`请继续为本书生成书级大纲的指定章节区间。\n\n要求：\n${reqs.map((r, i) => `${i + 1}. ${r}`).join("\n")}`];
	pushContextDocs(parts, input.contextDocs);
	const design = (input.bookDesign ?? "").trim();
	if (design) parts.push(`\n【全书设计 · 沿用（必须遵循）】\n${design}`);
	const prev = (input.previousChapters ?? "").trim();
	if (prev) parts.push(`\n【已生成章节 · 末尾衔接参考】\n${prev}`);
	return parts.join("\n");
}

/** v0.2.x+ 有卷模式书级大纲「继续生成」输入：已有大纲已规划到第 fromVolume-1 卷，本次只追加 fromVolume..toVolume 的新卷小节 + 更新结局 */
export interface BookOutlineExtendInput extends BookOutlineGenInput {
	fromVolume: number; // 新增卷的起始卷号（含）= 已有大纲最大卷号 + 1
	toVolume: number; // 新增卷的结束卷号（含）= 弹窗输入的目标总卷数
}

/** v0.2.x+ 有卷模式书级大纲续写 prompt：不重出主线/旧卷小节/逐章标记，只输出第 from..to 卷的新卷小节（标题＋声明行＋卷级规划）+ 一段更新的【结局】；
 * 上下文与生成书籍大纲同口径（调用方装配同一组 contextDocs）——既有卷号与剧情由世界观＋策划指南等既定事实保证接续（不注入整份现有书级大纲）。 */
export function buildBookOutlineExtendPrompt(input: BookOutlineExtendInput): string {
	const from = input.fromVolume;
	const to = input.toVolume;
	const reqs: string[] = [
		`本次只输出新增的卷小节：第 ${String(from)} 卷至第 ${String(to)} 卷（恰好 ${String(to - from + 1)} 卷），卷号 X 从现有大纲最后一卷的卷号继续递增（阿拉伯数字）`,
		`每卷一个小节，小节标题形如「## 第X卷·卷名」；小节第一行是卷声明 bullet「- 第X卷·卷名：一句话定位」（卷序号与卷名与本小节标题一致，不带章号区间）`,
		"声明行之后按固定结构写本卷的卷级规划（每项一行、简洁具体、避免空话）：\n   - 主线：本卷发生什么（具体场景与行动）\n   - 因果衔接：上一卷如何导致本卷（一句话）\n   - 大事件：本卷 2–4 个关键事件，按因果顺序列出（各自带来什么新代价、风险或转折）\n   - 人物变化：某角色处境或认知/关系的改变\n   - 卷末状态：本卷结尾的状态与留给下一卷的新问题（末卷写结局落点）",
		"除卷声明行外，不得再出现任何以「第X卷」开头的行；不写逐章标记（## 第N章），不写章号区间注记（如「（第1-20章）」）",
		"不要重复或改写现有大纲中的主线、已有卷小节或其他任何内容",
		"新卷小节之后写一段更新后的【结局】：主线如何收束、主角最终状态",
		outlineClosingClause("全书", to, "末卷须完成主线闭合（主角最终状态、最大反转回收）", "卷"),
		input.hasPlanningGuide ? "新卷的剧情须与世界观设定和策划指南保持一致，保持因果链完整，不得重复或矛盾" : "新卷的剧情须与世界观设定保持一致，保持因果链完整，不得重复或矛盾", // v0.2.25+ 引用文档配置框：策划指南块未注入时不悬空提及
		"反套路：反派/阻碍按其自身目标与逻辑行动，不是主角的道具；主角的挫折须源于其自身选择或性格缺陷，而非纯运气差",
		"只输出大纲正文本身，不要解释、前言说明或代码块包裹",
	];
	const parts: string[] = [`请基于本书现有大纲进度继续生成：只追加第 ${String(from)} 卷至第 ${String(to)} 卷的新卷小节与更新后的结局。\n\n要求：\n${reqs.map((r, i) => `${i + 1}. ${r}`).join("\n")}`];
	pushContextDocs(parts, input.contextDocs);
	return parts.join("\n");
}

// ---------- v0.2.13+ 策划指南 (/planning-guide；书级《策划指南.md》，大纲类命令的既定规划约束) ----------

/** v0.2.24+ 提示词文件装配改造：上下文块（书籍信息/张力规则/世界观/全书大纲/卷列表）改由调用方经 assemblePromptFiles 装配为组串传入；
 * 「仅世界观生成」（/planning-guide-worldview）无全书大纲/卷列表条目即对应块缺失 */
export interface PlanningGuideInput {
	bookTitle: string; // 书名（首句「为「X」生成」用）
	contextDocs?: string; // 调用方装配的上下文块串（【书籍信息】→【张力规则】→【世界观设定】→【全书大纲】→【卷列表 · 阅读序】）
	volumeCount?: number; // v0.2.25+ 分卷规划：本书计划卷数（弹窗输入，预填现有卷数）；>0 时生成要求恰好 N 卷按卷组织，undefined/0＝未指定（配合 volumeMode 走「按需分卷」软要求）
	volumeMode?: boolean; // v0.4.x+ 分卷模式（use_volumes≠false）：未给卷数（取消弹窗）时也附「按需分卷」按卷组织要求——分卷模式恒带分卷信息
	noVolumes?: boolean; // v0.4.x+ 无卷模式（《故事状态.md》use_volumes=false）：按卷要求缺失时附带禁卷强提示，与 volumeCount>0 互斥
}

/** v0.2.x+ 策划指南固定十节（顺序即文档结构）：首轮 prompt 的节清单、截断检测（planningGuideMissingSections）、
 * 续写 prompt 的缺失节列表共用同一事实源，避免三处文案漂移 */
export const PLANNING_GUIDE_SECTIONS: Array<{ no: string; title: string; req: string }> = [
	{ no: "一", title: "全书主线", req: "数句说清主角目标、核心冲突、结局走向（这本书到底在讲什么）" },
	{ no: "二", title: "大事件序列", req: "按时间/因果顺序列出全书主要大事件（每事件一两句话简述），包含：开篇激励事件、关键转折、中段高潮、最终高潮、结局落点" },
	{ no: "三", title: "升级路径", req: "赌注与代价如何一步步抬高——列出关键抬升节点及其大致位置（用「中段」「后段」等相对位置表述，不指定具体章号）" },
	{ no: "四", title: "主角转变弧", req: "开篇状态 → 结局状态；变化由其在压力下的哪个选择驱动" },
	{ no: "五", title: "反转与伏笔总规划", req: "列出全部主要反转（至少含一个全书中段最大反转），每个写明：反转是什么、伏笔埋在哪、在哪回收" },
	{ no: "六", title: "新意点与反套路条款", req: "先写出这个故事最可预测的版本，再指明在 1–2 个关键处如何刻意打破它；列出本书明确不用的俗套桥段清单" },
	{ no: "七", title: "节奏与张力曲线", req: "全书张力松紧交替的安排；高潮位置（后段）；实质性反转的落位（≥2 次）" },
	{ no: "八", title: "人物行动逻辑", req: "主角与主要配角（含反派）的核心动机与行为逻辑——按其自身目标与逻辑行动，不是主角的道具" },
	{ no: "九", title: "信息与知识状态规则", req: "各角色在任一时刻知道/不知道什么；信息释放节奏（禁止角色突然获得其不该知道的信息）" },
	{ no: "十", title: "世界观红线", req: "不得违背的硬规则（世界规则 / 势力 / 力量体系），逐条列出" },
];

/** v0.2.x+ 策划指南截断检测：扫描文本中的标题行（`#`~`######`），凡某节的标题关键词未出现在任何标题行即视为缺失；
 * 返回缺失节（按文档顺序）如 ["七、节奏与张力曲线"]。只认标题行——正文里提到节名不算该节已生成 */
export function planningGuideMissingSections(text: string): string[] {
	const headings = (text || "").split("\n").filter((l) => /^#{1,6}/.test(l));
	return PLANNING_GUIDE_SECTIONS.filter((s) => !headings.some((h) => h.includes(s.title))).map((s) => `${s.no}、${s.title}`);
}

/** v0.2.25+ 分卷规划要求（首轮与续写 prompt 共用同一事实源）：弹窗输入的卷数 >0 时要求《策划指南》恰好 N 卷按卷组织；
 *  v0.4.x+ 分卷模式（volumeMode）但未给卷数（取消弹窗）时改附「按需分卷」软要求——分卷模式下《策划指南》恒带分卷信息，不再出现整份无卷结构；
 *  平铺（无卷）模式返回空串（禁卷强提示走 planningGuideNoVolReq） */
function planningGuideVolumeReq(input: PlanningGuideInput): string {
	const n = input.volumeCount ?? 0;
	if (Number.isSafeInteger(n) && n >= 1) return `本书按 ${n} 卷规划（阅读序第 1 至第 ${n} 卷）。《策划指南》须按卷组织：在「二、大事件序列」「三、升级路径」「五、反转与伏笔总规划」等节内按卷分组，每卷用 H3 小标题「第X卷 · 卷名」（有【卷列表 · 阅读序】块时卷名取自其中，无该块或卷名未知时只写「第X卷」），写明该卷承载的大事件、张力抬升与反转落位；各卷须在卷内自然收束，卷末不留新悬念`;
	if (input.noVolumes || !input.volumeMode) return "";
	return "本书为分卷模式（《故事状态.md》use_volumes≠false）：《策划指南》须按卷组织——按需分卷（通常 1–5 卷，阅读序自第 1 卷起）：在「二、大事件序列」「三、升级路径」「五、反转与伏笔总规划」等节内按卷分组，每卷用 H3 小标题「第X卷 · 卷名」（有【卷列表 · 阅读序】块时卷名取自其中，无该块或卷名未知时只写「第X卷」），写明该卷承载的大事件、张力抬升与反转落位；各卷须在卷内自然收束，卷末不留新悬念";
}

/** v0.4.x+ 无卷模式禁卷强提示（首轮与续写 prompt 共用）：故事状态 use_volumes=false 时此前只是「不加按卷要求」，
 *  模型仍按网文惯例自发输出「第X卷/分卷规划」（用户实测无卷模式自动化生成策划结果混入分卷信息）——
 *  与按卷组织要求互斥（volumeCount>0 时不生效） */
function planningGuideNoVolReq(input: PlanningGuideInput): string {
	if (planningGuideVolumeReq(input)) return "";
	if (!input.noVolumes) return "";
	return "本书为无卷模式（《故事状态.md》use_volumes=false，纯 书籍→章节 扁平结构，全书不设卷）：《策划指南》不得输出任何分卷信息——禁止出现「第X卷」「卷名」「分卷规划」「按卷组织」等卷划分表述；全书主线、大事件序列、升级路径、反转与伏笔、节奏曲线一律以全书整体组织，布局只用相对位置（开篇/中段/后段/结局）表述";
}

/** v0.2.x+「策划指南」prompt：依据世界观设定生成书级《策划指南.md》——仅输出大事件简略内容，不处理章节问题。
 * 是后续书级/卷级大纲生成的既定规划约束。重新生成与首次生成同一口径：不注入现有《策划指南》，只依据既定事实重新生成。 */
export function buildPlanningGuidePrompt(input: PlanningGuideInput): string {
	const sectionsBlock = PLANNING_GUIDE_SECTIONS.map((s, i) => `## ${s.no}、${s.title}\n${s.req}${i < PLANNING_GUIDE_SECTIONS.length - 1 ? "\n\n" : ""}`).join("");
	// v0.3.3+：上下文含【时间线】块（阶段 0 清单含 timeline，书级《时间线.md》无有效条目时已先生成落盘）时，大事件以该时间轴为基础展开、不得冲突
	const hasTimeline = (input.contextDocs || "").includes("【时间线】");
	const reqs: string[] = [
		`请根据下面的书籍设定（尤其是世界观${hasTimeline ? "与【时间线】" : ""}），为本书生成一份《策划指南》，${hasTimeline ? "「二、大事件序列」须以【时间线】的时间点与事件为基础展开、不得与其冲突，" : ""}重点输出大事件的简略内容：\n\n${sectionsBlock}`,
	];
	const volReq = planningGuideVolumeReq(input); // v0.2.25+：有卷时按卷组织（十节结构不变，节内按卷分 H3）
	if (volReq) reqs.push(volReq);
	else { const noVol = planningGuideNoVolReq(input); if (noVol) reqs.push(noVol); } // v0.4.x+：无卷模式附禁卷强提示

	reqs.push("只输出策划指南正文本身（上述十个 H2 节），不要输出 H1 标题、解释、前言说明或代码块包裹");

	const parts: string[] = [`请根据下面的书籍设定，为「${input.bookTitle}」生成一份《策划指南》。\n\n它是后续书级/卷级大纲生成的既定规划约束，大纲生成时必须遵循、不得违背。\n\n要求：\n${reqs.map((r, i) => `${i + 1}. ${r}`).join("\n")}`];
	pushContextDocs(parts, input.contextDocs);
	return parts.join("\n");
}

/** v0.2.x+ 策划指南自动续写 prompt：单次输出被 max_tokens 截断时从现有文本的截断处继续（不重复已生成内容）；
 * missing 为空＝十节标题均已出现（可能只是末节尾部被切），此时只补剩余部分、若实际已完整则模型精确回复「已完成」供主流程停轮 */
export function buildPlanningGuideContinuePrompt(input: PlanningGuideInput, existing: string, missing: string[]): string {
	const reqs: string[] = [
		"只从【已生成部分】被截断处继续写：不要重复、改写或总结任何已生成内容，不要输出 H1 标题、前言说明或代码块包裹",
		"若现有文本末尾停在某个节标题处或该节内容不完整，先补完该节（已有的标题行不要重复输出）",
	];
	const volReq = planningGuideVolumeReq(input); // v0.2.25+：与首轮 prompt 同口径的按卷组织要求
	if (volReq) reqs.push(volReq);
	else { const noVol = planningGuideNoVolReq(input); if (noVol) reqs.push(noVol); } // v0.4.x+：与首轮同口径——无卷模式续写同样附禁卷强提示，防续写段混入分卷信息
	if (missing.length) {
		reqs.push(`尚缺以下节，须按序补全：${missing.join("、")}`);
	} else {
		reqs.push("十个节均已出现：若最后一节内容不完整只补写剩余部分；若全文实际已完整，只回复两个字：已完成");
	}
	const detailSections = missing.length ? PLANNING_GUIDE_SECTIONS.filter((s) => missing.includes(`${s.no}、${s.title}`)) : PLANNING_GUIDE_SECTIONS;
	reqs.push(`各节写作要求（只针对尚缺/未写完的节）：\n${detailSections.map((s) => `## ${s.no}、${s.title}\n${s.req}`).join("\n\n")}`);
	reqs.push("只输出续写正文本身");
	const parts: string[] = [`《策划指南》上一次生成因长度限制被截断。请基于下面的书籍设定与【已生成部分】，从截断处继续把《策划指南》写完整。\n\n它是后续书级/卷级大纲生成的既定规划约束，大纲生成时必须遵循、不得违背。\n\n要求：\n${reqs.map((r, i) => `${i + 1}. ${r}`).join("\n")}`];
	pushContextDocs(parts, input.contextDocs);
	parts.push(`\n【已生成部分 · 从截断处继续，勿重复】\n${(existing || "").trim()}`);
	return parts.join("\n");
}

// ---------- v0.3.3+ 时间线生成（阶段 0 前置：书级《案头资料/时间线.md》无有效条目时先用阶段 0 提示词生成、落盘后再继续生成策划指南；旧《大事件列表.md》及其生成链路已退场） ----------

export const TIMELINE_GEN_SYSTEM_PROMPT = "你是资深小说策划兼时间线管理者，擅长把世界观与主线拆解为按时间点与因果顺序排列、赌注逐步抬升的全书事件时间轴；输出的每个事件都严格写成「时间点 事件名」标题块＋「- 人物：」「- 事件：」「- 描述：」「- 影响：」「- 关联：」字段行的事件格式。";

export interface TimelineGenInput {
	bookTitle: string;
	contextDocs: string; // 调用方装配的上下文块串（【书籍信息】→【张力规则】→【世界观设定】，固定三+1块、不受引用文档配置框过滤）
}

export function buildTimelineGenPrompt(input: TimelineGenInput): string {
	const parts: string[] = [`请根据下面的书籍设定，为「${input.bookTitle}」生成一份《时间线》（全书事件时间轴）。\n\n它是全书主线事件按时间点排出的时间轴，后续《策划指南》与书级/卷级大纲都将以此为基础展开；时间线面板会以它做可视化与编辑（增删改节点、标记完成、沿关联跳转）。\n\n格式是硬性要求，必须严格照下面规定输出，违反任何一条都算失败输出：\n1. 首行为 H1 标题「# 时间线」，其下按时间点先后顺序列出全书主要事件（建议 10–20 条），须覆盖：开篇激励事件、关键转折、中段最大反转、最终高潮、结局落点\n2. 每个事件写成一个标题块：标题行＝「## 时间点 事件名」，时间点必填，取纯数字纪年（如 120）或 年-月（120-03）或 年-月-日（120-06-15）；纪年基准自选一个并在整份文档内保持一致，前史与背景事件用更早年份（如 -129-06）；事件名 4–12 个字，禁止在同行用「——」或冒号内联简述。其下字段行必须写成与时间线面板完全一致的事件格式，取值写在同行：「- 人物：」「- 事件：」「- 描述：」「- 影响：」「- 关联：」——人物/事件/描述/影响 四行对每条事件都必备；「- 描述：」写比「- 事件：」更详细的原因、经过与关键细节（时间线面板悬停时显示），不得与事件行同句照抄；「- 关联：」列出与该事件有因果承接的其他事件的事件名（须是本文档内出现过的标题名，顿号分隔，确实没有关联才可整行省略）；禁止写「- 完成：」行——那是面板勾选完成后才出现的标记。完整示例（只示范格式，不要照抄内容）：\n# 时间线\n## 120-06-15 黑市陷阱\n- 人物：程野、姜叙\n- 事件：程野为查明真相进入灰区购买未过滤的记忆片段，卖家递来的线索实则是定位器\n- 描述：灰区市场在守序者巡逻周期的盲区开市，姜叙的渠道递来的片段被人做过手脚，程野买完才察觉信号在反向发射\n- 影响：守序者的监控网络锁定程野行踪，他被列为重点监视对象\n## 120-06-20 雨夜出逃\n- 人物：程野\n- 事件：守序者上门抓捕，程野借姜叙提供的下水道图脱身\n- 描述：抓捕出动封街的三个小组，程野利用换岗间隙从检修井离开，代价是丢掉公开身份的全部证件\n- 影响：程野转入地下，原有人际与资源暂时失联\n- 关联：黑市陷阱\n3. 禁止的输出形态（每一条都不允许出现）：「1.」「2.」「3.」这类编号清单行；标题行之外的裸事件行；「- 完成：」行；字段名写成「- 人物 :」或取值另起一行的字段；标题行只有时间点没有事件名、或只有事件名没有时间点；把简述写进标题行；前言说明；代码块包裹\n4. 层级用标题深度表达：## ＝大事件；其下 ### ＝小事件（大事件的阶段性构成）；再下 #### ＝旁支事件（支线/配角反应/暗线）。只在确有分级必要时才用 ###／####，不为凑层级而拆；各级一律用第 2 条的「时间点＋事件名」标题行＋字段行格式\n5. 时间点须与因果顺序一致：承接前因的事件，时间点不得早于它所承接的事件；子事件的时间点落在其父事件的时间范围内\n6. 事件之间须有因果承接（因此/但是），禁止靠巧合推动剧情\n7. 赌注与代价随时间轴逐步抬升，张力有松有紧；最大反转落在中段附近、高潮落在后段（用时间点与相对位置表述，不指定具体章号）\n8. 事件必须与世界观设定兼容，不得违背其硬规则；人物的行动与决定只依赖其当时已知悉的信息\n9. 只输出《时间线》正文本身（从「# 时间线」开始），不要输出任何别的内容`];
	pushContextDocs(parts, input.contextDocs);
	return parts.join("\n");
}

// ---------- v0.3.0+ 世界观生成（auto-book 流水线首阶段：新命令「生成世界观」→ 书级《案头资料/世界观.md》） ----------

export const WORLDVIEW_GEN_SYSTEM_PROMPT = "你是资深小说世界观设计师，擅长把一句话设定扩写为自洽、可供全书创作引用的世界观设定文档。";

export interface WorldviewGenInput {
	bookTitle: string;
	premise: string; // 一句话设定（核心输入：state.one_line，弹窗可改）
	contextDocs?: string; // 调用方装配的上下文块串（【书籍信息】→【张力规则】，经引用文档配置框过滤）
}

/** 世界观生成 prompt：以一句话设定为种子生成书级《世界观.md》——固定 H2 小节、首行 H1；
 * 输出为自由格式文档（readWorldDoc.fullText 原样注入后续提示词），小节只是推荐骨架、允许按题材增删 */
export function buildWorldviewGenPrompt(input: WorldviewGenInput): string {
	const reqs: string[] = [
		`以【一句话设定】为种子扩写：${input.premise}\n世界观必须支撑这句话隐含的故事发生——主角与冲突在世界观中有明确的落点（谁是主角、他为什么不得不行动、阻碍来自哪种规则或势力）`,
		"按以下 H2 小节组织（可按题材增删改名，但「世界基本规则」与「世界观红线」两节必须有）：\n## 世界与类型\n## 世界基本规则（硬规则，逐条编号）\n## 势力与阵营\n## 地理与关键地点\n## 历史与时间线\n## 力量/科技/社会体系\n## 主角与世界的关系\n## 世界观红线（全书创作不得违背的硬规则，逐条列出）",
		"硬规则须具体、可判定、彼此不矛盾（写「魔法施放须消耗记忆，施法者会遗忘用其施法的经历」，不写「魔法有代价」）；后续所有大事件与剧情都不得违背这些规则",
		"只写设定本身，不写情节大纲、不写章节规划、不复述一句话设定之外的既有剧情",
		"首行为 H1 标题「# 世界观」，各节用 H2；只输出世界观文档正文本身，不要解释、前言说明或代码块包裹",
	];
	const parts: string[] = [`请根据下面的一句话设定与书籍信息，为「${input.bookTitle}」生成一份《世界观》。\n\n它是后续《时间线》《策划指南》、书级/卷级大纲与全部章节写作的既定事实约束，必须自洽、具体、无内部矛盾。\n\n要求：\n${reqs.map((r, i) => `${i + 1}. ${r}`).join("\n")}`];
	pushContextDocs(parts, input.contextDocs);
	return parts.join("\n");
}

// ---------- v0.2.21+ 写作命令「正文＋摘要」同响应输出协议（正文与 <SUMMARY> 块一并产出，插件确定性解析后分别落盘）----------

/** 写作提示词末尾的摘要协议段：scope=摘要覆盖范围描述（如「本章正文」「新续写部分」）。四条标准与延迟生成的 buildChapterSummaryPrompt 保持一致 */
function summaryTailInstruction(scope: string): string {
	return "\n\n【摘要】" + scope + "写完后另起一行输出 <SUMMARY>，再下一行输出 200~300 字的" + scope + "摘要（只含：关键情节/人物状态/伏笔与悬念/新增信息），最后一行以 </SUMMARY> 收尾。摘要块中不要包含任何其他内容。";
}

/** 解析「正文＋<SUMMARY> 块」LLM 输出：取最后一个完整 <SUMMARY>…</SUMMARY> 块为摘要；正文＝块前/块后较长一侧（容忍模型把顺序写反），并剥离其余完整块防止标签残留；
 * 无完整块或摘要为空 → 整段当正文、summary=null（调用方静默回落到现有延迟生成，不重试不阻断——本地小模型不一定遵守协议） */
export function parseChapterWithSummary(raw: string): { body: string; summary: string | null } {
	const text = raw || "";
	const openTag = "<SUMMARY>";
	const closeTag = "</SUMMARY>";
	let open = text.lastIndexOf(openTag);
	while (open >= 0) {
		const close = text.indexOf(closeTag, open + openTag.length);
		if (close < 0) break; // 最后一个开标签之后没有闭标签 → 无完整块
		const summary = text.slice(open + openTag.length, close).trim();
		if (summary) {
			const before = text.slice(0, open);
			const after = text.slice(close + closeTag.length);
			const base = before.trim().length >= after.trim().length ? before : after;
			return { body: base.replace(/<SUMMARY>[\s\S]*?<\/SUMMARY>/g, "").trim(), summary };
		}
		open = text.lastIndexOf(openTag, open - 1); // 空块 → 尝试更早的开标签
	}
	return { body: text.trim(), summary: null };
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
	withSummary?: boolean; // v0.2.21+：要求同响应末尾输出 <SUMMARY> 摘要块（覆盖重写后的整章）
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
- **必须保留的**：角色性格一致性、本章大纲约束（大纲要点不得遗漏）、与前文/后文的衔接逻辑
- **可以改变的**：事件顺序、描写详略、对话比重、叙事角度、悬念设置
- **场景工艺**：每个场景有明确的目标与障碍；关键转折用动作、对话和细节演出来，不用叙述概括；章节结尾以本章情节的自然终点收束，有大纲「章末钩子」时落在钩子上，不以总结段落收尾
- **通顺与逻辑优先**：每句话成分完整、语序正常，读一遍就懂；每个行动都有动机和缘由，前后信息不断链——不得为追求风格写出病句、乱序或逻辑断裂的段落
- **禁止章节编号引用**：${CHAPTER_REF_BAN}

请直接输出正文内容，不要包含额外说明${input.withSummary ? "（末尾要求的摘要块除外）" + summaryTailInstruction("重写后的本章正文") : ""}`;
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

【写作上下文（含本卷与本章大纲、角色设定、前文摘要、世界观）】
${input.context}

${bridge || "（暂无章节大纲）"}

【本章全文】
${(input.chapterContent || "").slice(0, 6000)}

${input.userInstruction ? `【重点审阅要求】${input.userInstruction}` : ""}

请输出审阅报告，包含以下部分：
1. **本章概述**：本章讲了什么，在全局中的位置与作用（一两句话）
2. **逻辑问题**：时间线、因果、设定前后矛盾、人物行为不合常理之处（逐条列出，说明问题与依据）
3. **小说连贯性**：与前后章衔接、伏笔呼应、本卷与本章大纲推进是否符合
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

/** 去AI味主流程：先做句式简化，再最多 maxRounds 轮 LLM 逐句改写（词表来自 SKILLS/网文高频禁用词清单.md 解析结果）。
 * shouldAbort（可选）：每轮开跑前检查，返回 true 即就地收尾、不再发起后续轮次的 LLM 请求——
 * 用于「停止生成」后即时退出（改写函数自身被 abort 抛错时由调用方兜住）。 */
export async function cleanAiText(text: string, rewrite: AiRewriteFn, maxRounds: number, data: BannedWordsData, shouldAbort?: () => boolean): Promise<{ text: string; report: CleanReport }> {
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
		if (shouldAbort?.()) break; // 用户已停止：不再发起本轮改写，直接以当前进度收尾
		const sentences = findAiSentences(current, data);
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
	report.remaining = findAiWordHits(current, data);
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

// ---------- /typo-check 错别字检测（LLM 全文扫描 + 确定性校验） ----------

/** 错别字检测系统提示词：只校对不改写、不评价 */
export const TYPO_SCAN_SYSTEM_PROMPT =
	"你是中文网络小说的校对助手。只找错别字（同音字误用、形近字误写、「的/地/得」误用、人名地名等专名错字）。不改写句子、不调整标点、不评价文笔、不输出任何解释。";

/** 错别字检测用户提示词：要求 LLM 输出 <MARKED> 包裹的带 <u> 标记全文 + 建议改正 JSON 数组；解析后由插件做确定性校验 */
export function buildTypoScanPrompt(content: string): string {
	return (
		"请找出下面章节正文中的错别字（用错的字）。\n\n" +
		"严格按以下格式输出，不要输出任何其他内容：\n" +
		"第一行：<MARKED>\n" +
		"接下来是完整原文：把每个错字（或错词）用 <u> 和 </u> 包住（例如 <u>按耐</u>），其余字符一律不得增删改换顺序；没有错字就原样输出原文。\n" +
		"最后一行：</MARKED>\n" +
		"之后另起一行输出 JSON 数组（可多行），每个元素形如 {\"wrong\":\"错字\",\"right\":\"建议改正\"}，与 <u> 标记按出现顺序一一对应；没有错字则输出 []。\n\n" +
		"【章节正文】\n---\n" + content + "\n---"
	);
}

/** LLM 输出中 <u> 标记的位置与文本（位置相对 marked 全文） */
export interface TypoMark { start: number; end: number; text: string }
/** 建议改正条目 */
export interface TypoSuggestion { wrong: string; right: string }

/** 解析并校验 LLM 错别字检测输出：取首个 <MARKED>…</MARKED> 段，剥掉 <u>/</u> 后必须与原文逐字一致（不一致返回 null 供重试）；
 * 建议列表取 </MARKED> 之后的 JSON 数组，解析失败降级为空（标记仍生效、只是无建议改正） */
export function parseTypoScan(raw: string, original: string): { marked: string; marks: TypoMark[]; suggestions: TypoSuggestion[] } | null {
	const open = raw.indexOf("<MARKED>");
	const close = open >= 0 ? raw.indexOf("</MARKED>", open) : -1;
	if (open < 0 || close < 0) return null;
	let marked = raw.slice(open + "<MARKED>".length, close);
	// 确定性校验：剥掉 <u>/</u> 后必须与原文逐字一致；模型把标记各占一行时容忍首尾各一个协议换行
	if (marked.replace(/<\/?u>/g, "") !== original) {
		const t = marked.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
		if (t.replace(/<\/?u>/g, "") === original) marked = t;
		else return null; // 全文回显有任何漂移即判失败
	}
	const marks: TypoMark[] = [];
	const re = /<u>([\s\S]*?)<\/u>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(marked)) !== null) {
		marks.push({ start: m.index, end: m.index + m[0].length, text: m[1] });
	}
	const suggestions: TypoSuggestion[] = [];
	const tail = raw.slice(close + "</MARKED>".length);
	const jb = tail.indexOf("[");
	const je = tail.lastIndexOf("]");
	if (jb >= 0 && je > jb) {
		try {
			const parsed: unknown = JSON.parse(tail.slice(jb, je + 1));
			if (Array.isArray(parsed)) {
				for (const item of parsed as Array<Record<string, unknown>>) {
					const wrong = typeof item?.wrong === "string" ? item.wrong.trim() : "";
					const right = typeof item?.right === "string" ? item.right.trim() : "";
					if (wrong && right) suggestions.push({ wrong, right });
				}
			}
		} catch { /* JSON 解析失败降级为空建议列表 */ }
	}
	return { marked, marks, suggestions };
}

/** 把 marked 全文中的 <u> 标记转换为可落盘的下划线 span（有建议改正时带 title 属性，Obsidian 阅读视图悬停可见），
 * 返回标记后文本与按出现顺序的「错字 → 建议」清单（供预览展示）。
 * 建议映射：条数与标记数一致时按顺序一一对应；否则按 wrong===标记文本 匹配（每条建议只用一次）；都匹配不到则该处无建议 */
export function applyTypoMarks(
	marked: string,
	marks: TypoMark[],
	suggestions: TypoSuggestion[]
): { text: string; list: Array<{ wrong: string; right: string | null }> } {
	const list: Array<{ wrong: string; right: string | null }> = [];
	const pool = [...suggestions];
	const rightFor = (i: number, text: string): string | null => {
		if (suggestions.length === marks.length) return suggestions[i]?.right ?? null;
		const idx = pool.findIndex((s) => s.wrong === text);
		if (idx >= 0) return pool.splice(idx, 1)[0].right;
		return null;
	};
	let out = "";
	let cursor = 0;
	for (let i = 0; i < marks.length; i++) {
		const mk = marks[i];
		out += marked.slice(cursor, mk.start);
		const right = rightFor(i, mk.text);
		list.push({ wrong: mk.text, right });
		out += right != null
			? `<span style="text-decoration:underline" title="建议改为：${right.replace(/"/g, "&quot;")}">${mk.text}</span>`
			: `<span style="text-decoration:underline">${mk.text}</span>`;
		cursor = mk.end;
	}
	out += marked.slice(cursor);
	return { text: out, list };
}
