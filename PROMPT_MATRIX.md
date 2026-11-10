# PROMPT_MATRIX.md —— 分阶段生成提示词矩阵

本文件是「写作阶段 × 命令 → 提示词组装」的单一速查表：每个 LLM 调用点的 **system prompt 来源、user prompt 构建函数、注入的上下文块、张力规则/禁用词/身份加强注入点、输出解析与校验**，行号以 `src/prompts.ts` / `src/main.ts` / `src/llm_client.ts` / `src/cast_analyzer.ts` 当前源码为准（v0.2.25 口径）。

**维护约定**：新增命令、改注入点或改 system 来源时，同步更新本矩阵对应行；若该命令属于 export-ai-prompts 覆盖范围，还须同步 `cmdExportPrompts` 的 features 清单与 `buildPromptExportDoc` 的 trySec 标题（两处逐字节一致，见 §8）。

## 1. 阶段 → 模型配置选取

`getPhaseLlmSetup(phaseIndex)`（main.ts:2772）：按 `writing_phases[phaseIndex].llm_config_name` 在 `llm_configs` 中查找，未指定或未命中取 `cfgs[0]`；**active_llm（旧版激活态）与对话框选择的 chat_model 均不参与阶段回退**。返回 `{ cfg, systemPrompt: conf.system_prompt, descStyle, identityBoost: phase?.identity_boost }`。无可用配置返回 null（调用方直接 return）。

| 阶段 | 语义 | 运行时调用点（main.ts） |
| --- | --- | --- |
| 0 | 策划指南 | 4866（ensurePlanningGuide 自动生成）、4884（cmdPlanningGuideWorldview）、export 6378 |
| 1 | 书级/卷级大纲 | 4613 / 4656（cmdGenerateVolOutline 含继续/补全＋无卷兜底批量）、5072（cmdGenerateBookOutline）、5262（cmdBookOutlineToVolumes 批量）、export 6392 / 6424 |
| 2 | 卷大纲→章节（AI 拆分兜底） | 4402（cmdVolumeOutlineToChapters）、export 6466 |
| 3 | 正文写作＋辅助任务 | 109 / 132（摘要 onload 回调）、1680（cmdAnalyzeCast）、2704（剧本转换）、2817（cmdLlmTest 连通测试）、4178（cmdWrite）、5449（cmdWriteConsecutive）、5564（cmdContinueWriting）、5706（cmdRewriteChapter）、5811（cmdPolishText）、deai 5908、fix-refs 5953、6621（cmdTypoCheck）、6697（cmdReviewChapter） |

## 2. System prompt 组装链

`assembleSystemPrompt(customSp, guideText, baseSp, identityBoost)`（llm_client.ts:182）：base = `customSp > baseSp > DEFAULT_SYSTEM_PROMPT`；其后追加【创作规范】块（guideText，冲突时【编写类型】优先）；再追加【身份加强】块（identityBoost，追加前剥掉值自带的前导「【身份加强】」标记，保证只出现一个块）。

两条组装路径：

- **正文路径**（阶段 3 写作命令）：`writerSystemPrompt`（main.ts:3059，async）= `assembleSystemPrompt(buildStoryTypeSystemPrompt({storyType, guideText, title, charNames, bannedGuideText, bannedData}) || undefined, guides.writerGuideText, baseSp, setup.identityBoost)`——customSp 为按书籍题材/指南/禁用词动态生成的【编写类型】system；**禁用词块仅注入正文写作路径**（`includeBanned` 默认 true，/review 等非正文路径传 false 退出——不加载禁用词、不注入禁用词块与指南禁用词类目）；【创作规范】用剥离禁用词类目的 `writerGuideText`（该内容已由禁用词块完整承载，防双份注入）。
- **大纲/策划/AI 拆分路径**（阶段 0/1/2）：直接 `assembleSystemPrompt(undefined, "", <BASE_SP>, setup.identityBoost)`，BASE_SP 为常量——阶段 0 复用 `BOOK_OUTLINE_GEN_SYSTEM_PROMPT`（prompts.ts:1138），阶段 1/2 用 `VOL_OUTLINE_GEN_SYSTEM_PROMPT`（prompts.ts:1002）。调用点：4624 / 4667（卷大纲）、4870 / 4900（策划指南）、4443（AI 拆分）、5366（book-outline-to-volumes 批量）。

**identity_boost 注入范围**（v0.2.24+）：全部创作阶段（0/1/2/3 写作命令）统一注入；机械/辅助任务有意不注入（输出协议严格、有漂移风险）：/typo、/analyze-cast、章节/卷摘要延迟生成、autoCleanAi 去AI味。

## 3. 阶段 0 · 策划指南

| 项 | 内容 |
| --- | --- |
| 入口 | `ensurePlanningGuide`（main.ts:4857，软依赖——失败返回 ""，后续大纲生成照常进行、只是无【策划规范】块）；`cmdPlanningGuideWorldview`（4884，worldOnly 输入、恒覆盖已有文档）；export 预览 6378 |
| system | `assembleSystemPrompt(undefined, "", BOOK_OUTLINE_GEN_SYSTEM_PROMPT, setup.identityBoost)`（4870 / 4900） |
| user prompt | 首轮 `buildPlanningGuidePrompt`（prompts.ts:1359）；截断续写 `buildPlanningGuideContinuePrompt`（1374，缺失节驱动） |
| 上下文块 | `planningGuideContextParts`（1329）：【书籍信息】【张力规则 ·…】【世界观】【全书大纲】【卷列表 · 阅读序】；**目标文档本身永不注入**（重新生成不读旧内容） |
| 张力规则 | 【书籍信息】后、world 块前，文案「生成策划指南时必须遵循」（1339）——策划指南无【创作规范】块故不挂其后 |
| 输出处理 | `runPlanningGuideStreamed`：十节清单 `PLANNING_GUIDE_SECTIONS`（1308）为唯一事实源；停止条件＝十节齐全且 finish_reason≠length / 模型精确回复「已完成」（仅十节已齐全时采信、防 token 边界 length 误报，该段不并入，main.ts:4839）/ 用户中止 / 尚缺节时连续 3 轮节数无推进（4846，提示调大 max_tokens）；空结果每轮重试 ×3；最多续写 10 轮 |

## 4. 阶段 1 · 大纲域

### 4.1 卷级大纲（cmdGenerateVolOutline，main.ts:4522）

| 项 | 内容 |
| --- | --- |
| system | `assembleSystemPrompt(undefined, "", VOL_OUTLINE_GEN_SYSTEM_PROMPT, setup.identityBoost)`（4624 / 4667） |
| user prompt | step 0 `buildVolOutlineDesignPrompt`（prompts.ts:1082，≤8 行【卷设计】）＋ steps 1..N `buildVolOutlineChapterPrompt`（1104，每步一个 `## 第N章`；supplementMode 变体＝只补缺失章号的补全措辞） |
| 上下文块 | `volOutlineContextParts`（1030）：【创作规范】【张力规则 ·…】（1043，挂【创作规范】后）【世界观】【策划规范】【全书大纲】【卷列表 · 阅读序】【前一卷卷大纲 · 仅参考】等；**目标卷大纲本身永不注入**、已有章节(+摘要)也不注入——生成只依据世界观＋策划指南等既定事实 |
| 路径变体 | 单卷完整生成 / 继续生成（genVolOutlineIncremental，从已有章号之后续写）/ 零卷兜底批量 `autoCreateVolumesAndGenOutlines`（4684，书级《大纲.md》有卷声明时自动建全部声明卷并逐卷生成，freshOutlines 链式上下文缓存） |

### 4.2 书级大纲（cmdGenerateBookOutline，main.ts:5072）

| 项 | 内容 |
| --- | --- |
| system | `assembleSystemPrompt(undefined, "", BOOK_OUTLINE_GEN_SYSTEM_PROMPT, setup.identityBoost)` |
| user prompt | 完整生成 `buildBookOutlineGenPrompt`（prompts.ts:1202，flat 平铺 vs volume 有卷两种模式）/ 续写 `buildBookOutlineContinuePrompt`（1244）/ extend 追加新卷 `buildBookOutlineExtendPrompt`（1273） |
| 上下文块 | `bookOutlineContextParts`（1165），张力规则挂【创作规范】后（1177）；**目标文档本身永不注入**、已有章节(+摘要)也不注入 |

### 4.3 从书级大纲生成卷（cmdBookOutlineToVolumes，main.ts:5262）

批量流程：`parseVolumeDeclarations` 解析书级《大纲.md》卷声明 → 逐卷创建 → 每卷走 `genVolOutlineIncremental`（system = `VOL_OUTLINE_GEN_SYSTEM_PROMPT` 组装，5366）；supplementMode＝只补缺失章号；`mergeVolOutlineChapters` 合并时保留已有章节。**export-ai-prompts 恒跳过本节**（批量流程无法用单段预览）。

## 5. 阶段 2 · 卷大纲→章节（AI 拆分兜底）

`cmdVolumeOutlineToChapters`（main.ts:4402）：正常路径为确定性拆分 `splitVolOutlineByChapter`（按 `## 第N章` 标记切分、零 LLM 调用）；**仅当找不到任何标记时**才走 AI 拆分兜底——逐章 LLM 调用 `buildVolOutlineChapterPrompt({sourceOutline, strictCurrentOutlineOnly:true})`（prompts.ts:1104），system = `VOL_OUTLINE_GEN_SYSTEM_PROMPT` 组装（4443），`max_tokens=max(cfg??4096, 8192)`，`generatedSoFar` 经 outlineSoFarContext 裁剪至最近 3 章。平铺（无卷）模式以书级《大纲.md》为拆分源、章节落书根。sourceOutline 是输入而非目标，不算「注入目标内容」。

## 6. 阶段 3 · 正文写作与辅助任务

### 6.1 正文命令

共用 system 路径见 §2 正文路径；共用上下文 `buildWritingContext`（prompts.ts:420）：书/卷/章三层结构（角色/场景结构化列表排除归属当前章的条目并按容器分层、人物关系跨层逐行去重优先级 章 > 卷 > 书、folderDocs 原文归章级节）、前文窗口 N 章＋跨卷卷摘要填充（N 与卷摘要开关可被故事状态.md 每书覆盖）；**v0.2.24+ 《伏笔.md》不再注入**——伏笔只由大纲 `[伏]…[/]` 标记驱动。字数区间 `wordRangeFromGuides`（269，正则 `<!--\s*字数配置\s*[:：]\s*N-N-->`，默认 [4000,5000]）。

| 命令 | cmd（main.ts） | user builder（prompts.ts） | 特殊协议 / 参数 | 输出解析与校验 |
| --- | --- | --- | --- | --- |
| /write | cmdWrite 4178 | `buildChapterPrompt`（859） | 规则 13 = CHAPTER_REF_BAN（904）；withSummary（state.use_summaries !== false）→ `summaryTailInstruction`（1396）`<SUMMARY>` 同响应协议；readOutlineWindow back:3 prevRefs；追加/覆盖模式（默认追加），指令经 appendOutlineInstruction 并入大纲并保存 | `parseChapterWithSummary`（1402）——解析失败静默回落延迟生成；`validateStoryTypeFormat`（632）格式不符重试 |
| /continue | cmdContinueWriting 5564 | `buildContinuePrompt`（928） | 注入现有正文尾部 1000 字；规则 10 = CHAPTER_REF_BAN（971）；withSummary 同上 | 同上 |
| /rewrite | cmdRewriteChapter 5706 | `buildRewritePrompt`（1456） | CHAPTER_REF_BAN（1488）；withSummary 同上 | 同上 |
| /polish | cmdPolishText 5811 | `buildPolishPrompt`（1538） | 无 CHAPTER_REF_BAN | — |
| /deai | （5908） | `buildDeaiPrompt`（1573） | AI 词命中由 `findAiWordHits` 按外部文件 BANNED_WORDS.md 清单检出（见 §7 禁用词）；逐句「N：改写句」编号行协议；max_tokens=min(8192, 句数×300+1024) 配置封顶，≤2 轮 | 按编号行回填 |
| /fix-refs | （5953） | `buildChapterRefFixPrompt`（779） | 同「N：改写句」编号行协议；输入由 `findChapterRefLeaks`（722）检出 | 按编号行回填 |
| /typo | cmdTypoCheck 6621 | `buildTypoScanPrompt` | system = `TYPO_SCAN_SYSTEM_PROMPT`（1883）；预算 max(cfg, len×2+1024)，3 次重试；**机械任务不注入 identity_boost** | `parseTypoScan`（1906）→ 下划线 span 落盘（唯一有意保留的标记性 span） |
| /review | cmdReviewChapter 6697 | `buildReviewPrompt`（1504） | 非正文路径：`writerSystemPrompt(includeBanned=false)`——不加载禁用词、不注入禁用词块与指南禁用词类目；无 CHAPTER_REF_BAN | — |

### 6.2 辅助任务

| 任务 | 调用点（main.ts） | system | user prompt | 参数 / 校验 |
| --- | --- | --- | --- | --- |
| 章节摘要（延迟生成） | onload 回调 109 | `CHAPTER_SUMMARY_SYSTEM_PROMPT`（prompts.ts:1424） | `buildChapterSummaryPrompt`（1427，200~300 字，viaOutline 变体） | max_tokens=600、temp=0.4、reasoning_effort="none"；不注入 identity_boost |
| 卷摘要（延迟整体重建） | onload 回调 132 | `VOL_SUMMARY_SYSTEM_PROMPT`（978） | `buildVolRebuildPrompt`（987，400~600 字，以该卷成员章《章节摘要》为输入） | max_tokens=900；不注入 identity_boost |
| /analyze-cast | cmdAnalyzeCast 1680 | `CAST_ANALYZE_SYSTEM_PROMPT`（cast_analyzer.ts:51） | `buildCastChapterPrompt`（cast_analyzer.ts:55） | JSON 输出，格式不符重试 ×3（formatRetryNote）；不注入 identity_boost |
| 剧本转换 | LLM 调用 2704（fn 2668，system 组装 2689） | `buildStoryTypeSystemPrompt({storyType:"剧本"})`（prompts.ts:597） | user prompt 内联数组 | max_tokens=max(4000, len×2)、temp 0.7，`validateStoryTypeFormat` 不符时 0.6 重试一次 |
| 连通测试 | cmdLlmTest 2817 | —（GET /models，无提示词） | — | — |

## 7. 横切机制速查

- **张力规则（TENSION_RULES.md）**：大纲路径挂【创作规范】块后（volOutlineContextParts:1043、bookOutlineContextParts:1177）；策划指南路径挂【书籍信息】后、world 块前且文案「生成策划指南时必须遵循」（planningGuideContextParts:1339）；**不进正文写作命令提示词**。全部运行时调用点生成前 `await this.loadTensionRules()`（读盘、缺失回落内置默认）；export-ai-prompts 预览同口径。
- **禁用词（BANNED_WORDS.md）**：运行时唯一来源＝插件数据目录 BANNED_WORDS.md——每次启动 `ensureBannedWordsFile`（main.ts:2343，onload:157）仅缺失时以内置默认播种写盘；`loadBannedWords`（2355）严格读盘，缺失/为空不回落内置（console.warn，内置词仅作播种内容参考）。注入点**仅正文写作路径**：`writerSystemPrompt(includeBanned=true)`（main.ts:3068）→ `buildStoryTypeSystemPrompt({bannedData})` → `buildMergedBannedBlock`（banned_words.ts:468，prompts.ts:600 条件组装）生成【禁用词】块；非正文 LLM 路径（对话/大纲/策划/deai/repair/export 预览）一律不加载，且其【创作规范】用剥离禁用词类目的 `writerGuideText`（防双份注入）。AI 词检测路径（autoCleanAi /deai/export-preview）另用该清单做命中检出（`findAiWordHits` banned_words.ts:190 / `findAiSentences` 233）。
- **CHAPTER_REF_BAN**（prompts.ts:719）：注入点仅三处——buildChapterPrompt 规则 13（904）、buildContinuePrompt 规则 10（971）、buildRewritePrompt（1488）；polish/deai/review 不含。
- **摘要同响应协议**（v0.2.21+）：`summaryTailInstruction`（1396，私有）供 /write /continue /rewrite（withSummary）在正文末尾追加 `<SUMMARY>` 块要求；`parseChapterWithSummary`（1402）解析，失败静默回落延迟生成管线。
- **目标文档永不注入自身生成上下文**：volOutlineContextParts / bookOutlineContextParts / planningGuideContextParts 均不注入正在生成的文档（全量或紧凑索引）；已有章节(+摘要)也不进大纲/策划生成——只依据世界观＋策划指南等既定事实。

## 8. 完整性交叉核对：export-ai-prompts 16 节

`cmdExportPrompts`（main.ts:6085）的 features 清单（6091–6108）与 `buildPromptExportDoc`（6127）各 `trySec("…")` 标题**逐字节一致**（含 · 两侧空格），任一处改动须同步另一处，否则该功能点被静默跳过。每节头部行标注该命令所属阶段的模型配置（`exportPhaseName`，6058）。

**章域 8 节**：

| # | 标题（trySec 行号） | 备注 |
| --- | --- | --- |
| 1 | 创作章节 (/write)（6172） | 有正文也导出（附注）；仅无章节大纲时跳过 |
| 2 | 续写当前章 (/continue)（6207） | `checkOutlineCoverage`（prompts.ts:1704）allCovered 时跳过 |
| 3 | 重写当前章 (/rewrite)（6242） | |
| 4 | 润色当前章 (/polish)（6269） | |
| 5 | 去AI化当前章 (/deai)（6283） | AI 词命中按外部文件 BANNED_WORDS.md 清单检出（见 §7 禁用词）；max_tokens=min(8192, 句数×300+1024) 配置封顶，≤2 轮 |
| 6 | 修正章节引用 (/fix-refs)（6310） | |
| 7 | 错别字检测 (/typo)（6335） | 预算 max(cfg, len×2+1024)，3 次重试，parseTypoScan |
| 8 | 审阅当前章 (/review)（6351） | |

**大纲域 5 节**：

| # | 标题（trySec 行号） | 备注 |
| --- | --- | --- |
| 9 | 生成策划指南（仅世界观） (/planning-guide-worldview)（6378） | system 复用 BOOK_OUTLINE_GEN_SYSTEM_PROMPT |
| 10 | 生成书籍大纲 (/book-outline-generate)（6392） | |
| 11 | 自动生成卷大纲 (/vol-outline-generate)（6424） | 只给 step 1（卷设计）＋ step 2（第1章，占位） |
| 12 | 从书级大纲生成卷 (/book-outline-to-volumes)（6463） | **恒跳过**——批量流程无法单段预览 |
| 13 | 从卷大纲生成章节·AI 拆分兜底 (/vol-outline-to-chapters)（6466） | |

**摘要域 3 节**：

| # | 标题（trySec 行号） | 备注 |
| --- | --- | --- |
| 14 | 分析人物与场景 (/analyze-cast)（6518） | JSON 重试 ×3（formatRetryNote） |
| 15 | 章节摘要（上下文组装时延迟生成）（6544） | summaryPlaceholder="（此处有摘要，尚未生成）" |
| 16 | 卷摘要（上下文组装时延迟整体重建）（6563） | |

导出默认章数 `defaultCount=max(chapters.length,1)`。本矩阵 §3–§6 覆盖的运行时调用点与这 16 节一一对应（阶段 0/1/2 各入口＋阶段 3 全部命令与辅助任务），无遗漏项。
