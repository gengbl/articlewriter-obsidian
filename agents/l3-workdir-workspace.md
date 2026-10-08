# L3 · work_dir 与每书工作区实现细节

work_dir 初始化与每书独立工作区模块的实现级说明（源文件职责：使用说明投放 / main.ts 工作区相关部分）；模块级行为见 [l2-workdir-story-switch.md](./l2-workdir-story-switch.md)。

## 相关源文件

| 文件 | 职责 |
| --- | --- |
| `src/usage_guide_default.ts` | 《使用说明.md》**内置默认文本**（DEFAULT_USAGE_GUIDE：快速上手/命令一览/常驻面板@引用语法/设置项/目录结构/常用标记速查，面向 vault 内用户、勿引用仓库路径）。两个投放点同源——①pickWorkDir 回调内 `seedUsageDoc()` 在设置/切换工作目录后自动写入 work_dir 根（仅缺失或为空才写）、②`generate-usage-doc` 命令手动重建（成功后 openMarkdown 打开）；均不覆盖已有非空内容。内容为独立文档 [docs/使用说明.md](../docs/使用说明.md)（esbuild `.md=text` 打包内联），更新用法直接编辑该 md |
| `src/main.ts`（每本书独立工作区部分） | **v0.2.1+ 每本书独立工作区**：`bookWorkspacePath(story)`＝`.obsidian/plugins/<id>/workspaces/<书名>.json`、`captureBookWorkspace(story)`（getLayout→JSON `{v,platform,layout}` 尽力存档）、`loadBookWorkspace(story, closeIfNoArchive?)`（changeLayout 恢复；跨端/损坏静默 false，成功 Notice；无存档且 closeIfNoArchive=true → `closeOpenDocs()` 关主编辑区全部 markdown 页签[iterateRootLeaves+detach]）、**`applyStorySwitch(next, closeIfNoArchive?)`＝所有改 lastStory 路径的统一入口**（归档旧书→写回 saveSettings→恢复新书；重选同书 no-op；仅 `switch-story` 选择器、写字台下拉框、新建书三个显式切书点传 true）＋ onload 订阅 workspace `layout-change` 防抖 1500ms 自动存当前书（3s 窗过滤自身 changeLayout 回声）；rename/delete-story 迁移/清理存档文件——语义细节见 [l2-workdir-story-switch.md](./l2-workdir-story-switch.md)「行为约定」v0.2.1+ 条。其余部分见 [l3-main-ts-flow.md](./l3-main-ts-flow.md) |
