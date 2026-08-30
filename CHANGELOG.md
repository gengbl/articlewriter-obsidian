# 变更日志

每次功能更新 / bug 修复完成后按「AGENTS.md · 工作更新写回约定」追加一行：日期 + 一句话摘要（一次任务的多个改动可合并成一条）。新条目追加在文件末尾。

- 2026-08-30：状态面板右键章节目录「新建文章…」路径修复（改用 `listChapters` 返回的真实章节目录，不再用会重复编号的 `chapterDirPath(story,num)`）；状态面板拆为固定头部 `.aw-st-top` + 可滚动树主体 `.aw-st-tree`（仅全局文档/章节树内部滚动，错误提示挂滚动区）；main.ts 订阅 vault 文件变更事件（workDir 内 .md）→ 防抖 800ms 自动刷新已打开状态面板，章节字数随写作落盘实时跟进，render 保持树区滚动位置；以上改动打包发布 **v0.0.3**（`articlewriter-v0.0.3.zip`）。
- 2026-08-30：状态页字体对齐侧栏文件列表——根因是文件列表项用专用变量 `--nav-item-size`(13px)/`--nav-item-color`(弱化灰)，面板原继承 body 的 15px+正文黑显得又大又黑；移除遗留 `font-size:0.85em`/下拉 `0.9em` 规则，`.aw-status-view` 改直接引用这两个变量；「小说状态」信息区 `.aw-st-status` 行高单独设为 1.6（继承值 1.3 偏紧）。
- 2026-08-30：更新时间显示改为本地时间——存储恒为 UTC ISO（`nowIso()`），原显示层直接字符串切片展示成 UTC；新增 `story_types.formatLocalDateTime(iso, full?)`，状态面板与 `/status` 命令均经其换算本地时间。
- 2026-08-30：「小说状态」书名行改版——更新时间从信息行移到书名同一行右对齐（`.aw-st-status-title` flex space-between），并改用含年份的本地格式 `YYYY-MM-DD HH:mm`；第三行只留章数·当前章·总字数。
- 2026-08-30：打包纳入写作指南——esbuild.config.mjs 把根目录 `WRITING_GUIDE.md` 一并拷入 `release/`，发布 zip 与部署均改为四个文件；AGENTS.md「运行环境与构建部署」新增打包条目。
- 2026-08-30：新增 RELEASE.md（代码提交 / 版本打包 / Gitea Release 发布的完整流程脚本 + 实测坑位），AGENTS.md Git 节增加引用；修正 v0.0.4 Gitea 附件漏 WRITING_GUIDE.md（重打 release/ 全量包并重建 Release）。
- 2026-08-30：v0.0.5 插件目录审核修复——banned_words.ts/prompts.ts 移除全部 lookbehind 断言（iOS Safari <16.4 会抛 SyntaxError；改「(?:^|[^X])」前缀组 + $N 回补模式，2万条随机语料对照旧规则零差异验证），正则统一编号捕获组；modals/llm_chat_view/main.ts 的 JS 内联样式赋值迁入 styles.css 静态类（`.aw-action-list`、`.aw-prompt-textarea`、`.aw-stream-*`、`.aw-chat-status.is-hidden/is-error` 等）；getEmptyStateElement 不再用 document.createElement 返回游离节点；revealLeaf→setActiveLeaf；TFolder 断言改 instanceof 收窄；删除未使用变量/常量（reason、CHAPTER_INFO_KEYS）、catch(_e) 空块；manifest 描述加英文+author=fosky，新增 MIT LICENSE，README 增加英文概览节。
- 2026-08-30：Lint 清理与设置页现代化——llm_client.buildParams 去 `as any`（改返回带索引签名的 `LlmChatBody`，model 可空+透传 openai_extras）；modals.ts 事件回调/选择器覆写统一 `void` 包裹消除「Promise returned where void expected」；删除操作 ×4 处由 `vault.trash(file,false)` 迁移到 `app.fileManager.trashFile(file)`（跟随用户删除方式设置）；移除 7 处冗余 `createEl(...) as HTMLElement*` 断言（本地 patch dts 的 createEl 本身泛型返回精确类型）；设置页新增声明式实现 `getSettingDefinitions()`+`getControlValue/setControlValue`（Obsidian ≥1.13 生效：LLM 配置渲染为 list+子页支持新建/删除/重排，key 约定 cfg.<下标>.<field>），旧 `display()/renderLlm()` 保留作 <1.13 回落。打包发布 **v0.0.6**。
- 2026-08-30：v0.0.7——manifest minAppVersion 由 1.4.0→**1.13.0**（声明式设置 API @since 1.13.0、fileManager.trashFile @since 1.6.6；社区插件目录校验 obsidianmd/no-unsupported-api 要求声明版本覆盖全部所用 API）；RELEASE.md 增补 GitHub 镜像 Release 资产要求（main.js/manifest.json/styles.css 必须作为独立附件上传，zip 可并存仅作额外资产）。
