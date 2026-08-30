# 变更日志

每次功能更新 / bug 修复完成后按「AGENTS.md · 工作更新写回约定」追加一行：日期 + 一句话摘要（一次任务的多个改动可合并成一条）。新条目追加在文件末尾。

- 2026-08-30：状态面板右键章节目录「新建文章…」路径修复（改用 `listChapters` 返回的真实章节目录，不再用会重复编号的 `chapterDirPath(story,num)`）；状态面板拆为固定头部 `.aw-st-top` + 可滚动树主体 `.aw-st-tree`（仅全局文档/章节树内部滚动，错误提示挂滚动区）；main.ts 订阅 vault 文件变更事件（workDir 内 .md）→ 防抖 800ms 自动刷新已打开状态面板，章节字数随写作落盘实时跟进，render 保持树区滚动位置；以上改动打包发布 **v0.0.3**（`articlewriter-v0.0.3.zip`）。
- 2026-08-30：状态页字体对齐侧栏文件列表——根因是文件列表项用专用变量 `--nav-item-size`(13px)/`--nav-item-color`(弱化灰)，面板原继承 body 的 15px+正文黑显得又大又黑；移除遗留 `font-size:0.85em`/下拉 `0.9em` 规则，`.aw-status-view` 改直接引用这两个变量；「小说状态」信息区 `.aw-st-status` 行高单独设为 1.6（继承值 1.3 偏紧）。
- 2026-08-30：更新时间显示改为本地时间——存储恒为 UTC ISO（`nowIso()`），原显示层直接字符串切片展示成 UTC；新增 `story_types.formatLocalDateTime(iso, full?)`，状态面板与 `/status` 命令均经其换算本地时间。
- 2026-08-30：「小说状态」书名行改版——更新时间从信息行移到书名同一行右对齐（`.aw-st-status-title` flex space-between），并改用含年份的本地格式 `YYYY-MM-DD HH:mm`；第三行只留章数·当前章·总字数。
- 2026-08-30：打包纳入写作指南——esbuild.config.mjs 把根目录 `WRITING_GUIDE.md` 一并拷入 `release/`，发布 zip 与部署均改为四个文件；AGENTS.md「运行环境与构建部署」新增打包条目。
