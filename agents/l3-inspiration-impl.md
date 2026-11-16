# L3 灵感工具包实现细节（改代码前必读）

对应 L2：[l2-inspiration-toolkit.md](./l2-inspiration-toolkit.md)（行为约定）。本文件记源文件职责、数据格式与管线细节。

## 源文件

| 位置 | 职责与关键细节 |
| --- | --- |
| `src/inspiration.ts`（203 行，**纯数据＋纯解析/渲染，不 import obsidian、无 IO**） | 灵感文档的唯一格式事实源。常量：`INSPIRATION_FOLDER_NAME="灵感"`、`INSPIRATION_DOC_NAME="灵感.md"`、`INSPIRATION_SKILL_NAME="灵感模板"`、`DEFAULT_INSPIRATION_NAME="未命名"`、`HEADING_DATE_SEP=" · "`。<br>类型 `InspirationBlock{heading,name,date,body,line,endLine}`——`line`/`endLine` 是 0-based 行号（`endLine` 不含该行，文件末时＝`lines.length`），**增删改与编辑器跳转全靠行号**（不用字符偏移，避免 CRLF 文件偏移错位）。<br>解析：`parseInspirationDoc(md)` 只把 `^##\s` 当块边界（`^#\s` 收尾当前块、`^###` 及更深留在块内），非灵感文档→`[]`；`parseInspirationHeading` 按最后一个 `" · "` 切名字/日期，尾段不是 `YYYY-MM-DD` 就整串算名字（`date=""`）。<br>渲染：`inspirationHeading(name,date)`/`inspirationDocHeader`/`ensureInspirationDocHeader`（无 H1 才补文档头）/`renderInspirationBody(template,vars)`（丢首个 H1、丢 HTML 注释块、把 `#`/`##` 降为 `###`、替换 `{{name}}/{{date}}/{{time}}`）/`renderInspirationBlock(name,date,template,time?)`。<br>编辑：`appendInspirationBlock`（文末追加、块间恒留一个空行）、`removeInspirationBlock`（按行 splice ＋ `tidyBlankLines` 压空行）、`renameInspirationBlock`（只改标题行）。<br>弹窗侧：`inspirationPreview(body,max=70)`（剥注释/标题/列表标记→一行摘要）、`inspirationMatches(block,keyword)`（名字＋正文小写包含）。<br>换行：`splitDoc`/`joinDoc` 语义＝记住原文件 eol（`splitDoc` 返回 `{lines,eol}`），所有写回按原 eol 拼接（CRLF 文件不被改成 LF）。`normalizeInspirationName`：剥 `#[]|`、压平空白、剥掉用户顺手写的「 · 日期」尾巴、限长 40、空→「未命名」。 |
| `src/inspiration.test.ts`（131 行，已列入 `package.json` 的 `test` entries） | 回归护栏：按二级标题切块且块内 `###` 属正文；标题无日期尾段→整串是名字；名字清洗与限长；模板渲染（丢 H1/注释、`##`→`###`、占位符替换）；**追加→解析→删除**往返（含 CRLF 保住换行风格、块间不出现三层空行）；改名只换标题行正文不动；摘要与关键词过滤。 |
| `src/editor_nav.ts`（32 行，**共用件**） | `revealEditorLine(leaf,line,retryDelays=[0,250])`＝「光标置该行＋滚到视口中央」，两次尝试躲开编辑器装载完成慢（移动端更慢）；`openFileAtLine(app,path,line)`＝`getAbstractFileByPath`→`getLeaf(false).openFile`→`revealEditorLine`，文件不存在返回 `false` 由调用方决定提示口径。**时间线面板的 `locateHeading` 已改为调用它**（`revealEditorLine(leaf, idx, [0])`，外层 0/250ms 重试留在原处）——新的「跳到文档某处」需求一律复用这里，不再各写一份。 |
| `src/modals.ts` `InspirationKitModal` ＋ `InspirationKitHandlers` | 弹窗 UI：搜索框（`.aw-insp-search`）＋`.aw-action-list aw-insp-list` 列表（行 `.aw-insp-row`：`.aw-insp-name`/`.aw-insp-date`/摘要，按钮「定位/改名/删除」）＋底部三按钮。`run(fn, closeFirst)`＝除删除外一律先 `close()` 再执行（模态遮罩让位），`closed` 标志防连点重复打开编辑器/重复弹改名框；`setBlocks()` 供写盘后回填重新解析的结果。删除走 `deleteBlock` 不关窗。样式在 `styles.css`「灵感工具包弹窗」段。 |
| `src/main.ts` 灵感工具包区块（`cmdInspirationKit` 等） | 见下方「命令侧流程」。 |
| `src/main.ts` 命令注册 | `inspiration-kit`（名称含「灵感工具包（/inspiration：…）」），排在 `deai-ledger-resume` 之后。 |
| `src/status_view.ts` | `StatusAction` 新增 `{ kind: "inspiration-kit"; story: string }`；「案头资料」小节标题行/组内空白右键与「案头资料/灵感」文件夹行右键（`folder.name === INSPIRATION_FOLDER_NAME` 条件项）各加「灵感工具包…」。main.ts 的 `runStatusAction` switch 里 `case "inspiration-kit": await this.cmdInspirationKit(a.story)`——**按 `a.story` 操作，不要求先切当前书**（`cmdInspirationKit(storyName?)` 带参走该书、不带参走 `requireStory()`）。 |
| `src/skills_default.ts` `DEFAULT_SKILLS["灵感模板"]` | 内置模板文本（自动播种到 `SKILLS/灵感模板.md`，仅缺失才写）。回归护栏在 `src/skills_default.test.ts`：播种文本以 `# 灵感模板` 开头、渲染后不含一/二级标题、注释剥净、`{{name}}` 被替换。 |

## 命令侧流程（main.ts）

- 路径：`inspirationFolderPath(story)=deskDocsPath(story)/灵感`、`inspirationDocPath(story)=…/灵感.md`。
- IO：读＝`manager.readDoc(path)`（不存在→`""`，弹窗渲染空态）；写＝`manager.writeGuideAt(path,text)`（缺失连父目录创建、存在则覆盖，末尾补一个换行）；失败 `notifyError` 并返回 `false`，**不刷新弹窗列表**。`resolveChapterDocPath` 对 `灵感.md` 不生效（不在 `CHAPTER_TEMPLATE_BASES`），路径原样透传。
- 模板：`inspirationTemplate()` 先 `vault.adapter.read(skillPath("灵感模板"))`（缺失时 adapter 抛错→空串），空则 `ensureSkillsFiles()` 重播种再读一次，仍空回落 `DEFAULT_SKILLS["灵感模板"]`。
- 定位：`locateInspiration(path,block)`＝`openFileAtLine(app,path,block.line)`；文件不在→Notice「灵感文件还没创建」。
- 新增：`cmdNewInspiration(story,title)`＝`TextInputModal`（留空也提交→`normalizeInspirationName("")`＝「未命名」）→ `ensureInspirationDocHeader` → `appendInspirationBlock(renderInspirationBlock(name,date,tpl))` → 写盘 → 重新解析取**最后一块**的 `line` → `openFileAtLine` 定位 → Notice。日期＝`inspirationDate()`（本地）。
- 改名：`cmdRenameInspiration(story,block)`＝预填 `block.name` 的输入框（空输入＝取消）→ `findInspirationBlock` 回查 → `renameInspirationBlock(md,target,value,target.date)`（原块没有日期就继续不带日期）。
- 删除：`cmdDeleteInspiration(story,block)`＝回查 → `ConfirmModal`（标题带块标题、正文带 `inspirationPreview(body,60)` 摘要，确认键「删除」）→ `removeInspirationBlock` → 写盘 → 返回**最新文档文本**给弹窗 `setBlocks(parseInspirationDoc(...))`；取消/失败返回原文本。
- 回查 `findInspirationBlock(md,block)`：`heading+line` 命中优先，退而求其次 `heading` 命中（同名块按文档顺序取第一条），都没有→`null`＋「该灵感块已不在文件里」提示、不做改动。

## 坑位

- **块对象是一次性快照**：任何一次写盘都会让所有块的 `line/endLine` 失效——先回查再动手、写完立即 `parseInspirationDoc` 回填。
- **别在灵感块里用二级标题**（无论用户手写还是模板自带）：二级标题会切出新块。渲染器已把模板里的 `#`/`##` 降为 `###`，手写文档不做修正（`parseInspirationDoc` 会照它切块）。
- **同名块**（同灵感名＋同日期）按文档顺序取第一条；`renameInspirationBlock` 之后同名冲突不会自动改名消歧。
- 弹窗与编辑器并发：用户在编辑器里改过文件后再点删除/改名，走的也是「重读盘＋回查」，不会用旧文本覆盖新改动。
- 工具包不做 LLM 调用、不进任何提示词装配；`SKILLS/灵感模板.md` 会出现在技能选择列表里，属正常（它是模板，用户自行别去引用）。
