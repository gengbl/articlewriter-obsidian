# L3 · 视图渲染与交互约定

## Modal 选型表

| Modal | 用途 |
| --- | --- |
| `TextInputModal` | 单个短文本输入（标题、ID、章节号等）；**v0.1.6+ 第 6 参可选 hintText：详细说明渲染在标题与输入框之间**（`.aw-prompt-hint`，muted 色 0.9em、white-space:pre-line 支持 \n 多行）；第 7 参可选 initialText 预填初始值（光标置末尾）。长说明一律走 hint 放输入框上方，placeholder 只留极短占位（main.ts prompt() 第 3 参 hint / 第 4 参 initial 透传）；**v0.3.7+ 第 8 参可选 multiline：改用 5 行 textarea**（contentEl 挂 `.aw-form-compact` 让无标签行 control 撑满＋textarea 挂 `.aw-prompt-textarea.aw-ta-rows` 宽度 100%、去全局 240px min-height 让 rows 生效＋`infoEl.remove()` 去掉定宽空标签列占满整行；底部「确定 CTA/取消」按钮行挂既有 `aw-btns-right` 成组贴右；裸回车＝换行，点「确定」或 Ctrl/Cmd+回车提交，Esc 取消）——仅 `cmdGenerateWorldview` 补问一句话设定传 true，其余调用点单行行为逐字不变 |
| `TextAreaPrompt` | 多行内容（场景正文、世界观历史、大纲追加） |
| `VolumeBatchCreateModal` | **批量新建卷**：顶部提示已有卷名单（重名校验），输入框+「添加」逐行把新卷名加入待建列表（回车=添加），每行带 ↑/↓（调创建顺序）/删除；「确定创建」（CTA，空列表禁用点击）→ onSubmit(names[]) 由 main.ts createVolumesInOrder 按序落盘；构造 `(app, storyName, existingNames[], onSubmit, onCancel?)`。命令面板「新建卷」、写字台右键「新建卷…」、零卷书整理/切换引导三处共用 pickNewVolumeNames 包装 |
| `MultiFieldModal` | 多字段表单；第 7 参 `initialValues` 预填——**所有"编辑已有实体"入口用它** |
| `AddCharacterModal` | **添加人物**（v0.2.0+）：单页「姓名 + 人物级别下拉 + 8 个设定字段 + 动态关系行（对象下拉 + 类型下拉 + ✕ 删除，可加多行）」，底部「确定」CTA。构造 `(app, scopes: CharacterScopeOption[], allCandidates: string[], relationTypes: string[], onSubmit, onCancel?)`；**Modal 只回数据、不碰 vault**——写人物与关系文档全在 main.ts `openAddCharacterDialog()`。候选口径：每行对象下拉以 `scopes[i].localCandidates`（该级别范围内已有角色名）优先，其余层级候选后缀「（其它层级）」；**切换级别只重建关系区、已选对象尽量保留**（旧值不在新候选里时补一个 option）。样式 `.aw-addchar-*`；**紧凑行距用通用类 `aw-form-compact`**（`AddCharacterModal` 与 `MultiFieldModal` 的 onOpen 都加在 contentEl 上）——属性字段行 `padding:1px`、**零分隔线**（选择器须写到 `.setting-item:not(:first-child)`〔0,3,0〕才能压过 Obsidian 同形内置规则〔0,2,0〕）、控件高 24px，**唯一一条横线**是 `.aw-form-compact h4`（「人物关系」小节标题）的 `border-top`；作用域不出这两个 Modal |
| `EventEditModal` | **时间线事件新增/编辑共用表单**（v0.3.3+，唯一入口＝时间线面板，见 [l3-timeline-view.md](./l3-timeline-view.md)）：构造 `(app, title, initialValues: Partial<EventEditResult>, charOptions, relatedOptions, onSubmit, onCancel?)`；字段＝时间点（**必填**、parseTimelineTime 可解析才提交，非法只内联报错不关弹窗）→事件名（可空＝无名）→人物（下拉多选）→已完成（toggle）→事件/影响（多行 textarea：事件 `rows=5`、影响 `rows=2`；两者挂 `aw-prompt-textarea` 复用宽度样式并加 `aw-ta-rows` 去掉其全局 240px min-height——不去掉则小 rows 被 min-height 盖过；**描述字段已移出弹窗**——`EventEditResult.desc` 提交时透传 `initialValues?.desc`，编辑保留既有 `- 描述：`、新增为空）→关联（下拉多选）；人物/关联共用私有 `makeMultiSelect`（已选行＋✕、行尾 select 只列未选候选、initial 旧值不丢）；`EventEditResult`＝{timeText, title, chars, done, event, desc, impact, related}。Modal 只回数据、不碰 vault——写回全在面板侧 mutate |
| `ActionMenuModal` | 通用动作列表：label + sub + marker（如 `▶ 当前`）+ disabled；↑↓/回车/点击选择。**一切"选一个实体再做操作"的菜单都用它**。交互约定：鼠标悬停行文字加粗提示可点；行采用 flex 布局并前置两个固定宽度列：`.aw-sel`（选中的非 disabled 行经其 `::before` 显示圆点 `●`，随 `.aw-selected` 类切换、无需重渲染）与 `.aw-cur`（承载「▶ 当前」等 marker，无则留空占位）——两列定宽使带/不带标记的行主标签起点始终一致、左对齐，↑↓移动选择不再右移/跳动；**点行只移动选中、不执行**——须再点「确认」CTA 或按回车才触发 onSelect（避免误触即改状态）。样式见 styles.css `.aw-action-row*`。 |
| `TextPanelModal` | 只读展示面板（show 类命令），行支持 bold/dim/accent |
| ~~`StreamingPreviewModal`~~→GenProgressView 流式阶段 | LLM 写作命令的流式预览已并入统一生成过程面板（ItemView「生成过程」，非居中 Modal）：beginStream(title) 进入小节，append/reset/setStatus + finish(保存/放弃)/fail + markStopped()（v0.4.x+：后处理阶段停止收尾时定格面板——停计时、状态行「已停止生成（用时 X），本章正文未保存」、页脚清空），done Promise 驱动写盘确认；点「停止生成」按钮/流式中关面板＝abort（v0.3.0+ 起 Esc 不再中断）；v0.4.x+ 面板焦点内按裸 Esc 被 view scope 吞掉（构造器里 `this.scope = new Scope(this.app.scope)`＋`register([], "Escape", () => false)`＝handled+preventDefault）——Obsidian 对非编辑器面板按 Esc 的默认行为是把焦点跳到最近使用的文档（用户实测表现为「显示的内容跳到其它文档」），此拦截消除该跳转；Esc 仍不做任何动作，带修饰键组合不受影响。与摘要延迟生成日志共用同一实例——先展示摘要工作过程、完成后同面板继续章节正文 |
| ~~`MarkdownViewerModal`~~ | （已删除——**v0.3.5+ 写作指南体系整体废弃**：该类曾用于只读渲染系统级创作规范等无 vault 载体的内容，最后一处调用「查看系统写作指南」已随体系移除，modals.ts 中类定义一并删除） |
| `ConfirmModal` | 危险操作确认；Esc=取消 |
| `StoryPickerModal` / `ChapterListModal` / `FolderPickerModal` | 小说选择 / 章节打开 / work_dir 初始化 |
| `NewStoryModal` | **建书三问**（v0.3.6+ 改版）：标题 text → **题材类型下拉**（四选项＝`PRESET_GENRES`，来自 skills_default 导出 `GENRE_SKILL_NAMES`（DEFAULT_SKILLS 四题材技法技能键）剥「写法」后缀：玄幻仙侠/科幻/历史武侠/都市现实，默认首项）→ 编写类型下拉（`PRESET_STYLES`）+自定义 text → 「创建」CTA。`onSubmit` 回 `NewStoryInput{title,genre,style}`，genre 落《故事状态.md》→【小说类型】提示词块；contentEl 挂 `aw-form-compact`（label 定宽、控件占满剩余空间） |

## 通用约定

- 统一「submitted/resolved 标志」模式：先置位再 `close()`，`onClose` 里未提交才触发 onCancel，防止 Esc 与按钮双触发。新 Modal 必须照抄该模式。
- **常驻 ItemView 渲染陷阱（规范原文，各视图文档均引用本条）**：本环境 Obsidian 对已注册视图不调用 `getEmptyStateElement()`（返回游离节点会整片空白），UI 必须在 `onOpen()` 里建进框架创建的 `this.contentEl`（内置日历等视图同款做法）；本地 patch dts 中 `ItemView.onClose` 签名是 `Promise<void>` 需声明 async；实例方法须实现 `getViewType()`/`getDisplayText()`/`getIcon()`，开文件用 `leaf.openFile(TFile)`（本 dts 无 setFile）。
- 文案风格：中文提示、错误带前缀（如「删除失败：…」）、成功 Notice 6–8s。
