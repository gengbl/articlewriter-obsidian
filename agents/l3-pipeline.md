# L3 · 全自动写书流水线实现细节（v0.3.0+）

改动 auto-book-from-skill（按技能全自动写书）/ worldview-generate 相关代码前必读对应条目。

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

- 命令注册（:213–216）：`worldview-generate` / `auto-book-stop` / `book-skill-create` / `auto-book-from-skill`（独立 `auto-book` 命令已移除，入口只剩技能路径）。无独立 slash 注册表——`/xxx` 只写在命令 name 文案里。
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

## src/modals.ts：AutoBookModal（仅「按技能全自动写书」缺参补填时打开——标题「按技能全自动写书 — 补填参数」）

- `AutoBookInput { startAt, endAt?, premise, volumeCount, chapterCounts, flatTotalChapters, overwrite }`（`endAt` v0.3.1+，undefined＝跑到流水线末尾）；import `PIPELINE_STAGES, StageId`（pipeline.ts 不 import obsidian，无循环依赖）。
- **`addStageRangeSettings(container, init)` 共用助手（v0.3.1+，AutoBookModal / BookSkillCreateModal / SkillRangeModal 三处复用）**：渲染「起始节点」「停止节点」两个下拉（均按 PIPELINE_STAGES 顺序；停止下拉多一项「跑到末尾（连续编写正文）」＝undefined），返回 `{ startAt(), endAt(), error() }` 闭包——`error()` 校验停止节点是否排在起始节点之前（非法返回中文错误串，合法返回 null）。
- 表单：起始/停止节点双下拉（上述助手）/ 一句话 textarea（`settingEl.addClass("aw-setting-stretch")` ＋ `rows = 6`：styles.css 该类把标签列收回 `flex:0 0 auto`、控件列 `flex:1 1 auto`、textarea `width:100%`＋`resize:vertical`，让输入框吃掉标签之外的整行剩余宽度——核心 `.setting-item-control` 默认只按 textarea 的 cols 宽度靠右摆）/ 平铺＝总章数、分卷＝卷数＋各卷章数（逗号/顿号/空格分隔；两组互斥、按书模式只渲染一组；分卷模式各卷章数 `setDesc` 实时显示「全书总章数 = N」推算值，不单独输入总章数）/ 覆盖 toggle。校验：worldview 起始必填 premise；正整数；各卷章数须 1 个（复制填满）或恰好卷数个字段的；起止区间非法（`range.error()`）；失败写行内 errEl、不关窗。预填值＝技能里已有的参数（startAt/endAt/premise/卷数/各卷章数/总章数，空值留空待补）。
- `onSubmit` 在 `close()` 之后 await；`onCancel` 可选（未提交关闭时回调，runBookSkill 补填路径未传）。

## src/modals.ts：SkillRangeModal（v0.3.1+，「按技能全自动写书」参数齐全时的范围确认弹窗）

- 构造：`(app, skillName, init: { startAt?, endAt? }, onSubmit: (startAt, endAt?) => …)`——无 onCancel，取消/Esc＝什么都不做（不跑流水线）。
- 标题「按技能全自动写书 — <技能名>」，说明行解释「停止节点也会执行，『跑到末尾』＝一直执行到『连续编写正文』」；表单即 `addStageRangeSettings` 双下拉（预填技能 start/end）；「开始」按钮先查 `range.error()`（非法写行内 errEl 不关窗），合法才 `close()` 后回调 `(startAt, endAt)` → main.ts 侧转手喂 `runAutoBook`。

## src/book_skill.ts 建书技能（v0.3.0+，纯函数，不 import obsidian/yaml）

- **不 import yaml 的原因**：yaml 是 CJS 包，测试走 esbuild→ESM（`.mjs`）打包会报 `Dynamic require of "process" is not supported`——故手写单层 frontmatter 解析（`parseFlatFrontmatter`：一行一项 `key: value`，空行/`#` 注释跳过，非法行（无冒号/键不合法）整块判 null＝非技能文件；不支持嵌套/多行值）。
- `BookSkillSpec`：`startAt/endAt/mode/flatTotalChapters/volumeCount/chapterCounts/overwrite/premise` 全可选 + `body`（正文＝一句话设定）。`endAt`（v0.3.1+）＝停止节点 id〔含〕，缺省＝跑到流水线末尾。
- `parseBookSkill(raw)`：`FM_RE` 取 frontmatter → 标记判定 `o.auto_book === "true"`（**未加引号的布尔 true**；`"true"` 带引号字符串不算）→ 逐字段宽松解析：`start`/`end` 须在 STAGE_IDS（非法各自忽略）、`mode` 仅 flat|volumes、`chapters`/`volumes` 走 `posInt`、`chapter_counts` 走 `parseCounts`（`[8, 10]` 方括号或逗号/顿号/空白分隔，含非法项整条丢弃）、`overwrite` 仅 `true`/`false` 字面量、`premise` 走 `unquote`（双引号标量按 JSON 语义解引）。**字段非法各自忽略、不整体报废**；BOM 先剥。
- `skillMissing(spec, flatMode, startAt)`：缺参判定——startAt=worldview 时一句话设定（premise∨body 合并传入）必填；平铺要 `chapters`；分卷要 `volumes`＋`chapter_counts`（长度 1 即算齐全，runAutoBook 末值复制兜底）。返回中文缺失项数组，空＝免交互可跑。
- `formatBookSkill(spec)`：向导落盘用——frontmatter 只写已设置字段（含 `end: <stage id>`，v0.3.1+，未设置不写），`premise` 用 `JSON.stringify` 双引号标量（与 `unquote` 对偶、yaml 兼容），正文空则省略。
- 测试：`src/book_skill.test.ts`（5 组：完整解析含 `end`/无标记与非法 frontmatter→null/`auto_book: "true"` 与 `overwrite: yes` 等宽松与严格边界/skillMissing 各分支/formatBookSkill 往返含 `end`）。

## main.ts + modals.ts：建书技能接线

- 命令注册（:215–216）：`book-skill-create` / `auto-book-from-skill`。
- `cmdCreateBookSkill`：ensureWorkDir → requireStory → ensureVolumeLayout → `this.auto` 拒并发 → `new BookSkillCreateModal(app, state.use_volumes === false, state.one_line, onSubmit)`。onSubmit：路径 `manager.deskDocsPath(story)/<文件名>.md`，已存在弹 ConfirmModal 确认覆盖，写盘＝`formatBookSkill`（含 `endAt: input.endAt`）＋**按 input.mode 过滤规模字段**（flat 只写 chapters、volumes 只写 volumes＋chapter_counts，另一组传 undefined 不落盘）＋`body: input.premise`（正文即一句话设定，不写 premise 字段）。
- `cmdAutoBookFromSkill`（:6046，**流水线唯一入口**）：ensureWorkDir → requireStory → ensureVolumeLayout → `if (this.auto)` 拒重复启动 → `adapter.list(desk)` 枚举 `案头资料/*.md` 逐个 `parseBookSkill`（读失败跳过）→ 零技能 Notice 提示先跑向导 → 单个直接 `runBookSkill`、多个弹 `SkillPickerModal`（第 4 参 placeholder＝"选择建书技能（案头资料/…）"，默认值仍是 SKILLS 文案；onPick 契约为 void，`void this.runBookSkill` 丢弃 Promise——obsidianmd/no-misused-promises）。
- `runBookSkill`（try/catch notifyError 自兜）：`flatMode = spec.mode ? spec.mode === "flat" : state.use_volumes === false`（技能 mode 优先于书籍实际模式）；premise＝`(spec.premise ?? "").trim() || body`；`skillMissing`（只查起始阶段需求，不受停止节点影响）空＝弹 `SkillRangeModal` 预填 `{ startAt: spec.startAt ?? "worldview", endAt: spec.endAt }`，点「开始」才 `runAutoBook`（volumeCount/chapterCounts/flatTotalChapters 缺省传 0/[]、overwrite 缺省 false；取消/Esc＝不跑）；非空＝Notice 列缺失项 + `new AutoBookModal` 预填技能参数（init 含 `endAt`）补填后开跑（两条路径最终都走 runAutoBook，预检/停止机制完全一致）。
- `BookSkillCreateModal`＋`BookSkillCreateInput`（含 `endAt?`）：表单＝文件名（默认「自动建书」）/起始＋停止节点双下拉（`addStageRangeSettings`）/一句话 textarea（预填 state.one_line）/规模模式下拉（默认跟随书籍）/规模参数/覆盖 toggle；**规模参数随模式切换显隐**（`applyMode()`＝三个 `settingEl.toggleClass("hide", …)`：flat 只显示全书总章数、volumes 只显示卷数＋各卷章数）；校验规则与 AutoBookModal 同一套（长度 1 章数按卷数复制填满、起止区间查 `range.error()`），提交对象取 `range.startAt()/range.endAt()`，onSubmit 非所选模式传 0/[]。
- 规模输入共用助手（modals.ts）：`COUNTS_HINT`（各卷章数占位/说明文案）＋`parseCountsText`（逗号/顿号/空白分隔解析，非法项→NaN）＋`computedTotalChapters(volCount, nums)`（单值×卷数或逐项求和，参数不齐返回 null）＋`addStageRangeSettings`（起止双下拉，见上节）——AutoBookModal 与 BookSkillCreateModal 的分卷模式都在各卷章数 `setDesc` 实时显示「全书总章数 = N」，提交校验也走 `parseCountsText`。
- `SkillPickerModal`（modals.ts :641）：placeholder 改第 4 可选参，默认值保持 SKILLS 选择场景文案。

## 世界观生成三件套 + 落盘

- `src/prompts.ts`（:1262–）：`WORLDVIEW_GEN_SYSTEM_PROMPT` / `WorldviewGenInput { bookTitle, premise, contextDocs? }` / `buildWorldviewGenPrompt`——固定 H2 骨架（「世界基本规则」「世界观红线」必含）、首行 H1、只写设定不写情节；`pushContextDocs` 注入调用方装配块。
- `src/story_manager.ts` `setWorldDoc`（:2625）：全量写书级《案头资料/世界观.md》，剥正文首部 H1、统一补 `# <书名> 世界观`（与 setPlanningGuide 同口径）。读取侧 `readWorldDoc().fullText`（stripComments 全文）供预检与上下文注入。
- `src/state_doc.ts`：`one_line?: string`——KEYS 白名单含 `one_line`，空串视为未设置、仅非空写回。
- `cmdGenerateWorldview`（main.ts :5172–）：阶段 0 `getPhaseLlmSetup(0)`；上下文 pairs＝book_info/guide（锁定）/tension_rules 经 `orderRefDocSpecs(pairs, phaseRefDocKeys(0), { guideKey: "guide" })` 过滤；流式完成自动落盘（auto 语义直接保存）；已有非空直接覆盖不确认。
- export-ai-prompts：features 列表「审阅当前章」后插「生成世界观 (/worldview-generate)」；trySec 节在「大纲域」首节，标题与 features 逐字节一致（选择键）。premise 按盘上 state.one_line，空则占位符「（state.one_line 为空：运行时弹窗补问一句话设定）」。
