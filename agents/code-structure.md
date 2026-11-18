# 代码结构总览（横切参考）

本文是**源码物理结构**的横切地图：构建产物链、`src/` 各模块职责与行数、模块依赖分层、`src/main.ts` 内部区块定位、根目录遗留文件、已知重复与债务。功能语义与行为约定不在这里，按 [l1-overview.md](./l1-overview.md) 功能路由进 L2/L3。行号以 prompt_files 装配重构后的工作树为基准（`0fcf4c9` 之后），改动大文件后就近修订。

## 构建与产物链

```
src/main.ts ──esbuild(bundle)──▶ release/main.js ──非生产构建再拷──▶ dist/main.js
                 ▲ tsc -noEmit 先行门禁（npm run build = tsc + esbuild --production）
```

- **唯一入口 `src/main.ts`**；`tsconfig.json` include 仅 `src/**/*.ts`——根目录遗留 `.ts` 不参与编译（见「根目录遗留文件」）。
- `esbuild.config.mjs`：`bundle:true`、`format:cjs`、`target:es2018`（iOS Safari <16.4 约束，**正则不得用 lookbehind 断言**）、`external` = obsidian / electron / @codemirror/* / @lezer/* / node 内置模块；`loader: {".md":"text"}` 把 `docs/使用说明.md` 等文档以纯文本内联进包（首启运行时播种，见 `src/*_default.ts`）。
- `release/` = 可分发目录（**gitignore**）：构建后自动拷入 `manifest.json`、`styles.css`；`dist/` 同步一份 `main.js` 供社区目录校验器（同样 gitignore）。v0.3.5+：写作指南体系整体废弃，根 `WRITING_GUIDE.md`/`docs/WRITING_GUIDE_template.md`/`docs/guide-types/` 已从仓库删除、对应 import 同步移除。
- 门禁：`npm run build`（tsc 零错误）+ `npm run lint`（eslint 仅四类 `no-unsafe-*` 为 error，见 eslint.config.mjs）；另有 advisory 扫描 `npm run lint:obsidianmd`（eslint-plugin-obsidianmd recommended，配置 `eslint.obsidianmd.mjs`，约定见 process-rules.md「验证要求」）；`npm test` 用 esbuild 把 `package.json` 里 entries 列出的全部 `src/*.test.ts`（现 10 个）打包成 mjs 交 `node --test`——**新增测试文件必须同时加进 entries**，否则不会被执行。
- 约定：`src/` 不用超出 lib ES2018 的 API（flatMap/trimEnd/matchAll 均被 lint 拦），详见 [process-rules.md](./process-rules.md)「验证要求」。

## `src/` 模块职责表（行数为当前值）

| 模块 | 行 | 职责 | 关键导出 |
| --- | --- | --- | --- |
| `main.ts` | 9593 | 插件入口＋全部命令实现＋面板装配＋设置页（内部区块见下节） | `default ArticleWriterPlugin` |
| `story_manager.ts` | 4028 | 磁盘结构层：书/卷/章实体目录与文档的 CRUD、状态文档、章节重排顺延（号码算术调 `chapter_moves.ts`）、打包合集（跨容器选择连续重编号）、扫描重建 | `StoryManager`、`CHAPTER_SUFFIX_TO_BASE`、`WritingDocPaths`、章节/卷读写全套、`writeDoc`（v0.4.6+ public） |
| `chapter_moves.ts` | 55 | 章节重排**纯决策层**（v0.4.6+ C10，无 obsidian 依赖）：`planRenumber`（容器内补洞压缩 1..N，升序单遍只挪变号章）、`hasAnyGap`（断档判定）、`planInsert`（插章冲突→降序顺延规划）；搬移/快照/引用重写仍在 story_manager，执行序必须与 plan 一致 | `planRenumber`、`hasAnyGap`、`planInsert` |
| `prompts.ts` | 1763 | 各生成阶段提示词组装（纯函数，不触 Vault/LLM）：编写章节、大纲族、策划指南、人物分析、deai/查重/错字等；上下文入参收 `bookDocs/volDocs/chapterDocs` 预装配文档串 | `build*Prompt`、各 `*_SYSTEM_PROMPT`、`CleanReport`、`cleanRelationshipsDoc` |
| `md_docs.ts` | 1115 | MD 文本解析/序列化：人物/场景/关系/伏笔/世界观字段级 parse↔format、章选解析、拆分卷大纲 | `CharacterDoc/SceneDoc/…`、`parse*/format*`、`splitVolOutlineByChapter`（v0.4.3+ 同族 `sliceVolOutlineChapters`：按章号窗口取块，供编写文章阶段前后 N 章大纲节选） |
| `modals.ts` | 1931 | 通用弹窗库（27 个导出 Modal/SuggestModal，含 v0.4.3+ `InspirationKitModal` 灵感工具包弹窗） | `TextInputModal`、`ActionMenuModal`、`TextPanelModal`、`ConfirmModal`、`InspirationKitModal`… |
| `relationship_view.ts` | 795 | 人物关系面板（ItemView，SVG 图＋列表；v0.4.4+ 图表的节点坐标、分级与弧线 path 不再就地算，改调 `graph_layout.ts`） | `RelationshipView`、`RelSnapshot` |
| `status_view.ts` | 806 | 「写字台」面板（ItemView，书/卷/章树＋动作分发；v0.4.3+ 案头资料右键「灵感工具包…」） | `StatusView`、`StatusAction`、`StatusSnapshot` |
| `timeline_view.ts` | 771 | 时间线面板（ItemView；定位到文档行改走共用件 `editor_nav.revealEditorLine`） | `TimelineView`、`TlSnapshot` |
| `story_types.ts` | 557 | 题材指南选取、大纲详略标记、MD5（摘要过期检测）、AI 词标记剥离 | `getStoryTypeGuide`、`md5`、`stripAiWordMarks` |
| `cast_analyzer.ts` | 516 | `analyze-cast` 纯逻辑：逐章 JSON 聚合、span 定层、同名合并 | 聚合/定层函数 |
| `outline_cast.ts` | ~290 | 大纲阶段人物/关系增量分层（v0.4.3+）：附录要求/拆分、`OutlineCastTracker` 逐章定层与增量写盘计划 | `OutlineCastTracker`、`splitOutlineCastAppendix`、`outlineCastAppendixInstruction` |
| `graph_layout.ts` | 436 | 人物关系图（图表模式）纯几何＋纯排序（v0.4.4+，无 DOM/无 vault）：`nodeRadius`/`labelFontSize`（按连线数分级）、`hubOf`（连线最多者＝枢纽）、`adjacencyMap`、`chainOrder`（贪心邻接链、旋转到枢纽居首）、`forceLayout`（**默认布局**：退火式力导向→硬碰撞消解→以枢纽为锚点两轴摊满画布→枢纽挪回锚点（`alignShift`）→逐点夹进画布；`hubUp` 即「把主角向上提」）、`ringLayout(count,cx,cy,rx,ry,degrees)`（椭圆环，留作对照）、`edgeCurvePath(a,b)` 出 SVG path `d`＝**向上拱的二次贝塞尔弧**（控制点＝弦两法向里朝上（−y）的一支，凸出量夹 [12,50]＝弦长·0.18，并按上边界再夹 `bow ≤ 2·(my−TOP_PAD)`；端点按节点半径裁到圆周外并按对方圆周收口；竖直弦固定向右拱）、`curvePoint(d,t)` 弧上取点 | `forceLayout`、`edgeCurvePath`、`chainOrder`、`adjacencyMap`、`nodeRadius`、`labelFontSize` |
| `llm_chat_view.ts` | 500 | 聊天面板（ItemView，流式、工具注入） | `LlmChatView` |
| `banned_words.ts` | 291 | 禁用词清单解析（唯一事实源＝`SKILLS/网文高频禁用词清单.md`，v0.3.6+ Skill 化）、句式简化、AI 词检测标红（纯函数） | `BannedWordsData`、`findAiWordHits`（~~`buildBannedWordsBlock`/`buildMergedBannedBlock`~~ 专用注入函数已随 v0.3.6+ 禁用词 Skill 化删除、~~`stripGuideCategoryBlock`~~ 曾用于剥指南「禁用词」类目，已随 v0.3.5+ 写作指南体系整体废弃删除） |
| `llm_client.ts` | 382 | OpenAI 兼容 chat/completions 封装（流式/非流式、错误装饰、前缀缓存读数） | `chatCompletion`、`chatStream`、`readCacheStats`/`cacheStatsText`、`LlmConfigDoc` 消费 |
| `prompts.test.ts` 等 14 个 `*.test.ts` | 288 起 | 纯函数单测（node --test，`npm test` 的 entries 列表在 package.json）；v0.4.3+ 新增 `llm_client.test.ts`（缓存读数口径）、`cast_analyzer.test.ts`（逐章分析钉点落点）、`deai_ledger.test.ts`（AI 味清单渲染与状态回填）、`inspiration.test.ts`（灵感文档解析↔渲染/按行增删往返、CRLF 保住换行风格）；v0.4.4+ 新增 `graph_layout.test.ts`（力导向确定性／点全落在画布内／枢纽居首且摆到中心偏上／圆点互不重叠／弧一律向上拱且不越顶边／端点裁到圆周外与两圆重叠时不推过头／交换端点侧向一致）；v0.4.6+ 新增 `chapter_moves.test.ts`（补洞升序单遍／插章降序顺延／断档判定）。**新增测试文件必须同时加进 package.json 的 entries** | — |
| `gen_progress_view.ts` | 279 | 统一「生成过程」流式面板 | `GenProgressView`（implements `WritingStreamSink`） |
| `state_doc.ts` | 200 | `状态.md` 文档 ↔ `StoryState` 序列化/解析、`chKey` 复合键 | `formatStateDoc/parseStateDoc`、`chKey/parseChKey` |
| `inspiration.ts` | 203 | 灵感工具包（v0.4.3+）：书级《案头资料/灵感/灵感.md》**纯数据结构＋纯解析/渲染＋按行增删**（无 IO、不 import obsidian）：`InspirationBlock{heading,name,date,body,line,endLine}`、`parseInspirationDoc`（只按 `##` 切块、`###` 属块内）、`renderInspirationBody/Block`（模板→块：丢 H1 与注释、`#`/`##` 降为 `###`、替换 `{{name}}/{{date}}/{{time}}`）、`append/remove/renameInspirationBlock`、`inspirationPreview/inspirationMatches`、`normalizeInspirationName`、`inspirationDate`；写回保住原文件 eol | `parseInspirationDoc`、`renderInspirationBlock`、`INSPIRATION_DOC_NAME`、`INSPIRATION_FOLDER_NAME`、`INSPIRATION_SKILL_NAME` |
| `plugin_config.ts` | 160 | 设置持久化读写（`data.json` → LlmConfigDoc 列表等） | `PluginConfig` |
| `prompt_files.ts` | 105 | 提示词文件组装器：调用方声明有序 `PromptSpec[]`（file/text 条目），按序读取（注入 reader）→清洗（去注释/剥标题行/transform）→去重（路径先到先赢＋清洗后同文跳过）→header 分节包装→join 成完整块串 | `assemblePromptFiles`、`PromptSpec`、`AssembledPrompt`、`PromptFileReader` |
| `editor_nav.ts` | 32 | 「在编辑器里打开文档并定位到某一行」共用件（v0.4.3+，灵感工具包／时间线面板共用）：置光标＋滚到视口中央，0/250ms 两次尝试躲开编辑器装载完成慢 | `openFileAtLine`、`revealEditorLine` |
| `deai_ledger.ts` | 139 | 连续编写 AI 味登记表（v0.4.3+）：`DeaiLedger`/`DeaiLedgerEntry` 数据结构＋《案头资料/AI味清单.md》纯渲染（状态图标、汇总、句子折叠、每节机器可读键行 `<!-- aw-deai-key:… -->`）＋`parseDeaiLedgerDoc` 回读解析（供「补做去AI味」续做中途停止的章），无 IO | `renderDeaiLedger`、`parseDeaiLedgerDoc`、`ledgerCounts`、`DEAI_LEDGER_DOC_NAME` |
| `usage_guide_default.ts` | 8 | `.md=text` 内联文档的唯一导出壳（docs/使用说明.md → work_dir《使用说明.md》）。`tension_rules_default.ts` 已随 v0.4.3+ 张力规则并入张力工具箱删除；`banned_words_default.ts` 已随 v0.3.6 禁用词 Skill 化删除 | 文本常量 |
| `md.d.ts` | 4 | `*.md` 模块声明（配 loader） | — |

## 依赖分层（相对 import，实测无环）

```
L0 叶子（零内部依赖）: md_docs, state_doc, story_types, plugin_config, banned_words, inspiration, *_default, md.d.ts
L1: llm_client(→plugin_config) · prompts(→md_docs,banned_words,story_types) · prompt_files(→md_docs) · cast_analyzer(→md_docs,state_doc) · editor_nav(→仅 obsidian)
    视图: status_view(→prompts,story_types,inspiration) · relationship_view(→md_docs,graph_layout) · timeline_view(→md_docs,editor_nav)
    modals(→pipeline,md_docs,state_doc,skills_default,inspiration) · llm_chat_view(→llm_client,modals,plugin_config)
L2: story_manager(→md_docs,state_doc,prompts,cast_analyzer,story_types)
L3: main.ts(→其余全部)          prompts.test.ts(→prompts)
```

要点：`prompts ← story_manager` 单向（manager 只消费组装结果/`CleanReport`）；`banned_words` 不依赖任何人，词表注入走 `prompts` 中转；视图不 import manager，快照经 main.ts `getStatusSnapshot/getRelationshipSnapshot/getTimelineSnapshot` 拉取、动作经 `handleStatusAction` 回调。

## `src/main.ts` 内部区块图（9197 行单文件）

> 下表行号是**历史快照、长期滞后于文件增长**（多轮改动后只更新新条目）。要定位真实位置请用区块注释：`grep -n '^	// ---------- ' src/main.ts`。

| 区块 | 行 | 内容 |
| --- | --- | --- |
| 头部 | 1–65 | imports、`DEFAULT_SETTINGS`(L40)、`RELATION_TYPE_OPTIONS`(L48)、`HDR_*` 大纲族块 header 常量(L50 附近，assembleVolOutlineContext specs 与 book 族旗标判定共用) |
| `ArticleWriterPlugin` | 66–6779 | 约 140 个方法，`onload` L83–273 注册 **70 条 `addCommand`**＋视图/事件/ribbon |
| ├ 设置与守卫 | 274–304 | `loadSettings/saveSettings` |
| ├ 工作目录/切书 | 305–564 | `noteWsIoError`(L311)、`bookWorkspacePath`(L321)`/captureBookWorkspace/loadBookWorkspace/applyStorySwitch/pickWorkDir/cmdSwitchStory`(L435) |
| ├ 卷结构命令 | 565–764 | `cmdVolumeMode`(L565)`/cmdOrganizeVolumes`(L611) |
| ├ 输入助手 | 765–860 | `prompt/pickNewDoc`(L849)`/promptChapterCountInput`(L782)`/promptOutlineGenMode/promptPrevChaptersInput/promptAllVolumeChapterCounts` |
| ├ 书/章基础命令 | 861–1146 | `cmdNewStory`(L863)`…cmdStatus`(L1042)、标签与错误助手、`pickAction/confirmBox` |
| ├ 卷/场景/人物/伏笔/世界命令 | 1147–2032 | `cmdVolume*`(L1149)`/cmdScene*`(L1345)`/cmdCharacter*`(L1521)`/cmdAnalyzeCast`(L1662)`/cmdForeshadow*`(L1869)`/cmdWorld*`(L1955)、大纲追加/章大纲打开(L1989) |
| ├ 章节管理/打包 | 2033–2264 | `cmdChapterDelete`(L2053)`/Rename/Renumber/cmdPack*`(L2133)`/cmdRescanStory`(L2202) |
| ├ 文档生命周期 | 2265–2810 | `cmdCompleteState`(L2279)`/cmdSetWordRange`(L2323，v0.3.5+ 字数区间命令，写《故事状态.md》`word_range`)`/purgeWritingGuideArtifacts`(L2357，v0.3.5 启动清理：各层 WRITING_GUIDE.md＋《写作指南汇总.md》＋插件数据目录 guide-types/＋data.json 遗留字段)`/wordRangeOf`(L2398)`/tensionRulesPath`(L2405)`/bannedWordsPath`(L2423)`/promptReader`(L2727)`/cmdGenerateUsageDoc`(L2793，借用 story_manager `readGuideAt`/`writeGuideAt` 做指定路径文档读写) |
| ├ LLM 装配 | 2915–3300 | `getPhaseLlmSetup`(L2915)`/cmdLlmTest`(L2994)`/openAddCharacterDialog`(L3118)`/loadSkillsBlockFrom`(L2580，v0.4.2+ 系统级与书籍级技能块共用装配)`/loadSkillsBlock`(L2596)`/loadBookSkillsBlock`(L2646)`/writerSystemPrompt`(L3293；v0.3.5+：旧 `loadWriterGuides` 三层指南加载已随写作指南体系废弃删除) |
| ├ 面板快照/动作 | 3076–3916 | `schedule*Refresh` 防抖、`get*Snapshot`(L3129)、`handleStatusAction`(L3355 起巨型分发) |
| ├ 生成执行层 | 3917–4174 | `genFailure`(L3917)`/stream 封装`、`decorateLlmError`(L4113)`、notifyAiReport`(L4152)、字数/引用告警 |
| ├ 写作命令族 | 4175–6064 | `cmdWrite`(L4177)、`assembleVolOutlineContext`(L4519)`/assembleWritingDocGroups`(L4550) 装配 helper、`cmdVolumeOutlineToChapters`(L4402)、卷/书大纲族（`genVolOutlineIncremental` L4059 等）、`cmdWriteConsecutive`(L5459)`/cmdContinueWriting`(L5575)`/cmdRewriteChapter`(L5718)`/cmdPolishText`(L5824)`/cmdDeaiClean`(L5893)`/cmdFixChapterRefs`(L5966) |
| ├ 灵感工具包（v0.4.3+，实测行号） | 4981–5132 | `inspirationFolderPath`/`inspirationDocPath`/`readInspirationDoc`/`writeInspirationDoc`/`inspirationTemplate`/`cmdInspirationKit(storyName?)`/`locateInspiration`/`cmdNewInspiration`/`cmdRenameInspiration`/`cmdDeleteInspiration`/`findInspirationBlock`（纯逻辑与增删在 `src/inspiration.ts`，见 [l3-inspiration-impl.md](./l3-inspiration-impl.md)） |
| ├ export-ai-prompts | 6065–6614 | `fenceBlock`(L6065)`/exportSection`(L6076)`/cmdExportPrompts`(L6098 巨型导出器) |
| └ 审校命令 | 6615–6779 | `cmdTypoCheck`(L6615)`/cmdReviewChapter`(L6691) |
| `StatusModal` | 6780–6794 | 状态文本弹窗（与 `modals.TextPanelModal` 功能重复，见债务） |
| `ArticleWriterSettingTab` | 6976–7500 | 设置页：`getSettingDefinitions` 声明式渲染＋「LLM 配置」tab 区块自定义 render（固定两 tab：全局设置页 + 模型配置页列表/详情两形态，`renderLlmGlobalTab`/`renderLlmConfigList`/`renderLlmConfigDetail`，模型增删/改名/上下移；改名走 `plugin_config.renameLlmConfig`＋`refreshLlmNameSelects()` 就地重刷页面上的「模型配置」下拉（见 l3-settings-page） |

## 根目录遗留文件（git 已跟踪、不参与构建）

| 文件 | 大小 | 状态 |
| --- | --- | --- |
| `main.ts` | 416KB / 7052 行 | src/ 拆分前的旧单文件全量拷贝，**已陈旧**（src/main.ts 现为 9197 行） |
| `llm_chat_view.ts` | 24KB | 同上旧拷贝 |
| `plugin_config.ts` | 3.8KB | 同上旧拷贝 |
| `main.js` | 2.1MB | 旧构建产物直接躺在仓库根（现产物在 release//dist/，均 gitignore） |

`tsconfig include=src/**/*.ts` 与 esbuild `entryPoints=["src/main.ts"]` 证明四者零引用；**清理候选**——删除需用户确认（AGENTS.md 未声明保留理由）。

## 已知重复与债务（改动时顺手收敛，勿新增同类）

- `clampNum` 两处重复：`relationship_view.ts:118`、`timeline_view.ts:46`。
- 章节后缀→基础名映射近似重复：`status_view.ts:5 CH_SUFFIX_TO_BASE` ≈ `story_manager.ts:103 CHAPTER_SUFFIX_TO_BASE`（键集略有出入，改命名规则两处都要查）。
- `StatusModal`（main.ts:6780）与 `modals.TextPanelModal`（modals.ts:530）功能重复，新弹窗优先用后者。
- `main.ts` 7946 行：命令实现与插件壳未分离；若拆分，第一刀候选是 export-ai-prompts（L6221–6794）与写作命令族（L3038–6220）下沉独立模块。
- 70 条 `addCommand` 手写散布 onload：若再频繁增删命令，可收敛为 id→实现注册表（command-reference.md 与命令面板双处维护成本）。
