// /analyze-cast 人物与场景分析——纯逻辑模块（无 vault 访问）：
// 逐章 LLM 分析的提示词构建 + JSON 解析 + 跨章聚合 + 出现范围定层 + 写盘计划。
// 落盘由 story_manager 的 saveCharacterLayer/saveSceneLayer/appendRelationships 执行，LLM 流式调用在 main.ts。
//
// 分层规则（按「出现范围」span 判定，平铺/卷模式通用）：
//   容器 = 章节复合键的归属卷（无卷=书根；平铺模式强制全部归书根）。
//   ≥2 个不同容器 → 书级；单容器内 ≥2 章 → 该容器级（书根→书级、卷→卷级）；仅 1 章 → 章级。
// 合并语义：同名条目「移动+字段合并」（现有字段优先、缺项补新），重复运行幂等自归位；
// 关系按 A-B 对去重，已存在的对跳过（纯追加）。

import type { CharacterDoc, RelationshipEntry, SceneDoc } from "./md_docs";
import { parseChKey } from "./state_doc";

/** 三层结构中的一个落点：book=书根 / volume=卷目录 / chapter=章节目录 */
export interface CastLayerRef {
	scope: "book" | "volume" | "chapter";
	volId?: string; // scope=volume
	chapterKey?: string; // scope=chapter（复合键 "N" 或 "volId:N"）
}

/** 单章分析结果（LLM 输出解析后的形状） */
export interface CastChapterAnalysis {
	characters: Array<{
		name: string;
		identity?: string;
		age?: string;
		gender?: string;
		personality?: string;
		appearance?: string;
		background?: string;
		abilities: string[];
		notes?: string;
	}>;
	scenes: Array<{
		scene_id: string;
		description?: string;
		characters: string[];
		notes?: string;
	}>;
	relationships: Array<{
		a: string;
		b: string;
		type?: string;
		status?: string;
		desc?: string;
	}>;
}

// ---------- 提示词 ----------

export const CAST_ANALYZE_SYSTEM_PROMPT =
	"你是中文网络小说的人物与场景分析助手。你阅读章节正文，提取人物设定、场景描述与人物关系，严格以 JSON 对象输出。不输出任何解释、前后缀或代码围栏。";

/** 逐章分析用户提示词：要求严格 JSON；knownNames/knownSceneIds 用于跨章名称归一 */
export function buildCastChapterPrompt(opts: {
	chapterLabel: string;
	content: string;
	knownNames: string[];
	knownSceneIds: string[];
	retryNote?: string;
}): string {
	const names = opts.knownNames.join("、");
	const scenes = opts.knownSceneIds.join("、");
	return (
		"请分析下面章节正文，提取三类信息：\n" +
		"1. characters：本章出现的所有人物（含仅被提及者）\n" +
		"2. scenes：本章事件发生的场景\n" +
		"3. relationships：本章中展现或暗示的人物关系\n\n" +
		"严格按以下单个 JSON 对象格式输出，不要包裹 ```json 代码围栏，不要输出任何其他内容：\n" +
		"{\n" +
		'  "characters": [\n' +
		'    {"name":"人名","identity":"身份/角色定位","age":"年龄","gender":"性别","personality":"性格特点","appearance":"外貌特征","background":"背景经历","abilities":["能力1","能力2"],"notes":"其他备注"}\n' +
		"  ],\n" +
		'  "scenes": [\n' +
		'    {"scene_id":"场景名","description":"场景描述","characters":["在场人物"],"notes":"其他备注"}\n' +
		"  ],\n" +
		'  "relationships": [\n' +
		'    {"a":"人物A","b":"人物B","type":"关系类型（如 朋友/敌对/亲属/师徒）","status":"关系当前状态","desc":"关系描述"}\n' +
		"  ]\n" +
		"}\n\n" +
		"要求：\n" +
		"- 只写正文中有明确依据的字段；无依据的字段整个省略（不要填空字符串或空数组，abilities/characters 除外——确无则给 []）。\n" +
		"- name、scene_id、a、b 必填且非空。\n" +
		`- 若某人物已收录在以下规范名单中，必须沿用同一名字：${names || "（暂无）"}\n` +
		`- 若某场景与以下已有场景名一致，必须沿用同一 scene_id：${scenes || "（暂无）"}\n` +
		(opts.retryNote ? `\n${opts.retryNote}\n` : "") +
		`\n章节：${opts.chapterLabel}\n正文：\n${opts.content}`
	);
}

// ---------- 解析 ----------

function castStr(v: unknown): string | undefined {
	if (typeof v !== "string") return undefined;
	const t = v.trim();
	return t ? t : undefined;
}

function castStrArr(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return [...new Set(v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
}

/**
 * 解析单章分析输出：容忍可选代码围栏与 JSON 前后的杂散文本（取首个 { 到末个 }）。
 * 顶层解析/形状失败返回 null（触发重试）；单条缺必填 id 只跳过该条、保留其余。
 */
export function parseCastChapterAnalysis(raw: string): CastChapterAnalysis | null {
	let text = String(raw ?? "").trim();
	if (!text) return null;
	const fence = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```\s*$/.exec(text);
	if (fence) text = fence[1].trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	let obj: unknown;
	try {
		obj = JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
	if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
	const o = obj as Record<string, unknown>;

	const characters: CastChapterAnalysis["characters"] = [];
	if (Array.isArray(o.characters)) {
		for (const item of o.characters) {
			if (typeof item !== "object" || item === null) continue;
			const c = item as Record<string, unknown>;
			const name = castStr(c.name);
			if (!name) continue; // 缺必填 id：跳过该条
			const entry: CastChapterAnalysis["characters"][number] = { name, abilities: castStrArr(c.abilities) };
			const identity = castStr(c.identity);
			if (identity) entry.identity = identity;
			const age = castStr(c.age);
			if (age) entry.age = age;
			const gender = castStr(c.gender);
			if (gender) entry.gender = gender;
			const personality = castStr(c.personality);
			if (personality) entry.personality = personality;
			const appearance = castStr(c.appearance);
			if (appearance) entry.appearance = appearance;
			const background = castStr(c.background);
			if (background) entry.background = background;
			const notes = castStr(c.notes);
			if (notes) entry.notes = notes;
			characters.push(entry);
		}
	}

	const scenes: CastChapterAnalysis["scenes"] = [];
	if (Array.isArray(o.scenes)) {
		for (const item of o.scenes) {
			if (typeof item !== "object" || item === null) continue;
			const s = item as Record<string, unknown>;
			const sceneId = castStr(s.scene_id);
			if (!sceneId) continue;
			const entry: CastChapterAnalysis["scenes"][number] = { scene_id: sceneId, characters: castStrArr(s.characters) };
			const description = castStr(s.description);
			if (description) entry.description = description;
			const notes = castStr(s.notes);
			if (notes) entry.notes = notes;
			scenes.push(entry);
		}
	}

	const relationships: CastChapterAnalysis["relationships"] = [];
	if (Array.isArray(o.relationships)) {
		for (const item of o.relationships) {
			if (typeof item !== "object" || item === null) continue;
			const r = item as Record<string, unknown>;
			const a = castStr(r.a);
			const b = castStr(r.b);
			if (!a || !b) continue; // 缺必填角色：跳过该条
			const entry: CastChapterAnalysis["relationships"][number] = { a, b };
			const type = castStr(r.type);
			if (type) entry.type = type;
			const status = castStr(r.status);
			if (status) entry.status = status;
			const desc = castStr(r.desc);
			if (desc) entry.desc = desc;
			relationships.push(entry);
		}
	}

	return { characters, scenes, relationships };
}

// ---------- 聚合与定层 ----------

/** 跨章聚合结果：名称/场景名/关系对 → 合并字段 + 出现章节键集合 */
export interface CastAggregate {
	characters: Map<string, { fields: Omit<CharacterDoc, "name" | "chapter" | "vol">; chapters: Set<string> }>;
	scenes: Map<string, { fields: Omit<SceneDoc, "scene_id" | "chapter_num" | "vol">; chapters: Set<string> }>;
	relationships: Map<string, { entry: RelationshipEntry; chapters: Set<string> }>; // key=relPairKey(a,b)
}

/** 关系对归一化键（A-B 无序） */
export function relPairKey(a: string, b: string): string {
	return [a.trim(), b.trim()].sort().join("|");
}

function fillStringFields(target: Record<string, unknown>, source: Record<string, unknown>, keys: string[]): void {
	for (const k of keys) {
		const cur = target[k];
		if ((typeof cur !== "string" || !cur.trim()) && typeof source[k] === "string" && String(source[k]).trim()) {
			target[k] = source[k];
		}
	}
}

function unionArr(target: Record<string, unknown>, key: string, add: string[]): void {
	const cur = Array.isArray(target[key]) ? (target[key] as string[]) : [];
	for (const x of add) if (!cur.includes(x)) cur.push(x);
	target[key] = cur;
}

/** 按章节顺序聚合：先出现的字段优先，后出现章节只补缺项；abilities/characters 取并集 */
export function aggregateCastAnalyses(chapters: Array<{ key: string; analysis: CastChapterAnalysis }>): CastAggregate {
	const agg: CastAggregate = { characters: new Map(), scenes: new Map(), relationships: new Map() };
	for (const { key, analysis } of chapters) {
		for (const c of analysis.characters) {
			const rec = agg.characters.get(c.name);
			if (!rec) {
				agg.characters.set(c.name, {
					fields: {
						identity: c.identity,
						age: c.age,
						gender: c.gender,
						personality: c.personality,
						appearance: c.appearance,
						background: c.background,
						abilities: [...c.abilities],
						notes: c.notes,
					},
					chapters: new Set([key]),
				});
			} else {
				rec.chapters.add(key);
				fillStringFields(rec.fields, c, [
					"identity",
					"age",
					"gender",
					"personality",
					"appearance",
					"background",
					"notes",
				]);
				unionArr(rec.fields, "abilities", c.abilities);
			}
		}
		for (const s of analysis.scenes) {
			const rec = agg.scenes.get(s.scene_id);
			if (!rec) {
				agg.scenes.set(s.scene_id, {
					fields: { description: s.description, characters: [...s.characters], notes: s.notes },
					chapters: new Set([key]),
				});
			} else {
				rec.chapters.add(key);
				fillStringFields(rec.fields, s, ["description", "notes"]);
				unionArr(rec.fields, "characters", s.characters);
			}
		}
		for (const r of analysis.relationships) {
			const pk = relPairKey(r.a, r.b);
			const rec = agg.relationships.get(pk);
			if (!rec) {
				agg.relationships.set(pk, {
					entry: { a: r.a, b: r.b, type: r.type ?? "", status: r.status ?? "", desc: r.desc ?? "" },
					chapters: new Set([key]),
				});
			} else {
				rec.chapters.add(key);
				if (!rec.entry.type && r.type) rec.entry.type = r.type;
				if (!rec.entry.status && r.status) rec.entry.status = r.status;
				if (!rec.entry.desc && r.desc) rec.entry.desc = r.desc;
			}
		}
	}
	return agg;
}

/** 按出现范围定层（span 规则）；平铺模式（useVolumes=false）强制全部容器归书根 */
export function determineCastLayer(chapterKeys: Iterable<string>, useVolumes: boolean): CastLayerRef {
	const keys = [...chapterKeys];
	if (!keys.length) return { scope: "book" };
	const ROOT = "__root__";
	const containers = new Set<string>();
	for (const k of keys) {
		const { vol } = parseChKey(k);
		containers.add(useVolumes ? vol ?? ROOT : ROOT);
	}
	if (containers.size >= 2) return { scope: "book" };
	const only = [...containers][0];
	const nums = new Set(keys.map((k) => parseChKey(k).num));
	if (only === ROOT) {
		if (nums.size >= 2) return { scope: "book" };
		return { scope: "chapter", chapterKey: keys[0] };
	}
	if (nums.size >= 2) return { scope: "volume", volId: only };
	return { scope: "chapter", chapterKey: keys[0] };
}

// ---------- 写盘计划 ----------

/** 某一层现有文档（ref + 该层全部条目） */
export interface CastLayerDoc<T> {
	ref: CastLayerRef;
	entries: Record<string, T>;
}

/** 某一层写盘结果：changed=false 的层跳过写盘 */
export interface CastLayerOutput<T> {
	ref: CastLayerRef;
	entries: Record<string, T>;
	changed: boolean;
}

/** 字段合并取值：现有非空值优先，否则取分析值（解析器缺项常为 ""） */
function pick(existing: string | undefined, fresh: string | undefined): string | undefined {
	return existing && existing.trim() ? existing : fresh;
}

function refSpecificity(ref: CastLayerRef): number {
	return ref.scope === "chapter" ? 2 : ref.scope === "volume" ? 1 : 0;
}

function layerRefKey(ref: CastLayerRef): string {
	return ref.scope === "volume" ? `volume:${ref.volId ?? ""}` : ref.scope === "chapter" ? `chapter:${ref.chapterKey ?? ""}` : "book";
}

/** 键排序后的规范 JSON——用于「内容是否变化」比较（与条目顺序无关） */
function canonicalJson(v: unknown): string {
	return JSON.stringify(v, (_k, val: unknown) => {
		if (val && typeof val === "object" && !Array.isArray(val)) {
			const o = val as Record<string, unknown>;
			const out: Record<string, unknown> = {};
			for (const k of Object.keys(o).sort()) out[k] = o[k];
			return out;
		}
		return val;
	});
}

interface MergedPlacement<T> {
	name: string;
	target: CastLayerRef;
	entry: T;
}

/**
 * 人物写盘计划：同名条目移动+字段合并（现有字段优先、缺项补新），
 * 每层最终内容 = 现有 − 移出 + 并入；changed 由规范 JSON 比较得出。
 */
export function buildCharacterWritePlan(
	existing: CastLayerDoc<CharacterDoc>[],
	agg: CastAggregate,
	useVolumes: boolean
): CastLayerOutput<CharacterDoc>[] {
	const placements = new Map<string, MergedPlacement<CharacterDoc>>(); // name → 目标
	for (const [name, rec] of agg.characters) {
		const target = determineCastLayer(rec.chapters, useVolumes);
		// 现有同名条目：多层并存时取最具体一层作合并基，其余副本全部移除
		let base: CharacterDoc | null = null;
		let bestSpec = -1;
		for (const layer of existing) {
			const e = layer.entries[name];
			if (!e) continue;
			const spec = refSpecificity(layer.ref);
			if (spec > bestSpec) {
				bestSpec = spec;
				base = e;
			}
		}
		const merged: CharacterDoc = {
			name,
			chapter: 0,
			identity: pick(base?.identity, rec.fields.identity),
			age: pick(base?.age, rec.fields.age),
			gender: pick(base?.gender, rec.fields.gender),
			personality: pick(base?.personality, rec.fields.personality),
			appearance: pick(base?.appearance, rec.fields.appearance),
			background: pick(base?.background, rec.fields.background),
			abilities: [...new Set([...(base?.abilities ?? []), ...rec.fields.abilities])],
			notes: pick(base?.notes, rec.fields.notes),
		};
		if (target.scope === "chapter" && target.chapterKey) {
			merged.chapter = parseChKey(target.chapterKey).num; // 章级：目标章的本地章号
			const { vol } = parseChKey(target.chapterKey);
			if (vol) merged.vol = vol;
		} else if (target.scope === "volume" && target.volId) {
			merged.vol = target.volId; // 运行态标签（不落盘）
		}
		placements.set(name, { name, target, entry: merged });
	}

	const outputs: CastLayerOutput<CharacterDoc>[] = existing.map((layer) => ({
		ref: layer.ref,
		entries: { ...layer.entries },
		changed: false,
	}));
	const outIndex = new Map(outputs.map((o, i) => [layerRefKey(o.ref), i]));
	for (const p of placements.values()) {
		// 从所有层移除该名字的全部副本
		for (const o of outputs) delete o.entries[p.name];
		let idx = outIndex.get(layerRefKey(p.target));
		if (idx === undefined) {
			outputs.push({ ref: p.target, entries: {}, changed: false });
			idx = outputs.length - 1;
			outIndex.set(layerRefKey(p.target), idx);
		}
		outputs[idx].entries[p.name] = p.entry;
	}
	for (let i = 0; i < outputs.length; i++) {
		const src = existing.find((l) => layerRefKey(l.ref) === layerRefKey(outputs[i].ref));
		outputs[i].changed = canonicalJson(outputs[i].entries) !== canonicalJson(src ? src.entries : {});
	}
	return outputs;
}

/** 场景写盘计划：语义同人物（键=scene_id，归属字段=chapter_num） */
export function buildSceneWritePlan(
	existing: CastLayerDoc<SceneDoc>[],
	agg: CastAggregate,
	useVolumes: boolean
): CastLayerOutput<SceneDoc>[] {
	const placements = new Map<string, MergedPlacement<SceneDoc>>();
	for (const [sceneId, rec] of agg.scenes) {
		const target = determineCastLayer(rec.chapters, useVolumes);
		let base: SceneDoc | null = null;
		let bestSpec = -1;
		for (const layer of existing) {
			const e = layer.entries[sceneId];
			if (!e) continue;
			const spec = refSpecificity(layer.ref);
			if (spec > bestSpec) {
				bestSpec = spec;
				base = e;
			}
		}
		const merged: SceneDoc = {
			scene_id: sceneId,
			description: pick(base?.description, rec.fields.description),
			chapter_num: 0,
			characters: [...new Set([...(base?.characters ?? []), ...rec.fields.characters])],
			notes: pick(base?.notes, rec.fields.notes),
			content: base?.content, // 场景正文（用户手写）只保留、不从分析覆盖
		};
		if (target.scope === "chapter" && target.chapterKey) {
			merged.chapter_num = parseChKey(target.chapterKey).num;
			const { vol } = parseChKey(target.chapterKey);
			if (vol) merged.vol = vol;
		} else if (target.scope === "volume" && target.volId) {
			merged.vol = target.volId;
		}
		placements.set(sceneId, { name: sceneId, target, entry: merged });
	}

	const outputs: CastLayerOutput<SceneDoc>[] = existing.map((layer) => ({
		ref: layer.ref,
		entries: { ...layer.entries },
		changed: false,
	}));
	const outIndex = new Map(outputs.map((o, i) => [layerRefKey(o.ref), i]));
	for (const p of placements.values()) {
		for (const o of outputs) delete o.entries[p.name];
		let idx = outIndex.get(layerRefKey(p.target));
		if (idx === undefined) {
			outputs.push({ ref: p.target, entries: {}, changed: false });
			idx = outputs.length - 1;
			outIndex.set(layerRefKey(p.target), idx);
		}
		outputs[idx].entries[p.name] = p.entry;
	}
	for (let i = 0; i < outputs.length; i++) {
		const src = existing.find((l) => layerRefKey(l.ref) === layerRefKey(outputs[i].ref));
		outputs[i].changed = canonicalJson(outputs[i].entries) !== canonicalJson(src ? src.entries : {});
	}
	return outputs;
}

/**
 * 关系写盘计划：已存在的 A-B 对（existingPairs，跨三层去重）跳过；
 * 新对按出现范围定层分组，由调用方逐层 appendRelationships。
 */
export function buildRelationshipWritePlan(
	existingPairs: Set<string>,
	agg: CastAggregate,
	useVolumes: boolean
): Array<{ ref: CastLayerRef; entries: RelationshipEntry[] }> {
	const groups = new Map<string, { ref: CastLayerRef; entries: RelationshipEntry[] }>();
	for (const [pk, rec] of agg.relationships) {
		if (existingPairs.has(pk)) continue; // 已有关系不重复追加
		const ref = determineCastLayer(rec.chapters, useVolumes);
		const key = layerRefKey(ref);
		let g = groups.get(key);
		if (!g) {
			g = { ref, entries: [] };
			groups.set(key, g);
		}
		g.entries.push(rec.entry);
	}
	return [...groups.values()];
}
