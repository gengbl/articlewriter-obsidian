# L2 · 敏感词检测（v0.4.6+）

## 模块概要

- **零 LLM 确定性扫描**（与 AI 味检测同族但词表独立）：按投稿平台内容安全红线扫描章节正文，命中给「分类×次数」汇总并可在正文标色。词表事实源＝`<work_dir>/SKILLS/敏感词清单.md`（随 `ensureSkillsFiles` 播种完整种子词表——11 大类目约 180 条平台高频红线词＋变体正则，仅缺失才写、用户编辑不覆盖；**不进任何提示词注入清单**——只供检测，不约束生成）。扫描为逐字精确匹配、中文不分词，多义常用词会误报，由用户按上下文判断。
- **两个命令**：
  - `sensitive-check`（检测敏感词）：目标章＝弹窗（留空=当前章）或写字台章节右键直调（可选参 story/key，不弹选择）。读正文（`readChapterContent` 已剥既有标记，重跑不双重包裹）→ 扫描 → **命中处包底色 span（title＝「分类：说明」）覆盖保存**＋编辑器打开该章；Notice 列分类分布与前 5 处「行号[分类] 词｜行片段」。零命中/空词表各有专属提示（空表引导去编辑技能文件）。
  - `sensitive-scan-all`（全书敏感词汇总）：逐章扫描**不落标记**，结果按「每扫一次一节（带时间戳标题）」追加《案头资料/敏感词报告.md》（首建带 H1＋说明），节内＝扫描章数/合计命中/有命中章的分类分布表；天然形成当日与历史汇总。收尾 Notice 汇总＋打开报告。
- **生成后软提醒**（同 warnChapterRefs 非阻断口径）：`/write`、`/write-consecutive`（writeOneChapter 共用路径）、`/continue`、`/rewrite` 四处生成内容检测（只查新生成部分），命中弹 Notice 列前 5 处＋建议运行「检测敏感词」；**不改正文、不落标记、不阻断流程**；检测异常只 console.warn。
- **与既有标记共存**：正文 span 三形态——AI 标红（`color:red`）、错别字下划线、敏感词底色（`background-color:#f2b8b5`＋title）；`stripAiWordMarks` 统一剥离（改 span 形状必须同步该函数，往返无损由 `sensitive_words.test.ts` 锁正则）。
- **词表格式**＝与《网文高频禁用词清单》完全一致（`## 分类`＋`- 「词」：说明`＋`## 变体正则`节，共用 `parseBannedWordsMd`；禁 lookbehind）。分类名即报告/标记里的类目；「变体正则」节的命中归入固定分类名「变体正则」。
- **边界**：不做自动替换/改写（与去AI味不同，平台红线因平台而异，改写交给人）；词表无 UI 编辑入口（直接编辑技能文件，同禁用词清单约定）。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-sensitive-check-impl.md](./l3-sensitive-check-impl.md) | `sensitive_words.ts` 纯模块函数、main.ts 命令与软提醒接线、span 形状与剥离、报告文件格式 |
| L2/L3 | [l2-skills.md](./l2-skills.md)、[l3-skills.md](./l3-skills.md) | 技能文件播种机制（DEFAULT_SKILLS／ensureSkillsFiles／skillPath） |
| L3 | [l3-status-view.md](./l3-status-view.md) | 章节行右键 StatusAction `sensitive-check` |
| 参考 | [command-reference.md](./command-reference.md) | 两命令语义速查 |
