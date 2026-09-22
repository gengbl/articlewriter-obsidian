// 移植自 Python 版 story/documents.py + context_builder.py + foreshadow.py：
// 纯函数（字符串进、字符串出）的 MD 文档解析与格式化，格式与 CLI 版完全兼容。

export interface VolumeInfo {
	id: string;
	name: string;
	description: string;
	order: number;
}

export interface SceneDoc {
	scene_id: string;
	title?: string;
	description?: string;
	chapter_num: number; // 0 = 全局未归属；卷内本地章号（v0.0.15 起各容器独立编号）
	vol?: string; // 运行态卷归属标签（仅加载时打标、不写盘），供跨卷展示与移动定位
	characters: string[];
	notes?: string;
	created_at?: string;
	updated_at?: string;
	content?: string;
}

export interface CharacterDoc {
	name: string;
	chapter: number; // 归属章节号（0 = 全局；卷内本地章号）
	vol?: string; // 运行态卷归属标签（仅加载时打标、不写盘）
	identity?: string;
	age?: string;
	gender?: string;
	personality?: string;
	appearance?: string;
	background?: string;
	abilities: string[];
	notes?: string;
}

export interface ForeshadowItem {
	chapter: string; // v0.0.15：复合键「N」（书根）或「卷id:N」；章号按容器独立编号，裸号只在本容器内有效
	index?: number; // 章内序号（0 起，保存时按顺序重编号；解析自标题「第N章 伏笔K」/「<卷名>·第N章 伏笔K」）
	character?: string;
	reason?: string;
	done: boolean;
}

export interface WorldSettingDoc {
	name?: string;
	world_type?: string;
	rules: string[];
	factions: string[];
	locations: string[];
	history?: string;
	magic_system?: string;
}

export interface ChapterInfoDoc {
	volume?: string;
	tags: string[];
	notes?: string;
	created_at?: string;
	updated_at?: string;
}

// ---------- 通用工具 ----------

/** 去掉 HTML 注释（<!-- ... -->，跨行），读取解析前统一调用 */
export function stripComments(text: string): string {
	return text.replace(/<!--[\s\S]*?-->/g, "");
}

export function joinList(items: Array<string | undefined | null>): string {
	return (items || []).filter((x) => x != null && String(x).trim() !== "").map(String).join("、");
}

export function splitList(text: string): string[] {
	return String(text || "")
		.split(/[、,，]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** 按 "## " 二级标题切块，返回各块正文（含首行标题） */
function h2Blocks(text: string): string[] {
	const parts = text.split(/^##\s+/m);
	return parts.slice(1);
}

// ---------- 中文数字（打包/导出用，对齐 ExportManager._chapter_num_cn）----------

const CN_DIGITS = "零一二三四五六七八九";

/** 章节号转中文数字：1→一、12→十二、21→二十一；<0 或 >=1000 原样返回十进制串 */
export function numToCn(num: number): string {
	num = Math.trunc(num);
	if (num <= 0 || num >= 1000) return String(num);
	if (num < 10) return CN_DIGITS[num];
	if (num < 20) return "十" + (num % 10 ? CN_DIGITS[num % 10] : "");
	if (num < 100) {
		const [tens, ones] = divmod(num, 10);
		return CN_DIGITS[tens] + "十" + (ones ? CN_DIGITS[ones] : "");
	}
	const [hundreds, rest] = divmod(num, 100);
	let s = CN_DIGITS[hundreds] + "百";
	if (rest) s += rest < 10 ? "零" + CN_DIGITS[rest] : numToCn(rest);
	return s;
}

function divmod(n: number, d: number): [number, number] {
	return [Math.floor(n / d), n % d];
}

/** 中文数字转整数（支持 零一二两三四五六七八九十百，<1000）；失败返回 null */
export function cnToNum(text: string): number | null {
	const t = String(text || "").trim().replace(/两/g, "二");
	if (!t) return null;
	if (/^\d+$/.test(t)) return parseInt(t, 10);
	if (!/^[零一二三四五六七八九十百]+$/.test(t)) return null;
	let total = 0; // 十位段累计
	let section = 0; // 百位段
	let digit = 0; // 当前单个数字（待乘单位）
	for (const ch of t) {
		if (ch === "零") continue;
		if (ch === "百") {
			section = (digit || 1) * 100;
			digit = 0;
		} else if (ch === "十") {
			total += (digit || 1) * 10;
			digit = 0;
		} else {
			const d = "一二三四五六七八九".indexOf(ch) + 1;
			if (d <= 0) return null;
			digit = d;
		}
	}
	return total + section + digit;
}

// ---------- 卷（卷.md）----------

export function parseVolumes(text: string): Record<string, VolumeInfo> {
	const result: Record<string, VolumeInfo> = {};
	let cur: VolumeInfo | null = null;
	for (const line of stripComments(text).split("\n")) {
		const s = line.trim();
		let m = /^##\s+(.+)$/.exec(s);
		if (m) {
			cur = { id: m[1].trim(), name: "", description: "", order: 0 };
			result[cur.id] = cur;
			continue;
		}
		if (!cur) continue;
		m = /^-?\s*名称[：:]\s*(.+)$/.exec(s);
		if (m) {
			cur.name = m[1].trim();
			continue;
		}
		m = /^-?\s*描述[：:]\s*(.+)$/.exec(s);
		if (m) {
			cur.description = m[1].trim();
			continue;
		}
		m = /^-?\s*顺序[：:]\s*(\d+)$/.exec(s);
		if (m) cur.order = parseInt(m[1], 10);
	}
	return result;
}

export function formatVolumes(title: string, vols: Record<string, VolumeInfo>): string {
	const lines = [`# ${title} 卷`, ""];
	for (const vol of Object.values(vols).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
		lines.push(`## ${vol.id}`);
		lines.push(`- 名称：${vol.name}`);
		if (vol.description) lines.push(`- 描述：${vol.description}`);
		lines.push(`- 顺序：${vol.order}`);
		lines.push("");
	}
	return lines.join("\n");
}

// ---------- 场景（场景.md，全局或章节内）----------

export function parseScenes(text: string, defaultChapter: number): Record<string, SceneDoc> {
	const result: Record<string, SceneDoc> = {};
	for (const block of h2Blocks(stripComments(text))) {
		const lines = block.split("\n");
		const sid = lines[0].trim();
		if (!sid) continue;
		const scene: SceneDoc = { scene_id: sid, chapter_num: defaultChapter, characters: [] };
		const contentParts: string[] = [];
		let inFence = false;
		for (let i = 1; i < lines.length; i++) {
			const s = lines[i].trim();
			if (s.startsWith("```")) {
				inFence = !inFence;
				continue;
			}
			if (inFence) {
				contentParts.push(lines[i]);
				continue;
			}
			let m = /^-?\s*标题[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.title = m[1].trim();
				continue;
			}
			m = /^-?\s*描述[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.description = m[1].trim();
				continue;
			}
			m = /^-?\s*章节[：:]\s*(\d+)$/.exec(s);
			if (m) {
				scene.chapter_num = parseInt(m[1], 10);
				continue;
			}
			m = /^-?\s*角色[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.characters = splitList(m[1]);
				continue;
			}
			m = /^-?\s*备注[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.notes = m[1].trim();
				continue;
			}
			m = /^-?\s*创建[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.created_at = m[1].trim();
				continue;
			}
			m = /^-?\s*更新[：:]\s*(.+)$/.exec(s);
			if (m) scene.updated_at = m[1].trim();
		}
		if (contentParts.length) scene.content = contentParts.join("\n").trim();
		result[sid] = scene;
	}
	return result;
}

export function formatScenes(heading: string, scenes: Record<string, SceneDoc>): string {
	const lines = [`# ${heading} 场景`, ""];
	for (const scene of Object.values(scenes).sort((a, b) => a.scene_id.localeCompare(b.scene_id))) {
		lines.push(`## ${scene.scene_id}`);
		if (scene.description) lines.push(`- 描述：${scene.description}`);
		if (scene.chapter_num) lines.push(`- 章节：${scene.chapter_num}`);
		if (scene.characters.length) lines.push(`- 角色：${joinList(scene.characters)}`);
		if (scene.notes) lines.push(`- 备注：${scene.notes}`);
		if (scene.created_at) lines.push(`- 创建：${scene.created_at}`);
		if (scene.updated_at) lines.push(`- 更新：${scene.updated_at}`);
		if (scene.content) lines.push("", "正文：", "```text", scene.content, "```");
		lines.push("");
	}
	return lines.join("\n");
}

// ---------- 人物（人物.md，全局或章节内）----------

export function parseCharacters(text: string, chapterNum: number): Record<string, CharacterDoc> {
	const result: Record<string, CharacterDoc> = {};
	for (const block of h2Blocks(stripComments(text))) {
		const lines = block.split("\n");
		const name = lines[0].trim();
		if (!name) continue;
		const char: CharacterDoc = { name, chapter: chapterNum, abilities: [] };
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i].trim().replace(/^-\s*/, "");
			const m = /^(身份|年龄|性别|性格|外貌|背景|能力|备注)[：:]\s*(.+)$/.exec(line);
			if (!m) continue;
			const key = m[1];
			const val = m[2].trim();
			switch (key) {
				case "身份": char.identity = val; break;
				case "年龄": char.age = val; break;
				case "性别": char.gender = val; break;
				case "性格": char.personality = val; break;
				case "外貌": char.appearance = val; break;
				case "背景": char.background = val; break;
				case "能力": char.abilities = splitList(val); break;
				case "备注": char.notes = val; break;
			}
		}
		result[name] = char;
	}
	return result;
}

export function formatCharacters(heading: string, chars: Record<string, CharacterDoc>): string {
	const lines = [`# ${heading} 人物`, ""];
	for (const char of Object.values(chars).sort((a, b) => a.name.localeCompare(b.name))) {
		lines.push(formatCharacterBlock(char));
		lines.push("", "---", "");
	}
	return lines.join("\n");
}

/** 单个角色块（对齐 DocumentStore._format_character） */
export function formatCharacterBlock(char: CharacterDoc): string {
	const lines = [`## ${char.name}`];
	if (char.identity) lines.push(`- 身份：${char.identity}`);
	if (char.age) lines.push(`- 年龄：${char.age}`);
	if (char.gender) lines.push(`- 性别：${char.gender}`);
	if (char.personality) lines.push(`- 性格：${char.personality}`);
	if (char.appearance) lines.push(`- 外貌：${char.appearance}`);
	if (char.background) lines.push(`- 背景：${char.background}`);
	if (char.abilities.length) lines.push(`- 能力：${joinList(char.abilities)}`);
	if (char.notes) lines.push(`- 备注：${char.notes}`);
	return lines.join("\n");
}

// ---------- 伏笔（伏笔.md + [伏]...[/] 标记解析，对齐 story/foreshadow.py；v0.0.15 起章节号为复合键「N」/「卷id:N」）----------

const FORESHADOW_BLOCK_RE = /\[伏\]([\s\S]*?)\[\/?(?:伏)?\]/g;

/** 卷名/卷ID → 卷ID 的解析表（跨卷引用与标题前缀共用） */
export type VolumeKeyIndex = Record<string, string>;

/** 把「卷前缀+本地章号」拼成复合键：无前缀=书根裸号 */
function scopeChapterKey(volId: string | null | undefined, num: number): string {
	return volId ? `${volId}:${num}` : String(num);
}

/** 拆复合键为 {vol,num}（无冒号=书根） */
export function splitChKey(key: string): { vol: string | null; num: number } {
	const i = key.indexOf(":");
	if (i < 0) return { vol: null, num: parseInt(key, 10) };
	return { vol: key.slice(0, i), num: parseInt(key.slice(i + 1), 10) };
}

/**
 * 解析单条伏笔文本（章节/人物/事由字段任意顺序；无字段时按「人物：事由」再退回整段为事由）。
 * 「章节：N」继承 defaultScope 所在容器；「章节：<卷名>第N章」（或 <卷ID>:N）显式跨卷。
 */
export function parseForeshadowText(text: string, defaultScope: string, volIndex?: VolumeKeyIndex): ForeshadowItem {
	const defVol = splitChKey(defaultScope).vol;
	let chapter = defaultScope;
	const mChap = /章节\s*[:：=]\s*(?:(\S+?)\s*第)?(\d+)/.exec(text);
	if (mChap) {
		const prefix = mChap[1] ?? "";
		const n = parseInt(mChap[2], 10);
		chapter = prefix ? scopeChapterKey(volIndex?.[prefix] ?? prefix, n) : scopeChapterKey(defVol, n);
	}
	let character = "";
	const mChar = /人物\s*[:：=]\s*([^；;，,\n]*?)(?=\s*事由\s*[:：=]|[；;，,\n]|$)/.exec(text);
	if (mChar) character = mChar[1].trim();
	const mReason = /事由\s*[:：=]\s*([\s\S]+)/.exec(text);
	if (mReason) return { chapter, character, reason: mReason[1].trim(), done: false };
	// 无显式事由：去掉已识别的 章节/人物 字段后看剩余
	let rest = text.replace(/章节\s*[:：=]\s*(?:\S+\s*第)?\d+\s*/g, "");
	rest = rest.replace(/人物\s*[:：=]\s*[^；;，,\n]*?(?=\s*事由\s*[:：=]|[；;，,\n]|$)/g, "");
	rest = rest.trim().replace(/^[\s \t，,；;。:：\-–—|、()（）]+|[\s \t，,；;。:：\-–—|、()（）]+$/g, "");
	if (!rest) return { chapter, character, reason: character || "", done: false };
	if (rest.includes("：") && !/^(人物|事由|章节)/.test(rest)) {
		const idx = rest.indexOf("：");
		const c = rest.slice(0, idx).trim();
		const r = rest.slice(idx + 1).trim();
		if (c && r) return { chapter, character: c, reason: r, done: false };
	}
	return { chapter, character, reason: rest, done: false };
}

/** 解析大纲中的 [伏]...[/]（或 [/伏]）标记 */
export function extractForeshadows(outline: string, defaultScope: string, volIndex?: VolumeKeyIndex): ForeshadowItem[] {
	const items: ForeshadowItem[] = [];
	if (!outline) return items;
	FORESHADOW_BLOCK_RE.lastIndex = 0; // 模块级 /g 正则：扫描前复位，防上次调用残留状态
	let fm: RegExpExecArray | null;
	while ((fm = FORESHADOW_BLOCK_RE.exec(outline)) !== null) {
		const content = fm[1].trim();
		if (!content) continue;
		const item = parseForeshadowText(content, defaultScope, volIndex);
		if (item.reason || item.character) items.push(item);
	}
	return items;
}

/** 去掉伏笔标志 [伏]/[/伏]（保留内容文本；[/] 是详略通用结束标记，不删） */
export function stripForeshadowMarks(outline: string): string {
	return String(outline || "").replace(/\[伏\]/g, "").replace(/\[\s*\/\s*伏\s*\]/g, "");
}

/**
 * 读取 伏笔.md：按「章节+序号」块解析，返回按 (复合键, 序号) 排序的列表。
 * 标题兼容两种形态：书根 `## 第N章 伏笔K`（旧格式原样可读）、卷内 `## <卷名或ID>·第N章 伏笔K`（前缀经 volIndex 归一为卷 ID）。
 */
export function parseForeshadows(text: string, volIndex?: VolumeKeyIndex): ForeshadowItem[] {
	const result: Array<[string, number, ForeshadowItem]> = [];
	for (const block of h2Blocks(stripComments(text))) {
		const lines = block.split("\n");
		const head = lines[0].trim();
		const m = /^(?:(.+?)·)?第\s*(\d+)\s*章\s*伏笔\s*(\d+)\s*$/.exec(head);
		if (!m) continue;
		const idx = parseInt(m[3], 10);
		const prefix = (m[1] ?? "").trim();
		const num = parseInt(m[2], 10);
		const chapter = prefix ? scopeChapterKey(volIndex?.[prefix] ?? prefix, num) : String(num);
		const item: ForeshadowItem = { chapter, index: idx, done: false };
		for (let i = 1; i < lines.length; i++) {
			const s = lines[i].trim();
			let m2 = /^-?\s*人物[：:]\s*(.+)$/.exec(s);
			if (m2) {
				item.character = m2[1].trim();
				continue;
			}
			m2 = /^-?\s*事由[：:]\s*(.+)$/.exec(s);
			if (m2) {
				item.reason = m2[1].trim();
				continue;
			}
			m2 = /^-?\s*状态[：:]\s*(.+)$/.exec(s);
			if (m2) item.done = m2[1].includes("已完成");
		}
		result.push([chapter, idx, item]);
	}
	return result.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]).map((x) => x[2]);
}

/**
 * 写 伏笔.md（按复合键分组、组内按序号重新编号，对齐 DocumentStore.write_foreshadows）。
 * volNames 提供卷 ID→名称 映射时卷内标题用卷名展示；缺省退回卷 ID。
 */
export function formatForeshadows(title: string, items: ForeshadowItem[], volNames?: Record<string, string>): string {
	const byChapter = new Map<string, ForeshadowItem[]>();
	for (const item of items) {
		if (!byChapter.has(item.chapter)) byChapter.set(item.chapter, []);
		byChapter.get(item.chapter)!.push(item);
	}
	const lines = [`# ${title} 伏笔`, ""];
	for (const chap of [...byChapter.keys()].sort((a, b) => a.localeCompare(b))) {
		const { vol, num } = splitChKey(chap);
		const head = vol ? `${volNames?.[vol] ?? vol}·第${num}章` : `第${num}章`;
		byChapter.get(chap)!.forEach((item, idx) => {
			lines.push(`## ${head} 伏笔${idx}`);
			if (item.character) lines.push(`- 人物：${item.character}`);
			if (item.reason) lines.push(`- 事由：${item.reason}`);
			lines.push(`- 状态：${item.done ? "已完成" : "未完成"}`);
			lines.push("");
		});
	}
	return lines.join("\n");
}

// ---------- 世界观（世界观.md）----------

export function parseWorld(text: string): WorldSettingDoc {
	const ws: WorldSettingDoc = { rules: [], factions: [], locations: [] };
	let fenceTarget: "history" | "magic_system" | null = null; // ```text 围栏归属（显式 - 历史：/- 力量体系：或 ## 标题）
	let buf: string[] = [];
	let inFence = false;
	for (const line of stripComments(text).split("\n")) {
		const s = line.trim();
		if (s.startsWith("```")) {
			if (inFence) {
				if (fenceTarget) ws[fenceTarget] = buf.join("\n").trim();
				inFence = false;
				fenceTarget = null;
				buf = [];
			} else {
				inFence = true;
			}
			continue;
		}
		if (inFence) {
			buf.push(line);
			continue;
		}
		let m = /^##\s+(.+)$/.exec(s);
		if (m) {
			const h = m[1].trim();
			if (/^(历史|背景)$/.test(h)) fenceTarget = "history";
			else if (h === "力量体系") fenceTarget = "magic_system";
			else fenceTarget = null;
			continue;
		}
		m = /^-?\s*世界[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.name = m[1].trim();
			continue;
		}
		m = /^-?\s*类型[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.world_type = m[1].trim();
			continue;
		}
		m = /^-?\s*规则[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.rules = splitList(m[1]);
			continue;
		}
		m = /^-?\s*势力[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.factions = splitList(m[1]);
			continue;
		}
		m = /^-?\s*地点[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.locations = splitList(m[1]);
			continue;
		}
		if (/^-?\s*历史[：:]?\s*$/.test(s)) {
			fenceTarget = "history";
			buf = [];
			continue;
		}
		if (/^-?\s*力量体系[：:]?\s*$/.test(s)) {
			fenceTarget = "magic_system";
			buf = [];
		}
	}
	return ws;
}

export function formatWorld(title: string, ws: WorldSettingDoc): string {
	const lines = [`# ${title} 世界观`, ""];
	if (ws.name) lines.push(`- 世界：${ws.name}`);
	if (ws.world_type) lines.push(`- 类型：${ws.world_type}`);
	if (ws.rules.length) lines.push(`- 规则：${joinList(ws.rules)}`);
	if (ws.factions.length) lines.push(`- 势力：${joinList(ws.factions)}`);
	if (ws.locations.length) lines.push(`- 地点：${joinList(ws.locations)}`);
	if (ws.history) lines.push("", "- 历史：", "```text", ws.history, "```");
	if (ws.magic_system) lines.push("", "- 力量体系：", "```text", ws.magic_system, "```");
	return lines.join("\n");
}

// ---------- 章节信息（章节信息.md）----------

/** 解析章节信息文档；保留无法识别的行由调用方处理 */
export function parseChapterInfo(text: string): ChapterInfoDoc & { preservedLines: string[] } {
	const info: ChapterInfoDoc & { preservedLines: string[] } = { tags: [], preservedLines: [] };
	let inComment = false;
	for (const line of String(text || "").split("\n")) {
		const s = line.trim();
		if (!s) continue;
		if (inComment) {
			info.preservedLines.push(line);
			if (s.includes("-->")) inComment = false;
			continue;
		}
		if (s.startsWith("#")) continue;
		if (s.includes("<!--")) {
			inComment = !s.includes("-->");
			info.preservedLines.push(line);
			continue;
		}
		const m = /^-?\s*(卷|标签|备注|创建时间|更新时间)[：:]\s*/.exec(s);
		if (m) {
			const key = m[1];
			const val = s.slice(m[0].length).trim();
			switch (key) {
				case "卷": if (val) info.volume = val; break;
				case "标签": info.tags = splitList(val); break;
				case "备注": if (val) info.notes = val; break;
				case "创建时间": if (val) info.created_at = val; break;
				case "更新时间": if (val) info.updated_at = val; break;
			}
			continue;
		}
		info.preservedLines.push(line);
	}
	return info;
}

/** 重写章节信息文档（对齐 DocumentStore.write_chapter_info：保留注释与未管理行） */
export function formatChapterInfo(num: number, heading: string, info: ChapterInfoDoc): string {
	const lines = [`# 第${num}章 ${heading} 章节信息`];
	if (info.volume) lines.push(`- 卷：${info.volume}`);
	if (info.tags.length) lines.push(`- 标签：${joinList(info.tags)}`);
	if (info.notes) lines.push(`- 备注：${info.notes}`);
	if (info.created_at) lines.push(`- 创建时间：${info.created_at}`);
	if (info.updated_at) lines.push(`- 更新时间：${info.updated_at}`);
	lines.push(...(info as ChapterInfoDoc & { preservedLines?: string[] }).preservedLines ?? []);
	return lines.join("\n") + "\n";
}

// ---------- 人物关系（人物关系.md，书/卷/章三层通用；v0.1.9+ 人物关系面板解析器）----------

/** 一条人物关系（书/卷/章三层通用；type/status 未标注时为空串） */
export interface RelationshipEntry {
	a: string; // 角色1（关系主体）
	b: string; // 角色2（关系对象）
	type: string; // 关系类型（如 师徒/队友），空=未标注
	status: string; // 关系状态原文（如 active/进行中），空=未标注
	desc: string; // 关系描述（多行原文，已去字段行与代码围栏）
}

/** 关系状态归一化类别：面板据此上色（active=进行中、pending=铺垫中、ended=已结束、unknown=未标注/未识别） */
export function relationshipStatusKind(status: string): "active" | "pending" | "ended" | "unknown" {
	const s = String(status || "").trim().toLowerCase();
	if (!s) return "unknown";
	if (/(end|over|close|done|finish|已结束|结束|终止|解除|断裂|决裂|反目|死亡|已死|逝|完结|失效|结束)/.test(s)) return "ended";
	if (/(pending|plan|待定|待|计划|铺垫|未定|将来|未来|拟|筹划|萌芽|酝酿|伏笔)/.test(s)) return "pending";
	if (/(active|on\b|进行中|生效|有效|持续|正在|当前|存续|进行|已建立|成立)/.test(s)) return "active";
	return "unknown";
}

/** 关系条目字段行（- 角色1：X / - 类型：X / - 状态：X / - 描述：X） */
const REL_FIELD_RE = /^\s*[-*+]?\s*([^：:]{1,8})[：:]\s*(.*)$/;

/** 标题行拆角色对：支持 "林川 - 苏晚" / "林川 ↔ 苏晚" / "林川与苏晚"；无分隔符时整体作角色1（角色2 由字段行补） */
function splitRelationshipTitle(title: string): { a: string; b: string } {
	const t = title.trim();
	const m = /^(.+?)\s*(?:[-–—~〜↔=]|与|\/|／|、)\s*(.+)$/.exec(t);
	if (m) return { a: m[1].trim(), b: m[2].trim() };
	return { a: t, b: "" };
}

/**
 * 解析《人物关系.md》：按 `## ` 分块，每块一条关系。
 * 兼容两种写法——①标题带角色对：`## 林川 - 苏晚` + 描述（旧模板）；②字段式：`## 关系1` + `- 角色1：…` `- 角色2：…`（可带 `- 类型：` `- 状态：` `- 描述：`）。
 * 描述可为 `- 描述：` 后接正文、或 ```text 围栏内容、或块内剩余自由文本行（三者合并）。角色1/2 都解析不出的块整块忽略。
 */
export function parseRelationships(text: string): RelationshipEntry[] {
	const body = stripComments(text || "");
	const out: RelationshipEntry[] = [];
	let cur: { a: string; b: string; type: string; status: string; descLines: string[] } | null = null;
	let inFence = false;
	const flush = (): void => {
		if (!cur) return;
		const { a, b, type, status, descLines } = cur;
		cur = null;
		if (!a.trim() && !b.trim()) return; // 非关系块（如「概述」）忽略
		out.push({ a: a.trim(), b: b.trim(), type: type.trim(), status: status.trim(), desc: descLines.join("\n").trim() });
	};
	for (const rawLine of body.split("\n")) {
		const line = rawLine.replace(/\s+$/, "");
		if (/^\s*```/.test(line)) {
			inFence = !inFence; // 围栏标记行本身不进正文
			continue;
		}
		if (inFence) {
			if (cur) cur.descLines.push(line);
			continue;
		}
		if (/^##\s+/.test(line)) {
			flush();
			const { a, b } = splitRelationshipTitle(line.replace(/^##\s+/, ""));
			cur = { a, b, type: "", status: "", descLines: [] };
			continue;
		}
		if (/^#\s+/.test(line)) continue; // 文档 H1 标题行忽略
		if (!cur) continue; // 尚未进入任何 ## 块的内容（如块外散文）忽略
		const m = REL_FIELD_RE.exec(line);
		if (m) {
			const key = m[1].trim();
			const val = m[2].trim();
			if (/^(角色1|角色一|角色A|角色a|甲方|主体|角色名1|角色1名)$/.test(key)) {
				if (val) cur.a = val;
				continue;
			}
			if (/^(角色2|角色二|角色B|角色b|乙方|对象|角色名2|角色2名)$/.test(key)) {
				if (val) cur.b = val;
				continue;
			}
			if (/^(类型|关系类型|关系)$/.test(key)) {
				cur.type = val;
				continue;
			}
			if (/^(状态|关系状态)$/.test(key)) {
				cur.status = val;
				continue;
			}
			if (/^(描述|说明|详情|备注|简介)$/.test(key)) {
				if (val) cur.descLines.push(val);
				continue;
			}
			continue; // 其它字段（如「出场章节」）不并入描述
		}
		if (!line.trim()) continue;
		cur.descLines.push(line.trim()); // 无字段前缀的自由文本行也算描述
	}
	flush();
	return out;
}

/** 关系条目序列化为文档块（与 parseRelationships 往返一致；供模板/迁移使用） */
export function formatRelationshipBlock(e: RelationshipEntry): string {
	const head = e.b ? `${e.a} - ${e.b}` : e.a;
	const lines = [`## ${head}`];
	if (e.type) lines.push(`- 类型：${e.type}`);
	if (e.status) lines.push(`- 状态：${e.status}`);
	if (e.desc) lines.push("- 描述：", "```text", e.desc, "```");
	lines.push("");
	return lines.join("\n");
}

/** 关系列表序列化为完整文档（标题恒为 `# 人物关系`） */
export function formatRelationships(items: RelationshipEntry[]): string {
	return ["# 人物关系", "", ...items.map((e) => formatRelationshipBlock(e))].join("\n").replace(/\n+$/, "\n");
}

// ---------- 时间线（时间线.md，书/卷/章三层通用；v0.2.x+ 时间线面板解析器）----------

/** 一条时间线事件（书/卷/章三层通用）：时间点＝整年＋可选月日（如 -129 / -129-06 / -129-06-15），兼容旧版纯数字写法（小数/科学计数法按「仅年份」处理）；面板按 (年,月,日) 升序自上而下渲染 */
export interface TimelineEntry {
	time: number; // 年份（任意数字，负数/小数兼容旧数据）
	month?: number; // 月份（1-12；未写则缺省）
	day?: number; // 日期（1-31；未写则缺省）
	chars: string[]; // 涉及人物（空数组=未标注）
	event: string; // 事件描述（多行原文，已去字段前缀与代码围栏标记）
}

/** 时间点结构化值（标题解析结果；序列化经 timelineTimeText 往返一致） */
export type TimelinePoint = Pick<TimelineEntry, "time" | "month" | "day">;

/** 纯数字时间点判定（支持 -3 / +2 / 1.5 / .5 / 1e4 等旧写法；带任何文字即非有效时间点） */
const TL_TIME_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** 年-月[-日] 整数时间点判定（如 -129-06、120-03-07；月日必须成对出现于连字符后，小数/科学计数法不允许挂月日后缀） */
const TL_DATE_MD_RE = /^([+-]?\d+)-(\d{1,2})(?:-(\d{1,2}))?$/;

export function parseTimelineTime(title: string): TimelinePoint | null {
	const t = title.trim();
	if (!t) return null;
	const dm = TL_DATE_MD_RE.exec(t); // 先试「年-月[-日]」：裸年份走下方纯数字分支，两路结果等价
	if (dm) {
		const mo = Number(dm[2]);
		const da = dm[3] ? Number(dm[3]) : undefined;
		if (mo < 1 || mo > 12) return null; // 非法月份整块视为非有效时间点
		if (da !== undefined && (da < 1 || da > 31)) return null;
		return { time: Number(dm[1]), month: mo, day: da };
	}
	if (!TL_TIME_RE.test(t)) return null;
	const n = Number(t);
	return Number.isFinite(n) ? { time: n } : null;
}

/** 时间点的规范文本（面板展示与写回标题共用）：纯数字原样；写了月/日则补零到两位（-129-06 / -129-06-15），可被 parseTimelineTime 原样解析回 */
export function timelineTimeText(p: TimelinePoint): string {
	let s = String(p.time);
	if (p.month != null) s += `-${String(p.month).padStart(2, "0")}`;
	if (p.day != null) s += `-${String(p.day).padStart(2, "0")}`;
	return s;
}

/**
 * 解析《时间线.md》：按 `## ` 分块，每块一条事件。
 * 标题必须是有效时间点——`年` / `年-月` / `年-月-日`（如 `## 120`、`## -3.5`〔旧纯数字写法〕、`## -129-06-15`），非法/非时间点标题的块（如「概述」、月份越界）整块忽略。
 * 块内字段行（复用 REL_FIELD_RE）：`- 人物：A、B`（别名 角色/登场人物/涉及人物/出场人物）、`- 事件：…`（别名 描述/说明/详情/备注/简介）。
 * 事件正文可为 `- 事件：` 后接文本、```text 围栏内容、或无字段前缀的自由文本行（三者合并）；其它字段（如「发生章节」）不并入。
 */
export function parseTimelines(text: string): TimelineEntry[] {
	const body = stripComments(text || "");
	const out: TimelineEntry[] = [];
	let cur: (TimelinePoint & { chars: string[]; eventLines: string[] }) | null = null;
	let inFence = false;
	const flush = (): void => {
		if (!cur) return;
		const e: TimelineEntry = { time: cur.time, chars: [...new Set(cur.chars)], event: cur.eventLines.join("\n").trim() };
		if (cur.month != null) e.month = cur.month; // 未写月/日的条目保持字段缺省（不显式落 undefined）
		if (cur.day != null) e.day = cur.day;
		out.push(e);
		cur = null;
	};
	for (const rawLine of body.split("\n")) {
		const line = rawLine.replace(/\s+$/, "");
		if (/^\s*```/.test(line)) {
			inFence = !inFence; // 围栏标记行本身不进正文
			continue;
		}
		if (inFence) {
			if (cur) cur.eventLines.push(line);
			continue;
		}
		if (/^##\s+/.test(line)) {
			flush();
			const t = parseTimelineTime(line.replace(/^##\s+/, ""));
			if (t === null) continue; // 非有效时间点标题块整块忽略（cur 已被 flush 置空，其下内容自然丢弃）
			cur = { ...t, chars: [], eventLines: [] };
			continue;
		}
		if (/^#\s+/.test(line)) continue; // 文档 H1 标题行忽略
		if (!cur) continue; // 尚未进入任何有效 ## 块的内容（如块外散文）忽略
		const m = REL_FIELD_RE.exec(line);
		if (m) {
			const key = m[1].trim();
			const val = m[2].trim();
			if (/^(人物|角色|登场人物|涉及人物|出场人物)$/.test(key)) {
				for (const c of splitList(val)) if (c && !cur.chars.includes(c)) cur.chars.push(c);
				continue;
			}
			if (/^(事件|描述|说明|详情|备注|简介)$/.test(key)) {
				if (val) cur.eventLines.push(val);
				continue;
			}
			continue; // 其它字段（如「发生章节」）不并入事件正文
		}
		if (!line.trim()) continue;
		cur.eventLines.push(line.trim()); // 无字段前缀的自由文本行也算事件正文
	}
	flush();
	return out;
}

/** 时间线条目序列化为文档块（与 parseTimelines 往返一致；标题经 timelineTimeText 规范化，含月日时补零到两位） */
export function formatTimelineBlock(e: TimelineEntry): string {
	const lines = [`## ${timelineTimeText(e)}`];
	if (e.chars.length) lines.push(`- 人物：${joinList(e.chars)}`);
	if (e.event) lines.push("- 事件：", "```text", e.event, "```");
	lines.push("");
	return lines.join("\n");
}

/** 时间线列表序列化为完整文档（标题恒为 `# 时间线`） */
export function formatTimelines(items: TimelineEntry[]): string {
	return ["# 时间线", "", ...items.map((e) => formatTimelineBlock(e))].join("\n").replace(/\n+$/, "\n");
}

// ---------- 大纲读取辅助 ----------

/** 去掉文档开头的 "# " 标题行，返回 [正文, 标题] */
export function stripTitleLine(text: string): [string, string] {
	const lines = String(text || "").split("\n");
	if (lines[0]?.trim().startsWith("# ")) {
		const title = lines[0].trim().replace(/^#+\s*/, "");
		return [lines.slice(1).join("\n").trim(), title];
	}
	return [String(text || "").trim(), ""];
}

// ---------- 章节号选择解析（pack/统计用；支持阿拉伯数字与中文数字、范围、列表）----------

export interface ChapterSelection {
	nums: number[]; // 去重升序，仅含 available 中存在的章
	invalid: string[]; // 无法识别的片段原文
}

/**
 * 解析章节选择表达式：
 * - "all"/"全部"/空 → 全部可用章
 * - 单章："3" / "三"
 * - 范围："3-7" / "3到7" / "三至七" / "3~7"
 * - 列表："1,2,5" / "1、2、5" / "1 2 5"（空白分隔）
 */
export function parseChapterSelection(text: string, available: number[]): ChapterSelection {
	const avail = new Set(available);
	const nums = new Set<number>();
	const invalid: string[] = [];
	const addNum = (n: number | null) => {
		if (n === null || n <= 0 || !avail.has(n)) {
			return false;
		}
		nums.add(n);
		return true;
	};
	const raw = String(text ?? "").trim();
	if (!raw || /^(all|全部)$/i.test(raw)) {
		for (const n of available) nums.add(n);
		return { nums: [...nums].sort((a, b) => a - b), invalid };
	}
	// 先按逗号/顿号切分，再处理其中的范围与纯数字片段
	let parts = raw.split(/[,，、]/).map((p) => p.trim()).filter(Boolean);
	// 无逗号时尝试按空白切分（如 "3 7 12"），但保留含连接符的完整范围片段
	if (parts.length === 1 && /\s/.test(parts[0])) {
		parts = parts[0].split(/\s+/).filter(Boolean);
	}
	for (let part of parts) {
		part = part.replace(/[～~]/g, "-");
		const rangeM = /^\s*(\d{1,6}|[一二三四五六七八九十百零两]+)\s*[-到至]\s*(\d{1,6}|[一二三四五六七八九十百零两]+)\s*$/.exec(part);
		if (rangeM) {
			const lo = cnToNum(rangeM[1]);
			const hi = cnToNum(rangeM[2]);
			if (lo === null || hi === null || lo > hi) {
				invalid.push(part);
				continue;
			}
			for (let n = lo; n <= hi; n++) addNum(n);
			continue;
		}
		const n = cnToNum(part);
		if (n !== null) {
			addNum(n);
		} else {
			invalid.push(part);
		}
	}
	return { nums: [...nums].sort((a, b) => a - b), invalid };
}
