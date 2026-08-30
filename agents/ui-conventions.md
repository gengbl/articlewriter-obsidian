# 交互约定（Modal 选型）

| Modal | 用途 |
| --- | --- |
| `TextInputModal` | 单个短文本输入（标题、ID、章节号等） |
| `TextAreaPrompt` | 多行内容（场景正文、世界观历史、大纲追加） |
| `MultiFieldModal` | 多字段表单；第 7 参 `initialValues` 预填——**所有"编辑已有实体"入口用它** |
| `ActionMenuModal` | 通用动作列表：label + sub + marker（如 `◀ 当前`）+ disabled；↑↓/回车/点击选择。**一切"选一个实体再做操作"的菜单都用它** |
| `TextPanelModal` | 只读展示面板（show 类命令），行支持 bold/dim/accent |
| `StreamingPreviewModal` | LLM 写作命令的流式预览：append/reset/setStatus + finish(保存/放弃)/fail，done Promise 驱动写盘确认 |
| `MarkdownViewerModal` | 只读渲染展示（系统级创作规范等无 vault 文件载体的内容），构造 `(app, title, markdown)` |
| `ConfirmModal` | 危险操作确认；Esc=取消 |
| `StoryPickerModal` / `ChapterListModal` / `FolderPickerModal` / `NewStoryModal` | 小说选择 / 章节打开 / work_dir 初始化 / 建书三问 |

- 统一「submitted/resolved 标志」模式：先置位再 `close()`，`onClose` 里未提交才触发 onCancel，防止 Esc 与按钮双触发。新 Modal 必须照抄该模式。
- **LLM 对话窗是常驻 ItemView 不是 Modal**：`LlmChatView`（`src/llm_chat_view.ts`）经 main.ts `registerView(LlmChatView.VIEW_TYPE, ...)` 注册 + ribbon 图标；自持 history 与每轮 AbortController，配置经构造注入的 getter 实时取 settings.llm（面板打开期间改设置后重新显示会自动刷新模型列表）。可见时才抢焦点（offsetParent 判空），避免停靠他区打断编辑。`StatusView`（状态页）同款：数据 getter + 写动作回调注入，渲染陷阱一致。
- 文案风格对齐 CLI：中文提示、错误带前缀（如「删除失败：…」）、成功 Notice 6–8s。
