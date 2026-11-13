# L2 · 技能系统（v0.3.0+ 轻量方案）

## 模块概要

技能 = 写作技巧类短文档，存放于 `<work_dir>/SKILLS/<name>.md`（vault 内、平铺一层、用户可直接编辑）。技能**纯 opt-in**：各阶段引用文档清单（ref_docs）中的 `skill:<name>` 条目决定哪些技能注入哪个阶段的提示词；`PHASE_REF_DOC_DEFAULTS` 仅两条内置技能条目——编写文章阶段（`PHASE_WRITING`）的 `skill:网文高频禁用词清单`（v0.3.6+ 禁用词 Skill 化）与世界观生成阶段（`PHASE_WORLDVIEW`）的 `skill:世界观生成框架`（v0.3.7+ 世界观方法论技能，名字取常量 `WORLDVIEW_FRAMEWORK_SKILL_NAME`），其余技能仍按阶段配置逐个添加（从未添加过技能的阶段除上述默认注入外，行为与旧版一致）。内置技能随启动播种，现共 **29 个、分三类**（技法/题材 24 个为 v0.3.4+ 从系统写作指南按类型分离扩充——**v0.3.5+ 写作指南体系整体废弃，播种来源文本已删除；技能现为 DEFAULT_SKILLS 唯一载体，题材要点即以此四题材技能为替代入口**；其中技法 9 个（作者身份/核心创作哲学/视角与文风/人物塑造/事件展开/情节推进/格式要求/禁止事项/自检清单）为「指南全部 Skill 化」轮（2026-11-12）随系统指南瘦身为骨架一并播种、「网文高频禁用词清单」为同日补充轮把指南最后的禁用词容器节 Skill 化新增、**v0.3.6+ 禁用词 Skill 化**时并入旧 BANNED_WORDS.md 的结构化词表（现＝禁用词唯一事实源，见下「禁用词 Skill 化」条）、**「世界观生成框架」为 v0.3.7+ 世界观阶段新增方法论技能**；身份加强 4 个为 v0.3.4+ Skill 化改造、第 5 个 `身份加强·世界观生成` 为 v0.3.7+ 新增）：技法类 20＝展示而非讲述 / 对话技巧 / 悬念与伏笔 / 句式与节奏 / 去翻译腔 / 结构去AI化 / 网文高频禁用词清单 / 白描场景描写 / 情绪与心理写法 / 张力工具箱 / 作者身份 / 核心创作哲学 / 视角与文风 / 人物塑造 / 事件展开 / 情节推进 / 格式要求 / 禁止事项 / 自检清单 / 世界观生成框架；题材类 4＝玄幻仙侠写法 / 科幻写法 / 都市现实写法 / 历史武侠写法；**身份加强类 5**＝`身份加强·<阶段名>`（前缀取 plugin_config 常量 `IDENTITY_BOOST_SKILL_PREFIX`＝`身份加强·`，阶段名取 `WRITING_PHASE_LABELS`）——前四个即旧「身份加强」机制的四段文本，注入方式与其它技能完全相同（勾选 `skill:` 条目才生效，**不勾选＝该阶段无身份加强**，旧版默认注入行为已取消）；旧 data.json 各阶段 `identity_boost` 定制值由 `migrateIdentityBoostSkills()` 自动迁移进对应文件后删除字段（`身份加强·世界观生成` 无 legacy 可迁移、纯播种）。用户可在 SKILLS/ 下自建任意 `<技能名>.md` 后通过设置页「添加技能…」挂到阶段清单。

## 行为约定

- **技能文件位置与形态**：`<work_dir>/SKILLS/<name>.md`（work_dir 未设时为 vault 根 `SKILLS/`）。平铺一层、只认 `.md`；文件起始 `# 技能名` 标题行注入时被剥除（stripHeading），正文即技巧要点列表。技能名 = 文件名基名。
- **播种语义**：启动时（work_dir 已设）与设置/切换工作目录后，`ensureSkillsFiles()` 把内置技能写入 SKILLS/——**仅文件缺失才写、绝不覆盖用户内容**；失败仅 console.warn 不阻断。运行时唯一来源 = 盘上 SKILLS/*.md 文件，内置内容（`src/skills_default.ts` DEFAULT_SKILLS）仅作播种种子。
- **禁用词 Skill 化（v0.3.6+）**：禁用词清单唯一事实源 = `SKILLS/网文高频禁用词清单.md`（技能名取 plugin_config 常量 `BANNED_LIST_SKILL_NAME`，进编写文章阶段（`PHASE_WRITING`）默认清单）。旧插件数据目录 `BANNED_WORDS.md` 由 `migrateBannedWordsSkill()` 启动时并入该技能文件（技能缺失＝取旧 md 正文逐字＋内置头部写入；技能＝旧内置散文占位版（逐字 `LEGACY_SKILL_BANNED_LIST`、未被用户定制）＝覆盖为结构化版；技能已被定制＝以文件为准不覆盖，旧 md 若也被定制过则 console.warn 提示手动并入），随后 `purgeBannedWordsSkillArtifacts()` 删除旧 md，并一并删除旧内置技能「禁用词回避」（仅逐字 = `LEGACY_SKILL_BANNED_AVOID` 时删，用户同名定制不碰）；迁移必须在播种前跑。旧 BANNED_WORDS.md 文件与 `src/banned_words_default.ts` 已从仓库删除，词表正文内联于 `skills_default.ts`。提示词注入走编写文章阶段技能块——旧【禁用词】专用注入块、`writerSystemPrompt` 的 `includeBanned` 形参、`buildBannedWordsBlock`/`buildMergedBannedBlock` 已删（/review 路径自此与正文路径注入一致，同样吃到清单）。词检测/清洗链（`loadBannedWords` → `parseBannedWordsMd`；autoCleanAi / deai / export 标红 / AI 词检测命令 / `cleanAiText`）解析同一技能文件，技能缺失或为空时回落包内默认词表。
- **注入路径分两档（防双份注入）**：
  - 阶段 0–3（世界观生成／策划方案生成／书籍大纲和卷级大纲生成／文章大纲生成，即除编写文章外全部阶段）：`skill:` 条目经 `orderRefDocSpecs` 就地转为 `{ file: SKILLS/<name>.md, header: 【技能 · name】, stripHeading: true }` 进**上下文文档**（user prompt 侧），位置随清单顺序。
  - 阶段 4（编写文章）：正文族上下文装配传 `skipSkills: true` 跳过 `skill:` 条目；技能改由 `writerSystemPrompt` 调 `loadSkillsBlock(PHASE_WRITING)` 装配后经 `buildStoryTypeSystemPrompt` 的 `skillsBlock` 钩子进 **system prompt**（排在编写类型块之后；v0.3.6+ 原禁用词专用块已删，词表清单经此技能块注入）。技能只在此注入一次。
- **不接技能的入口**：LLM 对话面板（chat 装配走编写文章阶段（`PHASE_WRITING`）默认清单且走 skipSkills）、剧本转换（`buildStoryTypeSystemPrompt` 另一调用点不传 skillsBlock）——与「技能服务于五阶段写作」的设计一致。
- **设置页交互**：引用文档配置框（各阶段 tab 内）新增「添加技能…」按钮——异步列 SKILLS/ 下 `.md` 基名、过滤已添加项，弹 `SkillPickerModal`（SuggestModal 按名称模糊搜索），选中即 commit `skill:<基名>`；清单中 skill 条目渲染为「🎯 技能 · <name>」行，可删除/排序。**v0.4.2+ 该行支持双击编辑**：双击 → `plugin.openSkillFile(name)` 经 `skillPath` 解析 `SKILLS/<name>.md`，存在即在编辑器 `getLeaf(false).openFile` 打开；缺失先跑 `ensureSkillsFiles()` 重播种（内置技能误删可回）再查，仍缺 Notice 提示可自建。行带 title 提示。SKILLS/ 无新技能时 Notice 提示。
- **关键陷阱（必读）**：SKILLS 读写**一律绕开 `manager.readDoc/writeDoc`**——`storyNameOfPath` 把 work_dir 第一级目录当书名，经 readDoc/writeDoc 会触发 `ensureLayout` 把 SKILLS/ 当旧格式书迁移（技能文件被搬进 案头资料/书稿）。全部直接走 vault adapter（`exists` 检查 + `adapter.write` 自动建父目录）；`promptReader()` 有 skillsPrefix 分支同样绕 readDoc。`listStories` 只认含 故事状态.md 的目录，SKILLS/ 不会冒充书。story_manager 零改动。
- **去重**：清单中重复 `skill:<name>` 条目——`loadSkillsBlock` 内 names 去重；上下文文档路径由装配器 `assemblePromptFiles` 的 seenFiles 兜底。

## 书籍级技能（v0.3.4+）

书籍 Skill = 与系统技能同格式（纯 Markdown 技巧要点、无 frontmatter）的**本书专用**写作技巧技能，区别于「自动化建书技能」（book_skill.ts，`auto_book: true` 那套，两者解析路径互不相干、不可混用）。

- **存储**：`<书>/案头资料/Skill/<技能名>.md`（每书一份、随书走）。该文件夹一旦存在即自动渲染为写字台「案头资料」节下的 **Skill 子节点**（statusDetail globalFolders 含 desk 直属文件夹，无需注册）。属真书路径，读写**可安全走** `manager.readDoc`/`promptReader`（与全局 SKILLS/ 必须绕 manager 的陷阱相反）。
- **创建与配置解耦（v0.3.4+ 改版）**：创建是一条独立路径——命令面板「新建 Skill…」（`skill-new` → `cmdSkillNew()`）打开编写弹窗，保存位置下拉保留（系统级/书籍级），内容区预填 `SKILL_CONTENT_TEMPLATE` 格式模板（`# 技能名`＋一行概述＋要点列表，对齐内置技能结构）让用户填充；**保存只落盘＋Notice（含写入路径），不进入任何配置**。阶段配置由独立命令「书籍 Skill 阶段配置…」（`book-skill-phases` → `cmdBookSkillPhases()`）单独调出，直达 `BookSkillPhaseModal`。
- **无管理面板（v0.3.4+ 定案）**：不设「书籍 Skill 面板」类聚合菜单——技能的**编辑与删除直接在 Obsidian 里对 `案头资料/Skill/<技能名>.md` 文件操作**（改内容即时生效；删文件后 故事状态.md 残留引用自动忽略）。写字台「案头资料」节右键只有两个直达入口：「新建 Skill…」→ action `skill-new`（走 `editSkillFlow(story,null)` 新建流）、「书籍 Skill 阶段配置…」→ action `book-skill-phases`（走 `phaseBookSkillFlow`），均带右键所在书的 `story`。
- **编写弹窗（`SkillEditModal`，新建/编辑共用）**：名称＋保存位置（系统级 SKILLS/ ｜ 书籍级 案头资料/Skill/）＋大文本域（编辑态以 `initialContent` 起算——修复：不碰编辑器直接保存不再清空原文件）。编辑态名称只读（保存回原位，防 故事状态.md 引用悬空）；**改保存级别＝以同名另存另一级**（目标已存在先确认覆盖）＋删旧文件（删书籍级旧文件同时清理 book_skills 引用）。无当前小说时选书籍级＝明确 Notice 早退。保存写盘失败给 8s 具体错误 Notice（`notifyError("保存技能文件失败")`），写前 `ensureFolders` 逐级确保目录存在（**adapter.write 不承诺创建父目录**——v0.3.4 保存后文件不出现的根因修复）。
- **阶段选用配置**：`BookSkillPhaseModal`＝**tab 页**（v0.3.4+ 改版；v0.3.7+ 起五 tab，数量由调用方 defs 决定），tab 名与设置页「写作阶段模型配置」五 tab **完全同名**——阶段名同源 plugin_config 常量 `WRITING_PHASE_LABELS`（＝世界观生成／策划方案生成／书籍大纲和卷级大纲生成／文章大纲生成／编写文章；`WritingPhase.name` 为 legacy 不再被 UI 读取）。每 tab 一下拉多选（`makeMultiSelect`），提交写回 故事状态.md `book_skills`（阶段 key → 技能名数组；固定键序、空阶段省略）。与系统技能一致：每阶段可挂多个。弹窗纵向：tab 内容区最小高度≈5 行已选（v0.3.4+），保存/取消按钮成组贴右（两弹窗一致）。
- **注入位置＝系统技能之后**：阶段 0–3 经 `orderRefDocSpecs` opts（`bookSkillDir`/`bookSkillNames`）把本书技能（`bookSkillSpecsFromDir` 生成的【技能 · 名称】spec）追加在引用文档数组**末尾**（**v0.3.5+** 旧「guideKey unshift 之后」挂位已随写作指南体系废弃）；固定 specs 装配（时间线生成 `buildTimelineInput`）同样在尾部追加同一 helper 结果。编写文章阶段（`PHASE_WRITING`）`writerSystemPrompt` 的 skillsBlock＝系统技能块＋书籍技能块拼接。同样受 skipSkills 防双份注入规则约束（上下文装配恒 skipSkills:true）。
- **删除技能**：直接删 `案头资料/Skill/<名>.md` 文件即可；`loadBookSkillsBlock` 读不到文件就跳过，`book_skills` 里的残留引用自动忽略（`deleteSkillFile` 程序化删除路径仍会同步清各阶段数组引用）。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-skills.md](./l3-skills.md) | 实现细节：skills_default.ts 结构（含 SKILL_CONTENT_TEMPLATE 新建预填模板）、main.ts 技能区块（skillsDir/skillPath/ensureSkillsFiles/loadSkillsBlock）、promptReader skills 分支、SkillPickerModal；「书籍级技能（v0.3.4+）」节＝state_doc book_skills/normalizeBookSkills、main.ts 书籍技能区块（bookSkillsDir/cmdSkillNew/cmdBookSkillPhases/bookSkillPhaseDefs/phaseBookSkillFlow/editSkillFlow/saveSkillFile/ensureFolders/deleteSkillFile）、SkillEditModal/BookSkillPhaseModal、orderRefDocSpecs bookSkill opts |
| L3 | [l3-prompt-assembly.md](./l3-prompt-assembly.md) | orderRefDocSpecs 的 `skill:` 分支与 skipSkills、writerSystemPrompt→skillsBlock 注入链 |
| L3 | [l3-state-and-volumes.md](./l3-state-and-volumes.md) | 故事状态.md 存储层：StoryState 字段、formatStateDoc/parseStateDoc、extraKeys 白名单（book_skills 字段实现细节另见 l3-skills.md 书籍级技能节） |
| L3 | [l3-settings-page.md](./l3-settings-page.md) | renderRefDocs 的 skill 行渲染与「添加技能…」按钮流程 |
| L2 | [l2-llm-writing-commands.md](./l2-llm-writing-commands.md) | 五阶段写作命令总览（技能注入发生地） |
| 横切 | [PROMPT_MATRIX.md](../PROMPT_MATRIX.md) | 编写文章阶段（`PHASE_WRITING`）system prompt 技能注入点（skillsBlock） |
