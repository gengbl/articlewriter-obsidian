// v0.4.3+ 大纲阶段人物/人物关系增量分层（纯逻辑，无 vault 访问）：
// 卷大纲生成与「从卷大纲生成章节」的每章生成调用会在大纲正文后附带人物/关系 JSON 附录，
// 本模块负责拆出附录、按「出现范围」定层（书/卷/章，口径同 /analyze-cast），并在每章之后给出增量写盘计划。
//
// 与 /analyze-cast 的差异：那边是「全部章分析完再聚合」，这里必须每生成一章就落盘——
// 因此跨章信息只能靠「本轮已出现章 + 盘上已有条目层」累积；后续章再次出现时把前章条目**提升**到卷级/书级。

import type { CastChapterAnalysis, CastLayerRef } from "./cast_analyzer";
import { parseCastChapterAnalysis, relPairKey } from "./cast_analyzer";
import type { CharacterDoc, RelationshipEntry } from "./md_docs";
import { parseChKey } from "./state_doc";

/** 附录分隔行（提示词要求模型原样输出；解析容忍 = / # / - 等装饰与全角括号） */
export const OUTLINE_CAST_APPENDIX_MARK = "===人物关系附录===";

const APPENDIX_LINE_RE = /^[^\S\n]*(?:[=#*\-【]{1,4})?[^\S\n]*人物(?:与)?关系附录[^\S\n]*(?:[=#*\-】]{1,4})?[^\S\n]*$/m;

/** 人物/关系附录输出要求（拼在大纲生成提示词末尾；knownNames 用于跨章同名归一） */
export function outlineCastAppendixInstruction(knownNames: string[] = []): string {
	const names = [...new Set(knownNames.map((n) => n.trim()).filter(Boolean))].slice(0, 60).join("、");
	return (
		"【人物与关系附录（硬性要求，必须输出）】\n" +
		`在大纲正文之后另起一行输出分隔行 ${OUTLINE_CAST_APPENDIX_MARK}，随后输出一个 JSON 对象（不要代码围栏、不要任何解释）：\n` +
		'{"characters":[{"name":"人名","identity":"身份","age":"年龄","gender":"性别","personality":"性格","appearance":"外貌","background":"背景","abilities":["能力"],"notes":"备注"}],"relationships":[{"a":"人物A","b":"人物B","type":"关系类型","status":"关系状态","desc":"关系描述"}]}\n' +
		"- characters：本段大纲里**出场**的角色（含仅被提及者），name 必填、全书统一写法；无依据的字段整个省略（abilities 确无则给 []）。\n" +
		"- relationships：本段大纲里**被明确描绘**的人物关系，a/b 必填且必须沿用 characters 里的名字；没有就输出 []。\n" +
		"- 只抽取人物与关系，不写场景/地点；附录不要重复大纲正文、不要写进大纲正文。\n" +
		(names ? `- 已知规范人名（务必沿用同一写法）：${names}\n` : "") +
		"- 大纲正文与附录缺一不可。"
	);
}

/** 从模型输出中拆出「大纲正文」与「人物/关系附录」（无分隔行时正文原样返回、附录为 null） */
export function splitOutlineCastAppendix(raw: string): { body: string; cast: CastChapterAnalysis | null } {
	const text = String(raw ?? "");
	const m = APPENDIX_LINE_RE.exec(text);
	if (!m) return { body: text.trim(), cast: null };
	const body = text.slice(0, m.index).trim();
	const appendix = text.slice(m.index + m[0].length);
	return { body, cast: parseCastChapterAnalysis(appendix) };
}

// ---------- 层与定层 ----------

export interface OutlineCastCharacterLayer {
	ref: CastLayerRef;
	entries: Record<string, CharacterDoc>;
}

export interface OutlineCastRelationshipLayer {
	ref: CastLayerRef;
	entries: RelationshipEntry[];
}

export interface OutlineCastInit {
	useVolumes: boolean;
	characters: OutlineCastCharacterLayer[];
	relationships: OutlineCastRelationshipLayer[];
}

export interface OutlineCastIngestResult {
	characterWrites: OutlineCastCharacterLayer[];
	relationshipWrites: OutlineCastRelationshipLayer[];
	skipped: string[]; // 目标层不存在（如章节目录尚未创建）而跳过的人物名 / 「A - B」
	writtenCharacters: number; // 成功定层写入的人物条目数（含提升）
	writtenRelationships: number; // 成功定层写入的关系条目数（含提升）
}

/** 层标识：book / volume:<volId> / chapter:<复合键> */
export function outlineCastLayerKey(ref: CastLayerRef): string {
	if (ref.scope === "volume") return `volume:${ref.volId ?? ""}`;
	if (ref.scope === "chapter") return `chapter:${ref.chapterKey ?? ""}`;
	return "book";
}

/** 角色/关系的「出场范围」定层（与 cast_analyzer.determineCastLayer 同口径，额外纳入盘上已有条目所在层，保证只升不降）：
 *  容器 = 章所属卷（无卷/平铺 = 书根）→ ≥2 容器书级；单容器 ≥2 章 → 卷级（书根→书级）；仅 1 章 → 章级。 */
function decideLayer(chapters: Set<string>, existing: CastLayerRef[], useVolumes: boolean): CastLayerRef {
	const all = new Set(chapters);
	const volumes = new Set<string>();
	let bookSeen = false;
	for (const ref of existing) {
		if (ref.scope === "book") bookSeen = true;
		else if (ref.scope === "volume") volumes.add(ref.volId ?? "");
		else if (ref.chapterKey) all.add(ref.chapterKey);
	}
	const containers = new Set<string>();
	for (const key of all) containers.add(useVolumes ? (parseChKey(key).vol ?? "") : "");
	for (const v of volumes) containers.add(v);
	if (bookSeen || containers.size >= 2) return { scope: "book" };
	const only = [...containers][0] ?? "";
	if (all.size >= 2 || volumes.size >= 1) {
		if (!useVolumes || only === "") return { scope: "book" };
		return { scope: "volume", volId: only };
	}
	const key = [...all][0];
	return key ? { scope: "chapter", chapterKey: key } : { scope: "book" };
}

function addTo(map: Map<string, Set<string>>, key: string, chapterKey: string): void {
	const set = map.get(key);
	if (set) set.add(chapterKey);
	else map.set(key, new Set([chapterKey]));
}

type CharacterFields = Omit<CharacterDoc, "chapter" | "vol">;

/** 字段合并：现有非空值优先、缺项补新；能力取并集 */
function mergeCharacterFields(base: CharacterFields | undefined, fresh: CharacterFields): CharacterDoc {
	const mixed = {
		name: fresh.name,
		identity: pick(base?.identity, fresh.identity),
		age: pick(base?.age, fresh.age),
		gender: pick(base?.gender, fresh.gender),
		personality: pick(base?.personality, fresh.personality),
		appearance: pick(base?.appearance, fresh.appearance),
		background: pick(base?.background, fresh.background),
		abilities: [...new Set([...(base?.abilities ?? []), ...(fresh.abilities ?? [])])],
		notes: pick(base?.notes, fresh.notes),
	};
	// 省掉空字段，保持文档简洁（formatCharacterBlock 只在非空时输出字段行）
	const out: CharacterDoc = { name: mixed.name, chapter: 0, abilities: mixed.abilities };
	for (const k of ["identity", "age", "gender", "personality", "appearance", "background", "notes"] as const) {
		if (mixed[k]) out[k] = mixed[k];
	}
	return out;
}

function pick(a: string | undefined, b: string | undefined): string | undefined {
	return a && a.trim() ? a : b && b.trim() ? b : undefined;
}

type RelationshipFields = { a: string; b: string; type?: string; status?: string; desc?: string };

function mergeRelationship(base: RelationshipEntry | undefined, fresh: RelationshipFields): RelationshipEntry {
	return {
		a: base?.a || fresh.a,
		b: base?.b || fresh.b,
		type: pick(base?.type, fresh.type) ?? "",
		status: pick(base?.status, fresh.status) ?? "",
		desc: pick(base?.desc, fresh.desc) ?? "",
	};
}

/** 一次运行（一卷的卷大纲生成 / 拆章）内的人物与关系分层追踪器：逐章 ingest → 返回需要重写的层 */
export class OutlineCastTracker {
	private readonly useVolumes: boolean;
	private readonly charLayers = new Map<string, OutlineCastCharacterLayer>();
	private readonly relLayers = new Map<string, OutlineCastRelationshipLayer>();
	private readonly charAgg = new Map<string, CharacterDoc>();
	private readonly relAgg = new Map<string, RelationshipEntry>();
	private readonly charChapters = new Map<string, Set<string>>();
	private readonly relChapters = new Map<string, Set<string>>();
	/** 本运行内新建的关系对（盘上已存在的关系不动；本运行新建的可随后续章提升层） */
	private readonly autoRel = new Set<string>();

	constructor(init: OutlineCastInit) {
		this.useVolumes = init.useVolumes;
		for (const layer of init.characters) this.charLayers.set(outlineCastLayerKey(layer.ref), { ref: layer.ref, entries: { ...layer.entries } });
		for (const layer of init.relationships) this.relLayers.set(outlineCastLayerKey(layer.ref), { ref: layer.ref, entries: layer.entries.slice() });
	}

	/** 新建的章节目录补注册空层（拆章时 ensureChapterAt 之后调用，否则章级落点判定为「层不存在」而跳过） */
	registerChapter(chapterKey: string): void {
		const ref: CastLayerRef = { scope: "chapter", chapterKey };
		const key = outlineCastLayerKey(ref);
		if (!this.charLayers.has(key)) this.charLayers.set(key, { ref, entries: {} });
		if (!this.relLayers.has(key)) this.relLayers.set(key, { ref, entries: [] });
	}

	/** 已知人物名（盘上三层 + 本轮已抽取），供提示词跨章同名归一 */
	knownNames(): string[] {
		const names = new Set<string>();
		for (const layer of this.charLayers.values()) for (const name of Object.keys(layer.entries)) names.add(name);
		for (const name of this.charAgg.keys()) names.add(name);
		return [...names].sort((a, b) => a.localeCompare(b));
	}

	/** 摄入一章的人物/关系附录：累积出现范围 → 定层 → 返回内容有变化的层（调用方整层写回） */
	ingest(chapterKey: string, cast: CastChapterAnalysis): OutlineCastIngestResult {
		const skipped: string[] = [];
		const touchedChar = new Set<string>();
		const touchedRel = new Set<string>();
		let writtenCharacters = 0;
		let writtenRelationships = 0;

		for (const fresh of cast.characters) {
			addTo(this.charChapters, fresh.name, chapterKey);
			this.charAgg.set(fresh.name, mergeCharacterFields(this.charAgg.get(fresh.name), fresh));
		}
		for (const fresh of cast.characters) {
			const name = fresh.name;
			const target = decideLayer(this.charChapters.get(name) ?? new Set([chapterKey]), this.refsWithCharacter(name), this.useVolumes);
			const targetKey = outlineCastLayerKey(target);
			const layer = this.charLayers.get(targetKey);
			if (!layer) { skipped.push(name); continue; } // 目标层不存在：保留出现记录，后续章再提升
			const merged = mergeCharacterFields(this.mostSpecificCharacter(name), this.charAgg.get(name) ?? fresh);
			for (const [key, l] of this.charLayers) {
				if (!l.entries[name]) continue;
				delete l.entries[name];
				touchedChar.add(key);
			}
			layer.entries[name] = merged;
			touchedChar.add(targetKey);
			writtenCharacters++;
		}

		for (const fresh of cast.relationships) {
			const key = relPairKey(fresh.a, fresh.b);
			addTo(this.relChapters, key, chapterKey);
			this.relAgg.set(key, mergeRelationship(this.relAgg.get(key), fresh));
		}
		for (const fresh of cast.relationships) {
			const key = relPairKey(fresh.a, fresh.b);
			const existing = this.refsWithRelationship(key);
			if (existing.length && !this.autoRel.has(key)) continue; // 盘上既有关系（含手写）保持原层不动
			const target = decideLayer(this.relChapters.get(key) ?? new Set([chapterKey]), existing, this.useVolumes);
			const targetKey = outlineCastLayerKey(target);
			const layer = this.relLayers.get(targetKey);
			if (!layer) { skipped.push(`${fresh.a} - ${fresh.b}`); continue; }
			const merged = mergeRelationship(this.mostSpecificRelationship(key), this.relAgg.get(key) ?? fresh);
			for (const [layerKey, l] of this.relLayers) {
				const before = l.entries.length;
				l.entries = l.entries.filter((e) => relPairKey(e.a, e.b) !== key);
				if (l.entries.length !== before) touchedRel.add(layerKey);
			}
			layer.entries.push(merged);
			this.autoRel.add(key);
			touchedRel.add(targetKey);
			writtenRelationships++;
		}

		return {
			characterWrites: [...touchedChar].map((k) => this.charLayers.get(k)!).filter(Boolean),
			relationshipWrites: [...touchedRel].map((k) => this.relLayers.get(k)!).filter(Boolean),
			skipped,
			writtenCharacters,
			writtenRelationships,
		};
	}

	private refsWithCharacter(name: string): CastLayerRef[] {
		const refs: CastLayerRef[] = [];
		for (const layer of this.charLayers.values()) if (layer.entries[name]) refs.push(layer.ref);
		return refs;
	}

	private refsWithRelationship(key: string): CastLayerRef[] {
		const refs: CastLayerRef[] = [];
		for (const layer of this.relLayers.values()) if (layer.entries.some((e) => relPairKey(e.a, e.b) === key)) refs.push(layer.ref);
		return refs;
	}

	/** 最具体层（章 > 卷 > 书）的现有条目：作为字段合并基座，避免覆盖已有人设 */
	private mostSpecificCharacter(name: string): CharacterDoc | undefined {
		let best: CharacterDoc | undefined;
		let spec = -1;
		for (const layer of this.charLayers.values()) {
			const entry = layer.entries[name];
			if (!entry) continue;
			const s = layer.ref.scope === "chapter" ? 2 : layer.ref.scope === "volume" ? 1 : 0;
			if (s > spec) { spec = s; best = entry; }
		}
		return best;
	}

	private mostSpecificRelationship(key: string): RelationshipEntry | undefined {
		let best: RelationshipEntry | undefined;
		let spec = -1;
		for (const layer of this.relLayers.values()) {
			const entry = layer.entries.find((e) => relPairKey(e.a, e.b) === key);
			if (!entry) continue;
			const s = layer.ref.scope === "chapter" ? 2 : layer.ref.scope === "volume" ? 1 : 0;
			if (s > spec) { spec = s; best = entry; }
		}
		return best;
	}
}
