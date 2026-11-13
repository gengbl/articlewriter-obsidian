# L2 · 全自动写书流水线（auto-book-run，v0.3.0+；v0.4.1+ 配置并入《故事状态.md》）

## 模块概要

全自动写书流水线把六个既有命令串成一条无人参与流水线：**生成世界观 → 生成策划指南 → 生成书级大纲 → 建卷并生成卷大纲 → 生成章节大纲 → 连续编写正文**。**唯一入口＝`auto-book-run`（全自动写书）**——独立的 `auto-book` 命令已移除；**v0.4.1+ 起参数不再有单独配置文件**，全部存当前书《故事状态.md》：`auto_book` 块（起止节点＋规模参数＋覆盖）＋顶层 `use_volumes`（规模模式）＋顶层 `one_line`（一句话设定），配置入口＝`auto-book-config`（见下「全自动建书配置」）。驱动者是插件本身（固定顺序、固定参数），LLM 只负责各阶段内的文本生成——因此不需要 function-calling。流水线**可从任意节点开始、到任意节点停止**（`auto_book` 的 `start`/`end` 字段或弹窗双下拉选起始/停止节点，从起始阶段跑到停止节点〔含〕；停止节点缺省＝「跑到末尾」），但**缺前置文件即拒绝开始**：启动前按起始阶段的预检需求表逐项查盘，缺什么列出什么（含建议先跑哪个命令），不静默补建、不生成任何内容。停止节点排在起始节点之前＝非法区间：弹窗校验拒绝提交，runAutoBook 兜底 Notice 拒跑。

行为约定：

- **六阶段与命令映射**（阶段只编排、不重复实现生成逻辑，一律直接调用既有 cmd 方法）：
  | 阶段 | 命令 | 说明 |
  | --- | --- | --- |
  | worldview | `worldview-generate`（/worldview-generate，v0.3.0+ 命令；v0.3.7+ 起为写作阶段 0 `PHASE_WORLDVIEW`） | 一句话设定 → 书级《案头资料/世界观.md》，阶段 0 模型 |
  | planning | `planning-guide-worldview`（/planning-guide-worldview） | 复用既有命令 |
  | book-outline | `book-outline-generate`（/book-outline-generate） | 复用既有命令 |
  | volumes | `book-outline-to-volumes`（/book-outline-to-volumes） | **平铺模式整阶段跳过**（无卷） |
  | chapter-outlines | `volume-outline-to-chapters`（/vol-outline-to-chapters） | 分卷＝逐卷调用；平铺＝无参调用拆书级《大纲.md》 |
  | bodies | `write-chapters-consecutive`（/write-consecutive） | 复用既有命令 |

- **预检（缺文件拒绝启动）**：每个阶段声明前置需求（`src/pipeline.ts` 纯数据表），检查按当前书模式过滤（always/volumes/flat 三种适用范围）；任一缺失 → Notice 列出全部缺失项并中止，**不进入任何阶段**。读取异常按缺失处理。需求语义：worldview→世界观.md 非空；book-outline→书级大纲非空；book-outline-volume-decls→大纲含可解析卷声明（原文检查）；book-outline-chapters→大纲含标题式 `## 第N章`；volumes→卷列表非空且逐卷卷大纲含章条目；chapter-outlines→章节列表非空且逐章《章节大纲.md》非空。

- **免交互语义**：流水线运行中（`this.auto` 非 null），所有 prompt/confirm 助手直接返回流水线参数值——一句话设定、卷数、各卷章数、总章数、覆盖开关（清理/覆盖类确认按 overwrite 答复、大纲生成模式直取「完整生成」）；「生成过程」面板的保存确认自动点「保存」（done 态 `autoAccept()`、流式态 `finishAuto`）。**流水线之外一切交互语义不变**。

- **规模参数**（由《故事状态.md》auto_book 配置提供；缺参时弹「全自动写书 — 补填参数」弹窗补齐，弹窗含起始/停止节点双下拉，规模三字段按模式互斥显隐〔共用 `addScaleSettings` helper，v0.4.1+〕：平铺＝仅「全书总章数」可编辑；分卷＝仅卷数/各卷章数，全书总章数整行隐藏、推算值〔单值×卷数或逐项求和〕实时显示在各卷章数说明行；补填结果经 `saveAutoBookConfig` 顺带写回状态文档）：分卷＝卷数 + 各卷章数（逗号分隔逐个对应，或单个整数用于所有卷；LLM 实际生成的卷声明数与卷数不齐时以末值复制兜底）；平铺＝全书总章数（喂书级大纲逐章规划弹窗与拆书级大纲弹窗）。一句话设定行只在起跑点含「生成世界观」时显示（起始节点为 worldview 才显示并必填；其余起始节点该行隐藏且不参与校验，premise 复用 state.one_line 持久化值）。

- **已有产物处理**：前三个生成阶段（worldview/planning/book-outline）重复 LLM 生成代价高——已有非空产物且未开「覆盖已有产物」开关则**整阶段跳过**（汇总 Notice 记「跳过」）；volumes/chapter-outlines/bodies 三阶段命令本身增量（只补缺失卷/章/正文），不设跳过、直接跑。

- **停止机制**（`auto-book-stop`，或面板上就地停止）：
  - 「停止全自动写书」命令＝置 stopped + 对当前生成面板 `requestStop()`（流式中＝中断本次生成；done 态＝放弃保存收尾）→ 当前阶段收尾后剩余阶段不再执行。
  - 面板上点「停止生成」/流式中关面板＝abort 当前生成（v0.3.0+ 起 Esc 不再中断） → 流水线在阶段边界检测到即停（该阶段记「执行中中止」）。
  - **阶段之间**（无流式生成时）关面板＝不影响流水线继续——面板关闭后插件仍缓存其实例（`lastGenPanel`），只有真正的 abort 信号才判停。
  - 已在运行时重复启动被拒（提示先停止）。

- **`worldview-generate`（/worldview-generate）单独运行语义**：流水线首阶段但也是独立命令——**v0.3.7+ 手动运行一律弹 multiline 窗确认一句话设定**（state.one_line 有则预填可改、无则空框；「确定」/Ctrl+回车提交，值与盘上不同时写回 state.one_line），auto 运行免交互取流水线参数；已有非空**直接覆盖、不确认**（流水线语义，手动运行同口径）；固定 H2 小节结构（「世界基本规则」「世界观红线」必含）、首行 H1，落盘走 `setWorldDoc`（统一补规范 H1、剥模型自带 H1）；上下文＝书籍信息＋张力规则（**v0.3.5+** 旧「创作规范（锁定）」已随写作指南体系废弃），按阶段 0 引用文档配置框过滤注入（默认清单含 `skill:世界观生成框架`，见 [l2-settings-llm-config.md](./l2-settings-llm-config.md)），**目标文档自身不注入**。

- **export-ai-prompts 覆盖**：大纲域新增「生成世界观 (/worldview-generate)」节（首节），按阶段 0 映射标注模型来源；一句话设定按盘上 state.one_line 装配，空则占位符注明「运行时弹窗补问」。

- **全自动建书配置（auto_book，v0.4.1+ 起替代旧「建书技能文件」）**：流水线参数固化在当前书《故事状态.md》frontmatter 里，实现「配置一次 → 一键出书」；参数齐全也要过一道范围确认弹窗（SkillRangeModal）。
  - **存储格式**：`auto_book:` 嵌套块（state_doc.ts `AutoBookConfig`，parse 时 `normalizeAutoBook` 清洗、非法项各自忽略）——`start`（起始节点 id）/`end`（停止节点 id〔含〕，缺省＝跑到流水线末尾；排在 start 之前＝runAutoBook 拒跑）/`chapters`（平铺总章数）/`volumes`（卷数）/`chapter_counts`（各卷章数：YAML 列表 `[8, 10]`、标量单值或逗号/顿号/空白分隔字符串均可）/`overwrite`。**规模模式不在块内**——复用顶层 `use_volumes`；**一句话设定复用顶层 `one_line`**。formatStateDoc 固定键序写出（start/end/chapters/volumes/chapter_counts/overwrite，只写非空键，全空＝整键省略）。旧版《案头资料/*.md》frontmatter 带 `auto_book: true` 的技能文件（含 `mode`/`premise` 字段）由 `migrateLegacyBookSkills`（main.ts）在 auto-book-config/auto-book-run 入口自动迁移：mode 覆盖 use_volumes、premise/正文仅在 one_line 为空时写入、字段并入 auto_book → 删除文件 → saveState + Notice。
  - **`auto-book-config`（配置全自动建书…）**：向导弹窗 AutoBookConfigModal（起始节点＋停止节点双下拉/一句话设定/规模模式与参数/覆盖开关，校验规则与 AutoBookModal 同一套〔三弹窗共用 `addStageRangeSettings` helper，v0.4.1+ 起该 helper 带 `onStartChange` 回调联动一句话设定行显隐；一句话设定与规模参数分别由共用 helper `addPremiseSetting`/`addScaleSettings` 渲染：一句话设定只在起始节点＝worldview 时显示、堆叠布局〔标签一行＋textarea 整行满宽，styles.css `.aw-setting-stack`〕，留空＝不动 one_line；规模参数随模式下拉互斥显隐——平铺仅全书总章数、分卷仅卷数＋各卷章数〔全书总章数整行隐藏，推算值显示在各卷章数说明行〕〕，按钮「保存配置」）→ `saveAutoBookConfig`（main.ts）写回状态文档：`auto_book` **整块替换**（只写所选模式的规模字段，模式切换时另一模式旧键自动清掉）＋规模模式写回 `use_volumes`＋premise 非空才写 `one_line`。用前须已手动创建书籍（配置不含建书）。
  - **`auto-book-run`（全自动写书）**：读状态配置直接开跑。缺参判定 `autoBookMissing(premise, cfg, flatMode, startAt)`（state_doc.ts 导出）只针对起始阶段的需求（不受停止节点影响）：起始节点为 worldview 时 `one_line` 必填；平铺要 `chapters`；分卷要 `volumes`＋`chapter_counts`（长度 1 视为齐全，末值复制兜底）。参数齐全＝**弹 SkillRangeModal（标题「全自动写书 — <书名>」）确认范围后开跑**（预填 `start`/`end`，双下拉可临时调整，点「开始」才执行、取消/Esc＝不跑）；缺参＝Notice 列出缺什么 + 把已有配置**预填进 AutoBookModal（标题「全自动写书 — 补填参数」）**补填后开跑，补填结果经 `saveAutoBookConfig` 顺带持久化（保存失败只 Notice、不阻断开跑）。预检、停止、覆盖语义即流水线统一语义（上文各节）；规模模式恒以 `state.use_volumes` 为准（旧技能文件 mode 字段只在迁移时一次性生效）。
  - 与 `SKILLS/` 写作技巧技能（l2-skills.md）与书级 `案头资料/Skill/` 技能（l2 写字台/书籍 Skill 阶段配置）都是不同概念：那些是注入提示词的技巧文档，这里是驱动流水线的参数配置，互不相干。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-pipeline.md](./l3-pipeline.md) | pipeline.ts 数据表、main.ts 编排/预检/免交互 hook/停止机制、AutoBookModal/AutoBookConfigModal/SkillRangeModal、worldview prompt 三件套、state_doc auto_book 块、book_skill.ts 旧技能文件迁移解析 |
| L3 | [l3-writing-commands-impl.md](./l3-writing-commands-impl.md) | 生成过程面板（autoAccept/requestStop 所在） |
| L2 | [command-reference.md](./command-reference.md) | worldview-generate / auto-book-stop / auto-book-config / auto-book-run 命令速查 |
| L2 | [l2-llm-writing-commands.md](./l2-llm-writing-commands.md) | 被编排的六个命令各自的行为约定 |
