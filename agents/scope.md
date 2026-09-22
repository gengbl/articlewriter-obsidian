# 项目概述与范围

本插件是独立的 Obsidian 小说创作工具：全部使用 Vault / Workspace API 操作 vault 内 Markdown，交互用 Modal。**LLM 写作类命令**（`write-chapter`/`continue-writing`/`rewrite-chapter`/`polish-text`/`deai-clean`/`review-chapter`）——prompt 组装在 `src/prompts.ts`（含两层创作规范注入、禁用词合并、编写类型格式校验），调用层在 `src/llm_client.ts`，结果落盘+场景同步走 `story_manager.ts`。

**设计决策（本插件自身行为约定）**：①所有生成结果先在统一「生成过程」面板内流式预览并经「保存/不保存」确认才写盘；v0.1.4+ 该面板同时承担摘要延迟生成的工作日志展示；②去AI味后保存的文件不含 AI 常用词的 HTML span 标记；③章节摘要文档不自动生成——但**卷摘要** `<volDir>/卷摘要.md` 为纯延迟生成：上下文组装需要时以该卷成员章《章节摘要》为输入整体重建（详见 data-model「卷摘要」条），是否注入写作上下文由设置 includeVolumeSummary 控制（默认关＝严格只注入最近 N 章的单章摘要，不注入任何卷级 digest、也不触发其 LLM 重建）；④写作上下文采用书/卷/章三层结构（角色/场景结构化列表排除归属当前章的条目并按容器分层、人物关系跨层逐行去重优先级 章 > 卷 > 书、folderDocs 原文归章级节）。

**功能边界（明确不做清单）**：自然语言编辑、剧本转换、WebDAV 同步、技能系统、禁用词批量管理与指南热重载功能、PDF 导出。创作规范三层已全部实现为 `agents-view`/`agents-edit`：小说级 `<书名>/WRITING_GUIDE.md` > 用户级 `<work_dir>/WRITING_GUIDE.md` > 系统级存插件设置 data.json（预置内置内容）。新增需求前先确认是否在该边界内。

**术语约定：用户可见文案一律称「小说」（原「故事」称呼已统一改掉）**；但磁盘文件名 `故事状态.md`、指南数据格式分类名（banned_words.ts 的「故事风格」等）、默认提示词与系统指南文本（llm_client.ts / system_guide_default.ts）保持原文不改。

**状态页「书籍列表」分组标题行右侧有占满剩余宽度的下拉框（`.aw-st-select`），选择即激活对应小说**（经 doSwitchStory→statusSwitchStory）；组内只展示当前激活小说的「全局文档/章节」小节、不枚举全部书名。
