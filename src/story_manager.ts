import { App, MarkdownView, TFile, TFolder, Vault } from "obsidian";
import * as doc from "./md_docs";
import {
	LEGACY_STATE_JSON,
	STATE_DOC_BODY,
	STATE_DOC_NAME,
	chKey,
	formatStateDoc,
	parseChKey,
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
	VOL_CHARACTERS_TEMPLATE,
	VOL_OUTLINE_TEMPLATE,
	VOL_RELATIONSHIPS_TEMPLATE,
	VOL_SCENES_TEMPLATE,
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

const CHAPTER_DIR_RE = /^第(\d{1,6})章-(.+)$/;

/** v0.0.16+：无卷模式下对卷类操作的统一拦截提示（纯 书→章 扁平结构，不支持建/管/归卷） */
export const NO_VOL_MODE_MSG = "该书当前为「无卷模式」（纯 书籍→章节 扁平结构），不支持该卷操作。如需启用卷结构，请先执行 /volume on";

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

/** /pack 表达式解析结果：已定位到具体容器+章节键列表；或整本多容器下裸号有歧义、需调用方让用户选容器后以 forcedVolId 重入 */
export type PackResolution = { volId: string | null; keys: string[] } | { ambiguous: true; expr: string };

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
			use_volumes: false, // v0.0.16+：新书默认无卷模式（纯 书籍→章节 扁平结构），需显式 /volume on 才启用有卷
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

	/** 卷实体目录名（= 净化后的卷名）。未归属章节留在书根，故卷名须唯一（addVolume/updateVolume 强制） */
	volumeFolderName(vol: doc.VolumeInfo): string {
		return safeFilename(vol.name.trim() || vol.id);
	}

	private async createFolderPath(p: string): Promise<void> {
		const segs = p.split("/").filter(Boolean);
		let cur = "";
		for (const s of segs) {
			cur = cur ? `${cur}/${s}` : s;
			if (!this.vault.getAbstractFileByPath(cur)) await this.vault.createFolder(cur);
		}
	}

	/**
	 * 参与章节扫描的容器路径：[书根本身] + 各「容器」子文件夹。
	 * 容器判定：名称命中某卷的实体目录名/ID，或内部含 ≥1 个形如章节目录的子文件夹；
	 * 普通资料夹（无章节目录、非卷名）不递归进入，避免把杂项里的同名目录误认成章。
	 */
	private async containerPaths(storyName: string, vols?: Record<string, doc.VolumeInfo>): Promise<string[]> {
		const base = this.storyPath(storyName);
		const paths: string[] = [base];
		try {
			const vmap = vols ?? (await this.loadVolumes(storyName));
			const known = new Set<string>();
			for (const v of Object.values(vmap)) {
				known.add(this.volumeFolderName(v));
				known.add(v.id);
			}
			const listed = await this.vault.adapter.list(base);
			for (const p of listed.folders ?? []) {
				const name = p.split("/").pop() as string;
				if (!name || name.startsWith(".") || name === "_backup") continue;
				let hasChapterChild = false;
				try {
					hasChapterChild = ((await this.vault.adapter.list(p)).folders ?? []).some((c) => CHAPTER_DIR_RE.test(c.split("/").pop()!));
				} catch { /* 不可读子目录忽略 */ }
				if (known.has(name) || hasChapterChild) paths.push(p);
			}
		} catch { /* 书目录不存在等 → 仅扫根 */ }
		return paths;
	}

	/** 确保卷实体目录存在（并补建缺失的卷级设定四件套模板），返回其路径 */
	private async ensureVolumeFolder(storyName: string, vol: doc.VolumeInfo): Promise<string> {
		const p = `${this.storyPath(storyName)}/${this.volumeFolderName(vol)}`;
		if (!this.vault.getAbstractFileByPath(p)) await this.createFolderPath(p);
		for (const [fname, tpl] of [
			["卷大纲.md", VOL_OUTLINE_TEMPLATE(vol.name)],
			["人物.md", VOL_CHARACTERS_TEMPLATE],
			["人物关系.md", VOL_RELATIONSHIPS_TEMPLATE],
			["场景.md", VOL_SCENES_TEMPLATE(vol.name)],
		] as Array<[string, string]>) {
			await this.ensureDoc(`${p}/${fname}`, tpl).catch(() => {}); // 模板补齐尽力而为，不阻断主流程
		}
		return p;
	}

	async listChapters(storyName: string): Promise<Array<{ key: string; num: number; title: string; dir: TFolder; vol?: string; parentPath: string }>> {
		const folder = this.vault.getAbstractFileByPath(this.storyPath(storyName));
		if (!folder || !(folder instanceof TFolder)) return [];
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		const byDirName = new Map<string, string>();
		for (const v of Object.values(vols)) {
			byDirName.set(this.volumeFolderName(v), v.id);
			byDirName.set(v.id, v.id);
		}
		const base = this.storyPath(storyName);
		const result: Array<{ key: string; num: number; title: string; dir: TFolder; vol?: string; parentPath: string }> = [];
		for (const containerPath of await this.containerPaths(storyName, vols)) {
			const cont = this.vault.getAbstractFileByPath(containerPath);
			if (!(cont instanceof TFolder)) continue;
			const volId = containerPath === base ? undefined : byDirName.get(cont.name);
			for (const child of cont.children) {
				if (!(child instanceof TFolder)) continue;
				const m = CHAPTER_DIR_RE.exec(child.name);
				if (!m) continue;
				if (!(await this.vault.adapter.exists(child.path))) continue; // 过滤元数据索引陈旧条目（目录已被改名/删除而索引未更新），防止其被当作存活章节再次迁移出重复目录
				if (!(await this.vault.adapter.exists(`${child.path}/章节.md`))) continue; // 空心残留目录（无章节.md，多为外部插件如 make-md 在迁移窗口期写入 .space 的残骸）：一律不当作章节——面板不显示、不参与任何迁移；由 quarantineHollowChapters 自动隔离进 _backup
				result.push({ key: chKey(volId ?? null, parseInt(m[1], 10)), num: parseInt(m[1], 10), title: m[2], dir: child, ...(volId ? { vol: volId } : {}), parentPath: containerPath });
			}
		}
		// v0.0.15：章号按容器独立编号 → 阅读序=书根章在前、各卷按 VolumeInfo.order 依次、组内本地章号升序
		return result.sort((a, b) => {
			const av = a.vol || "";
			const bv = b.vol || "";
			if (av !== bv) {
				if (!av) return -1;
				if (!bv) return 1;
				const ao = vols[av]?.order ?? Number.MAX_SAFE_INTEGER;
				const bo = vols[bv]?.order ?? Number.MAX_SAFE_INTEGER;
				return ao - bo || av.localeCompare(bv);
			}
			return a.num - b.num;
		});
	}

	async chapterBodyFile(storyName: string, key: string): Promise<TFile | null> {
		const chapters = await this.listChapters(storyName);
		const ch = chapters.find((c) => c.key === key);
		if (!ch) return null;
		const f = this.vault.getAbstractFileByPath(`${ch.dir.path}/章节.md`);
		return f instanceof TFile ? f : null;
	}

	/** v0.0.15：建章不再显式传号——在目标容器（书根/卷）内自动取本地最大号+1；volumeKey 解析不到时落书根 */
	async createChapter(storyName: string, title: string, volumeKey = ""): Promise<string> {
		let volId = "";
		if (volumeKey && ((await this.loadState(storyName))?.use_volumes ?? false)) {
			const vols = await this.loadVolumes(storyName);
			const vol = this.findVolumeIn(vols, volumeKey);
			if (vol) volId = vol.id; // 新章直接落在卷实体目录内，位置即归属；无卷模式下忽略卷参数、强制落书根
			// 解析不到 → 落书根（不阻断建章）
		}
		const inScope = (await this.listChapters(storyName)).filter((c) => (c.vol ?? "") === volId);
		const num = inScope.reduce((mx, c) => Math.max(mx, c.num), 0) + 1;
		return this.createChapterAt(storyName, num, title, volId);
	}

	private async createChapterAt(storyName: string, num: number, rawTitle: string, volId: string): Promise<string> {
		const safe = safeFilename(rawTitle.trim() || `第${num}章`);
		let base = this.storyPath(storyName);
		if (volId) {
			const vols = await this.loadVolumes(storyName);
			const vol = vols[volId];
			if (vol) base = `${base}/${this.volumeFolderName(vol)}`;
		}
		const dirPath = `${base}/第${String(num).padStart(2, "0")}章-${safe}`;
		if (this.vault.getAbstractFileByPath(dirPath)) {
			throw new Error(`章节目录已存在：${dirPath}`);
		}
		await this.createFolderPath(dirPath);
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
		state.current_chapter = chKey(volId || null, num);
		state.chapters[chKey(volId || null, num)] = volId ? { title: safe, words: 0, volume: volId } : { title: safe, words: 0 };
		await this.saveState(storyName, state);
		if (volId) await this.writeChapterInfoField(storyName, chKey(volId, num), "卷", volId); // 《章节信息》与位置保持同源
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
			use_volumes: false, // v0.0.16+：新书默认无卷模式（纯 书→章 扁平结构），需显式 /volume on 才启用有卷
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

	/** 确保状态文档 chapters 里有该章条目（缺失时按磁盘扫描结果回填 title/卷归属）——否则写入 current_chapter 的复合键会在下次解析时被「键须存在于 chapters」校验丢弃，表现为"激活不生效" */
	private async ensureChapterEntry(storyName: string, state: StoryState, key: string): Promise<void> {
		if (state.chapters[key]) return;
		const parsed = parseChKey(key);
		let title = "";
		try {
			title = (await this.listChapters(storyName)).find((c) => c.key === key)?.title ?? "";
		} catch { /* 扫描失败留空标题，scan-rebuild 会补全 */ }
		state.chapters[key] = parsed.vol ? { title, words: 0, volume: parsed.vol } : { title, words: 0 };
	}

	async switchChapter(storyName: string, key: string | null): Promise<string | null> {
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		state.current_chapter = key;
		if (key != null) {
			await this.ensureChapterEntry(storyName, state, key); // 目录与状态文档脱节（如卷实体目录被外部改名）时也能稳定激活
			const kv = parseChKey(key).vol;
			if (!state.use_volumes) delete state.current_volume; // v0.0.16+ 无卷模式：永不保留激活卷指针
			else if (kv) state.current_volume = kv; // 章节归卷时同步激活所属卷：以键里的容器为准（位置即归属），不信任可能过期的 meta.volume
		}
		await this.saveState(storyName, state);
		if (key == null) return null;
		const ch = await this.chapterDirOf(storyName, key);
		return ch ? `${ch.dir.path}/章节.md` : null;
	}

	/** v0.0.15：只在当前章所在容器（书根/同一卷）内前后翻页，不跨卷越界 */
	async nextOrPrev(storyName: string, dir: 1 | -1): Promise<{ path: string; num: number; key: string } | null> {
		const chapters = await this.listChapters(storyName);
		if (chapters.length === 0) return null;
		const curKey = (await this.loadState(storyName))?.current_chapter ?? null;
		const pos = curKey ? chapters.findIndex((c) => c.key === curKey) : -1;
		let target: (typeof chapters)[number];
		if (pos < 0) {
			target = dir === 1 ? chapters[0] : chapters[chapters.length - 1]; // 无当前章节：next→阅读序第一、prev→最后一章
		} else {
			const scopeVol = chapters[pos].vol ?? null;
			const inScope = chapters.filter((c) => (c.vol ?? null) === scopeVol);
			const localIdx = inScope.findIndex((c) => c.key === curKey);
			const nextIdx = localIdx + dir;
			if (nextIdx < 0 || nextIdx >= inScope.length) return null; // 到容器边界提示不再切换
			target = inScope[nextIdx];
		}
		await this.switchChapter(storyName, target.key);
		return { path: `${target.dir.path}/章节.md`, num: target.num, key: target.key };
	}

	async countWords(storyName: string, key?: string): Promise<Array<{ key: string; num: number; title: string; words: number }>> {
		const chapters = await this.listChapters(storyName);
		const rows: Array<{ key: string; num: number; title: string; words: number }> = [];
		for (const ch of chapters) {
			if (key != null && ch.key !== key) continue;
			const f = this.vault.getAbstractFileByPath(`${ch.dir.path}/章节.md`);
			const content = f instanceof TFile ? await this.vault.read(f) : "";
			rows.push({ key: ch.key, num: ch.num, title: ch.title, words: countPureWords(content) });
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

	// ---------- 系统级指南：插件数据目录 .obsidian/plugins/<id>/WRITING_GUIDE.md ----------
	// 该文件在 Obsidian 配置目录下、不被元数据索引收录，getAbstractFileByPath 恒返回 null；
	// 故走 DataAdapter 按文件系统相对路径读写（vault 根下任意路径均可），不依赖 TFile。

	async pluginFileExists(path: string): Promise<boolean> {
		try { return await this.app.vault.adapter.exists(path); } catch { return false; }
	}
	/** 读取插件目录内文件原文；不存在或失败返回 null */
	async readPluginFile(path: string): Promise<string | null> {
		const f = this.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) return await this.vault.read(f);
		try {
			if (await this.app.vault.adapter.exists(path)) return await this.app.vault.adapter.read(path);
		} catch { /* ignore */ }
		return null;
	}
	/** 写入/覆盖插件目录内文件（缺失自动建父目录） */
	async writePluginFile(path: string, text: string): Promise<void> {
		await this.app.vault.adapter.write(path, text.endsWith("\n") ? text : text + "\n");
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

	private async chapterDirOf(storyName: string, key: string): Promise<{ key: string; num: number; title: string; dir: TFolder; parentPath: string; vol?: string } | null> {
		const chapters = await this.listChapters(storyName);
		return chapters.find((c) => c.key === key) ?? null;
	}

	private bookTitle(storyName: string, state: StoryState | null): string {
		return (state?.title || "").trim() || storyName;
	}

	/** 加载运行态并校验激活卷/章节（对齐 Python finalize_load：卷不存在清空、章不存在回退最后一章） */
	async validatedState(storyName: string): Promise<StoryState> {
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const vols = await this.loadVolumes(storyName);
		if (!state.use_volumes || (state.current_volume && !vols[state.current_volume])) delete state.current_volume; // v0.0.16+：无卷模式永不保留激活卷指针
		const chapters = await this.listChapters(storyName);
		if (state.current_chapter != null && !chapters.some((c) => c.key === state.current_chapter)) {
			state.current_chapter = chapters.length ? chapters[chapters.length - 1].key : null; // 阅读序末章
		}
		const meta = state.current_chapter != null ? state.chapters[state.current_chapter] : undefined;
		if (state.use_volumes && meta?.volume && vols[meta.volume] && !state.current_volume) state.current_volume = meta.volume;
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
		return this.app.fileManager.trashFile(f).then(() => true);
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
		if (!((await this.loadState(storyName))?.use_volumes)) throw new Error(NO_VOL_MODE_MSG); // v0.0.16+ 无卷模式禁止建卷
		const vols = await this.loadVolumes(storyName);
		for (const v of Object.values(vols)) if (v.name === n) throw new Error(`已有同名卷：${n}（卷实体目录以卷名命名，须唯一）`);
		let id = String(volumeId).trim();
		if (!id) {
			let maxN = 0;
			for (const key of Object.keys(vols)) {
				const m = /^vol_(\d+)$/.exec(key);
				if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
			}
			id = `vol_${maxN + 1}`;
		} else if (id.includes(":")) {
			throw new Error(`卷 ID 不能含冒号「:」：${id}（复合章节键以「卷ID:章号」为格式，冒号为分隔符）`);
		} else if (vols[id]) {
			throw new Error(`卷 ID 已存在：${id}`);
		}
		const order = Object.values(vols).reduce((mx, v) => Math.max(mx, v.order), 0) + 1;
		const vol: doc.VolumeInfo = { id, name: n, description: description.trim(), order };
		vols[id] = vol;
		await this.saveVolumes(storyName, vols);
		await this.ensureVolumeFolder(storyName, vol); // 同步建卷实体目录；失败直接抛出由调用方提示
		return vol;
	}

	async updateVolume(storyName: string, key: string, patch: Partial<Pick<doc.VolumeInfo, "name" | "description">>): Promise<doc.VolumeInfo | null> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, key);
		if (!vol) return null;
		const oldName = vol.name;
		let newName = oldName;
		if (patch.name !== undefined && patch.name.trim()) {
			newName = patch.name.trim();
			for (const v of Object.values(vols)) if (v.id !== vol.id && v.name === newName) throw new Error(`已有同名卷：${newName}`);
		}
		if (patch.description !== undefined) vol.description = String(patch.description).trim();
		vol.name = newName;
		await this.saveVolumes(storyName, vols);
		// 卷实体目录随卷名走：改名后同步移动目录（失败则回滚元数据并报错）
		const base = this.storyPath(storyName);
		const oldDir = `${base}/${this.volumeFolderName({ ...vol, name: oldName })}`;
		const newDir = `${base}/${this.volumeFolderName(vol)}`;
		if (oldDir !== newDir && (await this.vault.adapter.exists(oldDir))) {
			try {
				const f = this.vault.getAbstractFileByPath(oldDir);
				if (!(f instanceof TFolder)) throw new Error("卷实体目录对象缺失");
				await this.vault.rename(f, newDir);
				await this.settleTree([{ path: oldDir, expect: false }, { path: newDir, expect: true }]);
			} catch (e) {
				vol.name = oldName;
				await this.saveVolumes(storyName, vols); // 回滚，保持元数据与磁盘一致
				throw e instanceof Error ? e : new Error(String(e));
			}
		}
		return vol;
	}

	/**
	 * v0.0.15 核心迁移助手：把一章在容器间移动（书根↔卷实体目录），保持「位置即归属」。
	 * 目标容器已有同号章时自动取该容器最大号+1 改名落位（复合键随之重映射：state.chapters / current_chapter / 伏笔.md 精确匹配项）。
	 * 不重写跨文档的裸「第N章」引用——同容器内引用语义不变，跨卷显式引用（如「第二卷·第5章」）不受影响。
	 */
	private async relocateChapterContainer(
		storyName: string,
		srcKey: string,
		destVolId: string | null
	): Promise<{ oldKey: string; newKey: string; num: number }> {
		const ch = await this.chapterDirOf(storyName, srcKey);
		if (!ch) throw new Error(`章节不存在：${srcKey}`);
		const base = this.storyPath(storyName);
		let destBase = base;
		if (destVolId) {
			const vols = await this.loadVolumes(storyName);
			const vol = vols[destVolId];
			if (!vol) throw new Error(`未找到卷：${destVolId}`);
			destBase = `${base}/${this.volumeFolderName(vol)}`;
			await this.ensureVolumeFolder(storyName, vol);
		}
		let num = ch.num;
		let targetPath = `${destBase}/第${String(num).padStart(2, "0")}章-${safeFilename(ch.title || `第${num}章`)}`;
		if (targetPath === ch.dir.path) return { oldKey: srcKey, newKey: srcKey, num }; // 已就位（含目标容器相同且同号）
		if (await this.vault.adapter.exists(targetPath)) {
			// 冲突：自动取目标容器最大号+1
			const inDest = (await this.listChapters(storyName)).filter((c) => (c.vol ?? null) === destVolId && c.key !== srcKey);
			num = inDest.reduce((mx, c) => Math.max(mx, c.num), 0) + 1;
			targetPath = `${destBase}/第${String(num).padStart(2, "0")}章-${safeFilename(ch.title || `第${num}章`)}`;
			if (await this.vault.adapter.exists(targetPath)) throw new Error(`目标位置仍有同名章节目录，无法迁移：${targetPath}`);
		}
		await this.vault.rename(ch.dir, targetPath);
		await this.settleTree([{ path: ch.dir.path, expect: false }, { path: targetPath, expect: true }]);
		const newKey = chKey(destVolId, num);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const meta = state.chapters[srcKey] ? { ...state.chapters[srcKey], volume: destVolId || undefined } : { title: ch.title, words: 0 };
		state.chapters[newKey] = meta;
		delete state.chapters[srcKey];
		if (state.current_chapter === srcKey) state.current_chapter = newKey;
		await this.saveState(storyName, state);
		try {
			const items = await this.loadForeshadows(storyName);
			let changed = false;
			for (const item of items) if (item.chapter === srcKey) { item.chapter = newKey; changed = true; } // 精确匹配重映射；跨卷显式引用不碰
			if (changed) await this.saveForeshadowsFile(storyName, items);
		} catch (e) { console.warn(`[ArticleWriter] 迁移 ${srcKey}→${newKey} 时伏笔重映射失败：`, e); }
		await this.writeChapterInfoField(storyName, newKey, "卷", destVolId ?? ""); // 《章节信息》与位置保持同源，/scan 无需再回填
		return { oldKey: srcKey, newKey, num };
	}

	/** 删除卷并解绑其下章节（删卷≠删章）：各章经 relocateChapterContainer 移回书根（同号冲突自动改号），再移除空目录与元数据 */
	async deleteVolume(storyName: string, key: string): Promise<{ deleted: boolean; movedKeys: string[] }> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, key);
		if (!vol) return { deleted: false, movedKeys: [] };
		const movedKeys: string[] = [];
		try {
			for (const ch of (await this.listChapters(storyName)).filter((c) => c.vol === vol.id)) {
				const r = await this.relocateChapterContainer(storyName, ch.key, null); // 位置即归属：物理回移+键重映射一次完成
				movedKeys.push(r.newKey);
			}
			const volDir = `${this.storyPath(storyName)}/${this.volumeFolderName(vol)}`;
			try { await this.vault.adapter.rmdir(volDir, false); } catch { /* 非空残留保留原地，提示用户手动清理即可 */ }
		} catch (e) { console.warn(`[ArticleWriter] 删除卷 ${vol.id} 时章节回移失败（已解绑的章保持原位）：`, e); }
		delete vols[vol.id];
		await this.saveVolumes(storyName, vols);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const liveKeys = new Set((await this.listChapters(storyName)).map((c) => c.key));
		for (const k of Object.keys(state.chapters)) {
			if (!liveKeys.has(k) && (state.chapters[k].volume || "") === vol.id) delete state.chapters[k]; // 仅清目录已缺失的悬空条目；存活章已由 relocate 重映射键并解绑
		}
		if (state.current_volume === vol.id) delete state.current_volume;
		await this.saveState(storyName, state);
		return { deleted: true, movedKeys };
	}

	/** 级联删除卷：其归属章节目录整体移入 Obsidian 回收站（删卷即删章，区别于 deleteVolume 的「解绑回移」），元数据一次清理。供写字台面板「删除本卷」右键项使用 */
	async deleteVolumeCascade(storyName: string, key: string): Promise<{ volId: string; name: string; chaptersDeleted: number[] }> {
		await this.quarantineHollowChapters(storyName); // 先隔离空心残留，防止把残骸当作存活章节误删/漏删
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, key);
		if (!vol) throw new Error(`未找到卷：${key}`);
		const state0 = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const keys = Object.keys(state0.chapters).filter((k) => (state0.chapters[k].volume || "") === vol.id);
		for (const k of [...keys]) {
			const ch = await this.chapterDirOf(storyName, k);
			if (!ch) continue; // 目录缺失（索引陈旧等）→ 仅清元数据
			await this.app.fileManager.trashFile(ch.dir);
			if (!(await this.settleTree([{ path: ch.dir.path, expect: false }]))) {
				throw new Error("回收站操作未生效（章节目录仍可见），已中止以防后续扫描把它当作存活章节再迁移出重复目录");
			}
		}
		if (keys.length) {
			const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
			for (const k of keys) delete state.chapters[k];
			if (state.current_chapter != null && !state.chapters[state.current_chapter]) {
				state.current_chapter = null; // 整卷删除后不自动越界切到别的容器，由用户显式选择
			}
			if (state.current_scene) delete state.current_scene; // 场景随章节目录一并删除，清理悬空引用
			await this.recomputeTotalWords(storyName, state);
			await this.saveState(storyName, state);
		}
		delete vols[vol.id];
		await this.saveVolumes(storyName, vols);
		try {
			const volDir = `${this.storyPath(storyName)}/${this.volumeFolderName(vol)}`;
			await this.vault.adapter.rmdir(volDir, false); // 非空残留（杂散文件）保留原地，提示用户手动清理即可
		} catch { /* 目录不存在或不可清空 → 忽略 */ }
		const state2 = await this.loadState(storyName);
		if (state2 && state2.current_volume === vol.id) {
			delete state2.current_volume;
			await this.saveState(storyName, state2);
		}
		return { volId: vol.id, name: vol.name, chaptersDeleted: keys.map((k) => parseChKey(k).num) };
	}

	/** 激活卷并自动切换到该卷最后一章（对齐 /volume use；v0.0.15 起「最后」=本卷本地最大号） */
	async activateVolume(storyName: string, key: string): Promise<{ num: number | null; path: string | null; chapterKey: string | null }> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, key);
		if (!vol) throw new Error(`未找到卷：${key}`);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		state.current_volume = vol.id;
		let targetNum = -1;
		for (const [k, meta] of Object.entries(state.chapters)) {
			if ((meta.volume || "") === vol.id && parseChKey(k).num > targetNum) targetNum = parseChKey(k).num;
		}
		try {
			for (const c of await this.listChapters(storyName)) if ((c.vol ?? "") === vol.id && c.num > targetNum) targetNum = c.num; // 磁盘为准：状态文档滞后（新章未入册）时也跳到真正的末章
		} catch { /* 扫描失败退回仅按状态文档 */ }
		const targetKey = targetNum >= 0 ? chKey(vol.id, targetNum) : null;
		if (targetKey != null) {
			await this.ensureChapterEntry(storyName, state, targetKey);
			state.current_chapter = targetKey;
		}
		await this.saveState(storyName, state);
		const ch = targetKey == null ? null : await this.chapterDirOf(storyName, targetKey);
		return { num: targetNum >= 0 ? targetNum : null, path: ch ? `${ch.dir.path}/章节.md` : null, chapterKey: targetKey };
	}

	private async writeChapterInfoField(
		storyName: string,
		key: string,
		field: "卷" | "标签" | "备注",
		value: string
	): Promise<void> {
		const ch = await this.chapterDirOf(storyName, key);
		if (!ch) return;
		const num = parseChKey(key).num; // 《章节信息》内容仍用本地章号（容器内语义）
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

	/** 把某章归入指定卷：物理迁移 + 键重映射 + 元数据/伏笔/《章节信息》一次完成；目标同号冲突自动改号 */
	async setChapterVolume(storyName: string, srcKey: string, volumeKey: string): Promise<string> {
		if (!((await this.loadState(storyName))?.use_volumes)) throw new Error(NO_VOL_MODE_MSG); // v0.0.16+ 无卷模式禁止归卷
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, volumeKey);
		if (!vol) throw new Error(`未找到卷：${volumeKey}`);
		try {
			await this.relocateChapterContainer(storyName, srcKey, vol.id); // 失败不吞错，可重跑「按卷整理目录」修复
		} catch (e) {
			throw e instanceof Error ? new Error(`${e.message}（可稍后重跑「按卷整理目录」修复）`) : new Error(String(e));
		}
		return vol.id;
	}

	/** 取消归属：章节目录移回书根（同号冲突自动改号），元数据与《章节信息》同步清空 */
	async unassignChapterVolume(storyName: string, srcKey: string): Promise<void> {
		try {
			await this.relocateChapterContainer(storyName, srcKey, null);
		} catch (e) { console.warn(`[ArticleWriter] 取消归属 ${srcKey} 时章节目录移回书根失败：`, e); }
	}

	// ---------- 按卷整理目录（平面结构升级 / 布局修复）----------

	/**
	 * 检测「平面结构」残留：章节已归卷（《章节信息》或状态文档有有效卷 ID）但目录仍留在书根。
	 * 返回需要移动的复合键列表；空数组＝已是按卷目录结构（未归属章留书根属正常）。
	 */
	async needsVolumeOrganize(storyName: string): Promise<string[]> {
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		if (!Object.keys(vols).length) return [];
		const state = await this.loadState(storyName);
		const base = this.storyPath(storyName);
		const out: string[] = [];
		for (const ch of await this.listChapters(storyName)) {
			if (ch.vol || ch.parentPath !== base) continue; // 已在卷实体目录内 → 非平面残留
			let assigned = "";
			try {
				assigned = doc.parseChapterInfo(await this.readDoc(`${ch.dir.path}/章节信息.md`)).volume || "";
			} catch { /* 读不到信息文件则看状态镜像 */ }
			if (!assigned && state?.chapters[ch.key]?.volume) assigned = String(state.chapters[ch.key].volume);
			if (assigned && this.findVolumeIn(vols, assigned)) out.push(ch.key);
		}
		return out.sort((a, b) => a.localeCompare(b));
	}

	/**
	 * 按卷整理（幂等的迁移/修复命令）：把「归属与位置不一致」的章节目录移到其归属容器 <书>/<卷名>/，同号冲突自动改号。
	 * 位于未知容器内的章节只报告不移动；卷名冲突（净化后同名）直接报错要求先改名。返回汇总。
	 */
	async organizeByVolumes(
		storyName: string
	): Promise<{ movedKeys: string[]; unassignedAtRoot: number; unknownContainers: Array<{ folder: string; keys: string[] }> }> {
		if (!((await this.loadState(storyName))?.use_volumes)) return { movedKeys: [], unassignedAtRoot: 0, unknownContainers: [] }; // v0.0.16+：无卷模式不做按卷整理（保持扁平）
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		const base = this.storyPath(storyName);
		// 卷名 → 实体目录名须一一对应，否则无法确定落点
		const usedNames = new Map<string, string[]>();
		for (const v of Object.values(vols)) {
			const n = this.volumeFolderName(v);
			usedNames.set(n, [...(usedNames.get(n) ?? []), v.id]);
		}
		const conflicts = [...usedNames.entries()].filter(([, ids]) => ids.length > 1).map(([n, ids]) => `${n}（${ids.join("、")}）`);
		if (conflicts.length) throw new Error(`卷名冲突，无法确定实体目录：${conflicts.join("；")}。请先用「管理卷」改名后再整理`);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const movedKeys: string[] = [];
		let unassignedAtRoot = 0;
		const unknownContainers: Array<{ folder: string; keys: string[] }> = [];
		for (const ch of await this.listChapters(storyName)) {
			const atRoot = ch.parentPath === base;
			let assigned = "";
			try {
				assigned = doc.parseChapterInfo(await this.readDoc(`${ch.dir.path}/章节信息.md`)).volume || "";
			} catch { /* 同上 */ }
			if (!assigned && state.chapters[ch.key]?.volume) assigned = String(state.chapters[ch.key].volume);
			const vol = assigned ? this.findVolumeIn(vols, assigned) : null;
			if (atRoot && !vol) {
				unassignedAtRoot++; // 未归属章留书根＝新布局的正常形态
				continue;
			}
			if (!atRoot && !ch.vol) {
				// 位于未知容器（非任何卷的实体目录）：只报告，不擅自移动
				const entry = unknownContainers.find((u) => u.folder === ch.parentPath);
				if (entry) entry.keys.push(ch.key);
				else unknownContainers.push({ folder: ch.parentPath, keys: [ch.key] });
				continue;
			}
			if (!vol) continue; // 已在某卷目录内但无有效归属 → /scan 会按位置回填字段，此处不动
			if ((ch.vol ?? null) === vol.id) continue; // 已就位且归属一致
			const r = await this.relocateChapterContainer(storyName, ch.key, vol.id); // 跨卷/平面残留统一走迁移助手（冲突自动改号+键重映射）
			movedKeys.push(r.newKey);
		}
		return { movedKeys, unassignedAtRoot, unknownContainers };
	}

	/**
	 * v0.0.16+：把该书所有卷实体目录内的章节整体拍平回书根（无卷模式落地的破坏性迁移）。
	 * 复用 relocateChapterContainer 逐章回移（同号冲突自动改号、复合键/伏笔/《章节信息》一次重映射），
	 * 顺序=listChapters 的全局阅读序（书根在前、各卷按 order 依次、组内本地号升序），保证结果确定可复现。
	 * 幂等可续跑：已回移到书根的章变为根域键，下次过滤 vol!=null 后不再处理；中断后可重跑 /volume off 补齐。
	 */
	async flattenToRoot(storyName: string): Promise<{ movedKeys: string[]; deletedVolumes: number }> {
		const vols = await this.loadVolumes(storyName);
		if (!Object.keys(vols).length) return { movedKeys: [], deletedVolumes: 0 }; // 本就无卷 → 无需迁移
		const base = this.storyPath(storyName);
		const ordered = (await this.listChapters(storyName)).filter((c) => c.vol != null); // listChapters 已按全局阅读序排好
		const movedKeys: string[] = [];
		for (const ch of ordered) {
			const r = await this.relocateChapterContainer(storyName, ch.key, null); // 位置即归属：物理回移+键重映射一次完成
			movedKeys.push(r.newKey);
		}
		// 清空各卷实体目录（连同其残留的卷级设定四件套）进回收站，再移除 卷.md 元数据
		let deletedVolumes = 0;
		for (const v of Object.values(vols)) {
			const volDir = `${base}/${this.volumeFolderName(v)}`;
			const f = this.vault.getAbstractFileByPath(volDir);
			if (f instanceof TFolder) { try { await this.app.fileManager.trashFile(f); } catch { /* 残留原地保留 */ } }
			deletedVolumes++;
		}
		await this.saveVolumes(storyName, {}); // 空 → removeDocIfExists(卷.md)
		// 收尾运行态：清激活卷指针 + 剥离根域章节上可能残留的过期 volume 字段
		const st = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		delete st.current_volume;
		for (const k of Object.keys(st.chapters)) if (!parseChKey(k).vol && st.chapters[k].volume) delete st.chapters[k].volume;
		await this.saveState(storyName, st);
		return { movedKeys, deletedVolumes };
	}

	/**
	 * v0.0.16+：切换该书工作模式。enabled=false=无卷（若仍有卷则先拍平迁移，破坏性、由调用方二次确认）；
	 * enabled=true=有卷（仅置位，书仍保持扁平直到用户 /volume add）。恒显式写回 use_volumes 使行为确定。
	 */
	async setVolumeMode(storyName: string, enabled: boolean): Promise<{ flattened: boolean; movedKeys: string[]; deletedVolumes: number }> {
		let result = { flattened: false, movedKeys: [] as string[], deletedVolumes: 0 };
		if (!enabled) {
			const vols = await this.loadVolumes(storyName);
			if (Object.keys(vols).length) {
				const r = await this.flattenToRoot(storyName); // 破坏性迁移在此执行
				result.flattened = true;
				result.movedKeys = r.movedKeys;
				result.deletedVolumes = r.deletedVolumes;
			}
		}
		const st = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		st.use_volumes = enabled;
		delete st.current_volume; // 切换模式后清掉任何激活卷指针
		await this.saveState(storyName, st);
		return result;
	}

	// ---------- 场景（章节级 + 根目录全局未归属）----------
	// v0.0.15：章号按容器独立编号 → 「哪一章」须由 (本地章号, 卷) 共同定位；
	// SceneDoc.vol 为运行态标签（加载时打标、formatScenes 不写盘），落盘位置本身即归属。

	private async sceneFilePath(storyName: string, chapNum: number, vol?: string | null): Promise<string> {
		if (chapNum > 0) {
			const ch = await this.chapterDirOf(storyName, chKey(vol ?? null, chapNum));
			if (!ch) throw new Error(`章节不存在：${chKey(vol ?? null, chapNum)}（无法定位其《场景》文件）`);
			return `${ch.dir.path}/场景.md`;
		}
		return `${this.storyPath(storyName)}/场景.md`;
	}

	private async saveScenesFile(
		storyName: string,
		chapNum: number,
		scenes: Record<string, doc.SceneDoc>,
		vol?: string | null
	): Promise<void> {
		let heading = "";
		if (chapNum > 0) {
			const ch = await this.chapterDirOf(storyName, chKey(vol ?? null, chapNum));
			heading = ch ? `第${chapNum}章 ${ch.title}` : `第${chapNum}章`; // 容器内本地语义，不写卷名
		} else {
			const state = await this.loadState(storyName);
			heading = this.bookTitle(storyName, state);
		}
		await this.writeDoc(await this.sceneFilePath(storyName, chapNum, vol), doc.formatScenes(heading, scenes));
	}

	async loadAllScenes(storyName: string): Promise<Record<string, doc.SceneDoc>> {
		const result: Record<string, doc.SceneDoc> = {};
		const base = this.storyPath(storyName);
		Object.assign(result, doc.parseScenes(await this.readDoc(`${base}/场景.md`), 0));
		for (const [volId, vol] of Object.entries(await this.loadVolumes(storyName))) { // v0.0.15：卷级设定四件套并入（章节级同名条目优先级更高）
			const parsed = doc.parseScenes(await this.readDoc(`${base}/${this.volumeFolderName(vol)}/场景.md`), 0);
			for (const s of Object.values(parsed)) s.vol = volId;
			Object.assign(result, parsed);
		}
		for (const ch of await this.listChapters(storyName)) {
			const parsed = doc.parseScenes(await this.readDoc(`${ch.dir.path}/场景.md`), ch.num);
			if (ch.vol) for (const s of Object.values(parsed)) s.vol = ch.vol; // 运行态卷归属标签（不落盘）
			Object.assign(result, parsed);
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
		const vol = chapNum > 0 ? input.vol?.trim() || undefined : undefined; // 全局未归属章不记卷
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
		if (vol) scene.vol = vol;
		const path = await this.sceneFilePath(storyName, chapNum, vol); // 顺带校验目标章节存在
		const local = doc.parseScenes(await this.readDoc(path), chapNum);
		local[id] = scene;
		await this.saveScenesFile(storyName, chapNum, local, vol);
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
		// 字段更新先应用，保证「移动+修改」复合请求不丢改动（对齐旧版顺序）
		if (patch.description !== undefined) scene.description = String(patch.description).trim();
		if (patch.characters !== undefined) {
			scene.characters = [...new Set((patch.characters ?? []).map((c) => c.trim()).filter(Boolean))];
		}
		if (patch.content !== undefined) scene.content = String(patch.content).trim();
		if (patch.notes !== undefined) scene.notes = String(patch.notes).trim();
		// v0.0.15：跨章移动须同时看「本地号」与「卷归属」；patch.vol 约定 undefined=不变、""/null=显式移到书根
		const newVol = patch.vol !== undefined ? (patch.vol || undefined) : scene.vol;
		if (patch.chapter_num !== undefined && patch.chapter_num >= 0 && (patch.chapter_num !== scene.chapter_num || newVol !== scene.vol)) {
			// 跨章节（或跨容器）移动：从原文件移除、写入新文件
			const fromPath = await this.sceneFilePath(storyName, scene.chapter_num, scene.vol);
			const fromLocal = doc.parseScenes(await this.readDoc(fromPath), scene.chapter_num);
			delete fromLocal[scene.scene_id];
			await this.saveScenesFile(storyName, scene.chapter_num, fromLocal, scene.vol);
			scene.chapter_num = Math.floor(patch.chapter_num);
			scene.vol = newVol; // 全局(0)时清标签
			const toPath = await this.sceneFilePath(storyName, scene.chapter_num, scene.vol);
			const toLocal = doc.parseScenes(await this.readDoc(toPath), scene.chapter_num);
			toLocal[scene.scene_id] = scene;
			await this.saveScenesFile(storyName, scene.chapter_num, toLocal, scene.vol);
			return scene;
		}
		const path = await this.sceneFilePath(storyName, scene.chapter_num, scene.vol);
		const local = doc.parseScenes(await this.readDoc(path), scene.chapter_num);
		local[scene.scene_id] = scene;
		await this.saveScenesFile(storyName, scene.chapter_num, local, scene.vol);
		return scene;
	}

	async deleteScene(storyName: string, key: string): Promise<boolean> {
		const all = await this.loadAllScenes(storyName);
		const scene = this.findSceneIn(all, key);
		if (!scene) return false;
		const path = await this.sceneFilePath(storyName, scene.chapter_num, scene.vol);
		const local = doc.parseScenes(await this.readDoc(path), scene.chapter_num);
		delete local[scene.scene_id];
		await this.saveScenesFile(storyName, scene.chapter_num, local, scene.vol);
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
	// v0.0.15：同场景——「哪一章」由 (本地章号, 卷) 共同定位；CharacterDoc.vol 为运行态标签不落盘。

	private async characterFilePath(storyName: string, chapNum: number, vol?: string | null): Promise<string> {
		if (chapNum > 0) {
			const ch = await this.chapterDirOf(storyName, chKey(vol ?? null, chapNum));
			if (!ch) throw new Error(`章节不存在：${chKey(vol ?? null, chapNum)}（无法定位其《人物》文件）`);
			return `${ch.dir.path}/人物.md`;
		}
		return `${this.storyPath(storyName)}/人物.md`;
	}

	private async saveCharactersFile(
		storyName: string,
		chapNum: number,
		characters: Record<string, doc.CharacterDoc>,
		vol?: string | null
	): Promise<void> {
		let heading = "";
		if (chapNum > 0) {
			const ch = await this.chapterDirOf(storyName, chKey(vol ?? null, chapNum));
			heading = ch ? `第${chapNum}章 ${ch.title}` : `第${chapNum}章`; // 容器内本地语义，不写卷名
		} else {
			const state = await this.loadState(storyName);
			heading = this.bookTitle(storyName, state);
		}
		await this.writeDoc(await this.characterFilePath(storyName, chapNum, vol), doc.formatCharacters(heading, characters));
	}

	async loadAllCharacters(storyName: string): Promise<Record<string, doc.CharacterDoc>> {
		const result: Record<string, doc.CharacterDoc> = {};
		const base = this.storyPath(storyName);
		Object.assign(result, doc.parseCharacters(await this.readDoc(`${base}/人物.md`), 0));
		for (const [volId, vol] of Object.entries(await this.loadVolumes(storyName))) { // v0.0.15：卷级设定四件套并入（章节级同名条目优先级更高）
			const parsed = doc.parseCharacters(await this.readDoc(`${base}/${this.volumeFolderName(vol)}/人物.md`), 0);
			for (const c of Object.values(parsed)) c.vol = volId;
			Object.assign(result, parsed);
		}
		for (const ch of await this.listChapters(storyName)) {
			const parsed = doc.parseCharacters(await this.readDoc(`${ch.dir.path}/人物.md`), ch.num);
			if (ch.vol) for (const c of Object.values(parsed)) c.vol = ch.vol; // 运行态卷归属标签（不落盘）
			Object.assign(result, parsed);
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
		const vol = chapNum > 0 ? input.vol?.trim() || undefined : undefined; // 全局未归属章不记卷
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
		if (vol) char.vol = vol;
		const path = await this.characterFilePath(storyName, chapNum, vol); // 顺带校验目标章节存在
		const local = doc.parseCharacters(await this.readDoc(path), chapNum);
		local[name] = char;
		await this.saveCharactersFile(storyName, chapNum, local, vol);
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
		// v0.0.15：跨章移动须同时看「本地号」与「卷归属」；patch.vol 约定 undefined=不变、""/null=显式移到书根（保持旧版语义：移动时不合并其他字段改动）
		const newVol = patch.vol !== undefined ? (patch.vol || undefined) : char.vol;
		if (patch.chapter !== undefined && patch.chapter >= 0 && (patch.chapter !== char.chapter || newVol !== char.vol)) {
			const fromPath = await this.characterFilePath(storyName, char.chapter, char.vol);
			const fromLocal = doc.parseCharacters(await this.readDoc(fromPath), char.chapter);
			delete fromLocal[char.name];
			await this.saveCharactersFile(storyName, char.chapter, fromLocal, char.vol);
			char.chapter = Math.floor(patch.chapter);
			char.vol = newVol; // 全局(0)时清标签
			const toPath = await this.characterFilePath(storyName, char.chapter, char.vol);
			const toLocal = doc.parseCharacters(await this.readDoc(toPath), char.chapter);
			toLocal[char.name] = char;
			await this.saveCharactersFile(storyName, char.chapter, toLocal, char.vol);
		} else {
			if (patch.identity !== undefined) char.identity = String(patch.identity).trim();
			if (patch.age !== undefined) char.age = String(patch.age).trim();
			if (patch.gender !== undefined) char.gender = String(patch.gender).trim();
			if (patch.personality !== undefined) char.personality = String(patch.personality).trim();
			if (patch.appearance !== undefined) char.appearance = String(patch.appearance).trim();
			if (patch.background !== undefined) char.background = String(patch.background).trim();
			if (patch.abilities !== undefined) char.abilities = [...new Set((patch.abilities ?? []).map((a) => a.trim()).filter(Boolean))];
			if (patch.notes !== undefined) char.notes = String(patch.notes).trim();
			const path = await this.characterFilePath(storyName, char.chapter, char.vol);
			const local = doc.parseCharacters(await this.readDoc(path), char.chapter);
			local[char.name] = char;
			await this.saveCharactersFile(storyName, char.chapter, local, char.vol);
		}
		return char;
	}

	/** 删除角色并清理各场景中的引用（对齐 /character delete） */
	async deleteCharacter(storyName: string, key: string): Promise<boolean> {
		const all = await this.loadAllCharacters(storyName);
		const char = this.findCharacterIn(all, key);
		if (!char) return false;
		const path = await this.characterFilePath(storyName, char.chapter, char.vol);
		const local = doc.parseCharacters(await this.readDoc(path), char.chapter);
		delete local[char.name];
		await this.saveCharactersFile(storyName, char.chapter, local, char.vol);
		// 清理场景引用
		for (const [sceneId, scene] of Object.entries(await this.loadAllScenes(storyName))) {
			if (!scene.characters.includes(char.name)) continue;
			scene.characters = scene.characters.filter((c) => c !== char.name);
			const spath = await this.sceneFilePath(storyName, scene.chapter_num, scene.vol);
			const slocal = doc.parseScenes(await this.readDoc(spath), scene.chapter_num);
			slocal[sceneId] = scene;
			await this.saveScenesFile(storyName, scene.chapter_num, slocal, scene.vol);
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

	// ---------- 伏笔（根目录 伏笔.md；v0.0.15 章节号为复合键「N」/「卷id:N」）----------

	/** 卷ID→卷ID、卷名→卷ID 归一表（跨卷引用与标题前缀共用） */
	private async buildVolIndex(storyName: string): Promise<doc.VolumeKeyIndex> {
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		const idx: doc.VolumeKeyIndex = {};
		for (const v of Object.values(vols)) {
			idx[v.id] = v.id;
			if (v.name && v.name !== v.id) idx[v.name] = v.id;
		}
		return idx;
	}

	async loadForeshadows(storyName: string): Promise<doc.ForeshadowItem[]> {
		return doc.parseForeshadows(await this.readDoc(`${this.storyPath(storyName)}/伏笔.md`), await this.buildVolIndex(storyName));
	}

	private async saveForeshadowsFile(storyName: string, items: doc.ForeshadowItem[]): Promise<void> {
		const path = `${this.storyPath(storyName)}/伏笔.md`;
		if (items.length === 0) {
			await this.removeDocIfExists(path);
			return;
		}
		const state = await this.loadState(storyName);
		const volNames: Record<string, string> = {};
		for (const v of Object.values(await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({})))) {
			volNames[v.id] = v.name || v.id; // 卷内标题用卷名展示，缺省退回卷 ID
		}
		await this.writeDoc(path, doc.formatForeshadows(this.bookTitle(storyName, state), items, volNames));
	}

	async addForeshadow(storyName: string, chapterKey: string, character: string, reason: string): Promise<number> {
		const parsed = parseChKey(String(chapterKey ?? "").trim());
		if (!parsed.num) throw new Error(`无效章节键：${chapterKey}`);
		const chap = chKey(parsed.vol, Math.max(1, parsed.num));
		const items = await this.loadForeshadows(storyName);
		items.push({ chapter: chap, character: character.trim(), reason: reason.trim(), done: false });
		await this.saveForeshadowsFile(storyName, items);
		return items.filter((i) => i.chapter === chap).length - 1; // 该章内新序号（保存时重编号）
	}

	/** 按「复合键+序号」标记完成/未完成；不带序号默认 0 */
	async setForeshadowDone(storyName: string, chapterKey: string, index: number, done: boolean): Promise<boolean> {
		const chap = String(chapterKey ?? "").trim();
		const items = await this.loadForeshadows(storyName);
		let pos = -1;
		for (let i = 0; i < items.length; i++) if (items[i].chapter === chap && items[i].index === index) (pos = i);
		if (pos < 0) return false;
		items[pos].done = done;
		await this.saveForeshadowsFile(storyName, items);
		return true;
	}

	async deleteForeshadow(storyName: string, chapterKey: string, index: number): Promise<boolean> {
		const chap = String(chapterKey ?? "").trim();
		const items = await this.loadForeshadows(storyName);
		const pos = items.findIndex((i) => i.chapter === chap && i.index === index);
		if (pos < 0) return false;
		items.splice(pos, 1);
		await this.saveForeshadowsFile(storyName, items);
		return true;
	}

	/**
	 * 从大纲文本提取 [伏]…[/] 标记并保存（对齐 ContextBuilder._save_outline_foreshadows）：
	 * defaultScopeKey=该大纲所属章节的复合键；同一章节已有伏笔则整体替换，否则追加。返回本次写入的条数。
	 */
	async saveOutlineForeshadows(storyName: string, outlineText: string, defaultScopeKey: string): Promise<number> {
		const extracted = doc.extractForeshadows(outlineText, defaultScopeKey, await this.buildVolIndex(storyName));
		if (extracted.length === 0) return 0;
		const items = await this.loadForeshadows(storyName);
		for (const chap of [...new Set(extracted.map((e) => e.chapter))]) {
			const fresh = extracted.filter((e) => e.chapter === chap);
			const kept = items.filter((i) => i.chapter !== chap);
			kept.push(...fresh);
			// 按复合键归组并重新编号（序号=章内位置；排序与 parseForeshadows/loadForeshadows 一致，保证标题分组稳定）
			const normalized: doc.ForeshadowItem[] = [];
			for (const c of [...new Set(kept.map((k) => k.chapter))].sort((x, y) => x.localeCompare(y))) {
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
	 * v0.0.15：入参为复合键；返回 { appended, foreshadows }，重复内容不重复追加。
	 */
	async appendChapterOutline(
		storyName: string,
		chapterKey: string,
		content: string
	): Promise<{ appended: boolean; foreshadows: number }> {
		const text = String(content ?? "").trim();
		if (!text) return { appended: false, foreshadows: 0 };
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) throw new Error(`章节不存在：${chapterKey}`);
		const num = parseChKey(ch.key).num; // 容器内本地章号（标题/模板语义）
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
		const foreshadows = await this.saveOutlineForeshadows(storyName, merged, ch.key);
		return { appended: true, foreshadows };
	}

	async readChapterOutline(storyName: string, chapterKey: string): Promise<string> {
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) return "";
		return (await this.readDoc(`${ch.dir.path}/章节大纲.md`)).replace(/^#+\s.*$/m, "").trim();
	}

	// ---------- 章节删除 / 改名 / 重编号（对齐 chapters.py）----------

	/** 删除章节：移入回收站、清理元数据；当前章回退到同容器最后一章。**被删号之后（同容器内）仍有章节时自动补洞**——复用 renumberChapters 把后续各章整体 -1（两阶段迁移+文档/伏笔引用重写），保持容器内 1..N 连续 */
	async deleteChapter(storyName: string, chapterKey: string): Promise<{ title: string; resequenced: boolean }> {
		await this.quarantineHollowChapters(storyName); // 先隔离空心残留，防止后续自动重排把它们迁移成新幽灵章节
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) throw new Error(`章节不存在：${chapterKey}`);
		await this.app.fileManager.trashFile(ch.dir);
		if (!(await this.settleTree([{ path: ch.dir.path, expect: false }]))) {
			throw new Error("回收站操作未生效（章节目录仍可见），已中止以防重排时把它当作存活章节再迁移出重复目录");
		}
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const removed = state.chapters[chapterKey];
		delete state.chapters[chapterKey];
		if (state.current_chapter === chapterKey) {
			// v0.0.15：回退到同容器最后一章（不跨卷）；该容器清空则置 null
			const scopeVol = parseChKey(ch.key).vol;
			const numsInScope = Object.keys(state.chapters)
				.filter((k) => parseChKey(k).vol === scopeVol)
				.map((k) => parseChKey(k).num);
			state.current_chapter = numsInScope.length ? chKey(scopeVol, Math.max(...numsInScope)) : null;
		}
		if (state.current_scene) delete state.current_scene; // 场景随章节目录一并删除，清理悬空引用
		await this.recomputeTotalWords(storyName, state);
		await this.saveState(storyName, state);
		let resequenced = false;
		// v0.0.15：仅当本容器删后仍留洞才触发压缩（renumberChapters 按容器幂等，已连续则 no-op）
		const scopeNumsAfter = Object.keys(state.chapters)
			.filter((k) => parseChKey(k).vol === parseChKey(ch.key).vol)
			.map((k) => parseChKey(k).num);
		if (scopeNumsAfter.some((n) => n > ch.num)) {
			resequenced = (await this.renumberChapters(storyName)).ok; // ok=false 仅「各容器均连续/无章节」，此处必有洞故预期 true
		} else {
			void this.quarantineHollowChapters(storyName); // 未触发重排时也要清扫删除窗口期可能产生的空心残骸
		}
		return { title: removed?.title || ch.title, resequenced };
	}

	/** 改章节标题：重命名目录并同步各文档中的旧标题（对齐 /chapter rename） */
	async renameChapter(storyName: string, chapterKey: string, rawNewTitle: string): Promise<string> {
		const m = /^第\s*\d+\s*章\s*(.+)$/.exec(String(rawNewTitle ?? "").trim());
		let newTitle = (m ? m[1] : String(rawNewTitle ?? "").trim()).trim();
		if (!newTitle) throw new Error("新标题不能为空");
		newTitle = safeFilename(newTitle);
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) throw new Error(`章节不存在：${chapterKey}`);
		const num = parseChKey(ch.key).num; // 容器内本地章号（目录名语义不变）
		const oldTitle = ch.title;
		if (oldTitle === newTitle) return newTitle;
		const newPath = `${ch.parentPath}/第${String(num).padStart(2, "0")}章-${newTitle}`; // 保留所在容器（书根/卷实体目录）
		await this.vault.rename(ch.dir, newPath);
		const renamed = this.vault.getAbstractFileByPath(newPath); // instanceof 收窄替代断言（本地 dts 返回 TAbstractFile | null）
		if (renamed instanceof TFolder) {
			for (const f of await this.listMarkdownFiles(renamed)) {
				const text = await this.vault.read(f);
				if (text.includes(oldTitle)) {
					await this.vault.modify(f, text.split(oldTitle).join(newTitle));
				}
			}
		}
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const meta = state.chapters[chapterKey] ?? { title: oldTitle, words: 0 };
		meta.title = newTitle;
		state.chapters[chapterKey] = meta;
		await this.saveState(storyName, state);
		return newTitle;
	}

	/**
	 * 等待真实文件系统达到期望状态——用 adapter.exists 直接查磁盘，不走 Obsidian 元数据索引。
	 * 连续快速重命名时索引会滞后：按索引校验会把「实际已完成」的重命名误判为未生效而中途抛错中止，
	 * 留下半套临时目录残留，后续操作再把它们当章节迁移，最终产生大号幽灵章节。超时返回 false。
	 */
	private async settleTree(checks: Array<{ path: string; expect: boolean }>, timeoutMs = 5000): Promise<boolean> {
		const probe = async (): Promise<boolean> => {
			for (const c of checks) if ((await this.vault.adapter.exists(c.path)) !== c.expect) return false;
			return true;
		};
		if (await probe()) return true;
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			await new Promise((r) => window.setTimeout(r, 100));
			if (await probe()) return true;
		}
		return probe();
	}

	/** 按复合键定位章节目录：先走元数据索引（正常路径），索引对刚改名的目录滞后时用真实文件系统目录名兜底（须同时匹配号与容器） */
	private async resolveChapterDir(storyName: string, chapterKey: string): Promise<{ path: string; title: string } | null> {
		const parsed = parseChKey(chapterKey);
		const viaIndex = (await this.listChapters(storyName)).find((c) => c.key === chapterKey);
		if (viaIndex && (await this.vault.adapter.exists(viaIndex.dir.path))) return { path: viaIndex.dir.path, title: viaIndex.title };
		try {
			const want = String(parsed.num).padStart(2, "0"); // 索引滞后兜底：逐容器扫真实文件系统（书根+各卷实体目录）
			const base = this.storyPath(storyName);
			const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
			const volByPath = new Map<string, string>();
			for (const v of Object.values(vols)) volByPath.set(`${base}/${this.volumeFolderName(v)}`, v.id);
			for (const contPath of await this.containerPaths(storyName, vols)) {
				let listed: { folders?: string[] };
				try { listed = await this.vault.adapter.list(contPath); } catch { continue; }
				const name = (listed.folders ?? []).map((p) => p.split("/").pop() as string).find((f) => CHAPTER_DIR_RE.exec(f)?.[1] === want);
				if (!name) continue;
				const contVol = contPath === base ? null : volByPath.get(contPath) ?? null;
				if (contVol !== parsed.vol) continue; // 同号章可能存在于多个卷，只认目标容器的
				return { path: `${contPath}/${name}`, title: CHAPTER_DIR_RE.exec(name)![2] };
			}
		} catch { /* 书目录不存在等——视为未找到 */ }
		return null;
	}

	/**
	 * 按局部映射重写文本中裸「第X章」引用（重编号/插章共用）：仅同容器语义的裸号参与换算；
	 * 跨卷显式写法不识别、不改写——前接「·」（如「第二卷·第5章」）或已知卷名直接结尾（如「章节：<卷名>第5章」「读完第二卷第3章后」）。
	 */
	private renumText(text: string, map: Record<number, number>, volNames: Set<string>): string {
		let out = "";
		let last = 0;
		const qualified = (idx: number): boolean => {
			if (idx > 0 && text[idx - 1] === "·") return true;
			const head = text.slice(Math.max(0, idx - 24), idx);
			for (const name of volNames) if (name && head.endsWith(name)) return true;
			return false;
		};
		const re = /第(\d{1,6})章/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) {
			if (m.index > last) out += text.slice(last, m.index);
			const n = parseInt(m[1], 10);
			out += `第${qualified(m.index) || !(n in map) ? n : map[n]}章`;
			last = m.index + m[0].length;
		}
		return out + text.slice(last);
	}

	/** 某容器（书根/卷实体目录）下全部 md：容器级文档 + 各章节目录内文件——作用域引用重写的扫描范围 */
	private async scopeMarkdownFiles(storyName: string, volId: string | null): Promise<TFile[]> {
		const base = this.storyPath(storyName);
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		const contPath = volId && vols[volId] ? `${base}/${this.volumeFolderName(vols[volId])}` : base;
		const cont = this.vault.getAbstractFileByPath(contPath);
		if (!(cont instanceof TFolder)) return [];
		const files: TFile[] = cont.children.filter((c): c is TFile => c instanceof TFile && /\.(md|markdown)$/i.test(c.name));
		for (const child of cont.children) if (child instanceof TFolder && CHAPTER_DIR_RE.test(child.name)) files.push(...(await this.listMarkdownFiles(child)));
		return files;
	}

	/**
	 * 空心章节目录＝连「章节.md」都没有（中断操作/外部插件干扰留下的损坏残留，通常只剩 .space/context.mdb）。
	 * 迁移类操作前把它们隔离到 <书>/_backup/，防止其参与两阶段迁移、把大号编号一路拖成幽灵章节。返回隔离数量。
	 * 扫描范围含书根与各容器（卷实体目录），残壳可能落在任何一层。
	 */
	private async quarantineHollowChapters(storyName: string): Promise<number> {
		const root = this.storyPath(storyName);
		let n = 0;
		for (const contPath of await this.containerPaths(storyName)) {
			let names: string[] = [];
			try {
				names = ((await this.vault.adapter.list(contPath)).folders ?? [])
					.map((p) => p.split("/").pop() as string)
					.filter((f) => CHAPTER_DIR_RE.test(f)); // 直接扫真实文件系统——listChapters 已隐藏空心目录，这里必须独立枚举才能找到它们
			} catch { continue; }
			for (const name of names) {
				const dirPath = `${contPath}/${name}`;
				try {
					if (!(await this.vault.adapter.exists(dirPath))) continue; // 索引陈旧条目，磁盘上已无此目录
					if (await this.vault.adapter.exists(`${dirPath}/章节.md`)) continue; // 正常章节
					const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
					const bakDir = `${root}/_backup/空心残留_${stamp}`;
					if (!(await this.vault.adapter.exists(bakDir))) await this.createFolderPath(bakDir);
					await this.vault.adapter.rename(dirPath, `${bakDir}/${name}${n ? `_${n}` : ""}`);
					n++;
				} catch (e) {
					console.warn(`[ArticleWriter] 隔离空心章节目录失败 ${dirPath}:`, e);
				}
			}
		}
		return n;
	}

	/** 中断残留可能造成同容器同号双目录（复合键重复）——两阶段迁移遇到会错移，直接拒绝并提示手动清理 */
	private assertUniqueKeys(keys: string[]): void {
		const seen = new Set<string>();
		for (const k of keys) {
			if (seen.has(k)) throw new Error(`检测到重复章节目录：${k}（可能是上次操作中断的残留），请手动清理后重试`);
			seen.add(k);
		}
	}

	private async moveChapterDir(storyName: string, fromKey: string, toNum: number): Promise<void> {
		const src = await this.resolveChapterDir(storyName, fromKey);
		if (!src) throw new Error(`章节目录不存在：${fromKey}`);
		const oldPath = src.path;
		const parentPath = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : this.storyPath(storyName); // 保留所在容器（书根/卷实体目录）
		const newPath = `${parentPath}/第${String(toNum).padStart(2, "0")}章-${safeFilename(src.title || `第${toNum}章`)}`;
		await this.vault.adapter.rename(oldPath, newPath); // 真实文件系统层整树改名（含 .space 等隐藏项），索引经 adapter 事件同步
		if (!(await this.settleTree([{ path: oldPath, expect: false }, { path: newPath, expect: true }]))) {
			throw new Error(`重命名未生效（旧目录仍在或新目录缺失），已中止以防产生重复章节：${oldPath} → ${newPath}`);
		}
		const toKey = chKey(parseChKey(fromKey).vol, toNum); // v0.0.15：重编号只在同容器内发生，卷归属不变
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		if (state.chapters[fromKey]) {
			state.chapters[toKey] = state.chapters[fromKey];
			delete state.chapters[fromKey];
		}
		if (state.current_chapter === fromKey) state.current_chapter = toKey;
		await this.saveState(storyName, state); // 每步落盘，中断可恢复（对齐 Python）
	}

	/**
	 * 重编号：每个容器（书根/各卷实体目录）独立压缩为连续 1..N（两阶段临时迁移；以磁盘为准）。
	 * v0.0.15：执行前把全书 md 备份到 _backup/卷内重排_<时间戳>/（角色改名同款 file-level copy，老书卷内迁移入口）；
	 * 裸「第X章」引用只在受影响容器的文件里按其局部映射重写——跨卷显式写法（「第二卷·第5章」「章节：<卷名>第5章」）不识别、不改写；
	 * 伏笔.md 条目按复合键结构化重映射。
	 */
	async renumberChapters(storyName: string): Promise<{ ok: boolean; msg: string }> {
		const folder = this.storyFolder(storyName);
		if (!folder) return { ok: false, msg: "没有章节" };
		await this.quarantineHollowChapters(storyName); // 先隔离空心残留，防止其参与两阶段迁移
		const chapters = await this.listChapters(storyName);
		if (chapters.length === 0) return { ok: false, msg: "没有章节" };
		this.assertUniqueKeys(chapters.map((c) => c.key)); // 中断残留的重复键会令两阶段迁移错移，直接拒绝

		type ScopeEntry = { volId: string | null; list: Array<(typeof chapters)[number]> };
		const scopes = new Map<string, ScopeEntry>();
		for (const c of chapters) {
			const id = c.vol ?? "";
			if (!scopes.has(id)) scopes.set(id, { volId: c.vol ?? null, list: [] });
			scopes.get(id)!.list.push(c);
		}
		let anyGap = false;
		for (const s of scopes.values()) {
			s.list.sort((a, b) => a.num - b.num);
			for (let i = 0; i < s.list.length; i++) if (s.list[i].num !== i + 1) (anyGap = true);
		}
		if (!anyGap) return { ok: false, msg: "各容器内章节号均已连续（书根与各卷各自 1..N），无需调整" };

		// 执行前全书 md 备份（引用重写出错时可整体恢复）
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
		const storyBase = this.storyPath(storyName);
		const backupDir = `${storyBase}/_backup/卷内重排_${ts}`;
		for (const f of await this.listMarkdownFiles(folder)) {
			await this.writeDoc(`${backupDir}/${f.path.substring(storyBase.length + 1)}`, await this.vault.read(f));
		}

		let movedTotal = 0;
		const scopeMaps = new Map<string | null, Record<number, number>>(); // volId → 局部号映射（仅留洞的容器参与改写）
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		for (const s of [...scopes.values()].sort((a, b) => (a.volId ?? "").localeCompare(b.volId ?? ""))) {
			const nums = s.list.map((c) => c.num);
			const map: Record<number, number> = {};
			s.list.forEach((c, i) => (map[c.num] = i + 1));
			const moving = s.list.filter((c, i) => c.num !== i + 1).map((c) => c.key); // 只移动真正变号的章——减少重命名次数即减少出错面
			if (!moving.length) continue;
			scopeMaps.set(s.volId, map);
			const tmpBase = Math.max(...nums) + nums.length + 1;
			for (let i = 0; i < moving.length; i++) await this.moveChapterDir(storyName, moving[i], tmpBase + i); // 旧 → 临时（每步校验生效）
			for (let i = 0; i < moving.length; i++) {
				await this.moveChapterDir(storyName, chKey(s.volId, tmpBase + i), map[parseChKey(moving[i]).num]); // 临时 → 新号
			}
			movedTotal += moving.length;
		}

		// 引用重写：仅受影响容器内的文件、按该容器局部映射（跨卷显式引用由 renumText 跳过）
		const volNames = new Set<string>();
		for (const v of Object.values(vols)) if (v.name) volNames.add(v.name);
		for (const [volId, map] of scopeMaps) {
			for (const f of await this.scopeMarkdownFiles(storyName, volId)) {
				const text = await this.vault.read(f);
				const next = this.renumText(text, map, volNames);
				if (next !== text) await this.vault.modify(f, next);
			}
		}
		// 伏笔.md 结构化重映射（对齐 _renumber_refs；复合键按容器局部号换算）
		const items = await this.loadForeshadows(storyName);
		let fsChanged = false;
		for (const item of items) {
			const p = parseChKey(item.chapter);
			const map = scopeMaps.get(p.vol);
			if (map && map[p.num]) {
				item.chapter = chKey(p.vol, map[p.num]);
				fsChanged = true;
			}
		}
		if (fsChanged) await this.saveForeshadowsFile(storyName, items);

		const quarantined = await this.quarantineHollowChapters(storyName); // 收尾清扫：外部插件（如 make-md）可能在迁移窗口期往临时目录写 .space 留下残骸，立即隔离出书目录
		return { ok: true, msg: `已按容器压缩为连续章号（共移动 ${movedTotal} 章${quarantined > 0 ? `，另隔离 ${quarantined} 个空心残留至 _backup` : ""}），原文件已备份到 _backup/卷内重排_${ts}/` };
	}

	/**
	 * 在 refKey 之前/之后插入新空章节：继承参照章所在容器的局部空间——该位置被占时，同容器内所有号 ≥ 插入号的章整体 +1（两阶段临时迁移防目录冲突），
	 * 并同步重写该容器文档内「第N章」引用与伏笔.md；插入点为空位（如插到断档处）则直接落位不挪动他人。
	 * createChapterAt 会把 current_chapter 设为新章——插入后自然聚焦到新章。返回新章复合键、本地号与其正文路径。
	 */
	async insertChapter(storyName: string, refKey: string, pos: "before" | "after", title: string): Promise<{ key: string; newNum: number; path: string }> {
		await this.quarantineHollowChapters(storyName); // 先隔离空心残留，防止其参与两阶段迁移
		const chapters = await this.listChapters(storyName);
		this.assertUniqueKeys(chapters.map((c) => c.key));
		const ref = chapters.find((c) => c.key === refKey);
		if (!ref) throw new Error(`章节不存在：${refKey}`);
		const scopeVol = ref.vol ?? null; // 新章继承参照章所在容器（同卷插入）
		const inScope = chapters.filter((c) => (c.vol ?? null) === scopeVol).sort((a, b) => a.num - b.num);
		const nums = inScope.map((c) => c.num);
		const newNum = pos === "before" ? ref.num : ref.num + 1;
		let affectedKeys: string[] = [];
		let path: string;
		if (!nums.includes(newNum)) {
			path = await this.createChapterAt(storyName, newNum, title, scopeVol ?? ""); // 空位直插，无需顺延
		} else {
			affectedKeys = inScope.filter((c) => c.num >= newNum).map((c) => c.key); // 这些章都要 +1
			const tmpBase = Math.max(...nums) + nums.length + 1;
			for (let i = 0; i < affectedKeys.length; i++) await this.moveChapterDir(storyName, affectedKeys[i], tmpBase + i); // 旧 → 临时
			path = await this.createChapterAt(storyName, newNum, title, scopeVol ?? "");
			for (let i = 0; i < affectedKeys.length; i++) await this.moveChapterDir(storyName, chKey(scopeVol, tmpBase + i), parseChKey(affectedKeys[i]).num + 1); // 临时 → 新号（每步落盘可恢复）
		}
		const newKey = chKey(scopeVol, newNum);
		// 引用重写：仅被挪动的章参与映射、且只在该容器文件内执行；新建章自身目录跳过（其文档里的「第N章」是自指，不能改）
		if (affectedKeys.length) {
			const mapping: Record<number, number> = {};
			for (const k of affectedKeys) mapping[parseChKey(k).num] = parseChKey(k).num + 1;
			const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
			const volNames = new Set<string>();
			for (const v of Object.values(vols)) if (v.name) volNames.add(v.name);
			for (const f of await this.scopeMarkdownFiles(storyName, scopeVol)) {
				const dirName = f.path.split("/").slice(-2, -1)[0] ?? "";
				if (CHAPTER_DIR_RE.exec(dirName)?.[1] === String(newNum).padStart(2, "0")) continue; // 新章自指保护
				const text = await this.vault.read(f);
				const next = this.renumText(text, mapping, volNames);
				if (next !== text) await this.vault.modify(f, next);
			}
			const items = await this.loadForeshadows(storyName);
			let fsChanged = false;
			for (const item of items) {
				const p = parseChKey(item.chapter);
				if (p.vol === scopeVol && mapping[p.num]) {
					item.chapter = chKey(scopeVol, mapping[p.num]);
					fsChanged = true;
				}
			}
			if (fsChanged) await this.saveForeshadowsFile(storyName, items);
		}
		void this.quarantineHollowChapters(storyName); // 收尾清扫迁移窗口期可能产生的空心残骸（不阻塞返回）
		return { key: newKey, newNum, path };
	}

	// ---------- 打包导出（/pack）----------

	/**
	 * 解析 /pack 表达式（v0.0.15 语义）并落到具体章节键列表：
	 * 可选首 token = 卷 id/卷名（精确或唯一包含匹配，多命中报错要求写全）；缺省依次取 current_volume、再无则整本。
	 * 范围内数字一律按所选容器的本地号解析；整本 + 显式数字且存在多个容器 → 返回 ambiguous 由调用方 pickAction 选容器后以 forcedVolId 重入。
	 */
	async resolvePackSelection(
		storyName: string,
		spec: string,
		forcedVolId?: string | null
	): Promise<PackResolution> {
		const chapters = await this.listChapters(storyName); // 阅读序：根域在前 + 各卷按《卷.md》order 展开
		if (forcedVolId !== undefined) {
			const pool = chapters.filter((c) => (c.vol ?? null) === forcedVolId);
			const sel = doc.parseChapterSelection(String(spec ?? "").trim() || "all", pool.map((c) => c.num));
			this.assertValidSelection(sel);
			return { volId: forcedVolId ?? null, keys: sel.nums.map((n) => chKey(forcedVolId ?? null, n)) };
		}
		const tokens = String(spec ?? "").trim().split(/\s+/).filter(Boolean);
		let volId: string | null = null;
		let exprTokens: string[] = [];
		if (tokens.length) {
			const t0 = tokens[0];
			const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
			const exact = Object.values(vols).find((v) => v.id === t0 || v.name === t0);
			const partial = exact ? [] : Object.values(vols).filter((v) => v.name.includes(t0));
			if (exact) {
				volId = exact.id;
				exprTokens = tokens.slice(1);
			} else if (partial.length === 1) {
				volId = partial[0].id;
				exprTokens = tokens.slice(1);
			} else if (partial.length > 1) {
				throw new Error(`「${t0}」匹配到多个卷：${partial.map((v) => v.name).join("、")}，请写全卷名`);
			} else {
				exprTokens = tokens; // 无卷 token → 整串都是章节选择表达式
			}
		}
		if (!volId) {
			const state = (await this.loadState(storyName)) ?? null; // 缺省依次取 current_volume
			const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
			if (state?.current_volume && vols[state.current_volume]) volId = state.current_volume;
		}
		if (volId) {
			const pool = chapters.filter((c) => c.vol === volId);
			const sel = doc.parseChapterSelection(exprTokens.join(" ") || "all", pool.map((c) => c.num));
			this.assertValidSelection(sel);
			return { volId, keys: sel.nums.map((n) => chKey(volId, n)) };
		}
		// 整本（无激活卷）
		const expr = exprTokens.join(" ").trim();
		if (!expr || /^(all|全部)$/i.test(expr)) return { volId: null, keys: chapters.map((c) => c.key) };
		if (new Set(chapters.map((c) => c.vol ?? "")).size > 1) return { ambiguous: true, expr } as never; // 多容器下裸号有歧义 → 调用方选容器
		const sel = doc.parseChapterSelection(expr, chapters.map((c) => c.num));
		this.assertValidSelection(sel);
		return { volId: null, keys: sel.nums.map((n) => chKey(null, n)) };
	}

	private assertValidSelection(sel: { nums: number[]; invalid: string[] }): void {
		if (sel.invalid.length) throw new Error(`无法识别的章节选择：${sel.invalid.join("、")}`);
		if (!sel.nums.length) throw new Error("没有可打包的章节");
	}

	async packChapters(
		storyName: string,
		spec: string,
		outputPath = ""
	): Promise<{ path: string; packed: Array<{ num: number; words: number }>; skipped: number[] }> {
		const res = await this.resolvePackSelection(storyName, spec);
		if ("ambiguous" in res) throw new Error("PACK_AMBIGUOUS_CONTAINER"); // 调用方应改用 pickAction 选容器后以 forcedVolId 重入 resolvePackSelection → packByKeys
		return this.packByKeys(storyName, res.keys, outputPath);
	}

	/** 按复合键列表（已定序）装配合辑：/pack 解析完成与导出卷共用的落盘入口 */
	async packByKeys(
		storyName: string,
		keys: string[],
		outputPath = ""
	): Promise<{ path: string; packed: Array<{ num: number; words: number }>; skipped: number[] }> {
		const all = await this.listChapters(storyName);
		const entries = keys.map((k) => all.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
		const built = await this.buildPackParts(entries);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const title = this.bookTitle(storyName, state);
		const first = built.packed[0].num;
		const last = built.packed[built.packed.length - 1].num;
		const fileName = safeFilename(
			built.packed.length > 1 && first !== last ? `${title}-第${first}-${last}章-合集` : `${title}-第${first}章-合集`
		) + ".md";
		return this.writePackFile(this.storyPath(storyName), fileName, outputPath, built);
	}

	/** 导出卷合集：该卷实体目录下全部章节（按位置判归属，与 /scan 口径一致）正文合一 MD；默认文件名 <书名>-<卷名>-合集.md */
	async packVolume(storyName: string, key: string, outputPath = "") {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, key);
		if (!vol) throw new Error(`未找到卷：${key}`);
		const chapters = (await this.listChapters(storyName)).filter((c) => c.vol === vol.id); // listChapters 已按阅读序（卷内本地号升序）
		if (!chapters.length) throw new Error(`卷「${vol.name}」下没有章节，无法导出（可先执行「按卷整理目录」归位）`);
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const fileName = safeFilename(`${this.bookTitle(storyName, state)}-${vol.name}-合集`) + ".md";
		return this.writePackFile(this.storyPath(storyName), fileName, outputPath, await this.buildPackParts(chapters));
	}

	/** /pack 与导出卷共用的合辑装配：逐章读《章节.md》正文（去 H1 标题行）、以分隔线拼接；空正文章节跳过并计入 skipped */
	private async buildPackParts(
		chapters: Array<{ key: string; num: number; title: string; dir: TFolder }>
	): Promise<{ parts: string[]; packed: Array<{ num: number; words: number }>; skipped: number[] }> {
		const bodyRe = /^#\s.*$/m; // 正文标题行
		const parts: string[] = [];
		const packed: Array<{ num: number; words: number }> = [];
		const skipped: number[] = [];
		for (const ch of chapters) {
			const f = this.vault.getAbstractFileByPath(`${ch.dir.path}/章节.md`);
			let text = f instanceof TFile ? await this.vault.read(f) : "";
			text = text.replace(bodyRe, "").trim();
			if (!text) {
				skipped.push(ch.num);
				continue;
			}
			parts.push(`## ${doc.numToCn(ch.num)}章 ${ch.title}\n\n${text}`);
			packed.push({ num: ch.num, words: countPureWords(text) });
		}
		if (!packed.length) throw new Error("所选章节均无正文，未生成文件");
		return { parts, packed, skipped };
	}

	/** 落盘合辑：outputPath 留空=存 baseDir/fileName；带扩展名视为完整文件名、不带则当目录拼 fileName */
	private async writePackFile(
		baseDir: string,
		fileName: string,
		outputPath: string,
		built: { parts: string[]; packed: Array<{ num: number; words: number }>; skipped: number[] }
	): Promise<{ path: string; packed: Array<{ num: number; words: number }>; skipped: number[] }> {
		let target = String(outputPath ?? "").trim();
		if (target) {
			if (!/\.(md|markdown)$/i.test(target)) target = `${target.replace(/\/+$/, "")}/${fileName}`;
		} else {
			target = `${baseDir}/${fileName}`;
		}
		await this.writeDoc(target, built.parts.join("\n\n---\n\n") + "\n");
		return { path: target, packed: built.packed, skipped: built.skipped };
	}

	// ---------- 扫描重建（/scan）----------

	/** 以磁盘为准刷新故事状态.md：补齐缺失模板文档、重算元数据与总字数 */
	async rescanStory(storyName: string): Promise<{ chapters: number; totalWords: number; createdDocs: number; volumeFixed?: number }> {
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
		const vols = await this.loadVolumes(storyName);
		// v0.0.15：既有卷实体目录的卷级设定四件套缺失补建（与建卷时同模板）
		for (const vol of Object.values(vols)) {
			const volDir = `${base}/${this.volumeFolderName(vol)}`;
			for (const [fname, tpl] of [
				["卷大纲.md", VOL_OUTLINE_TEMPLATE(vol.name)],
				["人物.md", VOL_CHARACTERS_TEMPLATE],
				["人物关系.md", VOL_RELATIONSHIPS_TEMPLATE],
				["场景.md", VOL_SCENES_TEMPLATE(vol.name)],
			] as Array<[string, string]>) {
				if ((await this.ensureDoc(`${volDir}/${fname}`, tpl)) === "created") created++;
			}
		}
		const seen = new Set<string>(diskChapters.map((c) => c.key));
		let volumeFixed = 0;
		for (const ch of diskChapters) {
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
			// 归属以目录位置为准（按卷整理后位置即真相）；《章节信息》「卷」字段与位置冲突时就地回填
			let volId = ch.vol ?? (info.volume || undefined);
			if (ch.vol && info.volume && info.volume !== ch.vol) {
				await this.writeChapterInfoField(storyName, ch.key, "卷", ch.vol);
				volumeFixed++;
			}
			state.chapters[ch.key] = {
				title: ch.title,
				words,
				volume: volId, // 标签/备注不再镜像进状态文档（无消费方），仍以《章节信息.md》为准
			};
		}
		for (const key of Object.keys(state.chapters)) {
			if (!seen.has(key)) delete state.chapters[key]; // 磁盘已删除的条目清理（复合键口径）
		}
		await this.recomputeTotalWords(storyName, state);
		if (state.current_volume && !vols[state.current_volume]) delete state.current_volume;
		if (state.current_chapter != null && !seen.has(state.current_chapter)) {
			state.current_chapter = diskChapters.length ? diskChapters[diskChapters.length - 1].key : null;
		}
		await this.saveState(storyName, state);
		return { chapters: diskChapters.length, totalWords: state.total_words, createdDocs: created, ...(volumeFixed ? { volumeFixed } : {}) };
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

	async readChapterOutlineForPrompt(storyName: string, chapterKey: string): Promise<string> {
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) return "";
		const raw = await this.readDoc(`${ch.dir.path}/章节大纲.md`);
		let lines = doc.stripComments(raw.trim()).trim().split("\n");
		while (lines.length && /^#\s*第\s*\d+\s*章.*大纲\s*$/.test(lines[0])) lines.shift();
		return lines.join("\n").trim();
	}

	/** 读正文：剥离 AI 用语标红标签 + 去 "# " 标题行（对齐 _read_std_chapter_dir，摘要哈希基于此文本） */
	async readChapterContent(storyName: string, chapterKey: string): Promise<string> {
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) return "";
		return doc.stripTitleLine(stripAiWordMarks(await this.readDoc(`${ch.dir.path}/章节.md`)))[0];
	}

	/** 读某章已保存的 AI 摘要；缺失/无哈希/内容已变化时返回空串（不自动生成，调用方回退原文预览） */
	private async readFreshSummary(storyName: string, chapterKey: string, content: string): Promise<string> {
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch || !content.trim()) return "";
		const raw = await this.readDoc(`${ch.dir.path}/章节摘要.md`);
		if (!raw.trim()) return "";
		const m = /<!--\s*内容哈希[:：]\s*([0-9a-f]{32})\s*-->/.exec(raw);
		if (!m || m[1] !== md5(content)) return "";
		return doc.stripTitleLine(doc.stripComments(raw))[0];
	}

	/** 读某章新鲜 AI 摘要（自取正文比对哈希；供卷摘要增量更新用），缺失/过期返回空串 */
	async getChapterSummaryText(storyName: string, chapterKey: string): Promise<string> {
		const content = await this.readChapterContent(storyName, chapterKey);
		return (await this.readFreshSummary(storyName, chapterKey, content)).trim();
	}

	// ---------- v0.0.15+ 卷摘要（<volDir>/卷摘要.md，插件特有、CLI 无对应概念）----------
	// 格式对齐《章节摘要.md》：H1 标题 + <!-- 内容哈希 --> 校验头。哈希 = 本卷各成员章「key|md5(正文)」拼接的 md5——
	// 任一成员正文变化即视为过期，由 main.ts refreshVolumeSummary 在写盘命令后增量重算（LLM）。

	/** 本卷内容指纹：全部有正文的成员章按阅读序拼 key|md5(正文) 再取 md5 */
	private async computeVolumeHash(storyName: string, volId: string): Promise<string> {
		const parts: string[] = [];
		for (const c of await this.listChapters(storyName)) {
			if (parseChKey(c.key).vol !== volId) continue;
			const body = await this.readChapterContent(storyName, c.key);
			if (!body.trim()) continue;
			parts.push(`${c.key}|${md5(body)}`);
		}
		return md5(parts.join("\n"));
	}

	/** 读新鲜卷摘要；文件缺失/哈希不匹配（任一本卷章节正文已变）时返回空串 */
	async readFreshVolumeSummary(storyName: string, volId: string): Promise<string> {
		try {
			const vols = await this.loadVolumes(storyName);
			const vol = vols[volId];
			if (!vol) return "";
			const raw = await this.readDoc(`${this.storyPath(storyName)}/${this.volumeFolderName(vol)}/卷摘要.md`);
			if (!raw.trim()) return "";
			const m = /<!--\s*内容哈希[:：]\s*([0-9a-f]{32})\s*-->/.exec(raw);
			if (!m || m[1] !== (await this.computeVolumeHash(storyName, volId))) return "";
			return doc.stripTitleLine(doc.stripComments(raw))[0].trim();
		} catch {
			return ""; // 读取失败按无摘要处理，不阻断写作上下文组装
		}
	}

	/** 保存卷摘要并写入当前内容哈希头 */
	async saveVolumeSummary(storyName: string, volId: string, summary: string): Promise<void> {
		const vols = await this.loadVolumes(storyName);
		const vol = vols[volId];
		if (!vol) throw new Error(`卷不存在：${volId}`);
		const hash = await this.computeVolumeHash(storyName, volId);
		await this.writeDoc(
			`${this.storyPath(storyName)}/${this.volumeFolderName(vol)}/卷摘要.md`,
			`# ${vol.name || volId} 卷摘要\n\n<!-- 内容哈希：${hash} -->\n\n${summary}\n`
		);
	}

	/**
	 * 组装写作提示词所需的磁盘数据。
	 * v0.0.15：chapterNum=阅读序位置（ordinal，跨卷连续），本地章号仅用于落盘标题与容器内引用；
	 * prevChapters/summaries 按阅读序窗口取（可跨卷延续）。副作用：从全局大纲与本章大纲抽取 [伏]…[/] 标记并持久化到 伏笔.md。
	 * v0.0.15 三层上下文：人物关系分书/卷/章三份返回（去重在 buildWritingContext）、activeVolId/exclude*Names/volSummary 供分层渲染；folderDocs 已剔除《人物关系.md》。
	 */
	async loadWritingData(
		storyName: string,
		chapterKey: string,
		opts?: { includeCurrentSummary?: boolean }
	): Promise<import("./prompts").WritingContextInput & { savedForeshadows: number }> {
		const state = await this.validatedState(storyName);
		const ordered = await this.listChapters(storyName); // 阅读序：书根在前 + 各卷按《卷.md》order、组内本地号升序
		const idx = ordered.findIndex((c) => c.key === chapterKey);
		if (idx < 0) throw new Error(`章节不存在：${chapterKey}`);
		const ch = ordered[idx];
		const ordinal = idx + 1;
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		const volNames: Record<string, string> = {};
		for (const [id, v] of Object.entries(vols)) if (v.name) volNames[id] = v.name;
		const labelOf = (key: string): string => {
			const p = parseChKey(key);
			return p.vol && volNames[p.vol] ? `${volNames[p.vol]}·第${p.num}章` : `第${p.num}章`;
		};

		const globalOutlineRaw = await this.readGlobalOutlineRaw(storyName);
		let savedForeshadows = await this.saveOutlineForeshadows(storyName, globalOutlineRaw, ch.key);

		// v0.0.15 三层上下文：《人物关系.md》不进 folderDocs（改经 chapterRelationships 单独传入参与跨层去重）；
		// 《人物.md》/《场景.md》仍由 folderDocs 原文渲染，其归属条目从结构化列表排除避免重复
		const chCharRaw = await this.readDoc(`${ch.dir.path}/人物.md`);
		const chSceneRaw = await this.readDoc(`${ch.dir.path}/场景.md`);
		const excludeCharNames = Object.keys(doc.parseCharacters(chCharRaw, ch.num));
		const excludeSceneIds = Object.keys(doc.parseScenes(chSceneRaw, ch.num));
		const entries: ChapterFolderDocEntry[] = [
			{ file: "章节大纲.md", text: await this.readDoc(`${ch.dir.path}/章节大纲.md`) },
			{ file: "人物.md", text: chCharRaw },
			{ file: "场景.md", text: chSceneRaw },
			{ file: "章节信息.md", text: await this.readDoc(`${ch.dir.path}/章节信息.md`) },
		];
		const folderDocs = buildChapterFolderDocs(entries, ch.key).docs; // 复合键：本章容器作为 [伏] 标记默认归属
		const chapterOutlineText = await this.readChapterOutlineForPrompt(storyName, ch.key);
		savedForeshadows += await this.saveOutlineForeshadows(storyName, chapterOutlineText, ch.key);

		const prevN = 3; // Python story_state.context_prev_chapters 缺省值（插件状态无此字段）
		const prevChapters: PrevChapterRef[] = [];
		for (let i = Math.max(0, idx - prevN); i < idx; i++) {
			const meta = ordered[i];
			const content = await this.readChapterContent(storyName, meta.key);
			if (!content.trim()) continue;
			prevChapters.push({ key: meta.key, num: i + 1, label: labelOf(meta.key), title: state.chapters[meta.key]?.title || meta.title, content });
		}

		const summaries: Record<number, string> = {};
		if (state.use_summaries !== false && prevN > 0) {
			const end = opts?.includeCurrentSummary ? ordinal : ordinal - 1;
			for (let i = Math.max(1, ordinal - prevN); i <= end; i++) {
				const meta = ordered[i - 1];
				const content = await this.readChapterContent(storyName, meta.key);
				const s = await this.readFreshSummary(storyName, meta.key, content);
				if (s) summaries[i] = s;
			}
		}

		// v0.0.15 三层上下文：人物关系按 书/卷/章 三份清洗文本返回，跨层逐行去重由 buildWritingContext 完成（优先级 章 > 卷 > 书）
		let relationshipsRaw = await this.readDoc(`${this.storyPath(storyName)}/人物关系.md`);
		if (!relationshipsRaw.trim()) relationshipsRaw = await this.readDoc(`${this.storyPath(storyName)}/角色关系.md`);
		const bookRelationships = cleanRelationshipsDoc(relationshipsRaw);
		const chapterRelationships = cleanRelationshipsDoc(await this.readDoc(`${ch.dir.path}/人物关系.md`));
		let volumeName = "";
		let volOutlineText = "";
		let volRelationships = "";
		let volSummary = "";
		if (ch.vol && vols[ch.vol]) {
			volumeName = vols[ch.vol].name || ch.vol;
			const volDir = `${this.storyPath(storyName)}/${this.volumeFolderName(vols[ch.vol])}`;
			volRelationships = cleanRelationshipsDoc(await this.readDoc(`${volDir}/人物关系.md`));
			const lines = doc.stripComments((await this.readDoc(`${volDir}/卷大纲.md`)).trim()).split("\n");
			while (lines.length && /^#\s/.test(lines[0])) lines.shift(); // 去 H1 标题行
			volOutlineText = lines.join("\n").trim();
			if (state.use_summaries !== false) volSummary = await this.readFreshVolumeSummary(storyName, ch.vol);
		}
		const foreshadows = (await this.loadForeshadows(storyName)).filter((f) => !f.done);

		return {
			chapterNum: ordinal,
			localNum: ch.num,
			volumeName,
			volOutlineText,
			chapterRanks: Object.fromEntries(ordered.map((c, i) => [c.key, i + 1] as [string, number])),
			volumeNames: volNames,
			title: (state.title || "").trim() || storyName,
			genre: state.genre,
			writingStyle: state.writing_style,
			currentSceneId: state.current_scene,
			globalOutlineRaw,
			chapterOutlineText,
			characters: Object.values(await this.loadAllCharacters(storyName)),
			activeVolId: ch.vol ?? "",
			excludeCharNames,
			excludeSceneIds,
			bookRelationships,
			volRelationships,
			chapterRelationships,
			volSummary,
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
	async setChapterBody(storyName: string, chapterKey: string, bodyText: string): Promise<number> {
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) throw new Error(`章节不存在：${chapterKey}`);
		const num = parseChKey(chapterKey).num; // 落盘标题用容器内本地号
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const meta = state.chapters[chapterKey] ?? { title: ch.title, words: 0 };
		state.chapters[chapterKey] = meta;
		const heading = (meta.title || "").trim() || ch.title;
		await this.writeDoc(`${ch.dir.path}/章节.md`, `# 第${num}章 ${heading}\n\n${(bodyText || "").replace(/\s+$/, "")}\n`);
		meta.words = countPureWords(bodyText);
		await this.recomputeTotalWords(storyName, state);
		await this.saveState(storyName, state);
		return meta.words;
	}

	/** 全量替换本章大纲正文（对齐 documents.write_chapter_outline：标题行 + rstrip + 标记帮助尾注） */
	async setChapterOutline(storyName: string, chapterKey: string, outlineText: string): Promise<void> {
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) throw new Error(`章节不存在：${chapterKey}`);
		const num = parseChKey(chapterKey).num; // 落盘标题用容器内本地号
		const state = await this.loadState(storyName);
		const heading = ((state?.chapters[chapterKey]?.title || "").trim()) || ch.title;
		const body = (outlineText || "").replace(/\s+$/, "");
		await this.writeDoc(`${ch.dir.path}/章节大纲.md`, appendOutlineMarkerHelp(`# 第${num}章 ${heading} 大纲\n\n${body}\n`));
	}

	/** Reader A（对齐 docs.read_chapter_outline/_strip_title_line）：去注释后仅剥一个 "# " 首行 */
	private async readOutlineText(storyName: string, chapterKey: string): Promise<string> {
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) return "";
		const raw = await this.readDoc(`${ch.dir.path}/章节大纲.md`);
		let lines = doc.stripComments(raw.trim()).trim().split("\n");
		if (lines.length && lines[0].startsWith("# ")) lines.shift();
		return lines.join("\n").trim();
	}

	/** Reader A（对齐 docs.read_chapter_outline/_strip_title_line）；供 prevOutlines/bridge 用。返回复合键→文本 */
	async readChaptersOutlines(storyName: string, keys: string[]): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		for (const key of keys) {
			out[key] = await this.readOutlineText(storyName, key);
		}
		return out;
	}

	/**
	 * v0.0.15 提示词组装用的阅读序大纲窗口：目标章前 back 章 + 后 fwd 章，逐项含 ordinal/key/label/text。
	 * label=容器内展示名（「第N章」或「<卷名>·第N章」），跨卷自然延续；供 prompts.ts 的 prev/bridge 块使用。
	 */
	async readOutlineWindow(storyName: string, chapterKey: string, opts?: { back?: number; fwd?: number }): Promise<Array<{ ordinal: number; key: string; label: string; text: string }>> {
		const back = Math.max(0, opts?.back ?? 3);
		const fwd = Math.max(0, opts?.fwd ?? 0);
		const ordered = await this.listChapters(storyName); // 阅读序
		const idx = ordered.findIndex((c) => c.key === chapterKey);
		if (idx < 0) throw new Error(`章节不存在：${chapterKey}`);
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		const volNames: Record<string, string> = {};
		for (const [id, v] of Object.entries(vols)) if (v.name) volNames[id] = v.name;
		const out: Array<{ ordinal: number; key: string; label: string; text: string }> = [];
		for (let i = Math.max(0, idx - back); i <= Math.min(ordered.length - 1, idx + fwd); i++) {
			const meta = ordered[i];
			out.push({
				ordinal: i + 1,
				key: meta.key,
				label: meta.vol && volNames[meta.vol] ? `${volNames[meta.vol]}·第${meta.num}章` : `第${meta.num}章`,
				text: await this.readOutlineText(storyName, meta.key),
			});
		}
		return out;
	}

	/** 保存审阅报告为章内 审阅笔记.md，返回文件路径 */
	async saveReviewNote(storyName: string, chapterKey: string, report: string): Promise<string> {
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) throw new Error(`章节不存在：${chapterKey}`);
		const num = parseChKey(chapterKey).num; // 落盘标题用容器内本地号
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
	vol?: string; // v0.0.15：chapter_num 的卷容器（本地号按容器独立编号；全局/书根可省）
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
	vol?: string; // v0.0.15：chapter 的卷容器（同 SceneInput.vol）
}

