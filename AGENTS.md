# AGENTS.md（articlewriter-obsidian）

本文档为 AI 助手在本项目中执行任务时必须遵守的约定。每次执行任务前，必须先读取本文件并遵循其中内容。行为语义的最终依据是 Python 原版项目 `/home/fosky/workspace/articlewriter/`（其 `AGENTS.md` + 源码）；本插件是其功能集的 Obsidian 移植版（确定性文件操作 + LLM 写作命令）。

## 项目概述与范围

把 `articlewriter` CLI 的功能移植为 Obsidian 插件：全部使用 Vault / Workspace API 操作 vault 内 Markdown，交互用 Modal。**LLM 写作类命令已完整移植**（Phase 2）：`/write`、`/continue`、`/rewrite`、`/polish`、`/deai`、`/review`——prompt 组装在 `src/prompts.ts`（含两层创作规范注入、禁用词合并、编写类型格式校验），调用层在 `src/llm_client.ts`，结果落盘+场景同步走 `story_manager.ts`。**与 CLI 的有意差异**：①所有生成结果先经「流式预览 → 保存/放弃」Modal 确认才写盘（CLI 直接自动保存，覆盖风险更高）；②去AI味后保存的文件不含 AI 常用词的 HTML span 标记（markAiWordsHtml 不移植）；③章节摘要文档不自动生成（Python `_refresh_chapter_summary` 暂缓）。**不包含**：`/edit` 自然语言编辑、剧本转换（script2novel/novel2script）、WebDAV 同步、技能系统（`/skill`）、`/agents banned|reload` 子命令（指南三层已全部移植为 `agents-view`/`agents-edit`：小说级 `<书名>/WRITING_GUIDE.md` > 用户级 `<work_dir>/WRITING_GUIDE.md` > 系统级存插件设置 data.json（预置 CLI 内置内容），原 `~/.articlewriter/` 不再使用）、PDF 导出。**术语约定：用户可见文案一律称「小说」（原「故事」称呼已统一改掉）**；但磁盘文件名 `故事状态.md`、指南数据格式分类名（banned_words.ts 的「故事风格」等）、CLI 派生的默认提示词与系统指南文本（llm_client.ts / system_guide_default.ts）保持原文不改。**状态页「书籍列表」分组标题行右侧有占满剩余宽度的下拉框（`.aw-st-select`），选择即激活对应小说**（经 doSwitchStory→statusSwitchStory）；组内只展示当前激活小说的「全局文档/章节」小节、不枚举全部书名。这些属于明确未移植项，新增需求前先确认是否要突破该边界。

## 运行环境与构建部署

- 构建：`npm run build` = `tsc -noEmit -skipLibCheck && node esbuild.config.mjs --production` → 产出完整可分发目录 **`release/`**（esbuild 打包出 `main.js`，并自动把手写的 `manifest.json`、`styles.css`、写作指南 `WRITING_GUIDE.md` 一并拷入；目录已自动创建）
- 打包：生成发布 zip（`articlewriter-v<版本号>.zip`）时把 `release/` 下全部文件整体压缩；**打包时，把写作指南也放进去**（`WRITING_GUIDE.md` 已由 esbuild.config.mjs 自动拷入 `release/`）
- **任何代码改动后必须跑通 `npm run build`（tsc 零错误）**；可再 `node --check release/main.js` 做语法兜底
- 部署：把 `release/` 下四个文件整体覆盖复制到 `/home/fosky/workspace/geng_bl/.obsidian/plugins/articlewriter/`，在 Obsidian 中重载插件生效
- Git：仓库远端为 Gitea `http://192.168.0.3:3000/geng_bl/articlewritter-obsidian.git`（分支 main）；`.gitignore` 排除 `node_modules/` 与 `/release/`——上传时只提交源码，不含依赖与编译产物
- **代码提交、版本打包与 Gitea Release 发布的完整流程见 [RELEASE.md](./RELEASE.md)**（含版本号规则、发布脚本与实测坑位），执行"打包发布"类任务前先读该文件
- esbuild 配置注意：非 watch 模式直接 `esbuild.build(options)` + `process.exit(0)`；banner 必须是对象 `{ js: "..." }` 不能是字符串
- **正则语法兼容性**：Obsidian 移动端 iOS（Safari <16.4）不支持 lookbehind 断言 `(?<=…)` / `(?<!…>`，运行时直接抛 SyntaxError——src 内所有动态 RegExp 禁用该语法；需排除匹配起点前的特定字符时统一用「(?:^|[^X])」前缀捕获组 + 替换串 `$N` 回补被消耗的前缀字符（范例见 banned_words.ts simplifyNegationContrast；改动此类规则须做新旧输出等价性对照验证）
- **本地 `node_modules/obsidian`（1.13.1）是被 patch 过的 d.ts**（有 `undo.patch`），与官方类型不同，已知差异：
  - 删除统一走 `app.fileManager.trashFile(file)`（单参、跟随用户「删除方式」设置：默认移入 vault `.trash/`，或系统回收站），不用 `delete()` 硬删；旧写法 `vault.trash(file,false)` 已全项目停用
  - HTMLElement 扩展没有 `createTextArea` / `setPlaceholder` 等方法：用 `createEl("textarea") as HTMLTextAreaElement` + 原生属性（`.placeholder = ...`、`.value = ...`、`.focus()`）
  - `getAbstractFileByPath` 返回 `TAbstractFile | null`，凡要当文件用必须先 `instanceof TFile` 收窄

## 代码结构

| 文件 | 职责 |
| --- | --- |
| `src/story_types.ts` | 纯工具：`safeFilename`（对齐 Python `fsutil.safe_filename`）、`countPureWords`（移植 `story_types.count_pure_words`：只计汉字/字母/数字等纯文字字符，不含标点符号空白）、`formatLocalDateTime`（ISO UTC 存储时间→本地时间展示换算，解析失败退回原串截断）、各文档模板（HTML 注释示例包裹） |
| `src/md_docs.ts` | **纯函数层**：全部 MD 文档的类型定义 + parse/format（卷/场景/人物/伏笔/世界观/章节信息/大纲辅助/章节选择表达式）。不接触 Vault。新增文档格式先在这里加类型与解析器 |
| `src/state_doc.ts` | **纯函数层**：运行态状态文档编解码——`StoryState`/`ChapterMeta` 类型 + YAML frontmatter parse/format（依赖 js-yaml，esbuild 打包进 bundle）。载体为 Obsidian「文件属性」风格的 `<书名>/故事状态.md`；正文原样保留、用户自定义属性（extra）保存时透传不丢失。改状态字段必须同步改这里并跑往返测试 |
| `src/llm_client.ts` | LLM 调用层（openai SDK v7，esbuild 打包进 bundle）：`normalizeBaseURL`（对齐 Python `_openai_endpoint`：base_url 未含 /vN 自动补 /v1）+ `createClient`（无 api_key 时用占位值过 SDK 校验，本地服务忽略该头）+ `testConnection`（GET /models）+ `chatCompletion`/`chatStream`（流式逐块回调）。配置来源=插件 data.json 中 active_llm 指向的配置。注意 openai v7 类型走 `OpenAI.Xxx` 命名空间导入，流式 create 需显式断言 `ChatCompletionCreateParamsStreaming` 重载。buildParams 返回本地接口 `LlmChatBody`（含 `[k:string]:unknown` 索引签名以透传 openai_extras、`model?:string` 允许本地服务留空）而非 `as any`——新增请求体字段要么在接口里声明、要么靠该签名兜底，勿回退到 any |
| `src/plugin_config.ts` | LLM 配置类型与默认模板：`LlmConfigDoc`（对齐 Python config.json 的 llm 段全字段）+ `PluginConfig`（active_llm/llm_configs/system_prompt/desc_style/system_guide）+ `buildDefaultLlmConf()`（首次运行预置 local/deepseek/qwen-dashscope 三组标准模板，api_key/model_name 留空待填；system_guide 预置 CLI 内置指南文本）。载体为 Obsidian 标准插件数据目录 `data.json`（saveData/loadData），不再使用 MD 文件 |
| `src/system_guide_default.ts` | 系统级写作指南默认文本（生成自 CLI 程序目录 `config/WRITING_GUIDE.md` 的全量内容，勿手工编辑转写）；作为三层创作规范的最低优先级层存入 data.json，可用 `/agents edit`「系统级」修改 |
| `src/modals.ts` | UI Modal 集合（见「交互约定」；LLM 对话窗已移出，改常驻视图） |
| `src/llm_chat_view.ts` | **常驻 LLM 对话面板**（自定义 ItemView，可停靠任意工作区区域、重载保留位置）：多轮流式聊天 Enter 发送/Shift+Enter 换行（含中文输入法合成态保护；操作提示为输入框占位文字——空时显示、输入即消失，输入框上方状态行仅动态显示「回复中/错误」等且空闲隐藏）；**@ 引用功能**：支持两种形式——①`@[[相对路径]]`（弹窗插入、可含空格）②`@相对路径`（手输，不含空白/冒号/方括号，须含 `/` 或扩展名防误伤邮箱）；行范围支持 `:行号`/`:起-止`、「空格+起-止」（如 `@a/b.md 13-34`）、以及紧贴 token 尾的数字（如 `]]3-5`、`@a/b.md9-12`——扩展名后紧跟数字自动拆为路径+范围）；键入 @ 弹候选列表（vault 全部文件按路径过滤、排除 `_resources` 资源目录[任意层级]、上限 200 条、↑↓/Enter/Tab/Esc 或点击选择）；insertRef 用纯字符串拼接替换 @查询段（不用 execCommand——失焦时选区不可靠会插出重复 @@），query 出现 [ ] 即收起弹窗避免插入后重开。Enter 发送时内联展开：resolveRefs 解析 BRACKET_TOKEN_RE（先定位 `@[[路径]]` token 本体，再对尾部用 parseRangeSuffix 锚定探测行范围——勿改回单条复杂正则，嵌套可选分支在 V8 下会漏匹配裸 token）+PLAIN_REF_RE → vault 读文件[缺失保留原 token+状态行报错]、**token 原位替换**为「=== 路径（第X–Y行 / 全文）=== + 带行号正文[未指定范围=整文件]」片段——历史与请求用替换后文本（模型直接看到原文，不再单独注入系统提示词），**气泡回显原始输入**（保留 @ 引用标记、不显示替换结果）；顶部下拉切换已保存模型配置、「停止生成」仅中断当前轮；每轮请求前置**对话专用**系统提示词（对齐 CLI chat.py `_chat_reply`：友好助手身份+【创作规范】指南+当前小说上下文快照[写作上下文+当前章节正文截断6000字]，main.ts `getChatSystemPrompt()` 恒返回非 null、任一部分失败仅局部回退）；多轮历史用原生 messages 传递；顶部首行显示当前小说·章节（main.ts `getActiveStoryInfo()` 非交互读取，每轮后同步；切书/切章等变更后由 main.ts `notifyContextChanged()` 主动刷新该行与「提示词」标签——钩子挂在两条必经路径：`saveSettings()` 末尾覆盖 lastStory/workDir 变更、`StoryManager.onStateChanged` 回调在每次 saveState 落盘后触发，故所有命令的章节状态变更无需逐处埋点）；自持 history（不落盘），构造注入 `getConf`/`getSystemPrompt`/`getActiveStory` getter 实时取值；main.ts 负责 registerView + ribbon 图标 + openLlmPanel()（已有则激活、否则底部新建分割区）。样式复用 styles.css `.aw-chat-*` 类 + `.aw-chat-view` flex 布局。**渲染陷阱**：本环境 Obsidian 对已注册视图不调用 `getEmptyStateElement()`（返回游离节点会整片空白），UI 必须在 `onOpen()` 里建进框架创建的 `this.contentEl`（内置日历等视图同款做法）；本地 patch dts 中 `ItemView.onClose` 签名是 `Promise<void>` 需声明 async；实例方法须实现 `getViewType()`/`getDisplayText()`/`getIcon()`，开文件用 `leaf.openFile(TFile)`（本 dts 无 setFile） |
| `src/status_view.ts` | **工作状态面板**（自定义 ItemView，可停靠任意区域、重载保留位置）：工作目录行（「工作目录：」标签加粗、路径可换行、「刷新」按钮内嵌该行右侧、行下有细分隔横线——无独立顶部工具条与操作提示）+ **「小说状态」区（`.aw-st-status`，位于工作目录横线之下、「书籍列表」分组之上，底部再一条横线隔开）**：仅展示当前激活书的概要——**书名行：名称左对齐 + 更新时间右对齐**（`.aw-st-status-title` flex space-between，时间经 `formatLocalDateTime(iso,true)` 显示本地 `YYYY-MM-DD HH:mm` 含年份）、题材/编写类型、`N章·第X章·总字数Y字`（原小说行尾的章数/当前章/字数在此），切换小说后随刷新更新；**下拉框选书 + 只展示激活小说小节**：「书籍列表（n）」分组标题行右侧有 `.aw-st-select` 下拉框占满剩余宽度（选择即激活该小说=同 statusSwitchStory 语义、已选中项再选不重复触发；click/contextmenu stopPropagation 不误触分组折叠与菜单）；组内渲染当前激活小说的**「全局文档」「章节」两个小节**（不再枚举全部小说的名称树，逐书行/箭头/storyOpen 已移除）；分组标题行右键=新建小说…/删除当前小说「名」（删书唯一出现处，整目录入回收站+清 lastStory）。树状结构：点章节行（含章节名）或行首 ▾/▸ 箭头只展开/折叠本章文件列表（expanded 集记手动态，默认收起）、绝不激活；**行尾右对齐的 `.aw-st-radio` RadioButton 是激活章节的唯一入口**（选中即写回 current_chapter[已是当前章则静默忽略]并同步所属卷，书内同名互斥、checked=当前章；stopPropagation 点它不触发行的开合）（章节行+文件行），组内空白右键也归该章文章级菜单（分组标题的右键经 sectionHead 可选参 onContext 处理），章节列表（当前章仅灰底标识无箭头，仅当前激活小说下的章节点击才写回 current_chapter[非激活书静默忽略]、归属卷时同步补激活所属卷；右键任何位置均不触发切换/激活；行前 ▾/▸ 是本章文件列表的折叠开关）与全局文档/各章文件行（点击 openFile 在编辑器打开）。数据经构造注入 getter（main.ts `getStatusSnapshot()` 非交互读取、逐段容错），写动作走 main.ts `statusSwitchStory`/`statusActivateChapter` 回盘后刷新视图；各小节支持文件夹式展开/折叠：小说列表、全局文档、章节列表点标题行切换，每章文件行默认折叠、由章节行前 ▾/▸ 箭头展开（expanded 集记手动展开态；stopPropagation 不触发激活），其余分组折叠态存实例 Set，均仅会话内保持不落盘；**右键上下文菜单**（视图内自绘 fixed 定位小面板，点外部/Esc 收起）：菜单按点击位置精确分配且**删除只作用于被点中的条目自身**（绝不把目录下所有文件枚举进菜单），各下层处理器均 stopPropagation 不落到兜底——面板空白处兜底仅「新建小说…」；「书籍列表」分组标题行=新建小说…｜删除当前小说「名」（危险操作，见上）；菜单标签一律简洁不带位置提示、不同级别项之间以横线隔开（`{sep:true}`→`.aw-st-menu-sep`），落点由点击位置决定：全局文档分组标题及组内空白=新建文章…[书根]/新建章节…；「章节」分组标题=新建章节…；**章节名行=新建文章…[该章节目录]/新建章节…｜编写本章…(=/write)/续写本章…(/continue)/润色本章…(/polish)｜重命名本章…(=/chapter rename：输入新标题后同步目录名与文档引用)/删除本章**（LLM 三项经 `statusRunWriting`：先把目标书设为 lastStory、激活该章[同点章节名语义]，再复用对应命令的完整交互流程）；每章容器块内空白=同两新建项（无删除）；文件行=新建文章…[其所属目录]/删除该文件（`故事状态.md` 禁删）。动作统一经第 5 个构造参数 `onAction(StatusAction)` 交 main.ts `handleStatusAction()` 执行（语义与对应命令一致但直接针对右键对象不再弹选择器；复用 cmdNewStory/prompt/confirmBox/fileManager.trashFile），完成后自动刷新视图；**字体观感对齐侧栏文件列表**：`.aw-status-view` 根节点设 `font-size: var(--nav-item-size)` + `color: var(--nav-item-color)`——文件列表项 `.tree-item-self` 用的是这对专用变量（桌面端 =13px 弱化灰），而非 body 的 `--font-ui-medium`(15px)+正文黑，直接继承会显得又大又黑（曾遗留的 `.view-content .aw-status-view {font-size:0.85em}` 整体缩小规则与下拉框 `0.9em` 已移除）；文件名不用链接蓝、悬停仅加背景块；**章/书字数展示一律实时统计各章 `章节.md`（manager.countWords，与 /count 同口径），不读状态文档里可能过期的 words/total_words**（旧数据/CLI 写入时该字段常为 0）；**布局拆分（滚动隔离）**：`.aw-status-view` 纵向 flex 撑满视图高度——`.aw-st-top` 固定头部（工作目录行/小说状态区/「书籍列表」标题行含下拉框，不随内容滚走）+ `.aw-st-tree` 可滚动主体（`flex:1; min-height:0; overflow-y:auto`，仅全局文档/章节树区域内部出滚动条）；操作失败等错误提示一律挂 `treeEl` 内不撑破头部；分组用 `sectionHead(this.topEl, ...)` 建标题行后须把返回的 body `appendChild` 移入 `treeEl`；**写作实时刷新**：main.ts 订阅 vault `modify/create/delete`（仅 workDir 内 `.md`，`pathUnderWorkDir()` 过滤）→ 防抖 800ms 调各打开面板的公开方法 `refresh()`（章节字数随编辑器落盘自动跟进），`render()` 重渲染前后保存/恢复 `treeEl.scrollTop` 避免跳回顶部；渲染陷阱同 llm_chat_view（UI 建进 contentEl） |
| `src/story_manager.ts` | **Vault API 操作层**（唯一直接读写 vault 的模块）：小说/章节/卷/场景/人物/伏笔/世界观/大纲/打包/重扫描/编写类型。构造时注入 `{ app, getStoryRoot: () => settings.workDir }` |
| `src/main.ts` | 插件入口：设置、命令注册（`addCommand`）、每个命令一个 `cmdXxx()` handler、通用交互辅助方法。**设置页双实现**：Obsidian ≥1.13 走声明式 `getSettingDefinitions()`+`getControlValue/setControlValue`（框架不再调 `display()`），<1.13 回落到旧 `display()/renderLlm()`——两者字段集必须保持一致，新增 LLM 字段两处都要补。key 约定：顶层 `workDir`/`autoOpenOnCreate`；全局 `llm.active_llm`/`system_prompt`/`desc_style`/`system_guide_path`；每份配置 `cfg.<数组下标>.<field>`（用下标而非 name 避免解析歧义，增删/重排后靠 `update()` 重建）。模型配置渲染为 list+子页（支持新建 config-N/删除[激活项被删则回落第一个]/拖拽重排 + 每页「设为激活」「测试连接」动作行）；数值字段 temperature/max_tokens 仍用 text 控件在 setControlValue 里 parse（空=undefined，对齐旧 UI，不用 number 控件以免空值被强转 0） |

### 新增命令的标准流程（对齐 CLI「在 COMMAND_DEFS 加一行即可」的体验）

1. 语义以 Python 版为准：查 `/home/fosky/workspace/articlewriter/AGENTS.md` 对应命令条目 + 源码实现，行为必须一致（含边界提示文案风格）
2. 需要新文档格式 → `md_docs.ts` 加类型 + parse/format（纯函数）
3. 文件操作 → `story_manager.ts` 加 async 方法（只在这层碰 vault；写操作用后即时落盘，不缓存内容到内存字段）
4. 交互 → 复用 `modals.ts` 现有 Modal；确实不够再加新 Modal
5. `main.ts`：`this.addCommand({ id, name: "中文说明（对齐 CLI /xxx）", callback: ... })` + 实现 `cmdXxx()`；handler 开头统一走 `ensureWorkDir()` / `requireStory()` 守卫，异常用 `notifyError(前缀, e)`
6. 同步更新 `README.md` 的命令表与本文档的「已移植命令速查」
7. `npm run build` → 复制部署 → Obsidian 内冒烟验证

### main.ts 通用辅助方法（handler 一律复用，不要重复造轮子）

- `ensureWorkDir()`：work_dir 未设置弹 FolderPickerModal 初始化；目录失效时重新选择。返回 `string | null`
- `activeStory()` / `requireStory()`：解析当前小说——记住上次选择（`settings.lastStory`），0 本书引导建书，1 本自动选中持久化，多本弹 StoryPickerModal
- `pickAction(title, ActionItem[])`：Promise 化的动作列表选择（回车/点击确认，Esc 取消返回 null）
- `confirmBox(...)`：危险操作二次确认
- `requireChapterNum(prompt)`：输入章节号并校验存在性
- `chapterLabel(num, title?)`：`第NN章 <标题>` 展示格式
- `notifyError(prefix, e)`：统一错误 Notice（6s）
- **LLM 写作命令共享辅助**（Phase 2，新增 LLM 命令一律复用不要重写）：`getLlmSetup()` 从插件 settings.llm（data.json）取激活配置+全局字段、无则 null；`loadWriterSetup()` = getLlmSetup + 缺失时弹通知返回 null；`loadWriterGuides(story)` 三层创作规范（小说级 > 用户级 > 系统级 data.json，顺序即优先级）+ 合并禁用词类目文本；`writerSystemPrompt(baseSp, guides, writingStyle?, title?, charNames?)` = buildStoryTypeSystemPrompt(编写类型块+禁用词) → assembleSystemPrompt(custom > baseSp > DEFAULT，末尾附【创作规范】原文)；`streamOnce`(空流→""、Abort 上抛)/`streamWithEmptyRetry`(×3)/`generateChapterStreamed`(对齐 writer.generate_chapter 的「生成→校验→带注记重生成」双次循环，最多3轮6调用)；`autoCleanAi(cfg, baseSp, guides, content, onProgress?)` 生成后去AI味（失败保留原文并弹摘要通知）；`targetChapterNum(story, verb)`/`promptArea(title, placeholder, initial?)` 章节号输入与多行输入封装。所有写盘前必须走 `StreamingPreviewModal.finish() + await done`（保存/放弃确认），去AI味等后处理期间用 `modal.setStatus(...)` 更新进度文案

## 数据模型与存储约定（继承 Python 版，必须保持兼容）

```
<work_dir>/<书名>/                    # work_dir 是容器，本身不是小说
├── 故事状态.md                       # Obsidian「文件属性」风格：YAML frontmatter = version 2 运行态，不存任何文档内容
#   （旧版 story_state.json 仅读兼容，首次 saveState 自动备份到 _backup/ 后不再读写）
├── WRITING_GUIDE.md                # 用户级创作规范（替代 ~/.articlewriter/WRITING_GUIDE.md）
├── 大纲.md / 卷.md / 场景.md / 世界观.md / 伏笔.md / 笔记.md   # 全局文档
└── 第NN章-<标题>/                     # 每章一个文件夹（NN=两位零填充）
    ├── 章节.md        # 正文
    ├── 章节大纲.md
    ├── 人物.md        # 归属该章的角色
    ├── 场景.md        # 本章场景
    └── 章节信息.md    # 卷归属/标签/备注/创建更新时间
```

- **故事状态.md（frontmatter，version 2）字段**：`title`、`genre`、`writing_style`、`current_chapter`、`current_scene`、`current_volume`、`total_words`、`created_at`、`updated_at`、`use_summaries` + `chapters`（键为章节号字符串，值=标题/字数/卷/标签/备注的嵌套映射）。空可选字段序列化时省略；key 顺序固定。磁盘是唯一事实来源；每个写操作后立即落盘，内存不持有文档内容。
- **状态文档保存语义（saveState）**：先读旧文档 → 只重写 frontmatter，**正文原样保留**（可自由写笔记）；用户在 Obsidian 属性面板加的自定义顶层属性会收进 `extra` 并透传回写（不被覆盖丢失）。新建书时用模板注释作初始正文。
- **创作规范三层结构**（完整对齐 CLI `/agents` 三层）：小说级 `<书名>/WRITING_GUIDE.md` > 用户级 `<work_dir>/WRITING_GUIDE.md` > 系统级存插件数据目录 `settings.llm.system_guide`（预置自 CLI 程序目录 `config/WRITING_GUIDE.md`，见 `src/system_guide_default.ts`；旧 data.json 缺该字段时 loadSettings 自动补默认值，不覆盖已有内容），且可用 `system_guide_path`（vault 相对路径）指向用户自己的指南文件——设置且可读时优先于内嵌内容，`/agents edit`「系统级」也直接写入该文件；读不到回落内嵌内容并在 view/edit 入口弹通知（写作命令静默回落）。view：文件层直接打开、系统级无 vault 文件时弹 MarkdownViewerModal 只读面板，仅一层直开 / 多层弹选择器 / 全无则提示；edit 选层后全量保存（文件层缺失新建 / 存在覆盖，系统级按上述规则落盘）。写作命令的 prompt 组装与禁用词合并均按此顺序取三层原文。
- **LLM 配置存插件数据目录 `data.json`**（`.obsidian/plugins/articlewriter/data.json`，经 saveData/loadData，替代 `~/.articlewriter/config.json`）：`settings.llm` = `PluginConfig`（`active_llm` + `llm_configs[]` 全字段对齐 Python 用户配置文件 + `system_prompt` + `desc_style` + `system_guide` 系统级写作指南 + `system_guide_path` 可选的 vault 文件路径覆盖，见「创作规范三层结构」），类型与默认模板在 `src/plugin_config.ts`。首次运行（data.json 无 llm 段）由 `buildDefaultLlmConf()` 预置 local/deepseek/qwen-dashscope 三组标准模板并弹通知提示填写 api_key/model_name；**不读取也不迁移旧的 work_dir MD 设置文档**（该方案已废弃）。**api_key 明文存于 data.json——勿将 .obsidian 同步/共享到不可信位置**。所有 LLM 命令读配置一律走 `getLlmSetup()`（激活项+全局字段），不再依赖 work_dir。
- **兼容迁移**：`loadState` 优先读 `故事状态.md`，缺失时回落旧版 `story_state.json`（Python CLI 产物可直接被识别加载）；对含旧 JSON 的小说首次 saveState 会把 JSON `vault.rename` 到 `_backup/story_state_<时间戳>.json`（不用回收站，保证可恢复），此后 MD 为唯一事实来源。
- 新建书/章时缺失的设定文档自动创建为「HTML 注释示例」模板（`ensureDoc`：已存在则跳过、绝不覆盖用户内容）；所有读取器在解析前过滤 HTML 注释，示例不会污染状态。**大纲类文档模板与 CLI `documents.py` 逐字对齐**：`outlineTemplate(书名)` → `# <书名> 大纲` + 全书主线/卷划分/结局示例注释；`chapterOutlineTemplate(num,标题)` → `# 第N章 <标题> 大纲` + 本章目标/情节要点/结尾示例注释；两者末尾均经 `appendOutlineMarkerHelp()` 附「大纲详略标记使用帮助」（[详][扩][补][略][跳]/[伏] + `<角色：>`/`<场景：>` 用法）。写盘路径同样恒带尾注：`setChapterOutline` / `appendChapterOutline`（对齐 `write_chapter_outline`）；建书/重扫描/open-outline/open-chapter-outline 均按书名或章节号动态生成模板标题行。
- 多行内容（场景正文、世界观历史/力量体系等）用 ```` ```text ```` 围栏包裹，解析按围栏进行（见 `md_docs.ts`）。
- **字段命名陷阱（继承自 Python，勿单方面"修正"）**：角色文档 `CharacterDoc` 的章节归属字段叫 **`chapter`**，而场景文档 `SceneDoc` 叫 **`chapter_num`**。两边都要改才允许统一。
- 伏笔（`ForeshadowItem`）：字段=章节/人物/事由/是否完成；`index` 是**章内序号（0 起）**，由 `parseForeshadows` 从 `## 第N章 伏笔K` 标题推导、保存时按位置重排（`saveOutlineForeshadows` 先做 per-chapter 归一化再写盘）。定位一律「章节+序号」、不带序号默认 0。
- 文件名/目录名统一经 `safeFilename()` 清理，禁止手工拼接未清洗的用户输入。
- 删除一律走回收站：`app.fileManager.trashFile(file)`（跟随用户「删除方式」设置，默认 vault `.trash/`），不用 `delete()` 硬删、也不再调旧 API `vault.trash(file,false)`；角色改名会把被改动文件备份到 `_backup/` 后再全小说替换。

### 卷 / 当前状态激活语义（对齐 CLI `/volume`、`/chapter switch`）

- 卷只是分组容器：数据存根目录 `卷.md`，章节通过 `章节信息.md` 的「卷」字段标记归属；卷不改变全局连续编号；删卷只清空其下章节标记并返回受影响章节号列表。
- `current_volume` + `current_chapter` 持久化在故事状态.md 的文件属性中；建卷自动激活并可顺带建该卷第一章；切换卷自动激活该卷最后一章；章节已归卷时切章同步补激活所属卷。
- 加载时校验：激活卷不存在→清空；激活章节不存在→回退最后一章（见 `validatedState`）。

## 已移植命令速查（插件 → CLI 对照）

| 插件命令 id | 对应 CLI | 说明 |
| --- | --- | --- |
| `set-work-dir` | `--work_dir` | 选择工作目录；0 本书提示先建书、唯一一本直接加载、多本提示用切换命令 |
| `switch-story` | `/dir <work_dir>/<书名>` | 列出全部小说（含各章数/当前章、◀ 当前标记），选中设为当前并弹出该书状态 |
| `new-story` | `/new` | 标题+题材+编写类型三问，建书与全套模板文档 |
| `new-chapter` / `list-chapters` | `/chapter add` / `/chapter list`、`/open` | 建章后自动激活；列表选择打开正文并切当前章 |
| `next-chapter` / `prev-chapter` | `/chapter next` / `prev` | 无当前章时 next→第一章、prev→最后一章；到边界提示不切 |
| `count-current` / `count-all` | `/count [号\|范围\|all]` | 纯文字字数统计（逐章 + 合计） |
| `save-current` | `/save` | 聚焦编辑器内容强制落盘 |
| `status` | `/status` | 标题/题材/编写类型/当前卷场景章节/章节数总字数/时间 |
| `volume-list` / `volume-add` / `volume-manage` | `/volume ...` | 列表（含当前标记）、新建（自动激活+可选建章）、启用/改名/改描述/分配章节/删除 |
| `scene-list` / `scene-add` / `scene-manage` | `/scene ...` | 全部章节+全局未归属；新增 ID/简介/角色/正文/归属；切换/查看/编辑/**移动**/删除 |
| `character-list` / `character-add` / `character-manage` | `/character ...` | 同上结构；能力字段为分词数组（`splitList`）；改名=预览命中后全小说替换并备份 `_backup/` |
| `foreshadow-list` / `foreshadow-add` / `foreshadow-manage` | `/foreshadow list/add/done/delete` | 全书 `伏笔.md`，按「章节+序号」操作 |
| `world-show` / `world-set` | `/world show/set` | 世界/类型/规则/势力/地点/历史/力量体系 |
| `outline-append-current` | `/outline chapter N [内容]` | 追加当前章大纲：去重合并 + `[伏]...[/]` 标记解析入库伏笔记录 |
| `open-chapter-outline` | —（配合 `/open 号 大纲`） | 打开当前章 `章节大纲.md`（缺失先建模板） |
| `chapter-delete` / `chapter-rename` / `chapter-renumber` | `/chapter delete`、目录改名、编号重排 | 删除=回收站+清理元数据与归属引用；重命名同步目录名与文档内引用；renumber 连续化并改写交叉引用 |
| `pack-chapters` | `/pack [选择][路径]` | 正文打包单 MD：中文章节号标题 + `---` 分隔；支持范围/列表/all（表达式解析在 `md_docs.parseChapterSelection`）；默认输出 `<书名>-第X-Y章-合集.md` |
| `rescan-story` | `/scan` | 从现有 MD 重建故事状态.md（只初始化，不切小说不改 work_dir） |
| `set-style` | `/style` | 切换编写类型 writing_style（预设或自定义），持久化到 state |
| `agents-view` / `agents-edit` | `/agents view` / `/agents edit` | 三层创作规范：小说级 `<书名>/WRITING_GUIDE.md` > 用户级 `<work_dir>/WRITING_GUIDE.md` > 系统级（默认 data.json 内嵌 CLI 内置内容，可用设置页 system_guide_path 指向 vault 文件覆盖）；view 文件层直开、系统级弹只读面板，单层直开/多层选择器/无则提示；edit 选层后多行文本框全量保存 |
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
| `status-page` | —（插件新增，无 CLI 对应） | **常驻可停靠**工作状态面板（自定义 ItemView `StatusView`，见代码结构表；ribbon「book-open」图标同入口）：工作目录+「书籍列表」分组（标题行右侧下拉框占满剩余空间，选择即激活对应小说；组内只展示该书的「全局文档」「章节」小节，不枚举书名树）、当前小说的题材/编写类型/总字数/更新时间、全局文档与各章文件（点击打开编辑器）、章节列表（树状：点行展开/折叠本章文件；勾选行尾右对齐的 Radio 才激活该章并同步所属卷）；已有面板时命令直接激活之，否则**不分割新面板**：直接复用左栏现有叶子 `getLeftLeaf(false)` 替换其内容显示状态面板[与文件列表同一位置，点侧栏文件图标切回]（左栏为空才 `getLeftLeaf(true)`，再不行退回主区域 `getLeaf("split")`）|

### 移动语义陷阱（updateScene / updateCharacter）

两者都是「**改章节 = 移动文件，早退**」：patch 里带新章节时只做跨章节目录的文件搬移并立即返回，**不再应用其它字段补丁**。因此编辑流程必须先保存字段修改，再单独以 `{ chapter_num }`（场景）或 `{ chapter }`（角色）调用一次完成移动。新增类似方法必须沿用该约定并在 JSDoc 注明。

## 交互约定（Modal 选型）

| Modal | 用途 |
| --- | --- |
| `TextInputModal` | 单个短文本输入（标题、ID、章节号等） |
| `TextAreaPrompt` | 多行内容（场景正文、世界观历史、大纲追加） |
| `MultiFieldModal` | 多字段表单；第 7 参 `initialValues` 预填——**所有"编辑已有实体"入口用它** |
| `ActionMenuModal` | 通用动作列表：label + sub + marker（如 `◀ 当前`）+ disabled；↑↓/回车/点击选择。**一切"选一个实体再做操作"的菜单都用它** |
| `TextPanelModal` | 只读展示面板（show 类命令），行支持 bold/dim/accent |
| `StreamingPreviewModal` | LLM 写作命令的流式预览：append/reset/setStatus + finish(保存/放弃)/fail，done Promise 驱动写盘确认 |
| `MarkdownViewerModal` | 只读渲染展示（系统级创作规范等无 vault 文件载体的内容），构造 `(app, title, markdown)` |
| `ConfirmModal` | 危险操作确认；Esc=取消 |
| `StoryPickerModal` / `ChapterListModal` / `FolderPickerModal` / `NewStoryModal` | 小说选择 / 章节打开 / work_dir 初始化 / 建书三问 |

- 统一「submitted/resolved 标志」模式：先置位再 `close()`，`onClose` 里未提交才触发 onCancel，防止 Esc 与按钮双触发。新 Modal 必须照抄该模式。
- **LLM 对话窗是常驻 ItemView 不是 Modal**：`LlmChatView`（`src/llm_chat_view.ts`）经 main.ts `registerView(LlmChatView.VIEW_TYPE, ...)` 注册 + ribbon 图标；自持 history 与每轮 AbortController，配置经构造注入的 getter 实时取 settings.llm（面板打开期间改设置后重新显示会自动刷新模型列表）。可见时才抢焦点（offsetParent 判空），避免停靠他区打断编辑。`StatusView`（状态页）同款：数据 getter + 写动作回调注入，渲染陷阱一致。
- 文案风格对齐 CLI：中文提示、错误带前缀（如「删除失败：…」）、成功 Notice 6–8s。

## work_dir 与小说切换行为约定（移植自 `/pwd` 与 `/dir`）

- work_dir 是容器目录本身不生成小说状态文档；每个小说是其下子文件夹（以含 `故事状态.md` 或遗留 `story_state.json` 判定）。
- **首次使用**任何命令弹 FolderPickerModal 初始化并持久化到插件设置（替代 CLI 写 config.json）。
- 切换工作目录后清空 `lastStory`（旧小说记忆作废）；随后按结果分支提示：0 本书→提示用「创建新小说」；1 本→自动加载为当前小说；多本→提示用「切换当前小说」。
- 「切换当前小说」（switch-story）= CLI `/dir <work_dir>/<书名>` 的等价物：选书 → 设 lastStory → 展示该书状态（章节数/当前章等），对应原版"加载该书，列出章节和当前状态"。
- rescan 只重建目标小说的 state，不改变 work_dir / 当前小说选择（同 CLI `/scan` 语义）。

## 工作更新写回约定（每次功能更新后强制执行）

本文件是下次会话了解项目现状的唯一入口。**任何功能新增 / 行为变更 / bug 修复完成后、收尾前，必须把本次工作写回本文件**：

1. **受影响模块的既有描述已过时 → 就地修订对应条目**（代码结构表、数据模型、交互约定等），补充新字段/事件订阅/布局结构/交互细节；已被现有条目覆盖的内容只改原条目，不另起重复段落。
2. **新引入的约定或陷阱 → 归入最相关章节**（渲染陷阱进代码结构表、CLI 对齐语义进数据模型节、构建坑进运行环境节）。
3. **`CHANGELOG.md`（仓库根目录的外部变更日志文件）末尾追加一行**：日期 + 一句话摘要（一次任务的多个改动可合并成一条）；保持精简，超过 120 行时将最旧的若干条压缩归档。AGENTS.md 本身只保留对该文件的引用，不再内联条目。

## 验证要求

- 每次任务完成必须：`npm run build` 通过 + 复制部署到 vault + 在 Obsidian 中重载并对改动路径做实际冒烟（建一个临时测试小说跑通新增/修改的命令，验完删除——**不要在真实书籍目录里试错**）。
- 构建部署通过后按「工作更新写回约定」同步 AGENTS.md，再算任务结束。
- 修复类任务需说明根因与验证结果。
- 纯函数层（md_docs.ts / story_types.ts）的行为变更应先用临时脚本或现有命令双向验证 parse↔format 往返一致（保存→再读回内容不丢字段、注释保留行不丢失）。

## 变更日志

已移至外部文件 **[CHANGELOG.md](./CHANGELOG.md)**（本文件不再内联条目）：每次任务收尾按下方写回约定第 3 条向其**末尾追加一行**（日期 + 一句话摘要）。了解历史改动时先读该文件。
