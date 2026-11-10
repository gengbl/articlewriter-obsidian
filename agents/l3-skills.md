# L3 · 技能系统实现细节（v0.3.0+）

改动技能相关代码前必读。所有行号为 0.3.0 开发期近似位置，以符号名检索为准。

## 源文件与符号

| 位置 | 内容 |
| --- | --- |
| `src/skills_default.ts` | `DEFAULT_SKILLS: Record<string, string>`——内置技能播种种子。键 = 技能名（= 文件名基名），值 = 文件全文（起始 `# 技能名` 标题行注入时被剥）。现含三个：展示而非讲述 / 对话技巧 / 悬念与伏笔。新增内置技能 = 在此加键值对（下次启动对缺失文件播种；已存在不覆盖，老 vault 不会自动拿到新技能——已知取舍） |
| `src/main.ts` 技能区块（loadBannedWords 之后，~L2345） | `skillsDir()`（**public**，设置页 tab 需访问）＝`<work_dir>/SKILLS`（work_dir 去尾斜杠；未设＝`SKILLS`）；`skillPath(name)`＝`<skillsDir>/<name>.md`；`ensureSkillsFiles()`＝遍历 DEFAULT_SKILLS，`adapter.exists` 缺失才 `adapter.write`（自动建父目录），try/catch 不阻断；`loadSkillsBlock(phaseIdx)`＝`phaseRefDocKeys(phaseIdx)` 过滤 `skill:` 前缀取基名去重 → adapter 读文件 → 空/读失败跳过 → `【技能 · name】\n${stripHeading(t).trim()}` 双换行 join；无条目返回空串 |
| `src/main.ts` `promptReader()`（~L2440） | 三分支：插件数据目录前缀 → `manager.readPluginFile`；`skillsPrefix`（`${skillsDir()}/`）→ adapter `exists`+`read`（try/catch 读失败按 null）；其余 → `manager.readDoc`。**skills 分支必须在 readDoc 之前**——readDoc 会触发 ensureLayout 迁移（见下「陷阱」） |
| `src/main.ts` `orderRefDocSpecs()`（~L2860） | opts 增 `skipSkills?: boolean`。循环内 `skill:` 分支（在 `file:` 分支后）：skipSkills 时直接 continue；否则 push `{ file: this.skillPath(name), header: 【技能 · name】, stripHeading: true }`（无 group——技能不进正文族分组）。重复条目由装配器 seenFiles 按 file 路径去重兜底 |
| `src/main.ts` 正文装配处（assembleWritingDocGroups 调用侧，~L2900 内） | `this.orderRefDocSpecs(pairs, ref, { fileGroup: "book", skipSkills: true })`——正文族（阶段 3 上下文文档）跳过技能 |
| `src/main.ts` `writerSystemPrompt()`（~L3150） | `const skillsBlock = await this.loadSkillsBlock(3)` → `buildStoryTypeSystemPrompt({ ..., skillsBlock: skillsBlock || undefined })`。11 个调用点零改动（技能加载内聚在本函数）；`includeBanned=false` 路径（/review）同样加载技能——技能与禁用词开关无关 |
| `src/prompts.ts` `buildStoryTypeSystemPrompt`（~L507） | `StoryTypePromptInput.skillsBlock?: string`（L503）；`if (input.skillsBlock) parts.push(input.skillsBlock)`（L514）——块序：编写类型块 → 禁用词块 → 技能块 → 【强制要求】尾。另一调用点（剧本转换）不传 skillsBlock＝不注入 |
| `src/modals.ts` `SkillPickerModal`（VaultFilePickerModal 之后） | `SuggestModal<string>`；构造入参 `(app, names: string[], onPick)`——名单由调用方（设置页）**打开弹窗前异步加载**后传入（SuggestModal 的 getSuggestions 是同步的，不能内部 async 读盘）；按基名小写 includes 过滤、slice(0,200) |
| `src/main.ts` `renderRefDocs()`（tab 类内，~L7130） | skill 条目行＝「🎯」+「技能 · <name>」（与 file: 行「📄」+路径并列的分支）；「添加技能…」按钮：`adapter.list(plugin.skillsDir())` 取 `.md` 基名 → 过滤清单已有 skill 名 → 空则 Notice 提示 → 非空 `names.sort(localeCompare zh)` 弹 SkillPickerModal → `commit([...keys, "skill:"+name])` |
| `src/main.ts` 播种挂点 | onload（ensureBannedWordsFile 后）：`if (this.settings.workDir) void this.ensureSkillsFiles()`；pickWorkDir 成功回调（seedUsageDoc 后）：`void this.ensureSkillsFiles()` |
| `src/plugin_config.ts` `WritingPhase.ref_docs` 注释 | 已补 `skill:<技能名>` 条目格式说明（含「阶段 3 进 system prompt、其余进上下文文档」） |

## 数据格式

- ref_docs 条目三形态：内置 key（`book_info` 等）｜`file:<vault 路径>`｜`skill:<技能名>`（v0.3.0+）。
- 技能文件：`<work_dir>/SKILLS/<name>.md`，内容自由 Markdown，建议起始 `# 技能名` + 要点列表；无 frontmatter、无解析约定，注入只剥起始标题行。

## 陷阱（改代码前确认）

1. **绝不经 manager**：`story_manager.storyNameOfPath` 把 work_dir 第一级目录当书名——`readDoc("SKILLS/x.md")`/`writeDoc` 会对 "SKILLS" 触发 `ensureLayout` 旧格式迁移，把技能文件搬进 `案头资料/`/`书稿/`。技能读写只走 `app.vault.adapter`。
2. **防双份注入**：阶段 3 技能只经 writerSystemPrompt→skillsBlock 进 system prompt；上下文装配必须保持 `skipSkills: true`。若新增正文族装配调用 orderRefDocSpecs 且清单可能含 skill 条目，显式决定 skipSkills。
3. **chat 面板拿不到技能**是设计使能：chat 装配走 phase 3 默认清单 + skipSkills。
4. `PHASE_REF_DOC_DEFAULTS` 不含 skill 条目——不要往默认清单塞技能，保持纯 opt-in。
5. SKILLS/ 读写发生在 vault adapter 层，Obsidian 文件监听/索引正常可见；`listStories` 只认含 `故事状态.md` 的目录，SKILLS/ 安全。
