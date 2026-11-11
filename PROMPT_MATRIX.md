# PROMPT_MATRIX.md —— 分阶段生成提示词矩阵

本文件是「写作阶段 × 命令 → 提示词组装」的单一速查表：每个 LLM 调用点的 **system prompt 来源、user prompt 构建函数、注入的上下文块、张力规则/禁用词/身份加强注入点、输出解析与校验**，行号以 `src/prompts.ts` / `src/main.ts` / `src/llm_client.ts` / `src/cast_analyzer.ts` 当前源码为准（prompt_files 装配重构后工作树口径）。

**维护约定**：新增命令、改注入点或改 system 来源时，同步更新本矩阵对应行；若该命令属于 export-ai-prompts 覆盖范围，还须同步 `cmdExportPrompts` 的 features 清单与 `buildPromptExportDoc` 的 trySec 标题（两处逐字节一致，见 §8）。上下文块改动＝改调用方的 `assemblePromptFiles` specs（`src/prompt_files.ts`），prompts.ts 旧上下文函数族（volOutlineContextParts / bookOutlineContextParts / planningGuideContextParts）已退役。

## 1. 阶段 → 模型配置选取

`getPhaseLlmSetup(phaseIndex)`（main.ts:2774）：按 `writing_phases[phaseIndex].llm_config_name` 在 `llm_configs` 中查找，未指定或未命中取 `cfgs[0]`；**active_llm（旧版激活态）与对话框选择的 chat_model 均不参与阶段回退**。返回 `{ cfg, systemPrompt: conf.system_prompt, descStyle, identityBoost: phase?.identity_boost }`。无可用配置返回 null（调用方直接 return）。

| 阶段 | 语义 | 运行时调用点（main.ts） |
| --- | --- | --- |
| 0 | 策划指南 + 时间线（v0.3.3+，旧大事件列表退场） | 5153（ensurePlanningGuide 自动生成）、5182（cmdPlanningGuideWorldview）、5036（ensureTimeline 前置自动生成，挂两入口）、export 7004 / 7019 |
| 1 | 书级/卷级大纲 | 4703 / 4746 / 4824（cmdGenerateVolOutline 含继续/补全＋无卷兜底批量）、5300 / 5326 / 5358（cmdGenerateBookOutline 含续写/extend）、5513（cmdBookOutlineToVolumes 批量）、export 6565 / 6596 / 6625 |
| 2 | 卷大纲→章节（AI 拆分兜底） | 4424（cmdVolumeOutlineToChapters）、export 6628 |
| 3 | 正文写作＋辅助任务 | 101 / 125（摘要 onload 回调）、1658（cmdAnalyzeCast）、2702（剧本转换）、2840（cmdLlmTest 连通测试）、4199（cmdWrite）、5596（cmdWriteConsecutive）、5712（cmdContinueWriting）、5855（cmdRewriteChapter）、5961（cmdPolishText）、6030（cmdDeaiClean）、6103（cmdFixChapterRefs）、6774（cmdTypoCheck）、6850（cmdReviewChapter） |

## 2. System prompt 组装链

`assembleSystemPrompt(customSp, guideText, baseSp, identityBoost)`（llm_client.ts:182）：base = `customSp > baseSp > DEFAULT_SYSTEM_PROMPT`；其后追加【创作规范】块（guideText，冲突时【编写类型】优先）；再追加【身份加强】块（identityBoost，追加前剥掉值自带的前导「【身份加强】」标记，保证只出现一个块）。

两条组装路径：

- **正文路径**（阶段 3 写作命令）：`writerSystemPrompt`（main.ts:3151，async）= `assembleSystemPrompt(buildStoryTypeSystemPrompt({storyType, guideText, title, charNames, bannedGuideText, bannedData, skillsBlock}) || undefined, guides.guideCleanText, baseSp, setup.identityBoost)`——customSp 为按书籍题材/指南/禁用词动态生成的【编写类型】system；guides 来自 `loadWriterGuides`（main.ts:3132，内部 `assembleGuideTexts` 直装三层指南原文，不再经《写作指南汇总.md》）；**禁用词块仅注入正文写作路径**（`includeBanned` 默认 true，/review 等非正文路径传 false 退出——不加载禁用词、不注入禁用词块与指南禁用词类目）；【创作规范】用剥离禁用词类目的 `guideCleanText`（该内容已由禁用词块完整承载，防双份注入）；**v0.2.27+ 技能块**：`skillsBlock = await loadSkillsBlock(3)`（main.ts:2377，读阶段 3 ref_docs 的 `skill:` 条目→SKILLS/<name>.md→【技能 · name】join，无条目＝空串不注入）——`buildStoryTypeSystemPrompt` 内块序＝【编写类型】→【禁用词】→技能块→【强制要求】尾（prompts.ts:503/514 钩子）；正文上下文装配走 `skipSkills:true`，技能只经此单次注入（剧本转换调用点不传＝不注入，见 [agents/l3-skills.md](./agents/l3-skills.md)）。
- **大纲/策划/AI 拆分路径**（阶段 0/1/2）：直接 `assembleSystemPrompt(undefined, "", <BASE_SP>, setup.identityBoost)`，BASE_SP 为常量——阶段 0 复用 `BOOK_OUTLINE_GEN_SYSTEM_PROMPT`（prompts.ts:1045），时间线前置生成用 `TIMELINE_GEN_SYSTEM_PROMPT`（prompts.ts:1247，v0.3.3+，替代旧 `EVENTS_LIST_SYSTEM_PROMPT`），**世界观生成用 `WORLDVIEW_GEN_SYSTEM_PROMPT`（prompts.ts:1262，v0.2.27+）**，阶段 1/2 用 `VOL_OUTLINE_GEN_SYSTEM_PROMPT`（prompts.ts:941）。调用点：4703 / 4746 / 4824（卷大纲＋兜底批量）、5168 / 5200（策划指南）、5047（时间线）、5204（世界观）、4465（AI 拆分）、5513（book-outline-to-volumes 批量）。

**identity_boost 注入范围**（v0.2.24+）：全部创作阶段（0/1/2/3 写作命令）统一注入；机械/辅助任务有意不注入（输出协议严格、有漂移风险）：/typo、/analyze-cast、章节/卷摘要延迟生成、autoCleanAi 去AI味。

## 3. 阶段 0 · 策划指南与世界观

| 项 | 内容 |
| --- | --- |
| 入口 | `ensurePlanningGuide`（main.ts:5153，软依赖——失败返回 ""，后续大纲生成照常进行、只是无【策划规范】块）；`cmdPlanningGuideWorldview`（5182，worldOnly 输入、恒覆盖已有文档）；export 预览 7019。**v0.2.25+ 卷数量弹窗**：两入口生成前共用 `promptPlanningGuideVolumeCount`（main.ts:5074，分卷模式才弹、预填现有卷数、取消＝不按卷组织软处理；平铺模式不弹）。**v0.3.3+ 时间线前置**（替代旧「大事件列表前置」）：两入口在卷数量弹窗前先过 `ensureTimeline`（5036，见下行） |
| 时间线（前置自动生成，v0.3.3+ 替代旧大事件列表行） | 目标文档＝书级《案头资料/时间线.md》（`StoryManager.bookTimelinePath`/`setBookTimeline`，story_manager.ts:1412/1417；旧《案头资料/大事件列表.md》与其 `eventsListPath`/`readEventsList`/`setEventsList` 全部退场——不迁移、留档 vault，插件无读写路径）。`ensureTimeline`（main.ts:5036）：仅当阶段 0 清单含 `timeline` 时生效（与配置框同口径）；书级文档已有**有效时间点条目**＝直接跳过（旧式纯时间点标题也算有效）；缺失/无有效条目＝用阶段 0 LLM 配置 + `TIMELINE_GEN_SYSTEM_PROMPT`（prompts.ts:1247）+ `buildTimelineGenPrompt`（1254）经 `streamWithEmptyRetry` 流式生成并落盘（`setBookTimeline` 原文原样、尾部补换行），再继续生成策划指南。**生成上下文固定**＝书籍信息＋【创作规范】（锁定）＋张力规则＋世界观（`buildTimelineInput` 5021，不受 ref_docs 过滤——生成上下文与注入清单分离，清单只控制结果是否注入）。失败/中止软处理：Notice「时间线未生成成功，继续生成策划指南（本次不带【时间线】）」后主流程继续。**输出格式＝标题块**：首行 `# 时间线`，每事件一个标题块、标题行＝「时间点 事件名」（`##` 大事件／`###` 小事件／`####` 旁支，时间点取纯数字纪年／年-月／年-月-日、事件名 4–12 字），其下＝**面板事件格式字段行**：`- 人物：` / `- 事件：` / `- 描述：` / `- 影响：` 每条必备（取值同行；`- 描述：` 写比事件更细的原因/经过/细节，仅悬停 Tip 显示）、`- 关联：` 只引用本文档内事件名（无关联可整行省略）、**禁止 `- 完成：` 行**（面板勾选产物）（`TIMELINE_GEN_SYSTEM_PROMPT` 同步该口径，示例含两块事件演示关联引用）——同一格式即时间线面板（`md_docs.parseTimelines`）展示与编辑的口径，旧「纯时间点」标题仍可解析兼容。**格式硬约束＋校验重试**：落盘前用 `md_docs.timelineGenFormatOk`（1099）校验——须≥1 个「时间点 事件名」标题块且零编号清单行/裸事件行，不合格＝带【格式修正要求】注记（内联独立串，非 `formatRetryNote`）重生成一次，仍不合格则原样落盘＋Notice「时间线格式仍不合规（已按原样保存，可在时间线面板手动修正）」软提示。export 预览 7004（非独立命令，恒可导出调试）。**注入侧**：策划指南的【时间线】块不再是单文件，由 `StoryManager.mergedTimelineText`（1459）把三层《时间线.md》（书级→未归卷章节→各卷及其章节，`readTimelineDocs` 顺序）逐条 `formatTimelineBlock` 重序列化合并（保留各文档内部层级与先后次序、不做全局时间排序），无有效条目＝空串＝空块不注入。 |
| system | `assembleSystemPrompt(undefined, "", BOOK_OUTLINE_GEN_SYSTEM_PROMPT, setup.identityBoost)`（5168 / 5200） |
| user prompt | 首轮 `buildPlanningGuidePrompt`（prompts.ts:1205）；截断续写 `buildPlanningGuideContinuePrompt`（1224，缺失节驱动）。**v0.2.25+ 按卷组织**：`PlanningGuideInput.volumeCount`>0 时两 prompt 均追加 `planningGuideVolumeReq` 要求行（十节结构不变，「二、大事件序列」「三、升级路径」「五、反转与伏笔总规划」等节内按卷分 H3 小标题「第X卷 · 卷名」，卷名取自【卷列表 · 阅读序】）；未输入/取消或平铺模式不加该条。**v0.3.3+ 时间线门控**（替代旧「大事件列表门控」）：contextDocs 含【时间线】块时，首轮 prompt 措辞改为「尤其是世界观与【时间线】」并追加「『二、大事件序列』须以【时间线】的时间点与事件为基础展开、不得与其冲突」；无块则维持原措辞 |
| 上下文块 | v0.2.24+ prompt_files 装配改造：`planningGuideContextParts` 已退役——调用方 `buildPlanningGuideInput`（main.ts:4999）经 `assemblePromptFiles` 装配 `contextDocs` 传入（【书籍信息】→【张力规则 ·…】→【世界观】→【时间线】→【全书大纲】→【卷列表 · 阅读序】，worldOnly 跳过大纲/卷列表条目）；**目标文档本身永不注入**（重新生成不读旧内容、specs 不含《策划指南.md》）；**v0.2.25+ ref_docs 门控**：条目按阶段 0 引用文档配置框过滤（`phaseRefDocKeys(0)`，默认清单＝书籍信息/张力规则/世界观/时间线（v0.3.3+，原「大事件列表」退场）；全书大纲/卷列表默认不注入、可在下拉手动添加）；【时间线】块由三层《时间线.md》合并时间轴装配（`mergedTimelineText`，书级无有效条目时先由 `ensureTimeline` 生成落盘再装配，见上行；v0.3.3+ 替代旧单文件【大事件列表】块）；**新增锁定【创作规范】注入**（`loadWriterGuides` 三层指南、header 常量 `HDR_GUIDE_PLANNING`＝【创作规范 · …生成策划指南时必须遵循…】，策划指南此前无创作规范块——现与其余阶段同口径锁定、不受 ref_docs 开关影响） |
| 张力规则 | 【创作规范】锁定块后、world 块前，文案「生成策划指南时必须遵循」（调用方 specs 注入，`HDR_TENSION_PLANNING`）——v0.2.25+ 起策划指南已有【创作规范】锁定块（`HDR_GUIDE_PLANNING`），张力规则挂其后 |
| 输出处理 | `runPlanningGuideStreamed`（main.ts:4926）：十节清单 `PLANNING_GUIDE_SECTIONS`（prompts.ts:1176）为唯一事实源；停止条件＝十节齐全且 finish_reason≠length / 模型精确回复「已完成」（仅十节已齐全时采信、防 token 边界 length 误报，该段不并入，main.ts:4970）/ 用户中止 / 尚缺节时连续 3 轮节数无推进（4939，提示调大 max_tokens）；空结果每轮重试 ×3；最多续写 10 轮 |

### 世界观生成（cmdGenerateWorldview，main.ts:5178，v0.2.27+）

全自动写书流水线首阶段，亦是独立命令 `worldview-generate`。单轮生成（无续写循环）。

| 项 | 内容 |
| --- | --- |
| 入口 | `cmdGenerateWorldview`（main.ts:5180）；全自动写书流水线 worldview 阶段（见 [l2-pipeline.md](./agents/l2-pipeline.md)）；export 预览 6941 |
| premise | 优先 `this.auto.premise`（流水线运行中，弹窗已校验非空）否则 `state.one_line`（state_doc 新增 `one_line?`，空串视为未设置）；皆空 → promptBox 补问（必填，取消/空即中止），补问值经 saveState 写回 `state.one_line` 作下次默认 |
| system | `assembleSystemPrompt(undefined, "", WORLDVIEW_GEN_SYSTEM_PROMPT, setup.identityBoost)`（prompts.ts:1262，调用点 5204） |
| user prompt | `buildWorldviewGenPrompt`（prompts.ts:1272）：一句话设定为种子（主角/行动动因/阻碍须在世界观中有落点）＋固定 H2 骨架（「世界基本规则」「世界观红线」必含，其余可按题材增删）＋硬规则可判定不矛盾＋只写设定不写情节＋首行 H1；输出为自由格式文档（`readWorldDoc().fullText` 原样注入后续提示词） |
| 上下文块 | 书籍信息＋【创作规范】（loadWriterGuides 锁定）＋张力规则三对 pairs 经 `orderRefDocSpecs(pairs, phaseRefDocKeys(0), { guideKey: "guide" })` 按阶段 0「引用文档」配置框过滤注入（与策划指南同口径）；**目标文档《世界观.md》自身不注入** |
| 输出处理 | `streamWithEmptyRetry` ×3 → `modal.signal.aborted`/空文本检查 → `setWorldDoc`（story_manager.ts:2625，剥正文首部 H1、统一补 `# <书名> 世界观`）＋`finishAuto` 自动落盘（无保存 CTA）；**已有非空直接覆盖、不确认**（流水线语义，手动运行同口径） |

## 4. 阶段 1 · 大纲域

### 4.1 卷级大纲（cmdGenerateVolOutline，main.ts:4613）

| 项 | 内容 |
| --- | --- |
| system | `assembleSystemPrompt(undefined, "", VOL_OUTLINE_GEN_SYSTEM_PROMPT, setup.identityBoost)`（4703 / 4746 / 4824） |
| user prompt | step 0 `buildVolOutlineDesignPrompt`（prompts.ts:982，≤8 行【卷设计】）＋ steps 1..N `buildVolOutlineChapterPrompt`（1007，每步一个 `## 第N章`；supplementMode 变体＝只补缺失章号的补全措辞；v0.2.x+ 五项结构/节奏/收束条款与书级大纲共享——`OUTLINE_CHAPTER_FIVE_ITEMS`〔927〕/`outlineRhythmClause`〔930〕/`outlineClosingClause`〔935〕，非 strict 分支旧版曾重复推入五项条款、已修） |
| 上下文块 | v0.2.24+ prompt_files 装配改造：`volOutlineContextParts` 已退役——调用方 `assembleVolOutlineContext`（main.ts:4550）经 `assemblePromptFiles` 装配 `contextDocs` 传入（【创作规范】【张力规则 ·…】挂【创作规范】后【世界观】【策划规范】【全书大纲】【卷列表 · 阅读序】【前一卷卷大纲 · 仅参考】等）；**目标卷大纲本身永不注入**（specs 不含目标《卷大纲.md》）、已有章节(+摘要)也不注入——生成只依据世界观＋策划指南等既定事实；**v0.2.25+ ref_docs 门控**：specs 改 key 配对、按 `phaseRefDocKeys(phaseIdx)` 过滤（默认 phaseIdx=1，AI 拆分路径传 2），【创作规范】锁定项恒保留、`file:<vault 路径>` 条目追加为【引用文档 · <路径>】块 |
| 路径变体 | 单卷完整生成 / 继续生成（genVolOutlineIncremental，main.ts:4081，从已有章号之后续写）/ 零卷兜底批量 `autoCreateVolumesAndGenOutlines`（4763，书级《大纲.md》有卷声明时自动建全部声明卷并逐卷生成，freshOutlines 链式上下文缓存） |

### 4.2 书级大纲（cmdGenerateBookOutline，main.ts:5218）

| 项 | 内容 |
| --- | --- |
| system | `assembleSystemPrompt(undefined, "", BOOK_OUTLINE_GEN_SYSTEM_PROMPT, setup.identityBoost)`（5300 / 5326 / 5358） |
| 数量弹窗 | v0.2.x+ 按模式分流：平铺问目标章数（`promptChapterCountInput`）＝恰好 N 章；**有卷问卷数量**（`promptBookOutlineVolumeCount`，main.ts:5200，预填现有卷数、取消＝中止）＝恰好 N 卷——各卷章数不在这里问（由「从书级大纲生成卷」逐卷问）。继续生成判定 `m`：平铺＝`maxOutlineChapterNum`、有卷＝`maxDeclaredVolumeNum`（md_docs.ts:351，扫卷声明 bullet 行卷号、旧格式区间注记兼容）；`BookOutlineGenInput.volumeCount` 传卷数、`chapterCount` 有卷模式传 0 |
| user prompt | 完整生成 `buildBookOutlineGenPrompt`（prompts.ts:1067，flat 平铺 vs volume 有卷两种模式——有卷＝恰好 N 卷、每卷 `## 第X卷·卷名` 小节＋首行声明 bullet＋卷级规划五项〔主线/因果衔接/大事件 2–4/人物变化/卷末状态〕、禁逐章标记与章号区间、禁其他「第X卷」开头行、结构＝全书主线→卷小节→【结局】、按最后一卷收束）/ 平铺分段续写 `buildBookOutlineContinuePrompt`（1115，fromChapter/toChapter）/ 有卷按卷追加 `buildBookOutlineExtendPrompt`（1144，fromVolume/toVolume，只追加新卷小节＋更新【结局】）；五项结构/节奏/收束条款与卷级大纲共享（`OUTLINE_CHAPTER_FIVE_ITEMS`〔927〕/`outlineRhythmClause`〔930〕/`outlineClosingClause`〔935〕） |
| 上下文块 | v0.2.24+ prompt_files 装配改造：`bookOutlineContextParts` 已退役——调用方经 `assemblePromptFiles` 装配 `contextDocs` 传入（【创作规范】【张力规则 ·…】挂【创作规范】后【世界观】【策划规范】等）；**目标文档本身永不注入**（specs 不含书级《大纲.md》）、已有章节(+摘要)也不注入；装配走 `assembleVolOutlineContext`（main.ts:4550，默认 phaseIdx=1）——与 §4.1 同一函数、同一 **阶段 1 引用文档配置框**门控（ref_docs 过滤＋【创作规范】锁定＋`file:` 追加），书级/卷级大纲共用阶段 1 清单 |

### 4.3 从书级大纲生成卷（cmdBookOutlineToVolumes，main.ts:5420）

批量流程：`parseVolumeDeclarations`（md_docs.ts:331）解析书级《大纲.md》卷声明 bullet（`- 第X卷[·・、\-—]<名>[（第A-B章）][:：]<描述>`，区间注记可选剥除）→ 逐卷创建 → 每卷走 `genVolOutlineIncremental`（system = `VOL_OUTLINE_GEN_SYSTEM_PROMPT` 组装，5513）；supplementMode＝只补缺失章号；`mergeVolOutlineChapters` 合并时保留已有章节。**export-ai-prompts 恒跳过本节**（批量流程无法用单段预览）。

## 5. 阶段 2 · 卷大纲→章节（AI 拆分兜底）

`cmdVolumeOutlineToChapters`（main.ts:4424）：正常路径为确定性拆分 `splitVolOutlineByChapter`（按 `## 第N章` 标记切分、零 LLM 调用）；**仅当找不到任何标记时**才走 AI 拆分兜底——逐章 LLM 调用 `buildVolOutlineChapterPrompt({sourceOutline, strictCurrentOutlineOnly:true})`（prompts.ts:1007），system = `VOL_OUTLINE_GEN_SYSTEM_PROMPT` 组装（4465），上下文经 `assembleVolOutlineContext`（main.ts:4550）传 `phaseIdx: 2` 按**阶段 2 引用文档配置框**过滤（见 §4.1 ref_docs 门控），`max_tokens=max(cfg??4096, 8192)`，`generatedSoFar` 经 outlineSoFarContext 裁剪至最近 3 章。平铺（无卷）模式以书级《大纲.md》为拆分源、章节落书根。sourceOutline 是输入而非目标，不算「注入目标内容」。

**v0.2.25+ 先清旧正文（问题①）**：章节段（segments）解析完成后、写入章节之前，先 `countChaptersWithBody`（story_manager.ts，范围＝目标卷 `(c.vol ?? "") === volId`，平铺＝书根）统计有正文的章数；>0 则弹 `confirmBox`（main.ts:4515，「从大纲生成章节：清除旧正文」）——确认＝`clearChapterBodies`（4515 调用，逐章 `setChapterBody(key,"")`，保留章节文件与标题、字数归零）后继续写入；取消＝Notice「已取消」直接 return，零改动。AI 拆分兜底路径同样先清（清点在两路径汇合之后）。汇总 Notice 增加「已清除旧正文：N 章」行。

## 6. 阶段 3 · 正文写作与辅助任务

### 6.1 正文命令

共用 system 路径见 §2 正文路径；共用上下文 `buildWritingContext`（prompts.ts:339）：书/卷/章三层结构（角色/场景结构化列表排除归属当前章的条目并按容器分层）、前文窗口 N 章＋跨卷卷摘要填充（N 与卷摘要开关可被故事状态.md 每书覆盖）；**v0.2.24+ prompt_files 装配改造**：上下文文档不再经 md_docs 结构化渲染——调用方经 `assembleWritingDocGroups`（main.ts:4585）按 `loadWritingData` 返回的 `docPaths` 装配 `bookDocs`/`volDocs`/`chapterDocs` 三组原文块串传入（世界观/人物关系等直载原文；旧 folderDocs 字段与跨层人物关系逐行去重〔章 > 卷 > 书〕已退役，去重仅剩装配器整块同文跳过）；**v0.2.25+ ref_docs 门控**：默认 `phaseIdx=3` 按**阶段 3 引用文档配置框**过滤（`phaseRefDocKeys(3)`），注入顺序＝配置框数组顺序（`orderRefDocSpecs`），`file:<vault 路径>` 自定义条目追加进书级组为【引用文档 · <路径>】块；【创作规范】由 system 侧锁定、不受开关影响；/review、对话命令同样走阶段 3 配置框口径；**《伏笔.md》不再注入**——伏笔只由大纲 `[伏]…[/]` 标记驱动；**v0.2.25+ 起不再注入【全书大纲】块**（用户定稿：阶段 3 写作上下文只依赖本卷/本章大纲；`globalOutlineRaw` 仍传入、仅供提及名检测与 `<角色：>` 标记风格判定），/continue、/review、/rewrite 中原「全局大纲」措辞已改「本卷与本章大纲」。**v0.2.25+ 平铺模式例外（问题②）**：无卷书的 `vol_outline` 槽位映射书级《大纲.md》、header＝【全书大纲】（平铺书没有卷大纲，写作上下文不能一份大纲都没有）——`outlineBlockNameOf`（prompts.ts:756）按实际注入块措辞，/write 等提示词大纲措辞随之为【本卷大纲】或【全书大纲】。字数区间 `wordRangeFromGuides`（268，正则 `<!--\s*字数配置\s*[:：]\s*N-N-->`，默认 [4000,5000]）。

| 命令 | cmd（main.ts） | user builder（prompts.ts） | 特殊协议 / 参数 | 输出解析与校验 |
| --- | --- | --- | --- | --- |
| /write | cmdWrite 4199 | `buildChapterPrompt`（777） | 规则 13 = CHAPTER_REF_BAN（629，挂点 825）；withSummary（state.use_summaries !== false）→ `summaryTailInstruction`（1263）`<SUMMARY>` 同响应协议；readOutlineWindow back:3 prevRefs；追加/覆盖模式（默认追加），指令经 appendOutlineInstruction 并入大纲并保存 | `parseChapterWithSummary`（1269）——解析失败静默回落延迟生成；`validateStoryTypeFormat`（542）格式不符重试 |
| /continue | cmdContinueWriting 5712 | `buildContinuePrompt`（849） | 注入现有正文尾部 1000 字；规则 10 = CHAPTER_REF_BAN（挂点 895）；withSummary 同上 | 同上 |
| /rewrite | cmdRewriteChapter 5855 | `buildRewritePrompt`（1323） | CHAPTER_REF_BAN（挂点 1355）；withSummary 同上 | 同上 |
| /polish | cmdPolishText 5961 | `buildPolishPrompt`（1405） | 无 CHAPTER_REF_BAN | — |
| /deai | cmdDeaiClean 6030 | `buildDeaiPrompt`（1440） | AI 词命中由 `findAiWordHits` 按外部文件 BANNED_WORDS.md 清单检出（见 §7 禁用词）；逐句「N：改写句」编号行协议；max_tokens=min(8192, 句数×300+1024) 配置封顶，≤2 轮 | 按编号行回填 |
| /fix-refs | cmdFixChapterRefs 6103 | `buildChapterRefFixPrompt`（689） | 同「N：改写句」编号行协议；输入由 `findChapterRefLeaks`（632）检出 | 按编号行回填 |
| /typo | cmdTypoCheck 6774 | `buildTypoScanPrompt`（1754） | system = `TYPO_SCAN_SYSTEM_PROMPT`（1750）；预算 max(cfg, len×2+1024)，3 次重试；**机械任务不注入 identity_boost** | `parseTypoScan`（1773）→ 下划线 span 落盘（唯一有意保留的标记性 span） |
| /review | cmdReviewChapter 6850 | `buildReviewPrompt`（1371） | 非正文路径：`writerSystemPrompt(includeBanned=false)`——不加载禁用词、不注入禁用词块与指南禁用词类目；无 CHAPTER_REF_BAN；上下文按阶段 3 ref_docs 配置框过滤 | — |

### 6.2 辅助任务

| 任务 | 调用点（main.ts） | system | user prompt | 参数 / 校验 |
| --- | --- | --- | --- | --- |
| 章节摘要（延迟生成） | onload 回调 101 | `CHAPTER_SUMMARY_SYSTEM_PROMPT`（prompts.ts:1291） | `buildChapterSummaryPrompt`（1294，200~300 字，viaOutline 变体） | max_tokens=600、temp=0.4、reasoning_effort="none"；不注入 identity_boost |
| 卷摘要（延迟整体重建） | onload 回调 125 | `VOL_SUMMARY_SYSTEM_PROMPT`（902） | `buildVolRebuildPrompt`（911，400~600 字，以该卷成员章《章节摘要》为输入） | max_tokens=900；不注入 identity_boost |
| /analyze-cast | cmdAnalyzeCast 1658 | `CAST_ANALYZE_SYSTEM_PROMPT`（cast_analyzer.ts:51） | `buildCastChapterPrompt`（cast_analyzer.ts:55） | JSON 输出，格式不符重试 ×3（formatRetryNote）；不注入 identity_boost |
| 剧本转换 | LLM 调用 2702（fn 2668，system 组装 2689） | `buildStoryTypeSystemPrompt({storyType:"剧本"})`（prompts.ts:507） | user prompt 内联数组 | max_tokens=max(4000, len×2)、temp 0.7，`validateStoryTypeFormat` 不符时 0.6 重试一次 |
| 连通测试 | cmdLlmTest 2840 | —（GET /models，无提示词） | — | — |

## 7. 横切机制速查

- **张力规则（书内「案头资料/张力规则.md」）**：大纲路径挂【创作规范】块后、策划指南路径挂【书籍信息】后、world 块前且文案「生成策划指南时必须遵循」——v0.2.24+ prompt_files 装配改造后由**调用方的 specs** 注入（旧 volOutlineContextParts / bookOutlineContextParts / planningGuideContextParts 注入行号已退役）；**不进正文写作命令提示词**。全部运行时调用点生成前 `await this.loadTensionRules(story)`（读书内文件、建书随十件套播种、运行时缺失先补播种内置默认、仍缺失/为空回落内置默认）；export-ai-prompts 预览同口径。
- **禁用词（BANNED_WORDS.md）**：运行时唯一来源＝插件数据目录 BANNED_WORDS.md——每次启动 `ensureBannedWordsFile`（main.ts:2327，onload:140）仅缺失时以内置默认播种写盘；`loadBannedWords`（2339）严格读盘，缺失/为空不回落内置（console.warn，内置词仅作播种内容参考）。注入点**仅正文写作路径**：`writerSystemPrompt(includeBanned=true)`（main.ts:3151）→ `buildStoryTypeSystemPrompt({bannedData, bannedGuideText})` → `buildMergedBannedBlock`（banned_words.ts:484，prompts.ts:510 条件组装）生成【禁用词】块；bannedGuideText＝各层指南「禁用词」类目合并文本（`loadWriterGuides` 返回，main.ts:3132）；非正文 LLM 路径（对话/大纲/策划/deai/repair/export 预览）一律不加载，且其【创作规范】用剥离禁用词类目的 `guideCleanText`（`stripGuideCategoryBlock`，banned_words.ts:333；防双份注入）。AI 词检测路径（autoCleanAi /deai/export-preview）另用该清单做命中检出（`findAiWordHits` banned_words.ts:190 / `findAiSentences` 233）。
- **CHAPTER_REF_BAN**（prompts.ts:629）：注入点仅三处——buildChapterPrompt 规则 13（825）、buildContinuePrompt 规则 10（895）、buildRewritePrompt（1355）；polish/deai/review 不含。
- **摘要同响应协议**（v0.2.21+）：`summaryTailInstruction`（1263，私有）供 /write /continue /rewrite（withSummary）在正文末尾追加 `<SUMMARY>` 块要求；`parseChapterWithSummary`（1269）解析，失败静默回落延迟生成管线。
- **目标文档永不注入自身生成上下文**：大纲/策划各路径的调用方 specs（`assemblePromptFiles`）均不含正在生成的文档（全量或紧凑索引）；已有章节(+摘要)也不进大纲/策划生成——只依据世界观＋策划指南等既定事实。
- **引用文档配置（ref_docs，v0.2.25+）**：`WritingPhase.ref_docs?: string[]`（plugin_config.ts:30）——每阶段一个引用文档配置框（设置页「写作阶段模型配置」各阶段「引用文档」子标签），条目＝内置文档 key（`REF_DOC_LABELS`/`PHASE_REF_DOC_CATALOGS`/`PHASE_REF_DOC_DEFAULTS`，plugin_config.ts:34/54/81）或 `file:<vault 路径>` 自定义文档或 `skill:<技能名>`（v0.2.27+）。运行时门控入口 `phaseRefDocKeys(phaseIdx)`（main.ts:2844）：`undefined`＝该阶段默认清单（不回填存储）、`[]`＝仅锁定项不注入可选文档；**数组顺序即装配顺序**（排前的先组装，设置页显示序号 + ↑/↓ 调整）。`assembleVolOutlineContext`（4641，默认 phaseIdx=1、AI 拆分路径传 2）、`assembleWritingDocGroups`（4676，默认 phaseIdx=3）、`buildPlanningGuideInput`（4935，阶段 0）三处共用 `orderRefDocSpecs(pairs, ref, opts)`（2852）按清单顺序映射 specs（opts：`guideKey`＝锁定创作规范键、`fileGroup`＝正文族分组、`skipSkills`＝跳过 `skill:` 条目），`file:` 条目渲染为【引用文档 · <路径>】块、`skill:` 条目渲染为【技能 · <名称>】块（stripHeading 剥起始标题行）、注入位置＝清单位置。**三级写作指南锁定注入**：阶段 1/2 经【创作规范】spec 恒保留（大纲/策划路径 unshift 固定第一块）、阶段 3 经 system 侧【创作规范】、阶段 0 经 `HDR_GUIDE_PLANNING`（main.ts:53）——均不受 ref_docs 开关影响。/review 与对话命令按**阶段 3** 配置框口径；export-ai-prompts 预览与运行时同口径。**技能条目（v0.2.27+）**：`skill:<技能名>` 读 `<work_dir>/SKILLS/<技能名>.md`（读写全走 vault adapter、不经 story manager，防 ensureLayout 迁移；见 [agents/l3-skills.md](./agents/l3-skills.md)）。注入分两档——阶段 0/1/2 按清单顺序进上下文（【技能 · name】块，同 `file:` 机制）；**阶段 3 例外**：正文族装配 `assembleWritingDocGroups` 传 `skipSkills:true` 跳过，改由 `writerSystemPrompt` 经 `loadSkillsBlock(3)` 注入 system prompt（防双注入，详见 §2 正文路径条）；对话面板装配也走 skipSkills＝不注入技能。

## 8. 完整性交叉核对：export-ai-prompts 18 节

`cmdExportPrompts`（main.ts:6553）的 features 清单（6559–6577）与 `buildPromptExportDoc`（6597）各 `trySec("…")` 标题**逐字节一致**（含 · 两侧空格），任一处改动须同步另一处，否则该功能点被静默跳过。每节头部行标注该命令所属阶段的模型配置（`exportPhaseName`，6526）。预览的上下文装配与运行时同口径（含 ref_docs 门控，见 §7）。

**章域 8 节**：

| # | 标题（trySec 行号） | 备注 |
| --- | --- | --- |
| 1 | 创作章节 (/write)（6642） | 有正文也导出（附注）；仅无章节大纲时跳过 |
| 2 | 续写当前章 (/continue)（6678） | `checkOutlineCoverage`（prompts.ts:1571）allCovered 时跳过 |
| 3 | 重写当前章 (/rewrite)（6714） | |
| 4 | 润色当前章 (/polish)（6742） | |
| 5 | 去AI化当前章 (/deai)（6756） | AI 词命中按外部文件 BANNED_WORDS.md 清单检出（见 §7 禁用词）；max_tokens=min(8192, 句数×300+1024) 配置封顶，≤2 轮 |
| 6 | 修正章节引用 (/fix-refs)（6783） | |
| 7 | 错别字检测 (/typo)（6808） | 预算 max(cfg, len×2+1024)，3 次重试，parseTypoScan |
| 8 | 审阅当前章 (/review)（6824） | |

**大纲域 7 节**（v0.2.25+ 新增大事件列表节、v0.3.3+ 改名时间线节、v0.2.27+ 新增世界观节）：

| # | 标题（trySec 行号） | 备注 |
| --- | --- | --- |
| 9 | 生成世界观 (/worldview-generate)（6852） | v0.2.27+；premise 按盘上 `state.one_line`（空则占位符注明）；system = `WORLDVIEW_GEN_SYSTEM_PROMPT` 组装（见 §3） |
| 10 | 生成时间线（策划指南前置自动生成）（7004） | 非独立命令——`ensureTimeline` 前置自动生成的调试预览；system = `TIMELINE_GEN_SYSTEM_PROMPT` 组装（v0.3.3+ 替代旧「生成大事件列表」节） |
| 11 | 生成策划指南（仅世界观） (/planning-guide-worldview)（6887） | system 复用 BOOK_OUTLINE_GEN_SYSTEM_PROMPT |
| 12 | 生成书籍大纲 (/book-outline-generate)（6904） | 有卷模式预览按 `vols.length \|\| defaultCount` 作卷数基准（v0.2.x+ 有卷弹窗问卷数量，见 §4.2） |
| 13 | 自动生成卷大纲 (/vol-outline-generate)（6935） | 只给 step 1（卷设计）＋ step 2（第1章，占位） |
| 14 | 从书级大纲生成卷 (/book-outline-to-volumes)（6964） | **恒跳过**——批量流程无法单段预览 |
| 15 | 从卷大纲生成章节·AI 拆分兜底 (/vol-outline-to-chapters)（6967） | |

**摘要域 3 节**：

| # | 标题（trySec 行号） | 备注 |
| --- | --- | --- |
| 16 | 分析人物与场景 (/analyze-cast)（7010） | JSON 重试 ×3（formatRetryNote） |
| 17 | 章节摘要（上下文组装时延迟生成）（7036） | summaryPlaceholder="（此处有摘要，尚未生成）" |
| 18 | 卷摘要（上下文组装时延迟整体重建）（7055） | |

导出默认章数 `defaultCount=max(chapters.length,1)`。本矩阵 §3–§6 覆盖的运行时调用点与这 18 节一一对应（阶段 0/1/2 各入口＋阶段 3 全部命令与辅助任务），无遗漏项。
