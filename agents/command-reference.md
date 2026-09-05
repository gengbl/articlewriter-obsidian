# 已移植命令速查（插件 → CLI 对照）

| 插件命令 id | 对应 CLI | 说明 |
| --- | --- | --- |
| `set-work-dir` | `--work_dir` | 选择工作目录；0 本书提示先建书、唯一一本直接加载、多本提示用切换命令 |
| `switch-story` | `/dir <work_dir>/<书名>` | 列出全部小说（含各章数/当前章、◀ 当前标记），选中设为当前并弹出该书状态 |
| `new-story` | `/new` | 标题+题材+编写类型三问，建书与全套模板文档 |
| `new-chapter` / `list-chapters` | `/chapter add` / `/chapter list`、`/open` | 建章后自动激活；列表选择打开正文并切当前章 |
| `insert-chapter` | —（插件新增，无 CLI 对应） | 在当前激活章（无则先选参照章）之前/之后插入新空章节：**v0.0.15 起编号在容器内**——仅参照章所在容器（卷/书根）中 ≥插入位的各章整体 +1（两阶段临时迁移防目录冲突；**全部改名走真实文件系统层 adapter.rename+adapter.exists 逐步强校验（不走会滞后的元数据索引），源目录按复合键定位带原始 FS 兜底，检测到重复号残留目录立即中止**——防连续快速重命名下索引滞后误判产生大号幽灵章节；操作前/后自动隔离空心残骸），同步重写各章文档「第N章」/「章节：N」引用与伏笔.md（引用为复合键语义、跨卷同号不再歧义）；插入位是断档空位时直接落位不挪动他人；完成后 current_chapter 指向新章（manager.insertChapter）。注：listChapters 一律忽略无「章节.md」的空心目录（外部插件如 make-md 会在迁移窗口期往新建目录写 .space/*.mdb 造成残骸），故面板永不显示此类幽灵章 |
| `next-chapter` / `prev-chapter` | `/chapter next` / `prev` | 无当前章时 next→第一章、prev→最后一章；到边界提示不切 |
| `count-current` / `count-all` | `/count [号\|范围\|all]` | 纯文字字数统计（逐章 + 合计） |
| `save-current` | `/save` | 聚焦编辑器内容强制落盘 |
| `status` | `/status` | 标题/题材/编写类型/当前卷场景章节/章节数总字数/时间 |
| `volume-list` / `volume-add` / `volume-manage` | `/volume ...` | 列表（含当前标记）、新建（**批量建卷页 VolumeBatchCreateModal：手动把卷名逐行加入列表〔上移/下移调创建顺序、删除〕，确定后按列表顺序依次 addVolume，单个重名失败不中断其余、末尾汇总 Notice；最后成功的卷 activateVolume 设当前 + 可选顺带建章归属该卷**，直接落卷实体目录）、启用/改名（同步移动实体目录）/改描述/分配章节（**支持 all/全部、区间如 3-7〔或三至七〕、列表如 1，4，5——复用 md_docs.parseChapterSelection 打包合集同款解析；多于一章时二次确认列出清单；单章失败不中断其余**；章节目录物理移入卷目录）/**导出此卷合集**（manager.packVolume：该卷实体目录下全部章节正文合一 MD，按位置判归属，与 /pack 共用 buildPackParts/writePackFile 装配落盘）/删除（章节先移回书根再清元数据） |
| `volume-mode-off` / `volume-mode-on` | `/volume off` / `/volume on`（插件新增 v0.0.16+：工作模式开关） | **off=设为无卷模式**——纯「书籍→章节」扁平结构，不建卷/不归卷/不按卷整理；若该书仍有卷则先二次确认再破坏性拍平（flattenToRoot：各卷章节 relocateChapterContainer(key,null) 回书根连续重编号、**各卷残留直属文档（设定四件套/卷摘要等）经 salvageVolumeDocsToRoot 挪出到书根且跨卷同名者加「<卷名>-」前缀避免覆盖**、随后各卷实体目录 trashFile 入回收站、清 卷.md 元数据与 current_volume），完成后写字台隐藏全部「新建卷」入口。**on=启用有卷模式**——仅置位不改盘，恢复可用「新建卷/管理卷/按卷整理目录」。新书默认即无卷（use_volumes=false）。两命令均走 cmdVolumeMode(enabled)，已处目标态时提示无需切换 |
| `organize-volumes` | —（插件新增：平面结构迁移） | 把书根下已归属各卷的章节目录移入对应 `<书名>/<卷名>/` 实体目录；幂等可重复执行。**该书无任何卷时先弹出同一个批量建卷页**（promptCreateVolumesIfEmpty→pickNewVolumeNames，手动加名单；取消/空列表 = 跳过继续；新建与既有章节目录同名的卷 → 其中章节立即自动归属）。切换书籍检测到平面残留时强制自动执行（不可跳过、不弹逐章分配框）；**但触发条件含两种：①有卷且 needsVolumeOrganize>0 ②零卷却存在未识别章节目录（listChapters parentPath≠书根 且 !vol）**——后者因 needsVolumeOrganize 对零卷书恒返回 []，须单独探测；两路径在迁移前均先过 promptCreateVolumesIfEmpty（全书无卷→弹批量建卷页，取消 = 跳过）。失败锁定该书结构操作直至手动成功；各结构命令入口另有确认框门禁（取消=阻断本次操作）。未归属章节留书根属正常布局、不触发整理；**手动执行收尾时对仍留书根的无归属章节逐个 pickAction 选卷归位**（仅一卷→一次 confirmBox 整体移动；选项含「留在书根」「停止分配」，Esc=停止本轮） |
| `scene-list` / `scene-add` / `scene-manage` | `/scene ...` | 全部章节+全局未归属；新增 ID/简介/角色/正文/归属；切换/查看/编辑/**移动**/删除 |
| `character-list` / `character-add` / `character-manage` | `/character ...` | 同上结构；能力字段为分词数组（`splitList`）；改名=预览命中后全小说替换并备份 `_backup/` |
| `foreshadow-list` / `foreshadow-add` / `foreshadow-manage` | `/foreshadow list/add/done/delete` | 全书 `伏笔.md`，按「章节+序号」操作 |
| `world-show` / `world-set` | `/world show/set` | 世界/类型/规则/势力/地点/历史/力量体系 |
| `outline-append-current` | `/outline chapter N [内容]` | 追加当前章大纲：去重合并 + `[伏]...[/]` 标记解析入库伏笔记录 |
| `open-chapter-outline` | —（配合 `/open 号 大纲`） | 打开当前章 `章节大纲.md`（缺失先建模板） |
 | `chapter-delete` / `chapter-rename` / `chapter-renumber` | `/chapter delete`、目录改名、编号重排 | 删除=回收站+清理元数据与归属引用，**被删号之后仍有章节时自动补洞重新排号**（复用 renumberChapters：后续各章 -1、文档/伏笔引用重写，保持 1..N 连续；返回 resequenced 供提示）；重命名同步目录名与文档内引用；renumber 手动连续化并改写交叉引用。三者迁移路径共用防幽灵章机制：真实 FS 层 adapter.rename+exists 逐步强校验、重复号残留即中止（assertUniqueKeys 拒绝并要求手工清理）；listChapters 仅过滤元数据索引陈旧条目——v0.1.4+ 起磁盘上存在的章节目录一律视为存活章节（无「章节.md」的空正文章照常列出、可被写作命令补写正文），旧 quarantineHollowChapters 预隔离/收尾清扫机制已整体移除（用户约定「有文件夹即正常」） |
| `pack-chapters` | `/pack [选择][路径]` | 正文打包单 MD：中文章节号标题 + `---` 分隔；支持范围/列表/all（表达式解析在 `md_docs.parseChapterSelection`）；默认输出 `<书名>-第X-Y章-合集.md`。与导出卷共用私有装配 buildPackParts（逐章读《章节.md》去 H1、空正文章跳过计入 skipped）+ writePackFile（outputPath 带扩展名=完整文件名、不带当目录拼 fileName）——改合辑格式只动这两处 |
| `pack-volume` | —（插件新增：导出卷合集） | 选卷→该卷实体目录下全部章节（按位置判归属，入口先过 ensureVolumeLayout 门禁保证位置==归属）正文合一 MD；无章报错提示先「按卷整理目录」归位；默认输出 `<书名>-<卷名>-合集.md`；写字台面板卷节点右键「导出本卷合集…」同义入口（StatusAction export-volume），管理卷菜单亦有同款项 |
| `rescan-story` | `/scan` | 从现有 MD 重建故事状态.md（只初始化，不切小说不改 work_dir） |
| `set-style` | `/style` | 切换编写类型 writing_style（预设或自定义），持久化到 state |
| `agents-view` / `agents-edit` | `/agents view` / `/agents edit` | 三层创作规范：小说级 `<书名>/WRITING_GUIDE.md` > 用户级 `<work_dir>/WRITING_GUIDE.md` > 系统级 **插件数据目录** `.obsidian/plugins/articlewriter/WRITING_GUIDE.md`[固定路径，非用户可配]；view 各层直接打开对应文件，单层直开/多层选择器/全无则提示用编辑创建；edit 选层后多行文本框全量保存并刷新该书《写作指南汇总》 |
| `generate-writing-guide` | —（插件新增） | 生成空模板：对用户级 `<work_dir>/WRITING_GUIDE.md` 与当前书 `<书名>/WRITING_GUIDE.md` 各建一份同格式骨架（`buildEmptyGuideTemplate` 抽段名、清正文），目标已存在且非空则跳过并提示；不触碰系统级 |
| `regenerate-system-guide` | —（插件新增） | 重新生成系统写作指南：confirmBox 二次确认后把内置默认覆盖写回 `.obsidian/plugins/articlewriter/WRITING_GUIDE.md`，再尽力刷新当前书《写作指南汇总》 |
| `generate-usage-doc` | —（插件新增） | 生成使用说明：按内置文本（`src/usage_guide_default.ts` DEFAULT_USAGE_GUIDE）在 work_dir 根建《使用说明.md》，成功后打开该文件；**设置/切换工作目录时自动投放**（pickWorkDir 回调内 seedUsageDoc），仅缺失或为空才写入、绝不覆盖用户内容，已存在非空则跳过并提示 |
| （无对应命令） | （替代 `~/.articlewriter/config.json`） | LLM 配置改存插件数据目录 data.json（首次运行预置三组标准模板）；旧的「打开插件设置文档 open-config-doc」命令已移除，不再读写 work_dir MD 文件、不做迁移 |
| `llm-test` | `/llm test` | 对激活 LLM 配置执行 GET /models 连通性测试并弹通知（列出可用模型）；设置页内每份配置也可单独测连 |
| `write-chapter` | `/write [要点]` | 创作章节：目标章解析（当前→场景归属→下一章）；**无正文且有大纲时直接按大纲自动开写不弹任何输入框[对齐 CLI /write]，仅无正文且无大纲才询问要点**、大纲覆盖率检查、追加/覆盖选择、编写类型格式校验重试×3（最多6次LLM调用）、自动去AI味、预览保存后写盘+同步当前场景正文 |
| `continue-writing` | `/continue [要点]` | 续写当前章（已有末尾1000字衔接，无格式校验仅空结果重试×3）；本章无正文时回落到 /write；大纲要点全覆盖且未给新指令时警告跳过；剥离重复标题+去AI味后追加 |
| `rewrite-chapter` | `/rewrite [号] [要求]` | 重写整章（单次生成不带格式校验），含前后章大纲桥接与旧文参考，去AI味后全量覆盖保存 |
| `polish-text` | `/polish [风格]` | 润色当前章（原文截断4500字入 prompt，仅改表达不改情节），全量覆盖保存 |
| `deai-clean` | `/deai [号]` | 检测 AI 常用词 → 逐句打回 LLM 重写（基础系统提示词，非编写类型块）→ 原位替换两轮 → 预览确认后覆盖保存 |
| `review-chapter` | `/review [号] [重点]` | 全局视角审阅报告（非流式 chatCompletion，thinking=on 语义，空结果重试×3），可另存为章节目录内 `审阅笔记.md` |
| （设置页 LLM 区） | `/llm [名字]` | Obsidian 插件设置 → ArticleWriter：多组 OpenAI 兼容配置的查看/编辑/切换 active_llm/保存回写 MD 文档（正文与自定义属性透传保留） |
| `llm-chat` | —（插件新增，无 CLI 对应） | **常驻可停靠** LLM 对话面板（自定义 ItemView `LlmChatView`，见代码结构表；ribbon 图标同入口）：多轮流式聊天，Enter 发送/Shift+Enter 换行（含中文输入法合成态保护），支持 @ 引用 vault 任意文件（弹窗选择或手输路径；范围可写 :行号 / :起-止 / 紧跟如 ]]3-5），Enter 发送时引用被原位替换为对应行的实际内容再发给模型，顶部下拉切换任意已保存模型配置（对后续轮次生效），「停止生成」只中断当前一轮、会话保留；已有面板时命令直接激活之，否则底部新建分割区；每轮前置对话专用系统提示词（对齐 CLI `_chat_reply`，见代码结构表）；顶部首行显示当前小说·章节；不落盘（重启清空历史）、关闭面板中断进行中请求 |
| `status-page` | —（插件新增，无 CLI 对应） | **常驻可停靠**写字台（自定义 ItemView `StatusView`，显示名「写字台」；见代码结构表；ribbon「book-open」图标同入口）：工作目录+「书籍列表」分组（标题行右侧下拉框占满剩余空间，选择即激活对应小说；组内只展示该书的「全局文档」「章节」小节，不枚举书名树）、当前小说的题材/编写类型/总字数/更新时间、全局文档与各章文件（点击打开编辑器）、章节列表（树状：点行展开/折叠本章文件；勾选行尾右对齐的 Radio 才激活该章并同步所属卷）；已有面板时命令直接激活之，否则**不分割新面板**：直接复用左栏现有叶子 `getLeftLeaf(false)` 替换其内容显示状态面板[与文件列表同一位置，点侧栏文件图标切回]（左栏为空才 `getLeftLeaf(true)`，再不行退回主区域 `getLeaf("split")`）|

## 移动语义陷阱（updateScene / updateCharacter）

两者都是「**改章节 = 移动文件，早退**」：patch 里带新章节时只做跨章节目录的文件搬移并立即返回，**不再应用其它字段补丁**。因此编辑流程必须先保存字段修改，再单独以 `{ chapter_num }`（场景）或 `{ chapter }`（角色）调用一次完成移动。新增类似方法必须沿用该约定并在 JSDoc 注明。
