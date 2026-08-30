# work_dir 与小说切换行为约定（移植自 `/pwd` 与 `/dir`）

- work_dir 是容器目录本身不生成小说状态文档；每个小说是其下子文件夹（以含 `故事状态.md` 或遗留 `story_state.json` 判定）。
- **首次使用**任何命令弹 FolderPickerModal 初始化并持久化到插件设置（替代 CLI 写 config.json）。
- 切换工作目录后清空 `lastStory`（旧小说记忆作废）；随后按结果分支提示：0 本书→提示用「创建新小说」；1 本→自动加载为当前小说；多本→提示用「切换当前小说」。
- 「切换当前小说」（switch-story）= CLI `/dir <work_dir>/<书名>` 的等价物：选书 → 设 lastStory → 展示该书状态（章节数/当前章等），对应原版"加载该书，列出章节和当前状态"。
- rescan 只重建目标小说的 state，不改变 work_dir / 当前小说选择（同 CLI `/scan` 语义）。
