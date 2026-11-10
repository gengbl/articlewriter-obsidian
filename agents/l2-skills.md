# L2 · 技能系统（v0.3.0+ 轻量方案）

## 模块概要

技能 = 写作技巧类短文档，存放于 `<work_dir>/SKILLS/<name>.md`（vault 内、平铺一层、用户可直接编辑）。技能**纯 opt-in**：各阶段引用文档清单（ref_docs）中的 `skill:<name>` 条目决定哪些技能注入哪个阶段的提示词；`PHASE_REF_DOC_DEFAULTS` 不含任何技能条目（未添加过技能的阶段行为与旧版完全一致）。内置三个技巧技能（展示而非讲述 / 对话技巧 / 悬念与伏笔）随启动播种，用户可在 SKILLS/ 下自建任意 `<技能名>.md` 后通过设置页「添加技能…」挂到阶段清单。

## 行为约定

- **技能文件位置与形态**：`<work_dir>/SKILLS/<name>.md`（work_dir 未设时为 vault 根 `SKILLS/`）。平铺一层、只认 `.md`；文件起始 `# 技能名` 标题行注入时被剥除（stripHeading），正文即技巧要点列表。技能名 = 文件名基名。
- **播种语义（对齐 BANNED_WORDS.md）**：启动时（work_dir 已设）与设置/切换工作目录后，`ensureSkillsFiles()` 把内置技能写入 SKILLS/——**仅文件缺失才写、绝不覆盖用户内容**；失败仅 console.warn 不阻断。运行时唯一来源 = 盘上 SKILLS/*.md 文件，内置内容（`src/skills_default.ts` DEFAULT_SKILLS）仅作播种种子。
- **注入路径分两档（防双份注入）**：
  - 阶段 0–2（策划方案/书大纲/卷大纲）：`skill:` 条目经 `orderRefDocSpecs` 就地转为 `{ file: SKILLS/<name>.md, header: 【技能 · name】, stripHeading: true }` 进**上下文文档**（user prompt 侧），位置随清单顺序。
  - 阶段 3（编写文章）：正文族上下文装配传 `skipSkills: true` 跳过 `skill:` 条目；技能改由 `writerSystemPrompt` 调 `loadSkillsBlock(3)` 装配后经 `buildStoryTypeSystemPrompt` 的 `skillsBlock` 钩子进 **system prompt**（排在编写类型块、禁用词块之后）。技能只在此注入一次。
- **不接技能的入口**：LLM 对话面板（chat 装配默认 phase 3 且走 skipSkills）、剧本转换（`buildStoryTypeSystemPrompt` 另一调用点不传 skillsBlock）——与「技能服务于四阶段写作」的设计一致。
- **设置页交互**：引用文档配置框（各阶段 tab 内）新增「添加技能…」按钮——异步列 SKILLS/ 下 `.md` 基名、过滤已添加项，弹 `SkillPickerModal`（SuggestModal 按名称模糊搜索），选中即 commit `skill:<基名>`；清单中 skill 条目渲染为「🎯 技能 · <name>」行，可删除/排序。SKILLS/ 无新技能时 Notice 提示。
- **关键陷阱（必读）**：SKILLS 读写**一律绕开 `manager.readDoc/writeDoc`**——`storyNameOfPath` 把 work_dir 第一级目录当书名，经 readDoc/writeDoc 会触发 `ensureLayout` 把 SKILLS/ 当旧格式书迁移（技能文件被搬进 案头资料/书稿）。全部直接走 vault adapter（`exists` 检查 + `adapter.write` 自动建父目录）；`promptReader()` 有 skillsPrefix 分支同样绕 readDoc。`listStories` 只认含 故事状态.md 的目录，SKILLS/ 不会冒充书。story_manager 零改动。
- **去重**：清单中重复 `skill:<name>` 条目——`loadSkillsBlock` 内 names 去重；上下文文档路径由装配器 `assemblePromptFiles` 的 seenFiles 兜底。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-skills.md](./l3-skills.md) | 实现细节：skills_default.ts 结构、main.ts 技能区块（skillsDir/skillPath/ensureSkillsFiles/loadSkillsBlock）、promptReader skills 分支、SkillPickerModal |
| L3 | [l3-prompt-assembly.md](./l3-prompt-assembly.md) | orderRefDocSpecs 的 `skill:` 分支与 skipSkills、writerSystemPrompt→skillsBlock 注入链 |
| L3 | [l3-settings-page.md](./l3-settings-page.md) | renderRefDocs 的 skill 行渲染与「添加技能…」按钮流程 |
| L2 | [l2-llm-writing-commands.md](./l2-llm-writing-commands.md) | 四阶段写作命令总览（技能注入发生地） |
| 横切 | [PROMPT_MATRIX.md](../PROMPT_MATRIX.md) | 阶段 3 system prompt 技能注入点（skillsBlock） |
