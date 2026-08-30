import { App, MarkdownView, TFile, TFolder, Vault } from "obsidian";
import * as doc from "./md_docs";
import {
	LEGACY_STATE_JSON,
	STATE_DOC_BODY,
	STATE_DOC_NAME,
	formatStateDoc,
	parseStateDoc,
} from "./state_doc";
export type { ChapterMeta, StoryState } from "./state_doc";
import type { StoryState } from "./state_doc";
import {
	CHAPTER_BODY_TEMPLATE,
	CHAPTER_CHARACTERS_TEMPLATE,
	CHAPTER_INFO_TEMPLATE,
	chapterOutlineTemplate,
	CHAPTER_RELATIONSHIPS_TEMPLATE,
	CHAPTER_SCENES_TEMPLATE,
	FORESHADOW_TEMPLATE,
	NOTES_TEMPLATE,
	outlineTemplate,
	VOLUME_TEMPLATE,
	WORLD_TEMPLATE,
	appendOutlineMarkerHelp,
	countPureWords,
	md5,
	safeFilename,
	stripAiWordMarks,
} from "./story_types";
import { buildChapterFolderDocs, cleanRelationshipsDoc } from "./prompts";
import type { ChapterFolderDocEntry, PrevChapterRef } from "./prompts";

const CHAPTER_DIR_RE = /^第(\d{1,3})章-(.+)$/;

interface StateDocRead {
	state: StoryState | null;
	body?: string;
	extra?: Record<string, unknown>;
	fromLegacy: boolean;
}

function nowIso(): string {
	return new Date().toISOString();
}

export interface StoryManagerOptions {
	app: App;
	/** 小说放置的根目录（vault 相对路径），空=vault 根 */
	getStoryRoot: () => string;
	/** 每次 saveState 成功落盘后回调（供插件广播刷新依赖状态文档的 UI，如 LLM 面板顶部当前小说·章节行） */
	onStateChanged?: () => void;
}

/** 小说管理器：所有文件/文件夹操作均使用 Obsidian Vault 内置 API */
export class StoryManager {
	private app: App;
	private getStoryRoot: () => string;
	private onStateChanged?: () => void;

	constructor(opts: StoryManagerOptions) {
		this.app = opts.app;
		this.getStoryRoot = opts.getStoryRoot;
		this.onStateChanged = opts.onStateChanged;
	}

	private get vault(): Vault {
		return this.app.vault;
	}

	// ---------- 路径工具 ----------

	storyPath(storyName: string): string {
		const root = this.getStoryRoot().replace(/\/+$/, "");
		return root ? `${root}/${storyName}` : storyName;
	}

	/** 新格式：Obsidian 文件属性风格的状态文档路径 */
	stateDocPath(storyName: string): string {
		return `${this.storyPath(storyName)}/${STATE_DOC_NAME}`;
	}

	/** 旧格式：Python CLI 的 JSON（只读兼容，首次保存后自动备份迁移） */
	legacyJsonPath(storyName: string): string {
		return `${this.storyPath(storyName)}/${LEGACY_STATE_JSON}`;
	}

	chapterDirPath(storyName: string, num: number, title?: string): string {
		const safe = safeFilename((title || "").trim() || `第${num}章`);
		return `${this.storyPath(storyName)}/第${String(num).padStart(2, "0")}章-${safe}`;
	}

	// ---------- 小说发现与状态读写 ----------

	/** 列出根目录下所有含状态文档（故事状态.md，或旧版 story_state.json）的小说名 */
	async listStories(): Promise<string[]> {
		const rootName = this.getStoryRoot().replace(/\/+$/, "");
		const root = rootName
			? this.vault.getAbstractFileByPath(rootName)
			: this.vault.getRoot();
		if (!root || !(root instanceof TFolder)) return [];
		const names: string[] = [];
		for (const child of root.children) {
			if (!(child instanceof TFolder)) continue;
			if (
				this.vault.getAbstractFileByPath(`${child.path}/${STATE_DOC_NAME}`) ||
				this.vault.getAbstractFileByPath(`${child.path}/${LEGACY_STATE_JSON}`)
			) {
				names.push(child.name);
			}
		}
		return names.sort((a, b) => a.localeCompare(b, "zh"));
	}

	private async readStateDoc(storyName: string): Promise<StateDocRead> {
		const md = this.stateDocPath(storyName);
		const f = this.vault.getAbstractFileByPath(md);
		if (f instanceof TFile) {
			try {
				const parsed = parseStateDoc(await this.vault.read(f));
				return { state: parsed.state, body: parsed.body, extra: parsed.extra, fromLegacy: false };
			} catch {
				return { state: null, fromLegacy: false };
			}
		}
		const legacy = this.legacyJsonPath(storyName);
		const lf = this.vault.getAbstractFileByPath(legacy);
		if (lf instanceof TFile) {
			try {
				return { state: JSON.parse(await this.vault.read(lf)) as StoryState, fromLegacy: true };
			} catch {
				return { state: null, fromLegacy: true };
			}
		}
		return { state: null, fromLegacy: false };
	}

	async loadState(storyName: string): Promise<StoryState | null> {
		return (await this.readStateDoc(storyName)).state;
	}

	async saveState(storyName: string, state: StoryState): Promise<void> {
		state.updated_at = nowIso();
		const prev = await this.readStateDoc(storyName);
		await this.writeDoc(
			this.stateDocPath(storyName),
			formatStateDoc(state, { body: prev.body ?? STATE_DOC_BODY, extra: prev.extra })
		);
		if (prev.fromLegacy || this.vault.getAbstractFileByPath(this.legacyJsonPath(storyName))) {
			await this.migrateLegacyJson(storyName).catch(() => {});
		}
		this.onStateChanged?.(); // 状态文档已变更（当前章/卷/字数等），通知插件层刷新相关 UI
	}

	/** 旧版 story_state.json → _backup/（保留可恢复，此后以故事状态.md为唯一事实来源） */
	private async migrateLegacyJson(storyName: string): Promise<void> {
		const f = this.vault.getAbstractFileByPath(this.legacyJsonPath(storyName));
		if (!(f instanceof TFile)) return;
		const backupDir = `${this.storyPath(storyName)}/_backup`;
		if (!this.vault.getAbstractFileByPath(backupDir)) {
			await this.vault.createFolder(backupDir);
		}
		const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
		await this.vault.rename(f, `${backupDir}/${LEGACY_STATE_JSON.replace(".json", "")}_${stamp}.json`);
	}

	private async writeDoc(path: string, content: string): Promise<TFile> {
		const existing = this.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.vault.modify(existing, content);
			return existing;
		}
		const parent = path.substring(0, path.lastIndexOf("/"));
		if (parent && !this.vault.getAbstractFileByPath(parent)) {
			await this.vault.createFolder(parent);
		}
		return this.vault.create(path, content);
	}

	/** 文档不存在时创建模板；已存在则保留不覆盖（对齐 Python「已存在则跳过」约定） */
	async ensureDoc(path: string, template: string): Promise<"created" | "exists"> {
		const file = this.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) return "exists";
		await this.writeDoc(path, template);
		return "created";
	}

	// ---------- 新建小说 ----------

	async createStory(title: string, genre: string, writingStyle: string): Promise<string> {
		const name = safeFilename(title.trim() || "未命名");
		if (await this.loadState(name)) throw new Error(`当前目录已存在同名小说：${name}`);
		const base = this.storyPath(name);
		const state: StoryState = {
			version: 2,
			title: title.trim(),
			genre: genre.trim() || "网文小说",
			writing_style: writingStyle.trim() || "网文小说",
			current_chapter: null,
			total_words: 0,
			use_summaries: true,
			chapters: {},
			created_at: nowIso(),
			updated_at: nowIso(),
		};
		await this.vault.createFolder(base);
		const docs: Array<[string, string]> = [
			["大纲.md", outlineTemplate(title)],
			["世界观.md", WORLD_TEMPLATE],
			["卷.md", VOLUME_TEMPLATE],
			["伏笔.md", FORESHADOW_TEMPLATE],
			["笔记.md", NOTES_TEMPLATE],
			["人物.md", CHAPTER_CHARACTERS_TEMPLATE],
			["人物关系.md", CHAPTER_RELATIONSHIPS_TEMPLATE],
			["场景.md", CHAPTER_SCENES_TEMPLATE],
		];
		for (const [fname, tpl] of docs) {
			await this.ensureDoc(`${base}/${fname}`, tpl);
		}
		await this.saveState(name, state);
		return name;
	}

	// ---------- 章节扫描与创建 ----------

	async listChapters(storyName: string): Promise<Array<{ num: number; title: string; dir: TFolder }>> {
		const folder = this.vault.getAbstractFileByPath(this.storyPath(storyName));
		if (!folder || !(folder instanceof TFolder)) return [];
		const result: Array<{ num: number; title: string; dir: TFolder }> = [];
		for (const child of folder.children) {
			if (!(child instanceof TFolder)) continue;
			const m = CHAPTER_DIR_RE.exec(child.name);
			if (m) result.push({ num: parseInt(m[1], 10), title: m[2], dir: child });
		}
		return result.sort((a, b) => a.num - b.num);
	}

	async chapterBodyFile(storyName: string, num: number): Promise<TFile | null> {
		const chapters = await this.listChapters(storyName);
		const ch = chapters.find((c) => c.num === num);
		if (!ch) return null;
		const f = this.vault.getAbstractFileByPath(`${ch.dir.path}/章节.md`);
		return f instanceof TFile ? f : null;
	}

	async createChapter(storyName: string, num: number, title: string): Promise<string> {
		const safe = safeFilename(title.trim() || `第${num}章`);
		const dirPath = this.chapterDirPath(storyName, num, safe);
		if (this.vault.getAbstractFileByPath(dirPath)) {
			throw new Error(`章节目录已存在：${dirPath}`);
		}
		await this.vault.createFolder(dirPath);
		const docs: Array<[string, string]> = [
			["章节.md", CHAPTER_BODY_TEMPLATE(num, safe)],
			["章节大纲.md", chapterOutlineTemplate(num, safe)],
			["人物.md", CHAPTER_CHARACTERS_TEMPLATE],
			["人物关系.md", CHAPTER_RELATIONSHIPS_TEMPLATE],
			["场景.md", CHAPTER_SCENES_TEMPLATE],
			["章节信息.md", CHAPTER_INFO_TEMPLATE(num)],
		];
		for (const [fname, tpl] of docs) {
			await this.ensureDoc(`${dirPath}/${fname}`, tpl);
		}
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		state.current_chapter = num;
		state.chapters[String(num)] = { title: safe, words: 0 };
		await this.saveState(storyName, state);
		return `${dirPath}/章节.md`;
	}

	private emptyState(storyName: string): StoryState {
		return {
			version: 2,
			title: storyName,
			genre: "",
			writing_style: "网文小说",
			current_chapter: null,
			total_words: 0,
			use_summaries: true,
			chapters: {},
			created_at: nowIso(),
			updated_at: nowIso(),
		};
	}

	// ---------- 打开文件（内置 reveal）----------

	async openMarkdown(path: string): Promise<void> {
		const file = this.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`文件不存在：${path}`);
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file);
	}

	/** 打开小说根文档；不存在时先按模板创建再打开 */
	async openStoryDoc(storyName: string, docName: string, template: string): Promise<void> {
		const path = `${this.storyPath(storyName)}/${docName}`;
		await this.ensureDoc(path, template);
		await this.openMarkdown(path);
	}

	// ---------- 保存（编辑器内容强制落盘）----------

	/** 把当前聚焦的 章节.md 编辑器内容写回磁盘，返回字数；无匹配视图返回 -1 */
	async saveCurrentChapter(): Promise<number> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!file || !(file.path.endsWith("/章节.md") || file.name === "章节.md")) return -1;
		const content = view.editor.getValue();
		await this.vault.modify(file, content);
		return countPureWords(content);
	}

	// ---------- 切换 / 统计 ----------

	async switchChapter(storyName: string, num: number | null): Promise<string | null> {
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		state.current_chapter = num;
		if (num != null) {
			const meta = state.chapters[String(num)];
			if (meta?.volume) state.current_volume = meta.volume; // 章节归卷时同步激活所属卷
		}
		await this.saveState(storyName, state);
		if (num == null) return null;
		const chapters = await this.listChapters(storyName);
		const ch = chapters.find((c) => c.num === num);
		return ch ? `${ch.dir.path}/章节.md` : null;
	}

	async nextOrPrev(storyName: string, dir: 1 | -1): Promise<{ path: string; num: number } | null> {
		const chapters = await this.listChapters(storyName);
		if (chapters.length === 0) return null;
		const state = await this.loadState(storyName);
		let idx = chapters.findIndex((c) => c.num === state?.current_chapter);
		if (idx < 0) idx = dir === 1 ? 0 : chapters.length - 1; // 无当前章节：next→第一章、prev→最后一章
		idx += dir;
		if (idx < 0 || idx >= chapters.length) return null; // 到边界提示不再切换
		const target = chapters[idx];
		await this.switchChapter(storyName, target.num);
		return { path: `${target.dir.path}/章节.md`, num: target.num };
	}

	async countWords(storyName: string, num?: number): Promise<Array<{ num: number; title: string; words: number }>> {
		const chapters = await this.listChapters(storyName);
		const rows: Array<{ num: number; title: string; words: number }> = [];
		for (const ch of chapters) {
			if (num != null && ch.num !== num) continue;
			const f = this.vault.getAbstractFileByPath(`${ch.dir.path}/章节.md`);
			const content = f instanceof TFile ? await this.vault.read(f) : "";
			rows.push({ num: ch.num, title: ch.title, words: countPureWords(content) });
		}
		return rows;
	}

	async totalWords(storyName: string): Promise<number> {
		const rows = await this.countWords(storyName);
		return rows.reduce((s, r) => s + r.words, 0);
	}

	// ---------- 写作指南 WRITING_GUIDE.md（三层中的两个 vault 文件层：小说级 <书名>/ > 用户级 <work_dir>/；第三层系统级存插件设置 data.json，见 main.ts guideLayers） ----------

	bookGuidePath(storyName: string): string {
		return `${this.storyPath(storyName)}/WRITING_GUIDE.md`;
	}

	userGuidePath(): string {
		return `${this.getStoryRoot().replace(/\/+$/, "")}/WRITING_GUIDE.md`;
	}

	/** 读取指定路径的指南原文；不存在返回 null */
	async readGuideAt(path: string): Promise<string | null> {
		const f = this.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? await this.vault.read(f) : null;
	}

	/** 全量保存指南到指定路径（缺失则创建，存在则覆盖——与 CLI /agents edit 语义一致） */
	async writeGuideAt(path: string, text: string): Promise<void> {
		await this.writeDoc(path, text.endsWith("\n") ? text : text + "\n");
	}

	// ---------- 通用文档工具 ----------

	private async readDoc(path: string): Promise<string> {
		const f = this.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? await this.vault.read(f) : "";
	}

	private storyFolder(storyName: string): TFolder | null {
		const f = this.vault.getAbstractFileByPath(this.storyPath(storyName));
		return f instanceof TFolder ? f : null;
	}

	/** 递归收集 folder 下全部 .md（跳过隐藏目录与 _backup） */
	async listMarkdownFiles(folder: TFolder): Promise<TFile[]> {
		const result: TFile[] = [];
		const walk = (f: TFolder): void => {
			for (const child of f.children) {
				if (child.name.startsWith(".")) continue;
				if (child instanceof TFolder) {
					if (child.name === "_backup") continue;
					walk(child);
				} else if (child instanceof TFile && /\.(md|markdown)$/i.test(child.name)) {
					result.push(child);
				}
			}
		};
		walk(folder);
		return result.sort((a, b) => a.path.localeCompare(b.path));
	}

	private async chapterDirOf(storyName: string, num: number): Promise<{ dir: TFolder; title: string } | null> {
		const chapters = await this.listChapters(storyName);
		return chapters.find((c) => c.num === num) ?? null;
	}

	private bookTitle(storyName: string, state: StoryState | null): string {
		return (state?.title || "").trim() || storyName;
	}

	/** 加载运行态并校验激活卷/章节（对齐 Python finalize_load：卷不存在清空、章不存在回退最后一章） */
	async validatedState(storyName: string): Promise<StoryState> {
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const vols = await this.loadVolumes(storyName);
		if (state.current_volume && !vols[state.current_volume]) delete state.current_volume;
		const chapters = await this.listChapters(storyName);
		if (state.current_chapter != null && !chapters.some((c) => c.num === state.current_chapter)) {
			state.current_chapter = chapters.length ? chapters[chapters.length - 1].num : null;
		}
		const meta = state.current_chapter != null ? state.chapters[String(state.current_chapter)] : undefined;
		if (meta?.volume && vols[meta.volume] && !state.current_volume) state.current_volume = meta.volume;
		return state;
	}

	private async recomputeTotalWords(storyName: string, state: StoryState): Promise<void> {
		let sum = 0;
		for (const ch of await this.listChapters(storyName)) {
			const f = this.vault.getAbstractFileByPath(`${ch.dir.path}/章节.md`);
			sum += countPureWords(f instanceof TFile ? await this.vault.read(f) : "");
		}
		state.total_words = sum;
	}

	// ---------- 卷（卷.md）----------

	async loadVolumes(storyName: string): Promise<Record<string, doc.VolumeInfo>> {
		return doc.parseVolumes(await this.readDoc(`${this.storyPath(storyName)}/卷.md`));
	}

	async saveVolumes(storyName: string, vols: Record<string, doc.VolumeInfo>): Promise<void> {
		const path = `${this.storyPath(storyName)}/卷.md`;
		if (!vols || Object.keys(vols).length === 0) {
			await this.removeDocIfExists(path);
			return;
		}
		const state = await this.loadState(storyName);
		await this.writeDoc(path, doc.formatVolumes(this.bookTitle(storyName, state), vols));
	}

	private removeDocIfExists(path: string): Promise<boolean> {
		const f = this.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return Promise.resolve(false);
		return this.vault.trash(f, false).then(() => true);
	}

	async volumeList(storyName: string): Promise<doc.VolumeInfo[]> {
		return Object.values(await this.loadVolumes(storyName)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	}

	/** 查找卷：精确 ID → 精确名称 → 名称包含（对齐 Python find_volume） */
	findVolumeIn(vols: Record<string, doc.VolumeInfo>, key: string): doc.VolumeInfo | null {
		const k = String(key ?? "").trim();
		if (!k) return null;
		if (vols[k]) return vols[k];
		for (const v of Object.values(vols)) if (v.name === k) return v;
		for (const v of Object.values(vols)) if (v.name.includes(k)) return v;
		return null;
	}

	async addVolume(storyName: string, name: string, description = "", volumeId = ""): Promise<doc.VolumeInfo> {
		const n = name.trim();
		if (!n) throw new Error("卷名不能为空");
		const vols = await this.loadVolumes(storyName);
		let id = String(volumeId).trim();
		if (!id) {
			let maxN = 0;
			for (const key of Object.keys(vols)) {
				const m = /^vol_(\d+)$/.exec(key);
				if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
			}
			id = `vol_${maxN + 1}`;
		} else if (vols[id]) {
			throw new Error(`卷 ID 已存在：${id}`);
		}
		const order = Object.values(vols).reduce((mx, v) => Math.max(mx, v.order), 0) + 1;
		const vol: doc.VolumeInfo = { id, name: n, description: description.trim(), order };
		vols[id] = vol;
		await this.saveVolumes(storyName, vols);
		return vol;
	}

	async updateVolume(storyName: string, key: string, patch: Partial<Pick<doc.VolumeInfo, "name" | "description">>): Promise<doc.VolumeInfo | null> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, key);
		if (!vol) return null;
		if (patch.name !== undefined && patch.name.trim()) vol.name = patch.name.trim();
		if (patch.description !== undefined) vol.description = String(patch.description).trim();
		await this.saveVolumes(storyName, vols);
		return vol;
	}

	/** 删除卷并清空其下章节的归属标记（卷仅作分组容器，不影响章节编号） */
	async deleteVolume(storyName: string, key: string): Promise<{ deleted: boolean; unassignedChapters: number[] }> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, key);
		if (!vol) return { deleted: false, unassignedChapters: [] };
		delete vols[vol.id];
		await this.saveVolumes(storyName, vols);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const cleared: number[] = [];
		for (const [numStr, meta] of Object.entries(state.chapters)) {
			if (meta.volume === vol.id || meta.volume === vol.name) {
				meta.volume = "";
				cleared.push(parseInt(numStr, 10));
				await this.writeChapterInfoField(storyName, parseInt(numStr, 10), "卷", "");
			}
		}
		if (state.current_volume === vol.id) delete state.current_volume;
		await this.saveState(storyName, state);
		return { deleted: true, unassignedChapters: cleared };
	}

	/** 激活卷并自动切换到该卷最后一章（对齐 /volume use） */
	async activateVolume(storyName: string, key: string): Promise<{ num: number | null; path: string | null }> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, key);
		if (!vol) throw new Error(`未找到卷：${key}`);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		state.current_volume = vol.id;
		let target: number | null = null;
		for (const [numStr, meta] of Object.entries(state.chapters)) {
			if ((meta.volume || "") === vol.id && parseInt(numStr, 10) > (target ?? -1)) target = parseInt(numStr, 10);
		}
		if (target != null) state.current_chapter = target;
		await this.saveState(storyName, state);
		const ch = target == null ? null : await this.chapterDirOf(storyName, target);
		return { num: target, path: ch ? `${ch.dir.path}/章节.md` : null };
	}

	private async writeChapterInfoField(
		storyName: string,
		num: number,
		field: "卷" | "标签" | "备注",
		value: string
	): Promise<void> {
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) return;
		const path = `${ch.dir.path}/章节信息.md`;
		const raw = await this.readDoc(path);
		const info = doc.parseChapterInfo(raw);
		if (field === "卷") info.volume = value.trim();
		else if (field === "标签") info.tags = value.trim() ? doc.splitList(value) : [];
		else info.notes = value.trim();
		let heading = "";
		for (const line of raw.split("\n")) {
			if (line.trim().startsWith("#")) {
				heading = line.trim().replace(/^#+\s*/, "").replace(new RegExp(`^第${num}章\\s*`), "").replace(/\s*章节信息$/, "");
				break;
			}
		}
		await this.writeDoc(path, doc.formatChapterInfo(num, heading, info));
	}

	async setChapterVolume(storyName: string, num: number, volumeKey: string): Promise<string> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, volumeKey);
		if (!vol) throw new Error(`未找到卷：${volumeKey}`);
		await this.writeChapterInfoField(storyName, num, "卷", vol.id);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const meta = state.chapters[String(num)] ?? { title: "", words: 0 };
		meta.volume = vol.id;
		state.chapters[String(num)] = meta;
		await this.saveState(storyName, state);
		return vol.id;
	}

	async unassignChapterVolume(storyName: string, num: number): Promise<void> {
		await this.writeChapterInfoField(storyName, num, "卷", "");
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		if (state.chapters[String(num)]) state.chapters[String(num)].volume = "";
		await this.saveState(storyName, state);
	}

	// ---------- 场景（章节级 + 根目录全局未归属）----------

	private async sceneFilePath(storyName: string, chapNum: number): Promise<string> {
		if (chapNum > 0) {
			const ch = await this.chapterDirOf(storyName, chapNum);
			return `${ch!.dir.path}/场景.md`;
		}
		return `${this.storyPath(storyName)}/场景.md`;
	}

	private async saveScenesFile(
		storyName: string,
		chapNum: number,
		scenes: Record<string, doc.SceneDoc>
	): Promise<void> {
		let heading = "";
		if (chapNum > 0) {
			const ch = await this.chapterDirOf(storyName, chapNum);
			heading = ch ? `第${chapNum}章 ${ch.title}` : `第${chapNum}章`;
		} else {
			const state = await this.loadState(storyName);
			heading = this.bookTitle(storyName, state);
		}
		await this.writeDoc(await this.sceneFilePath(storyName, chapNum), doc.formatScenes(heading, scenes));
	}

	async loadAllScenes(storyName: string): Promise<Record<string, doc.SceneDoc>> {
		const result: Record<string, doc.SceneDoc> = {};
		Object.assign(result, doc.parseScenes(await this.readDoc(`${this.storyPath(storyName)}/场景.md`), 0));
		for (const ch of await this.listChapters(storyName)) {
			Object.assign(result, doc.parseScenes(await this.readDoc(`${ch.dir.path}/场景.md`), ch.num));
		}
		return result;
	}

	findSceneIn(scenes: Record<string, doc.SceneDoc>, key: string): doc.SceneDoc | null {
		const k = String(key ?? "").trim();
		if (!k) return null;
		if (scenes[k]) return scenes[k];
		for (const s of Object.values(scenes)) if (s.scene_id.includes(k)) return s;
		return null;
	}

	async addScene(storyName: string, input: SceneInput): Promise<doc.SceneDoc> {
		const id = safeFilename(String(input.scene_id ?? "").trim());
		if (!id) throw new Error("场景名不能为空");
		const chapNum = Math.max(0, Math.floor(Number(input.chapter_num) || 0));
		const all = await this.loadAllScenes(storyName);
		if (all[id]) throw new Error(`同名场景已存在：${id}`);
		const scene: doc.SceneDoc = {
			scene_id: id,
			description: String(input.description ?? "").trim(),
			chapter_num: chapNum,
			characters: [...new Set((input.characters ?? []).map((c) => c.trim()).filter(Boolean))],
			content: String(input.content ?? "").trim(),
			notes: String(input.notes ?? "").trim(),
		};
		const path = await this.sceneFilePath(storyName, chapNum);
		const local = doc.parseScenes(await this.readDoc(path), chapNum);
		local[id] = scene;
		await this.saveScenesFile(storyName, chapNum, local);
		return scene;
	}

	async updateScene(
		storyName: string,
		key: string,
		patch: Partial<Omit<doc.SceneDoc, "scene_id">> & { chapter_num?: number }
	): Promise<doc.SceneDoc | null> {
		const all = await this.loadAllScenes(storyName);
		const scene = this.findSceneIn(all, key);
		if (!scene) return null;
		if (patch.description !== undefined) scene.description = String(patch.description).trim();
		if (patch.chapter_num !== undefined && patch.chapter_num >= 0 && patch.chapter_num !== scene.chapter_num) {
			// 跨章节移动：从原文件移除、写入新文件
			const fromPath = await this.sceneFilePath(storyName, scene.chapter_num);
			const fromLocal = doc.parseScenes(await this.readDoc(fromPath), scene.chapter_num);
			delete fromLocal[scene.scene_id];
			await this.saveScenesFile(storyName, scene.chapter_num, fromLocal);
			scene.chapter_num = Math.floor(patch.chapter_num);
			const toPath = await this.sceneFilePath(storyName, scene.chapter_num);
			const toLocal = doc.parseScenes(await this.readDoc(toPath), scene.chapter_num);
			toLocal[scene.scene_id] = scene;
			await this.saveScenesFile(storyName, scene.chapter_num, toLocal);
			return scene;
		}
		if (patch.characters !== undefined) {
			scene.characters = [...new Set((patch.characters ?? []).map((c) => c.trim()).filter(Boolean))];
		}
		if (patch.content !== undefined) scene.content = String(patch.content).trim();
		if (patch.notes !== undefined) scene.notes = String(patch.notes).trim();
		const path = await this.sceneFilePath(storyName, scene.chapter_num);
		const local = doc.parseScenes(await this.readDoc(path), scene.chapter_num);
		local[scene.scene_id] = scene;
		await this.saveScenesFile(storyName, scene.chapter_num, local);
		return scene;
	}

	async deleteScene(storyName: string, key: string): Promise<boolean> {
		const all = await this.loadAllScenes(storyName);
		const scene = this.findSceneIn(all, key);
		if (!scene) return false;
		const path = await this.sceneFilePath(storyName, scene.chapter_num);
		const local = doc.parseScenes(await this.readDoc(path), scene.chapter_num);
		delete local[scene.scene_id];
		await this.saveScenesFile(storyName, scene.chapter_num, local);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		if (state.current_scene === scene.scene_id) delete state.current_scene;
		await this.saveState(storyName, state);
		return true;
	}

	/** 切换当前场景（纯运行态操作，对齐 /scene switch） */
	async switchScene(storyName: string, key: string): Promise<doc.SceneDoc> {
		const all = await this.loadAllScenes(storyName);
		const scene = this.findSceneIn(all, key);
		if (!scene) throw new Error(`未找到场景：${key}`);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		state.current_scene = scene.scene_id;
		await this.saveState(storyName, state);
		return scene;
	}

	// ---------- 角色（人物.md：章节级 + 根目录全局）----------

	private async characterFilePath(storyName: string, chapNum: number): Promise<string> {
		if (chapNum > 0) {
			const ch = await this.chapterDirOf(storyName, chapNum);
			return `${ch!.dir.path}/人物.md`;
		}
		return `${this.storyPath(storyName)}/人物.md`;
	}

	private async saveCharactersFile(
		storyName: string,
		chapNum: number,
		characters: Record<string, doc.CharacterDoc>
	): Promise<void> {
		let heading = "";
		if (chapNum > 0) {
			const ch = await this.chapterDirOf(storyName, chapNum);
			heading = ch ? `第${chapNum}章 ${ch.title}` : `第${chapNum}章`;
		} else {
			const state = await this.loadState(storyName);
			heading = this.bookTitle(storyName, state);
		}
		await this.writeDoc(await this.characterFilePath(storyName, chapNum), doc.formatCharacters(heading, characters));
	}

	async loadAllCharacters(storyName: string): Promise<Record<string, doc.CharacterDoc>> {
		const result: Record<string, doc.CharacterDoc> = {};
		Object.assign(result, doc.parseCharacters(await this.readDoc(`${this.storyPath(storyName)}/人物.md`), 0));
		for (const ch of await this.listChapters(storyName)) {
			Object.assign(result, doc.parseCharacters(await this.readDoc(`${ch.dir.path}/人物.md`), ch.num));
		}
		return result;
	}

	findCharacterIn(chars: Record<string, doc.CharacterDoc>, key: string): doc.CharacterDoc | null {
		const k = String(key ?? "").trim();
		if (!k) return null;
		if (chars[k]) return chars[k];
		for (const c of Object.values(chars)) if (c.name.includes(k)) return c;
		return null;
	}

	async addCharacter(storyName: string, input: CharacterInput): Promise<doc.CharacterDoc> {
		const name = safeFilename(String(input.name ?? "").trim());
		if (!name) throw new Error("角色名不能为空");
		const chapNum = Math.max(0, Math.floor(Number(input.chapter) || 0));
		const all = await this.loadAllCharacters(storyName);
		if (all[name]) throw new Error(`同名角色已存在：${name}`);
		const char: doc.CharacterDoc = {
			name,
			chapter: chapNum,
			identity: String(input.identity ?? "").trim(),
			age: String(input.age ?? "").trim(),
			gender: String(input.gender ?? "").trim(),
			personality: String(input.personality ?? "").trim(),
			appearance: String(input.appearance ?? "").trim(),
			background: String(input.background ?? "").trim(),
			abilities: doc.splitList(String(input.abilities ?? "")),
			notes: String(input.notes ?? "").trim(),
		};
		const path = await this.characterFilePath(storyName, chapNum);
		const local = doc.parseCharacters(await this.readDoc(path), chapNum);
		local[name] = char;
		await this.saveCharactersFile(storyName, chapNum, local);
		return char;
	}

	async updateCharacter(
		storyName: string,
		key: string,
		patch: Partial<Omit<doc.CharacterDoc, "name">> & { chapter?: number }
	): Promise<doc.CharacterDoc | null> {
		const all = await this.loadAllCharacters(storyName);
		const char = this.findCharacterIn(all, key);
		if (!char) return null;
		if (patch.chapter !== undefined && patch.chapter >= 0 && patch.chapter !== char.chapter) {
			const fromPath = await this.characterFilePath(storyName, char.chapter);
			const fromLocal = doc.parseCharacters(await this.readDoc(fromPath), char.chapter);
			delete fromLocal[char.name];
			await this.saveCharactersFile(storyName, char.chapter, fromLocal);
			char.chapter = Math.floor(patch.chapter);
			const toPath = await this.characterFilePath(storyName, char.chapter);
			const toLocal = doc.parseCharacters(await this.readDoc(toPath), char.chapter);
			toLocal[char.name] = char;
			await this.saveCharactersFile(storyName, char.chapter, toLocal);
		} else {
			if (patch.identity !== undefined) char.identity = String(patch.identity).trim();
			if (patch.age !== undefined) char.age = String(patch.age).trim();
			if (patch.gender !== undefined) char.gender = String(patch.gender).trim();
			if (patch.personality !== undefined) char.personality = String(patch.personality).trim();
			if (patch.appearance !== undefined) char.appearance = String(patch.appearance).trim();
			if (patch.background !== undefined) char.background = String(patch.background).trim();
			if (patch.abilities !== undefined) char.abilities = [...new Set((patch.abilities ?? []).map((a) => a.trim()).filter(Boolean))];
			if (patch.notes !== undefined) char.notes = String(patch.notes).trim();
			const path = await this.characterFilePath(storyName, char.chapter);
			const local = doc.parseCharacters(await this.readDoc(path), char.chapter);
			local[char.name] = char;
			await this.saveCharactersFile(storyName, char.chapter, local);
		}
		return char;
	}

	/** 删除角色并清理各场景中的引用（对齐 /character delete） */
	async deleteCharacter(storyName: string, key: string): Promise<boolean> {
		const all = await this.loadAllCharacters(storyName);
		const char = this.findCharacterIn(all, key);
		if (!char) return false;
		const path = await this.characterFilePath(storyName, char.chapter);
		const local = doc.parseCharacters(await this.readDoc(path), char.chapter);
		delete local[char.name];
		await this.saveCharactersFile(storyName, char.chapter, local);
		// 清理场景引用
		for (const [sceneId, scene] of Object.entries(await this.loadAllScenes(storyName))) {
			if (!scene.characters.includes(char.name)) continue;
			scene.characters = scene.characters.filter((c) => c !== char.name);
			const spath = await this.sceneFilePath(storyName, scene.chapter_num);
			const slocal = doc.parseScenes(await this.readDoc(spath), scene.chapter_num);
			slocal[sceneId] = scene;
			await this.saveScenesFile(storyName, scene.chapter_num, slocal);
		}
		return true;
	}

	/** 角色改名：全小说 MD 文件同步替换，原文件备份到 _backup/角色改名_时间戳/（对齐 /character rename） */
	async renameCharacter(
		storyName: string,
		oldName: string,
		newName: string
	): Promise<{ hits: number; files: number } | null> {
		const oldN = String(oldName ?? "").trim();
		const newN = safeFilename(String(newName ?? "").trim());
		if (!oldN || !newN) return null;
		const folder = this.storyFolder(storyName);
		if (!folder) throw new Error(`小说不存在：${storyName}`);
		const storyBase = this.storyPath(storyName);
		const changed: Array<{ file: TFile; text: string }> = [];
		let hits = 0;
		for (const f of await this.listMarkdownFiles(folder)) {
			const text = await this.vault.read(f);
			const c = text.split(oldN).length - 1;
			if (c > 0) {
				hits += c;
				changed.push({ file: f, text });
			}
		}
		if (hits === 0) return null;
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
		const backupDir = `${storyBase}/_backup/角色改名_${ts}`;
		for (const item of changed) {
			const rel = item.file.path.substring(storyBase.length + 1);
			await this.writeDoc(`${backupDir}/${rel}`, item.text);
		}
		for (const item of changed) {
			await this.vault.modify(item.file, item.text.split(oldN).join(newN));
		}
		return { hits, files: changed.length };
	}

	// ---------- 伏笔（根目录 伏笔.md）----------

	async loadForeshadows(storyName: string): Promise<doc.ForeshadowItem[]> {
		return doc.parseForeshadows(await this.readDoc(`${this.storyPath(storyName)}/伏笔.md`));
	}

	private async saveForeshadowsFile(storyName: string, items: doc.ForeshadowItem[]): Promise<void> {
		const path = `${this.storyPath(storyName)}/伏笔.md`;
		if (items.length === 0) {
			await this.removeDocIfExists(path);
			return;
		}
		const state = await this.loadState(storyName);
		await this.writeDoc(path, doc.formatForeshadows(this.bookTitle(storyName, state), items));
	}

	async addForeshadow(storyName: string, chapter: number, character: string, reason: string): Promise<number> {
		const chap = Math.max(1, chapter);
		const items = await this.loadForeshadows(storyName);
		items.push({ chapter: chap, character: character.trim(), reason: reason.trim(), done: false });
		await this.saveForeshadowsFile(storyName, items);
		return items.filter((i) => i.chapter === chap).length - 1; // 该章内新序号（保存时重编号）
	}

	/** 按「章节+序号」标记完成/未完成；不带序号默认 0 */
	async setForeshadowDone(storyName: string, chapter: number, index: number, done: boolean): Promise<boolean> {
		const items = await this.loadForeshadows(storyName);
		let pos = -1;
		for (let i = 0; i < items.length; i++) if (items[i].chapter === chapter && items[i].index === index) (pos = i);
		if (pos < 0) return false;
		items[pos].done = done;
		await this.saveForeshadowsFile(storyName, items);
		return true;
	}

	async deleteForeshadow(storyName: string, chapter: number, index: number): Promise<boolean> {
		const items = await this.loadForeshadows(storyName);
		const pos = items.findIndex((i) => i.chapter === chapter && i.index === index);
		if (pos < 0) return false;
		items.splice(pos, 1);
		await this.saveForeshadowsFile(storyName, items);
		return true;
	}

	/**
	 * 从大纲文本提取 [伏]…[/] 标记并保存（对齐 ContextBuilder._save_outline_foreshadows）：
	 * 同一章节已有伏笔则整体替换，否则追加。返回本次写入的条数。
	 */
	async saveOutlineForeshadows(storyName: string, outlineText: string, defaultChapter: number): Promise<number> {
		const extracted = doc.extractForeshadows(outlineText, Math.max(1, defaultChapter));
		if (extracted.length === 0) return 0;
		const items = await this.loadForeshadows(storyName);
		for (const chap of [...new Set(extracted.map((e) => e.chapter))]) {
			const fresh = extracted.filter((e) => e.chapter === chap);
			const kept = items.filter((i) => i.chapter !== chap);
			kept.push(...fresh);
			// 按章节归组并重新编号（序号=章内位置，与 formatForeshadows 的写法一致）
			const normalized: doc.ForeshadowItem[] = [];
			for (const c of [...new Set(kept.map((k) => k.chapter))].sort((x, y) => x - y)) {
				kept.filter((k) => k.chapter === c).forEach((k, i) => {
					k.index = i;
					normalized.push(k);
				});
			}
			await this.saveForeshadowsFile(storyName, normalized);
		}
		return extracted.length;
	}

	// ---------- 世界观（世界观.md）----------

	async readWorldDoc(storyName: string): Promise<doc.WorldSettingDoc> {
		return doc.parseWorld(await this.readDoc(`${this.storyPath(storyName)}/世界观.md`));
	}

	/** /world set <字段> <值>：世界/类型/规则/势力/地点/历史/力量体系 */
	async setWorldField(storyName: string, field: string, value: string): Promise<boolean> {
		const path = `${this.storyPath(storyName)}/世界观.md`;
		const ws = await this.readWorldDoc(storyName);
		switch (field.trim()) {
			case "世界":
				ws.name = value.trim();
				break;
			case "类型":
				ws.world_type = value.trim();
				break;
			case "规则":
				ws.rules = value ? doc.splitList(value) : [];
				break;
			case "势力":
				ws.factions = value ? doc.splitList(value) : [];
				break;
			case "地点":
				ws.locations = value ? doc.splitList(value) : [];
				break;
			case "历史":
				ws.history = value;
				break;
			case "力量体系":
				ws.magic_system = value;
				break;
			default:
				return false;
		}
		const state = await this.loadState(storyName);
		await this.writeDoc(path, doc.formatWorld(this.bookTitle(storyName, state), ws));
		return true;
	}

	// ---------- 大纲追加（章节大纲.md）----------

	/**
	 * 追加保存章节大纲（对齐 /outline chapter N [内容]：加载现有→去重合并→写盘）。
	 * 返回 { appended, foreshadows }；重复内容不重复追加。
	 */
	async appendChapterOutline(
		storyName: string,
		num: number,
		content: string
	): Promise<{ appended: boolean; foreshadows: number }> {
		const text = String(content ?? "").trim();
		if (!text) return { appended: false, foreshadows: 0 };
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) throw new Error(`第${num}章不存在`);
		const path = `${ch.dir.path}/章节大纲.md`;
		let current = (await this.readDoc(path)).replace(/^#+\s.*$/m, "").trim(); // 去掉标题行
		let merged: string;
		if (current && (text === current || current.endsWith(text) || (text.length >= 10 && current.includes(text)))) {
			return { appended: false, foreshadows: 0 }; // 已包含该内容，未重复追加
		} else if (current) {
			merged = `${current}\n\n${text}`;
		} else {
			merged = text;
		}
		await this.writeDoc(path, appendOutlineMarkerHelp(`# 第${num}章 ${ch.title} 大纲\n\n${merged}\n`)); // 对齐 write_chapter_outline：始终带标记帮助尾注
		const foreshadows = await this.saveOutlineForeshadows(storyName, merged, num);
		return { appended: true, foreshadows };
	}

	async readChapterOutline(storyName: string, num: number): Promise<string> {
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) return "";
		return (await this.readDoc(`${ch.dir.path}/章节大纲.md`)).replace(/^#+\s.*$/m, "").trim();
	}

	// ---------- 章节删除 / 改名 / 重编号（对齐 chapters.py）----------

	/** 删除章节：移入回收站、清理元数据；当前章节回退到最后一章 */
	async deleteChapter(storyName: string, num: number): Promise<{ title: string }> {
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) throw new Error(`第${num}章不存在`);
		await this.vault.trash(ch.dir, false);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const removed = state.chapters[String(num)];
		delete state.chapters[String(num)];
		if (state.current_chapter === num) {
			const remaining = Object.keys(state.chapters).map((k) => parseInt(k, 10));
			state.current_chapter = remaining.length ? Math.max(...remaining) : null;
		}
		if (state.current_scene) delete state.current_scene; // 场景随章节目录一并删除，清理悬空引用
		await this.recomputeTotalWords(storyName, state);
		await this.saveState(storyName, state);
		return { title: removed?.title || ch.title };
	}

	/** 改章节标题：重命名目录并同步各文档中的旧标题（对齐 /chapter rename） */
	async renameChapter(storyName: string, num: number, rawNewTitle: string): Promise<string> {
		const m = /^第\s*\d+\s*章\s*(.+)$/.exec(String(rawNewTitle ?? "").trim());
		let newTitle = (m ? m[1] : String(rawNewTitle ?? "").trim()).trim();
		if (!newTitle) throw new Error("新标题不能为空");
		newTitle = safeFilename(newTitle);
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) throw new Error(`第${num}章不存在`);
		const oldTitle = ch.title;
		if (oldTitle === newTitle) return newTitle;
		const newPath = `${this.storyPath(storyName)}/第${String(num).padStart(2, "0")}章-${newTitle}`;
		await this.vault.rename(ch.dir, newPath);
		for (const f of await this.listMarkdownFiles(this.vault.getAbstractFileByPath(newPath) as TFolder)) {
			const text = await this.vault.read(f);
			if (text.includes(oldTitle)) {
				await this.vault.modify(f, text.split(oldTitle).join(newTitle));
			}
		}
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const meta = state.chapters[String(num)] ?? { title: oldTitle, words: 0 };
		meta.title = newTitle;
		state.chapters[String(num)] = meta;
		await this.saveState(storyName, state);
		return newTitle;
	}

	private async moveChapterDir(storyName: string, fromNum: number, toNum: number): Promise<void> {
		const ch = await this.chapterDirOf(storyName, fromNum);
		if (!ch) throw new Error(`章节目录不存在：第${fromNum}章`);
		const newPath = `${this.storyPath(storyName)}/第${String(toNum).padStart(2, "0")}章-${safeFilename(ch.title || `第${toNum}章`)}`;
		await this.vault.rename(ch.dir, newPath);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		if (state.chapters[String(fromNum)]) {
			state.chapters[String(toNum)] = state.chapters[String(fromNum)];
			delete state.chapters[String(fromNum)];
		}
		if (state.current_chapter === fromNum) state.current_chapter = toNum;
		await this.saveState(storyName, state); // 每步落盘，中断可恢复（对齐 Python）
	}

	/**
	 * 重编号章节为连续 1..N（两阶段临时迁移；以磁盘为准）。
	 * 同时重写各章节目录内 md 中的「第X章」引用与 伏笔.md 的章节号。
	 */
	async renumberChapters(storyName: string): Promise<{ ok: boolean; msg: string }> {
		const chapters = await this.listChapters(storyName);
		if (chapters.length === 0) return { ok: false, msg: "没有章节" };
		const nums = chapters.map((c) => c.num).sort((a, b) => a - b);
		let contiguous = true;
		for (let i = 0; i < nums.length; i++) if (nums[i] !== i + 1) (contiguous = false);
		if (contiguous) return { ok: false, msg: `章节号已连续（1~${nums.length}），无需调整` };
		const mapping: Record<number, number> = {};
		for (let i = 0; i < nums.length; i++) mapping[nums[i]] = i + 1;
		const tmpBase = Math.max(...nums) + nums.length + 1;
		for (let i = 0; i < nums.length; i++) {
			await this.moveChapterDir(storyName, nums[i], tmpBase + i); // 旧 → 临时
		}
		for (let i = 0; i < nums.length; i++) {
			await this.moveChapterDir(storyName, tmpBase + i, i + 1); // 临时 → 新
		}
		// 重写引用：各章节目录内 md 的「第X章」文本
		const renumText = (text: string): string => {
			let out = text.replace(/第(\d{1,6})章/g, (_all, d) => {
				const n = parseInt(d, 10);
				return `第${mapping[n] ?? n}章`;
			});
			out = out.replace(/章节[：:]\s*(\d+)/g, (_all, d) => {
				const n = parseInt(d, 10);
				return `章节：${mapping[n] ?? n}`;
			});
			return out;
		};
		const folder = this.storyFolder(storyName);
		if (folder) {
			for (const ch of await this.listChapters(storyName)) {
				for (const f of await this.listMarkdownFiles(ch.dir)) {
					const text = await this.vault.read(f);
					const next = renumText(text);
					if (next !== text) await this.vault.modify(f, next);
				}
			}
			// 伏笔.md 结构化重编号（对齐 _renumber_refs）
			const items = await this.loadForeshadows(storyName);
			let changed = false;
			for (const item of items) if (mapping[item.chapter]) (item.chapter = mapping[item.chapter]);
			await this.saveForeshadowsFile(storyName, items);
			void changed;
		}
		return { ok: true, msg: `已重编号为连续 1~${nums.length} 章` };
	}

	// ---------- 打包导出（/pack）----------

	async packChapters(
		storyName: string,
		spec: string,
		outputPath = ""
	): Promise<{ path: string; packed: Array<{ num: number; words: number }>; skipped: number[] }> {
		const chapters = await this.listChapters(storyName);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const sel = doc.parseChapterSelection(spec || String(state.current_chapter ?? ""), chapters.map((c) => c.num));
		if (!sel.nums.length) throw new Error(`没有可打包的章节${sel.invalid.length ? `（无法识别：${sel.invalid.join("、")}）` : ""}`);
		const bodyRe = /^#\s.*$/m; // 正文标题行
		const parts: string[] = [];
		const packed: Array<{ num: number; words: number }> = [];
		const skipped: number[] = [];
		for (const n of sel.nums) {
			const ch = chapters.find((c) => c.num === n)!;
			const f = this.vault.getAbstractFileByPath(`${ch.dir.path}/章节.md`);
			let text = f instanceof TFile ? await this.vault.read(f) : "";
			text = text.replace(bodyRe, "").trim();
			if (!text) {
				skipped.push(n);
				continue;
			}
			parts.push(`## ${doc.numToCn(n)}章 ${ch.title}\n\n${text}`);
			packed.push({ num: n, words: countPureWords(text) });
		}
		if (!packed.length) throw new Error("所选章节均无正文，未生成文件");
		const title = this.bookTitle(storyName, state);
		const first = packed[0].num;
		const last = packed[packed.length - 1].num;
		const fileName = safeFilename(
			packed.length > 1 && first !== last ? `${title}-第${first}-${last}章-合集` : `${title}-第${first}章-合集`
		) + ".md";
		let target = String(outputPath ?? "").trim();
		if (target) {
			if (!/\.(md|markdown)$/i.test(target)) target = `${target.replace(/\/+$/, "")}/${fileName}`;
		} else {
			target = `${this.storyPath(storyName)}/${fileName}`;
		}
		await this.writeDoc(target, parts.join("\n\n---\n\n") + "\n");
		return { path: target, packed, skipped };
	}

	// ---------- 扫描重建（/scan）----------

	/** 以磁盘为准刷新故事状态.md：补齐缺失模板文档、重算元数据与总字数 */
	async rescanStory(storyName: string): Promise<{ chapters: number; totalWords: number; createdDocs: number }> {
		const base = this.storyPath(storyName);
		const folder = this.storyFolder(storyName);
		if (!folder) throw new Error(`小说目录不存在：${base}`);
		let created = 0;
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		for (const [fname, tpl] of [
			["大纲.md", outlineTemplate(this.bookTitle(storyName, state))],
			["世界观.md", WORLD_TEMPLATE],
			["卷.md", VOLUME_TEMPLATE],
			["伏笔.md", FORESHADOW_TEMPLATE],
			["笔记.md", NOTES_TEMPLATE],
		] as Array<[string, string]>) {
			if ((await this.ensureDoc(`${base}/${fname}`, tpl)) === "created") created++;
		}
		const diskChapters = await this.listChapters(storyName);
		const seen = new Set<number>();
		for (const ch of diskChapters) {
			seen.add(ch.num);
			const dirDocs: Array<[string, string]> = [
				["章节.md", CHAPTER_BODY_TEMPLATE(ch.num, ch.title)],
				["章节大纲.md", chapterOutlineTemplate(ch.num, ch.title)],
				["人物.md", CHAPTER_CHARACTERS_TEMPLATE],
				["人物关系.md", CHAPTER_RELATIONSHIPS_TEMPLATE],
				["场景.md", CHAPTER_SCENES_TEMPLATE],
				["章节信息.md", CHAPTER_INFO_TEMPLATE(ch.num)],
			];
			for (const [fname, tpl] of dirDocs) {
				if ((await this.ensureDoc(`${ch.dir.path}/${fname}`, tpl)) === "created") created++;
			}
			const info = doc.parseChapterInfo(await this.readDoc(`${ch.dir.path}/章节信息.md`));
			const f = this.vault.getAbstractFileByPath(`${ch.dir.path}/章节.md`);
			const words = countPureWords(f instanceof TFile ? await this.vault.read(f) : "");
			state.chapters[String(ch.num)] = {
				title: ch.title,
				words,
				volume: info.volume || undefined,
				tags: info.tags.length ? info.tags : undefined,
				note: info.notes || undefined,
			};
		}
		for (const key of Object.keys(state.chapters)) {
			if (!seen.has(parseInt(key, 10))) delete state.chapters[key]; // 磁盘已删除的条目清理
		}
		await this.recomputeTotalWords(storyName, state);
		const vols = await this.loadVolumes(storyName);
		if (state.current_volume && !vols[state.current_volume]) delete state.current_volume;
		if (state.current_chapter != null && !seen.has(state.current_chapter)) {
			state.current_chapter = diskChapters.length ? diskChapters[diskChapters.length - 1].num : null;
		}
		await this.saveState(storyName, state);
		return { chapters: diskChapters.length, totalWords: state.total_words, createdDocs: created };
	}

	// ---------- 编写类型（/style）----------

	async setWritingStyle(storyName: string, style: string): Promise<string> {
		const s = String(style ?? "").trim();
		if (!s) throw new Error("类型名不能为空");
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		state.writing_style = s;
		await this.saveState(storyName, state);
		return s;
	}

	// ---------- 写作上下文加载（/write /continue /rewrite /review 共用，对应 Python get_context_for_writing 的磁盘读取）----------

	private async readGlobalOutlineRaw(storyName: string): Promise<string> {
		const raw = await this.readDoc(`${this.storyPath(storyName)}/大纲.md`);
		let lines = doc.stripComments(raw.trim()).trim().split("\n");
		if (lines.length && lines[0].startsWith("# ")) lines.shift();
		return lines.join("\n").trim();
	}

	async readChapterOutlineForPrompt(storyName: string, num: number): Promise<string> {
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) return "";
		const raw = await this.readDoc(`${ch.dir.path}/章节大纲.md`);
		let lines = doc.stripComments(raw.trim()).trim().split("\n");
		while (lines.length && /^#\s*第\s*\d+\s*章.*大纲\s*$/.test(lines[0])) lines.shift();
		return lines.join("\n").trim();
	}

	/** 读正文：剥离 AI 用语标红标签 + 去 "# " 标题行（对齐 _read_std_chapter_dir，摘要哈希基于此文本） */
	async readChapterContent(storyName: string, num: number): Promise<string> {
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) return "";
		return doc.stripTitleLine(stripAiWordMarks(await this.readDoc(`${ch.dir.path}/章节.md`)))[0];
	}

	/** 读某章已保存的 AI 摘要；缺失/无哈希/内容已变化时返回空串（不自动生成，调用方回退原文预览） */
	private async readFreshSummary(storyName: string, num: number, content: string): Promise<string> {
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch || !content.trim()) return "";
		const raw = await this.readDoc(`${ch.dir.path}/章节摘要.md`);
		if (!raw.trim()) return "";
		const m = /<!--\s*内容哈希[:：]\s*([0-9a-f]{32})\s*-->/.exec(raw);
		if (!m || m[1] !== md5(content)) return "";
		return doc.stripTitleLine(doc.stripComments(raw))[0];
	}

	/**
	 * 组装写作提示词所需的磁盘数据。
	 * 副作用：从全局大纲与本章大纲抽取 [伏]…[/] 标记并持久化到 伏笔.md（对齐 Python _save_outline_foreshadows）。
	 */
	async loadWritingData(
		storyName: string,
		chapterNum: number,
		opts?: { includeCurrentSummary?: boolean }
	): Promise<import("./prompts").WritingContextInput & { savedForeshadows: number }> {
		const num = Math.max(1, chapterNum | 0);
		const state = await this.validatedState(storyName);
		const byNum = new Map((await this.listChapters(storyName)).map((c) => [c.num, c]));

		const globalOutlineRaw = await this.readGlobalOutlineRaw(storyName);
		let savedForeshadows = await this.saveOutlineForeshadows(storyName, globalOutlineRaw, num);

		const ch = byNum.get(num);
		const entries: ChapterFolderDocEntry[] = [];
		if (ch) {
			for (const fname of ["章节大纲.md", "人物.md", "人物关系.md", "场景.md", "章节信息.md"]) {
				entries.push({ file: fname, text: await this.readDoc(`${ch.dir.path}/${fname}`) });
			}
		}
		const folderDocs = buildChapterFolderDocs(entries, num).docs;
		const chapterOutlineText = await this.readChapterOutlineForPrompt(storyName, num);
		savedForeshadows += await this.saveOutlineForeshadows(storyName, chapterOutlineText, num);

		const prevN = 3; // Python story_state.context_prev_chapters 缺省值（插件状态无此字段）
		const prevChapters: PrevChapterRef[] = [];
		for (let i = Math.max(1, num - prevN); i < num; i++) {
			const meta = byNum.get(i);
			if (!meta) continue;
			const content = await this.readChapterContent(storyName, i);
			if (!content.trim()) continue;
			prevChapters.push({ num: i, title: state.chapters[String(i)]?.title || meta.title, content });
		}

		const summaries: Record<number, string> = {};
		if (state.use_summaries !== false && prevN > 0) {
			const end = opts?.includeCurrentSummary ? num : num - 1;
			for (let i = Math.max(1, num - prevN); i <= end; i++) {
				const meta = byNum.get(i);
				if (!meta) continue;
				const content = await this.readChapterContent(storyName, i);
				const s = await this.readFreshSummary(storyName, i, content);
				if (s) summaries[i] = s;
			}
		}

		let relationshipsRaw = await this.readDoc(`${this.storyPath(storyName)}/人物关系.md`);
		if (!relationshipsRaw.trim()) relationshipsRaw = await this.readDoc(`${this.storyPath(storyName)}/角色关系.md`);
		const foreshadows = (await this.loadForeshadows(storyName)).filter((f) => !f.done);

		return {
			chapterNum: num,
			title: (state.title || "").trim() || storyName,
			genre: state.genre,
			writingStyle: state.writing_style,
			currentSceneId: state.current_scene,
			globalOutlineRaw,
			chapterOutlineText,
			characters: Object.values(await this.loadAllCharacters(storyName)),
			relationships: cleanRelationshipsDoc(relationshipsRaw),
			prevChapters,
			summaries,
			world: await this.readWorldDoc(storyName),
			scenes: Object.values(await this.loadAllScenes(storyName)),
			foreshadows,
			folderDocs,
			savedForeshadows,
		};
	}

	// ---------- LLM 写作命令落盘（/write /continue /rewrite /review，对齐 Python chapters.add/update + documents.write_*）----------

	/** 全量写正文并同步字数状态（对齐 update_chapter_content；不改动 current_chapter）。返回纯文字字数 */
	async setChapterBody(storyName: string, num: number, bodyText: string): Promise<number> {
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) throw new Error(`第${num}章不存在`);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const meta = state.chapters[String(num)] ?? { title: ch.title, words: 0 };
		state.chapters[String(num)] = meta;
		const heading = (meta.title || "").trim() || ch.title;
		await this.writeDoc(`${ch.dir.path}/章节.md`, `# 第${num}章 ${heading}\n\n${(bodyText || "").replace(/\s+$/, "")}\n`);
		meta.words = countPureWords(bodyText);
		await this.recomputeTotalWords(storyName, state);
		await this.saveState(storyName, state);
		return meta.words;
	}

	/** 全量替换本章大纲正文（对齐 documents.write_chapter_outline：标题行 + rstrip + 标记帮助尾注） */
	async setChapterOutline(storyName: string, num: number, outlineText: string): Promise<void> {
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) throw new Error(`第${num}章不存在`);
		const state = await this.loadState(storyName);
		const heading = ((state?.chapters[String(num)]?.title || "").trim()) || ch.title;
		const body = (outlineText || "").replace(/\s+$/, "");
		await this.writeDoc(`${ch.dir.path}/章节大纲.md`, appendOutlineMarkerHelp(`# 第${num}章 ${heading} 大纲\n\n${body}\n`));
	}

	/** Reader A（对齐 docs.read_chapter_outline/_strip_title_line）：去注释后仅剥一个 "# " 首行；供 prevOutlines/bridge 用 */
	async readChaptersOutlines(storyName: string, nums: number[]): Promise<Record<number, string>> {
		const out: Record<number, string> = {};
		for (const n of nums) {
			const ch = await this.chapterDirOf(storyName, n);
			if (!ch) continue;
			const raw = await this.readDoc(`${ch.dir.path}/章节大纲.md`);
			let lines = doc.stripComments(raw.trim()).trim().split("\n");
			if (lines.length && lines[0].startsWith("# ")) lines.shift();
			out[n] = lines.join("\n").trim();
		}
		return out;
	}

	/** 保存审阅报告为章内 审阅笔记.md，返回文件路径 */
	async saveReviewNote(storyName: string, num: number, report: string): Promise<string> {
		const ch = await this.chapterDirOf(storyName, num);
		if (!ch) throw new Error(`第${num}章不存在`);
		const path = `${ch.dir.path}/审阅笔记.md`;
		await this.writeDoc(path, `# 第${num}章 审阅笔记\n\n${(report || "").replace(/\s+$/, "")}\n`);
		return path;
	}
}

/** 场景输入（对齐 /scene add：ID=标题，归属章节默认当前章，0=未归属） */
export interface SceneInput {
	scene_id: string;
	description?: string;
	chapter_num: number;
	characters?: string[];
	content?: string;
	notes?: string;
}

/** 角色输入（对齐 /character add [名] + 字段询问；chapter 缺省=当前章，0=全局） */
export interface CharacterInput {
	name: string;
	identity?: string;
	age?: string;
	gender?: string;
	personality?: string;
	appearance?: string;
	background?: string;
	abilities?: string; // 「、」或逗号分隔的能力列表
	notes?: string;
	chapter?: number;
}

