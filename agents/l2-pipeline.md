# L2 · 全自动写书流水线（auto-book-from-skill，v0.3.0+）

## 模块概要

全自动写书流水线把六个既有命令串成一条无人参与流水线：**生成世界观 → 生成策划指南 → 生成书级大纲 → 建卷并生成卷大纲 → 生成章节大纲 → 连续编写正文**。**唯一入口＝`auto-book-from-skill`（按技能全自动写书）**——独立的 `auto-book` 命令已移除，参数改由书籍《案头资料/》下的建书技能文件提供（见下「自动化建书技能」）。驱动者是插件本身（固定顺序、固定参数），LLM 只负责各阶段内的文本生成——因此不需要 function-calling。流水线**可从任意节点开始**（技能 `start` 字段或补填弹窗下拉选起始节点，从该阶段跑到末尾），但**缺前置文件即拒绝开始**：启动前按起始阶段的预检需求表逐项查盘，缺什么列出什么（含建议先跑哪个命令），不静默补建、不生成任何内容。

行为约定：

- **六阶段与命令映射**（阶段只编排、不重复实现生成逻辑，一律直接调用既有 cmd 方法）：
  | 阶段 | 命令 | 说明 |
  | --- | --- | --- |
  | worldview | `worldview-generate`（/worldview-generate，**新增命令**） | 一句话设定 → 书级《案头资料/世界观.md》，阶段 0 模型 |
  | planning | `planning-guide-worldview`（/planning-guide-worldview） | 复用既有命令 |
  | book-outline | `book-outline-generate`（/book-outline-generate） | 复用既有命令 |
  | volumes | `book-outline-to-volumes`（/book-outline-to-volumes） | **平铺模式整阶段跳过**（无卷） |
  | chapter-outlines | `volume-outline-to-chapters`（/vol-outline-to-chapters） | 分卷＝逐卷调用；平铺＝无参调用拆书级《大纲.md》 |
  | bodies | `write-chapters-consecutive`（/write-consecutive） | 复用既有命令 |

- **预检（缺文件拒绝启动）**：每个阶段声明前置需求（`src/pipeline.ts` 纯数据表），检查按当前书模式过滤（always/volumes/flat 三种适用范围）；任一缺失 → Notice 列出全部缺失项并中止，**不进入任何阶段**。读取异常按缺失处理。需求语义：worldview→世界观.md 非空；book-outline→书级大纲非空；book-outline-volume-decls→大纲含可解析卷声明（原文检查）；book-outline-chapters→大纲含标题式 `## 第N章`；volumes→卷列表非空且逐卷卷大纲含章条目；chapter-outlines→章节列表非空且逐章《章节大纲.md》非空。

- **免交互语义**：流水线运行中（`this.auto` 非 null），所有 prompt/confirm 助手直接返回流水线参数值——一句话设定、卷数、各卷章数、总章数、覆盖开关（清理/覆盖类确认按 overwrite 答复、大纲生成模式直取「完整生成」）；「生成过程」面板的保存确认自动点「保存」（done 态 `autoAccept()`、流式态 `finishAuto`）。**流水线之外一切交互语义不变**。

- **规模参数**（由技能文件提供；缺参时弹「按技能全自动写书 — 补填参数」弹窗补齐，按书模式分支，两组互斥只显示一组）：分卷＝卷数 + 各卷章数（逗号分隔逐个对应，或单个整数用于所有卷；各卷章数说明行实时显示推算的全书总章数＝单值×卷数或逐项求和，不再单独输入总章数；LLM 实际生成的卷声明数与卷数不齐时以末值复制兜底）；平铺＝全书总章数（喂书级大纲逐章规划弹窗与拆书级大纲弹窗）。起始节点为「生成世界观」时一句话设定必填；其余起始节点可空（premise 复用 state.one_line 持久化值）。

- **已有产物处理**：前三个生成阶段（worldview/planning/book-outline）重复 LLM 生成代价高——已有非空产物且未开「覆盖已有产物」开关则**整阶段跳过**（汇总 Notice 记「跳过」）；volumes/chapter-outlines/bodies 三阶段命令本身增量（只补缺失卷/章/正文），不设跳过、直接跑。

- **停止机制**（`auto-book-stop`，或面板上就地停止）：
  - 「停止全自动写书」命令＝置 stopped + 对当前生成面板 `requestStop()`（流式中＝中断本次生成；done 态＝放弃保存收尾）→ 当前阶段收尾后剩余阶段不再执行。
  - 面板上点「停止生成」/流式中关面板＝abort 当前生成（v0.3.0+ 起 Esc 不再中断） → 流水线在阶段边界检测到即停（该阶段记「执行中中止」）。
  - **阶段之间**（无流式生成时）关面板＝不影响流水线继续——面板关闭后插件仍缓存其实例（`lastGenPanel`），只有真正的 abort 信号才判停。
  - 已在运行时重复启动被拒（提示先停止）。

- **`worldview-generate`（/worldview-generate）单独运行语义**：流水线首阶段但也是独立命令——一句话设定优先取 state.one_line（auto 运行时取流水线参数），空则弹窗补问（补问值写回 state.one_line 作下次默认）；已有非空**直接覆盖、不确认**（流水线语义，手动运行同口径）；固定 H2 小节结构（「世界基本规则」「世界观红线」必含）、首行 H1，落盘走 `setWorldDoc`（统一补规范 H1、剥模型自带 H1）；上下文＝书籍信息＋创作规范（锁定）＋张力规则，按阶段 0 引用文档配置框过滤注入，**目标文档自身不注入**。

- **export-ai-prompts 覆盖**：大纲域新增「生成世界观 (/worldview-generate)」节（首节），按阶段 0 映射标注模型来源；一句话设定按盘上 state.one_line 装配，空则占位符注明「运行时弹窗补问」。

- **自动化建书技能（book skill，v0.3.0+）**：把流水线的参数固化成一个可编辑的技能文件，实现「写一个技能文件 → 一键免交互出书」。
  - **文件位置与格式**：技能文件＝当前书 `案头资料/<名称>.md`（与书级参考资料同目录，聊天窗口可 @ 引用）。frontmatter 须含 `auto_book: true`（未加引号的布尔，`"true"` 字符串不算标记）＋可选字段 `start`（起始节点 id）/`mode`（flat|volumes，缺省跟随书籍无卷模式）/`chapters`（平铺总章数）/`volumes`（卷数）/`chapter_counts`（各卷章数：`[8, 10]` 或 `8, 10` 逗号/顿号/空白分隔）/`overwrite`/`premise`（可选，优先于正文）；**正文＝一句话设定**。字段非法各自忽略、不整体报废；无标记的案头资料文档视为普通资料（含《世界观.md》等十件套）。
  - **`book-skill-create`（创建自动化建书技能）**：向导弹窗（文件名/起始节点/一句话设定/规模模式与参数/覆盖开关，校验规则与 AutoBookModal 同一套；规模参数随模式下拉切换显隐——平铺只显示全书总章数、分卷只显示卷数＋各卷章数〔说明行显示推算的全书总章数〕，落盘技能文件只写所选模式的规模字段）→ 写 `案头资料/<文件名>.md`；同名已存在须确认覆盖。用前须已手动创建书籍（流水线不含建书）。
  - **`auto-book-from-skill`（按技能全自动写书）**：枚举当前书 `案头资料/*.md` 中带标记的技能文件——只有一个直接执行、多个弹模糊选择器。参数齐全（见下）＝**免交互直接开跑**（Notice 提示已按技能启动）；缺参＝Notice 列出缺什么 + 把技能参数**预填进 AutoBookModal** 补填后开跑。缺参判定：起始节点为 worldview 时一句话设定（premise∨正文）必填；平铺要 `chapters`；分卷要 `volumes`＋`chapter_counts`（长度 1 视为齐全，末值复制兜底）。预检、停止、覆盖语义即流水线统一语义（上文各节，无独立 `auto-book` 命令可比对——技能入口就是唯一入口）；mode 字段与书籍实际模式不一致时以技能 mode 为准。
  - 与 `SKILLS/` 写作技巧技能（l2-skills.md）是两套概念：那是注入提示词的技巧文档，这里是驱动流水线的建书模板，目录与用途都不混。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-pipeline.md](./l3-pipeline.md) | pipeline.ts 数据表、main.ts 编排/预检/免交互 hook/停止机制、AutoBookModal、worldview prompt 三件套、book_skill.ts 建书技能解析 |
| L3 | [l3-writing-commands-impl.md](./l3-writing-commands-impl.md) | 生成过程面板（autoAccept/requestStop 所在） |
| L2 | [command-reference.md](./command-reference.md) | worldview-generate / auto-book-stop / book-skill-create / auto-book-from-skill 命令速查 |
| L2 | [l2-llm-writing-commands.md](./l2-llm-writing-commands.md) | 被编排的六个命令各自的行为约定 |
