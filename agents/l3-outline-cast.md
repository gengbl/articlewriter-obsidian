# L3 · 大纲阶段人物/关系增量分层实现细节

`生成卷大纲`（四个入口）与 `从卷大纲生成章节` 在每生成一章时顺带抽取人物与人物关系、并按出现范围写入书/卷/章三层《人物.md》《人物关系.md》。模块级行为约定见 [l2-cast-analysis.md](./l2-cast-analysis.md)「大纲阶段增量抽取」节；与 `/analyze-cast` 的差异是**边生成边落盘**，没有全量分析窗口。

## 相关源文件

| 文件 | 职责 |
| --- | --- |
| `src/outline_cast.ts` | **纯逻辑模块（无 vault 访问）**：附录常量与要求文本、附录拆分、`OutlineCastTracker`（逐章摄入 + 定层 + 增量写盘计划）。导出 `OUTLINE_CAST_APPENDIX_MARK`、`outlineCastAppendixInstruction(knownNames?)`、`splitOutlineCastAppendix(raw)`、`OutlineCastLayerKey` 相关类型（`OutlineCastCharacterLayer`/`OutlineCastRelationshipLayer`/`OutlineCastInit`/`OutlineCastIngestResult`）、`outlineCastLayerKey(ref)`、`OutlineCastTracker` |
| `src/prompts.ts` | `ChapterOutlineExpandInput.castAppendix?: boolean` / `knownNames?: string[]`；`buildChapterOutlineExpandPrompt` 末尾按需追加 `outlineCastAppendixInstruction(...)` |
| `src/story_manager.ts` | 分层 IO：`loadCharacterLayerDocs` / `loadRelationshipLayerDocs`（书根 + 每卷 + 每章各一层）、`saveCharacterLayer` / `saveRelationshipLayer`（ref → 目标路径后整层重写）；`readAllRelationshipEntries` 复用 `loadRelationshipLayerDocs` |
| `src/state_doc.ts` | 书级开关 `ai_outline_cast`（接口 + extraKeys 白名单 + 布尔解析 + 显式才写 frontmatter） |
| `src/main.ts` | 追踪器生命周期（`newOutlineCastTracker` / `outlineCastRun` / `ingestOutlineCast` / `outlineCastSummaryLine`）、`genVolOutlineIncremental` 的 `cast` 选项、拆章循环接入、`cmdCompleteState` 第六项询问 |
| `src/outline_cast.test.ts` | 7 组单测：附录拆分容错、要求文本、章→卷提升、跨卷→书级与既有书级不降、平铺两级、层不存在跳过与补注册、关系提升与既有不动 |

## 附录协议

- 分隔行常量 `OUTLINE_CAST_APPENDIX_MARK = "===人物关系附录==="`；提示词要求模型在**大纲正文之后另起一行**输出该分隔行，随后输出**严格 JSON**（无代码围栏、无解释）：
  `{"characters":[{"name","identity","age","gender","personality","appearance","background","abilities":[],"notes"}],"relationships":[{"a","b","type","status","desc"}]}`
- `splitOutlineCastAppendix(raw)`：
  - 分隔行正则容忍两侧 `=`/`#`/`*`/`-` 装饰与全角括号（`【人物关系附录】` 亦可）；
  - 命中 → 返回 `{ body: 分隔行之前正文 trim, cast: parseCastChapterAnalysis(其后文本) }`（复用 `/analyze-cast` 解析器，容忍代码围栏）；
  - 未命中 → `{ body: raw.trim(), cast: null }`；
  - 附录非法 JSON → `cast=null` 但正文保留（大纲不因附录格式失败而丢失）。
- **只抽人物与关系**：要求文本明确「不写场景/地点」，附录里出现 scenes 也不会被使用（`ingest` 只读 `characters`/`relationships`）。
- 调用方在落盘前用 `body` 作为大纲正文；正文为空（只有附录）按该段失败处理，避免把空章写进卷大纲。

## 追踪器与定层

`new OutlineCastTracker({ useVolumes, characters, relationships })`：用 `story_manager` 读出的三层现有条目播种各层（`loadCharacterLayerDocs` / `loadRelationshipLayerDocs`），并据此把「盘上已有条目所在层」作为定层输入。

- `decideLayer(chapters: Set<string>, existing: CastLayerRef[], useVolumes)`：
  - 容器集合 = 本轮出现章（`parseChKey` 取 vol，平铺/无卷→`""`）∪ 既有条目所在卷；
  - 既有书级条目、或容器数 ≥2 → **书级**；
  - 单容器内章数 ≥2（或既有卷级层）→ 卷级（书根容器→书级）；平铺模式 → 书级；
  - 否则 → 章级（`chapterKey` 为该章复合键）。
- `registerChapter(key)`：拆章时 `ensureChapterAt` 之后调用，补注册空的章级层——否则章级落点被判为「层不存在」而跳过。
- `knownNames()`：盘上三层 + 本轮已抽取的人名去重排序，供下一章提示词约束同名写法。
- `ingest(chapterKey, cast)`：
  1. 先把本章人物/关系累加进 `charAgg`/`relAgg` 与出现章集合（`charChapters`/`relChapters`）；
  2. 每个人物：`decideLayer` → 目标层不存在则 `skipped.push(name)`（保留出现记录，后续章可提升）；否则以**最具体层现有条目**为基座做字段合并，删除其他层同名副本，写入目标层；
  3. 每条关系：盘上既有（`refsWithRelationship` 非空且不在本运行 `autoRel` 集合）→ 保持原层不动；本运行新建的可用 `decideLayer` 提升层（跨章出现即从章级挪到卷级/书级）；
  4. 返回 `characterWrites` / `relationshipWrites`（仅内容有变化的层）、`skipped`、`writtenCharacters` / `writtenRelationships` 计数。
- 字段合并 `mergeCharacterFields`：现有非空优先、缺项补新、`abilities` 并集；空字符串字段省略（与 `formatCharacterBlock` 一致）。关系合并 `mergeRelationship` 同理（type/status/desc 现有优先）。

## main.ts 接入点

| 位置 | 说明 |
| --- | --- |
| `outlineCastRun(story, state)` | `state.ai_outline_cast === false` 时返回 `null`（不抽附录、不写盘）；否则建追踪器 + 空统计 `OutlineCastRunStats{characters,relationships,skipped}` |
| `genVolOutlineIncremental({..., cast?})` | `cast` 存在时：章段（kind==="chapter"）用户提示词末尾追加 `outlineCastAppendixInstruction(tracker.knownNames())`；生成后 `splitOutlineCastAppendix`，正文落盘、`ingestOutlineCast(story, tracker, chKey(cast.volId, num), parsed.cast, stats)`。卷设计段（kind==="design"）不抽 |
| 四个调用点 | 「继续生成卷大纲」「完整生成卷大纲」「自动生成卷大纲（无卷自动建卷）」「从书级大纲生成卷 `/book-outline-to-volumes`」各自 `const castRun = await this.outlineCastRun(...)` 并传入 `cast`；收尾 Notice / 汇总行附人物/关系条数 |
| `cmdBookOutlineToVolumes` 拆章循环 | 章大纲扩展调用带 `castAppendix`/`knownNames`；`ensureChapterAt` 后 `tracker.registerChapter(key)`；扩展结果剥离附录后写《章节大纲.md》，再 `ingestOutlineCast`（扩展为空/关闭扩展时不 ingest）；收尾汇总追加 `outlineCastSummaryLine` |
| `ingestOutlineCast` | 逐层 `saveCharacterLayer` / `saveRelationshipLayer`；任一层写盘失败只 `console.warn`、不中断大纲生成；累计三计数 |
| `cmdCompleteState` | 第六项询问 `ai_outline_cast`（确认=写 true、取消=写 false）；齐全提示同步列出该键 |

## 开关与语义

- `ai_outline_cast`：缺省（未写）＝开；写 `false` 关闭。与 `ai_expand_chapter_outline` 独立——但拆章路径的附录随扩展调用产生，因此扩展关闭时也不抽取（卷大纲生成路径仍按本开关抽取）。
- 卷大纲生成阶段章节目录通常尚未创建 → 单章角色计入 `skipped`；跨章角色直接落卷级、跨卷落书级，后续拆章 ingest 时再补齐章级。
- 幂等：重复运行同一卷/同一章时，同名条目按新出现集合重算层、删除跨层副本，字段只补不覆盖。
