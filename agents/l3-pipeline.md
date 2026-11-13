# L3 · 全自动写书流水线实现细节（v0.3.0+）

改动 auto-book-run（全自动写书）/ auto-book-config（配置全自动建书…）/ worldview-generate 相关代码前必读对应条目。

## src/pipeline.ts（纯数据 + 纯函数，不 import obsidian）

- `StageId = "worldview" | "planning" | "book-outline" | "volumes" | "chapter-outlines" | "bodies"`；`StageDef { id, name, command, requirements }`；`PIPELINE_STAGES` 按执行顺序排列（worldview 无前置需求）。
- `StageRequirement { id, when, label }`：`when: "always" | "volumes" | "flat"`——预检按书模式过滤（flat 模式排除 volumes 项、分卷模式排除 flat 项）；`id` 是 main.ts 侧文件检查的 switch 键（此处不掺 IO）；`label` 直接进预检失败 Notice。
- 纯函数：`stageById`（未知 id throw）、`stagesFrom(startAt, stopAt?)`（v0.3.1+：切片＝起始到停止节点〔含 stopAt〕，stopAt 省略＝到末尾；stopAt 排在 startAt 之前＝返回空数组，调用方须防空区间）、`requirementsFor(startAt, flatMode)`（只取**起始阶段**的需求表并按 when 过滤——起跑点之前的阶段不跑，其文件需求由起始阶段 requirements 覆盖；停止节点不影响预检需求）。
- 测试：`src/pipeline.test.ts`（5 条断言：阶段顺序/stagesFrom 尾部切片/stagesFrom stopAt 截断与空区间/requirementsFor 模式过滤/stageById 抛错）。`npm test` 脚本已改双入口 esbuild 到 `.tmp-tests/`（`outExtension: {'.js':'.mjs'}`，显式传两个 .mjs 给 `node --test`——Node 24 不接受目录参数），`.gitignore` 含 `/.tmp-tests/`。

## main.ts：AutoRun 上下文与免交互 hook

- `interface AutoRun`（main.ts 顶部）：`premise / volumeCount / chapterCounts / flatTotalChapters / overwrite / countOverride / stopped`。`countOverride` 是当前阶段的章数弹窗显式答案（null＝不覆盖、按 chapterCounts 末值兜底）。
- `private auto: AutoRun | null`——非 null 即「流水线运行中」，各 prompt/confirm 助手开头检查 `if (this.auto)` 直接返回参数值。**现有 hook 站点**（新增交互助手时须同步考虑 auto 分支）：
  - `promptChapterCountInput`（约 :802）：取 `countOverride ?? chapterCounts 末值`，皆无＝返回取消（防御）。
  - 大纲生成模式选择（约 :819）：返回 0＝「完整生成」（覆盖与否由 overwrite 决定，不走「按已有进度继续」）。
  - 逐卷章数批量输入（约 :852）：按 chapterCounts 展开，与卷声明数不齐时末值复制补齐。
  - 清理/覆盖类 confirm（约 :1159）：返回 `auto.overwrite`。
  - 卷数弹窗两处（约 :5035 book-outline 有卷模式、约 :5376 book-outline-to-volumes）：返回 `auto.volumeCount`。
  - `cmdGenerateWorldview` premise（约 :5186）：`this.auto ? this.auto.premise : state.one_line`。
  - `cmdGenerateBookOutline` 三处保存 CTA（约 :5485/:5515/:5553）：`if (this.auto) modal.autoAccept()`；覆盖/追加 pickAction（约 :5564）：auto 直取 0＝「覆盖」。其余 7 处 CTA 站点不在流水线路径、有意未插。
- **TS 收窄陷阱**：`this.auto` 跨 await 会被收窄失效（其他方法可置 null），编排内一律用局部 `const auto: AutoRun`；hook 站点用 `this.auto.xxx` 前须先局部化（如 `this.auto ? this.auto.premise : …`）。

## main.ts：全自动写书流水线编排段（cmdWriteConsecutive 之后、/continue 段之前）

- 命令注册（:209–212）：`worldview-generate` / `auto-book-stop` / `auto-book-config` / `auto-book-run`（v0.4.1+：旧 `book-skill-create` / `auto-book-from-skill` 已删除，独立 `auto-book` 命令更早已移除，入口只剩 auto-book-run 一条路径）。无独立 slash 注册表——`/xxx` 只写在命令 name 文案里。
- `runAutoBook(story, flatMode, input)`：
  1. `stages = stagesFrom(input.startAt, input.endAt)` 预计算执行范围——空数组（停止节点排在起始节点之前）即 Notice「全自动未开始——停止节点排在起始节点之前，执行范围为空」return（v0.3.1+ 兜底，弹窗侧已校验）。然后 `autoMissing(story, requirementsFor(input.startAt, flatMode))` 预检——非空即 Notice 列缺失项 return（**零生成**）。
  2. 置 `this.auto = auto`（局部 const）+ `this.lastGenPanel = null`（清上一轮含手动生成的面板 abort 残留）。
  3. `for (stage of stages)`（即 `stagesFrom(startAt, endAt)` 的预计算结果）：阶段前查 `autoAborted()` → 平铺跳过 volumes → `!overwrite && autoStageHasOutput` 整阶段跳过 → book-outline/chapter-outlines 阶段设 `countOverride = flatMode ? flatTotalChapters : null` → Notice 阶段进入 → switch 直接 `await this.cmdXxx()` → 阶段后再查 `autoAborted()`。
  4. chapter-outlines 分卷：`volumeList` 逐卷 `cmdVolumeOutlineToChapters(vols[i].id)`，每卷前查 abort、`countOverride = chapterCounts[i] ?? 末值 ?? null`；平铺：无参调用＝拆书级《大纲.md》。
  5. `finally { this.auto = null }`；汇总 Notice（执行链/跳过/停止于）。
- `autoMissing`：switch(r.id) 六类检查——`readWorldDoc().fullText ?? ""` 非空 / `readGlobalOutline` 非空 / `parseVolumeDeclarations(readGlobalOutlineFile)` 非空（**原文检查**，清洗版会剥声明行）/ `outlineChapterHeadings(readGlobalOutline)` 非空（只认标题式 `## 第N章`）/ `volumeList` 非空且逐卷 `splitVolOutlineByChapter().segments` 非空 / `listChapters` 非空且逐章 `readChapterOutlineForPrompt` 非空；try/catch 读取异常按缺失。
- `autoStageHasOutput`：仅 worldview/planning/book-outline 三阶段（`readWorldDoc.fullText` / `readPlanningGuide` / `readGlobalOutline` 非空）；读取异常按无产物（该阶段重跑）。
- `autoAborted()`：`this.auto?.stopped === true || this.lastGenPanel?.signal.aborted === true`。
- `cmdStopAutoBook`：无 auto 则 Notice return；置 `auto.stopped = true` + `(await this.getGenPanel(false))?.requestStop()`。
- `lastGenPanel: GenProgressView | null`：`getGenPanel` 两处命中即缓存（:4146 遍历 leaves、:4151 新建）。**面板 onClose 后 leaf 脱离但实例引用仍在**——这就是缓存存在的原因；`signal.aborted` 只在真正 abort（点「停止生成」按钮/流式中关面板，v0.3.0+ 起 Esc 不再中断）时为 true，阶段间正常关面板不置停。

## src/gen_progress_view.ts

- `autoAccept()`（:253）：done 态（finish 后等待保存 CTA）自动 `end(true)`＝等价点「保存」。与 `finishAuto`（流式态自动保存、跳过 done 态）互补。
- `requestStop()`（:258）：streaming→`ctrl.abort()`；done→`end(false)`（放弃保存收尾）；idle/已收尾无操作。
- `signal` getter 透出当前 AbortController.signal；`beginStream` 每轮新建 controller——阶段间 abort 状态不跨轮残留（但 lastGenPanel 缓存的是**最近一轮**的 signal，runAutoBook 开头置 null 再清一次保险）。

## src/modals.ts：AutoBookModal（仅「全自动写书」缺参补填时打开——标题「全自动写书 — 补填参数」）

- `AutoBookInput { startAt, endAt?, premise, volumeCount, chapterCounts, flatTotalChapters, overwrite }`（`endAt` v0.3.1+，undefined＝跑到流水线末尾）；import `PIPELINE_STAGES, StageId`（pipeline.ts 不 import obsidian，无循环依赖）。
- **`addStageRangeSettings(container, init, onStartChange?)` 共用助手（v0.3.1+，AutoBookModal / BookSkillCreateModal / SkillRangeModal 三处复用）**：渲染「起始节点」「停止节点」两个下拉（均按 PIPELINE_STAGES 顺序；停止下拉多一项「跑到末尾（连续编写正文）」＝undefined），返回 `{ startAt(), endAt(), error() }` 闭包——`error()` 校验停止节点是否排在起始节点之前（非法返回中文错误串，合法返回空串）。v0.4.1+ 起第三参 `onStartChange(id)`＝起始节点变更回调（起始下拉 onChange 里触发），AutoBookModal/AutoBookConfigModal 用它联动「一句话设定」行显隐（只在 `startAt()==="worldview"` 时显示，`aw-hide` 类切换）。
- 表单（v0.4.1+ 重构为共用助手）：起始/停止节点双下拉（上述助手，带 `onStartChange` 联动）/ 一句话设定（`addPremiseSetting`：堆叠布局 `aw-setting-stack`——标签自占一行、textarea 自占一行吃满弹窗宽度，`rows = 6`＋`resize:vertical`；仅起始节点＝worldview 时显示，`aw-hide` 类切换）/ 规模参数（`addScaleSettings`：按模式互斥显隐〔aw-hide 类〕——平铺仅「全书总章数」可编辑输入；分卷仅卷数＋各卷章数〔逗号/顿号/空格分隔〕，全书总章数整行隐藏、`syncCountsDesc()` 把推算值实时写进各卷章数说明行「（全书总章数 = N）」）/ 覆盖 toggle。校验：`scale.error()`＋`range.error()`＋worldview 起始必填 premise；失败写行内 errEl、不关窗。提交取 `scale.read()`（单值各卷章数按卷数复制填满）。预填值＝《故事状态.md》auto_book 配置里已有的参数（startAt/endAt/premise/卷数/各卷章数/总章数，空值留空待补）。
- `onSubmit` 在 `close()` 之后 await；`onCancel` 可选（未提交关闭时回调，cmdAutoBookRun 补填路径未传）。

## src/modals.ts：SkillRangeModal（v0.3.1+，「全自动写书」参数齐全时的范围确认弹窗）

- 构造：`(app, title, init: { startAt?, endAt? }, onSubmit: (startAt, endAt?) => …)`——v0.4.1+ 第 2 参改传书名（`state.title || "当前书"`，旧版是技能名）；无 onCancel，取消/Esc＝什么都不做（不跑流水线）。
- 标题「全自动写书 — <书名>」，说明行解释「停止节点也会执行，『跑到末尾』＝一直执行到『连续编写正文』」；表单即 `addStageRangeSettings` 双下拉（预填 `auto_book` 的 start/end）；「开始」按钮先查 `range.error()`（非法写行内 errEl 不关窗），合法才 `close()` 后回调 `(startAt, endAt)` → main.ts 侧转手喂 `runAutoBook`。

## src/book_skill.ts 旧建书技能解析（v0.3.0+；v0.4.1+ 起仅作一次性迁移工具，纯函数，不 import obsidian/yaml）

- **模块现状**：建书配置已并入《故事状态.md》auto_book 块（state_doc.ts），本模块不再创建/读取技能文件——只保留 `parseBookSkill` 供 `migrateLegacyBookSkills`（main.ts）把旧《案头资料/*.md》技能文件迁移进状态文档后删除文件。`skillMissing`/`formatBookSkill` 已删除。
- **不 import yaml 的原因**：yaml 是 CJS 包，测试走 esbuild→ESM（`.mjs`）打包会报 `Dynamic require of "process" is not supported`——故手写单层 frontmatter 解析（`parseFlatFrontmatter`：一行一项 `key: value`，空行/`#` 注释跳过，非法行（无冒号/键不合法）整块判 null＝非技能文件；不支持嵌套/多行值）。
- `BookSkillSpec`：`startAt/endAt/mode/flatTotalChapters/volumeCount/chapterCounts/overwrite/premise` 全可选 + `body`（正文＝一句话设定）。`endAt`＝停止节点 id〔含〕，缺省＝跑到流水线末尾。
- `parseBookSkill(raw)`：`FM_RE` 取 frontmatter → 标记判定 `o.auto_book === "true"`（**未加引号的布尔 true**；`"true"` 带引号字符串不算）→ 逐字段宽松解析：`start`/`end` 须在 STAGE_IDS（非法各自忽略）、`mode` 仅 flat|volumes、`chapters`/`volumes` 走 `posInt`、`chapter_counts` 走 `parseCounts`（`[8, 10]` 方括号或逗号/顿号/空白分隔，含非法项整条丢弃）、`overwrite` 仅 `true`/`false` 字面量、`premise` 走 `unquote`（双引号标量按 JSON 语义解引）。**字段非法各自忽略、不整体报废**；BOM 先剥。
- `posInt(v)`：正整数宽松解析（number 或纯数字字符串）——v0.4.1+ 起 state_doc.ts `normalizeAutoBook` 也 import 复用（唯一保留的跨模块共享件）。
- 测试：`src/book_skill.test.ts`（4 组：非技能文档→null（无 frontmatter/无标记/非法行）/全字段解析且非法字段各自忽略/chapter_counts 方括号数组与逗号字符串/旧技能文件迁移解析〔v0.4.1+〕）。缺参与落盘格式化组已随 `skillMissing`/`formatBookSkill` 删除。

## main.ts + modals.ts：全自动建书配置接线（v0.4.1+）

main.ts「v0.4.1+ 全自动建书」段（:6150–，runAutoBook 编排之后）：`migrateLegacyBookSkills` / `saveAutoBookConfig` / `cmdAutoBookConfig` / `cmdAutoBookRun` 四件套。

- `migrateLegacyBookSkills(story, state)`（:6155，两个命令入口都先跑）：`adapter.list(deskDocsPath)` 枚举 `案头资料/*.md` 逐个 `parseBookSkill`（读失败跳过），命中即按文件名排序逐个合并——**`spec.mode` 覆盖 `state.use_volumes`**（旧流水线按技能 mode 执行，保持行为一致）、premise∨正文**仅当 `state.one_line` 为空时**写入、`start/end/chapters/volumes/chapter_counts/overwrite` 并入 `state.auto_book`（已有键被技能值覆盖）→ `adapter.remove` 删除全部命中文件 → `saveState` ＋ Notice（列出文件名＋迁移后模式）。零命中＝原 state 直返、零写盘。多个技能文件时后者覆盖前者的同名字段。
- `saveAutoBookConfig(story, input: AutoBookConfigInput)`（:6191）：写回状态文档——`use_volumes = input.mode === "volumes"`；`one_line` 仅 premise 非空才写（空＝保持原值）；`auto_book` **整块替换**（不是 merge）：`startAt !== "worldview"` 才写 `start`、`endAt` 有值才写 `end`、规模字段只写所选模式那组（flat＝chapters、volumes＝volumes＋chapter_counts）、`overwrite` 恒写——模式切换时另一模式旧键自动清掉。
- `cmdAutoBookConfig`（:6210，「配置全自动建书…」）：ensureWorkDir → requireStory → ensureVolumeLayout → `this.auto` 拒并发 → `migrateLegacyBookSkills` → `new AutoBookConfigModal(app, { flatMode, premise: state.one_line, startAt/endAt/volumeCount/chapterCounts/flatTotalChapters/overwrite 全部预填自 state }, onSubmit)`；onSubmit＝`saveAutoBookConfig` ＋成功 Notice；try/catch notifyError。
- `cmdAutoBookRun`（:6239，**流水线唯一入口**）：ensureWorkDir → requireStory → ensureVolumeLayout → `if (this.auto)` 拒重复启动 → `migrateLegacyBookSkills` → `flatMode = state.use_volumes === false`、`cfg = state.auto_book`、`premise = state.one_line`、`startAt = cfg?.start ?? "worldview"` → `autoBookMissing(premise, cfg, flatMode, startAt)`（state_doc.ts 导出，见下节）判定：
  - 空缺失＝弹 `SkillRangeModal(app, state.title || "当前书", { startAt, endAt: cfg?.end }, …)`，确认回调转手 `runAutoBook(story, flatMode, { startAt, endAt, premise, volumeCount: cfg?.volumes ?? 0, chapterCounts: cfg?.chapter_counts ?? [], flatTotalChapters: cfg?.chapters ?? 0, overwrite: cfg?.overwrite ?? false })`。
  - 非空＝Notice「全自动建书配置缺少参数：…」＋ `new AutoBookModal` 预填已有配置补填；提交后先 `saveAutoBookConfig` 持久化（失败只 Notice「补填参数保存失败…（本次运行不受影响）」、**不阻断开跑**），再 `runAutoBook`（补填弹窗的规模模式会改写 `use_volumes`，runAutoBook 的 flatMode 取补填弹窗所选模式）。
- `AutoBookConfigModal`＋`AutoBookConfigInput`（modals.ts，替代旧 BookSkillCreateModal/BookSkillCreateInput）：标题「配置全自动建书 — 当前书」；表单＝起始＋停止节点双下拉（`addStageRangeSettings`，带 `onStartChange`）/一句话设定（`addPremiseSetting`，标签「一句话设定（写入 one_line）」，预填 state.one_line，仅起始节点＝worldview 时显示，**留空＝保存时不动 one_line**）/规模模式下拉（默认跟随书籍，onChange 调 `scale.setMode`）/规模参数（`addScaleSettings`）/覆盖 toggle；**规模显隐由 `addScaleSettings.applyMode()` 统一处理**（三个 `settingEl.toggleClass("aw-hide", …)` 互斥切换：flat 仅全书总章数可编辑、volumes 仅卷数/各卷章数且全书总章数整行隐藏推算值进各卷章数说明行）；校验规则与 AutoBookModal 同一套（`range.error()`＋`scale.error()`；premise 不必填），按钮「保存配置」，提交对象取 `range.startAt()/range.endAt()`＋`scale.read()`＋`scale.mode()`。
- 规模/一句话输入共用助手（modals.ts）：`COUNTS_HINT`（各卷章数占位/说明文案）＋`parseCountsText`（逗号/顿号/空白分隔解析，非法项→NaN）＋`computedTotalChapters(volCount, nums)`（单值×卷数或逐项求和，参数不齐返回 null）＋`addStageRangeSettings`（起止双下拉，见上节）＋**v0.4.1+ `addPremiseSetting(contentEl, name, initial)`**（一句话设定堆叠行，返回 `{settingEl, value()}`，styles.css `.aw-setting-stack`＝`flex-direction:column`＋控件列 `display:block;width:100%`＋textarea `width:100%`）＋**`addScaleSettings(contentEl, init)` 返回 `ScaleControls {mode(), setMode(m), error(), read()}`**（渲染全书总章数/卷数/各卷章数三行、按模式互斥 aw-hide 显隐；`setMode`→`applyMode()` 切三行 `aw-hide` 类并同步说明行；`error()` 中文校验文案〔「平铺模式：全书总章数须为正整数」等〕；`read()` 单值章数复制填满）**显隐类必须用自带 `.aw-hide`（styles.css `display:none!important`）——Obsidian 核心 app.css 没有 `.hide` 类规则（app.asar 全文检索无 `.hide{…}`），早期写 `toggleClass("hide")` 类挂上却毫无效果，表现为「重启后弹窗毫无变化」**——AutoBookModal / AutoBookConfigModal / SkillRangeModal 三弹窗复用这组助手，分卷模式全书总章数整行隐藏、推算值（`syncCountsDesc()`→`computedTotalChapters`）只作各卷章数说明行展示、不落盘。
- `SkillPickerModal`（modals.ts）：旧建书技能选择场景已随 auto-book-from-skill 删除；现仅剩设置页「引用文档」清单的技能添加处（main.ts :7662）使用，走默认 placeholder「选择技能（SKILLS/*.md…）」——指写作技巧技能，与建书配置无关。

## 世界观生成三件套 + 落盘

- `src/prompts.ts`（:1262–）：`WORLDVIEW_GEN_SYSTEM_PROMPT` / `WorldviewGenInput { bookTitle, premise, contextDocs? }` / `buildWorldviewGenPrompt`——固定 H2 骨架（「世界基本规则」「世界观红线」必含）、首行 H1、只写设定不写情节；`pushContextDocs` 注入调用方装配块。
- `src/story_manager.ts` `setWorldDoc`（:2625）：全量写书级《案头资料/世界观.md》，剥正文首部 H1、统一补 `# <书名> 世界观`（与 setPlanningGuide 同口径）。读取侧 `readWorldDoc().fullText`（stripComments 全文）供预检与上下文注入。
- `src/state_doc.ts`：`one_line?: string`——KEYS 白名单含 `one_line`，空串视为未设置、仅非空写回。**v0.4.1+ `auto_book?: AutoBookConfig`**（嵌套块，extraKeys 白名单含 `auto_book`）：`AutoBookConfig { start?, end?, chapters?, volumes?, chapter_counts?, overwrite? }`；parse 侧 `normalizeAutoBook(raw)` 清洗（stage id 白名单、`posInt`（book_skill.ts 导出复用）、`chapter_counts` 三形态＝YAML 数组/分隔字符串/标量单值→`[n]`，非法项各自忽略、数组含非法项整条丢弃）；formatStateDoc 固定键序写出（start/end/chapters/volumes/chapter_counts/overwrite，只写非空键，chapter_counts 为 YAML 块列表，全空＝整键省略）；导出 `autoBookMissing(premise, cfg, flatMode, startAt)` 缺参判定（仅 worldview 起跑要求 premise；flat 要 chapters；volumes 要 volumes＋chapter_counts，长度 1 即算齐全）。测试：`src/state_doc.test.ts`（auto_book 解析/清洗/键序写出/autoBookMissing 各分支）。
- `cmdGenerateWorldview`（main.ts :5292–，装配 :5312）：阶段 0 `getPhaseLlmSetup(PHASE_WORLDVIEW)`（v0.3.7+ 世界观生成为独立写作阶段）；上下文 pairs＝book_info/tension_rules（~~guide（锁定）~~**v0.3.5+ 写作指南体系整体废弃**：guide 对与 `guideKey` 选项已删除）经 `orderRefDocSpecs(pairs, phaseRefDocKeys(PHASE_WORLDVIEW), { bookSkillDir, bookSkillNames })` 过滤（默认清单含 `skill:世界观生成框架`；v0.3.4+ 书籍技能追加注入）；流式完成自动落盘（auto 语义直接保存）；已有非空直接覆盖不确认。
- export-ai-prompts：features 列表「审阅当前章」后插「生成世界观 (/worldview-generate)」；trySec 节在「大纲域」首节，标题与 features 逐字节一致（选择键）。premise 按盘上 state.one_line，空则占位符「（state.one_line 为空：运行时弹窗补问一句话设定）」。
