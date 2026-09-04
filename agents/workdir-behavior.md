# work_dir 与小说切换行为约定（移植自 `/pwd` 与 `/dir`）

- work_dir 是容器目录本身不生成小说状态文档；每个小说是其下子文件夹（以含 `故事状态.md` 或遗留 `story_state.json` 判定）。
- **首次使用**任何命令弹 FolderPickerModal 初始化并持久化到插件设置（替代 CLI 写 config.json）。
- 切换工作目录后清空 `lastStory`（旧小说记忆作废）；随后按结果分支提示：0 本书→提示用「创建新小说」；1 本→自动加载为当前小说；多本→提示用「切换当前小说」。
- **设置/切换工作目录后自动投放《使用说明.md》**到 work_dir 根（pickWorkDir 回调内 seedUsageDoc，源=`docs/使用说明.md`（esbuild text loader 打包进 release/main.js，经 usage_guide_default.ts 再导出；每次功能变更须同步该文件，见 AGENTS.md 全局硬规则）；仅缺失或为空才写、绝不覆盖用户内容，新建时在切换通知里附带一句）。**插件启动时也自检**（onload→ensureUsageDocOnStartup）：workDir 已设且有效、但《使用说明.md》缺失或为空 → 自动创建并在 workspace 布局就绪后打开（openWhenLayoutReady；覆盖首装升级与文档被删场景），真·首启尚无工作目录则等 pickWorkDir 投放。「生成使用说明」命令可手动重建（同规则+成功后打开该文件）；pickWorkDir 新建时同样自动打开。
- 「切换当前小说」（switch-story）= CLI `/dir <work_dir>/<书名>` 的等价物：选书 → 设 lastStory → **若该书仍有平面结构残留则强制自动执行「按卷整理目录」、不可跳过**——残留判定含两种：有卷但已归属章留书根，或零卷却存在未识别章节目录；**全书无任何卷时迁移前先弹批量建卷页**（VolumeBatchCreateModal：手动把卷名加入列表、确定后按序创建；取消/空列表 = 跳过）→ 展示该书状态（章节数/当前章等），对应原版"加载该书，列出章节和当前状态"。写字台书籍下拉框切换（statusSwitchStory）走同一强制迁移路径。**lastStory/current_chapter 等元数据变更统一经 main.ts `notifyContextChanged()` 广播：除刷新 LLM 对话面板外，现同时 `scheduleStatusPanelRefresh(200)` 防抖刷新所有已打开的写字台——修复「用命令面板 `/dir` 切换当前小说后、其它分栏里已打开的写字台停留在旧书不更新」的 bug（写字台下拉框那条路本就自刷本栏，故此前仅跨分栏/命令入口暴露）**。失败置 flatBlocked 锁定该书结构操作直至手动成功。
- rescan 只重建目标小说的 state，不改变 work_dir / 当前小说选择（同 CLI `/scan` 语义）。
