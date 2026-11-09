# L3 · /analyze-cast 人物与场景分析实现细节

`/analyze-cast` 模块的实现级说明；模块级行为约定见 [l2-cast-analysis.md](./l2-cast-analysis.md)。

## 相关源文件

| 文件 | 职责 |
| --- | --- |
| `src/cast_analyzer.ts` | **纯逻辑模块（无 vault 访问）**：提示词构建 + JSON 解析 + 跨章聚合 + span 定层 + 写盘计划。导出：`CastLayerRef`（落点：scope book/volume/chapter + volId?/chapterKey?）、`CastChapterAnalysis`（单章解析形状）、`CAST_ANALYZE_SYSTEM_PROMPT`、`buildCastChapterPrompt({chapterLabel,content,knownNames,knownSceneIds,retryNote?})`、`parseCastChapterAnalysis(raw)`、`relPairKey(a,b)`、`aggregateCastAnalyses(chapters)`、`determineCastLayer(chapterKeys,useVolumes)`、`CastLayerDoc<T>`/`CastLayerOutput<T>`、`buildCharacterWritePlan`/`buildSceneWritePlan`/`buildRelationshipWritePlan`。依赖仅 `md_docs`（类型）+ `state_doc`（parseChKey），story_manager 反向 type-only import 本模块——无循环 |
| `src/story_manager.ts`（~L2030「/analyze-cast 分层读写」节） | vault IO：`loadCharacterLayerDocs`/`loadSceneLayerDocs`（书根 + 每卷 + 每章各成一个 `CastLayerDoc` 层、逐层打 ref，卷/章条目补运行态 vol 标签；文件缺失的层返回空条目——readDoc 缺失即 ""，无需逐层 try/catch）、`saveCharacterLayer`/`saveSceneLayer(storyName, ref, entries)`（ref→(chapNum,vol) 映射后走既有 saveCharactersFile/saveScenesFile；缺 key/volId 抛错）、`readAllRelationshipEntries`（书根《人物关系.md》＋《角色关系.md》兜底＋每卷目录＋每章节目录，parseRelationships 平铺成列表；**对集合去重留给 main.ts 用 relPairKey 做**）。另 `sceneFilePath` 扩展了卷级分支（`chapNum===0 && vol` → 卷目录《场景.md》，经 resolveVolumeDocPath）、`saveScenesFile` 卷级 H1=卷名 |
| `src/main.ts` `cmdAnalyzeCast`（命令注册在 character-rename 之后） | 命令流程编排（见下「管线」）：validatedState → use_volumes → 卷模式 ensureVolumeLayout → listChapters + readChapterContent（空章跳过+Notice）→ getPhaseLlmSetup(3)（编写文章阶段配置，v0.2.22+；system=CAST_ANALYZE_SYSTEM_PROMPT）→ 从三层文档播种 knownNames/knownSceneIds/existingRelPairs → beginWritingPanel（传 setup.cfg，标题显示实际阶段模型名）→ 逐章循环 → aggregateCastAnalyses → 两个写盘计划 → 逐层 saveCharacterLayer/saveSceneLayer（仅 changed 层）→ buildRelationshipWritePlan → 逐组 appendRelationships → finishAuto + 汇总 Notice |

## 提示词与 JSON 形状

- 系统提示固定一句：严格 JSON 对象输出、无解释/围栏。用户提示给出完整字段模板并要求：**无依据的字段整个省略**（不填空串/空数组，abilities/characters 例外——确无给 `[]`）；name/scene_id/a/b 必填非空；已知规范名单（knownNames/knownSceneIds）必须沿用同一名字（跨章归一）。
- 形状：`{characters:[{name,identity,age,gender,personality,appearance,background,abilities[],notes}], scenes:[{scene_id,description,characters[],notes}], relationships:[{a,b,type,status,desc}]}`。
- **解析容错**（parseCastChapterAnalysis）：容忍可选 ``` 围栏；取首个 `{` 到末个 `}` 做 JSON.parse；顶层解析/形状失败返回 **null**（触发重试）；单条缺必填 id（name/scene_id/a+b）只跳过该条、保留其余（宽松）。字符串字段 trim 后空视为缺失（castStr→undefined），数组元素非字符串/空串过滤去重。

## 聚合与定层

- `aggregateCastAnalyses` 按章节顺序遍历：先出现的字段优先、后章只补缺项（fillStringFields）；abilities/characters 取并集（unionArr）；关系按 `relPairKey`（A-B 排序 join "|"，无序对）合并、type/status/desc 缺项补。产出 `CastAggregate`：三类 Map，值含合并字段 + 出现章节键 Set。
- `determineCastLayer(chapterKeys, useVolumes)` span 规则：容器 = 各键的归属卷（无卷=ROOT；useVolumes=false 时强制全 ROOT）。≥2 容器 → book；单 ROOT 容器 ≥2 章 → book、1 章 → chapter；单卷 V ≥2 章 → volume:V、1 章 → chapter。空集合兜底 book。
- 平铺模式因此只有书级/章级两层；卷模式三层齐备。书根直属章（卷模式下无卷章）按 ROOT 容器计数。

## 写盘计划（幂等自归位）

- `buildCharacterWritePlan`/`buildSceneWritePlan`（场景键=scene_id、归属字段=chapter_num，语义同人物）：每个聚合条目定层后——现有同名条目若存在于任一层，取**最具体层**（specificity 章2>卷1>书0）为合并基座，从**所有层**删除该名字全部副本，再写入目标层。字段合并用 `pick(base?.f, fresh)`：现有非空优先、否则取分析值（解析器缺项产出 undefined/""，`??` 不足以补缺故需 trim 判定）。场景 `content`（用户手写正文）只保留基座值、绝不回填。编号复位：book/volume 级 chapter/chapter_num=0（格式化省略）、chapter 级 = parseChKey(chapterKey).num 并补 vol 运行态标签。
- 每层最终内容 = 现有 − 移出 + 并入；`changed` 由 **canonicalJson**（对象键排序的规范 JSON，与条目顺序无关）比较得出，false 的层跳过写盘。目标层原本不存在时新建空层输出。
- `buildRelationshipWritePlan(existingPairs, agg, useVolumes)`：existingPairs（main.ts 从 readAllRelationshipEntries 用 relPairKey 建）命中的对直接跳过（纯追加语义）；新对按定层结果分组返回 `[{ref, entries}]`，调用方逐组 `appendRelationships`（该方法本身不去重、空列表抛错——过滤必须前置）。

## main.ts 管线细节（cmdAnalyzeCast）

1. 前置：validatedState；卷模式先 ensureVolumeLayout；listChapters 阅读序 + readChapterContent，空章收集进 skipped 清单不发起调用。
2. 播种：loadCharacterLayerDocs/loadSceneLayerDocs/readAllRelationshipEntries → knownNames/knownSceneIds/existingRelPairs（存量条目也参与跨章归一约束）。
3. 逐章循环：`beginStream("第 i/N 章 …")` → `streamWithEmptyRetry`（空输出 3 次重试由其内部处理并自行 fail）→ parseCastChapterAnalysis；解析失败且 raw 非空才 `view.fail(...)`（避免与内部 fail 重复），最多 3 次解析重试——重试间 **`view.reset()`**（清屏而非 fail，保证下次流式仍渲染）、提示词附 retryNote 纠正说明；每次尝试后查 `view.signal.aborted`。最终失败的章 skip+fail 计入 skipped，整轮继续。成功章把新名字/场景 id 追加进 known 清单供后续章。
4. 中止：聚合前任何时刻 abort → **零写盘**直接收尾。
5. 落盘：aggregateCastAnalyses → buildCharacterWritePlan/buildSceneWritePlan → 仅 changed 层 saveCharacterLayer/saveSceneLayer → buildRelationshipWritePlan → 逐组 appendRelationships（scope/volId/chapterKey 由 ref 映射）→ finishAuto + 汇总 Notice（人物/场景各层写入数、新增关系数、跳过章清单）。

## 陷阱

- **不得在聚合前写盘**：单章视角无法判定跨章/跨卷范围，部分写盘会产生错误分层。
- **fail/reset 分工**：raw 为空时的失败已由 streamWithEmptyRetry 内部 fail，外层不得再 fail；解析重试之间用 reset 而非 fail（fail 会进入终态 UI）。下一章的 beginStream 安全——它会 abort 上一会话并重建三件套 UI。
- **appendRelationships 无去重且空列表抛错**：existingPairs 过滤必须在调用前完成；某组 entries 为空时跳过该组调用。
- **卷级场景落盘是新增分支**：`sceneFilePath` 的 `chapNum===0 && vol` 分支只被本命令触发——既有 addScene 调用方从不带 vol 传 chapNum=0，行为不变。
- **Omit 映射类型可直接赋 Record<string, unknown>**（strict tsc 实测）：aggregateCastAnalyses 中 rec.fields/条目对象直接赋值即可，勿加 `as unknown as` 双断言。
