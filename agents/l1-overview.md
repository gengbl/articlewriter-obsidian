# L1 · 项目概述与范围

本插件是独立的 Obsidian 小说创作工具：全部使用 Vault / Workspace API 操作 vault 内 Markdown，交互用 Modal。**LLM 写作类命令**（`write-chapter`/`continue-writing`/`rewrite-chapter`/`polish-text`/`deai-clean`/`typo-check`/`review-chapter`）——prompt 组装在 `src/prompts.ts`（上下文文档块经 `src/prompt_files.ts` 装配器按调用方声明的文件名数组读盘装配，【创作规范】＝三层指南直装的 guideCleanText、《写作指南汇总.md》仅用户查看产物不进提示词；禁用词合并、编写类型格式校验），调用层在 `src/llm_client.ts`，结果落盘+场景同步走 `story_manager.ts`。

**设计决策（本插件自身行为约定）**：①所有生成结果先在统一「生成过程」面板内流式预览并经「保存/不保存」确认才写盘；v0.1.4+ 该面板同时承担摘要延迟生成的工作日志展示；②去AI味后保存的文件不含 AI 常用词的 HTML span 标记（**例外：错别字检测 `/typo-check` 的下划线 span 是结果性标记、有意落盘**——供 Obsidian 预览展示错字位置与悬停建议，读回正文时经 `stripAiWordMarks` 自动剥离，不影响摘要/字数/导出）；③章节摘要与卷摘要均建章/建卷不播种、纯延迟生成：上下文组装需要时章摘要经 LLM 逐章生成落盘（`NN-<标题>-摘要.md`）、**卷摘要** `<volDir>/卷摘要.md` 以该卷成员章《章节摘要》为输入整体重建（详见 [l3-summary-pipeline.md](./l3-summary-pipeline.md)「卷摘要」条），卷摘要是否注入写作上下文由设置 includeVolumeSummary 控制（默认关＝严格只注入最近 N 章的单章摘要，不注入任何卷级 digest、也不触发其 LLM 重建；**v0.2.x+ 前文窗口章数 N 与卷摘要开关均可被故事状态.md 的 `prev_chapters`/`include_volume_summary` 每书覆盖**，显式设置优先于全局 data.json 设置）；④写作上下文采用书/卷/章三层结构（角色/场景结构化列表排除归属当前章的条目并按容器分层；**v0.2.24+ prompt_files 装配改造**：三层上下文文档——世界观/大纲/人物关系/卷大纲/章节大纲等——由调用方按 specs 声明文件名、经 `src/prompt_files.ts` `assemblePromptFiles` 读原文装配进 bookDocs/volDocs/chapterDocs，人物关系不再跨层逐行去重（仅装配器整块去重：路径先到先赢＋清洗后同文跳过）、旧 folderDocs 字段退役）；⑤**平台支持桌面＋移动双端**——移动端常驻面板（写字台/人物关系/时间线/LLM 对话）经 `getPanelHostLeaf()` 分割主区域承载（移动端右栏无 UI 入口）、鼠标专用交互（如时间线拖动更新时间点）自动降级为仅展示/仅打开；manifest `isDesktopOnly` 必须保持 `false`（v0.2.17 曾误改为 `true` 致 Obsidian 平板/手机直接跳过加载本插件，v0.2.19 已改回）；**v0.2.20+ 写字台同样双端常驻**——左栏（移动端抽屉／桌面端左栏）视图切换列表恒有写字台 tab，启动时与切书恢复工作区后自动补位（main.ts `ensureStatusInLeftSidebar` 经 `ensureSideLeaf` 幂等补 tab、不抢焦点、不展开抽屉），不做平台分支。

**功能边界（明确不做清单）**：自然语言编辑、剧本转换、WebDAV 同步、技能系统、禁用词批量管理与指南热重载功能、PDF 导出。创作规范三层已全部实现为 `agents-view`/`agents-edit`：小说级 `<书名>/WRITING_GUIDE.md` > 用户级 `<work_dir>/WRITING_GUIDE.md` > 系统级插件数据目录文件 `.obsidian/plugins/articlewriter/WRITING_GUIDE.md`（首启由内置默认播种、路径固定非用户可配；另有四个「类型要点」文件 guide-types/*.md 按书籍题材组装进汇总，详见 [l2-writing-guide.md](./l2-writing-guide.md)）。新增需求前先确认是否在该边界内。

**术语约定：用户可见文案一律称「小说」（原「故事」称呼已统一改掉）**；但磁盘文件名 `故事状态.md`、指南数据格式分类名（banned_words.ts 的「故事风格」等）、默认提示词与系统指南文本（llm_client.ts / system_guide_default.ts）保持原文不改。

## 功能地图（L2 模块 → L3 实现细节）

| 功能域 | L2 模块文档 | 相关 L3 实现细节 |
| --- | --- | --- |
| 故事结构（目录树 / 卷 / 章节 / 引言 / 状态文档 / 章节身份） | [l2-story-structure.md](./l2-story-structure.md) | [l3-state-and-volumes.md](./l3-state-and-volumes.md)、[l3-md-docs-parsing.md](./l3-md-docs-parsing.md) |
| 设定实体（大纲 / 场景 / 人物 / 世界观 / 伏笔 / 笔记） | [l2-setting-entities.md](./l2-setting-entities.md) | [l3-md-docs-parsing.md](./l3-md-docs-parsing.md) |
| 人物与场景分析（/analyze-cast：逐章 LLM 分析正文，按出现范围写入书/卷/章三层《人物.md》《场景.md》，新关系追加对应层《人物关系.md》） | [l2-cast-analysis.md](./l2-cast-analysis.md) | [l3-cast-analyzer.md](./l3-cast-analyzer.md) |
| 写字台（StatusView：书籍列表 / 树节点 / 右键菜单 / 新建文档流程） | [l2-writing-desk.md](./l2-writing-desk.md) | [l3-status-view.md](./l3-status-view.md)、[l3-view-rendering.md](./l3-view-rendering.md) |
| LLM 对话面板 | [l2-llm-chat-panel.md](./l2-llm-chat-panel.md) | [l3-llm-chat-view.md](./l3-llm-chat-view.md)、[l3-view-rendering.md](./l3-view-rendering.md) |
| 人物关系面板 | [l2-relationship-panel.md](./l2-relationship-panel.md) | [l3-relationship-view.md](./l3-relationship-view.md)、[l3-md-docs-parsing.md](./l3-md-docs-parsing.md) |
| 时间线面板 | [l2-timeline-panel.md](./l2-timeline-panel.md) | [l3-timeline-view.md](./l3-timeline-view.md)、[l3-md-docs-parsing.md](./l3-md-docs-parsing.md) |
| LLM 写作命令（含「生成过程」面板） | [l2-llm-writing-commands.md](./l2-llm-writing-commands.md) | [l3-writing-commands-impl.md](./l3-writing-commands-impl.md)、[l3-prompt-assembly.md](./l3-prompt-assembly.md)、[l3-summary-pipeline.md](./l3-summary-pipeline.md)、[l3-main-ts-flow.md](./l3-main-ts-flow.md) |
| 写作指南（三层生命周期） | [l2-writing-guide.md](./l2-writing-guide.md) | [l3-guide-lifecycle.md](./l3-guide-lifecycle.md) |
| 设置页 / LLM 配置 | [l2-settings-llm-config.md](./l2-settings-llm-config.md) | [l3-settings-page.md](./l3-settings-page.md) |
| work_dir 初始化 / 切换小说 | [l2-workdir-story-switch.md](./l2-workdir-story-switch.md) | [l3-workdir-workspace.md](./l3-workdir-workspace.md) |
| 构建 / 打包 / 部署 / 发布 | — | [l3-build-deploy.md](./l3-build-deploy.md) |
