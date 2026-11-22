import { App, Notice, Platform, Plugin, PluginSettingTab, TAbstractFile, TFile, TFolder, View, WorkspaceLeaf, WorkspaceSidedock, type Editor, type MarkdownFileInfo, type MarkdownView, type SettingDefinitionItem } from "obsidian";
import { ActionItem, ActionMenuModal, AddCharacterModal, AwGuideModal, AwModal, AutoBookConfigInput, AutoBookConfigModal, AutoBookInput, AutoBookModal, BookSkillPhaseModal, ChapterListModal, CharacterEditModal, ConfirmModal, ExportPromptsSelectModal, FixRefsReviewModal, FolderPickerModal, InspirationKitModal, MultiFieldModal, NewFilePickerModal, NewStoryInput, NewStoryModal, PanelLine, SaveReplyModal, SceneEditModal, type SceneEditResult, type SceneRelEdit, SkillEditModal, SkillPickerModal, SkillRangeModal, StoryMetaModal, StoryMetaInput, StoryPickerModal, TextAreaPrompt, TextPanelModal, TextInputModal, VaultFilePickerModal, VolumeBatchCreateModal, ensureParentFolders } from "./modals";
import type { AddCharacterResult, CharacterEditResult, CharacterScopeOption, MultiSelGroup, SaveReplyResult, SkillEditResult, SkillLevel } from "./modals";
import { parseBookSkill, type BookSkillSpec } from "./book_skill"; // v0.4.1+ 旧「案头资料/」建书技能文件解析（仅供一次性迁移；建书配置已并入《故事状态.md》auto_book 块）
import { LlmChatView } from "./llm_chat_view";
import { GenProgressView, formatElapsedMs, type WritingStreamSink } from "./gen_progress_view";
import { StatusView, type StatusAction, type StatusChapterEntry, type StatusDetail, type StatusFileEntry, type StatusFolderEntry, type StatusSnapshot, type StatusStoryEntry, type StatusTyping } from "./status_view";
import { RelationshipView, REL_SCOPE_WORDS, type RelCharInfo, type RelGroup, type RelRow, type RelSnapshot, type RelStoryEntry } from "./relationship_view";
import { TimelineView, tlRowName, type TlDocRef, type TlLane, type TlRow, type TlSnapshot, type TlStoryEntry } from "./timeline_view"; // v0.3.3+ 合并大事件：面板承担事件增删改，构造第三参＝编辑弹窗人物候选；v0.4.7+ TlLane＝多时间线泳道汇总；v0.4.8+ tlRowName＝条目事件名口径（场景挂事件候选/索引共用）
import { SceneView, sceneDisplayName, type SceneRow, type SceneSnapshot, type SceneScope, type SceneStoryEntry } from "./scene_view"; // v0.4.7+ 场景面板（卡片画布三层《场景.md》）
import { MAX_TYPE_DELTA, SEGMENT_MIN_DEFAULT, SEGMENT_MIN_MAX, SEGMENT_MIN_MIN, TYPE_STATS_HEADER, diffStats, liveSegStats, nextSegmentStart, normalizeSegmentMinutes, renderStatsRow, segActiveMs, segNetChars, segmentMs, segmentStartOf, summarizeStatsFile, type TypeSeg } from "./typing_stats"; // v0.4.5+ 打字统计纯计算（段长可配/停顿/表格渲染/文件汇总/窗口活跃时长）；采集与落盘在本文件接线
import { chapterOutlineTemplate, countPureWords, FORESHADOW_TEMPLATE, formatLocalDateTime, NOTES_TEMPLATE, outlineTemplate, WORLD_TEMPLATE } from "./story_types";
import { safeFilename } from "./story_types";
import { StoryManager, NO_VOL_MODE_MSG, CHAPTER_DIR_RE, PROLOGUE_DIR_NAME, DESK_DOCS_DIR_NAME, MANUSCRIPT_DIR_NAME, type TimelineDocSource, type WritingDocPaths } from "./story_manager";
import { BOOK_SKILL_PHASE_KEYS, bookSkillPhaseKey, WORD_RANGE_DEFAULT, autoBookMissing, type AutoBookConfig, type BookSkillPhase, chKey, findChapterByStateKey, parseChKey, type StoryState } from "./state_doc"; // v0.4.9+ findChapterByStateKey＝新建场景「级别」候选里定位当前激活章
import { BANNED_LIST_SKILL_NAME, buildDefaultLlmConf, CHAT_REF_DOC_CATALOG, CHAT_REF_DOC_DEFAULTS, defaultBaseUrlForProvider, filterEnabledLlmConfigs, getVisibleLlmFields, IDENTITY_BOOST_SKILL_PREFIX, isLlmConfigEnabled, LEGACY_WRITING_TASK_SKILL_NAMES, normalizeLlmProvider, PHASE_CHAPTER_OUTLINE, PHASE_OUTLINE, PHASE_PLANNING, PHASE_REF_DOC_CATALOGS, PHASE_REF_DOC_DEFAULTS, PHASE_WORLDVIEW, PHASE_WRITING, REF_DOC_KEY_RENAMES, REF_DOC_LABELS, renameLlmConfig, selectEnabledLlmName, SENSITIVE_LIST_SKILL_NAME, setLlmConfigEnabled, TENSION_TOOLBOX_SKILL_NAME, toggleLlmConfigEnabled, WRITING_PHASE_LABELS, WRITING_TASK_SKILL_NAME } from "./plugin_config";
import type { LlmConfigDoc, PluginConfig, WritingPhase } from "./plugin_config";
import { stampUsageDoc, usageDocNeedsRegen, usageDocVersion } from "./usage_doc_stamp";
import { DEFAULT_USAGE_GUIDE } from "./usage_guide_default";
import { assembleSystemPrompt, cacheStatsText, chatCompletion, chatStream, describeLlmError, isLoopbackBaseUrl, isRetryableLlmError, normalizeBaseURL, retryTurnMessages, testConnection } from "./llm_client";
import type { Message } from "./llm_client";
import { findAiWordHits, simplifyEmphaticRepetition, simplifyNegationContrast, findAiSentences, parseBannedWordsMd, type BannedWordsData } from "./banned_words";
import { applySensitiveMarks, findSensitiveHits, groupSensitiveHits, renderSensitiveReportSection } from "./sensitive_words"; // v0.4.6+ 敏感词检测（词表＝SKILLS/敏感词清单.md，零 LLM 确定性扫描）
import { DEAI_LEDGER_DOC_NAME, ledgerCounts, parseDeaiLedgerDoc, renderDeaiLedger, type DeaiLedger, type DeaiLedgerEntry } from "./deai_ledger"; // v0.4.3+ 连续编写的 AI 味登记表（写章后只登记、整轮写完后统一清洗；未洗完的章由「补做去AI味」按清单续做）
import { LEGACY_SKILL_BANNED_AVOID, LEGACY_SKILL_BANNED_LIST } from "./banned_words_legacy";
import { BANNED_LIST_SKILL_HEAD, DEFAULT_SKILLS, GENRE_FLAT_SKILL_SOURCES, GENRE_SKILL_FOLDER, SKILL_CONTENT_TEMPLATE, SYSTEM_PROMPT_SKILL_FOLDER, TENSION_TOOLBOX_TAIL, WRITING_STYLE_SKILL_FOLDER, WRITING_TASK_FIXED_COMMENT } from "./skills_default";
import { appendOutlineInstruction, applyTypoMarks, applyWordRangeVars, BOOK_OUTLINE_GEN_SYSTEM_PROMPT, bookInfoText, BookOutlineGenInput, buildBookOutlineContinuePrompt, buildBookOutlineExtendPrompt, buildBookOutlineGenPrompt, buildChapterOutlineExpandPrompt, buildChapterPrompt, buildChapterRefFixPrompt, buildChapterSummaryPrompt, buildContinuePrompt, buildDeaiPrompt, buildPlanningGuideContinuePrompt, buildPlanningGuidePrompt, buildPolishPrompt, buildReviewPrompt, buildRewritePrompt, buildStoryTypeSystemPrompt, buildTimelineGenPrompt, buildTypoScanPrompt, buildVolOutlineChapterPrompt, buildVolOutlineDesignPrompt, buildVolRebuildPrompt, buildWorldviewGenPrompt, buildWritingContext, CHAPTER_OUTLINE_EXPAND_SYSTEM_PROMPT, CHAPTER_SUMMARY_SYSTEM_PROMPT, ChapterRefFixReport, checkOutlineCoverage, cleanAiText, cleanRelationshipsDoc, findChapterRefLeaks, findChapterRefSentences, fixChapterRefs, formatRetryNote, parseChapterWithSummary, parseTypoScan, PLANNING_GUIDE_SECTIONS, PlanningGuideInput, planningGuideMissingSections, pt, ptT, setTaskPromptOverrides, stripHeading, TASK_PROMPTS, TIMELINE_GEN_SYSTEM_PROMPT, TimelineGenInput, type StableSink, TYPO_SCAN_SYSTEM_PROMPT, validateStoryTypeFormat, VOL_OUTLINE_GEN_SYSTEM_PROMPT, VOL_SUMMARY_SYSTEM_PROMPT, VolOutlineGenInput, volumeListText, withSharedContextPrefix, wordTargetHint, WorldviewGenInput } from "./prompts";
import { requirementsFor, stagesFrom, type StageId, type StageRequirement } from "./pipeline";
import { assemblePromptFiles, type AssembledPrompt, type PromptFileReader, type PromptSpec } from "./prompt_files";
import { detectChatAutoRefs } from "./chat_refs";
import { parseToolArgs, TOOL_RESULT_MAX_CHARS, CHAT_WRITING_TOOLS, CHAT_GENERATION_TOOLS, resolveToolName, unknownToolHint, pickStringArg, pickNumberArg, normalizeDocName, DOC_NAME_ARG_KEYS, CHAPTER_NUM_ARG_KEYS, VOL_NAME_ARG_KEYS } from "./chat_tools";
import { cnToNum, deleteSceneBlock, DOC_SCOPE_WORDS, docLocationLabel, docRelPath, extractPlannedChapterCount, insertSceneBlock, maxDeclaredVolumeNum, mergeVolOutlineChapters, parseChapterSelection, parseRelationships, parseTimelines, parseVolumeDeclarations, renameSceneBlock, renameSceneRefs, rewriteScenePosition, sliceVolOutlineChapters, splitList, splitVolOutlineByChapter, stripComments, stripForeshadowMarks, timelineGenFormatOk, timelineTimeText, updateSceneBlock, type SceneBlockInput, type TimelineEntry, type VolumeDeclaration, type VolumeInfo } from "./md_docs";
import type { RelationshipEntry } from "./md_docs";
import { CAST_ANALYZE_SYSTEM_PROMPT, CAST_JSON_RETRY_NOTE, aggregateCastAnalyses, buildCastChapterPrompt, buildCharacterWritePlan, buildRelationshipWritePlan, buildSceneWritePlan, castStableChars, parseCastChapterAnalysis, relPairKey } from "./cast_analyzer";
import { OUTLINE_CAST_APPENDIX_MARK, OutlineCastTracker, outlineCastAppendixInstruction, splitOutlineCastAppendix } from "./outline_cast";
import type { CastChapterAnalysis } from "./cast_analyzer";
import { appendInspirationBlock, ensureInspirationDocHeader, INSPIRATION_DOC_NAME, INSPIRATION_FOLDER_NAME, INSPIRATION_SKILL_NAME, inspirationDate, inspirationHeading, inspirationPreview, normalizeInspirationName, parseInspirationDoc, removeInspirationBlock, renameInspirationBlock, renderInspirationBlock, type InspirationBlock } from "./inspiration"; // v0.4.3+ 灵感工具包：《案头资料/灵感/灵感.md》纯解析/渲染/增删（无 IO，可测）
import { openFileAtLine } from "./editor_nav"; // v0.4.3+ 打开文档并定位到某行（灵感定位/写字台/时间线共用）

interface ArticleWriterSettings {
	workDir: string; // 写小说的文件夹（对齐 CLI --work_dir / /dir）；空=未初始化，首次用命令时弹选择器
	lastStory: string;
	autoOpenOnCreate: boolean;
	noStoryGuideOff?: boolean; // v0.4.7+：true＝不再在启动时（工作目录里没有书籍时）弹「先建一本书」引导面板
	prevChapters?: number; // v0.1.4+：写作提示词「前文内容」窗口章数 N（缺省/非法按 CLI 默认 3；0=不注入前文）。卷模式窗口限本卷、跨卷缺口以各前卷《卷摘要》填充
	nextChapters?: number; // v0.4.3+：写作提示词「后续参考」窗口章数 N（缺省/非法按 3；0=不注入后章）。当前消费方＝编写文章阶段的大纲节选（前 prevN／后 nextN 章）
	includeVolumeSummary?: boolean; // v0.1.4+：是否把整卷《卷摘要》注入写作上下文（含跨卷前卷摘要）；默认关——对齐 Python 原版严格 prev_n 语义，只注入最近 N 章
	typingSegmentMin?: number; // v0.4.5+：打字（码字）统计的段长（分钟）；缺省/非法/越界回落 10
	continueTailChars?: number; // v0.4.6+ 修 C9：续写提示词注入的「已有内容末尾窗口」字数（缺省/非法/越界回落 1000；范围 200–20000）
	llm?: PluginConfig; // LLM 多组模型配置 + 对话引用清单/阶段模型映射（替代 ~/.articlewriter/config.json，存插件数据目录 data.json；v0.4.3+ system_prompt 已删除）
}

const DEFAULT_SETTINGS: ArticleWriterSettings = {
	workDir: "",
	lastStory: "",
	autoOpenOnCreate: true,
	prevChapters: 3,
	nextChapters: 3,
	typingSegmentMin: SEGMENT_MIN_DEFAULT,
	continueTailChars: 1000,
};

/** 「添加人物」关系类型下拉的可选值：均能命中 relationship_view.ts 的类型正则（保证图视图边色/图标可识别），空值=未标注 */
const RELATION_TYPE_OPTIONS = ["师徒", "同门", "朋友", "同伴", "恋人", "亲族", "主仆", "敌对", "对手", "盟友"];

/** v0.2.24+ 大纲族上下文块 header 常量：assembleVolOutlineContext 的 specs 与 book 族旗标判定（按返回 blocks 的 header 匹配）共用，防措辞漂移。措辞逐字对齐旧 prompts.ts volOutlineContextParts/bookOutlineContextParts */
const HDR_BOOK_INFO = "【书籍信息】";
const HDR_WORLD = "【世界观设定】";
const HDR_PLANNING = "【策划规范 · 本书既定规划（生成大纲时必须遵循、不得违背）】";
const HDR_BOOK_REL = "【书籍人物关系】";
const HDR_VOL_REL = "【本卷人物关系】";
const HDR_VOL_LIST = "【卷列表 · 阅读序】";
const HDR_OUTLINE_SOURCE = "【当前大纲来源（本次拆分/写作依据）】"; // v0.4.3+：逐章/逐次变化的「本次主输入」块——注入时恒排最后，锚点按它之前的稳定前缀计算

/** v0.2.24+ 按装配结果 blocks 的 header 判断某上下文块是否实际注入（book 族 reqs 旗标推导共用：运行时 + export 预览） */
function hasCtxBlock(assembled: AssembledPrompt, hdr: string): boolean {
	return assembled.blocks.some((b) => b.header === hdr);
}

/** v0.3.0+ auto-book 流水线运行上下文（main.ts 编排、各交互助手读取）：
 * 非 null 时 prompt/confirm 助手不再弹窗、直接返回这里的参数值——被复用的既有命令（生成书级大纲/建卷/拆章等）因此全程免交互；
 * chapterCounts 为各卷目标章数（chapter-outlines 阶段逐卷设为 countOverride）；countOverride 为当前阶段章数弹窗的显式答案（平铺总章数等）；
 * stopped 由「停止全自动」置 true——编排循环在阶段间与阶段内检查后中止 */
interface AutoRun {
	premise: string;
	volumeCount: number; // 分卷模式计划卷数（平铺模式不用）
	chapterCounts: number[]; // 分卷模式各卷目标章数（长度＝volumeCount）
	flatTotalChapters: number; // 平铺模式全书总章数
	overwrite: boolean; // 已有世界观/策划指南/书级大纲是否重新生成
	countOverride: number | null; // 当前阶段 promptChapterCountInput 的显式答案（null=不覆盖、按 chapterCounts 末值兜底）
	stopped: boolean;
}

/** v0.4.3+ 大纲阶段人物/关系分层写盘统计（一次运行内累计，收尾 Notice 汇总） */
interface OutlineCastRunStats {
	characters: number; // 成功定层写入的人物条目数（含跨章提升）
	relationships: number; // 成功定层写入的关系条目数（含跨章提升）
	skipped: number; // 目标层不存在（章节目录未创建）而跳过的条目数
}

/** v0.4.3+ getPhaseLlmSetup 的返回形状（写成命名类型供「编写一章」共用助手接参） */
interface PhaseLlmSetup {
	cfg: LlmConfigDoc;
	systemPrompt?: string;
	descStyle?: string;
}

/** v0.4.3+ AI 味本地检测结果（deferDeai 模式下登记进《AI味清单.md》的载荷，不花 LLM 调用） */
interface DeaiFlavor {
	hits: number; // 禁用词命中总数（同一词多处按多次计）
	words: string[]; // 命中词（按出现序去重）
	sentences: string[]; // 命中整句
}

/** writeOneChapter 的结果：ok=false 时 reason＝panel（面板打不开）/ aborted（生成或清洗阶段被停止）/ empty（生成结果为空）/ body（只出了摘要块） */
type ChapterWriteResult =
	| { ok: true; content: string; chapterSummary: string | null; modal: GenProgressView; aiFlavor: DeaiFlavor | null }
	| { ok: false; reason: "panel" | "aborted" | "empty" | "body" };

/** v0.4.3+ 系统提示词技能：`SKILLS/系统提示词/<name>.md` 覆盖内置常量；文件缺失/为空时回落常量。
 *  只控制 system 消息，不改用户 prompt 的解析协议；编辑技能文件后由 vault 事件刷新缓存，重载插件亦生效。 */
const SYSTEM_PROMPT_SKILLS: Record<string, string> = {
	人物场景分析: CAST_ANALYZE_SYSTEM_PROMPT,
	章摘要: CHAPTER_SUMMARY_SYSTEM_PROMPT,
	卷摘要: VOL_SUMMARY_SYSTEM_PROMPT,
	卷大纲生成: VOL_OUTLINE_GEN_SYSTEM_PROMPT,
	章大纲编写: CHAPTER_OUTLINE_EXPAND_SYSTEM_PROMPT, // v0.4.3+：从大纲生成章节时逐章扩写章大纲（长度≈该章正文目标字数 1/4）的专属技能
	时间线生成: TIMELINE_GEN_SYSTEM_PROMPT,
	错别字检测: TYPO_SCAN_SYSTEM_PROMPT,
	// v0.4.3+：5 条纯硬编码任务指令固定文本（剧本转换两段/对话助手身份/时间线与编写类型格式修正注记），
	// 经 prompts.ts pt/ptT 取用；读盘口径见 refreshPromptSkillOverrides（任务条目原文直读、不剥标题）
	...TASK_PROMPTS,
};

/** v0.4.9+ 新建场景「级别」下拉的两枚小类型（`sceneScopeChoices` 用）：
 *  `SceneScopeOption`＝弹窗顶部下拉的一项（value＝book/volume/chapter、label＝层级词开头＋当前卷名/章名）；
 *  `SceneScopeChapter`＝`manager.listChapters` 元素中本流程用到的字段（章级《场景.md》＝`dir.path`/场景.md） */
interface SceneScopeOption {
	value: string;
	label: string;
}
/* v0.4.9+ 层级词与「所在位置」文案已统一到 md_docs（`DOC_SCOPE_WORDS`／`docLocationLabel`／`docRelPath`）＝场景、时间线、人物关系三个面板共用同一拼法（代码重用） */
interface SceneScopeChapter {
	key: string;
	num: number;
	title: string;
	dir: TFolder;
	vol?: string;
	parentPath: string;
}

export default class ArticleWriterPlugin extends Plugin {
	settings: ArticleWriterSettings = { ...DEFAULT_SETTINGS };
	manager!: StoryManager;
	/** v0.4.3+ 系统提示词技能覆盖缓存（name -> 正文）；由 refreshPromptSkillOverrides 维护 */
	private promptSkillOverrides = new Map<string, string>();
	private statusRefreshTimer: number | null = null; // 工作目录内文件变更 → 防抖刷新已打开状态面板的定时器
	private relRefreshTimer: number | null = null; // 同上，人物关系面板（v0.1.9+）
	private tlRefreshTimer: number | null = null; // 同上，时间线面板（v0.2.x+）
	private scRefreshTimer: number | null = null; // 同上，场景面板（v0.4.7+）
	private flatBlocked: string | null = null; // 仍为平面结构且整理失败的书名：章节/卷结构操作锁定，直至「按卷整理目录」成功
	private wsSaveTimer: number | null = null; // v0.2.1+：layout-change → 防抖存档当前书工作区的定时器
	private lastWorkspaceRestoreAt = 0; // v0.2.1+：最近一次 changeLayout 恢复的时间戳（抑制自身触发的 layout-change 回存）
	/** v0.4.5+ 打字（码字）统计状态：当前段缓冲（story＝该段归属小说，segMs＝开窗时刻的段长 ms——设置改动后旧段先结算）；段末/超时经 tick 或跨段 flush */
	private typeSeg: (TypeSeg & { story: string; segMs: number }) | null = null;
	private typeTexts = new Map<string, string>(); // 路径→上次读到的正文（diff 基线；某文件首次被看见只立基线、不计数）
	private lastModifyAt = new Map<string, number>(); // v0.4.6+ C7：路径→最近一次 vault modify 时刻（判定编辑器回声改动来自程序化写盘）
	private typePrevSegEnd = 0; // 上一段（同一本书）的末时刻：改段长后新开段不得回溯到它之前，否则两段的活跃时长区间重叠、《码字记录.md》汇总双计
	private typeFlushChain: Promise<void> = Promise.resolve(); // 串行 flush 队列（防两次追加读-改-写互相覆盖）
	/**
	 * v0.4.5+ 「本次写作」会话（**懒锚定**：开始时刻＝该会话内第一次有效键入，不是写字台打开时刻——
	 * Obsidian 启动即打开写字台，若打开就计时会把挂机时间灌进「总时长」）。
	 * `typeSessionStartAt===0`＝本次尚未开始（面板显示「未开始」占位）；写字台打开/重开、切书、停笔超过一个段长＝结束本次（清零待重新锚定）。
	 */
	private typeSessionStartAt = 0;
	private typeSessionStory = "";
	private typeSessionChars = 0;
	private typeSessionActiveMs = 0;
	private typeLastEditAt = 0; // 本次内最后一次有效键入时刻（停笔超过段长即自动结束本次）
	private typeLastSeg: { start: number; end: number; chars: number; speed: number | null } | null = null;
	private wsIoErrorNoticed = false; // v0.2.1+：工作区 IO 失败通知每会话只弹一次（防抖存档高频触发会刷屏），细节恒进 console
	private auto: AutoRun | null = null; // v0.3.0+：auto-book 流水线运行上下文——非 null 时各 prompt/confirm 助手直接返回参数值（免交互驱动），「停止全自动」置 stopped 中断当前阶段
	private lastGenPanel: GenProgressView | null = null; // v0.3.0+：最近取到/打开过的生成面板实例——面板被关闭（leaf 脱离）后引用仍在，其 signal.aborted 供流水线阶段间识别「流式中关面板/点停止＝停止」

	/** v0.1.4+：data.json settings.prevChapters → 有效窗口章数 N（缺省/非法回落 CLI 默认 3；0=不注入前文） */
	private effectivePrevN(): number {
		const n = Math.floor(Number(this.settings.prevChapters ?? 3));
		return Number.isFinite(n) && n >= 0 ? n : 3;
	}

	/** v0.4.3+：data.json settings.nextChapters → 有效后续参考章数 N（缺省/非法回落 3；0=不注入后章）——书级 next_chapters 显式设置时优先（解析在 story_manager.loadWritingData） */
	private effectiveNextN(): number {
		const n = Math.floor(Number(this.settings.nextChapters ?? 3));
		return Number.isFinite(n) && n >= 0 ? n : 3;
	}

	/** v0.4.5+：data.json settings.typingSegmentMin → 有效码字记录段长（分钟；缺省/非法/越界回落 10） */
	private effectiveTypeSegmentMin(): number {
		return normalizeSegmentMinutes(this.settings.typingSegmentMin);
	}

	/** v0.4.6+ 修 C9：data.json settings.continueTailChars → 有效续写末尾衔接窗口（字；缺省/非法/越界回落 1000，范围 200–20000）。
	 *  旧版硬编码 1000：对 4000–5000 字的长章，续写只见末尾 1/4，中段伏笔与重复推进风险高。 */
	private effectiveContinueTailChars(): number {
		const n = Number(this.settings.continueTailChars);
		return Number.isFinite(n) && n >= 200 && n <= 20000 ? Math.round(n) : 1000;
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.manager = new StoryManager({
			app: this.app,
			getStoryRoot: () => this.settings.workDir,
			onStateChanged: () => this.notifyContextChanged(),
			getPrevChapters: () => this.effectivePrevN(), // v0.1.4+：实时读 data.json，改设置即时生效
			getNextChapters: () => this.effectiveNextN(), // v0.4.3+：后续参考章数（编写文章阶段大纲节选窗口）
			includeVolumeSummary: () => !!this.settings.includeVolumeSummary, // v0.1.4+：卷摘要注入开关（默认关）
			generateChapterSummary: async ({ label, sourceText, viaOutline }) => { // v0.1.4+：缺失/过期章节摘要的 LLM 延迟生成入口（对齐 CLI _summarize_chapter），无配置/失败返回 null；v0.2.22+：走编写文章阶段配置
				const setup = this.getPhaseLlmSetup(PHASE_WRITING);
				if (!setup) return null;
				try {
					const t = await chatCompletion(
						setup.cfg,
						[
							{ role: "system" as const, content: this.promptSkill("章摘要", CHAPTER_SUMMARY_SYSTEM_PROMPT) },
							{ role: "user" as const, content: buildChapterSummaryPrompt(label, sourceText, viaOutline) },
						],
						// reasoning_effort:"none"——摘要是小预算（600 token）的机械压缩任务，思考型模型（llama-server --reasoning-format deepseek 等）
						// 会把全部预算耗在 reasoning_content 上、content 恒空 → chatCompletion 抛「LLM 未返回内容」→ 摘要永远不落盘。
						// 实测（llama-server 0.3.0-dev + Qwen jinja 模板）：enable_thinking:false 不被服务端透传给模板（仍思考），
						// 而 reasoning_effort:"none" 被识别并关思考（finish_reason=stop、content 正常）；OpenAI o 系列原生支持该字段，
						// 其余兼容端点（DeepSeek/Ollama/vLLM 等）忽略未知字段、无副作用
						{ max_tokens: 600, temperature: 0.4, reasoning_effort: "none" }
					);
					return (t || "").trim() || null;
				} catch (e) {
					console.warn("[articlewriter] 章节摘要生成失败：", e);
					return null;
				}
			},
			generateVolumeSummary: async ({ volumeName, chapters }) => { // v0.1.4+：卷摘要全量重建——输入本卷全部成员章的新鲜 AI 摘要，取代旧增量合并滚动法；v0.2.22+：走编写文章阶段配置
				const setup = this.getPhaseLlmSetup(PHASE_WRITING);
				if (!setup) return null;
				try {
					const lines = chapters.map((c) => ({ label: c.label, title: c.title, summary: c.summary }));
					const t = await chatCompletion(
						setup.cfg,
						[
							{ role: "system" as const, content: this.promptSkill("卷摘要", VOL_SUMMARY_SYSTEM_PROMPT) },
							{ role: "user" as const, content: buildVolRebuildPrompt(volumeName, lines) },
						],
						// reasoning_effort:"none"——同章节摘要：小预算（900 token）任务，思考型模型会把预算耗在 reasoning_content 上导致 content 恒空
						{ max_tokens: 900, temperature: 0.4, reasoning_effort: "none" }
					);
					return (t || "").trim() || null;
				} catch (e) {
					console.warn("[articlewriter] 卷摘要生成失败：", e);
					return null;
				}
			},
			onProgress: (msg) => { void this.notifyGenProgress(msg); }, // v0.1.4+：延迟生成的进度反馈（持久 Notice + 空闲超时兜底）；回调契约为 void，显式丢弃 Promise
		});
		await this.purgeWritingGuideArtifacts(); // v0.3.5+：写作指南体系整体废弃——启动时一次性清理存量指南产物（各层 WRITING_GUIDE.md、《写作指南汇总.md》、插件数据目录 WRITING_GUIDE.md 与 guide-types/、data.json 遗留字段）；题材要点改走 SKILLS/ 技能
		if (this.settings.workDir) await this.migrateBannedWordsSkill(); // v0.3.6+：禁用词 Skill 化——旧插件数据目录 BANNED_WORDS.md 先迁移并入 SKILLS/网文高频禁用词清单.md（须在技能播种前，防内置默认顶掉迁移结果）
		void this.purgeBannedWordsSkillArtifacts(); // v0.3.6+：清理收口残留：插件数据目录 BANNED_WORDS.md＋旧内置技能「禁用词回避」（仅未被用户定制时删）
		await this.migrateIdentityBoostSkills(); // v0.3.4+：旧 data.json 各阶段 identity_boost 先迁移成 SKILLS/身份加强·<阶段名>.md（须在播种前跑，用户旧定制不被内置默认顶掉）
		if (this.settings.workDir) void this.ensureSkillsFiles(); // v0.3.0+：工作目录已设时确保内置技能文件播种到 <work_dir>/SKILLS/（仅缺失才写；未设工作目录等 pickWorkDir 投放）
		void this.syncUsageDocOnStartup(); // v0.4.7+ 每次启动比对《使用说明.md》版本戳：缺失/为空/无戳/版本不符（含升级）→ 按当前版本重建并打开；版本一致不动。真·首启无工作目录则等 pickWorkDir 投放
		void this.guideNewStoryOnStartup(); // v0.4.7+ 启动引导：没有书籍（未设工作目录，或工作目录里一本书都没有）→ 弹「先建一本书」面板（面板内「不再弹出」＋设置项可关）

		this.addCommand({ id: "set-work-dir", name: "选择工作目录（work_dir，对齐 CLI --work_dir）", callback: () => this.pickWorkDir(false) });
		this.addCommand({ id: "switch-story", name: "切换当前小说（/dir：选书并加载其状态）", callback: () => this.cmdSwitchStory() });

		this.addCommand({ id: "new-story", name: "创建新小说（建书：小说文件夹+模板文档）", callback: () => this.cmdNewStory() });
		this.addCommand({ id: "edit-story-meta", name: "修改小说信息（题材/编写类型，下拉来自系统技能目录）", callback: () => this.cmdEditStoryMeta() });
		this.addCommand({ id: "new-chapter", name: "新建章节（章节目录+正文/大纲等文档）", callback: () => this.cmdNewChapter() });
		this.addCommand({ id: "insert-chapter", name: "插入章节（在选中章之前/之后新建，后续章节号自动顺延）", callback: () => void this.cmdInsertChapter() });
		this.addCommand({ id: "list-chapters", name: "章节列表（选择打开正文）", callback: () => this.cmdListChapters() });
		this.addCommand({ id: "open-outline", name: "打开总大纲 大纲.md", callback: () => this.cmdOpenOutline() });
		this.addCommand({ id: "open-worldview", name: "打开世界观 世界观.md", callback: () => this.cmdOpenDoc("世界观.md", WORLD_TEMPLATE) });
		this.addCommand({ id: "open-foreshadow", name: "打开伏笔记录 伏笔.md", callback: () => this.cmdOpenDoc("伏笔.md", FORESHADOW_TEMPLATE) });
		this.addCommand({ id: "open-notes", name: "打开笔记 笔记.md", callback: () => this.cmdOpenDoc("笔记.md", NOTES_TEMPLATE) });
		this.addCommand({ id: "next-chapter", name: "下一章（并打开正文）", callback: () => this.cmdNextOrPrev(1) });
		this.addCommand({ id: "prev-chapter", name: "上一章（并打开正文）", callback: () => this.cmdNextOrPrev(-1) });
		this.addCommand({ id: "count-current", name: "统计当前章节字数（纯文字）", callback: () => this.cmdCount() });
		this.addCommand({ id: "count-all", name: "统计全书各章字数与合计", callback: () => this.cmdCountAll() });
		this.addCommand({ id: "save-current", name: "保存当前章节（编辑器内容强制落盘）", callback: () => this.cmdSave() });
		this.addCommand({ id: "status", name: "小说状态（标题/类型/当前章节/总字数）", callback: () => this.cmdStatus() });

		this.addCommand({ id: "volume-list", name: "卷列表（含各卷章节数与当前标记）", callback: () => this.cmdVolumeList() });
		this.addCommand({ id: "volume-add", name: "新建卷（并设为当前卷，可顺带建章归属）", callback: () => this.cmdVolumeAdd() });
		this.addCommand({ id: "volume-manage", name: "管理卷（启用/改名/改描述/分配章节/删除）", callback: () => this.cmdVolumeManage() });
		this.addCommand({ id: "organize-volumes", name: "按卷整理目录（把书根下已归属各卷的章节移入对应卷实体目录；幂等可重复执行）", callback: () => void this.cmdOrganizeVolumes() });
		this.addCommand({ id: "volume-mode-off", name: "设为无卷模式（/volume off：拍平并删除全部卷，保持纯 书籍→章节 扁平结构；破坏性、需确认）", callback: () => void this.cmdVolumeMode(false) });
		this.addCommand({ id: "volume-mode-on", name: "启用有卷模式（/volume on：允许建卷/归卷/按卷整理目录）", callback: () => void this.cmdVolumeMode(true) });

		this.addCommand({ id: "scene-list", name: "场景列表（全部章节+全局未归属）", callback: () => this.cmdSceneList() });
		this.addCommand({ id: "scene-add", name: "新增场景（ID/简介/角色/正文/归属章节）", callback: () => this.cmdSceneAdd() });
		this.addCommand({ id: "scene-manage", name: "管理场景（切换/查看/编辑/移动/删除）", callback: () => this.cmdSceneManage() });

		this.addCommand({ id: "character-list", name: "人物列表（全部章节+全局）", callback: () => this.cmdCharacterList() });
		this.addCommand({ id: "character-add", name: "新增人物（身份/性别/性格/外貌/背景/能力等）", callback: () => this.cmdCharacterAdd() });
		this.addCommand({ id: "character-manage", name: "管理人员（查看/编辑/移动/改名/删除）", callback: () => this.cmdCharacterManage() });
		this.addCommand({ id: "character-rename", name: "角色改名（全书 MD 文档同步替换旧名并自动备份）", callback: () => this.cmdCharacterRename() });
		this.addCommand({ id: "analyze-cast", name: "分析人物与场景（/analyze-cast：逐章 LLM 深度分析正文，发现新人物/场景、提取字段，按出现范围定层写入三层文档，新关系追加到对应层《人物关系.md》）", callback: () => void this.cmdAnalyzeCast() });

		this.addCommand({ id: "foreshadow-list", name: "伏笔列表（全书 伏笔.md，含状态）", callback: () => this.cmdForeshadowList() });
		this.addCommand({ id: "foreshadow-add", name: "添加伏笔（章节/角色/原因）", callback: () => this.cmdForeshadowAdd() });
		this.addCommand({ id: "foreshadow-manage", name: "管理伏笔（标记完成/取消/删除）", callback: () => this.cmdForeshadowManage() });

		this.addCommand({ id: "world-show", name: "世界观总览（世界/类型/规则/势力/地点/历史/力量体系）", callback: () => this.cmdWorldShow() });
		this.addCommand({ id: "world-set", name: "设置世界观字段（世界/类型/规则/势力/地点/历史/力量体系）", callback: () => this.cmdWorldSet() });

		this.addCommand({ id: "outline-append-current", name: "追加当前章大纲（自动去重并提取 [伏] 伏笔）", callback: () => this.cmdOutlineAppendCurrent() });
		this.addCommand({ id: "open-chapter-outline", name: "打开当前章 章节大纲.md", callback: () => this.cmdOpenChapterOutline() });
		this.addCommand({ id: "volume-outline-to-chapters", name: "从卷大纲生成章节（/vol-outline-to-chapters：按「第N章」标记拆分卷大纲，缺失章节自动创建并写入各章大纲；无卷模式拆书级《大纲.md》、章节落书根）", callback: () => this.cmdVolumeOutlineToChapters() });
		this.addCommand({ id: "book-outline-generate", name: "生成书籍大纲（/book-outline-generate：依据全局设定与已有章节 AI 流式生成书级《大纲.md》——平铺模式逐章规划、有卷模式按卷划分事件与情节）", callback: () => this.cmdGenerateBookOutline() });
		this.addCommand({ id: "vol-outline-generate", name: "自动生成卷大纲（/vol-outline-generate：依据全局设定 AI 流式生成目标卷的 N 章卷大纲；无卷时按书级大纲自动建卷并逐卷生成）", callback: () => this.cmdGenerateVolOutline() });
		this.addCommand({ id: "vol-outline-sync", name: "同步卷大纲章节（/vol-outline-sync：卷大纲续写后，把新增的「第N章」标记建成新章节）", callback: () => this.cmdSyncVolOutlineChapters() });
		this.addCommand({ id: "book-outline-to-volumes", name: "从书级大纲生成卷（/book-outline-to-volumes：解析书级《大纲.md》的卷声明，逐卷生成全部卷及其卷大纲——缺失卷自动创建、只补缺失章）", callback: () => this.cmdBookOutlineToVolumes() });
		this.addCommand({ id: "timeline-generate", name: "生成时间线（/timeline-generate：以书籍信息与世界观为上下文，AI 流式生成书级《案头资料/时间线.md》——策划指南前置时间线的单独生成入口，已有有效条目时先确认后覆盖）", callback: () => this.cmdGenerateTimeline() });
		this.addCommand({ id: "planning-guide-worldview", name: "生成策划指南·仅世界观（/planning-guide-worldview：早期规划场景——输入仅世界观设定，AI 流式生成书级《策划指南.md》）", callback: () => this.cmdPlanningGuideWorldview() });
		this.addCommand({ id: "complete-outline-docs", name: "补全大纲资料（检查书根参与大纲生成的资料——大纲/策划指南/世界观/人物关系——缺失者按模板创建，已存在不覆盖）", callback: () => this.cmdCompleteOutlineDocs() });
		this.addCommand({ id: "worldview-generate", name: "生成世界观（/worldview-generate：以一句话设定为种子 AI 流式生成书级《案头资料/世界观.md》——全自动写书流水线首阶段，亦可单独运行）", callback: () => this.cmdGenerateWorldview() });
		this.addCommand({ id: "auto-book-stop", name: "停止全自动写书（中断当前生成并停止后续阶段）", callback: () => this.cmdStopAutoBook() });
		this.addCommand({ id: "auto-book-config", name: "配置全自动建书…（当前书执行范围/规模参数/一句话设定，写入《故事状态.md》auto_book 块；保存后「全自动写书」按配置免交互跑流水线）", callback: () => this.cmdAutoBookConfig() });
		this.addCommand({ id: "auto-book-run", name: "全自动写书（按当前书《故事状态.md》配置跑流水线：参数齐全弹范围确认，缺参弹窗补填）", callback: () => this.cmdAutoBookRun() });
		this.addCommand({ id: "skill-new", name: "新建 Skill…（写作技巧技能：名称＋内容预填格式模板，保存位置可选系统级 SKILLS/ 或书籍级 案头资料/Skill/；保存后不进入配置）", callback: () => this.cmdSkillNew() });
		this.addCommand({ id: "book-skill-phases", name: "书籍 Skill 阶段配置…（当前书五阶段各选用一个或多个 Skill，写入 故事状态.md，注入到系统 Skill 之后）", callback: () => this.cmdBookSkillPhases() });

		this.addCommand({ id: "chapter-delete", name: "删除章节（移入回收站并清理元数据）", callback: () => this.cmdChapterDelete() });
		this.addCommand({ id: "chapter-rename", name: "重命名章节标题（同步目录名与文档引用）", callback: () => this.cmdChapterRename() });
		this.addCommand({ id: "chapter-renumber", name: "重排全部章节编号为连续序号（含交叉引用改写）", callback: () => this.cmdChapterRenumber() });
		this.addCommand({ id: "rename-chapter-file", name: "重命名章节文件（将旧格式改为第NN章-章节名格式）", callback: () => this.cmdRenameChapterFile() });

		this.addCommand({ id: "pack-chapters", name: "打包章节合集（/pack：正文合辑单 MD，留空=当前章，支持 all/区间 3-7/列表 1、4、5；输出路径可自定义）", callback: () => this.cmdPackChapters() });
		this.addCommand({ id: "pack-volume", name: "导出卷合集（该卷全部章节正文合一 MD，默认 <书名>-<卷名>-合集.md；写字台卷节点右键同义入口）", callback: () => this.cmdPackVolume() });
		this.addCommand({ id: "rescan-story", name: "扫描重建小说状态文档（以磁盘为准）", callback: () => this.cmdRescanStory() });
		this.addCommand({ id: "update-state-doc", name: "更新故事状态文档（轻量同步：chapters 补缺删多＋刷新字数/卷归属，正文与书级参数不动；补齐缺失文档请用扫描重建）", callback: () => this.cmdUpdateStateDoc() });
		this.addCommand({ id: "state-complete", name: "补全故事状态可用参数（升级旧故事状态文档：把缺失的书级提示词组装选项补写进 frontmatter）", callback: () => this.cmdCompleteState() });
		this.addCommand({ id: "set-style", name: "设置编写类型（网文小说/剧本/普通小说/散文随笔…）", callback: () => this.cmdSetStyle() });
		this.addCommand({ id: "article-to-screenplay", name: "文章转剧本（按当前打开 Markdown 自动生成“原文件名+剧本.md”）", callback: () => this.cmdArticleToScreenplay() });
		this.addCommand({ id: "set-word-range", name: "设置本章字数区间（写入当前书《故事状态.md》word_range，正文生成提示词的字数要求）", callback: () => this.cmdSetWordRange() });
		this.addCommand({ id: "generate-usage-doc", name: "生成使用说明（在 work_dir 根建「使用说明.md」；已是当前插件版本则跳过，版本不符/升级则重建）", callback: () => this.cmdGenerateUsageDoc() });
		this.addCommand({ id: "llm-test", name: "LLM 连接测试（/llm test：GET /models 验证编写文章阶段配置）", callback: () => this.cmdLlmTest() });

		this.addCommand({ id: "write-chapter", name: "创作章节（/write：按大纲+指令 LLM 流式生成，自动去AI味后保存）", callback: () => this.cmdWrite() });
		this.addCommand({ id: "write-chapters-consecutive", name: "连续编写（/write-consecutive：按章节生成，每次只写当前章并停止，待下一次继续）", callback: () => this.cmdWriteConsecutive() });
		this.addCommand({ id: "continue-writing", name: "续写当前章（/continue：按本卷与本章大纲在正文末尾继续）", callback: () => this.cmdContinueWriting() });
		this.addCommand({ id: "rewrite-chapter", name: "重写本章（/rewrite：基于大纲与旧文整体重构）", callback: () => this.cmdRewriteChapter() });
		this.addCommand({ id: "polish-text", name: "润色当前章（/polish：仅优化文字表达不改情节）", callback: () => this.cmdPolishText() });
		this.addCommand({ id: "deai-clean", name: "去AI味（/deai：含 AI 常用词的句子打回 LLM 重写并原位替换）", callback: () => this.cmdDeaiClean() });
		this.addCommand({ id: "deai-ledger-resume", name: "补做去AI味（按《AI味清单.md》把连续编写中途停止时没洗完的章接着清洗）", callback: () => this.cmdDeaiLedgerResume() });
		this.addCommand({ id: "inspiration-kit", name: "灵感工具包（/inspiration：案头资料/灵感/灵感.md 内快速打开、定位到灵感、改名、删除、新增灵感块）", callback: () => this.cmdInspirationKit() });
		this.addCommand({ id: "fix-chapter-refs", name: "修复章节编号引用（/fix-refs：检测正文「第N章」类元引用，LLM 逐句改写后原位替换；留空=全部章节，填数字=指定章）", callback: () => this.cmdFixChapterRefs() });
		this.addCommand({ id: "typo-check", name: "错别字检测（/typo-check：LLM 扫描本章错字并加下划线标记，附建议改正）", callback: () => this.cmdTypoCheck() });
		this.addCommand({ id: "sensitive-check", name: "检测敏感词（零 LLM：按 SKILLS/敏感词清单.md 扫描本章，命中正文标色＋分类汇总；留空=当前章）", callback: () => this.cmdSensitiveCheck() });
		this.addCommand({ id: "sensitive-scan-all", name: "全书敏感词汇总（零 LLM：逐章扫描，分类汇总追加《案头资料/敏感词报告.md》）", callback: () => this.cmdSensitiveScanAll() });
		this.addCommand({ id: "review-chapter", name: "审阅本章（/review：全局视角查逻辑/连贯性问题出报告）", callback: () => this.cmdReviewChapter() });
		this.addCommand({ id: "export-ai-prompts", name: "导出AI提示词（/export-ai-prompts：按当前小说数据实拼各 AI 命令的 system/user 提示词，按功能一文件存入书根《AI提示词/》文件夹，不调用 LLM，供本地模型调试）", callback: () => void this.cmdExportPrompts() });
		this.addCommand({ id: "llm-chat", name: "打开 LLM 对话窗口（常驻面板：多轮流式聊天，可停靠任意区域、切换已保存的模型配置）", callback: () => void this.openLlmPanel() });
		this.addCommand({ id: "status-page", name: "打开写字台（当前书/章节/文件一览，点击小说或章节可切换激活）", callback: () => void this.openStatusPanel() });
		this.addCommand({ id: "relationship-panel", name: "打开人物关系面板（汇总书/卷/章三层关系，按类型·状态带图标展示，点击打开来源文档）", callback: () => void this.openRelationshipPanel() });
		this.addCommand({ id: "timeline-panel", name: "打开时间线面板（汇总书/卷/章三层《时间线.md》事件流，按时间点数值升序自上而下展示，支持节点增删改与关联跳转）", callback: () => void this.openTimelinePanel() });
		this.addCommand({ id: "scene-panel", name: "打开场景面板（汇总书/卷/章三层《场景.md》，卡片式展示）", callback: () => void this.openScenePanel() }); // v0.4.7+ 场景面板

		this.registerView(LlmChatView.VIEW_TYPE, (leaf) => new LlmChatView(leaf, () => this.settings.llm, () => this.getChatSystemPrompt(), () => this.getActiveStoryInfo(), (name) => this.setActiveLlmFromChat(name), () => this.chatSessionDir(), (raw) => this.collectChatAutoRefBlocks(raw), (name, args) => this.chatExecTool(name, args)));
		this.registerView(GenProgressView.VIEW_TYPE, (leaf) => new GenProgressView(leaf)); // v0.1.4+：摘要延迟生成的工作过程面板（notifyGenProgress 驱动）
		this.registerView(StatusView.VIEW_TYPE, (leaf) => new StatusView(leaf, () => this.getStatusSnapshot(), (name) => this.statusSwitchStory(name), (story, key) => this.statusActivateChapter(story, key), (a) => this.handleStatusAction(a), () => this.getStatusTyping(), () => this.endTypeSession())); // 第 6＝写字台「码字状态」Tab 数据源；第 7＝写字台打开/重开＝结束上次「本次写作」（下次敲字重新锚定）
		this.registerView(RelationshipView.VIEW_TYPE, (leaf) => new RelationshipView(leaf, () => this.getRelationshipSnapshot(), () => this.openAddCharacterDialog(), (name) => this.renameCharacterFlow(name), (name) => this.openEditCharacterDialog(name), (name) => this.deleteCharacterFlow(name))); // v0.1.9+：人物关系面板（展示只读，切书在写字台/命令里做；v0.2.0+ 头部「添加人物」注入写动作）
		this.registerView(TimelineView.VIEW_TYPE, (leaf) => new TimelineView(leaf, () => this.getTimelineSnapshot(), () => this.getTimelineCharOptions())); // v0.2.x+：时间线面板；v0.3.3+ 合并大事件：可编辑（节点增删改写回《时间线.md》），人物候选走 getTimelineCharOptions
		this.registerView(SceneView.VIEW_TYPE, (leaf) => new SceneView(leaf, () => this.getSceneSnapshot(), (moved) => this.moveSceneFlow(moved), (at) => this.addSceneFlow(undefined, at), (row) => this.editSceneFlow(row), (row) => this.deleteSceneFlow(row), (row, at) => this.addSceneFlow(row, at), (name) => this.openTimelineEventFlow(name))); // v0.4.7+：场景面板（卡片画布；写回＝整组位置拖动/新增/编辑/删除/添加子场景五流程；v0.4.9+ 新增可带画布落点＝空白处右键「在此添加场景」；v0.4.8+ 卡片「🕐」区事件点击＝跳时间线面板定位）
		this.addRibbonIcon("message-square", "打开 LLM 对话窗口（常驻面板）", () => void this.openLlmPanel());
		this.addRibbonIcon("book-open", "打开写字台（当前书/章节/文件）", () => void this.openStatusPanel());
		this.addRibbonIcon("users", "打开人物关系面板（书/卷/章三层关系）", () => void this.openRelationshipPanel());
		this.addRibbonIcon("history", "打开时间线面板（书/卷/章三层《时间线.md》事件流，可编辑）", () => void this.openTimelinePanel());
		this.addRibbonIcon("map", "打开场景面板（书/卷/章三层《场景.md》卡片）", () => void this.openScenePanel()); // v0.4.7+ 场景面板
		this.addSettingTab(new ArticleWriterSettingTab(this));

		// 工作目录内文件变更（编辑器写作自动落盘等）→ 防抖刷新所有已打开面板（写字台字数 + 人物关系 + 时间线），让改动实时跟进
		const watchFile = (file: TAbstractFile) => {
			if (!(file instanceof TFile) || !file.path.endsWith(".md") || !this.pathUnderWorkDir(file.path)) return;
			if (file.path.includes(`/${SYSTEM_PROMPT_SKILL_FOLDER}/`)) void this.refreshPromptSkillOverrides(); // v0.4.3+：编辑系统提示词技能即时生效
			this.schedulePanelRefresh();
		};
		this.registerEvent(this.app.vault.on("modify", watchFile));
		this.registerEvent(this.app.vault.on("create", watchFile));
		this.registerEvent(this.app.vault.on("delete", watchFile));
		// 主窗口重命名/移动（文件列表右键改名、拖拽）：触发时 file.path 已是新路径，须同时看 oldPath 判断是否涉及工作目录（覆盖跨边界移入/移出 workDir），任一侧为 .md 即可能改变面板枚举
		const watchRename = (file: TAbstractFile, oldPath: string) => {
			if (!(file instanceof TFile)) return;
			if (!((this.pathUnderWorkDir(file.path) || this.pathUnderWorkDir(oldPath)) && (file.path.endsWith(".md") || oldPath.endsWith(".md")))) return;
			if (file.path.includes(`/${SYSTEM_PROMPT_SKILL_FOLDER}/`) || oldPath.includes(`/${SYSTEM_PROMPT_SKILL_FOLDER}/`)) void this.refreshPromptSkillOverrides();
			this.schedulePanelRefresh();
		};
		this.registerEvent(this.app.vault.on("rename", watchRename));
		// v0.4.5+ 打字（码字）统计：编辑器内容变化 → 只统计当前小说目录内 .md 的有效键入，按段长（设置项「码字记录段长」，缺省 10 分钟）分桶；
		// 段边界被下一次键入跨过、或空闲由定时器兜底 → flush 一行到书级《案头资料/码字记录.md》（tick 取 15s：短段长下边界也能及时结算）
		this.registerEvent(this.app.workspace.on("editor-change", (editor, info) => this.onTypingEdit(editor, info)));
		// v0.4.6+ 修 C7：记录每个文件的 vault「modify」时刻——程序化写盘（错别字 span 落盘、LLM 覆盖、面板事件写回、状态文档同步等）
		// 的次序是 modify 事件 → 编辑器缓冲刷新 → editor-change；用户键入则相反（键入在先、自动保存 ≥2s 后才 modify）。
		// 据此在 onTypingEdit 里把「modify 后 500ms 内的 editor-change」判为程序化回声：只刷基线、不记字、不计键入、不锚定本次。
		this.registerEvent(this.app.vault.on("modify", (f) => {
			if (this.lastModifyAt.size > 500) for (const [k, t] of this.lastModifyAt) if (Date.now() - t > 5000) this.lastModifyAt.delete(k); // 防长会话堆积
			this.lastModifyAt.set(f.path, Date.now());
		}));
		// v0.4.6+ 修 C2：打开某章正文《章节.md》即激活该书该章——旧版 current_chapter 只经写字台 Radio/命令切换，
		// 文件列表里打开第 12 章后按「续写/重写/去AI味」会作用于旧的当前章（只有面板标题露章名，极易写错章）
		this.registerEvent(this.app.workspace.on("file-open", (file) => void this.syncCurrentChapterOnFileOpen(file)));
		this.registerInterval(window.setInterval(() => this.tickTypingStats(), 15_000));
		// v0.4.5+ 「本次写作」＝懒锚定（首次有效键入才计），因此不需要 active-leaf-change 钩子去「开一次」：
		// 写字台打开/重开走 StatusView.onOpen → endTypeSession（结束上次），停笔超过一个段长由 tick 兜底结束
		// v0.2.1+ 每本书独立工作区：布局任意变化（开/关/分栏/tab 切换等）→ 防抖把当前窗口状态存入「当前小说」的工作区文件；自身 changeLayout 恢复触发的回声事件被时间窗过滤
		this.registerEvent(this.app.workspace.on("layout-change", () => {
			if (Date.now() - this.lastWorkspaceRestoreAt < 3000) return; // 刚恢复过布局，跳过回存避免抖动
			const s = (this.settings.lastStory || "").trim();
			if (!s) return;
			if (this.wsSaveTimer != null) window.clearTimeout(this.wsSaveTimer);
			this.wsSaveTimer = window.setTimeout(() => { void this.captureBookWorkspace(s); }, 1500);
		}));
		void this.checkWorkspaceDirOnStartup(); // v0.2.1+ 启动自检：检测 workspaces/ 缺失则创建（仅 console 留痕，不落盘任何文件；原 .heartbeat.txt 诊断机制在 IO 通路验证后移除）
		// v0.2.20 启动即把写字台放进左栏切换列表（移动端抽屉可见可选）：等布局就绪后补位，不抢焦点、不展开抽屉
		this.app.workspace.onLayoutReady(() => { void this.ensureStatusInLeftSidebar(); });
	}

	/** 插件加载时检测一次工作区存档目录：缺失则递归创建；失败走统一上报（noteWsIoError），成功不打日志避免噪音 */
	private async checkWorkspaceDirOnStartup(): Promise<void> {
		try {
			await this.manager.ensureVaultDir(`${this.app.vault.configDir}/plugins/${this.manifest.id}/workspaces`);
		} catch (e) {
			this.noteWsIoError("工作区目录检测", e);
		}
	}

	async loadSettings(): Promise<void> {
		const saved = ((await this.loadData()) ?? {}) as Partial<ArticleWriterSettings> & { storyDir?: string };
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		if (!this.settings.workDir && saved.storyDir) this.settings.workDir = saved.storyDir; // 兼容旧设置键名
		if (!this.settings.llm) {
			// 首次运行（或 data.json 无 llm 段）：按 Python 用户配置文件结构预置标准模板，api_key/model_name 留空待填；不迁移旧的 ArticleWriter设置.md
			this.settings.llm = buildDefaultLlmConf();
			await this.saveData(this.settings);
			new Notice("已预置 3 组模型配置模板（local / deepseek / qwen-dashscope）\n请在 Obsidian 设置 → ArticleWriter 填写 api_key/模型名", 8000);
		} else {
			for (const cfg of this.settings.llm.llm_configs ?? []) {
				if (cfg.enabled == null) cfg.enabled = true;
			}
		}
		if (!this.settings.llm.writing_phases || this.settings.llm.writing_phases.length < 5) {
			// v0.2.24+：旧数据补字段：写作阶段模型配置骨架（各阶段 name/llm_config_name），不覆盖用户已有内容
			// v0.3.7+：「世界观生成」头插为阶段 0——恰为旧四阶段（length===4）时先头插新阶段骨架，原条目整体后移（已保存的 llm_config_name/ref_docs 随对象保留）
			// v0.3.4+：identity_boost 已 Skill 化——不再播种该字段；旧 data.json 残留值由 migrateIdentityBoostSkills() 在技能播种前迁移到 SKILLS/ 文件并从盘上清除
			const defaults = buildDefaultLlmConf();
			let phases = this.settings.llm.writing_phases ?? [];
			if (phases.length === 4) phases = [{ name: WRITING_PHASE_LABELS[0] }, ...phases];
			(defaults.writing_phases ?? []).forEach((def, i) => {
				if (!phases[i]) phases[i] = { name: def.name };
			});
			this.settings.llm.writing_phases = phases;
			await this.saveData(this.settings);
		}
		// v0.3.3+/v0.4.3+ 存量引用清单 key 静默迁移（REF_DOC_KEY_RENAMES：events_list→timeline、tension_rules→skill:张力工具箱）——保原位置、去重，有改动才落盘
		if (this.migrateRefDocKeys()) await this.saveData(this.settings);
	}

	/** 存量引用清单（各阶段 ref_docs ＋ 对话 chat_ref_docs）里的内置 key 按 REF_DOC_KEY_RENAMES 原位改写（迁移后重复项去重）；返回是否有改动。
	 *  张力规则并入张力工具箱（v0.4.3+）：旧清单里的 `tension_rules` 换成 `skill:张力工具箱`，注入位置与是否注入都照旧 */
	private migrateRefDocKeys(): boolean {
		const fix = (list: string[] | undefined): string[] | undefined => {
			if (!list || !list.some((k) => REF_DOC_KEY_RENAMES[k] !== undefined)) return undefined;
			const next: string[] = [];
			for (const k of list) {
				const nk = REF_DOC_KEY_RENAMES[k] ?? k;
				if (!next.includes(nk)) next.push(nk);
			}
			return next;
		};
		let changed = false;
		for (const p of this.settings.llm?.writing_phases ?? []) {
			const next = fix(p.ref_docs);
			if (next) { p.ref_docs = next; changed = true; }
		}
		const llm = this.settings.llm;
		if (llm) {
			const next = fix(llm.chat_ref_docs);
			if (next) { llm.chat_ref_docs = next; changed = true; }
		}
		return changed;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.notifyContextChanged(); // lastStory 等设置变更后同步刷新 LLM 面板顶部小说·章节行
	}

	// ---------- v0.2.1+ 每本书独立工作区：以书名命名的窗口布局存档，切书/加载书时恢复 ----------
	// 载体为插件数据目录裸文件 <configDir>/plugins/<id>/workspaces/<书名>.json（走 DataAdapter，不被索引收录）。
	// 内容＝{ v, platform, layout }——layout 即 workspace.getLayout() 全量布局对象；捕获时机＝离开该书（统一切换入口）与布局防抖自动存档。
	// Obsidian 自身启动时仍按全局会话恢复上次布局（不在此处干预），本功能只覆盖应用内的切书/加载书动作。

	/** 工作区 IO 失败的统一上报：console.error 全量细节；Notice 带真实报错文本且每会话仅首次弹出 */
	private noteWsIoError(where: string, e: unknown): void {
		console.error(`[articlewriter] ${where}：`, e);
		const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
		if (!this.wsIoErrorNoticed) {
			this.wsIoErrorNoticed = true;
			new Notice(`ArticleWriter：工作区存档读写失败（${msg.slice(0, 160)}），本次按书工作区不可用——详见开发者工具控制台 [articlewriter] 日志`, 12000);
		}
	}

	/** 「书名」的工作区存档路径（文件名=书籍名字本身，与顶层目录同名可互认） */
	bookWorkspacePath(story: string): string {
		return `${this.app.vault.configDir}/plugins/${this.manifest.id}/workspaces/${story}.json`;
	}

	/** 把当前窗口布局存入指定书的工作区文件；尽力而为，失败走 noteWsIoError 统一上报、不阻断调用方流程 */
	async captureBookWorkspace(story: string): Promise<void> {
		const s = story.trim();
		if (!s) return;
		if (!this.app.workspace.layoutReady) return; // 启动早期布局未就绪：静默跳过（后续防抖会再触发）
		try {
			const doc = { v: 1, platform: Platform.isDesktopApp ? "desktop" : "mobile", layout: this.app.workspace.getLayout() };
			await this.manager.writePluginFile(this.bookWorkspacePath(s), JSON.stringify(doc)); // 高频防抖路径：成功不打日志，失败走 noteWsIoError
		} catch (e) {
			this.noteWsIoError(`保存「${s}」的工作区`, e);
		}
	}

	/** 关闭主编辑区内所有打开的文档页签（侧栏停靠与浮动窗口不动，与工作区 getLayout/changeLayout 的作用域一致），给新书留空编辑器 */
	private closeOpenDocs(): void {
		try {
			const targets: WorkspaceLeaf[] = [];
			this.app.workspace.iterateRootLeaves((leaf) => { if (leaf.getViewState().type === "markdown") targets.push(leaf); }); // 先收集再逐个 detach：detach 会改动容器结构
			for (const leaf of targets) leaf.detach();
		} catch { /* 尽力而为的辅助动作，失败不影响切书主流程 */ }
	}

	/** 加载指定书的已存工作区布局（若有且同端类型）。closeIfNoArchive=true 时无存档则先关闭主编辑区全部打开文档再返回 false（仅显式切书入口传 true；命令隐式解析当前书不关，避免误清用户会话）；跨端/损坏一律保持现状。成功恢复弹 Notice 反馈 */
	async loadBookWorkspace(story: string, closeIfNoArchive = false): Promise<boolean> {
		const s = story.trim();
		if (!s) return false;
		if (!this.app.workspace.layoutReady) return false; // 启动早期布局未就绪：静默跳过
		let text: string | null = null;
		try { text = await this.manager.readPluginFile(this.bookWorkspacePath(s)); } catch (e) { this.noteWsIoError(`读取「${s}」的工作区`, e); return false; }
		if (!text || !text.trim()) { if (closeIfNoArchive) this.closeOpenDocs(); return false; } // 显式切书且目标无存档：清掉旧书文档页签，空编辑器开始；隐式解析则保持现状
		// 存档损坏 / 格式异常 / 跨端 / 缺 layout 段：一律保持现状静默返回 false（不阻断切书主流程）
		let env: { v?: number; platform?: string; layout?: Record<string, unknown> };
		try {
			const raw: unknown = JSON.parse(text); // 声明为 unknown 后逐层收窄，避免 any 直赋（any→unknown 赋值被规则豁免）
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
			env = raw; // 上方类型守卫已把 unknown 窄化为 object，env 各字段全可选可直接赋值（无需断言）
		} catch { return false; }
		if (env.platform && env.platform !== (Platform.isDesktopApp ? "desktop" : "mobile")) return false; // 桌面/移动布局结构不同，互不恢复
		const layout = env.layout;
		if (!layout || typeof layout !== "object" || Array.isArray(layout)) return false;
		this.lastWorkspaceRestoreAt = Date.now(); // 先打时间戳再换布局：changeLayout 引发的 layout-change 回声被过滤
		try {
			await this.app.workspace.changeLayout(layout);
			void this.ensureStatusInLeftSidebar(); // v0.2.20：changeLayout 全量替换会抹掉左栏（存档未含写字台时），立即补回保持常驻
			new Notice(`已加载「${s}」的工作区`, 4000);
			return true;
		} catch (e) {
			this.noteWsIoError(`恢复「${s}」的布局（changeLayout）`, e);
			return false;
		}
	}

	/** 切换/加载当前小说的统一入口（所有改 lastStory 的路径一律走这里）：先把旧书的窗口状态存进其工作区 → 写回 lastStory+saveSettings → 再恢复新书的工作区（若有）。closeIfNoArchive=true 时目标书无存档则关闭主编辑区全部打开文档（仅 /dir 选择器、写字台下拉框、新建书三个显式切书入口传 true；activeStory 等命令隐式解析不传，避免误清用户会话）。重选同一本书为无操作 */
	async applyStorySwitch(next: string, closeIfNoArchive = false): Promise<void> {
		const target = next.trim();
		const cur = (this.settings.lastStory || "").trim();
		if (!target || cur === target) return;
		await this.captureBookWorkspace(cur); // cur 为空时内部直接返回；正常流程不打日志（失败走 noteWsIoError）
		this.settings.lastStory = target;
		// v0.4.5+ 切书：结束上一本书的「本次写作」——顺带把它未落盘的段结算进该书《码字记录.md》（段归属按段上的 story，不按刚改的 lastStory）；
		// 新书的「本次」不预设起点，等第一次敲字再锚定（anchorTypeSession）
		this.endTypeSession();
		await this.saveSettings();
		await this.loadBookWorkspace(target, closeIfNoArchive);
	}

	// ---------- work_dir（首次使用必须选定写小说的文件夹）----------

	private async ensureWorkDir(): Promise<string | null> {
		const dir = this.settings.workDir.replace(/\/+$/, "");
		if (!dir) return this.pickWorkDir(true); // 首次使用：弹选择器初始化
		const f = this.app.vault.getAbstractFileByPath(dir);
		if (!(f instanceof TFolder)) {
			new Notice(`工作目录已不存在：${dir}，请重新选择`);
			return this.pickWorkDir(false);
		}
		return dir;
	}

	pickWorkDir(firstUse: boolean): Promise<string | null> {
		return new Promise((resolve) => {
			new FolderPickerModal(
				this.app,
				async (path) => {
					const prevStory = (this.settings.lastStory || "").trim();
					this.settings.workDir = path.replace(/\/+$/, "");
					await this.captureBookWorkspace(prevStory); // v0.2.1+：作废旧小说记忆前，先把其窗口状态归档进该书工作区
					this.settings.lastStory = ""; // 切换工作目录后清空旧小说记忆（对齐 CLI /dir）
					await this.saveSettings();
					let msg = firstUse ? `已初始化工作目录：${path || "vault 根"}` : `已切换工作目录：${path || "vault 根"}`;
					if (await this.seedUsageDoc()) msg += "；已在该目录投放《使用说明.md》（当前版本）"; // 设置/切换后把使用说明投放到 work_dir（版本戳一致则跳过）
					await this.migrateIdentityBoostSkills(); // v0.3.4+：新工作目录就位后再迁移旧 identity_boost（此前无 workDir 时启动迁移是空转）
					await this.migrateBannedWordsSkill(); // v0.3.6+：新工作目录就位后把旧 BANNED_WORDS.md 迁移并入其 SKILLS/ 禁用词清单技能（须在播种前）
					void this.purgeBannedWordsSkillArtifacts(); // v0.3.6+：清理旧插件数据目录 BANNED_WORDS.md 与未定制的旧内置技能「禁用词回避」
					void this.ensureSkillsFiles(); // v0.3.0+：切换工作目录后把内置技能播种到其 SKILLS/（仅缺失才写，不覆盖用户技能）
					try {
						const stories = await this.manager.listStories();
						if (stories.length === 0) {
							msg += "；该目录下还没有书，请先用「创建新小说」建书";
						} else if (stories.length === 1) {
							await this.applyStorySwitch(stories[0]); // 唯一一本书时直接加载（对齐 CLI /dir 到已有小说目录），并恢复其工作区
							msg += `；已加载唯一的小说：${stories[0]}`;
						} else {
							msg += `；共 ${stories.length} 本书，可用「切换当前小说」选择`;
						}
					} catch {
						/* 列表失败不影响切换结果 */
					}
					new Notice(msg, 8000);
					resolve(path);
				},
				() => resolve(null)
			).open();
		});
	}

	/** 切换当前小说（对齐 CLI /dir <work_dir>/<书名>：选书、设为当前并展示其状态） */
	async cmdSwitchStory(): Promise<void> {
		const dir = await this.ensureWorkDir();
		if (!dir) return;
		let stories: string[];
		try {
			stories = await this.manager.listStories();
		} catch (e) {
			this.notifyError("获取小说列表失败", e);
			return;
		}
		if (stories.length === 0) {
			new Notice(`工作目录下还没有书，请先用「创建新小说」建书`);
			return;
		}
		const items: ActionItem[] = [];
		for (const s of stories) {
			let sub = "";
			try {
				const state = await this.manager.loadState(s);
				const chCount = Object.keys(state?.chapters ?? {}).length;
				sub = `${chCount} 章`;
				if (state && state.current_chapter != null) sub += ` 当前第${String(state.current_chapter).padStart(2, "0")}章`;
			} catch {
				sub = "（状态读取失败）";
			}
			items.push({ label: s, sub, marker: s === this.settings.lastStory ? "▶ 当前" : undefined });
		}
		const idx = await this.pickAction("切换当前小说（/dir）", items);
		if (idx == null) return;
		await this.applyStorySwitch(stories[idx], true); // v0.2.1+：归档旧书工作区 + 写回 + 恢复所选书的工作区；显式切换→目标无存档则清空打开文档
		new Notice(`已切换到：${stories[idx]}`, 6000);
		await this.enforceVolumeLayoutOnSwitch(stories[idx]); // 平面结构 → 强制自动按卷整理（不可跳过）
		await this.cmdStatus(); // /dir 加载该书后展示章节与当前状态
	}

	// ---------- 活动小说解析：记住上次选择；多书时弹选择器 ----------

	private async activeStory(): Promise<string | null> {
		const stories = await this.manager.listStories();
		if (stories.length === 0) return null;
		if (this.settings.lastStory && stories.includes(this.settings.lastStory)) return this.settings.lastStory;
		if (stories.length === 1) {
			await this.applyStorySwitch(stories[0]); // v0.2.1+：加载唯一书时一并恢复其工作区
			return stories[0];
		}
		return new Promise((resolve) => {
			new StoryPickerModal(
				this.app,
				stories,
				async (name) => {
					await this.applyStorySwitch(name); // v0.2.1+：选书即切书，归档旧书并恢复所选书的工作区
					resolve(name);
				},
				() => resolve(null)
			).open();
		});
	}

	/** 无小说时先引导建书 */
	private async requireStory(): Promise<string | null> {
		let story = await this.activeStory();
		if (story == null) {
			new Notice("还没有小说，请先用「创建新小说」建书");
			story = await this.cmdNewStory();
		}
		return story || null;
	}

	// ---------- 按卷实体目录：布局门禁与整理命令 ----------

	/** 「按卷整理目录」核心执行（命令入口与切换强制迁移共用），完成后弹结果摘要 */
	private async runOrganizeVolumes(story: string): Promise<void> {
		const r = await this.manager.organizeByVolumes(story);
		const parts: string[] = [];
		if (r.movedKeys.length) parts.push(`${r.movedKeys.length} 章移入卷实体目录`);
		if (r.unassignedAtRoot) parts.push(`${r.unassignedAtRoot} 个未归属章节留在书根（正常）`);
		for (const uc of r.unknownContainers) parts.push(`未识别容器「${uc.folder}」含 ${uc.keys.join("、")}`);
		new Notice(parts.length ? `按卷整理完成：${parts.join("；")}` : "目录已按卷就位，无需移动", 8000);
	}

	/** 全书一个卷都没有时：弹一次批量新建卷页面（手动加名单、确定后按序创建；取消/空列表 = 跳过直接继续），供手动整理与切换强制迁移共用 */
	private async promptCreateVolumesIfEmpty(story: string): Promise<void> {
		if ((await this.manager.volumeList(story)).length > 0) return;
		new Notice(`《${story}》当前没有任何卷：可先在弹出的页面里建几个卷（取消 = 跳过、直接继续）`, 6000);
		const names = await this.pickNewVolumeNames(story);
		if (!names || !names.length) return;
		await this.createVolumesInOrder(story, names);
	}

	/** 主动新建卷的统一入口页：列表式批量输入（手动添加卷名、可调顺序/删除，确定 → 按列表顺序依次创建）；返回 null = 取消或空列表 */
	private async pickNewVolumeNames(story: string): Promise<string[] | null> {
		let existing: string[] = [];
		try {
			existing = (await this.manager.volumeList(story)).map((v) => v.name);
		} catch { /* 读取失败不阻断弹框，重名校验由 addVolume 兜底报错 */ }
		return await new Promise<string[] | null>((resolve) => {
			let settled = false;
			const finish = (v: string[] | null) => {
				if (!settled) {
					settled = true;
					resolve(v);
				}
			};
			new VolumeBatchCreateModal(this.app, story, existing, (names) => finish(names.length ? names : null), () => finish(null)).open();
		});
	}

	/** 按列表顺序逐个建卷（单个失败不中断其余），最后成功创建的设为当前卷，末尾汇总通知；返回最后一个成功卷的 id（全失败为 null） */
	private async createVolumesInOrder(story: string, names: string[]): Promise<string | null> {
		const ok: string[] = [];
		const failed: string[] = [];
		let lastId: string | null = null;
		for (const n of names) {
			try {
				const vol = await this.manager.addVolume(story, n, ""); // 唯一名校验 + 自动建同名实体目录
				ok.push(vol.name);
				lastId = vol.id;
			} catch (e) {
				failed.push(`${n}（${e instanceof Error ? e.message : String(e)}）`);
			}
		}
		if (lastId != null) await this.manager.activateVolume(story, lastId); // 最后成功的成为当前卷
		const parts: string[] = [];
		if (ok.length) parts.push(`已创建 ${ok.join("、")}`);
		if (failed.length) parts.push(`未建成：${failed.join("；")}`);
		new Notice(parts.join("；"), 8000);
		return lastId;
	}

	/** v0.0.16+：切换该书工作模式。enabled=false=无卷（若有卷则先拍平迁移回书根并删除全部卷实体目录——破坏性、需二次确认）；enabled=true=有卷（仅置位）。完成后刷新写字台 */
	async cmdVolumeMode(enabled: boolean): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const cur = (await this.manager.loadState(story))?.use_volumes ?? false;
			if (cur === enabled) {
				new Notice(`《${story}》已是「${enabled ? "有卷" : "无卷"}」模式，无需切换。`, 6000);
				return;
			}
			let volCount = 0;
			let chInVols = 0;
			try {
				volCount = (await this.manager.volumeList(story)).length;
				chInVols = (await this.manager.listChapters(story)).filter((c) => c.vol != null).length;
			} catch { /* 统计失败不阻断开关本身 */ }
			if (!enabled && volCount > 0) { // 破坏性：拍平并删除全部卷 → 必须二次确认
				const ok = await this.confirmBox(
					`把《${story}》的全部 ${volCount} 个卷拍平回书根？`,
					`${chInVols} 章将从各卷目录移回书根并在书内重新连续编号；各卷残留的直属文档（如卷大纲/人物等设定五件套）也将挪出到书根，跨卷同名者前面加「<卷名>-」前缀以免覆盖；随后 ${volCount} 个卷实体目录与卷.md 元数据清除进回收站。此操作不可撤销（可去 Obsidian 回收站找回）。`,
					"确认切换为无卷"
				);
				if (!ok) return;
			}
			const r = await this.manager.setVolumeMode(story, enabled);
			this.flatBlocked = null;
			new Notice(
				enabled
					? `已启用「有卷模式」：现在可用「新建卷」「管理卷」「按卷整理目录」。`
					: r.flattened
						? `已切换为「无卷模式」：拍平 ${r.movedKeys.length} 章${r.movedDocs ? `、挪出 ${r.movedDocs} 份卷内文档` : ""}回书根、移除 ${r.deletedVolumes} 个卷，保持纯 书籍→章节 结构。`
						: `已切换为「无卷模式」（本就无卷，仅锁定扁平结构）。`,
				10000
			);
		} catch (e) {
			this.notifyError("切换工作模式失败", e);
		}
	}

	/** v0.0.16+：无卷模式书触发卷操作时先自动切到「有卷」模式（setVolumeMode(true) 仅置位、非破坏性），再继续原逻辑 */
	private async ensureVolumeModeEnabled(story: string): Promise<void> {
		if ((await this.manager.loadState(story))?.use_volumes !== false) return;
		await this.manager.setVolumeMode(story, true);
		new Notice(`《${story}》已启用「有卷」模式，继续…`, 6000);
	}

	async cmdOrganizeVolumes(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		await this.ensureVolumeModeEnabled(story); // v0.0.16+：无卷模式先自动转为有卷再整理
		try {
			await this.promptCreateVolumesIfEmpty(story); // 无卷 → 先弹批量建卷页（手动加名单，取消 = 跳过）
			if (!(await this.manager.volumeList(story)).length) new Notice("该书没有卷：全部章节将留在书根。如需分卷管理请先到「新建卷」建卷再整理。", 8000);
			await this.runOrganizeVolumes(story);
			this.flatBlocked = null;
			await this.assignUnassignedChapters(story); // 书根残留的无归属章节 → 逐个让用户选择归入哪个卷
		} catch (e) {
			this.notifyError("按卷整理失败", e);
		}
	}

	/** 按卷整理收尾：对仍留书根的无归属章节，引导用户逐章选择归入哪个卷（物理移目录+写归属字段）；仅一卷时一次确认整体移动 */
	private async assignUnassignedChapters(story: string): Promise<void> {
		try {
			const base = this.manager.storyPath(story);
			const unassigned = (await this.manager.listChapters(story)).filter((c) => c.parentPath === base && !c.vol).sort((a, b) => a.num - b.num);
			if (!unassigned.length) return;
			const vols = await this.manager.volumeList(story);
			if (!vols.length) {
				new Notice(`书根还有 ${unassigned.length} 个未归属章节且暂无可分配的卷：请先「新建卷」后再运行「按卷整理目录」。`, 8000);
				return;
			}
			let assigned = 0;
			if (vols.length === 1) {
				const ok = await this.confirmBox(
					`把 ${unassigned.length} 个未归属章节全部移入唯一的卷「${vols[0].name}」？`,
					"章节目录将物理移入该卷实体目录并写入归属字段。",
					"全部移入"
				);
				if (!ok) return;
				for (const ch of unassigned) {
					try { await this.manager.setChapterVolume(story, ch.key, vols[0].id); assigned++; } catch { /* 单章失败保留原地，继续其余 */ }
				}
			} else {
				const ok = await this.confirmBox(
					`发现 ${unassigned.length} 个留在书根的未归属章节`,
					"现在可以逐章选择它们归入哪个卷（章节目录会物理移入对应卷目录）；也可以稍后在「管理卷→分配章节」里处理。",
					"开始分配"
				);
				if (!ok) return;
				const STOP = vols.length + 1; // 选项下标：卷们 / 留书根 / 停止分配
				for (let i = 0; i < unassigned.length; i++) {
					const ch = unassigned[i];
					const idx = await this.pickAction(
						`${this.chapterLabel(ch.num, ch.title)} 放到哪个卷？`,
						[
							...vols.map((v) => ({ label: v.name, sub: v.description || v.id })),
							{ label: "留在书根", sub: "本章暂不归属任何卷" },
							{ label: "停止分配", sub: `剩余 ${unassigned.length - i - 1} 章保持原样` },
						]
					);
					if (idx == null || idx === STOP) break; // Esc 或选「停止分配」→ 结束本轮
					if (idx >= vols.length) continue; // 「留在书根」
					try { await this.manager.setChapterVolume(story, ch.key, vols[idx].id); assigned++; } catch { /* 单章失败保留原地，继续其余 */ }
				}
			}
			new Notice(`未归属章节处理完成：${assigned} 章已移入卷目录${assigned < unassigned.length ? `，其余 ${unassigned.length - assigned} 章仍留书根` : ""}`, 8000);
		} catch (e) {
			this.notifyError("分配未归属章节失败", e);
		}
	}

	/** 结构操作门禁：该书若仍有平面残留（书根下带卷归属的章节），先引导执行整理；取消则阻断本次操作 */
	private async ensureVolumeLayout(story: string): Promise<boolean> {
		if (this.flatBlocked === story) {
			new Notice("该书的章节目录尚未按卷整理完毕，章节/卷操作已锁定：请先运行「按卷整理目录」命令。", 10000);
			return false;
		}
		try {
			const nums = await this.manager.needsVolumeOrganize(story);
			if (!nums.length) return true;
			const ok = await this.confirmBox(
				`《${story}》还有 ${nums.length} 个已归属卷的章节留在书根`,
				"启用「章节按卷实体目录归位」前，需要先把这些章节移入对应卷目录。点击确定将立即自动整理，之后继续你刚才的操作。",
				"立即整理"
			);
			if (!ok) {
				new Notice(`已取消：请先手动运行「按卷整理目录」（共 ${nums.length} 章待归位）后再进行章节/卷操作。`, 10000);
				return false;
			}
			await this.runOrganizeVolumes(story);
			return (await this.manager.needsVolumeOrganize(story)).length === 0;
		} catch (e) {
			this.notifyError("检查章节目录布局失败", e);
			return false;
		}
	}

	/** 切换书籍后调用：检测到平面结构则强制自动按卷整理（不可跳过）；**全书无卷时先弹批量建卷页**（VolumeBatchCreateModal：手动加名单、确定后按序创建；取消/空列表 = 跳过），覆盖两种残留——有卷但章留书根、或零卷却存在未识别章节目录；失败时锁定该书的结构操作 */
	private async enforceVolumeLayoutOnSwitch(story: string): Promise<void> {
		try {
			// 修复历史缺陷：误建的「NN章-标题」目录（缺「第」）补回前缀
			try {
				const repaired = await this.manager.repairUnprefixedChapterFolders(story);
				if (repaired > 0) new Notice(`已修复 ${repaired} 个章节目录名（补回「第」前缀）`, 8000);
			} catch (e) {
				this.notifyError("章节目录名修复失败", e);
			}
			// 旧格式模板文档检测与批量迁移（章节文件 → NN-标题-后缀.md；卷文件 → 卷名-后缀.md）
			try {
				const legacyDocs = await this.manager.detectOldFormatDocs(story);
				if (legacyDocs.length > 0) {
					const ok = await this.confirmBox(
						"检测到《" + story + "》有 " + legacyDocs.length + " 处旧格式文档",
						"旧格式模板文件名为裸名（如 章节.md / 卷大纲.md），新格式会在前面加上所属章节名/卷名（如 初见-章节.md / 风起-卷大纲.md）。是否立即批量更新？更新仅重命名文件，不改动内容。",
						"批量更新"
					);
					if (ok) {
						const result = await this.manager.migrateOldFormatDocs(legacyDocs);
						let noticeText = "已更新 " + result.migrated + " 处旧格式文档";
						if (result.errors.length) noticeText += "，失败 " + result.errors.length + " 处";
						new Notice(noticeText, 8000);
						if (result.errors.length) this.notifyError("部分文档迁移失败", new Error(result.errors.join("; ")));
					}
				}
			} catch (e) {
				this.notifyError("旧格式文档检测失败", e);
			}

			const st0 = await this.manager.loadState(story);
			if (st0 && !st0.use_volumes) { // v0.0.16+：无卷模式的书刻意保持纯 书→章 扁平结构，跳过建卷/按卷整理引导
				this.flatBlocked = null;
				return;
			}
			const nums = await this.manager.needsVolumeOrganize(story); // 有卷时的平面残留（needsVolumeOrganize 对零卷书恒返回 []）
			let strayContainer = false;
			if (!nums.length) {
				strayContainer = (await this.manager.volumeList(story)).length === 0 &&
					(await this.manager.listChapters(story)).some((c) => c.parentPath !== this.manager.storyPath(story) && !c.vol); // 零卷 + 遗留子目录含章节 → 也视为待整理
			}
			if (!nums.length && !strayContainer) {
				this.flatBlocked = null;
				return;
			}
			



await this.promptCreateVolumesIfEmpty(story); // 零卷 → 先弹建卷框（新建与遗留目录同名的卷，其内章节立即归属）
			new Notice(nums.length ? `《${story}》仍为平面结构（${nums.length} 章带卷归属），正在自动按卷整理…` : `《${story}》存在未识别章节目录，正在自动按卷整理…`, 5000);
			await this.runOrganizeVolumes(story);
			this.flatBlocked = (await this.manager.needsVolumeOrganize(story)).length ? story : null;
		} catch (e) {
			this.flatBlocked = story;
			this.notifyError("自动按卷整理失败", e);
			new Notice("章节/卷操作已临时锁定：请稍后手动运行「按卷整理目录」命令。", 12000);
		}
	}

	// ---------- 交互辅助 ----------

	private prompt(title: string, placeholder: string, hint?: string, initial?: string, multiline?: boolean): Promise<string | null> { // v0.1.6+：可选 hint 渲染在输入框上方（详细说明），placeholder 只留极短占位；initial 预填初始值（光标置末尾）；v0.3.7+ multiline＝5 行 textarea（占满行宽，回车换行、Ctrl/Cmd+回车提交）
		// v0.4.6+ 对话工具调用：写作命令经 chatExecTool 代跑时，本次补充要求由工具参数预答（一次性消耗，其余弹窗照常交互）
		if (this.chatToolCtx && this.chatToolCtx.instruction != null && !this.chatToolCtx.instructionUsed) {
			this.chatToolCtx.instructionUsed = true;
			return Promise.resolve(this.chatToolCtx.instruction);
		}
		return new Promise((resolve) => {
			new TextInputModal(
				this.app,
				title,
				placeholder,
				(value) => resolve(value),
				() => resolve(null),
				hint,
				initial,
				multiline
			).open();
		});
	}

	/** 收集目标章数核心（v0.2.25+ 起支持 initial 预填当前值，如卷数量预填现有卷数）：弹窗输入正整数（v0.2.x+ 起不设上限），非法输入重弹，取消返回 null；cancelText 为取消时的 Notice 文案 */
	private async promptChapterCountInput(title: string, hint: string, cancelText: string, fieldLabel = "目标章数（正整数，如 5）", initial?: string): Promise<number | null> {
		if (this.auto) { // v0.3.0+ auto-book 免交互：当前阶段显式答案（countOverride）优先，否则各卷章数末值兜底；两者皆无＝参数缺失、取消该步（防御，正常流水线不会走到）
			const n = this.auto.countOverride ?? this.auto.chapterCounts[this.auto.chapterCounts.length - 1];
			if (n == null) { new Notice(`全自动流水线缺少「${title}」的章数参数，该步骤已取消`, 6000); return null; }
			return n;
		}
		for (;;) {
			const raw = await this.prompt(title, fieldLabel, hint, initial);
			if (raw == null || raw === "") { new Notice(cancelText, 4000); return null; } // 取消（静默中止会让用户误以为命令卡死）
			if (!/^\d+$/.test(raw.trim())) { new Notice(`章数无效：请输入正整数（收到「${raw}」）`, 6000); continue; }
			const n = Number(raw.trim());
			if (Number.isSafeInteger(n) && n >= 1) return n;
			new Notice(`章数无效：请输入正整数（收到「${raw}」）`, 6000);
		}
	}

	/** v0.4.6+ 手动规模弹窗与《故事状态.md》auto_book 双向同步的共用取数：该卷在 chapter_counts（按卷阅读序）中的预定章数，
	 *  该位无值取末值复制（与 auto 流水线末值兜底同口径）；数组缺失返回 undefined（不预填） */
	private autoVolCountFor(state: StoryState, volIdx: number): number | undefined {
		const cc = state.auto_book?.chapter_counts ?? [];
		if (!cc.length) return undefined;
		return cc[volIdx] ?? cc[cc.length - 1];
	}

	/** v0.4.6+ 「该卷章数」写回 auto_book.chapter_counts（按卷阅读序）：覆盖既有位／向后追加均可，中间空洞按末值复制补齐
	 *  （与 auto 流水线「counts[i] ?? 末值」同口径，不凭空编造与预填不一致的数）。改脏即落盘由调用方 saveState */
	private setAutoVolCount(state: StoryState, volIdx: number, n: number): void {
		const cc = state.auto_book?.chapter_counts ?? [];
		const next = [...cc];
		while (next.length < volIdx) next.push(next.length ? next[next.length - 1] : n);
		next[volIdx] = n;
		state.auto_book = { ...(state.auto_book ?? {}), chapter_counts: next };
	}

	/** v0.4.6+ 「各卷章数」整串写回 auto_book.chapter_counts：与存值一致零写盘；auto 流水线不适用（参数本就来自该字段） */
	private async saveAutoVolCounts(story: string, state: StoryState, counts: number[]): Promise<void> {
		if (this.auto) return;
		if ((state.auto_book?.chapter_counts ?? []).join() === counts.join()) return;
		state.auto_book = { ...(state.auto_book ?? {}), chapter_counts: [...counts] };
		await this.manager.saveState(story, state);
	}

	/** v0.2.x+ 大纲「继续生成」模式选择：目标大纲非空时先问完整生成还是按已有进度继续生成；返回 0=完整 / 1=继续 / null=取消 */
	private async promptOutlineGenMode(title: string): Promise<number | null> {
		if (this.auto) return 0; // v0.3.0+ auto-book 免交互：已有大纲走完整生成（覆盖与否由 overwrite 决定）
		return this.pickAction(`${title}：现有大纲非空，请选择生成方式`, [
			{ label: "完整生成", sub: "重新生成整份大纲（保存时再选覆盖/追加）" },
			{ label: "继续生成（按已有进度）", sub: "从已有大纲最后一章之后，按指定章数向后追加新内容" },
		]);
	}

	/** 「补全故事状态可用参数」专用：收集一个书级章窗口参数（prev_chapters／next_chapters 共用，v0.4.3+ 抽公共）——
	 *  非负整数（0＝不注入该方向）、预填当前全局生效值、非法输入重弹、取消返回 null */
	private async promptWindowChaptersInput(opts: {
		story: string;
		field: string;
		title: string;
		placeholder: string;
		what: string;
		zeroMeans: string;
		prefill: number;
	}): Promise<number | null> {
		for (;;) {
			const raw = await this.prompt(
				opts.title,
				opts.placeholder,
				[
					`《${opts.story}》的故事状态文档缺少书级参数 ${opts.field}（${opts.what}）。`,
					`输入非负整数：0＝${opts.zeroMeans}；当前按全局设置生效（N=${opts.prefill}，已预填在输入框）。`,
					"输入后按回车确认、Esc 取消：",
				].join("\n"),
				String(opts.prefill)
			);
			if (raw == null) { new Notice("已取消补全故事状态参数", 4000); return null; }
			if (!/^\d+$/.test(raw.trim())) { new Notice(`数值无效：请输入非负整数（收到「${raw}」）`, 6000); continue; }
			return parseInt(raw.trim(), 10);
		}
	}

	/** v0.2.x+：收集书级 prev_chapters（前文窗口章数） */
	private async promptPrevChaptersInput(story: string): Promise<number | null> {
		return this.promptWindowChaptersInput({
			story,
			field: "prev_chapters",
			title: "使用章节摘要数量（prev_chapters）",
			placeholder: "前文窗口章数 N（非负整数，如 3）",
			what: "写作提示词「前文内容」窗口章数；编写文章阶段的大纲节选也按它取当前章之前 N 章",
			zeroMeans: "不注入前文",
			prefill: this.effectivePrevN(),
		});
	}

	/** v0.4.3+：收集书级 next_chapters（后文窗口章数，编写文章阶段大纲节选取当前章之后 N 章） */
	private async promptNextChaptersInput(story: string): Promise<number | null> {
		return this.promptWindowChaptersInput({
			story,
			field: "next_chapters",
			title: "后续参考章数（next_chapters）",
			placeholder: "后文窗口章数 N（非负整数，如 3）",
			what: "编写文章阶段大纲节选取当前章之后 N 章",
			zeroMeans: "不注入后章大纲",
			prefill: this.effectiveNextN(),
		});
	}

	/** v0.3.5+「设置本章字数区间」：弹窗收集 [下限,上限]，写入《故事状态.md》word_range（取代旧 WRITING_GUIDE 指南「字数配置」注释）；输入「4000-5000」「4000~5000」「4000 5000」皆可，非法重弹，取消返回 null */
	private async promptWordRangeInput(story: string, initial?: [number, number]): Promise<[number, number] | null> {
		const cur = initial ?? this.wordRangeOf(await this.manager.loadState(story));
		for (;;) {
			const raw = await this.prompt(
				"正文字数区间（word_range）",
				[
					`《${story}》正文生成提示词的字数要求（写入《故事状态.md》frontmatter 的 word_range）。`,
					`格式：下限-上限（如 4000-5000），也可用 ~ ／ 逗号 ／ 空格分隔；两个正整数且下限≤上限。`,
					`当前生效值 ${cur[0]}-${cur[1]}（已预填在输入框）。输入后按回车确认、Esc 取消：`,
				].join("\n"),
				`${cur[0]}-${cur[1]}`
			);
			if (raw == null) { new Notice("已取消设置字数区间", 4000); return null; }
			const m = /^\s*(\d+)\s*(?:[-~～至到]|,|\s)\s*(\d+)\s*$/.exec(raw.trim());
			if (!m) { new Notice(`格式无效：请输入「下限-上限」（收到「${raw}」）`, 6000); continue; }
			const lo = parseInt(m[1], 10);
			const hi = parseInt(m[2], 10);
			if (lo <= 0 || lo > hi) { new Notice(`数值无效：要求 0 < 下限 ≤ 上限（收到 ${lo}-${hi}）`, 6000); continue; }
			return [lo, hi];
		}
	}

	/** AI 兜底拆分收集目标章数（v0.2.10+；v0.4.6+ 升级为与《故事状态.md》auto_book 双向同步）：
	 *  vol=null＝平铺书级拆分，同步 chapters（全书总章数，同「生成书籍大纲」弹窗口径）；
	 *  vol＝卷拆分，预填/写回 chapter_counts 中该卷阅读序位次（缺位取末值复制预填，写回经 setAutoVolCount 补洞） */
	private async promptSplitCountSync(story: string, state: StoryState, vol: { id: string; name: string } | null): Promise<number | null> {
		if (!vol) {
			const saved = state.auto_book?.chapters;
			const c = await this.promptChapterCountInput(
				"AI 拆分书级大纲",
				`书级《大纲.md》未检测到「第N章」标记，将调用 AI 自动拆分。\n请输入要拆分的章数（正整数，不设上限），输入后按回车确认、Esc 取消：${saved != null ? `\n（上次全书总章数 ${String(saved)} 已预填，改值将存回《故事状态.md》）` : ""}`,
				"已取消 AI 拆分书级大纲",
				"目标章数（正整数，如 5）",
				saved != null ? String(saved) : undefined,
			);
			if (c != null && saved !== c && !this.auto) {
				state.auto_book = { ...(state.auto_book ?? {}), chapters: c };
				await this.manager.saveState(story, state);
			}
			return c;
		}
		const vols = Object.values(await this.manager.loadVolumes(story)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
		const idx = vols.findIndex((v) => v.id === vol.id);
		const pre = idx >= 0 ? this.autoVolCountFor(state, idx) : undefined;
		const c = await this.promptChapterCountInput(
			"AI 拆分卷大纲",
			`「${vol.name}」的卷大纲未检测到「第N章」标记，将调用 AI 自动拆分。\n请指定要拆分的章数（正整数，不设上限），输入后按回车确认、Esc 取消：${pre != null ? `\n（auto_book.chapter_counts 该卷预定章数 ${String(pre)} 已预填，改值将存回）` : ""}`,
			"已取消 AI 拆分卷大纲",
			"目标章数（正整数，如 8）",
			pre != null ? String(pre) : undefined,
		);
		if (c != null && idx >= 0 && !this.auto && (state.auto_book?.chapter_counts ?? [])[idx] !== c) {
			this.setAutoVolCount(state, idx, c);
			await this.manager.saveState(story, state);
		}
		return c;
	}

	/** v0.2.x+「从书级大纲生成卷」/「自动生成卷大纲」无卷兜底共用：单个弹窗一次性问全所有卷的目标章数（逗号/顿号/空格分隔、数量须等于卷数、每卷正整数，v0.2.x+ 起不设上限）；非法输入重弹，取消返回 null。title＝弹窗标题与取消提示前缀（默认「从书级大纲生成卷」） */
	private async promptAllVolumeChapterCounts(decls: VolumeDeclaration[], title = "从书级大纲生成卷", initial?: number[]): Promise<number[] | null> {
		if (this.auto) { // v0.3.0+ auto-book 免交互：各卷章数取流水线参数；与卷声明数不齐时以末值复制补齐（卷声明数由 LLM 生成、可能与弹窗卷数不同）
			const src = this.auto.chapterCounts;
			if (!src.length) return null;
			return decls.map((_, i) => src[i] ?? src[src.length - 1]);
		}
		const names = decls.map((d, i) => `${i + 1}. ${d.name}`).join("\n");
		const pre = initial && initial.length === decls.length ? initial.join(",") : undefined; // v0.4.6+ auto_book.chapter_counts 已覆盖同样卷数时整串预填（改值由调用方写回）
		for (;;) {
			const raw = await this.prompt(title, `各卷目标章数（${decls.length} 个整数，如 8,6）`, [
				"书级《大纲.md》中识别到以下卷，请按顺序为每一卷输入目标章数（正整数，不设上限）：",
				names,
				`共 ${decls.length} 个数，用逗号 / 顿号 / 空格分隔（如 ${decls.map(() => "8").join(",")}）。`,
				...(pre ? [`上次配置的各卷章数已预填（来自《故事状态.md》auto_book.chapter_counts），改值将存回。`] : []),
			].join("\n"), pre);
			if (raw == null || raw.trim() === "") { new Notice(`已取消${title}`, 4000); return null; } // 取消（静默中止会让用户误以为命令卡死）
			const parts = raw.split(/[,，、\s]+/).filter(Boolean);
			if (parts.length !== decls.length) { new Notice(`请输入 ${decls.length} 个章数（每卷一个，收到 ${parts.length} 个：「${raw}」）`, 6000); continue; }
			const nums: number[] = [];
			let bad = false;
			for (const p of parts) {
				const v = /^\d+$/.test(p) ? Number(p) : NaN;
				if (!(Number.isSafeInteger(v) && v >= 1)) { bad = true; break; }
				nums.push(v);
			}
			if (!bad) return nums;
			new Notice(`章数无效：请为每卷输入正整数（收到「${raw}」）`, 6000);
		}
	}

	private pickNewDoc(title: string, options: Array<{ name: string; exists: boolean }>): Promise<{ kind: "custom"; name: string } | { kind: "std"; name: string } | null> { // v0.1.8+：新建文档单弹窗——全宽输入框（内部提示「自定义文件名…」）+下方「确定」按钮，标准文档名可点选回填；与标准文档同名时走 std 路径由调用方二次确认后按模板创建
		return new Promise((resolve) => {
			new NewFilePickerModal(this.app, title, options, (r) => resolve(r), () => resolve(null)).open();
		});
	}

	/** v0.4.7+ 按 vault 默认方式新建空 .md（写字台各「新建文档/文章」自定义名路径共用）：
	 *  父目录缺失自动补建；同名不报错而是按 Obsidian 风格取「名 1」「名 2」；建好即在编辑器打开——不弹确认、不弹 Notice */
	private async createVaultDefaultDoc(folder: string, name: string): Promise<string> {
		await ensureParentFolders(this.app, `${folder}/placeholder.md`); // 逐级补建容器目录（卷「文档」子目录可能尚未创建）
		let base = safeFilename(name);
		if (!base.toLowerCase().endsWith(".md")) base += ".md";
		if (base === ".md") throw new Error("文件名为空或全是被过滤掉的字符"); // 输入只剩非法字符时 safeFilename 会清空——直接报可读错误，别建出无名的 .md
		let path = `${folder}/${base}`;
		for (let n = 1; this.app.vault.getAbstractFileByPath(path); n++) path = `${folder}/${base.replace(/\.md$/i, "")} ${String(n)}.md`; // 同名顺延，同 Obsidian 新建文件默认行为
		const f = await this.app.vault.create(path, "");
		await this.app.workspace.getLeaf(false).openFile(f); // 建完即在编辑器打开（Obsidian 默认新建即打开编辑）
		return path;
	}

	private async pickNewStoryInput(): Promise<NewStoryInput | null> {
		await this.ensureSkillsFiles(); // v0.4.3+：先播种再列目录，保证新装的题材/编写类型技能可选
		const genres = await this.listFolderSkillNames(GENRE_SKILL_FOLDER);
		const styles = await this.listFolderSkillNames(WRITING_STYLE_SKILL_FOLDER);
		return new Promise((resolve) => {
			new NewStoryModal(this.app, (input) => resolve(input), () => resolve(null), genres, styles).open();
		});
	}

	/** v0.4.3+ 修改现有小说的题材/编写类型：下拉同样取系统技能目录（题材/、编写类型/） */
	private async pickStoryMetaInput(currentGenre: string, currentStyle: string): Promise<StoryMetaInput | null> {
		await this.ensureSkillsFiles();
		const genres = await this.listFolderSkillNames(GENRE_SKILL_FOLDER);
		const styles = await this.listFolderSkillNames(WRITING_STYLE_SKILL_FOLDER);
		return new Promise((resolve) => {
			new StoryMetaModal(this.app, currentGenre, currentStyle, genres, styles, (input) => resolve(input), () => resolve(null)).open();
		});
	}

	/** v0.4.3+ 修改当前小说信息（题材/编写类型）：只改《故事状态.md》两字段，不动书名/目录 */
	async cmdEditStoryMeta(storyArg?: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = storyArg ?? (await this.requireStory());
		if (!story) return;
		try {
			const state = await this.manager.validatedState(story);
			const input = await this.pickStoryMetaInput(state.genre || "", state.writing_style || "");
			if (!input) return;
			state.genre = input.genre;
			state.writing_style = input.style;
			await this.manager.saveState(story, state);
			new Notice(`已更新《${story}》：题材「${input.genre}」/ 编写类型「${input.style}」`, 6000);
			this.scheduleStatusPanelRefresh(0);
			this.scheduleRelationshipPanelRefresh(0);
		} catch (e) {
			this.notifyError("修改小说信息失败", e);
		}
	}

	// ---------- 命令实现 ----------

	async cmdNewStory(): Promise<string | null> {
		if (!(await this.ensureWorkDir())) return null;
		const input = await this.pickNewStoryInput();
		if (!input) return null;
		try {
			const name = await this.manager.createStory(input.title, input.genre, input.style);
			await this.applyStorySwitch(name, true); // v0.2.1+：新书成为当前书——先归档原当前书的窗口状态；新书必无存档→关闭旧书打开的文档，空编辑器开始
			new Notice(`已创建小说「${name}」：文件夹与模板文档就绪`);
			if (this.settings.autoOpenOnCreate) {
				await this.manager.openMarkdown(`${this.manager.storyPath(name)}/大纲.md`);
			}
			return name;
		} catch (e) {
			new Notice(`创建失败：${(e as Error).message}`);
			return null;
		}
	}

	async cmdNewChapter(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		const chapters = await this.manager.listChapters(story);
		const curVol = ((await this.manager.loadState(story))?.current_volume ?? "").trim(); // 有当前卷 → 新章直接落卷实体目录并写归属字段（v0.0.15：编号在容器内自动顺延）
		const base = this.manager.storyPath(story);
		const inScope = curVol ? chapters.filter((c) => c.vol === curVol) : chapters.filter((c) => !c.vol && c.parentPath === base);
		const nextNum = inScope.length ? Math.max(...inScope.map((c) => c.num)) + 1 : 1;
		let volName = "";
		try { if (curVol) volName = this.manager.findVolumeIn(await this.manager.loadVolumes(story), curVol)?.name ?? curVol; } catch { volName = curVol; }
		const scopeLabel = curVol ? `卷「${volName}」` : "书根";
		const title = await this.prompt(`新建章节（将成为 ${scopeLabel}第${nextNum}章）`, "章节标题");
		if (title == null || !title.trim()) return;
		try {
			const bodyPath = await this.manager.createChapter(story, title.trim(), curVol);
			new Notice(`已创建 ${scopeLabel}第${String(nextNum).padStart(2, "0")}章-${title.trim()}：章节目录与文档就绪`);
			if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(bodyPath);
		} catch (e) {
			new Notice(`创建失败：${(e as Error).message}`);
		}
	}

	/** 在当前激活章（无则先选）之前/之后插入新空章节：本容器内 ≥插入位的各章整体 +1、引用同步重写（manager.insertChapter），完成后聚焦新章 */
	async cmdInsertChapter(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const chapters = await this.manager.listChapters(story);
			if (!chapters.length) {
				new Notice("还没有章节，先用「新建章节」创建第一章");
				return;
			}
			const volNames = await this.volNameMap(story);
			const cur = (await this.manager.loadState(story))?.current_chapter ?? null;
			let refIdx: number | null = cur != null ? chapters.findIndex((c) => c.key === cur) : -1;
			if (refIdx < 0) {
				refIdx = await this.pickAction(
					"选择参照章节（在其之前/之后插入）",
					chapters.map((c) => ({ label: this.keyLabel(c.key, volNames, c.title), marker: cur === c.key ? "▶ 当前" : undefined }))
				);
				if (refIdx == null) return;
			}
			const ref = chapters[refIdx];
			const posIdx = await this.pickAction(`相对 ${this.keyLabel(ref.key, volNames)} 的插入位置`, [
				{ label: `之前 → 新章成为第${String(ref.num).padStart(2, "0")}章，原该章及本容器后续各 +1` },
				{ label: `之后 → 新章成为第${String(ref.num + 1).padStart(2, "0")}章，其后的章各 +1` },
			]);
			if (posIdx == null) return;
			const newNum = posIdx === 0 ? ref.num : ref.num + 1;
			const t = await this.prompt(`新建第${newNum}章`, "章节标题");
			if (t == null) return;
			const title = t.trim() || String(newNum); // 留空沿用建章惯例：以编号作标题
			const r = await this.manager.insertChapter(story, ref.key, posIdx === 0 ? "before" : "after", title);
			new Notice(`${this.keyLabel(r.key, volNames, title)} 已插入；本卷内后续章节号与文档引用已顺延更新`, 6000);
			if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(r.path);
		} catch (e) {
			this.notifyError("插入章节失败", e);
		}
	}

	async cmdListChapters(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const chapters = await this.manager.listChapters(story);
		if (chapters.length === 0) {
			new Notice("还没有章节，先用「新建章节」创建第一章");
			return;
		}
		const state = await this.manager.loadState(story);
		const volNames = await this.volNameMap(story);
		new ChapterListModal(
			this.app,
			chapters.map((c) => ({ num: c.num, key: c.key, title: c.title, path: c.dir.path, isCurrent: state?.current_chapter === c.key, display: this.keyLabel(c.key, volNames, c.title) })),
			async (item) => {
				const bodyPath = await this.manager.switchChapter(story, item.key ?? String(item.num));
				if (bodyPath) await this.manager.openMarkdown(bodyPath);
			}
		).open();
	}

	/** 打开总大纲（缺失时按书名生成模板，对齐 CLI create_book_docs 的 大纲.md 初始内容） */
	async cmdOpenOutline(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.activeStory();
		if (!story) return;
		try {
			const state = await this.manager.loadState(story);
			await this.manager.openStoryDoc(story, "大纲.md", outlineTemplate((state?.title ?? "").trim() || story));
		} catch (e) {
			new Notice(`打开失败：${(e as Error).message}`);
		}
	}

	async cmdOpenDoc(docName: string, template: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.activeStory();
		if (!story) return;
		try {
			await this.manager.openStoryDoc(story, docName, template);
		} catch (e) {
			new Notice(`打开失败：${(e as Error).message}`);
		}
	}

	async cmdNextOrPrev(dir: 1 | -1): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const result = await this.manager.nextOrPrev(story, dir);
		if (!result) {
			new Notice("已到边界，没有更多章节");
			return;
		}
		await this.manager.openMarkdown(result.path);
		new Notice(`已切换到第${String(result.num).padStart(2, "0")}章`);
	}

	async cmdCount(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		if (state?.current_chapter == null) {
			new Notice("还没有当前章节，先新建或切换章节");
			return;
		}
		const rows = await this.manager.countWords(story, state.current_chapter);
		const row = rows[0];
		new Notice(row ? `第${String(row.num).padStart(2, "0")}章 ${row.title}：纯文字 ${row.words} 字（含标点 ${row.chars} 字；投稿平台字数多按含标点计）` : "该章节无正文", 5000);
	}

	async cmdCountAll(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const rows = await this.manager.countWords(story);
		if (rows.length === 0) {
			new Notice("还没有章节");
			return;
		}
		let total = 0;
		let totalChars = 0;
		for (const r of rows) {
			total += r.words;
			totalChars += r.chars;
		}
		new StatusModal(this.app, [
			"各章字数（纯文字 / 含标点）：",
			...rows.map((r) => `  第${String(r.num).padStart(2, "0")}章 ${r.title} ${r.words} / ${r.chars} 字`),
			`合计：纯文字 ${total} 字（含标点 ${totalChars} 字；投稿平台字数多按含标点计）`,
		]).open();
	}

	async cmdSave(): Promise<void> {
		const words = await this.manager.saveCurrentChapter();
		if (words < 0) {
			new Notice("当前打开的不是 章节.md，无法保存");
			return;
		}
		new Notice(`已保存当前章节（纯文字 ${words} 字）`);
	}

	async cmdStatus(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.activeStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		if (!state) {
			new Notice("未找到小说状态文档（故事状态.md / story_state.json）");
			return;
		}
		const chapters = await this.manager.listChapters(story);
		let total = 0;
		for (const ch of chapters) {
			const f = await this.manager.chapterBodyFile(story, ch.key);
			if (f instanceof TFile) total += countPureWords(await this.app.vault.read(f));
		}
		const lines: string[] = [
			`书名：${state.title}`,
			`题材：${state.genre || "-"} 编写类型：${state.writing_style || "-"}`,
			`当前章节：${state.current_chapter != null ? `第${String(state.current_chapter).padStart(2, "0")}章` : "无"}`,
		];
		let volName = "";
		try {
			if (state.current_volume) {
				const vols = await this.manager.loadVolumes(story);
				volName = this.manager.findVolumeIn(vols, state.current_volume)?.name ?? state.current_volume;
			}
		} catch {
			volName = state.current_volume || "";
		}
		lines.push(`当前卷：${volName || "-"} 当前场景：${state.current_scene || "-"}`);
		lines.push(`章节数：${chapters.length} 总字数（纯文字）：${total}`);
		lines.push(`创建：${formatLocalDateTime(state.created_at, true)} 更新：${formatLocalDateTime(state.updated_at, true)}`);
		new StatusModal(this.app, lines).open();
	}

	// ---------- 通用交互辅助 ----------

	private chapterLabel(num: number, title?: string): string {
		return `第${String(num).padStart(2, "0")}章${title ? ` ${title}` : ""}`;
	}

	/** v0.0.15：卷内编号的展示名（带卷前缀）："第二卷·第03章 标题" / "第05章 标题" */
	private keyLabel(key: string, volNames?: Record<string, string>, title?: string): string {
		const p = parseChKey(key);
		const base = this.chapterLabel(p.num, title);
		return p.vol ? `${volNames?.[p.vol] || p.vol}·${base}` : base;
	}

	/** 一次性构建 卷id→卷名 映射，供各命令展示用；失败返回空表（降级为显示卷 id） */
	private async volNameMap(story: string): Promise<Record<string, string>> {
		try {
			const vols = await this.manager.loadVolumes(story);
			const out: Record<string, string> = {};
			for (const [id, v] of Object.entries(vols)) out[id] = v.name;
			return out;
		} catch {
			return {};
		}
	}

	/** v0.0.15：场景/人物「归属章节」的展示名（本地号+容器卷前缀），0=全局 */
	private refLabel(num: number, vol: string | null | undefined, volNames?: Record<string, string>): string {
		if (!num) return "全局";
		return this.keyLabel(chKey(vol ?? null, num), volNames);
	}

	/** v0.0.15：把用户输入的裸章号解析到具体容器（跨卷同号逐个确认）；0=全局直通；不存在/取消 → null */
	private async resolveLocalNum(story: string, n: number, volNames: Record<string, string>): Promise<{ num: number; vol?: string } | null> {
		if (n === 0) return { num: 0 };
		const cands = (await this.manager.listChapters(story)).filter((c) => c.num === n);
		if (!cands.length) return null;
		if (cands.length === 1) return { num: n, vol: cands[0].vol };
		const ci = await this.pickAction(`「第${String(n).padStart(2, "0")}章」在多个容器里都存在，请选择`, cands.map((c) => ({ label: this.keyLabel(c.key, volNames, c.title) })));
		return ci == null ? null : { num: n, vol: cands[ci].vol };
	}

	private notifyError(prefix: string, e: unknown): void {
		new Notice(`${prefix}：${describeLlmError(e)}`, 8000); // 带 cause/code/HTTP 状态，避免只有一句 "Connection error." 无法定位
	}

	private pickAction(title: string, items: ActionItem[]): Promise<number | null> {
		return new Promise((resolve) => {
			new ActionMenuModal(this.app, title, items, (i) => resolve(i), () => resolve(null)).open();
		});
	}

	private confirmBox(title: string, message: string, label = "确认"): Promise<boolean> {
		if (this.auto) return Promise.resolve(this.auto.overwrite); // v0.3.0+ auto-book 免交互：清理/覆盖类确认统一按「覆盖已有产物」开关答复
		return new Promise((resolve) => {
			new ConfirmModal(this.app, title, message, label, () => resolve(true), () => resolve(false)).open();
		});
	}

	/** 无当前章节时弹框询问章号（v0.0.15：返回复合键；裸号按容器解析，跨卷同号逐个确认） */
	private async requireChapterKey(story: string): Promise<string | null> {
		const state = await this.manager.loadState(story);
		if (state?.current_chapter != null) return state.current_chapter;
		const volNames = await this.volNameMap(story);
		const t = await this.prompt("没有当前章节", "请输入章节号（卷内本地号）");
		if (t == null) return null;
		const n = parseInt(t, 10);
		const ref = Number.isFinite(n) && n > 0 ? await this.resolveLocalNum(story, n, volNames) : null;
		if (!ref) { new Notice(`第${n ?? "?"}章不存在`); return null; }
		return chKey(ref.vol ?? null, ref.num);
	}

	// ---------- 卷（/volume）----------

	async cmdVolumeList(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const vols = await this.manager.volumeList(story);
			if (!vols.length) {
				new Notice("还没有卷，先用「新建卷」创建");
				return;
			}
			const state = await this.manager.validatedState(story);
			const chapters = await this.manager.listChapters(story); // v0.0.15：按卷过滤用实体目录清单（state.chapters 键已为复合键）
			const lines: Array<string | PanelLine> = [];
			for (const v of vols) {
				lines.push({ text: `${state.current_volume === v.id ? "◀ " : ""}${v.name}`, bold: true });
				if (v.description) lines.push(`  描述：${v.description}`);
				const assigned = chapters.filter((c) => c.vol === v.id).map((c) => this.chapterLabel(c.num));
				lines.push(assigned.length ? `  归属章节：${assigned.join("、")}` : "  暂无归属章节");
			}
			lines.push("");
			lines.push(`当前卷：${state.current_volume || "无"}（共 ${vols.length} 卷）`);
			new TextPanelModal(this.app, "卷列表", lines).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdVolumeAdd(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		await this.ensureVolumeModeEnabled(story); // v0.0.16+：无卷模式先自动转为有卷再建卷
		if (!(await this.ensureVolumeLayout(story))) return;
		const names = await this.pickNewVolumeNames(story); // 列表式批量新建卷页面（手动加名单、确定后按序创建）
		if (!names || !names.length) return;
		try {
			const lastId = await this.createVolumesInOrder(story, names);
			if (lastId == null) return; // 全部失败：汇总通知已给出原因
			let volName = lastId;
			try {
				volName = this.manager.findVolumeIn(await this.manager.loadVolumes(story), lastId)?.name ?? lastId;
			} catch { /* 名称回退用 id */ }
			const doChapter = await this.confirmBox("顺带建章", `是否立即创建一个新章节并归属到最后一个新建的卷「${volName}」？`, "创建");
			if (!doChapter) return;
			const chapters = await this.manager.listChapters(story);
			const inVol = chapters.filter((c) => c.vol === lastId); // v0.0.15：编号在目标卷内自动顺延
			const nextNum = inVol.length ? Math.max(...inVol.map((c) => c.num)) + 1 : 1;
			const t = await this.prompt(`新建第${nextNum}章（卷「${volName}」）`, "章节标题");
			if (t == null) return;
			const title = t.trim() || String(nextNum);
			const bodyPath = await this.manager.createChapter(story, title, lastId); // 直接落卷实体目录并写归属字段（位置即归属）
			new Notice(`${this.chapterLabel(nextNum, title)} 已创建并归属卷「${volName}」`);
			if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(bodyPath);
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	async cmdVolumeManage(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		await this.ensureVolumeModeEnabled(story); // v0.0.16+：无卷模式先自动转为有卷再管理卷
		if (!(await this.ensureVolumeLayout(story))) return;
		try {
			const vols = await this.manager.volumeList(story);
			if (!vols.length) {
				new Notice("还没有卷，先用「新建卷」创建");
				return;
			}
			const state = await this.manager.validatedState(story);
			const idx = await this.pickAction(
				"选择要管理的卷",
				vols.map((v) => ({ label: v.name, sub: v.description || v.id, marker: state.current_volume === v.id ? "▶ 当前" : undefined }))
			);
			if (idx == null) return;
			const vol = vols[idx];
			const chAll = await this.manager.listChapters(story); // v0.0.15：归属清单按复合键管理（本地号在卷内独立）
			const assigned = chAll.filter((c) => c.vol === vol.id).map((c) => ({ key: c.key, num: c.num, title: c.title }));
			const act = await this.pickAction(`管理卷「${vol.name}」`, [
				{ label: "启用此卷（设为当前卷并切到其最后一章）" },
				{ label: "重命名卷" },
				{ label: "编辑描述" },
				{ label: `把某章节分配到本卷${assigned.length ? `（现有 ${assigned.length} 章）` : ""}` },
				{ label: "解除本卷中某章节的归属", disabled: !assigned.length },
				{ label: "导出此卷合集（全部章节正文合一 MD，/pack 同款格式）", disabled: !assigned.length },
				{ label: "删除此卷（其章节变为未分配）" },
			]);
			if (act == null) return;
			switch (act) {
				case 0: {
					const r = await this.manager.activateVolume(story, vol.id);
					new Notice(r.num != null ? `已启用「${vol.name}」，切换到${this.chapterLabel(r.num)}` : `已将「${vol.name}」设为当前卷（暂无归属章节）`);
					if (r.path) await this.manager.openMarkdown(r.path);
					break;
				}
				case 1: {
					const n = await this.prompt("重命名卷", "新名称");
					if (!n || !n.trim()) break;
					const u = await this.manager.updateVolume(story, vol.id, { name: n.trim() });
					new Notice(u ? `已改名为「${u.name}」` : "改名失败：卷不存在");
					break;
				}
				case 2: {
					const d = await new Promise<string | null>((resolve) => {
						new TextAreaPrompt(this.app, "编辑描述", "卷的描述…", vol.description || "", "保存", (v) => resolve(v), () => resolve(null)).open();
					});
					if (d == null) break;
					await this.manager.updateVolume(story, vol.id, { description: d });
					new Notice("描述已更新");
					break;
				}
 			case 3: {
 				const t = await this.prompt("分配章节", "章节号：支持 all/全部、区间如 3-7（或 三至七）、列表如 1，4，5；跨卷同号时逐个确认");
 				if (t == null || !t.trim()) break;
 				const sel = parseChapterSelection(t, [...new Set(chAll.map((c) => c.num))].sort((a, b) => a - b)); // 复用打包合集同款表达式解析（去重升序）
 				if (sel.invalid.length) new Notice(`无法识别的片段已忽略：${sel.invalid.join("、")}`, 6000);
 				if (!sel.nums.length) {
 					new Notice("没有可分配的章节");
 					break;
 				}
 				const volNames2 = await this.volNameMap(story);
 				const resolvedKeys: string[] = [];
 				let skippedAmb = 0;
 				for (const n of sel.nums) {
 					const cands = chAll.filter((c) => c.num === n);
 					if (!cands.length) continue;
 					if (cands.length === 1) {
 						resolvedKeys.push(cands[0].key);
 					} else {
 						const ci = await this.pickAction(
 							`「第${String(n).padStart(2, "0")}章」在多个容器里都存在，选要移入本卷的那个`,
 							cands.map((c) => ({ label: `${this.keyLabel(c.key, volNames2, c.title)}${c.vol === vol.id ? "（已在本卷）" : ""}` }))
 						);
 						if (ci == null || ci < 0) { skippedAmb++; continue; } // Esc/取消 → 跳过该号继续其余
 						resolvedKeys.push(cands[ci].key);
 					}
 				}
 				if (!resolvedKeys.length) { new Notice("没有可分配的章节"); break; }
 				if (resolvedKeys.length > 1) {
 					const labels = resolvedKeys.map((k) => this.keyLabel(k, volNames2));
 					const shown = labels.length <= 12 ? labels.join("、") : `${labels.slice(0, 12).join("、")} …等共 ${labels.length} 章`;
 					const ok = await this.confirmBox(
 						`把以下 ${resolvedKeys.length} 个章节分配到卷「${vol.name}」？`,
 						shown + "。章节目录将物理移入该卷实体目录并写入归属字段。",
 						"确认分配"
 					);
 					if (!ok) break;
 				}
 				let done = 0;
 				for (const k of resolvedKeys) try { await this.manager.setChapterVolume(story, k, vol.id); done++; } catch { /* 单章失败保留原地，继续其余 */ }
 				new Notice(`${done}/${resolvedKeys.length} 章已归属卷「${vol.name}」${skippedAmb ? `；跳过未选择 ${skippedAmb} 号` : ""}${done < resolvedKeys.length ? "（个别失败请重试）" : ""}`, 8000);
 				break;
 			}
				case 4: {
					const ci = await this.pickAction(
						"选择要解除归属的章节",
						assigned.map((c) => ({ label: this.chapterLabel(c.num, c.title) }))
					);
					if (ci == null) break;
					await this.manager.unassignChapterVolume(story, assigned[ci].key);
					new Notice("已解除该章节的卷归属");
					break;
				}
			case 5: {
				const outText = await this.prompt(`导出卷「${vol.name}」`, "输出位置（留空用默认文件名）", [
				"将该卷全部章节的《章节.md》正文合一 MD（按章序排列），输出路径规则：",
				"· 留空 —— 存到该小说目录下 <书名>-<卷名>-合集.md（再次导出会覆盖同名文件）",
				"· 以 .md 结尾 —— 视为完整文件名，原样使用",
				"· 其他 —— 视为目标目录，自动拼上默认文件名 <书名>-<卷名>-合集.md",
			].join("\n"));
				if (outText == null) break;
				const r = await this.manager.packVolume(story, vol.id, outText.trim());
				const words = r.packed.reduce((s, p) => s + p.words, 0);
				new Notice(`已生成 ${r.path}（共 ${r.packed.length} 章，纯文字 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}）`, 8000);
				await this.manager.openMarkdown(r.path);
				break;
			}
				default: {
					const ok = await this.confirmBox(
						"删除卷？",
						`删除后，其下 ${assigned.length} 个章节的卷字段将被清空（章节本身保留）。此操作不可撤销。`,
						"删除"
					);
					if (!ok) break;
					const r = await this.manager.deleteVolume(story, vol.id);
					new Notice(r.deleted ? `已删除，共 ${r.movedKeys.length} 章被移出该卷` : "删除失败：卷不存在");
				}
			}
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	// ---------- 场景（/scene）----------

	async cmdSceneList(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const scenes = Object.values(await this.manager.loadAllScenes(story)).sort((a, b) => a.chapter_num - b.chapter_num || a.scene_id.localeCompare(b.scene_id));
			if (!scenes.length) {
				new Notice("还没有场景，先用「新增场景」创建");
				return;
			}
			const state = await this.manager.validatedState(story);
			const volNames = await this.volNameMap(story); // v0.0.15：归属展示带卷前缀
			const lines: Array<string | PanelLine> = [];
			for (const s of scenes) {
				lines.push({ text: `${state.current_scene === s.scene_id ? "◀ " : ""}${s.scene_id}`, bold: true });
				const bits = [this.refLabel(s.chapter_num, s.vol, volNames), s.characters?.length ? `角色：${s.characters.join("、")}` : "", s.description || ""].filter(Boolean);
				if (bits.length) lines.push(`  ${bits.join(" ")}`);
			}
			lines.push("");
			lines.push(`当前场景：${state.current_scene || "无"}（共 ${scenes.length} 个）`);
			new TextPanelModal(this.app, "场景列表", lines).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdSceneAdd(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		const defKey = state?.current_chapter ?? null; // v0.0.15：复合键 "volId:N" / "N"
		const volNames = await this.volNameMap(story);
		const curRef = defKey != null ? (() => { const p = parseChKey(defKey); return { num: p.num, vol: p.vol ?? undefined }; })() : null;
		const vals = await new Promise<Record<string, string> | null>((resolve) => {
			new MultiFieldModal(
				this.app,
				"新增场景",
				[
					{ key: "id", label: "场景 ID/标题", placeholder: "如：夜半天台" },
					{ key: "desc", label: "简介", placeholder: "一句话说明场景氛围/用途" },
					{ key: "chars", label: "在场角色", placeholder: '多个用「、」分隔' },
					{ key: "chap", label: "归属章节号（卷内本地号）", placeholder: `留空=${curRef ? `当前 ${this.refLabel(curRef.num, curRef.vol, volNames)}` : "无（全局）"}，0=全局未归属` },
					{ key: "notes", label: "备注" },
				],
				"下一步（正文）",
				(v) => resolve(v),
				() => resolve(null)
			).open();
		});
		if (!vals || !vals.id.trim()) return;
		const content = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, "场景正文（可选）", "描写该场景的环境/道具/关键动作…", "", "完成", (v) => resolve(v ?? ""), () => resolve(null)).open();
		});
		if (content == null) return;
		let chapNum = 0; let chapVol: string | undefined;
		const ct = (vals.chap ?? "").trim();
		if (ct !== "") {
			const n = parseInt(ct, 10);
			if (!Number.isFinite(n) || n < 0) {
				new Notice(`无效的章节号：${ct}`);
				return;
			}
			const ref = await this.resolveLocalNum(story, n, volNames); // v0.0.15：裸章号 → 具体容器
			if (!ref) { new Notice(`第${n}章不存在`); return; }
			chapNum = ref.num; chapVol = ref.vol;
		} else if (curRef) {
			chapNum = curRef.num; chapVol = curRef.vol;
		}
		try {
			await this.manager.addScene(story, {
				scene_id: vals.id.trim(),
				description: vals.desc,
				characters: splitList(vals.chars || ""),
				chapter_num: chapNum,
				vol: chapVol,
				notes: vals.notes,
				content,
			});
			new Notice(`已创建场景「${vals.id.trim()}」（${this.refLabel(chapNum, chapVol ?? null, volNames)}）`);
		} catch (e) {
			this.notifyError("创建失败", e);
		}
	}

	async cmdSceneManage(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const scenes = Object.values(await this.manager.loadAllScenes(story));
			if (!scenes.length) {
				new Notice("还没有场景，先用「新增场景」创建");
				return;
			}
			scenes.sort((a, b) => a.chapter_num - b.chapter_num || a.scene_id.localeCompare(b.scene_id));
			const state = await this.manager.validatedState(story);
			const volNames = await this.volNameMap(story); // v0.0.15：归属展示带卷前缀（s.vol 为加载时打标的运行态容器）
			const idx = await this.pickAction(
				"选择要管理的场景",
				scenes.map((s) => ({ label: s.scene_id, sub: `${this.refLabel(s.chapter_num, s.vol, volNames)} · ${s.description || ""}`.trim(), marker: state.current_scene === s.scene_id ? "▶ 当前" : undefined }))
			);
			if (idx == null) return;
			const scene = scenes[idx];
			const act = await this.pickAction(`管理场景「${scene.scene_id}」`, [
				{ label: "切换为当前场景（仅运行态）" },
				{ label: "查看详情" },
				{ label: "编辑信息（简介/角色/备注/归属章节）" },
				{ label: "删除此场景" },
			]);
			if (act == null) return;
			switch (act) {
				case 0: {
					await this.manager.switchScene(story, scene.scene_id);
					new Notice(`当前场景已切换到「${scene.scene_id}」（不影响当前章节）`);
					break;
				}
				case 1: {
					const lines: Array<string | PanelLine> = [
						{ text: scene.scene_id, bold: true },
						`归属：${this.refLabel(scene.chapter_num, scene.vol, volNames)}`,
					];
					for (const [k, v] of Object.entries({ 简介: scene.description, 角色: scene.characters?.join("、"), 备注: scene.notes })) if (v) lines.push(`${k}：${v}`);
					lines.push("", "---", "", scene.content || "（无正文）");
					new TextPanelModal(this.app, `场景详情 · ${scene.scene_id}`, lines).open();
					break;
				}
				case 2: {
					const vals = await new Promise<Record<string, string> | null>((resolve) => {
						new MultiFieldModal(
							this.app,
							`编辑场景「${scene.scene_id}」`,
							[
								{ key: "desc", label: "简介" },
								{ key: "chars", label: "在场角色", placeholder: '多个用「、」分隔' },
								{ key: "notes", label: "备注" },
								{ key: "chap", label: "归属章节号（卷内本地号）", placeholder: `当前=${this.refLabel(scene.chapter_num, scene.vol, volNames)}，留空不变；跨容器移动需同时改卷归属时请配合「管理卷→分配」` },
							],
							"保存",
							(v) => resolve(v),
							() => resolve(null),
							{ desc: scene.description ?? "", chars: (scene.characters ?? []).join("、"), notes: scene.notes ?? "", chap: "" }
						).open();
					});
					if (!vals) break;
					await this.manager.updateScene(story, scene.scene_id, { description: vals.desc, characters: splitList(vals.chars || ""), notes: vals.notes });
					const ct = (vals.chap ?? "").trim();
					if (ct !== "") {
						const n = parseInt(ct, 10);
						if (!Number.isFinite(n) || n < 0) new Notice(`无效的章节号：${ct}`);
						else {
							const ref = await this.resolveLocalNum(story, n, volNames); // v0.0.15：裸章号 → 具体容器（跨卷同号逐个确认）
							if (!ref) new Notice(`第${n}章不存在，未移动`);
							else if (ref.num === scene.chapter_num && (ref.vol ?? undefined) === (scene.vol ?? undefined)) { /* 同容器同号 → 不变 */ }
							else {
								await this.manager.updateScene(story, scene.scene_id, { chapter_num: ref.num, vol: ref.vol });
								new Notice(`已移动到 ${this.refLabel(ref.num, ref.vol ?? null, volNames)}`);
							}
						}
					} else new Notice("场景信息已保存");
					break;
				}
				default: {
					const ok = await this.confirmBox("删除场景？", `将删除「${scene.scene_id}」并清理其引用。`, "删除");
					if (!ok) break;
					const done = await this.manager.deleteScene(story, scene.scene_id);
					new Notice(done ? "已删除该场景" : "删除失败：场景不存在");
				}
			}
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	// ---------- 人物（/character）----------

	async cmdCharacterList(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const chars = Object.values(await this.manager.loadAllCharacters(story)).sort((a, b) => a.chapter - b.chapter || a.name.localeCompare(b.name));
			if (!chars.length) {
				new Notice("还没有人物，先用「新增人物」创建");
				return;
			}
			const lines: Array<string | PanelLine> = [];
			for (const c of chars) {
				lines.push({ text: c.name, bold: true });
				const bits = [c.chapter === 0 ? "全局" : this.chapterLabel(c.chapter), c.identity || "", c.gender ? `性别：${c.gender}` : ""].filter(Boolean);
				if (bits.length) lines.push(`  ${bits.join(" ")}`);
			}
			lines.push("");
			lines.push(`共 ${chars.length} 人`);
			new TextPanelModal(this.app, "人物列表", lines).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdCharacterAdd(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		const defKey = state?.current_chapter ?? null; // v0.0.15：复合键 "volId:N" / "N"
		const volNames = await this.volNameMap(story);
		const curRef = defKey != null ? (() => { const p = parseChKey(defKey); return { num: p.num, vol: p.vol ?? undefined }; })() : null;
		const vals = await new Promise<Record<string, string> | null>((resolve) => {
			new MultiFieldModal(
				this.app,
				"新增人物",
				[
					{ key: "name", label: "姓名（必填）" },
					{ key: "identity", label: "身份" },
					{ key: "age", label: "年龄" },
					{ key: "gender", label: "性别" },
					{ key: "personality", label: "性格" },
					{ key: "appearance", label: "外貌" },
					{ key: "background", label: "背景" },
					{ key: "abilities", label: "能力/技能", placeholder: '多个用「、」分隔' },
					{ key: "notes", label: "备注" },
					{ key: "chap", label: "归属章节号（卷内本地号）", placeholder: `留空=${curRef ? `当前 ${this.refLabel(curRef.num, curRef.vol, volNames)}` : "无（全局）"}，0=全局` },
				],
				"创建",
				(v) => resolve(v),
				() => resolve(null)
			).open();
		});
		if (!vals || !vals.name.trim()) return;
		let chapNum = 0; let chapVol: string | undefined;
		const ct = (vals.chap ?? "").trim();
		if (ct !== "") {
			const n = parseInt(ct, 10);
			if (!Number.isFinite(n) || n < 0) {
				new Notice(`无效的章节号：${ct}`);
				return;
			}
			const ref = await this.resolveLocalNum(story, n, volNames); // v0.0.15：裸章号 → 具体容器
			if (!ref) { new Notice(`第${n}章不存在`); return; }
			chapNum = ref.num; chapVol = ref.vol;
		} else if (curRef) {
			chapNum = curRef.num; chapVol = curRef.vol;
		}
		try {
			await this.manager.addCharacter(story, { name: vals.name.trim(), identity: vals.identity, age: vals.age, gender: vals.gender, personality: vals.personality, appearance: vals.appearance, background: vals.background, abilities: vals.abilities, notes: vals.notes, chapter: chapNum, vol: chapVol });
			new Notice(`已创建人物「${vals.name.trim()}」（${this.refLabel(chapNum, chapVol ?? null, volNames)}）`);
		} catch (e) {
			this.notifyError("创建失败", e);
		}
	}

	/** v0.2.x+ 角色改名（独立命令）：选择人物 → 输入新名 → 全小说 MD 同步替换 + 自动备份。与「管理人员→改名」、人物关系面板「改名」共用 renameCharacterFlow */
	async cmdCharacterRename(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const chars = Object.values(await this.manager.loadAllCharacters(story));
			if (!chars.length) {
				new Notice("还没有人物，先用「新增人物」创建", 6000);
				return;
			}
			const volNames = await this.volNameMap(story);
			const byName = new Map<string, { scope: string; identity?: string }>();
			for (const c of chars) {
				if (byName.has(c.name)) continue; // 同名跨层只列一次（改名本就全书生效）
				byName.set(c.name, { scope: this.refLabel(c.chapter, c.vol, volNames), identity: c.identity });
			}
			const names = [...byName.keys()].sort((a, b) => a.localeCompare(b, "zh"));
			const idx = await this.pickAction(
				"选择要改名的角色",
				names.map((n) => {
					const info = byName.get(n);
					const sub = [info?.scope, info?.identity].filter(Boolean).join(" · ");
					return { label: n, sub: sub || undefined };
				})
			);
			if (idx == null) return;
			await this.renameCharacterFlow(names[idx], story);
		} catch (e) {
			this.notifyError("角色改名失败", e);
		}
	}

	/** 角色改名核心流程（命令面板 / 管理人员菜单 / 人物关系面板「改名」共用）：提示新名 → manager.renameCharacter 全书 MD 替换并备份 → 汇总 Notice */
	async renameCharacterFlow(oldName: string, storyArg?: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = storyArg ?? (await this.requireStory());
		if (!story) return;
		try {
			const newName = await this.prompt(`角色改名「${oldName}」`, "新名字", [
				"将把全书 MD 文档中所有「旧名」替换为「新名」（含《人物》《人物关系》《场景》《大纲》与各章正文）。",
				"替换按文本全量匹配（包含子串），请确认旧名不会误伤其他词；原文件会先备份到 _backup/角色改名_时间戳/。",
				"输入后按回车确认、Esc 取消：",
			].join("\n"), oldName);
			if (newName == null) return;
			const target = newName.trim();
			if (!target) { new Notice("新名字不能为空", 6000); return; }
			if (target === oldName) { new Notice("新名字与旧名相同，未做修改", 6000); return; }
			const r = await this.renameCharacterTo(story, oldName, target);
			if (!r) return;
		} catch (e) {
			this.notifyError("角色改名失败", e);
		}
	}

	/**
	 * 角色改名的唯一落盘实现（v0.4.9+ 代码重用：命令「管理人员 → 改名」与人物关系面板的「编辑人物」弹窗共用）＝
	 * `manager.renameCharacter`（全书 MD 全量替换 + 原文件备份到 _backup/角色改名_时间戳/）→ Notice → 人物关系面板选中名跟随 + 立即刷新。
	 * 返回 null＝全书找不到旧名（未做任何修改），调用方据此中止后续写盘。
	 */
	private async renameCharacterTo(story: string, oldName: string, newName: string): Promise<{ hits: number; files: number } | null> {
		const r = await this.manager.renameCharacter(story, oldName, newName);
		if (!r) {
			new Notice(`未找到「${oldName}」的任何出现位置，未做修改`, 8000);
			return null;
		}
		new Notice(`已将 ${String(r.hits)} 处「${oldName}」替换为「${newName}」（涉及 ${String(r.files)} 个文件，原文件已备份到 _backup/角色改名_时间戳/）`, 10000);
		for (const leaf of this.app.workspace.getLeavesOfType(RelationshipView.VIEW_TYPE)) {
			if (leaf.view instanceof RelationshipView) leaf.view.handleRenamed(oldName, newName); // 同步面板选中名，避免刷新后按旧名筛选为空
		}
		this.scheduleRelationshipPanelRefresh(0); // 立即刷新已打开的人物关系面板
		return r;
	}

	/** /analyze-cast：逐章 LLM 分析正文（严格 JSON），跨章聚合后按「出现范围」定层——
	 * ≥2 容器→书级、单容器多章→容器级、仅 1 章→章级（平铺模式全部容器归书根）；
	 * 同名条目移动+字段合并（现有优先、缺项补新，重复运行幂等自归位），关系按 A-B 对去重纯追加。
	 * 全程同一生成面板逐章流式展示；某章 3 次输出均非合法 JSON 则跳过该章并在汇总中列出；
	 * 用户中断（停止按钮/关面板）→ 不写任何文件（出现范围信息不完整）。 */
	async cmdAnalyzeCast(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const state = await this.manager.validatedState(story);
			const useVolumes = state.use_volumes !== false;
			if (useVolumes && !(await this.ensureVolumeLayout(story))) return;
			const chapters = await this.manager.listChapters(story);
			if (!chapters.length) { new Notice("这本书还没有章节，没有可分析的正文", 8000); return; }
			const volNames = await this.volNameMap(story);
			const targets: Array<{ key: string; label: string; content: string }> = [];
			const emptyLabels: string[] = [];
			for (const ch of chapters) {
				const label = this.keyLabel(ch.key, volNames, ch.title);
				const content = await this.manager.readChapterContent(story, ch.key);
				if (!content.trim()) { emptyLabels.push(label); continue; } // 空正文章跳过
				targets.push({ key: ch.key, label, content });
			}
			if (!targets.length) { new Notice("所有章节都还没有正文，无法分析", 8000); return; }

			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）

			// 现有三层文档播种：已知人名/场景名（跨章名称归一）+ 已有关系对（去重基线）
			const charLayers = await this.manager.loadCharacterLayerDocs(story);
			const sceneLayers = await this.manager.loadSceneLayerDocs(story);
			const existingRelPairs = new Set((await this.manager.readAllRelationshipEntries(story)).map((r) => relPairKey(r.a, r.b)));
			const knownNames = new Set<string>();
			for (const layer of charLayers) for (const c of Object.values(layer.entries)) knownNames.add(c.name);
			const knownSceneIds = new Set<string>();
			for (const layer of sceneLayers) for (const s of Object.values(layer.entries)) knownSceneIds.add(s.scene_id);

			const view = await this.beginWritingPanel(`分析人物与场景 · ${story}`, setup.cfg);
			if (!view) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			if (emptyLabels.length) new Notice(`${String(emptyLabels.length)} 个章节没有正文，将跳过：${emptyLabels.join("、")}`, 10000);

			const analyses: Array<{ key: string; analysis: CastChapterAnalysis }> = [];
			const skipped: string[] = [];
			let aborted = false;
			for (let i = 0; i < targets.length; i++) {
				const t = targets[i];
				const label = `分析${t.label}（${String(i + 1)}/${String(targets.length)}）`;
				view.beginStream(label);
				let raw = "";
				let parsed: CastChapterAnalysis | null = null;
				const castSystem = this.promptSkill("人物场景分析", CAST_ANALYZE_SYSTEM_PROMPT);
				const castSysMsg: Message = { role: "system", content: castSystem };
				let prevRaw = ""; // 非法 JSON 的上一版输出：作 assistant 轮带入续轮（前缀缓存接得上、也让模型看见自己错在哪）
				for (let attempt = 1; attempt <= 3; attempt++) {
					const castPrompt = buildCastChapterPrompt({
						chapterLabel: t.label,
						content: t.content,
						knownNames: [...knownNames],
						knownSceneIds: [...knownSceneIds],
					});
					// v0.4.3+ 前缀缓存锚点：逐章分析的提示词＝固定「任务说明＋JSON 模板＋要求清单」在前、逐章变化段（规范名单/已有场景名随章节增长、
					// 章名与正文）在后 → 锚点钉在变化段起点之前（名单行了还不能算，钉在其后就落在分叉点之后、后续章一律复用不到）
					const castPin = this.cachePinAt(castPrompt, castStableChars(castPrompt));
					// v0.4.3+ 非法 JSON 重试＝会话续轮（retryTurnMessages）：旧做法把 retryNote 拼回提示词尾部（在同一条 user 消息里分叉），
					// 本章正文整段要重新 prefill；现把非法输出作 assistant 轮、纠错文案作新一轮 user 消息 → 整段前缀复用
					raw = await this.streamWithEmptyRetry(
						setup.cfg,
						attempt === 1
							? () => [castSysMsg, { role: "user", content: castPrompt }]
							: () => retryTurnMessages(castSysMsg, castPrompt, prevRaw, CAST_JSON_RETRY_NOTE),
						view, label, castPin
					);
					prevRaw = raw;
					if (view.signal.aborted) { aborted = true; break; } // 用户点停止 / 关面板 → 整轮中止
					parsed = parseCastChapterAnalysis(raw);
					if (parsed) break;
					if (attempt < 3) {
						new Notice(`${t.label}：输出不是合法 JSON（第${String(attempt)}次），正在重试…`, 6000);
						view.reset(); // 丢弃非法输出，重试从零开始
					}
				}
				if (aborted) break;
				if (!parsed) {
					skipped.push(t.label);
					if (raw.trim()) view.fail("模型输出不是合法 JSON（已重试 3 次）"); // 连续空时 streamWithEmptyRetry 已 fail，不重复
					continue;
				}
				for (const c of parsed.characters) knownNames.add(c.name);
				for (const s of parsed.scenes) knownSceneIds.add(s.scene_id);
				analyses.push({ key: t.key, analysis: parsed });
			}
			if (aborted) {
				new Notice(`已停止：分析了 ${String(analyses.length)}/${String(targets.length)} 章，未写入任何文件（出现范围信息不完整）`, 12000);
				return;
			}
			if (!analyses.length) {
				view.fail("所有章节分析均失败，未写入任何文件");
				new Notice(`✗ 分析失败：${String(targets.length)} 个章节的模型输出均无效，未写入任何文件`, 12000);
				return;
			}

			// 聚合 + 定层 + 写盘计划 → 落盘（人物/场景整层重写、关系逐层追加）
			const agg = aggregateCastAnalyses(analyses);
			const charPlan = buildCharacterWritePlan(charLayers, agg, useVolumes);
			const scenePlan = buildSceneWritePlan(sceneLayers, agg, useVolumes);
			let charLayersWritten = 0;
			let sceneLayersWritten = 0;
			let relAdded = 0;
			try {
				for (const out of charPlan) if (out.changed) { await this.manager.saveCharacterLayer(story, out.ref, out.entries); charLayersWritten++; }
				for (const out of scenePlan) if (out.changed) { await this.manager.saveSceneLayer(story, out.ref, out.entries); sceneLayersWritten++; }
				for (const g of buildRelationshipWritePlan(existingRelPairs, agg, useVolumes)) {
					if (!g.entries.length) continue;
					await this.manager.appendRelationships(story, g.ref.scope, g.entries, { volId: g.ref.volId ?? null, chapterKey: g.ref.chapterKey ?? null });
					relAdded += g.entries.length;
				}
			} catch (e) {
				this.notifyError("分析结果落盘失败", e);
				view.fail("落盘失败");
				return;
			}
			view.finishAuto(`✓ 分析完成：人物 ${String(agg.characters.size)} · 场景 ${String(agg.scenes.size)} · 新关系 ${String(relAdded)}`, "全程用时");
			let msg = `✓ 人物/场景分析完成：分析 ${String(analyses.length)}/${String(targets.length)} 章，人物 ${String(agg.characters.size)}（更新 ${String(charLayersWritten)} 层）、场景 ${String(agg.scenes.size)}（更新 ${String(sceneLayersWritten)} 层）、新增关系 ${String(relAdded)}`;
			if (skipped.length) msg += `\n跳过 ${String(skipped.length)} 章（模型输出无效）：${skipped.join("、")}`;
			new Notice(msg, 15000);
		} catch (e) {
			this.notifyError("人物/场景分析失败", e);
		}
	}

	async cmdCharacterManage(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const chars = Object.values(await this.manager.loadAllCharacters(story));
			if (!chars.length) {
				new Notice("还没有人物，先用「新增人物」创建");
				return;
			}
			chars.sort((a, b) => a.chapter - b.chapter || a.name.localeCompare(b.name));
			const volNames = await this.volNameMap(story); // v0.0.15：归属展示带卷前缀（c.vol 为加载时打标的运行态容器）
			const idx = await this.pickAction(
				"选择要管理的人物",
				chars.map((c) => ({ label: c.name, sub: `${this.refLabel(c.chapter, c.vol, volNames)} · ${c.identity || ""}`.trim() }))
			);
			if (idx == null) return;
			const char = chars[idx];
			const act = await this.pickAction(`管理人员「${char.name}」`, [
				{ label: "查看详情" },
				{ label: "编辑信息（身份/年龄/性格/外貌/背景/能力等）" },
				{ label: `移动归属章节（当前：${this.refLabel(char.chapter, char.vol, volNames)}）` },
				{ label: "改名（全小说 MD 同步替换并自动备份）" },
				{ label: "删除此人（并清理各场景中的引用）" },
			]);
			if (act == null) return;
			switch (act) {
				case 0: {
					const lines: Array<string | PanelLine> = [{ text: char.name, bold: true }];
					for (const [k, v] of Object.entries({ 归属: this.refLabel(char.chapter, char.vol, volNames), 身份: char.identity, 年龄: char.age, 性别: char.gender, 性格: char.personality, 外貌: char.appearance, 背景: char.background, 能力: char.abilities?.join("、"), 备注: char.notes })) if (v) lines.push(`${k}：${v}`);
					new TextPanelModal(this.app, `人物详情 · ${char.name}`, lines).open();
					break;
				}
				case 1: {
					// v0.4.9+ 代码重用＝与人物关系面板「编辑人物」同一个弹窗（级别可换层＋姓名可改＋设定字段）
					await this.openEditCharacterDialog(char.name, story);
					break;
				}
				case 2: {
					const t = await this.prompt("移动归属章节", `新的章节号（卷内本地号，0=全局，当前=${this.refLabel(char.chapter, char.vol, volNames)}）`);
					if (t == null) break;
					const n = parseInt(t, 10);
					if (!Number.isFinite(n) || n < 0) new Notice(`无效的章节号：${t}`);
					else {
						const ref = await this.resolveLocalNum(story, n, volNames); // v0.0.15：裸章号 → 具体容器（跨卷同号逐个确认）
						if (!ref) new Notice(`第${n}章不存在`);
						else if (ref.num === char.chapter && (ref.vol ?? undefined) === (char.vol ?? undefined)) { /* 同容器同号 → 不变 */ }
						else {
							await this.manager.updateCharacter(story, char.name, { chapter: ref.num, vol: ref.vol });
							new Notice(`「${char.name}」已移动到 ${this.refLabel(ref.num, ref.vol ?? null, volNames)}`);
						}
					}
					break;
				}
				case 3: {
					await this.renameCharacterFlow(char.name, story); // 与命令面板「角色改名」/人物关系面板「改名」同一流程
					break;
				}
				default: {
					await this.deleteCharacterByName(story, char.name); // v0.4.9+ 代码重用＝与人物关系面板右键「删除人物」同一实现
				}
			}
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	// ---------- 伏笔（/foreshadow）----------

	async cmdForeshadowList(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const items = await this.manager.loadForeshadows(story);
			if (!items.length) {
				new Notice("还没有伏笔记录");
				return;
			}
			const volNames = await this.volNameMap(story); // v0.0.15：it.chapter 为复合键，展示带卷前缀
			const lines: Array<string | PanelLine> = [];
			items.forEach((it, i) => {
				lines.push({ text: `${it.done ? "✔" : "○"} ${this.keyLabel(it.chapter, volNames)} #${(it.index ?? i) + 1}`, bold: !it.done });
				const bits = [it.character ? `人物：${it.character}` : "", it.reason || ""].filter(Boolean);
				if (bits.length) lines.push(`  ${bits.join(" ")}`);
			});
			lines.push("");
			lines.push(`共 ${items.length} 条，其中已完成 ${items.filter((i) => i.done).length} 条`);
			new TextPanelModal(this.app, "伏笔列表", lines).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdForeshadowAdd(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const key = await this.requireChapterKey(story); // v0.0.15：复合键
		if (key == null) return;
		const volNames = await this.volNameMap(story);
		const label = this.keyLabel(key, volNames);
		const character = await this.prompt(`${label} · 添加伏笔`, "涉及角色（可留空）");
		if (character == null) return;
		const reason = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, `${label} · 伏笔事由`, "埋了什么、为什么重要…", "", "保存", (v) => resolve(v), () => resolve(null)).open();
		});
		if (reason == null || !reason.trim()) return;
		try {
			const idx = await this.manager.addForeshadow(story, key, character, reason);
			new Notice(`已写入 伏笔.md：${label} 伏笔 #${idx + 1}`);
		} catch (e) {
			this.notifyError("添加失败", e);
		}
	}

	async cmdForeshadowManage(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const items = await this.manager.loadForeshadows(story);
			if (!items.length) {
				new Notice("还没有伏笔记录，先用「添加伏笔」创建");
				return;
			}
			const volNames = await this.volNameMap(story); // v0.0.15：item.chapter 为复合键
			const idx = await this.pickAction(
				"选择要管理的伏笔",
				items.map((it, i) => ({ label: `${it.done ? "✔" : "○"} ${this.keyLabel(it.chapter, volNames)} #${(it.index ?? i) + 1}`, sub: [it.character, it.reason].filter(Boolean).join(" ") }))
			);
			if (idx == null) return;
			const item = items[idx];
			const act = await this.pickAction(`管理 ${this.keyLabel(item.chapter, volNames)} 伏笔 #${(item.index ?? idx) + 1}`, [
				item.done ? { label: "取消完成标记" } : { label: "标记为已完成" },
				{ label: "删除这条伏笔" },
			]);
			if (act == null) return;
			const pos = item.index ?? idx;
			if (act === 0) {
				const ok = await this.manager.setForeshadowDone(story, item.chapter, pos, !item.done);
				new Notice(ok ? `已${!item.done ? "标记完成" : "取消完成"}` : "操作失败：未找到该条伏笔（可能已被其他操作改动，请重新打开列表）");
			} else {
				const confirmOk = await this.confirmBox("删除伏笔？", `[${[item.character, item.reason].filter(Boolean).join(" ") || "无内容"}]`, "删除");
				if (!confirmOk) return;
				const ok = await this.manager.deleteForeshadow(story, item.chapter, pos);
				new Notice(ok ? "已删除该条伏笔" : "删除失败：未找到该条伏笔");
			}
		} catch (e) {
			this.notifyError("操作失败", e);
		}
	}

	// ---------- 世界观（/world）----------

	async cmdWorldShow(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const ws = await this.manager.readWorldDoc(story);
			const lines: Array<string | PanelLine> = [];
			for (const [k, v] of Object.entries({ 世界: ws.name, 类型: ws.world_type, 规则: ws.rules?.length ? ws.rules.join("；") : "", 势力: ws.factions?.length ? ws.factions.join("、") : "", 地点: ws.locations?.length ? ws.locations.join("、") : "" })) if (v) lines.push(`${k}：${v}`);
			if (ws.history) lines.push("", "---", "", `历史：`, ws.history);
			if (ws.magic_system) lines.push("", "---", "", `力量体系：`, ws.magic_system);
			new TextPanelModal(this.app, "世界观总览", lines.length ? lines : ["（世界观.md 还是空的，用「设置世界观字段」填写）"]).open();
		} catch (e) {
			this.notifyError("读取失败", e);
		}
	}

	async cmdWorldSet(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const field = await this.prompt("设置世界观", "字段名：世界 / 类型 / 规则 / 势力 / 地点 / 历史 / 力量体系");
		if (!field?.trim()) return;
		const value = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, `世界观 · ${field.trim()}`, "规则/势力/地点多个项可用「、」或分号分隔；历史与力量体系支持多行…", "", "保存", (v) => resolve(v), () => resolve(null)).open();
		});
		if (value == null) return;
		try {
			const ok = await this.manager.setWorldField(story, field, value);
			new Notice(ok ? `${field.trim()} 已写入 世界观.md` : `未知字段：${field.trim()}（可选：世界/类型/规则/势力/地点/历史/力量体系）`, 6000);
		} catch (e) {
			this.notifyError("写入失败", e);
		}
	}

	// ---------- 大纲追加 / 章节大纲打开 ----------

	async cmdOutlineAppendCurrent(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const key = await this.requireChapterKey(story); // v0.0.15：复合键
		if (key == null) return;
		const volNames = await this.volNameMap(story);
		const label = this.keyLabel(key, volNames);
		const content = await new Promise<string | null>((resolve) => {
			new TextAreaPrompt(this.app, `${label} · 追加大纲`, "写剧情要点；需要埋伏笔用 [伏]…[/] 包裹，将自动提取到 伏笔.md", "", "保存并追加", (v) => resolve(v), () => resolve(null)).open();
		});
		if (content == null || !content.trim()) return;
		try {
			const r = await this.manager.appendChapterOutline(story, key, content);
			if (!r.appended) new Notice("该内容已存在于本章大纲中，未重复追加");
			else new Notice(`已追加到 ${label} 的 章节大纲.md${r.foreshadows ? `，并提取 ${r.foreshadows} 条伏笔` : ""}`, 6000);
		} catch (e) {
			this.notifyError("追加失败", e);
		}
	}

	async cmdOpenChapterOutline(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const key = await this.requireChapterKey(story); // v0.0.15：复合键
		if (key == null) return;
		try {
			const path = await this.manager.chapterDocPath(story, key, "章节大纲.md");
			if (!path) {
				new Notice(`${this.keyLabel(key)} 不存在`);
				return;
			}
			const num = parseChKey(key).num;
			const t = (await this.manager.listChapters(story)).find((c) => c.key === key)?.title ?? "";
			await this.manager.ensureDoc(path, chapterOutlineTemplate(num, t));
			await this.manager.openMarkdown(path);
		} catch (e) {
			this.notifyError("打开失败", e);
		}
	}

	// ---------- 章节删除 / 改名 / 重编号（对齐 chapters.py）----------

	private async pickChapterAction(title: string): Promise<{ key: string; num: number; title: string } | null> {
		const story = await this.requireStory();
		if (!story) return null;
		const chapters = await this.manager.listChapters(story);
		if (!chapters.length) {
			new Notice("还没有章节");
			return null;
		}
		const state = await this.manager.loadState(story);
		const volNames = await this.volNameMap(story); // v0.0.15：展示带卷前缀、按复合键比对当前章
		const idx = await this.pickAction(
			title,
			chapters.map((c) => ({ label: this.keyLabel(c.key, volNames, c.title), marker: state?.current_chapter === c.key ? "▶ 当前" : undefined }))
		);
		if (idx == null) return null;
		return { key: chapters[idx].key, num: chapters[idx].num, title: chapters[idx].title };
	}

	async cmdChapterDelete(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const picked = await this.pickChapterAction("选择要删除的章节");
		if (!picked) return;
		const story = (this.settings.lastStory || (await this.requireStory()));
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const ok = await this.confirmBox(`删除${this.chapterLabel(picked.num, picked.title)}？`, "章节目录将移入 Obsidian 回收站，元数据与卷归属一并清理；若为当前章节则回退到最后一章。本容器内其后的各章会自动重新排号、保持连续编号。", "删除");
			if (!ok) return;
			const r = await this.manager.deleteChapter(story, picked.key); // v0.0.15：复合键
			new Notice(`${this.chapterLabel(picked.num, picked.title)} 已删除（可在回收站找回）${r.resequenced ? "；后续章节已自动重新排号为连续" : ""}`);
		} catch (e) {
			this.notifyError("删除失败", e);
		}
	}

	async cmdChapterRename(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		const picked = await this.pickChapterAction("选择要重命名的章节");
		if (!picked) return;
		const t = await this.prompt(`重命名 ${this.chapterLabel(picked.num)}`, `新标题（当前：${picked.title}）`);
		if (!t?.trim()) return;
		try {
			const newTitle = await this.manager.renameChapter(story, picked.key, t.trim()); // v0.0.15：复合键
			new Notice(`已改名为 ${this.chapterLabel(picked.num, newTitle)}，目录与文档引用已同步`, 6000);
		} catch (e) {
			this.notifyError("改名失败", e);
		}
	}

	async cmdChapterRenumber(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		const ok = await this.confirmBox(
			"重排全部章节编号？",
			"所有章节目录将按现有顺序从第1章起连续重新编号，各文档中的「第N章 / 章节：N」交叉引用与伏笔编号会一并改写。建议先保存所有打开的编辑。",
			"开始重排"
		);
		if (!ok) return;
		try {
			const r = await this.manager.renumberChapters(story);
			new Notice(r.msg || (r.ok ? "已完成重排" : "未完成"), 8000);
		} catch (e) {
			this.notifyError("重排失败", e);
		}
	}

async cmdRenameChapterFile(): Promise<void> {
    if (!(await this.ensureWorkDir())) return;
    const story = await this.requireStory();
    if (!story) return;
    const chapters = await this.manager.listChapters(story);
    if (!chapters.length) {
        new Notice("该小说没有章节");
        return;
    }
    const idx = await this.pickAction(
        "选择要重命名的章节",
        chapters.map((ch) => ({
            label: (ch.vol ? "卷「" + ch.vol + "」" : "书根") + " 第" + String(ch.num).padStart(2, "0") + "章 " + ch.title,
        })),
    );
    if (idx == null) return;
    const chapter = chapters[idx];
    if (!chapter) return;
    const newTitle = await this.prompt("新章节标题", "输入新的章节标题（留空保持不变）", chapter.title);
    if (newTitle == null) return;
    const newSafe = safeFilename(newTitle.trim());
    try {
        const complexKey = chapter.vol ? chapter.vol + ":" + String(chapter.num) : String(chapter.num);
        await this.manager.renameChapter(story, complexKey, newSafe);
        new Notice("章节文件已重命名为：" + newSafe);
    } catch (e) {
        this.notifyError("重命名失败", e);
    }
}

	// ---------- 打包合集（/pack）----------

	async cmdPackChapters(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const specText = await this.prompt("打包章节合集", "输入范围表达式（留空=仅当前章）", [
			"将所选范围内章节的《章节.md》正文合一 MD、按阅读序排列：",
			"· 留空 —— 只打当前章",
			"· all / 全部 —— 整本书（书根未归卷章节 + 各卷）",
			"· 区间 —— 如 3-7 或 三至七（容器内本地章号，自动升序）",
			"· 列表 —— 如 1、4、5（逗号/顿号/空格分隔均可）",
			"· 多卷可加卷名前缀限定范围，如 「风起 3-7」（裸号跨多个容器会报歧义，请加前缀区分）",
		].join("\n"));
		if (specText == null) return;
		const outText = await this.prompt("输出路径", "输出位置（留空用默认文件名）", [
			"· 留空 —— 存到该小说目录下 <书名>-第X-Y章-合集.md（单章为 <书名>-第X章-合集.md；重打包覆盖同名文件）",
			"· 以 .md 结尾 —— 视为完整文件名，原样使用",
			"· 其他 —— 视为目标目录，自动拼上默认文件名",
		].join("\n"));
		if (outText == null) return;
		try {
			const r = await this.manager.packChapters(story, specText.trim(), outText.trim());
			const words = r.packed.reduce((s, p) => s + p.words, 0);
			new Notice(`已生成 ${r.path}（${r.packed.length} 章，纯文字共 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}）`, 8000);
			await this.manager.openMarkdown(r.path);
		} catch (e) {
			this.notifyError("打包失败", e);
		}
	}

	async cmdPackVolume(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		await this.ensureVolumeModeEnabled(story); // v0.0.16+：无卷模式先自动转为有卷再导出
		if (!(await this.ensureVolumeLayout(story))) return; // 平面残留先归位，位置才等于归属
		try {
			const vols = await this.manager.volumeList(story);
			if (!vols.length) {
				new Notice("还没有卷，先用「新建卷」创建");
				return;
			}
			const state = await this.manager.validatedState(story);
			const chs = await this.manager.listChapters(story);
			const idx = await this.pickAction(
				"选择要导出的卷",
				vols.map((v) => ({ label: v.name, sub: `${chs.filter((c) => c.vol === v.id).length} 章${v.description ? ` · ${v.description}` : ""}`, marker: state.current_volume === v.id ? "▶ 当前" : undefined }))
			);
			if (idx == null) return;
			const vol = vols[idx];
			const outText = await this.prompt(`导出卷「${vol.name}」`, "输出位置（留空用默认文件名）", [
				"将该卷全部章节的《章节.md》正文合一 MD（按章序排列），输出路径规则：",
				"· 留空 —— 存到该小说目录下 <书名>-<卷名>-合集.md（再次导出会覆盖同名文件）",
				"· 以 .md 结尾 —— 视为完整文件名，原样使用",
				"· 其他 —— 视为目标目录，自动拼上默认文件名 <书名>-<卷名>-合集.md",
			].join("\n"));
			if (outText == null) return;
			const r = await this.manager.packVolume(story, vol.id, outText.trim());
			const words = r.packed.reduce((s, p) => s + p.words, 0);
			new Notice(`已生成 ${r.path}（卷「${vol.name}」共 ${r.packed.length} 章，纯文字 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}）`, 8000);
			await this.manager.openMarkdown(r.path);
		} catch (e) {
			this.notifyError("导出失败", e);
		}
	}

	// ---------- 扫描重建 / 编写类型 ----------

	async cmdRescanStory(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const r = await this.manager.rescanStory(story);
			new Notice(`扫描完成：章节 ${r.chapters} 个，总字数（纯文字）${r.totalWords}${r.createdDocs ? `，补齐缺失模板文档 ${r.createdDocs} 份` : ""}${r.volumeFixed ? `，修正与目录位置不一致的卷归属字段 ${r.volumeFixed} 处` : ""}`, 6000);
		} catch (e) {
			this.notifyError("扫描失败", e);
		}
	}

	/** 「更新故事状态文档」：轻量同步《故事状态.md》frontmatter——chapters 镜像按磁盘补缺删多并刷新 title/volume/words，顺带重算 total_words、校正悬空激活指针；正文与书级参数原样不动，不补齐缺失模板文档（重活走「扫描重建」） */
	async cmdUpdateStateDoc(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const r = await this.manager.syncStateDoc(story);
			const parts = [`新增 ${r.added}`, `删除 ${r.removed}`, `刷新 ${r.refreshed}`].join("、");
			new Notice(`状态文档已同步：chapters ${parts}，现有章节 ${r.chapters} 个，总字数（纯文字）${r.totalWords}`, 6000);
		} catch (e) {
			this.notifyError("更新状态文档失败", e);
		}
	}

	/** v0.2.x+「补全故事状态可用参数」：升级旧的故事状态文档——把缺失的书级提示词组装选项（prev_chapters / next_chapters（v0.4.3+） / include_volume_summary / word_range / ai_expand_chapter_outline（v0.4.3+） / ai_outline_cast（v0.4.3+））逐项询问后显式补写进 frontmatter（正文原样保留、其余键不动）；全部已显式设置时仅提示无需补全。旧版 story_state.json 载体经 loadState/saveState 顺带迁移为 MD 文档 */
	async cmdCompleteState(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		if (!state) { new Notice("读取故事状态文档失败", 6000); return; }
		const missingPrev = state.prev_chapters == null;
		const missingNext = state.next_chapters == null;
		const missingVolSum = state.include_volume_summary == null;
		const missingRange = state.word_range == null;
		const missingExpand = state.ai_expand_chapter_outline == null;
		const missingCast = state.ai_outline_cast == null;
		if (!missingPrev && !missingNext && !missingVolSum && !missingRange && !missingExpand && !missingCast) {
			new Notice(`《${story}》故事状态文档的可用参数已齐全（prev_chapters=${state.prev_chapters}、next_chapters=${state.next_chapters}、include_volume_summary=${state.include_volume_summary}、word_range=${state.word_range![0]}-${state.word_range![1]}、ai_expand_chapter_outline=${state.ai_expand_chapter_outline}、ai_outline_cast=${state.ai_outline_cast}），无需补全`, 8000);
			return;
		}
		const parts: string[] = [];
		if (missingPrev) {
			const n = await this.promptPrevChaptersInput(story);
			if (n == null) return; // 取消：不写盘
			state.prev_chapters = n;
			parts.push(`prev_chapters=${n}`);
		}
		if (missingNext) {
			const n = await this.promptNextChaptersInput(story);
			if (n == null) return; // 取消：不写盘
			state.next_chapters = n;
			parts.push(`next_chapters=${n}`);
		}
		if (missingVolSum) {
			const on = await this.confirmBox(
				"是否使用前卷摘要组织提示词（include_volume_summary）",
				`《${story}》的故事状态文档缺少书级参数 include_volume_summary（是否使用前卷摘要组织提示词）。\n开启后写作上下文额外注入本卷完整《卷摘要》，跨卷缺口以各前卷《卷摘要》由近及远填充；关闭则严格只按窗口章数注入单章摘要。\n当前按全局设置生效（${this.settings.includeVolumeSummary ? "开" : "关"}）。\n确认＝写入 true（开）、取消＝写入 false（关）：`,
				"开启"
			);
			state.include_volume_summary = on;
			parts.push(`include_volume_summary=${on}`);
		}
		if (missingRange) {
			const wr = await this.promptWordRangeInput(story);
			if (wr == null) return; // 取消：不写盘
			state.word_range = wr;
			parts.push(`word_range=${wr[0]}-${wr[1]}`);
		}
		if (missingExpand) {
			const on = await this.confirmBox(
				"是否让 AI 扩展章大纲（ai_expand_chapter_outline）",
				`《${story}》的故事状态文档缺少书级参数 ai_expand_chapter_outline（从大纲生成章节时是否让 AI 扩展章大纲）。\n开启后「从卷大纲生成章节」会把卷大纲拆出的各章段落交给 AI 扩写成完整章大纲（长度约为该章正文目标字数的 1/4，技能：SKILLS/系统提示词/章大纲编写.md），再写入各章《章节大纲.md》；关闭则直接写入拆分原文。\n确认＝写入 true（开）、取消＝写入 false（关）：`,
				"开启"
			);
			state.ai_expand_chapter_outline = on;
			parts.push(`ai_expand_chapter_outline=${on}`);
		}
		if (missingCast) {
			const on = await this.confirmBox(
				"是否在大纲阶段抽取人物与关系（ai_outline_cast）",
				`《${story}》的故事状态文档缺少书级参数 ai_outline_cast（大纲生成时是否抽取人物/人物关系并按出现范围分层写入）。\n开启后「生成卷大纲」与「从卷大纲生成章节」会在每章大纲生成时一并抽取该章人物与关系，按出现范围写入三层文档：只在 1 章出现→章级《人物.md》《人物关系.md》、同卷多章→卷级、跨卷→书级；关闭则只生成大纲、不动人物文档。\n确认＝写入 true（开）、取消＝写入 false（关）：`,
				"开启"
			);
			state.ai_outline_cast = on;
			parts.push(`ai_outline_cast=${on}`);
		}
		try {
			await this.manager.saveState(story, state);
			new Notice(`已补全故事状态参数：${parts.join("、")}`, 8000);
		} catch (e) {
			this.notifyError("补全故事状态参数失败", e);
		}
	}

	/** v0.3.5+：设置当前书正文字数区间（写《故事状态.md》word_range，取代旧三层写作指南「字数配置」注释） */
	async cmdSetWordRange(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const state = await this.manager.loadState(story);
		if (!state) { new Notice("读取故事状态文档失败", 6000); return; }
		const wr = await this.promptWordRangeInput(story, state.word_range);
		if (wr == null) return;
		try {
			state.word_range = wr;
			await this.manager.saveState(story, state);
			new Notice(`《${story}》字数区间已设为 ${wr[0]}-${wr[1]}（正文生成提示词按此要求字数）`, 6000);
		} catch (e) {
			this.notifyError("设置字数区间失败", e);
		}
	}

	async cmdSetStyle(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const t = await this.prompt("设置编写类型", "如：网文小说 / 剧本 / 普通小说 / 散文随笔");
		if (!t?.trim()) return;
		try {
			const style = await this.manager.setWritingStyle(story, t.trim());
			new Notice(`编写类型已设为「${style}」`);
		} catch (e) {
			this.notifyError("设置失败", e);
		}
	}

	// ---------- 写作指南存量清理（v0.3.5+：三层 WRITING_GUIDE.md 创作规范体系整体废弃，字数配置改走书级《故事状态.md》word_range，题材要点改走 SKILLS/ 技能） ----------

	/** 启动时一次性清理废弃写作指南产物：各书《WRITING_GUIDE.md》与《写作指南汇总.md》、用户级 <work_dir>/WRITING_GUIDE.md、插件数据目录 WRITING_GUIDE.md 与 guide-types/ 目录、data.json 的 system_guide 遗留字段；vault 文件进 Obsidian 回收站可找回，失败不阻断启动 */
	private async purgeWritingGuideArtifacts(): Promise<void> {
		const vaultPaths: string[] = [];
		try {
			for (const story of await this.manager.listStories()) {
				vaultPaths.push(`${this.manager.storyPath(story)}/WRITING_GUIDE.md`, `${this.manager.storyPath(story)}/写作指南汇总.md`);
			}
			const wd = this.settings.workDir?.replace(/\/+$/, "");
			if (wd) vaultPaths.push(`${wd}/WRITING_GUIDE.md`);
		} catch (e) {
			console.warn("[ArticleWriter] 枚举写作指南存量文件失败", e);
		}
		for (const p of vaultPaths) {
			try {
				const f = this.app.vault.getAbstractFileByPath(p);
				if (f instanceof TFile) await this.app.fileManager.trashFile(f); // vault 产物进回收站，误清理可找回
			} catch (e) {
				console.warn(`[ArticleWriter] 清理写作指南存量文件失败：${p}`, e);
			}
		}
		const adapter = this.app.vault.adapter;
		const dir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		try {
			if (await adapter.exists(`${dir}/WRITING_GUIDE.md`)) await adapter.remove(`${dir}/WRITING_GUIDE.md`); // 插件数据目录不被元数据索引收录，无回收站语义，直接删
			const typesDir = `${dir}/guide-types`;
			if (await adapter.exists(typesDir)) await adapter.rmdir(typesDir, true); // 目录须走 rmdir 递归删：adapter.remove 只支持文件，对目录抛 EISDIR
		} catch (e) {
			console.warn("[ArticleWriter] 清理插件数据目录写作指南产物失败", e);
		}
		const llm = this.settings.llm as (LlmConfigDoc & { system_guide?: unknown; system_guide_path?: unknown }) | undefined;
		if (llm && (llm.system_guide !== undefined || llm.system_guide_path !== undefined)) {
			delete llm.system_guide; // data.json 遗留字段：旧版内嵌系统级指南文本/路径
			delete llm.system_guide_path;
			await this.saveData(this.settings);
		}
	}

	/** v0.3.5+：正文字数区间生效值——书级《故事状态.md》word_range 优先（解析时已校验 lo>0 且 lo<=hi），未配置回落全局默认 [4000,5000] */
	private wordRangeOf(state: StoryState | null | undefined): [number, number] {
		return state?.word_range ?? WORD_RANGE_DEFAULT;
	}

	// ---------- 情节张力/节奏手法（v0.4.3+ 张力规则并入张力工具箱）：唯一载体＝系统技能 `SKILLS/张力工具箱.md`（见技能区块），
	// 经各阶段引用清单的 skill: 条目注入。旧书级「案头资料/张力规则.md」与内置 key tension_rules 退役：文件保留在盘上、不再播种、不再自动注入。

	// ---------- 禁用词清单（v0.3.6+ Skill 化：事实源＝SKILLS/网文高频禁用词清单.md，见技能区块；旧插件数据目录 BANNED_WORDS.md 启动时迁移并入后删除） ----------

	/** 读取禁用词清单（事实源＝SKILLS/<BANNED_LIST_SKILL_NAME>.md，用户改过就用改过的；技能文件缺失时回落包内默认——清空/为空的清单照实按空处理） */
	private async loadBannedWords(): Promise<BannedWordsData> {
		let t = "";
		try {
			const adapter = this.app.vault.adapter;
			const p = this.skillPath(BANNED_LIST_SKILL_NAME); // 不经 manager，见技能区块头注释
			t = (await adapter.exists(p)) ? await adapter.read(p) : "";
		} catch { /* 读失败按缺失处理，走包内默认 */ }
		if (!t.trim()) {
			console.warn(`[ArticleWriter] 禁用词清单技能文件缺失或为空，本次按包内默认词表处理（SKILLS/${BANNED_LIST_SKILL_NAME}.md）`);
			t = DEFAULT_SKILLS[BANNED_LIST_SKILL_NAME] ?? "";
		}
		return parseBannedWordsMd(t);
	}

	/** v0.4.6+ 读取敏感词清单（事实源＝SKILLS/敏感词清单.md，与禁用词清单同格式同解析器；技能文件缺失回落包内完整种子词表。
	 *  该技能不进任何提示词注入清单——只供「检测敏感词 / 全书敏感词汇总 / 生成后软提醒」确定性扫描） */
	private async loadSensitiveWords(): Promise<BannedWordsData> {
		let t = "";
		try {
			const adapter = this.app.vault.adapter;
			const p = this.skillPath(SENSITIVE_LIST_SKILL_NAME);
			t = (await adapter.exists(p)) ? await adapter.read(p) : "";
		} catch { /* 读失败按缺失处理，走包内默认 */ }
		if (!t.trim()) {
			console.warn(`[ArticleWriter] 敏感词清单技能文件缺失或为空，本次按包内示例词表处理（SKILLS/${SENSITIVE_LIST_SKILL_NAME}.md）`);
			t = DEFAULT_SKILLS[SENSITIVE_LIST_SKILL_NAME] ?? "";
		}
		return parseBannedWordsMd(t);
	}

	// ---------- 技能系统（v0.3.0+）：技能文件＝<work_dir>/SKILLS/<name>.md（vault 内、平铺一层、用户可直接编辑）；引用文档清单以 skill:<name> 条目 opt-in ----------
	// 注意：SKILLS 读写一律绕开 manager.readDoc/writeDoc——storyNameOfPath 把 work_dir 下第一级目录当书名，
	// 经 readDoc/writeDoc 会触发 ensureLayout 把 SKILLS/ 当旧格式书迁移（技能文件被搬进 案头资料/书稿）。故直接走 vault adapter。

	/** 技能目录路径：work_dir 下 SKILLS/（vault 根=顶层 SKILLS 文件夹）。public＝设置页引用文档框列技能文件用 */
	skillsDir(): string {
		const dir = this.settings.workDir.replace(/\/+$/, "");
		return dir ? `${dir}/SKILLS` : "SKILLS";
	}

	/** 技能文件路径：SKILLS/<name>.md（name＝清单里 skill: 后的基名）。public＝设置页引用文档行双击打开技能用 */
	skillPath(name: string): string {
		return `${this.skillsDir()}/${name}.md`;
	}

	/** 在编辑器中打开技能文件（v0.4.2+ 设置页引用文档「技能 · X」行双击）：文件缺失先试 ensureSkillsFiles 重播种（内置技能误删可回），仍缺则 Notice 提示 */
	async openSkillFile(name: string): Promise<void> {
		const p = this.skillPath(name);
		let file = this.app.vault.getAbstractFileByPath(p);
		if (!(file instanceof TFile)) {
			await this.ensureSkillsFiles();
			file = this.app.vault.getAbstractFileByPath(p);
		}
		if (!(file instanceof TFile)) {
			new Notice(`技能文件不存在：${p}（可在 ${this.skillsDir()}/ 下新建 ${name}.md）`, 6000);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	/** 启动/设置工作目录后确保内置技能文件存在：仅缺失才写、绝不覆盖用户内容（禁用词清单技能播种也走这里，v0.3.6+ Skill 化）；失败不阻断 */
	private async ensureSkillsFiles(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			await this.ensureFolders(this.skillsDir()); // v0.3.4+：write 不承诺建父目录，显式确保（见 saveSkillFile）
			// v0.4.3+ 写作任务技能合并：存量「章节写作任务」「章节创作」迁移成唯一《章节写作指导.md》并清理旧文件——须先于播种循环（防用户定制被内置默认先占位）
			await this.mergeWritingTaskSkillFiles();
			for (const [name, text] of Object.entries(DEFAULT_SKILLS)) {
				const p = this.skillPath(name);
				if (await adapter.exists(p)) continue;
				const slash = p.lastIndexOf("/");
				if (slash > 0) await this.ensureFolders(p.slice(0, slash)); // v0.4.3+：题材/、编写类型/ 等子目录技能也要播种
				let content = text;
				if (name.startsWith(`${GENRE_SKILL_FOLDER}/`)) {
					// v0.4.3+：题材目录技能优先沿用旧平铺技能（用户可能已定制），仅替换起始标题行
					const genre = name.slice(GENRE_SKILL_FOLDER.length + 1);
					const flat = GENRE_FLAT_SKILL_SOURCES[genre];
					if (flat) {
						const src = this.skillPath(flat);
						try {
							const old = (await adapter.exists(src)) ? await adapter.read(src) : "";
							if (old.trim()) content = old.replace(/^#\s.*$/m, `# ${genre}`);
						} catch { /* 旧文件读取失败按内置默认播种 */ }
					}
				}
				await adapter.write(p, content.endsWith("\n") ? content : content + "\n"); // 不经 manager，见本区块头注释
			}
			// v0.4.3+ 张力规则并入张力工具箱：存量技能文件补齐内置新增段（H·节奏控制＋用法建议），用户已改写的内容不动；缺失文件上面已播种为完整合并版
			await this.mergeTensionToolboxSkill();
			// v0.4.3+ 身份加强·编写文章不带字数要求：清理存量文件【任务】列举行的【字数要求…】（裸写与占位写法两代形态）——字数约束唯一出处＝代码主清单第 2 条（按书级 word_range）
			await this.removeIdentityBoostWordRequirement();
			// v0.4.3+ 章节写作指导固定文字化：存量文件里两个旧动态条款行（{{outline_ref_clause}} 卷结构定位、{{chapter_ref_ban}} 禁令）移除、头部注释换代——禁令改由代码生成（主清单第 3 条）、卷结构定位条款整体移除不再注入
			await this.upgradeWritingTaskSkillFixed();
			// v0.4.3+：系统提示词覆盖技能（SKILLS/系统提示词/<名称>.md）——同样仅缺失才写，编辑后由 vault 事件刷新
			const sysDir = `${this.skillsDir()}/${SYSTEM_PROMPT_SKILL_FOLDER}`;
			await this.ensureFolders(sysDir);
			// v0.4.3+ 退役系统提示词技能：默认写作身份（改由用户在「LLM 配置 → 写作系统提示词」自配，定制内容自动并入）、世界观生成、书级大纲生成（恢复内置常量，不再可覆盖）
			// v0.4.3+ 退役系统提示词技能：默认写作身份/世界观生成/书级大纲生成（系统提示词不再可覆盖：写作身份用内置默认、可按需经技能通道加强；三个旧文件启动时清理）
			await this.retireSysPromptSkill("默认写作身份");
			await this.retireSysPromptSkill("世界观生成");
			await this.retireSysPromptSkill("书级大纲生成");
			for (const [name, text] of Object.entries(SYSTEM_PROMPT_SKILLS)) {
				const p = `${sysDir}/${name}.md`;
				if (await adapter.exists(p)) continue;
				await adapter.write(p, text.endsWith("\n") ? text : text + "\n");
			}
			await this.refreshPromptSkillOverrides();
		} catch (e) {
			console.warn("[ArticleWriter] 播种技能文件失败", e);
		}
	}

	/** v0.4.3+ 张力规则并入张力工具箱：存量 `SKILLS/张力工具箱.md` 一次性补齐内置新增段（H·节奏控制＋用法建议，事实源 skills_default.TENSION_TOOLBOX_TAIL）。
	 *  只追加缺失段、用户已改写的正文一律不动；文件缺失＝交给播种写完整合并版；已含该段则跳过（幂等，重复启动无副作用）。写盘失败下次启动再试。 */
	private async mergeTensionToolboxSkill(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const p = this.skillPath(TENSION_TOOLBOX_SKILL_NAME);
			if (!(await adapter.exists(p))) return;
			const tail = TENSION_TOOLBOX_TAIL.trim();
			if (!tail) return;
			const cur = await adapter.read(p);
			if (cur.includes("### H. 节奏控制") || cur.includes(tail)) return;
			await adapter.write(p, `${cur.replace(/\s+$/, "")}\n\n${tail}\n`);
		} catch (e) {
			console.warn(`[ArticleWriter] 补齐 SKILLS/${TENSION_TOOLBOX_SKILL_NAME}.md（张力规则并入）失败`, e);
		}
	}

	/** v0.4.3+ 身份加强·编写文章移除字数要求：该技能文本不得带字数约束——正文字数要求唯一出处＝buildChapterPrompt 代码主清单第 2 条（按书级《故事状态.md》word_range 生成）。
	 *  存量 `SKILLS/身份加强·编写文章.md` 清理【任务】列举行的【字数要求…】两代形态：
	 *  占位写法「【字数要求：{{word_low}}-{{word_high}}字（严禁超过{{word_high}}字）】」（上一版迁移产物）与裸写「【字数要求】」（仅锚点「【发布平台】【字数要求】【风格/语气】」命中时删，用户改写过不动）；
	 *  清理后文本与原文一致则跳过（幂等）。文件缺失＝交给播种写新模板；写盘失败下次启动再试。 */
	private async removeIdentityBoostWordRequirement(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const name = `${IDENTITY_BOOST_SKILL_PREFIX}${WRITING_PHASE_LABELS[PHASE_WRITING]}`;
			const p = this.skillPath(name);
			if (!(await adapter.exists(p))) return;
			const cur = await adapter.read(p);
			let next = cur.replace("【字数要求：{{word_low}}-{{word_high}}字（严禁超过{{word_high}}字）】", "");
			if (next.includes("【发布平台】【字数要求】【风格/语气】")) next = next.replace("【发布平台】【字数要求】【风格/语气】", "【发布平台】【风格/语气】");
			if (next === cur) return;
			await adapter.write(p, next);
		} catch (e) {
			console.warn(`[ArticleWriter] 清理 SKILLS/${IDENTITY_BOOST_SKILL_PREFIX}${WRITING_PHASE_LABELS[PHASE_WRITING]}.md（字数要求移除）失败`, e);
		}
	}

	/** v0.4.3+ 章节写作指导固定文字化：两个旧动态条款（卷结构定位＋章节号引用禁令）移出技能文件——禁令由 buildChapterPrompt 代码生成（主清单第 3 条）、卷结构定位条款已按要求整体移除——
	 *  存量文件删除仍含 `{{outline_ref_clause}}`/`{{chapter_ref_ban}}` 的编号条文行、旧头部注释行换代为 skills_default.WRITING_TASK_FIXED_COMMENT（锚点「本技能提供「创作本章正文」」），
	 *  合并旧文件残留的旧标题（# 章节创作）规整为技能名、编号条文序号统一规整为 1 起（单独装配约定）；其余行逐字保留（用户定制条文不动）。
	 *  升级后内容与原文一致则跳过（幂等）；文件缺失＝交给播种写内置新种子；写盘失败下次启动再试。 */
	private async upgradeWritingTaskSkillFixed(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const p = this.skillPath(WRITING_TASK_SKILL_NAME);
			if (!(await adapter.exists(p))) return;
			const cur = await adapter.read(p);
			const hasPh = cur.includes("{{outline_ref_clause}}") || cur.includes("{{chapter_ref_ban}}");
			// 注释换代锚点：旧原始注释（「本技能提供「创作本章正文」」）与第一代固定化注释（「本技能只提供固定文字条款」）都换成当前事实源 WRITING_TASK_FIXED_COMMENT
			const oldCommentRe = /^<!--.*(?:本技能提供「创作本章正文」|本技能只提供固定文字条款)/;
			const kept = cur
				.split(/\r?\n/)
				.filter((line) => !(hasPh && /^\s*\d+[.、]/.test(line) && (line.includes("{{outline_ref_clause}}") || line.includes("{{chapter_ref_ban}}"))));
			let counter = 0;
			const next = kept
				.map((line, i) => {
					if (oldCommentRe.test(line)) return WRITING_TASK_FIXED_COMMENT;
					if (i === 0 && line.startsWith("# ") && !line.startsWith(`# ${WRITING_TASK_SKILL_NAME}`)) return `# ${WRITING_TASK_SKILL_NAME}`;
					const m = /^\s*(\d+)([.、]\s*)/.exec(line);
					if (m) {
						counter += 1;
						if (m[1] !== String(counter)) return line.replace(m[1], String(counter));
					}
					return line;
				})
				.join("\n")
				.replace(/\s+$/, "") + "\n";
			if (next === cur) return;
			await adapter.write(p, next);
		} catch (e) {
			console.warn(`[ArticleWriter] 升级 SKILLS/${WRITING_TASK_SKILL_NAME}.md（固定文字条文化）失败`, e);
		}
	}

	/** v0.4.3+ 写作任务技能合并：「章节写作任务」「章节创作」两份并为唯一 `SKILLS/章节写作指导.md`——新文件缺失时按旧文件内容迁移（「章节创作」优先，其次「章节写作任务」，保留用户定制原文），
	 *  两份旧文件都缺失/为空则不写（交给播种循环写内置默认 DEFAULT_SKILLS[章节写作指导]）；随后两份旧文件一律移入回收站（幂等：不存在即跳过；失败保留文件下次启动再试）。
	 *  清单里的旧 `skill:` 条目另由 loadSettings `migrateRefDocKeys` 按 REF_DOC_KEY_RENAMES 原位改写。须在播种循环之前调用。 */
	private async mergeWritingTaskSkillFiles(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const p = this.skillPath(WRITING_TASK_SKILL_NAME);
			if (!(await adapter.exists(p))) {
				for (const old of LEGACY_WRITING_TASK_SKILL_NAMES) {
					const op = this.skillPath(old);
					if (!(await adapter.exists(op))) continue;
					const cur = await adapter.read(op);
					if (!cur.trim()) continue;
					await adapter.write(p, cur.endsWith("\n") ? cur : cur + "\n");
					break;
				}
			}
		} catch (e) {
			console.warn(`[ArticleWriter] 迁移 SKILLS/${WRITING_TASK_SKILL_NAME}.md（写作任务技能合并）失败`, e);
		}
		for (const old of LEGACY_WRITING_TASK_SKILL_NAMES) await this.trashSkillByPath(this.skillPath(old)); // 清理与迁移独立：即便无需迁移（新文件已存在）也清旧文件
	}

	/** v0.4.3+ 技能文件退役共用：vault 路径存在 TFile 则移入回收站（`fileManager.trashFile`＝尊重用户删除偏好）、否则 adapter.remove；清理失败静默保留文件、下次启动再试（retireSysPromptSkill 与写作任务技能合并共用） */
	private async trashSkillByPath(p: string): Promise<void> {
		try {
			const tf = this.app.vault.getAbstractFileByPath(p);
			if (tf instanceof TFile) { await this.app.fileManager.trashFile(tf); return; }
			if (await this.app.vault.adapter.exists(p)) await this.app.vault.adapter.remove(p);
		} catch { /* 清理失败保留文件，下次启动再试 */ }
	}

	/** v0.4.3+ 退役一个系统提示词技能：`SKILLS/系统提示词/<name>.md` 存在则移入回收站（无 TFile 时 adapter.remove）；清理失败静默、下次启动再试。 */
	private async retireSysPromptSkill(name: string): Promise<void> {
		await this.trashSkillByPath(`${this.skillsDir()}/${SYSTEM_PROMPT_SKILL_FOLDER}/${name}.md`);
	}

	/** v0.4.3+ 刷新系统提示词覆盖缓存：读 SKILLS/系统提示词/ 下技能文件（system 条目剥注释/标题、任务条目原文直读），空则回落内置常量。 */
	private async refreshPromptSkillOverrides(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const dir = `${this.skillsDir()}/${SYSTEM_PROMPT_SKILL_FOLDER}`;
		const next = new Map<string, string>();
		for (const name of Object.keys(SYSTEM_PROMPT_SKILLS)) {
			try {
				const p = `${dir}/${name}.md`;
				if (!(await adapter.exists(p))) continue;
				const raw = await adapter.read(p);
				// v0.4.3+：TASK_PROMPTS 任务条目原文直读（仅 trim，条内含「## 时间点」等字面标题、剥洗会破坏）；9 个 system 条目仍剥注释/标题
				const text = name in TASK_PROMPTS ? raw.trim() : stripHeading(stripComments(raw)).trim();
				if (text) next.set(name, text);
			} catch { /* 读失败回落内置常量 */ }
		}
		this.promptSkillOverrides = next;
		// v0.4.3+：任务条目注入 prompts 模块覆盖表（pt/ptT 盘上优先、缺失/空回落内置）
		const taskNext: Record<string, string> = {};
		for (const k of Object.keys(TASK_PROMPTS)) {
			const v = next.get(k);
			if (v) taskNext[k] = v;
		}
		setTaskPromptOverrides(taskNext);
	}

	/** 取系统提示词：优先 SKILLS/系统提示词/<name>.md 覆盖，缺失回落内置常量 */
	private promptSkill(name: string, fallback: string): string {
		return this.promptSkillOverrides.get(name) || fallback;
	}

	/** 旧版「身份加强」→ 内置技能文件迁移（v0.3.4+，Skill 化收口）：data.json 各阶段 writing_phases[i].identity_boost（旧机制的用户定制文本）
	 *  转写为 SKILLS/身份加强·<阶段名>.md（剥掉旧【身份加强】标记、补 `# 技能名` 标题），迁移成功后从 data.json 删除该字段（对齐 system_guide 播种后清内嵌段先例）。
	 *  必须在 ensureSkillsFiles 之前跑：写好的文件被播种的 exists 检查跳过，用户旧定制不会被内置默认顶掉；同名文件已存在＝以文件为准、丢弃旧设置值。
	 *  未选工作目录时不动盘（SKILLS/ 本身也未播种），等 pickWorkDir 后再迁；写盘失败保留字段、下次启动重试。 */
	private async migrateIdentityBoostSkills(): Promise<void> {
		if (!this.settings.workDir) return;
		const phases = (this.settings.llm?.writing_phases ?? []) as Array<WritingPhase & { identity_boost?: string }>;
		if (!phases.some((p) => p.identity_boost && p.identity_boost.trim())) return;
		try {
			const adapter = this.app.vault.adapter;
			await this.ensureFolders(this.skillsDir()); // 不经 manager，见本区块头注释
			for (let i = 0; i < phases.length; i++) {
				const raw = phases[i].identity_boost?.trim();
				const label = WRITING_PHASE_LABELS[i];
				if (!raw || !label) continue;
				const name = `${IDENTITY_BOOST_SKILL_PREFIX}${label}`;
				const p = this.skillPath(name);
				if (await adapter.exists(p)) continue; // 文件为准
				await adapter.write(p, `# ${name}\n\n${raw.replace(/^【身份加强】\s*/, "")}\n`);
			}
			for (const p of phases) delete p.identity_boost;
			await this.saveData(this.settings);
		} catch (e) {
			console.warn("[ArticleWriter] 迁移旧身份加强到技能文件失败", e);
		}
	}

	/** 旧插件数据目录 BANNED_WORDS.md → SKILLS/网文高频禁用词清单.md 迁移（v0.3.6+，禁用词 Skill 化收口）：
	 *  技能文件缺失＝首次迁移：正文取旧 md 从第一个 `## ` 起的逐字内容（无 workDir 或 md 不存在则回落包内默认条目），头部换成 BANNED_LIST_SKILL_HEAD；
	 *  技能文件存在但逐字＝旧内置散文版（LEGACY_SKILL_BANNED_LIST，未被用户定制）＝v0.3.5 补充轮播种的占位版：用旧 md 正文覆盖成结构化版；
	 *  技能文件已是结构化版或经用户定制＝以文件为准不再覆盖（若此时旧 md 也被定制过，其定制内容无法并入，console.warn 提示后仍由 purge 删除 md）。
	 *  必须在 ensureSkillsFiles 之前跑（防内置默认先占位）；写盘失败下次启动重试；旧 md 本体由 purgeBannedWordsSkillArtifacts 删除。 */
	private async migrateBannedWordsSkill(): Promise<void> {
		if (!this.settings.workDir) return;
		try {
			const adapter = this.app.vault.adapter;
			await this.ensureFolders(this.skillsDir()); // 不经 manager，见技能区块头注释
			const sp = this.skillPath(BANNED_LIST_SKILL_NAME);
			const legacyMd = `${this.app.vault.configDir}/plugins/${this.manifest.id}/BANNED_WORDS.md`;
			const mdText = (await adapter.exists(legacyMd)) ? await adapter.read(legacyMd) : "";
			const skillText = (await adapter.exists(sp)) ? await adapter.read(sp) : "";
			if (skillText.trim() && skillText.trim() !== LEGACY_SKILL_BANNED_LIST.trim()) {
				if (mdText.trim() && mdText.trim() !== DEFAULT_SKILLS[BANNED_LIST_SKILL_NAME]?.trim()) {
					console.warn(`[ArticleWriter] 检测到旧 BANNED_WORDS.md 与技能文件均被编辑过，保留技能文件内容、旧清单文件将被删除；如有自定义词条请手动并入 SKILLS/${BANNED_LIST_SKILL_NAME}.md`);
				}
				return;
			}
			if (!mdText.trim()) {
				// 旧 md 不存在：技能文件缺失→不写，交给随后 ensureSkillsFiles 播种完整默认（防写出只有头部的空词表）；技能文件＝旧散文占位版→覆盖为包内默认结构化版
				if (skillText.trim() === LEGACY_SKILL_BANNED_LIST.trim()) await adapter.write(sp, DEFAULT_SKILLS[BANNED_LIST_SKILL_NAME] ?? "");
				return;
			}
			const bodyStart = mdText.search(/^## /m);
			if (bodyStart < 0) {
				// 旧 md 存在但没有词表正文（异常形态，如被清空只剩引言）：照实按空清单落盘——保留用户「清空词表」意图（解析器接受结构合法的空清单）
				await adapter.write(sp, BANNED_LIST_SKILL_HEAD);
				return;
			}
			await adapter.write(sp, BANNED_LIST_SKILL_HEAD + mdText.slice(bodyStart));
		} catch (e) {
			console.warn("[ArticleWriter] 迁移旧禁用词清单到技能文件失败", e);
		}
	}

	/** 禁用词 Skill 化残留清理（v0.3.6+）：插件数据目录 BANNED_WORDS.md（内容已迁移并入技能文件）＋旧内置技能「禁用词回避」——技能文件仅在逐字＝旧内置默认（未被用户定制）时删除；失败不阻断启动 */
	private async purgeBannedWordsSkillArtifacts(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const legacyMd = `${this.app.vault.configDir}/plugins/${this.manifest.id}/BANNED_WORDS.md`;
			if (await adapter.exists(legacyMd)) await adapter.remove(legacyMd); // 插件数据目录不被元数据索引收录，无回收站语义，直接删（对齐 purgeWritingGuideArtifacts）
			const ap = this.skillPath("禁用词回避");
			if (await adapter.exists(ap)) {
				const t = await adapter.read(ap);
				if (t.trim() === LEGACY_SKILL_BANNED_AVOID.trim()) await adapter.remove(ap); // 用户同名定制不碰
			}
		} catch (e) {
			console.warn("[ArticleWriter] 清理禁用词 Skill 化残留失败", e);
		}
	}

	/** 技能块共用装配（系统级 SKILLS/ 与书籍级 案头资料/Skill/ 同口径）：name+文件路径 → 读原文 → 剥 HTML 注释与起始标题行 → 【技能 · name】拼接；读失败/读空跳过，全空返回空串 */
	private async loadSkillsBlockFrom(entries: Array<{ name: string; file: string; header?: string }>): Promise<string> {
		const parts: string[] = [];
		for (const { name, file, header } of entries) {
			let t: string | null = null;
			try {
				t = (await this.app.vault.adapter.exists(file)) ? await this.app.vault.adapter.read(file) : null;
			} catch { /* 读失败按缺失跳过 */ }
			if (!t || !t.trim()) continue;
			const body = stripHeading(stripComments(t)).trim(); // 注释先剥，再剥标题行（注释行在前会挡住标题剥离）；两者都不进提示词
			if (!body) continue;
			parts.push(`${header ?? `【技能 · ${name}】`}\n${body}`);
		}
		return parts.join("\n\n");
	}

	/** 读取系统技能子目录中的技能（如 题材/玄幻仙侠、编写类型/网文小说）：用于 genre / writing_style 自动加载；缺失返回空串 */
	private async loadFolderSkillBlock(folder: string, name: string): Promise<string> {
		const n = (name || "").trim();
		if (!n) return "";
		const rel = `${folder}/${n}`;
		return this.loadSkillsBlockFrom([{ name: rel, file: this.skillPath(rel), header: `【${folder} · ${n}】` }]);
	}

	/** 读取用户在当前「编写文章」阶段选中的写作任务技能（v0.4.3+ 唯一载体＝章节写作指导；旧 章节创作/章节写作任务 清单条目已由 loadSettings 按 REF_DOC_KEY_RENAMES 改写）；未选返回空串 */
	private async loadSelectedTaskSkill(): Promise<string> {
		const keys = this.phaseRefDocKeys(PHASE_WRITING);
		const name = keys.includes(`skill:${WRITING_TASK_SKILL_NAME}`) ? WRITING_TASK_SKILL_NAME : "";
		return name ? await this.loadWritingTaskSkill(name) : "";
	}

	/** 读取平铺写作任务技能的静态正文（SKILLS/<name>.md，剥注释/标题）；缺失返回空串 */
	private async loadWritingTaskSkill(name: string): Promise<string> {
		const p = this.skillPath(name);
		try {
			if (!(await this.app.vault.adapter.exists(p))) return "";
			const raw = await this.app.vault.adapter.read(p);
			return stripHeading(stripComments(raw)).trim();
		} catch {
			return "";
		}
	}

	/** 列出系统技能子目录下的技能名（SKILLS/<folder>/*.md 基名，zh 排序）：新建/修改小说信息弹窗的题材、编写类型下拉 */
	async listFolderSkillNames(folder: string): Promise<string[]> {
		const dir = `${this.skillsDir()}/${folder}`;
		try {
			const listed = await this.app.vault.adapter.list(dir);
			return listed.files
				.filter((f) => f.toLowerCase().endsWith(".md"))
				.map((f) => f.slice(dir.length + 1, -3))
				.filter((n) => n.trim().length > 0)
				.sort((a, b) => a.localeCompare(b, "zh"));
		} catch {
			return [];
		}
	}

	/** 递归列出 SKILLS/ 下全部技能（含子目录，返回相对路径基名如 `题材/玄幻仙侠`）：设置页「添加技能…」按文件夹层次展示与选择 */
	async listAllSkillNames(): Promise<string[]> {
		const root = this.skillsDir();
		const out: string[] = [];
		const walk = async (dir: string, prefix: string): Promise<void> => {
			let listed: { files?: string[]; folders?: string[] };
			try {
				listed = await this.app.vault.adapter.list(dir);
			} catch {
				return;
			}
			for (const f of listed.files ?? []) {
				if (!f.toLowerCase().endsWith(".md")) continue;
				const base = (f.split("/").pop() ?? "").slice(0, -3);
				if (base) out.push(`${prefix}${base}`);
			}
			for (const sub of listed.folders ?? []) {
				const name = sub.split("/").pop() ?? "";
				if (!name || name.startsWith(".")) continue;
				await walk(sub, `${prefix}${name}/`);
			}
		};
		await walk(root, "");
		return out.sort((a, b) => a.localeCompare(b, "zh"));
	}

	/** 装配阶段 phaseIdx 的系统级技能块（system prompt 注入用）：ref_docs 清单过滤 skill: 条目（去重）→ 读 SKILLS/<name>.md；无条目/全读不到返回空串。
	 *  v0.4.3+：exclude 用于跳过已由 genre/writing_style 自动注入的目录技能，避免同一技能重复注入。 */
	private async loadSkillsBlock(phaseIdx: number, exclude: string[] = []): Promise<string> {
		const names: string[] = [];
		for (const k of this.phaseRefDocKeys(phaseIdx)) {
			if (!k.startsWith("skill:")) continue;
			const name = k.slice(6);
			if (exclude.includes(name) || names.includes(name)) continue;
			names.push(name);
		}
		if (!names.length) return "";
		return this.loadSkillsBlockFrom(names.map((name) => ({ name, file: this.skillPath(name) })));
	}

	// ---------- 书籍级技能（v0.3.4+）：技能文件＝<书>/案头资料/Skill/<name>.md（每书一份、写字台「案头资料」下 Skill 子文件夹）；阶段选用存于 故事状态.md 的 book_skills（阶段 key → 技能名数组）----------
	// 与全局 SKILLS/ 不同：书籍级技能在书目录下，属真书路径，读写可安全走 manager.readDoc/promptReader（无 ensureLayout 误迁移风险）；全局 SKILLS/ 必须绕 manager（见上方区块头注释）。

	/** 书籍技能目录：「案头资料/Skill/」（该文件夹存在后自动渲染为写字台案头资料节的 Skill 节点，无需额外注册） */
	bookSkillsDir(storyName: string): string {
		return `${this.manager.deskDocsPath(storyName)}/Skill`;
	}

	/** 书籍技能文件路径：案头资料/Skill/<name>.md（name＝基名） */
	bookSkillPath(storyName: string, name: string): string {
		return `${this.bookSkillsDir(storyName)}/${name}.md`;
	}

	/** 列出书籍技能名（基名去 .md 后缀、按 zh 排序）；目录不存在返回空数组 */
	async listBookSkillNames(storyName: string): Promise<string[]> {
		try {
			const listing = await this.app.vault.adapter.list(this.bookSkillsDir(storyName));
			return listing.files
				.filter((f) => f.endsWith(".md"))
				.map((f) => f.slice(f.lastIndexOf("/") + 1, -3))
				.sort((a, b) => a.localeCompare(b, "zh"));
		} catch {
			return [];
		}
	}

	/** 阶段 phaseIdx（0–4）本书选用的书籍技能名（读 故事状态.md book_skills；未配置＝空数组） */
	async phaseBookSkillNames(storyName: string, phaseIdx: number): Promise<string[]> {
		const key = bookSkillPhaseKey(phaseIdx);
		if (!key) return [];
		const st = await this.manager.loadState(storyName);
		const names = st?.book_skills?.[key];
		return Array.isArray(names) ? names : [];
	}

	/** 书籍技能注入 spec（v0.3.4+ 共用形态）：技能名 → 【技能 · name】PromptSpec（stripHeading、经 promptReader→readDoc 读书目录下真书路径）；orderRefDocSpecs 追加注入与固定 speclist 装配（时间线输入等）共用 */
	private bookSkillSpecsFromDir(dir: string, names: string[]): PromptSpec[] {
		return names.map((name) => ({ file: `${dir}/${name}.md`, header: `【技能 · ${name}】`, stripHeading: true }));
	}

	/** 装配阶段 phaseIdx 的书籍技能块（现仅「编写文章」阶段＝PHASE_WRITING 经 writerSystemPrompt 注入 system prompt）：读案头资料/Skill/<name>.md；清洗与拼接走 loadSkillsBlockFrom（与系统级技能同口径）；无条目/全读不到返回空串 */
	async loadBookSkillsBlock(storyName: string, phaseIdx: number): Promise<string> {
		const names = await this.phaseBookSkillNames(storyName, phaseIdx);
		if (!names.length) return "";
		return this.loadSkillsBlockFrom(names.map((name) => ({ name, file: this.bookSkillPath(storyName, name) })));
	}

	/** 逐级确保 vault 目录存在（adapter.mkdir 一次只建一层；adapter.write 不承诺创建父目录——v0.3.4+ 技能保存失败 bug 修复：写技能文件前必须先显式建目录） */
	private async ensureFolders(path: string): Promise<void> {
		const parts = path.split("/");
		for (let i = 1; i <= parts.length; i++) {
			const seg = parts.slice(0, i).join("/");
			if (!(await this.app.vault.adapter.exists(seg))) await this.app.vault.adapter.mkdir(seg);
		}
	}

	/** 保存技能文件（编写面板提交）：system＝全局 SKILLS/<name>.md（绕 manager 走 adapter）；book＝<书>/案头资料/Skill/<name>.md。写前逐级 ensure 目录（adapter.write 不承诺建父目录）。返回写入路径 */
	async saveSkillFile(level: SkillLevel, storyName: string | null, name: string, content: string): Promise<string> {
		const text = content.endsWith("\n") ? content : content + "\n";
		if (level === "system") {
			await this.ensureFolders(this.skillsDir());
			const p = this.skillPath(name);
			await this.app.vault.adapter.write(p, text);
			return p;
		}
		if (!storyName) throw new Error("未指定小说，无法保存书籍级技能");
		await this.ensureFolders(this.bookSkillsDir(storyName));
		const p = this.bookSkillPath(storyName, name);
		await this.app.vault.adapter.write(p, text);
		return p;
	}

	/** 删除技能文件（书籍级同步清理 故事状态.md book_skills 各阶段引用，防悬空条目） */
	async deleteSkillFile(level: SkillLevel, storyName: string | null, name: string): Promise<void> {
		if (level === "system") {
			const p = this.skillPath(name);
			if (!(await this.app.vault.adapter.exists(p))) throw new Error(`技能文件不存在：${p}`);
			await this.app.vault.adapter.remove(p);
			return;
		}
		if (!storyName) throw new Error("未指定小说，无法删除书籍级技能");
		const p = this.bookSkillPath(storyName, name);
		if (!(await this.app.vault.adapter.exists(p))) throw new Error(`技能文件不存在：${p}`);
		await this.app.vault.adapter.remove(p);
		const st = await this.manager.loadState(storyName);
		if (st?.book_skills) {
			let changed = false;
			for (const k of BOOK_SKILL_PHASE_KEYS) {
				const arr = st.book_skills[k];
				if (arr && arr.includes(name)) {
					const next = arr.filter((n) => n !== name);
					if (next.length) st.book_skills[k] = next;
					else delete st.book_skills[k];
					changed = true;
				}
			}
			if (changed) await this.manager.saveState(storyName, st);
		}
	}

	/** SkillEditModal 的 Promise 包装：提交 resolve 结果、关闭未提交 resolve null */
	private skillEditBox(title: string, editing: { name: string; level: SkillLevel } | null, initialContent: string): Promise<SkillEditResult | null> {
		return new Promise((resolve) => {
			new SkillEditModal(this.app, title, editing, initialContent, (r) => resolve(r), () => resolve(null)).open();
		});
	}

	/**
	 * 技能编写流（命令「新建 Skill…」与写字台案头资料右键入口共用；面板移除后编辑态暂无入口，保留能力）：editing=null 新建（内容预填 SKILL_CONTENT_TEMPLATE 格式模板、保存位置默认书籍级）；
	 * 编辑态读原文件预填、级别预选当前。提交后：级别未变＝原地保存；改了级别＝以同名另存另一级（目标已存在先确认覆盖）再删旧文件。
	 * 保存成功只弹 Notice、不接任何后续配置（v0.3.4+ 创建与配置解耦）；写盘失败给 8s 具体错误 Notice（防面板外层 catch 吞错、一闪而过）。
	 */
	private async editSkillFlow(story: string, editing: { name: string; level: SkillLevel } | null): Promise<void> {
		let initial: string;
		if (editing) {
			const p = editing.level === "system" ? this.skillPath(editing.name) : this.bookSkillPath(story, editing.name);
			initial = (await this.app.vault.adapter.exists(p)) ? await this.app.vault.adapter.read(p) : "";
		} else {
			initial = SKILL_CONTENT_TEMPLATE;
		}
		const res = await this.skillEditBox(editing ? `编辑 Skill：${editing.name}` : "新建 Skill", editing, initial);
		if (!res) return;
		if (res.level === "book" && !story) {
			new Notice("书籍级 Skill 需要先有当前小说：请在写字台「书籍列表」切换后重试，或把保存位置改为系统级", 8000);
			return;
		}
		const target = res.level === "system" ? this.skillPath(res.name) : this.bookSkillPath(story, res.name);
		const moved = editing && editing.level !== res.level; // 编辑态改保存位置＝另存另一级＋删旧（防旧文件残留同名混淆）
		if ((moved || !editing) && (await this.app.vault.adapter.exists(target)) && !(await this.confirmBox("覆盖已有技能", `保存位置已存在「${res.name}.md」，覆盖其内容？`, "覆盖"))) return;
		try {
			await this.saveSkillFile(res.level, story, res.name, res.content);
		} catch (e) {
			this.notifyError("保存技能文件失败", e);
			return;
		}
		if (moved) {
			try {
				await this.deleteSkillFile(editing.level, story, editing.name); // 书籍级旧文件删除同时清理 book_skills 引用
			} catch (e) {
				this.notifyError("已另存成功，但旧位置文件删除失败", e);
			}
		}
		new Notice(moved ? `已另存为${res.level === "system" ? "系统级（SKILLS/）" : "书籍级（案头资料/Skill/）"}：「${res.name}」` : `已保存技能：${target}`, 5000);
	}

	/** 阶段选用配置流（独立命令「书籍 Skill 阶段配置…」与写字台右键入口共用）：BookSkillPhaseModal 五阶段多选，保存写回 故事状态.md book_skills（空阶段省略该键） */
	private async phaseBookSkillFlow(story: string, phases: { key: BookSkillPhase; label: string }[]): Promise<void> {
		const names = await this.listBookSkillNames(story);
		const st = await this.manager.validatedState(story);
		const sel: Partial<Record<BookSkillPhase, string[]>> = st.book_skills ?? {};
		const cur: Partial<Record<BookSkillPhase, readonly string[]>> = {};
		for (const k of BOOK_SKILL_PHASE_KEYS) {
			const a = sel[k];
			if (a && a.length) cur[k] = a;
		}
		const res = await new Promise<Partial<Record<BookSkillPhase, string[]>> | null>((resolve) => {
			new BookSkillPhaseModal(this.app, phases, names, cur, (r) => resolve(r), () => resolve(null)).open();
		});
		if (!res) return;
		st.book_skills = { worldview: res.worldview ?? [], planning: res.planning ?? [], outline: res.outline ?? [], volume_outline: res.volume_outline ?? [], writing: res.writing ?? [] };
		await this.manager.saveState(story, st);
		new Notice("书籍 Skill 阶段配置已保存", 5000);
	}

	/** 独立创建命令（v0.3.4+ 创建/配置解耦）：名称＋保存位置下拉＋内容预填格式模板；保存只落盘给 Notice，不进入任何配置（阶段配置由「书籍 Skill 阶段配置…」单独调出） */
	async cmdSkillNew(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		try {
			await this.editSkillFlow(this.settings.lastStory, null);
		} catch (e) {
			this.notifyError("新建 Skill 失败", e);
		}
	}

	/** 五阶段定义（label 取 WRITING_PHASE_LABELS 共用常量、与设置页阶段 tab 同名）：阶段配置命令与写字台右键入口共用 */
	private bookSkillPhaseDefs(): { key: BookSkillPhase; label: string }[] {
		return BOOK_SKILL_PHASE_KEYS.map((key, i) => ({ key, label: WRITING_PHASE_LABELS[i] ?? `阶段 ${i}` }));
	}

	/** 独立阶段配置命令（v0.3.4+）：直达当前书五阶段选用配置框 */
	async cmdBookSkillPhases(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			await this.phaseBookSkillFlow(story, this.bookSkillPhaseDefs());
		} catch (e) {
			this.notifyError("书籍 Skill 阶段配置失败", e);
		}
	}

	/** 提示词文件读取器（assemblePromptFiles 注入用）：插件数据目录文件（.obsidian/plugins/<id>/…，不被元数据索引收录）走 readPluginFile，
	 *  SKILLS/ 技能文件走 adapter.read（绕 readDoc 的布局收口，见技能区块头注释），其余 vault 路径走 readDoc（含布局收口）；缺失按空处理 */
	private promptReader(): PromptFileReader {
		const prefix = `${this.app.vault.configDir}/plugins/${this.manifest.id}/`;
		const skillsPrefix = `${this.skillsDir()}/`;
		return async (file) => {
			if (file.startsWith(prefix)) return await this.manager.readPluginFile(file);
			if (file.startsWith(skillsPrefix)) {
				try { return (await this.app.vault.adapter.exists(file)) ? await this.app.vault.adapter.read(file) : null; } catch { return null; }
			}
			return await this.manager.readDoc(file);
		};
	}

	/** 启动自检（v0.4.7+ 版本戳驱动）：比对《使用说明.md》里的版本戳与当前插件版本——缺失/为空/无戳/版本不符（升级即属此类）就用包内内置文本重建并打开；版本一致一律不动（用户决策：升级直接覆盖、不留备份） */
	private async syncUsageDocOnStartup(): Promise<void> {
		try {
			const dir = this.settings.workDir.replace(/\/+$/, "");
			if (!dir) return;
			if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) return;
			const p = this.usageDocPath();
			const v = this.manifest.version;
			const ex = await this.manager.readGuideAt(p);
			if (!usageDocNeedsRegen(ex, v)) return;
			const old = usageDocVersion(ex ?? "");
			await this.writeUsageDoc(p);
			new Notice(ex && ex.trim() ? (old ? `插件升级 ${old} → ${v}：已重新生成《使用说明.md》（内置说明，可按需继续编辑）` : `《使用说明.md》无版本戳（旧版插件遗留），已按当前版本 ${v} 重新生成`) : "已在工作目录创建《使用说明.md》", 8000);
			this.openWhenLayoutReady(p);
		} catch (e) {
			console.warn("[ArticleWriter] 启动生成《使用说明.md》失败", e);
		}
	}

	/** 写内置说明的统一出口（v0.4.7+）：stampUsageDoc 前置版本戳注释＋可见版本提示行——启动自检/切工作目录投放/手动命令三处共用 */
	private async writeUsageDoc(path: string): Promise<void> {
		await this.manager.writeGuideAt(path, stampUsageDoc(DEFAULT_USAGE_GUIDE, this.manifest.version));
	}

	/** 等 workspace 布局就绪再开文件（onload 阶段 getLeaf 可能不可用）；转调 runWhenLayoutReady */
	private openWhenLayoutReady(path: string): void {
		this.runWhenLayoutReady(() => { void this.manager.openMarkdown(path).catch((e) => console.warn(`[ArticleWriter] 打开 ${path} 失败`, e)); });
	}

	/** 等 workspace 布局就绪再执行（onload 阶段 getLeaf/Modal 叠层不可靠）；本仓库 dts 版本的 workspace.on 无 layout-ready 事件，改用短轮询、registerInterval 托管卸载清理 */
	private runWhenLayoutReady(run: () => void): void {
		if (this.app.workspace.layoutReady) {
			run();
			return;
		}
		const timer = window.setInterval(() => {
			if (!this.app.workspace.layoutReady) return;
			window.clearInterval(timer);
			run();
		}, 250);
		this.registerInterval(timer);
	}

	/** v0.4.7+ 启动无书引导：一次 listStories 判定「有没有书籍」——未设工作目录＝引导先选目录；工作目录有效但其中没有任何书（子文件夹里都没有《故事状态.md》）＝引导建书。
	 *  面板动作：建书（走 cmdNewStory）/换工作目录/打开《使用说明.md》/不再弹出（写 settings.noStoryGuideOff，设置页可再开）。设置里已关＝不弹；列表读取失败＝不弹（不干扰启动） */
	private async guideNewStoryOnStartup(): Promise<void> {
		if (this.settings.noStoryGuideOff) return;
		const dir = this.settings.workDir.replace(/\/+$/, "");
		if (dir) {
			if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) return; // 工作目录已失效：走原有「命令里重新选目录」路径，不叠引导
			let stories: string[] = [];
			try {
				stories = await this.manager.listStories();
			} catch (e) {
				console.warn("[ArticleWriter] 启动引导读取书籍清单失败", e);
				return;
			}
			if (stories.length) return;
			this.runWhenLayoutReady(() => {
				new AwGuideModal(this.app, {
					title: "先建一本书，开始写小说",
					body: `工作目录「${dir}」里还没有书籍（其下文件夹都没有《故事状态.md》）。\n\n「创建新小说」＝填书名＋选题材与编写类型，然后建 <书名>/ 文件夹并生成全套模板文档（故事状态.md、大纲.md、世界观.md、卷.md、伏笔.md、笔记.md 等）；建好就能建章、续写、用对话面板讨论剧情。\n书如果放在别处，点「换一个工作目录」。`,
					actions: [
						{ label: "创建新小说", cta: true, run: () => void this.cmdNewStory() },
						{ label: "换一个工作目录", run: () => void this.pickWorkDir(false) },
						{ label: "打开使用说明", run: () => void this.manager.openMarkdown(this.usageDocPath()).catch((e) => console.warn("[ArticleWriter] 打开使用说明失败", e)) },
						{ label: "不再弹出", run: () => void this.disableNoStoryGuide() },
					],
				}).open();
			});
			return;
		}
		this.runWhenLayoutReady(() => {
			new AwGuideModal(this.app, {
				title: "先选工作目录，再建一本书",
				body: "还没有工作目录，也就还没有任何书籍。\n\n先指定 vault 里存放小说的文件夹（如「我的工作/写书计划」）：之后每本书都是它下面的一个 <书名>/ 文件夹（内含《故事状态.md》等模板文档）。\n选好后用「创建新小说」建第一本书。",
				actions: [
					{ label: "选择工作目录", cta: true, run: () => void this.pickWorkDir(true) },
					{ label: "打开使用说明", run: () => void this.manager.openMarkdown(this.usageDocPath()).catch((e) => console.warn("[ArticleWriter] 打开使用说明失败", e)) },
					{ label: "不再弹出", run: () => void this.disableNoStoryGuide() },
				],
			}).open();
		});
	}

	/** 引导面板「不再弹出」：写 settings.noStoryGuideOff 并落盘；设置页「无小说时弹出建书引导」可重新开启 */
	private async disableNoStoryGuide(): Promise<void> {
		this.settings.noStoryGuideOff = true;
		await this.saveSettings();
		new Notice("已关闭「无小说时弹出建书引导」：可在 设置 → ArticleWriter → 「无小说时弹出建书引导」重新开启", 8000);
	}

	/** 《使用说明.md》路径：work_dir 根（vault 根=顶层文件） */
	private usageDocPath(): string {
		const dir = this.settings.workDir.replace(/\/+$/, "");
		return dir ? `${dir}/使用说明.md` : "使用说明.md";
	}

	/** 设置/切换工作目录后把《使用说明.md》投放到其根（v0.4.7+ 与启动自检同口径）：缺失/为空/无戳/版本不符才写，已是当前版本则不动。返回是否写入（新建或重建） */
	private async seedUsageDoc(): Promise<boolean> {
		try {
			const p = this.usageDocPath(); // 调用时 settings.workDir 已更新（pickWorkDir 回调内先赋值）
			const ex = await this.manager.readGuideAt(p);
			if (!usageDocNeedsRegen(ex, this.manifest.version)) return false;
			await this.writeUsageDoc(p);
			try { await this.manager.openMarkdown(p); } catch { /* 打开失败不影响投放结果（用户交互期 workspace 已就绪，理论上不会到这里） */ }
			return true;
		} catch (e) {
			console.warn("[ArticleWriter] 生成《使用说明.md》失败", e);
			return false;
		}
	}

	/** 手动生成/重建使用说明（v0.4.7+ 与启动自检同口径）：缺失/为空/无戳/版本不符＝按当前版本重建并打开；已是当前版本＝不动并提示（要强制重建先删该文件） */
	async cmdGenerateUsageDoc(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		try {
			const p = this.usageDocPath();
			const v = this.manifest.version;
			const ex = await this.manager.readGuideAt(p);
			if (!usageDocNeedsRegen(ex, v)) {
				new Notice(`《使用说明.md》已是当前版本 ${v}，未改动：${p}\n如需强制重建，请先删除该文件再运行本命令`, 8000);
				return;
			}
			await this.writeUsageDoc(p);
			new Notice(`已生成使用说明：${p}（版本 ${v}）`, 8000);
			await this.manager.openMarkdown(p);
		} catch (e) {
			this.notifyError("生成使用说明失败", e);
		}
	}

	/** 通用剧本转换：按“原文件名 + 剧本”命名输出到同目录；可复用于当前打开文件或某章节正文；v0.2.22+：走编写文章阶段配置（辅助任务归属阶段 4） */
	private async convertMarkdownToScreenplay(file: TFile, label = file.basename): Promise<void> {
		const setup = this.getPhaseLlmSetup(PHASE_WRITING);
		if (!setup) {
			new Notice("未找到 LLM 配置\n请先在 Obsidian 设置里配置 ArticleWriter 的模型。", 8000);
			return;
		}
		const sourceText = await this.app.vault.read(file);
		if (!sourceText.trim()) {
			new Notice(`《${label}》为空，无法转换成剧本。`, 8000);
			return;
		}
		const dirPath = file.path.includes("/") ? file.path.substring(0, file.path.lastIndexOf("/")) : "";
		const baseName = file.basename || "未命名";
		let targetName = `${baseName}剧本.md`;
		let targetPath = dirPath ? `${dirPath}/${targetName}` : targetName;
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(targetPath)) {
			targetName = `${baseName}剧本${counter}.md`;
			targetPath = dirPath ? `${dirPath}/${targetName}` : targetName;
			counter++;
		}
		const systemPrompt = buildStoryTypeSystemPrompt({ storyType: "剧本" });
		const userPrompt = [
			pt("剧本转换-改写要求"), // v0.4.3+：固定指令文本走 TASK_PROMPTS（SKILLS/系统提示词/ 盘上可编辑），「原文：」与正文留代码动态拼接
			"原文：",
			sourceText,
		].join("\n\n");
		const notice = new Notice(`正在将《${label}》转换为剧本…`);
		try {
			const done = await chatCompletion(
				setup.cfg,
				[
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				{ max_tokens: Math.max(4000, Math.ceil(sourceText.length * 2)), temperature: 0.7 }
			);
			let converted = (done || "").trim();
			if (!converted) throw new Error("LLM 未返回内容");
			const reason = validateStoryTypeFormat(converted, "剧本");
			if (reason) {
				// v0.4.3+ 重试＝会话续轮（retryTurnMessages）：旧「重写指令＋原文」重发在第一字符即分叉，整段原文重新 prefill（实测 reused=0）；
				// 现把上一版剧本作 assistant 轮、重写指令作新一轮 user 消息 → 首请求整段前缀复用。两段固定行并条，动态校验原因经「校验反馈：{{reason}}」插值
				const retry = await chatCompletion(
					setup.cfg,
					retryTurnMessages({ role: "system", content: systemPrompt }, userPrompt, converted, ptT("剧本转换-重写指令", { reason })),
					{ max_tokens: Math.max(4000, Math.ceil(sourceText.length * 2)), temperature: 0.6 }
				);
				converted = (retry || converted).trim();
			}
			notice.hide();
			await this.app.vault.create(targetPath, converted);
			const newFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (newFile instanceof TFile) {
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile);
			}
			new Notice(`已转换为剧本：${targetName}`, 8000);
		} catch (e) {
			notice.hide();
			this.notifyError("文章转剧本失败", e);
		}
	}

	/** 把当前打开的文章改写为严格 screenplay，并以“原文件名 + 剧本”命名输出到同目录 */
	async cmdArticleToScreenplay(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
			new Notice("请先打开一个 Markdown 文件，再执行“文章转剧本”。", 8000);
			return;
		}
		await this.convertMarkdownToScreenplay(file);
	}

	/** 以写字台里选中的章节正文为源，输出同目录“章节名+剧本.md” */
	async cmdChapterToScreenplay(storyName: string, key: string): Promise<void> {
		const file = await this.manager.chapterBodyFile(storyName, key);
		if (!(file instanceof TFile)) {
			new Notice("该章节未找到正文文件，无法转换成剧本。", 8000);
			return;
		}
		const chapter = (await this.manager.listChapters(storyName)).find((c) => c.key === key);
		const label = chapter ? `第${String(chapter.num).padStart(2, "0")}章 ${chapter.title}` : file.basename;
		await this.convertMarkdownToScreenplay(file, label);
	}

	// ---------- LLM 配置（存插件数据目录 data.json，替代 ~/.articlewriter/config.json；首次运行预置标准模板） ----------

	/** 按写作阶段获取模型配置：优先使用阶段指定的 llm_config_name，未指定则取第一个配置（cfgs[0]）；active_llm（旧版激活态）与对话框选择的 chat_model 均不参与阶段回退——切换对话框模型/激活态不影响各阶段用哪个模型；无可用配置返回 null */
	private getPhaseLlmSetup(phaseIndex: number): PhaseLlmSetup | null {
		const conf = this.settings.llm ?? null;
		const cfgs = filterEnabledLlmConfigs(conf?.llm_configs ?? []);
		if (!conf || !cfgs.length) return null;
		const phases = conf.writing_phases ?? [];
		const phase = phases[phaseIndex];
		const cfgName = phase?.llm_config_name?.trim();
		const cfg = cfgName ? (cfgs.find((c) => c.name === cfgName) ?? cfgs[0]) : cfgs[0];
		return { cfg, systemPrompt: undefined, descStyle: conf.desc_style }; // v0.4.3+：全局 system_prompt 已废弃恒 undefined（identity_boost 早已 Skill 化）——各命令 system 走编写类型块/命令常量/内置默认
	}

	/** v0.4.6+ 修 C8：阶段模型完全缺失（无任何启用配置）时的统一提示——旧版多数命令 `if (!setup) return;` 静默退出，
	 *  用户按命令毫无反馈。写作类命令入口一律调用本提示；纯辅助/导出路径（摘要回调、导出提示词、批处理 helper）维持静默。 */
	private notifyNoLlm(): void {
		new Notice("未找到 LLM 配置\n请先在 Obsidian 设置 → ArticleWriter 的「LLM 模型配置」区填写（启用至少一组配置）", 8000);
	}

	/** 引用文档配置框（v0.2.25+）：读取阶段 idx 生效的引用文档清单（保存值 ?? 默认清单），按数组顺序原样返回——数组顺序即提示词装配顺序（排在前面的先注入）。
	 *  "file:" 前缀条目为用户自选 vault 文件，其余为内置 key；各装配入口按此顺序注入，清单外的内置文档不注入。 */
	private phaseRefDocKeys(phaseIdx: number): string[] {
		const saved = (this.settings.llm?.writing_phases ?? [])[phaseIdx]?.ref_docs;
		return (saved ?? PHASE_REF_DOC_DEFAULTS[phaseIdx] ?? []).filter((k) => k !== "guide"); // v0.3.5+：历史保存清单里的「guide」锁定项已随写作指南体系废弃（就地忽略，无需用户重设）
	}

	/** 引用文档配置框共用过滤（v0.2.25+）：keyed pairs 按 ref_docs 清单顺序重排为 specs 数组——file: 条目就地转为【引用文档 · <路径>】块（fileGroup＝正文族分组归属），
	 *  skill: 条目（v0.3.0+）就地转为【技能 · <name>】块（读 SKILLS/<name>.md；skipSkills＝正文族跳过，技能改走 system prompt 注入、防双份），清单外内置 key 不注入、重复 key 去重；
	 *  bookSkillDir＋bookSkillNames（v0.3.4+）：书籍级技能追加在所有清单条目之后（＝系统技能最后一个 skill: 条目之后），块头同为【技能 · <name>】；skipSkills 时同样不追加；
	 *  v0.3.5+：旧 guideKey「三层创作规范锁定项」已随写作指南体系废弃 */
	private orderRefDocSpecs(pairs: Array<{ key: string; spec: PromptSpec }>, ref: string[], opts?: { fileGroup?: string; skipSkills?: boolean; bookSkillDir?: string; bookSkillNames?: string[] }): PromptSpec[] {
		const byKey = new Map(pairs.map((p) => [p.key, p.spec]));
		const specs: PromptSpec[] = [];
		const seen = new Set<string>();
		for (const k of ref) {
			if (k.startsWith("file:")) { specs.push({ file: k.slice(5), header: `【引用文档 · ${k.slice(5)}】`, stripHeading: true, ...(opts?.fileGroup ? { group: opts.fileGroup } : {}) }); continue; }
			if (k.startsWith("skill:")) {
				if (!opts?.skipSkills) {
					const name = k.slice(6);
					specs.push({ file: this.skillPath(name), header: `【技能 · ${name}】`, stripHeading: true }); // 读经 promptReader skills 分支；重复条目由装配器 file 路径去重兜底
				}
				continue;
			}
			if (seen.has(k)) continue;
			const s = byKey.get(k);
			if (s) { seen.add(k); specs.push(s); }
		}
		if (!opts?.skipSkills && opts?.bookSkillDir && opts.bookSkillNames?.length) {
			specs.push(...this.bookSkillSpecsFromDir(opts.bookSkillDir, opts.bookSkillNames)); // v0.3.4+ 书籍技能：恒排在系统技能 skill: 条目之后
		}
		return specs;
	}

	/**
	 * LLM 对话框顶部下拉切换模型 → 写回 data.json 的 `chat_model`（并即时保存）：
	 * 对话框此后使用新模型；该值随 data.json 持久化，Obsidian 重启后对话框下拉从它加载。
	 * 写作命令按阶段映射取模型，不再依赖全局激活态。
	 */
	async setActiveLlmFromChat(name: string): Promise<void> {
		const conf = this.settings.llm;
		if (!conf || !name) return;
		const allowed = filterEnabledLlmConfigs(conf.llm_configs ?? []).map((cfg) => cfg.name);
		if (!allowed.includes(name) || conf.chat_model === name) return;
		conf.chat_model = name;
		await this.saveSettings();
		new Notice(`已切换对话框模型：${name}`, 4000);
	}

	/** 让已打开的 LLM 对话框下拉与激活项同步（设置页改激活模型 / 新建删除配置后调用；对话框自身切换无需调用） */
	syncChatModelSelect(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(LlmChatView.VIEW_TYPE)) {
			if (leaf.view instanceof LlmChatView) leaf.view.refreshModels();
		}
	}

	/** 对话「保存到文件」弹窗的默认路径前缀：当前书目录存在则用它，否则 work_dir，空=vault 根 */
	private async chatDefaultSaveDir(): Promise<string> {
		try {
			const info = await this.getActiveStoryInfo();
			if (info) {
				const p = this.manager.storyPath(info.story);
				if (this.app.vault.getAbstractFileByPath(p) instanceof TFolder) return p;
			}
		} catch { /* 取当前书失败降级为 work_dir */ }
		return this.settings.workDir;
	}

	/** v0.4.6+ 对话会话目录：当前书《案头资料/AI会话》（LlmChatView 每轮自动保存/接回最近会话用）；无当前小说返回 ""＝纯问答不落盘 */
	private async chatSessionDir(): Promise<string> {
		try {
			const info = await this.getActiveStoryInfo();
			return info ? `${this.manager.deskDocsPath(info.story)}/AI会话` : "";
		} catch {
			return "";
		}
	}

	// ---------- LLM 连接测试（对齐 CLI /llm test，GET /models；v0.2.22+：测编写文章阶段配置——写作命令实际使用的模型） ----------

	async cmdLlmTest(): Promise<void> {
		try {
			const setup = this.getPhaseLlmSetup(PHASE_WRITING);
			if (!setup) {
				new Notice("未找到 LLM 配置\n请在 Obsidian 设置 → ArticleWriter 的「LLM 模型配置」区填写", 8000);
				return;
			}
			await this.runLlmTest(setup.cfg);
		} catch (e) {
			this.notifyError("LLM 连接测试失败", e);
		}
	}

	/** 对指定配置执行 GET /models 连通性测试并弹通知（命令与设置页共用） */
	async runLlmTest(target: LlmConfigDoc): Promise<void> {
		const n = new Notice(`正在测试 LLM 连接：${target.name || "(未命名)"} @ ${normalizeBaseURL(target.base_url)} …`);
		try {
			const r = await testConnection(target);
			n.hide();
			new Notice(
				r.ok
					? `✓ 已连接 ${target.name}${r.models?.length ? `\n可用模型：${r.models.join("、")}` : ""}`
					: `✗ 连接失败 ${target.name}\n${r.message}`,
				r.ok ? 8000 : 20000,
			);
		} catch (e) {
			n.hide();
			new Notice(`✗ 测试异常：${e instanceof Error ? e.message : String(e)}`, 20000);
		}
	}

	/** 打开常驻 LLM 对话面板：已有则直接激活，否则在工作区新建分割区域承载（UI 在 onOpen 建进 contentEl，勿用 getEmptyStateElement——本环境不调用它）；无配置时由面板内状态行提示去设置页 */
	private async openLlmPanel(): Promise<void> {
		try {
			const existing = this.app.workspace.getLeavesOfType(LlmChatView.VIEW_TYPE);
			if (existing.length) {
				this.app.workspace.setActiveLeaf(existing[0]); // revealLeaf 已废弃，改用 setActiveLeaf（minAppVersion 1.4+ 可用）
				return;
			}
			const leaf = this.app.workspace.getLeaf("split");
			await leaf.setViewState({ type: LlmChatView.VIEW_TYPE, active: true });
		} catch (e) {
			this.notifyError("打开对话窗口失败", e);
		}
	}

	/** v0.2.20 写字台常驻左栏（移动端抽屉／桌面端左栏）：左栏没有写字台叶子时经 ensureSideLeaf 补一个 tab（不抢焦点、不展开抽屉），保证它始终出现在侧栏视图切换列表里可被选中；左栏已有则无操作（幂等） */
	private async ensureStatusInLeftSidebar(): Promise<void> {
		const ws = this.app.workspace;
		if (!ws.layoutReady) return; // 启动早期布局未就绪：静默跳过（onLayoutReady 回调路径已覆盖正常时机）
		let present = false;
		ws.iterateAllLeaves((leaf) => {
			if (leaf.getRoot() === ws.leftSplit && leaf.view instanceof StatusView) present = true;
		});
		if (present) return;
		try {
			await ws.ensureSideLeaf(StatusView.VIEW_TYPE, "left", { active: false, reveal: false });
		} catch { /* 尽力而为的辅助动作，失败不影响主流程（命令/ribbon 仍可手动打开） */ }
	}

	private async openStatusPanel(): Promise<void> {
		try {
			const existing = this.app.workspace.getLeavesOfType(StatusView.VIEW_TYPE);
			if (existing.length) {
				this.app.workspace.setActiveLeaf(existing[0]); // revealLeaf 已废弃，改用 setActiveLeaf（minAppVersion 1.4+ 可用）
				return;
			}
			// 不分割新面板：直接复用左栏现有叶子（与文件列表同一位置，替换其内容显示状态面板；点侧栏文件图标可切回文件列表）；左栏为空才退回新建
			const leaf = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeftLeaf(true) ?? this.app.workspace.getLeaf("split");
			await leaf.setViewState({ type: StatusView.VIEW_TYPE, active: true });
		} catch (e) {
			this.notifyError("打开写字台失败", e);
		}
	}

	/** 常驻面板（人物关系／时间线）的承载叶子：桌面端复用右栏叶子（写字台占左栏，两者可同屏对照），依次回退新建右栏→分割主区域；移动端右栏无 UI 入口（视图调不出来），改分割主区域承载（与 LLM 对话窗口相同） */
	private getPanelHostLeaf(): WorkspaceLeaf {
		if (Platform.isMobileApp) return this.app.workspace.getLeaf("split");
		return this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getRightLeaf(true) ?? this.app.workspace.getLeaf("split");
	}

	/** 打开常驻面板（人物关系／时间线）：移动端先丢弃仍滞留右栏的旧面板（旧版本/桌面端工作区持久化而来——移动端右栏无 UI 入口，激活它没有任何可见效果），主区域已有则直接激活，否则由 getPanelHostLeaf 取承载叶子新建 */
	private async openResidentPanel(viewType: string, failMsg: string): Promise<void> {
		try {
			if (Platform.isMobileApp) {
				const stale = this.app.workspace.getLeavesOfType(viewType).filter((l) => l.parent instanceof WorkspaceSidedock);
				for (const l of stale) l.detach();
				if (stale.length) {
					// 丢弃后活动叶子可能为空或仍指向右栏，先切到主区域的笔记，保证 getLeaf("split") 分割的是主区域
					// （workspace.activeLeaf 已废弃：改用推荐替代 getActiveViewOfType(View) 再取 View.leaf）
					const active = this.app.workspace.getActiveViewOfType(View)?.leaf ?? null;
					if (!active || active.parent instanceof WorkspaceSidedock) {
						const anchor = this.app.workspace.getLeavesOfType("markdown").find((l) => !(l.parent instanceof WorkspaceSidedock));
						if (anchor) this.app.workspace.setActiveLeaf(anchor);
					}
				}
			}
			const existing = this.app.workspace.getLeavesOfType(viewType);
			if (existing.length) {
				this.app.workspace.setActiveLeaf(existing[0]);
				return;
			}
			const leaf = this.getPanelHostLeaf();
			await leaf.setViewState({ type: viewType, active: true });
		} catch (e) {
			this.notifyError(failMsg, e);
		}
	}

	/** 打开常驻人物关系面板（v0.1.9+） */
	private async openRelationshipPanel(): Promise<void> {
		await this.openResidentPanel(RelationshipView.VIEW_TYPE, "打开人物关系面板失败");
	}

	/** 打开常驻时间线面板（v0.2.x+；v0.3.3+ 合并大事件后面板可编辑） */
	private async openTimelinePanel(): Promise<void> {
		await this.openResidentPanel(TimelineView.VIEW_TYPE, "打开时间线面板失败");
	}

	/** 打开常驻场景面板（v0.4.7+） */
	private async openScenePanel(): Promise<void> {
		await this.openResidentPanel(SceneView.VIEW_TYPE, "打开场景面板失败");
	}

	/**
	 * v0.4.9+ 「人物级别」候选唯一口径（＝添加／编辑人物弹窗最上方那一行，用户要求＝下拉按**书籍级 → 卷级 → 章级**分组排列，
	 *  不再把默认项顶到最前；每档文案带清「写进哪一份《人物.md》」＝`书籍级 · 案头资料/人物.md`／`卷级 · <卷名>`／`章级 · 第NN章 章名`）。
	 * 候选顺序＝书籍级（恒在）→ 每一卷 → 每一章（都按管理器枚举顺序）；`defaultId`＝当前写作位置（激活章 → 激活卷 → 书籍级）。
	 * 同时带回全书人物名（关系行候选用）与各档「范围内」角色名（＝该层《人物.md》里已有条目，排在下拉最前）。
	 */
	private async characterScopeChoices(story: string): Promise<{ scopes: CharacterScopeOption[]; defaultId: string; allNames: string[] }> {
		const sortZh = (a: string, b: string): number => a.localeCompare(b, "zh");
		const all = Object.values(await this.manager.loadAllCharacters(story));
		const allNames = all.map((c) => c.name).sort(sortZh);
		// 各层级「范围内」角色名：书级=书根全局条目，卷级=该卷卷目录条目，章级=该章目录条目（与 loadAllCharacters 的读取口径一致）
		const inScope = (pred: (c: (typeof all)[number]) => boolean): string[] => all.filter(pred).map((c) => c.name).sort(sortZh);
		const bookDir = this.manager.storyPath(story);
		const scopes: CharacterScopeOption[] = [
			{ id: "book", kind: "book", label: `书籍级 · ${docRelPath(`${this.manager.deskDocsPath(story)}/人物.md`, bookDir)}`, localCandidates: inScope((c) => c.chapter <= 0 && !c.vol) },
		];
		for (const v of await this.manager.volumeList(story)) {
			scopes.push({ id: `vol:${v.id}`, kind: "volume", label: `卷级 · ${v.name}`, volId: v.id, localCandidates: inScope((c) => c.chapter <= 0 && c.vol === v.id) });
		}
		const volNames = await this.volNameMap(story);
		for (const c of await this.manager.listChapters(story)) {
			scopes.push({ id: `ch:${c.key}`, kind: "chapter", label: `章级 · ${this.keyLabel(c.key, volNames, c.title)}`, chapterKey: c.key, localCandidates: inScope((cc) => cc.chapter === c.num && (cc.vol ?? "") === (c.vol ?? "")) });
		}
		const state = await this.manager.loadState(story).catch(() => null); // 状态读不到＝按书籍级
		const curKey = state?.current_chapter ?? null;
		const curVol = state?.current_volume ?? "";
		const def = (curKey ? scopes.find((x) => x.chapterKey === curKey) : undefined) ?? (curVol ? scopes.find((x) => x.volId === curVol) : undefined) ?? scopes[0];
		return { scopes, defaultId: def?.id ?? "book", allNames };
	}

	/** 某条《人物.md》条目（`chapter`＋`vol`）落在哪一档级别＝`characterScopeChoices` 里的候选 id（章级按「章号＋卷」匹配复合键）。找不到＝空串 */
	private characterScopeIdFor(scopes: readonly CharacterScopeOption[], chapter: number, vol?: string): string {
		if (chapter <= 0) return vol ? `vol:${vol}` : "book";
		for (const s of scopes) {
			if (!s.chapterKey) continue;
			const p = parseChKey(s.chapterKey);
			if (p && p.num === chapter && (p.vol ?? "") === (vol ?? "")) return s.id;
		}
		return "";
	}

	/** 级别候选 → `updateCharacter` 的归属补丁（＝把人物条目搬进那一层《人物.md》）：书籍级＝`chapter 0`＋vol 显式清空（管理器约定 `""`＝清除卷归属）；
	 *  卷级＝`chapter 0`＋该卷 id；章级＝复合键解析出的章号＋卷 id。解不出＝null（不换层） */
	private scopeMovePatch(s: CharacterScopeOption): { chapter: number; vol: string | undefined } | null {
		if (s.kind === "book") return { chapter: 0, vol: "" };
		if (s.kind === "volume") return { chapter: 0, vol: s.volId ?? "" };
		const p = s.chapterKey ? parseChKey(s.chapterKey) : null;
		return p ? { chapter: p.num, vol: p.vol ?? "" } : null;
	}

	/**
	 * 「添加人物」弹窗（v0.2.0+）：人物关系面板头部按钮与卡片右键「新增」的唯一实现。
	 * 姓名 + 人物级别（v0.4.9+＝弹窗第一行，候选按书籍级 → 卷级 → 章级排、默认＝当前写作位置，决定写入哪份《人物.md》）+ 设定字段 + 动态关系行；
	 * 提交后先 addCharacter 落人物，再按同一级别把关系条目追加进对应《人物关系.md》（书根／卷目录／章节目录）。
	 */
	async openAddCharacterDialog(): Promise<void> {
		const story = await this.activeStory();
		if (!story) {
			new Notice("尚未选择当前小说：请先在写字台或命令里切换小说", 6000);
			return;
		}
		let scopes: CharacterScopeOption[] = [];
		let allNames: string[] = [];
		let defaultId = "book";
		try {
			const choices = await this.characterScopeChoices(story);
			scopes = choices.scopes;
			allNames = choices.allNames;
			defaultId = choices.defaultId;
		} catch (e) {
			this.notifyError("读取人物/章节失败", e);
			return;
		}
		if (!scopes.length) scopes = [{ id: "book", kind: "book", label: "书籍级 · 案头资料/人物.md", localCandidates: [] }];
		const result = await new Promise<AddCharacterResult | null>((resolve) => {
			new AddCharacterModal(this.app, scopes, allNames, RELATION_TYPE_OPTIONS, defaultId, (r) => resolve(r), () => resolve(null)).open();
		});
		if (!result) return;
		try {
			const parsed = result.scope.kind === "chapter" && result.scope.chapterKey ? parseChKey(result.scope.chapterKey) : null;
			await this.manager.addCharacter(story, {
				name: result.name,
				identity: result.fields.identity,
				age: result.fields.age,
				gender: result.fields.gender,
				personality: result.fields.personality,
				appearance: result.fields.appearance,
				background: result.fields.background,
				abilities: result.fields.abilities,
				notes: result.fields.notes,
				chapter: parsed ? parsed.num : 0, // 卷级/书籍级人物 chapter=0；卷级靠 vol 落卷实体目录、书籍级无 vol 落书根
				vol: parsed ? parsed.vol ?? undefined : result.scope.volId,
			});
			if (result.relations.length) {
				const entries: RelationshipEntry[] = result.relations.map((r) => ({ a: result.name, b: r.target, type: r.type, status: "active", desc: "" })); // 新建关系默认进行中
				await this.manager.appendRelationships(story, result.scope.kind, entries, { volId: result.scope.volId, chapterKey: result.scope.chapterKey });
			}
			new Notice(`已添加人物「${result.name}」（${result.scope.label}）${result.relations.length ? `，并写入 ${String(result.relations.length)} 条关系` : ""}`, 8000);
			this.schedulePanelRefresh(300);
		} catch (e) {
			this.notifyError("添加失败", e);
		}
	}

	/**
	 * 「编辑人物」弹窗（v0.4.9+ 人物关系面板：双击人物卡片/节点、右键菜单「编辑」）：
	 * 级别（v0.4.9+＝弹窗第一行，候选按书籍级 → 卷级 → 章级排、默认选中该人物现在那一档＝换层＝把条目搬进另一份《人物.md》；
	 * 拿不到级别候选时退化成只读行＝`REL_SCOPE_WORDS` 口径的「所在位置」）＋姓名（改名＝`manager.renameCharacter` 全书同步替换＋自动备份）
	 * ＋设定字段。写回一律走 `manager.updateCharacter`：**换层与改字段分两次调用**（管理器的换层分支不套字段补丁，合一次会丢字段改动）。
	 */
	async openEditCharacterDialog(name: string, storyArg?: string): Promise<void> {
		const story = storyArg ?? (await this.activeStory());
		if (!story) {
			new Notice("尚未选择当前小说：请先在写字台或命令里切换小说", 6000);
			return;
		}
		try {
			const entries = await this.manager.loadCharacterEntries(story);
			const entry = entries.find((e) => e.name === name) ?? entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
			if (!entry) {
				new Notice(`找不到人物「${name}」：可能已被删除，请点「刷新」后重试`, 6000);
				return;
			}
			const { scopes } = await this.characterScopeChoices(story);
			const curId = this.characterScopeIdFor(scopes, entry.chapter, entry.vol);
			const here = docLocationLabel(entry.scope, entry.sourcePath, this.manager.storyPath(story), REL_SCOPE_WORDS); // 「卷级 · 书稿/第一卷 风起/人物.md」
			const level = curId ? { options: scopes.map((s) => ({ value: s.id, label: s.label })), value: curId } : { label: here };
			const res = await new Promise<CharacterEditResult | null>((resolve) => {
				new CharacterEditModal(
					this.app,
					`编辑人物「${entry.name}」`,
					entry.name,
					{
						identity: entry.identity ?? "",
						age: entry.age ?? "",
						gender: entry.gender ?? "",
						personality: entry.personality ?? "",
						appearance: entry.appearance ?? "",
						background: entry.background ?? "",
						abilities: (entry.abilities ?? []).join("、"),
						notes: entry.notes ?? "",
					},
					level,
					(r) => resolve(r),
					() => resolve(null)
				).open();
			});
			if (!res) return;
			let target = entry.name;
			if (res.name !== entry.name) {
				// 改名走与命令「管理人员 → 改名」同一条落盘路径（全书 MD 同步替换 + 自动备份 + 面板选中名跟随）
				const r = await this.renameCharacterTo(story, entry.name, res.name);
				if (!r) return;
				target = res.name.trim();
			}
			const scope = res.scopeId ? scopes.find((s) => s.id === res.scopeId) : undefined;
			const move = scope && scope.id !== curId ? this.scopeMovePatch(scope) : null;
			// 约定（command-reference「移动语义陷阱」）＝updateCharacter 带 chapter 时只搬条目、不套字段补丁＝先写字段，再单独调一次换层
			await this.manager.updateCharacter(story, target, {
				identity: res.fields.identity ?? "",
				age: res.fields.age ?? "",
				gender: res.fields.gender ?? "",
				personality: res.fields.personality ?? "",
				appearance: res.fields.appearance ?? "",
				background: res.fields.background ?? "",
				abilities: splitList(res.fields.abilities ?? ""),
				notes: res.fields.notes ?? "",
			});
			if (move) await this.manager.updateCharacter(story, target, move);
			const movedTo = move ? `（已移到${scope ? scope.label : "新级别"}）` : "";
			new Notice(`已更新人物「${target}」${movedTo}`, 6000);
			this.schedulePanelRefresh(300);
		} catch (e) {
			this.notifyError("更新人物失败", e);
		}
	}

	/** 「删除人物」（v0.4.9+ 人物关系面板右键菜单）＝二次确认后 `manager.deleteCharacter`（连带清理各场景里的引用）；与命令面板「管理人员→删除此人」同一实现 */
	async deleteCharacterFlow(name: string): Promise<void> {
		const story = await this.activeStory();
		if (!story) {
			new Notice("尚未选择当前小说：请先在写字台或命令里切换小说", 6000);
			return;
		}
		await this.deleteCharacterByName(story, name);
		this.schedulePanelRefresh(300);
	}

	/** 删除人物的唯一实现（v0.4.9+ 代码重用：命令面板「管理人员」与人物关系面板右键菜单共用）＝确认框 → `deleteCharacter` → Notice */
	private async deleteCharacterByName(story: string, name: string): Promise<void> {
		const ok = await this.confirmBox("删除人物？", `将删除「${name}」并清理各场景中的引用。如需保留请改用「改名」。`, "删除");
		if (!ok) return;
		const done = await this.manager.deleteCharacter(story, name);
		new Notice(done ? "已删除该人物" : "删除失败：人物不存在");
	}

	// ---------- LLM 写作命令（/write /continue /rewrite /polish /deai /review，对应 Python WritingMixin + writer.py） ----------

	private promptArea(title: string, placeholder: string, initial = ""): Promise<string | null> {
		return new Promise((resolve) => {
			new TextAreaPrompt(this.app, title, placeholder, initial, "确定", (v) => resolve(v), () => resolve(null)).open();
		});
	}

	/** 章节号输入：空=当前章默认；Esc=取消整个命令（v0.0.15：返回复合键） */
	private async targetChapterKey(story: string, verb: string): Promise<string | null> {
		if (this.chatToolCtx?.chapterKey) return this.chatToolCtx.chapterKey; // v0.4.6+ 对话工具代跑：章由工具参数直给，不再弹窗
		const state = await this.manager.loadState(story);
		const cur = state?.current_chapter ?? null; // 复合键 "volId:N" / "N"
		const volNames = await this.volNameMap(story);
		const raw = await this.prompt(`要${verb}哪一章`, cur ? `当前 ${this.keyLabel(cur, volNames)}，留空即用当前章` : "请输入章节号");
		if (raw == null) return null;
		const t = raw.trim();
		let key: string | null = null;
		if (t === "") key = cur;
		else if (/^\d+$/.test(t)) {
			const ref = await this.resolveLocalNum(story, parseInt(t, 10), volNames); // 裸章号 → 具体容器（跨卷同号逐个确认）
			key = ref ? chKey(ref.vol ?? null, ref.num) : null;
		}
		if (!key || !t && !cur) { new Notice(`第${t || "?"}章不存在`); return null; }
		return key;
	}

	/** 组装正文生成系统提示词：编写类型格式块（含技能块）→ 内置默认（v0.4.3+：全局 config.system_prompt 已废弃，baseSp 现恒空）。
	 *  v0.3.6+：【禁用词】专用注入块已随禁用词 Skill 化移除——词表改经阶段 4 默认引用清单的 skill: 条目走下方技能块注入（所有走本函数的路径一致，/review 同样吃到清单）。
	 *  v0.3.0+：阶段 4 ref_docs 中的 skill: 条目经 loadSkillsBlock(PHASE_WRITING) 装配进【技能】块（buildStoryTypeSystemPrompt.skillsBlock 钩子）——正文族上下文文档已跳过 skill: 条目，技能只在此注入一次
	 *  v0.3.4+：传 storyName 时本书书籍技能块（loadBookSkillsBlock(story, PHASE_WRITING)）拼接在系统技能块之后，同一 skillsBlock 钩子注入 */
	private async writerSystemPrompt(
		baseSp: string | undefined,
		writingStyle?: string,
		title?: string,
		charNames?: Array<string | null>,
		storyName?: string
	): Promise<string> {
		// v0.4.3+：writing_style / genre 自动加载系统技能目录中的编写特征（编写类型/<值>.md、题材/<值>.md），
		// 不再依赖 STORY_TYPES 硬编码或手动 ref_docs；技能文件缺失时 buildStoryTypeSystemPrompt 回落内置模板。
		const state = storyName ? await this.manager.loadState(storyName) : null;
		const genre = state?.genre || "";
		const style = writingStyle || "";
		const autoSkillNames = [
			style ? `${WRITING_STYLE_SKILL_FOLDER}/${style}` : "",
			genre ? `${GENRE_SKILL_FOLDER}/${genre}` : "",
			WRITING_TASK_SKILL_NAME, // v0.4.3+ 章节写作指导（旧「章节写作任务」「章节创作」已并入）：创作命令的静态要求由 taskSkillBlock 单独注入，避免与阶段技能重复
			...LEGACY_WRITING_TASK_SKILL_NAMES, // 旧名防御：迁移失败残留时仍排除，防旧文件未被清理时双重注入
		].filter(Boolean);
		const wr = this.wordRangeOf(state); // v0.4.3+：技能文本字数占位符 {{word_low}}/{{word_high}}/{{word_range}} 按书级《故事状态.md》word_range 插值（未配置回落 4000-5000）
		const sysSkills = applyWordRangeVars(await this.loadSkillsBlock(PHASE_WRITING, autoSkillNames), wr);
		const bookSkills = storyName ? applyWordRangeVars(await this.loadBookSkillsBlock(storyName, PHASE_WRITING), wr) : ""; // v0.3.4+：书籍级技能排在系统技能之后
		const skillsBlock = [sysSkills, bookSkills].filter((b) => b).join("\n\n");
		const styleSkill = applyWordRangeVars(await this.loadFolderSkillBlock(WRITING_STYLE_SKILL_FOLDER, style), wr);
		const genreSkill = applyWordRangeVars(await this.loadFolderSkillBlock(GENRE_SKILL_FOLDER, genre), wr);
		const custom = buildStoryTypeSystemPrompt({
			storyType: writingStyle,
			title,
			charNames,
			storyTypeSkillBlock: styleSkill || undefined,
			genreSkillBlock: genreSkill || undefined,
			skillsBlock: skillsBlock || undefined,
		});
		return assembleSystemPrompt(custom || undefined, baseSp); // v0.3.4+：identity_boost 参数已随 Skill 化移除，身份加强经 skillsBlock 注入；v0.3.5+：【创作规范】三层指南块已随写作指南体系废弃
	}

	// ---------- 写字台（StatusView）数据与动作 ----------

	/** 路径是否落在当前工作目录内（含根本身）；未设置工作目录时一律不匹配 */
	private pathUnderWorkDir(p: string): boolean {
		const root = this.settings.workDir.replace(/\/+$/, "");
		if (!root) return false;
		return p === root || p.startsWith(root + "/");
	}

	/** 防抖刷新所有已打开的状态面板（编辑器自动落盘会连发变更，合并成一次重渲染；无面板打开时直接忽略） */
	private scheduleStatusPanelRefresh(delayMs = 800): void {
		if (!this.app.workspace.getLeavesOfType(StatusView.VIEW_TYPE).length) return;
		if (this.statusRefreshTimer != null) window.clearTimeout(this.statusRefreshTimer);
		this.statusRefreshTimer = window.setTimeout(() => {
			this.statusRefreshTimer = null;
			for (const leaf of this.app.workspace.getLeavesOfType(StatusView.VIEW_TYPE)) {
				if (leaf.view instanceof StatusView) void leaf.view.refresh();
			}
		}, delayMs);
	}

	/** 防抖刷新所有已打开面板（写字台 + 人物关系 + 时间线）：同一批文件变更合并成一次重渲染 */
	private schedulePanelRefresh(delayMs = 800): void {
		this.scheduleStatusPanelRefresh(delayMs);
		this.scheduleRelationshipPanelRefresh(delayMs);
		this.scheduleTimelinePanelRefresh(delayMs);
		this.scheduleScenePanelRefresh(delayMs); // v0.4.7+ 场景面板
	}

	// ---------- 打字（码字）统计（v0.4.5+）：按段长（设置项「码字记录段长」，缺省 10 分钟）一段，写书级《案头资料/码字记录.md》 ----------

	/**
	 * 编辑器变化采集（editor-change）：只统计**当前小说目录内** .md 的键入（书根/案头资料/卷/章全覆盖），
	 * 《码字记录.md》自身不计数。文本与 typeTexts 缓存做前后 diff：
	 * ① 文件首次被看见只立基线不计数（防打开整章即按全文计字）；
	 * ② 单次新增非空白字符 > MAX_TYPE_DELTA＝粘贴/程序化写入（含 LLM 落盘、外部改动回声）→ 只更新基线、不记字也不记键入事件；
	 * ③ 有效键入 → 归入当前段（段长＝设置项 `typingSegmentMin`，缺省 10 分钟；跨段/切书/改了段长先把旧段 flush；
	 *    新开段的起点经 `nextSegmentStart` 夹到上一段末之后——改段长时新段按新段长回溯对齐会跟刚落盘的旧段重叠，
	 *    那段时间两段各算一次活跃时长，《码字记录.md》的写作总时长随之虚高）。字数只计非空白字符。
	 * **v0.4.5+ 净增口径**：删除不倒扣进「键入」，只累加进段上的 `deleted` 把先前敲的字抵掉（净增＝新增−删除，见 `segNetChars`）；
	 * **纯删除**（本次没有新增）不开段、不记键入事件、不影响停顿/活跃时长——删字不算码字。
	 */
	private onTypingEdit(editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
		const story = (this.settings.lastStory || "").trim();
		if (!story) return;
		const f = info.file;
		if (!f || !f.path.endsWith(".md")) return;
		const root = this.manager.storyPath(story);
		if (!f.path.startsWith(`${root}/`)) return;
		if (f.path === this.manager.bookTypeStatsPath(story)) return;
		const cur = editor.getValue();
		const prev = this.typeTexts.get(f.path);
		this.typeTexts.set(f.path, cur);
		if (prev === undefined) return; // 首见＝立基线
		const d = diffStats(prev, cur);
		if (d.added === 0 && d.deleted === 0) return;
		// v0.4.6+ 修 C7：程序化写盘（typo span 落盘/LLM 覆盖/面板写回/状态文档同步）→ 基线已刷新但不算码字：
		// modify 事件先于编辑器回声的 editor-change（用户键入则相反、且自动保存 ≥2s 滞后），500ms 内出现即判程序化
		const mt = this.lastModifyAt.get(f.path);
		if (mt !== undefined && Date.now() - mt < 500) return;
		if (d.added > MAX_TYPE_DELTA) return; // 粘贴/程序化写入
		const curSegMs = segmentMs(this.settings.typingSegmentMin); // 段长走设置项（越界/非法回落 10 分钟）
		if (d.added === 0) { // 纯删除：只抵掉进行中段里先前敲入的字（超长剪贴＝程序化改动，同样不理）
			if (d.deleted <= MAX_TYPE_DELTA) {
				const live = this.typeSeg;
				const at = Date.now();
				if (live && live.story === story && live.segMs === curSegMs && at < live.start + live.segMs) live.deleted += d.deleted;
			}
			return;
		}
		const now = Date.now();
		this.anchorTypeSession(now, story); // 本次未开始时以这次键入为「本次开始」（懒锚定，见 endTypeSession）
		this.typeLastEditAt = now;
		const seg = this.typeSeg;
		if (seg && (seg.start !== segmentStartOf(now, seg.segMs) || seg.story !== story || seg.segMs !== curSegMs)) {
			const prevEnd = Math.min(now, seg.start + seg.segMs); // 旧段按「开窗时的段长」结算（改段长不影响已在累积的段）
			void this.enqueueTypeFlush(seg, prevEnd); // 跨段、切书或改了段长：先结算旧段
			this.typeSeg = null;
			this.typePrevSegEnd = seg.story === story ? prevEnd : 0; // 换书＝写进另一本书的文件，区间不相干，不做夹取
		}
		if (!this.typeSeg) this.typeSeg = { start: nextSegmentStart(now, curSegMs, this.typePrevSegEnd), edits: [], chars: 0, deleted: 0, story, segMs: curSegMs };
		this.typeSeg.edits.push(now);
		this.typeSeg.chars += d.added;
		if (d.deleted > 0 && d.deleted <= MAX_TYPE_DELTA) this.typeSeg.deleted += d.deleted; // 同一次编辑里的替换/回删即时抵掉
	}

	/**
	 * 定时器（15s）两件事：
	 * ① 段满即结算（写作停下后不再有 editor-change，兜底落盘；无键入事件的空段不写行）；
	 * ② **本次写作自动结束**（v0.4.5+）：本次已开始且停笔超过**一个段长**（＝设置项「码字记录段长」）→ 结束本次
	 *    （长时间离开不会把挂机时间挂在「本次时长／总时长」上，下次敲字自动重开一次本次）。
	 */
	private tickTypingStats(): void {
		const now = Date.now();
		if (this.typeSessionStartAt && this.typeLastEditAt && now - this.typeLastEditAt > segmentMs(this.settings.typingSegmentMin)) this.endTypeSession();
		const seg = this.typeSeg;
		if (seg && now >= seg.start + seg.segMs) {
			const prevEnd = seg.start + seg.segMs;
			this.typePrevSegEnd = prevEnd; // 段区间已占用，之后新开段（哪怕改了段长）不得回溯进这段
			void this.enqueueTypeFlush(seg, prevEnd);
			this.typeSeg = null;
		}
	}

	/** 串行 flush 队列：读-改-写追加一行，防并发覆盖；失败只 console.debug（后台统计不打扰写作） */
	private enqueueTypeFlush(seg: TypeSeg & { story: string; segMs: number }, end: number): Promise<void> {
		this.typeFlushChain = this.typeFlushChain.then(() => this.writeTypeRow(seg, end));
		return this.typeFlushChain;
	}

	private async writeTypeRow(seg: TypeSeg & { story: string; segMs: number }, end: number): Promise<void> {
		// 整段没有一次有效键入事件＝没有写作会话，不产生噪音行；**净增 0（写的全删回去）仍写一行**（字数 0、速度「—」）：
		// 否则该段的活跃时长在攒段期间被面板算着、落盘时却被整段抹掉——「本次时长／写作总时长」会在 flush 那一刻往回跳。
		if (!seg.edits.length || end <= seg.start) return;
		const net = segNetChars(seg);
		const path = this.manager.bookTypeStatsPath(seg.story);
		try {
			let text = "";
			if (await this.app.vault.adapter.exists(path)) text = await this.app.vault.adapter.read(path);
			const base = text.trim() ? `${text.replace(/\s+$/, "")}\n` : TYPE_STATS_HEADER; // 缺失按表头创建（adapter.write 自动补建父目录）
			await this.app.vault.adapter.write(path, `${base}${renderStatsRow(seg, end)}\n`);
		} catch (e) {
			console.debug("码字统计写入《码字记录.md》失败：", e);
			return;
		}
		// 落盘成功 → 计入「本次写作」会话累加（仅当该段属于本次会话的小说），并刷新写字台「码字状态」Tab。
		// 活跃时长按「本次锚点」夹取（段起点按整点网格对齐、可能早于本次开始），本次时长才不会越过墙钟「总时长」
		if (this.typeSessionStartAt && seg.story === this.typeSessionStory) {
			const active = segActiveMs(seg, end, this.typeSessionStartAt);
			this.typeSessionChars += net;
			this.typeSessionActiveMs += active;
			this.typeLastSeg = { start: seg.start, end, chars: net, speed: active > 0 ? Math.round((net * 3_600_000) / active) : null };
		}
		this.notifyTypingPanel();
	}

	/** 打字统计落盘后只刷写字台底部「写作状态」区（不重扫字数、不动树区） */
	private notifyTypingPanel(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(StatusView.VIEW_TYPE)) {
			if (leaf.view instanceof StatusView) void leaf.view.refreshTyping();
		}
	}

	/**
	 * 结束「本次写作」：写字台打开/重开（StatusView.onOpen）、切书、或停笔超过一个段长（tickTypingStats）都会调用。
	 * 动作＝把进行中的段先结算进它自己的《码字记录.md》（本次结束前敲的字不留缓冲、也不带进下一次本次）＋清累加＋开始时刻归零。
	 * 归零后本次**不预设起点**——下一次有效键入才锚定（`anchorTypeSession`），故启动/挂机时间不进「本次码字／本次时长／总时长」。
	 */
	private endTypeSession(): void {
		const seg = this.typeSeg;
		if (seg) {
			const end = Math.min(Date.now(), seg.start + seg.segMs);
			void this.enqueueTypeFlush(seg, end);
			this.typePrevSegEnd = seg.story === (this.settings.lastStory || "").trim() ? end : 0; // 同书才做区间夹取（换书写的文件不同、区间不相干）
			this.typeSeg = null;
		}
		this.typeSessionStartAt = 0;
		this.typeSessionStory = "";
		this.typeSessionChars = 0;
		this.typeSessionActiveMs = 0;
		this.typeLastEditAt = 0;
		this.typeLastSeg = null;
		this.notifyTypingPanel();
	}

	/** 本次尚未开始（或归属的书变了）→ 以这次键入为起点重开一次；已在本次中则只确认归属，不重置累加 */
	private anchorTypeSession(now: number, story: string): void {
		if (this.typeSessionStartAt && this.typeSessionStory === story) return;
		this.typeSessionStartAt = now;
		this.typeSessionStory = story;
		this.typeSessionChars = 0;
		this.typeSessionActiveMs = 0;
		this.typeLastSeg = null;
	}

	/** v0.4.5+ 写字台底部「写作状态」区数据：本次累加＋当前段写到此刻＋《码字记录.md》全文汇总（写作总时长的事实源） */
	async getStatusTyping(): Promise<StatusTyping | null> {
		const story = (this.settings.lastStory || "").trim();
		if (!story) return null;
		const now = Date.now();
		const started = this.typeSessionStartAt > 0;
		// 进行中段按其**开窗时的段长**核算，不用当前设置值：改过段长而旧段尚未结算时，按新段长会把「此刻」夹到过去、停顿与活跃时长当场失真
		const rawSeg = this.typeSeg && this.typeSeg.story === story ? this.typeSeg : null;
		const live = rawSeg ? liveSegStats(rawSeg, now, rawSeg.segMs) : { chars: 0, pauseMs: 0, activeMs: 0 }; // 整段口径（写进《码字记录.md》的就是这段）
		const liveSession = rawSeg && started ? liveSegStats(rawSeg, now, rawSeg.segMs, this.typeSessionStartAt) : { chars: 0, pauseMs: 0, activeMs: 0 }; // 本次口径（锚点之后的部分）
		const path = this.manager.bookTypeStatsPath(story);
		let hist = { segments: 0, chars: 0, pauseMs: 0, activeMs: 0 };
		try {
			if (await this.app.vault.adapter.exists(path)) hist = summarizeStatsFile(await this.app.vault.adapter.read(path));
		} catch (e) {
			console.debug("码字统计读取《码字记录.md》失败：", e);
		}
		const chars = started ? this.typeSessionChars + liveSession.chars : 0;
		const active = started ? this.typeSessionActiveMs + liveSession.activeMs : 0;
		return {
			started,
			sessionStartAt: this.typeSessionStartAt,
			sessionChars: chars,
			sessionActiveMs: active,
			wallMs: started ? now - this.typeSessionStartAt : 0,
			avgSpeed: chars > 0 && active > 0 ? Math.round((chars * 3_600_000) / active) : null,
			lastSeg: this.typeLastSeg,
			totalActiveMs: hist.activeMs + live.activeMs, // 文件里的行已含本次已落盘段，这里只补未落盘的当前段
			totalChars: hist.chars + live.chars, // 与上一行同口径：累计字数也含当前段，否则恒落后一个段长、每次落盘跳一格
			segmentMin: this.effectiveTypeSegmentMin(),
			recordPath: path,
		};
	}

	/** 防抖刷新已打开的人物关系面板（v0.1.9+）：关系文档在编辑器里改动/新建同样实时跟进 */
	private scheduleRelationshipPanelRefresh(delayMs = 800): void {
		if (!this.app.workspace.getLeavesOfType(RelationshipView.VIEW_TYPE).length) return;
		if (this.relRefreshTimer != null) window.clearTimeout(this.relRefreshTimer);
		this.relRefreshTimer = window.setTimeout(() => {
			this.relRefreshTimer = null;
			for (const leaf of this.app.workspace.getLeavesOfType(RelationshipView.VIEW_TYPE)) {
				if (leaf.view instanceof RelationshipView) void leaf.view.refresh();
			}
		}, delayMs);
	}

	/** 防抖刷新已打开的时间线面板（v0.2.x+）：《时间线.md》在编辑器里改动/新建同样实时跟进 */
	private scheduleTimelinePanelRefresh(delayMs = 800): void {
		if (!this.app.workspace.getLeavesOfType(TimelineView.VIEW_TYPE).length) return;
		if (this.tlRefreshTimer != null) window.clearTimeout(this.tlRefreshTimer);
		this.tlRefreshTimer = window.setTimeout(() => {
			this.tlRefreshTimer = null;
			for (const leaf of this.app.workspace.getLeavesOfType(TimelineView.VIEW_TYPE)) {
				if (leaf.view instanceof TimelineView) void leaf.view.refresh();
			}
		}, delayMs);
	}

	/** 防抖刷新已打开的场景面板（v0.4.7+）：三层《场景.md》在编辑器里改动/新建同样实时跟进 */
	private scheduleScenePanelRefresh(delayMs = 800): void {
		if (!this.app.workspace.getLeavesOfType(SceneView.VIEW_TYPE).length) return;
		if (this.scRefreshTimer != null) window.clearTimeout(this.scRefreshTimer);
		this.scRefreshTimer = window.setTimeout(() => {
			this.scRefreshTimer = null;
			for (const leaf of this.app.workspace.getLeavesOfType(SceneView.VIEW_TYPE)) {
				if (leaf.view instanceof SceneView) void leaf.view.refresh();
			}
		}, delayMs);
	}

	/** 状态页数据快照：工作目录 + 全部小说概览 + 当前小说详情（章节/文件路径），全程非交互、逐段容错 */
	async getStatusSnapshot(): Promise<StatusSnapshot> {
		const root = this.settings.workDir.replace(/\/+$/, "");
		if (!root) return { workDir: "", stories: [], details: {} };
		const names = await this.manager.listStories();
		const last = this.settings.lastStory?.trim() ?? "";
		const stories: StatusStoryEntry[] = [];
		/** 逐书实时统计的章节字数（key→words）：状态文档里的 words/total_words 可能是过期值（旧数据、CLI 写入或建章后未同步），展示一律以磁盘 MD 为准（同 /count 口径）。**只为当前激活书做全量 countWords**——视图只渲染激活书的章节小节，非激活书仅用 state 值兜底（下拉框只显示书名），省掉多本书逐章读盘的 IO（手机上刷新明显卡顿的主因之一） */
		let activeLiveWords: Record<string, number> | undefined;
		let activeLiveChars: Record<string, number> | undefined; // 含标点的总字符数（同批 countWords 顺带产出，无额外 IO）
		for (const name of names) {
			let title = name;
			let chapterCount = 0;
			let currentChapter: string | null = null;
			let words = 0;
			try {
				const st = await this.manager.loadState(name); // 单文件读取，成本低，全部保留（切书提示也要用）
				if (st) {
					title = st.title || name;
					chapterCount = Object.keys(st.chapters).length;
					currentChapter = st.current_chapter;
					words = st.total_words;
				}
			} catch {
				/* 单本状态读取失败不影响列表其余项 */
			}
			if (name === last) {
				try {
					const rows = await this.manager.countWords(name); // 读各章 章节.md 纯文字计数
					const map: Record<string, number> = {};
					const charMap: Record<string, number> = {};
					for (const r of rows) { map[r.key] = r.words; charMap[r.key] = r.chars; }
					activeLiveWords = map;
					activeLiveChars = charMap;
					words = rows.reduce((s, r) => s + r.words, 0); // 实时值优先，覆盖可能过期的 state 值
				} catch {
					/* 字数统计失败时保留 state 里的旧值兜底 */
				}
			}
			stories.push({ name, title, chapterCount, currentChapter, words, active: name === last });
		}
		// 只为当前激活书构建详情子树（视图仅渲染其「案头资料/书稿」小节；切书必走完整 refresh 重新拉取）；失败则该节显示加载提示
		const details: Record<string, StatusDetail> = {};
		if (last && names.includes(last)) {
			try {
				details[last] = await this.buildStoryDetail(last, activeLiveWords, activeLiveChars);
			} catch {
				/* 详情缺失时视图显示「未能加载状态」提示 */
			}
		}
		return { workDir: root, stories, details };
	}

	// ---------- 人物关系面板（RelationshipView，v0.1.9+） ----------

	/**
	 * 人物关系面板快照：工作目录 + 小说概览 + 当前书三层《人物关系.md》解析结果（书根 / 当前卷 / 当前章）。
	 * 全程非交互只读：只读状态文档与 ≤3 份关系 md（不逐章统计），解析失败逐层降级为空列表。
	 */
	async getRelationshipSnapshot(): Promise<RelSnapshot> {
		const root = this.settings.workDir.replace(/\/+$/, "");
		if (!root) return { workDir: "", stories: [], activeStory: null, activeStoryTitle: "", groups: [], relCount: 0, chars: [], storyDir: "" };
		const names = await this.manager.listStories();
		const last = this.settings.lastStory?.trim() ?? "";
		const stories: RelStoryEntry[] = [];
		for (const name of names) {
			let title = name;
			try {
				const st = await this.manager.loadState(name); // 单文件读取，成本低；失败用书名兜底
				if (st?.title) title = st.title;
			} catch {
				/* 单本状态读取失败不影响列表其余项 */
			}
			stories.push({ name, title, active: name === last });
		}
		const active = last && names.includes(last) ? last : null;
		if (!active) return { workDir: root, stories, activeStory: null, activeStoryTitle: "", groups: [], relCount: 0, chars: [], storyDir: "" };
		const state = await this.manager.loadState(active);
		const docs = await this.manager.readRelationshipDocs(active, state?.current_chapter ?? null); // 书/卷/章三层原文（只读）
		const groups: RelGroup[] = [];
		let relCount = 0;
		for (const d of docs) {
			let rows: RelRow[] = [];
			try {
				rows = parseRelationships(d.text).map((e) => ({ ...e, scope: d.scope, scopeLabel: d.label, sourcePath: d.path }));
			} catch {
				/* 单层解析失败不影响其余层（保留 hasText 提示用户检查格式） */
			}
			relCount += rows.length;
			groups.push({ scope: d.scope, label: d.label, path: d.path, rows, hasText: d.text.trim().length > 0 });
		}
		let chars: RelCharInfo[] = [];
		try {
			chars = await this.manager.loadCharacterEntries(active); // 全部三层《人物.md》设定条目（「人物状态」区用；失败不阻断关系展示）
		} catch { /* ignore */ }
		return { workDir: root, stories, activeStory: active, activeStoryTitle: stories.find((s) => s.name === active)?.title ?? active, groups, relCount, chars, storyDir: this.manager.storyPath(active) }; // storyDir＝「所在位置」要剥掉的前缀（人物状态区悬停文案用）
	}

	// ---------- 时间线面板（TimelineView，v0.2.x+） ----------

	/**
	 * 时间线面板快照：工作目录 + 小说概览 + 当前书**全部**时间线文档解析结果（书根 / 每一卷 / 每一章），全程非交互只读。
	 * 各层条目合并为单一按时间点升序的行列表（年→月→日，同值保持文档枚举顺序）；每行带层级标签与来源路径供展示及双击定位。
	 * v0.4.7+ 多时间线：同容器内《时间线-***.md》同样入列（readTimelineDocs 枚举），行带 lane/laneIndex；快照 lanes＝泳道汇总（默认泳道恒最先），供面板配色、按时间线筛选与「＋ 事件」选目标文档。
	 * 单层解析失败降级为空列表不影响其余层；原文非空但零条目的文档直接跳过——v0.4.3+ 起面板不再在列表下方给「无有效条目」提示行。
	 */
	async getTimelineSnapshot(): Promise<TlSnapshot> {
		const root = this.settings.workDir.replace(/\/+$/, "");
		if (!root) return { workDir: "", stories: [], activeStory: null, activeStoryTitle: "", useVolumes: false, bookTimelinePath: "", rows: [], totalCount: 0, lanes: [], docs: [], storyDir: "" };
		const names = await this.manager.listStories();
		const last = this.settings.lastStory?.trim() ?? "";
		const stories: TlStoryEntry[] = [];
		for (const name of names) {
			let title = name;
			try {
				const st = await this.manager.loadState(name); // 单文件读取，成本低；失败用书名兜底
				if (st?.title) title = st.title;
			} catch { /* 单本状态读取失败不影响列表其余项 */ }
			stories.push({ name, title, active: name === last });
		}
		const active = last && names.includes(last) ? last : null;
		if (!active) return { workDir: root, stories, activeStory: null, activeStoryTitle: "", useVolumes: false, bookTimelinePath: "", rows: [], totalCount: 0, lanes: [], docs: [], storyDir: "" };
		const state = await this.manager.loadState(active);
		const docsSrc = await this.manager.readTimelineDocs(active); // 各层原文（只读），顺序按 manager 约定（有卷模式每卷紧随其成员章）
		const laneIdx = new Map<string, number>(); // 泳道名 → 序号（按文档枚举序首次出现；默认泳道排最前）
		const laneOrder: string[] = [];
		for (const d of docsSrc) {
			const lane = d.lane ?? "默认";
			if (!laneOrder.includes(lane)) laneOrder.push(lane);
		}
		laneOrder.sort((a, b) => (a === b ? 0 : a === "默认" ? -1 : b === "默认" ? 1 : 0)); // 默认恒最先，其余保持出现序
		laneOrder.forEach((n, i) => laneIdx.set(n, i));
		const rows: TlRow[] = [];
		const lanes: TlLane[] = laneOrder.map((name) => ({ name, count: 0, paths: [] }));
		for (const d of docsSrc) {
			let list: TimelineEntry[] = [];
			try {
				list = parseTimelines(d.text);
			} catch { /* 单层解析失败不影响其余层 */ }
			const lane = d.lane ?? "默认";
			const li = laneIdx.get(lane) ?? 0;
			if (list.length) lanes[li].count += list.length;
			if (this.app.vault.getAbstractFileByPath(d.path) instanceof TFile) lanes[li].paths.push(d.path); // 只登记磁盘上真实存在的文档（候选路径＝尚未创建，不进 lanes.paths；空文档也登记，「＋ 事件」据此能写入该泳道）
			list.forEach((e, i) => rows.push({ ...e, id: `${d.path}#${i}`, scope: d.scope, sourcePath: d.path, sourceLabel: d.label, lane, laneIndex: li })); // id＝来源路径#文档内序号：稳定标识供折叠状态跨刷新保持
		}
		// v0.4.9+ 每份时间线文档都随快照带一份出处（含尚未创建的候选路径）＝时间线弹窗「级别」下拉的候选＋行上「所在文档」提示
		const docs: TlDocRef[] = docsSrc.map((d) => ({ path: d.path, scope: d.scope, lane: d.lane ?? "默认", exists: this.app.vault.getAbstractFileByPath(d.path) instanceof TFile }));
		// rows 保持文档枚举顺序（**不按时间全局排序**）：面板据此在**每个文档内部**按「父＝其前最近一条级别更小的条目」挂父——跨文档/跨时间的子事件仍挂在结构父下；时间点升序渲染由面板渲染趟负责
		return { workDir: root, stories, activeStory: active, activeStoryTitle: stories.find((s) => s.name === active)?.title ?? active, useVolumes: state?.use_volumes === true, bookTimelinePath: this.manager.bookTimelinePath(active), rows, totalCount: rows.length, lanes, docs, storyDir: this.manager.storyPath(active) };
	}

	/**
	 * 场景面板数据快照（v0.4.7+）：当前小说**书/卷/章三层《场景.md》**全部条目扁平化（book → 各卷 → 各章文档序），
	 * 每条带来源层级标签与路径（双击定位/写回定位用）。只读非交互；无工作目录/无当前小说返回空快照。
	 */
	async getSceneSnapshot(): Promise<SceneSnapshot> {
		const root = this.settings.workDir.replace(/\/+$/, "");
		if (!root) return { workDir: "", stories: [], activeStory: null, activeStoryTitle: "", rows: [], totalCount: 0 };
		const names = await this.manager.listStories();
		const last = this.settings.lastStory?.trim() ?? "";
		const stories: SceneStoryEntry[] = [];
		for (const name of names) {
			let title = name;
			try {
				const st = await this.manager.loadState(name); // 单文件读取，成本低；失败用书名兜底
				if (st?.title) title = st.title;
			} catch { /* 单本状态读取失败不影响列表其余项 */ }
			stories.push({ name, title, active: name === last });
		}
		const active = last && names.includes(last) ? last : null;
		if (!active) return { workDir: root, stories, activeStory: null, activeStoryTitle: "", rows: [], totalCount: 0 };
		const volNameById = new Map<string, string>();
		try {
			for (const v of await this.manager.volumeList(active)) volNameById.set(v.id, v.name);
		} catch { /* 卷列表缺失按无卷渲染 */ }
		const chDocByKey = new Map<string, { label: string; path: string }>();
		for (const ch of await this.manager.listChapters(active)) chDocByKey.set(ch.key, { label: `章 · 第${ch.num}章 ${ch.title}`.trim(), path: `${ch.dir.path}/场景.md` }); // listChapters 已带目录，无需再逐章定位
		const rows: SceneRow[] = [];
		const layers = await this.manager.loadSceneLayerDocs(active); // 三层《场景.md》读取口径与 /analyze-cast 写回一致
		for (const layer of layers) {
			let scope: SceneScope = "book";
			let label = "书籍级";
			let path = `${this.manager.deskDocsPath(active)}/场景.md`;
			if (layer.ref.scope === "volume") {
				scope = "volume";
				const vol = { id: String(layer.ref.volId ?? ""), name: volNameById.get(String(layer.ref.volId ?? "")) ?? "", description: "", order: 0 };
				label = `卷 · ${vol.name}`;
				path = this.manager.volumeDocPath(active, vol, "场景.md");
			} else if (layer.ref.scope === "chapter") {
				scope = "chapter";
				const chd = chDocByKey.get(String(layer.ref.chapterKey ?? ""));
				if (chd) {
					label = chd.label;
					path = chd.path;
				}
			}
			let i = 0;
			for (const s of Object.values(layer.entries)) {
				rows.push({ ...s, id: `${path}#${s.scene_id}`, scope, sourcePath: path, sourceLabel: label, docIndex: i++ });
			}
		}
		return { workDir: root, stories, activeStory: active, activeStoryTitle: stories.find((s) => s.name === active)?.title ?? active, rows, totalCount: rows.length, eventTimes: await this.sceneEventTimes(active) }; // v0.4.8+ eventTimes＝卡片「🕐」区解析 `- 事件：` 用（名字→时间点文本）
	}

	/** v0.4.8+ 当前小说全部时间线条目的扁平事件表（场景卡片「🕐」区与编辑弹窗「事件」候选的**共用底料**）：
	 *  `name`＝事件名（口径＝`tlRowName`＝标题里时间点之后的名字，旧「纯时间点」标题回落事件正文首行）；`timeText`＝时间点显示文本；
	 *  `group`＝该条所在《时间线.md》的出处标签（书籍级 / 卷 · xx / 章 · 第N章 xx〔· 泳道名〕）＝弹窗下拉的分组名。
	 *  整份读取失败＝空表；某层解析失败＝跳过该层（同 getTimelineSnapshot 口径）——都不拦场景面板渲染 */
	private async timelineEventList(story: string): Promise<{ name: string; timeText: string; group: string }[]> {
		const out: { name: string; timeText: string; group: string }[] = [];
		let docs: TimelineDocSource[];
		try {
			docs = await this.manager.readTimelineDocs(story);
		} catch { return out; }
		for (const d of docs) {
			let list: TimelineEntry[] = [];
			try {
				list = parseTimelines(d.text);
			} catch { /* 单层解析失败不影响其余层 */ }
			for (const e of list) {
				const n = tlRowName(e);
				if (n) out.push({ name: n, timeText: timelineTimeText(e), group: d.label });
			}
		}
		return out;
	}

	/** v0.4.8+ 场景卡片「🕐」区的时间线索引＝**小写事件名 → 时间点显示文本**（同名后者覆盖前者）。
	 *  面板据此给 chip 加时间徽章；查不到＝该事件已从时间线改名/删除（chip 置灰划掉，点击仍由 `TimelineView.revealEvent` 提示找不到） */
	private async sceneEventTimes(story: string): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		for (const e of await this.timelineEventList(story)) out[e.name.toLowerCase()] = e.timeText;
		return out;
	}

	/** v0.4.8+ 场景编辑弹窗「事件」候选＝按所在《时间线.md》分组（弹窗下拉里＝`<optgroup>` 树状分类，组名＝出处标签），组内按文档序去重 */
	private async sceneEventOptions(story: string): Promise<MultiSelGroup[]> {
		const groups = new Map<string, string[]>();
		for (const e of await this.timelineEventList(story)) {
			const arr = groups.get(e.group) ?? [];
			if (!arr.includes(e.name)) arr.push(e.name);
			groups.set(e.group, arr);
		}
		return [...groups.entries()].map(([group, items]) => ({ group, items }));
	}

	/**
	 * 场景面板写回**共用通道**（v0.4.7+，与 timeline_view.mutate 同型；位置/新增/编辑/删除四流程统一走此）：
	 * adapter 读来源《场景.md》（不存在＝空文档按起底模板创建，先 ensureParentFolders）→ fn 生成新文本（null＝定位失败/同名，failMsg 给专门提示）→ adapter 写回 → Notice。
	 * **无论成败都立即 `scheduleScenePanelRefresh(0)`**：`adapter.write` 不触发 vault `modify` 事件，挂在外部改动上的防抖刷新对**自写回**不生效——
	 * 面板必须写后重读快照，否则卡片 left/top 与拖动闭包基准坐标停留旧值（第二次拖动松手会弹回上一次落点）；失败刷新同时弹回视图侧的乐观移动。
	 */
	private async mutateSceneDoc(okMsg: string, docPath: string, fn: (text: string) => string | null, failMsg?: () => string): Promise<boolean> {
		try {
			const exists = await this.app.vault.adapter.exists(docPath);
			const text = exists ? await this.app.vault.adapter.read(docPath) : "";
			const next = fn(text);
			if (next === null) {
				new Notice(failMsg ? failMsg() : "写回失败：源文档自面板加载后可能已变化，请点「刷新」后重试", 6000);
				return false;
			}
			if (!exists) await ensureParentFolders(this.app, docPath);
			await this.app.vault.adapter.write(docPath, next);
			new Notice(okMsg, 5000);
			return true;
		} catch (e) {
			this.notifyError("写回《场景.md》失败", e);
			return false;
		} finally {
			this.scheduleScenePanelRefresh(0);
		}
	}

	/**
	 * 场景面板拖动改位置写回（v0.4.7 整组语义）：被拖卡片连同全部子孙一次传入，**按来源文档合并**（同文档多次
	 * `rewriteScenePosition` 链式套用）经共用通道一次落盘；任一场景定位失败（快照过期防误写）整组拒绝并给统一提示。
	 * 视图已乐观把整组卡片移到新坐标，成败都由通道刷新校准。
	 */
	private async moveSceneFlow(moved: { row: SceneRow; x: number; y: number }[]): Promise<void> {
		if (!moved.length) return;
		const byDoc = new Map<string, { row: SceneRow; x: number; y: number }[]>();
		for (const m of moved) {
			const arr = byDoc.get(m.row.sourcePath);
			if (arr) arr.push(m);
			else byDoc.set(m.row.sourcePath, [m]);
		}
		const first = moved[0].row;
		const okMsg = moved.length === 1
			? `已将「${sceneDisplayName(first)}」移到 (${String(Math.round(moved[0].x))}, ${String(Math.round(moved[0].y))})`
			: `已移动「${sceneDisplayName(first)}」及其 ${String(moved.length - 1)} 个场景（含随区域移动的大场景）`; // v0.4.9+ 清单里除被拖的整组子孙，还有被区域口径顺带搬走的大场景（区域头）
		for (const [docPath, ms] of byDoc) {
			let failed: SceneRow | undefined; // fn 内捕获首个定位失败的场景（Notice 里点名）
			await this.mutateSceneDoc(okMsg, docPath, (text) => {
				let cur = text;
				for (const m of ms) {
					const expect = m.row.x != null && m.row.y != null ? { x: m.row.x, y: m.row.y } : null;
					const next = rewriteScenePosition(cur, m.row.scene_id, expect, m.x, m.y);
					if (next === null) {
						failed = m.row;
						return null;
					}
					cur = next;
				}
				return cur;
			}, () => `写回失败：场景「${sceneDisplayName(failed ?? ms[0].row)}」的源文档自面板加载后可能已变化，请点「刷新」后重试`);
		}
	}

	/** v0.4.9+ 新建场景的「级别」候选（编辑弹窗最上方下拉）＝下拉内容按**书级 → 卷级 → 章级**排列，每档都以层级词开头：
	 *  `书级 · 案头资料/场景.md`／`卷级 · 当前卷「卷名」`／`章级 · 第NN章 章名`（用户要求＝**卷名与章名必须显示在下拉里**）。缺当前激活卷/章时那一档不进候选（书级恒在）；
	 *  **默认仍是卷级**（有激活卷＝选它，否则顺延到章级、再否则书级）。
	 *  同时给出各级别的目标《场景.md》路径（＝打开弹窗那一刻解析，之后切换激活卷/章不影响本次写入）：
	 *  书级＝`deskDocsPath/场景.md`（案头资料/场景.md）、卷级＝`volumeDocPath(卷)`（卷目录《文档/场景.md》）、章级＝章节目录《场景.md》。
	 *  激活卷取《故事状态.md》`current_volume`（id 或卷名都可，`findVolumeIn` 口径），激活章取 `current_chapter`（复合键 `volId:N`／裸数字都兜） */
	private async sceneScopeChoices(story: string): Promise<{ options: SceneScopeOption[]; value: string; paths: Map<string, string> }> {
		const paths = new Map<string, string>();
		const labels = new Map<string, string>(); // 下拉文案（用户要求＝卷级带当前卷名、章级带章号＋章名；排列仍是书级 → 卷级 → 章级）
		const state = await this.manager.loadState(story).catch(() => null); // 状态读不到＝按「无激活卷/章」给候选
		const volMap = await this.manager.loadVolumes(story).catch((): Record<string, VolumeInfo> => ({})); // 卷清单读不到＝无卷
		const curVol = state?.current_volume ? this.manager.findVolumeIn(volMap, state.current_volume) : null;
		if (curVol) {
			paths.set("volume", this.manager.volumeDocPath(story, curVol, "场景.md"));
			labels.set("volume", `卷级 · 当前卷「${curVol.name}」`); // 用户要求＝卷级这一项要带当前卷名
		}
		const chapters = await this.manager.listChapters(story).catch((): SceneScopeChapter[] => []); // 章清单读不到＝无章
		const curCh = findChapterByStateKey(chapters, state?.current_chapter); // v0.4.9+ 复合键精确→章号兜底（裸数字旧键只比章号、带卷前缀还要求同卷；非法键＝无章级候选）
		if (curCh) {
			paths.set("chapter", `${curCh.dir.path}/场景.md`);
			labels.set("chapter", `章级 · 第${String(curCh.num).padStart(2, "0")}章 ${curCh.title}`.trim()); // 用户要求＝章级这一项要带当前章号与章名
		}
		paths.set("book", `${this.manager.deskDocsPath(story)}/场景.md`); // 书级这一档恒在（写进案头资料/场景.md）
		labels.set("book", "书级 · 案头资料/场景.md");
		const options: SceneScopeOption[] = []; // 排列按用户要求＝书级 → 卷级 → 章级
		for (const value of ["book", "volume", "chapter"] as const) {
			if (!paths.has(value)) continue; // 没有当前卷/章＝该档不进候选
			options.push({ value, label: labels.get(value) ?? DOC_SCOPE_WORDS[value] });
		}
		const value = paths.has("volume") ? "volume" : paths.has("chapter") ? "chapter" : "book"; // 默认卷级；无激活卷→章级→书级
		return { options, value, paths };
	}

	/**
	 * 场景面板「＋ 场景」根级新增（v0.4.7+）／画布空白处右键「在此添加场景」（v0.4.9+：`at`＝右键处的画布坐标，直接写进新场景 `- 位置：x,y`＝卡片落在点上）：
	 * SceneEditModal 收集 → `md_docs.insertSceneBlock` 追加到**弹窗顶部「级别」下拉所选那一层**《场景.md》（下拉按书级 → 卷级 → 章级排、默认卷级；
	 * v0.4.9+ 用户要求，旧口径恒为书级）文末（文件不存在按 "# 场景" 起底自动创建；目录缺失先 ensureParentFolders——adapter.write 不承诺建父目录）。同名/非法名明确拒绝。
	 * 「添加子场景」（`parentRow`）＝**沿用父场景那份文档**（级别行只读、值＝将写入的位置＝`docLocationLabel(父.scope, 父.sourcePath, 书目录)`＝不跨层拆父子），父下拉预填该父。
	 * `at`＝画布落点（v0.4.9+ 口径由场景面板给）：画布空白处右键＝就在该点；「＋ 场景」／「添加子场景」＝**先按自动布局**（面板判断自动布局的落点在当前视口内且没压到旧卡片→不带 `at`＝**不写 `- 位置：`**）；只有自动布局会排到视口外或压到旧卡片时，面板才传「视口左上角 +(50,50)」的坐标（带阶梯避让）。
	 */
	private async addSceneFlow(parentRow?: SceneRow, at?: { x: number; y: number }): Promise<void> {
		const story = await this.activeStory();
		if (!story) {
			new Notice("尚未选择当前小说：请先在写字台或命令里切换小说", 6000);
			return;
		}
		const charOptions = await this.getTimelineCharOptions();
		const snap = await this.getSceneSnapshot(); // 父场景候选＝全部场景（新建无需排除自身）
		const parentOptions = this.sceneParentOptions(snap.rows, null);
		const scopeChoices = parentRow ? null : await this.sceneScopeChoices(story); // v0.4.9+ 根级新增才给级别下拉
		const eventOptions = await this.sceneEventOptions(story); // v0.4.8+ 「事件」多选候选＝该书各层《时间线.md》事件名，按所在文件分组
		new SceneEditModal(
			this.app,
			parentRow ? `新建子场景（隶属「${sceneDisplayName(parentRow)}」）` : "新建场景",
			null,
			parentRow ? { parent: parentRow.scene_id } : undefined,
			charOptions,
			parentOptions,
			this.sceneRelatedOptions(snap.rows, null),
			eventOptions, // v0.4.8+ 事件候选（按《时间线.md》分组＝下拉 optgroup 树状列表）
			parentRow
				? { label: docLocationLabel(parentRow.scope, parentRow.sourcePath, this.manager.storyPath(story)) } // 添加子场景＝级别随父＝只读，这一行显示「将写入的位置」＝父场景那份《场景.md》（书内路径）
				: { options: scopeChoices?.options ?? [], value: scopeChoices?.value ?? "book" }, // 根级新增＝级别下拉（书级／卷级／章级）
			async (res) => {
				let path = parentRow ? parentRow.sourcePath : `${this.manager.deskDocsPath(story)}/场景.md`; // 子场景与父同文档；根级新增＝按弹窗选的级别取对应层文档
				if (scopeChoices) {
					const chosen = scopeChoices.paths.get(res.scope ?? "") ?? scopeChoices.paths.get(scopeChoices.value);
					if (chosen) path = chosen;
				}
				const input: SceneBlockInput = {
					scene_id: res.sceneId,
					description: res.description || undefined,
					chapter_num: 0,
					characters: res.characters,
					parent: res.parent || undefined,
					related: res.related.length ? res.related.map((x) => x.id) : undefined, // v0.4.9+ 弹窗交的是带说明的行＝取 id 列表
					relatedLabels: this.sceneRelNotes(res.related), // v0.4.9+ 联通性说明（`- 关联：甲（官道·三日路程）`）
					terrain: res.terrain || undefined, // v0.4.8+ 地形下拉（空＝不写 `- 地形：` 行）
					events: res.events.length ? res.events : undefined, // v0.4.8+ 场景挂事件（`- 事件：甲、乙`；弹窗按《时间线.md》分组选）
					x: at?.x, // v0.4.9+ 空白处右键「在此添加场景」＝直接落在点上的画布坐标（写 `- 位置：x,y`；头部按钮不带＝按自动布局排布）
					y: at?.y,
					created_at: new Date().toISOString().slice(0, 10),
				}; // v0.4.8+ 弹窗已无「备注/正文」输入＝这两字段不写（文档里手写的这两行仍照常解析展示）
				await this.mutateSceneDoc(`已新增场景「${res.sceneId}」（${path}）`, path, (text) => insertSceneBlock(text, input), () => `已存在同名场景「${res.sceneId}」或场景名无效`);
			}
		).open();
	}

	/** v0.4.9+ 弹窗关联行 → 新增场景写盘用的说明表（`- 关联：甲（说明）`）：只留有说明的项，全空＝undefined */
	private sceneRelNotes(related: readonly SceneRelEdit[]): Record<string, string> | undefined {
		const out: Record<string, string> = {};
		for (const r of related) {
			const v = r.note.trim();
			if (v) out[r.id] = v;
		}
		return Object.keys(out).length ? out : undefined;
	}

	/** v0.4.9+ 弹窗关联行 → 编辑写盘用的说明覆盖表（`updateSceneBlock` 的 relatedNotes）：**全部** id 都列出，
	 *  说明留空＝清掉该行原有说明（覆盖口径），未列出的 id 才沿用原说明 */
	private sceneRelNoteEdits(related: readonly SceneRelEdit[]): Record<string, string> {
		const out: Record<string, string> = {};
		for (const r of related) out[r.id] = r.note.trim();
		return out;
	}

	/** v0.4.9+ 编辑弹窗预填：SceneDoc 的 `related` ＋ `relatedLabels` → 弹窗行（每行＝场景 id＋该行联通性说明） */
	private sceneRelEdits(row: SceneRow): SceneRelEdit[] {
		return (row.related ?? []).map((id) => ({ id, note: row.relatedLabels?.[id] ?? "" }));
	}

	/** 场景编辑弹窗候选基座（v0.4.7+ 复用＝父场景/关联场景共用）：全部场景按 id 去重、label＝显示名口径 */
	private sceneOptionPairs(rows: SceneRow[]): { id: string; label: string }[] {
		const seen = new Set<string>();
		const out: { id: string; label: string }[] = [];
		for (const r of rows) {
			if (seen.has(r.scene_id)) continue;
			seen.add(r.scene_id);
			out.push({ id: r.scene_id, label: sceneDisplayName(r) });
		}
		return out;
	}

	/** 场景编辑弹窗「父场景」候选：全部场景去重，excludeId 时排除自身＋全部后代（沿 `- 父场景：` 链闭包展开，防父子成环） */
	private sceneParentOptions(rows: SceneRow[], excludeId: string | null): { id: string; label: string }[] {
		const excl = excludeId ? this.collectDescendantIds(rows, excludeId) : new Set<string>();
		return this.sceneOptionPairs(rows).filter((o) => !excl.has(o.id));
	}

	/** 场景编辑弹窗「关联场景」候选（v0.4.7+）：全部场景去重、仅排除自身（关联无层级语义、无须防环） */
	private sceneRelatedOptions(rows: SceneRow[], selfId: string | null): { id: string; label: string }[] {
		return this.sceneOptionPairs(rows).filter((o) => o.id !== selfId);
	}

	/** 沿 parent 链做后代闭包（含 rootId 自身）；简单不动点迭代，场景量级小、无环假设由候选侧排除保证 */
	private collectDescendantIds(rows: SceneRow[], rootId: string): Set<string> {
		const out = new Set<string>([rootId]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const r of rows) {
				if (r.parent && out.has(r.parent) && !out.has(r.scene_id)) {
					out.add(r.scene_id);
					grew = true;
				}
			}
		}
		return out;
	}

	/** 场景面板 ✎ 编辑：弹窗预填现值 → 共用通道内 `md_docs.updateSceneBlock` 只改该块（未触碰字段/正文围栏/创建时间保留原行）。v0.4.8+：场景名也可改——改名走 renameSceneFlow（换块锚＋同步全部 `- 父场景：`/`- 关联：` 引用） */
	private async editSceneFlow(row: SceneRow): Promise<void> {
		const charOptions = await this.getTimelineCharOptions();
		const snap = await this.getSceneSnapshot();
		const parentOptions = this.sceneParentOptions(snap.rows, row.scene_id); // 排除自身与后代防环
		const story = snap.activeStory ?? ""; // v0.4.8+ 事件候选需要当前书（无书＝空候选，弹窗显示「还没有时间线事件」）
		const eventOptions = story ? await this.sceneEventOptions(story) : [];
		new SceneEditModal(
			this.app,
			`编辑场景「${sceneDisplayName(row)}」`,
			{ scene_id: row.scene_id },
			{ sceneId: row.scene_id, description: row.description ?? "", characters: row.characters, parent: row.parent ?? "", related: this.sceneRelEdits(row), terrain: row.terrain ?? "", events: row.events ?? [] }, // v0.4.9+ 关联预填＝行（id＋联通性说明）；v0.4.8+ 事件预填＝`- 事件：` 名字列表
			charOptions,
			parentOptions,
			this.sceneRelatedOptions(snap.rows, row.scene_id),
			eventOptions, // v0.4.8+ 事件候选（按《时间线.md》分组＝下拉 optgroup 树状列表）
			{ label: docLocationLabel(row.scope, row.sourcePath, snap.activeStory ? this.manager.storyPath(snap.activeStory) : "") }, // v0.4.9+ 级别行只读＝只显示「场景所在位置」＝层级 · **书内路径**（从书籍目录起算，不带仓库里的《工作目录/<书名>/》前缀），编辑态不跨层挪块
			async (res) => {
				const newId = res.sceneId.trim();
				if (newId && newId !== row.scene_id) {
					await this.renameSceneFlow(row, snap, newId, res);
					return;
				}
				await this.mutateSceneDoc(`已更新场景「${row.scene_id}」`, row.sourcePath, (text) =>
					updateSceneBlock(text, row.scene_id, {
						description: res.description,
						characters: res.characters,
						parent: res.parent, // 空串＝删除 `- 父场景：` 行（升为顶层）
						related: res.related.map((x) => x.id), // v0.4.7+ 关联场景（空数组＝删 `- 关联：` 行）；显示名输入已删——原 `- 标题：` 行未触碰原样保留
						relatedNotes: this.sceneRelNoteEdits(res.related), // v0.4.9+ 每行联通性说明（空串＝清掉该行说明）；写盘＝`- 关联：甲（说明）`
						terrain: res.terrain, // v0.4.8+ 地形下拉（空串＝删 `- 地形：` 行；`- 颜色：` 弹窗不编辑＝原样保留）
						events: res.events, // v0.4.8+ 场景挂事件（空数组＝删 `- 事件：` 行；既有括号备注按名字沿用）
						// v0.4.8+ 弹窗无「备注/正文」输入＝这两字段不给出＝原 `- 备注：` 行与 ```text 正文围栏原样保留
					})
				);
			}
		).open();
	}

	/** 场景面板 🗑 删除：ConfirmModal 二次确认（禁 window.confirm）→ 共用通道内 `md_docs.deleteSceneBlock` 整块删（含正文围栏） */
	private async deleteSceneFlow(row: SceneRow): Promise<void> {
		const ok = await this.confirmBox("删除场景", `将从《场景.md》删除「${sceneDisplayName(row)}」（整块含正文，不可撤销）。`, "删除");
		if (!ok) return;
		await this.mutateSceneDoc(`已删除场景「${sceneDisplayName(row)}」`, row.sourcePath, (text) => deleteSceneBlock(text, row.scene_id));
	}

	/** v0.4.8+ 场景卡片「🕐」区点击事件＝跳时间线：先走常驻面板通道把时间线面板带到前台（未开＝按常驻口径新建），
	 *  再让面板按事件名定位条目行＝滚动进视口＋闪烁高亮（`TimelineView.revealEvent`；时间线里没有同名事件时由它弹提示） */
	private async openTimelineEventFlow(name: string): Promise<void> {
		await this.openTimelinePanel();
		const leaf = this.app.workspace.getLeavesOfType(TimelineView.VIEW_TYPE)[0];
		if (!(leaf?.view instanceof TimelineView)) return; // 面板创建失败（openResidentPanel 已弹错）＝静默
		await leaf.view.revealEvent(name);
	}

	/**
	 * 场景改名（v0.4.8+）：共用通道内链式 `renameSceneBlock`（换 `## id` 块锚＋同文档 `- 父场景：`/`- 关联：`/等值 `- 标题：` 引用同步）→ `updateSceneBlock`（按新 id 写本次字段）；
	 * 成功后按快照扫**其余**场景文档，含引用者逐份 `renameSceneRefs` 同步（口径＝同文档优先→全局首个：文档自身有同名块＝其引用指向本地块、不动；
	 * 别的文档在文档序里更早出现同名块＝全局首个不是本块，跨文档同步会误伤，跳过并提示）。源文档改名失败即整体中止。
	 */
	private async renameSceneFlow(row: SceneRow, snap: SceneSnapshot, newId: string, res: SceneEditResult): Promise<void> {
		const oldId = row.scene_id;
		const renamed = await this.mutateSceneDoc(`已将场景「${oldId}」改名为「${newId}」`, row.sourcePath, (text) => {
			const renamedText = renameSceneBlock(text, oldId, newId);
			if (renamedText === null) return null;
			return updateSceneBlock(renamedText, newId, {
				description: res.description,
				characters: res.characters,
				parent: res.parent,
				related: res.related.map((x) => x.id),
				relatedNotes: this.sceneRelNoteEdits(res.related), // v0.4.9+ 联通性说明随改名一并写回（改名后 id＝新名）
				terrain: res.terrain, // v0.4.8+ 地形下拉（改名同批写回）
				events: res.events, // v0.4.8+ 场景挂事件（改名同批写回；空数组＝删行）
				// 备注/正文不给出＝改名时原 `- 备注：` 行与正文围栏原样保留（v0.4.8+ 弹窗已无这两输入）
			});
		}, () => `改名失败：源文档里未找到「${oldId}」，或「${newId}」在该文档已有同名场景——请点「刷新」后重试`);
		if (!renamed) return;
		const firstSame = snap.rows.find((r) => r.scene_id === oldId);
		if (firstSame && firstSame.sourcePath !== row.sourcePath) {
			new Notice(`其它文档存在更早的同名场景「${oldId}」：跨文档引用未同步（同名解析优先指向那份文档）`, 8000);
			return;
		}
		const docs = new Map<string, SceneRow[]>();
		for (const r of snap.rows) {
			if (r.sourcePath === row.sourcePath) continue;
			const arr = docs.get(r.sourcePath);
			if (arr) arr.push(r);
			else docs.set(r.sourcePath, [r]);
		}
		for (const [docPath, rowsIn] of docs) {
			if (rowsIn.some((r) => r.scene_id === oldId)) continue; // 该文档自有同名块＝其引用指向本地块，不动
			if (!rowsIn.some((r) => r.parent === oldId || (r.related ?? []).some((x) => x === oldId))) continue; // 无引用可同步
			await this.mutateSceneDoc(`已同步「${docPath}」中对改名场景的引用`, docPath, (text) => renameSceneRefs(text, oldId, newId));
		}
	}

	/** 时间线编辑弹窗「人物」下拉候选（v0.3.3+ 合并大事件）：当前书三层《人物.md》角色名去重排序（与人物关系面板「人物状态」同源）；无当前书/读取失败返回空数组（弹窗退化为无候选） */
	async getTimelineCharOptions(): Promise<string[]> {
		const active = this.settings.lastStory?.trim() ?? "";
		if (!active) return [];
		let names: string[];
		try {
			const entries = await this.manager.loadCharacterEntries(active);
			names = [...new Set(entries.map((e) => e.name.trim()).filter((n) => n.length > 0))];
		} catch { return []; } // 人物候选读取失败不拦编辑弹窗
		return names.sort((a, b) => a.localeCompare(b, "zh"));
	}

	/** 单本书的详情快照：状态字段 + 章节目录（含各章文件）+ 书根案头资料；字数优先用传入的实时磁盘统计 chWords，回退 state 值 */
	private async buildStoryDetail(storyName: string, chWords?: Record<string, number>, chChars?: Record<string, number>): Promise<StatusDetail> {
		const state = await this.manager.loadState(storyName);
		let vols: Array<{ id: string; name: string; description: string; order: number }> = [];
		try {
			vols = await this.manager.volumeList(storyName); // 卷列表缺失（未建过卷）→ 按无卷渲染，章节全部平铺
		} catch { /* ignore */ }
		const curVolId = state?.current_volume ?? "";
		const chs = await this.manager.listChapters(storyName);
		const chapters: StatusChapterEntry[] = chs.map((c) => ({
			key: c.key,
			num: c.num,
			title: c.title,
			words: chWords ? (chWords[c.key] ?? 0) : (state?.chapters[c.key]?.words ?? 0),
			active: c.key === state?.current_chapter,
			volumeId: c.vol ?? "", // 以章节目录物理位置判归属（与 /scan 口径一致），供面板挂到对应卷节点下
			files: c.dir.children.filter((f): f is TFile => f instanceof TFile).map((f) => ({ path: f.path, name: f.name })).sort((a, b) => a.name.localeCompare(b.name, "zh")),
		}));
		const storyDir = this.app.vault.getAbstractFileByPath(this.manager.storyPath(storyName));
		const deskDir = this.app.vault.getAbstractFileByPath(this.manager.deskDocsPath(storyName)); // 「案头资料/」（新布局）；旧布局尚未迁移时不存在
		// 「案头资料」小节展示 = 「案头资料/」内容 ∪ 书根剩余项（故事状态.md/卷.md/AI提示词/ 等系统项留书根一并展示；「案头资料/」「书稿/」两个容器自身不列入）
		const srcDirs = [deskDir, storyDir].filter((d): d is TFolder => d instanceof TFolder);
		const knownVolNames = new Set(vols.map((v) => this.manager.volumeFolderName(v))); // 已建卷的实体目录名集合，用于过滤书根文件夹（旧布局未迁移时生效）
		const globalFiles: StatusFileEntry[] = [];
		const globalFolders: StatusFolderEntry[] = [];
		const folderFiles = (fd: TFolder): StatusFileEntry[] => fd.children.filter((c): c is TFile => c instanceof TFile).map((c) => ({ path: c.path, name: c.name })).sort((a, b) => a.name.localeCompare(b.name, "zh")); // v0.2.23+：文件夹直属 md（按名排序），供写字台行展开查看
		for (const d of srcDirs) {
			for (const f of d.children) {
				if (f instanceof TFile) {
					globalFiles.push({ path: f.path, name: f.name });
				} else if (f instanceof TFolder && d === storyDir) {
					if (f.name === DESK_DOCS_DIR_NAME || f.name === MANUSCRIPT_DIR_NAME) continue; // 新布局两容器
					if (CHAPTER_DIR_RE.test(f.name) || knownVolNames.has(f.name) || f.name === PROLOGUE_DIR_NAME) continue;
					globalFolders.push({ path: f.path, name: f.name, files: folderFiles(f) });
				} else if (f instanceof TFolder) {
					globalFolders.push({ path: f.path, name: f.name, files: folderFiles(f) }); // 「案头资料/」直属文件夹原样展示
				}
			}
		}
		globalFiles.sort((a, b) => a.name.localeCompare(b.name, "zh"));
		globalFolders.sort((a, b) => a.name.localeCompare(b.name, "zh"));
		const volDocs = await this.manager.listVolumeDocsByVol(storyName); // v0.1.3+：各卷实体目录直属 md（非章节目录），供写字台「文档」子节点展示
		const prologueFiles = this.manager.listPrologueDocs(storyName); // v0.2.x+：书根「引言」文件夹直属 md（全书唯一），供写字台「引言」节点展示
		return {
			storyName,
			title: state?.title || storyName,
			genre: state?.genre || "",
			writingStyle: state?.writing_style || "",
			currentChapter: state?.current_chapter ?? null,
			currentVolume: curVolId,
			totalWords: chWords ? Object.values(chWords).reduce((s, w) => s + w, 0) : (state?.total_words ?? 0),
			totalChars: chChars ? Object.values(chChars).reduce((s, w) => s + w, 0) : undefined, // 含标点总字符数：仅实时统计可用时给出（state 无此字段，故缺失则不显示）
			updatedAt: state?.updated_at || "",
			volumes: vols.map((v) => ({ id: v.id, name: v.name, order: v.order, active: v.id === curVolId, docs: volDocs[v.id] ?? [] })),
			chapters,
			globalFiles,
			globalFolders,
			prologueFiles,
			useVolumes: state?.use_volumes ?? true, // v0.0.16+：无卷模式时写字台隐藏全部「新建卷」入口；状态缺失按有卷兜底不擅藏功能
		};
	}

	/** 状态页切换当前小说：写回 lastStory（对齐 switch-story 的持久化语义）；v0.2.1+ 经统一入口归档旧书并恢复所选书的工作区（changeLayout 可能重建承载本视图的分栏，调用方 doSwitchStory 的后续 refresh 落在游离节点上无副作用） */
	async statusSwitchStory(name: string): Promise<void> {
		new Notice(`已切换当前小说：${name}`, 4000);
		await this.applyStorySwitch(name, true); // 显式下拉切书→目标无存档则关闭主编辑区打开的文档
		await this.enforceVolumeLayoutOnSwitch(name); // 平面结构 → 强制自动按卷整理（不可跳过）
	}

	/** 状态页激活章节：写回 current_chapter；该章归属卷时同步补激活所属卷（对齐切章约定），返回新的当前章复合键 */
	async statusActivateChapter(storyName: string, key: string): Promise<string> {
		const state = await this.manager.loadState(storyName);
		if (!state) throw new Error("状态文档缺失，请先执行「重建小说状态」");
		await this.manager.switchChapter(storyName, key); // 含 chapters 条目回填 + 按键内容器同步当前卷（目录与状态脱节时也稳定生效）
		return key;
	}

	/**
	 * v0.4.6+ 修 C2：file-open → 打开的是当前小说某章正文《章节.md》时自动激活该章（等价写字台 Radio）。
	 * 只在「当前书 + 正文文件 + 无进行中生成（面板流式中/auto-book 流水线跑着）」时响应；键与现值相同零写盘
	 * （纯浏览不脏《故事状态.md》）。防抖 300ms 合并快速连点；大纲/摘要/审阅笔记等非正文文件一律不动指针。
	 */
	private chapterOpenSyncTimer: number | null = null;
	private syncCurrentChapterOnFileOpen(file: TFile | null): void {
		const story = (this.settings.lastStory || "").trim();
		if (!file || !story || this.auto) return; // 全自动流水线跑着＝目标已锁定，不跟浏览
		if (file.name !== "章节.md" && !file.name.endsWith("-章节.md")) return; // 只认章节正文（老格式「章节.md」／新格式「<标题>-章节.md」，见 saveCurrentChapter 同款判定；大纲/摘要/审阅笔记一律不动指针）
		if (!file.path.startsWith(`${this.manager.storyPath(story)}/`)) return; // 只认当前书（浏览他书文件不切）
		if (this.lastGenPanel?.isStreaming()) return; // 生成面板流式中：本次目标锁定，不中途换章
		if (this.chapterOpenSyncTimer != null) window.clearTimeout(this.chapterOpenSyncTimer);
		this.chapterOpenSyncTimer = window.setTimeout(() => {
			void (async () => {
				try {
					const state = await this.manager.loadState(story);
					if (!state) return;
					const hit = (await this.manager.listChapters(story)).find((c) => file.path.startsWith(`${c.dir.path}/`)); // 章节目录前缀命中＝该章正文
					if (!hit || (state.current_chapter ?? "") === hit.key) return; // 同键零写盘
					await this.statusActivateChapter(story, hit.key);
					this.notifyContextChanged(); // 顶部 LLM 面板章节行＋写字台/人物关系面板防抖刷新
				} catch {
					/* 浏览态失败不打扰用户（状态文档缺失等有主路径提示） */
				}
			})();
		}, 300);
	}

	/** 广播刷新所有已打开的 LLM 对话面板顶部「当前小说 · 章节」行（切书/切章/建章等任何状态或设置变更路径都会经 saveSettings 或 manager.saveState 触发到这里），并防抖刷新所有已打开的写字台（切书/切章后跨分栏同步） */
	notifyContextChanged(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(LlmChatView.VIEW_TYPE)) {
			if (leaf.view instanceof LlmChatView) {
				void leaf.view.updateCtxLine(); // 顶部小说·章节行
				void leaf.view.updateSpLabel(); // 「提示词」标签（是否含小说上下文、约字数）
			}
		}
		// lastStory/current_chapter 等元数据变更时同步刷新所有已打开面板（写字台 + 人物关系）：切书/切章后其它面板不再停留在旧书；防抖合并突发
		this.schedulePanelRefresh(200);
	}

	/** 状态页右键快捷菜单动作执行器（语义与对应命令一致，但直接针对右键所在的小说/章节/目录，不再弹选择器） */
	async handleStatusAction(a: StatusAction): Promise<void> {
		switch (a.kind) {
			case "new-story": {
				await this.cmdNewStory(); // 复用建书三问流程
				return;
			}
			case "edit-story-meta": {
				await this.cmdEditStoryMeta(a.story);
				return;
			}
			case "open-typing-record": { // v0.4.5+ 底部「写作状态」标题行：打开该书《案头资料/码字记录.md》（文件缺失先按表头建骨架再打开）
				const story = (this.settings.lastStory || "").trim();
				if (!story) {
					new Notice("尚未激活小说：无法定位《码字记录.md》", 4000);
					return;
				}
				const path = this.manager.bookTypeStatsPath(story);
				let file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					try {
						await this.app.vault.adapter.write(path, TYPE_STATS_HEADER);
					} catch (e) {
						new Notice(`创建《码字记录.md》失败：${e instanceof Error ? e.message : String(e)}`, 6000);
						return;
					}
					file = this.app.vault.getAbstractFileByPath(path);
				}
				if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
				return;
			}
			case "rename-story": {
				const cur = (await this.manager.loadState(a.name))?.title ?? a.name;
				const t = await this.prompt(`改名「${a.name}」`, `新书名（当前：${cur || "无"}）`);
				if (t == null || !t.trim() || t.trim() === cur) return; // 留空/未变更不执行
				const r = await this.manager.renameStory(a.name, t.trim()); // title + 顶层目录同步改名 + 全书 MD 文档内旧书名整体替换（原件备份 _backup/改书名_时间戳/）
				try { // v0.2.1+：该书的工作区存档以书名命名，须随改名迁移否则丢失关联
					const wsOld = this.bookWorkspacePath(a.name);
					const wsNew = this.bookWorkspacePath(r.newName);
					if (wsOld !== wsNew && (await this.manager.pluginFileExists(wsOld))) {
						const text = await this.manager.readPluginFile(wsOld);
						if (text != null) {
							await this.manager.writePluginFile(wsNew, text);
							await this.app.vault.adapter.remove(wsOld);
						}
					}
				} catch { /* v0.2.1+：旧名工作区存档改名迁移为尽力而为，失败不影响改名主流程 */ }
				if ((this.settings.lastStory || "") === a.name) {
					this.settings.lastStory = r.newName; // 当前书记忆随目录改名，同时触发 LLM 面板上下文行刷新
					await this.saveSettings();
				}
				let msg = r.newName !== a.name ? `已改名为「${t.trim()}」，顶层目录已同步移动为 ${r.newName}` : `已改名为「${t.trim()}」（目录名不变）`;
				if (r.hits > 0) msg += `；书中文档里的旧书名已替换 ${String(r.hits)} 处（${String(r.files)} 个文件，原件备份至 _backup/改书名_…）`;
				new Notice(msg, 6000);
				return;
			}
			case "delete-story": {
				const folder = this.app.vault.getAbstractFileByPath(this.manager.storyPath(a.name));
				if (!(folder instanceof TFolder)) throw new Error("小说目录不存在或已被移动");
				const ok = await this.confirmBox(`删除小说「${a.name}」？`, "整本书的文件夹（含全部章节与文档）将移入 Obsidian 回收站，可从中找回。", "删除");
				if (!ok) return;
				await this.app.fileManager.trashFile(folder);
				try { const ws = this.bookWorkspacePath(a.name); if (await this.manager.pluginFileExists(ws)) await this.app.vault.adapter.remove(ws); } catch { /* v0.2.1+：清理该书工作区存档，失败不影响删书 */ }
				if ((this.settings.lastStory || "") === a.name) {
					this.settings.lastStory = "";
					await this.saveSettings(); // 同时触发 LLM 面板上下文行刷新
				}
				new Notice(`小说「${a.name}」已删除（可在回收站找回）`);
				return;
			}
			case "new-chapter": {
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const chapters = await this.manager.listChapters(a.story);
				const st = await this.manager.loadState(a.story);
				let curVol = (st?.current_volume ?? "").trim(); // 有当前卷 → 落卷实体目录
				if (st && !st.use_volumes) curVol = ""; // v0.0.16+：无卷模式一律落书根（纯 书→章），忽略残留 current_volume/右键 volId
				if (a.volId && a.volId !== curVol) { // 卷节点右键建章：目标卷优先，并同步设为当前卷（位置即归属）
					curVol = a.volId;
					if (st) {
						st.current_volume = a.volId;
						await this.manager.saveState(a.story, st);
					}
				}
				const base = this.manager.storyPath(a.story);
				const inScope = curVol ? chapters.filter((c) => c.vol === curVol) : chapters.filter((c) => !c.vol && c.parentPath === base);
				const nextNum = inScope.length ? Math.max(...inScope.map((c) => c.num)) + 1 : 1;
				let volName = "";
				try { if (curVol) volName = this.manager.findVolumeIn(await this.manager.loadVolumes(a.story), curVol)?.name ?? curVol; } catch { volName = curVol; }
				const scopeLabel = curVol ? `卷「${volName}」` : "书根";
				const title = await this.prompt(`新建章节（将成为 ${scopeLabel}第${nextNum}章）`, "章节标题");
				if (title == null || !title.trim()) return;
				const bodyPath = await this.manager.createChapter(a.story, title.trim(), curVol); // v0.0.15：编号在容器内自动顺延，不再手输章号
				new Notice(`${scopeLabel}已创建第${String(nextNum).padStart(2, "0")}章-${title.trim()}：章节目录与文档就绪`);
				if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(bodyPath);
				return;
			}
			case "create-volume": {
				if ((await this.manager.loadState(a.story))?.use_volumes === false) { new Notice(NO_VOL_MODE_MSG, 10000); return; } // v0.0.16+：无卷模式禁止建卷兜底（写字台已隐藏该入口）
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const names = await this.pickNewVolumeNames(a.story); // 列表式批量新建卷页面（手动加名单、确定后按序创建）
				if (!names || !names.length) return;
				await this.createVolumesInOrder(a.story, names); // 单个卷失败不中断其余，汇总通知给出原因；最后成功的设为当前卷
				return;
			}
			case "rename-volume": {
				const vols = await this.manager.volumeList(a.story);
				const curName = vols.find((v) => v.id === a.id)?.name ?? a.id;
				const n = await this.prompt("重命名卷", `新名称（当前：${curName}）`);
				if (!n?.trim() || n.trim() === curName) return;
				const u = await this.manager.updateVolume(a.story, a.id, { name: n.trim() }); // 同步重命名卷实体目录；同名冲突/移动失败抛错回滚
				new Notice(u ? `已改名为「${u.name}」，卷实体目录已同步移动` : "改名失败：卷不存在", 6000);
				return;
			}
			case "delete-volume": {
				const vols = await this.manager.volumeList(a.story);
				const vol = vols.find((v) => v.id === a.id);
				if (!vol) throw new Error(`卷 ${a.id} 不存在或已被删除`);
				const state = await this.manager.loadState(a.story);
				const nums = Object.entries(state?.chapters ?? {})
					.filter(([, m]) => (m.volume || "") === vol.id || (m.volume || "") === vol.name)
					.map(([k]) => parseChKey(k).num)
					.sort((x, y) => x - y);
				const ok = await this.confirmBox(
					`删除卷「${vol.name}」？`,
					nums.length
						? `其归属的 ${nums.length} 章（${nums.slice(0, 12).map((n) => this.chapterLabel(n)).join("、")}${nums.length > 12 ? " 等" : ""}）将一并移入 Obsidian 回收站，可从中找回；其余章节编号自动保持连续。`
						: "该卷暂无归属章节，仅删除卷本身及其实体目录。",
					"删除"
				);
				if (!ok) return;
				const r = await this.manager.deleteVolumeCascade(a.story, vol.id); // 级联删章入回收站 + 单次补洞重排
				new Notice(`已删除卷「${r.name}」${r.chaptersDeleted.length ? `，级联删除 ${String(r.chaptersDeleted.length)} 章（可在回收站找回）` : ""}`, 8000);
				return;
			}
			case "activate-volume": {
				const vols = await this.manager.volumeList(a.story);
				const name = vols.find((v) => v.id === a.id)?.name ?? a.id;
				const r = await this.manager.activateVolume(a.story, a.id); // 设 current_volume 并切到该卷最后一章
				new Notice(r.num != null ? `已启用「${name}」，切换到${this.chapterLabel(r.num)}` : `已将「${name}」设为当前卷（暂无归属章节）`, 4000);
				if (r.path) await this.manager.openMarkdown(r.path);
				return;
			}
			case "export-volume": {
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留先归位：导出按物理位置判归属
				const vols = await this.manager.volumeList(a.story);
				const vol = vols.find((v) => v.id === a.id);
				if (!vol) throw new Error(`卷 ${a.id} 不存在或已被删除`);
				const specText = await this.prompt(`导出（卷「${vol.name}」）`, "输入范围表达式（留空/all=该卷全部章节）", [
					"将该卷内所选范围的《章节.md》正文合一 MD，按章序排列、文件首行带本卷标题；默认存 <书名>-<卷名>-范围.md（不支持自定义文件名/路径，重导覆盖同名文件）。范围写法：",
					"· 留空 / all / 全部 —— 该卷全部章节",
					"· 区间 —— 如 3-7 或 三至七（该卷内本地章号，自动升序去重）",
					"· 列表 —— 如 1、4、5（顿号/逗号/空格分隔均可）",
				].join("\n"));
				if (specText == null) return;
				const r = await this.manager.packStory(a.story, specText.trim(), vol.id, ""); // 锁定本卷：留空=all 即该卷全章；默认名 <书名>-<卷名>-范围.md
				const words = r.packed.reduce((s, p) => s + p.words, 0);
				new Notice(`已生成 ${r.path}（共 ${r.packed.length} 章，纯文字 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}`, 8000);
				await this.manager.openMarkdown(r.path);
				return;
			}
			case "export-story": {
				const specText = await this.prompt("导出书稿", "输入范围表达式（留空/all=整本）", [
					"将所选范围内全部章节的《章节.md》正文合一 MD，阅读序排列。有卷模式每个卷组前带「# 第N卷 · 卷名」标题行（无章的空卷也照样输出其卷名），无卷模式平铺不带；章标题行为「## 第N章 章节名」。范围写法：",
					"· 留空 / all / 全部 —— 整本（含书根未归卷 + 各卷）",
					"· 区间 —— 如 3-7 或 三至七（自动升序去重；多卷书可加卷名前缀限定，如 风起:3-7、第一卷,2-5）",
					"· 列表 —— 如 1、4、5（顿号/逗号/空格分隔均可）",
					"· 裸号跨多个卷重名时会弹选择器让你选所在卷",
				].join("\n"));
				if (specText == null) return;
				const outText = await this.prompt("输出路径", "输出位置（留空用默认文件名）", [
					"· 留空 —— 限定某卷时存到该小说目录下 <书名>-<卷名>-范围.md（如 <书名>-风起-第3-7章.md；单章为 -第N章、离散号为 -第1、4、5章），整本/书根域为 <书名>-书稿.md（重导覆盖同名文件）",
					"· 以 .md 结尾 —— 视为完整文件名，原样使用",
					"· 其他 —— 视为目标目录，自动拼上对应默认文件名",
				].join("\n"));
				if (outText == null) return;
				try {
					let r: Awaited<ReturnType<typeof this.manager.packStory>>;
					try {
						r = await this.manager.packStory(a.story, specText.trim(), undefined, outText.trim());
					} catch (e2) {
						if (!String((e2 as Error)?.message).includes("PACK_AMBIGUOUS_CONTAINER")) throw e2; // 裸号跨容器有歧义 → 选容器后以 forcedVolId 重入
						const vols = await this.manager.volumeList(a.story);
						const idx = await this.pickAction("章节号在多个容器里都存在，请选择所在卷", vols.map((v) => ({ label: v.name })));
						if (idx == null) return;
						r = await this.manager.packStory(a.story, specText.trim(), vols[idx].id, outText.trim());
					}
					const words = r.packed.reduce((s, p) => s + p.words, 0);
					new Notice(`已生成 ${r.path}（${r.packed.length} 章，纯文字共 ${words} 字${r.skipped.length ? `；跳过无正文：${r.skipped.map((n) => this.chapterLabel(n)).join("、")}` : ""}）`, 8000);
					await this.manager.openMarkdown(r.path);
				} catch (e) {
					this.notifyError("导出书稿失败", e);
				}
				return;
			}
			case "vol-outline-generate": {
				// v0.2.x+「书稿」小节标题行右键：书级语义——无卷→按书级《大纲.md》声明自动建卷并逐卷生成；有卷→当前卷/选择器（与命令面板同语义）
				if ((this.settings.lastStory || "").trim() !== a.story) await this.applyStorySwitch(a.story);
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留先归位：该命令按卷操作
				const st = await this.manager.loadState(a.story);
				if (st?.use_volumes === false) { new Notice(NO_VOL_MODE_MSG, 10000); return; } // 无卷模式没有卷大纲
				await this.cmdGenerateVolOutline();
				return;
			}
			case "book-outline-generate": {
				// v0.2.x+「书稿」标题行右键：生成书级《大纲.md》——平铺/有卷两模式通用（平铺=逐章规划、有卷=卷声明），无需卷检查
				if ((this.settings.lastStory || "").trim() !== a.story) await this.applyStorySwitch(a.story);
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留先归位
				await this.cmdGenerateBookOutline();
				return;
			}
			case "vol-outline-to-chapters":
			case "vol-outline-sync": {
				// 卷节点右键的卷大纲工作流入口：锁定被点卷、不弹选择器（写字台只渲染激活书小节，切书为防御性兜底）
				// v0.2.x+ 平铺（无卷）模式：不带 id 的 to-chapters=「从书级大纲生成章节…」→ 拆书级《大纲.md》、章节落书根
				if ((this.settings.lastStory || "").trim() !== a.story) await this.applyStorySwitch(a.story);
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留先归位：两条命令均按卷操作
				const st = await this.manager.loadState(a.story);
				if (a.kind === "vol-outline-to-chapters" && !a.id && st?.use_volumes === false) {
					await this.cmdVolumeOutlineToChapters(); // 平铺：无参 → 读书级《大纲.md》
					return;
				}
				if (st?.use_volumes === false) { new Notice(NO_VOL_MODE_MSG, 10000); return; } // 无卷模式没有卷大纲
				const vols = await this.manager.volumeList(a.story);
				if (!vols.find((v) => v.id === a.id)) throw new Error(`卷 ${a.id} 不存在或已被删除`);
				if (a.kind === "vol-outline-to-chapters") await this.cmdVolumeOutlineToChapters(a.id);
				else await this.cmdSyncVolOutlineChapters(a.id);
				return;
			}
			case "write-consecutive": {
				// v0.2.x+ 右键「连续编写」：带 id=卷节点——限该卷内连续编写；不带 id=「书稿」标题行——全书语义（与命令面板同义）
				if ((this.settings.lastStory || "").trim() !== a.story) await this.applyStorySwitch(a.story);
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留先归位
				if (a.id) {
					const st = await this.manager.loadState(a.story);
					if (st?.use_volumes === false) { new Notice(NO_VOL_MODE_MSG, 10000); return; } // 防御：无卷模式没有卷节点
					const vols = await this.manager.volumeList(a.story);
					if (!vols.find((v) => v.id === a.id)) throw new Error(`卷 ${a.id} 不存在或已被删除`);
					await this.cmdWriteConsecutive(a.id);
				} else {
					await this.cmdWriteConsecutive();
				}
				return;
			}
			case "book-outline-to-volumes": {
				// 「书籍列表」标题行右键：按书级《大纲.md》生成其声明的全部卷（写字台只渲染激活书小节，切书为防御性兜底）
				if ((this.settings.lastStory || "").trim() !== a.story) await this.applyStorySwitch(a.story);
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留先归位：本命令按卷操作
				const st = await this.manager.loadState(a.story);
				if (st?.use_volumes === false) { new Notice(NO_VOL_MODE_MSG, 10000); return; } // 无卷模式没有卷大纲
				await this.cmdBookOutlineToVolumes();
				return;
			}
			case "rename-chapter": {
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const curNum = parseChKey(a.key).num;
				const cur = (await this.manager.loadState(a.story))?.chapters[a.key]?.title ?? "";
				const t = await this.prompt(`重命名 ${this.chapterLabel(curNum, cur)}`, `新标题（当前：${cur || "无"}）`);
				if (!t?.trim()) return;
				const newTitle = await this.manager.renameChapter(a.story, a.key, t.trim()); // 重命名目录并同步各文档中的旧标题引用
				new Notice(`已改名为 ${this.chapterLabel(curNum, newTitle)}，目录与文档引用已同步`, 6000);
				return;
			}
			case "insert-chapter": {
				// 右键所在章节即参照章、方向已定：只问标题（留空以编号作标题），复用 manager.insertChapter 的顺延+引用重写
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const refNum = parseChKey(a.key).num;
				const newNum = a.pos === "before" ? refNum : refNum + 1;
				const t = await this.prompt(`新建第${newNum}章`, `插入到 ${this.chapterLabel(refNum)} ${a.pos === "before" ? "之前" : "之后"}的章节标题`);
				if (t == null) return;
				const title = t.trim() || String(newNum);
				const r = await this.manager.insertChapter(a.story, a.key, a.pos, title);
				new Notice(`${this.chapterLabel(r.newNum, title)} 已插入；后续章节号与文档引用已顺延更新`, 6000);
				if (this.settings.autoOpenOnCreate) await this.manager.openMarkdown(r.path);
				return;
			}
			case "delete-chapter": {
				if (!(await this.ensureVolumeLayout(a.story))) return; // 平面残留 → 先引导按卷整理
				const st = await this.manager.loadState(a.story);
				const meta = st?.chapters[a.key];
				const delNum = parseChKey(a.key).num;
				const ok = await this.confirmBox(`删除第${String(delNum).padStart(2, "0")}章${meta?.title ? " " + meta.title : ""}？`, "章节目录将移入 Obsidian 回收站，元数据与卷归属一并清理；若为当前章节则回退到最后一章。其后的各章会自动重新排号、保持连续编号。", "删除");
				if (!ok) return;
				const r = await this.manager.deleteChapter(a.story, a.key);
				new Notice(`章节已删除（可在回收站找回）${r.resequenced ? "；后续章节已自动重新排号为连续" : ""}`);
				return;
			}
			case "chapter-to-screenplay": {
				await this.cmdChapterToScreenplay(a.story, a.key);
				return;
			}
			case "sensitive-check": {
				await this.cmdSensitiveCheck(a.story, a.key); // v0.4.6+ 写字台章节右键：锁定被点章、不弹章选择
				return;
			}
			case "new-file": {
				if (a.folder) {
					// 案头资料文件夹行右键「新建文章…」：在该文件夹内新建 .md（仅自定义文件名，无标准文档清单）
					const folder = a.folder;
					if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw new Error("该文件夹不存在或已被移动");
					const res = await this.pickNewDoc(`在「${folder.split("/").pop() ?? folder}」新建文章`, []);
					if (res == null) return;
					await this.createVaultDefaultDoc(folder, res.name); // v0.4.7+：vault 默认方式创建（同名顺延＋自动打开，无 Notice/确认）
					return;
				}
				const target = a.key == null ? {} : { chKey: a.key }; // 书级（案头资料）或章节目录
				const stds = await this.manager.standardDocs(a.story, target); // 标准模板文档列出（参与提示词者），已存在禁用
				const res = await this.pickNewDoc(`新建${a.key == null ? "资料" : "文章"}（${a.key == null ? "书根目录（案头资料）" : "该章节目录"}）`, stds); // v0.1.8+：全宽输入框+底部「确定」单视图，不再多窗
				if (res == null) return;
				if (res.kind === "std") {
					const s = stds.find((o) => o.name === res.name)!;
					if (s.exists) { // 选中的标准文档已存在→弹存在性提示，用户确认后才以模板空内容替换
						const ok = await this.confirmBox(`${res.name} 已存在`, "将用模板空内容替换其现有文字。", "替换");
						if (!ok) return;
						await this.manager.overwriteStandardDoc(a.story, target, res.name);
						new Notice(`已将 ${res.name} 替换为模板空内容`);
						return;
					}
					const created = await this.manager.ensureStandardDoc(a.story, target, res.name); // 不存在直接按模板创建
					new Notice(created ? `已创建 ${res.name}（模板）` : `${res.name} 已存在，未改动`);
					return;
				}
				let folder: string;
				if (a.key == null) {
					folder = this.manager.deskDocsPath(a.story); // 书级自定义资料落「案头资料/」（无卷模式的自定义文档即落此处）
				} else {
					const ch = (await this.manager.listChapters(a.story)).find((c) => c.key === a.key); // 以磁盘为准取真实章节目录（含章名）
					if (!ch) throw new Error(`第${parseChKey(a.key).num}章不存在`);
					folder = ch.dir.path;
				}
				await this.createVaultDefaultDoc(folder, res.name); // v0.4.7+：vault 默认方式创建（同名顺延＋自动打开）
				return;
			}
			case "delete-file": {
				const f = this.app.vault.getAbstractFileByPath(a.path);
				if (!(f instanceof TFile)) throw new Error("文件不存在或已被移动");
				if (f.name === "故事状态.md") throw new Error("不能删除小说状态文档（需要重置请用「重建小说状态」命令）");
				const ok = await this.confirmBox(`删除文件 ${f.path}？`, "将移入 Obsidian 回收站，可从中找回。", "删除");
				if (!ok) return;
				await this.app.fileManager.trashFile(f);
				new Notice(`${f.name} 已删除（可在回收站找回）`);
				return;
			}
			case "delete-folder": {
				const f = this.app.vault.getAbstractFileByPath(a.path);
				if (!(f instanceof TFolder)) throw new Error("文件夹不存在或已被移动");
				if (f.name === DESK_DOCS_DIR_NAME || f.name === MANUSCRIPT_DIR_NAME) throw new Error(`「${f.name}」是系统容器目录，不能删除`); // 双保险：这两类容器不会出现在案头资料列表里
				const ok = await this.confirmBox(`删除文件夹 ${f.path} 及其全部内容？`, "将整体移入 Obsidian 回收站，可从中找回。", "删除");
				if (!ok) return;
				await this.app.fileManager.trashFile(f);
				new Notice(`${f.name} 已删除（可在回收站找回）`);
				return;
			}
			case "new-volume-doc": {
				const vols = await this.manager.loadVolumes(a.story);
				const vol = this.manager.findVolumeIn(vols, a.volId); // 按 id/名解析目标卷
				if (!vol) throw new Error(`卷 ${a.volId} 不存在或已被删除`);
				const target = { volId: vol.id };
				const stds = await this.manager.standardDocs(a.story, target); // 设定五件套列出，已存在禁用
				const res = await this.pickNewDoc(`在卷「${vol.name}」新建文档`, stds); // v0.1.8+：全宽输入框+底部「确定」单视图，不再多窗
				if (res == null) return;
				if (res.kind === "std") {
					const s = stds.find((o) => o.name === res.name)!;
					if (s.exists) { // 选中的标准文档已存在→弹存在性提示，用户确认后才以模板空内容替换
						const ok = await this.confirmBox(`${res.name} 已存在`, `将在卷「${vol.name}」用模板空内容替换其现有文字。`, "替换");
						if (!ok) return;
						await this.manager.overwriteStandardDoc(a.story, target, res.name);
						new Notice(`已将 ${res.name} 替换为模板空内容`);
						return;
					}
					const created = await this.manager.ensureStandardDoc(a.story, target, res.name); // 不存在直接按模板创建
					new Notice(created ? `已在卷「${vol.name}」创建 ${res.name}（模板）` : `${res.name} 已存在，未改动`);
					return;
				}
				const folder = this.manager.volumeDocsDirPath(a.story, vol); // v0.4.7+ 修复：落点＝卷实体目录下的「文档」子目录（与写字台卷内「文档」列表同一目录；旧实现写卷根，文件建出来了但面板看不到）
				if (!(this.app.vault.getAbstractFileByPath(this.manager.volumeDirPath(a.story, vol)) instanceof TFolder)) throw new Error("该卷实体目录缺失，请先执行「按卷整理目录」");
				await this.createVaultDefaultDoc(folder, res.name); // 目录不存在时逐级补建，建完自动在编辑器打开
				return;
			}
			case "complete-volume-docs": {
				const vols = await this.manager.loadVolumes(a.story);
				const vol = this.manager.findVolumeIn(vols, a.volId); // 按 id/名解析目标卷
				if (!vol) throw new Error(`卷 ${a.volId} 不存在或已被删除`);
				const created = await this.manager.ensureVolumeDocs(a.story, vol.id); // 缺失的设定模板补建，已存在保留不覆盖
				new Notice(created.length ? `已为卷「${vol.name}」补全缺失文档：${created.join("、")}` : `卷「${vol.name}」的模板文档已齐全（卷大纲/人物/人物关系/场景），无需补全`, 8000);
				return;
			}
			case "complete-root-docs": {
				const created = await this.manager.ensureRootDocs(a.story); // 书根默认资料九件套补缺，已存在保留不覆盖（张力规则已并入系统技能张力工具箱，不再播种）
				new Notice(created.length ? `已为「${a.story}」补全缺失资料：${created.join("、")}` : `「${a.story}」的默认资料文件已齐全（大纲/策划指南/世界观/伏笔/笔记/人物/人物关系/场景/时间线），无需补全`, 8000);
				return;
			}
			case "skill-new":
				await this.editSkillFlow(a.story, null); // v0.3.4+：写字台案头资料右键「新建 Skill…」（创建与配置解耦，保存只落盘不进配置）
				return;
			case "book-skill-phases":
				await this.phaseBookSkillFlow(a.story, this.bookSkillPhaseDefs()); // v0.3.4+：写字台案头资料右键直达五阶段选用配置
				return;
			case "inspiration-kit":
				await this.cmdInspirationKit(a.story); // v0.4.3+：写字台「案头资料」标题行/灵感文件夹行右键（按该书的《案头资料/灵感/灵感.md》操作，不必先切书）
				return;
			case "complete-outline-docs": {
				const created = await this.manager.ensureOutlineDocs(a.story); // 参与大纲生成的四件资料补缺，已存在保留不覆盖
				new Notice(created.length ? `已为「${a.story}」补全大纲资料：${created.join("、")}` : `「${a.story}」的大纲资料已齐全（大纲/策划指南/世界观/人物关系），无需补全`, 8000);
				return;
			}
			case "new-prologue": {
				const created = await this.manager.ensurePrologue(a.story); // 幂等：已有「引言」文件夹则不覆盖
				new Notice(created ? `已在「${a.story}」书根创建「引言」文件夹并播种正文《引言.md》` : `「${a.story}」已有「引言」文件夹，未改动`);
				return;
			}
			case "delete-prologue": {
				const ok = await this.confirmBox(`删除「${a.story}」的引言？`, `整个书根「引言」文件夹将移入 Obsidian 回收站，可从中找回。`, "删除");
				if (!ok) return;
				await this.manager.deletePrologue(a.story);
				new Notice(`引言已删除（可在回收站找回）`);
				return;
			}
			case "new-prologue-doc": {
				const folder = this.manager.prologuePath(a.story);
				if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw new Error("「引言」文件夹不存在，请先在「书稿」标题右键「新建引言…」创建");
				const res = await this.pickNewDoc("在引言新建文档", []); // 仅自定义文件名（无标准文档清单）
				if (res == null) return;
				await this.createVaultDefaultDoc(folder, res.name); // v0.4.7+：vault 默认方式创建（同名顺延＋自动打开）
				return;
			}
			case "complete-chapter-docs": {
				const created = await this.manager.ensureChapterDocs(a.story, a.key); // 该章节目录缺失的标准模板文档补缺，已存在保留不覆盖
				const ch = (await this.manager.listChapters(a.story)).find((c) => c.key === a.key); // chapterDirOf 为私有，经公开列表解析展示标签
				const label = ch ? `第${String(ch.num).padStart(2, "0")}章 ${ch.title}` : a.key;
				new Notice(created.length ? `已为${label}补全缺失文档：${created.join("、")}` : `${label}的模板文档已齐全（章节/章节大纲/人物/人物关系/场景/章节信息），无需补全`, 8000);
				return;
			}
			case "llm-write":
			case "llm-continue":
			case "llm-polish": {
				await this.statusRunWriting(a.kind, a.story, a.key); // 章节行右键的 LLM 写作入口
				return;
			}
		}
	}

	/** 状态面板章节行右键调用 LLM 写作命令：先把目标书/章设为当前（与点章节名激活同语义），再复用对应命令的既有交互流程（创作要点输入、流式预览确认等全部保留） */
	private async statusRunWriting(kind: "llm-write" | "llm-continue" | "llm-polish", story: string, key: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		if ((this.settings.lastStory || "").trim() !== story) {
			await this.applyStorySwitch(story); // v0.2.1+：统一入口——归档旧书 + 持久化 + 恢复目标书的工作区，并广播刷新 LLM 面板上下文行
		}
		await this.statusActivateChapter(story, key); // 写回 current_chapter + 同步所属卷
		switch (kind) {
			case "llm-write": await this.cmdWrite(); break;
			case "llm-continue": await this.cmdContinueWriting(); break;
			case "llm-polish": await this.cmdPolishText(); break;
		}
	}

	/** 当前活动小说快照（供对话面板头部展示）：非交互读取 lastStory+状态；无有效当前小说返回 null */
	async getActiveStoryInfo(): Promise<{ story: string; chapterNum: number; chapterTitle: string } | null> {
		const s = this.settings.lastStory?.trim();
		if (!s || !(await this.manager.listStories()).includes(s)) return null;
		let chapterNum = 1;
		let chapterTitle = "";
		try {
			const st = await this.manager.loadState(s);
			const curKey = st?.current_chapter ?? null;
			if (curKey != null) {
				chapterNum = parseChKey(curKey).num; // v0.0.15：current_chapter 为复合键，展示用本地章号
				const ch = (await this.manager.listChapters(s)).find((c) => c.key === curKey);
				chapterTitle = ch?.title || "";
			}
		} catch {
			/* 状态/章节读取失败仍显示小说名与默认章号 */
		}
		return { story: s, chapterNum, chapterTitle };
	}

	/** 对话专用系统提示词（对齐 chat.py `_chat_reply` + `_build_chat_context`）：
	 * 友好写作助手身份 + 当前小说上下文快照(写作上下文+当前章节正文截断6000字)。
	 * v0.3.5+：旧【创作规范】（三层《WRITING_GUIDE.md》指南）已随写作指南体系废弃，对话只带身份与上下文快照。
	 * 无当前小说=仅身份；任一部分构建失败不阻断整体（回退纯问答，对齐 CLI「某部分失败不影响整体」）。恒返回非 null。 */
	/** v0.4.3+ 对话窗口引用文档装配：按「对话引用清单」（LLM 配置 → chat_ref_docs，机制同写作阶段 ref_docs）把内置文档/技能/vault 文档拼成提示词块串。
	 *  清单空/未配置＝返回空串（保持既有对话上下文行为不变）；内置 key 复用阶段装配同口径 spec 与去重清洗；任一条读取失败不阻断（装配器跳过）。 */
	private async buildChatRefDocs(story: string): Promise<string> {
		const list = this.settings.llm?.chat_ref_docs ?? [];
		if (!list.length) return "";
		try {
			const state = await this.manager.loadState(story);
			if (!state) return "";
			return (await assemblePromptFiles(this.promptReader(), this.orderRefDocSpecs(await this.chatRefDocPairs(story, state), list))).text;
		} catch {
			return ""; // 状态/文档读取失败＝不带附加引用文档，不阻断对话
		}
	}

	/** 对话内置引用文档 spec 对（buildChatRefDocs 清单装配与 v0.4.6+ 自然提及自动加载共用）：key→PromptSpec，含时间线合并/人物关系兜底路径等全部口径 */
	private async chatRefDocPairs(story: string, state: StoryState): Promise<Array<{ key: string; spec: PromptSpec }>> {
		const desk = this.manager.deskDocsPath(story);
		return [
			{ key: "book_info", spec: { text: bookInfoText(state.title, state.genre, state.writing_style), header: HDR_BOOK_INFO } },
			{ key: "worldview", spec: { file: `${desk}/世界观.md`, header: HDR_WORLD, stripHeading: false } }, // 与阶段口径一致：stripComments 后全文（含 H1）
			{ key: "timeline", spec: { text: await this.manager.mergedTimelineText(story), header: "【时间线】" } }, // 三层《时间线.md》合并时间轴，无有效条目＝空块不注入
			{ key: "book_outline", spec: { file: `${desk}/大纲.md`, header: "【全书大纲】", stripHeading: true } },
			{ key: "planning_guide", spec: { file: this.manager.planningGuidePath(story), header: "【策划指南】", stripHeading: true } },
			{ key: "book_relations", spec: { file: await this.manager.bookRelationshipsDocPath(story), header: "【书级人物关系】", stripComments: false, transform: cleanRelationshipsDoc } },
		];
	}

	/** v0.4.6+ 对话「自然提及自动加载」：从用户原始输入 detectChatAutoRefs（识别规则见 src/chat_refs.ts），
	 *  把提及的章节正文/卷大纲/内置文档读盘拼成 @ 引用同款「=== 标签 ===」块串，随本轮 user 消息注入上下文。
	 *  无当前小说/无命中/任何读取失败＝返回空（不阻断发送）；labels＝状态行与气泡「自动加载：…」清单。 */
	private async collectChatAutoRefBlocks(raw: string): Promise<{ text: string; labels: string[] }> {
		const story = this.settings.lastStory?.trim();
		if (!story || !raw.trim()) return { text: "", labels: [] };
		try {
			const state = await this.manager.loadState(story);
			if (!state) return { text: "", labels: [] };
			const titles: string[] = [];
			for (const meta of Object.values(state.chapters ?? {})) {
				const t = (meta.title ?? "").trim();
				if (t.length >= 2) titles.push(t);
			}
			const specs = detectChatAutoRefs(raw, titles);
			if (!specs.length) return { text: "", labels: [] };
			const parts: string[] = [];
			const labels: string[] = [];
			const entries = Object.entries(state.chapters ?? {});
			let volMap: Record<string, VolumeInfo> = {};
			try { volMap = await this.manager.loadVolumes(story); } catch { /* 无卷数据：卷引用跳过、章归属排序退化 */ }
			const curVol = state.current_chapter ? parseChKey(state.current_chapter).vol : null;
			// 章正文：同章号跨卷歧义→当前卷优先，其次按卷 order
			const chapterBlock = async (key: string, metaLabel: string, label: string): Promise<void> => {
				const f = await this.manager.chapterBodyFile(story, key);
				if (!f) return;
				parts.push(`\n=== ${f.path}（${metaLabel} · 对话自动加载）===\n${await this.app.vault.cachedRead(f)}\n`);
				labels.push(label);
			};
			for (const spec of specs) {
				if (spec.kind !== "chapter") continue;
				for (const num of spec.nums) {
					const key = this.chatChapterCandidates(entries, num, volMap, curVol)[0]; // 跨卷同号：当前卷优先（与 read_chapter 工具同口径）
					if (!key) continue;
					const meta = state.chapters?.[key];
					const t = (meta?.title ?? "").trim();
					await chapterBlock(key, `第${String(num)}章${t ? `《${t}》` : ""}`, t ? `第${String(num)}章《${t}》` : `第${String(num)}章`);
				}
			}
			// 《标题》/标题提及：先按章标题（精确>包含）解析成章正文，解不到再试内置文档名映射，再回落案头资料同名文档
			const docNameKeys: Record<string, string> = { 故事状态: "story_state", 世界观: "worldview", 人物关系: "book_relations", 时间线: "timeline", 大纲: "book_outline", 全书大纲: "book_outline", 策划指南: "planning_guide" };
			const desk = this.manager.deskDocsPath(story);
			const wantDocs = new Set(specs.filter((s) => s.kind === "doc").map((s) => s.docKey ?? ""));
			for (const spec of specs) {
				if (spec.kind !== "title") continue;
				const t = (spec.title ?? "").trim();
				if (!t) continue;
				const hit = entries.find(([, m]) => (m.title ?? "").trim() === t) ?? entries.find(([, m]) => { const mt = (m.title ?? "").trim(); return mt.length >= 2 && (mt.includes(t) || t.includes(mt)); });
				if (hit) { await chapterBlock(hit[0], `《${t}》`, `《${t}》章节`); continue; }
				const mapped = docNameKeys[t];
				if (mapped) { wantDocs.add(mapped); continue; }
				const f = this.app.vault.getAbstractFileByPath(`${desk}/${t}.md`);
				if (f instanceof TFile) {
					parts.push(`\n=== ${f.path}（《${t}》 · 对话自动加载）===\n${await this.app.vault.cachedRead(f)}\n`);
					labels.push(`《${t}》`);
				}
			}
			// 卷：第N卷 → 按 order 匹配的《卷大纲.md》
			for (const spec of specs) {
				if (spec.kind !== "volume") continue;
				const vol = Object.values(volMap).find((v) => v.order === spec.nums[0]) ?? Object.values(volMap).find((v) => v.name.includes(String(spec.nums[0])));
				if (!vol) continue;
				const p = this.manager.volumeDocPath(story, vol, "卷大纲");
				const body = (await this.manager.readDoc(p)).trim();
				if (!body) continue;
				parts.push(`\n=== ${p}（第${String(spec.nums[0])}卷《${vol.name}》卷大纲 · 对话自动加载）===\n${body}\n`);
				labels.push(`第${String(spec.nums[0])}卷《${vol.name}》大纲`);
			}
			// 内置文档（关键词命中或《文档名》提及）：复用 chatRefDocPairs 口径经装配器读取；故事状态＝格式化摘要而非原文件
			const stateText = this.storyStateSnapshot(state, volMap);
			const pairs = [...(await this.chatRefDocPairs(story, state)), { key: "story_state", spec: { text: stateText, header: "【故事状态】" } }];
			const selected = pairs.filter((p) => wantDocs.has(p.key)).map((p) => p.spec);
			if (selected.length) {
				const assembled = await assemblePromptFiles(this.promptReader(), selected);
				if (assembled.text.trim()) parts.push(assembled.text);
				const docLabels: Record<string, string> = { story_state: "故事状态", worldview: "世界观", timeline: "时间线", book_outline: "全书大纲", planning_guide: "策划指南", book_relations: "人物关系" };
				for (const p of pairs) {
					if (!wantDocs.has(p.key) || !docLabels[p.key]) continue;
					if (p.spec.file && !this.app.vault.getAbstractFileByPath(p.spec.file)) continue; // 文档不存在＝未注入也不列进清单
					labels.push(docLabels[p.key]);
				}
			}
			return { text: parts.join("\n"), labels };
		} catch {
			return { text: "", labels: [] }; // 任何读盘/解析意外都不阻断对话发送
		}
	}

	/** 《故事状态.md》对话用格式化摘要（自动加载「故事状态」时注入；只给关键进度事实，不塞 frontmatter 原文） */
	private storyStateSnapshot(state: StoryState, volMap: Record<string, VolumeInfo>): string {
		const lines = [`书名：${state.title}｜题材：${state.genre}｜风格：${state.writing_style}`];
		const chapterCount = Object.keys(state.chapters ?? {}).length;
		lines.push(`${state.use_volumes ? `有卷模式（${String(Object.keys(volMap).length)} 卷）` : "平铺模式"} · 已建 ${String(chapterCount)} 章 · 正文合计 ${String(state.total_words)} 字`);
		if (state.current_chapter) {
			const ck = parseChKey(state.current_chapter);
			const meta = state.chapters?.[state.current_chapter];
			const volName = ck.vol ? volMap[ck.vol]?.name ?? ck.vol : "";
			lines.push(`当前章：${volName ? `${volName} · ` : ""}第${String(ck.num)}章${meta?.title ? `《${meta.title}》` : ""}`);
		}
		if (state.word_range) lines.push(`章字数区间：${String(state.word_range[0])}–${String(state.word_range[1])}`);
		if (state.one_line?.trim()) lines.push(`一句话设定：${state.one_line.trim()}`);
		return lines.join("\n");
	}

	// ---------- v0.4.6+ 对话工具调用（function calling 执行侧；工具定义见 src/chat_tools.ts） ----------

	/** 写作命令代跑上下文：chatExecTool 设定→命令内部经 prompt()/targetChapterKey() 接缝消费→命令结束清空；instruction=null＝不预答任何弹窗（如新建章的标题输入） */
	private chatToolCtx: { chapterKey: string; instruction: string | null; instructionUsed: boolean } | null = null;

	/** 工具结果统一截断（防单条 tool 消息炸窗口） */
	private clipToolResult(s: string): string {
		return s.length > TOOL_RESULT_MAX_CHARS ? `${s.slice(0, TOOL_RESULT_MAX_CHARS)}\n…（结果过长已截断）` : s;
	}

	/** 按章号取候选章节复合键（跨卷同号→当前卷优先、再按卷 order；自动加载与 read_chapter/写作工具共用口径） */
	private chatChapterCandidates(
		entries: Array<[string, { title?: string; words?: number; volume?: string }]>,
		num: number,
		volMap: Record<string, VolumeInfo>,
		curVol: string | null
	): string[] {
		return entries
			.filter(([k]) => parseChKey(k).num === num)
			.sort(([ka], [kb]) => {
				const va = parseChKey(ka).vol === curVol ? 0 : 1;
				const vb = parseChKey(kb).vol === curVol ? 0 : 1;
				if (va !== vb) return va - vb;
				return (volMap[parseChKey(ka).vol ?? ""]?.order ?? 0) - (volMap[parseChKey(kb).vol ?? ""]?.order ?? 0);
			})
			.map(([k]) => k);
	}

	/** 对话工具执行入口（LlmChatView 经构造第 8 参转交）：任何异常都转成给模型的文本、不抛断工具循环 */
	async chatExecTool(name: string, argsJson: string): Promise<string> {
		const args = parseToolArgs(argsJson);
		const story = this.settings.lastStory?.trim();
		const resolved = resolveToolName(name); // v0.4.7+ 工具名容错：模型常串出 read_file / list_files / grep / write_file 这类通用 agent 工具名
		if (resolved.mapped) new Notice(`模型调了不存在的工具「${name}」，已改按「${resolved.name}」执行（参数原样传）`, 6000);
		name = resolved.name;
		try {
			if (name === "save_content_to_file") return await this.chatToolSaveToFile(args); // 不依赖当前书（回落 work_dir）；SaveReplyModal 人证落盘
			if (CHAT_GENERATION_TOOLS.includes(name)) {
				if (!story) return "当前没有选定小说，无法执行生成命令。";
				return await this.runChatGenerationTool(name, story, args);
			}
			if (CHAT_WRITING_TOOLS.includes(name)) {
				if (!story) return "当前没有选定小说，无法执行写作命令。";
				return await this.runChatWritingTool(name, story, args);
			}
			if (!story) return "当前没有选定小说，该工具不可用。";
			switch (name) {
				case "read_chapter":
					return await this.chatToolReadChapter(story, args);
				case "read_doc":
					return await this.chatToolReadDoc(story, args);
				case "read_chapter_outline":
					return await this.chatToolReadChapterOutline(story, args);
				case "read_volume_outline":
					return await this.chatToolReadVolumeOutline(story, args);
				case "set_current_chapter":
					return await this.chatToolSetCurrentChapter(story, args);
				case "list_chapters":
					return await this.chatToolListChapters(story);
				case "search_vault":
					return await this.chatToolSearch(story, args);
				default:
					return unknownToolHint(name); // 纠正型结果：列候选＋全量名单，模型下一轮自己改对
			}
		} catch (e) {
			return `工具 ${name} 执行失败：${e instanceof Error ? e.message : String(e)}`;
		}
	}

	private async loadToolState(story: string): Promise<StoryState | null> {
		return await this.manager.loadState(story);
	}

	private async chatToolReadChapter(story: string, args: Record<string, unknown>): Promise<string> {
		const state = await this.loadToolState(story);
		if (!state) return "状态文档缺失，无法定位章节。";
		const num = pickNumberArg(args, CHAPTER_NUM_ARG_KEYS); // v0.4.7+ 参数键宽松（chapter_num/chapter/num…），也接受「第18章」这类字符串
		if (!Number.isFinite(num) || num <= 0) return "参数 chapter_num 无效（应为正整数章节号）。";
		let volMap: Record<string, VolumeInfo> = {};
		try { volMap = await this.manager.loadVolumes(story); } catch { /* 无卷数据退化当前卷优先 */ }
		const curVol = state.current_chapter ? parseChKey(state.current_chapter).vol : null;
		const key = this.chatChapterCandidates(Object.entries(state.chapters ?? {}), num, volMap, curVol)[0];
		if (!key) return `第${String(num)}章不存在。`;
		const f = await this.manager.chapterBodyFile(story, key);
		if (!f) return `第${String(num)}章正文文件未定位（可能尚未写作）。`;
		const meta = state.chapters?.[key];
		return this.clipToolResult(`【${this.keyLabel(key, await this.volNameMap(story).catch(() => ({})), meta?.title)} 正文】\n${await this.app.vault.cachedRead(f)}`);
	}

	private async chatToolReadDoc(story: string, args: Record<string, unknown>): Promise<string> {
		const name = normalizeDocName(pickStringArg(args, DOC_NAME_ARG_KEYS)); // v0.4.7+ 参数键宽松（doc_name/name/path/file…）＋归一（去《》/.md/目录前缀，收「书籍大纲」「年表」等说法）
		const alias: Record<string, string> = { 世界观: "worldview", 大纲: "book_outline", 全书大纲: "book_outline", 人物关系: "book_relations", 时间线: "timeline", 策划指南: "planning_guide", 故事状态: "story_state" };
		const key = alias[name];
		if (!key) return `参数 doc_name 无效（收到「${name || "空"}」；可选：世界观/大纲/人物关系/时间线/策划指南/故事状态，写书名或带 .md 的路径也认，如《时间线.md》）。`;
		const state = await this.loadToolState(story);
		if (!state) return "状态文档缺失。";
		if (key === "story_state") {
			let volMap: Record<string, VolumeInfo> = {};
			try { volMap = await this.manager.loadVolumes(story); } catch { /* 平铺书无卷 */ }
			return this.storyStateSnapshot(state, volMap);
		}
		const pair = (await this.chatRefDocPairs(story, state)).find((p) => p.key === key);
		if (!pair) return "该文档不存在。";
		const assembled = await assemblePromptFiles(this.promptReader(), [pair.spec]);
		const text = assembled.text.trim();
		return text ? this.clipToolResult(text) : `《${name}》文档不存在或为空。`;
	}

	private async chatToolListChapters(story: string): Promise<string> {
		const state = await this.loadToolState(story);
		if (!state) return "状态文档缺失。";
		let volMap: Record<string, VolumeInfo> = {};
		try { volMap = await this.manager.loadVolumes(story); } catch { /* 平铺书无卷 */ }
		const rows = Object.entries(state.chapters ?? {})
			.sort(([a], [b]) => (volMap[parseChKey(a).vol ?? ""]?.order ?? 0) - (volMap[parseChKey(b).vol ?? ""]?.order ?? 0) || parseChKey(a).num - parseChKey(b).num)
			.map(([k, m]) => `第${String(parseChKey(k).num)}章《${m.title || "无题"}》${parseChKey(k).vol ? `（${volMap[parseChKey(k).vol ?? ""]?.name ?? parseChKey(k).vol}）` : ""}${m.words ? ` ${String(m.words)}字` : ""}${k === state.current_chapter ? " ←当前章" : ""}`);
		return rows.length ? `共 ${String(rows.length)} 章：\n${rows.join("\n")}` : "尚无任何章节。";
	}

	private async chatToolSearch(story: string, args: Record<string, unknown>): Promise<string> {
		const kw = typeof args.keyword === "string" ? args.keyword.trim() : "";
		if (!kw) return "参数 keyword 无效。";
		const limit = Math.min(50, Math.max(1, typeof args.limit === "number" ? Math.trunc(args.limit) : 20));
		const base = this.manager.storyPath(story);
		const hits: string[] = [];
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (!f.path.startsWith(`${base}/`) || f.path.includes("/_resources/")) continue;
			const lines = (await this.app.vault.cachedRead(f)).split(/\r?\n/);
			for (let i = 0; i < lines.length; i++) {
				if (!lines[i].includes(kw)) continue;
				hits.push(`${f.path.replace(`${base}/`, "")}:${String(i + 1)}  ${lines[i].trim().slice(0, 160)}`);
				if (hits.length >= limit) break;
			}
			if (hits.length >= limit) break;
		}
		return hits.length ? hits.join("\n") : `未在当前小说内找到「${kw}」。`;
	}

	/** 读取最近生成面板的累积全文（独立方法避开 TS 对字段置 null 后的窄化——命令内部会重新赋值该字段） */
	private peekGenPanelText(): string {
		return this.lastGenPanel?.fullText ?? "";
	}

	/** 写作命令工具代跑：预置 chatToolCtx（章节直给＋要求预答）→ 当前章驱动型命令先切当前章（续写/重写/编写/润色读 current_chapter）→
	 *  跑原命令（生成过程面板＋保存确认全流程不变）→ 面板产出回灌给模型。review/deai 走 targetChapterKey 章直给、不动当前章指针 */
	private async runChatWritingTool(name: string, story: string, args: Record<string, unknown>): Promise<string> {
		const num = typeof args.chapter_num === "number" ? Math.trunc(args.chapter_num) : NaN;
		if (!Number.isFinite(num) || num <= 0) return "参数 chapter_num 无效（应为正整数章节号）。";
		const state = await this.loadToolState(story);
		if (!state) return "状态文档缺失，无法定位章节。";
		let volMap: Record<string, VolumeInfo> = {};
		try { volMap = await this.manager.loadVolumes(story); } catch { /* 平铺书无卷 */ }
		const curVol = state.current_chapter ? parseChKey(state.current_chapter).vol : null;
		const key = this.chatChapterCandidates(Object.entries(state.chapters ?? {}), num, volMap, curVol)[0];
		if (!key) return `第${String(num)}章不存在（不存在该章或尚未创建）。`;
		const rawInstr = typeof args.instruction === "string" ? args.instruction.trim() : "";
		const style = typeof args.style === "string" ? args.style.trim() : "";
		const isNewChapter = !(state.chapters ?? {})[key];
		// 全新章节走 /write 时第一个弹窗是「章节标题」——不预答（避免把要求当标题），让用户在弹窗里定标题
		const instruction = name === "write_chapter" && isNewChapter ? null : rawInstr || (name === "polish_chapter" ? style : "");
		const targetSeamOnly = name === "review_chapter" || name === "deai_chapter";
		if (!targetSeamOnly) await this.manager.switchChapter(story, key);
		this.chatToolCtx = { chapterKey: key, instruction, instructionUsed: false };
		this.lastGenPanel = null;
		try {
			if (name === "review_chapter") await this.cmdReviewChapter();
			else if (name === "continue_writing") await this.cmdContinueWriting();
			else if (name === "rewrite_chapter") await this.cmdRewriteChapter();
			else if (name === "write_chapter") await this.cmdWrite();
			else if (name === "polish_chapter") await this.cmdPolishText();
			else await this.cmdDeaiClean();
		} finally {
			this.chatToolCtx = null;
		}
		const out = this.peekGenPanelText().trim();
		const volNames = await this.volNameMap(story).catch(() => ({}));
		const label = this.keyLabel(key, volNames, state.chapters?.[key]?.title);
		const verb: Record<string, string> = { review_chapter: "审阅报告", continue_writing: "续写正文", rewrite_chapter: "重写正文", write_chapter: "章节正文", polish_chapter: "润色结果", deai_chapter: "去AI味结果" };
		const what = verb[name] ?? name;
		if (!out) return `${what}（${label}）已结束但没有产出（可能取消、被停止或前置校验未过，详见提示/生成面板）。`;
		return `已执行「${what}」· ${label}。完整结果已在「生成过程」面板展示，是否保存由用户决定。产出内容如下：\n${this.clipToolResult(out)}`;
	}

	/** 卷名→卷 id（工具参数用；未匹配返回 undefined＝按命令默认交互选择） */
	private async resolveToolVolId(story: string, nameArg: unknown): Promise<string | undefined> {
		const name = typeof nameArg === "string" ? nameArg.trim() : "";
		if (!name) return undefined;
		try {
			const vols = Object.values(await this.manager.loadVolumes(story));
			const hit = vols.find((v) => v.name === name) ?? vols.find((v) => v.name.includes(name));
			return hit?.id;
		} catch {
			return undefined;
		}
	}

	/** 全书各章正文字数快照（连续编写工具前后对比用：哪些章本轮被写上了正文） */
	private async chapterFilledMap(story: string): Promise<Map<string, number>> {
		const map = new Map<string, number>();
		for (const ch of await this.manager.listChapters(story)) {
			map.set(ch.key, countPureWords(await this.manager.readChapterContent(story, ch.key)));
		}
		return map;
	}

	/** 书级生成命令代跑：弹窗交互（生成模式/目标章数/覆盖确认/中断续跑三选）默认留给用户；
	 *  仅 generate_worldview 的一句话设定可由工具参数预答（该命令唯一 prompt）。产出读生成面板回灌，取消/无产出如实告知。
	 *  write_chapters_consecutive 特例：免确认自动保存、多章连写——不读面板文本，改以「正文前后差集」回灌本轮新写了哪些章 */
	private async runChatGenerationTool(name: string, story: string, args: Record<string, unknown>): Promise<string> {
		this.lastGenPanel = null;
		if (name === "generate_worldview") {
			const premise = typeof args.premise === "string" ? args.premise.trim() : "";
			if (premise) this.chatToolCtx = { chapterKey: "", instruction: premise, instructionUsed: false };
		}
		let consecutiveDiff = ""; // write_chapters_consecutive 专用回灌文本
		try {
			if (name === "generate_worldview") await this.cmdGenerateWorldview();
			else if (name === "generate_planning_guide") await this.cmdPlanningGuideWorldview();
			else if (name === "generate_timeline") await this.cmdGenerateTimeline();
			else if (name === "generate_book_outline") await this.cmdGenerateBookOutline();
			else if (name === "generate_vol_outline") await this.cmdGenerateVolOutline();
			else if (name === "outline_to_chapters") await this.cmdVolumeOutlineToChapters(await this.resolveToolVolId(story, args.volume_name));
			else if (name === "write_chapters_consecutive") {
				const before = await this.chapterFilledMap(story);
				await this.cmdWriteConsecutive(await this.resolveToolVolId(story, args.volume_name));
				const volNames = await this.volNameMap(story).catch(() => ({}));
				const state = await this.loadToolState(story);
				const newly: string[] = [];
				const stillEmpty: string[] = [];
				for (const [k, w] of await this.chapterFilledMap(story)) {
					const label = this.keyLabel(k, volNames, state?.chapters?.[k]?.title);
					if ((before.get(k) ?? 0) === 0 && w > 0) newly.push(`${label}（${String(w)}字）`);
					else if (w === 0) stillEmpty.push(label);
				}
				consecutiveDiff = newly.length
					? `「连续编写」已执行完毕（正文**自动保存**、无需再确认）：本轮新写 ${String(newly.length)} 章——${newly.join("、")}${stillEmpty.length ? `；仍无正文的章：${stillEmpty.join("、")}（可能缺大纲或中途停止）` : "；全书已有正文的章均已覆盖"}。`
					: `「连续编写」已执行但没有新写入正文（可能全部章节已有正文被跳过、缺章节大纲、或用户在生成面板点了停止）。`;
			}
		} finally {
			this.chatToolCtx = null;
		}
		if (consecutiveDiff) return consecutiveDiff;
		const out = this.peekGenPanelText().trim();
		const verb: Record<string, string> = {
			generate_worldview: "生成世界观",
			generate_planning_guide: "生成策划指南",
			generate_timeline: "生成时间线",
			generate_book_outline: "生成书籍大纲",
			generate_vol_outline: "生成卷大纲",
			outline_to_chapters: "从大纲生成章节",
			write_chapters_consecutive: "连续编写",
		};
		const what = verb[name] ?? name;
		if (!out) return `${what}：已结束但没有流式产出（可能用户在弹窗中取消、被停止，或命令直接写盘完成——请查看《案头资料》文档与通知确认结果）。`;
		return `已执行「${what}」（当前小说：${story}）。结果已在「生成过程」面板展示/写入流程已走完，是否保存由用户决定。产出内容如下：\n${this.clipToolResult(out)}`;
	}

	private async chatToolReadChapterOutline(story: string, args: Record<string, unknown>): Promise<string> {
		const state = await this.loadToolState(story);
		if (!state) return "状态文档缺失，无法定位章节。";
		const num = pickNumberArg(args, CHAPTER_NUM_ARG_KEYS); // v0.4.7+ 同 read_chapter：参数键与「第18章」写法都收
		if (!Number.isFinite(num) || num <= 0) return "参数 chapter_num 无效（应为正整数章节号）。";
		let volMap: Record<string, VolumeInfo> = {};
		try { volMap = await this.manager.loadVolumes(story); } catch { /* 平铺书无卷 */ }
		const key = this.chatChapterCandidates(Object.entries(state.chapters ?? {}), num, volMap, state.current_chapter ? parseChKey(state.current_chapter).vol : null)[0];
		if (!key) return `第${String(num)}章不存在。`;
		const txt = (await this.manager.readChapterOutlineForPrompt(story, key)).trim();
		return txt ? this.clipToolResult(`【第${String(num)}章 章节大纲】\n${txt}`) : `第${String(num)}章的《章节大纲》不存在或为空。`;
	}

	private async chatToolReadVolumeOutline(story: string, args: Record<string, unknown> = {}): Promise<string> {
		let volMap: Record<string, VolumeInfo> = {};
		try { volMap = await this.manager.loadVolumes(story); } catch { /* 无卷数据 */ }
		const vols = Object.values(volMap);
		if (!vols.length) return "本书为平铺结构（无卷），没有卷大纲。";
		const name = pickStringArg(args, VOL_NAME_ARG_KEYS); // v0.4.7+ 参数键宽松（volume_name/volume/vol…）
		let vol: VolumeInfo | undefined;
		if (name) vol = vols.find((v) => v.name === name) ?? vols.find((v) => v.name.includes(name));
		else {
			const state = await this.loadToolState(story);
			const curId = state?.current_volume ?? (state?.current_chapter ? parseChKey(state.current_chapter).vol : null);
			vol = curId ? volMap[curId] : undefined;
			if (!vol) return `未指定卷名。现有卷：${vols.sort((a, b) => a.order - b.order).map((v) => v.name).join("、")}`;
		}
		if (!vol) return `找不到卷「${name}」。现有卷：${vols.map((v) => v.name).join("、")}`;
		const body = (await this.manager.readDoc(this.manager.volumeDocPath(story, vol, "卷大纲"))).trim();
		return body ? this.clipToolResult(`【卷大纲 · ${vol.name}】\n${body}`) : `《${vol.name}》的卷大纲不存在或为空。`;
	}

	private async chatToolSetCurrentChapter(story: string, args: Record<string, unknown>): Promise<string> {
		const state = await this.loadToolState(story);
		if (!state) return "状态文档缺失。";
		const num = pickNumberArg(args, CHAPTER_NUM_ARG_KEYS); // v0.4.7+ 参数键宽松＋字符串章号（「第18章」）也收
		if (!Number.isFinite(num) || num <= 0) return "参数 chapter_num 无效（应为正整数章节号）。";
		let volMap: Record<string, VolumeInfo> = {};
		try { volMap = await this.manager.loadVolumes(story); } catch { /* 平铺书无卷 */ }
		const key = this.chatChapterCandidates(Object.entries(state.chapters ?? {}), num, volMap, state.current_chapter ? parseChKey(state.current_chapter).vol : null)[0];
		if (!key) return `第${String(num)}章不存在。`;
		await this.manager.switchChapter(story, key);
		return `已把当前章设为 ${this.keyLabel(key, await this.volNameMap(story).catch(() => ({})), state.chapters?.[key]?.title)}。`;
	}

	/** save_content_to_file：内容交 SaveReplyModal（路径可编辑/覆盖需勾选＝人证闸门），确认后逐级建目录写盘；取消＝不落盘 */
	private async chatToolSaveToFile(args: Record<string, unknown>): Promise<string> {
		const content = typeof args.content === "string" ? args.content : "";
		if (!content.trim()) return "参数 content 为空（要保存的完整 Markdown 文本）。";
		const suggested = typeof args.suggested_path === "string" ? args.suggested_path.trim().replace(/^\/+/, "") : "";
		const base = await this.chatDefaultSaveDir();
		const prefix = suggested ? (suggested.includes("/") ? suggested : `${base}/${suggested}`) : `${base}/`;
		const res = await new Promise<SaveReplyResult | null>((resolve) => {
			new SaveReplyModal(this.app, prefix, (r) => resolve(r), () => resolve(null)).open();
		});
		if (!res) return "用户取消了保存框，未落盘。";
		const existing = this.app.vault.getAbstractFileByPath(res.path);
		if (existing instanceof TFile) await this.app.vault.modify(existing, content);
		else {
			await ensureParentFolders(this.app, res.path);
			await this.app.vault.create(res.path, content);
		}
		return `已保存到 ${res.path}（用户在确认框中确定）。`;
	}

	private async getChatSystemPrompt(): Promise<{ text: string; hasStory: boolean }> {
		// v0.4.3+：对话助手身份固定文案收 TASK_PROMPTS["对话助手身份"]（SKILLS/系统提示词/ 盘上可编辑）
		const CHAT_ASSISTANT_PROMPT = pt("对话助手身份");
		let hasStory = false;
		const lastStory = this.settings.lastStory?.trim();
		try {
			if (lastStory && (await this.manager.listStories()).includes(lastStory)) hasStory = true;
		} catch { /* 小说列表读取失败按无当前小说处理，不阻断对话 */ }
		let text = assembleSystemPrompt(CHAT_ASSISTANT_PROMPT); // v0.3.5+：【创作规范】三层指南块已随写作指南体系废弃
		if (hasStory) {
			try {
				const state = await this.manager.loadState(lastStory);
				if (state?.title) {
					const curKey = state.current_chapter; // v0.0.15：复合键（"volId:N"/"N"）
					let volNames: Record<string, string> = {};
					try { volNames = await this.volNameMap(lastStory); } catch { /* 卷名缺失降级为 id */ }
					const parts: string[] = [];
					if (curKey != null && curKey !== "") {
						try {
							// ensureSummaries:false —— 这个调用只服务「对话框提示词/字数标签」这类**只读展示**：
							// 触发摘要 LLM 生成会让切书/切章时凭空弹出「生成过程」面板并开始输出（用户视角就是"自动开始写"），必须禁掉
							const data = await this.manager.loadWritingData(lastStory, curKey, { includeCurrentSummary: false, ensureSummaries: false });
							const docs = await this.assembleWritingDocGroups(lastStory, data); // 对话上下文：章大纲照注入（skip=false）
							const ctx = buildWritingContext({ ...data, ...docs });
							if (ctx) parts.push(ctx);
						} catch {
							/* 写作上下文构建失败不影响当前章节部分 */
						}
						try {
							const content0 = await this.manager.readChapterContent(lastStory, curKey);
							if (content0 && content0.trim()) {
								let content = content0;
								if (content.length > 6000) content = content.slice(0, 6000) + "\n[...内容省略...]";
								parts.push(`\n【当前章节】${this.keyLabel(curKey, volNames)}\n${content}`);
							}
						} catch {
							/* 章节读取失败则只带写作上下文 */
						}
					}
					if (parts.length) {
						text +=
							"\n\n以下是当前小说的上下文，供你回答时参考。请基于它回答，不要复述上下文本身：\n\n" +
							parts.join("\n");
					}
				}
			} catch {
				/* 状态读取失败则不带小说上下文，回退纯问答（对齐 CLI） */
			}
		}
		// v0.4.3+：用户配置的对话引用文档/技能追加在最后（清单空＝无附加，行为不变）
		if (hasStory && lastStory) {
			const refDocs = await this.buildChatRefDocs(lastStory);
			if (refDocs) text += "\n\n以下是用户为对话附加的引用文档与技能，请一并参考，不要复述其内容：\n\n" + refDocs;
		}
		return { text, hasStory };
	}

	/**
	 * 单次流式调用：空流按「结果为空」处理（返回""），用户中断向上抛 AbortError。
	 * 思考型模型的 reasoning_content 增量经 sink.appendReasoning 实时透出到面板（仅展示不落盘）；
	 * 「正文为空但思考非空」由 chatStream 抛针对性错误（不走空结果重试——那会再白等数轮思考）。
	 * 网络层瞬时故障（fetch 的 `Failed to fetch` / Connection error / ETIMEDOUT / ECONNRESET / 5xx）自动退避重试 2 次
	 * ——长 prompt 的首字节等待常达数十秒，连接被中间设备或服务端网关掐断是常见故障，重试一次多半即通；
	 * 参数类 4xx（超长上下文、密钥错等）由 isRetryableLlmError 挡掉直接失败，避免白等。
	 */
	private async streamOnce(cfg: LlmConfigDoc, messages: Message[], sink: WritingStreamSink, extra?: Record<string, unknown>, onFinish?: (reason: string | null) => void): Promise<string> {
		const maxAttempts = 3;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return await chatStream(cfg, messages, (d) => sink.append(d), extra, sink.signal, (d) => sink.appendReasoning(d), onFinish,
					// v0.4.3+ 前缀缓存读数（serve 在末个 chunk 带 timings.cache_n）→ 面板状态行显示，核对 cachePin 是否真的命中
					(s) => sink.noteCache?.(cacheStatsText(s)));
			} catch (e) {
				if (sink.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
				const msg = e instanceof Error ? e.message : String(e);
				if (msg.includes("输出为空") || msg.includes("未返回内容")) return "";
				// 本地端点（localhost/127.0.0.1）的连接失败＝服务没起来，重试必然同样失败，直接报错让用户看到端点更省事
				const localEndpoint = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(cfg.base_url || "");
				if (attempt < maxAttempts && !localEndpoint && isRetryableLlmError(e)) {
					const waitS = attempt * 2; // 2s、4s 退避
					sink.reset(); // 丢弃半截输出，重试从零开始
					sink.setStatus(`连接中断，${String(waitS)} 秒后自动重试（第 ${String(attempt)}/${String(maxAttempts - 1)} 次）…`); // v0.2.x+ 先 reset 再 setStatus：临时态在退避等待期间不被计时器/状态刷新覆盖（原顺序下 reset 会立即清掉该文案）
					await new Promise((r) => window.setTimeout(r, waitS * 1000));
					if (sink.signal.aborted) throw e;
					continue;
				}
				throw this.decorateLlmError(e, cfg);
			}
		}
		throw new Error("生成重试后仍失败");
	}

	/** 生成失败统一提示：用户中断仅通知；其它错误额外在预览框内显示失败态 */
	private genFailure(e: unknown, label: string, sink?: WritingStreamSink): void {
		if (e instanceof Error && e.name === "AbortError") {
			new Notice(`已停止生成，${label}未保存`);
			sink?.markStopped?.(); // v0.4.x+ 面板同步定格：计时停止、状态行改「已停止」，避免停留在「正在收尾…」的假象
			return;
		}
		this.notifyError(`${label}失败`, e);
		sink?.fail(describeLlmError(e));
	}

	/** 流式生成 + 结果为空自动重试 ×3（对应 cmd 层 max_attempts=3）；失败/中断/全空均返回""。
	 * onFinish（可选）透传给 chatStream：每次尝试流结束都会回调，最终值对应最后一次尝试的 finish_reason */
	private async streamWithEmptyRetry(
		cfg: LlmConfigDoc,
		buildMessages: () => Message[],
		sink: WritingStreamSink,
		label: string,
		extra?: Record<string, unknown>,
		onFinish?: (reason: string | null) => void
	): Promise<string> {
		for (let attempt = 1; attempt <= 3; attempt++) {
			let content: string;
			try {
				content = await this.streamOnce(cfg, buildMessages(), sink, extra, onFinish);
			} catch (e) {
				this.genFailure(e, label, sink);
				return "";
			}
			if (content.trim()) return content;
			if (attempt < 3) {
				new Notice(`生成结果为空（第${String(attempt)}次），正在重试…`, 6000);
				sink.reset();
			}
		}
		new Notice(`✗ ${label}失败：连续 3 次生成结果为空`, 12000);
		sink.fail("连续 3 次生成结果为空");
		return "";
	}

	/**
	 * 前缀缓存锚点（v0.4.x+）：在 user 消息里「写作上下文·稳定段」的结束处钉一个检查点，让同一本书的后续
	 * 请求（连写下一章、重写、续写）把书籍级上下文**整段** reused，而不是只按服务端默认 8192 token 块对齐。
	 * 实测（serve 引擎日志）同一本书第 2 章请求：带锚点 24324 reused + 16 read（0.5s）／无锚点 16384 reused（4.0s）。
	 * 服务端 resolve_prefix 用 lcp 把 chars 收敛到真实公共 token 前缀，偏移略有出入无害、无需留安全余量。
	 * 只在本地端点生效：strata_* 字段由 llm_client.buildParams 在非回环 base_url 上统一剥掉。
	 * 不适用（稳定段太短 / 上下文没原样进入 user 消息）时返回 undefined。
	 */
	private cachePin(prompt: string, context: string, stableChars: number | undefined): Record<string, unknown> | undefined {
		if (!stableChars || stableChars < 600) return undefined; // 稳定段太短，钉检查点没有收益
		const at = prompt.indexOf(context);
		if (at < 0) return undefined; // 上下文未原样出现在 user 消息中（拼接口径变了）
		return this.cachePinAt(prompt, at + stableChars);
	}

	/** v0.4.3+ 按绝对字符位钉锚点（cachePin 的底层）：提示词分块不是「一整段可 indexOf 的上下文」时（如逐章分析的
	 *  指令头＋正文、书级大纲续写的上下文＋设计＋衔接段）由调用方自行算出稳定前缀结束位。 */
	private cachePinAt(prompt: string, chars: number | undefined): Record<string, unknown> | undefined {
		if (!chars || chars < 600) return undefined; // 稳定段太短，钉检查点没有收益
		if (chars < 1 || chars >= prompt.length - 1) return undefined;
		return { strata_prefix: { message: 1, chars } };
	}

	/** v0.4.3+ 大纲族上下文的前缀缓存锚点字符数：块串里「逐章变化块」（header 命中者）之前的稳定前缀长度；
	 *  未命中（没有该块）时退回整段长度——调用方据此让相邻章请求复用世界观/策划规范/人物关系整段稳定头。 */
	private stableCharsBefore(contextDocs: string, blocks: ReadonlyArray<{ header: string; text: string }>, header: string): number {
		const block = blocks.find((b) => b.header === header);
		if (!block) return contextDocs.length;
		const at = contextDocs.indexOf(block.text);
		return at > 0 ? at : contextDocs.length;
	}

	/** 对齐 writer.generate_chapter：最多 3 轮「生成→格式校验→带修正注记重新生成」；中断/异常/全空返回""。
	 *  v0.4.3+ 重试轮经 retryTurnMessages 走「会话续轮」形状（保住上一次请求的前缀缓存），不再把注记拼在原 user 消息末尾 */
	private async generateChapterStreamed(
		cfg: LlmConfigDoc,
		systemPrompt: string,
		prompt: string,
		writingStyle: string | undefined,
		sink: WritingStreamSink,
		extra?: Record<string, unknown>
	): Promise<string> {
		const sysMsg: Message = { role: "system", content: systemPrompt };
		let content = "";
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				content = await this.streamOnce(cfg, [sysMsg, { role: "user" as const, content: prompt }], sink, extra);
			} catch (e) {
				this.genFailure(e, "创作", sink);
				return "";
			}
			if (!content.trim()) break; // 空结果 → 外层统一报错（与 Python break 一致）
			const reason = validateStoryTypeFormat(content, writingStyle);
			if (!reason) return content;
			new Notice(`生成内容不符合【编写类型】（第${String(attempt)}次）：${reason}\n正在附加格式修正要求重新生成…`, 8000);
			sink.reset();
			let retried: string;
			try {
				retried = await this.streamOnce(cfg, retryTurnMessages(sysMsg, prompt, content, formatRetryNote(writingStyle, reason)), sink, extra);
			} catch (e) {
				this.genFailure(e, "创作", sink);
				return "";
			}
			const r2 = validateStoryTypeFormat(retried, writingStyle);
			if (retried.trim() && !r2) return retried;
			content = retried;
		}
		if (!content.trim()) {
			new Notice("✗ 创作失败：连续 3 次生成结果为空", 12000);
			sink.fail("连续 3 次生成结果为空");
		}
		return content;
	}

	// v0.1.4+ 起卷摘要不再在写盘命令后 eager 刷新：上下文组装需要时由 manager.ensureFreshVolumeSummary 延迟全量重建（输入=本卷全部成员章的新鲜章节摘要）。

	/** v0.1.4+ 摘要延迟生成的进度反馈——专用面板展示工作过程（GenProgressView）：每个 LLM 任务实时追加一行带时间戳的日志并自动滚底；onProgress(null)=本轮结束，追加分隔完成行后面板保持展示，直到下一轮生成清空或用户手动关闭。面板打开/写入失败仅告警，绝不影响生成本身 */
	private genRunOpen = false;
	private async notifyGenProgress(msg: string | null): Promise<void> {
		try {
			if (!msg) {
				if (this.genRunOpen) {
					const view = await this.getGenPanel(false); // 只找已开实例；用户中途关过面板则静默跳过收尾行
					view?.finishRun();
					this.genRunOpen = false;
				}
				return;
			}
			const view = await this.getGenPanel(true); // 无已开实例则新开 tab
			if (!view) return;
			if (!this.genRunOpen) {
				view.startRun(this.settings.lastStory?.trim() || undefined);
				this.genRunOpen = true;
			}
			view.appendLine(`⏳ ${msg}`);
		} catch (e) {
			console.warn("[articlewriter] 更新摘要进度面板失败：", e);
		}
	}

	/** 取「生成过程」面板视图：withOpen=false 只找已开启的实例（收尾用）；true=没有时新开一个 tab。失败返回 null */
	private async getGenPanel(withOpen: boolean): Promise<GenProgressView | null> {
		for (const l of this.app.workspace.getLeavesOfType(GenProgressView.VIEW_TYPE)) if (l.view instanceof GenProgressView) { this.lastGenPanel = l.view; return l.view; } // v0.3.0+：顺手记录实例（auto-book 阶段间停止检测用）
		if (!withOpen) return null;
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: GenProgressView.VIEW_TYPE, active: true });
		const view = leaf.view instanceof GenProgressView ? leaf.view : null;
		if (view) this.lastGenPanel = view;
		return view;
	}

	/** v0.1.4+ 打开统一生成面板并进入流式小节（与摘要日志同一 ItemView，替换原独立 StreamingPreviewModal）：无实例则新开 tab；失败返回 null */
	private async beginWritingPanel(title: string, cfg?: LlmConfigDoc): Promise<GenProgressView | null> {
		const view = await this.getGenPanel(true);
		if (!view) return null;
		// v0.4.6+ 修 C5：注入 done 态关面板的草稿兜底——流式完成但未点「保存」就关面板时，全文落《案头资料/生成草稿/》防蒸发
		const draftStory = (this.settings.lastStory || "").trim();
		view.onDiscardText = draftStory ? (text) => void this.saveGenDraft(draftStory, title, text) : undefined;
		// 标题带上**本命令实际使用的**模型（调用方传入其所属阶段的配置）：各写作/大纲命令按阶段映射取配置（getPhaseLlmSetup），
		// 而 LLM 对话框顶部下拉可以另选配置——不显示出来时，用户极易误以为两处用的是同一个模型（本地/云端对不上就会连接失败）
		const modelLabel = cfg ? `${cfg.name || cfg.model_name || "默认"}` : "";
		view.beginStream(modelLabel ? `${title} · 模型 ${modelLabel}` : title);
		return view;
	}

	/** v0.4.6+ 修 C5：生成面板 done 态被关（未保存）时的草稿兜底落盘——每次一文件（标题＋本地时间戳），Notice 报路径；保存成功/明确弃稿不会走到这里 */
	private async saveGenDraft(story: string, title: string, text: string): Promise<void> {
		try {
			const now = new Date();
			const p = (n: number) => String(n).padStart(2, "0");
			const ts = `${String(now.getFullYear())}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
			const path = `${this.manager.deskDocsPath(story)}/生成草稿/${safeFilename(`${title}-${ts}`)}.md`;
			await this.manager.writeDoc(path, text.replace(/\s+$/, "") + "\n"); // 不用 trimEnd（ES2019 API，外部检查器类型环境判 error 类型→no-unsafe-call）
			new Notice(`✂ 生成内容未保存，草稿已存至\n${path}`, 12000);
		} catch (e) {
			this.notifyError("生成草稿落盘失败", e);
		}
	}

	/** v0.2.x+ 增量大纲生成 · 已生成各段的上下文裁剪：≤3 段全列；>3 段只列最近 3 章并在头部注明省略章数——避免每步把本轮全部已生成章节 O(N²) 重复上传（紧邻的前一章恒在尾部，因果链不断） */
	private outlineSoFarContext(segs: string[]): string {
		const TAIL = 3;
		if (segs.length <= TAIL) return segs.join("\n\n");
		return `（前 ${String(segs.length - TAIL)} 章已生成，此处仅列最近 ${TAIL} 章供衔接参考）\n\n${segs.slice(-TAIL).join("\n\n")}`;
	}

	/** v0.4.3+ 大纲阶段人物/关系分层：构建一次运行（一卷的卷大纲生成 / 拆章）的追踪器——从盘上三层《人物.md》《人物关系.md》
	 *  播种既有条目所在层与跨章出现记录，后续每章 ingest 时按「本轮已出现章 + 盘上已有层」定层并提升。 */
	private async newOutlineCastTracker(story: string, state: StoryState): Promise<OutlineCastTracker> {
		return new OutlineCastTracker({
			useVolumes: state.use_volumes !== false,
			characters: await this.manager.loadCharacterLayerDocs(story),
			relationships: await this.manager.loadRelationshipLayerDocs(story),
		});
	}

	/** v0.4.3+ 大纲阶段人物/关系分层的运行上下文：书级开关 ai_outline_cast=false 时返回 null（不抽附录、不写文档） */
	private async outlineCastRun(story: string, state: StoryState): Promise<{ tracker: OutlineCastTracker; stats: OutlineCastRunStats } | null> {
		if (state.ai_outline_cast === false) return null;
		return { tracker: await this.newOutlineCastTracker(story, state), stats: { characters: 0, relationships: 0, skipped: 0 } };
	}

	/** v0.4.3+ 收尾汇总行（无任何条目时不显示） */
	private outlineCastSummaryLine(stats: OutlineCastRunStats): string {
		return `人物/关系分层写入：人物 ${String(stats.characters)} 条、关系 ${String(stats.relationships)} 条${stats.skipped ? `（跳过 ${String(stats.skipped)} 条：目标章节目录尚未创建，待拆章后补齐）` : ""}`;
	}

	/** v0.4.3+ 每生成一章调用一次：摄入该章人物/关系附录并整层重写内容有变化的层（书/卷/章）。
	 *  写盘失败只告警、不中断大纲生成（大纲是主产物，人物文档可后续 /analyze-cast 补齐）。 */
	private async ingestOutlineCast(
		story: string,
		tracker: OutlineCastTracker,
		chapterKey: string,
		cast: CastChapterAnalysis,
		stats: OutlineCastRunStats
	): Promise<void> {
		const r = tracker.ingest(chapterKey, cast);
		try {
			for (const layer of r.characterWrites) await this.manager.saveCharacterLayer(story, layer.ref, layer.entries);
			for (const layer of r.relationshipWrites) await this.manager.saveRelationshipLayer(story, layer.ref, layer.entries);
		} catch (e) {
			console.warn("[articlewriter] 大纲阶段人物/关系写盘失败（已跳过，可后续 /analyze-cast 补齐）：", e);
		}
		stats.characters += r.writtenCharacters;
		stats.relationships += r.writtenRelationships;
		stats.skipped += r.skipped.length;
	}

	/** v0.2.x+ 增量生成卷大纲（/vol-outline-generate · 无卷兜底 · 书级大纲→生成卷 三入口共用）：输出拆成小段防长单次输出断开——
	 * 第 0 步【卷设计】段（hasDesign=false 的补全模式跳过）、其后每个章号一个 `## 第N章` 小节；
	 * 全程同一面板实例，每段 beginStream 实时流式展示、生成完立即经 commit 落盘（无保存/不保存 CTA，finishAuto 自动收尾）再继续下一段；
	 * 每章提示词带共享书籍上下文 + 本轮【卷设计】+ 已生成各段（>3 段时仅列最近 3 章、前段省略注明，见 outlineSoFarContext），保证跨段因果链。
	 * 点「停止生成」/ 关面板 → 整轮中止（已落盘段落保留在磁盘）；某段 LLM 失败/连续空 → 该轮 failed（已落盘段落保留）。
	 * @param cfg 本命令所属阶段的模型配置（getPhaseLlmSetup 结果，调用方已保证非空）
	 * @param failLabel 面板标题与失败提示前缀（如「生成卷大纲 X」）
	 * @param chapterNums 要生成的章号（升序；完整模式 1..N，补全模式为缺失章号）
	 * @param buildDesignPrompt 第 0 步提示词构建器（hasDesign=false 时忽略）
	 * @param buildChapterPrompt 单章提示词构建器（chapterNum/volumeDesign/generatedSoFar 由本助手传入）
	 * @param commit 段落生成完成后的落盘策略（kind=design/chapter；segmentText 已去尾部空白），写盘失败抛错由本助手统一处理 */
	private async genVolOutlineIncremental(opts: {
		cfg: LlmConfigDoc;
		failLabel: string;
		chapterNums: number[];
		hasDesign: boolean;
		buildDesignPrompt: () => string;
		buildChapterPrompt: (chapterNum: number, volumeDesign: string, generatedSoFar: string) => string;
		commit: (segmentText: string, kind: "design" | "chapter") => Promise<void>;
		systemPrompt: string; // v0.2.24+：调用方按所属阶段组装后传入（v0.3.4+：身份加强改经技能通道注入，不再随组装附带）
		cast?: { story: string; volId: string | null; tracker: OutlineCastTracker; stats: OutlineCastRunStats }; // v0.4.3+：每章段附带人物/关系附录并逐章分层写盘（章节目录不存在时跳过章级、保留出现记录待提升）
		stableContext?: string; // v0.4.3+：本轮共享上下文块串（与 buildChapterPrompt 闭包里的 contextDocs 同一份）——用于落前缀缓存锚点，相邻章复用整段稳定头
	}): Promise<{ aborted: boolean; failed: boolean; written: number; panelFailed: boolean }> {
		const view = await this.beginWritingPanel(opts.failLabel, opts.cfg);
		if (!view) return { aborted: false, failed: false, written: 0, panelFailed: true };
		const totalSteps = opts.chapterNums.length + (opts.hasDesign ? 1 : 0);
		let stepIdx = 0;
		let written = 0;
		let volumeDesign = "";
		const soFarSegs: string[] = []; // 本轮已生成各段（提示词注入时经 outlineSoFarContext 裁剪为最近 3 章）
		const runStep = async (kind: "design" | "chapter", num: number): Promise<"ok" | "aborted" | "failed"> => {
			stepIdx++;
			const label = `${opts.failLabel} · ${kind === "design" ? "卷设计" : `第${num}章`} (${String(stepIdx)}/${String(totalSteps)})`;
			view.beginStream(label);
			const basePrompt = kind === "design" ? opts.buildDesignPrompt() : opts.buildChapterPrompt(num, volumeDesign, this.outlineSoFarContext(soFarSegs));
			// v0.4.3+：章段末尾追加人物/关系附录要求（卷设计段不需要）
			const prompt = kind === "chapter" && opts.cast ? `${basePrompt}\n\n${outlineCastAppendixInstruction(opts.cast.tracker.knownNames())}` : basePrompt;
			// v0.4.3+ 前缀缓存锚点：设计段与章段提示词都以共享上下文开头（buildVolOutlineDesignPrompt/buildVolOutlineChapterPrompt
			// 已统一改为上下文在前、指令压后），钉在上下文末尾 → 后续各段复用世界观/策划规范/人物关系整段稳定头。
			// 卷设计段也钉：它的检查点正是第 1 章的复用起点（旧实现设计段指令在前、上下文在后，与章节步零复用）
			const pin = opts.stableContext ? this.cachePin(prompt, opts.stableContext, opts.stableContext.length) : undefined;
			const content = await this.streamWithEmptyRetry(opts.cfg, () => [
				{ role: "system", content: opts.systemPrompt },
				{ role: "user", content: prompt },
			], view, label, pin ? { ...pin } : undefined);
			if (view.signal.aborted) return "aborted"; // 用户点停止 / 关面板 → 整轮中止（streamWithEmptyRetry 已按中断提示）
			if (!content.trim()) return "failed"; // 失败/连续空：streamWithEmptyRetry 已 notifyError + sink.fail，不重复提示
			// v0.4.3+：拆出附录——大纲正文照常落盘，人物/关系在落盘后逐章分层写入
			const parsed = kind === "chapter" && opts.cast ? splitOutlineCastAppendix(content) : { body: content, cast: null };
			const seg = parsed.body.replace(/\s+$/, "");
			if (!seg) return "failed"; // 只有附录没有正文：视为失败（避免把空章写进卷大纲）
			try {
				await opts.commit(seg, kind);
			} catch (e) {
				this.notifyError(`${opts.failLabel}落盘失败`, e);
				view.fail("落盘失败");
				return "failed";
			}
			written++;
			if (kind === "design") volumeDesign = seg;
			else {
				soFarSegs.push(seg);
				if (parsed.cast && opts.cast) await this.ingestOutlineCast(opts.cast.story, opts.cast.tracker, chKey(opts.cast.volId, num), parsed.cast, opts.cast.stats);
			}
			view.finishAuto(`✓ ${kind === "design" ? "卷设计" : `第${num}章`}已落盘 (${String(stepIdx)}/${String(totalSteps)})`, "段落用时");
			return "ok";
		};
		if (opts.hasDesign) {
			const r = await runStep("design", 0);
			if (r !== "ok") return { aborted: r === "aborted", failed: r === "failed", written, panelFailed: false };
		}
		for (const num of opts.chapterNums) {
			const r = await runStep("chapter", num);
			if (r !== "ok") return { aborted: r === "aborted", failed: r === "failed", written, panelFailed: false };
		}
		return { aborted: false, failed: false, written, panelFailed: false };
	}

	/** 连接类失败时补上端点与模型，并给出最常见成因（本地服务未启动 / 实际使用的阶段模型与预期不符）——原样抛出时只有一句 "Connection error." */
	private decorateLlmError(e: unknown, cfg: LlmConfigDoc): Error {
		const msg = describeLlmError(e);
		const err = e instanceof Error ? e : new Error(msg);
		if (!/failed to fetch|connection error|econnrefused|etimedout|econnreset|econnaborted|socket hang up/i.test(msg)) return err;
		const base = normalizeBaseURL(cfg.base_url) || "(未配置 base_url)";
		return new Error(`${msg}｜端点 ${base}（模型 ${cfg.model_name || "默认"}）。若端点是本地地址，请确认本地模型服务已启动；各命令用的是其所属阶段的模型配置，与 LLM 对话框顶部下拉所选可能不是同一个。`);
	}

	/** 生成后自动去AI味（对应 _auto_clean_ai）：命中禁用词清单（运行时读盘上 SKILLS/网文高频禁用词清单.md）的 AI 常用词的句子打回 LLM 重写并原位替换；失败保留原文。
	 * v0.4.x+ signal＝生成面板的 AbortSignal：面板「停止生成」须同时中断本阶段的重写请求（不传 signal 时停止按钮对该阶段完全无效——每轮调用前复查＋透传给 chatCompletion，中断后不再发起新请求） */
	private async autoCleanAi(
		cfg: LlmConfigDoc,
		baseSp: string | undefined,
		content: string,
		onProgress?: () => void,
		signal?: AbortSignal,
		sharedPrefix?: { context: string; stableChars?: number } // v0.4.3+ 前缀复用：把本章生成时用过的写作上下文原样带进清洗请求（仅回环端点生效，见下）
	): Promise<string> {
		if (!content || !content.trim()) return content;
		if (signal?.aborted) return content; // 进入前已被停止：直接原样返回，由调用方按 aborted 终止流程
		const data = await this.loadBannedWords();
		const hits = findAiWordHits(content, data);
		if (!hits.length) return content;
		new Notice(`检测到 ${String(hits.length)} 处 AI 常用词，正在打回重写…`, 6000);
		onProgress?.();
		// 去AI味使用基础系统提示词（不带编写类型块），对齐 Python system_prompt=None 回落行为
		const sp = assembleSystemPrompt(undefined, baseSp);
		// v0.4.3+ 前缀复用：清洗请求与刚发出的章节请求共享同一段上下文前缀 → 章与章之间不会把上一章的 K/V 挤出 slot
		// （引擎的 reused 只认「当前会话的公共前缀」；conversation-cache 停放额度不足时日志打 skip parking，那时逐章 reused 必为 0）。
		// 云端端点不带：按输入 token 计费，多送整段上下文纯属花钱——与 buildParams 剥 strata_* 同一口径（isLoopbackBaseUrl）
		const withPrefix = Boolean(sharedPrefix?.context) && isLoopbackBaseUrl(cfg.base_url);
		try {
			const { text, report } = await cleanAiText(content, async (p, maxTokens) => {
				if (signal?.aborted) { const e = new Error("已停止生成"); e.name = "AbortError"; throw e; } // 停止后剩余轮次不再打网络
				const finalPrompt = withPrefix && sharedPrefix ? withSharedContextPrefix(sharedPrefix.context, p) : p;
				const pin = withPrefix && sharedPrefix ? this.cachePin(finalPrompt, sharedPrefix.context, sharedPrefix.stableChars) : undefined;
				return chatCompletion(cfg, [
					{ role: "system" as const, content: sp },
					{ role: "user" as const, content: finalPrompt },
				], { max_tokens: Math.min(maxTokens, cfg.max_tokens ?? maxTokens), ...(pin ?? {}), ...(pin ? { strata_checkpoint: true } : {}) }, signal);
			}, 2, data, () => Boolean(signal?.aborted));
			if (signal?.aborted) return content; // 停止：本轮改写结果不再采用，也不出「去AI味完成」提示，由调用方终止流程
			this.notifyAiReport(report);
			return text;
		} catch (e) {
			if (signal?.aborted) return content; // 「停止生成」掐断在途请求属预期，不当失败处理
			console.warn("AI 用语清洗失败，保留原文：", e);
			return content;
		}
	}

	/** 输出清洗结果摘要（对应 _print_ai_clean_report） */
	private notifyAiReport(report: import("./prompts").CleanReport): void {
		const parts: string[] = [];
		if (report.simplified.length) parts.push(`句式简化 ${String(report.simplified.length)} 处`);
		if (report.replaced.length) parts.push(`LLM 重写 ${String(report.replaced.length)} 句`);
		if (report.remaining.length) parts.push(`⚠ 仍残留 ${String(report.remaining.length)} 处（建议人工检查）`);
		if (report.errors.length) parts.push(`✗ ${String(report.errors.length)} 句改写失败已保留原句`);
		new Notice(parts.length ? `去AI味完成：${parts.join("，")}` : "去AI味完成", 8000);
	}

	/** 字数超限提醒（对应 _warn_word_limit）；v0.4.3+ 口径对齐提示词措辞——以 word_range 中值为宜、可上下浮动20%，提醒阈值＝浮动上界（中值×1.2） */
	private warnWordLimit(content: string, wordRange: [number, number]): void {
		const wc = countPureWords(content || "");
		const { mid, flHigh } = wordTargetHint(wordRange);
		if (wc > flHigh) new Notice(`⚠ 生成内容 ${String(wc)} 字，超出宜写 ${String(mid)} 字（±20%，约至 ${String(flHigh)} 字）的上界；如需要请精简`, 10000);
	}

	/** v0.2.21+：正文「第N章」章节编号引用检测提醒——提示词禁令之外的确定性兜底，命中即非阻断 Notice（标题行除外，至多列前 5 处） */
	private warnChapterRefs(content: string): void {
		const leaks = findChapterRefLeaks(content || "");
		if (!leaks.length) return;
		const shown = leaks.slice(0, 5).map((l) => `第${String(l.line)}行「${l.snippet}」`).join("、");
		new Notice(`⚠ 正文检测到 ${String(leaks.length)} 处「第N章」类章节编号引用（章节编号只允许出现在标题行）：${shown}${leaks.length > 5 ? "…" : ""}，建议人工检查`, 10000);
	}

	// ---------- v0.4.3+ 灵感工具包（书级《案头资料/灵感/灵感.md》：全书灵感攒一处，快速打开/定位/改名/删除/新增灵感块）----------
	// 文档形态＝H1 文档头 ＋ 每条灵感一个二级标题块（## 灵感名 · 日期）；解析/渲染/增删的纯逻辑在 src/inspiration.ts（可测、无 IO），
	// 正文模板走系统技能 SKILLS/灵感模板.md（DEFAULT_SKILLS 播种、用户可编辑）。

	/** 灵感文件夹（书级《案头资料/灵感/》）与灵感文件路径（全部灵感块都在这一份文件里） */
	private inspirationFolderPath(story: string): string {
		return `${this.manager.deskDocsPath(story)}/${INSPIRATION_FOLDER_NAME}`;
	}

	private inspirationDocPath(story: string): string {
		return `${this.inspirationFolderPath(story)}/${INSPIRATION_DOC_NAME}`;
	}

	/** 读灵感文档（不存在＝空串 → 工具包按「还没有灵感」渲染空态） */
	private async readInspirationDoc(story: string): Promise<string> {
		return this.manager.readDoc(this.inspirationDocPath(story));
	}

	/** 写灵感文档（writeGuideAt＝缺失连父目录一起建、存在则覆盖）；失败弹错并返回 false，调用方不刷新弹窗列表 */
	private async writeInspirationDoc(story: string, text: string): Promise<boolean> {
		try {
			await this.manager.writeGuideAt(this.inspirationDocPath(story), text);
			return true;
		} catch (e) {
			this.notifyError(`写入《${INSPIRATION_DOC_NAME}》失败`, e);
			return false;
		}
	}

	/** 灵感块正文模板＝系统技能 SKILLS/灵感模板.md（用户可编辑）；缺失先重播种一次（误删可回、不覆盖用户改过的），仍缺回落内置 DEFAULT_SKILLS */
	private async inspirationTemplate(): Promise<string> {
		const p = this.skillPath(INSPIRATION_SKILL_NAME);
		const read = async (): Promise<string> => {
			try {
				return await this.app.vault.adapter.read(p);
			} catch {
				return ""; // 文件不存在时 adapter.read 抛错
			}
		};
		let t = await read();
		if (!t.trim()) {
			await this.ensureSkillsFiles();
			t = await read();
		}
		return t.trim() ? t : DEFAULT_SKILLS[INSPIRATION_SKILL_NAME] ?? "";
	}

	/** 「灵感工具包」命令入口：弹窗里完成打开/定位/改名/删除/新增。每次写盘后重新解析回填列表（旧块的行号会失效）。
	 *  storyName 由写字台右键传入（对哪本书的案头资料操作就用哪本书，不必先切当前书）；命令面板不带参→走当前激活书 */
	async cmdInspirationKit(storyName?: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = storyName?.trim() ? storyName.trim() : await this.requireStory();
		if (!story) return;
		const path = this.inspirationDocPath(story);
		const state = await this.manager.loadState(story);
		const title = state?.title || story;
		const modal = new InspirationKitModal(this.app, path, parseInspirationDoc(await this.readInspirationDoc(story)), {
			openBlock: (b) => this.locateInspiration(path, b),
			renameBlock: (b) => this.cmdRenameInspiration(story, b),
			deleteBlock: async (b) => {
				modal.setBlocks(parseInspirationDoc(await this.cmdDeleteInspiration(story, b)));
			},
			newBlock: () => this.cmdNewInspiration(story, title),
			openDoc: async () => {
				if (await openFileAtLine(this.app, path, 0)) return;
				new Notice(`还没有《${INSPIRATION_DOC_NAME.replace(/\.md$/, "")}》：点「新增灵感」建第一条`, 6000);
			},
			editTemplate: () => this.openSkillFile(INSPIRATION_SKILL_NAME),
		});
		modal.open();
	}

	/** 定位：在编辑器打开灵感文件、把该块标题行滚到视口中央（行号来自最近一次解析） */
	private async locateInspiration(path: string, block: InspirationBlock): Promise<void> {
		if (await openFileAtLine(this.app, path, block.line)) return;
		new Notice("灵感文件还没创建：点「新增灵感」建第一条", 6000);
	}

	/** 新增：问灵感名（留空＝未命名＋今天日期）→ 按 SKILLS/灵感模板.md 在文档**末尾**追加一块 → 打开文件并定位到新块，等用户填充 */
	private cmdNewInspiration(story: string, title: string): void {
		new TextInputModal(
			this.app,
			"新增灵感",
			"灵感名（留空＝未命名 + 今天日期）",
			async (value) => {
				const name = normalizeInspirationName(value);
				const date = inspirationDate();
				const md = ensureInspirationDocHeader(await this.readInspirationDoc(story), title);
				const next = appendInspirationBlock(md, renderInspirationBlock(name, date, await this.inspirationTemplate()));
				if (!(await this.writeInspirationDoc(story, next))) return;
				const blocks = parseInspirationDoc(next);
				await openFileAtLine(this.app, this.inspirationDocPath(story), blocks[blocks.length - 1]?.line ?? 0);
				new Notice(`已在《${INSPIRATION_DOC_NAME.replace(/\.md$/, "")}》末尾新增「${inspirationHeading(name, date)}」，编辑器已定位过去，填完直接保存`, 8000);
			},
			undefined,
			`块标题＝「灵感名 · ${inspirationDate()}」；正文按 SKILLS/${INSPIRATION_SKILL_NAME}.md 生成（要改模板结构就在工具包里点「编辑灵感模板」）`
		).open();
	}

	/** 改名：只换块标题（日期保持原样），块内正文一字不动 */
	private cmdRenameInspiration(story: string, block: InspirationBlock): void {
		new TextInputModal(
			this.app,
			`改名：${block.heading}`,
			"新的灵感名（日期不变）",
			async (value) => {
				if (!value.trim()) return;
				const md = await this.readInspirationDoc(story);
				const target = this.findInspirationBlock(md, block);
				if (!target) {
					new Notice("该灵感块已不在文件里（可能刚被手工改动或删除），未做修改", 8000);
					return;
				}
				const next = renameInspirationBlock(md, target, value, target.date);
				if (!(await this.writeInspirationDoc(story, next))) return;
				new Notice(`已改名：${target.heading} → ${inspirationHeading(value, target.date)}`, 6000);
			},
			undefined,
			undefined,
			block.name
		).open();
	}

	/** 删除：确认后只移除这一块（其他灵感与文档本身保留）。返回处理后的最新文档文本（取消/写盘失败＝原文本），供弹窗回填列表 */
	private async cmdDeleteInspiration(story: string, block: InspirationBlock): Promise<string> {
		const md = await this.readInspirationDoc(story);
		const target = this.findInspirationBlock(md, block);
		if (!target) {
			new Notice("该灵感块已不在文件里（可能刚被手工改动或删除），未做修改", 8000);
			return md;
		}
		const ok = await new Promise<boolean>((res) => {
			new ConfirmModal(
				this.app,
				`删除灵感「${target.heading}」？`,
				`${inspirationPreview(target.body, 60) || "（该块正文为空）"}\n只移除这一块，其他灵感与文件本身保留。`,
				"删除",
				() => res(true),
				() => res(false)
			).open();
		});
		if (!ok) return md;
		const next = removeInspirationBlock(md, target);
		if (!(await this.writeInspirationDoc(story, next))) return md;
		new Notice(`已删除灵感「${target.heading}」`, 5000);
		return next;
	}

	/** 弹窗里拿到的块对象可能因手工编辑或上一次增删而失效（行号变了）：按「标题＋行号 → 标题」两级回查到最新文档里的同一块 */
	private findInspirationBlock(md: string, block: InspirationBlock): InspirationBlock | null {
		const blocks = parseInspirationDoc(md);
		return blocks.find((b) => b.heading === block.heading && b.line === block.line) ?? blocks.find((b) => b.heading === block.heading) ?? null;
	}

	// ---------- v0.4.3+ 「编写一章」共用核心（/write 与连续编写共用：命令侧只做目标解析、模式选择与落盘收尾） ----------

	/** AI 味本地检测（不花 LLM 调用）：禁用词命中数＋命中词（按出现序去重）＋命中整句。
	 *  连续编写用它把每章的 AI 味先登记到《AI味清单.md》、整轮写完再统一打回重写（即时清洗会把刚写好的会话从引擎 slot 顶掉、断掉前缀复用链） */
	private async detectAiFlavor(content: string): Promise<DeaiFlavor> {
		const data = await this.loadBannedWords();
		const hits = findAiWordHits(content, data);
		if (!hits.length) return { hits: 0, words: [], sentences: [] };
		const words: string[] = [];
		for (const h of hits) if (!words.includes(h.word)) words.push(h.word);
		return { hits: hits.length, words, sentences: findAiSentences(content, data).map((s) => s.sentence.trim()) };
	}

	/** v0.4.3+ 编写一章核心（/write 与连续编写唯一共用的生成路径）：装配写作上下文（StableSink 记稳定前缀长度）→ buildChapterPrompt
	 *  → 「生成过程」面板流式生成（带前缀缓存钉点）→ 解析「正文＋<SUMMARY> 块」→ 去AI味（`deferDeai`＝true 时只做词表本地检测、把命中交调用方登记，不动正文）
	 *  → 字数/章节编号引用提醒 →（可选）并入旧正文 → 面板回显最终正文。
	 *  **不落盘、不收尾面板**：由调用方按各自模式处理（/write 走「保存/不保存」确认，连续编写自动保存＋finishAuto） */
	private async writeOneChapter(opts: {
		story: string;
		chKey: string; // 章节复合键（调用方须已建好章节目录）
		label: string; // 展示用章名（keyLabel 结果）
		chapterOutlineRaw: string; // 注入提示词的本章大纲
		userInstruction?: string; // /write 的「创作要点」
		panelTitle: string; // 生成面板标题
		setup: PhaseLlmSetup;
		state: StoryState;
		deferDeai?: boolean; // 连续编写：本章不即时清洗，只返回 AI 味命中供登记
		mergeContent?: (fresh: string) => string; // /write 追加模式：把新生成正文并入磁盘旧正文
	}): Promise<ChapterWriteResult> {
		const { story, chKey, label, setup, state } = opts;
		const data = await this.manager.loadWritingData(story, chKey, { includeCurrentSummary: false }); // 本章大纲是否注入由章级 specs 的 skip 控制（prompt_files 装配）
		const docs = await this.assembleWritingDocGroups(story, data, { skipChapterOutline: true }); // 本章大纲由 buildChapterPrompt 注入，上下文不重复
		const stable: StableSink = {}; // v0.4.x+ 前缀缓存锚点：记下上下文里「稳定前缀」的字符长度
		const context = buildWritingContext({ ...data, ...docs }, stable);
		let prevRefs: Array<{ label: string; text?: string }> = [];
		try {
			prevRefs = (await this.manager.readOutlineWindow(story, chKey, { back: 3 })).map((w) => ({ label: w.label, text: w.text || undefined }));
		} catch { /* 前文大纲窗口读取失败不阻断生成 */ }
		const wordRange = this.wordRangeOf(state);
		const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块
		const withSummary = state.use_summaries !== false; // v0.2.21+：摘要随写（关闭摘要时不要求也不保存）
		const built = buildChapterPrompt({
			chapterNum: data.chapterNum, // v0.0.15：阅读序位置（ordinal，跨卷连续）
			chapterLabel: label,
			chapterKey: chKey,
			chapterOutlineRaw: opts.chapterOutlineRaw,
			userInstruction: opts.userInstruction,
			context,
			wordRange,
			descStyle: setup.descStyle,
			storyType: state.writing_style,
			taskSkillBlock: (await this.loadSelectedTaskSkill()) || undefined,
			prevOutlines: prevRefs,
			withSummary,
		});
		console.debug("[articlewriter] 编写本章请求规模", { model: setup.cfg.model_name || "(默认)", systemLen: sp.length, promptLen: built.prompt.length }); // 排查连接失败是否与请求体量相关

		const modal = await this.beginWritingPanel(opts.panelTitle, setup.cfg);
		if (!modal) return { ok: false, reason: "panel" };
		let content = await this.generateChapterStreamed(setup.cfg, sp, built.prompt, state.writing_style, modal, this.cachePin(built.prompt, context, stable.stableChars));
		if (modal.signal.aborted) return { ok: false, reason: "aborted" };
		if (!content.trim()) return { ok: false, reason: "empty" };

		// 解析「正文＋<SUMMARY> 块」（解析失败整段当正文，静默回落到延迟生成）；面板预览随后经既有 reset 逻辑刷新为纯正文
		let chapterSummary: string | null = null;
		if (withSummary) {
			const parsed = parseChapterWithSummary(content);
			chapterSummary = parsed.summary;
			content = parsed.body;
			if (!content.trim()) return { ok: false, reason: "body" }; // 正文为空（如模型只输出了摘要块）→ 按生成失败处理
		}

		// 去AI味时机：单章命令写完立即改；连续编写只登记、整轮写完后统一改（见 cmdWriteConsecutive）
		let aiFlavor: DeaiFlavor | null = null;
		if (opts.deferDeai) {
			aiFlavor = await this.detectAiFlavor(content);
			if (aiFlavor.hits) new Notice(`${label}：检测到 ${String(aiFlavor.hits)} 处 AI 常用词，已登记《${DEAI_LEDGER_DOC_NAME.replace(/\.md$/, "")}》，整轮写完后统一改写`, 6000);
		} else {
			content = await this.autoCleanAi(setup.cfg, setup.systemPrompt, content, () => {
				modal.setStatus("正在去除 AI 常用词…");
			}, modal.signal, { context, stableChars: stable.stableChars }); // v0.4.3+ 带上本章的写作上下文前缀（本地端点复用同一份 K/V）
			if (modal.signal.aborted) { modal.markStopped(); return { ok: false, reason: "aborted" }; } // v0.4.x+ 停止在去AI味阶段同样生效：面板定格、不再重绘/弹保存确认
		}
		this.warnWordLimit(content, wordRange);
		this.warnChapterRefs(content); // 只检测新生成内容（追加模式合并旧正文前），避免误报既有正文
		void this.warnSensitiveWords(content); // v0.4.6+：敏感词软提醒（零 LLM、非阻断，词表＝SKILLS/敏感词清单.md）
		if (opts.mergeContent) content = opts.mergeContent(content);
		if (content !== modal.fullText) {
			modal.reset();
			modal.append(content);
		}
		return { ok: true, content, chapterSummary, modal, aiFlavor };
	}

	/** v0.4.3+ 连续编写收尾：整轮章节写完后统一去AI味（**手动停止/面板关闭都不豁免**——已写完的章不该留着 AI 味交回用户）。
	 *  逐章回读正文＋重建写作上下文（与刚写完时同一装配 → 清洗请求带同一段前缀、K/V 复用不断链）、
	 *  调 autoCleanAi 打回重写并就地写回正文，同时把结果回填进《AI味清单.md》的条目状态。
	 *  面板只是预览载体（清洗走非流式 chatCompletion）→ 打不开也照洗；清洗途中被停止＝当前章标 stopped、其余留 pending，
	 *  由「补做去AI味」命令按《AI味清单.md》续做（见 cmdDeaiLedgerResume）。 */
	private async runDeferredDeai(story: string, ledger: DeaiLedger, setup: PhaseLlmSetup): Promise<void> {
		for (const e of ledger.entries) {
			if (e.status !== "pending") continue;
			if (!e.chKey) { e.status = "stopped"; e.note = "清单里缺该章的章节键（旧版清单文档），无法定位正文，未处理"; continue; } // 键行＝渲染时写入的 <!-- aw-deai-key:… -->，旧文件没有→按章名也认不出来的就跳过
			const panel = await this.beginWritingPanel(`统一去AI味 ${e.label}`, setup.cfg);
			if (!panel) console.warn(`[articlewriter] 统一去AI味：生成面板打不开，${e.label} 仍照常清洗（只是没有预览）`);
			const body = await this.manager.readChapterContent(story, e.chKey);
			if (!body.trim()) {
				e.status = "cleaned";
				e.note = "正文为空，无需清洗";
				panel?.finishAuto("正文为空，跳过清洗", "清洗用时");
				continue;
			}
			const data = await this.manager.loadWritingData(story, e.chKey, { includeCurrentSummary: false });
			const docs = await this.assembleWritingDocGroups(story, data, { skipChapterOutline: true });
			const stable: StableSink = {};
			const context = buildWritingContext({ ...data, ...docs }, stable);
			const cleaned = await this.autoCleanAi(setup.cfg, setup.systemPrompt, body, () => {
				panel?.setStatus("正在统一去除 AI 常用词…");
			}, panel?.signal, { context, stableChars: stable.stableChars });
			if (panel?.signal.aborted) {
				panel.markStopped();
				e.status = "stopped";
				e.note = "清洗被停止，正文未改写（《AI味清单.md》里仍待处理，可用「补做去AI味」继续）";
				return; // 用户显式停止清洗＝本轮收尾到此为止，其余章原样留在清单里
			}
			if (cleaned === body) {
				e.status = "cleaned";
				e.note = "正文未变化（词表命中，但句式简化与整句重写都未生效）";
			} else {
				const words = await this.manager.setChapterBody(story, e.chKey, cleaned);
				const left = (await this.detectAiFlavor(cleaned)).hits;
				e.status = "cleaned";
				e.note = `已写回 ${String(words)} 字${left ? `，仍剩 ${String(left)} 处命中` : "，命中已清零"}`;
			}
			panel?.reset();
			panel?.append(cleaned); // 面板回显清洗后的正文（清洗走非流式 chatCompletion，过程中面板只有状态行）
			panel?.finishAuto(`✓ ${e.note ?? ""}`.trim());
		}
	}

	/** v0.4.3+ 登记表落盘：书级《案头资料/AI味清单.md》（写字台「案头资料」节可直接点开）。连续编写每写完一章就重写一次，
	 *  中途停止也留下待处理清单；失败只提示、不打断编写流程。返回文件路径（失败返回 ""） */
	private async writeDeaiLedger(story: string, ledger: DeaiLedger): Promise<string> {
		const path = `${this.manager.deskDocsPath(story)}/${DEAI_LEDGER_DOC_NAME}`;
		try {
			await this.manager.ensureDoc(path, "");
			const f = this.app.vault.getAbstractFileByPath(path);
			if (f instanceof TFile) await this.app.vault.modify(f, renderDeaiLedger(ledger));
			return path;
		} catch (e) {
			this.notifyError("写入《AI味清单.md》失败", e);
			return "";
		}
	}

	/** v0.4.3+ 「补做去AI味」命令：把《AI味清单.md》里没洗完的章接着洗完——连续编写中途停止、清洗中途被停止、面板被打不开/关掉
	 *  都只把已处理章标 ✓，其余留在清单里（⏳/✋）。本命令读回清单（`parseDeaiLedgerDoc`）→ 未清洗条目重新排队 → 走与连续编写收尾
	 *  **同一条** `runDeferredDeai`（同一装配的写作上下文前缀＋钉点，K/V 复用口径不变）→ 重写清单。已清洗章不动。 */
	async cmdDeaiLedgerResume(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		const ledgerPath = `${this.manager.deskDocsPath(story)}/${DEAI_LEDGER_DOC_NAME}`;
		const f = this.app.vault.getAbstractFileByPath(ledgerPath);
		const shortName = DEAI_LEDGER_DOC_NAME.replace(/\.md$/, "");
		if (!(f instanceof TFile)) { new Notice(`没有找到《${shortName}》——只有「连续编写」会写这份清单（单章命令写完立即清洗）`, 8000); return; }
		const ledger = parseDeaiLedgerDoc(await this.app.vault.read(f));
		if (!ledger) { new Notice(`《${shortName}》不是插件生成的清单格式（可能被手工改写过），未做任何处理`, 8000); return; }
		const todo = ledger.entries.filter((e) => e.status !== "cleaned");
		if (!todo.length) { new Notice(`《${shortName}》里没有待处理章节（登记 ${String(ledger.entries.length)} 章都已清洗）`, 6000); return; }
		// 旧版清单文档没有机器可读键行 → 按章名（keyLabel 口径）反查章节键；认不出来的由 runDeferredDeai 标 stopped 跳过
		const volNames = await this.volNameMap(story).catch(() => ({}));
		const chapters = await this.manager.listChapters(story);
		for (const e of todo) {
			if (e.chKey) continue;
			const hit = chapters.find((c) => this.keyLabel(c.key, volNames, c.title) === e.label);
			if (hit) e.chKey = hit.key;
		}
		for (const e of todo) { e.status = "pending"; } // 重新排队（runDeferredDeai 只处理 pending；✋ 未清洗同样要补做）
		const setup = this.getPhaseLlmSetup(PHASE_WRITING); // 与连续编写同一阶段配置
		if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
		new Notice(`开始补做去AI味：${ledgerCounts(ledger)}`, 8000);
		await this.runDeferredDeai(story, ledger, setup);
		const written = await this.writeDeaiLedger(story, ledger);
		const leftCount = ledger.entries.filter((e) => e.status !== "cleaned").length;
		new Notice(`补做去AI味结束：${ledgerCounts(ledger)}${leftCount ? `\n仍有 ${String(leftCount)} 章未清洗（可再次运行本命令）` : ""}${written ? `\n清单文件：${written}` : ""}`, 12000);
	}

	// ---------- /write 创作章节 ----------

	async cmdWrite(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			const scenes = await this.manager.loadAllScenes(story);
			const curSceneId = state.current_scene ?? undefined;
			const curScene = curSceneId ? scenes[curSceneId] : undefined;

			// 目标章节复合键：当前章 → 当前场景归属章 → 当前卷/书根内下一未建章（v0.0.15：编号在容器内自动顺延）
			const chapters = await this.manager.listChapters(story); // 阅读序：书根在前 + 各卷按 order、组内本地号升序
			let targetKey: string | null = state.current_chapter && state.current_chapter !== "" ? state.current_chapter : null;
			if (!targetKey && curScene?.chapter_num) targetKey = chKey(curScene.vol ?? "", curScene.chapter_num);
			if (!targetKey) {
				const basePath = this.manager.storyPath(story);
				const scopeVol = (state.current_volume ?? "").trim();
				const inScope = scopeVol ? chapters.filter((c) => c.vol === scopeVol) : chapters.filter((c) => !c.vol && c.parentPath === basePath);
				targetKey = chKey(scopeVol, inScope.length ? Math.max(...inScope.map((c) => c.num)) + 1 : 1);
			}

			const volNames = await this.volNameMap(story).catch(() => ({}));
			const tLabel = this.keyLabel(targetKey, volNames); // 展示名（含卷前缀），交互提示统一用它
			const targetVol = parseChKey(targetKey).vol ?? ""; // 新建章节的容器（""=书根）
			const chEntry = chapters.find((c) => c.key === targetKey) ?? null;
			const meta = state.chapters[targetKey] ?? null;
			const wasNew = !meta; // 对应 Python is_new（以状态元数据为准）
			const isNewLike = wasNew && !chEntry; // 全新章节（无目录且无元数据）
			const bodyOnDisk = chEntry ? await this.manager.readChapterContent(story, targetKey) : "";
			const outlineOnDisk = chEntry ? await this.manager.readChapterOutlineForPrompt(story, targetKey) : "";
			const hasContent = bodyOnDisk.trim() !== "";

			// 章节标题：已有取磁盘/状态；全新章节询问（Esc=取消）
			let title = ((meta?.title || "").trim()) || (chEntry ? chEntry.title : "") || `第${parseChKey(targetKey).num}章`;
			if (isNewLike) {
				const t = await this.prompt(`${tLabel}标题`, `${tLabel}`);
				if (t == null) return;
				title = t.trim() || `第${parseChKey(targetKey).num}章`;
			}

			// 写作指令交互（对齐 CLI args 语义）
			let instruction = "";
			if (hasContent) {
				const pick = await this.pickAction(`${this.keyLabel(targetKey, volNames, title)} 已有内容（${String(countPureWords(bodyOnDisk))} 字）`, [
					{ label: "给出新的创作要点", sub: "生成后选择追加或覆盖" },
					{ label: "暂不创作", sub: "仅提示当前状态" },
				]);
				if (pick == null) return;
				if (pick === 1) {
					new Notice("章节已有创作内容，请输入新的写作指令开始创作\n或使用「续写当前章 (/continue)」继续");
					return;
				}
				instruction = ((await this.prompt("创作要点", "如：写主角来到小镇的见闻")) ?? "").trim();
				if (!instruction) {
					new Notice("未输入创作要点，已取消");
					return;
				}
			} else if (!outlineOnDisk.trim()) {
				// 无正文且无大纲：才交互询问；有大纲时不再打扰（对齐 CLI /write「未提供写作指令→按大纲自动创作」语义）
				const pick = await this.pickAction(`${tLabel}还没有正文，也没有大纲`, [
					{ label: "先输入创作要点再开始" },
					{ label: "直接开始（无参考内容）" },
				]);
				if (pick == null) return;
				if (pick === 0) {
					instruction = ((await this.prompt("创作要点（可选）", "如：写主角与反派的初次交锋")) ?? "").trim();
				}
			} else {
				new Notice(`未提供写作指令，按${tLabel}大纲自动创作`, 4000); // 有大纲、无正文：直接开写，不弹任何输入框
			}

			let structureReady = !!chEntry;
			let outlineForGen = outlineOnDisk;

			// 全新章节且无指令：从磁盘/询问补充大纲（对应 is_new && !instruction 分支）
			if (!instruction && isNewLike && !outlineOnDisk.trim()) {
				const o = await this.promptArea(`${tLabel}大纲（可选）`, "- 情节要点一\n- 情节要点二");
				if (o == null) return;
				outlineForGen = o.trim();
			}

			// 未提供写作指令：有大纲且尚无正文 → 按大纲自动创作；否则只创建/就绪后返回
			if (!instruction) {
				if (!(outlineForGen.trim() !== "" && !hasContent)) {
					if (wasNew && !structureReady) {
						await this.manager.createChapter(story, title, targetVol); // 目标容器（卷/书根）内自动顺延编号
						structureReady = true;
						new Notice(`✓ 已创建 ${this.keyLabel(targetKey, volNames, title)}`, 6000);
					} else {
						new Notice(`✓ 已就绪：${this.keyLabel(targetKey, volNames, title)}`, 6000);
					}
					new Notice("章节已有创作内容时，请给出新的写作指令开始创作\n或使用「续写当前章 (/continue)」继续", 10000);
					return;
				}
			}

			// 追加还是覆盖（对应 a/r 询问，默认追加）
			let mode: "a" | "r" = "a";
			if (hasContent) {
				const m = await this.pickAction(`${this.keyLabel(targetKey, volNames, title)} 已有内容（${String(countPureWords(bodyOnDisk))} 字），如何处理？`, [
					{ label: "追加到现有内容之后", sub: "默认；自动剥离新内容的重复标题" },
					{ label: "覆盖整章正文" },
				]);
				if (m == null) return;
				mode = m === 1 ? "r" : "a";
			}

			// 生成前把用户指令并入大纲并落盘（仅对已有章节/已有大纲做预合并）
			if (instruction && !!(meta || chEntry || outlineOnDisk.trim())) {
				outlineForGen = appendOutlineInstruction(outlineOnDisk, "创作要点", instruction);
				if (!structureReady) {
					await this.manager.createChapter(story, title, targetVol); // 目标容器内自动顺延编号
					structureReady = true;
				}
				await this.manager.setChapterOutline(story, targetKey, outlineForGen);
				new Notice(`已更新${tLabel}大纲并保存`, 4000);
			}

			// 组装提示词与系统提示词（loadWritingData/readOutlineWindow 按磁盘阅读序定位，全新章须先建目录）
			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			if (!structureReady) {
				await this.manager.createChapter(story, title, targetVol); // 目标容器内自动顺延编号
				structureReady = true;
				new Notice(`✓ 已创建 ${this.keyLabel(targetKey, volNames, title)}`, 6000);
			}
			// v0.4.3+ 生成走「编写一章」共用核心（与连续编写同一条代码路径）：上下文装配→流式生成（带钉点）→摘要解析→去AI味→提醒→面板回显
			const res = await this.writeOneChapter({
				story,
				chKey: targetKey,
				label: tLabel,
				chapterOutlineRaw: outlineForGen,
				userInstruction: instruction || undefined,
				panelTitle: `创作 ${this.keyLabel(targetKey, volNames, title)}`,
				setup,
				state,
				mergeContent: mode === "a" && hasContent ? (fresh) => bodyOnDisk.replace(/\s+$/, "") + "\n\n" + stripHeading(fresh) : undefined, // 追加模式：新生成正文并入磁盘旧正文
			});
			if (!res.ok) {
				if (res.reason === "panel") new Notice("无法打开生成面板，本次操作已取消", 8000);
				else if (res.reason === "aborted") new Notice("已停止生成，本章正文未保存", 6000); // v0.4.x+ 停止在去AI味阶段同样生效：面板定格、不再重绘/弹保存确认
				return;
			}
			const { content, chapterSummary, modal } = res;
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice(`未保存${wasNew ? "（新章节结构已保留，正文未写入）" : ""}`, 6000);
				return;
			}

			// 落盘：新章创建目录；追加/覆盖写正文；新章指令并入大纲
			if (!structureReady) {
				await this.manager.createChapter(story, title, targetVol); // 目标容器内自动顺延编号
				structureReady = true;
			}
			const words = await this.manager.setChapterBody(story, targetKey, content); // v0.1.4+：摘要不再写盘后即时生成——下次组装写作上下文时按需延迟生成（带进度反馈）
			// v0.2.21+：同响应产出的摘要分别落盘（按已存正文重算哈希→下次上下文组装判「新鲜」直接复用，省掉单独摘要 LLM 调用）
			if (chapterSummary) {
				try {
					await this.manager.saveChapterSummary(story, targetKey, chapterSummary);
				} catch { /* 摘要保存失败不阻断主流程（回落到延迟生成） */ }
			}
			if (wasNew) {
				let finalOutline = outlineForGen;
				if (instruction) finalOutline = appendOutlineInstruction(finalOutline, "创作要点", instruction);
				if (finalOutline.trim()) await this.manager.setChapterOutline(story, targetKey, finalOutline);
			}

			// 当前场景归属该章时同步场景正文（v0.0.15：按复合键比较）
			if (curScene?.chapter_num && chKey(curScene.vol ?? "", curScene.chapter_num) === targetKey) {
				const old = (curScene.content || "").replace(/\s+$/, "");
				const sceneNew = old ? `${old}\n\n${content}` : content;
				await this.manager.updateScene(story, curScene.scene_id, { content: sceneNew });
				new Notice(`✓ 已同步到场景 '${curScene.scene_id}'`, 6000);
			}

			try {
				const f = await this.manager.chapterBodyFile(story, targetKey);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* 打开失败不影响结果 */ }
			new Notice(`✓ ${this.keyLabel(targetKey, volNames, title)} 创作完成！\n字数：${String(words)}${chapterSummary ? "\n摘要：已随正文一并保存" : ""}`, 8000);
		} catch (e) {
			this.notifyError("创作章节失败", e);
		}
	}

	// ---------- v0.2.10+ 从卷大纲生成章节 (/vol-outline-to-chapters) ----------

	/** 按章号解析拆分源（H2 标题 `## 第N章 <标题>` 或「第N章」开头的普通段落），缺失章节自动创建，各段内容全量覆盖写入对应章节的《章节大纲.md》（旧大纲内容被替换）；v0.4.3+ 书级开关 `ai_expand_chapter_outline`（缺省开）开启时，拆出的各章段落逐章交给阶段 3 模型、按专属技能《章大纲编写》（`SKILLS/系统提示词/章大纲编写.md`）扩写成完整章大纲（长度≈该章正文目标字数 1/4）后落盘，扩展为空/中止前后章保留原文；AI 拆分兜底路径已逐章生成完整大纲、不再二次扩写。既有章节标记带标题时同步章名（复用 renameChapter：章节目录改名+文档文件名前缀+文档内旧标题引用+元数据 title，标记无标题则不动名）；一个「第N章」标记都识别不到时调 LLM 自动拆分（目标章数优先取大纲内声明如「共N章」，未声明弹窗收集、取消即中止；v0.2.x+ 走统一「生成过程」面板流式预览、停止按钮/关面板中止；输出同格式再走同一解析器，失败提示并中止）。收尾：有原当前章则恢复，否则指向该容器首章（供「连续编写」从第 1 章起步）。v0.4.6+ 中断续跑：主循环每写成一章《章节大纲》即把进度写入《故事状态.md》frontmatter 的 `outline_split`（vol＝本轮拆分源容器，done＝已写入章复合键），正常收尾清除；被停止/中止后同容器再运行且标记非空时，先弹「继续生成（跳过 done∩存活 的章，其正文与大纲不动、也不进清理范围）/ 清理重新生成（清标记整体重跑）/ 取消」；大纲改成无「第N章」标记时无法续跑，自动清标记改走 AI 全量拆分。可选参 volId＝写字台卷节点右键入口：锁定被点卷、不弹选择器（找不到该卷则提示中止）。v0.2.x+ 平铺（无卷）模式：拆书级《大纲.md》、章节落书根（空 volId）——「生成书籍大纲」平铺形态的配套拆章步骤 */
	async cmdVolumeOutlineToChapters(volId?: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			const flatMode = state.use_volumes === false;
			let vol: { id: string; name: string };
			let raw: string;
			let sourceLabel: string;
			if (flatMode) {
				// v0.2.x+ 平铺（无卷）模式：以书级《大纲.md》为拆分源，章节直接落书根（空 volId）
				vol = { id: "", name: "书级大纲" };
				sourceLabel = "书级《大纲.md》";
				raw = await this.manager.readGlobalOutline(story);
				if (!raw.trim()) { new Notice("书级《大纲.md》为空，请先生成或撰写大纲再生成章节", 8000); return; }
			} else {
				const volsRec = await this.manager.loadVolumes(story);
				const vols = Object.values(volsRec).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
				if (!vols.length) { new Notice("还没有卷，请先新建卷（新建卷）", 8000); return; }
				const curVol = (state.current_volume ?? "").trim();
				let v = volId ? this.manager.findVolumeIn(volsRec, volId) : (curVol ? this.manager.findVolumeIn(volsRec, curVol) : null); // 右键入口锁定被点卷；否则回落当前卷
				if (!v) {
					if (volId) { new Notice(`找不到卷 ${volId}（可能已改名或删除）`, 8000); return; }
					const items: ActionItem[] = vols.map((vv) => ({ label: vv.name, sub: vv.description || undefined, marker: vv.id === curVol ? "▶ 当前" : undefined }));
					const idx = await this.pickAction("选择目标卷（从它的卷大纲生成章节）", items);
					if (idx == null) return;
					v = vols[idx];
				}
				vol = v;
				sourceLabel = `「${vol.name}」的卷大纲`;
				raw = await this.manager.readVolumeOutline(story, vol.id);
				if (!raw.trim()) { new Notice(`卷「${vol.name}」的《卷大纲.md》为空，请先写大纲再生成章节`, 8000); return; }
			}
			// v0.4.6+ 中断续跑：marker.vol 与本轮拆分源容器一致且 done 非空＝上次已写入若干章《章节大纲》后中途停止（AI 拆分兜底不中途落盘，不会留半截标记）。
			// 三选：继续生成（跳过 done∩存活 的章）/ 清理重新生成（清标记、整体重跑＝旧行为）/ 取消。其他容器残留的标记不动，等那个容器自己运行时再问。
			const marker = state.outline_split && state.outline_split.vol === vol.id ? state.outline_split : undefined;
			let resumeDone = new Set<string>();
			if (marker?.done.length) {
				if (this.auto) { // v0.3.0+ auto 流水线免交互：残留进度直接丢弃（与 promptOutlineGenMode auto＝完整生成同语义），整体重新生成
					state.outline_split = undefined;
					await this.manager.saveState(story, state);
				} else {
					const act = await this.pickAction(`从${sourceLabel}生成章节：检测到上次运行被中断`, [
						{ label: "继续生成（跳过已生成章）", sub: `上次已写入 ${String(marker.done.length)} 章大纲——这些章不再扩展/覆盖，只补写其余章` },
						{ label: "清理重新生成", sub: "丢弃上次进度，按大纲整体重新生成（清旧正文、删大纲外多余章照旧）" },
						{ label: "取消", sub: "保留上次进度与现状，本次不做任何改动" },
					]);
					if (act == null || act === 2) return;
					if (act === 0) resumeDone = new Set(marker.done);
					else { state.outline_split = undefined; await this.manager.saveState(story, state); }
				}
			}
			let { segments, preamble } = splitVolOutlineByChapter(raw);
			let aiSplit = false;
			let aiCount = 0;
			if (!segments.length) {
				if (resumeDone.size) { // 大纲已被改成无「第N章」标记：done 集合无从映射到章号，无法续跑——清标记改走 AI 全量拆分
					new Notice("大纲中未检测到「第N章」标记，无法按上次进度续写——已清除中断标记，改走 AI 全量拆分生成", 8000);
					resumeDone = new Set();
					state.outline_split = undefined;
					await this.manager.saveState(story, state);
				}
				// 一个章节标记都没有 → 交给 AI 拆分，但改成逐章生成：每章调用一次 LLM，生成完后立即继续下一章，不在一轮里把整份大纲推成超长思考。
				const setup = this.getPhaseLlmSetup(PHASE_CHAPTER_OUTLINE); // v0.2.22+：文章大纲生成阶段（卷/书大纲拆分为章节大纲）
				if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
				const systemPrompt = assembleSystemPrompt(undefined, this.promptSkill("卷大纲生成", VOL_OUTLINE_GEN_SYSTEM_PROMPT));
				const cleaned = stripComments(raw);
				const count = extractPlannedChapterCount(cleaned) ?? await this.promptSplitCountSync(story, state, flatMode ? null : vol);
				if (count == null) return;
				const volList = flatMode ? [] : Object.values(await this.manager.loadVolumes(story)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((v) => ({ name: v.name, description: v.description }));
				await this.ensurePlanningGuide(story, state); // v0.2.13+：缺失则先自动生成（软依赖，失败返回 ""）；副作用先行，specs 只负责读盘注入
				// v0.2.24+ prompt_files 装配：上下文块循环外一次装配（各章共用）。strict 模式：【当前大纲来源】=清洗后的拆分源，跳过全书大纲/前卷/人物关系块（与旧字段口径一致）
				const assembled = await this.assembleVolOutlineContext(story, state, vol, { outlineText: cleaned, strict: true, noBookRel: true, noVolRel: true, volumes: volList, phaseIdx: PHASE_CHAPTER_OUTLINE }); // v0.2.25+：AI 拆分兜底走阶段 3（文章大纲生成）引用文档清单
				const contextDocs = assembled.text;
				const soFarSegs: string[] = []; // 本轮已生成各章（提示词注入时经 outlineSoFarContext 裁剪为最近 3 章）
				for (let num = 1; num <= count; num++) {
					const view = await this.beginWritingPanel(`AI 拆分${sourceLabel}第${num}章`, setup.cfg);
					if (!view) return;
					const prompt = buildVolOutlineChapterPrompt({
						contextDocs,
						strictCurrentOutlineOnly: true,
						targetVolumeName: vol.name,
						chapterCount: count,
						chapterNum: num,
						generatedSoFar: this.outlineSoFarContext(soFarSegs),
					});
					// v0.4.3+ 前缀缓存锚点：逐章共用的上下文整段（含本轮之前已生成章节）钉在稳定前缀末尾
					const pin = this.cachePin(prompt, contextDocs, this.stableCharsBefore(contextDocs, assembled.blocks, HDR_OUTLINE_SOURCE));
					const chunk = await this.streamWithEmptyRetry(setup.cfg, () => [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: prompt },
					], view, `AI 拆分${sourceLabel}为 ${count} 章 · 第${num}章`, { max_tokens: Math.max(setup.cfg.max_tokens ?? 4096, 8192), ...(pin ?? {}) });
					if (view.signal.aborted) return;
					if (!chunk.trim()) return;
					soFarSegs.push(chunk.replace(/\s+$/, ""));
					view.finishAuto(`✓ 第${num}章已生成`, "本章用时");
				}
				const allText = soFarSegs.join("\n\n"); // 全量拼接仅用于落盘解析与报错预览（提示词注入已裁剪）
				const reparsed = splitVolOutlineByChapter(allText);
				if (!reparsed.segments.length) {
					new Notice(`AI 逐章拆分结果中未识别到「第N章」标记，请重试或在${sourceLabel}中手动添加章节标记\nAI 输出开头：${allText.slice(0, 80)}…`, 15000);
					return;
				}
				segments = reparsed.segments;
				preamble = "";
				aiSplit = true;
				aiCount = count;
			}
			// v0.2.25+ 与大纲完全对齐：大纲章号集合之外的容器内旧章节为多余章节（确认后删除入回收站）；既有章节正文先清空（旧正文与新大纲冲突隐患）。有任何清理先弹窗确认，取消即中止、不落任何改动
			const validSegs = segments.filter((s) => s.num >= 1);
			const keepNums = new Set(validSegs.map((s) => s.num));
			const extras = validSegs.length ? await this.manager.listExtraChapters(story, vol.id, keepNums) : []; // 大纲全为无效章号时不删，防误清空容器
			const extraKeys = new Set(extras.map((c) => c.key));
			const prevCurrent = state.current_chapter ?? "";
			let clearedBodies = 0, deletedExtras = 0;
			const bodyKeepKeys = new Set([...extraKeys, ...resumeDone]); // v0.4.6+ 继续模式：上次已生成的章保留其正文/大纲，不进清空统计与清空范围
			const withBody = await this.manager.countChaptersWithBody(story, vol.id, bodyKeepKeys);
			if (withBody > 0 || extras.length) {
				const msg = [
					`从${sourceLabel}生成章节前，检测到目标范围内需要清理旧章节：`,
					withBody > 0 ? `\n- 清空 ${String(withBody)} 章旧正文（章节大纲同样被覆盖），避免旧正文与新大纲冲突` : "",
					extras.length ? `\n- 删除 ${String(extras.length)} 章大纲中没有的多余章节（移入回收站）：${extras.slice(0, 6).map((c) => `第${String(c.num)}章 ${c.title}`).join("、")}${extras.length > 6 ? `…等 ${String(extras.length)} 章` : ""}` : "",
					resumeDone.size ? `\n- 继续生成模式：上次已生成的 ${String(resumeDone.size)} 章不在此列，其正文与大纲保持不动` : "",
					"\n\n确认清理并继续生成？",
				].filter(Boolean).join("");
				const ok = await this.confirmBox("从大纲生成章节：清理旧章节", msg, "确认清理并生成");
				if (!ok) { new Notice("已取消：未清理旧章节、未生成章节", 5000); return; }
				if (withBody > 0) clearedBodies = await this.manager.clearChapterBodies(story, vol.id, bodyKeepKeys);
				// 降序删除：deleteChapter 删后若仍有更大号存活会触发补洞顺延，先删大号避免波及待删目标；大纲章号有洞时补洞可能把保留章挪到大纲外号位，故循环补删直到容器完全落在大纲号上
				if (validSegs.length) {
					for (;;) {
						const doomed = await this.manager.listExtraChapters(story, vol.id, keepNums);
						if (!doomed.length) break;
						for (let i = doomed.length - 1; i >= 0; i--) await this.manager.deleteChapter(story, doomed[i].key);
						deletedExtras += doomed.length;
					}
				}
			}
			let created = 0, setCount = 0, renamed = 0, expanded = 0, expandFailed = 0, skippedResumed = 0;
			const badNums: number[] = [];
			// v0.4.6+ 中断续跑：doneSet＝本轮结束时应生效的进度集（继续模式带上次 done 起步）；aliveBefore＝清理后仍存活的章键，
			// 跳过条件＝done 且存活（done 里被用户删掉的章照常重新生成）。每成功写成一章《章节大纲》即把 marker 落盘（saveSplitMarker），
			// 之后任何中途 return（停止按钮/关面板/异常）磁盘上都留有进度，下次同容器运行即可「继续生成」；正常收尾清除（clearSplitMarker）。
			const doneSet = new Set(resumeDone);
			const aliveBefore = new Set((await this.manager.listChapters(story)).map((c) => c.key));
			// v0.4.3+ 章大纲扩展：书级开关《故事状态.md》ai_expand_chapter_outline（缺省＝开）——把卷大纲拆出的各章段落交给阶段 3 模型，
			// 按专属技能「章大纲编写」扩写成完整章大纲（长度≈该章正文目标字数 1/4）后落盘；AI 拆分兜底路径（aiSplit）已逐章生成完整大纲、不再二次扩写。
			const expandOn = state.ai_expand_chapter_outline !== false && !aiSplit;
			const expandSetup = expandOn && segments.some((s) => s.num >= 1 && s.content.trim()) ? this.getPhaseLlmSetup(PHASE_CHAPTER_OUTLINE) : null;
			if (expandOn && !expandSetup && segments.some((s) => s.num >= 1 && s.content.trim())) new Notice("未找到可用的 LLM 模型配置，无法 AI 扩展章大纲——已直接写入拆分原文（可在设置页「写作阶段模型配置」配置阶段 3 模型）", 10000);
			const expandSystem = expandSetup ? assembleSystemPrompt(undefined, this.promptSkill("章大纲编写", CHAPTER_OUTLINE_EXPAND_SYSTEM_PROMPT)) : "";
			// v0.4.3+ 大纲阶段人物/关系分层：附录随章大纲扩展同一次调用输出，逐章写入书/卷/章三层文档
			const castRun = expandSetup ? await this.outlineCastRun(story, state) : null;
			const chapterWords = wordTargetHint(this.wordRangeOf(state)).mid; // 本章正文宜写字数（区间中值）
			const targetOutline = Math.max(200, Math.round(chapterWords / 4)); // 章大纲目标长度＝每章长度的 1/4
			const finalized: string[] = []; // 已落盘的各章大纲（最多取最近 2 章作衔接参考）
			for (const seg of segments) {
				if (seg.num < 1) { badNums.push(seg.num); continue; }
				const { key, created: isNew, renamed: wasRenamed } = await this.manager.ensureChapterAt(story, seg.num, seg.title, vol.id, true); // syncTitle：大纲标记标题为准同步章名/目录名
				if (isNew) created++;
				else if (wasRenamed) renamed++;
				if (castRun) castRun.tracker.registerChapter(key); // 章节目录刚建好 → 补注册空层，否则章级落点会被判为「层不存在」
				if (resumeDone.has(key) && aliveBefore.has(key)) { // v0.4.6+ 继续模式：上次中断前已写好本章大纲——跳过扩展与覆盖，仅把现存大纲喂进衔接参考（prevOutlines）
					skippedResumed++;
					const prevOutline = (await this.manager.readChapterOutline(story, key)).trim();
					if (prevOutline) finalized.push(`第${seg.num}章 ${seg.title}\n${prevOutline}`);
					continue;
				}
				const segText = seg.content.trim();
				if (!segText) continue;
				let outlineText = seg.content;
				let chapterCast: CastChapterAnalysis | null = null;
				if (expandSetup) {
					const view = await this.beginWritingPanel(`扩展第${seg.num}章章大纲`, expandSetup.cfg);
					if (!view) return;
					const assembled = await this.assembleVolOutlineContext(story, state, vol, {
						outlineText: segText,
						noVolRel: flatMode, // 平铺模式无卷级人物关系
						phaseIdx: PHASE_CHAPTER_OUTLINE,
					});
					const contextDocs = assembled.text;
					const prompt = buildChapterOutlineExpandPrompt({
						chapterNum: seg.num,
						chapterTitle: seg.title,
						outlineText: segText,
						chapterWords,
						targetWords: targetOutline,
						contextDocs,
						prevOutlines: finalized.slice(-2).join("\n\n"),
						castAppendix: !!castRun,
						knownNames: castRun?.tracker.knownNames(),
					});
					// v0.4.3+ 前缀缓存锚点：钉在「逐章变化的本章原始段落」之前的稳定前缀末尾（世界观/策划规范/人物关系等）
					const pin = this.cachePin(prompt, contextDocs, this.stableCharsBefore(contextDocs, assembled.blocks, HDR_OUTLINE_SOURCE));
					const chunk = await this.streamWithEmptyRetry(expandSetup.cfg, () => [
						{ role: "system", content: expandSystem },
						{ role: "user", content: prompt },
					], view, `扩写${sourceLabel}第${seg.num}章大纲`, { max_tokens: Math.max(expandSetup.cfg.max_tokens ?? 4096, 8192), ...(pin ?? {}) });
					if (view.signal.aborted) return;
					const parsed = castRun ? splitOutlineCastAppendix(chunk) : { body: chunk, cast: null };
					const body = parsed.body.trim();
					if (body) { outlineText = body; chapterCast = parsed.cast; expanded++; }
					else expandFailed++; // 扩展为空（或只有附录）：保留拆分原文
					view.finishAuto(body ? `✓ 第${seg.num}章大纲已扩展` : `⚠ 第${seg.num}章扩展为空，已保留拆分原文`, "本章用时");
				}
				await this.manager.setChapterOutline(story, key, outlineText); // 全量覆盖旧大纲
				setCount++;
				doneSet.add(key);
				await this.saveSplitMarker(story, vol.id, doneSet); // v0.4.6+ 每章落盘即提交进度：后续章若被停止/中止，下次运行可从此续跑
				if (castRun && chapterCast) await this.ingestOutlineCast(story, castRun.tracker, key, chapterCast, castRun.stats);
				finalized.push(`第${seg.num}章 ${seg.title}\n${outlineText.trim()}`);
			}
			// v0.4.6+ 正常收尾：清除中断续跑标记（磁盘上不存在则零写盘）；此后任何中途停止都会从头重新检测
			await this.clearSplitMarker(story);
			// 恢复/设置当前章：原当前章未被删除且未被补洞挪号（key 仍存活）则恢复；否则指向该容器首章（供「连续编写」从第 1 章起步）
			const aliveKeys = new Set((await this.manager.listChapters(story)).map((c) => c.key));
			if (prevCurrent && aliveKeys.has(prevCurrent)) await this.manager.switchChapter(story, prevCurrent);
			else if (validSegs.length) await this.manager.switchChapter(story, chKey(vol.id, Math.min(...validSegs.map((s) => s.num))));

			const lines = [`✓ 已从${sourceLabel}生成章节：共 ${String(segments.length)} 章${aiSplit ? `（未检测到章节标记，已由 AI 自动拆分为 ${aiCount} 章）` : ""}`];
			if (created) lines.push(`新建章节：${String(created)}`);
			if (renamed) lines.push(`同步章名（目录与文档引用一并更新）：${String(renamed)} 章`);
			if (deletedExtras) lines.push(`删除大纲外章节（移入回收站）：${String(deletedExtras)} 章`);
			if (clearedBodies) lines.push(`已清除旧正文：${String(clearedBodies)} 章`);
			if (setCount) lines.push(`写入大纲（覆盖旧内容）：${String(setCount)}`);
			if (skippedResumed) lines.push(`跳过（上次中断前已生成）：${String(skippedResumed)} 章`);
			if (expanded) lines.push(`AI 扩展章大纲（约 ${String(targetOutline)} 字/章，软技能《章大纲编写》）：${String(expanded)} 章`);
			if (expandFailed) lines.push(`扩展为空已保留拆分原文：${String(expandFailed)} 章`);
			if (castRun && castRun.stats.characters + castRun.stats.relationships + castRun.stats.skipped > 0) lines.push(this.outlineCastSummaryLine(castRun.stats));
			if (badNums.length) lines.push(`忽略无效章号：${badNums.join("、")}`);
			if (preamble.trim()) lines.push("提示：首个章标记前有卷级前言内容，未分配到任何章节");
			new Notice(lines.join("\n"), 12000);
		} catch (e) {
			this.notifyError("从卷大纲生成章节失败", e);
		}
	}

	/** v0.4.6+ 「从大纲生成章节」进度提交：先重读磁盘状态再合并 marker 写回——主循环里 ensureChapterAt/ingestCast 等已改过
	 *  状态文档（新章元数据、current_chapter），用命令入口的陈旧 state 整体写回会覆盖这些变更 */
	private async saveSplitMarker(story: string, volId: string, done: Set<string>): Promise<void> {
		const s = await this.manager.validatedState(story);
		s.outline_split = { vol: volId, done: [...done] };
		await this.manager.saveState(story, s);
	}

	/** v0.4.6+ 清除「从大纲生成章节」中断续跑标记（正常收尾）：磁盘上本就无标记则零写盘 */
	private async clearSplitMarker(story: string): Promise<void> {
		const s = await this.manager.validatedState(story);
		if (!s.outline_split) return;
		s.outline_split = undefined;
		await this.manager.saveState(story, s);
	}

	/** v0.2.24+ 提示词文件装配改造：卷大纲族（vol-outline-generate / 无卷自动建卷 / 书级大纲→生成卷 / AI 兜底拆分）与书籍大纲族共用上下文装配——
	 *  spec 顺序与块措辞逐字对齐旧 volOutlineContextParts/bookOutlineContextParts：书籍信息→世界观→策划规范→当前大纲来源→全书大纲→书籍/本卷人物关系→卷列表→前一卷卷大纲（张力手法已并入张力工具箱技能，经阶段引用清单的 skill: 条目注入，不再是固定 spec）。
	 *  strict = strictCurrentOutlineOnly（跳过全书大纲/前卷块）；noBookRel/noVolRel = 分别跳过书籍/本卷人物关系块；
	 *  noTargetMark = 卷列表不带「← 目标卷」标记（旧 book 族卷列表无标记）；
	 *  outlineText = 【当前大纲来源】正文（清洗由调用方负责，如 AI 拆分传 stripComments(raw)）；传了即跳过【全书大纲】文件条目（先到先赢去重同效）。
	 *  ensurePlanningGuide 副作用须先于本调用发生。
	 *  返回 AssembledPrompt：调用方取 .text 作 contextDocs；book 族另按 blocks 的 header 匹配推导 hasVolumes/hasPlanningGuide/hasBookRelationships/hasVolRelationships 旗标 */
	private async assembleVolOutlineContext(story: string, state: StoryState, vol: { id: string; name: string }, opts: {
		outlineText?: string;
		strict?: boolean;
		noBookRel?: boolean;
		noVolRel?: boolean;
		noTargetMark?: boolean;
		volumes?: Array<{ name: string; description?: string }>;
		prevOutline?: string;
		phaseIdx?: number; // v0.2.25+：引用文档配置框按阶段过滤注入（默认 PHASE_OUTLINE＝书籍大纲和卷级大纲生成；AI 拆分兜底传 PHASE_CHAPTER_OUTLINE）
	}): Promise<AssembledPrompt> {
		const desk = this.manager.deskDocsPath(story);
		// v0.2.25+：spec 带引用文档 key——按本阶段 ref_docs 清单过滤；
		const pairs: Array<{ key: string; spec: PromptSpec }> = [
			{ key: "book_info", spec: { text: bookInfoText(state.title, state.genre, state.writing_style), header: HDR_BOOK_INFO } },
			{ key: "worldview", spec: { file: `${desk}/世界观.md`, header: HDR_WORLD, stripHeading: false } }, // 旧 worldBlock 优先 fullText＝stripComments 后全文（含 H1）
			{ key: "timeline", spec: { text: await this.manager.mergedTimelineText(story), header: "【时间线】" } }, // v0.3.3+ 三层《时间线.md》合并时间轴（阶段 2/3 下拉目录可手动添加、默认不注入）；无有效条目＝空块不注入
			{ key: "planning_guide", spec: { file: this.manager.planningGuidePath(story), header: HDR_PLANNING, stripHeading: true } },
			{ key: "outline_source", spec: { text: opts.outlineText ?? "", header: HDR_OUTLINE_SOURCE } },
			{ key: "book_outline", spec: { file: `${desk}/大纲.md`, header: "【全书大纲】", stripHeading: true, skip: !!opts.strict || opts.outlineText !== undefined } },
			{ key: "book_relations", spec: { file: await this.manager.bookRelationshipsDocPath(story), header: HDR_BOOK_REL, stripComments: false, transform: cleanRelationshipsDoc, skip: !!opts.noBookRel } },
			{ key: "vol_relations", spec: { file: this.manager.volumeDocPath(story, { ...vol, description: "", order: 0 }, "人物关系.md"), header: HDR_VOL_REL, stripComments: false, transform: cleanRelationshipsDoc, skip: !!opts.noVolRel } }, // 卷目录名只吃 name/id，其余字段合成占位
			{ key: "vol_list", spec: { text: volumeListText(opts.volumes ?? [], opts.noTargetMark ? undefined : vol.name), header: HDR_VOL_LIST } },
			{ key: "prev_vol_outline", spec: { text: opts.prevOutline ?? "", header: "【前一卷卷大纲 · 仅参考】", skip: !!opts.strict } },
		];
		const phaseIdx = opts.phaseIdx ?? PHASE_OUTLINE;
		let ref = this.phaseRefDocKeys(phaseIdx);
		if (opts.outlineText !== undefined) {
			// v0.4.3+ 本段原文是本次调用的主输入（AI 拆分/章大纲扩展的唯一依据），两件事必须保证：
			// ①无论阶段引用清单怎么配（用户可增删）都要注入——否则模型没有依据、会凭空编造；
			// ②排在块串最后——它逐章变化，放稳定上下文（世界观/策划规范/人物关系等）之后才能让前缀缓存复用整段稳定头。
			ref = [...ref.filter((k) => k !== "outline_source"), "outline_source"];
		}
		// v0.2.25+：按 ref_docs 数组顺序注入（排前的先组装）；file: 条目在清单中的位置即注入位置
		// v0.3.4+：本书书籍技能按本阶段配置追加在清单条目之后（案头资料/Skill/）
		return assemblePromptFiles(this.promptReader(), this.orderRefDocSpecs(pairs, ref, { bookSkillDir: this.bookSkillsDir(story), bookSkillNames: await this.phaseBookSkillNames(story, phaseIdx) }));
	}

	/** v0.4.3+：编写文章阶段的大纲块（替代原先注入整份卷大纲/全书大纲）——按本书前后章窗口配置，只取当前章前 N 章与后 N 章的大纲节选：
	 *  - 卷模式：本卷《卷大纲.md》按**卷内本地章号**（localNum）切窗口；平铺模式：书级《大纲.md》按**全书章号**（chapterNum）切；
	 *  - 窗口 = [当前章号 - prevN, 当前章号 + nextN]，夹到 ≥1；节选**恒含前言块**（【卷设计】/本卷定位），章标记行保留；
	 *  - 章号缺失、读盘失败、或取到的节选与全文等价 → 回退整份大纲的 file spec（保证上下文不缺大纲）；
	 *  - 窗口内无任何章块且前言为空（prevN=nextN=0 的空大纲）→ 返回空 text（不注入）；
	 *  - 块归 chapter 组：内容逐章变化，不能落在 prompts.ts 前缀缓存的稳定段（vol 组在 stableEnd 之前）。
	 *  header 保持【本卷大纲】/【全书大纲】不变——prompts.ts outlineBlockNameOf 与正文要求的第 3 条措辞按 header 门控，不随节选改动 */
	private async writingOutlineSpec(
		storyName: string,
		dp: WritingDocPaths,
		ctx: { chapterNum?: number; localNum?: number; activeVolId?: string; prevN?: number; nextN?: number }
	): Promise<PromptSpec> {
		const header = dp.vol ? "【本卷大纲】" : "【全书大纲】";
		const whole: PromptSpec = dp.vol
			? { file: dp.vol.outline, header, stripHeading: true, transform: stripForeshadowMarks, group: "chapter" }
			: { file: dp.book.globalOutline, header, stripHeading: true, transform: stripForeshadowMarks, group: "chapter" };
		const cur = dp.vol ? (ctx.localNum ?? 0) : (ctx.chapterNum ?? 0);
		if (!cur || cur < 1) return whole; // 章号不可知（导出预览等边界）→ 保持原行为
		const nonNeg = (v: unknown, dflt: number): number => {
			const n = Math.floor(Number(v ?? dflt));
			return Number.isFinite(n) && n >= 0 ? n : dflt;
		};
		const prevN = nonNeg(ctx.prevN, 3);
		const nextN = nonNeg(ctx.nextN, 3);
		if (dp.vol && !ctx.activeVolId) return whole; // 卷模式但卷 id 缺失 → 不切片，回退整份
		let raw = "";
		try {
			raw = dp.vol ? await this.manager.readVolumeOutline(storyName, ctx.activeVolId ?? "") : await this.manager.readGlobalOutline(storyName);
		} catch {
			return whole; // 读盘失败 → 交回装配器按 file 读（缺失即缺失）
		}
		if (!raw.trim()) return whole;
		const sliced = sliceVolOutlineChapters(raw, Math.max(1, cur - prevN), cur + nextN).trim();
		if (!sliced) return { text: "", header, transform: stripForeshadowMarks, group: "chapter" }; // 前后窗口都为 0 且无卷设计 → 不注入大纲块
		if (sliced === raw.trim()) return whole; // 窗口覆盖整份大纲（书很短）→ 走 file spec，清洗口径与其余文档一致
		const span = [prevN > 0 ? `前 ${prevN} 章` : "", nextN > 0 ? `后 ${nextN} 章` : ""].filter(Boolean).join("、");
		const note = `（本节选仅含当前章${span || "（窗口为 0）"}的大纲与卷级前言，其余章节已省略）`;
		return { text: `${note}\n\n${sliced}`, header, transform: stripForeshadowMarks, group: "chapter" };
	}

	/** v0.2.24+ 提示词文件装配改造：写作上下文三层文档组串（bookDocs/volDocs/chapterDocs）——specs 按 loadWritingData 解析出的 data.docPaths 声明，
	 *  块措辞/清洗管线逐字对齐旧基线渲染：书级＝世界观.md（stripHeading:false，旧 fullText 含 H1）＋书级人物关系（cleanRelationshipsDoc 自带剥注释+剥 H1，故 stripComments:false）；
	 *  卷级＝卷大纲（剥 H1＋stripForeshadowMarks）＋卷人物关系；章级按旧注入顺序＝本章大纲（剥 H1＋stripForeshadowMarks，注入开关＝skipChapterOutline）→人物→场景→本章人物关系。
	 *  章级人物/场景旧口径只剥 `# 第N章` 题行、模板 `# 人物`/`# 场景` 标题保留，故不设 stripHeading。
	 *  旧跨层人物关系逐行去重（章>卷>书）随结构化渲染退役——现仅装配器整块去重（先到先赢＋同文跳过），已定稿取舍 */
	private async assembleWritingDocGroups(
		storyName: string,
		data: { docPaths: WritingDocPaths; chapterNum?: number; localNum?: number; activeVolId?: string; prevN?: number; nextN?: number },
		opts?: { skipChapterOutline?: boolean; phaseIdx?: number }
	): Promise<{ bookDocs: string; volDocs: string; chapterDocs: string }> {
		const dp = data.docPaths;
		// v0.4.3+：大纲块＝前后 N 章大纲节选（见 writingOutlineSpec）；v0.2.25+：spec 带引用文档 key——按本阶段（默认 3＝编写文章）ref_docs 清单过滤；用户自选 file: 条目并入书级组注入
		const outlineSpec = await this.writingOutlineSpec(storyName, dp, data);
		const pairs: Array<{ key: string; spec: PromptSpec }> = [
			{ key: "worldview", spec: { file: dp.book.world, header: HDR_WORLD, stripHeading: false, group: "book" } },
			{ key: "timeline", spec: { text: await this.manager.mergedTimelineText(storyName), header: "【时间线】", group: "book" } }, // v0.3.3+ 三层合并时间轴（阶段 4 下拉目录可手动添加、默认不注入）；归书级组、无有效条目＝空块不注入
			{ key: "book_relations", spec: { file: dp.book.bookRelationships, header: HDR_BOOK_REL, stripComments: false, transform: cleanRelationshipsDoc, group: "book" } },
			...(dp.vol ? [
				{ key: "vol_outline", spec: outlineSpec }, // v0.4.3+：本卷大纲 → 前后 N 章节选（header/group 由 writingOutlineSpec 决定）
				{ key: "vol_relations", spec: { file: dp.vol.relationships, header: HDR_VOL_REL, stripComments: false, transform: cleanRelationshipsDoc, group: "vol" } },
			] : [
				// 平铺模式（无卷）：vol_outline 槽位映射书级《大纲.md》＝【全书大纲】——平铺书没有卷大纲，写作上下文不能一份大纲都没有（提示词的大纲措辞按实际注入块门控）
				{ key: "vol_outline", spec: outlineSpec }, // v0.4.3+：全书大纲 → 前后 N 章节选
			]),
			{ key: "chapter_outline", spec: { file: dp.chapter.outline, header: "【本章大纲】", stripHeading: true, transform: stripForeshadowMarks, skip: !!opts?.skipChapterOutline, group: "chapter" } },
			{ key: "characters", spec: { file: dp.chapter.characters, header: "【本章人物设定】", group: "chapter" } },
			{ key: "scenes", spec: { file: dp.chapter.scenes, header: "【本章场景】", group: "chapter" } },
			{ key: "chapter_relations", spec: { file: dp.chapter.relationships, header: "【本章人物关系】", stripComments: false, transform: cleanRelationshipsDoc, group: "chapter" } },
		];
		const ref = this.phaseRefDocKeys(opts?.phaseIdx ?? PHASE_WRITING);
		// v0.2.25+：按 ref_docs 数组顺序注入（排前的先组装）；file: 条目并入书级组、注入位置＝清单位置
		const assembled = await assemblePromptFiles(this.promptReader(), this.orderRefDocSpecs(pairs, ref, { fileGroup: "book", skipSkills: true })); // v0.3.0+：正文族跳过 skill: 条目——技能经 writerSystemPrompt 进 system prompt，防双份注入
		return { bookDocs: assembled.groupText("book"), volDocs: assembled.groupText("vol"), chapterDocs: assembled.groupText("chapter") };
	}

	// ---------- v0.2.11+ 自动生成卷大纲 (/vol-outline-generate) ----------

	/** 依据全局设定（世界观/社会组成/力量体系/基调等）为目标卷 LLM 流式生成恰好 N 章的卷大纲（`## 第N章 <标题>` 标记格式，与「从卷大纲生成章节」同一解析器兼容）。v0.2.x+ 增量分段落盘：【卷设计】段 + 每章一个小节逐段生成、每段流式展示完立即写盘（防长单次输出断开）；完整生成非空弹覆盖/追加二选一（追加保留原文含注释）在生成前定好、空则直写；停止按钮/关面板中止整轮（已落盘段落保留）。不改任何 state。目标卷默认当前卷，无当前卷则弹选择器。无卷时若书级《大纲.md》有卷声明 → 自动创建全部声明卷并逐卷生成卷大纲（autoCreateVolumesAndGenOutlines），否则提示先建卷/补书级大纲。
	 * v0.2.x+ 继续生成：现有卷大纲非空时先选「完整生成 / 按已有进度继续」——继续模式问「要增加的章数 N」、目标总章数 = 已有最大章号 M + N（M = `## 第N章` 最大章号），无【卷设计】步、从 M+1..count 逐章续写（supplementMode 承接已有章、原文 preamble 作卷设计参考），直接拼到原文末尾落盘（剥掉首部 H1、无覆盖/追加二选一），提示词带「故事在目标章自然收束结尾」 */
	async cmdGenerateVolOutline(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			if (state.use_volumes === false) { new Notice(NO_VOL_MODE_MSG, 10000); return; } // 无卷模式没有卷大纲
			const volsRec = await this.manager.loadVolumes(story);
			const vols = Object.values(volsRec).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
			if (!vols.length) {
				// v0.2.x+：无卷兜底——书级《大纲.md》有卷声明则自动创建全部声明卷并逐卷生成卷大纲；无声明则维持原提示
				const globalOutline = await this.manager.readGlobalOutline(story);
				const decls = parseVolumeDeclarations(globalOutline);
				if (!decls.length) { new Notice("还没有卷，且书级《大纲.md》未识别到卷声明（格式：`- 第X卷·卷名：描述`），请先新建卷或补全书级大纲", 12000); return; }
				await this.ensurePlanningGuide(story, state); // v0.2.13+：缺失则先自动生成（软依赖，失败返回 ""）；副作用先行，specs 只负责读盘注入
				await this.autoCreateVolumesAndGenOutlines(story, state, decls);
				return;
			}
			const curVol = (state.current_volume ?? "").trim();
			let vol = curVol ? this.manager.findVolumeIn(volsRec, curVol) : null; // 目标卷默认当前卷
			if (!vol) {
				const items: ActionItem[] = vols.map((v) => ({ label: v.name, sub: v.description || undefined, marker: v.id === curVol ? "▶ 当前" : undefined }));
				const idx = await this.pickAction("选择目标卷（自动生成它的卷大纲）", items);
				if (idx == null) return;
				vol = vols[idx];
			}
			const setup = this.getPhaseLlmSetup(PHASE_OUTLINE); // v0.2.22+：书籍大纲和卷级大纲生成阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			// 上下文组装（v0.2.24+ prompt_files 装配）：世界观/全书大纲/人物关系/卷列表/前一卷卷大纲等块改由 assembleVolOutlineContext 按 specs 读盘装配。不注入本卷现有大纲本身（目标文档不进生成提示词）
			await this.ensurePlanningGuide(story, state); // v0.2.13+：缺失则先自动生成（软依赖，失败返回 ""）；副作用先行，specs 只负责读盘注入
			const volIdx = vols.findIndex((v) => v.id === vol.id);
			const prevVol = volIdx > 0 ? vols[volIdx - 1] : null;
			const prevOutline = prevVol ? await this.manager.readVolumeOutline(story, prevVol.id) : "";
			const existing = await this.manager.readVolumeOutline(story, vol.id); // 清洗文本：模板注释视为空

			// v0.2.x+ 继续生成：现有大纲非空时先选「完整生成 / 按已有进度继续」；继续模式目标总章数 = 已有最大章号 M + 用户指定增量 N
			let continueMode = false;
			let m = 0;
			if (existing.trim()) {
				const mode = await this.promptOutlineGenMode(`生成卷大纲「${vol.name}」`);
				if (mode == null) return;
				if (mode === 1) {
					continueMode = true;
					const segs = splitVolOutlineByChapter(existing).segments;
					m = segs.length ? Math.max(...segs.map((s) => s.num)) : 0;
					if (m <= 0) {
						new Notice(`「${vol.name}」现有卷大纲未识别到「## 第N章」章标记，无法判断已有进度——请补上章标记后重试，或改选完整生成`, 12000);
						return;
					}
				}
			}
			let count: number;
			if (continueMode) {
				const addN = await this.promptChapterCountInput(`继续生成卷大纲「${vol.name}」`, `「${vol.name}」的卷大纲已覆盖到第 ${String(m)} 章。\n请指定要向后追加的章数（正整数，不设上限），输入后按回车确认、Esc 取消：`, "已取消继续生成卷大纲", "要增加的章数（正整数，如 5）");
				if (addN == null) return;
				count = m + addN;
			} else {
				const pre = this.autoVolCountFor(state, volIdx); // v0.4.6+ 预填/写回 auto_book.chapter_counts 该卷阅读序位次
				const c = await this.promptChapterCountInput("自动生成卷大纲", `将依据全局设定为「${vol.name}」AI 自动生成卷大纲。\n请指定要生成的章数（正整数，不设上限），输入后按回车确认、Esc 取消：${pre != null ? `\n（auto_book.chapter_counts 该卷预定章数 ${String(pre)} 已预填，改值将存回）` : ""}`, "已取消自动生成卷大纲", "目标章数（正整数，如 8）", pre != null ? String(pre) : undefined);
				if (c == null) return;
				count = c;
				if (!this.auto && volIdx >= 0 && (state.auto_book?.chapter_counts ?? [])[volIdx] !== c) {
					this.setAutoVolCount(state, volIdx, c);
					await this.manager.saveState(story, state);
				}
			}
			const assembled = await this.assembleVolOutlineContext(story, state, vol, { volumes: vols.map((v) => ({ name: v.name, description: v.description })), prevOutline });
			const ctx: VolOutlineGenInput = {
				targetVolumeName: vol.name,
				chapterCount: count,
				hasPlanningGuide: hasCtxBlock(assembled, HDR_PLANNING), // v0.2.25+ 引用文档配置框：策划指南可被移出阶段 2 清单——提示词【策划规范】措辞按块实际存在门控
				contextDocs: assembled.text,
			};

			// v0.2.x+ 继续生成：无【卷设计】步，从 M+1..count 逐章续写（supplementMode），
			// base = 原文剥掉首部 H1 后直接追加落盘（无覆盖/追加二选一）；提示词带「故事在目标章自然收束结尾」
			if (continueMode) {
				const raw = (await this.manager.readVolumeOutlineRaw(story, vol.id)).replace(/^#\s.*\n/, "");
				let base = raw ? `${raw}\n\n` : "";
				const nums: number[] = [];
				for (let c = m + 1; c <= count; c++) nums.push(c);
				console.debug("[articlewriter] 卷大纲增量续写", { model: setup.cfg.model_name || "(默认)", vol: vol.name, from: m + 1, to: count });
				const castRun = await this.outlineCastRun(story, state);
				const res = await this.genVolOutlineIncremental({
					cfg: setup.cfg,
					failLabel: `继续生成卷大纲 ${vol.name}`,
					chapterNums: nums,
					hasDesign: false,
					buildDesignPrompt: () => "",
					buildChapterPrompt: (num, _design, soFar) => buildVolOutlineChapterPrompt({ ...ctx, chapterNum: num, volumeDesign: "", generatedSoFar: soFar, supplementMode: true }),
					cast: castRun ? { story, volId: vol.id, tracker: castRun.tracker, stats: castRun.stats } : undefined,
					commit: async (seg) => {
						base = base ? `${base}\n\n${seg}` : seg; // 段间空行分隔（各段尾部空白已被助手剥除）
						await this.manager.setVolumeOutline(story, vol.id, base);
					},
					systemPrompt: assembleSystemPrompt(undefined, this.promptSkill("卷大纲生成", VOL_OUTLINE_GEN_SYSTEM_PROMPT)),
					stableContext: ctx.contextDocs,
				});
				if (res.panelFailed) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
				if (res.aborted) { new Notice(`已停止生成「${vol.name}」卷大纲${res.written ? `：前 ${String(res.written)} 段已落盘` : ""}`, 10000); return; }
				if (res.failed) { new Notice(`「${vol.name}」卷大纲生成中断${res.written ? `：前 ${String(res.written)} 段已落盘` : ""}`, 10000); return; }
				const check = splitVolOutlineByChapter(base);
				const castLine = castRun && castRun.stats.characters + castRun.stats.relationships + castRun.stats.skipped > 0 ? `\n${this.outlineCastSummaryLine(castRun.stats)}` : "";
				new Notice((check.segments.length
					? `✓ 已续写「${vol.name}」卷大纲（共识别到 ${String(check.segments.length)} 个章标记），可运行「从卷大纲生成章节」拆入各章`
					: `✓ 已续写「${vol.name}」卷大纲，但未识别到「第N章」标记——请手动补上章标记后再拆章`) + castLine, 12000);
				return;
			}

			// 完整生成：落盘策略在生成前定好（增量分段直接落盘、无保存/不保存 CTA）：非空弹覆盖/追加（追加保留原文含注释、剥掉首部 H1 后拼接，setVolumeOutline 统一补回自己的 H1）；空则直写。
			// 注意：分段逐段落盘，中途失败/中止时旧内容已被部分覆盖或追加——这是「直接落盘」的代价
			let base = "";
			if (existing) {
				const items2: ActionItem[] = [
					{ label: "覆盖现有大纲", sub: "用新生成内容替换《卷大纲.md》" },
					{ label: "追加到现有大纲末尾", sub: "保留原文（含注释），新内容接在末尾" },
				];
				const choice = await this.pickAction(`「${vol.name}」的卷大纲非空，如何保存？`, items2);
				if (choice == null) { new Notice("已取消保存卷大纲", 6000); return; }
				if (choice === 1) {
					const raw = (await this.manager.readVolumeOutlineRaw(story, vol.id)).replace(/^#\s.*\n/, "");
					base = raw ? `${raw}\n\n` : "";
				}
			}

			// 增量生成：【卷设计】段 + 每章一个小节，每段流式展示完立即落盘再继续下一段（防长单次输出断开）
			const nums: number[] = [];
			for (let c = 1; c <= count; c++) nums.push(c);
			console.debug("[articlewriter] 卷大纲增量生成", { model: setup.cfg.model_name || "(默认)", vol: vol.name, steps: nums.length + 1 });
			const castRun = await this.outlineCastRun(story, state);
			const res = await this.genVolOutlineIncremental({
				cfg: setup.cfg,
				failLabel: `生成卷大纲 ${vol.name}`,
				chapterNums: nums,
				hasDesign: true,
				buildDesignPrompt: () => buildVolOutlineDesignPrompt(ctx),
				buildChapterPrompt: (num, design, soFar) => buildVolOutlineChapterPrompt({ ...ctx, chapterNum: num, volumeDesign: design, generatedSoFar: soFar }),
				cast: castRun ? { story, volId: vol.id, tracker: castRun.tracker, stats: castRun.stats } : undefined,
				commit: async (seg) => {
					base = base ? `${base}\n\n${seg}` : seg; // 段间空行分隔（各段尾部空白已被助手剥除）
					await this.manager.setVolumeOutline(story, vol.id, base);
				},
				systemPrompt: assembleSystemPrompt(undefined, this.promptSkill("卷大纲生成", VOL_OUTLINE_GEN_SYSTEM_PROMPT)),
				stableContext: ctx.contextDocs,
			});
			if (res.panelFailed) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			if (res.aborted) { new Notice(`已停止生成「${vol.name}」卷大纲${res.written ? `：前 ${String(res.written)} 段已落盘` : ""}`, 10000); return; }
			if (res.failed) { new Notice(`「${vol.name}」卷大纲生成中断${res.written ? `：前 ${String(res.written)} 段已落盘` : ""}`, 10000); return; }

			// 软警告：生成结果若未识别到章标记，提示需手动补标记才能拆章
			const check = splitVolOutlineByChapter(base);
			const castLine = castRun && castRun.stats.characters + castRun.stats.relationships + castRun.stats.skipped > 0 ? `\n${this.outlineCastSummaryLine(castRun.stats)}` : "";
			new Notice((check.segments.length
				? `✓ 已生成「${vol.name}」卷大纲（识别到 ${String(check.segments.length)} 个章标记），可运行「从卷大纲生成章节」拆入各章`
				: `✓ 已生成「${vol.name}」卷大纲，但未识别到「第N章」标记——请手动补上章标记后再拆章`) + castLine, 12000);
		} catch (e) {
			this.notifyError("自动生成卷大纲失败", e);
		}
	}

	/** v0.2.x+「自动生成卷大纲」无卷兜底：自动创建书级《大纲.md》声明的全部卷（声明描述作卷描述、按文档序），再逐卷增量分段落盘生成其卷大纲（【卷设计】段 + 每章一个小节，每段流式展示完立即写盘，防长单次输出断开）；各卷目标章数由单个弹窗一次性问全（建卷前问，Esc 可零副作用取消）；批内链式上下文 prevVolumeOutline 取阅读序前一卷清洗大纲、本轮已生成的卷用 freshOutlines 缓存（与 readVolumeOutline 同口径）；上下文块（世界观/全书大纲/策划规范/人物关系等）经 assembleVolOutlineContext 按 specs 逐卷读盘装配（调用方须先调 ensurePlanningGuide 保证《策划指南.md》已生成）；停止按钮中断 → 整批中止（该卷已落盘段落保留）；收尾 ✓/✗ 汇总。新建卷的《卷大纲.md》必为空（模板注释视为空）→ 直写不弹覆盖/追加；声明按名去重且入口保证零存量卷，故循环内不会命中已有卷 */
	private async autoCreateVolumesAndGenOutlines(story: string, state: StoryState, decls: VolumeDeclaration[]): Promise<void> {
		const counts = await this.promptAllVolumeChapterCounts(decls, "自动生成卷大纲", state.auto_book?.chapter_counts); // v0.4.6+ chapter_counts 预填＋写回
		if (!counts) return;
		await this.saveAutoVolCounts(story, state, counts);
		const setup = this.getPhaseLlmSetup(PHASE_OUTLINE); // v0.2.22+：书籍大纲和卷级大纲生成阶段
		if (!setup) return;

		let vols = await this.manager.volumeList(story);
		const freshOutlines = new Map<string, string>(); // 本轮已生成的卷 → 清洗后大纲（供后续卷链式上下文）
		const results: Array<{ name: string; mark: "✓" | "↷" | "✗"; note: string }> = [];
		let createdCount = 0;
		let aborted = false;

		for (let i = 0; i < decls.length; i++) {
			const decl = decls[i];
			const n = counts[i];
			let vol = vols.find((v) => v.name === decl.name); // 精确名匹配（包含匹配会把「雾港」误配到「雾港外海」之类）
			if (!vol) {
				try {
					vol = await this.manager.addVolume(story, decl.name, decl.description);
					vols = await this.manager.volumeList(story); // 建卷后重载（order/ID 以磁盘为准）
					createdCount++;
				} catch (e) {
					results.push({ name: decl.name, mark: "✗", note: `建卷失败：${String(e)}` });
					continue;
				}
			}

			// 链式上下文：阅读序前一卷（本轮已生成则用缓存）
			const volIdx = vols.findIndex((v) => v.id === vol.id);
			const prevVol = volIdx > 0 ? vols[volIdx - 1] : null;
			let prevOutline = "";
			if (prevVol) {
				const cachedPrev = freshOutlines.get(prevVol.id);
				prevOutline = cachedPrev != null ? cachedPrev : await this.manager.readVolumeOutline(story, prevVol.id);
			}
			const assembled = await this.assembleVolOutlineContext(story, state, vol, { volumes: vols.map((v) => ({ name: v.name, description: v.description })), prevOutline });

			const ctx: VolOutlineGenInput = {
				targetVolumeName: vol.name,
				chapterCount: n,
				hasPlanningGuide: hasCtxBlock(assembled, HDR_PLANNING), // v0.2.25+ 引用文档配置框：【策划规范】措辞按块实际存在门控
				contextDocs: assembled.text,
			};
			console.debug("[articlewriter] 自动生成卷大纲（无卷自动建卷）增量生成", { model: setup.cfg.model_name || "(默认)", vol: vol.name, steps: n + 1 });

			// 增量分段落盘：【卷设计】段 + 每章一个小节，每段流式展示完立即写盘（防长单次输出断开）；新建卷大纲必为空 → 直写
			const label = `生成卷大纲 ${vol.name} (${i + 1}/${decls.length})`;
			let base = "";
			const castRun = await this.outlineCastRun(story, state);
			const res = await this.genVolOutlineIncremental({
				cfg: setup.cfg,
				failLabel: label,
				chapterNums: Array.from({ length: n }, (_, c) => c + 1),
				hasDesign: true,
				buildDesignPrompt: () => buildVolOutlineDesignPrompt(ctx),
				buildChapterPrompt: (num, design, soFar) => buildVolOutlineChapterPrompt({ ...ctx, chapterNum: num, volumeDesign: design, generatedSoFar: soFar }),
				cast: castRun ? { story, volId: vol.id, tracker: castRun.tracker, stats: castRun.stats } : undefined,
				commit: async (seg) => {
					base = base ? `${base}\n\n${seg}` : seg; // 段间空行分隔（各段尾部空白已被助手剥除）
					await this.manager.setVolumeOutline(story, vol.id, base);
				},
				systemPrompt: assembleSystemPrompt(undefined, this.promptSkill("卷大纲生成", VOL_OUTLINE_GEN_SYSTEM_PROMPT)),
				stableContext: ctx.contextDocs,
			});
			if (res.panelFailed) { results.push({ name: decl.name, mark: "✗", note: "无法打开生成面板" }); continue; }
			if (res.aborted) { aborted = true; break; } // Esc → 整批中止（已落盘段落保留）
			if (res.failed) { results.push({ name: decl.name, mark: "✗", note: `生成中断${res.written ? `（前 ${String(res.written)} 段已落盘）` : ""}` }); continue; }

			freshOutlines.set(vol.id, stripComments(base).trim());
			const check = splitVolOutlineByChapter(base);
			const castNote = castRun && castRun.stats.characters + castRun.stats.relationships > 0 ? `；人物 ${String(castRun.stats.characters)}／关系 ${String(castRun.stats.relationships)} 条` : "";
			results.push({ name: decl.name, mark: "✓", note: (check.segments.length ? `识别到 ${String(check.segments.length)} 个章标记` : "未识别到「第N章」标记，需手动补标记才能拆章") + castNote });
		}

		const lines = results.map((r) => `${r.mark} ${r.name}：${r.note}`);
		new Notice([`自动生成卷大纲完成（自动建卷 ${String(createdCount)}/${String(decls.length)}）${aborted ? "（用户中止，后续卷未处理）" : ""}`, ...lines].join("\n"), 15000);
	}

	// ---------- v0.2.13+ 策划指南 (/planning-guide；书级《策划指南.md》——书级/卷级大纲生成的既定规划约束) ----------

	/** v0.2.13+ 组装策划指南生成输入（自动生成与手动 /planning-guide·/planning-guide-worldview 共用）：书籍信息 / 世界观 / 全书大纲 / 卷列表（阅读序，平铺模式无卷）。
	 * opts.worldOnly=仅世界观生成（跳过大纲/卷输入，早期规划场景）。opts.volumeCount=分卷规划卷数（弹窗输入，>0 时生成要求按卷组织）。
	 * v0.2.25+：按阶段 1 引用文档配置框过滤注入；用户自选 file: 条目追加注入 */
	private async buildPlanningGuideInput(story: string, state: StoryState, opts?: { worldOnly?: boolean; volumeCount?: number }): Promise<PlanningGuideInput> {
		const desk = this.manager.deskDocsPath(story);
		const volsRec = opts?.worldOnly || state.use_volumes === false ? {} : await this.manager.loadVolumes(story);
		const vols = Object.values(volsRec).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
		// v0.2.24+ prompt_files 装配：块顺序与措辞逐字对齐旧 planningGuideContextParts（世界观含 H1＝旧 worldBlock fullText 口径；大纲剥 H1＝旧 readGlobalOutline 清洗口径；卷列表无目标卷标记）
		const pairs: Array<{ key: string; spec: PromptSpec }> = [
			{ key: "book_info", spec: { text: bookInfoText(state.title, state.genre, state.writing_style), header: HDR_BOOK_INFO } },
			{ key: "worldview", spec: { file: `${desk}/世界观.md`, header: HDR_WORLD, stripHeading: false } },
			{ key: "timeline", spec: { text: await this.manager.mergedTimelineText(story), header: "【时间线】" } }, // v0.3.3+ 合并时间轴与大事件：三层《时间线.md》合并时间轴原样注入（保留各文档层级与先后次序，不做全局时间排序）；无有效条目＝空块不注入，书级缺失时由 ensureTimeline 先生成落盘再装配
			{ key: "book_outline", spec: { file: `${desk}/大纲.md`, header: "【全书大纲】", stripHeading: true, skip: !!opts?.worldOnly } },
			{ key: "vol_list", spec: { text: volumeListText(vols.map((v) => ({ name: v.name, description: v.description }))), header: HDR_VOL_LIST, skip: !!opts?.worldOnly } },
		];
		const ref = this.phaseRefDocKeys(PHASE_PLANNING);
		// v0.2.25+：按 ref_docs 数组顺序注入（排前的先组装）；file: 条目在清单中的位置即注入位置
		// v0.3.4+：本书书籍技能（阶段 1 配置）追加在清单条目之后
		return { bookTitle: state.title, contextDocs: (await assemblePromptFiles(this.promptReader(), this.orderRefDocSpecs(pairs, ref, { bookSkillDir: this.bookSkillsDir(story), bookSkillNames: await this.phaseBookSkillNames(story, PHASE_PLANNING) }))).text, volumeCount: opts?.volumeCount, volumeMode: state.use_volumes !== false, noVolumes: state.use_volumes === false }; // v0.4.x+：分卷模式恒附按卷组织要求（卷数缺省＝按需分卷 1–5 卷）；无卷模式附「不得输出分卷信息」强提示
	}

	/** v0.3.3+ 时间线生成输入组装（替代旧大事件列表生成输入；固定上下文：书籍信息→张力工具箱技能→世界观，不受引用文档配置框过滤——生成上下文与注入清单分离；清单只控制生成结果是否参与注入。
	 *  v0.4.3+ 张力规则并入张力工具箱：第二段由书级《张力规则.md》内联块换成 `SKILLS/张力工具箱.md` 技能块（与 skill: 条目同形态） */
	private async buildTimelineInput(story: string, state: StoryState): Promise<TimelineGenInput> {
		const desk = this.manager.deskDocsPath(story);
		const specs: PromptSpec[] = [
			{ text: bookInfoText(state.title, state.genre, state.writing_style), header: HDR_BOOK_INFO },
			{ file: this.skillPath(TENSION_TOOLBOX_SKILL_NAME), header: `【技能 · ${TENSION_TOOLBOX_SKILL_NAME}】`, stripHeading: true }, // v0.4.3+ 张力规则并入张力工具箱：固定上下文改注入系统技能（同 skill: 条目形态）
			{ file: `${desk}/世界观.md`, header: HDR_WORLD, stripHeading: false },
		];
		specs.push(...this.bookSkillSpecsFromDir(this.bookSkillsDir(story), await this.phaseBookSkillNames(story, PHASE_PLANNING))); // v0.3.4+：本书书籍技能（阶段 1 配置）追加在固定文档之后（与 orderRefDocSpecs 追加注入同形态）
		return { bookTitle: state.title, contextDocs: (await assemblePromptFiles(this.promptReader(), specs)).text };
	}

	/** v0.3.3+ 阶段 1 前置：确保书级《时间线.md》有有效条目——无（缺失/为空/全是旧式非时间点内容）时先用阶段 1 LLM 配置＋时间线提示词流式生成并落盘，再继续生成策划指南（装配时【时间线】块走三层合并时间轴）。
	 *  仅当阶段 1 引用文档清单含 timeline 时生效（与配置框同口径：清单不含则该文档不参与本阶段）；生成失败/中止软处理——Notice 后继续主流程（本次不带【时间线】块） */
	private async ensureTimeline(story: string, state: StoryState): Promise<void> {
		if (!this.phaseRefDocKeys(PHASE_PLANNING).includes("timeline")) return;
		const existing = await this.manager.readDoc(this.manager.bookTimelinePath(story));
		if (existing.trim() && parseTimelines(existing).length) return; // 已有有效时间点条目：不重新生成（面板手工维护的时间线优先）
		const setup = this.getPhaseLlmSetup(PHASE_PLANNING); // 与策划指南生成同用阶段 1 映射
		if (!setup) { new Notice("未取到活动 LLM 配置，跳过时间线自动生成", 8000); return; }
		if (!(await this.runBookTimelineGen(story, state, setup.cfg, "自动生成时间线"))) new Notice("时间线未生成成功，继续生成策划指南（本次不带【时间线】）", 10000);
	}

	/** v0.4.3+ 时间线生成核心（ensureTimeline 策划指南前置自动路径与 /timeline-generate 单独命令共用）：
	 *  生成上下文＝书籍信息＋张力工具箱技能＋世界观＋本书书籍技能（buildTimelineInput，不受配置框过滤）→ 阶段 1 LLM 配置流式生成
	 *  → timelineGenFormatOk 校验，不合规则清预览带纠错注记（pt("时间线-格式修正注记")）重生成一次（v0.4.3+：重试走 retryTurnMessages 会话续轮）、仍不合规则按原样落盘软处理
	 *  → setBookTimeline 原样保存到书级《案头资料/时间线.md》。title＝生成面板标题；返回 true＝已落盘（失败/中止已 Notice，调用方勿重复弹） */
	private async runBookTimelineGen(story: string, state: StoryState, cfg: LlmConfigDoc, title: string): Promise<boolean> {
		const input = await this.buildTimelineInput(story, state);
		const promptText = buildTimelineGenPrompt(input);
		console.debug("[articlewriter] 时间线生成请求规模", { model: cfg.model_name || "(默认)", promptLen: promptText.length });
		const modal = await this.beginWritingPanel(title, cfg);
		if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return false; }
		const systemPrompt = assembleSystemPrompt(undefined, this.promptSkill("时间线生成", TIMELINE_GEN_SYSTEM_PROMPT));
		const sysMsg: Message = { role: "system", content: systemPrompt };
		// v0.4.3+ 前缀缓存锚点：buildTimelineGenPrompt 已改为上下文在前、格式硬要求压后，
		// 钉在上下文末尾 → 格式纠错重生成直接复用「书籍信息＋技能＋世界观」整段稳定头
		const pin = this.cachePin(promptText, input.contextDocs, input.contextDocs.length);
		let content = await this.streamWithEmptyRetry(cfg, () => [
			sysMsg,
			{ role: "user", content: promptText },
		], modal, "生成时间线", pin); // 空结果重试/异常/中止统一处理（genFailure 已按中断提示），失败返回空串
		if (content.trim() && !timelineGenFormatOk(content)) {
			// 无「时间点＋事件名」标题块或混有编号行（模型常见漂移形态）→ 清预览带纠错注记重生成一次；重生成后仍不合规则按原样落盘软处理（时间线面板兼容旧纯时间点标题、用户可手动修正）
			new Notice("时间线输出格式不合规（未见「时间点 事件名」标题块），正在重新生成…", 10000);
			modal.reset();
			// v0.4.3+ 重试＝会话续轮（retryTurnMessages）：旧「promptText＋注记」同条追加只有钉点之前的稳定头能复用，本轮输入整段重读；
			// 现把上一版输出作 assistant 轮、固定纠错文案（TASK_PROMPTS["时间线-格式修正注记"]，盘上可编辑）作新一轮 user 消息 → 首请求整段前缀复用
			const retryMessages = retryTurnMessages(sysMsg, promptText, content, pt("时间线-格式修正注记"));
			content = await this.streamWithEmptyRetry(cfg, () => retryMessages, modal, "生成时间线", pin);
			if (content.trim() && !timelineGenFormatOk(content)) new Notice("时间线格式仍不合规（已按原样保存，可在时间线面板手动修正）", 12000);
		}
		if (!content.trim()) return false;
		await this.manager.setBookTimeline(story, content);
		modal.finishAuto("✓ 书级《案头资料/时间线.md》已保存", "本轮用时");
		return true;
	}

	/** v0.4.3+ 单独命令「生成时间线」(/timeline-generate)：以书籍信息＋世界观为上下文单独流式生成书级《案头资料/时间线.md》——
	 *  策划指南前置自动路径（ensureTimeline）的手动对等入口：不受阶段 1 引用清单是否含 timeline 的门控，始终可生成；
	 *  已有有效时间点条目时先弹「重新生成覆盖/取消」确认（面板手工维护的时间线优先）。LLM 配置与提示词口径与自动路径完全一致（阶段 1 映射） */
	async cmdGenerateTimeline(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			const setup = this.getPhaseLlmSetup(PHASE_PLANNING); // 与策划指南生成同用阶段 1 映射
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			const existing = await this.manager.readDoc(this.manager.bookTimelinePath(story));
			if (existing.trim() && parseTimelines(existing).length) {
				const idx = await this.pickAction("生成时间线：书级《时间线.md》已有有效时间点条目", [
					{ label: "重新生成（覆盖现有条目）", sub: "依据书籍信息与世界观重新流式生成，成功后整体覆盖书级《案头资料/时间线.md》" },
					{ label: "取消", sub: "保留现有时间线（可在时间线面板手动维护）" },
				]);
				if (idx !== 0) return;
			}
			if (await this.runBookTimelineGen(story, state, setup.cfg, "生成时间线")) new Notice("✓ 已生成书级《案头资料/时间线.md》，策划指南/大纲生成将按引用清单注入【时间线】块", 12000);
		} catch (e) {
			this.notifyError("生成时间线失败", e);
		}
	}

	/** v0.2.25+ 策划指南生成前卷数量弹窗（自动路径与 /planning-guide-worldview 共用）：分卷模式下先问本书计划卷数（预填现有卷数），
	 *  生成的《策划指南》按卷组织、标明卷序号与卷名（阶段 2 卷大纲生成即有依据）；v0.4.x+ 分卷模式取消弹窗返回 undefined＝改走「按需分卷（1–5 卷）」软要求、仍按卷组织；平铺模式返回 undefined（禁卷强提示） */
	private async promptPlanningGuideVolumeCount(story: string, state: StoryState): Promise<number | undefined> {
		if (state.use_volumes === false) return undefined;
		if (this.auto) return this.auto.volumeCount; // v0.3.0+ auto-book 免交互：卷数取流水线参数
		const count = Object.keys(await this.manager.loadVolumes(story)).length;
		const saved = state.auto_book?.volumes; // v0.4.6+ 与 auto_book.volumes 双向同步（取消＝按需分卷时不写回）
		const n = await this.promptChapterCountInput(
			"策划指南 · 卷数量",
			`本书为分卷模式：输入计划卷数（预填现有卷数${count || saved == null ? "" : `；无存量卷时取 auto_book.volumes=${String(saved)}`}），《策划指南》将按卷组织、标明卷序号与卷名；取消＝按需分卷（通常 1–5 卷，仍按卷组织）`,
			"未输入卷数量，《策划指南》按需分卷（通常 1–5 卷）",
			"卷数量（正整数，如 3）",
			count ? String(count) : saved != null ? String(saved) : undefined,
		);
		if (n != null && saved !== n && !this.auto) {
			state.auto_book = { ...(state.auto_book ?? {}), volumes: n };
			await this.manager.saveState(story, state);
		}
		return n ?? undefined;
	}

	/** v0.2.x+ 策划指南流式生成＋截断自动续写（ensurePlanningGuide 自动路径与 /planning-guide-worldview 共用）：
	 * 首轮 buildPlanningGuidePrompt；单次输出被 max_tokens 截断（finish_reason=length）或十节有缺失时，按 buildPlanningGuideContinuePrompt
	 * 自动续写（最多 10 轮），每轮复用同一面板（reset 后先 append 已有内容、新段再流式追加）；空结果每轮重试 ×3（与 streamWithEmptyRetry 同口径）；
	 * 停止条件：十节齐全且 finish_reason≠length / 模型回复「已完成」（文档实际已完整）/ 用户中止 / 尚缺节时连续 3 轮节数无推进（提示调大 max_tokens）。
	 * 返回 {content, aborted}：aborted=true 时调用方不得保存。 */
	private async runPlanningGuideStreamed(opts: {
		cfg: LlmConfigDoc;
		modal: GenProgressView;
		input: PlanningGuideInput;
		systemPrompt: string; // v0.2.24+：调用方按所属阶段组装后传入（v0.3.4+：身份加强改经技能通道注入，不再随组装附带）
		label: string;
	}): Promise<{ content: string; aborted: boolean }> {
		const { cfg, modal, input, systemPrompt, label } = opts;
		let content = "";
		let prevPresent = 0; // 上一轮结束时的已识别节数（判断净推进用）
		let stall = 0; // 连续「尚缺节但节数无推进」轮数，≥3 视为模型单次输出能力不足
		const maxRounds = 10;
		for (let round = 1; round <= maxRounds; round++) {
			const missingBefore = planningGuideMissingSections(content);
			if (round > 1) new Notice(`📝 策划指南上次被截断，继续续写（第 ${String(round)}/${String(maxRounds)} 轮）…`, 6000);
			const promptText = round === 1 ? buildPlanningGuidePrompt(input) : buildPlanningGuideContinuePrompt(input, content, missingBefore);
			// v0.4.3+ 前缀缓存锚点：首轮与各续写轮都以同一段书籍设定上下文开头（两个 builder 已统一上下文在前、指令压后），
			// 钉在上下文末尾 → 第 2..N 轮把书籍信息/技能/世界观/大纲/卷列表整段稳定头 reused（此前每轮前缀从头即分叉）
			const pin = this.cachePin(promptText, input.contextDocs ?? "", (input.contextDocs ?? "").length);
			let seg = "";
			let finishReason: string | null = null; // 本轮流结束原因（空结果重试会覆盖，最终值对应最后一次尝试）
			for (let attempt = 1; attempt <= 3; attempt++) {
				modal.reset();
				if (content) modal.append(`${content}\n\n`); // 面板先呈现已有内容、新段再流式追加（与大纲续写同口径）
				try {
					seg = await this.streamOnce(cfg, [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: promptText },
					], modal, pin, (r) => { finishReason = r; });
				} catch (e) {
					if (modal.signal.aborted) { new Notice(`已停止生成，${label}未保存`, 6000); return { content, aborted: true }; }
					this.notifyError(`${label}失败`, e);
					seg = "";
					break;
				}
				if (seg.trim()) break;
				if (attempt < 3) new Notice(`生成结果为空（第${String(attempt)}次），正在重试…`, 6000);
			}
			if (!seg.trim()) {
				new Notice(`✗ ${label}失败：连续 3 次生成结果为空`, 12000);
				modal.fail("连续 3 次生成结果为空");
				break; // 面板停留在「实际将保存」的已有内容
			}
			const segTrim = seg.replace(/\s+$/, "");
			// 完成标记：十节已齐全时模型判定现有文本实际已完整（token 边界 length 误报 / 尾部可忽略）→ 停止续写、不并入该段
			if (missingBefore.length === 0 && segTrim.length < 100 && !/^#{1,6}/m.test(segTrim) && /已完成/.test(segTrim)) break;
			content = content ? `${content}\n\n${segTrim}` : segTrim;
			const missing = planningGuideMissingSections(content);
			const present = PLANNING_GUIDE_SECTIONS.length - missing.length;
			if (missing.length === 0 && finishReason !== "length") break; // 十节齐全且自然结束 → 完整
			if (missing.length > 0 && present <= prevPresent) {
				stall++;
				if (stall >= 3) { new Notice("策划指南续写无法继续推进（模型单次输出过短或反复截断），已停止；可调大 max_tokens 后重试", 12000); break; }
			} else {
				stall = 0;
			}
			prevPresent = present;
		}
		return { content, aborted: false };
	}

	/** v0.2.13+ 大纲生成前确保书级《策划指南.md》存在：已有非空直接返回清洗文本；缺失/为空则 LLM 流式自动生成（截断自动续写；v0.2.25+ 分卷模式先弹「卷数量」要求按卷组织，取消＝按需分卷、不阻断）并落盘后返回；
	 * 生成失败（用户中止 / 连续 3 次空结果）仅告警并返回 ""——软依赖，大纲生成照常进行、只是不带【策划规范】块。 */
	private async ensurePlanningGuide(story: string, state: StoryState): Promise<string> {
		const existing = await this.manager.readPlanningGuide(story);
		if (existing.trim()) return existing;
		const setup = this.getPhaseLlmSetup(PHASE_PLANNING); // v0.2.22+：策划方案生成阶段
		if (!setup) { new Notice("未取到活动 LLM 配置，跳过策划指南自动生成", 8000); return ""; }
		await this.ensureTimeline(story, state); // v0.3.3+：书级《时间线.md》无有效条目→先用阶段 1 提示词生成落盘，再继续生成策划指南
		const volumeCount = await this.promptPlanningGuideVolumeCount(story, state); // v0.2.25+：分卷模式先弹卷数量（取消＝按需分卷软要求，不阻断）
		const input = await this.buildPlanningGuideInput(story, state, { volumeCount });
		console.debug("[articlewriter] 策划指南自动生成请求规模", { model: setup.cfg.model_name || "(默认)", promptLen: buildPlanningGuidePrompt(input).length });
		const modal = await this.beginWritingPanel("自动生成策划指南", setup.cfg);
		if (!modal) { new Notice("无法打开生成面板，跳过策划指南自动生成", 8000); return ""; }
		const { content, aborted } = await this.runPlanningGuideStreamed({
			cfg: setup.cfg,
			modal,
			input,
			systemPrompt: assembleSystemPrompt(undefined, BOOK_OUTLINE_GEN_SYSTEM_PROMPT),
			label: "生成策划指南",
		});
		if (aborted || !content.trim()) {
			new Notice("策划指南未生成完成，继续大纲生成（本次不带【策划规范】约束）", 10000);
			return "";
		}
		await this.manager.setPlanningGuide(story, content);
		modal.finishAuto("✓ 策划指南已自动生成并保存", "本轮用时");
		return content.replace(/\s+$/, "");
	}

	/** v0.2.x+「生成策划指南（仅世界观）」(/planning-guide-worldview)：早期规划场景——输入仅世界观设定（不含大纲/卷），AI 流式生成书级《策划指南.md》；v0.2.25+ 分卷模式先弹「卷数量」要求按卷组织。
	 * 始终直接生成并覆盖，不读取旧策划指南内容作为约束。流式展示完自动落盘；单次输出被 max_tokens 截断时自动续写至完整（runPlanningGuideStreamed） */
	async cmdPlanningGuideWorldview(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			const setup = this.getPhaseLlmSetup(PHASE_PLANNING); // v0.2.22+：策划方案生成阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			await this.ensureTimeline(story, state); // v0.3.3+：书级《时间线.md》无有效条目→先用阶段 1 提示词生成落盘，再继续生成策划指南
			const volumeCount = await this.promptPlanningGuideVolumeCount(story, state); // v0.2.25+：分卷模式先弹卷数量（取消＝按需分卷软要求）
			const input = await this.buildPlanningGuideInput(story, state, { worldOnly: true, volumeCount });
			console.debug("[articlewriter] 策划指南（仅世界观）生成请求规模", { model: setup.cfg.model_name || "(默认)", promptLen: buildPlanningGuidePrompt(input).length });
			const modal = await this.beginWritingPanel("生成策划指南（仅世界观）", setup.cfg);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			const { content, aborted } = await this.runPlanningGuideStreamed({
				cfg: setup.cfg,
				modal,
				input,
				systemPrompt: assembleSystemPrompt(undefined, BOOK_OUTLINE_GEN_SYSTEM_PROMPT),
				label: "生成策划指南（仅世界观）",
			});
			if (aborted) return;
			if (!content.trim()) return;
			await this.manager.setPlanningGuide(story, content);
			modal.finishAuto("✓ 策划指南已保存", "本轮用时");
			new Notice("✓ 已生成书级《策划指南.md》（仅依据世界观），后续大纲生成将遵循其既定规划", 12000);
		} catch (e) {
			this.notifyError("生成策划指南（仅世界观）失败", e);
		}
	}

	// ---------- v0.3.0+ 生成世界观 (/worldview-generate；书级《案头资料/世界观.md》——auto-book 流水线首阶段，亦可单独运行) ----------

	/** v0.3.0+「生成世界观」：以一句话设定为种子 LLM 流式生成书级《案头资料/世界观.md》——v0.3.7+ 手动运行一律弹 multiline 窗确认（state.one_line 有则预填可改、无则空框），auto 免交互取流水线参数。
	 * 固定 H2 小节（「世界基本规则」「世界观红线」必含）、首行 H1；上下文（书籍信息＋张力工具箱等技能条目）按阶段 0 引用文档配置框过滤注入（目标文档自身不注入）。
	 * 流式展示完自动落盘（setWorldDoc 统一补规范 H1、剥模型自带 H1）；已有非空直接覆盖、不确认（auto-book 语义，手动运行同口径）。
	 * premise 与 state.one_line 不同时写回持久化（弹窗补问的值复用为下次默认值）。 */
	async cmdGenerateWorldview(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			const setup = this.getPhaseLlmSetup(PHASE_WORLDVIEW); // 阶段 0 世界观生成（v0.3.7+ 独立阶段）
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			let premise = ((this.auto ? this.auto.premise : state.one_line) ?? "").trim(); // auto-book 免交互：premise 取流水线参数（弹窗已校验非空）
			if (!this.auto || !premise) { // v0.3.7+ 手动运行一律弹窗确认：one_line 已有内容预填给用户修改、无内容则空框；auto 仅参数缺失兜底重弹（正常不会走到，启动预检已校验 premise 非空）
				const t = await this.prompt("生成世界观 · 一句话设定", "一句话设定（必填）", "世界观生成的种子：主角是谁、为什么不得不行动、阻碍来自哪种规则或势力。\n例：一个能看见别人死期的少年，发现自己每次说出死期都会提前应验", premise || undefined, true); // v0.3.7+ multiline：5 行 textarea 占满行宽；已有设定预填（光标置末尾）
				if (t == null || !t.trim()) { new Notice("未输入一句话设定，已取消生成世界观", 6000); return; }
				premise = t.trim();
			}
			const pairs: Array<{ key: string; spec: PromptSpec }> = [
				{ key: "book_info", spec: { text: bookInfoText(state.title, state.genre, state.writing_style), header: HDR_BOOK_INFO } },
			];
			const input: WorldviewGenInput = { bookTitle: state.title, premise, contextDocs: (await assemblePromptFiles(this.promptReader(), this.orderRefDocSpecs(pairs, this.phaseRefDocKeys(PHASE_WORLDVIEW), { bookSkillDir: this.bookSkillsDir(story), bookSkillNames: await this.phaseBookSkillNames(story, PHASE_WORLDVIEW) }))).text }; // v0.3.4+：阶段 0 书籍技能追加注入
			console.debug("[articlewriter] 世界观生成请求规模", { model: setup.cfg.model_name || "(默认)", promptLen: buildWorldviewGenPrompt(input).length });
			const modal = await this.beginWritingPanel("生成世界观", setup.cfg);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			const wvPrompt = buildWorldviewGenPrompt(input);
			// v0.4.3+ 前缀缓存锚点：builder 已改为上下文在前（书籍信息＋清单技能块打头），钉在上下文末尾——
			// 同一本书重新生成世界观 / 紧接的《时间线》《策划指南》生成可复用这段技能与书籍信息头
			const wvPin = this.cachePin(wvPrompt, input.contextDocs ?? "", (input.contextDocs ?? "").length);
			const content = await this.streamWithEmptyRetry(setup.cfg, () => [
				{ role: "system", content: assembleSystemPrompt() }, // v0.4.3+：世界观生成专用 system 常量已删——回落 DEFAULT_SYSTEM_PROMPT，身份经清单技能条目（默认含「身份加强·世界观生成」）加强
				{ role: "user", content: wvPrompt },
			], modal, "生成世界观", wvPin);
			if (modal.signal.aborted) return;
			if (!content.trim()) return;
			await this.manager.setWorldDoc(story, content);
			modal.finishAuto("✓ 世界观已保存", "本轮用时");
			if (premise !== (state.one_line ?? "").trim()) { // 一句话设定持久化（auto-book / 手动补问均写回；后续运行预填）
				state.one_line = premise;
				await this.manager.saveState(story, state);
			}
			new Notice("✓ 已生成书级《案头资料/世界观.md》，后续策划指南/大纲/正文生成以其为既定事实约束", 12000);
		} catch (e) {
			this.notifyError("生成世界观失败", e);
		}
	}

	// ---------- v0.2.x+ 生成书籍大纲 (/book-outline-generate) ----------

	/** 补全书根参与大纲生成的资料（大纲/策划指南/世界观/人物关系）：缺失者按模板创建、已存在不覆盖。供命令面板与写字台「书稿」右键 */
	async cmdCompleteOutlineDocs(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const created = await this.manager.ensureOutlineDocs(story);
			new Notice(created.length ? `已为「${story}」补全大纲资料：${created.join("、")}` : `「${story}」的大纲资料已齐全（大纲/策划指南/世界观/人物关系），无需补全`, 8000);
		} catch (e) {
			this.notifyError("补全大纲资料失败", e);
		}
	}

	/** 平铺书级大纲的章标记（只认标题式 `## 第N章`——避免【全书设计】里以「第N章」开头的正文被误判）；返回按文档顺序的出现位置与章号 */
	private outlineChapterHeadings(text: string): Array<{ index: number; num: number }> {
		const out: Array<{ index: number; num: number }> = [];
		const re = /^#{1,6}[^\S\n]*第[^\S\n]*(\d+|[零〇一二两三四五六七八九十百千万]+)[^\S\n]*章/gm;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) {
			const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : cnToNum(m[1].replace(/〇/g, "零"));
			if (n != null && n > 0) out.push({ index: m.index, num: n });
		}
		return out;
	}

	/** 续写辅助：丢掉最后一个章标题起的整块（可能被 max_tokens 截断的末章），返回保留文本与该章章号；无章标题时原样返回、lastNum=0 */
	private trimLastOutlineChapter(text: string): { text: string; lastNum: number } {
		const heads = this.outlineChapterHeadings(text);
		if (!heads.length) return { text, lastNum: 0 };
		const last = heads[heads.length - 1];
		return { text: text.slice(0, last.index).replace(/\s+$/, ""), lastNum: last.num };
	}

	/** v0.2.x+ 平铺书级大纲「继续生成」：现有大纲章标记（`## 第N章`）中的最大章号；无则返回 0 */
	private maxOutlineChapterNum(text: string): number {
		const heads = this.outlineChapterHeadings(text);
		return heads.length ? Math.max(...heads.map((h) => h.num)) : 0;
	}

	/** v0.2.x+ 有卷模式书级大纲「继续生成」：丢掉模型可能在首个新卷声明行之前加的前言（自首个声明行起保留）；未识别到声明行时原样返回 */
	private trimExtendPreamble(text: string): string {
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (/^\s*[-*]\s*第\s*(?:\d+|[零一二两三四五六七八九十百]+)\s*卷/.test(lines[i])) return lines.slice(i).join("\n");
		}
		return text;
	}

	/** v0.2.x+ 平铺书级大纲自动续写（完整生成的截断兜底与「继续生成」共用）：单次输出被 max_tokens 截断（或从已有进度起步）时按 10 章一段续写，直到覆盖 chapterCount 或无法继续；
	 * 续写前丢掉可能被截断的末章、从其章号重生成；空结果重试 3 次 / 连续无净推进 ≥3 轮中止；返回最终 content、用户是否中断（aborted=true 时调用方不得保存）、startNum（本次新生成的首个章号，供「继续生成」调用方切出新内容段） */
	private async runFlatOutlineContinuation(opts: {
		cfg: LlmConfigDoc;
		modal: GenProgressView;
		outlineInput: BookOutlineGenInput;
		content: string;
		systemPrompt: string; // v0.2.24+：调用方按所属阶段组装后传入（v0.3.4+：身份加强改经技能通道注入，不再随组装附带）
	}): Promise<{ content: string; aborted: boolean; startNum: number }> {
		const count = opts.outlineInput.chapterCount;
		let content = opts.content;
		const heads0 = this.outlineChapterHeadings(content);
		let lastNum = heads0.length ? Math.max(...heads0.map((h) => h.num)) : 0;
		if (lastNum >= count) return { content, aborted: false, startNum: 0 };
		const lastBlock0 = heads0.length ? content.slice(heads0[heads0.length - 1].index) : "";
		const initialLooksComplete = !!lastBlock0 && /章末钩子/.test(lastBlock0);
		// 首轮末章若停在半句（缺章末钩子）→ 丢掉整章重生成；否则从下一章继续
		if (!initialLooksComplete) content = this.trimLastOutlineChapter(content).text;
		const curHeads = this.outlineChapterHeadings(content);
		lastNum = curHeads.length ? Math.max(...curHeads.map((h) => h.num)) : 0; // 按实际保留内容重算，避免后续进度判断用旧末章号
		const startNum = lastNum + 1;
		let next = startNum;
		let guard = 0;
		let stall = 0; // 连续「本轮只生成到半章、裁掉后无净推进」次数，≥3 视为模型输出能力不足
		const maxRounds = count + 5; // 每轮至少应推进 1 章；上限只防病态死循环
		while (next <= count && guard < maxRounds) {
			guard++;
			const beforeNum = lastNum; // 本轮开始前已保留的最新章号（判断净推进用）
			const to = Math.min(count, next + 9);
			new Notice(`📝 大纲已生成到第${String(next - 1)}章，继续续写第${String(next)}-${String(to)}章…`, 6000);
			opts.modal.reset();
			opts.modal.append(`${content}\n\n`);
			const heads = this.outlineChapterHeadings(content);
			const design = heads.length ? content.slice(0, heads[0].index).trim() : content.trim();
			const tailStart = heads.length ? heads[Math.max(0, heads.length - 3)].index : 0;
			const tail = content.slice(tailStart).trim();
			const contPrompt = buildBookOutlineContinuePrompt({ ...opts.outlineInput, fromChapter: next, toChapter: to, bookDesign: design, previousChapters: tail });
			// v0.4.3+ 前缀缓存锚点：该 prompt 在本书内按 10 章一段反复调用（builder 已统一上下文在前、指令压后），
			// 钉在【已生成章节 · 末尾衔接参考】之前 → 每轮复用「上下文＋全书设计」整段稳定头；
			// 无该块（首段无设计）时退回上下文末尾
			const tailHdrAt = contPrompt.indexOf("\n【已生成章节 · 末尾衔接参考】");
			const pin = tailHdrAt > 0
				? this.cachePinAt(contPrompt, tailHdrAt)
				: this.cachePin(contPrompt, opts.outlineInput.contextDocs ?? "", (opts.outlineInput.contextDocs ?? "").length);
			let seg = "";
			for (let attempt = 1; attempt <= 3; attempt++) {
				try {
					seg = await this.streamOnce(opts.cfg, [
						{ role: "system", content: opts.systemPrompt },
						{ role: "user", content: contPrompt },
					], opts.modal, pin);
				} catch (e) {
					if (opts.modal.signal.aborted) { new Notice("已停止生成书籍大纲", 6000); return { content, aborted: true, startNum }; }
					this.notifyError(`续写大纲（第${String(next)}-${String(to)}章）失败`, e);
					seg = "";
					break;
				}
				if (seg.trim()) break;
				if (attempt < 3) {
					new Notice(`续写结果为空（第${String(attempt)}次），正在重试…`, 6000);
					opts.modal.reset();
					opts.modal.append(`${content}\n\n`);
				}
			}
			if (!seg.trim()) {
				opts.modal.reset();
				opts.modal.append(content); // 面板回到「实际将保存」的内容
				new Notice("续写中断：已保留已生成部分，可在面板选择保存", 10000);
				break;
			}
			const segHeads = this.outlineChapterHeadings(seg);
			const segClean = (segHeads.length ? seg.slice(segHeads[0].index) : seg).replace(/\s+$/, ""); // 丢掉模型可能加的前言/重复【全书设计】
			const merged = `${content}\n\n${segClean}`;
			const mergedHeads = this.outlineChapterHeadings(merged);
			const mergedMax = mergedHeads.length ? Math.max(...mergedHeads.map((h) => h.num)) : 0;
			if (mergedMax <= lastNum) {
				opts.modal.reset();
				opts.modal.append(content);
				new Notice("续写未产生新的章节，已停止继续生成", 8000);
				break;
			}
			content = merged;
			lastNum = mergedMax;
			const lastBlock = mergedHeads.length ? merged.slice(mergedHeads[mergedHeads.length - 1].index) : "";
			const looksComplete = !!lastBlock && /章末钩子/.test(lastBlock);
			if (mergedMax < to && !looksComplete) {
				content = this.trimLastOutlineChapter(content).text; // 本段末尾也可能被截断 → 丢掉末章重生成
				const keptHeads = this.outlineChapterHeadings(content);
				lastNum = keptHeads.length ? Math.max(...keptHeads.map((h) => h.num)) : 0;
				if (lastNum <= beforeNum) {
					stall++;
					if (stall >= 3) { new Notice("续写无法继续推进（模型单次输出过短或反复截断），已停止；可调大 max_tokens 后重试", 12000); break; }
				} else {
					stall = 0;
				}
				next = lastNum + 1;
			} else {
				stall = 0;
				next = mergedMax + 1;
			}
			opts.modal.reset();
			opts.modal.append(content);
		}
		const finalHeads = this.outlineChapterHeadings(content);
		const finalLast = finalHeads.length ? Math.max(...finalHeads.map((h) => h.num)) : 0;
		if (finalHeads.length < count || finalLast < count) new Notice(`⚠ 大纲未覆盖全部 ${String(count)} 章（识别到 ${String(finalHeads.length)} 个章标记、最新到第 ${String(finalLast)} 章），可保存后再次生成或手动补齐`, 12000);
		return { content, aborted: false, startNum };
	}

	/** v0.2.x+ 有卷模式「生成书籍大纲」卷数量弹窗（预填现有卷数）：书级《大纲.md》按卷划分事件与情节——每卷一个小节写卷级规划（不含章号区间）；
	 *  取消＝中止本次生成（区别于策划指南卷数量弹窗的软取消）。各卷章数不在这里问，由「从书级大纲生成卷」的 promptAllVolumeChapterCounts 逐卷问。 */
	private async promptBookOutlineVolumeCount(story: string): Promise<number | null> {
		if (this.auto) return this.auto.volumeCount; // v0.3.0+ auto-book 免交互：卷数取流水线参数
		const existing = Object.keys(await this.manager.loadVolumes(story)).length;
		const state = await this.manager.validatedState(story); // v0.4.6+ 与 auto_book.volumes 双向同步（同 chapters 口径）
		const saved = state.auto_book?.volumes;
		const n = await this.promptChapterCountInput(
			"生成书籍大纲 · 卷数量",
			`本书为分卷模式：输入本书计划卷数（预填现有卷数${existing || saved == null ? "" : `；无存量卷时取《故事状态.md》auto_book.volumes=${String(saved)}`}），书级《大纲.md》按卷划分事件与情节——每卷一个小节、写该卷的卷级规划（不含章号区间）。\n各卷章数稍后由「从书级大纲生成卷」逐卷询问；取消＝中止本次生成。${existing || saved == null ? "" : "\n改值确认后写回 auto_book.volumes（此后全自动写书沿用新值）。"}`,
			"已取消生成书籍大纲",
			"卷数量（正整数，如 3）",
			existing ? String(existing) : saved != null ? String(saved) : undefined,
		);
		if (n != null && saved !== n) {
			state.auto_book = { ...(state.auto_book ?? {}), volumes: n }; // 增量合并、不动其余键
			await this.manager.saveState(story, state);
		}
		return n;
	}

	/** 依据全局设定（世界观/基调等）与已有章节（及其已存摘要）LLM 流式生成书级《大纲.md》；平铺（无卷）与有卷两模式通用：
	 * - 平铺模式：逐章规划——恰好 N 个 `## 第N章 <标题>` 标记（与「从卷大纲生成章节」同一解析器兼容）＋每章固定结构，配套拆章步骤=「从卷大纲生成章节」（平铺下读书级《大纲.md》、章节落书根）；
	 * - 有卷模式：全书主线 + 按卷小节（每卷「## 第X卷·卷名」标题＋首行 `- 第X卷·卷名：一句话定位` 声明行，可被「从书级大纲生成卷」解析；其后是该卷按卷划分的事件与情节）+ 结局，不写逐章标记与章号区间。
	 * 完整生成落盘：书级《大纲.md》非空时弹覆盖/追加二选一（追加保留原文含注释、剥掉首部 H1 后拼接，setGlobalOutline 统一补回自己的 H1），空则直写；不改任何 state。
	 * v0.2.x+ 继续生成：现有大纲非空时先选「完整生成 / 按已有进度继续」——继续模式问「要增加的章数/卷数 N」、目标 = 已有最大进度 M + N（M：平铺取 `## 第N章` 最大章号、有卷取卷声明行最大卷号），
	 * 平铺走 runFlatOutlineContinuation 从 M 之后逐章续写、有卷走 buildBookOutlineExtendPrompt 只追加新卷小节 + 更新结局；两者都直接拼到原文末尾（无覆盖/追加二选一），提示词均带「故事在目标单元自然收束结尾」。
	 * 数量弹窗按模式分流：平铺问目标章数（恰好规划 N 章）；有卷问卷数量（恰好规划 N 卷，预填现有卷数、取消即中止） */
	async cmdGenerateBookOutline(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			const flatMode = state.use_volumes === false;
			const setup = this.getPhaseLlmSetup(PHASE_OUTLINE); // v0.2.22+：书籍大纲和卷级大纲生成阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			const existing = await this.manager.readGlobalOutline(story); // 清洗文本：模板注释视为空
			// v0.2.x+ 继续生成：现有大纲非空时先选「完整生成 / 按已有进度继续」；继续模式目标总章数 = 已有最大章号 M + 用户指定增量 N
			let continueMode = false;
			let m = 0;
			if (existing.trim()) {
				const mode = await this.promptOutlineGenMode("生成书籍大纲");
				if (mode == null) return;
				if (mode === 1) {
					continueMode = true;
					m = flatMode ? this.maxOutlineChapterNum(existing) : maxDeclaredVolumeNum(existing); // 平铺 m＝最大章号；有卷 m＝最大卷号
					if (m <= 0) {
						new Notice(flatMode
							? "现有书级《大纲.md》未识别到「## 第N章」章标记，无法判断已有进度——请补上章标记后重试，或改选完整生成"
							: "现有书级《大纲.md》未识别到 `- 第X卷·卷名：描述` 卷声明行，无法判断已有进度——请补上卷声明行后重试，或改选完整生成", 12000);
						return;
					}
				}
			}
			// 数量弹窗按模式分流：平铺问章数（恰好规划 N 章）；有卷问卷数（恰好规划 N 卷）。continueMode 下 count＝目标总单元数（已有最大进度 M＋增量）
			let count: number;
			if (continueMode) {
				const addN = await this.promptChapterCountInput(
					"继续生成书籍大纲",
					flatMode
						? `书级《大纲.md》已覆盖到第 ${String(m)} 章。\n请指定要向后追加的章数（正整数，不设上限），输入后按回车确认、Esc 取消：`
						: `书级《大纲.md》已规划到第 ${String(m)} 卷。\n请指定要向后追加的卷数（正整数，不设上限），输入后按回车确认、Esc 取消：`,
					"已取消继续生成书籍大纲",
					flatMode ? "要增加的章数（正整数，如 5）" : "要增加的卷数（正整数，如 2）",
				);
				if (addN == null) return;
				count = m + addN;
			} else if (flatMode) {
				// v0.4.6+ 平铺目标章数与《故事状态.md》auto_book.chapters（全书总章数）双向同步：有值即预填输入框
				// （与「全自动写书」同一规模参数）；用户改值后写回该字段（同值零写盘；auto 流水线不走弹窗、不适用）
				const saved = state.auto_book?.chapters;
				const hint = `将依据世界观与策划指南 AI 生成书级《大纲.md》。\n请指定目标章数（正整数，不设上限），输入后按回车确认、Esc 取消：\n（平铺模式：大纲将恰好规划这么多章${saved != null ? `；上次章数 ${String(saved)} 已预填，改值将存回《故事状态.md》` : ""}）`;
				const c = await this.promptChapterCountInput("生成书籍大纲", hint, "已取消生成书籍大纲", "目标章数（正整数，如 5）", saved != null ? String(saved) : undefined);
				if (c == null) return;
				count = c;
				if (saved !== c && !this.auto) {
					state.auto_book = { ...(state.auto_book ?? {}), chapters: c }; // 增量合并、不动 auto_book 其他键（start/end/volumes…）
					await this.manager.saveState(story, state);
				}
			} else {
				const v = await this.promptBookOutlineVolumeCount(story);
				if (v == null) return;
				count = v;
			}

			// 上下文组装（v0.2.24+ prompt_files 装配）：世界观/策划规范/人物关系/卷列表块改由 assembleVolOutlineContext 按 specs 读盘装配（与卷大纲族同一 helper；张力手法走清单里的 skill:张力工具箱）。不注入现有书级大纲本身（目标文档不进生成提示词）
			await this.ensurePlanningGuide(story, state); // v0.2.13+：缺失则先自动生成（软依赖，失败返回 ""）；副作用先行，specs 只负责读盘注入
			const volsRec = flatMode ? {} : await this.manager.loadVolumes(story);
			const vols = Object.values(volsRec).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
			const currentVolumeKey = typeof state.current_volume === "string" && state.current_volume.trim() ? state.current_volume.trim() : "";
			const relationshipVol = !flatMode ? (currentVolumeKey ? this.manager.findVolumeIn(volsRec, currentVolumeKey) : vols[0] ?? null) : null;
			const assembled = await this.assembleVolOutlineContext(story, state, relationshipVol ?? { id: "", name: "" }, {
				strict: true, // 旧 book 路径不注入全书大纲/前一卷卷大纲，也不注入目标文档本身
				noVolRel: flatMode, // 平铺模式无目标卷 → 跳本卷人物关系（书籍人物关系仍注入，与旧 relationshipCtx 口径一致）
				noTargetMark: true, // 旧 book 路径卷列表无「← 目标卷」标记
				volumes: vols.map((v) => ({ name: v.name, description: v.description })),
			});
			const outlineInput: BookOutlineGenInput = {
				flatMode,
				chapterCount: flatMode ? count : 0, // 有卷模式卷级规划不含章号，不用章数
				volumeCount: flatMode ? undefined : count,
				hasVolumes: hasCtxBlock(assembled, HDR_VOL_LIST),
				hasPlanningGuide: hasCtxBlock(assembled, HDR_PLANNING),
				hasBookRelationships: hasCtxBlock(assembled, HDR_BOOK_REL),
				hasVolRelationships: hasCtxBlock(assembled, HDR_VOL_REL),
				contextDocs: assembled.text,
			};
			// v0.2.x+ 继续生成 · 有卷模式：只追加第 M+1..count 卷的新卷小节 + 更新后的结局（不重出主线/旧卷小节），直接拼到原文末尾（无覆盖/追加二选一）
			if (continueMode && !flatMode) {
				const extPrompt = buildBookOutlineExtendPrompt({ ...outlineInput, fromVolume: m + 1, toVolume: count });
				console.debug("[articlewriter] 书籍大纲续写请求规模", { model: setup.cfg.model_name || "(默认)", fromVol: m + 1, toVol: count, promptLen: extPrompt.length });
				const modal = await this.beginWritingPanel("继续生成书籍大纲", setup.cfg);
				if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
				modal.append(`${existing}\n\n`); // 先展示已有进度，新内容流式接在其后
				// v0.4.3+ 前缀缓存锚点：base book 大纲族 builder 统一上下文在前，沿上下文末尾钉点（同书重跑/同族后续请求可复用）
				const extPin = this.cachePin(extPrompt, outlineInput.contextDocs ?? "", (outlineInput.contextDocs ?? "").length);
				let seg = await this.streamWithEmptyRetry(setup.cfg, () => [
					{ role: "system", content: assembleSystemPrompt(undefined, BOOK_OUTLINE_GEN_SYSTEM_PROMPT) },
					{ role: "user", content: extPrompt },
				], modal, "继续生成书籍大纲", extPin);
				if (modal.signal.aborted) return;
				if (!seg.trim()) return;
				seg = this.trimExtendPreamble(seg).replace(/\s+$/, "");
				modal.reset();
				modal.append(seg); // 面板回到「实际将追加」的内容
				modal.finish();
				if (this.auto) modal.autoAccept(); // v0.3.0+ auto-book 免交互：done 态自动点「保存」
				const keep = await modal.done;
				if (!keep) { new Notice("未保存书籍大纲", 6000); return; }
				const raw = (await this.manager.readGlobalOutlineFile(story)).replace(/^#\s.*\n/, "");
				const body = raw ? `${raw}\n\n${seg}` : seg;
				await this.manager.setGlobalOutline(story, body);
				const decls = parseVolumeDeclarations(body);
				new Notice(decls.length
					? `✓ 已续写书级《大纲.md》（识别到 ${String(decls.length)} 条卷声明），可运行「从书级大纲生成卷」建卷并逐卷生成卷大纲`
					: `✓ 已续写书级《大纲.md》，但未识别到卷声明（格式：\`- 第X卷·卷名：描述\`）——请手动补上后再建卷`, 12000);
				return;
			}

			// v0.2.x+ 继续生成 · 平铺模式：从已有进度向后逐章续写（与完整生成的截断兜底共用 runFlatOutlineContinuation），只追加新生成部分
			if (continueMode) {
				const modal = await this.beginWritingPanel("继续生成书籍大纲", setup.cfg);
				if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
				modal.append(existing);
				const res = await this.runFlatOutlineContinuation({ cfg: setup.cfg, modal, outlineInput, content: existing, systemPrompt: assembleSystemPrompt(undefined, BOOK_OUTLINE_GEN_SYSTEM_PROMPT) });
				if (res.aborted) return;
				const heads = this.outlineChapterHeadings(res.content);
				const cut = heads.find((h) => h.num >= res.startNum); // startNum 可能等于 M（末章残缺被裁掉重生成时）→ 用 >= 把重生成的 M 章一并算进新内容
				if (!cut) {
					new Notice("未产生新章节，原大纲保持不变", 8000);
					return;
				}
				const newPart = res.content.slice(cut.index).replace(/\s+$/, "");
				modal.reset();
				modal.append(newPart); // 面板回到「实际将追加」的内容
				modal.finish();
				if (this.auto) modal.autoAccept(); // v0.3.0+ auto-book 免交互：done 态自动点「保存」
				const keep = await modal.done;
				if (!keep) { new Notice("未保存书籍大纲", 6000); return; }
				const rawFull = (await this.manager.readGlobalOutlineFile(story)).replace(/^#\s.*\n/, "");
				// 末章曾被裁掉重生成（startNum<=m）→ 原文末尾的残缺末章一并裁掉再拼，避免同一章出现两个版本
				const raw = res.startNum <= m ? this.trimLastOutlineChapter(rawFull).text : rawFull;
				const body = raw ? `${raw}\n\n${newPart}` : newPart;
				await this.manager.setGlobalOutline(story, body);
				const check = splitVolOutlineByChapter(body);
				new Notice(check.segments.length
					? `✓ 已续写书级《大纲.md》（识别到 ${String(check.segments.length)} 个章标记），可运行「从卷大纲生成章节」拆入各章`
					: `✓ 已续写书级《大纲.md》，但未识别到「第N章」标记——请手动补上章标记后再拆章`, 12000);
				return;
			}

			const promptText = buildBookOutlineGenPrompt(outlineInput);
			console.debug("[articlewriter] 书籍大纲生成请求规模", { model: setup.cfg.model_name || "(默认)", flatMode, promptLen: promptText.length });

			// 流式预览 + 保存确认
			const modal = await this.beginWritingPanel("生成书籍大纲", setup.cfg);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			const systemPrompt = assembleSystemPrompt(undefined, BOOK_OUTLINE_GEN_SYSTEM_PROMPT); // v0.2.24+：完整生成与平铺续写共用同一系统提示词
			// v0.4.3+ 前缀缓存锚点：builder 已改为上下文在前（整段书籍设定打头），钉在上下文末尾——
			// 紧接的续写轮次（runFlatOutlineContinuation）与「继续生成」都能从这里接着复用
			const promptTextPin = this.cachePin(promptText, outlineInput.contextDocs ?? "", (outlineInput.contextDocs ?? "").length);
			let content = await this.streamWithEmptyRetry(setup.cfg, () => [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: promptText },
			], modal, "生成书籍大纲", promptTextPin);
			if (modal.signal.aborted) return;
			if (!content.trim()) return;

			// v0.2.x+ 平铺模式：单次输出受 max_tokens 限制会被截断（如目标 100 章只生成到第 80 章）——
			// 未覆盖 1..count 时按 10 章一段自动续写（与「继续生成」共用 runFlatOutlineContinuation），直到覆盖或无法继续
			if (flatMode) {
				const res = await this.runFlatOutlineContinuation({ cfg: setup.cfg, modal, outlineInput, content, systemPrompt }); // v0.2.24+：复用上方已组装的 systemPrompt
				if (res.aborted) return;
				content = res.content;
			}

			modal.finish();
			if (this.auto) modal.autoAccept(); // v0.3.0+ auto-book 免交互：done 态自动点「保存」
			const keep = await modal.done;
			if (!keep) { new Notice("未保存书籍大纲", 6000); return; }

			// 落盘：非空弹覆盖/追加（追加保留原文含注释、剥掉首部 H1 后拼接，setGlobalOutline 统一补回自己的 H1）；空则直写
			let body = content.replace(/\s+$/, "");
			if (existing) {
				const items2: ActionItem[] = [
					{ label: "覆盖现有大纲", sub: "用新生成内容替换《大纲.md》" },
					{ label: "追加到现有大纲末尾", sub: "保留原文（含注释），新内容接在末尾" },
				];
				const choice = this.auto ? 0 : await this.pickAction("书级《大纲.md》非空，如何保存？", items2); // v0.3.0+ auto-book 免交互：流水线只在 overwrite 时走到这里（已有产物且不开覆盖则整阶段跳过），直取「覆盖」
				if (choice == null) { new Notice("已取消保存书籍大纲", 6000); return; }
				if (choice === 1) {
					const raw = (await this.manager.readGlobalOutlineFile(story)).replace(/^#\s.*\n/, "");
					body = raw ? `${raw}\n\n${body}` : body;
				}
			}
			await this.manager.setGlobalOutline(story, body);

			// 软警告：平铺查章标记（拆章前提）；有卷查卷声明（「从书级大纲生成卷」前提）
			if (flatMode) {
				const check = splitVolOutlineByChapter(body);
				new Notice(check.segments.length
					? `✓ 已生成书级《大纲.md》（识别到 ${String(check.segments.length)} 个章标记），可运行「从卷大纲生成章节」拆入各章`
					: `✓ 已生成书级《大纲.md》，但未识别到「第N章」标记——请手动补上章标记后再拆章`, 12000);
			} else {
				const decls = parseVolumeDeclarations(body);
				new Notice(decls.length
					? `✓ 已生成书级《大纲.md》（识别到 ${String(decls.length)} 条卷声明），可运行「从书级大纲生成卷」建卷并逐卷生成卷大纲`
					: `✓ 已生成书级《大纲.md》，但未识别到卷声明（格式：\`- 第X卷·卷名：描述\`）——请手动补上卷声明后再建卷`, 12000);
			}
		} catch (e) {
			this.notifyError("生成书籍大纲失败", e);
		}
	}

	// ---------- v0.2.x+ 从书级大纲生成卷 (/book-outline-to-volumes) ----------

	/** 解析书级《大纲.md》的卷声明（`- 第X卷·名：描述`，旧格式区间注记「（第A-B章）」仍兼容解析），逐卷生成其声明的全部卷及各自卷大纲（详细程度书级→卷级→章级；v0.2.x+ 增量分段落盘——全量模式【卷设计】段 + 每缺失章一个小节、补全模式逐缺失章小节，每段流式展示完立即写盘，防长单次输出断开）：
	 * - 缺失卷按声明自动创建（描述作卷描述）；建卷失败记该卷 failed 继续下一卷；已有卷按**精确名**匹配（不用包含匹配防误配）；
	 * - 各卷目标章数由单个弹窗一次性问全（每卷一个正整数，不设上限）；
	 * - 逐卷模式判定：missing = 1..N 与已有章号差集——空 → 整卷跳过「全部 N 章已齐整」；已有章条目且 missing 非空 → 补全模式（只补缺失章、生成后按章序合并，已有章原样保留绝不重写）；无章条目（文件空或只有自由文本前言）→ 全量生成（现有内容作上下文）+ 同一合并路径（前言保留）；
	 * - 批内链式上下文：prevVolumeOutline 取阅读序前一卷清洗大纲，本轮已更新的卷用 freshOutlines 缓存（存 stripComments(currentRaw).trim()，与 readVolumeOutline 同口径）；
	 * - 某卷生成中断（前 N 段已落盘、保留）/面板打不开 → 记该卷 failed 继续下一卷；Esc 中断 → 整批中止（收尾汇总注明、已落盘段落保留）。
	 * 入口：命令面板 + 写字台「书籍列表」标题行右键（仅 volMode）。 */
	async cmdBookOutlineToVolumes(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			if (state.use_volumes === false) { new Notice(NO_VOL_MODE_MSG, 10000); return; } // 无卷模式没有卷大纲

			const globalOutline = await this.manager.readGlobalOutline(story); // 清洗文本（bullet 声明行原样保留）
			if (!globalOutline.trim()) { new Notice("书级《大纲.md》为空，请先写书级大纲再生成卷", 8000); return; }
			const decls = parseVolumeDeclarations(globalOutline);
			if (!decls.length) { new Notice("书级《大纲.md》未识别到卷声明（格式：`- 第X卷·卷名：描述`）", 10000); return; }
			const counts = await this.promptAllVolumeChapterCounts(decls, "从书级大纲生成卷", state.auto_book?.chapter_counts); // v0.4.6+ chapter_counts 预填＋写回
			if (!counts) return;
			await this.saveAutoVolCounts(story, state, counts);

			const setup = this.getPhaseLlmSetup(PHASE_OUTLINE); // v0.2.22+：书籍大纲和卷级大纲生成阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			await this.ensurePlanningGuide(story, state); // v0.2.13+：缺失则先自动生成（软依赖，失败返回 ""）；副作用先行，specs 只负责读盘注入

			let vols = await this.manager.volumeList(story);
			const freshOutlines = new Map<string, string>(); // 本轮已更新的卷 → 清洗后大纲（供后续卷链式上下文，与 readVolumeOutline 同口径）
			const results: Array<{ name: string; mark: "✓" | "↷" | "✗"; note: string }> = [];
			let aborted = false;

			for (let i = 0; i < decls.length; i++) {
				const decl = decls[i];
				const n = counts[i];
				let vol = vols.find((v) => v.name === decl.name); // 精确名匹配（包含匹配会把「雾港」误配到「雾港外海」之类）
				if (!vol) {
					try {
						vol = await this.manager.addVolume(story, decl.name, decl.description);
						vols = await this.manager.volumeList(story); // 建卷后重载（order/ID 以磁盘为准）
					} catch (e) {
						results.push({ name: decl.name, mark: "✗", note: `建卷失败：${String(e)}` });
						continue;
					}
				}

				const existingRaw = await this.manager.readVolumeOutlineRaw(story, vol.id);
				const cachedExisting = freshOutlines.get(vol.id);
				const existingClean = cachedExisting != null ? cachedExisting : await this.manager.readVolumeOutline(story, vol.id); // 清洗文本：模板注释视为空
				const existingSegs = [...splitVolOutlineByChapter(existingClean).segments].sort((a, b) => a.num - b.num); // 已有章小节（章序）：用于判定缺失章号
				const haveNums = new Set(existingSegs.map((s) => s.num));
				const missing: number[] = [];
				for (let c = 1; c <= n; c++) if (!haveNums.has(c)) missing.push(c);
				if (!missing.length) { results.push({ name: decl.name, mark: "↷", note: `全部 ${n} 章已齐整，跳过` }); continue; }
				const supplementMode = haveNums.size > 0; // 已有章条目 → 只补缺失章；无章条目（空/纯自由文本）→ 全量生成（前言经合并路径保留）

				// 链式上下文：阅读序前一卷（本轮已更新则用缓存）
				const volIdx = vols.findIndex((v) => v.id === vol.id);
				const prevVol = volIdx > 0 ? vols[volIdx - 1] : null;
				let prevOutline = "";
				if (prevVol) {
					const cachedPrev = freshOutlines.get(prevVol.id);
					prevOutline = cachedPrev != null ? cachedPrev : await this.manager.readVolumeOutline(story, prevVol.id);
				}

				const assembled = await this.assembleVolOutlineContext(story, state, vol, { volumes: vols.map((v) => ({ name: v.name, description: v.description })), prevOutline });
				const ctx: VolOutlineGenInput = {
					targetVolumeName: vol.name,
					chapterCount: n,
					hasPlanningGuide: hasCtxBlock(assembled, HDR_PLANNING), // v0.2.25+ 引用文档配置框：【策划规范】措辞按块实际存在门控
					contextDocs: assembled.text,
				};
				console.debug("[articlewriter] 书级大纲→生成卷增量生成", { model: setup.cfg.model_name || "(默认)", vol: vol.name, mode: supplementMode ? "补全" : "全量", missing, steps: missing.length + (supplementMode ? 0 : 1) });

				// 增量分段落盘：全量模式先【卷设计】段（直接追加——合并会丢前言）、再每缺失章一个小节；补全模式无设计步、逐章小节；
				// 每章小节经 mergeVolOutlineChapters 按章序插入（已有章原样保留、绝不重写），每段流式展示完立即写盘（防长单次输出断开）
				const label = `生成卷大纲 ${vol.name} (${i + 1}/${decls.length})`;
				let currentRaw = existingRaw.replace(/^#\s.*\n/, "");
				const addedNums: number[] = [];
				const droppedNums: number[] = [];
				const castRun = await this.outlineCastRun(story, state);
				const res = await this.genVolOutlineIncremental({
					cfg: setup.cfg,
					failLabel: label,
					chapterNums: missing,
					hasDesign: !supplementMode,
					buildDesignPrompt: () => buildVolOutlineDesignPrompt(ctx),
					buildChapterPrompt: (num, design, soFar) => buildVolOutlineChapterPrompt({ ...ctx, chapterNum: num, volumeDesign: design, generatedSoFar: soFar, supplementMode }),
					cast: castRun ? { story, volId: vol.id, tracker: castRun.tracker, stats: castRun.stats } : undefined,
					commit: async (seg, kind) => {
						const cur = currentRaw.replace(/\s+$/, ""); // 拼接前统一去尾部空白（各段尾部空白已被助手剥除），保证段间恰好一个空行
						if (kind === "design") {
							currentRaw = cur ? `${cur}\n\n${seg}` : seg; // 设计段是卷级前言：直接追加（合并路径会丢弃新内容的前言）
						} else {
							const merged = mergeVolOutlineChapters(cur ? `${cur}\n\n` : "", seg);
							addedNums.push(...merged.added);
							droppedNums.push(...merged.dropped);
							currentRaw = merged.body;
						}
						await this.manager.setVolumeOutline(story, vol.id, currentRaw);
					},
					systemPrompt: assembleSystemPrompt(undefined, this.promptSkill("卷大纲生成", VOL_OUTLINE_GEN_SYSTEM_PROMPT)),
					stableContext: ctx.contextDocs,
				});
				if (res.panelFailed) { results.push({ name: decl.name, mark: "✗", note: "无法打开生成面板" }); continue; }
				if (res.aborted) { aborted = true; break; } // 停止按钮 → 整批中止（已落盘段落保留）
				if (res.failed) { results.push({ name: decl.name, mark: "✗", note: `生成中断${res.written ? `（前 ${String(res.written)} 段已落盘）` : ""}` }); continue; }

				freshOutlines.set(vol.id, stripComments(currentRaw).trim());
				const castNote = castRun && castRun.stats.characters + castRun.stats.relationships > 0 ? `；人物 ${String(castRun.stats.characters)}／关系 ${String(castRun.stats.relationships)} 条` : "";
				results.push({ name: decl.name, mark: "✓", note: `新增 ${String(addedNums.length)} 章（第${addedNums.join("、")}章）${droppedNums.length ? `，丢弃重复 ${String(droppedNums.length)} 章` : ""}${castNote}` });
			}

			const lines = results.map((r) => `${r.mark} ${r.name}：${r.note}`);
			new Notice([`从书级大纲生成卷完成${aborted ? "（用户中止，后续卷未处理）" : ""}`, ...lines].join("\n"), 15000);
		} catch (e) {
			this.notifyError("从书级大纲生成卷失败", e);
		}
	}

	// ---------- v0.2.11+ 同步卷大纲章节 (/vol-outline-sync) ----------

	/** 卷大纲被用户续写后，从被续写部分创建新章节：按「第N章」标记解析《卷大纲.md》，章号尚不存在的章节自动创建并把该段内容写入其《章节大纲.md》；已存在的章跳过不动（不碰其大纲）；一个标记都没有时引导用「从卷大纲生成章节」（含 AI 兜底拆分）。收尾：有原当前章则恢复，否则指向首个新建章（文档序，面向增量续写）。可选参 volId＝写字台卷节点右键入口：锁定被点卷、不弹选择器（找不到该卷则提示中止） */
	async cmdSyncVolOutlineChapters(volId?: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			if (state.use_volumes === false) { new Notice(NO_VOL_MODE_MSG, 10000); return; } // 无卷模式没有卷大纲
			const volsRec = await this.manager.loadVolumes(story);
			const vols = Object.values(volsRec).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
			if (!vols.length) { new Notice("还没有卷，请先新建卷（新建卷）", 8000); return; }
			const curVol = (state.current_volume ?? "").trim();
			let vol = volId ? this.manager.findVolumeIn(volsRec, volId) : (curVol ? this.manager.findVolumeIn(volsRec, curVol) : null); // 右键入口锁定被点卷；否则回落当前卷
			if (!vol) {
				if (volId) { new Notice(`找不到卷 ${volId}（可能已改名或删除）`, 8000); return; }
				const items: ActionItem[] = vols.map((v) => ({ label: v.name, sub: v.description || undefined, marker: v.id === curVol ? "▶ 当前" : undefined }));
				const idx = await this.pickAction("选择目标卷（把它的卷大纲同步成章节）", items);
				if (idx == null) return;
				vol = vols[idx];
			}
			const raw = await this.manager.readVolumeOutline(story, vol.id);
			if (!raw.trim()) { new Notice(`卷「${vol.name}」的《卷大纲.md》为空，请先写大纲`, 8000); return; }
			const { segments, preamble } = splitVolOutlineByChapter(raw);
			if (!segments.length) {
				new Notice(`未在「${vol.name}」的卷大纲中识别到「第N章」标记。\n请为续写部分补上章标记（如「## 第6章 <标题>」），或运行「从卷大纲生成章节」（无标记时可用 AI 兜底拆分）`, 15000);
				return;
			}

			const prevCurrent = state.current_chapter ?? "";
			let created = 0, setCount = 0, skipped = 0;
			const badNums: number[] = [];
			const createdKeys: string[] = [];
			for (const seg of segments) {
				if (seg.num < 1) { badNums.push(seg.num); continue; }
				const { key, created: isNew } = await this.manager.ensureChapterAt(story, seg.num, seg.title, vol.id);
				if (!isNew) { skipped++; continue; } // 已存在的章：不动其大纲（用户可能已写过）
				created++;
				createdKeys.push(key);
				if (seg.content.trim()) { await this.manager.setChapterOutline(story, key, seg.content); setCount++; } // 新章必空纲，直写
			}
			// 收尾：有原当前章则恢复；否则指向首个新建章（文档序，供增量续写后接着写）
			if (prevCurrent) await this.manager.switchChapter(story, prevCurrent);
			else if (createdKeys.length) await this.manager.switchChapter(story, createdKeys[0]);

			if (!created) {
				new Notice(`「${vol.name}」没有可新建的章节：${String(segments.length)} 个「第N章」标记均已存在（跳过 ${String(skipped)}${badNums.length ? `，忽略无效章号 ${badNums.join("、")}` : ""}），未做任何改动`, 12000);
				return;
			}
			const lines = [`✓ 已把「${vol.name}」卷大纲同步成章节：新建 ${String(created)} 章`];
			if (setCount) lines.push(`直接写入大纲：${String(setCount)}`);
			lines.push(`跳过已有章节：${String(skipped)}`);
			if (badNums.length) lines.push(`忽略无效章号：${badNums.join("、")}`);
			if (preamble.trim()) lines.push("提示：首个章标记前有卷级前言内容，未分配到任何章节");
			new Notice(lines.join("\n"), 12000);
		} catch (e) {
			this.notifyError("同步卷大纲章节失败", e);
		}
	}

	// ---------- v0.2.10+ 连续编写 (/write-consecutive) ----------

	/** 从阅读序中**第一个没有正文的章节**起（不依赖 current_chapter——章数很多时当前章可能停在第 40 章），逐章生成、每章写完自动推进，遇到无大纲章或用户中断才停止。
	 * 已有正文的章一律跳过（不覆盖），因此反复执行即可从断点续写。
	 * v0.4.3+ 两点改动：①先把待编写章节收集成数组（正文空＋大纲非空），再逐章调用「编写一章」共用核心 `writeOneChapter`（与 /write 同一条生成路径，不再各写一份上下文装配/流式/摘要解析）；
	 * ②去AI味改为**先记录、整轮写完后统一改**——每章只用禁用词表本地检测并把命中写进书级《案头资料/AI味清单.md》，
	 *   全部章节写完后由 `runDeferredDeai` 逐章回读正文＋重建上下文统一打回重写并回填状态。理由：章间插入清洗 LLM 请求会把引擎 slot 里的写作会话覆盖掉（跨会话停放又常被 skip parking 拒），
	 *   逐章前缀复用全部归 0；单章命令（/write、/continue、/rewrite）仍写完立即清洗。
	 * 可选参 volId＝写字台卷节点右键入口：限该卷内连续编写（同样从该卷第一个没有正文的章节起，生成到卷末或中断） */
	async cmdWriteConsecutive(volId?: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		try {
			const state = await this.manager.validatedState(story);
			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			const allChapters = await this.manager.listChapters(story); // 阅读序：书根在前 + 各卷按 order、组内本地号升序
			const chapters = volId ? allChapters.filter((c) => c.vol === volId) : allChapters; // v0.2.x+ 卷节点右键：限该卷（当前章不属本卷时 findIndex=-1→从本卷首章起）
			if (!chapters.length) { new Notice(volId ? "该卷还没有章节，请先创建章节" : "还没有章节，请先创建章节", 8000); return; }
			const volNames = await this.volNameMap(story);
			const scenes = await this.manager.loadAllScenes(story);
			const curSceneId = state.current_scene ?? undefined;
			const curScene = curSceneId ? scenes[curSceneId] : undefined;

			// 起点＝阅读序中第一个没有正文的章节（章数很多/当前章停在中间时也从最前面的空缺开始；全部已有正文则直接提示）
			let startIdx = -1;
			for (let i = 0; i < chapters.length; i++) {
				const body = await this.manager.readChapterContent(story, chapters[i].key);
				if (!body.trim()) { startIdx = i; break; }
			}
			if (startIdx < 0) {
				new Notice(volId ? "该卷全部章节都已有正文，无需连续编写" : "全部章节都已有正文，无需连续编写（如需重写某章请用「编写本章」）", 8000);
				return;
			}
			// v0.4.3+ 先收集「待编写章节」数组（正文为空且大纲非空才入队，遇到缺大纲即停），再逐章调用「编写一章」共用核心 writeOneChapter
			// ——与 /write 同一条生成路径（上下文装配、前缀缓存钉点、摘要随写、字数与编号引用提醒都不重复实现）
			const queue: Array<{ key: string; label: string; outline: string }> = [];
			let skipped = 0;
			let stopReason = "";
			for (const ch of chapters.slice(startIdx)) {
				const label = this.keyLabel(ch.key, volNames, ch.title);
				const body = await this.manager.readChapterContent(story, ch.key);
				if (body.trim()) { // 先判正文：已有正文的章直接跳过，即使缺大纲也不阻断后续（原顺序先判大纲会被已写章卡住）
					skipped++;
					new Notice(`⏭ ${label} 已有正文（${String(countPureWords(body))} 字），跳过`, 5000);
					continue;
				}
				const outline = await this.manager.readChapterOutlineForPrompt(story, ch.key);
				if (!outline.trim()) { stopReason = `${label} 没有大纲`; break; }
				queue.push({ key: ch.key, label, outline });
			}
			if (!queue.length) { new Notice(stopReason || "没有需要编写的章节", 8000); return; }

			// v0.4.3+ 去AI味时机：连续编写＝「先记录、写完统一改」——逐章只做禁用词本地检测（不花 LLM 调用）并登记进书级《AI味清单.md》，
			// 整轮章节写完后统一打回重写。理由：章与章之间插一条清洗 LLM 请求会把引擎 slot 里刚写好的写作会话覆盖掉（跨会话停放又常被
			// skip parking 拒），逐章 reused 全成 0；改成登记后，章与章之间只剩纯连续的写作请求，前缀复用链不断。
			const ledger: DeaiLedger = { generatedAt: formatLocalDateTime(new Date().toISOString(), true), scopeLabel: volId ? volNames[volId] ?? volId : "全书", writtenChapters: 0, entries: [] };
			// v0.4.3+ 上一轮中途停止留下的未清洗章 → 并入本轮一起收尾（清单文件按本轮重写，仍未处理完的继续留在里面等「补做去AI味」）
			const prevLedgerFile = this.app.vault.getAbstractFileByPath(`${this.manager.deskDocsPath(story)}/${DEAI_LEDGER_DOC_NAME}`);
			if (prevLedgerFile instanceof TFile) {
				const prev = parseDeaiLedgerDoc(await this.app.vault.read(prevLedgerFile));
				const carry: DeaiLedgerEntry[] = (prev?.entries ?? [])
					.filter((e) => e.status !== "cleaned")
					.map((e) => ({ ...e, status: "pending", note: "上一轮连续编写未清洗，并入本轮" }));
				if (carry.length) {
					ledger.entries.push(...carry);
					new Notice(`《AI味清单.md》里还有 ${String(carry.length)} 章未清洗（上一轮中途停止），已并入本轮统一处理`, 8000);
				}
			}
			let ledgerPath = "";
			let written = 0, totalWords = 0, summariesSaved = 0;
			const runStartedAt = Date.now(); // 逐章自动续写：每章写完后直接进入下一章，不需要等待用户再次点击
			for (const item of queue) {
				const res = await this.writeOneChapter({
					story,
					chKey: item.key,
					label: item.label,
					chapterOutlineRaw: item.outline,
					panelTitle: `连续编写 ${item.label}`,
					setup,
					state,
					deferDeai: true, // 本章只登记 AI 味，清洗留到整轮结束后统一做
				});
				if (!res.ok) {
					stopReason = res.reason === "panel" ? `${item.label} 无法打开生成面板` : res.reason === "aborted" ? `${item.label} 生成被中断` : res.reason === "body" ? `${item.label} 正文为空（仅输出摘要块）` : `${item.label} 生成结果为空`;
					break;
				}
				const { content, chapterSummary, modal } = res;
				const words = await this.manager.setChapterBody(story, item.key, content); // 免确认自动保存
				// v0.2.21+：同响应产出的摘要分别落盘（失败不阻断连续编写，回落到延迟生成）
				if (chapterSummary) {
					try {
						await this.manager.saveChapterSummary(story, item.key, chapterSummary);
						summariesSaved++;
					} catch { /* 摘要保存失败不阻断连续编写 */ }
				}
				if (curScene?.chapter_num && chKey(curScene.vol ?? "", curScene.chapter_num) === item.key) {
					const old = (curScene.content || "").replace(/\s+$/, "");
					await this.manager.updateScene(story, curScene.scene_id, { content: old ? `${old}\n\n${content}` : content });
				}
				await this.manager.switchChapter(story, item.key); // 自动推进到下一章，无需用户再次点击
				modal.finishAuto(`✓ 已自动保存 ${String(words)} 字${chapterSummary ? "，摘要已一并保存" : ""}`);
				written++;
				totalWords += words;
				ledger.writtenChapters = written;
				if (res.aiFlavor?.hits) {
					ledger.entries.push({ chKey: item.key, label: item.label, hits: res.aiFlavor.hits, words: res.aiFlavor.words, sentences: res.aiFlavor.sentences, status: "pending" });
					ledgerPath = await this.writeDeaiLedger(story, ledger); // 每章即时落盘：中途停止也留下待处理清单
				}
			}
			// 整轮写完后统一去AI味（中途停止也照做：已写章节不该留着 AI 味交回用户）
			if (ledger.entries.length) {
				new Notice(`开始统一去除 AI 味：${ledgerCounts(ledger)}`, 8000);
				await this.runDeferredDeai(story, ledger, setup);
				ledgerPath = await this.writeDeaiLedger(story, ledger);
			}
			const lines = [`连续编写结束：共写入 ${String(written)} 章`];
			if (skipped) lines.push(`跳过 ${String(skipped)} 章（已有正文）`);
			if (totalWords) lines.push(`总字数：${String(totalWords)}`);
			if (summariesSaved) lines.push(`摘要：已随正文保存 ${String(summariesSaved)} 份`); // v0.2.21+
			lines.push(`总用时：${formatElapsedMs(Date.now() - runStartedAt)}`);
			if (stopReason) lines.push(`停止原因：${stopReason}`);
			if (ledger.entries.length) {
				const uncleaned = ledger.entries.filter((e) => e.status !== "cleaned").length;
				lines.push(`AI 味统一改写：${ledgerCounts(ledger)}${uncleaned ? `\n未洗完的 ${String(uncleaned)} 章可再运行命令「补做去AI味」` : ""}${ledgerPath ? `\n清单文件：${ledgerPath}` : ""}`);
			}
			new Notice(lines.join("\n"), 12000);
		} catch (e) {
			this.notifyError("连续编写失败", e);
		}
	}

	// ---------- v0.3.0+ 全自动写书流水线（v0.4.1+ 入口＝auto-book-run 按《故事状态.md》auto_book 配置启动 / auto-book-stop 停止） ----------

	/** 预检：按起始阶段的前置需求逐项做文件/标记检查（pipeline.ts 只存 id+label，IO 在这里）；
	 *  读取异常按缺失处理（与各命令自身容错同口径）。返回缺失项 label 列表（空＝全部满足、可以开始） */
	private async autoMissing(story: string, reqs: StageRequirement[]): Promise<string[]> {
		const missing: string[] = [];
		for (const r of reqs) {
			let ok = false;
			try {
				switch (r.id) {
					case "worldview":
						ok = ((await this.manager.readWorldDoc(story)).fullText ?? "").trim().length > 0; // fullText 可选：parseWorld 不产生、由 readWorldDoc 填充
						break;
					case "book-outline":
						ok = (await this.manager.readGlobalOutline(story)).trim().length > 0;
						break;
					case "book-outline-volume-decls":
						ok = parseVolumeDeclarations(await this.manager.readGlobalOutlineFile(story)).length > 0; // 原文检查：清洗版 readGlobalOutline 会剥声明行以外的加工，声明以原文为准
						break;
					case "book-outline-chapters":
						ok = this.outlineChapterHeadings(await this.manager.readGlobalOutline(story)).length > 0; // 平铺拆书级大纲＝只认标题式「## 第N章」
						break;
					case "volumes": {
						const vols = await this.manager.volumeList(story);
						ok = vols.length > 0 && (await Promise.all(vols.map((v) => this.manager.readVolumeOutline(story, v.id)))).every((t) => splitVolOutlineByChapter(t).segments.length > 0);
						break;
					}
					case "chapter-outlines": {
						const chs = await this.manager.listChapters(story);
						ok = chs.length > 0 && (await Promise.all(chs.map((c) => this.manager.readChapterOutlineForPrompt(story, c.key)))).every((t) => t.trim().length > 0);
						break;
					}
				}
			} catch { ok = false; }
			if (!ok) missing.push(r.label);
		}
		return missing;
	}

	/** 阶段是否已有产物：仅前三个生成阶段有「已有即跳过」语义（重复 LLM 生成代价高）；
	 *  volumes/chapter-outlines/bodies 三阶段命令本身增量（只补缺失卷/章/正文），不设跳过 */
	private async autoStageHasOutput(story: string, id: StageId): Promise<boolean> {
		try {
			if (id === "worldview") return ((await this.manager.readWorldDoc(story)).fullText ?? "").trim().length > 0;
			if (id === "planning") return (await this.manager.readPlanningGuide(story)).trim().length > 0;
			if (id === "book-outline") return (await this.manager.readGlobalOutline(story)).trim().length > 0;
		} catch { /* 读取异常＝按无产物处理（该阶段会重新生成） */ }
		return false;
	}

	/** 流水线停止信号：「停止全自动」置 stopped；或生成面板被中断（点「停止生成」按钮/流式中关面板＝abort；v0.3.0+ 起 Esc 不再中断） */
	private autoAborted(): boolean {
		return this.auto?.stopped === true || this.lastGenPanel?.signal.aborted === true;
	}

	/** 编排主体：预检缺前置文件→列出缺什么并拒绝开始（不静默补建、不生成任何内容）；
	 *  通过后置 this.auto（各交互助手免交互）→ stagesFrom(startAt, endAt) 逐阶段直接调既有 cmd 方法（不重复实现生成逻辑，endAt 含、缺省到末尾）；
	 *  平铺模式跳过 volumes 阶段；前三个生成阶段已有产物且未开覆盖则整阶段跳过；
	 *  book-outline（平铺）与 chapter-outlines（逐卷）经 countOverride 喂章数弹窗；阶段前后查停止信号，中止即断 */
	private async runAutoBook(story: string, flatMode: boolean, input: AutoBookInput): Promise<void> {
		const stages = stagesFrom(input.startAt, input.endAt);
		if (!stages.length) { new Notice("全自动未开始——停止节点排在起始节点之前，执行范围为空", 8000); return; }
		const missing = await this.autoMissing(story, requirementsFor(input.startAt, flatMode));
		if (missing.length) {
			new Notice(`全自动未开始——缺少前置文件：\n${missing.map((m) => `・${m}`).join("\n")}`, 15000);
			return;
		}
		const auto: AutoRun = { premise: input.premise.trim(), volumeCount: input.volumeCount, chapterCounts: input.chapterCounts.slice(), flatTotalChapters: input.flatTotalChapters, overwrite: input.overwrite, countOverride: null, stopped: false }; // 局部引用：this.auto 跨 await 会被 TS 收窄失效，编排内一律用 auto
		this.auto = auto;
		this.lastGenPanel = null; // 清掉上一轮（含手动生成）遗留的面板实例与 abort 状态
		const done: string[] = [];
		const skipped: string[] = [];
		let stoppedAt = "";
		try {
			for (const stage of stages) {
				if (this.autoAborted()) { stoppedAt = `${stage.name}（未执行）`; break; }
				if (flatMode && stage.id === "volumes") { skipped.push(`${stage.name}（平铺模式无卷）`); continue; }
				if (!auto.overwrite && (await this.autoStageHasOutput(story, stage.id))) { skipped.push(`${stage.name}（已有产物）`); continue; }
				if (stage.id === "book-outline" || stage.id === "chapter-outlines") auto.countOverride = flatMode ? input.flatTotalChapters : null; // 平铺：书级大纲逐章规划/拆书级大纲都要章数弹窗
				else auto.countOverride = null;
				new Notice(`全自动 · 进入阶段：${stage.name}`, 5000);
				switch (stage.id) {
					case "worldview": await this.cmdGenerateWorldview(); break;
					case "planning": await this.cmdPlanningGuideWorldview(); break;
					case "book-outline": await this.cmdGenerateBookOutline(); break;
					case "volumes": await this.cmdBookOutlineToVolumes(); break;
					case "chapter-outlines":
						if (flatMode) await this.cmdVolumeOutlineToChapters(); // 平铺：无参调用＝拆书级《大纲.md》、章节落书根
						else {
							const vols = await this.manager.volumeList(story);
							for (let i = 0; i < vols.length; i++) {
								if (this.autoAborted()) break;
								const last = input.chapterCounts[input.chapterCounts.length - 1];
								auto.countOverride = input.chapterCounts[i] ?? last ?? null; // 逐卷显式答案；与卷数不齐时末值复制兜底
								await this.cmdVolumeOutlineToChapters(vols[i].id);
							}
						}
						break;
					case "bodies": await this.cmdWriteConsecutive(); break;
				}
				if (this.autoAborted()) { stoppedAt = `${stage.name}（执行中中止）`; break; }
				done.push(stage.name);
			}
		} finally {
			this.auto = null;
		}
		const lines = [`全自动写书结束：执行 ${String(done.length)} 个阶段${done.length ? `：${done.join(" → ")}` : ""}`];
		if (skipped.length) lines.push(`跳过：${skipped.join("、")}`);
		if (stoppedAt) lines.push(`停止于：${stoppedAt}`);
		new Notice(lines.join("\n"), 15000);
	}

	/** 停止全自动：置 stopped（编排阶段间断）+ 对当前生成面板 requestStop()（流式中＝中断本次生成、done 态＝放弃保存收尾） */
	async cmdStopAutoBook(): Promise<void> {
		if (!this.auto) { new Notice("当前没有运行中的全自动流水线", 5000); return; }
		this.auto.stopped = true;
		(await this.getGenPanel(false))?.requestStop();
		new Notice("已请求停止全自动流水线——当前生成中断，剩余阶段不再执行", 8000);
	}

	// ---------- v0.4.1+ 全自动建书（配置＝《故事状态.md》auto_book 块；旧「案头资料/」技能文件在命令入口自动迁移） ----------

	/** 旧技能文件（v0.4.1 前 案头资料/<名>.md，frontmatter 带 auto_book: true）一次性迁移：扫描解析→合并进 state——
	 *  mode 决定 use_volumes（与旧流水线实际执行口径一致）、premise 字段∨正文在 one_line 为空时补入、执行范围＋规模参数写入 auto_book 块；
	 *  发现即删除旧文件并 saveState，Notice 说明合并结果。多个技能文件按文件名顺序逐个合并（后者按键覆盖）并全部删除。返回合并后的 state */
	private async migrateLegacyBookSkills(story: string, state: StoryState): Promise<StoryState> {
		const adapter = this.app.vault.adapter;
		const desk = this.manager.deskDocsPath(story);
		const found: { name: string; path: string; spec: BookSkillSpec }[] = [];
		if (await adapter.exists(desk)) {
			for (const f of (await adapter.list(desk)).files) {
				if (!f.endsWith(".md")) continue;
				let raw: string;
				try { raw = await adapter.read(f); } catch { continue; }
				const spec = parseBookSkill(raw);
				if (spec) found.push({ name: f.split("/").pop()!.replace(/\.md$/, ""), path: f, spec });
			}
		}
		if (!found.length) return state;
		found.sort((a, b) => a.name.localeCompare(b.name));
		for (const { spec } of found) {
			if (spec.mode) state.use_volumes = spec.mode === "volumes"; // 旧流水线按技能 mode 执行，迁移时覆盖文档 use_volumes
			const premise = (spec.premise ?? "").trim() || spec.body.trim();
			if (premise && !(state.one_line ?? "").trim()) state.one_line = premise;
			const cfg: AutoBookConfig = { ...(state.auto_book ?? {}) };
			if (spec.startAt) cfg.start = spec.startAt;
			if (spec.endAt) cfg.end = spec.endAt;
			if (spec.flatTotalChapters != null) cfg.chapters = spec.flatTotalChapters;
			if (spec.volumeCount != null) cfg.volumes = spec.volumeCount;
			if (spec.chapterCounts?.length) cfg.chapter_counts = [...spec.chapterCounts];
			if (spec.overwrite != null) cfg.overwrite = spec.overwrite;
			state.auto_book = cfg;
		}
		for (const f of found) await adapter.remove(f.path).catch(() => {});
		await this.manager.saveState(story, state);
		new Notice(`旧建书技能配置已合并进《故事状态.md》auto_book 并删除文件：${found.map((f) => f.name).join(", ")}\n模式＝${state.use_volumes ? "分卷" : "平铺"}；此后「全自动写书」按状态文档配置执行`, 12000);
		return state;
	}

	/** auto-book 配置写回《故事状态.md》：use_volumes＝规模模式、one_line＝一句话设定（空＝保持不动不覆盖）、
	 *  auto_book＝执行范围＋规模参数＋覆盖开关（start=worldview 等默认值不写；与所选模式无关的规模键不写） */
	private async saveAutoBookConfig(story: string, input: AutoBookConfigInput): Promise<void> {
		const state = await this.manager.validatedState(story);
		state.use_volumes = input.mode === "volumes";
		if (input.premise.trim()) state.one_line = input.premise.trim();
		const cfg: AutoBookConfig = {};
		if (input.startAt !== "worldview") cfg.start = input.startAt;
		if (input.endAt) cfg.end = input.endAt;
		if (input.mode === "flat") {
			if (input.flatTotalChapters) cfg.chapters = input.flatTotalChapters;
		} else {
			if (input.volumeCount) cfg.volumes = input.volumeCount;
			if (input.chapterCounts.length) cfg.chapter_counts = [...input.chapterCounts];
		}
		cfg.overwrite = input.overwrite;
		state.auto_book = cfg;
		await this.manager.saveState(story, state);
	}

	/** 「配置全自动建书」：弹窗预填当前配置（先迁移旧技能文件）→ 保存写回状态文档（auto_book＋use_volumes＋one_line） */
	async cmdAutoBookConfig(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		if (this.auto) { new Notice("全自动流水线已在运行中——请先停止再修改配置", 8000); return; }
		try {
			const state = await this.migrateLegacyBookSkills(story, await this.manager.validatedState(story));
			const cfg = state.auto_book ?? {};
			new AutoBookConfigModal(this.app, {
				flatMode: state.use_volumes === false,
				premise: (state.one_line ?? "").trim(),
				startAt: cfg.start,
				endAt: cfg.end,
				volumeCount: cfg.volumes,
				chapterCounts: cfg.chapter_counts,
				flatTotalChapters: cfg.chapters,
				overwrite: cfg.overwrite,
			}, async (input) => {
				await this.saveAutoBookConfig(story, input);
				new Notice("已保存全自动建书配置到《故事状态.md》（auto_book）——运行「全自动写书」即可按配置免交互跑流水线", 8000);
			}).open();
		} catch (e) {
			this.notifyError("保存全自动建书配置失败", e);
		}
	}

	/** 「全自动写书」：按当前书《故事状态.md》配置（auto_book 块＋use_volumes＋one_line，先迁移旧技能文件）跑流水线——
	 *  参数齐全（见 autoBookMissing）＝弹 SkillRangeModal 预填配置 start/end 确认或调整范围后开跑；
	 *  缺参＝Notice 提示缺项＋预填 AutoBookModal 补填，补填结果顺带持久化回状态文档后再开跑 */
	async cmdAutoBookRun(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story || !(await this.ensureVolumeLayout(story))) return;
		if (this.auto) { new Notice("全自动流水线已在运行中——如需重新开始请先「停止全自动写书」", 8000); return; }
		try {
			const state = await this.migrateLegacyBookSkills(story, await this.manager.validatedState(story));
			const flatMode = state.use_volumes === false;
			const cfg = state.auto_book;
			const premise = (state.one_line ?? "").trim();
			const startAt = cfg?.start ?? "worldview";
			const missing = autoBookMissing(premise, cfg, flatMode, startAt);
			if (!missing.length) {
				new SkillRangeModal(this.app, state.title || "当前书", { startAt, endAt: cfg?.end }, (s, e) => this.runAutoBook(story, flatMode, {
					startAt: s,
					endAt: e,
					premise,
					volumeCount: cfg?.volumes ?? 0,
					chapterCounts: cfg?.chapter_counts ?? [],
					flatTotalChapters: cfg?.chapters ?? 0,
					overwrite: cfg?.overwrite ?? false,
				})).open();
				return;
			}
			new Notice(`全自动建书配置缺少参数：${missing.join("、")}——请在弹窗补填后开始（补填结果会保存进《故事状态.md》）`, 10000);
			new AutoBookModal(
				this.app,
				flatMode,
				{
					startAt,
					endAt: cfg?.end,
					premise: premise || undefined,
					volumeCount: cfg?.volumes || undefined,
					chapterCounts: cfg?.chapter_counts?.length ? cfg.chapter_counts : undefined,
					flatTotalChapters: cfg?.chapters || undefined,
				},
				(input) => {
					// 补填即持久化：AutoBookInput（含 mode）直接透传为配置写回入参；失败不阻断开跑、只提示
					void this.saveAutoBookConfig(story, { ...input, mode: flatMode ? "flat" : "volumes" }).catch((e) => this.notifyError("补填配置保存到《故事状态.md》失败", e));
					return this.runAutoBook(story, flatMode, input);
				}
			).open();
		} catch (e) {
			this.notifyError("全自动写书启动失败", e);
		}
	}

	// ---------- /continue 续写当前章 ----------

	async cmdContinueWriting(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const state = await this.manager.validatedState(story);
			const currentKey = state.current_chapter ?? ""; // v0.0.15：复合键（"volId:N"/"N"）
			if (!currentKey) {
				new Notice("还没有章节，请先使用「创作章节 (/write)」创建");
				return;
			}
			const chapters = await this.manager.listChapters(story);
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const curLabel = this.keyLabel(currentKey, volNames);
			const chEntry = chapters.find((c) => c.key === currentKey) ?? null;
			const meta = state.chapters[currentKey] ?? null;
			if (!chEntry) {
				if (meta) {
					// 状态中存在但磁盘目录未定位：交给 /write 兜底（有大纲则按大纲自动创作）
					await this.cmdWrite();
					return;
				}
				new Notice(`${curLabel}不存在`);
				return;
			}
			const bodyOnDisk = await this.manager.readChapterContent(story, currentKey);
			if (!bodyOnDisk.trim()) {
				new Notice(`${curLabel}还没有正文内容，将从章节大纲开始创作…`, 6000);
				await this.cmdWrite();
				return;
			}
			const outlineOnDisk = await this.manager.readChapterOutlineForPrompt(story, currentKey);

			// 续写要点（Esc=取消；留空=按本卷与本章大纲自然续写）
			const rawInstr = await this.prompt("续写要点（可选）", "如：写主角与反派的正面对峙");
			if (rawInstr == null) return;
			const instruction = rawInstr.trim();

			// 大纲覆盖率检查：已有内容且全部要点已覆盖、无新指令 → 跳过
			if (outlineOnDisk && !instruction) {
				const cov = checkOutlineCoverage(bodyOnDisk, outlineOnDisk);
				if (cov.allCovered) {
					new Notice(`⚠ ${curLabel}大纲要点已全部完成，无需续写\n请给出新的写作纲要后再试`, 10000);
					return;
				}
			}

			// 先把指令并入大纲落盘（对齐 cmd_continue 预合并语义）
			let mergedForGen = outlineOnDisk;
			if (instruction) {
				mergedForGen = appendOutlineInstruction(outlineOnDisk, "续写要点", instruction);
				await this.manager.setChapterOutline(story, currentKey, mergedForGen);
				new Notice(`已更新${curLabel}大纲并保存`, 4000);
			}

			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			const data = await this.manager.loadWritingData(story, currentKey, { includeCurrentSummary: true });
			const docs = await this.assembleWritingDocGroups(story, data); // /continue：buildContinuePrompt 不注入大纲全文，本章大纲仍走上下文（skip=false）
			const stable: StableSink = {}; // v0.4.x+ 前缀缓存锚点
			const context = buildWritingContext({ ...data, ...docs }, stable);
			let prevRefs: Array<{ label: string; text?: string }> = [];
			try {
				prevRefs = (await this.manager.readOutlineWindow(story, currentKey, { back: 3 })).map((w) => ({ label: w.label, text: w.text || undefined }));
			} catch { /* 前文大纲窗口读取失败不阻断生成 */ }
			const wordRange = this.wordRangeOf(state);
			const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块
			const built = buildContinuePrompt({
				chapterNum: data.chapterNum, // v0.0.15：阅读序位置（ordinal，跨卷连续）
				chapterLabel: curLabel,
				chapterKey: currentKey,
				userInstruction: instruction || undefined,
				context,
				globalOutlineRaw: data.globalOutlineRaw,
				chapterOutlineRaw: mergedForGen,
				prevOutlines: prevRefs,
				descStyle: setup.descStyle,
				storyType: state.writing_style,
				currentSummary: data.summaries[data.chapterNum] ?? "",
				existingContent: bodyOnDisk,
				wordRange,
				withSummary: state.use_summaries !== false, // v0.2.21+：摘要随写（只覆盖新续写部分）
				tailChars: this.effectiveContinueTailChars(), // v0.4.6+ C9：末尾衔接窗口走设置项（缺省 1000）
			});

			const modal = await this.beginWritingPanel(`续写 ${this.keyLabel(currentKey, volNames, meta?.title || chEntry.title)}`, setup.cfg);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			let content = await this.streamWithEmptyRetry(
				setup.cfg,
				() => [
					{ role: "system" as const, content: sp },
					{ role: "user" as const, content: built.prompt },
				],
				modal,
				"续写",
				this.cachePin(built.prompt, context, stable.stableChars)
			);
			if (modal.signal.aborted) return;
			if (!content.trim()) return;

			// v0.2.21+：解析「正文＋<SUMMARY> 块」（只覆盖新续写部分；解析失败整段当正文，静默回落到延迟生成）
			let chapterSummary: string | null = null;
			if (state.use_summaries !== false) {
				const parsed = parseChapterWithSummary(content);
				chapterSummary = parsed.summary;
				content = parsed.body;
				if (!content.trim()) return; // 正文为空（如模型只输出了摘要块）→ 按生成失败处理
			}

			content = stripHeading(content); // 剥离 LLM 自带的章节标题，避免重复标题
			content = await this.autoCleanAi(setup.cfg, setup.systemPrompt, content, () => {
				modal.setStatus("正在去除 AI 常用词…");
			}, modal.signal, { context, stableChars: stable.stableChars }); // v0.4.3+ 带上本章的写作上下文前缀（本地端点复用同一份 K/V）
			if (modal.signal.aborted) { modal.markStopped(); new Notice("已停止生成，续写内容未保存", 6000); return; } // v0.4.x+ 去AI味阶段停止同样生效
			this.warnWordLimit(content, wordRange);
			this.warnChapterRefs(content); // v0.2.21+：只检测新续写部分（合并旧正文前）
			void this.warnSensitiveWords(content); // v0.4.6+：敏感词软提醒（零 LLM、非阻断）
			const newContent = bodyOnDisk.replace(/\s+$/, "") + "\n\n" + content;
			if (newContent !== modal.fullText) {
				modal.reset();
				modal.append(newContent);
			}
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（续写内容仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, currentKey, newContent); // v0.1.4+：摘要延迟到下次上下文组装时按需生成
			// v0.2.21+：同响应产出的摘要分别落盘（只覆盖新续写部分；失败不阻断，回落到延迟生成）
			if (chapterSummary) {
				try {
					await this.manager.saveChapterSummary(story, currentKey, chapterSummary);
				} catch { /* 摘要保存失败不阻断主流程 */ }
			}
			try {
				const f = await this.manager.chapterBodyFile(story, currentKey);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ 续写完成！\n新增字数：${String(countPureWords(content))}\n总字数：${String(words)}${chapterSummary ? "\n摘要：已随正文一并保存" : ""}`, 8000);
		} catch (e) {
			this.notifyError("续写失败", e);
		}
	}

	// ---------- /rewrite 重写本章 ----------

	async cmdRewriteChapter(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const num = await this.targetChapterKey(story, "重写"); // v0.0.15：复合键
			if (num == null) return;
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const chLabel = this.keyLabel(num, volNames);
			const bodyOnDisk = await this.manager.readChapterContent(story, num);
			if (!bodyOnDisk.trim()) {
				new Notice(`${chLabel}还没有内容，请先使用「创作章节 (/write)」`);
				return;
			}
			const rawInstr = await this.prompt("重写要求（可选）", '如："改为反派视角"、"增加反转"、"压缩节奏"');
			if (rawInstr == null) return;
			const instruction = rawInstr.trim();

			const state = await this.manager.validatedState(story);
			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			const data = await this.manager.loadWritingData(story, num, { includeCurrentSummary: true }); // 本章大纲是否注入由章级 specs 的 skip 控制（prompt_files 装配）
			const docs = await this.assembleWritingDocGroups(story, data, { skipChapterOutline: true }); // /rewrite：本章大纲经 bridge.cur 注入，上下文不重复
			const stable: StableSink = {}; // v0.4.x+ 前缀缓存锚点
			const context = buildWritingContext({ ...data, ...docs }, stable);
			let bridge: { prev?: { label: string; text?: string }; cur?: { label: string; text?: string }; nxt?: { label: string; text?: string } } = {};
			try {
				for (const w of await this.manager.readOutlineWindow(story, num, { back: 1, fwd: 1 })) {
					const ref = { label: w.label, text: w.text || undefined };
					if (w.key === num) bridge.cur = ref;
					else if (w.ordinal < data.chapterNum) bridge.prev = ref;
					else bridge.nxt = ref;
				}
			} catch { /* 大纲桥读取失败不阻断重写 */ }
			const wordRange = this.wordRangeOf(state);
			const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块
			const prompt = buildRewritePrompt({
				chapterNum: data.chapterNum, // v0.0.15：阅读序位置（ordinal，跨卷连续）
				chapterLabel: chLabel,
				userInstruction: instruction || undefined,
				context,
				bridge,
				oldContent: bodyOnDisk,
				currentSummary: data.summaries[data.chapterNum] ?? "",
				wordRange,
				storyType: state.writing_style,
				withSummary: state.use_summaries !== false, // v0.2.21+：摘要随写（覆盖重写后的整章）
			});

			const modal = await this.beginWritingPanel(`重写 ${chLabel}`, setup.cfg);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			let content = await this.streamWithEmptyRetry(
				setup.cfg,
				() => [
					{ role: "system" as const, content: sp },
					{ role: "user" as const, content: prompt },
				],
				modal,
				"重写",
				this.cachePin(prompt, context, stable.stableChars)
			);
			if (modal.signal.aborted) return;
			if (!content.trim()) {
				new Notice("✗ 重写结果为空", 8000);
				return;
			}
			// v0.2.21+：解析「正文＋<SUMMARY> 块」（覆盖重写后的整章；解析失败整段当正文，静默回落到延迟生成）
			let chapterSummary: string | null = null;
			if (state.use_summaries !== false) {
				const parsed = parseChapterWithSummary(content);
				chapterSummary = parsed.summary;
				content = parsed.body;
				if (!content.trim()) { new Notice("✗ 重写正文为空（仅输出摘要块）", 8000); return; } // 正文为空 → 按生成失败处理
			}
			content = await this.autoCleanAi(setup.cfg, setup.systemPrompt, content, () => {
				modal.setStatus("正在去除 AI 常用词…");
			}, modal.signal, { context, stableChars: stable.stableChars }); // v0.4.3+ 带上本章的写作上下文前缀（本地端点复用同一份 K/V）
			if (modal.signal.aborted) { modal.markStopped(); new Notice("已停止生成，重写内容未保存", 6000); return; } // v0.4.x+ 去AI味阶段停止同样生效
			this.warnChapterRefs(content); // v0.2.21+：重写整章均为新生成内容，直接检测（标题行在检测内豁免）
			void this.warnSensitiveWords(content); // v0.4.6+：敏感词软提醒（零 LLM、非阻断）
			if (content !== modal.fullText) {
				modal.reset();
				modal.append(content);
			}
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（重写结果仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, num, content); // 全量覆盖；v0.1.4+：摘要延迟到下次上下文组装时按需生成
			// v0.2.21+：同响应产出的摘要分别落盘（失败不阻断，回落到延迟生成）
			if (chapterSummary) {
				try {
					await this.manager.saveChapterSummary(story, num, chapterSummary);
				} catch { /* 摘要保存失败不阻断主流程 */ }
			}
			try {
				const f = await this.manager.chapterBodyFile(story, num);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ ${chLabel}已重写（${String(words)} 字）${chapterSummary ? "\n摘要：已随正文一并保存" : ""}`, 8000);
		} catch (e) {
			this.notifyError("重写章节失败", e);
		}
	}

	// ---------- /polish 润色当前章 ----------

	async cmdPolishText(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const state = await this.manager.validatedState(story);
			const currentKey = state.current_chapter ?? ""; // v0.0.15：复合键（"volId:N"/"N"）
			if (!currentKey) {
				new Notice("还没有章节，请先使用「创作章节 (/write)」创建");
				return;
			}
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const curLabel = this.keyLabel(currentKey, volNames);
			const bodyOnDisk = await this.manager.readChapterContent(story, currentKey);
			if (!bodyOnDisk.trim()) {
				new Notice(`${curLabel}还没有内容`);
				return;
			}
			const rawStyle = await this.prompt("润色风格（可选）", "如：更简洁有力、更有画面感");
			if (rawStyle == null) return; // Esc=取消
			const style = rawStyle.trim();

			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			const data = await this.manager.loadWritingData(story, currentKey, { includeCurrentSummary: true });
			const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块
			const prompt = buildPolishPrompt({
				text: bodyOnDisk,
				style: style || undefined,
				summary: data.summaries[data.chapterNum] ?? "",
				storyType: state.writing_style,
			});

			const modal = await this.beginWritingPanel(`润色 ${curLabel}`, setup.cfg);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			let content = await this.streamWithEmptyRetry(
				setup.cfg,
				() => [
					{ role: "system" as const, content: sp },
					{ role: "user" as const, content: prompt },
				],
				modal,
				"润色"
			);
			if (modal.signal.aborted) return;
			if (!content.trim()) {
				new Notice("✗ 润色结果为空", 8000);
				return;
			}
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（润色结果仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, currentKey, content); // 全量覆盖原章节；v0.1.4+：摘要延迟到下次上下文组装时按需生成
			try {
				const f = await this.manager.chapterBodyFile(story, currentKey);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ 已保存润色结果到${curLabel}（${String(words)} 字）`, 8000);
		} catch (e) {
			this.notifyError("润色失败", e);
		}
	}

	// ---------- /deai 去AI味 ----------

	async cmdDeaiClean(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const num = await this.targetChapterKey(story, "去除 AI 常用词"); // v0.0.15：复合键
			if (num == null) return;
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const chLabel = this.keyLabel(num, volNames);
			const bodyOnDisk = await this.manager.readChapterContent(story, num);
			if (!bodyOnDisk.trim()) {
				new Notice(`${chLabel}还没有内容`);
				return;
			}
			const data = await this.loadBannedWords();
			const hits = findAiWordHits(bodyOnDisk, data);
			if (!hits.length) {
				new Notice(`✓ ${chLabel}未检测到 AI 常用词`, 6000);
				return;
			}
			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）
			const baseSp = assembleSystemPrompt(undefined, setup.systemPrompt); // 去AI味用基础系统提示词

			const n = new Notice(`正在清洗${chLabel}的 AI 常用词（${String(hits.length)} 处）…\n逐句打回 LLM 重写，可能需要一点时间`);
			let cleaned: string;
			try {
				const r = await cleanAiText(
					bodyOnDisk,
					async (p, maxTokens) =>
						chatCompletion(setup.cfg, [
							{ role: "system" as const, content: baseSp },
							{ role: "user" as const, content: p },
						], { max_tokens: Math.min(maxTokens, setup.cfg.max_tokens ?? maxTokens) }),
					2,
					data
				);
				cleaned = r.text;
				this.notifyAiReport(r.report);
			} catch (e) {
				n.hide();
				this.notifyError("去AI味失败", e);
				return;
			}
			n.hide();

			if (!cleaned.trim()) {
				new Notice("✗ 清洗结果为空", 8000);
				return;
			}
			const modal = await this.beginWritingPanel(`去AI味结果 · ${chLabel}`, setup.cfg);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			modal.append(cleaned);
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（清洗结果仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, num, cleaned); // 全量覆盖；v0.1.4+：摘要延迟到下次上下文组装时按需生成
			try {
				const f = await this.manager.chapterBodyFile(story, num);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ ${chLabel}已更新（${String(words)} 字）`, 8000);
		} catch (e) {
			this.notifyError("去AI味失败", e);
		}
	}

	// ---------- /fix-refs 修复章节编号引用（v0.2.21+：手动检测「第N章」元引用并原位替换） ----------

	async cmdFixChapterRefs(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			// v0.2.x+：输入语义——留空=全书所有章节都检测修复（按阅读序逐章），填数字=只修指定章节（跨卷同号逐个确认）
			const raw = await this.prompt("修复章节编号引用", "输入章节号（留空=全部章节）", [
				"检测正文「第N章」类元引用，LLM 逐句改写后原位替换，全部改写完成后弹预览、确认后落盘（取消＝不落盘）：",
				"· 留空 —— 全书所有章节都检测修复（按阅读序逐章处理）",
				"· 填数字 —— 只修指定章节（如 3；跨卷同号会逐个确认）",
			].join("\n"));
			if (raw == null) return;
			const t = raw.trim();
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const all = await this.manager.listChapters(story); // 阅读序：书根在前 + 各卷按 order、组内本地号升序
			if (!all.length) { new Notice("还没有章节，请先创建章节", 8000); return; }
			let targets: Array<{ key: string; num: number; title: string }>;
			if (t === "") {
				targets = all; // 留空＝全书所有章节
			} else if (/^\d+$/.test(t)) {
				const ref = await this.resolveLocalNum(story, parseInt(t, 10), volNames); // 裸章号 → 具体容器（跨卷同号逐个确认）
				const hit = ref ? all.find((c) => c.key === chKey(ref.vol ?? null, ref.num)) : undefined;
				if (!hit) { new Notice(`第${t}章不存在`); return; }
				targets = [hit];
			} else {
				new Notice(`章节号无效：请输入数字或留空（收到「${raw}」）`, 6000);
				return;
			}

			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) {
				new Notice("未找到 LLM 配置\n请先在 Obsidian 设置里配置 ArticleWriter 的模型。", 8000);
				return;
			}
			const baseSp = assembleSystemPrompt(undefined, setup.systemPrompt); // 修复用基础系统提示词（全书共用一份）

			// v0.4.6+ 修 C6：先收集全部改写结果（不落盘）→ FixRefsReviewModal 预览「原句→改写句」→ 确认后才批量覆盖保存；取消/Esc 全部丢弃
			let fixedChapters = 0, cleanChapters = 0, emptyChapters = 0, notFixedChapters = 0, totalReplaced = 0, totalSkippedSent = 0;
			const pending: Array<{ key: string; label: string; text: string; pairs: Array<{ from: string; to: string }> }> = [];
			for (const ch of targets) {
				const chLabel = this.keyLabel(ch.key, volNames, ch.title);
				const bodyOnDisk = await this.manager.readChapterContent(story, ch.key);
				if (!bodyOnDisk.trim()) { emptyChapters++; continue; }
				const leaks = findChapterRefLeaks(bodyOnDisk);
				if (!leaks.length) { cleanChapters++; continue; }

				const n = new Notice(`正在修复${chLabel}的章节编号引用（${String(leaks.length)} 处）…\n逐句打回 LLM 重写，可能需要一点时间`);
				let fixed: string;
				let report: ChapterRefFixReport;
				try {
					const r = await fixChapterRefs(
						bodyOnDisk,
						async (p, maxTokens) =>
							chatCompletion(setup.cfg, [
								{ role: "system" as const, content: baseSp },
								{ role: "user" as const, content: p },
							], { max_tokens: Math.min(maxTokens, setup.cfg.max_tokens ?? maxTokens) })
					);
					fixed = r.text;
					report = r.report;
				} catch (e) {
					n.hide();
					this.notifyError("修复章节编号引用失败", e);
					return;
				}
				n.hide();

				if (!fixed.trim()) {
					notFixedChapters++;
					new Notice(`✗ ${chLabel}修复结果为空，跳过`, 8000);
					continue;
				}
				if (!report.replaced.length) {
					notFixedChapters++;
					totalSkippedSent += report.skipped.length;
					new Notice(`⏭ ${chLabel}的 ${String(leaks.length)} 处引用均未成功改写（${String(report.skipped.length)} 句跳过，原文保留）`, 10000);
					continue;
				}
				pending.push({
					key: ch.key,
					label: chLabel,
					text: fixed,
					pairs: report.replaced.map(([from, to]) => ({ from, to })),
				});
				totalReplaced += report.replaced.length;
				totalSkippedSent += report.skipped.length;
			}

			const summaryLines = (): string[] => {
				const l = [`章节编号引用修复结束：改写保存 ${String(fixedChapters)} 章`];
				if (cleanChapters) l.push(`无引用跳过 ${String(cleanChapters)} 章`);
				if (emptyChapters) l.push(`无正文跳过 ${String(emptyChapters)} 章`);
				if (notFixedChapters) l.push(`未成功 ${String(notFixedChapters)} 章`);
				if (totalReplaced) l.push(`共改写 ${String(totalReplaced)} 句`);
				if (totalSkippedSent) l.push(`${String(totalSkippedSent)} 句跳过保留原文`);
				return l;
			};

			if (!pending.length) {
				new Notice(summaryLines().join("\n"), 12000);
				return;
			}
			const approved = await new Promise<boolean>((resolve) => {
				new FixRefsReviewModal(
					this.app,
					"修复章节编号引用 — 落盘前预览",
					`即将改写 ${String(pending.length)} 章正文（共 ${String(totalReplaced)} 句）；确认后覆盖保存，取消＝全部不落盘。`,
					pending.map((p) => ({ label: p.label, pairs: p.pairs })),
					() => resolve(true),
					() => resolve(false)
				).open();
			});
			if (!approved) {
				new Notice("已取消：本次改写全部未落盘，正文未改动", 8000);
				return;
			}
			for (const p of pending) {
				await this.manager.setChapterBody(story, p.key, p.text); // v0.4.6+：预览确认后才覆盖保存；摘要仍延迟到下次上下文组装时按需生成
				fixedChapters++;
			}
			try {
				const f = await this.manager.chapterBodyFile(story, pending[pending.length - 1].key); // 与旧行为一致：收尾打开最后改写的一章
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(summaryLines().join("\n"), 12000); // v0.4.6+：汇总在落盘后取数——fixedChapters 此刻才是真实保存章数
		} catch (e) {
			this.notifyError("修复章节编号引用失败", e);
		}
	}

	// ---------- /export-ai-prompts 导出AI提示词 ----------

	/** 按代码内反引号最长串自动升级围栏，保证提示词原文（本身含 ``` ）能被完整包进代码块 */
	private fenceBlock(text: string): string {
		let fence = "```";
		while (text.includes(fence)) fence += "`";
		return `${fence}\n${text}\n${fence}`;
	}

	private exportPhaseName(phaseIndex: number): string {
		return WRITING_PHASE_LABELS[phaseIndex] ?? ""; // v0.3.4+：取共用常量（旧读 writing_phases[i].name，旧 data.json 残留「阶段1..4」致导出名漂移）
	}

	/** 导出文档的一节：模型配置来源（所属阶段映射 + cfg.name/model_name）、备注、system/user 提示词代码块 */
	private exportSection(
		title: string,
		cfg: LlmConfigDoc | null,
		phaseLabel: string, // 所属阶段名（exportPhaseName），各命令均按阶段映射取模型
		notes: string[],
		blocks: Array<{ heading: string; content: string }>
	): string {
		const lines: string[] = [`## ${title}`, ""];
		if (cfg) lines.push(`- 模型配置：${cfg.name}${cfg.model_name ? `（${cfg.model_name}）` : ""} —— 来自阶段「${phaseLabel}」映射`);
		for (const n of notes) lines.push(`- 备注：${n}`);
		if (blocks.length) lines.push("");
		for (const b of blocks) lines.push(`### ${b.heading}`, "", this.fenceBlock(b.content), "");
		return lines.join("\n");
	}

	private exportSkipSection(title: string, reason: string): string {
		return `## ${title}\n\n- 已跳过：${reason}\n`;
	}

	/** /export-ai-prompts：按当前小说磁盘数据实拼各 AI 命令的 system/user 提示词（与各 cmdXxx 同一构建函数与参数、弹窗输入取默认值），
	 * 按功能一文件存书根《AI提示词/》文件夹（含导出说明文件）供本地模型调试。全程不调用 LLM；现在不会触发 LLM 的阶段只写跳过原因。
	 * 增量链（卷大纲/AI拆分/analyze-cast/书级大纲续写）只导出首步提示词，依赖前一步输出的占位处用【】注明。 */
	async cmdExportPrompts(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			// 注意：以下标题是「选中→导出」的唯一匹配键，必须与 buildPromptExportDoc 里各 trySec("…") 的标题逐字节一致（含 · 等符号两侧空格）；任一处改动都要同步另一处，否则该功能点会被静默跳过。
			const features = [
				"创作章节 (/write)",
				"续写当前章 (/continue)",
				"重写当前章 (/rewrite)",
				"润色当前章 (/polish)",
				"去AI化当前章 (/deai)",
				"修正章节引用 (/fix-refs)",
				"错别字检测 (/typo)",
				"审阅当前章 (/review)",
				"生成世界观 (/worldview-generate)",
				"生成时间线 (/timeline-generate)",
				"生成策划指南（仅世界观） (/planning-guide-worldview)",
				"生成书籍大纲 (/book-outline-generate)",
				"自动生成卷大纲 (/vol-outline-generate)",
				"从书级大纲生成卷 (/book-outline-to-volumes)",
				"从卷大纲生成章节·AI 拆分兜底 (/vol-outline-to-chapters)",
				"分析人物与场景 (/analyze-cast)",
				"章节摘要（上下文组装时延迟生成）",
				"卷摘要（上下文组装时延迟整体重建）",
			];
			const selected = await new Promise<string[] | null>((resolve) => {
				new ExportPromptsSelectModal(
					this.app,
					features.map((t) => ({ title: t })),
					(sel) => resolve(sel),
					() => resolve(null)
				).open();
			});
			if (!selected) return;
			const entries = await this.buildPromptExportDoc(story, selected);
			await this.manager.savePromptExportDocs(story, entries);
			const paths = entries.map((e) => e.path).join("、");
			new Notice(`✓ AI 提示词已导出（${String(entries.length)} 个文件）\n${paths}\n可逐个复制 system/user 内容喂给本地模型比对输出`, 10000);
		} catch (e) {
			this.notifyError("导出AI提示词失败", e);
		}
	}

	private async buildPromptExportDoc(story: string, selectedFeatures?: string[]): Promise<Array<{ title: string; content: string; path: string }>> {
		const state = await this.manager.validatedState(story);
		const volNames = await this.volNameMap(story);
		const chapters = await this.manager.listChapters(story);
		const flatMode = state.use_volumes === false;
		const defaultCount = Math.max(chapters.length, 1); // 章数弹窗的导出默认值（实际运行时弹窗输入）
		const activeKey = (state.current_chapter ?? "").trim();
		const chLabel = activeKey ? this.keyLabel(activeKey, volNames) : "";
		const bodyOf = activeKey ? await this.manager.readChapterContent(story, activeKey) : "";
		const outlineOf = activeKey ? await this.manager.readChapterOutlineForPrompt(story, activeKey) : "";

		const entries: Array<{ title: string; content: string }> = [];
		const selectedSet = selectedFeatures ? new Set(selectedFeatures) : null;
		const trySec = async (title: string, fn: () => Promise<string>): Promise<void> => {
			if (selectedSet && !selectedSet.has(title)) return; // 未选中则跳过（不写入任何条目）
			try {
				entries.push({ title, content: await fn() });
			} catch (e) {
				entries.push({ title, content: this.exportSkipSection(title, `组装失败：${e instanceof Error ? e.message : String(e)}`) });
			}
		};
		const noChapter = activeKey ? null : "写字台没有当前激活章节（/write 等命令基于它定位目标章）";
		const phaseName = (i: number): string => this.exportPhaseName(i);

		const volsRec = flatMode ? {} : await this.manager.loadVolumes(story);
		const vols = Object.values(volsRec).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
		const noLlm = (title: string): string => this.exportSkipSection(title, "该阶段未找到可用 LLM 配置（无配置时所有 AI 步骤都不会调用模型）。");
		// v0.2.23+：导出全程不触发摘要的 LLM 生成——组装写作上下文时已存新鲜摘要照放，缺失处填此占位符明示「此处有摘要、尚未生成」（卷摘要槽位与运行时一致：无成员章摘要的卷运行时也跳过、不占槽，故不填）
		const summaryPlaceholder = "（此处有摘要，尚未生成）";
		const bridgeOf = async (key: string, ordinal: number): Promise<{ prev?: { label: string; text?: string }; cur?: { label: string; text?: string }; nxt?: { label: string; text?: string } }> => {
			const bridge: { prev?: { label: string; text?: string }; cur?: { label: string; text?: string }; nxt?: { label: string; text?: string } } = {};
			try {
				for (const w of await this.manager.readOutlineWindow(story, key, { back: 1, fwd: 1 })) {
					const entry = { label: w.label, text: w.text || undefined };
					if (w.key === key) bridge.cur = entry;
					else if (w.ordinal < ordinal) bridge.prev = entry;
					else bridge.nxt = entry;
				}
			} catch { /* 桥接大纲读取失败：按空处理（与运行时一致） */ }
			return bridge;
		};

		// ===== 章域 =====
		// 注意：下面每个 trySec("…") 的标题是「选中→导出」的匹配键，必须与 cmdExportPrompts 里 features 清单逐字节一致；改动任一处都要同步另一处，否则该功能点被静默跳过。
		await trySec("创作章节 (/write)", async () => {
			const title = "创作章节 (/write)";
			if (noChapter) return this.exportSkipSection(title, noChapter);
			const hasBody = bodyOf.trim().length > 0; // v0.2.23+：激活章已有正文也照常组装导出（节内备注运行时不会触发）——调试 /write 提示词不必先切到空章
			if (!outlineOf.trim()) return this.exportSkipSection(title, "当前章没有《章节大纲.md》内容，且导出按弹窗默认值（不代填「章节大纲」「写作要点」）——两者皆空时 /write 只创建/就绪章节，不调用 LLM。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING);
			if (!setup) return noLlm(title);
			const data = await this.manager.loadWritingData(story, activeKey, { includeCurrentSummary: false, ensureSummaries: false, missingSummaryPlaceholder: summaryPlaceholder }); // v0.2.23+：只读导出——不触发摘要 LLM 生成，缺失处填占位符
			const docs = await this.assembleWritingDocGroups(story, data, { skipChapterOutline: true }); // /write 预览：与运行时同口径（大纲经 buildChapterPrompt 注入）
			const context = buildWritingContext({ ...data, ...docs });
			let prevRefs: Array<{ label: string; text?: string }> = [];
			try {
				prevRefs = (await this.manager.readOutlineWindow(story, activeKey, { back: 3 })).map((w) => ({ label: w.label, text: w.text || undefined }));
			} catch { /* 前文大纲窗口读取失败：按空处理（与运行时一致） */ }
			const built = buildChapterPrompt({
				chapterNum: data.chapterNum,
				chapterLabel: chLabel,
				chapterKey: activeKey,
				chapterOutlineRaw: outlineOf.trim(),
				userInstruction: undefined,
				context,
				wordRange: this.wordRangeOf(state),
				descStyle: setup.descStyle,
				storyType: state.writing_style,
				taskSkillBlock: (await this.loadSelectedTaskSkill()) || undefined,
				prevOutlines: prevRefs,
				withSummary: state.use_summaries !== false,
			});
			const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), [
				...(hasBody ? ["当前激活章已有正文：运行时 /write 此时不会触发（要接着写用 /continue，整章重写用 /rewrite）；此处导出的是假设触发时实发的提示词。"] : []),
				"弹窗取默认值：新建标题（沿用现有章）、章节大纲（留空=用盘上《章节大纲.md》）、写作要点（留空）。",
			], [
				{ heading: "系统提示词（system）", content: sp },
				{ heading: "用户提示词（user）", content: built.prompt },
			]);
		});
		await trySec("续写当前章 (/continue)", async () => {
			const title = "续写当前章 (/continue)";
			if (noChapter) return this.exportSkipSection(title, noChapter);
			if (!bodyOf.trim()) return this.exportSkipSection(title, "当前激活章还没有正文，/continue 不适用（先用 /write 创作）。");
			if (outlineOf.trim() && checkOutlineCoverage(bodyOf, outlineOf).allCovered) return this.exportSkipSection(title, "盘上《章节大纲.md》的要点已被现有正文全部覆盖，且导出按弹窗默认（续写要点留空）——运行时此时提示「大纲要点已全部完成」，不调用 LLM。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING);
			if (!setup) return noLlm(title);
			const data = await this.manager.loadWritingData(story, activeKey, { includeCurrentSummary: true, ensureSummaries: false, missingSummaryPlaceholder: summaryPlaceholder }); // v0.2.23+：只读导出——不触发摘要 LLM 生成，缺失处填占位符
			const docs = await this.assembleWritingDocGroups(story, data); // /continue 预览：与运行时同口径（大纲不走上下文重复注入＝false）
			const context = buildWritingContext({ ...data, ...docs });
			let prevRefs: Array<{ label: string; text?: string }> = [];
			try {
				prevRefs = (await this.manager.readOutlineWindow(story, activeKey, { back: 3 })).map((w) => ({ label: w.label, text: w.text || undefined }));
			} catch { /* 前文大纲窗口读取失败：按空处理（与运行时一致） */ }
			const built = buildContinuePrompt({
				chapterNum: data.chapterNum, // 阅读序位置（ordinal，跨卷连续）
				chapterLabel: chLabel,
				chapterKey: activeKey,
				userInstruction: undefined,
				context,
				globalOutlineRaw: data.globalOutlineRaw,
				chapterOutlineRaw: outlineOf, // 续写要点为空 → 不做预合并，直接用盘上大纲
				prevOutlines: prevRefs,
				descStyle: setup.descStyle,
				storyType: state.writing_style,
				currentSummary: data.summaries[data.chapterNum] ?? "",
				existingContent: bodyOf,
				wordRange: this.wordRangeOf(state),
				withSummary: state.use_summaries !== false,
				tailChars: this.effectiveContinueTailChars(), // v0.4.6+ C9：与运行时同一设置口径（导出提示词一致性）
			});
			const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), ["「续写要点」弹窗取默认值（留空）。留空且有大纲时先做要点覆盖率检查（见上）；有指令时会先把指令并入大纲落盘再拼提示词。", "响应约定：正文＋<SUMMARY> 块（摘要随写只覆盖新续写部分），解析失败整段当正文。"], [
				{ heading: "系统提示词（system）", content: sp },
				{ heading: "用户提示词（user）", content: built.prompt },
			]);
		});
		await trySec("重写当前章 (/rewrite)", async () => {
			const title = "重写当前章 (/rewrite)";
			if (noChapter) return this.exportSkipSection(title, noChapter);
			if (!bodyOf.trim()) return this.exportSkipSection(title, "当前激活章还没有正文，/rewrite 提示「还没有内容」，不调用 LLM。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING);
			if (!setup) return noLlm(title);
			const data = await this.manager.loadWritingData(story, activeKey, { includeCurrentSummary: true, ensureSummaries: false, missingSummaryPlaceholder: summaryPlaceholder }); // v0.2.23+：只读导出——不触发摘要 LLM 生成，缺失处填占位符；本章大纲是否注入由章级 specs 的 skip 控制（prompt_files 装配）
			const docs = await this.assembleWritingDocGroups(story, data, { skipChapterOutline: true }); // /rewrite 预览：与运行时同口径（大纲经 bridge.cur 注入）
			const context = buildWritingContext({ ...data, ...docs });
			const bridge = await bridgeOf(activeKey, data.chapterNum);
			const prompt = buildRewritePrompt({
				chapterNum: data.chapterNum,
				chapterLabel: chLabel,
				userInstruction: undefined,
				context,
				bridge,
				oldContent: bodyOf,
				currentSummary: data.summaries[data.chapterNum] ?? "",
				wordRange: this.wordRangeOf(state),
				storyType: state.writing_style,
				withSummary: state.use_summaries !== false,
			});
			const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), ["「重写要求」弹窗取默认值（留空）。运行时会弹「覆盖整章/仅参考」保存选择，不影响提示词。", "响应约定：正文＋<SUMMARY> 块（摘要覆盖重写后的整章）。"], [
				{ heading: "系统提示词（system）", content: sp },
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		await trySec("润色当前章 (/polish)", async () => {
			const title = "润色当前章 (/polish)";
			if (noChapter) return this.exportSkipSection(title, noChapter);
			if (!bodyOf.trim()) return this.exportSkipSection(title, "当前激活章还没有内容，/polish 不调用 LLM。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING);
			if (!setup) return noLlm(title);
			const data = await this.manager.loadWritingData(story, activeKey, { includeCurrentSummary: true, ensureSummaries: false, missingSummaryPlaceholder: summaryPlaceholder }); // v0.2.23+：只读导出——不触发摘要 LLM 生成，缺失处填占位符
			const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块
			const prompt = buildPolishPrompt({ text: bodyOf, style: undefined, summary: data.summaries[data.chapterNum] ?? "", storyType: state.writing_style });
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), ["「润色风格」弹窗取默认值（留空=由模型自行判断风格）。结果面板确认后才覆盖保存；摘要延迟到下次上下文组装时生成。"], [
				{ heading: "系统提示词（system）", content: sp },
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		await trySec("去AI化当前章 (/deai)", async () => {
			const title = "去AI化当前章 (/deai)";
			if (noChapter) return this.exportSkipSection(title, noChapter);
			if (!bodyOf.trim()) return this.exportSkipSection(title, "当前激活章还没有正文，/deai 不调用 LLM。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING);
			if (!setup) return noLlm(title);
			// 与 cleanAiText 相同的预处理链：先本地化简（否定对比、强调重复），再找 AI 句
			let current = bodyOf;
			const [simp1, simPairs] = simplifyNegationContrast(current);
			if (simPairs.length) current = simp1;
			const [merged, repPairs] = simplifyEmphaticRepetition(current);
			if (repPairs.length) current = merged;
			const data = await this.loadBannedWords();
			const sentences = findAiSentences(current, data);
			if (!sentences.length) return this.exportSkipSection(title, "词表与正则均未命中（本地化简后仍无 AI 句式），/deai 不调用 LLM。导出的提示词以当前章正文为基准。");
			const prompt = buildDeaiPrompt(current, sentences);
			const maxTokens = Math.min(8192, sentences.length * 300 + 1024);
			const runtimeMax = Math.min(maxTokens, setup.cfg.max_tokens ?? maxTokens); // 运行时受配置 max_tokens 封顶
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), [
				`命中 ${String(sentences.length)} 句；每轮 max_tokens = min(8192, 句数×300+1024) 再受配置 max_tokens 封顶 → 本次=${String(runtimeMax)}。最多 2 轮：第 2 轮的输入取决于第 1 轮的改写结果，无法预先拼出。`,
				"响应约定：每行「序号|改写后句子」，解析后按句号回写；改不动的行保留原句。",
				simPairs.length || repPairs.length ? "正文已先经本地化简（否定对比/强调重复规则），非原始盘上文本。" : "",
			].filter(Boolean), [
				{ heading: "系统提示词（system）", content: assembleSystemPrompt(undefined, setup.systemPrompt) },
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		await trySec("修正章节引用 (/fix-refs)", async () => {
			const title = "修正章节引用 (/fix-refs)";
			const hits: string[] = [];
			for (const ch of chapters) {
				const b = await this.manager.readChapterContent(story, ch.key);
				if (b.trim() && findChapterRefLeaks(b).length) hits.push(ch.key);
			}
			if (!hits.length) return this.exportSkipSection(title, "全部章节正文均未命中「第N章」式引用（/fix-refs 先本地扫描，无命中不调 LLM）。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING);
			if (!setup) return noLlm(title);
			const first = hits[0];
			const content = await this.manager.readChapterContent(story, first);
			const sentences = findChapterRefSentences(content);
			const prompt = buildChapterRefFixPrompt(content, sentences);
			const maxTokens = Math.min(8192, sentences.length * 300 + 1024);
			const runtimeMax = Math.min(maxTokens, setup.cfg.max_tokens ?? maxTokens);
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), [
				`运行时会逐章处理全部 ${String(hits.length)} 个命中章节；导出只给阅读序第一个命中的 ${this.keyLabel(first, volNames)}。`,
				`max_tokens = min(8192, 句数×300+1024) 受配置封顶 → 本次=${String(runtimeMax)}。最多 2 轮，第 2 轮依赖第 1 轮改写结果。`,
				"响应约定：每行「序号|改写后句子」；改写后仍含「第N章」的行会被跳过保留。",
			], [
				{ heading: "系统提示词（system）", content: assembleSystemPrompt(undefined, setup.systemPrompt) },
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		await trySec("错别字检测 (/typo)", async () => {
			const title = "错别字检测 (/typo)";
			if (noChapter) return this.exportSkipSection(title, noChapter);
			if (!bodyOf.trim()) return this.exportSkipSection(title, "当前激活章还没有正文，/typo 不调用 LLM。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING);
			if (!setup) return noLlm(title);
			const prompt = buildTypoScanPrompt(bodyOf);
			const budget = Math.max(setup.cfg.max_tokens ?? 65535, Math.ceil(bodyOf.length * 2) + 1024); // 需要全文回显 → 预算按正文长度放大
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), [
				`模型需原样回显全文并内联 〇…〇 标记；max_tokens=${String(budget)}（max(配置值, 正文长度×2+1024)）。校验失败整次重试，最多 3 次、输入相同。`,
				"响应约定：JSON 数组 [{wrong,right?,context?}] 在首个 '{' 处截断；正文取最后一个 JSON 块之后的文本。",
			], [
				{ heading: "系统提示词（system）", content: this.promptSkill("错别字检测", TYPO_SCAN_SYSTEM_PROMPT) },
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		await trySec("审阅当前章 (/review)", async () => {
			const title = "审阅当前章 (/review)";
			if (noChapter) return this.exportSkipSection(title, noChapter);
			if (!bodyOf.trim()) return this.exportSkipSection(title, "当前激活章还没有正文，/review 不调用 LLM。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) return noLlm(title);
			const data = await this.manager.loadWritingData(story, activeKey, { includeCurrentSummary: false, ensureSummaries: false, missingSummaryPlaceholder: summaryPlaceholder }); // v0.2.23+：只读导出——不触发摘要 LLM 生成，缺失处填占位符
			const docs = await this.assembleWritingDocGroups(story, data, { skipChapterOutline: true }); // /review 预览：与运行时同口径（大纲经 bridge.cur 注入）
			const context = buildWritingContext({ ...data, ...docs });
			const bridge = await bridgeOf(activeKey, data.chapterNum);
			const prompt = buildReviewPrompt({
				chapterNum: data.chapterNum,
				chapterLabel: chLabel,
				userInstruction: undefined,
				context,
				bridge,
				chapterContent: bodyOf,
			});
			const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块；v0.3.6+：禁用词注入块已移除，审阅报告路径与正文路径注入一致（阶段 4 技能块）
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), [
				"「审阅重点」弹窗取默认值（留空）。报告为空时重试，最多 3 次、输入相同。",
				"审阅走阶段映射（阶段 4 编写文章），不受全局激活态/对话框模型影响。",
			], [
				{ heading: "系统提示词（system）", content: sp },
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		// ===== 大纲域 =====
		await trySec("生成世界观 (/worldview-generate)", async () => {
			const title = "生成世界观 (/worldview-generate)";
			const setup = this.getPhaseLlmSetup(PHASE_WORLDVIEW); // 与运行时同阶段（阶段 0 世界观生成）
			if (!setup) return noLlm(title);
			const premise = (state.one_line ?? "").trim(); // 运行时为空会弹窗补问；导出按盘上现状（空则占位符注明）
			const pairs: Array<{ key: string; spec: PromptSpec }> = [
				{ key: "book_info", spec: { text: bookInfoText(state.title, state.genre, state.writing_style), header: HDR_BOOK_INFO } },
			];
			const input: WorldviewGenInput = { bookTitle: state.title, premise: premise || "（state.one_line 为空：运行时弹窗补问一句话设定）", contextDocs: (await assemblePromptFiles(this.promptReader(), this.orderRefDocSpecs(pairs, this.phaseRefDocKeys(PHASE_WORLDVIEW), { bookSkillDir: this.bookSkillsDir(story), bookSkillNames: await this.phaseBookSkillNames(story, PHASE_WORLDVIEW) }))).text }; // v0.3.4+：导出与运行时同口径（书籍技能追加注入；v0.3.7+ 世界观生成独立阶段）
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WORLDVIEW), [
				"该命令走阶段映射（阶段 0 世界观生成），不受全局激活态/对话框模型影响；auto-book 流水线首阶段，亦可单独运行。",
				"上下文＝书籍信息＋引用清单里的技能条目（默认含张力工具箱、世界观生成框架），按阶段 0 配置框过滤；目标文档《案头资料/世界观.md》自身不注入。",
				"一句话设定取 state.one_line（弹窗输入后持久化）；本导出按盘上现状装配。",
			], [
				{ heading: "系统提示词（system）", content: assembleSystemPrompt() }, // 与实际调用点一致：同回落 DEFAULT_SYSTEM_PROMPT
				{ heading: "用户提示词（user）", content: buildWorldviewGenPrompt(input) },
			]);
		});
		await trySec("生成时间线 (/timeline-generate)", async () => {
			const title = "生成时间线 (/timeline-generate)";
			const setup = this.getPhaseLlmSetup(PHASE_PLANNING); // v0.3.3+：与策划指南同用阶段 1 映射
			if (!setup) return noLlm(title);
			const input = await this.buildTimelineInput(story, state);
			const prompt = buildTimelineGenPrompt(input);
			return this.exportSection(title, setup.cfg, phaseName(PHASE_PLANNING), [
				"独立命令 /timeline-generate：以书籍信息＋张力工具箱技能＋世界观为上下文单独流式生成书级《案头资料/时间线.md》；已有有效时间点条目时先弹「重新生成覆盖/取消」确认。同一提示词也用于策划指南前置自动生成（自动路径或 /planning-guide-worldview 时若书级《时间线.md》无有效时间点条目，先用本提示词流式生成并落盘再继续生成策划指南；已有有效条目则跳过生成，该自动路径仅当阶段 1 引用文档清单含「时间线」时生效）。",
				"输出＝时间线面板的事件格式：标题块「时间点 事件名」＋「- 人物：」「- 事件：」「- 详情：」「- 影响：」「- 关联：」字段行（人物/事件/详情/影响 必备、无「- 完成：」行），经 timelineGenFormatOk 校验后由 setBookTimeline 原样保存到书级《案头资料/时间线.md》；不合规带纠错注记重生成一次。",
				"生成上下文固定为张力工具箱技能＋世界观（不受配置框过滤）；策划指南提示词的【时间线】块按三层《时间线.md》合并时间轴装配（书级→未归卷章节→各卷及其章节，保留各文档层级与先后次序），按清单位置注入（默认排世界观之后），并驱动其「二、大事件序列」以时间线的时间点与事件为基础展开。",
			], [
				{ heading: "系统提示词（system）", content: assembleSystemPrompt(undefined, this.promptSkill("时间线生成", TIMELINE_GEN_SYSTEM_PROMPT)) },
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		await trySec("生成策划指南（仅世界观） (/planning-guide-worldview)", async () => {
			const title = "生成策划指南（仅世界观） (/planning-guide-worldview)";
			const setup = this.getPhaseLlmSetup(PHASE_PLANNING); // v0.2.22+：策划方案生成阶段
			if (!setup) return noLlm(title);
			const volCount = state.use_volumes === false ? undefined : Object.keys(await this.manager.loadVolumes(story)).length || undefined; // 预览不弹窗：按现有卷数展示按卷组织要求
			const input = await this.buildPlanningGuideInput(story, state, { worldOnly: true, volumeCount: volCount }); // 与运行时同口径：不注入现有《策划指南》本身（目标文档不进生成提示词）
			const prompt = buildPlanningGuidePrompt(input);
			return this.exportSection(title, setup.cfg, phaseName(PHASE_PLANNING), [
				"该命令走阶段映射（阶段 1 策划方案生成），不受全局激活态/对话框模型影响。",
				"输入仅书籍信息＋世界观（不含大纲/卷）；引用文档按阶段 1 配置框过滤。",
				"运行时前置：阶段 1 清单含「时间线」且书级《时间线.md》无有效条目时，先自动生成该书级文档再继续本命令（本预览按盘上现状装配——三层《时间线.md》有有效条目即已带【时间线】合并时间轴块）。",
				"分卷模式运行时先弹「卷数量」（预填现有卷数），《策划指南》按卷组织、标明卷序号与卷名；取消＝按需分卷（通常 1–5 卷，仍按卷组织）。本预览按现有卷数展示该要求行。",
				"无卷模式（《故事状态.md》use_volumes=false）：不弹卷数量，且首轮与截断续写 prompt 一律附带禁卷强提示——《策划指南》不得输出「第X卷/卷名/分卷规划」等分卷信息（v0.4.x+，防无卷书策划结果混入分卷内容）。",
			], [
				{ heading: "系统提示词（system）", content: assembleSystemPrompt(undefined, BOOK_OUTLINE_GEN_SYSTEM_PROMPT) }, // v0.2.24+：与运行时同口径
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		await trySec("生成书籍大纲 (/book-outline-generate)", async () => {
			const title = "生成书籍大纲 (/book-outline-generate)";
			const setup = this.getPhaseLlmSetup(PHASE_OUTLINE);
			if (!setup) return noLlm(title);
			const existing = await this.manager.readGlobalOutline(story); // 清洗文本：模板注释视为空
			const relationshipVol = !flatMode ? (state.current_volume ? this.manager.findVolumeIn(volsRec, state.current_volume) : vols[0] ?? null) : null;
			const assembled = await this.assembleVolOutlineContext(story, state, relationshipVol ?? { id: "", name: "" }, { // 与运行时同一 helper 装配；张力规则同口径（读书内「案头资料/张力规则.md」，缺失先播种并回落内置默认）
				strict: true,
				noVolRel: flatMode,
				noTargetMark: true,
				volumes: vols.map((v) => ({ name: v.name, description: v.description })),
			});
			const prompt = buildBookOutlineGenPrompt({
				flatMode,
				chapterCount: flatMode ? defaultCount : 0, // 有卷模式卷级规划不含章号（与运行时同口径传 0）
				volumeCount: flatMode ? undefined : (vols.length || defaultCount), // 有卷模式导出基准＝现有卷数（运行时弹窗预填值），无卷回落 defaultCount
				hasVolumes: hasCtxBlock(assembled, HDR_VOL_LIST),
				hasPlanningGuide: hasCtxBlock(assembled, HDR_PLANNING),
				hasBookRelationships: hasCtxBlock(assembled, HDR_BOOK_REL),
				hasVolRelationships: hasCtxBlock(assembled, HDR_VOL_REL),
				contextDocs: assembled.text,
			});
			return this.exportSection(title, setup.cfg, phaseName(PHASE_OUTLINE), [
				`数量弹窗按模式分流：平铺问目标章数（导出基准 ${String(defaultCount)}）、有卷问卷数量（导出基准＝现有卷数 ${String(vols.length || defaultCount)}，运行时预填现有卷数）。`,
				existing.trim() ? "书级《大纲.md》已存在：运行时先弹「完整生成 / 按已有进度继续」——本导出是「完整生成」形态；继续模式（按卷续写 / 平铺逐章续写）提示词形态不同，未导出。现有大纲本身不注入生成提示词（目标文档不进生成提示词）；已有章节+摘要也不注入——生成只依据世界观＋策划指南等既定事实。" : "书级《大纲.md》为空：直接完整生成。",
				"《策划指南.md》按盘上现状注入；运行时缺失会先自动生成再拼提示词（软依赖）。",
			], [
				{ heading: "系统提示词（system）", content: assembleSystemPrompt(undefined, BOOK_OUTLINE_GEN_SYSTEM_PROMPT) }, // v0.2.24+：与运行时同口径
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		await trySec("自动生成卷大纲 (/vol-outline-generate)", async () => {
			const title = "自动生成卷大纲 (/vol-outline-generate)";
			if (flatMode) return this.exportSkipSection(title, "无卷模式没有卷大纲。");
			if (!vols.length) return this.exportSkipSection(title, "还没有卷：运行时若书级《大纲.md》含卷声明会走「自动建卷+逐卷生成」批量流程（autoCreateVolumesAndGenOutlines），否则提示先建卷——两种形态都不按单卷弹窗导出。");
			const setup = this.getPhaseLlmSetup(PHASE_OUTLINE);
			if (!setup) return noLlm(title);
			const curVol = (state.current_volume ?? "").trim();
			const vol = (curVol ? this.manager.findVolumeIn(volsRec, curVol) : null) ?? vols[0];
			const volIdx = vols.findIndex((v) => v.id === vol.id);
			const prevOutline = volIdx > 0 ? await this.manager.readVolumeOutline(story, vols[volIdx - 1].id) : "";
			const existing = await this.manager.readVolumeOutline(story, vol.id);
			const assembled = await this.assembleVolOutlineContext(story, state, vol, { volumes: vols.map((v) => ({ name: v.name, description: v.description })), prevOutline }); // 与运行时同一 helper 装配；张力规则同口径（读书内「案头资料/张力规则.md」，缺失先播种并回落内置默认）
			const ctx: VolOutlineGenInput = {
				targetVolumeName: vol.name,
				chapterCount: defaultCount,
				hasPlanningGuide: hasCtxBlock(assembled, HDR_PLANNING), // v0.2.25+ 与运行时同口径：【策划规范】措辞按块实际存在门控
				contextDocs: assembled.text,
			};
			return this.exportSection(title, setup.cfg, phaseName(PHASE_OUTLINE), [
				curVol ? `目标卷=当前卷「${vol.name}」。` : `当前卷未设定：运行时会弹卷选择器；导出取第一卷「${vol.name}」。`,
				`目标章数弹窗取默认值 ${String(defaultCount)}（运行时弹窗无默认值，此为导出基准）。`,
				"完整生成分段增量：【卷设计】1 段 + 每章 1 小段，逐段生成立即落盘。本导出只给首步（卷设计）与第二步（第1章，卷设计处为占位符）；后续章输入含「本轮已生成章段」，依赖前一步输出，无法预先拼出。",
				existing.trim() ? "本卷《卷大纲.md》已存在：运行时先弹「完整生成 / 按已有进度继续」、再弹「覆盖 / 追加」保存选择——本导出是「完整生成」形态；继续模式无卷设计步、supplementMode 提示词形态不同，未导出。现有卷大纲本身不注入生成提示词（目标文档不进生成提示词）；已有章节也不注入——生成只依据世界观＋策划指南等既定事实。" : "",
				state.ai_outline_cast === false
					? "人物/关系抽取已关闭（ai_outline_cast=false）：章段提示词不追加附录要求，也不写《人物.md》《人物关系.md》。"
					: `章段（第2步起）用户提示词末尾追加【人物与关系附录（硬性要求，必须输出）】：正文后输出分隔行 ${OUTLINE_CAST_APPENDIX_MARK} + 严格 JSON（characters/relationships），代码剥离附录、正文照常落盘，随后按出现范围逐章分层写入书/卷/章《人物.md》《人物关系.md》（ai_outline_cast 缺省＝开）。已知规范人名随本轮已抽取条目累加，导出只含盘上现有条目播种的初始列表。`,
			].filter(Boolean), [
				{ heading: "系统提示词（system）", content: assembleSystemPrompt(undefined, this.promptSkill("卷大纲生成", VOL_OUTLINE_GEN_SYSTEM_PROMPT)) }, // v0.2.24+：与运行时同口径
				{ heading: "第1步 · 卷设计（user）", content: buildVolOutlineDesignPrompt(ctx) },
				{
					heading: "第2步 · 第1章（user，卷设计为占位符）",
					content:
						buildVolOutlineChapterPrompt({ ...ctx, chapterNum: 1, volumeDesign: "（占位：上一步【卷设计】完整输出）", generatedSoFar: "" }) +
						(state.ai_outline_cast === false ? "" : `\n\n${outlineCastAppendixInstruction([])}`),
				},
			]);
		});
		await trySec("从书级大纲生成卷 (/book-outline-to-volumes)", async () => {
			return this.exportSkipSection("从书级大纲生成卷 (/book-outline-to-volumes)", "该命令是对书级《大纲.md》每条卷声明自动建卷并逐卷生成卷大纲的批量流程（autoCreateVolumesAndGenOutlines）；每卷的提示词与上面「自动生成卷大纲」同形态（上下文按各卷替换），不另出不带弹窗上下文的重复段。");
		});
		await trySec("从卷大纲生成章节·AI 拆分兜底 (/vol-outline-to-chapters)", async () => {
			const title = "从卷大纲生成章节·AI 拆分兜底 (/vol-outline-to-chapters)";
			let vol: { id: string; name: string };
			let raw: string;
			let sourceLabel: string;
			if (flatMode) {
				vol = { id: "", name: "书级大纲" };
				sourceLabel = "书级《大纲.md》";
				raw = await this.manager.readGlobalOutline(story);
			} else {
				if (!vols.length) return this.exportSkipSection(title, "还没有卷，命令直接提示先新建卷。");
				const curVol = (state.current_volume ?? "").trim();
				const v = (curVol ? this.manager.findVolumeIn(volsRec, curVol) : null) ?? vols[0];
				vol = v;
				sourceLabel = `「${v.name}」的卷大纲`;
				raw = await this.manager.readVolumeOutline(story, v.id);
			}
			if (!raw.trim()) return this.exportSkipSection(title, `${sourceLabel}为空，命令提示先写大纲，不调 LLM。`);
			if (splitVolOutlineByChapter(raw).segments.length) return this.exportSkipSection(title, `${sourceLabel}已含「## 第N章」章标记：运行时直接本地解析拆分并落盘各章，不调用 LLM（AI 拆分兜底不触发）。`);
			const setup = this.getPhaseLlmSetup(PHASE_CHAPTER_OUTLINE); // v0.2.22+：文章大纲生成阶段（卷/书大纲拆分为章节大纲）
			if (!setup) return noLlm(title);
			const cleaned = stripComments(raw);
			const count = extractPlannedChapterCount(cleaned) ?? defaultCount;
			const volList = flatMode ? [] : vols.map((v) => ({ name: v.name, description: v.description }));
			const prompt = buildVolOutlineChapterPrompt({
				contextDocs: (await this.assembleVolOutlineContext(story, state, vol, { outlineText: cleaned, strict: true, noBookRel: true, noVolRel: true, volumes: volList, phaseIdx: PHASE_CHAPTER_OUTLINE })).text, // 与运行时同一 helper 装配；张力规则同口径（读书内「案头资料/张力规则.md」，缺失先播种并回落内置默认）
				strictCurrentOutlineOnly: true,
				targetVolumeName: vol.name,
				chapterCount: count,
				chapterNum: 1,
				generatedSoFar: "",
			});
			const runtimeMax = Math.max(setup.cfg.max_tokens ?? 4096, 8192);
			return this.exportSection(title, setup.cfg, phaseName(PHASE_CHAPTER_OUTLINE), [
				`AI 拆分仅在源大纲 0 个「第N章」标记时触发（本次已触发，源=${sourceLabel}）。逐章生成共 ${String(count)} 次调用：第 2 章起注入「本轮已生成最近 3 章」，依赖前序输出——本导出只给第 1 章。`,
				`章数=${String(count)}：${extractPlannedChapterCount(cleaned) ? "从大纲文本抽取的计划章数" : "大纲未抽取到计划章数，运行时弹窗询问；导出取默认 " + String(defaultCount)}。`,
				`该调用显式 max_tokens=${String(runtimeMax)}（max(配置值, 8192)）。拆分成功后接本地解析逐章落盘（不再另调 LLM）。`,
				state.ai_expand_chapter_outline === false
					? "拆章后 AI 扩展章大纲已关闭（ai_expand_chapter_outline=false）：大纲段落原文直接写盘，不调用扩展 LLM。"
					: "拆章后逐章再调一次「章大纲编写」LLM 扩展章大纲（长度≈该章正文目标字数 1/4，本段不重复导出）；扩展调用在 ai_outline_cast 开时额外要求人物/关系附录，并按出现范围写入三层《人物.md》《人物关系.md》。",
			], [
				{ heading: "系统提示词（system）", content: assembleSystemPrompt(undefined, this.promptSkill("卷大纲生成", VOL_OUTLINE_GEN_SYSTEM_PROMPT)) }, // v0.2.24+：与运行时同口径
				{ heading: "用户提示词（user）", content: prompt },
			]);
		});
		// ===== 摘要域 =====
		await trySec("分析人物与场景 (/analyze-cast)", async () => {
			const title = "分析人物与场景 (/analyze-cast)";
			const targets: Array<{ key: string; label: string; content: string }> = [];
			for (const ch of chapters) {
				const label = this.keyLabel(ch.key, volNames, ch.title);
				const content = await this.manager.readChapterContent(story, ch.key);
				if (content.trim()) targets.push({ key: ch.key, label, content }); // 空正文章跳过（与运行时一致）
			}
			if (!targets.length) return this.exportSkipSection(title, "没有任何章节有正文，命令提示无法分析，不调用 LLM。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING);
			if (!setup) return noLlm(title);
			// 已知人名/场景名 seed：与运行时相同，从现有三层人物/场景文档播种
			const knownNames = new Set<string>();
			for (const layer of await this.manager.loadCharacterLayerDocs(story)) for (const c of Object.values(layer.entries)) knownNames.add(c.name);
			const knownSceneIds = new Set<string>();
			for (const layer of await this.manager.loadSceneLayerDocs(story)) for (const s of Object.values(layer.entries)) knownSceneIds.add(s.scene_id);
			const first = targets[0];
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), [
				`运行时按阅读序逐章各调一次 LLM（本次共 ${String(targets.length)} 章为处理对象，无正文章会跳过）；导出只给第一个目标章 ${first.label}。第 2 章起 knownNames/knownSceneIds 会累加上一章分析结果，依赖前一步输出，无法预先拼出。`,
				"knownNames/knownSceneIds 已按盘上现有人物/场景三层文档条目播种（跨章名称归一基线）。",
				"响应约定：单个 JSON 对象（无代码围栏）；非法 JSON 时重试最多 3 次，重试以会话续轮追加纠错消息（「你上一次的输出不是合法 JSON…」）。",
			], [
				{ heading: "系统提示词（system）", content: this.promptSkill("人物场景分析", CAST_ANALYZE_SYSTEM_PROMPT) },
				{ heading: "用户提示词（user）", content: buildCastChapterPrompt({ chapterLabel: first.label, content: first.content, knownNames: [...knownNames], knownSceneIds: [...knownSceneIds] }) },
			]);
		});
		await trySec("章节摘要（上下文组装时延迟生成）", async () => {
			const title = "章节摘要（上下文组装时延迟生成）";
			if (state.use_summaries === false) return this.exportSkipSection(title, "该书「摘要随写」已关闭（《故事状态.md》use_summaries=false），摘要链路全程不触发。");
			if (noChapter) return this.exportSkipSection(title, `${noChapter}；摘要按章延迟生成，没有目标章。`);
			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：走编写文章阶段配置（与运行时 onload 回调一致）
			if (!setup) return noLlm(title);
			const src = await this.manager.chapterSummarySource(story, activeKey); // 正文优先，无正文回落《章节大纲》
			if (!src) return this.exportSkipSection(title, "当前激活章既没有正文也没有《章节大纲》内容，无摘要来源，不调 LLM。");
			if ((await this.manager.readSavedChapterSummary(story, activeKey)).trim()) return this.exportSkipSection(title, `当前激活章 ${chLabel} 的《章节摘要》已存在且新鲜（内容哈希与来源一致）——延迟生成机制下不会再次调用 LLM；正文/大纲变化导致哈希失配后，下次组装写作上下文时才重新生成。`);
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), [
				"不是独立命令：写作上下文组装（/write、/continue 等注入前文摘要）时，窗口章摘要缺失/过期才按需触发并落盘（延迟生成）。本导出以当前激活章为例重建这条提示词。",
				"走阶段映射（阶段 4 编写文章），不受全局激活态/对话框模型影响。",
				`摘要来源 = ${src.viaOutline ? "《章节大纲.md》回落（该章暂无正文）" : "章正文"}。`,
				'调用显式参数：max_tokens=600、temperature=0.4、reasoning_effort="none"（小预算机械压缩任务，防思考型模型吃空预算）。label 形如「卷名·第N章」或「第N章」。',
			], [
				{ heading: "系统提示词（system）", content: this.promptSkill("章摘要", CHAPTER_SUMMARY_SYSTEM_PROMPT) },
				{ heading: "用户提示词（user）", content: buildChapterSummaryPrompt(chLabel, src.text, src.viaOutline) },
			]);
		});
		await trySec("卷摘要（上下文组装时延迟整体重建）", async () => {
			const title = "卷摘要（上下文组装时延迟整体重建）";
			if (state.use_summaries === false) return this.exportSkipSection(title, "该书「摘要随写」已关闭，摘要链路全程不触发。");
			if (flatMode) return this.exportSkipSection(title, "无卷模式（书→章扁平结构）没有卷摘要。");
			const volOn = state.include_volume_summary ?? !!this.settings.includeVolumeSummary; // 本书级 frontmatter 覆盖优先于全局设置
			if (!volOn) return this.exportSkipSection(title, "「使用前卷摘要组织提示词」当前为关（全局设置与书级覆盖均未开启）——卷摘要不进写作上下文，也不会触发重建。");
			const curVol = (state.current_volume ?? "").trim();
			const vol = (curVol ? this.manager.findVolumeIn(volsRec, curVol) : null) ?? vols[0];
			if (!vol) return this.exportSkipSection(title, "还没有卷，无卷摘要可言。");
			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：走编写文章阶段配置（与运行时 onload 回调一致）
			if (!setup) return noLlm(title);
			if ((await this.manager.readFreshVolumeSummary(story, vol.id)).trim()) return this.exportSkipSection(title, `「${vol.name}」的《卷摘要》当前新鲜（指纹与各成员章新鲜摘要一致）——延迟生成机制下不会再次调用 LLM；任一成员章摘要变化/新增后，下次组装上下文时才整体重建。`);
			const volName = vol.name || vol.id;
			const lines: Array<{ label: string; title: string; summary: string }> = [];
			for (const c of chapters) {
				if (parseChKey(c.key).vol !== vol.id) continue;
				const s = (await this.manager.readSavedChapterSummary(story, c.key)).trim(); // 只取已生成且新鲜的成员章摘要（与运行时只读收集口径一致）
				if (!s) continue;
				lines.push({ label: `${volName}·第${c.num}章`, title: state.chapters[c.key]?.title || "", summary: s });
			}
			if (!lines.length) return this.exportSkipSection(title, `「${volName}」没有任何新鲜的成员章《章节摘要》可作输入，运行时直接降级跳过，不调 LLM。`);
			return this.exportSection(title, setup.cfg, phaseName(PHASE_WRITING), [
				"不是独立命令：写作上下文组装需要前卷摘要、且已存《卷摘要》指纹过期（成员章摘要变化/新增）时触发整体重建并落盘。本导出按盘上现状重建这条提示词。",
				"走阶段映射（阶段 4 编写文章），不受全局激活态/对话框模型影响。",
				`目标卷=「${volName}」（当前卷${curVol ? "" : "未设定，取第一卷"}）；输入为本卷 ${String(lines.length)} 个成员的已存新鲜章节摘要（缺失/过期的成员章跳过）。`,
				'调用显式参数：max_tokens=900、temperature=0.4、reasoning_effort="none"。',
			], [
				{ heading: "系统提示词（system）", content: this.promptSkill("卷摘要", VOL_SUMMARY_SYSTEM_PROMPT) },
				{ heading: "用户提示词（user）", content: buildVolRebuildPrompt(volName, lines) },
			]);
		});

		const storyPath = this.manager.storyPath(story);
		const slugOf = (title: string): string => title.replace(/\s+/g, "-").replace(/[^\u4e00-\u9fa5a-zA-Z0-9-]/g, "").slice(0, 60);
		entries.unshift({
			title: "AI提示词（导出说明）",
			content: [
				"# AI提示词（导出）",
				"",
				`本文件由「导出AI提示词」(/export-ai-prompts) 生成于 ${new Date().toISOString()}，小说：《${state.title}》。`,
				"",
				"- 每个阶段给出**运行时实拼**的 system/user 提示词（与各命令同一构建函数与参数），可直接逐个复制喂本地模型比对输出。",
				"- 导出全程不调用 LLM；按当前盘上数据判定「现在会不会触发」，不会触发的阶段只写跳过原因——唯一例外是 /write：激活章已有正文时运行时不触发，但仍照常组装导出提示词（节内备注），便于随时调试。",
				"- 弹窗输入取默认基准：文本弹窗留空；章数弹窗取 " + String(defaultCount) + "（= 现有章数）。运行时改了弹窗输入/盘上数据后需重新导出。",
				"- 增量链（卷设计→逐章、AI 拆分逐章、analyze-cast 逐章、书级大纲续写）只导出首步；依赖前一步输出的位置用占位符注明。",
				"- 章域基准 = 写字台当前激活章" + (activeKey ? `「${chLabel}」` : "（未设定，相关阶段已跳过）") + "；大纲/卷摘要域基准 = 当前卷。",
				"- 章节摘要/卷摘要不是命令：它们在写作上下文组装时按需延迟生成，导出展示其最新形态的提示词。",
				"- 写作上下文中的摘要：导出全程不触发摘要的 LLM 生成——已存新鲜摘要照放；缺失处填占位符 " + summaryPlaceholder + "（无成员章摘要的卷运行时也跳过、不占槽，故不填占位符）。",
				"- 本文档不是书稿（案头资料）：重新导出会整体覆盖。",
			].join("\n"),
		});
		return entries.map((e) => ({
			...e,
			path: `${storyPath}/AI提示词/${slugOf(e.title)}.md`,
		}));
	}

	// ---------- /typo-check 错别字检测 ----------
	async cmdTypoCheck(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const num = await this.targetChapterKey(story, "检测错别字"); // v0.0.15：复合键
			if (num == null) return;
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const chLabel = this.keyLabel(num, volNames);
			const bodyOnDisk = await this.manager.readChapterContent(story, num); // readChapterContent 已剥离既有标红/下划线标记，重跑不会双重包裹
			if (!bodyOnDisk.trim()) {
				new Notice(`${chLabel}还没有内容，无法检测错别字`);
				return;
			}
			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) { this.notifyNoLlm(); return; } // v0.4.6+ C8：统一提示（旧静默退出＝按了没反应）

			const n = new Notice(`正在检测${chLabel}的错别字…\nLLM 全文扫描，可能需要一点时间`);
			let markedText = "";
			let list: Array<{ wrong: string; right: string | null }> = [];
			try {
				// 全文回显式输出：token 预算须覆盖原文 + <u> 标记 + 建议 JSON，取配置值与估算值的较大者
				const maxTokens = Math.max(setup.cfg.max_tokens ?? 65535, Math.ceil(bodyOnDisk.length * 2) + 1024);
				for (let attempt = 1; attempt <= 3; attempt++) {
					const raw = await chatCompletion(
						setup.cfg,
						[
							{ role: "system" as const, content: this.promptSkill("错别字检测", TYPO_SCAN_SYSTEM_PROMPT) },
							{ role: "user" as const, content: buildTypoScanPrompt(bodyOnDisk) },
						],
						{ max_tokens: maxTokens }
					);
					const parsed = parseTypoScan(raw || "", bodyOnDisk);
					if (!parsed) continue; // 剥掉 <u> 标记后与原文不一致 → 重试
					const applied = applyTypoMarks(parsed.marked, parsed.marks, parsed.suggestions);
					markedText = applied.text;
					list = applied.list;
					break;
				}
			} catch (e) {
				n.hide();
				this.notifyError("错别字检测失败", e);
				return;
			}
			n.hide();
			if (!markedText) {
				new Notice(`✗ 错别字检测失败：模型输出 3 次均未通过校验（全文回显漂移），章节文件未改动`, 10000);
				return;
			}
			if (!list.length) {
				new Notice(`✓ ${chLabel}未检测到错别字`, 6000);
				return;
			}
			const modal = await this.beginWritingPanel(`错别字检测结果 · ${chLabel}`, setup.cfg);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			const listLines = list.map((it, i) => `${i + 1}. ${it.wrong} → ${it.right ?? "（无建议）"}`);
			modal.append(`共发现 ${String(list.length)} 处错别字：\n${listLines.join("\n")}\n\n---\n\n` + markedText);
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（错别字标记仅预览）", 6000);
				return;
			}
			const words = await this.manager.setChapterBody(story, num, markedText); // 全量覆盖；下划线 span 有意落盘、读回时自动剥离
			try {
				const f = await this.manager.chapterBodyFile(story, num);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
			new Notice(`✓ ${chLabel}已标记 ${String(list.length)} 处错别字（${String(words)} 字）`, 8000);
		} catch (e) {
			this.notifyError("错别字检测失败", e);
		}
	}

	// ---------- v0.4.6+ 敏感词检测（词表＝SKILLS/敏感词清单.md，零 LLM） ----------
	/** 「检测敏感词」：单章确定性扫描，命中处正文包底色 span（title＝分类：说明）后覆盖保存、编辑器打开；
	 *  与错别字标记共存（readChapterContent 统一剥离三类标记，重跑不双重包裹）。可选参 story/key＝写字台章节右键入口直调（不弹章选择） */
	async cmdSensitiveCheck(storyArg?: string, keyArg?: string): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = storyArg ?? (await this.requireStory());
		if (!story) return;
		try {
			let key: string | null = keyArg ?? null;
			if (!key) {
				key = await this.targetChapterKey(story, "检测敏感词");
				if (key == null) return;
			}
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const data = await this.loadSensitiveWords();
			if (!Object.keys(data.words).length && !data.patterns.length) {
				new Notice(`敏感词清单为空\n可在设置/编辑器打开 SKILLS/${SENSITIVE_LIST_SKILL_NAME}.md 补充词条（## 分类 ＋ - 「词」：说明）`, 8000);
				return;
			}
			const bodyOnDisk = await this.manager.readChapterContent(story, key); // 已剥离既有标记，重跑不双重包裹
			if (!bodyOnDisk.trim()) { new Notice("该章节还没有内容，无法检测敏感词"); return; }
			const hits = findSensitiveHits(bodyOnDisk, data);
			const chLabel = this.keyLabel(key, volNames);
			if (!hits.length) {
				new Notice(`✓ ${chLabel}未命中敏感词（词表 ${Object.values(data.words).reduce((s, g) => s + g.length, 0) + data.patterns.length} 条）`, 6000);
				return;
			}
			const marked = applySensitiveMarks(bodyOnDisk, hits, data);
			await this.manager.setChapterBody(story, key, marked); // 标记落盘（读回自动剥离，不影响后续生成）
			const groups = groupSensitiveHits(hits);
			const samples = hits.slice(0, 5).map((h) => ` 第${String(h.line)}行[${h.category}] ${h.word}｜${h.excerpt}`);
			const more = hits.length > samples.length ? `\n …其余 ${String(hits.length - samples.length)} 处见正文标色` : "";
			new Notice(`⚠ ${chLabel}敏感词 ${String(hits.length)} 处：${groups.map((g) => `${g.category}×${String(g.count)}`).join("、")}\n${samples.join("\n")}${more}\n已在正文中标色（可打开该章查看）`, 12000);
			try {
				const f = await this.manager.chapterBodyFile(story, key);
				if (f instanceof TFile) await this.manager.openMarkdown(f.path);
			} catch { /* ignore */ }
		} catch (e) {
			this.notifyError("检测敏感词失败", e);
		}
	}

	/** 「全书敏感词汇总」：逐章确定性扫描（不落标记），分类汇总追加到《案头资料/敏感词报告.md》——每次一节带时间戳，天然形成当日/历史汇总 */
	async cmdSensitiveScanAll(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const data = await this.loadSensitiveWords();
			if (!Object.keys(data.words).length && !data.patterns.length) {
				new Notice(`敏感词清单为空\n可在编辑器打开 SKILLS/${SENSITIVE_LIST_SKILL_NAME}.md 补充词条`, 8000);
				return;
			}
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const all = await this.manager.listChapters(story);
			if (!all.length) { new Notice("还没有章节，请先创建章节", 6000); return; }
			const perChapter: Array<{ label: string; hits: number; groups: Array<{ category: string; count: number }> }> = [];
			let totalHits = 0;
			for (const ch of all) {
				const body = await this.manager.readChapterContent(story, ch.key);
				const hits = findSensitiveHits(body, data);
				totalHits += hits.length;
				perChapter.push({ label: this.keyLabel(ch.key, volNames, ch.title), hits: hits.length, groups: groupSensitiveHits(hits) });
			}
			const now = new Date();
			const p2 = (n: number) => String(n).padStart(2, "0");
			const stamp = `${String(now.getFullYear())}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
			const reportPath = `${this.manager.deskDocsPath(story)}/敏感词报告.md`;
			const section = renderSensitiveReportSection(story, stamp, all.length, perChapter.filter((c) => c.hits > 0), totalHits);
			const existing = await this.manager.readDoc(reportPath); // 不存在按空处理（writeDoc 自动补父目录）
			const header = existing.trim() ? "" : `# 敏感词报告\n\n本文件由「全书敏感词汇总」自动追加，每扫描一次一节（时间倒序阅读：最新节在文件末尾）。词表事实源＝SKILLS/${SENSITIVE_LIST_SKILL_NAME}.md。\n`;
			await this.manager.writeDoc(reportPath, `${existing}${header}${existing.trim() ? "\n" : ""}${section}`);
			const hitChapters = perChapter.filter((c) => c.hits > 0);
			new Notice(
				totalHits
					? `⚠ 全书敏感词汇总：${String(all.length)} 章共 ${String(totalHits)} 处命中（${String(hitChapters.length)} 章有命中）\n${hitChapters.slice(0, 5).map((c) => ` ${c.label} ${String(c.hits)} 处`).join("\n")}${hitChapters.length > 5 ? `\n …其余 ${String(hitChapters.length - 5)} 章见报告` : ""}\n报告已追加：${reportPath}`
					: `✓ 全书敏感词汇总：${String(all.length)} 章均未命中（词表 ${Object.values(data.words).reduce((s, g) => s + g.length, 0) + data.patterns.length} 条）\n报告已追加：${reportPath}`,
				12000
			);
			try {
				await this.manager.openMarkdown(reportPath);
			} catch { /* ignore */ }
		} catch (e) {
			this.notifyError("全书敏感词汇总失败", e);
		}
	}

	/** v0.4.6+ 生成后敏感词软提醒（同 warnChapterRefs 非阻断口径）：只检测新生成内容，Notice 列前 5 处，不改正文不落标记 */
	private async warnSensitiveWords(content: string): Promise<void> {
		try {
			const data = await this.loadSensitiveWords();
			const hits = findSensitiveHits(content, data);
			if (!hits.length) return;
			const groups = groupSensitiveHits(hits);
			new Notice(`⚠ 新生成内容命中敏感词 ${String(hits.length)} 处（${groups.map((g) => `${g.category}×${String(g.count)}`).join("、")}）：\n${hits.slice(0, 5).map((h) => ` [${h.category}] ${h.word}｜${h.excerpt}`).join("\n")}\n建议按平台规则改写，或运行「检测敏感词」在正文标色`, 10000);
		} catch (e) {
			console.warn("[articlewriter] 敏感词软提醒失败：", e);
		}
	}

	// ---------- /review 审阅本章 ----------

	async cmdReviewChapter(): Promise<void> {
		if (!(await this.ensureWorkDir())) return;
		const story = await this.requireStory();
		if (!story) return;
		try {
			const state = await this.manager.validatedState(story);
			void state;
			const num = await this.targetChapterKey(story, "审阅"); // v0.0.15：复合键
			if (num == null) return;
			const volNames = await this.volNameMap(story).catch(() => ({}));
			const chLabel = this.keyLabel(num, volNames);
			const bodyOnDisk = await this.manager.readChapterContent(story, num);
			if (!bodyOnDisk.trim()) {
				new Notice(`${chLabel}还没有内容，无法审阅`);
				return;
			}
			const rawInstr = await this.prompt("重点审阅要求（可选）", "如：重点检查时间线与人物动机");
			if (rawInstr == null) return;
			const instruction = rawInstr.trim();

			const setup = this.getPhaseLlmSetup(PHASE_WRITING); // v0.2.22+：编写文章阶段
			if (!setup) { new Notice("未找到 LLM 配置\n请在 Obsidian 设置 → ArticleWriter 的「LLM 模型配置」区填写 api_key/模型名", 8000); return; }
			const data = await this.manager.loadWritingData(story, num, { includeCurrentSummary: false }); // 本章大纲是否注入由章级 specs 的 skip 控制（prompt_files 装配）
			const docs = await this.assembleWritingDocGroups(story, data, { skipChapterOutline: true }); // /review：本章大纲经 bridge.cur 注入，上下文不重复
			const reviewStable: StableSink = {}; // v0.4.3+ 前缀缓存：审阅的上下文与写作族同一装配（书级/卷级块在前，前文窗口与章级块在后）
			const context = buildWritingContext({ ...data, ...docs }, reviewStable);
			let bridge: { prev?: { label: string; text?: string }; cur?: { label: string; text?: string }; nxt?: { label: string; text?: string } } = {};
			try {
				for (const w of await this.manager.readOutlineWindow(story, num, { back: 1, fwd: 1 })) {
					const ref = { label: w.label, text: w.text || undefined };
					if (w.key === num) bridge.cur = ref;
					else if (w.ordinal < data.chapterNum) bridge.prev = ref;
					else bridge.nxt = ref;
				}
			} catch { /* 大纲桥读取失败不阻断审阅 */ }
			const sp = await this.writerSystemPrompt(setup.systemPrompt, state.writing_style, state.title, data.characters.map((c) => c.name), story); // v0.3.4+：story 传入启用本书书籍技能块；v0.3.6+：禁用词注入块已移除，审阅报告路径与正文路径注入一致（阶段 4 技能块）
			const prompt = buildReviewPrompt({
				chapterNum: data.chapterNum, // v0.0.15：阅读序位置（ordinal，跨卷连续）
				chapterLabel: chLabel,
				userInstruction: instruction || undefined,
				context,
				bridge,
				chapterContent: bodyOnDisk,
			});

			// v0.4.3+ 前缀缓存锚点：审阅提示词＝【写作上下文】在前（书级/卷级块跨章不变）、大纲桥＋【本章全文】＋审阅要求在后，
			// 钉在稳定段末尾 → 逐章审阅、以及「刚写完本章就审阅」都能复用写作侧已 park 的同一整段稳定头。
			// 仍按单发口径不落检查点（buildParams 对回环非流式默认 strata_checkpoint:false）
			const reviewPin = this.cachePin(prompt, context, reviewStable.stableChars);
			const n = new Notice(`正在从全局视角审阅${chLabel}…\n将结合小说大纲、前文与角色设定分析本章逻辑，请耐心等待`);
			let report = "";
			for (let attempt = 1; attempt <= 3 && !report.trim(); attempt++) {
				try {
					report = await chatCompletion(setup.cfg, [
						{ role: "system" as const, content: sp },
						{ role: "user" as const, content: prompt },
					], reviewPin);
				} catch (e) {
					n.hide();
					const msg = e instanceof Error ? e.message : String(e);
					if ((msg.includes("未返回内容") || msg.includes("输出为空")) && attempt < 3) {
						new Notice(`审阅结果为空（第${String(attempt)}次），正在重试…`, 6000);
						continue;
					}
					this.notifyError("审阅失败", e);
					return;
				}
			}
			n.hide();
			if (!report.trim()) {
				new Notice("✗ 审阅结果为空：服务繁忙或生成被中断，请稍后重试", 12000);
				return;
			}

			const modal = await this.beginWritingPanel(`审阅报告 · ${chLabel}`, setup.cfg);
			if (!modal) { new Notice("无法打开生成面板，本次操作已取消", 8000); return; }
			modal.append(report);
			modal.finish();
			const keep = await modal.done;
			if (!keep) {
				new Notice("未保存（仅预览）", 6000);
				return;
			}
			const path = await this.manager.saveReviewNote(story, num, report);
			await this.manager.openMarkdown(path).catch(() => undefined);
			new Notice(`✓ 审阅笔记已保存到\n${path}`, 8000);
		} catch (e) {
			this.notifyError("审阅失败", e);
		}
	}
}

/** 多行文本展示框 */
class StatusModal extends AwModal {
	constructor(app: App, private lines: string[]) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "小说状态 / 统计" });
		this.contentEl.createEl("pre", { cls: "aw-status-pre" }).setText(this.lines.join("\n")); // white-space:pre-wrap 走类名
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

class ArticleWriterSettingTab extends PluginSettingTab {
	plugin: ArticleWriterPlugin;
	private llmTabActive = 0; // LLM 配置 tab 区块选中态（0=全局设置，1=模型配置）；增删/重排会整页重建，靠该字段跨重建保留
	private phaseTabActive = 0; // 写作阶段模型 tab 区块选中态（0–4 五阶段）；阶段页选模型/改引用文档会整页重建（this.update()），靠该字段跨重建保留、不跳回第一 tab
	private llmCfgDetail: number | null = null; // 模型配置 tab 内打开的详情页配置下标（null=列表形态）；跨整页重建保留
	/**
	 * v0.4.6+ 设置页内所有「按名字列出模型配置」的下拉框登记表（写作阶段模型配置 + 全局「对话框使用的模型配置」）。
	 * 这些块同屏可见，改名只重渲染其中一块会留下另一块的旧名；改名走就地重刷（`refreshLlmNameSelects`）而非整页重建
	 * （整页重建会丢焦点/滚动位置，且改名是在输入框 change 里触发的）。增删/禁用仍走整页 `update()`，无需登记。
	 * `selected()` 现取当前应选中的名字（数据侧已改名 → 自然落到新名），故重刷后选中态不丢。
	 */
	private llmNameSelects: { sel: HTMLSelectElement; selected: () => string }[] = [];

	constructor(plugin: ArticleWriterPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	// ===== 声明式设置（唯一实现：minAppVersion=1.13.0 保证框架恒调 getSettingDefinitions；pre-1.13 的已废弃 display()/renderLlm 旧渲染路径已删除——目录校验器禁 deprecated API）=====

	private conf(): PluginConfig {
		return this.plugin.settings.llm ?? (this.plugin.settings.llm = buildDefaultLlmConf());
	}

	// v0.3.4+：原 renderIdentityBoost（identity_boost 只读预览＋编辑/保存/使用默认值）已随 Skill 化删除——
	// 身份加强文本改在 SKILLS/身份加强·<阶段名>.md 里直接编辑，生效与否由各阶段「引用文档」清单的 skill: 条目决定。

	// 引用文档配置框：可增删改的引用文档清单（顺序即装配顺序）。阶段版与对话版共用 renderRefDocsBox 引擎（v0.4.3+）。
	private renderRefDocs(container: HTMLElement, phaseIdx: number): void {
		const phs = this.conf().writing_phases ?? [];
		if (!phs[phaseIdx]) phs[phaseIdx] = { name: "" };
		this.renderRefDocsBox(container, {
			getSaved: () => phs[phaseIdx].ref_docs,
			defaults: PHASE_REF_DOC_DEFAULTS[phaseIdx] ?? [],
			catalog: PHASE_REF_DOC_CATALOGS[phaseIdx] ?? {},
			save: (l) => { if (l === null) delete phs[phaseIdx].ref_docs; else phs[phaseIdx].ref_docs = l; void this.plugin.saveData(this.plugin.settings); },
		});
	}

	/** v0.4.3+ 对话窗口引用文档配置框（LLM 配置 tab）：与写作阶段同形态（内置下拉＋vault 文档＋技能），清单写 settings.llm.chat_ref_docs；getChatSystemPrompt 装配进对话 system。 */
	private renderChatRefDocs(container: HTMLElement): void {
		this.renderRefDocsBox(container, {
			getSaved: () => this.conf().chat_ref_docs,
			defaults: CHAT_REF_DOC_DEFAULTS,
			catalog: CHAT_REF_DOC_CATALOG,
			save: (l) => { const c = this.conf(); if (l === null) delete c.chat_ref_docs; else c.chat_ref_docs = l; void this.plugin.saveData(this.plugin.settings); },
		});
	}

	/** 引用文档配置框引擎：清单渲染＋拖拽排序＋内置文档/vault 文档/技能三种添加＋恢复默认。save(null)＝清除自定义清单回落默认。 */
	private renderRefDocsBox(container: HTMLElement, opts: {
		getSaved(): string[] | undefined;
		defaults: string[];
		catalog: Record<string, string>;
		save(list: string[] | null): void;
	}): void {
		const rerender = (): void => {
			// 局部重渲染：只重建引用文档容器，避免整页重绘丢失外层 tab 选中态
			container.empty();
			this.renderRefDocsBox(container, opts);
		};
		const commit = (list: string[]): void => {
			opts.save(list);
			rerender();
		};

		const list = container.createDiv({ cls: "aw-refdocs-list" });
		const saved = opts.getSaved();
		const keys = saved ? [...saved] : [...opts.defaults];
		if (keys.length === 0) {
			list.createDiv({ cls: "aw-refdocs-empty", text: "当前清单为空：不会注入任何引用文档。" });
		}
		const move = (i: number, j: number): void => {
			if (j < 0 || j >= keys.length) return;
			const arr = [...keys];
			[arr[i], arr[j]] = [arr[j], arr[i]];
			commit(arr);
		};
		// v0.4.3+：鼠标拖拽调整顺序（HTML5 drag & drop）——拖到目标行的上/下半即插到其前/后；
		// 触屏端不支持 HTML5 拖拽，行内 ↑/↓ 按钮保留作为移动端替代（与拖拽同源 commit，落盘口径一致）
		let dragFrom: number | null = null;
		const clearDropMarks = (): void => {
			list.querySelectorAll(".aw-refdocs-row").forEach((el) => el.removeClass("is-dragging", "is-drop-before", "is-drop-after"));
		};
		const dropBefore = (ev: DragEvent, el: HTMLElement): boolean => { // 指针落在行上半＝插到该行之前
			const r = el.getBoundingClientRect();
			return ev.clientY < r.top + r.height / 2;
		};
		const used = new Set<string>();
		keys.forEach((key, i) => {
			const row = list.createDiv({ cls: "aw-refdocs-row" });
			row.createSpan({ cls: "aw-refdocs-num", text: String(i + 1) });
			if (key.startsWith("file:")) {
				row.createSpan({ cls: "aw-refdocs-lock", text: "📄" });
				row.createSpan({ cls: "aw-refdocs-label", text: key.slice(5) });
			} else if (key.startsWith("skill:")) {
				row.createSpan({ cls: "aw-refdocs-lock", text: "🎯" });
				row.createSpan({ cls: "aw-refdocs-label", text: `技能 · ${key.slice(6)}` });
				// v0.4.2+：双击技能行 → 编辑器打开 SKILLS/<基名>.md 直接编辑（内置技能文件缺失会自动重播种）
				const skillName = key.slice(6);
				row.setAttr("title", "双击在编辑器中打开该技能文件进行编辑");
				row.addEventListener("dblclick", () => void this.plugin.openSkillFile(skillName));
			} else {
				used.add(key);
				row.createSpan({ cls: "aw-refdocs-lock", text: "📚" });
				row.createSpan({ cls: "aw-refdocs-label", text: REF_DOC_LABELS[key] ?? key });
			}
			const up = row.createEl("button", { cls: "aw-refdocs-move", text: "↑", attr: { title: "上移（更早组装）" } });
			up.disabled = i === 0;
			up.onclick = () => move(i, i - 1);
			const down = row.createEl("button", { cls: "aw-refdocs-move", text: "↓", attr: { title: "下移（更晚组装）" } });
			down.disabled = i === keys.length - 1;
			down.onclick = () => move(i, i + 1);
			const del = row.createEl("button", { cls: "aw-refdocs-del", text: "删除" });
			del.onclick = () => commit(keys.filter((_, j) => j !== i));
			// v0.4.3+ 拖拽排序：整行可拖（按钮上的拖拽让位给点击），拖起行半透明、目标行上/下缘显示插入线
			row.addClass("is-draggable");
			row.setAttr("draggable", "true");
			row.addEventListener("dragstart", (ev) => {
				if (ev.target instanceof HTMLElement && ev.target.closest("button")) { ev.preventDefault(); return; }
				dragFrom = i;
				row.addClass("is-dragging");
				ev.dataTransfer?.setData("text/plain", String(i)); // Firefox 需 setData 才会启动拖拽
				if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
			});
			row.addEventListener("dragend", () => { dragFrom = null; clearDropMarks(); });
			row.addEventListener("dragover", (ev) => {
				if (dragFrom == null || dragFrom === i) return;
				ev.preventDefault(); // 必须阻止默认才允许 drop
				if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
				const before = dropBefore(ev, row);
				row.toggleClass("is-drop-before", before);
				row.toggleClass("is-drop-after", !before);
			});
			row.addEventListener("dragleave", (ev) => { // 行内子元素间移动不触发撤离标记
				if (ev.relatedTarget instanceof Node && row.contains(ev.relatedTarget)) return;
				row.removeClass("is-drop-before", "is-drop-after");
			});
			row.addEventListener("drop", (ev) => {
				ev.preventDefault();
				const from = dragFrom;
				dragFrom = null;
				clearDropMarks();
				if (from == null || from === i) return;
				const to = dropBefore(ev, row) ? i : i + 1; // 目标插入位置（原数组口径，0..len）
				if (to === from || to === from + 1) return; // 原地不动
				const arr = [...keys];
				const moved = arr.splice(from, 1)[0];
				arr.splice(to > from ? to - 1 : to, 0, moved);
				commit(arr);
			});
		});

		// 添加内置引用文档：下拉中只列出尚未在清单中的本配置可注入文档。
		const catalog: Record<string, string> = opts.catalog;
		const addable = Object.keys(catalog).filter((k) => !used.has(k));
		const addRow = container.createDiv({ cls: "aw-refdocs-addrow" });
		const select = addRow.createEl("select", { cls: "aw-refdocs-select" });
		if (addable.length === 0) {
			select.createEl("option", { value: "", text: "（内置文档已全部添加）" });
		} else {
			for (const k of addable) select.createEl("option", { value: k, text: catalog[k] });
			const add = addRow.createEl("button", { cls: "aw-refdocs-add", text: "添加引用文档" });
			add.onclick = () => {
				if (select.value) commit([...keys, select.value]);
			};
		}

		// 添加 vault 文档：弹出 vault Markdown 文件选择器（模糊搜索），选中即直接添加为 file:<path>，无需手输路径。
		const addVault = container.createEl("button", { cls: "aw-refdocs-add", text: "添加 vault 文档…" });
		addVault.onclick = () => {
			new VaultFilePickerModal(this.app, (p) => commit([...keys, `file:${p}`])).open();
		};

		// 添加技能（v0.3.0+）：列出 <work_dir>/SKILLS/ 下技能文件基名（内置技能启动时已播种、用户可自建），选中即添加为 skill:<基名>。
		const addSkill = container.createEl("button", { cls: "aw-refdocs-add", text: "添加技能…" });
		addSkill.onclick = () => {
			void (async () => {
				const existing = new Set(keys.filter((k) => k.startsWith("skill:")).map((k) => k.slice(6)));
				let names: string[] = [];
				try {
					// 系统提示词覆盖技能是内部机制（自动加载），不出现在阶段引用技能选择里
					names = (await this.plugin.listAllSkillNames()).filter((n) => !existing.has(n) && !n.startsWith(`${SYSTEM_PROMPT_SKILL_FOLDER}/`));
				} catch { /* SKILLS/ 不存在 → 空名单 */ }
				if (names.length === 0) {
					new Notice(`没有可添加的技能：${this.plugin.skillsDir()}/ 下没有新的技能文件（内置技能会自动创建，也可自行新建 <技能名>.md）`, 8000);
					return;
				}
				new SkillPickerModal(this.app, names.sort((a, b) => a.localeCompare(b, "zh")), (name) => commit([...keys, `skill:${name}`])).open();
			})();
		};

		if (saved !== undefined) {
			const resetRow = container.createDiv({ cls: "aw-refdocs-resetrow" });
			const reset = resetRow.createEl("button", { cls: "aw-refdocs-reset", text: "恢复默认清单" });
			reset.onclick = () => {
				opts.save(null);
				rerender();
			};
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// v0.4.3+：设置页挂 `.aw-form` 作用域类（与弹窗基类 AwModal 同一口径）——标签左对齐、输入框/下拉框占满剩余宽度（styles.css）
		this.containerEl.addClass("aw-form");
		this.llmNameSelects = []; // v0.4.6+ 整页重建＝旧设置页 DOM 即将废弃：模型名下拉登记表清空，各块渲染时重新登记（防登记表堆积游离节点）
		const cfgs = this.conf().llm_configs ?? [];
		const defs: SettingDefinitionItem[] = [];

		defs.push({ name: "工作目录（work_dir）", desc: "写小说的文件夹（vault 内已有文件夹）。首次使用任何命令时会自动弹出选择器让你选定；以后建书/建章/打开文档等全部在该目录下操作。每个小说是其下一个子文件夹：故事状态.md、大纲.md、第NN章-标题/章节.md 等", control: { key: "workDir", type: "text", placeholder: "首次使用时自动选择" } });
		defs.push({ name: "重新选择工作目录…", desc: "弹出文件夹选择器切换 work_dir（同「选择工作目录」命令）", action: () => void this.plugin.pickWorkDir(false) });
		defs.push({ name: "创建后自动打开文档", desc: "新建小说/章节后立即在标签页中打开对应正文或大纲", control: { key: "autoOpenOnCreate", type: "toggle" } });
		defs.push({ name: "无小说时弹出建书引导", desc: "v0.4.7+ 每次启动检查一次：未设工作目录、或工作目录里没有任何书籍（其下子文件夹都没有《故事状态.md》）时，弹出引导面板带你选目录／建第一本书（面板内也可「不再弹出」）。关闭＝不再自动弹出", control: { key: "noStoryGuideOff", type: "toggle" } });
		defs.push({ name: "前文参考章数 prevN", desc: "写作命令生成提示词时注入【前文内容】的最近 N 章（每章取 AI 摘要、缺失自动生成；0=不注入前文）。留空=默认 3。卷模式下窗口限本卷，不再拉取他卷章节细节。v0.4.3+：编写文章阶段的大纲块也按本值取当前章之前 N 章的大纲节选", control: { key: "prevChapters", type: "text", placeholder: "默认 3" } });
		defs.push({ name: "后续参考章数 nextN", desc: "v0.4.3+：编写文章阶段的大纲块只注入当前章前后若干章的节选（不再注入整卷/全书大纲）——前 N 章取「前文参考章数 prevN」、后 N 章取本项（0=不注入后章）。留空=默认 3。本书《故事状态.md》的 next_chapters 显式设置时优先于本项", control: { key: "nextChapters", type: "text", placeholder: "默认 3" } });
		defs.push({ name: "注入整卷《卷摘要》", desc: "开启后写作上下文额外包含当前卷完整《卷摘要》，跨卷缺口另以各前卷《卷摘要》填充（含触发 LLM 重建）；关闭=严格只注入最近 N 章（对齐 Python 原版语义，默认关）", control: { key: "includeVolumeSummary", type: "toggle" } });
		defs.push({ name: "码字记录段长（分钟）", desc: "v0.4.5+ 打字（码字）统计每段的时长：段边界按整点对齐（10＝每小时 :00/:10/:20…，5/15/30/60 同理；不能整除 60 的值以整点为原点顺次切段），每段一行追加到该书《案头资料/码字记录.md》（有效字数／停顿／码字速度）。留空或非法＝默认 10；可填 1–120，越界按 10 处理；改动从下一段起生效", control: { key: "typingSegmentMin", type: "text", placeholder: "默认 10" } });
		defs.push({ name: "续写衔接窗口（字）", desc: "v0.4.6+ 「续写当前章」提示词注入的已有内容末尾窗口字数。留空或非法＝默认 1000；可填 200–20000。长章（4000+ 字）建议 2000–3000，衔接更稳但每次续写输入更长（占用上下文预算）", control: { key: "continueTailChars", type: "text", placeholder: "默认 1000" } });

		const c = this.conf();
		const effectiveChatModel = selectEnabledLlmName(cfgs, c.chat_model || c.active_llm);
		if (effectiveChatModel && c.chat_model !== effectiveChatModel) c.chat_model = effectiveChatModel;

		// v0.2.22+：写作阶段模型配置（五阶段独立模型，tab 页管理）
		defs.push({
			type: "group",
			heading: "写作阶段模型配置（v0.2.22+）",
			items: [{
				name: "",
				render: (setting) => {
					setting.settingEl.addClass("aw-phase-tabs-setting");
					const tabContainer = setting.controlEl.createDiv({ cls: "aw-phase-tabs-container" });
					const tabHeader = tabContainer.createDiv({ cls: "aw-phase-tabs-header" });
					const tabContent = tabContainer.createDiv({ cls: "aw-phase-tabs-content" });
					const tabNames = WRITING_PHASE_LABELS; // v0.3.4+：与书籍 Skill 弹窗/导出文档同源常量（不再读 writing_phases[i].name legacy 字段）
					if (this.phaseTabActive < 0 || this.phaseTabActive >= tabNames.length) this.phaseTabActive = 0; // 下标越界回落第一 tab
					let activeTab = this.phaseTabActive; // 跨整页重建保留选中态（阶段页选模型触发 this.update()）
					// 创建 tab 按钮
					tabNames.forEach((name, idx) => {
						const btn = tabHeader.createEl("button", { cls: "aw-phase-tab-btn" + (idx === activeTab ? " is-active" : "") });
						btn.setText(name);
						btn.onclick = () => {
							if (activeTab === idx) return;
							this.phaseTabActive = activeTab = idx;
							tabHeader.querySelectorAll(".aw-phase-tab-btn").forEach((b, i) => {
								b.classList.toggle("is-active", i === idx);
							});
							tabContent.empty();
							renderPhaseTab(idx, tabContent);
						};
					});
					// 渲染当前 phase tab
					const renderPhaseTab = (idx: number, container: HTMLElement) => {
						// 模型配置行（自定义布局，避免嵌套 setting-item CSS 冲突）
						const row = container.createDiv({ cls: "aw-phase-model-row" });
						row.createSpan({ cls: "aw-phase-model-label", text: "模型配置" });
						const drop = row.createEl("select", { cls: "aw-phase-model-select" });
						// v0.4.6+ 选项与选中项现取（本块与下方「LLM 配置」块同屏，改名后就地重刷、旧名不留存）；选中值取该阶段当前 llm_config_name
						this.registerLlmNameSelect(drop, () => (this.conf().writing_phases ?? [])[idx]?.llm_config_name ?? "");
						drop.addEventListener("change", () => {
							const phs = this.conf().writing_phases ?? [];
							if (!phs[idx]) phs[idx] = { name: "" };
							phs[idx].llm_config_name = drop.value || undefined;
							void this.plugin.saveSettings();
							this.update();
						});
						// v0.3.4+：原「身份加强 | 引用文档」内层子标签已随身份加强 Skill 化收敛——阶段页只剩引用文档清单，直接渲染
						this.renderRefDocs(container.createDiv({ cls: "aw-phase-subtabs-content" }), idx);
					};
					renderPhaseTab(activeTab, tabContent);
				},
			}],
		});

		// LLM 配置合并 tab 区块：tab 0=全局设置（原「LLM 全局设置」group 并入），tab 1=模型配置（列表样式，点条目进详情页，返回按钮回列表）
		defs.push({
			type: "group",
			heading: "LLM 配置（模型配置 + 全局设置，存于插件数据目录 data.json）",
			items: [{
				name: "",
				render: (setting) => {
					setting.settingEl.addClass("aw-phase-tabs-setting");
					const tabContainer = setting.controlEl.createDiv({ cls: "aw-phase-tabs-container" });
					const tabHeader = tabContainer.createDiv({ cls: "aw-phase-tabs-header" });
					const tabContent = tabContainer.createDiv({ cls: "aw-phase-tabs-content" });
					if (this.llmTabActive > 1) this.llmTabActive = 0;
					let activeTab = this.llmTabActive;
					const renderConfigPane = (): void => {
						const cfgs = this.conf().llm_configs ?? [];
						if (this.llmCfgDetail != null && (this.llmCfgDetail < 0 || this.llmCfgDetail >= cfgs.length)) this.llmCfgDetail = null; // 下标越界（配置被删）→ 回落列表形态
						tabContent.empty();
						if (this.llmCfgDetail == null) this.renderLlmConfigList(tabContent, renderConfigPane);
						else this.renderLlmConfigDetail(tabContent, this.llmCfgDetail, renderConfigPane);
					};
					const selectTab = (idx: number) => {
						this.llmTabActive = activeTab = idx;
						tabHeader.querySelectorAll(".aw-phase-tab-btn").forEach((b, i) => b.classList.toggle("is-active", i === idx));
						if (idx === 0) {
							tabContent.empty();
							this.renderLlmGlobalTab(tabContent);
						} else {
							renderConfigPane();
						}
					};
					["全局设置", "模型配置"].forEach((name, idx) => {
						const btn = tabHeader.createEl("button", { cls: "aw-phase-tab-btn" + (idx === activeTab ? " is-active" : "") });
						btn.setText(name);
						btn.onclick = () => { if (activeTab === idx) return; selectTab(idx); };
					});
					selectTab(activeTab);
				},
			}],
		});

		defs.push({ name: "关于", desc: "ArticleWriter Obsidian 版：建书/建章、打开文档、保存、字数统计；数据全部为 vault 内 MD 文档，运行态存于各书的「故事状态.md」YAML 文件属性（version 2）。LLM 走 OpenAI 兼容接口（openai SDK），可接 DeepSeek / DashScope / Ollama / LM Studio / llama.cpp 等。api_key 明文存放——同步/分享 vault 时注意不要泄露配置文件。" });
		return defs;
	}

	/**
	 * v0.4.6+ 用一个「模型名下拉」的选项：选项＝当前**已启用**配置的名字（name→name），选中项由调用方给的 `selected()` 现取。
	 * 单一实现，阶段页与全局页共用（避免两处各写一遍选项构造、改名后只有一处跟着变）。
	 */
	private fillLlmNameOptions(sel: HTMLSelectElement, selected: string): void {
		sel.empty();
		for (const cfg of filterEnabledLlmConfigs(this.conf().llm_configs ?? [])) sel.createEl("option", { value: cfg.name, text: cfg.name });
		sel.value = selected; // 名字不在选项里（引用了已禁用/已删的配置）＝空白，与旧渲染口径一致
	}

	/** 登记一个模型名下拉并立即填充（阶段 tab／全局 tab 每次渲染都调用；`selected` 必须是现取当前值的闭包，不能捕获快照） */
	private registerLlmNameSelect(sel: HTMLSelectElement, selected: () => string): void {
		this.llmNameSelects.push({ sel, selected });
		this.fillLlmNameOptions(sel, selected());
	}

	/**
	 * 改名后把设置页上**已可见**的模型名下拉全部就地重刷（选项＋选中态）。
	 * 切 tab / 整页重建销毁的旧节点按 `isConnected` 认出并清出登记表（否则下次重刷会写进游离节点）。
	 */
	private refreshLlmNameSelects(): void {
		const alive: { sel: HTMLSelectElement; selected: () => string }[] = [];
		for (const entry of this.llmNameSelects) {
			if (!entry.sel.isConnected) continue;
			this.fillLlmNameOptions(entry.sel, entry.selected());
			alive.push(entry);
		}
		this.llmNameSelects = alive;
	}

	/** LLM 配置 tab · tab 0「全局设置」：对话框模型 / 系统提示词 / 描述方式（原「LLM 全局设置」group 的自定义 DOM 版） */
	private renderLlmGlobalTab(container: HTMLElement): void {
		const c = this.conf();
		const save = () => void this.plugin.saveSettings();
		const row1 = container.createDiv({ cls: "aw-llm-row" });
		row1.createSpan({ cls: "aw-llm-label", text: "对话框使用的模型配置" });
		const chatDrop = row1.createEl("select", { cls: "aw-llm-select" });
		// v0.4.6+ 选项与选中项一律**现取**（不再吃页面构建时算好的名字快照）：选中值经 `selectEnabledLlmName` 归一并回写 chat_model，
		// 与 LLM 对话框（`refreshModels`）同一口径；改名后 `refreshLlmNameSelects` 重刷这里也能落到新名
		this.registerLlmNameSelect(chatDrop, () => {
			const conf = this.conf();
			const next = selectEnabledLlmName(conf.llm_configs ?? [], conf.chat_model || conf.active_llm);
			if (next && conf.chat_model !== next) conf.chat_model = next;
			return next ?? "";
		});
		chatDrop.addEventListener("change", () => { c.chat_model = chatDrop.value || undefined; this.plugin.syncChatModelSelect(); save(); });
		// v0.4.6+ 对话自动上下文压缩阈值（%）：发送前估算提示词 token ≥ 模型窗口×此比例 → 先自动压缩早期轮次再发送；0＝关闭
		const ratioRow = container.createDiv({ cls: "aw-llm-row" });
		ratioRow.createSpan({ cls: "aw-llm-label", text: "对话自动压缩阈值 %" });
		const ratioInput = ratioRow.createEl("input", { type: "number", cls: "aw-llm-input" });
		ratioInput.min = "0";
		ratioInput.max = "100";
		ratioInput.placeholder = "默认 75";
		ratioInput.value = c.chat_compress_ratio == null ? "" : String(c.chat_compress_ratio);
		ratioInput.addEventListener("change", () => {
			const n = Number(ratioInput.value);
			c.chat_compress_ratio = ratioInput.value.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
			save();
		});
		ratioRow.createSpan({ cls: "aw-dim", text: "发送前估算提示词占模型上下文窗口（模型配置 context_window）超过此比例时，先自动压缩早期轮次再发送；0＝关闭（仍可手动「压缩上下文」）" }); // 改对话框模型 → 已打开的 LLM 对话框下拉同步跟随
		// v0.4.3+：原「写作系统提示词 system_prompt」文本框已废弃删除（系统提示词不再使用）——原位改为对话窗口引用文档/技能配置（机制同写作阶段 ref_docs）
		container.createDiv({ cls: "aw-llm-row" }).createSpan({ cls: "aw-llm-label", text: "对话窗口引用文档 / 技能" });
		this.renderChatRefDocs(container.createDiv({ cls: "aw-refdocs" }));
		const row3 = container.createDiv({ cls: "aw-llm-row" });
		row3.createSpan({ cls: "aw-llm-label", text: "描述方式 desc_style" });
		const styleDrop = row3.createEl("select", { cls: "aw-llm-select" });
		styleDrop.createEl("option", { value: "normal", text: "normal" });
		styleDrop.createEl("option", { value: "complete", text: "complete" });
		styleDrop.value = c.desc_style || "normal";
		styleDrop.addEventListener("change", () => { c.desc_style = styleDrop.value || "normal"; save(); });
	}

	/** LLM 配置 tab · 模型配置页 · 列表形态：每份配置一行（名称 + 模型/地址摘要），点击进入详情页；「＋ 新建配置」创建后直接跳进其详情页 */
	private renderLlmConfigList(container: HTMLElement, rerender: () => void): void {
		const cfgs = this.conf().llm_configs ?? [];
		const addBtn = container.createEl("button", { cls: "aw-llm-add", text: "＋ 新建配置" });
		addBtn.onclick = () => void this.addLlmConfig();
		if (cfgs.length === 0) {
			container.createDiv({ cls: "aw-llm-empty", text: "尚无模型配置：点「＋ 新建配置」创建" });
			return;
		}
		const listEl = container.createDiv({ cls: "aw-llm-list" });
		cfgs.forEach((cfg, i) => {
			const disabled = !isLlmConfigEnabled(cfg);
			const row = listEl.createDiv({ cls: "aw-llm-item" + (disabled ? " is-disabled" : "") });
			const content = row.createDiv({ cls: "aw-llm-item-main" });
			content.createSpan({ cls: "aw-llm-item-name", text: cfg.name });
			content.createSpan({ cls: "aw-llm-item-meta", text: cfg.model_name || "（未填模型名）" });
			if (disabled) content.createSpan({ cls: "aw-llm-item-state", text: "已禁用" });
			const actions = row.createDiv({ cls: "aw-llm-item-actions" });
			const toggleBtn = actions.createEl("button", { cls: "aw-llm-toggle", text: disabled ? "启用" : "禁用" });
			toggleBtn.onclick = (event) => {
				event.stopPropagation();
				void (async () => {
					const conf = this.conf();
					const nextEnabled = toggleLlmConfigEnabled(cfg);
					setLlmConfigEnabled(conf, cfg, nextEnabled);
					await this.plugin.saveSettings();
					this.plugin.syncChatModelSelect();
					this.update();
					rerender();
				})();
			};
			const delBtn = actions.createEl("button", { cls: "aw-llm-del", text: "删除" });
			delBtn.onclick = (event) => {
				event.stopPropagation();
				void (async () => {
					const ok = await new Promise<boolean>((resolve) => {
						new ConfirmModal(this.app, "删除模型配置", `确认删除模型配置「${cfg.name}」吗？删除后会清除其写作阶段绑定，并从可用模型列表中移除。`, "删除", () => resolve(true), () => resolve(false)).open();
					});
					if (ok) this.removeLlmConfig(i);
				})();
			};
			row.onclick = disabled ? null : () => { this.llmCfgDetail = i; rerender(); };
		});
	}

	/** LLM 配置 tab · 模型配置页 · 详情页（i = llm_configs 下标）：编辑单份模型配置，字段语义与原声明式 page 一致；「返回列表」按钮回列表（局部刷新不整页重建）；改名就地同步；删除/重排走整页重建、靠 llmCfgDetail 保持详情页 */
	private renderLlmConfigDetail(container: HTMLElement, i: number, rerender: () => void): void {
		const c = this.conf();
		const cfg = (c.llm_configs ?? [])[i];
		if (!cfg) return;
		const save = () => void this.plugin.saveSettings();
		const disabled = !isLlmConfigEnabled(cfg);
		const backBtn = container.createEl("button", { cls: "aw-llm-back", text: "← 返回模型配置列表" });
		backBtn.onclick = () => { this.llmCfgDetail = null; rerender(); };
		const textRow = (label: string, placeholder: string, get: () => string, set: (v: string) => void): HTMLInputElement => {
			const row = container.createDiv({ cls: "aw-llm-row" });
			row.createSpan({ cls: "aw-llm-label", text: label });
			const input = row.createEl("input", { cls: "aw-llm-input", type: "text", placeholder });
			input.value = get();
			input.disabled = disabled;
			input.addEventListener("change", () => set(input.value));
			return input;
		};
		const providerType = normalizeLlmProvider(cfg.provider);
		const visibleFields = getVisibleLlmFields(providerType);
		const showField = (field: "base_url" | "model_name" | "api_key" | "temperature" | "max_tokens" | "top_p" | "repeat_penalty" | "reasoning_effort" | "thinking" | "context_window" | "chat_tools") => visibleFields.includes(field);
		// 名称：空名/重名不保存（输入框回落原值）。改名走 `renameLlmConfig`——把 active_llm／chat_model／各写作阶段 llm_config_name 一次性全部跟上，
		// 再就地重刷设置页上可见的模型名下拉（写作阶段块与本块同屏，只重渲染本块会留下另一块的旧名）＋已打开的 LLM 对话框下拉；不整页重建（保住输入框焦点与滚动位置）
		const nameInput = textRow("名称 name", "配置名称", () => cfg.name, (v) => {
			const trimmed = v.trim();
			if (!trimmed || (trimmed !== cfg.name && (c.llm_configs ?? []).some((x) => x.name === trimmed))) { nameInput.value = cfg.name; return; }
			renameLlmConfig(c, cfg, trimmed);
			this.refreshLlmNameSelects();
			this.plugin.syncChatModelSelect();
			save();
		});
		const providerRow = container.createDiv({ cls: "aw-llm-row" });
		providerRow.createSpan({ cls: "aw-llm-label", text: "模型类型 provider" });
		const providerDrop = providerRow.createEl("select", { cls: "aw-llm-select" });
		providerDrop.disabled = disabled;
		const providerOptions: Record<string, string> = { "openai-compatible": "OpenAI 兼容", deepseek: "DeepSeek", qwen: "Qwen" };
		Object.entries(providerOptions).forEach(([k, v]) => providerDrop.createEl("option", { value: k, text: v }));
		providerDrop.value = providerType;
		providerDrop.addEventListener("change", () => {
			const next = normalizeLlmProvider(providerDrop.value);
			cfg.provider = next;
			if (!cfg.base_url) cfg.base_url = defaultBaseUrlForProvider(next);
			save();
			rerender();
		});
		const testRow = container.createDiv({ cls: "aw-llm-row" });
		testRow.createSpan({ cls: "aw-llm-label", text: "连通性测试" });
		const testBtn = testRow.createEl("button", { text: "测试连接" });
		testBtn.disabled = disabled;
		testBtn.onclick = () => void this.plugin.runLlmTest(cfg);
		if (showField("temperature")) textRow("温度 temperature", "如 0.8", () => cfg.temperature == null ? "" : String(cfg.temperature), (v) => { const n = Number(v); cfg.temperature = v.trim() !== "" && !Number.isNaN(n) ? n : undefined; save(); });
		if (showField("max_tokens")) textRow("最大 token max_tokens", "如 65535", () => cfg.max_tokens == null ? "" : String(cfg.max_tokens), (v) => { const n = Number(v); cfg.max_tokens = v.trim() !== "" && !Number.isNaN(n) ? n : undefined; save(); });
		// v0.4.6+ 模型上下文窗口：LLM 对话面板自动压缩判定用（估算提示词 ≥ 窗口×阈值% 先压后发）；留空回落模型名 NNK 后缀（如 …-128k）
		if (showField("context_window")) textRow("上下文窗口 context_window", "token 数，如 128000；LLM 对话「自动上下文压缩」判定用——留空则按模型名 -128k 类后缀推断，推不出只手动压缩", () => cfg.context_window == null ? "" : String(cfg.context_window), (v) => { const n = Number(v); cfg.context_window = v.trim() !== "" && Number.isSafeInteger(n) && n > 0 ? n : undefined; save(); });
		if (showField("base_url")) textRow("服务地址 base_url", defaultBaseUrlForProvider(providerType) || "http://localhost:8509", () => cfg.base_url ?? "", (v) => { cfg.base_url = v.trim() || undefined; save(); });
		if (showField("model_name")) textRow("模型 model_name", "留空用服务端已加载模型", () => cfg.model_name ?? "", (v) => { cfg.model_name = v.trim() || undefined; save(); });
		if (showField("api_key")) textRow("API Key api_key", "留空=不发送鉴权头", () => cfg.api_key ?? "", (v) => { cfg.api_key = v.trim() || undefined; save(); });
		if (showField("top_p")) textRow("Top P top_p", "如 0.9", () => cfg.top_p == null ? "" : String(cfg.top_p), (v) => { const n = Number(v); cfg.top_p = v.trim() !== "" && !Number.isNaN(n) ? n : undefined; save(); });
		if (showField("repeat_penalty")) textRow("重复惩罚 repeat_penalty", "如 1.1", () => cfg.repeat_penalty == null ? "" : String(cfg.repeat_penalty), (v) => { const n = Number(v); cfg.repeat_penalty = v.trim() !== "" && !Number.isNaN(n) ? n : undefined; save(); });
		// v0.2.21+：多值字段用下拉框；存量值不在标准集时动态并入选项（标「（存量值）」）防丢失
		if (showField("reasoning_effort")) {
			const effortOptions: Record<string, string> = { "": "留空（不发送）", none: "none（关思考）", low: "low", medium: "medium", high: "high", max: "max" };
			const effortCur = (cfg.reasoning_effort ?? "").trim();
			if (effortCur && !Object.prototype.hasOwnProperty.call(effortOptions, effortCur)) effortOptions[effortCur] = `${effortCur}（存量值）`;
			const effortRow = container.createDiv({ cls: "aw-llm-row" });
			effortRow.createSpan({ cls: "aw-llm-label", text: "推理强度 reasoning_effort" });
			const effortDrop = effortRow.createEl("select", { cls: "aw-llm-select" });
			effortDrop.disabled = disabled;
			Object.entries(effortOptions).forEach(([k, v]) => effortDrop.createEl("option", { value: k, text: v }));
			effortDrop.value = effortCur;
			effortDrop.addEventListener("change", () => { cfg.reasoning_effort = effortDrop.value || undefined; save(); });
		}
		if (showField("thinking")) {
			const thinkOptions: Record<string, string> = { "": "留空（跟随服务端默认）", on: "on（开思考）", off: "off（关思考）" };
			const thinkCur = (cfg.thinking ?? "").trim();
			if (thinkCur && !Object.prototype.hasOwnProperty.call(thinkOptions, thinkCur)) thinkOptions[thinkCur] = `${thinkCur}（存量值）`;
			const thinkRow = container.createDiv({ cls: "aw-llm-row" });
			thinkRow.createSpan({ cls: "aw-llm-label", text: "思考模式 thinking" });
			const thinkDrop = thinkRow.createEl("select", { cls: "aw-llm-select" });
			thinkDrop.disabled = disabled;
			Object.entries(thinkOptions).forEach(([k, v]) => thinkDrop.createEl("option", { value: k, text: v }));
			thinkDrop.value = thinkCur;
			thinkDrop.addEventListener("change", () => { cfg.thinking = thinkDrop.value || undefined; save(); });
		}
		// v0.4.7+ 对话工具调用开关：仅 LLM 对话面板生效——部分本地小模型带 21 工具语法约束时输出不稳（正文半句即停/全空，实测本地 Strata Qwen3.8-Flash），关掉即不带工具定义、恢复完整输出；写作命令不受影响
		if (showField("chat_tools")) {
			const chatToolsOptions: Record<string, string> = { "": "启用（对话中模型可调用工具）", off: "off（发送不带工具定义）" };
			const chatToolsCur = (cfg.chat_tools ?? "").trim();
			if (chatToolsCur && !Object.prototype.hasOwnProperty.call(chatToolsOptions, chatToolsCur)) chatToolsOptions[chatToolsCur] = `${chatToolsCur}（存量值）`;
			const chatToolsRow = container.createDiv({ cls: "aw-llm-row" });
			chatToolsRow.createSpan({ cls: "aw-llm-label", text: "对话工具调用 chat_tools" });
			const chatToolsDrop = chatToolsRow.createEl("select", { cls: "aw-llm-select" });
			chatToolsDrop.disabled = disabled;
			Object.entries(chatToolsOptions).forEach(([k, v]) => chatToolsDrop.createEl("option", { value: k, text: v }));
			chatToolsDrop.value = chatToolsCur;
			chatToolsDrop.addEventListener("change", () => { cfg.chat_tools = chatToolsDrop.value || undefined; save(); });
		}
		const actions = container.createDiv({ cls: "aw-llm-actions" });
		const toggleBtn = actions.createEl("button", { text: disabled ? "启用配置" : "禁用配置" });
		toggleBtn.onclick = () => {
			void (async () => {
				const nextEnabled = toggleLlmConfigEnabled(cfg);
				setLlmConfigEnabled(c, cfg, nextEnabled);
				await this.plugin.saveSettings();
				this.plugin.syncChatModelSelect();
				this.update();
				rerender();
			})();
		};
		const upBtn = actions.createEl("button", { text: "↑ 上移" });
		upBtn.disabled = i === 0 || disabled;
		upBtn.onclick = () => this.reorderLlmConfigs(i, i - 1);
		const downBtn = actions.createEl("button", { text: "下移 ↓" });
		downBtn.disabled = i >= (c.llm_configs ?? []).length - 1 || disabled;
		downBtn.onclick = () => this.reorderLlmConfigs(i, i + 1);
	}

	getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (key === "workDir") return s.workDir ?? "";
		if (key === "autoOpenOnCreate") return !!s.autoOpenOnCreate;
		if (key === "noStoryGuideOff") return s.noStoryGuideOff !== true; // v0.4.7+ 行文案是「无小说时弹出建书引导」，落盘字段取反（缺省未定义＝开）
		if (key === "prevChapters") return s.prevChapters == null ? "" : String(s.prevChapters); // v0.1.4+：空=按内置默认 3
		if (key === "nextChapters") return s.nextChapters == null ? "" : String(s.nextChapters); // v0.4.3+：空=按内置默认 3
		if (key === "includeVolumeSummary") return !!s.includeVolumeSummary; // v0.1.4+：卷摘要注入开关（缺省=false）
		if (key === "typingSegmentMin") return s.typingSegmentMin == null ? "" : String(s.typingSegmentMin); // v0.4.5+：空=按缺省 10 分钟
		if (key === "continueTailChars") return s.continueTailChars == null ? "" : String(s.continueTailChars); // v0.4.6+ C9：空=按缺省 1000 字
		// v0.3.4+：写作阶段模型配置（仅剩 llm_config_name 走 setControlValue；identity_boost 已 Skill 化）
		const phaseCfgMatch = key.match(/^writing_phases\.(\d+)\.(llm_config_name)$/);
		if (phaseCfgMatch) {
			const idx = Number(phaseCfgMatch[1]);
			const field = phaseCfgMatch[2];
			const phases = this.conf().writing_phases ?? [];
			const rec = phases[idx] as unknown as Record<string, unknown>; // 动态字段名索引需经 Record 中转（合法保留断言）
			return rec?.[field] ?? "";
		}
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		const str = typeof value === "string" ? value : "";
		if (key === "workDir") {
			const prevStory = (s.lastStory || "").trim(); // v0.2.1+：作废旧小说记忆前先把其窗口状态归档进该书工作区（与 pickWorkDir 同语义）
			s.workDir = str.trim().replace(/^\/+|\/+$/g, "");
			void this.plugin.captureBookWorkspace(prevStory);
			s.lastStory = "";
			await this.plugin.saveSettings();
			return;
		}
		if (key === "autoOpenOnCreate") {
			s.autoOpenOnCreate = value === true;
			await this.plugin.saveSettings();
			return;
		}
		if (key === "noStoryGuideOff") { // v0.4.7+ 显示取反：勾上＝启动时弹建书引导（缺省），取消＝写 noStoryGuideOff=true 不再弹
			s.noStoryGuideOff = value !== true;
			await this.plugin.saveSettings();
			return;
		}
		if (key === "prevChapters") { // v0.1.4+：非负整数；留空/非法=清除回落内置默认 3（对齐 cfg 数值字段「空=undefined」约定）
			const n = Number(str);
			s.prevChapters = str.trim() !== "" && !Number.isNaN(n) && n >= 0 ? Math.floor(n) : undefined;
			await this.plugin.saveSettings();
			return;
		}
		if (key === "nextChapters") { // v0.4.3+：非负整数；留空/非法=清除回落内置默认 3（与 prevChapters 同口径）
			const n = Number(str);
			s.nextChapters = str.trim() !== "" && !Number.isNaN(n) && n >= 0 ? Math.floor(n) : undefined;
			await this.plugin.saveSettings();
			return;
		}
		if (key === "includeVolumeSummary") { // v0.1.4+：布尔开关，关闭存 false（缺省即关）
			s.includeVolumeSummary = value === true;
			await this.plugin.saveSettings();
			return;
		}
		if (key === "typingSegmentMin") { // v0.4.5+：1–120 分钟整数；留空/非法/越界=清除、运行时回落缺省 10（与 prevChapters「空=默认」同口径）
			const n = Number(str);
			s.typingSegmentMin = str.trim() !== "" && Number.isFinite(n) && n >= SEGMENT_MIN_MIN && n <= SEGMENT_MIN_MAX ? Math.floor(n) : undefined;
			await this.plugin.saveSettings();
			return;
		}
		if (key === "continueTailChars") { // v0.4.6+ C9：200–20000 字；留空/非法/越界=清除、运行时回落缺省 1000
			const n = Number(str);
			s.continueTailChars = str.trim() !== "" && Number.isFinite(n) && n >= 200 && n <= 20000 ? Math.round(n) : undefined;
			await this.plugin.saveSettings();
			return;
		}
		// v0.3.4+：写作阶段模型配置（仅剩 llm_config_name 走 setControlValue；identity_boost 已 Skill 化）
		const phaseCfgMatch = key.match(/^writing_phases\.(\d+)\.(llm_config_name)$/);
		if (phaseCfgMatch) {
			const c = this.conf();
			const idx = Number(phaseCfgMatch[1]);
			const field = phaseCfgMatch[2];
			if (!c.writing_phases) c.writing_phases = [];
			while (c.writing_phases.length <= idx) c.writing_phases.push({ name: "" });
			(c.writing_phases[idx] as unknown as Record<string, unknown>)[field] = str.trim() || undefined;
			await this.plugin.saveSettings();
			return;
		}
		// 未知键忽略
	}

	private async addLlmConfig(): Promise<void> {
		const conf = this.conf();
		const cfgs = (conf.llm_configs ??= []);
		let i = cfgs.length + 1;
		let name = `config-${i}`;
		while (cfgs.some((x) => x.name === name)) { i++; name = `config-${i}`; }
		cfgs.push({ name, enabled: true, provider: "openai-compatible", api_key: "", base_url: "", model_name: "", temperature: 0.8, max_tokens: 65535, top_p: 0.9, repeat_penalty: 1.1, thinking: "", reasoning_effort: "none", openai_extras: [], api_style: "" });
		if (!conf.active_llm) conf.active_llm = name;
		await this.plugin.saveSettings();
		this.plugin.syncChatModelSelect();
		this.llmTabActive = 1; // 整页重建后切到「模型配置」tab
		this.llmCfgDetail = cfgs.length - 1; // 并直接进入新配置的详情页
		this.update();
		new Notice("已新建模型配置，请填写服务地址/模型/API Key");
	}

	private removeLlmConfig(i: number): void {
		void (async () => {
			const conf = this.conf();
			const cfgs = conf.llm_configs ?? [];
			const removed = cfgs.splice(i, 1)[0];
			if (removed && conf.active_llm === removed.name) conf.active_llm = (conf.llm_configs ?? []).find((cfg) => isLlmConfigEnabled(cfg) && cfg.name !== removed.name)?.name ?? (conf.llm_configs ?? [])[0]?.name;
			if (removed && conf.chat_model === removed.name) conf.chat_model = (conf.llm_configs ?? []).find((cfg) => isLlmConfigEnabled(cfg) && cfg.name !== removed.name)?.name ?? undefined;
			// 清理 writing_phases 中对被删配置的引用
			if (removed) {
				const phases = conf.writing_phases ?? [];
				for (const phase of phases) {
					if (phase.llm_config_name === removed.name) phase.llm_config_name = undefined;
				}
			}
			this.llmTabActive = 1; // 整页重建后留在「模型配置」tab
			this.llmCfgDetail = null; // 删除后回落列表形态
			await this.plugin.saveSettings();
			this.plugin.syncChatModelSelect();
			this.update();
		})();
	}

	private reorderLlmConfigs(oldIndex: number, newIndex: number): void {
		void (async () => {
			const cfgs = this.conf().llm_configs ?? [];
			const [moved] = cfgs.splice(oldIndex, 1);
			cfgs.splice(newIndex, 0, moved);
			if (this.llmCfgDetail === oldIndex) this.llmCfgDetail = newIndex; // 详情页跟随被移动配置的新位置
			await this.plugin.saveSettings();
			this.plugin.syncChatModelSelect();
			this.update();
		})();
	}
}
