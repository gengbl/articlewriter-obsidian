import { App, MarkdownView, Platform, TFile, TFolder, Vault } from "obsidian";
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
import type { ChapterMeta, StoryState } from "./state_doc";
import { DEFAULT_TENSION_RULES } from "./tension_rules_default";
import {
	CHAPTER_BODY_TEMPLATE,
	CHAPTER_CHARACTERS_TEMPLATE,
	CHAPTER_INFO_TEMPLATE,
	chapterOutlineTemplate,
	CHAPTER_RELATIONSHIPS_TEMPLATE,
	CHAPTER_SCENES_TEMPLATE,
	FORESHADOW_TEMPLATE,
	NOTES_TEMPLATE,
	PLANNING_GUIDE_TEMPLATE,
	PROLOGUE_TEMPLATE,
	outlineTemplate,
	VOL_CHARACTERS_TEMPLATE,
	VOL_OUTLINE_TEMPLATE,
	VOL_RELATIONSHIPS_TEMPLATE,
	VOL_SCENES_TEMPLATE,
	VOLUME_TEMPLATE,
	WORLD_TEMPLATE,
	appendOutlineMarkerHelp,
	countCharsWithPunct,
	countPureWords,
	md5,
	safeFilename,
	timelineTemplate,
	stripAiWordMarks,
} from "./story_types";

import type { CastLayerDoc, CastLayerRef } from "./cast_analyzer";
import type { PrevChapterRef } from "./prompts";

export const CHAPTER_DIR_RE = /^第(\d{1,6})章-(.+)$/;

/** 引言实体目录名（位于 `书稿/` 下；保留名——卷名不得占用，避免与引言文件夹物理冲突） */
export const PROLOGUE_DIR_NAME = "引言";

/** 案头资料目录名（书级参考资料：十件套 + 用户自建文件；写字台「案头资料」小节展示其内容 ∪ 书根剩余项） */
export const DESK_DOCS_DIR_NAME = "案头资料";

/** 书稿目录名（容纳引言目录、章节目录与卷目录） */
export const MANUSCRIPT_DIR_NAME = "书稿";

/** 卷文档子目录名（卷目录直属，容纳卷文档六件套 + 用户文件） */
export const VOLUME_DOCS_DIR_NAME = "文档";

/** 书根系统管理项（迁移不搬动、不计入「案头资料」；隐藏点文件另行按前缀跳过） */
const ROOT_SYSTEM_NAMES = new Set([STATE_DOC_NAME, LEGACY_STATE_JSON, "AI提示词", "_backup", "卷.md"]);

/** 人物关系面板数据源（v0.1.9+）：一层《人物关系.md》的归属层级、展示标签、实际路径与原文（文件缺失时 text 为空串） */
export interface RelationshipDocSource {
	scope: "book" | "volume" | "chapter";
	label: string; // 展示标签：书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>
	path: string; // vault 相对路径（面板点击据此打开文件）
	text: string;
}

/** 人物关系面板「人物状态」区条目（v0.2.x+）：一条《人物.md》角色设定 + 其归属层级/标签/来源路径（同名角色在多层登记时为多条，不合并） */
export interface CharacterInfoEntry extends doc.CharacterDoc {
	scope: "book" | "volume" | "chapter";
	label: string; // 书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>
	sourcePath: string; // 所在《人物.md》的 vault 相对路径
}

/** 时间线面板数据源（v0.2.x+）：一份《时间线.md》的归属层级、展示标签、实际探测到的路径与原文；文件缺失时 text 为空串。volId 仅有卷模式下归入某卷的章条目携带（供面板嵌套分组） */
export interface TimelineDocSource {
	scope: "book" | "volume" | "chapter";
	label: string; // 书籍级 / 卷 · <卷名> / 章 · 第N章 <标题>
	path: string; // vault 相对路径（面板点击据此打开文件；文档尚不存在时为新格式候选路径）
	text: string;
	volId?: string; // 该章所属卷 ID（仅「有卷模式」下归卷章节携带）
}

/** 章节目录内的标准模板文档「逻辑基名」（代码内部一律用逻辑基名读写，物理名经 chapterDocPhysicalName 解析） */
const CHAPTER_TEMPLATE_BASES = new Set(["章节.md", "章节大纲.md", "人物.md", "人物关系.md", "场景.md", "章节信息.md", "章节摘要.md", "时间线.md"]);

/** 卷目录内的标准模板文档「逻辑基名」 */
const VOLUME_TEMPLATE_BASES = new Set(["卷大纲.md", "人物.md", "人物关系.md", "场景.md", "卷摘要.md", "时间线.md"]);

/** 章节逻辑基名 → 新格式后缀（""=正文，物理名直接用 <章节目录名>.md；其余 = <章节目录名>-<后缀>） */
const CHAPTER_DOC_SUFFIX: Record<string, string> = {
	"章节.md": "",
	"章节大纲.md": "大纲.md",
	"人物.md": "人物.md",
	"人物关系.md": "人物关系.md",
	"场景.md": "场景.md",
	"章节信息.md": "信息.md",
	"章节摘要.md": "摘要.md",
	"时间线.md": "时间线.md",
};
/** 新格式后缀 → 章节逻辑基名（反查，用于识别已有文件） */
const CHAPTER_SUFFIX_TO_BASE: Record<string, string> = {
	"大纲.md": "章节大纲.md",
	"信息.md": "章节信息.md",
	"人物.md": "人物.md",
	"人物关系.md": "人物关系.md",
	"场景.md": "场景.md",
	"摘要.md": "章节摘要.md",
	"时间线.md": "时间线.md",
};
/** 卷逻辑基名 → 新格式后缀（物理名 = <卷目录名>-<后缀>） */
const VOLUME_DOC_SUFFIX: Record<string, string> = {
	"卷大纲.md": "大纲.md",
	"人物.md": "人物.md",
	"人物关系.md": "人物关系.md",
	"场景.md": "场景.md",
	"卷摘要.md": "摘要.md",
	"时间线.md": "时间线.md",
};
/** 新格式后缀 → 卷逻辑基名（反查） */
const VOLUME_SUFFIX_TO_BASE: Record<string, string> = {
	"大纲.md": "卷大纲.md",
	"人物.md": "人物.md",
	"人物关系.md": "人物关系.md",
	"场景.md": "场景.md",
	"摘要.md": "卷摘要.md",
	"时间线.md": "时间线.md",
};

/** 章节内某逻辑基名对应的新格式物理文件名（folder=章节目录名，如 第01章-初见 → 文件前缀取纯数字 01-初见） */
function chapterDocPhysicalName(folder: string, base: string): string {
	const prefix = folder.replace(/^第(\d+)章-/, "$1-"); // 第01章-初见 → 01-初见（仅文件名用数字，目录名不变）
	const suffix = CHAPTER_DOC_SUFFIX[base];
	return suffix === "" ? `${prefix}.md` : `${prefix}-${suffix}`;
}

/** 章节目录名 → 新格式文件前缀（纯数字），如 第01章-初见 → 01-初见 */
function chapterFilePrefix(folder: string): string {
	return folder.replace(/^第(\d+)章-/, "$1-");
}

/** 旧「文件夹名前缀」格式物理名（第01章-初见.md / 第01章-初见-大纲.md），用于向后兼容解析 */
function chapterDocFolderPrefixName(folder: string, base: string): string {
	const suffix = CHAPTER_DOC_SUFFIX[base];
	return suffix === "" ? `${folder}.md` : `${folder}-${suffix}`;
}

/** 卷内某逻辑基名对应的新格式物理文件名（folder=卷目录名，即卷名） */
function volumeDocPhysicalName(folder: string, base: string): string {
	return `${folder}-${VOLUME_DOC_SUFFIX[base]}`;
}

/** 旧格式模板文档迁移项（章/卷 + 一组「旧物理名→新物理名」重命名） */
export interface OldFormatMigrationItem {
	kind: "chapter" | "volume";
	label: string; // 展示用（如「第01章 初见」「卷「风起」」）
	renames: Array<{ from: string; to: string }>;
}

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
	/** v0.1.4+：写作提示词「前文内容」窗口章数 N（data.json settings.prevChapters；缺省/未注入时按 CLI 默认 3）。卷模式下窗口限本卷、跨卷缺口以各前卷《卷摘要》填充 */
	getPrevChapters?: () => number;
	/** v0.4.3+：写作提示词「后续参考」窗口章数 N（data.json settings.nextChapters，缺省 3、0=不注入后章）；本书《故事状态.md》next_chapters 显式设置时优先。当前消费方＝编写文章阶段的大纲节选（前 N／后 N 章） */
	getNextChapters?: () => number;
	/** v0.1.4+：是否把整卷《卷摘要》/跨卷前卷摘要注入写作上下文（data.json settings.includeVolumeSummary，缺省=false 关闭——默认严格只按 prevN 注入单章摘要，与 CLI 语义一致；开启后恢复三层上下文的卷级 digest 行为） */
	includeVolumeSummary?: () => boolean;
	/** v0.1.4+：LLM 生成单章摘要（对齐 CLI _summarize_chapter）——上下文组装时发现缺失/过期摘要即经此延迟生成并落盘；无可用配置或失败返回 null（调用方回退原文预览，不阻断写作）。卷摘要重建前会先对本卷全部成员章确保新鲜摘要 */
	generateChapterSummary?: (input: { storyName: string; chapterKey: string; label: string; sourceText: string; viaOutline: boolean }) => Promise<string | null>;
	/** v0.1.4+：LLM 全量重建某卷《卷摘要》——输入为本卷全部成员章的新鲜 AI 摘要（阅读序），取代旧「最新章节增量合并」滚动法。无可用配置或失败返回 null（该卷按无摘要降级，不阻断写作） */
	generateVolumeSummary?: (input: { storyName: string; volId: string; volumeName: string; chapters: Array<{ key: string; label: string; title: string; summary: string }> }) => Promise<string | null>;
	/** v0.1.4+：摘要 LLM 生成的进度反馈钩子（msg=null 表示本轮结束、隐藏提示）。延迟生成可能串行多次 LLM 调用，期间给用户可见进展 */
	onProgress?: (msg: string | null) => void;
}

/** /pack 表达式解析结果：已定位到具体容器+章节键列表；或整本多容器下裸号有歧义、需调用方让用户选容器后以 forcedVolId 重入 */
export type PackResolution = { volId: string | null; keys: string[] } | { ambiguous: true; expr: string };

/** v0.2.24+ 提示词文件装配改造：loadWritingData 解析出的三层文档路径（调用方按这些路径声明 PromptSpec、经 assemblePromptFiles 装配注入）；vol 组仅当前章在卷内时存在 */
export interface WritingDocPaths {
	book: { world: string; globalOutline: string; bookRelationships: string }; // 案头资料：世界观.md / 大纲.md / 人物关系.md（旧别名已兜底解析）
	vol?: { outline: string; relationships: string }; // 卷级：卷大纲.md / 人物关系.md（resolveVolumeDocPath 已解析 legacy 前缀）
	chapter: { outline: string; characters: string; scenes: string; relationships: string }; // 章级：章节大纲.md / 人物.md / 场景.md / 人物关系.md
}

/** 小说管理器：所有文件/文件夹操作均使用 Obsidian Vault 内置 API */
export class StoryManager {
	private app: App;
	private getStoryRoot: () => string;
	private onStateChanged?: () => void;
	private getPrevChapters?: () => number; // v0.1.4+：前文窗口章数（data.json 可配，缺省 3）
	private getNextChapters?: () => number; // v0.4.3+：后续参考章数（data.json 可配，缺省 3）
	private includeVolumeSummary?: () => boolean; // v0.1.4+：卷级摘要注入开关（默认关）
	private generateChapterSummary?: (input: { storyName: string; chapterKey: string; label: string; sourceText: string; viaOutline: boolean }) => Promise<string | null>;
	private generateVolumeSummary?: (input: { storyName: string; volId: string; volumeName: string; chapters: Array<{ key: string; label: string; title: string; summary: string }> }) => Promise<string | null>;
	private onProgress?: (msg: string | null) => void; // v0.1.4+：摘要生成进度反馈

	constructor(opts: StoryManagerOptions) {
		this.app = opts.app;
		this.getStoryRoot = opts.getStoryRoot;
		this.onStateChanged = opts.onStateChanged;
		this.getPrevChapters = opts.getPrevChapters;
		this.getNextChapters = opts.getNextChapters;
		this.includeVolumeSummary = opts.includeVolumeSummary;
		this.generateChapterSummary = opts.generateChapterSummary;
		this.generateVolumeSummary = opts.generateVolumeSummary;
		this.onProgress = opts.onProgress;
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

	/** 章节目录（未归属章落「书稿/」直属；归卷章在 书稿/<卷>/ 下，见 volumeDirPath） */
	chapterDirPath(storyName: string, num: number, title?: string): string {
		const safe = safeFilename((title || "").trim() || `第${num}章`);
		return `${this.manuscriptPath(storyName)}/第${String(num).padStart(2, "0")}章-${safe}`;
	}

	/** 书稿目录（引言/章节/卷的物理容器；平铺与有卷模式共用） */
	manuscriptPath(storyName: string): string {
		return `${this.storyPath(storyName)}/${MANUSCRIPT_DIR_NAME}`;
	}

	/** 案头资料目录（书级参考资料：十件套 + 用户自建文件） */
	deskDocsPath(storyName: string): string {
		return `${this.storyPath(storyName)}/${DESK_DOCS_DIR_NAME}`;
	}

	/** 卷实体目录（书稿/<卷目录名>） */
	volumeDirPath(storyName: string, vol: doc.VolumeInfo): string {
		return `${this.manuscriptPath(storyName)}/${this.volumeFolderName(vol)}`;
	}

	/** 卷文档子目录（书稿/<卷目录名>/文档） */
	volumeDocsDirPath(storyName: string, vol: doc.VolumeInfo): string {
		return `${this.volumeDirPath(storyName, vol)}/${VOLUME_DOCS_DIR_NAME}`;
	}

	/** v0.2.24+ 提示词文件装配改造：resolveVolumeDocPath 的公开包装——解析卷级文档物理路径（新布局裸基名 / 旧前缀 / 旧新格式命名兼容） */
	volumeDocPath(storyName: string, vol: doc.VolumeInfo, base: string): string {
		return this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, base);
	}

	/** v0.2.24+ 提示词文件装配改造：书级《人物关系.md》路径（主路径读不到/为空时回落旧别名 角色关系.md，与 loadWritingData 同一兜底口径） */
	async bookRelationshipsDocPath(storyName: string): Promise<string> {
		const primary = `${this.deskDocsPath(storyName)}/人物关系.md`;
		if ((await this.readDoc(primary)).trim()) return primary;
		return `${this.deskDocsPath(storyName)}/角色关系.md`;
	}

	// ---------- 布局迁移（旧格式 → 案头资料/书稿 物理结构）----------

	/** 已确认处于新布局（或无需迁移）的书名缓存，避免每次读写重复探测 */
	private readonly layoutChecked = new Set<string>();
	/** 正在迁移中的书名（防重入：迁移期间的收口调用直接放行，避免递归） */
	private readonly migrating = new Set<string>();

	/** 从 vault 路径提取书名（故事根下第一级目录）；不在故事根下返回 null */
	private storyNameOfPath(path: string): string | null {
		const root = this.getStoryRoot().replace(/\/+$/, "");
		const rel = root ? (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null) : path;
		if (!rel) return null;
		const seg = rel.split("/")[0];
		return seg && !seg.startsWith(".") ? seg : null;
	}

	/**
	 * 布局收口：确保该书处于新物理结构（案头资料/ + 书稿/）。
	 * 探测轻量：①「案头资料/」已存在 → 视为已迁移直接返回；②否则 adapter.list(书根) 一次调用本地判定——
	 * 存在任何非隐藏、非系统项（引言/、章节目录、卷目录、九件套或用户自建文件/文件夹）即触发迁移。
	 * force=true 绕过 layoutChecked 缓存（/scan 修复入口用）。migrating 防重入；迁移失败不写缓存（下次重试）。
	 */
	private async ensureLayout(storyName: string, force = false): Promise<void> {
		if (this.migrating.has(storyName)) return;
		if (!force && this.layoutChecked.has(storyName)) return;
		this.migrating.add(storyName);
		try {
			if (this.vault.getAbstractFileByPath(this.deskDocsPath(storyName)) instanceof TFolder) {
				this.layoutChecked.add(storyName); // ① 已迁移
				return;
			}
			let listed: { files?: string[]; folders?: string[] };
			try {
				listed = await this.vault.adapter.list(this.storyPath(storyName)); // ② 一次 list 调用
			} catch {
				return; // 书目录不存在等 → 不迁移
			}
			const hasMarker = [...(listed.files ?? []), ...(listed.folders ?? [])].some((p) => {
				const name = p.split("/").pop() ?? "";
				if (!name || name.startsWith(".")) return false;
				if (name === DESK_DOCS_DIR_NAME || name === MANUSCRIPT_DIR_NAME) return false;
				return !ROOT_SYSTEM_NAMES.has(name); // 任何非隐藏非系统项（含纯用户文件书）都触发
			});
			if (!hasMarker) {
				this.layoutChecked.add(storyName); // 仅系统项/空书 → 无需迁移
				return;
			}
			await this.migrateStoryLayout(storyName);
			this.layoutChecked.add(storyName);
		} finally {
			this.migrating.delete(storyName);
		}
	}

	/**
	 * 旧格式 → 新物理结构一次性迁移引擎（幂等、可重跑）：
	 * ① 卷目录（书根）→ 整体 rename 到 书稿/<卷>/（章节目录随迁），再建「文档/」子目录并把卷直属 TFile 移入（legacy 前缀名归一裸基名）；
	 * ② 引言/ → 书稿/引言/；③ 书根章节目录 → 书稿/；④ 书根其余非系统项（九件套 + 用户文件/文件夹）→ 案头资料/。
	 * 系统项（故事状态.md / story_state.json / AI提示词/ / _backup/ / 卷.md）留书根；隐藏点文件跳过不搬。
	 * 冲突按 Obsidian 惯例加 ` (N)` 后缀；目标文件夹已存在时 mergeMoveFolder 逐子项合并后清源。全程 vault.rename/createFolder 直操，不经 writeDoc。
	 */
	private async migrateStoryLayout(storyName: string): Promise<void> {
		const base = this.storyPath(storyName);
		const desk = this.deskDocsPath(storyName);
		const ms = this.manuscriptPath(storyName);
		for (const p of [desk, ms]) {
			if (!this.vault.getAbstractFileByPath(p)) await this.vault.createFolder(p);
		}
		const checks: Array<{ path: string; expect: boolean }> = [];

		// 已知卷目录名（《卷.md》：物理名与 ID 都可能是目录名）
		const volNames = new Set<string>();
		try {
			for (const v of Object.values(await this.loadVolumes(storyName))) {
				volNames.add(this.volumeFolderName(v));
				volNames.add(v.id);
			}
		} catch { /* 无《卷.md》→ 无已知卷 */ }

		// ① 卷目录：整体 rename 到 书稿/<卷>/（章节目录随迁），再建「文档/」移直属 TFile
		let rootFolders: string[] = [];
		try {
			rootFolders = (await this.vault.adapter.list(base)).folders ?? [];
		} catch {
			return; // 书根不可读 → 放弃迁移
		}
		for (const f of rootFolders) {
			const name = f.split("/").pop() ?? "";
			if (!name || name.startsWith(".") || name === DESK_DOCS_DIR_NAME || name === MANUSCRIPT_DIR_NAME) continue;
			if (!volNames.has(name)) continue;
			const src = `${base}/${name}`;
			const dest = `${ms}/${name}`;
			if (this.vault.getAbstractFileByPath(dest) instanceof TFolder) {
				await this.mergeMoveFolder(src, dest); // 目标已存在（半迁移态）→ 逐子项合并后清源
			} else {
				const sf = this.vault.getAbstractFileByPath(src);
				if (!(sf instanceof TFolder)) continue;
				await this.vault.rename(sf, dest);
			}
			checks.push({ path: src, expect: false }, { path: dest, expect: true });
			// 建「文档/」子目录并移入卷直属 TFile（legacy 前缀名归一裸基名；用户文件原名保留）
			const docsDir = `${dest}/${VOLUME_DOCS_DIR_NAME}`;
			if (!this.vault.getAbstractFileByPath(docsDir)) await this.vault.createFolder(docsDir);
			let vfiles: string[] = [];
			try {
				vfiles = (await this.vault.adapter.list(dest)).files ?? [];
			} catch {
				continue;
			}
			for (const vf of vfiles) {
				const vname = vf.split("/").pop() ?? "";
				if (!vname || vname.startsWith(".")) continue;
				const tf = this.vault.getAbstractFileByPath(`${dest}/${vname}`);
				if (!(tf instanceof TFile)) continue;
				const logical = this.volumeLogicalBaseOf(vname, name); // 标准模板 → 裸基名；非标准 → null（原名）
				const finalName = await this.uniqueSiblingName(docsDir, logical ?? vname);
				await this.vault.rename(tf, `${docsDir}/${finalName}`);
				checks.push({ path: `${dest}/${vname}`, expect: false }, { path: `${docsDir}/${finalName}`, expect: true });
			}
		}

		// ② 引言/ → 书稿/引言/
		const prologueSrc = `${base}/${PROLOGUE_DIR_NAME}`;
		const prologueFolder = this.vault.getAbstractFileByPath(prologueSrc); // 捕获一次供 instanceof 收窄复用（免 as TFolder）
		if (prologueFolder instanceof TFolder) {
			const dest = `${ms}/${PROLOGUE_DIR_NAME}`;
			if (this.vault.getAbstractFileByPath(dest) instanceof TFolder) {
				await this.mergeMoveFolder(prologueSrc, dest);
			} else {
				await this.vault.rename(prologueFolder, dest);
			}
			checks.push({ path: prologueSrc, expect: false }, { path: dest, expect: true });
		}

		// ③ 书根章节目录 → 书稿/（重列一次，覆盖卷目录移出后剩余项）
		let restFolders: string[] = [];
		try {
			restFolders = (await this.vault.adapter.list(base)).folders ?? [];
		} catch { /* 忽略 */ }
		for (const f of restFolders) {
			const name = f.split("/").pop() ?? "";
			if (!name || name.startsWith(".") || name === DESK_DOCS_DIR_NAME || name === MANUSCRIPT_DIR_NAME) continue;
			if (!CHAPTER_DIR_RE.test(name)) continue;
			const src = `${base}/${name}`;
			const dest = `${ms}/${name}`;
			if (this.vault.getAbstractFileByPath(dest) instanceof TFolder) {
				await this.mergeMoveFolder(src, dest);
			} else {
				const sf = this.vault.getAbstractFileByPath(src);
				if (!(sf instanceof TFolder)) continue;
				await this.vault.rename(sf, dest);
			}
			checks.push({ path: src, expect: false }, { path: dest, expect: true });
		}

		// ④ 书根其余非系统项 → 案头资料/（再列一次，兜住全部剩余）
		let rest: { files?: string[]; folders?: string[] } = {};
		try {
			rest = await this.vault.adapter.list(base);
		} catch { /* 忽略 */ }
		for (const p of [...(rest.folders ?? []), ...(rest.files ?? [])]) {
			const name = p.split("/").pop() ?? "";
			if (!name || name.startsWith(".")) continue;
			if (name === DESK_DOCS_DIR_NAME || name === MANUSCRIPT_DIR_NAME) continue;
			if (ROOT_SYSTEM_NAMES.has(name)) continue; // 系统项留书根
			const from = this.vault.getAbstractFileByPath(`${base}/${name}`);
			if (!from) continue;
			const toName = await this.uniqueSiblingName(desk, name);
			await this.vault.rename(from, `${desk}/${toName}`);
			checks.push({ path: `${base}/${name}`, expect: false }, { path: `${desk}/${toName}`, expect: true });
		}

		// 连续 rename 后等真实文件系统落定（元数据索引滞后由各消费方既有兜底逻辑容忍）
		await this.settleTree(checks);
	}

	/** 同目录内生成不冲突名（Obsidian 惯例：冲突加 ` (N)` 后缀）；查真实文件系统，避免索引滞后误判 */
	private async uniqueSiblingName(dirPath: string, desired: string): Promise<string> {
		if (!(await this.vault.adapter.exists(`${dirPath}/${desired}`))) return desired;
		const dot = desired.lastIndexOf(".");
		const stem = dot > 0 ? desired.slice(0, dot) : desired;
		const ext = dot > 0 ? desired.slice(dot) : "";
		for (let n = 2; ; n++) {
			const cand = `${stem} (${n})${ext}`;
			if (!(await this.vault.adapter.exists(`${dirPath}/${cand}`))) return cand;
		}
	}

	/** 目标文件夹已存在（半迁移/重跑）时：逐子项移入目标（冲突加 ` (N)` 后缀），再清空源目录；隐藏点文件跳过不搬 */
	private async mergeMoveFolder(src: string, dest: string): Promise<void> {
		let listed: { files?: string[]; folders?: string[] } = {};
		try {
			listed = await this.vault.adapter.list(src);
		} catch {
			return;
		}
		for (const p of [...(listed.folders ?? []), ...(listed.files ?? [])]) {
			const name = p.split("/").pop() ?? "";
			if (!name || name.startsWith(".")) continue;
			const from = this.vault.getAbstractFileByPath(`${src}/${name}`);
			if (!from) continue;
			const toName = await this.uniqueSiblingName(dest, name);
			await this.vault.rename(from, `${dest}/${toName}`);
		}
		const srcFolder = this.vault.getAbstractFileByPath(src);
		if (srcFolder instanceof TFolder && srcFolder.children.length === 0) {
			try { await this.app.fileManager.trashFile(srcFolder); } catch { /* 被外部持锁等极少数情况：清空的源目录残留原地留待手动清理 */ } // 清空的源目录扔回收站（残留点文件时 children 非空，保留目录）
		}
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
		const sn = this.storyNameOfPath(path);
		if (sn) await this.ensureLayout(sn); // 布局收口：旧格式书先自动迁移再写
		path = this.resolveChapterDocPath(path); // 章节目录模板文件按新格式 <标题>-<基名> 落盘（老格式存量回退）
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
		path = this.resolveChapterDocPath(path); // 章节目录模板文件按新格式落盘
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
		for (const [fname, tpl] of this.rootDocTemplates(title)) await this.ensureDoc(`${this.deskDocsPath(name)}/${fname}`, tpl); // 默认资料十件套 → 「案头资料/」（与 ensureRootDocs 同一清单来源）
		await this.ensureDoc(`${base}/卷.md`, VOLUME_TEMPLATE); // 系统管理的《卷.md》留书根
		await this.ensurePrologue(name).catch(() => {}); // 引言播种（best-effort：失败不影响建书主流程）
		await this.saveState(name, state);
		this.layoutChecked.add(name); // 新书按新布局播种，无需迁移探测
		return name;
	}

	/** 改书名：更新状态文档 title + 顶层目录改名（净化后同名则仅改标题不动目录）+ 全书 MD 文档内旧书名整体替换为新书名（含《大纲/卷/伏笔/世界观》等标题行与正文；原文件备份 _backup/改书名_时间戳/，同角色改名口径）；返回新目录名与替换统计 */
	async renameStory(oldName: string, newTitle: string): Promise<{ newName: string; hits: number; files: number }> {
		const st = await this.loadState(oldName);
		if (!st) throw new Error(`小说 ${oldName} 的状态文档缺失`);
		const folder = this.vault.getAbstractFileByPath(this.storyPath(oldName));
		if (!(folder instanceof TFolder)) throw new Error("小说目录不存在或已被移动");
		const trimmed = newTitle.trim();
		if (!trimmed) throw new Error("新书名不能为空");
		const oldTitle = st.title;
		st.title = trimmed;
		await this.saveState(oldName, st); // 先回盘标题（含故事状态.md），再随目录整体搬走
		let newName = oldName;
		const safeNew = safeFilename(trimmed);
		if (safeNew !== oldName) {
			const parent = folder.parent?.path ?? "";
			const target = parent ? `${parent}/${safeNew}` : safeNew;
			if (this.vault.getAbstractFileByPath(target)) throw new Error(`当前目录已存在同名项：${target}，请换一个名字`);
			await this.vault.rename(folder, target); // 整树搬移，vault 索引与链接随之更新
			newName = safeNew;
		}
		// 全书 MD 文档内旧书名 → 新书名（《大纲.md》`# <书名> 大纲`、卷/伏笔/世界观标题行及正文一并覆盖）：先备份原文件到 _backup/改书名_时间戳/ 再替换（同角色改名口径）；状态文档已回盘新标题不会被再次命中
		let hits = 0;
		let files = 0;
		const oldT = (oldTitle || "").trim();
		const nf = this.storyFolder(newName);
		if (oldT && oldT !== trimmed && nf) {
			const changed: Array<{ file: TFile; text: string }> = [];
			for (const f of await this.listMarkdownFiles(nf)) {
				const text = await this.vault.read(f);
				const c = text.split(oldT).length - 1;
				if (c > 0) {
					hits += c;
					files += 1;
					changed.push({ file: f, text });
				}
			}
			if (changed.length) {
				const d = new Date();
				const pad = (n: number) => String(n).padStart(2, "0");
				const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
				const storyBase = this.storyPath(newName);
				const backupDir = `${storyBase}/_backup/改书名_${ts}`;
				for (const item of changed) {
					const rel = item.file.path.substring(storyBase.length + 1);
					await this.writeDoc(`${backupDir}/${rel}`, item.text);
				}
				for (const item of changed) {
					await this.vault.modify(item.file, item.text.split(oldT).join(trimmed));
				}
			}
		}
		return { newName, hits, files };
	}

	// ---------- 章节扫描与创建 ----------

	/** 卷实体目录名（= 净化后的卷名）。未归属章节留在「书稿/」直属，故卷名须唯一（addVolume/updateVolume 强制） */
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
	 * 参与章节扫描的容器路径：[书稿目录] + 其下各「容器」子文件夹。
	 * 容器判定：名称命中某卷的实体目录名/ID，或内部含 ≥1 个形如章节目录的子文件夹；
	 * 普通资料夹（无章节目录、非卷名）不递归进入，避免把杂项里的同名目录误认成章。
	 */
	private async containerPaths(storyName: string, vols?: Record<string, doc.VolumeInfo>): Promise<string[]> {
		const base = this.manuscriptPath(storyName);
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
		} catch { /* 书稿目录不存在等 → 仅扫书稿 */ }
		return paths;
	}

	/** 卷级设定五件套模板清单（建卷播种 / scan 补缺 / 写字台「补全卷文档」同一来源）；返回逻辑基名，物理名经 resolveVolumeDocPath 解析（如 风起-大纲.md）。《时间线》为可选手写参考资料、不参与提示词注入 */
	private volumeDocTemplates(vol: doc.VolumeInfo): Array<[string, string]> {
		return [
			["卷大纲.md", VOL_OUTLINE_TEMPLATE(vol.name)],
			["人物.md", VOL_CHARACTERS_TEMPLATE],
			["人物关系.md", VOL_RELATIONSHIPS_TEMPLATE],
			["场景.md", VOL_SCENES_TEMPLATE(vol.name)],
			["时间线.md", timelineTemplate(`${vol.name} 卷时间线`)],
		];
	}

	/** 确保卷实体目录存在（并补建缺失的卷级设定五件套模板），返回其路径 */
	private async ensureVolumeFolder(storyName: string, vol: doc.VolumeInfo): Promise<string> {
		const p = this.volumeDirPath(storyName, vol);
		if (!this.vault.getAbstractFileByPath(p)) await this.createFolderPath(p);
		for (const [fname, tpl] of this.volumeDocTemplates(vol)) {
			await this.ensureDoc(this.resolveVolumeDocPath(p, vol.name, fname), tpl).catch(() => {}); // 模板补齐尽力而为，不阻断主流程
		}
		return p;
	}

	/** 检查指定卷下的卷级设定模板，缺失者按模板创建（已存在一律保留不覆盖）；返回本次新建的文件名列表（全齐则为空数组）。卷实体目录缺失时一并补建 */
	async ensureVolumeDocs(storyName: string, volId: string): Promise<string[]> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, volId); // 按 id/名解析目标卷
		if (!vol) throw new Error(`卷 ${volId} 不存在或已被删除`);
		const p = this.volumeDirPath(storyName, vol);
		if (!this.vault.getAbstractFileByPath(p)) await this.createFolderPath(p);
		const created: string[] = [];
		for (const [fname, tpl] of this.volumeDocTemplates(vol)) {
			if ((await this.ensureDoc(this.resolveVolumeDocPath(p, vol.name, fname), tpl)) === "created") created.push(fname);
		}
		return created;
	}

	/** 「案头资料/」默认资料十件套模板清单（建书播种 / 写字台「补全资料」同一来源；《故事状态.md》与系统管理的《卷.md》不在其内）。《策划指南》参与大纲生成（空模板，首次大纲生成前自动 AI 生成内容）；《时间线》为可选手写参考资料、不参与提示词注入；《张力规则.md》内置默认播种（DEFAULT_TENSION_RULES），生成书级/卷级大纲与策划指南时注入、每书可独立编辑 */
	private rootDocTemplates(title: string): Array<[string, string]> {
		return [
			["大纲.md", outlineTemplate(title)],
			["策划指南.md", PLANNING_GUIDE_TEMPLATE],
			["世界观.md", WORLD_TEMPLATE],
			["伏笔.md", FORESHADOW_TEMPLATE],
			["笔记.md", NOTES_TEMPLATE],
			["人物.md", CHAPTER_CHARACTERS_TEMPLATE],
			["人物关系.md", CHAPTER_RELATIONSHIPS_TEMPLATE],
			["场景.md", CHAPTER_SCENES_TEMPLATE],
			["时间线.md", timelineTemplate(`${title.trim() || "未命名小说"} 时间线`)],
			["张力规则.md", DEFAULT_TENSION_RULES],
		];
	}

	/** 参与大纲生成的书级资料清单（书级/卷级大纲与策划指南的输入源）：建书播种齐全，「补全大纲资料」按此清单补缺 */
	private outlineDocNames(): string[] {
		return ["大纲.md", "策划指南.md", "世界观.md", "人物关系.md"];
	}

	/** 检查「案头资料/」下参与大纲生成的资料（大纲/策划指南/世界观/人物关系），缺失者按模板创建（已存在一律保留不覆盖）；返回本次新建的文件名列表。供命令面板与写字台「书稿」右键「补全大纲资料」 */
	async ensureOutlineDocs(storyName: string): Promise<string[]> {
		const st = await this.loadState(storyName);
		if (!st) throw new Error(`小说 ${storyName} 的状态文档缺失`);
		const base = this.deskDocsPath(storyName); // 书级大纲资料在「案头资料/」
		if (!this.vault.getAbstractFileByPath(this.storyPath(storyName))) throw new Error("小说目录不存在或已被移动");
		const templates = new Map(this.rootDocTemplates(st.title || storyName));
		const created: string[] = [];
		for (const fname of this.outlineDocNames()) {
			const tpl = templates.get(fname) ?? "";
			if ((await this.ensureDoc(`${base}/${fname}`, tpl)) === "created") created.push(fname);
		}
		return created;
	}

	/** 检查「案头资料/」下的默认资料文件，缺失者按模板创建（已存在一律保留不覆盖）；返回本次新建的文件名列表（全齐则为空数组）。供写字台案头资料节点右键「补全资料」 */
	async ensureRootDocs(storyName: string): Promise<string[]> {
		const st = await this.loadState(storyName);
		if (!st) throw new Error(`小说 ${storyName} 的状态文档缺失`);
		const base = this.deskDocsPath(storyName); // 书级默认资料在「案头资料/」
		if (!this.vault.getAbstractFileByPath(this.storyPath(storyName))) throw new Error("小说目录不存在或已被移动");
		const created: string[] = [];
		for (const [fname, tpl] of this.rootDocTemplates(st.title || storyName)) {
			if ((await this.ensureDoc(`${base}/${fname}`, tpl)) === "created") created.push(fname);
		}
		return created;
	}

	/** 「引言」文件夹路径（书稿/引言，全书唯一，有卷/无卷模式同位；不参与章节编号与提示词注入） */
	prologuePath(storyName: string): string {
		return `${this.manuscriptPath(storyName)}/${PROLOGUE_DIR_NAME}`;
	}

	/** 确保「引言」文件夹与正文《引言.md》存在（幂等，已存在不覆盖）；返回是否本次新建。建书/建卷/建章播种调用，失败由调用方兜底不影响主流程 */
	async ensurePrologue(storyName: string): Promise<boolean> {
		const p = this.prologuePath(storyName);
		if (this.vault.getAbstractFileByPath(p)) return false;
		await this.createFolderPath(p);
		try {
			await this.ensureDoc(`${p}/引言.md`, PROLOGUE_TEMPLATE);
		} catch { /* 正文文档创建失败不影响文件夹建立 */ }
		return true;
	}

	/** 「引言」文件夹直属 md 文件清单（写字台「引言」节点展示；空数组=尚无引言），按文件名 zh 序 */
	listPrologueDocs(storyName: string): Array<{ path: string; name: string }> {
		const dir = this.vault.getAbstractFileByPath(this.prologuePath(storyName));
		if (!(dir instanceof TFolder)) return [];
		return dir.children.filter((f): f is TFile => f instanceof TFile).map((f) => ({ path: f.path, name: f.name })).sort((a, b) => a.name.localeCompare(b.name, "zh"));
	}

	/** 删除整个「引言」文件夹（移入 Obsidian 回收站） */
	async deletePrologue(storyName: string): Promise<void> {
		const dir = this.vault.getAbstractFileByPath(this.prologuePath(storyName));
		if (!(dir instanceof TFolder)) throw new Error(`「${PROLOGUE_DIR_NAME}」文件夹不存在`);
		await this.app.fileManager.trashFile(dir);
	}

	/** 指定节点容器的标准模板文档清单+存在性（写字台「新建…文档/文章…」优先列出参与提示词的标准文档）：chKey=章节目录、volId=卷实体目录、皆无=书级（「案头资料/」）——与各级播种同一来源 */
	async standardDocs(storyName: string, target: { volId?: string; chKey?: string }): Promise<Array<{ name: string; exists: boolean }>> {
		const dir = await this.standardDirOf(storyName, target);
		return (await this.standardTemplateList(storyName, target)).map(([name]) => ({
			name,
			exists: !!this.vault.getAbstractFileByPath(this.resolveStandardDocPath(dir, target, name)), // 新格式文件名去前缀后比对实际文件
		}));
	}

	/** 标准模板文档实际路径解析：章节目录走 resolveChapterDocPath、卷目录走 resolveVolumeDocPath（卷名取目录名）、书级原样（dir 已是「案头资料/」） */
	private resolveStandardDocPath(dir: string, target: { volId?: string; chKey?: string }, name: string): string {
		if (target.chKey != null) return this.resolveChapterDocPath(`${dir}/${name}`);
		if (target.volId != null) {
			const volFolder = dir.slice(dir.lastIndexOf("/") + 1); // 卷实体目录名即卷名（volumeFolderName=safeFilename(name)）
			return this.resolveVolumeDocPath(dir, volFolder, name);
		}
		return `${dir}/${name}`;
	}

	/** 在指定节点容器按模板创建一份缺失的标准文档（已存在保留不覆盖）；返回是否本次新建。非该级标准名则报错 */
	async ensureStandardDoc(storyName: string, target: { volId?: string; chKey?: string }, fname: string): Promise<boolean> {
		const list = await this.standardTemplateList(storyName, target);
		const tpl = list.find(([n]) => n === fname)?.[1];
		if (!tpl) throw new Error(`「${fname}」不是该级别的标准文档`);
		const dir = await this.standardDirOf(storyName, target);
		return (await this.ensureDoc(this.resolveStandardDocPath(dir, target, fname), tpl)) === "created";
	}

	/** 以模板空内容覆盖写指定容器的标准文档（无论是否存在——调用方须先经用户确认丢失现有内容的风险）；非该级标准名则报错 */
	async overwriteStandardDoc(storyName: string, target: { volId?: string; chKey?: string }, fname: string): Promise<void> {
		const list = await this.standardTemplateList(storyName, target);
		const tpl = list.find(([n]) => n === fname)?.[1];
		if (!tpl) throw new Error(`「${fname}」不是该级别的标准文档`);
		const dir = await this.standardDirOf(storyName, target);
		await this.writeDoc(this.resolveStandardDocPath(dir, target, fname), tpl);
	}

	private async standardTemplateList(storyName: string, target: { volId?: string; chKey?: string }): Promise<Array<[string, string]>> {
		if (target.chKey != null) {
			const ch = await this.chapterDirOf(storyName, target.chKey);
			if (!ch) throw new Error("章节不存在或已被删除");
			return this.chapterDocTemplates(ch.num, ch.title);
		}
		if (target.volId != null) {
			const vols = await this.loadVolumes(storyName);
			const vol = this.findVolumeIn(vols, target.volId); // 按 id/名解析目标卷
			if (!vol) throw new Error(`卷 ${target.volId} 不存在或已被删除`);
			return this.volumeDocTemplates(vol);
		}
		const st = await this.loadState(storyName);
		if (!st) throw new Error(`小说 ${storyName} 的状态文档缺失`);
		return this.rootDocTemplates(this.bookTitle(storyName, st));
	}

	private async standardDirOf(storyName: string, target: { volId?: string; chKey?: string }): Promise<string> {
		if (target.chKey != null) {
			const ch = await this.chapterDirOf(storyName, target.chKey);
			if (!ch) throw new Error("章节不存在或已被删除");
			return ch.dir.path;
		}
		if (target.volId != null) {
			const vols = await this.loadVolumes(storyName);
			const vol = this.findVolumeIn(vols, target.volId); // 按 id/名解析目标卷
			if (!vol) throw new Error(`卷 ${target.volId} 不存在或已被删除`);
			const p = this.volumeDirPath(storyName, vol);
			if (!(this.vault.getAbstractFileByPath(p) instanceof TFolder)) throw new Error("该卷实体目录缺失，请先执行「按卷整理目录」");
			return p;
		}
		return this.deskDocsPath(storyName); // 书级标准文档在「案头资料/」
	}

	async listChapters(storyName: string): Promise<Array<{ key: string; num: number; title: string; dir: TFolder; vol?: string; parentPath: string }>> {
		await this.ensureLayout(storyName); // 布局收口：旧格式书先自动迁移再扫描章节
		const folder = this.vault.getAbstractFileByPath(this.storyPath(storyName));
		if (!folder || !(folder instanceof TFolder)) return [];
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		const byDirName = new Map<string, string>();
		for (const v of Object.values(vols)) {
			byDirName.set(this.volumeFolderName(v), v.id);
			byDirName.set(v.id, v.id);
		}
		const base = this.manuscriptPath(storyName); // 书级章节直接位于「书稿/」下
		const result: Array<{ key: string; num: number; title: string; dir: TFolder; vol?: string; parentPath: string }> = [];
		for (const containerPath of await this.containerPaths(storyName, vols)) {
			const cont = this.vault.getAbstractFileByPath(containerPath);
			if (!(cont instanceof TFolder)) continue;
			const volId = containerPath === base ? undefined : byDirName.get(cont.name);
			for (const child of cont.children) {
				if (!(child instanceof TFolder)) continue;
				const m = CHAPTER_DIR_RE.exec(child.name);
				if (!m) continue;
				if (!(await this.vault.adapter.exists(child.path))) continue; // 过滤元数据索引陈旧条目（目录已被改名/删除而索引未更新）；v0.1.4+：磁盘上存在的章节目录一律视为存活章节（标题取自目录名），无《章节.md》的空正文章照常列出、可被写作命令补写正文，不再隔离进 _backup
				result.push({ key: chKey(volId ?? null, parseInt(m[1], 10)), num: parseInt(m[1], 10), title: m[2], dir: child, ...(volId ? { vol: volId } : {}), parentPath: containerPath });
			}
		}
		// v0.0.15：章号按容器独立编号 → 阅读序=「书稿/」直属章在前、各卷按 VolumeInfo.order 依次、组内本地章号升序
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

	/** v0.2.x+：各卷实体目录 `文档/` 子目录内的直属文件（含建卷播种的设定五件套/卷摘要 + 用户文件），按卷 ID 归组；供写字台在卷节点下以「文档」子节点展示。无《卷.md》或某卷 `文档/` 缺失则跳过该卷 */
	async listVolumeDocsByVol(storyName: string): Promise<Record<string, Array<{ path: string; name: string }>>> {
		const out: Record<string, Array<{ path: string; name: string }>> = {};
		let vmap: Record<string, doc.VolumeInfo> = {};
		try {
			vmap = await this.loadVolumes(storyName);
		} catch {
			return out; // 未建过卷 → 空映射
		}
		for (const v of Object.values(vmap)) {
			const f = this.vault.getAbstractFileByPath(this.volumeDocsDirPath(storyName, v));
			if (!(f instanceof TFolder)) continue;
			out[v.id] = f.children.filter((x): x is TFile => x instanceof TFile).map((x) => ({ path: x.path, name: x.name })).sort((a, b) => a.name.localeCompare(b.name, "zh"));
		}
		return out;
	}

	async chapterBodyFile(storyName: string, key: string): Promise<TFile | null> {
		const chapters = await this.listChapters(storyName);
		const ch = chapters.find((c) => c.key === key);
		if (!ch) return null;
		const f = this.vault.getAbstractFileByPath(this.resolveChapterDocPath(`${ch.dir.path}/章节.md`));
		return f instanceof TFile ? f : null;
	}

	/** 公开：解析某章节内模板文件的实际路径（新格式 <标题>-<基名> 优先，老格式裸基名回退；都不存在返回新格式路径供创建）；章节不存在返回 null */
	async chapterDocPath(storyName: string, key: string, base: string): Promise<string | null> {
		const ch = await this.chapterDirOf(storyName, key);
		if (!ch) return null;
		return this.resolveChapterDocPath(`${ch.dir.path}/${base}`);
	}

	/** v0.0.15：建章不再显式传号——在目标容器（「书稿/」直属/卷）内自动取本地最大号+1；volumeKey 解析不到时落「书稿/」直属 */
	async createChapter(storyName: string, title: string, volumeKey = ""): Promise<string> {
		let volId = "";
		if (volumeKey && ((await this.loadState(storyName))?.use_volumes ?? false)) {
			const vols = await this.loadVolumes(storyName);
			const vol = this.findVolumeIn(vols, volumeKey);
			if (vol) volId = vol.id; // 新章直接落在卷实体目录内，位置即归属；无卷模式下忽略卷参数、强制落「书稿/」直属
			// 解析不到 → 落「书稿/」直属（不阻断建章）
		}
		const inScope = (await this.listChapters(storyName)).filter((c) => (c.vol ?? "") === volId);
		const num = inScope.reduce((mx, c) => Math.max(mx, c.num), 0) + 1;
		return this.createChapterAt(storyName, num, title, volId);
	}

	/** v0.2.10+「从卷大纲生成章节」：确保目标容器（volId="" 为「书稿/」直属）内指定本地号的章节存在——已存在原样返回，缺失则按 createChapterAt 语义创建（含模板播种与状态登记）。
	 *  v0.2.25+ syncTitle：章节已存在且 rawTitle 非空时同步章名——复用 renameChapter（重命名章节目录+文档文件名前缀+文档内旧标题引用+元数据 title），
	 *  「重新生成章节」侧传 true（大纲全量覆盖、章名跟随大纲标记）；「续写创建新章节」侧不传（已存在章完全不动）。返回 { key, created, renamed } */
	async ensureChapterAt(storyName: string, num: number, rawTitle: string, volId: string, syncTitle = false): Promise<{ key: string; created: boolean; renamed: boolean }> {
		const key = chKey(volId || null, num);
		const existing = await this.chapterDirOf(storyName, key);
		if (existing) {
			let renamed = false;
			if (syncTitle && rawTitle.trim()) {
				const newTitle = await this.renameChapter(storyName, key, rawTitle); // 与现名相同则内部直接返回、不产生任何改动
				renamed = newTitle !== existing.title;
			}
			return { key, created: false, renamed };
		}
		await this.createChapterAt(storyName, num, rawTitle, volId);
		return { key, created: true, renamed: false };
	}

	/** 章节目录七件套模板清单（建章播种 / scan 补缺 / 写字台「新建文章…」优先列表同一来源）。《时间线》为可选手写参考资料、《章节信息》为位置元数据（v0.2.23+ 起）——两者均不参与提示词注入 */
	chapterDocTemplates(num: number, title: string): Array<[string, string]> {
		const heading = title.trim() ? `第${num}章 ${title}` : `第${num}章`; // H1 口径与章节大纲模板一致
		return [
			["章节.md", CHAPTER_BODY_TEMPLATE(num, title)],
			["章节大纲.md", chapterOutlineTemplate(num, title)],
			["人物.md", CHAPTER_CHARACTERS_TEMPLATE],
			["人物关系.md", CHAPTER_RELATIONSHIPS_TEMPLATE],
			["场景.md", CHAPTER_SCENES_TEMPLATE],
			["章节信息.md", CHAPTER_INFO_TEMPLATE(num)],
			["时间线.md", timelineTemplate(`${heading} 时间线`)],
		];
	}

	/** 检查指定章节目录下的标准模板文档，缺失者按模板创建（已存在一律保留不覆盖）；返回本次新建的文件名列表（全齐则为空数组）。供写字台章节行右键「补全文档」 */
	async ensureChapterDocs(storyName: string, chKey: string): Promise<string[]> {
		const ch = await this.chapterDirOf(storyName, chKey);
		if (!ch) throw new Error(`章节 ${chKey} 不存在或已被删除`);
		const created: string[] = [];
		for (const [fname, tpl] of this.chapterDocTemplates(ch.num, ch.title)) { // 与建章播种 / scan 补缺同一清单来源
			if ((await this.ensureDoc(`${ch.dir.path}/${chapterDocPhysicalName(ch.dir.name, fname)}`, tpl)) === "created") created.push(fname);
		}
		return created;
	}

	private async createChapterAt(storyName: string, num: number, rawTitle: string, volId: string): Promise<string> {
		const safe = safeFilename(rawTitle.trim() || `第${num}章`);
		let base = this.manuscriptPath(storyName); // 章节目录物理落于「书稿/」下（有卷模式则入卷目录）
		if (volId) {
			const vols = await this.loadVolumes(storyName);
			const vol = vols[volId];
			if (vol) base = this.volumeDirPath(storyName, vol);
		}
		// 章节目录名：第NN章-章节名（目录名保留「第…章」，仅目录内文件名的数字前缀用纯数字）
		const folderName = `第${String(num).padStart(2, "0")}章-${safe}`;
		const dirPath = `${base}/${folderName}`;
		if (this.vault.getAbstractFileByPath(dirPath)) {
			throw new Error(`章节目录已存在：${dirPath}`);
		}
		await this.createFolderPath(dirPath);
		// 播种按新格式 <编号>-<章节名>-<基名后缀>.md 落盘（旧 build 残留的裸基名迁移由 detectOldFormatDocs + cmdRenameChapterFile 兜底）
		for (const [base, tpl] of this.chapterDocTemplates(num, safe)) {
			await this.ensureDoc(`${dirPath}/${chapterDocPhysicalName(folderName, base)}`, tpl);
		}
		await this.ensurePrologue(storyName).catch(() => {}); // 引言播种（best-effort：失败不影响建章主流程）
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		state.current_chapter = chKey(volId || null, num);
		state.chapters[chKey(volId || null, num)] = volId ? { title: safe, words: 0, volume: volId } : { title: safe, words: 0 };
		await this.saveState(storyName, state);
		if (volId) await this.writeChapterInfoField(storyName, chKey(volId, num), "卷", volId); // 《章节信息》与位置保持同源
		return this.resolveChapterDocPath(`${dirPath}/章节.md`);
	}

	/** 旧格式模板文档检测：章节目录内尚未采用新格式（01-初见-后缀.md）的章节标准模板、卷 `文档/` 内尚未归一裸基名（卷大纲.md …）的卷标准模板 → 迁移项 */
	async detectOldFormatDocs(storyName: string): Promise<OldFormatMigrationItem[]> {
		const items: OldFormatMigrationItem[] = [];
		// 章节目录内：扫描实际文件，识别逻辑基名后比对目标新格式（01-初见.md / 01-初见-大纲.md …）
		const chapters = await this.listChapters(storyName);
		for (const ch of chapters) {
			const folder = ch.dir.name; // 第01章-初见
			const title = ch.title;
			const renames: Array<{ from: string; to: string }> = [];
			const claimed = new Set<string>(); // 同一逻辑基名只迁移一次
			for (const child of ch.dir.children) {
				if (!(child instanceof TFile)) continue;
				const base = this.chapterLogicalBaseOf(child.name, folder, title);
				if (!base || claimed.has(base)) continue;
				const target = chapterDocPhysicalName(folder, base);
				if (child.name === target) continue; // 已是新格式
				claimed.add(base);
				if (ch.dir.children.some((x) => x.name === target)) continue; // 目标名已被同目录另一文件占用（如正确新格式与 -undefined 残留并存）→ 跳过避免重命名冲突，残留留待用户手动清理
				renames.push({ from: `${ch.dir.path}/${child.name}`, to: `${ch.dir.path}/${target}` });
			}
			if (renames.length) items.push({ kind: "chapter", label: `第${String(ch.num).padStart(2, "0")}章 ${ch.title}`, renames });
		}
		// 卷目录内：扫描 `文档/` 子目录实际文件 → 新布局裸基名（卷大纲.md …）
		let vols: Record<string, doc.VolumeInfo> = {};
		try { vols = await this.loadVolumes(storyName); } catch { vols = {}; }
		for (const vol of Object.values(vols)) {
			const docsDir = this.volumeDocsDirPath(storyName, vol);
			const volFolder = this.vault.getAbstractFileByPath(docsDir);
			if (!(volFolder instanceof TFolder)) continue;
			const folder = safeFilename(vol.name);
			const renames: Array<{ from: string; to: string }> = [];
			const claimed = new Set<string>();
			for (const child of volFolder.children) {
				if (!(child instanceof TFile)) continue;
				const base = this.volumeLogicalBaseOf(child.name, folder);
				if (!base || claimed.has(base)) continue;
				const target = base; // 新布局：文档/ 内裸基名
				if (child.name === target) continue;
				claimed.add(base);
				if (volFolder.children.some((x) => x.name === target)) continue; // 目标名已被同目录另一文件占用 → 跳过避免重命名冲突，残留留待用户手动清理
				renames.push({ from: `${docsDir}/${child.name}`, to: `${docsDir}/${target}` });
			}
			if (renames.length) items.push({ kind: "volume", label: `卷「${vol.name}」`, renames });
		}
		return items;
	}

	/** 批量迁移旧格式模板文档到新格式（逐文件 rename，单文件失败不中断，逐项记录错误） */
	async migrateOldFormatDocs(items: OldFormatMigrationItem[]): Promise<{ migrated: number; errors: string[] }> {
		const errors: string[] = [];
		let migrated = 0;
		for (const item of items) {
			try {
				for (const r of item.renames) {
					const f = this.vault.getAbstractFileByPath(r.from);
					if (f) await this.vault.rename(f, r.to);
				}
				migrated++;
			} catch (e) {
				errors.push(item.label + ": " + (e instanceof Error ? e.message : String(e)));
			}
		}
		return { migrated, errors };
	}

	/** 修复历史缺陷：把误建的「NN章-标题」章节目录（缺「第」前缀）重命名为「第NN章-标题」；返回修复数量。书稿目录与各卷目录均扫 */
	async repairUnprefixedChapterFolders(storyName: string): Promise<number> {
		let fixed = 0;
		const fixIn = async (containerPath: string): Promise<void> => {
			const cont = this.vault.getAbstractFileByPath(containerPath);
			if (!(cont instanceof TFolder)) return;
			for (const child of [...cont.children]) {
				if (!(child instanceof TFolder)) continue;
				const m = /^(\d{1,6})章-(.+)$/.exec(child.name);
				if (!m) continue;
				const target = `${containerPath}/第${m[1].padStart(2, "0")}章-${m[2]}`;
				if (this.vault.getAbstractFileByPath(target)) continue; // 目标已存在则跳过，避免覆盖
				try {
					await this.vault.rename(child, target);
					fixed++;
				} catch { /* 单个失败不阻断其余 */ }
			}
		};
		await fixIn(this.manuscriptPath(storyName));
		let vols: Record<string, doc.VolumeInfo> = {};
		try { vols = await this.loadVolumes(storyName); } catch { vols = {}; }
		for (const vol of Object.values(vols)) await fixIn(this.volumeDirPath(storyName, vol));
		return fixed;
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

	/** 打开书级根文档（案头资料/）；不存在时先按模板创建再打开 */
	async openStoryDoc(storyName: string, docName: string, template: string): Promise<void> {
		const path = `${this.deskDocsPath(storyName)}/${docName}`;
		await this.ensureDoc(path, template);
		await this.openMarkdown(path);
	}

	// ---------- 保存（编辑器内容强制落盘）----------

	/** 把当前聚焦的 章节.md 编辑器内容写回磁盘，返回字数；无匹配视图返回 -1 */
	async saveCurrentChapter(): Promise<number> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		// 正文文件：老格式 章节.md；新格式 <章节标题>-章节.md（所在目录为「第NN章-*」）
		const isBodyName = file ? (file.name === "章节.md" || file.name.endsWith("-章节.md")) : false;
		if (!file || !isBodyName || !CHAPTER_DIR_RE.test(file.parent?.name ?? "")) return -1;
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
		return ch ? this.resolveChapterDocPath(`${ch.dir.path}/章节.md`) : null;
	}

	/** v0.0.15：只在当前章所在容器（「书稿/」直属/同一卷）内前后翻页，不跨卷越界 */
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
		return { path: this.resolveChapterDocPath(`${target.dir.path}/章节.md`), num: target.num, key: target.key };
	}

	async countWords(storyName: string, key?: string): Promise<Array<{ key: string; num: number; title: string; words: number; chars: number }>> {
		const chapters = await this.listChapters(storyName);
		const rows: Array<{ key: string; num: number; title: string; words: number; chars: number }> = [];
		for (const ch of chapters) {
			if (key != null && ch.key !== key) continue;
			const f = this.vault.getAbstractFileByPath(this.resolveChapterDocPath(`${ch.dir.path}/章节.md`));
			const content = f instanceof TFile ? stripAiWordMarks(await this.vault.read(f)) : ""; // 剥离错别字下划线等标记，避免 span 标签虚增字数
			rows.push({ key: ch.key, num: ch.num, title: ch.title, words: countPureWords(content), chars: countCharsWithPunct(content) });
		}
		return rows;
	}

	async totalWords(storyName: string): Promise<number> {
		const rows = await this.countWords(storyName);
		return rows.reduce((s, r) => s + r.words, 0);
	}

	// ---------- 指定路径文档读写（使用说明等 vault md 通用；v0.3.5+ 旧三层 WRITING_GUIDE.md 已废弃） ----------

	/** 读取指定路径的指南原文；不存在返回 null */
	async readGuideAt(path: string): Promise<string | null> {
		const f = this.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? await this.vault.read(f) : null;
	}

	/** 全量保存指南到指定路径（缺失则创建，存在则覆盖——与 CLI /agents edit 语义一致） */
	async writeGuideAt(path: string, text: string): Promise<void> {
		await this.writeDoc(path, text.endsWith("\n") ? text : text + "\n");
	}

	// ---------- 插件数据目录文件读写：.obsidian/plugins/<id>/…（工作区、禁用词等通用） ----------
	// 该文件在 Obsidian 配置目录下、不被元数据索引收录，getAbstractFileByPath 恒返回 null；
	// 故走 DataAdapter 按文件系统相对路径读写（vault 根下任意路径均可），不依赖 TFile。

	async pluginFileExists(path: string): Promise<boolean> {
		try { return await this.app.vault.adapter.exists(path); } catch { return false; }
	}
	/** 检测 vault 根下目录是否存在：缺失则递归创建（Obsidian mkdir 为 recursive 语义、幂等）；返回本次是否新建。失败原样抛出由调用方上报 */
	async ensureVaultDir(dir: string): Promise<"exists" | "created"> {
		if (await this.app.vault.adapter.exists(dir)) return "exists";
		await this.app.vault.adapter.mkdir(dir);
		return "created";
	}

	/** 确保目标路径的父目录存在（无父级段时直接跳过）——writePluginFile 写前自愈用 */
	private async ensureParentDir(path: string): Promise<void> {
		const i = path.lastIndexOf("/");
		if (i <= 0) return; // 文件就在 vault 根，没有需要建的父目录
		await this.ensureVaultDir(path.slice(0, i));
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
	/** 写入/覆盖插件目录内文件：先检测并创建缺失的父目录，再落盘。相对路径被 adapter 拒绝时（部分 Obsidian 版本对 .obsidian 下相对写有限制），桌面端改用 vault 根绝对路径重试一次 */
	async writePluginFile(path: string, text: string): Promise<void> {
		await this.ensureParentDir(path); // 父目录不存在就先建（recursive mkdir 幂等）
		const data = text.endsWith("\n") ? text : text + "\n";
		try {
			await this.app.vault.adapter.write(path, data);
		} catch (e) {
			if (!Platform.isDesktopApp) throw e; // 移动端无桌面端同样的 .obsidian 写限制问题，原样抛出
			const ad = this.app.vault.adapter as unknown as { getFullPath?: (p: string) => string }; // FileSystemAdapter 专有方法，基类类型未声明
			if (typeof ad.getFullPath !== "function") throw e;
			const abs = ad.getFullPath(path); // 相对路径 → vault 根下绝对路径
			if (!abs || abs === path) throw e; // 解析不出新路径（如本就是绝对路径）：不二次尝试
			await this.app.vault.adapter.write(abs, data);
		}
	}

	// ---------- 通用文档工具 ----------

	async readDoc(path: string): Promise<string> {
		const sn = this.storyNameOfPath(path);
		if (sn) await this.ensureLayout(sn); // 布局收口：旧格式书先自动迁移再读
		const f = this.vault.getAbstractFileByPath(this.resolveChapterDocPath(path));
		return f instanceof TFile ? await this.vault.read(f) : "";
	}

	/**
	 * v0.1.9+ 人物关系面板：只读返回某书三层《人物关系.md》的层级/标签/路径/原文（书级 + 当前卷 + 当前章）。
	 * 章层按 chapterKey 定位（缺省取状态文档 current_chapter）；卷层按键所属卷解析、缺省取 current_volume。
	 * 定位不到的层不返回；文件不存在时 text 为空串（由调用方按空态处理）。全程非交互、不写盘。
	 */
	async readRelationshipDocs(storyName: string, chapterKey?: string | null): Promise<RelationshipDocSource[]> {
		const out: RelationshipDocSource[] = [];
		const base = this.deskDocsPath(storyName); // 书级《人物关系》在「案头资料/」
		const state = await this.loadState(storyName);
		const key = (chapterKey ?? state?.current_chapter) || "";
		let bookText = await this.readDoc(`${base}/人物关系.md`);
		if (!bookText.trim()) bookText = await this.readDoc(`${base}/角色关系.md`); // 旧别名兜底（与写作上下文同口径）
		out.push({ scope: "book", label: "书籍级", path: `${base}/人物关系.md`, text: bookText });

		let volId = key ? parseChKey(key).vol ?? "" : "";
		if (!volId) volId = state?.current_volume ?? "";
		if (volId) {
			const vol = (await this.loadVolumes(storyName))[volId];
			if (vol) {
				const path = this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "人物关系.md");
				out.push({ scope: "volume", label: `卷 · ${vol.name}`, path, text: await this.readDoc(path) });
			}
		}
		if (key) {
			const ch = await this.chapterDirOf(storyName, key);
			if (ch) {
				const path = this.resolveChapterDocPath(`${ch.dir.path}/人物关系.md`);
				out.push({ scope: "chapter", label: `章 · 第${ch.num}章 ${ch.title}`.trim(), path, text: await this.readDoc(path) });
			}
		}
		return out;
	}

	/**
	 * 人物关系面板「人物状态」区数据源（v0.2.x+）：只读解析该书**全部三层**《人物.md》（书级 + 每一卷 + 每一章），
	 * 返回逐条角色设定（含归属层级/标签/来源路径，同名多层登记不合并——展示侧自行按名筛选）。
	 * 与 loadAllCharacters 同遍历口径，但保留每条的出处；文件缺失/单层解析失败静默跳过。全程非交互、不写盘。
	 */
	async loadCharacterEntries(storyName: string): Promise<CharacterInfoEntry[]> {
		const out: CharacterInfoEntry[] = [];
		const base = this.deskDocsPath(storyName); // 书级《人物》在「案头资料/」
		const collect = (text: string, chapNum: number, scope: "book" | "volume" | "chapter", label: string, path: string): void => {
			let chars: Record<string, doc.CharacterDoc>;
			try {
				chars = doc.parseCharacters(text, chapNum);
			} catch {
				return; // 单层格式异常不影响其余层
			}
			for (const c of Object.values(chars)) out.push({ ...c, scope, label, sourcePath: path });
		};
		collect(await this.readDoc(`${base}/人物.md`), 0, "book", "书籍级", `${base}/人物.md`);
		for (const [, vol] of Object.entries(await this.loadVolumes(storyName))) {
			const path = this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "人物.md");
			collect(await this.readDoc(path), 0, "volume", `卷 · ${vol.name}`, path);
		}
		for (const ch of await this.listChapters(storyName)) {
			const path = this.resolveChapterDocPath(`${ch.dir.path}/人物.md`);
			collect(await this.readDoc(path), ch.num, "chapter", `章 · 第${ch.num}章 ${ch.title}`.trim(), path);
		}
		return out;
	}

	/** 章节目录内探测《时间线.md》物理名：新格式 `<NN-标题>-时间线.md` → 裸 `时间线.md`；都不存在时返回新格式候选路径 + 空文本 */
	private async probeTimelineInDir(dirPath: string, folder: string): Promise<{ path: string; text: string }> {
		const prefixed = `${dirPath}/${chapterFilePrefix(folder)}-时间线.md`; // 如 01-初见-时间线.md
		if (this.vault.getAbstractFileByPath(prefixed)) return { path: prefixed, text: await this.readDoc(prefixed) };
		const bare = `${dirPath}/时间线.md`;
		if (this.vault.getAbstractFileByPath(bare)) return { path: bare, text: await this.readDoc(bare) };
		return { path: prefixed, text: "" };
	}

	/** v0.3.3+ 书级《时间线》路径（「案头资料/时间线.md」；旧《大事件列表.md》退场后的统一口径，时间线面板与提示词装配共用） */
	bookTimelinePath(storyName: string): string {
		return `${this.deskDocsPath(storyName)}/时间线.md`;
	}

	/** v0.3.3+ 阶段 0 前置：全量写书级《时间线.md》（AI 生成原文原样落盘、尾部补一个换行）；缺失则创建、存在则覆盖 */
	async setBookTimeline(storyName: string, content: string): Promise<void> {
		await this.writeDoc(this.bookTimelinePath(storyName), `${String(content ?? "").replace(/\s+$/, "")}\n`);
	}

	/**
	 * v0.2.x+ 时间线面板：只读枚举某书**全部**《时间线.md》来源（书级 + 每一卷 + 每一章），自上而下的完整时间轴概览。
	 * 顺序——有卷模式：书籍级 → 「书稿/」直属未归卷章节(num升序) → 各卷按阅读序、每卷紧随其成员章节(num升序，条目带 volId)；无卷模式：书籍级 → 全部章节(num升序)。
	 * 物理命名兼容新格式(`<NN-标题>-时间线.md` / `<卷名>-时间线.md`)与裸 `时间线.md`，探测次序 新→裸；缺失层记候选路径 + 空文本（展示侧按空态处理）。全程非交互、不写盘。
	 */
	async readTimelineDocs(storyName: string): Promise<TimelineDocSource[]> {
		const out: TimelineDocSource[] = [];
		const base = this.bookTimelinePath(storyName); // 书级《时间线》在「案头资料/」
		out.push({ scope: "book", label: "书籍级", path: base, text: await this.readDoc(base) });
		const chLabel = (ch: { num: number; title: string }): string => `章 · 第${ch.num}章 ${ch.title}`.trim();
		const all = await this.listChapters(storyName); // 阅读序：「书稿/」直属未归卷在前，其后各卷章节依次(num升序)
		if ((await this.loadState(storyName))?.use_volumes !== true) {
			for (const ch of all) {
				const p = await this.probeTimelineInDir(ch.dir.path, ch.dir.name);
				out.push({ scope: "chapter", label: chLabel(ch), path: p.path, text: p.text });
			}
			return out;
		}
		for (const ch of all) if (!ch.vol) {
			const p = await this.probeTimelineInDir(ch.dir.path, ch.dir.name);
			out.push({ scope: "chapter", label: chLabel(ch), path: p.path, text: p.text });
		}
		for (const vol of await this.volumeList(storyName)) {
			const vpath = this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "时间线.md"); // 文档/裸基名 → legacy 前缀 → 旧新格式
			out.push({ scope: "volume", label: `卷 · ${vol.name}`, path: vpath, text: await this.readDoc(vpath) });
			for (const ch of all) if (ch.vol === vol.id) {
				const p = await this.probeTimelineInDir(ch.dir.path, ch.dir.name);
				out.push({ scope: "chapter", label: chLabel(ch), path: p.path, text: p.text, volId: vol.id });
			}
		}
		return out;
	}

	/**
	 * v0.3.3+ 合并时间轴与大事件：把某书**三层**《时间线.md》（书级 → 未归卷章节 → 各卷及其章节，readTimelineDocs 顺序）合并为一段提示词用的时间轴文本。
	 * 条目按 formatTimelineBlock 规范重新序列化（标题行＝时间点＋事件名，字段行 人物/完成/事件/描述/影响/关联），非时间线标题块与非时间点标题块自然丢弃。
	 * 各文档内部保持原层级与先后次序（父子事件相邻、不被全局排序打散）；无有效条目（文档缺失或全是旧式内容）返回空串——调用方据此判定「本书暂无时间线」。
	 */
	async mergedTimelineText(storyName: string): Promise<string> {
		const blocks: string[] = [];
		for (const d of await this.readTimelineDocs(storyName)) {
			for (const e of doc.parseTimelines(d.text)) blocks.push(doc.formatTimelineBlock(e));
		}
		return blocks.join("\n").trim();
	}

	/**
	 * v0.2.0+「添加人物」：把关系条目**追加**到指定层级的《人物关系.md》（书级 / 卷目录 / 章节目录）。
	 * 文档缺失或为空时先按该层模板起底（模板注释不参与 parseRelationships，无副作用）；已有内容原样保留、新条目追加在末尾。
	 * 返回实际写入的 vault 相对路径（供 Notice 展示）。
	 */
	async appendRelationships(
		storyName: string,
		scope: "book" | "volume" | "chapter",
		entries: doc.RelationshipEntry[],
		opts?: { volId?: string | null; chapterKey?: string | null }
	): Promise<string> {
		if (!entries.length) throw new Error("没有可写入的关系条目");
		const base = this.deskDocsPath(storyName); // 书级《人物关系》在「案头资料/」
		let path = "";
		let template = CHAPTER_RELATIONSHIPS_TEMPLATE; // 书籍级与章级同模板（与建章/ensureRootDocs 播种一致）
		if (scope === "book") {
			path = `${base}/人物关系.md`;
		} else if (scope === "volume") {
			const volId = String(opts?.volId ?? "").trim();
			if (!volId) throw new Error("缺少卷 id，无法写入卷级人物关系");
			const vol = (await this.loadVolumes(storyName))[volId];
			if (!vol) throw new Error(`卷不存在：${volId}`);
			await this.ensureVolumeFolder(storyName, vol);
			path = this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "人物关系.md");
			template = VOL_RELATIONSHIPS_TEMPLATE;
		} else {
			const key = String(opts?.chapterKey ?? "").trim();
			if (!key) throw new Error("缺少章节键，无法写入章级人物关系");
			const ch = await this.chapterDirOf(storyName, key);
			if (!ch) throw new Error(`章节不存在：${key}`);
			path = this.resolveChapterDocPath(`${ch.dir.path}/人物关系.md`);
		}
		const existing = (await this.readDoc(path)).replace(/\s*$/, "");
		const head = existing ? `${existing}\n\n` : `${template.replace(/\s*$/, "")}\n\n`;
		const body = head + entries.map((e) => doc.formatRelationshipBlock(e)).join("\n");
		await this.writeDoc(path, body.replace(/\n+$/, "\n"));
		return path;
	}

	/**
	 * 章节目录内模板文件路径解析（v0.1.9+ 新格式：正文 <章节目录名>.md、其余 <章节目录名>-<后缀>.md，如 第01章-初见-大纲.md）：
	 * 仅对「第NN章-*」目录下的标准模板逻辑基名生效；按 新格式 → 旧前缀格式(<标题>-<基名>) → 裸基名 依次回退，都不存在时返回新格式路径（供创建）。
	 * 书级资料（「案头资料/」下 大纲.md 等）与卷目录文件不受影响（卷目录由调用方显式经 resolveVolumeDocPath 处理）。
	 */
	private resolveChapterDocPath(path: string): string {
		const idx = path.lastIndexOf("/");
		if (idx < 0) return path;
		const dir = path.slice(0, idx);
		const base = path.slice(idx + 1);
		if (!CHAPTER_TEMPLATE_BASES.has(base)) return path;
		const folder = dir.slice(dir.lastIndexOf("/") + 1);
		const m = /^第\d+章-(.+)$/.exec(folder);
		if (!m) return path;
		const title = m[1];
		const target = `${dir}/${chapterDocPhysicalName(folder, base)}`; // 新格式：01-初见-大纲.md
		if (this.vault.getAbstractFileByPath(target)) return target;
		const folderPrefixed = `${dir}/${chapterDocFolderPrefixName(folder, base)}`; // 旧文件夹前缀：第01章-初见-大纲.md
		if (this.vault.getAbstractFileByPath(folderPrefixed)) return folderPrefixed;
		const intermediate = `${dir}/${title}-${base}`; // 更旧标题前缀：初见-章节大纲.md
		if (this.vault.getAbstractFileByPath(intermediate)) return intermediate;
		if (this.vault.getAbstractFileByPath(path)) return path; // 裸基名：章节大纲.md
		return target;
	}

	/** 卷目录内模板文件路径解析（v0.2.x+ 新布局：`文档/` 子目录内裸基名，如 文档/卷大纲.md）：裸基名 → 旧前缀(<卷名>-<基名>) → 旧新格式(<卷目录名>-<后缀>) 依次回退，都不存在返回 `文档/` 裸基名 */
	private resolveVolumeDocPath(volDir: string, volName: string, base: string): string {
		const folder = safeFilename(volName);
		const target = `${volDir}/${VOLUME_DOCS_DIR_NAME}/${base}`; // 新布局裸基名：文档/卷大纲.md
		if (this.vault.getAbstractFileByPath(target)) return target;
		const intermediate = `${volDir}/${folder}-${base}`; // 旧前缀格式：风起-卷大纲.md
		if (this.vault.getAbstractFileByPath(intermediate)) return intermediate;
		const legacy = `${volDir}/${volumeDocPhysicalName(folder, base)}`; // 旧新格式：风起-大纲.md
		if (this.vault.getAbstractFileByPath(legacy)) return legacy;
		return target;
	}

	/** 识别卷目录内某物理文件名对应的逻辑基名（新/旧前缀/裸名三种命名兼容）；非标准模板返回 null */
	private volumeLogicalBaseOf(name: string, folder: string): string | null {
		if (name.startsWith(`${folder}-`)) {
			const rest = name.slice(folder.length + 1);
			if (VOLUME_SUFFIX_TO_BASE[rest]) return VOLUME_SUFFIX_TO_BASE[rest]; // 新格式：风起-大纲.md
			if (VOLUME_TEMPLATE_BASES.has(rest)) return rest; // 旧前缀：风起-卷大纲.md
		}
		if (name === `${folder}-undefined`) return "时间线.md"; // 历史缺陷残留：后缀映射缺《时间线》曾误建为 <卷名>-undefined（无扩展名）
		if (VOLUME_TEMPLATE_BASES.has(name)) return name; // 裸基名
		return null;
	}

	/** 识别章节目录内某物理文件名对应的逻辑基名（新数字前缀/旧文件夹前缀/旧标题前缀/裸名四种命名兼容）；非标准模板返回 null */
	private chapterLogicalBaseOf(name: string, folder: string, title: string): string | null {
		const prefix = chapterFilePrefix(folder); // 第01章-初见 → 01-初见
		if (name === `${prefix}.md`) return "章节.md"; // 新格式正文：01-初见.md
		if (name.startsWith(`${prefix}-`)) {
			const base = CHAPTER_SUFFIX_TO_BASE[name.slice(prefix.length + 1)];
			if (base) return base; // 新格式：01-初见-大纲.md
		}
		if (name === `${prefix}-undefined` || name === `${folder}-undefined`) return "时间线.md"; // 历史缺陷残留：后缀映射缺《时间线》曾误建为 <NN-标题>-undefined（无扩展名）
		if (name === `${folder}.md`) return "章节.md"; // 旧文件夹前缀正文：第01章-初见.md
		if (name.startsWith(`${folder}-`)) {
			const base = CHAPTER_SUFFIX_TO_BASE[name.slice(folder.length + 1)];
			if (base) return base;
		}
		if (name.startsWith(`${title}-`)) { // 旧标题前缀：初见-章节.md
			const b = name.slice(title.length + 1);
			if (CHAPTER_TEMPLATE_BASES.has(b)) return b;
		}
		if (CHAPTER_TEMPLATE_BASES.has(name)) return name; // 裸基名
		return null;
	}

	/**
	 * 目录改名后，按**真实文件系统**把章节目录内模板文件重命名为新目录名前缀（兼容旧前缀/裸名）。
	 * 刻意用 adapter.list/adapter.exists/adapter.rename（而非 vault.getAbstractFileByPath/vault.rename）：adapter.rename 后 Obsidian 索引会滞后，
	 * 用索引会把旧文件名/旧路径当作现状，重命名失败进而中断有序重排、留下断档残留。全程非致命，单个失败即跳过。
	 */
	private async syncChapterDocFileNames(dirPath: string, oldFolder: string, newFolder: string, title: string): Promise<void> {
		let files: string[] = [];
		try { files = (await this.vault.adapter.list(dirPath)).files ?? []; } catch { return; }
		for (const full of files) {
			const name = full.split("/").pop() || "";
			if (!/\.md$/i.test(name)) continue;
			const base = this.chapterLogicalBaseOf(name, oldFolder, title);
			if (!base) continue;
			const target = chapterDocPhysicalName(newFolder, base);
			if (name === target) continue;
			const targetFull = `${dirPath}/${target}`;
			try {
				if (!(await this.vault.adapter.exists(targetFull))) await this.vault.adapter.rename(full, targetFull);
			} catch { /* 单个失败不阻断 */ }
		}
	}

	/** 卷目录改名后，按真实文件系统把卷模板文件重命名为新卷目录名前缀；非致命 */
	private async syncVolumeDocFileNames(dirPath: string, oldFolder: string, newFolder: string): Promise<void> {
		let files: string[] = [];
		try { files = (await this.vault.adapter.list(dirPath)).files ?? []; } catch { return; }
		for (const full of files) {
			const name = full.split("/").pop() || "";
			if (!/\.md$/i.test(name)) continue;
			const base = this.volumeLogicalBaseOf(name, oldFolder);
			if (!base) continue;
			const target = volumeDocPhysicalName(newFolder, base);
			if (name === target) continue;
			const targetFull = `${dirPath}/${target}`;
			try {
				if (!(await this.vault.adapter.exists(targetFull))) await this.vault.adapter.rename(full, targetFull);
			} catch { /* 单个失败不阻断 */ }
		}
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
			const f = this.vault.getAbstractFileByPath(this.resolveChapterDocPath(`${ch.dir.path}/章节.md`));
			sum += countPureWords(f instanceof TFile ? stripAiWordMarks(await this.vault.read(f)) : ""); // 剥离错别字下划线等标记，避免 span 标签虚增字数
		}
		state.total_words = sum;
	}

	// ---------- 卷（卷.md）----------

	async loadVolumes(storyName: string): Promise<Record<string, doc.VolumeInfo>> {
		await this.ensureLayout(storyName); // 布局收口：旧格式书先自动迁移再读卷（卷.md 留书根，路径不受迁移影响）
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
		if (n === PROLOGUE_DIR_NAME) throw new Error(`卷名不可为「${PROLOGUE_DIR_NAME}」（保留名：「书稿/引言」文件夹占用该名）`);
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
		await this.ensurePrologue(storyName).catch(() => {}); // 引言播种（best-effort：失败不影响建卷主流程）
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
			if (newName === PROLOGUE_DIR_NAME) throw new Error(`卷名不可改为「${PROLOGUE_DIR_NAME}」（保留名：「书稿/引言」文件夹占用该名）`);
			for (const v of Object.values(vols)) if (v.id !== vol.id && v.name === newName) throw new Error(`已有同名卷：${newName}`);
		}
		if (patch.description !== undefined) vol.description = String(patch.description).trim();
		vol.name = newName;
		await this.saveVolumes(storyName, vols);
		// 卷实体目录随卷名走：改名后同步移动目录（失败则回滚元数据并报错）
		const base = this.manuscriptPath(storyName); // 卷实体目录在「书稿/」下
		const oldDir = `${base}/${this.volumeFolderName({ ...vol, name: oldName })}`;
		const newDir = `${base}/${this.volumeFolderName(vol)}`;
		if (oldDir !== newDir && (await this.vault.adapter.exists(oldDir))) {
			try {
				const f = this.vault.getAbstractFileByPath(oldDir);
				if (!(f instanceof TFolder)) throw new Error("卷实体目录对象缺失");
				await this.vault.rename(f, newDir);
				await this.settleTree([{ path: oldDir, expect: false }, { path: newDir, expect: true }]);
				// 卷模板文件随卷名同步为新格式（走真实 FS、非致命）
				await this.syncVolumeDocFileNames(newDir, safeFilename(oldName), safeFilename(newName));
			} catch (e) {
				vol.name = oldName;
				await this.saveVolumes(storyName, vols); // 回滚，保持元数据与磁盘一致
				throw e instanceof Error ? e : new Error(String(e));
			}
		}
		return vol;
	}

	/**
	 * v0.0.15 核心迁移助手：把一章在容器间移动（「书稿/」直属↔卷实体目录），保持「位置即归属」。
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
		let destBase = this.manuscriptPath(storyName); // 未归属章落「书稿/」直属
		if (destVolId) {
			const vols = await this.loadVolumes(storyName);
			const vol = vols[destVolId];
			if (!vol) throw new Error(`未找到卷：${destVolId}`);
			destBase = this.volumeDirPath(storyName, vol); // 卷实体目录在「书稿/」下
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
		// 新格式文件名含章号：迁移后同步把模板文件重命名为新目录名前缀（走真实 FS、非致命）
		await this.syncChapterDocFileNames(targetPath, ch.dir.name, targetPath.slice(targetPath.lastIndexOf("/") + 1), ch.title);
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

	/** 删除卷并解绑其下章节（删卷≠删章）：各章经 relocateChapterContainer 移回「书稿/」直属（同号冲突自动改号），卷目录整体扔回收站（含残留杂散文件），元数据一次清理 */
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
			const volDir = this.volumeDirPath(storyName, vol); // 卷实体目录在「书稿/」下
			// 章已经 relocate 到根目录，卷目录内只剩杂散文件；用 trashFile 把整个卷目录扔回收站（用户主动「删除卷」该有的语义，非空残留不再保留原地）
			const vf = this.vault.getAbstractFileByPath(volDir);
			if (vf instanceof TFolder) { try { await this.app.fileManager.trashFile(vf); } catch { /* 文件被外部持锁等极少数情况，残留原地由用户手动清理 */ } }
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
			const volDir = this.volumeDirPath(storyName, vol); // 卷实体目录在「书稿/」下
			// 章已经 trashFile 入回收站，卷目录内只剩杂散文件；用 trashFile 把整个卷目录扔回收站（用户主动「级联删除卷」该有的语义，非空残留不再保留原地）
			const vf = this.vault.getAbstractFileByPath(volDir);
			if (vf instanceof TFolder) { try { await this.app.fileManager.trashFile(vf); } catch { /* 文件被外部持锁等极少数情况，残留原地由用户手动清理 */ } }
		} catch { /* getAbstractFileByPath 等前置异常 → 忽略 */ }
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
		return { num: targetNum >= 0 ? targetNum : null, path: ch ? this.resolveChapterDocPath(`${ch.dir.path}/章节.md`) : null, chapterKey: targetKey };
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

	/** 取消归属：章节目录移回「书稿/」直属（同号冲突自动改号），元数据与《章节信息》同步清空 */
	async unassignChapterVolume(storyName: string, srcKey: string): Promise<void> {
		try {
			await this.relocateChapterContainer(storyName, srcKey, null);
		} catch (e) { console.warn(`[ArticleWriter] 取消归属 ${srcKey} 时章节目录移回「书稿/」直属失败：`, e); }
	}

	// ---------- 按卷整理目录（平面结构升级 / 布局修复）----------

	/**
	 * 检测「平面结构」残留：章节已归卷（《章节信息》或状态文档有有效卷 ID）但目录仍留在「书稿/」直属。
	 * 返回需要移动的复合键列表；空数组＝已是按卷目录结构（未归属章留「书稿/」直属属正常）。
	 */
	async needsVolumeOrganize(storyName: string): Promise<string[]> {
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		if (!Object.keys(vols).length) return [];
		const state = await this.loadState(storyName);
		const base = this.manuscriptPath(storyName); // 「书稿/」直属＝未归属章的正常落点
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
	 * 按卷整理（幂等的迁移/修复命令）：把「归属与位置不一致」的章节目录移到其归属容器 <书>/书稿/<卷名>/，同号冲突自动改号。
	 * 位于未知容器内的章节只报告不移动；卷名冲突（净化后同名）直接报错要求先改名。返回汇总。
	 */
	async organizeByVolumes(
		storyName: string
	): Promise<{ movedKeys: string[]; unassignedAtRoot: number; unknownContainers: Array<{ folder: string; keys: string[] }> }> {
		if (!((await this.loadState(storyName))?.use_volumes)) return { movedKeys: [], unassignedAtRoot: 0, unknownContainers: [] }; // v0.0.16+：无卷模式不做按卷整理（保持扁平）
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		const base = this.manuscriptPath(storyName); // 「书稿/」直属＝未归属章的正常落点
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
				unassignedAtRoot++; // 未归属章留「书稿/」直属＝新布局的正常形态
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
	 * v0.0.16+：把该书所有卷实体目录内的章节整体拍平回「书稿/」直属（无卷模式落地的破坏性迁移）。
	 * 复用 relocateChapterContainer 逐章回移（同号冲突自动改号、复合键/伏笔/《章节信息》一次重映射），
	 * 顺序=listChapters 的全局阅读序（书稿直属在前、各卷按 order 依次、组内本地号升序），保证结果确定可复现。
	 * 幂等可续跑：已回移到「书稿/」直属的章变为根域键，下次过滤 vol!=null 后不再处理；中断后可重跑 /volume off 补齐。
	 */
	async flattenToRoot(storyName: string): Promise<{ movedKeys: string[]; deletedVolumes: number; movedDocs: number }> {
		const vols = await this.loadVolumes(storyName);
		if (!Object.keys(vols).length) return { movedKeys: [], deletedVolumes: 0, movedDocs: 0 }; // 本就无卷 → 无需迁移
		const ordered = (await this.listChapters(storyName)).filter((c) => c.vol != null); // listChapters 已按全局阅读序排好
		const movedKeys: string[] = [];
		for (const ch of ordered) {
			const r = await this.relocateChapterContainer(storyName, ch.key, null); // 位置即归属：物理回移+键重映射一次完成
			movedKeys.push(r.newKey);
		}
		// v0.1.3+：拍平前先 salvaging 各卷残留的文件（设定五件套/卷摘要等，含「文档/」子目录）回「案头资料/」保留；跨卷同名者加「<卷名>-」前缀避免覆盖，而非随目录一起进回收站
		const movedDocs = await this.salvageVolumeDocsToRoot(storyName, vols);
		// 清空各卷实体目录（连同其残留内容）进回收站，再移除 卷.md 元数据
		let deletedVolumes = 0;
		for (const v of Object.values(vols)) {
			const volDir = this.volumeDirPath(storyName, v); // 卷实体目录在「书稿/」下
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
		return { movedKeys, deletedVolumes, movedDocs };
	}

	/** v0.1.3+：拍平迁移前把各卷实体目录里剩余的文件（非章节目录，如建卷播种的设定五件套/卷摘要等）回移到「案头资料/」保留；
	 * 新布局下卷级文档在 <书稿>/<卷>/文档/ 子目录内，须连同直属文件一并回移，否则会随卷目录进回收站丢数据。
	 * 跨卷或目标已存在同名者加「<卷名>-」前缀避免覆盖。返回成功迁移的文件数 */
	private async salvageVolumeDocsToRoot(storyName: string, vols: Record<string, doc.VolumeInfo>): Promise<number> {
		const desk = this.deskDocsPath(storyName); // 回移落点＝「案头资料/」（书级文档统一归口）
		if (!(await this.vault.adapter.exists(desk))) await this.vault.createFolder(desk); // 极端情况下（未迁移即拍平）先确保落点存在
		let moved = 0;
		for (const v of Object.values(vols)) {
			const folder = this.vault.getAbstractFileByPath(this.volumeDirPath(storyName, v));
			if (!(folder instanceof TFolder)) continue; // 章节已先行回移，此处只剩卷内直属文件与「文档/」子目录
			const files = folder.children.filter((x): x is TFile => x instanceof TFile);
			const docsSub = folder.children.find((x): x is TFolder => x instanceof TFolder && x.name === VOLUME_DOCS_DIR_NAME);
			if (docsSub) files.push(...docsSub.children.filter((x): x is TFile => x instanceof TFile)); // 「文档/」内的卷级文档一并回移
			for (const file of files) {
				let target = `${desk}/${file.name}`;
				if (await this.vault.adapter.exists(target)) {
					target = `${desk}/${safeFilename(v.name)}-${file.name}`; // 跨卷/目标同名 → 前面增加卷名后再挪出
					if (await this.vault.adapter.exists(target)) throw new Error(`拍平冲突：案头资料已存在 ${target}，无法迁移 ${file.path}`);
				}
				await this.vault.rename(file, target);
				await this.settleTree([{ path: file.path, expect: false }, { path: target, expect: true }]); // 等虚拟文件系统同步再处理下一个/后续删目录
				moved++;
			}
		}
		return moved;
	}

	/**
	 * v0.0.16+：切换该书工作模式。enabled=false=无卷（若仍有卷则先拍平迁移，破坏性、由调用方二次确认）；
	 * enabled=true=有卷（仅置位，书仍保持扁平直到用户 /volume add）。恒显式写回 use_volumes 使行为确定。
	 */
	async setVolumeMode(storyName: string, enabled: boolean): Promise<{ flattened: boolean; movedKeys: string[]; deletedVolumes: number; movedDocs: number }> {
		let result = { flattened: false, movedKeys: [] as string[], deletedVolumes: 0, movedDocs: 0 };
		if (!enabled) {
			const vols = await this.loadVolumes(storyName);
			if (Object.keys(vols).length) {
				const r = await this.flattenToRoot(storyName); // 破坏性迁移在此执行
				result.flattened = true;
				result.movedKeys = r.movedKeys;
				result.deletedVolumes = r.deletedVolumes;
				result.movedDocs = r.movedDocs;
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
			return this.resolveChapterDocPath(`${ch.dir.path}/场景.md`);
		}
		if (vol) { // /analyze-cast：卷级场景（归属本卷的场景设定）落卷实体目录，与 loadAllScenes 的卷级读取口径一致
			const v = (await this.loadVolumes(storyName))[vol];
			if (!v) throw new Error(`卷不存在：${vol}（无法定位其《场景》文件）`);
			return this.resolveVolumeDocPath(this.volumeDirPath(storyName, v), v.name, "场景.md");
		}
		return `${this.deskDocsPath(storyName)}/场景.md`; // 书级全局场景在「案头资料/」
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
		} else if (vol) {
			const v = (await this.loadVolumes(storyName))[vol];
			heading = v ? v.name : "场景"; // 卷级：H1 用卷名（与卷级人物同口径）
		} else {
			const state = await this.loadState(storyName);
			heading = this.bookTitle(storyName, state);
		}
		await this.writeDoc(await this.sceneFilePath(storyName, chapNum, vol), doc.formatScenes(heading, scenes));
	}

	async loadAllScenes(storyName: string): Promise<Record<string, doc.SceneDoc>> {
		const result: Record<string, doc.SceneDoc> = {};
		const base = this.deskDocsPath(storyName); // 书级全局《场景》在「案头资料/」
		Object.assign(result, doc.parseScenes(await this.readDoc(`${base}/场景.md`), 0));
		for (const [volId, vol] of Object.entries(await this.loadVolumes(storyName))) { // v0.0.15：卷级设定五件套并入（章节级同名条目优先级更高）
			const parsed = doc.parseScenes(await this.readDoc(this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "场景.md")), 0);
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
		// v0.0.15：跨章移动须同时看「本地号」与「卷归属」；patch.vol 约定 undefined=不变、""/null=显式移到「书稿/」直属（未归卷）
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
			return this.resolveChapterDocPath(`${ch.dir.path}/人物.md`);
		}
		if (vol) { // v0.2.0+：卷级人物（归属本卷的角色设定）落卷实体目录，与 loadAllCharacters 的卷级读取口径一致
			const v = (await this.loadVolumes(storyName))[vol];
			if (!v) throw new Error(`卷不存在：${vol}（无法定位其《人物》文件）`);
			return this.resolveVolumeDocPath(this.volumeDirPath(storyName, v), v.name, "人物.md");
		}
		return `${this.deskDocsPath(storyName)}/人物.md`; // 书级全局人物在「案头资料/」
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
		} else if (vol) {
			const v = (await this.loadVolumes(storyName))[vol];
			heading = v ? v.name : "人物"; // 卷级：H1 用卷名（formatCharacters 拼成「# <卷名> 人物」）
		} else {
			const state = await this.loadState(storyName);
			heading = this.bookTitle(storyName, state);
		}
		await this.writeDoc(await this.characterFilePath(storyName, chapNum, vol), doc.formatCharacters(heading, characters));
	}

	async loadAllCharacters(storyName: string): Promise<Record<string, doc.CharacterDoc>> {
		const result: Record<string, doc.CharacterDoc> = {};
		const base = this.deskDocsPath(storyName); // 书级全局《人物》在「案头资料/」
		Object.assign(result, doc.parseCharacters(await this.readDoc(`${base}/人物.md`), 0));
		for (const [volId, vol] of Object.entries(await this.loadVolumes(storyName))) { // v0.0.15：卷级设定五件套并入（章节级同名条目优先级更高）
			const parsed = doc.parseCharacters(await this.readDoc(this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "人物.md")), 0);
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

	// ---------- /analyze-cast 分层读写（人物/场景按 ref 定位书/卷/章三层）----------

	/** 读全部三层《人物.md》（书级 + 每卷 + 每章），保持层间独立、逐层打标 ref；文件缺失的层返回空条目 */
	async loadCharacterLayerDocs(storyName: string): Promise<CastLayerDoc<doc.CharacterDoc>[]> {
		const out: CastLayerDoc<doc.CharacterDoc>[] = [];
		const base = this.deskDocsPath(storyName); // 书级全局《人物》在「案头资料/」
		out.push({ ref: { scope: "book" }, entries: doc.parseCharacters(await this.readDoc(`${base}/人物.md`), 0) });
		for (const [volId, vol] of Object.entries(await this.loadVolumes(storyName))) {
			const entries = doc.parseCharacters(
				await this.readDoc(this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "人物.md")),
				0
			);
			for (const c of Object.values(entries)) c.vol = volId; // 运行态标签（不落盘）
			out.push({ ref: { scope: "volume", volId }, entries });
		}
		for (const ch of await this.listChapters(storyName)) {
			const entries = doc.parseCharacters(await this.readDoc(`${ch.dir.path}/人物.md`), ch.num);
			if (ch.vol) for (const c of Object.values(entries)) c.vol = ch.vol;
			out.push({ ref: { scope: "chapter", chapterKey: ch.key }, entries });
		}
		return out;
	}

	/** 读全部三层《场景.md》，口径同 loadCharacterLayerDocs */
	async loadSceneLayerDocs(storyName: string): Promise<CastLayerDoc<doc.SceneDoc>[]> {
		const out: CastLayerDoc<doc.SceneDoc>[] = [];
		const base = this.deskDocsPath(storyName); // 书级全局《场景》在「案头资料/」
		out.push({ ref: { scope: "book" }, entries: doc.parseScenes(await this.readDoc(`${base}/场景.md`), 0) });
		for (const [volId, vol] of Object.entries(await this.loadVolumes(storyName))) {
			const entries = doc.parseScenes(
				await this.readDoc(this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "场景.md")),
				0
			);
			for (const s of Object.values(entries)) s.vol = volId;
			out.push({ ref: { scope: "volume", volId }, entries });
		}
		for (const ch of await this.listChapters(storyName)) {
			const entries = doc.parseScenes(await this.readDoc(`${ch.dir.path}/场景.md`), ch.num);
			if (ch.vol) for (const s of Object.values(entries)) s.vol = ch.vol;
			out.push({ ref: { scope: "chapter", chapterKey: ch.key }, entries });
		}
		return out;
	}

	/** 把一层人物条目整体写回（ref → (本地章号, 卷) 定位；book=章号0无卷、volume=章号0带卷、chapter=复合键解析） */
	async saveCharacterLayer(storyName: string, ref: CastLayerRef, entries: Record<string, doc.CharacterDoc>): Promise<void> {
		if (ref.scope === "chapter") {
			const key = String(ref.chapterKey ?? "").trim();
			if (!key) throw new Error("缺少章节键，无法写入章级《人物》");
			const { vol, num } = parseChKey(key);
			await this.saveCharactersFile(storyName, num, entries, vol ?? null);
			return;
		}
		if (ref.scope === "volume") {
			const volId = String(ref.volId ?? "").trim();
			if (!volId) throw new Error("缺少卷 id，无法写入卷级《人物》");
			await this.saveCharactersFile(storyName, 0, entries, volId);
			return;
		}
		await this.saveCharactersFile(storyName, 0, entries, null);
	}

	/** 把一层场景条目整体写回，口径同 saveCharacterLayer */
	async saveSceneLayer(storyName: string, ref: CastLayerRef, entries: Record<string, doc.SceneDoc>): Promise<void> {
		if (ref.scope === "chapter") {
			const key = String(ref.chapterKey ?? "").trim();
			if (!key) throw new Error("缺少章节键，无法写入章级《场景》");
			const { vol, num } = parseChKey(key);
			await this.saveScenesFile(storyName, num, entries, vol ?? null);
			return;
		}
		if (ref.scope === "volume") {
			const volId = String(ref.volId ?? "").trim();
			if (!volId) throw new Error("缺少卷 id，无法写入卷级《场景》");
			await this.saveScenesFile(storyName, 0, entries, volId);
			return;
		}
		await this.saveScenesFile(storyName, 0, entries, null);
	}

	/** 读全部三层《人物关系.md》（书级 + 每卷 + 每章）合并为条目列表，供跨层去重；文件缺失的层跳过 */
	async readAllRelationshipEntries(storyName: string): Promise<doc.RelationshipEntry[]> {
		const out: doc.RelationshipEntry[] = [];
		const base = this.deskDocsPath(storyName); // 书级《人物关系》在「案头资料/」
		let bookText = await this.readDoc(`${base}/人物关系.md`);
		if (!bookText.trim()) bookText = await this.readDoc(`${base}/角色关系.md`); // 旧别名兜底（与写作上下文同口径）
		out.push(...doc.parseRelationships(bookText));
		for (const vol of Object.values(await this.loadVolumes(storyName))) {
			out.push(...doc.parseRelationships(await this.readDoc(this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "人物关系.md"))));
		}
		for (const ch of await this.listChapters(storyName)) {
			out.push(...doc.parseRelationships(await this.readDoc(this.resolveChapterDocPath(`${ch.dir.path}/人物关系.md`))));
		}
		return out;
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
		// v0.2.0+：chapter=0 时 vol 非空 = 卷级人物（归属本卷的角色设定，落卷实体目录）；无卷才落书级（「案头资料/」）
		const vol = input.vol?.trim() || undefined;
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
		// v0.0.15：跨章移动须同时看「本地号」与「卷归属」；patch.vol 约定 undefined=不变、""/null=显式移到「书稿/」直属（未归卷）（保持旧版语义：移动时不合并其他字段改动）
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
		return doc.parseForeshadows(await this.readDoc(`${this.deskDocsPath(storyName)}/伏笔.md`), await this.buildVolIndex(storyName));
	}

	private async saveForeshadowsFile(storyName: string, items: doc.ForeshadowItem[]): Promise<void> {
		const path = `${this.deskDocsPath(storyName)}/伏笔.md`; // 书级《伏笔》在「案头资料/」
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

	// ---------- 世界观（案头资料/世界观.md）----------

	async readWorldDoc(storyName: string): Promise<doc.WorldSettingDoc> {
		const text = await this.readDoc(`${this.deskDocsPath(storyName)}/世界观.md`); // 书级《世界观》在「案头资料/」
		// v0.2.x+：附带清洗后全文——parseWorld 只识别固定字段行，自由格式设定（人物/时间线/自定义小节）会全部丢失；提示词注入优先用 fullText，保证任意写法的世界观都进上下文
		return { ...doc.parseWorld(text), fullText: doc.stripComments(text).trim() };
	}

	/** v0.3.0+「生成世界观」（auto-book 流水线首阶段）：全量写书级《世界观.md》（H1 `# <书名> 世界观` + 正文，正文首部 H1 与尾部空白已去，与 setPlanningGuide 同口径）；缺失则创建、存在则覆盖 */
	async setWorldDoc(storyName: string, bodyText: string): Promise<void> {
		const state = await this.loadState(storyName);
		const title = ((state?.title ?? "").trim()) || "未命名小说";
		let lines = String(bodyText ?? "").replace(/\s+$/, "").trim().split("\n");
		while (lines.length && /^#\s/.test(lines[0])) lines.shift(); // 剥掉模型自带的 H1，统一补规范 H1
		await this.writeDoc(`${this.deskDocsPath(storyName)}/世界观.md`, `# ${title} 世界观\n\n${lines.join("\n").trim()}\n`);
	}

	/** /world set <字段> <值>：世界/类型/规则/势力/地点/历史/力量体系 */
	async setWorldField(storyName: string, field: string, value: string): Promise<boolean> {
		const path = `${this.deskDocsPath(storyName)}/世界观.md`; // 书级《世界观》在「案头资料/」
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

	/** 删除章节：移入回收站、清理元数据；当前章回退到同容器最后一章。**被删号之后（同容器内）仍有章节时自动补洞**——复用 renumberChapters 把后续各章整体 -1（升序单遍顺延+文档/伏笔引用重写），保持容器内 1..N 连续 */
	async deleteChapter(storyName: string, chapterKey: string): Promise<{ title: string; resequenced: boolean }> {
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
		const oldFolder = ch.dir.name; // 第01章-旧名
		const newFolder = `第${String(num).padStart(2, "0")}章-${newTitle}`;
		const newPath = `${ch.parentPath}/${newFolder}`; // 保留所在容器（「书稿/」直属/卷实体目录）
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
		// 模板文件随章名同步为新格式（走真实 FS、非致命；不依赖索引，故放在 if 外）
		await this.syncChapterDocFileNames(newPath, oldFolder, newFolder, newTitle);
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
	 * 留下半套重排（断档残留）。超时返回 false。
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
			const want = String(parsed.num).padStart(2, "0"); // 索引滞后兜底：逐容器扫真实文件系统（「书稿/」直属+各卷实体目录）
			const base = this.manuscriptPath(storyName);
			const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
			const volByPath = new Map<string, string>();
			for (const v of Object.values(vols)) volByPath.set(this.volumeDirPath(storyName, v), v.id);
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

	/** 某容器（「书稿/」直属/卷实体目录）下全部 md：容器级文档 + 各章节目录内文件——作用域引用重写的扫描范围 */
	private async scopeMarkdownFiles(storyName: string, volId: string | null): Promise<TFile[]> {
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		const contPath = volId && vols[volId] ? this.volumeDirPath(storyName, vols[volId]) : this.manuscriptPath(storyName);
		const cont = this.vault.getAbstractFileByPath(contPath);
		if (!(cont instanceof TFolder)) return [];
		const files: TFile[] = cont.children.filter((c): c is TFile => c instanceof TFile && /\.(md|markdown)$/i.test(c.name));
		for (const child of cont.children) if (child instanceof TFolder && CHAPTER_DIR_RE.test(child.name)) files.push(...(await this.listMarkdownFiles(child)));
		return files;
	}

	/** 中断残留可能造成同容器同号双目录（复合键重复）——有序迁移遇到会错移，直接拒绝并提示手动清理 */
	private assertUniqueKeys(keys: string[]): void {
		const seen = new Set<string>();
		for (const k of keys) {
			if (seen.has(k)) throw new Error(`检测到重复章节目录：${k}（可能是上次操作中断的残留），请手动清理后重试`);
			seen.add(k);
		}
	}

	/** 快照完整性校验：listChapters 经元数据索引枚举子目录，索引滞后（刚手动建/改过章节目录）时可能漏掉磁盘上的存活章——迁移开始前发现即拒绝，避免改名目标撞上未入快照的存活章而中途报错中止 */
	private async assertSnapshotCoversDisk(storyName: string, chapters: Array<{ dir: TFolder }>): Promise<void> {
		const known = new Set(chapters.map((c) => c.dir.path));
		for (const contPath of await this.containerPaths(storyName)) {
			let listed: { folders?: string[] };
			try {
				listed = await this.vault.adapter.list(contPath);
			} catch {
				continue; // 不可读容器忽略（与 listChapters 口径一致）
			}
			for (const p of listed.folders ?? []) {
				if (!CHAPTER_DIR_RE.test(p.split("/").pop() ?? "")) continue;
				if (!known.has(p)) throw new Error(`Obsidian 索引尚未同步章节目录 ${p}（索引滞后），请等待片刻后重试`);
			}
		}
	}

	private async moveChapterDir(storyName: string, fromKey: string, toNum: number): Promise<void> {
		const src = await this.resolveChapterDir(storyName, fromKey);
		if (!src) throw new Error(`章节目录不存在：${fromKey}`);
		const oldPath = src.path;
		const parentPath = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : this.manuscriptPath(storyName); // 保留所在容器（「书稿/」直属/卷实体目录）
		const newPath = `${parentPath}/第${String(toNum).padStart(2, "0")}章-${safeFilename(src.title || `第${toNum}章`)}`;
		await this.vault.adapter.rename(oldPath, newPath); // 真实文件系统层整树改名（含 .space 等隐藏项），索引经 adapter 事件同步
		if (!(await this.settleTree([{ path: oldPath, expect: false }, { path: newPath, expect: true }]))) {
			throw new Error(`重命名未生效（旧目录仍在或新目录缺失），已中止以防产生重复章节：${oldPath} → ${newPath}`);
		}
		// 新格式文件名含章号：目录改名后同步把模板文件重命名为新目录名前缀（走真实 FS、非致命，避免中断重排）
		await this.syncChapterDocFileNames(newPath, oldPath.slice(oldPath.lastIndexOf("/") + 1), newPath.slice(newPath.lastIndexOf("/") + 1), src.title);
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
	 * 重编号：每个容器（「书稿/」直属/各卷实体目录）独立压缩为连续 1..N（升序单遍有序迁移、无临时槽，中断不留大号幽灵章；以磁盘为准）。
	 * v0.0.15：执行前把全书 md 备份到 _backup/卷内重排_<时间戳>/（角色改名同款 file-level copy，老书卷内迁移入口）；
	 * 裸「第X章」引用只在受影响容器的文件里按其局部映射重写——跨卷显式写法（「第二卷·第5章」「章节：<卷名>第5章」）不识别、不改写；
	 * 伏笔.md 条目按复合键结构化重映射。
	 */
	async renumberChapters(storyName: string): Promise<{ ok: boolean; msg: string }> {
		const folder = this.storyFolder(storyName);
		if (!folder) return { ok: false, msg: "没有章节" };
		const chapters = await this.listChapters(storyName);
		if (chapters.length === 0) return { ok: false, msg: "没有章节" };
		this.assertUniqueKeys(chapters.map((c) => c.key)); // 中断残留的重复键会令有序迁移错移，直接拒绝
		await this.assertSnapshotCoversDisk(storyName, chapters); // 索引滞后于磁盘时开始前即拒绝，避免改名目标撞上未入快照的存活章

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
		if (!anyGap) return { ok: false, msg: "各容器内章节号均已连续（「书稿/」直属与各卷各自 1..N），无需调整" };

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
			const map: Record<number, number> = {};
			s.list.forEach((c, i) => (map[c.num] = i + 1));
			const moving = s.list.filter((c, i) => c.num !== i + 1).map((c) => c.key); // 只移动真正变号的章——减少重命名次数即减少出错面
			if (!moving.length) continue;
			scopeMaps.set(s.volId, map);
			// 升序单遍：位置 i 的章目标位 i+1 必空（洞，或刚被前一步从该位移走时腾出）——无临时槽，中断也不会留下大号幽灵章
			for (let i = 0; i < s.list.length; i++) {
				if (s.list[i].num === i + 1) continue;
				await this.moveChapterDir(storyName, s.list[i].key, i + 1);
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

		return { ok: true, msg: `已按容器压缩为连续章号（共移动 ${movedTotal} 章），原文件已备份到 _backup/卷内重排_${ts}/` };
	}

	/**
	 * 在 refKey 之前/之后插入新空章节：继承参照章所在容器的局部空间——该位置被占时，同容器内所有号 ≥ 插入号的章整体 +1（降序单遍顺延，目标位必空、无临时槽），
	 * 并同步重写该容器文档内「第N章」引用与伏笔.md；插入点为空位（如插到断档处）则直接落位不挪动他人。
	 * createChapterAt 会把 current_chapter 设为新章——插入后自然聚焦到新章。返回新章复合键、本地号与其正文路径。
	 */
	async insertChapter(storyName: string, refKey: string, pos: "before" | "after", title: string): Promise<{ key: string; newNum: number; path: string }> {
		const chapters = await this.listChapters(storyName);
		this.assertUniqueKeys(chapters.map((c) => c.key));
		await this.assertSnapshotCoversDisk(storyName, chapters); // 索引滞后于磁盘时开始前即拒绝，避免顺延目标撞上未入快照的存活章
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
			// 降序单遍：最高号章先移，目标位 num+1 必空（最高章之上无章；其下各章的目标位刚被上一步腾出）——无临时槽，中断也不会留下大号幽灵章
			for (let i = affectedKeys.length - 1; i >= 0; i--) {
				await this.moveChapterDir(storyName, affectedKeys[i], parseChKey(affectedKeys[i]).num + 1);
			}
			path = await this.createChapterAt(storyName, newNum, title, scopeVol ?? ""); // 插入位已腾空
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
		return this.writePackFile(this.deskDocsPath(storyName), fileName, outputPath, built); // 未指定输出路径时默认落「案头资料/」
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
		return this.writePackFile(this.deskDocsPath(storyName), fileName, outputPath, await this.buildPackParts(chapters)); // 未指定输出路径时默认落「案头资料/」
	}

	/** 导出书稿/卷节点「导出…」共用引擎：所选范围全部章节《章节.md》正文合一 MD，阅读序排列。spec 语义同 /pack——**未锁卷**（forcedVolId===undefined）时留空/all/全部=整本（不回落 current_volume、区别于 /pack；支持卷名前缀+区间/列表）；**锁定某卷**（forcedVolId!==undefined）时留空/all=该卷全部章节、区间/列表按该卷本地号解析（无歧义）。有卷模式按容器装配：**每个卷组前都带「# 第N卷 · 卷名」标题行，无章的空卷也照样输出其卷名行**（卷号按《卷.md》order 序号），「书稿/」直属未归卷章节排最前不带标题；无卷模式（use_volumes===false）平铺不带任何卷标题。**每章正文开头自带的章节号行（「第N章 标题」等，见 md_docs.stripLeadingChapterHeading）先剥掉，章号只用代码生成的「## 第N章 标题」**。**默认文件名按口径区分**：限定某卷=`<书名>-<卷名>-范围.md`（范围取实际有正文章节号：单章 第N章／连续 第X-Y章／离散 第1、4、5章），整本或未归卷域=`<书名>-书稿.md`；重导覆盖同名文件 */
	async packStory(storyName: string, spec: string, forcedVolId?: string | null, outputPath = "") {
		const expr = String(spec ?? "").trim();
		if (forcedVolId === undefined && (!expr || /^(all|全部)$/i.test(expr))) {
			return this.packStoryByKeys(storyName, (await this.listChapters(storyName)).map((c) => c.key), { whole: true }, outputPath); // 整本（含「书稿/」直属未归卷 + 各卷，空卷亦出卷名行）
		}
		const res = await this.resolvePackSelection(storyName, expr, forcedVolId); // 锁卷时留空/all=该卷全章
		if ("ambiguous" in res) throw new Error("PACK_AMBIGUOUS_CONTAINER"); // 调用方应 pickAction 选容器后以 forcedVolId 重入
		return this.packStoryByKeys(storyName, res.keys, { whole: false, volId: res.volId ?? "" }, outputPath); // ""=未归卷（「书稿/」直属）
	}

	private async packStoryByKeys(
		storyName: string,
		keys: string[],
		scope: { whole: boolean; volId?: string },
		outputPath = ""
	): Promise<{ path: string; packed: Array<{ num: number; words: number }>; skipped: number[] }> {
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		let vols: doc.VolumeInfo[] = [];
		try {
			if (state.use_volumes !== false) vols = await this.volumeList(storyName); // 无卷模式一律平铺输出（与写字台展示语义一致）；《卷.md》缺失按无卷兜底
		} catch { /* ignore */ }
		const volSeq = new Map(vols.map((v, i) => [v.id, i + 1])); // 卷号=卷列表序号（与写字台「第N卷 · 卷名」一致）
		const all = await this.listChapters(storyName); // 阅读序：「书稿/」直属在前 + 各卷按《卷.md》order、组内本地号升序
		const picked = new Set(keys);
		if (!all.some((c) => picked.has(c.key))) throw new Error("没有可导出的章节");
		const entriesOf = (volId: string | null) => all.filter((c) => (c.vol ?? null) === volId && picked.has(c.key));

		const bodyRe = /^#\s.*$/m;
		const parts: string[] = [];
		const packed: Array<{ num: number; words: number }> = [];
		const skipped: number[] = [];
		const appendChapter = async (ch: (typeof all)[number]): Promise<void> => {
			const f = this.vault.getAbstractFileByPath(this.resolveChapterDocPath(`${ch.dir.path}/章节.md`));
			let text = f instanceof TFile ? stripAiWordMarks(await this.vault.read(f)) : ""; // 剥离错别字下划线等标记，导出合辑不含 span
			text = doc.stripLeadingChapterHeading(text.replace(bodyRe, "").trim()); // 正文自带的「第N章 标题」行一并去掉，章节号只用代码生成
			if (!text) {
				skipped.push(ch.num);
				return;
			}
			parts.push(`## 第${doc.numToCn(ch.num)}章 ${ch.title}\n\n${text}`);
			packed.push({ num: ch.num, words: countPureWords(text) });
		};
		const volumeHeader = (v: doc.VolumeInfo): string => `# ${volSeq.get(v.id) ? `第${doc.numToCn(volSeq.get(v.id)!)}卷 · ` : ""}${v.name || v.id}`;

		if (scope.whole) {
			for (const ch of entriesOf(null)) await appendChapter(ch); // 「书稿/」直属未归卷章节：不带标题、排在最前
			for (const v of vols) { // 有卷模式：每卷组前贴「第N卷 · 卷名」H1 行——无章的空卷也照样输出其卷名行
				parts.push(volumeHeader(v));
				for (const ch of entriesOf(v.id)) await appendChapter(ch);
			}
		} else {
			const volId = scope.volId ?? null; // ""=未归卷（「书稿/」直属）
			if (volId) {
				const v = vols.find((x) => x.id === volId);
				if (v) parts.push(volumeHeader(v)); // 限定单卷导出同样带该卷标题行
			}
			for (const ch of entriesOf(volId)) await appendChapter(ch);
		}
		if (!packed.length) throw new Error("所选章节均无正文，未生成文件");
		const title = this.bookTitle(storyName, state);
		let base = `${title}-书稿`; // 整本 / 未归卷域（含无卷平铺）默认名
		if (!scope.whole && scope.volId) { // 限定了某卷 → 按「书名-卷名-范围」命名（范围取实际有正文章节号：单章 第N章、连续 第X-Y章、离散 第1、4、5章）
			const v = vols.find((x) => x.id === scope.volId);
			const nums = [...packed.map((p) => p.num)].sort((a, b) => a - b);
			const first = nums[0];
			const last = nums[nums.length - 1];
			const contiguous = nums.every((n, i) => n === first + i);
			const rangePart = nums.length === 1 ? `第${nums[0]}章` : contiguous ? `第${first}-${last}章` : `第${nums.join("、")}章`;
			base = `${title}${v?.name ? `-${v.name}` : ""}-${rangePart}`;
		}
		const fileName = safeFilename(base) + ".md";
		return this.writePackFile(this.deskDocsPath(storyName), fileName, outputPath, { parts, packed, skipped }); // 未指定输出路径时默认落「案头资料/」
	}

	/** /pack 与导出卷共用的合辑装配：逐章读《章节.md》正文（去 H1 标题行、再去正文开头自带的章节号行）、以分隔线拼接；空正文章节跳过并计入 skipped */
	private async buildPackParts(
		chapters: Array<{ key: string; num: number; title: string; dir: TFolder }>
	): Promise<{ parts: string[]; packed: Array<{ num: number; words: number }>; skipped: number[] }> {
		const bodyRe = /^#\s.*$/m; // 正文标题行
		const parts: string[] = [];
		const packed: Array<{ num: number; words: number }> = [];
		const skipped: number[] = [];
		for (const ch of chapters) {
			const f = this.vault.getAbstractFileByPath(this.resolveChapterDocPath(`${ch.dir.path}/章节.md`));
			let text = f instanceof TFile ? stripAiWordMarks(await this.vault.read(f)) : ""; // 剥离错别字下划线等标记，导出合辑不含 span
			text = doc.stripLeadingChapterHeading(text.replace(bodyRe, "").trim()); // 正文自带的「第N章 标题」行一并去掉，章节号只用代码生成
			if (!text) {
				skipped.push(ch.num);
				continue;
			}
			parts.push(`## 第${doc.numToCn(ch.num)}章 ${ch.title}\n\n${text}`); // v0.1.6+：章节号带「第」前缀，对齐 CLI /pack（如「## 第二十章 虎妖初现」）
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
		await this.ensureLayout(storyName, true); // 布局收口（/scan 修复入口）：force 绕过缓存强制重探
		const base = this.storyPath(storyName);
		const folder = this.storyFolder(storyName);
		if (!folder) throw new Error(`小说目录不存在：${base}`);
		let created = 0;
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		const desk = this.deskDocsPath(storyName); // 书级文档补建落点＝「案头资料/」
		for (const [fname, tpl] of [
			["大纲.md", outlineTemplate(this.bookTitle(storyName, state))],
			["世界观.md", WORLD_TEMPLATE],
			["伏笔.md", FORESHADOW_TEMPLATE],
			["笔记.md", NOTES_TEMPLATE],
		] as Array<[string, string]>) {
			if ((await this.ensureDoc(`${desk}/${fname}`, tpl)) === "created") created++;
		}
		if ((await this.ensureDoc(`${base}/卷.md`, VOLUME_TEMPLATE)) === "created") created++; // 系统管理的《卷.md》留书根
		const diskChapters = await this.listChapters(storyName);
		const vols = await this.loadVolumes(storyName);
		// v0.0.15：既有卷实体目录的卷级设定五件套缺失补建（与建卷时同模板，同一清单来源 volumeDocTemplates）
		for (const vol of Object.values(vols)) {
			const volDir = this.volumeDirPath(storyName, vol); // 卷实体目录在「书稿/」下
			for (const [fname, tpl] of this.volumeDocTemplates(vol)) {
				if ((await this.ensureDoc(this.resolveVolumeDocPath(volDir, vol.name, fname), tpl)) === "created") created++;
			}
		}
		const seen = new Set<string>(diskChapters.map((c) => c.key));
		let volumeFixed = 0;
		for (const ch of diskChapters) {
			for (const [base, tpl] of this.chapterDocTemplates(ch.num, ch.title)) { // 与建章播种同一清单来源
				if ((await this.ensureDoc(`${ch.dir.path}/${chapterDocPhysicalName(ch.dir.name, base)}`, tpl)) === "created") created++;
			}
			const info = doc.parseChapterInfo(await this.readDoc(`${ch.dir.path}/章节信息.md`));
			const f = this.vault.getAbstractFileByPath(this.resolveChapterDocPath(`${ch.dir.path}/章节.md`));
			const words = countPureWords(f instanceof TFile ? stripAiWordMarks(await this.vault.read(f)) : ""); // 剥离错别字下划线等标记，避免 span 标签虚增字数
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

	// ---------- 更新故事状态文档（/update-state，轻量同步）----------

	/**
	 * 以磁盘章节为准更新《故事状态.md》的 chapters 镜像：缺失的补、多余的删，全部条目刷新 title/volume/words
	 * （卷归属以目录位置为准，同 /scan）；顺带重算 total_words、校正悬空 current_chapter/current_volume。
	 * 书级参数与正文原样不动（saveState 语义：只重写 frontmatter）、不创建任何模板文档、不改《章节信息》——
	 * 补齐缺失文档/修正卷字段等重活仍走 rescanStory（/scan）。
	 */
	async syncStateDoc(storyName: string): Promise<{ added: number; removed: number; refreshed: number; chapters: number; totalWords: number }> {
		const diskChapters = await this.listChapters(storyName);
		const seen = new Set<string>(diskChapters.map((c) => c.key));
		const state = (await this.loadState(storyName)) ?? this.emptyState(storyName);
		let added = 0;
		let removed = 0;
		let refreshed = 0;
		for (const ch of diskChapters) {
			const f = this.vault.getAbstractFileByPath(this.resolveChapterDocPath(`${ch.dir.path}/章节.md`));
			const words = countPureWords(f instanceof TFile ? stripAiWordMarks(await this.vault.read(f)) : ""); // 与 /scan 同口径：剥离错别字等标记防虚增
			const meta: ChapterMeta = { title: ch.title, words, volume: ch.vol ?? undefined }; // 卷归属以目录位置为准
			const prev = state.chapters[ch.key];
			if (!prev) added++;
			else if (prev.title !== meta.title || (prev.volume ?? "") !== (meta.volume ?? "") || prev.words !== meta.words) refreshed++;
			state.chapters[ch.key] = meta;
		}
		for (const key of Object.keys(state.chapters)) {
			if (!seen.has(key)) {
				delete state.chapters[key]; // 磁盘已无对应目录的多余条目（复合键口径，同 /scan）
				removed++;
			}
		}
		await this.recomputeTotalWords(storyName, state);
		const vols = await this.loadVolumes(storyName).catch((): Record<string, doc.VolumeInfo> => ({}));
		if (state.current_volume && !vols[state.current_volume]) delete state.current_volume;
		if (state.current_chapter != null && !seen.has(state.current_chapter)) {
			state.current_chapter = diskChapters.length ? diskChapters[diskChapters.length - 1].key : null; // 悬空激活回退阅读序末章（同 validatedState 语义）
		}
		await this.saveState(storyName, state);
		return { added, removed, refreshed, chapters: diskChapters.length, totalWords: state.total_words };
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
		const raw = await this.readDoc(`${this.deskDocsPath(storyName)}/大纲.md`); // 书级《大纲》在「案头资料/」
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

	/** v0.2.10+「从卷大纲生成章节」：读指定卷《卷大纲.md》清洗文本（去注释 + 去首部 H1 标题行，与 loadWritingData 注入口径一致）；卷不存在或文件缺失返回空串 */
	async readVolumeOutline(storyName: string, volId: string): Promise<string> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, volId);
		if (!vol) return "";
		const volDir = this.volumeDirPath(storyName, vol); // 卷实体目录在「书稿/」下
		const lines = doc.stripComments((await this.readDoc(this.resolveVolumeDocPath(volDir, vol.name, "卷大纲.md"))).trim()).split("\n");
		while (lines.length && /^#\s/.test(lines[0])) lines.shift(); // 去 H1 标题行
		return lines.join("\n").trim();
	}

	/** v0.2.11+「自动生成卷大纲」：读目标卷《卷大纲.md》原始文本（不清洗，保留注释与 H1——供追加模式在原文末尾续写）；卷不存在或文件缺失返回空串 */
	async readVolumeOutlineRaw(storyName: string, volId: string): Promise<string> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, volId);
		if (!vol) return "";
		const volDir = this.volumeDirPath(storyName, vol); // 卷实体目录在「书稿/」下
		return (await this.readDoc(this.resolveVolumeDocPath(volDir, vol.name, "卷大纲.md"))).trim();
	}

	/** v0.2.11+「自动生成卷大纲」：全量写目标卷《卷大纲.md》（H1 `# <卷名> 卷大纲` + 正文，正文尾部空白已去）；卷不存在抛错 */
	async setVolumeOutline(storyName: string, volId: string, bodyText: string): Promise<void> {
		const vols = await this.loadVolumes(storyName);
		const vol = this.findVolumeIn(vols, volId);
		if (!vol) throw new Error(`卷不存在：${volId}`);
		const volDir = this.volumeDirPath(storyName, vol); // 卷实体目录在「书稿/」下
		const body = String(bodyText ?? "").replace(/\s+$/, "");
		await this.writeDoc(this.resolveVolumeDocPath(volDir, vol.name, "卷大纲.md"), `# ${vol.name} 卷大纲\n\n${body}\n`);
	}

	/** v0.2.11+「自动生成卷大纲」：读全书《大纲.md》清洗文本（与 readGlobalOutlineRaw/写作上下文注入同口径）；缺失返回空串 */
	async readGlobalOutline(storyName: string): Promise<string> {
		return this.readGlobalOutlineRaw(storyName);
	}

	/** v0.2.x+「生成书籍大纲」：读全书《大纲.md》原始文本（不清洗，保留注释与 H1——供追加模式在原文末尾续写）；文件缺失返回空串 */
	async readGlobalOutlineFile(storyName: string): Promise<string> {
		return (await this.readDoc(`${this.deskDocsPath(storyName)}/大纲.md`)).trim(); // 书级《大纲》在「案头资料/」
	}

	/** v0.2.x+「生成书籍大纲」：全量写全书《大纲.md》（H1 `# <书名> 大纲` + 正文 + 标记帮助尾注，与初始模板 outlineTemplate 一致；正文尾部空白已去） */
	async setGlobalOutline(storyName: string, bodyText: string): Promise<void> {
		const state = await this.loadState(storyName);
		const title = ((state?.title ?? "").trim()) || "未命名小说";
		const body = String(bodyText ?? "").replace(/\s+$/, "");
		await this.writeDoc(`${this.deskDocsPath(storyName)}/大纲.md`, appendOutlineMarkerHelp(`# ${title} 大纲\n\n${body}\n`)); // 书级《大纲》在「案头资料/」
	}

	/** /export-ai-prompts：把实拼的 AI 提示词文档写到书根各阶段独立文件（案头资料、非书稿；重复导出整体覆盖） */
	async savePromptExportDocs(storyName: string, entries: Array<{ path: string; content: string }>): Promise<void> {
		for (const { path, content } of entries) {
			await this.writeDoc(path, content);
		}
	}

	// ---------- v0.2.13+ 策划指南 策划指南.md（书级单文件 案头资料/策划指南.md；仅供大纲类命令注入【策划规范】，不进写作命令/聊天面板） ----------

	planningGuidePath(storyName: string): string {
		return `${this.deskDocsPath(storyName)}/策划指南.md`; // 书级《策划指南》在「案头资料/」
	}

	/** v0.2.13+「策划指南」：读书级《策划指南.md》清洗文本（去注释 + 去首部 H1 标题行，与 readGlobalOutline 同口径）；缺失返回空串 */
	async readPlanningGuide(storyName: string): Promise<string> {
		const raw = await this.readDoc(this.planningGuidePath(storyName));
		let lines = doc.stripComments(raw.trim()).trim().split("\n");
		while (lines.length && /^#\s/.test(lines[0])) lines.shift();
		return lines.join("\n").trim();
	}

	/** v0.2.13+「策划指南」：全量写书级《策划指南.md》（H1 `# <书名> 策划指南` + 正文，正文尾部空白已去）；缺失则创建、存在则覆盖 */
	async setPlanningGuide(storyName: string, bodyText: string): Promise<void> {
		const state = await this.loadState(storyName);
		const title = ((state?.title ?? "").trim()) || "未命名小说";
		const body = String(bodyText ?? "").replace(/\s+$/, "");
		await this.writeDoc(this.planningGuidePath(storyName), `# ${title} 策划指南\n\n${body}\n`);
	}

	/** 读正文：剥离 AI 用语标红标签 + 去 "# " 标题行（对齐 _read_std_chapter_dir，摘要哈希基于此文本） */
	async readChapterContent(storyName: string, chapterKey: string): Promise<string> {
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) return "";
		return doc.stripTitleLine(stripAiWordMarks(await this.readDoc(`${ch.dir.path}/章节.md`)))[0];
	}

	/** v0.1.4+ 摘要来源文本：优先正文；无正文时回落《章节大纲》清洗文本按纲概括——哈希校验基于同一份「有效来源」，任一变化即旧摘要失效。两者皆空返回 null */
	async chapterSummarySource(storyName: string, chapterKey: string): Promise<{ text: string; viaOutline: boolean } | null> {
		const content = await this.readChapterContent(storyName, chapterKey);
		if (content.trim()) return { text: content, viaOutline: false };
		const outline = await this.readChapterOutlineForPrompt(storyName, chapterKey);
		if (outline.trim()) return { text: outline, viaOutline: true };
		return null;
	}

	/** 读某章已保存的 AI 摘要；缺失/无哈希/有效来源（正文或回落大纲）已变化时返回空串 */
	private async readFreshSummary(storyName: string, chapterKey: string): Promise<string> {
		const src = await this.chapterSummarySource(storyName, chapterKey);
		if (!src) return "";
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) return "";
		const raw = await this.readDoc(this.resolveChapterDocPath(`${ch.dir.path}/章节摘要.md`)); // 新格式 <编号>-<章节名>-摘要.md，缺失则自动回退旧前缀/裸基名
		if (!raw.trim()) return "";
		const m = /<!--\s*内容哈希[:：]\s*([0-9a-f]{32})\s*-->/.exec(raw);
		if (!m || m[1] !== md5(src.text)) return "";
		return doc.stripTitleLine(doc.stripComments(raw))[0];
	}

	/** v0.2.x+「生成书籍大纲」：读某章已保存且未失效的 AI 摘要（只读、不触发生成）；缺失/失效返回空串 */
	async readSavedChapterSummary(storyName: string, chapterKey: string): Promise<string> {
		return this.readFreshSummary(storyName, chapterKey);
	}

	/** v0.1.4+ 保存单章 AI 摘要并写入当前内容哈希头（对齐《卷摘要》格式；哈希基于有效来源文本） */
	async saveChapterSummary(storyName: string, chapterKey: string, summary: string): Promise<void> {
		const s = String(summary ?? "").trim();
		if (!s) throw new Error("摘要不能为空");
		const src = await this.chapterSummarySource(storyName, chapterKey);
		if (!src) throw new Error(`本章无可概括内容（正文与大纲均为空）：${chapterKey}`);
		const ch = await this.chapterDirOf(storyName, chapterKey);
		if (!ch) throw new Error(`章节不存在：${chapterKey}`);
		const num = parseChKey(chapterKey).num; // 落盘标题用容器内本地号
		await this.writeDoc(`${ch.dir.path}/${chapterDocPhysicalName(ch.dir.name, "章节摘要.md")}`, `# 第${num}章 摘要\n\n<!-- 内容哈希：${md5(src.text)} -->\n\n${s}\n`);
	}

	private genInFlight = new Map<string, Promise<string>>(); // v0.1.4+：在途生成任务缓存——并发组装共享同一 Promise，消除竞态窗口内对同章/同卷的双重 LLM 调用

	/** v0.1.4+ 确保某章有新鲜 AI 摘要（公开入口、含在途去重）：两个上下文组装交错并发时共享首个任务的生成结果，避免重复生成 */
	async ensureFreshChapterSummary(storyName: string, chapterKey: string, label?: string): Promise<string> {
		const k = `${storyName}\u0001ch\u0001${chapterKey}`;
		const inflight = this.genInFlight.get(k);
		if (inflight) return inflight;
		const p = this.doEnsureFreshChapterSummary(storyName, chapterKey, label).finally(() => this.genInFlight.delete(k));
		this.genInFlight.set(k, p);
		return p;
	}

	/** 已存且哈希匹配直接返回；否则经注入的 LLM 生成并落盘。无来源/未注入生成器/use_summaries=false/失败均返回空串（调用方回退原文预览，不阻断流程）。label=展示标签（含卷名前缀），供提示词「章节：」行 */
	private async doEnsureFreshChapterSummary(storyName: string, chapterKey: string, label?: string): Promise<string> {
		try {
			const state = await this.validatedState(storyName);
			if (state.use_summaries === false) return "";
			const src = await this.chapterSummarySource(storyName, chapterKey);
			if (!src || !this.generateChapterSummary) return "";
			const fresh = (await this.readFreshSummary(storyName, chapterKey)).trim();
			if (fresh) return fresh;
			const lbl = label?.trim() || (() => { const p = parseChKey(chapterKey); return `第${p.num}章`; })();
			this.onProgress?.(`正在生成「${lbl}」章节摘要…`); // v0.1.4+：延迟生成的进度反馈（LLM 调用可能耗时数十秒）
			const t = ((await this.generateChapterSummary({ storyName, chapterKey, label: lbl, sourceText: src.text, viaOutline: src.viaOutline })) ?? "").trim();
			if (!t) {
				console.warn(`[articlewriter] 章节摘要生成返回空（未落盘）：${storyName} ${chapterKey}`); // v0.2.x+：诊断日志——此前该路径完全静默，LLM 失败时用户只见进度提示、摘要却从未保存
				return "";
			}
			await this.saveChapterSummary(storyName, chapterKey, t);
			return t;
		} catch (e) {
			console.error(`[articlewriter] 章节摘要确保失败（未落盘）：${storyName} ${chapterKey}`, e); // v0.2.x+：诊断日志——保留「失败不阻断」语义，仅补可见性
			return ""; // 摘要失败不影响写作上下文组装/写盘流程
		}
	}

	// ---------- v0.0.15+ / v0.1.4+ 卷摘要（<volDir>/卷摘要.md，插件特有、CLI 无对应概念）----------
	// 格式对齐《章节摘要.md》：H1 标题 + <!-- 内容哈希 --> 校验头。v0.1.4+ 起**整体重建语义**——输入为本卷中已有且未过期的成员章 AI 摘要（只读收集，不主动触发其他章节生成）；
	// 指纹 = 各成员章「key|md5(已存且新鲜的章节摘要)」按阅读序拼接的 md5，与生成输入完全一致（旧版基于正文 md5 的文件首次使用必然失配→触发一次自愈重建）。
	// **延迟生成**：不再在写盘命令后 eager 刷新；上下文组装需要时经 ensureFreshVolumeSummary 按需生成并落盘。

	/** 本卷摘要指纹：全部有新鲜章节摘要的成员章按阅读序拼 key|md5(摘要) 再取 md5 */
	private async computeVolumeDigest(storyName: string, volId: string): Promise<string> {
		const parts: string[] = [];
		for (const c of await this.listChapters(storyName)) {
			if (parseChKey(c.key).vol !== volId) continue;
			const s = (await this.readFreshSummary(storyName, c.key)).trim(); // 仅计已存且未过期的章节摘要
			if (!s) continue;
			parts.push(`${c.key}|${md5(s)}`);
		}
		return md5(parts.join("\n"));
	}

	/** 读新鲜卷摘要（快速路径、不触发生成）；文件缺失/哈希不匹配（任一成员章节摘要已变或缺失）时返回空串 */
	async readFreshVolumeSummary(storyName: string, volId: string): Promise<string> {
		try {
			const vols = await this.loadVolumes(storyName);
			const vol = vols[volId];
			if (!vol) return "";
			const raw = await this.readDoc(this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "卷摘要.md")); // 文档/裸基名 → legacy 前缀 → 旧新格式
			if (!raw.trim()) return "";
			const m = /<!--\s*内容哈希[:：]\s*([0-9a-f]{32})\s*-->/.exec(raw);
			if (!m || m[1] !== (await this.computeVolumeDigest(storyName, volId))) return "";
			return doc.stripTitleLine(doc.stripComments(raw))[0].trim();
		} catch {
			return ""; // 读取失败按无摘要处理，不阻断写作上下文组装
		}
	}

	/** v0.1.4+ 确保某卷有新鲜《卷摘要》——延迟生成入口（上下文组装需要时调用）：
	 * ①只读收集本卷中**已有且未过期**的成员章《章节摘要》（不主动触发其他章节的 LLM 生成——只生成当前提示词真正用到的窗口章；无可用摘要则直接返回空串降级）；
	 * ②指纹=这些成员章摘要的 md5 拼接，与已存文件匹配则直接返回；
	 * ③否则以收集到的章节摘要为输入经注入 LLM 整体重建并落盘（随更多章节摘要陆续生成而增量变全）。
	 * use_summaries=false/无任何可概括章节/未注入生成器/失败均返回空串（该卷按无摘要降级，不阻断流程）。公开入口含在途去重——并发组装共享同一重建任务 */
	async ensureFreshVolumeSummary(storyName: string, volId: string): Promise<string> {
		const k = `${storyName}\u0001vol\u0001${volId}`;
		const inflight = this.genInFlight.get(k);
		if (inflight) return inflight;
		const p = this.doEnsureFreshVolumeSummary(storyName, volId).finally(() => this.genInFlight.delete(k));
		this.genInFlight.set(k, p);
		return p;
	}

	private async doEnsureFreshVolumeSummary(storyName: string, volId: string): Promise<string> {
		try {
			const state = await this.validatedState(storyName);
			if (state.use_summaries === false) return "";
			const vols = await this.loadVolumes(storyName);
			const vol = vols[volId];
			if (!vol) return "";
			const volName = vol.name || volId;
			const members = (await this.listChapters(storyName)).filter((c) => parseChKey(c.key).vol === volId); // listChapters 即阅读序
			const chapters: Array<{ key: string; label: string; title: string; summary: string }> = [];
			for (const c of members) {
				const s = (await this.readFreshSummary(storyName, c.key)).trim(); // v0.1.4+：只取**已生成且未过期**的章节摘要（只读收集）——不为卷重建主动触发其他章节的 LLM 生成；上下文组装真正需要的窗口章各自在 loadWritingData 中按需自生，缺失/过期的成员章跳过、待其进入前文窗口时再生成
				if (!s) continue;
				chapters.push({ key: String(c.key ?? ""), label: `${volName}·第${c.num}章`, title: state.chapters[c.key]?.title || "", summary: s });
			}
			if (!chapters.length || !this.generateVolumeSummary) return "";
			const stored = await this.readFreshVolumeSummary(storyName, volId);
			if (stored) return stored;
			this.onProgress?.(`正在依据 ${chapters.length} 个章节摘要生成「${volName}」卷摘要…`);
			const t = ((await this.generateVolumeSummary({ storyName, volId, volumeName: volName, chapters })) ?? "").trim();
			if (!t) {
				console.warn(`[articlewriter] 卷摘要生成返回空（未落盘）：${storyName} ${volId}`); // v0.2.x+：诊断日志——同章节摘要，此前该路径完全静默
				return "";
			}
			await this.saveVolumeSummary(storyName, volId, t);
			return t;
		} catch (e) {
			console.error(`[articlewriter] 卷摘要确保失败（未落盘）：${storyName} ${volId}`, e); // v0.2.x+：诊断日志——保留「失败不阻断」语义，仅补可见性
			return ""; // 卷摘要失败不影响写作上下文组装/写盘流程
		}
	}

	/** v0.2.23+ 只读检查：某卷是否有任何成员章存在「已生成且未过期」的《章节摘要》（收集口径与 doEnsureFreshVolumeSummary 一致）——只读导出场景填占位符的门槛：无成员摘要的卷运行时也跳过（不占槽/不出节），占位符同样不得填入 */
	private async volumeHasFreshMemberSummary(storyName: string, volId: string): Promise<boolean> {
		const members = (await this.listChapters(storyName)).filter((c) => parseChKey(c.key).vol === volId);
		for (const c of members) if ((await this.readFreshSummary(storyName, c.key)).trim()) return true;
		return false;
	}

	/** 保存卷摘要并写入当前内容哈希头（指纹口径与 computeVolumeDigest 一致） */
	async saveVolumeSummary(storyName: string, volId: string, summary: string): Promise<void> {
		const vols = await this.loadVolumes(storyName);
		const vol = vols[volId];
		if (!vol) throw new Error(`卷不存在：${volId}`);
		const hash = await this.computeVolumeDigest(storyName, volId);
		await this.writeDoc(
			this.resolveVolumeDocPath(this.volumeDirPath(storyName, vol), vol.name, "卷摘要.md"), // 文档/裸基名 → legacy 前缀 → 旧新格式
			`# ${vol.name || volId} 卷摘要\n\n<!-- 内容哈希：${hash} -->\n\n${summary}\n`
		);
	}

	/**
	 * 组装写作提示词所需的磁盘数据。
	 * v0.0.15：chapterNum=阅读序位置（ordinal，跨卷连续），本地章号仅用于落盘标题与容器内引用；
	 * prevChapters/summaries 按阅读序窗口取（可跨卷延续）。副作用：从全局大纲与本章大纲抽取 [伏]…[/] 标记并持久化到 伏笔.md。
	 * v0.0.15 三层上下文：activeVolId/exclude*Names/volSummary 供分层渲染；v0.2.24+ 文档原文不再在此读取组装——三层路径经 docPaths 返回，由调用方声明 spec 装配（assemblePromptFiles）。
	 * v0.1.4+：①前文窗口章数 N=data.json settings.prevChapters（getPrevChapters 注入、缺省 3）且**限本容器**——卷模式不再拉取他卷章节，缺口以最近各前卷《卷摘要》填充（prevVolSummaries，由近及远）；
	 * ②**摘要全部延迟生成**（不在写盘命令后 eager 刷新）：窗口章/前卷/本卷需要时经 ensureFresh* 按需触发 LLM 并经 onProgress 给用户进度反馈——窗口章无正文时回落《章节大纲》作来源（预览即大纲文本），缺失/过期经 ensureFreshChapterSummary 生成落盘；
	 * ③**卷摘要=本卷全部成员章新鲜章节摘要的全量重建**（ensureFreshVolumeSummary，指纹=各章「key|md5(摘要)」拼接 md5；旧版基于正文哈希的文件首次使用自愈重建一次）；
	 * ④角色范围收窄——跨容器不深入他章《人物.md》：书级文档恒含、写卷内时排除「书稿/」直属章节级条目、他卷仅取其卷级《人物.md》条目且仅限阅读序在前者。
	 */
	async loadWritingData(
		storyName: string,
		chapterKey: string,
		opts?: {
			includeCurrentSummary?: boolean;
			/** 允许按需触发摘要的 LLM 生成（默认 true）。**只读展示场景必须传 false**——否则一个"读上下文算字数"的动作会顺带烧 token 生成摘要并把生成过程面板顶出来（如 LLM 对话框刷新提示词标签） */
			ensureSummaries?: boolean;
			/** v0.2.23+ 只读导出场景（/export-ai-prompts）：与 ensureSummaries=false 联用，摘要缺失时把该占位文本填入对应槽位（窗口章摘要/本卷摘要/前卷摘要）而非留空——导出文档据此明示「此处有摘要、尚未生成」；运行时写作命令不传 */
			missingSummaryPlaceholder?: string;
		}
	): Promise<import("./prompts").WritingContextInput & { savedForeshadows: number; docPaths: WritingDocPaths; nextN: number }> {
		const state = await this.validatedState(storyName);
		const ordered = await this.listChapters(storyName); // 阅读序：「书稿/」直属在前 + 各卷按《卷.md》order、组内本地号升序
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

		// v0.2.24+ 提示词文件装配改造：文档原文注入改由调用方按 docPaths 声明 spec 装配；此处仍读本章《人物.md》/《场景.md》
		// 计算归属条目——结构化角色/场景列表排除它们，避免与章级组串【本章人物设定】/【本章场景】原文渲染重复
		const chCharRaw = await this.readDoc(`${ch.dir.path}/人物.md`);
		const chSceneRaw = await this.readDoc(`${ch.dir.path}/场景.md`);
		const excludeCharNames = Object.keys(doc.parseCharacters(chCharRaw, ch.num));
		const excludeSceneIds = Object.keys(doc.parseScenes(chSceneRaw, ch.num));
		const chapterOutlineText = await this.readChapterOutlineForPrompt(storyName, ch.key);
		savedForeshadows += await this.saveOutlineForeshadows(storyName, chapterOutlineText, ch.key);

		// v0.1.4+：窗口章数 N=data.json settings.prevChapters（缺省/非法回落 CLI 默认 3）；卷模式窗口限本容器——
		// 跨卷缺口不拉取他卷章节，改以最近各前卷新鲜《卷摘要》填充（prevVolSummaries，由近及远）
		// v0.2.x+：本书级覆盖——故事状态.md frontmatter 的 prev_chapters 显式设置时优先于全局设置
		const rawPrevN = state.prev_chapters != null ? Number(state.prev_chapters) : Number(this.getPrevChapters?.() ?? 3);
		const prevN = Number.isFinite(rawPrevN) && rawPrevN >= 0 ? Math.floor(rawPrevN) : 3;
		// v0.4.3+：后续参考章数 N（同口径：书级 next_chapters 显式设置优先，否则 DATA.json settings.nextChapters，缺省 3）
		// 当前消费方＝编写文章阶段的大纲节选（assembleWritingDocGroups 按 prevN/nextN 只取当前章前后若干章），不参与摘要生成
		const rawNextN = state.next_chapters != null ? Number(state.next_chapters) : Number(this.getNextChapters?.() ?? 3);
		const nextN = Number.isFinite(rawNextN) && rawNextN >= 0 ? Math.floor(rawNextN) : 3;
		let startIdx = Math.max(0, idx - prevN);
		while (ch.vol && startIdx < idx && parseChKey(ordered[startIdx].key).vol !== ch.vol) startIdx++; // 卷模式跳过落在其他容器的头部
		const prevChapters: PrevChapterRef[] = [];
		for (let i = startIdx; i < idx; i++) {
			const meta = ordered[i];
			const src = await this.chapterSummarySource(storyName, meta.key); // 正文优先；无正文回落大纲作来源（预览即大纲文本）
			if (!src) continue;
			prevChapters.push({ key: meta.key, num: i + 1, label: labelOf(meta.key), title: state.chapters[meta.key]?.title || meta.title, content: src.text });
		}

		// v0.1.4+：窗口章缺失/过期摘要经注入 LLM 自动生成并落盘（对齐 CLI get_previous_summaries 自动补全语义）；includeCurrentSummary 路径同覆盖当前章。
		// ensureSummaries=false 时退化为「只读已有新鲜摘要」（readFreshSummary 不触发生成）——只读场景不得产生 LLM 副作用
		const ensureSummaries = opts?.ensureSummaries !== false;
		const summaries: Record<number, string> = {};
		if (state.use_summaries !== false && prevN > 0) {
			const targets: Array<{ ord: number; key: string }> = prevChapters.map((p) => ({ ord: p.num, key: String(p.key ?? "") }));
			if (opts?.includeCurrentSummary) targets.push({ ord: ordinal, key: ch.key });
			for (const t of targets) {
				const s = ensureSummaries
					? await this.ensureFreshChapterSummary(storyName, t.key, labelOf(t.key))
					: await this.readFreshSummary(storyName, t.key);
				if (s) summaries[t.ord] = s;
				else if (!ensureSummaries && opts?.missingSummaryPlaceholder) summaries[t.ord] = opts.missingSummaryPlaceholder; // v0.2.23+：只读导出对缺失的窗口章/当前章摘要填占位符（不触发 LLM 生成）
			}
		}

		// v0.2.x+：本书级覆盖——故事状态.md frontmatter 的 include_volume_summary 显式设置时优先于全局设置
		const includeVolSummary = state.include_volume_summary ?? this.includeVolumeSummary?.() ?? false;

		// v0.1.4+：跨卷缺口填充（仅 includeVolumeSummary 开启时）——本容器内不足 N 章时，以阅读序最近各前卷的新鲜《卷摘要》补足至 N（由近及远、不深入他卷章节）；默认关闭时严格只按 prevN 注入单章摘要
		let prevVolSummaries: Array<{ name: string; text: string }> | undefined;
		if (includeVolSummary && ch.vol && state.use_summaries !== false && prevN > 0 && prevN - prevChapters.length > 0) {
			const prevVolsFarToNear: string[] = []; // 阅读序在前且非本卷的卷 id（远→近）
			for (let i = 0; i < idx; i++) {
				const v = parseChKey(ordered[i].key).vol;
				if (v && v !== ch.vol && !prevVolsFarToNear.includes(v)) prevVolsFarToNear.push(v);
			}
			const picked: Array<{ name: string; text: string }> = [];
			for (const vid of [...prevVolsFarToNear].reverse()) {
				if (picked.length >= prevN - prevChapters.length) break;
				const t = ensureSummaries
					? await this.ensureFreshVolumeSummary(storyName, vid) // v0.1.4+：需要即生成——前卷摘要缺失/过期时同样延迟重建（带进度反馈），不再因无文件而静默为空
					: await this.readFreshVolumeSummary(storyName, vid); // 只读场景：仅取已有新鲜卷摘要，缺失即跳过
				if (t.trim()) picked.push({ name: volNames[vid] || vid, text: t.trim() });
				else if (!ensureSummaries && opts?.missingSummaryPlaceholder && (await this.volumeHasFreshMemberSummary(storyName, vid))) picked.push({ name: volNames[vid] || vid, text: opts.missingSummaryPlaceholder }); // v0.2.23+：只读导出对缺失的前卷摘要填占位符——仅限有成员章新鲜摘要的卷（无成员摘要的卷运行时也跳过、不占槽）
			}
			if (picked.length) prevVolSummaries = picked;
		}

		// v0.1.4+：角色范围收窄——跨容器不深入他章《人物.md》：书级文档恒含；写卷内时排除「书稿/」直属章节级条目；
		// 本卷全量保留；他卷仅取其卷级《人物.md》条目（chapter=0）且仅限阅读序在前者（未来卷不注入）
		const curVolId = ch.vol ?? "";
		const prevVolIds = new Set<string>();
		for (let i = 0; i < idx; i++) {
			const v = parseChKey(ordered[i].key).vol;
			if (v && v !== curVolId) prevVolIds.add(v);
		}
		const characters = Object.values(await this.loadAllCharacters(storyName)).filter((c) => {
			if (!c.vol) return c.chapter <= 0 ? true : curVolId === ""; // 书级《人物.md》恒含；「书稿/」直属章节级条目仅在「书稿/」直属/平面写作时保留
			return c.vol === curVolId || (c.chapter <= 0 && prevVolIds.has(c.vol));
		});

		// v0.2.24+ 提示词文件装配改造：三层文档原文不再在此读取清洗——只解析出路径（含旧别名兜底），
		// 由调用方按 docPaths 声明 PromptSpec、经 assemblePromptFiles 读取装配注入
		const desk = this.deskDocsPath(storyName); // 书级文档在「案头资料/」
		const bookRelationshipsPath = await this.bookRelationshipsDocPath(storyName); // 旧别名兜底见 helper
		let volumeName = "";
		let volPaths: WritingDocPaths["vol"];
		let volSummary = "";
		if (ch.vol && vols[ch.vol]) {
			volumeName = vols[ch.vol].name || ch.vol;
			volPaths = {
				outline: this.volumeDocPath(storyName, vols[ch.vol], "卷大纲.md"),
				relationships: this.volumeDocPath(storyName, vols[ch.vol], "人物关系.md"),
			};
			if (state.use_summaries !== false && includeVolSummary) {
				// v0.1.4+：延迟生成——本卷全部章节摘要为输入全量重建，需要时才触发 LLM（带进度反馈）；默认关闭不注入整卷 digest、也不触发其重建
				volSummary = ensureSummaries ? await this.ensureFreshVolumeSummary(storyName, ch.vol) : await this.readFreshVolumeSummary(storyName, ch.vol);
				if (!volSummary.trim() && !ensureSummaries && opts?.missingSummaryPlaceholder && (await this.volumeHasFreshMemberSummary(storyName, ch.vol))) volSummary = opts.missingSummaryPlaceholder; // v0.2.23+：只读导出对缺失的本卷摘要填占位符（仅限有成员章新鲜摘要的卷）
			}
		}
		this.onProgress?.(null); // v0.1.4+：本轮上下文组装的摘要生成阶段结束 → 隐藏进度提示（插件侧另有空闲超时兜底）

		return {
			chapterNum: ordinal,
			localNum: ch.num,
			volumeName,
			chapterRanks: ordered.reduce<Record<string, number>>((acc, c, i) => {
				acc[c.key] = i + 1;
				return acc;
			}, {}),
			title: (state.title || "").trim() || storyName,
			genre: state.genre,
			writingStyle: state.writing_style,
			currentSceneId: state.current_scene,
			globalOutlineRaw,
			chapterOutlineText,
			characters, // v0.1.4+：已按容器范围收窄（见上文 filter）
			activeVolId: ch.vol ?? "",
			excludeCharNames,
			excludeSceneIds,
			volSummary,
			prevVolSummaries,
			prevChapters,
			summaries,
			prevN,
			nextN, // v0.4.3+：后续参考章数（编写文章阶段大纲节选用）
			scenes: Object.values(await this.loadAllScenes(storyName)),
			docPaths: {
				book: { world: `${desk}/世界观.md`, globalOutline: `${desk}/大纲.md`, bookRelationships: bookRelationshipsPath },
				vol: volPaths,
				chapter: { outline: `${ch.dir.path}/章节大纲.md`, characters: `${ch.dir.path}/人物.md`, scenes: `${ch.dir.path}/场景.md`, relationships: `${ch.dir.path}/人物关系.md` },
			},
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
		meta.words = countPureWords(stripAiWordMarks(bodyText)); // 剥离错别字下划线等标记，字数按纯净正文计
		await this.recomputeTotalWords(storyName, state);
		await this.saveState(storyName, state);
		return meta.words;
	}

	/** v0.2.25+ 从大纲生成章节前置清理：统计目标容器（volId=""＝书根平铺容器）内已有正文的章数（确认弹窗用，与 clearChapterBodies 同口径；excludeKeys 内的章即将被删除、不计入） */
	async countChaptersWithBody(storyName: string, volId: string, excludeKeys?: Set<string>): Promise<number> {
		const chapters = await this.listChapters(storyName);
		let n = 0;
		for (const c of chapters.filter((cc) => (cc.vol ?? "") === volId && !excludeKeys?.has(cc.key))) {
			const raw = await this.readDoc(`${c.dir.path}/章节.md`);
			const lines = raw.split("\n");
			if (lines.length && lines[0].startsWith("# ")) lines.shift();
			if (lines.join("\n").trim()) n++;
		}
		return n;
	}

	/** v0.2.25+ 从大纲生成章节前置清理：统计/清空目标容器（volId=""＝书根平铺容器）内全部章节的《章节.md》正文（保留标题行、字数状态同步归零）。返回实际清空的章数；excludeKeys 内的章即将被删除、跳过 */
	async clearChapterBodies(storyName: string, volId: string, excludeKeys?: Set<string>): Promise<number> {
		const chapters = await this.listChapters(storyName);
		let cleared = 0;
		for (const c of chapters.filter((cc) => (cc.vol ?? "") === volId && !excludeKeys?.has(cc.key))) {
			const raw = await this.readDoc(`${c.dir.path}/章节.md`);
			const lines = raw.split("\n");
			if (lines.length && lines[0].startsWith("# ")) lines.shift();
			if (!lines.join("\n").trim()) continue; // 本就无正文：跳过（不计入清空数）
			await this.setChapterBody(storyName, c.key, "");
			cleared++;
		}
		return cleared;
	}

	/** v0.2.25+ 从大纲生成章节前置清理：列出目标容器（volId=""＝书根平铺容器）内章号不在 keepNums 的多余章节（大纲没写到的旧章节，调用方逐个 deleteChapter）。按章号升序返回 */
	async listExtraChapters(storyName: string, volId: string, keepNums: Set<number>): Promise<Array<{ key: string; num: number; title: string }>> {
		const chapters = await this.listChapters(storyName);
		return chapters
			.filter((cc) => (cc.vol ?? "") === volId && !keepNums.has(cc.num))
			.map((cc) => ({ key: cc.key, num: cc.num, title: cc.title }))
			.sort((a, b) => a.num - b.num);
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
	vol?: string; // v0.0.15：chapter_num 的卷容器（本地号按容器独立编号；全局/未归卷（「书稿/」直属）可省）
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

