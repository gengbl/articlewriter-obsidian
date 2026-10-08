# L3 · 视图渲染与交互约定

## Modal 选型表

| Modal | 用途 |
| --- | --- |
| `TextInputModal` | 单个短文本输入（标题、ID、章节号等）；**v0.1.6+ 第 6 参可选 hintText：详细说明渲染在标题与输入框之间**（`.aw-prompt-hint`，muted 色 0.9em、white-space:pre-line 支持 \n 多行）；第 7 参可选 initialText 预填初始值（光标置末尾）。长说明一律走 hint 放输入框上方，placeholder 只留极短占位（main.ts prompt() 第 3 参 hint / 第 4 参 initial 透传） |
| `TextAreaPrompt` | 多行内容（场景正文、世界观历史、大纲追加） |
| `VolumeBatchCreateModal` | **批量新建卷**：顶部提示已有卷名单（重名校验），输入框+「添加」逐行把新卷名加入待建列表（回车=添加），每行带 ↑/↓（调创建顺序）/删除；「确定创建」（CTA，空列表禁用点击）→ onSubmit(names[]) 由 main.ts createVolumesInOrder 按序落盘；构造 `(app, storyName, existingNames[], onSubmit, onCancel?)`。命令面板「新建卷」、写字台右键「新建卷…」、零卷书整理/切换引导三处共用 pickNewVolumeNames 包装 |
| `MultiFieldModal` | 多字段表单；第 7 参 `initialValues` 预填——**所有"编辑已有实体"入口用它** |
| `AddCharacterModal` | **添加人物**（v0.2.0+）：单页「姓名 + 人物级别下拉 + 8 个设定字段 + 动态关系行（对象下拉 + 类型下拉 + ✕ 删除，可加多行）」，底部「确定」CTA。构造 `(app, scopes: CharacterScopeOption[], allCandidates: string[], relationTypes: string[], onSubmit, onCancel?)`；**Modal 只回数据、不碰 vault**——写人物与关系文档全在 main.ts `openAddCharacterDialog()`。候选口径：每行对象下拉以 `scopes[i].localCandidates`（该级别范围内已有角色名）优先，其余层级候选后缀「（其它层级）」；**切换级别只重建关系区、已选对象尽量保留**（旧值不在新候选里时补一个 option）。样式 `.aw-addchar-*`；**紧凑行距用通用类 `aw-form-compact`**（`AddCharacterModal` 与 `MultiFieldModal` 的 onOpen 都加在 contentEl 上）——属性字段行 `padding:1px`、**零分隔线**（选择器须写到 `.setting-item:not(:first-child)`〔0,3,0〕才能压过 Obsidian 同形内置规则〔0,2,0〕）、控件高 24px，**唯一一条横线**是 `.aw-form-compact h4`（「人物关系」小节标题）的 `border-top`；作用域不出这两个 Modal |
| `ActionMenuModal` | 通用动作列表：label + sub + marker（如 `▶ 当前`）+ disabled；↑↓/回车/点击选择。**一切"选一个实体再做操作"的菜单都用它**。交互约定：鼠标悬停行文字加粗提示可点；行采用 flex 布局并前置两个固定宽度列：`.aw-sel`（选中的非 disabled 行经其 `::before` 显示圆点 `●`，随 `.aw-selected` 类切换、无需重渲染）与 `.aw-cur`（承载「▶ 当前」等 marker，无则留空占位）——两列定宽使带/不带标记的行主标签起点始终一致、左对齐，↑↓移动选择不再右移/跳动；**点行只移动选中、不执行**——须再点「确认」CTA 或按回车才触发 onSelect（避免误触即改状态）。样式见 styles.css `.aw-action-row*`。 |
| `TextPanelModal` | 只读展示面板（show 类命令），行支持 bold/dim/accent |
| ~~`StreamingPreviewModal`~~→GenProgressView 流式阶段 | LLM 写作命令的流式预览已并入统一生成过程面板（ItemView「生成过程」，非居中 Modal）：beginStream(title) 进入小节，append/reset/setStatus + finish(保存/放弃)/fail，done Promise 驱动写盘确认；Esc/停止生成=abort。与摘要延迟生成日志共用同一实例——先展示摘要工作过程、完成后同面板继续章节正文 |
| `MarkdownViewerModal` | 只读渲染展示（系统级创作规范等无 vault 文件载体的内容），构造 `(app, title, markdown)` |
| `ConfirmModal` | 危险操作确认；Esc=取消 |
| `StoryPickerModal` / `ChapterListModal` / `FolderPickerModal` / `NewStoryModal` | 小说选择 / 章节打开 / work_dir 初始化 / 建书三问 |

## 通用约定

- 统一「submitted/resolved 标志」模式：先置位再 `close()`，`onClose` 里未提交才触发 onCancel，防止 Esc 与按钮双触发。新 Modal 必须照抄该模式。
- **常驻 ItemView 渲染陷阱（规范原文，各视图文档均引用本条）**：本环境 Obsidian 对已注册视图不调用 `getEmptyStateElement()`（返回游离节点会整片空白），UI 必须在 `onOpen()` 里建进框架创建的 `this.contentEl`（内置日历等视图同款做法）；本地 patch dts 中 `ItemView.onClose` 签名是 `Promise<void>` 需声明 async；实例方法须实现 `getViewType()`/`getDisplayText()`/`getIcon()`，开文件用 `leaf.openFile(TFile)`（本 dts 无 setFile）。
- 文案风格：中文提示、错误带前缀（如「删除失败：…」）、成功 Notice 6–8s。
