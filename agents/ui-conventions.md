# 交互约定（Modal 选型）

| Modal | 用途 |
| --- | --- |
| `TextInputModal` | 单个短文本输入（标题、ID、章节号等） |
| `TextAreaPrompt` | 多行内容（场景正文、世界观历史、大纲追加） |
| `VolumeBatchCreateModal` | **批量新建卷**：顶部提示已有卷名单（重名校验），输入框+「添加」逐行把新卷名加入待建列表（回车=添加），每行带 ↑/↓（调创建顺序）/删除；「确定创建」（CTA，空列表禁用点击）→ onSubmit(names[]) 由 main.ts createVolumesInOrder 按序落盘；构造 `(app, storyName, existingNames[], onSubmit, onCancel?)`。命令面板「新建卷」、写字台右键「新建卷…」、零卷书整理/切换引导三处共用 pickNewVolumeNames 包装 |
| `MultiFieldModal` | 多字段表单；第 7 参 `initialValues` 预填——**所有"编辑已有实体"入口用它** |
| `ActionMenuModal` | 通用动作列表：label + sub + marker（如 `▶ 当前`）+ disabled；↑↓/回车/点击选择。**一切"选一个实体再做操作"的菜单都用它**。交互约定：鼠标悬停行文字加粗提示可点；行采用 flex 布局并前置两个固定宽度列：`.aw-sel`（选中的非 disabled 行经其 `::before` 显示圆点 `●`，随 `.aw-selected` 类切换、无需重渲染）与 `.aw-cur`（承载「▶ 当前」等 marker，无则留空占位）——两列定宽使带/不带标记的行主标签起点始终一致、左对齐，↑↓移动选择不再右移/跳动；**点行只移动选中、不执行**——须再点「确认」CTA 或按回车才触发 onSelect（避免误触即改状态）。样式见 styles.css `.aw-action-row*`。 |
| `TextPanelModal` | 只读展示面板（show 类命令），行支持 bold/dim/accent |
| `StreamingPreviewModal` | LLM 写作命令的流式预览：append/reset/setStatus + finish(保存/放弃)/fail，done Promise 驱动写盘确认 |
| `MarkdownViewerModal` | 只读渲染展示（系统级创作规范等无 vault 文件载体的内容），构造 `(app, title, markdown)` |
| `ConfirmModal` | 危险操作确认；Esc=取消 |
| `StoryPickerModal` / `ChapterListModal` / `FolderPickerModal` / `NewStoryModal` | 小说选择 / 章节打开 / work_dir 初始化 / 建书三问 |

- 统一「submitted/resolved 标志」模式：先置位再 `close()`，`onClose` 里未提交才触发 onCancel，防止 Esc 与按钮双触发。新 Modal 必须照抄该模式。
- **LLM 对话窗是常驻 ItemView 不是 Modal**：`LlmChatView`（`src/llm_chat_view.ts`）经 main.ts `registerView(LlmChatView.VIEW_TYPE, ...)` 注册 + ribbon 图标；自持 history 与每轮 AbortController，配置经构造注入的 getter 实时取 settings.llm（面板打开期间改设置后重新显示会自动刷新模型列表）。可见时才抢焦点（offsetParent 判空），避免停靠他区打断编辑。`StatusView`（状态页）同款：数据 getter + 写动作回调注入，渲染陷阱一致。
- **写字台树节点约定**（status_view.ts）：行=纯展示+开合（点行只折叠/展开子级），激活一律走行尾 Radio（章节组名 `aw-chap-<书>`、卷组名 `aw-vol-<书>`，各自互斥）；右键菜单挂在「被点中的条目自身」与其块容器空白处（stopPropagation 不透传），删除类项仅出现在作用对象自己的菜单上且 danger 标红；层级缩进统一用 `.aw-st-kids`（左指示线），新增层级勿另造缩进样式。**无卷模式（StatusDetail.useVolumes===false）下**：三处右键入口的「新建卷…」项一律不渲染——书籍列表分组标题行（headItems）、全局文档分组标题及组内空白（gItems）、「章节」分组标题；空态文案也改为仅提「新建章节」（不提建卷）。有卷书（useVolumes!==false，含状态缺失兜底）保持原样显示全部建卷入口。**卷内「文档」子节点（v0.1.3+）**：每卷展开后**固定置顶**（始终排在章节目录之前、各章一律置于其后）、以命名头 `.aw-st-vol-dochead`（文案「文档（N）」）列出该卷实体目录下的直属 md（非章节目录，含建卷播种的设定四件套/卷摘要等）——**命名头字体与章节名行 `.aw-st-chap` 相同**（默认字号字色）；实测该命名头比同层章节名靠左约一个 caret 宽，故给 `.aw-st-vol-dochead` 补 `padding-left:1em` 使标签列对齐章节名（值随主题/字号可能需再微调），且标签文本无前导空格、紧跟 caret(自带 margin-right:0.35em) 起笔；其文件列表再嵌一层 `.aw-st-kids` 使各行对齐/缩进与「章节名下的文档」相同，层级缩进一律沿用 `.aw-st-kids` 不另造；命名头与每个文件行右键均提供「在本卷新建文档…」(StatusAction `new-volume-doc`→main.ts 落点为 `${storyPath}/${volumeFolderName(vol)}`)，文件行点击打开、可删除。**该命名头可独立折叠**：左侧带 ▾/▸ 纯视觉指示符（`.aw-st-caret`），鼠标点击整行即切换开合——状态键 `voldocs:<书>:<卷ID>` 复用 `collapsed` 集合、默认展开，收起时仅保留命名头、不渲染文件行，且与其所在卷节点的开合互不连动。数据由 story_manager.listVolumeDocsByVol 一次性枚举后经 StatusDetail.volumes[].docs 注入快照（view 只读渲染）。
- 文案风格对齐 CLI：中文提示、错误带前缀（如「删除失败：…」）、成功 Notice 6–8s。
