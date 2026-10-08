# L3 · main.ts 入口与命令流程

## 插件入口

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 插件入口：设置、命令注册（`addCommand`）、每个命令一个 `cmdXxx()` handler、通用交互辅助方法。人物关系面板接线见 [l2-relationship-panel.md](./l2-relationship-panel.md)、时间线面板接线见 [l2-timeline-panel.md](./l2-timeline-panel.md)、设置页声明式实现见 [l2-settings-llm-config.md](./l2-settings-llm-config.md)、每本书独立工作区见 [l2-workdir-story-switch.md](./l2-workdir-story-switch.md)、引言写字台动作见 [l2-writing-desk.md](./l2-writing-desk.md) |

## 新增命令的标准流程

1. 先明确新命令的语义与边界；提示词 / 错误文案风格与既有命令保持一致（参考 `command-reference.md` 对应条目）
2. 需要新文档格式 → `md_docs.ts` 加类型 + parse/format（纯函数）
3. 文件操作 → `story_manager.ts` 加 async 方法（只在这层碰 vault；写操作用后即时落盘，不缓存内容到内存字段）
4. 交互 → 复用 `modals.ts` 现有 Modal；确实不够再加新 Modal
5. `main.ts`：`this.addCommand({ id, name: "中文说明", callback: ... })` + 实现 `cmdXxx()`；handler 开头统一走 `ensureWorkDir()` / `requireStory()` 守卫，异常用 `notifyError(前缀, e)`
6. 同步更新 `README.md`（英文）与 `README_ZN.md`（中文）两份的命令表与 `command-reference.md` 的「已移植命令速查」（两版内容保持对齐，改一必改二）
7. `npm run build` → 复制部署 → Obsidian 内冒烟验证

## main.ts 通用辅助方法（handler 一律复用，不要重复造轮子）

- `ensureWorkDir()`：work_dir 未设置弹 FolderPickerModal 初始化；目录失效时重新选择。返回 `string | null`
- `activeStory()` / `requireStory()`：解析当前小说——记住上次选择（`settings.lastStory`），0 本书引导建书，1 本自动选中持久化，多本弹 StoryPickerModal
- `pickAction(title, ActionItem[])`：Promise 化的动作列表选择（回车/点击确认，Esc 取消返回 null）
- `confirmBox(...)`：危险操作二次确认
- `requireChapterNum(prompt)`：输入章节号并校验存在性
- `chapterLabel(num, title?)`：`第NN章 <标题>` 展示格式
- `notifyError(prefix, e)`：统一错误 Notice（6s）

- **LLM 写作命令共享辅助**（Phase 2，新增 LLM 命令一律复用不要重写）：`getLlmSetup()` 从插件 settings.llm（data.json）取激活配置+全局字段、无则 null；`loadWriterSetup()` = getLlmSetup + 缺失时弹通知返回 null；`loadWriterGuides(story)` 三层创作规范（小说级 > 用户级 > 系统级插件文件，顺序即优先级）——读三层后调 `persistAggregatedGuide` 合并落盘该书《写作指南汇总.md》，返回 guideText=该汇总去注释正文（**提示词仅注入它**）、bannedGuideText=合并后的禁用词类目；`writerSystemPrompt(baseSp, guides, writingStyle?, title?, charNames?)` = buildStoryTypeSystemPrompt(编写类型块+禁用词) → assembleSystemPrompt(custom > baseSp > DEFAULT，末尾附【创作规范】原文)；`streamOnce`(空流→""、Abort 上抛)/`streamWithEmptyRetry`(×3)/`generateChapterStreamed`(「生成→校验→带注记重生成」双次循环，最多3轮6调用)；`autoCleanAi(cfg, baseSp, guides, content, onProgress?)` 生成后去AI味（失败保留原文并弹摘要通知）；v0.1.4+ `effectivePrevN()`（data.json settings.prevChapters→有效窗口章数 N，空/非法回落 3）、`notifyGenProgress(msg|null)` + `getGenPanel(withOpen)`（manager onProgress 落地为**统一生成过程面板的日志阶段**：驱动 GenProgressView「生成过程」ItemView，每任务追加一行带时间戳日志并滚底、null=本轮结束写完成行；无实例时新开 tab，打不开仅告警不阻断生成）+ `beginWritingPanel(title)`（同一 ItemView 进入流式小节=原 StreamingPreviewModal 位置；返回 null 时命令弹通知取消）。onload registerView(GenProgressView.VIEW_TYPE)。并在 manager 构造注入 generateChapterSummary/generateVolumeSummary/onProgress 三个回调（LLM 闭包走 getLlmSetup+chatCompletion）；`targetChapterNum(story, verb)`/`promptArea(title, placeholder, initial?)` 章节号输入与多行输入封装。所有写盘前必须经 beginWritingPanel 取得的视图走 `finish() + await done`（保存/放弃确认），去AI味等后处理期间用其 `setStatus(...)` 更新进度文案
- **创作规范文件生命周期 / 汇总持久化**：`systemGuidePath()` = `${configDir}/plugins/<id>/WRITING_GUIDE.md`（固定，非用户可配）；`ensureSystemGuideFile()`（onload 调一次，缺失则用 data.json 内嵌值或内置默认播种、失败不阻断启动）；`readSystemGuideText()`（读不到回落内置默认）。汇总侧——`aggregatePath(story)`=`<书目录>/写作指南汇总.md`；`persistAggregatedGuide(story,book,user,sys)`=mergeGuideCategories→serializeAggregateGuide→embedAggHash(三层 md5)→writeGuideAt，返回 `{ guideText: stripComments(body), merged }`；`rebuildAggregatedGuide(story)`=读三层并与已存 agg-hash 比对、仅变更时重算落盘（供 `/agents edit` 保存后与重置命令刷新）。两个新命令 handler：`cmdGenerateWritingGuide()`（对用户级 work_dir 与当前书各建同格式空模板 buildEmptyGuideTemplate(DEFAULT_SYSTEM_GUIDE)，目标非空则跳过并提示）、`cmdRegenerateSystemGuide()`（confirmBox 二次确认后 writePluginFile 覆盖系统级文件为内置默认，再尽力刷新当前书汇总）。使用说明侧——`usageDocPath()`（work_dir 根的《使用说明.md》，vault 根时=顶层文件）、`seedUsageDoc()`（设置/切换工作目录后自动投放，仅缺失或为空写入 DEFAULT_USAGE_GUIDE、失败只 console.warn 不阻断切换）、`cmdGenerateUsageDoc()`（手动重建，非空跳过并提示，成功打开该文件）
