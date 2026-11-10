# 代码结构总览（横切参考）

本文是**源码物理结构**的横切地图：构建产物链、`src/` 各模块职责与行数、模块依赖分层、`src/main.ts` 内部区块定位、根目录遗留文件、已知重复与债务。功能语义与行为约定不在这里，按 [l1-overview.md](./l1-overview.md) 功能路由进 L2/L3。行号以 prompt_files 装配重构后的工作树为基准（`0fcf4c9` 之后），改动大文件后就近修订。

## 构建与产物链

```
src/main.ts ──esbuild(bundle)──▶ release/main.js ──非生产构建再拷──▶ dist/main.js
                 ▲ tsc -noEmit 先行门禁（npm run build = tsc + esbuild --production）
```

- **唯一入口 `src/main.ts`**；`tsconfig.json` include 仅 `src/**/*.ts`——根目录遗留 `.ts` 不参与编译（见「根目录遗留文件」）。
- `esbuild.config.mjs`：`bundle:true`、`format:cjs`、`target:es2018`（iOS Safari <16.4 约束，**正则不得用 lookbehind 断言**）、`external` = obsidian / electron / @codemirror/* / @lezer/* / node 内置模块；`loader: {".md":"text"}` 把 `docs/使用说明.md` 等文档以纯文本内联进包（首启运行时播种，见 `src/*_default.ts`）。
- `release/` = 可分发目录（**gitignore**）：构建后自动拷入 `manifest.json`、`styles.css`；`dist/` 同步一份 `main.js` 供社区目录校验器（同样 gitignore）。`WRITING_GUIDE.md` 不再随包发布。
- 门禁：`npm run build`（tsc 零错误）+ `npm run lint`（eslint 仅四类 `no-unsafe-*` 为 error，见 eslint.config.mjs）；另有 advisory 扫描 `npm run lint:obsidianmd`（eslint-plugin-obsidianmd recommended，配置 `eslint.obsidianmd.mjs`，约定见 process-rules.md「验证要求」）；`npm test` 用 esbuild 把 `src/prompts.test.ts` 就地打包成 mjs 交 `node --test`（唯一测试文件）。
- 约定：`src/` 不用超出 lib ES2018 的 API（flatMap/trimEnd/matchAll 均被 lint 拦），详见 [process-rules.md](./process-rules.md)「验证要求」。

## `src/` 模块职责表（行数为当前值）

| 模块 | 行 | 职责 | 关键导出 |
| --- | --- | --- | --- |
| `main.ts` | 7500 | 插件入口＋全部命令实现＋面板装配＋设置页（内部区块见下节） | `default ArticleWriterPlugin` |
| `story_manager.ts` | 3932 | 磁盘结构层：书/卷/章实体目录与文档的 CRUD、状态文档、章节重排顺延、打包合集、扫描重建 | `StoryManager`、`CHAPTER_SUFFIX_TO_BASE`、`WritingDocPaths`、章节/卷读写全套 |
| `prompts.ts` | 1763 | 各生成阶段提示词组装（纯函数，不触 Vault/LLM）：编写章节、大纲族、策划指南、人物分析、deai/查重/错字等；上下文入参收 `bookDocs/volDocs/chapterDocs` 预装配文档串 | `build*Prompt`、各 `*_SYSTEM_PROMPT`、`CleanReport`、`cleanRelationshipsDoc` |
| `md_docs.ts` | 1115 | MD 文本解析/序列化：人物/场景/关系/伏笔/世界观字段级 parse↔format、章选解析、拆分卷大纲 | `CharacterDoc/SceneDoc/…`、`parse*/format*`、`splitVolOutlineByChapter` |
| `modals.ts` | 1003 | 通用弹窗库（16 个 Modal/SuggestModal） | `TextInputModal`、`ActionMenuModal`、`TextPanelModal`、`ConfirmModal`… |
| `relationship_view.ts` | 781 | 人物关系面板（ItemView，SVG 图＋列表） | `RelationshipView`、`RelSnapshot` |
| `status_view.ts` | 773 | 「写字台」面板（ItemView，书/卷/章树＋动作分发） | `StatusView`、`StatusAction`、`StatusSnapshot` |
| `timeline_view.ts` | 566 | 时间线面板（ItemView） | `TimelineView`、`TlSnapshot` |
| `story_types.ts` | 557 | 题材指南选取、大纲详略标记、MD5（摘要过期检测）、AI 词标记剥离 | `getStoryTypeGuide`、`md5`、`stripAiWordMarks` |
| `cast_analyzer.ts` | 505 | `analyze-cast` 纯逻辑：逐章 JSON 聚合、span 定层、同名合并 | 聚合/定层函数 |
| `llm_chat_view.ts` | 500 | 聊天面板（ItemView，流式、工具注入） | `LlmChatView` |
| `banned_words.ts` | 510 | 禁用词清单解析（运行时唯一来源＝数据目录 BANNED_WORDS.md）、句式简化、AI 词检测标红（纯函数） | `BannedWordsData`、`buildMergedBannedBlock`、`findAiWordHits`、`stripGuideCategoryBlock` |
| `llm_client.ts` | 306 | OpenAI 兼容 chat/completions 封装（流式/非流式、错误装饰） | `chatCompletion`、`streamOnce`、`LlmConfigDoc` 消费 |
| `prompts.test.ts` | 288 | prompts 纯函数单测（node --test） | — |
| `gen_progress_view.ts` | 279 | 统一「生成过程」流式面板 | `GenProgressView`（implements `WritingStreamSink`） |
| `state_doc.ts` | 200 | `状态.md` 文档 ↔ `StoryState` 序列化/解析、`chKey` 复合键 | `formatStateDoc/parseStateDoc`、`chKey/parseChKey` |
| `plugin_config.ts` | 160 | 设置持久化读写（`data.json` → LlmConfigDoc 列表等） | `PluginConfig` |
| `prompt_files.ts` | 105 | 提示词文件组装器：调用方声明有序 `PromptSpec[]`（file/text 条目），按序读取（注入 reader）→清洗（去注释/剥标题行/transform）→去重（路径先到先赢＋清洗后同文跳过）→header 分节包装→join 成完整块串 | `assemblePromptFiles`、`PromptSpec`、`AssembledPrompt`、`PromptFileReader` |
| `guide_types_default.ts` | 39 | 内置题材类型指南文本（播种） | 常量 |
| `usage_guide_default.ts` 等 4 个 `*_default.ts` | 各 8 | `.md=text` 内联文档的导出壳（usage/tension/guide_template/banned_words） | 文本常量 |
| `system_guide_default.ts` | 7 | 系统级写作指南内联文本导出 | 文本常量 |
| `md.d.ts` | 4 | `*.md` 模块声明（配 loader） | — |

## 依赖分层（相对 import，实测无环）

```
L0 叶子（零内部依赖）: md_docs, state_doc, story_types, plugin_config, modals, banned_words, *_default, md.d.ts
L1: llm_client(→plugin_config) · prompts(→md_docs,banned_words,story_types) · prompt_files(→md_docs) · cast_analyzer(→md_docs,state_doc)
    视图: status_view(→prompts,story_types) · relationship_view(→md_docs) · timeline_view(→md_docs)
    llm_chat_view(→llm_client,modals,plugin_config)
L2: story_manager(→md_docs,state_doc,prompts,cast_analyzer,story_types)
L3: main.ts(→其余全部)          prompts.test.ts(→prompts)
```

要点：`prompts ← story_manager` 单向（manager 只消费组装结果/`CleanReport`）；`banned_words` 不依赖任何人，词表注入走 `prompts` 中转；视图不 import manager，快照经 main.ts `getStatusSnapshot/getRelationshipSnapshot/getTimelineSnapshot` 拉取、动作经 `handleStatusAction` 回调。

## `src/main.ts` 内部区块图（7500 行单文件）

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
| ├ 章节管理/打包 | 2033–2264 | `cmdChapterDelete`(L2053)`/Rename/Renumber/cmdPack*`(L2133)`/cmdRescanStory`(L2202)`/cmdCompleteState`(L2215) |
| ├ 指南/文档生命周期 | 2265–2769 | `systemGuidePath`(L2268)`/tensionRulesPath`(L2295)`/bannedWordsPath`(L2320)`/cmdGenerateWritingGuideSummary`(L2359)`/guideTypePath`(L2385)`/promptReader`(L2412)`/assembleGuideTexts`(L2421)`/guideLayers`(L2433)`/aggregatePath`(L2453)`/cmdAgents*`(L2522)`/cmdGenerateWritingGuide`(L2554)`/cmdGenerateUsageDoc`(L2632)`/cmdRegenerateSystemGuide`(L2649) |
| ├ LLM 装配 | 2770–3075 | `getPhaseLlmSetup`(L2773)`/cmdLlmTest`(L2818)`/openAddCharacterDialog`(L2942)`/loadWriterGuides`(L3043，返回三层原文＋bannedGuideText＋guideRawText/guideCleanText)`/writerSystemPrompt` |
| ├ 面板快照/动作 | 3076–3916 | `schedule*Refresh` 防抖、`get*Snapshot`(L3129)、`handleStatusAction`(L3355 起巨型分发) |
| ├ 生成执行层 | 3917–4174 | `genFailure`(L3917)`/stream 封装`、`decorateLlmError`(L4113)`、notifyAiReport`(L4152)、字数/引用告警 |
| ├ 写作命令族 | 4175–6064 | `cmdWrite`(L4177)、`assembleVolOutlineContext`(L4519)`/assembleWritingDocGroups`(L4550) 装配 helper、`cmdVolumeOutlineToChapters`(L4402)、卷/书大纲族（`genVolOutlineIncremental` L4059 等）、`cmdWriteConsecutive`(L5459)`/cmdContinueWriting`(L5575)`/cmdRewriteChapter`(L5718)`/cmdPolishText`(L5824)`/cmdDeaiClean`(L5893)`/cmdFixChapterRefs`(L5966) |
| ├ export-ai-prompts | 6065–6614 | `fenceBlock`(L6065)`/exportSection`(L6076)`/cmdExportPrompts`(L6098 巨型导出器) |
| └ 审校命令 | 6615–6779 | `cmdTypoCheck`(L6615)`/cmdReviewChapter`(L6691) |
| `StatusModal` | 6780–6794 | 状态文本弹窗（与 `modals.TextPanelModal` 功能重复，见债务） |
| `ArticleWriterSettingTab` | 6976–7500 | 设置页：`getSettingDefinitions` 声明式渲染＋「LLM 配置」tab 区块自定义 render（固定两 tab：全局设置页 + 模型配置页列表/详情两形态，`renderLlmGlobalTab`/`renderLlmConfigList`/`renderLlmConfigDetail`，模型增删/改名/上下移） |

## 根目录遗留文件（git 已跟踪、不参与构建）

| 文件 | 大小 | 状态 |
| --- | --- | --- |
| `main.ts` | 416KB / 7052 行 | src/ 拆分前的旧单文件全量拷贝，**已陈旧**（src/main.ts 为 7500 行） |
| `llm_chat_view.ts` | 24KB | 同上旧拷贝 |
| `plugin_config.ts` | 3.8KB | 同上旧拷贝 |
| `main.js` | 2.1MB | 旧构建产物直接躺在仓库根（现产物在 release//dist/，均 gitignore） |

`tsconfig include=src/**/*.ts` 与 esbuild `entryPoints=["src/main.ts"]` 证明四者零引用；**清理候选**——删除需用户确认（AGENTS.md 未声明保留理由）。

## 已知重复与债务（改动时顺手收敛，勿新增同类）

- `clampNum` 两处重复：`relationship_view.ts:111`、`timeline_view.ts:46`。
- 章节后缀→基础名映射近似重复：`status_view.ts:5 CH_SUFFIX_TO_BASE` ≈ `story_manager.ts:103 CHAPTER_SUFFIX_TO_BASE`（键集略有出入，改命名规则两处都要查）。
- `StatusModal`（main.ts:6780）与 `modals.TextPanelModal`（modals.ts:530）功能重复，新弹窗优先用后者。
- `main.ts` 7500 行：命令实现与插件壳未分离；若拆分，第一刀候选是 export-ai-prompts（L6221–6794）与写作命令族（L3038–6220）下沉独立模块。
- 70 条 `addCommand` 手写散布 onload：若再频繁增删命令，可收敛为 id→实现注册表（command-reference.md 与命令面板双处维护成本）。
