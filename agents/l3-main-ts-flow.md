# L3 · main.ts 入口与命令流程

## 插件入口

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 插件入口：设置、命令注册（`addCommand`）、每个命令一个 `cmdXxx()` handler、通用交互辅助方法。人物关系面板接线见 [l3-relationship-view.md](./l3-relationship-view.md)、时间线面板接线见 [l3-timeline-view.md](./l3-timeline-view.md)、设置页声明式实现见 [l3-settings-page.md](./l3-settings-page.md)、每本书独立工作区见 [l3-workdir-workspace.md](./l3-workdir-workspace.md)、引言写字台动作见 [l3-status-view.md](./l3-status-view.md) |

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

- **LLM 写作命令共享辅助**（Phase 2，新增 LLM 命令一律复用不要重写）：`getLlmSetup()` 从插件 settings.llm（data.json）取激活配置+全局字段、无则 null；`loadWriterSetup()` = getLlmSetup + 缺失时弹通知返回 null；`loadWriterGuides(story)` 三层创作规范（小说级 > 用户级 > 系统级插件文件，顺序即优先级）——读三层后调 `persistAggregatedGuide` 合并落盘该书《写作指南汇总.md》，返回 guideText=该汇总去注释正文（**提示词仅注入它**）、bannedGuideText=合并后的禁用词类目；`writerSystemPrompt(baseSp, guides, writingStyle?, title?, charNames?)` = buildStoryTypeSystemPrompt(编写类型块+禁用词) → assembleSystemPrompt(custom > baseSp > DEFAULT，末尾附【创作规范】原文)；`streamOnce`(空流→""、Abort 上抛；v0.2.x+ 加可选 `extra?: Record<string, unknown>` 参透传 chatStream——如 AI 兜底拆分强制 max_tokens≥8192)/`streamWithEmptyRetry`(×3，同样透传 extra)/`generateChapterStreamed`(「生成→校验→带注记重生成」双次循环，最多3轮6调用)；`autoCleanAi(cfg, baseSp, guides, content, onProgress?)` 生成后去AI味（失败保留原文并弹摘要通知）；v0.1.4+ `effectivePrevN()`（data.json settings.prevChapters→有效窗口章数 N，空/非法回落 3）、`notifyGenProgress(msg|null)` + `getGenPanel(withOpen)`（manager onProgress 落地为**统一生成过程面板的日志阶段**：驱动 GenProgressView「生成过程」ItemView，每任务追加一行带时间戳日志并滚底、null=本轮结束写完成行；无实例时新开 tab，打不开仅告警不阻断生成）+ `beginWritingPanel(title)`（同一 ItemView 进入流式小节=原 StreamingPreviewModal 位置；返回 null 时命令弹通知取消）+ v0.2.x+ `genVolOutlineIncremental(opts)`（/vol-outline-generate · 无卷兜底 · 书级大纲→生成卷 三入口共用）：卷大纲增量分段生成——第 0 步【卷设计】段（hasDesign=false 跳过）＋每个章号一个 `## 第N章` 小节，全程同一面板实例；每段 beginStream(label) 实时流式 → streamWithEmptyRetry → 立即 commit(segmentText, kind) 落盘（调用方闭包自管累积 body 与空行分隔，助手已去每段尾部空白）→ finishAuto(msg, "段落用时") 再继续下一段；每章提示词由调用方 buildChapterPrompt(chapterNum, volumeDesign, generatedSoFar) 构建，generatedSoFar＝本轮已生成各段拼接（助手维护，保证跨段因果链）；返回 {aborted, failed, written, panelFailed}——panelFailed＝面板打不开（调用方自行处理）、aborted＝用户 Esc/关面板（已落盘段落保留）、failed＝某段 LLM 失败/连续空/落盘失败（已落盘段落保留）。onload registerView(GenProgressView.VIEW_TYPE)。并在 manager 构造注入 generateChapterSummary/generateVolumeSummary/onProgress 三个回调（LLM 闭包走 getLlmSetup+chatCompletion）；v0.2.13+ `buildPlanningGuideInput(story, state, existingGuide?, opts?{chapterCount?, worldOnly?})`（组装 PlanningGuideInput：书籍信息＋世界观＋全书大纲＋卷列表〔flatMode 感知、平铺为空〕＋全部已有章节阅读序及其已存摘要；**v0.2.x+ opts.chapterCount 入 chapterCount、flatMode=state.use_volumes===false 恒置、worldOnly 跳过大纲/卷/章节加载**——供 /planning-guide·/planning-guide-worldview 与 ensurePlanningGuide 自动生成路径共用）＋`ensurePlanningGuide(story, state)`（readPlanningGuide 为空则 loadWriterSetup 守卫→beginWritingPanel("自动生成策划指南")→streamWithEmptyRetry〔system=BOOK_OUTLINE_GEN_SYSTEM_PROMPT〕→成功 setPlanningGuide＋finishAuto 后返回清洗文本；中止/连续空结果仅 Notice 告警返回 ""——**软依赖**，三个大纲生成命令〔book-outline-generate / vol-outline-generate 含无卷兜底批量路径 / book-outline-to-volumes〕生成前调用）；`cmdPlanningGuide()`（/planning-guide 手动生成：已存在且非空先 pickAction 整体重写/取消，流式→setPlanningGuide＋finishAuto 自动落盘）；`targetChapterNum(story, verb)`/`promptArea(title, placeholder, initial?)` 章节数输入与多行输入封装。所有写盘前必须经 beginWritingPanel 取得的视图走 `finish() + await done`（保存/放弃确认）——**免确认自动保存路径除外**（连续编写与卷大纲增量落盘直接 `finishAuto(message?, elapsedLabel?)` 收尾，见 [l2-llm-writing-commands.md](./l2-llm-writing-commands.md)），去AI味等后处理期间用其 `setStatus(...)` 更新进度文案
- **创作规范文件生命周期 / 汇总持久化**：`systemGuidePath()` = `${configDir}/plugins/<id>/WRITING_GUIDE.md`（固定，非用户可配）；`ensureSystemGuideFile()`（onload 调一次，缺失则用 data.json 内嵌值或内置默认播种、失败不阻断启动）；`readSystemGuideText()`（读不到回落内置默认）。汇总侧——`aggregatePath(story)`=`<书目录>/写作指南汇总.md`；`persistAggregatedGuide(story,book,user,sys)`=mergeGuideCategories→serializeAggregateGuide→embedAggHash(三层 md5)→writeGuideAt，返回 `{ guideText: stripComments(body), merged }`；`rebuildAggregatedGuide(story)`=读三层并与已存 agg-hash 比对、仅变更时重算落盘（供 `/agents edit` 保存后与重置命令刷新）。两个新命令 handler：`cmdGenerateWritingGuide()`（对用户级 work_dir 与当前书各建同格式空模板 buildEmptyGuideTemplate(DEFAULT_SYSTEM_GUIDE)，目标非空则跳过并提示）、`cmdRegenerateSystemGuide()`（confirmBox 二次确认后 writePluginFile 覆盖系统级文件为内置默认，再尽力刷新当前书汇总）。使用说明侧——`usageDocPath()`（work_dir 根的《使用说明.md》，vault 根时=顶层文件）、`seedUsageDoc()`（设置/切换工作目录后自动投放，仅缺失或为空写入 DEFAULT_USAGE_GUIDE、失败只 console.warn 不阻断切换）、`cmdGenerateUsageDoc()`（手动重建，非空跳过并提示，成功打开该文件）
