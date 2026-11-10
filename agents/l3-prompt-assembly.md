# L3：提示词文件装配（src/prompt_files.ts）

v0.2.24+ 提示词组装重构的实现细节。**改任何 LLM 命令的上下文注入前必读本文件**；各命令的注入面速查见 [PROMPT_MATRIX.md](../PROMPT_MATRIX.md)，模块物理位置见 [code-structure.md](./code-structure.md)。

## 设计口径（已定稿）

- 统一入口 = 「有序条目数组」（`PromptSpec[]`）：每个 LLM 调用者按自己的需要声明所需提示词存储文件的顺序列表；装配器按序加载→清洗→去重→分节包装→join 成完整块串。
- **全部进提示词的上下文文档走文件名直载原文**：不再经 md_docs 结构化解析/渲染（旧 volOutlineContextParts/bookOutlineContextParts/planningGuideContextParts 与 folderDocs/dropOutlineDoc 字段族已退役）。
- **《写作指南汇总.md》退役注入**：三层指南原文文件直接列进 specs；汇总仅留作用户查看产物（persistAggregatedGuide 仍落盘）。
- 包装块标题/裁决语措辞逐字保留旧口径；块顺序由调用方 specs 顺序决定。

## 装配器语义（src/prompt_files.ts，105 行）

- `PromptFileReader = (file) => Promise<string | null | undefined>`：由调用方注入；main.ts `promptReader()`（2463）按路径三路分流——插件数据目录（`.obsidian/plugins/<id>/` 前缀）走 `manager.readPluginFile`，`<work_dir>/SKILLS/` 前缀走 vault adapter（v0.3.0+ 技能文件，**绕 readDoc 防 ensureLayout 迁移**，见 [l3-skills.md](./l3-skills.md)），其余 vault 路径走 `manager.readDoc`（含布局收口）；返回 ""/null 皆按缺失处理。
- `PromptSpec` 字段：`file`（与 `text` 二选一，同给时 file 优先、读不到用 text 兜底；file 同时是路径去重键）｜`text`（内联动态块：书籍信息/卷列表/用户输入大纲等）｜`header`（缺省 = 只输出正文，由调用方并入自己的包装）｜`stripComments`（**仅 file 条目**默认 true）｜`stripHeading`（**仅 file 条目**，剥起始连续标题行：`#…` 与纯文本「第N章/回」题行）｜`transform`（清洗后派生处理，file/text 条目都吃）｜`fallback`（缺失/空替代文本，仍走管线）｜`skip`（保留声明位置但不注入）｜`group`（分组标签，结果按组取用）。
- 去重（先到先赢，数组顺序即优先级）：①同一 `file` 只装载第一次——**读不到也记名**，同路径不重试注入；②清洗后正文与前面任一已注入块相同 → 跳过（跨文件同内容防双份）。
- join：块内 `header + "\n" + text`，块间 `\n\n`。
- 返回 `AssembledPrompt`：`blocks`（含 file/header/text/group，供按 header 推导旗标）、`groupText(name)`（组内按声明顺序拼接）、`text`（全部块拼接）。
- 仅 import `md_docs.stripComments`，不依赖 prompts/story_manager（L1 层模块，见 code-structure 依赖分层）。

## main.ts 装配 helper

- `promptReader()`（2463）：见上（v0.3.0+ 三路分流含 SKILLS/ 技能文件分支）。
- `assembleGuideTexts(storyName|null, genre, writingStyle?)`（2421）：创作规范单次装配，返回 `{ raw, cleaned }`——specs 顺序＝小说级 > 用户级 > 系统级（fallback 内置 DEFAULT_SYSTEM_GUIDE）> `guide-types/<题材命中>`（fallback 内置 defaultText，transform 加 `## 写作要点（name）` 前缀）；**raw** 保留 `<!-- 编写类型:x -->` 标记（供 getStoryTypeGuide 提取类型区块）、**cleaned** = `stripGuideCategoryBlock(raw)`（剥禁用词类目块＋类型块＋全部注释，供【创作规范】注入）。指南 spec 用 `stripComments:false` ＋ `stripHeading:true`。
- `loadWriterGuides(storyName)`（3043）：返回 `{ bookText, userText, systemText, bannedGuideText, guideRawText, guideCleanText }`——bookText/userText 原文供 wordRangeFromGuides 字数区间；`bannedGuideText` = 合并后「禁用词」类目（仅正文路径经禁用词块注入）；`guideRawText`/`guideCleanText` 见上；顺带触发《写作指南汇总.md》检测更新重建（仅查看产物）。
- `orderRefDocSpecs(pairs, ref, opts?)`（2852，私有）：三装配入口共用——按 `phaseRefDocKeys` 清单顺序重排 keyed pairs（未知 key 丢弃、重复 key 只取首次），`file:<path>` 条目经 `promptReader()` 就地内联为【引用文档 · <path>】spec（opts.fileGroup 决定分组归属，正文族归 book 组），opts.guideKey 命中的锁定 spec 最后 **unshift 恒第一块**。**v0.3.0+ 技能条目**：`skill:<name>` 条目就地内联为 `{ file: SKILLS/<name>.md, header: 【技能 · name】, stripHeading: true }`（读经 promptReader SKILLS 分支，重复条目由装配器 file 去重兜底）；`opts.skipSkills: true` 时跳过全部 skill 条目——正文族（assembleWritingDocGroups）用它退出，阶段 3 技能改走 system prompt（见下 writerSystemPrompt 条）。
- `assembleVolOutlineContext(story, state, vol, guides, tensionRules, opts)`（4550）：大纲族共享装配（vol-outline-generate／无卷自动建卷／书级大纲→生成卷／AI 兜底拆分／book-outline-generate 复用同一 helper）。spec 顺序＝书籍信息→创作规范（HDR_GUIDE_OUTLINE）→张力规则→世界观.md（stripHeading:false）→策划指南.md→当前大纲来源（text）→全书大纲（strict 或已给 outlineText 则 skip）→书籍人物关系（transform cleanRelationshipsDoc、stripComments:false）→本卷人物关系→卷列表（noTargetMark 决定「← 目标卷」标记）→前一卷卷大纲。opts＝`{ outlineText?, strict?, noBookRel?, noVolRel?, noTargetMark?, volumes?, prevOutline?, phaseIdx? }`（phaseIdx 默认 1，AI 兜底拆分及其导出预览传 2）。**v0.2.25+ 引用文档过滤**：specs 改为 keyed pairs（key=内置文档 key），按 `phaseRefDocKeys(phaseIdx)` 的**数组顺序**注入（排前的先组装），用户 `file:` 条目以【引用文档 · <路径>】header 在清单中的位置就地注入；guide 键不受清单控制、恒注入并 unshift 固定第一块（三装配入口共用私有 `orderRefDocSpecs(pairs, ref, opts)`：opts.guideKey＝锁定创作规范键、opts.fileGroup＝正文族 file: 条目分组归属）。`ensurePlanningGuide` 副作用须先于本调用。book 族旗标（hasVolumes/hasPlanningGuide/hasBookRelationships/hasVolRelationships）由调用方按 `blocks` 的 header 匹配推导（hasCtxBlock）。
- `assembleWritingDocGroups(data, opts?)`（4676）：写作上下文三层文档组串——按 `loadWritingData` 解析出的 `data.docPaths` 声明三组 specs（`group:"book"/"vol"/"chapter"`），返回 `{ bookDocs, volDocs, chapterDocs }` 补进 input 再 `buildWritingContext({ ...data, ...docs })`。书级＝世界观.md（stripHeading:false）＋书级人物关系；卷级＝卷大纲（剥 H1＋stripForeshadowMarks）＋卷人物关系；章级按旧注入顺序＝本章大纲（skipChapterOutline 开关）→人物→场景→本章人物关系。章级人物/场景只剥题行、不设 stripHeading（`# 人物`/`# 场景` 标题保留）。**旧跨层人物关系逐行去重（章>卷>书）随结构化渲染退役——现仅装配器整块去重，已定稿取舍。** **v0.2.25+ 引用文档过滤**：opts 增 `phaseIdx?`（默认 3——全部既有调用点都是阶段 3 命令，零改动）；specs 改 keyed pairs 按 `phaseRefDocKeys(phaseIdx)` **数组顺序**注入（排前的先组装），用户 `file:` 条目按清单位置并入 book 组。**v0.3.0+ 技能防双份**：本 helper 调 `orderRefDocSpecs(…, { fileGroup: "book", skipSkills: true })`——正文族上下文跳过 `skill:` 条目，阶段 3 技能只经 writerSystemPrompt 进 system prompt。**v0.2.25+ 平铺（无卷）模式**：`dp.vol` 缺失时 `vol_outline` key 改映射书级《大纲.md》（`dp.book.globalOutline`）、header 直接【全书大纲】、group 归 book（平铺书没有卷大纲，写作上下文不能一份大纲都没有）；提示词措辞口径由 prompts.ts `outlineBlockNameOf(context)`（756）扫描组装后上下文文本中的实际大纲块 header 推导：含【本卷大纲】＝「本卷大纲」、含【全书大纲】＝「全书大纲」、都没有＝空串（措辞退化为泛指「大纲」）——buildWritingContext 809（要求第 3 条）/ 续写等 856 两处消费。
- `buildPlanningGuideInput(story, state, opts?)`（4844）：策划方案生成（阶段 0）输入组装。**v0.2.25+**：调 `loadWriterGuides(story)` 注入锁定创作规范块（header 常量 `HDR_GUIDE_PLANNING`，三层指南恒注入、不受配置框影响），其余 specs 按 `phaseRefDocKeys(0)` **数组顺序**注入、`file:` 条目按清单位置就地注入——这是新行为（此前阶段 0 输入仅书籍信息＋世界观）。spec 顺序＝书籍信息→创作规范（guide，unshift 恒第一块）→张力规则（`HDR_TENSION_PLANNING`）→世界观.md（stripHeading:false）→**大事件列表（`events_list`，`manager.eventsListPath`，header【大事件列表】，缺失时由 `ensureEventsList` 先生成落盘再装配）**→全书大纲（worldOnly skip）→卷列表（worldOnly skip）。
- `buildEventsListInput(story, state)`（4866）：大事件列表生成输入组装——**固定上下文**＝书籍信息→创作规范（HDR_GUIDE_PLANNING）→张力规则→世界观，**不经 `orderRefDocSpecs`/ref_docs 过滤**（生成上下文与注入清单分离：清单只控制生成结果是否注入策划指南）。配套流程 `ensureEventsList`（4881）见 [l3-writing-commands-impl.md](./l3-writing-commands-impl.md)。
- `phaseRefDocKeys(phaseIdx)`（2844）：读 `writing_phases[phaseIdx].ref_docs`（`undefined` 回落 `PHASE_REF_DOC_DEFAULTS[phaseIdx]`），按数组顺序原样返回 `string[]`——数组顺序即装配注入顺序（排前的先组装）；三个装配 helper 共用，各自按序映射内置 spec、`file:` 条目就地注入、`skill:` 条目按阶段分流（见下）。
- `writerSystemPrompt(…)`（3151）：正文生成 system prompt 组装。**v0.3.0+ 技能注入**：`loadSkillsBlock(3)` 读阶段 3 清单的 `skill:` 条目（去重、读 SKILLS/<name>.md、剥标题、`【技能 · name】` join）→ `buildStoryTypeSystemPrompt({ skillsBlock })` 追加在编写类型块与禁用词块之后、【强制要求】尾之前（prompts.ts L503/L514 钩子，11 个调用点零改动）。剧本转换调用点不传 skillsBlock＝不注入；chat 面板装配走 skipSkills 且不经本函数＝拿不到技能（设计使能）。详见 [l3-skills.md](./l3-skills.md)。

## 调用方约定

- 各 LLM 命令自己声明所需文件列表（specs），组内结构化角色/场景列表仍留 prompts.ts `buildWritingContext` 原位渲染。
- prompts.ts 各 input 的 `contextDocs?: string` 字段接收装配结果（旧 guideText?/tensionRules?/planningGuide?/worldText 等逐字段注入退役；唯一保留 guideText 的是 `buildStoryTypeSystemPrompt` 的【创作规范】包装）。
- 禁用词块仍仅正文路径注入；`bannedGuideText` 口径不变。
- 大纲族：正在生成的目标文档（《大纲.md》/《卷大纲.md》）不进自己的生成提示词（strict skip）。
- **v0.2.25+ 引用文档配置框**：内置文档注入与否由各阶段 `ref_docs` 决定（见 [l2-settings-llm-config.md](./l2-settings-llm-config.md)），**数组顺序即装配顺序**（排前的先组装，设置页显示序号 + ↑/↓ 调整）；三层《写作指南》创作规范为锁定项、任何配置下恒注入（阶段 3 经 llm_client `assembleSystemPrompt`【创作规范】、阶段 1/2 经 HDR_GUIDE_OUTLINE、阶段 0 经 HDR_GUIDE_PLANNING，大纲/策划路径固定第一块；设置页锁定行恒排清单最上面）；review/chat 等未显式传 phaseIdx 的调用点即跟随阶段 3 配置框。
- **v0.3.0+ 技能条目（`skill:<name>`）**：纯 opt-in——`PHASE_REF_DOC_DEFAULTS` 不含任何 skill 条目。注入两档：阶段 0–2 进上下文文档（orderRefDocSpecs 就地内联【技能 · name】块，位置随清单顺序）；阶段 3 进 system prompt（正文装配 skipSkills 跳过、writerSystemPrompt→skillsBlock 单次注入）。技能读写全程绕 manager（防 ensureLayout 迁移），见 [l3-skills.md](./l3-skills.md)。
