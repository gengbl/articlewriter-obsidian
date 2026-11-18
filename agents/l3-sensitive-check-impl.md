# L3 · 敏感词检测实现细节（v0.4.6+）

改动本域代码前必读。行为约定见 [l2-sensitive-check.md](./l2-sensitive-check.md)。

## src/sensitive_words.ts（纯模块，无 DOM/无 vault）

- `SensitiveHit`：`start/end`（正文下标）、`word`（命中词；变体正则命中＝展示词）、`category`（词表 `## 分类` 名；变体正则节命中固定归 `"变体正则"`）、`line`（1-based 行号）、`excerpt`（所在行片段，>60 字符截断加 `…`）。
- `findSensitiveHits(text, data)`：literal 词逐分类 `indexOf` 推进 ＋ `data.patterns` 变体正则 `exec` 循环（空匹配 `lastIndex++` 防死循环）；命中按 `start` 升序、同起点按 `end` 升序；重叠命中全保留（与 `findAiWordHits` 口径一致）。解析器复用 **`parseBannedWordsMd`**（banned_words.ts，勿 fork）。
- `groupSensitiveHits(hits)`：分类→计数，保持词表分类出现序（变体正则如有恒最后，因其按 patterns 遍历追加在尾部）。
- `applySensitiveMarks(text, hits, data)`：**从后往前**包 span 避免位移；`title＝「分类：说明」`（说明缺省时只留分类；`"` 转 `&quot;`）。span 开标签常量 `SENSITIVE_SPAN_OPEN = '<span style="background-color:#f2b8b5"'`，title 属性可缺省。
- `renderSensitiveReportSection(storyName, scannedAt, chapterCount, perChapter, totalHits)`：报告节 markdown——零命中＝一行说明；有命中＝「| 章节 | 命中 | 分类分布 |」表（分布＝`分类×次数` 顿号连接）。

## src/sensitive_words.test.ts（5 例，已注册 package.json entries）

- 覆盖：多命中排序/行号/片段、变体正则分类归属、**span 形状与 stripAiWordMarks 剥离正则互锁**（测试内写同款剥离正则断言往返无损——改 `story_types.ts` 或 `SENSITIVE_SPAN_OPEN` 形状必改一侧即挂）、分类计数序、报告节两形态。

## 标记剥离（src/story_types.ts `stripAiWordMarks`）

三形态并存，逐一剥开标签后统一剥 `</span>`：
1. AI 标红 `<span style="color:red">`（无 title）
2. 错别字下划线 `<span style="text-decoration:underline"(?: title=…)?>`
3. 敏感词底色 `<span style="background-color:#f2b8b5"(?: title=…)?>`

`manager.readChapterContent` 内部走该剥离 → 命令重跑天然幂等（不会双重包裹）。

## src/main.ts 接线

- `SENSITIVE_LIST_SKILL_NAME = "敏感词清单"`（plugin_config.ts）；`DEFAULT_SKILLS["敏感词清单"]`（skills_default.ts）＝完整种子词表（11 类目约 180 条红线词＋12 变体正则，词条格式 `- 「词」：说明`），随 `ensureSkillsFiles` 仅缺失播种（已有种子文件不会自动升级——需要新词表时删掉 vault 内旧文件重启重播种）。
- `loadSensitiveWords()`：仿 `loadBannedWords`——`skillPath()` 读盘，空/缺失回落 `DEFAULT_SKILLS` 包内种子（console.warn）。
- `cmdSensitiveCheck(storyArg?, keyArg?)`：写字台右键传参直调（不弹章选择）；空词表早退（Notice 引导编辑 `SKILLS/敏感词清单.md`）；零命中早退；命中→`applySensitiveMarks` + `manager.setChapterBody` 覆盖保存 + `chapterBodyFile`/`openMarkdown` 打开该章。
- `cmdSensitiveScanAll()`：`listChapters` 全量 → `readChapterContent`（已剥标记）→ 扫描不落标记 → `renderSensitiveReportSection` 追加 `${deskDocsPath}/敏感词报告.md`（`manager.readDoc` 读旧文，空则补 H1 引言；`writeDoc` 自动补父目录）→ Notice＋打开报告。
- `warnSensitiveWords(content)`：三处生成路径（writeOneChapter 的 /write、/continue、/rewrite）`void` fire-and-forget，位置紧跟 `warnChapterRefs` 之后；异常仅 console.warn。
- 命令注册：`addCommand` id `sensitive-check` / `sensitive-scan-all`（typo-check 旁）；`StatusAction` case `sensitive-check`（case `chapter-to-screenplay` 之后）。

## src/status_view.ts

- `StatusAction` union 增 `{ kind: "sensitive-check"; story: string; key: string }`；章节行右键菜单「转成剧本…」后追加「检测敏感词」项。

## 报告文件格式（《案头资料/敏感词报告.md》）

- 首建＝`# 敏感词报告` H1＋说明引言；此后每次扫描追加 `## YYYY-MM-DD HH:mm 扫描《书名》` 一节（最新在文件末尾）；节内＝扫描章数/合计命中粗体行＋有命中章的分布表。追加语义＝读旧文＋拼接＋writeDoc 覆盖。
