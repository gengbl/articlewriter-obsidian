# L2 · LLM 对话面板

## 模块概要

- **LLM 对话窗是常驻 ItemView 不是 Modal**：`LlmChatView`（`src/llm_chat_view.ts`）经 main.ts `registerView(LlmChatView.VIEW_TYPE, ...)` 注册 + ribbon 图标；自持 history 与每轮 AbortController，配置经构造注入的 getter 实时取 settings.llm；**顶部「模型：」下拉切换即写回 data.json 的 `llm.active_llm`**（v0.2.0+，构造第 5 参 `setActiveModel` 由 main.ts 注入 `setActiveLlmFromChat`；写作命令/连接测试共用同一激活项，故切换后下一次命令立即用新模型、重启后按它加载），设置页改激活模型则经 main.ts `syncChatModelSelect()` 反向同步下拉（`refreshModels` 已改为 public 且**一律以 `active_llm` 为选中依据**）。可见时才抢焦点（offsetParent 判空），避免停靠他区打断编辑。`StatusView`（状态页）同款：数据 getter + 写动作回调注入，渲染陷阱一致（见 [l3-view-rendering.md](./l3-view-rendering.md)「常驻 ItemView 渲染陷阱」）。

## 相关源文件

| 文件 | 职责 |
| --- | --- |
| `src/llm_chat_view.ts` | **常驻 LLM 对话面板**（自定义 ItemView，可停靠任意工作区区域、重载保留位置）：多轮流式聊天 Enter 发送/Shift+Enter 换行（含中文输入法合成态保护；操作提示为输入框占位文字——空时显示、输入即消失，输入框上方状态行仅动态显示「回复中/错误」等且空闲隐藏）；**@ 引用功能**：支持两种形式——①`@[[相对路径]]`（弹窗插入、可含空格）②`@相对路径`（手输，不含空白/冒号/方括号，须含 `/` 或扩展名防误伤邮箱）；行范围支持 `:行号`/`:起-止`、「空格+起-止」（如 `@a/b.md 13-34`）、以及紧贴 token 尾的数字（如 `]]3-5`、`@a/b.md9-12`——扩展名后紧跟数字自动拆为路径+范围）；键入 @ 弹候选列表（vault 全部文件按路径过滤、排除 `_resources` 资源目录[任意层级]、上限 200 条、↑↓/Enter/Tab/Esc 或点击选择）；insertRef 用纯字符串拼接替换 @查询段（不用 execCommand——失焦时选区不可靠会插出重复 @@），query 出现 [ ] 即收起弹窗避免插入后重开。Enter 发送时内联展开：resolveRefs 解析 BRACKET_TOKEN_RE（先定位 `@[[路径]]` token 本体，再对尾部用 parseRangeSuffix 锚定探测行范围——勿改回单条复杂正则，嵌套可选分支在 V8 下会漏匹配裸 token）+PLAIN_REF_RE → vault 读文件[缺失保留原 token+状态行报错]、**token 原位替换**为「=== 路径（第X–Y行 / 全文）=== + 带行号正文[未指定范围=整文件]」片段——历史与请求用替换后文本（模型直接看到原文，不再单独注入系统提示词），**气泡回显原始输入**（保留 @ 引用标记、不显示替换结果）；顶部下拉切换已保存模型配置（**v0.2.0+ 切换即写回 data.json 的 `active_llm`**：构造第 5 参 `setActiveModel` 注入 main.ts `setActiveLlmFromChat`，与写作命令/连接测试共用同一激活项；`refreshModels()` 已 public 且**一律以 `active_llm` 为选中依据**，设置页侧经 `syncChatModelSelect()` 反向同步）、「停止生成」仅中断当前轮；每轮请求前置**对话专用**系统提示词（友好助手身份+【创作规范】指南+当前小说上下文快照[写作上下文+当前章节正文截断6000字]，main.ts `getChatSystemPrompt()` 恒返回非 null、任一部分失败仅局部回退）；多轮历史用原生 messages 传递；顶部首行显示当前小说·章节（main.ts `getActiveStoryInfo()` 非交互读取，每轮后同步；切书/切章等变更后由 main.ts `notifyContextChanged()` 主动刷新该行与「提示词」标签——钩子挂在两条必经路径：`saveSettings()` 末尾覆盖 lastStory/workDir 变更、`StoryManager.onStateChanged` 回调在每次 saveState 落盘后触发，故所有命令的章节状态变更无需逐处埋点）；自持 history（不落盘），构造注入 `getConf`/`getSystemPrompt`/`getActiveStory` getter 实时取值；main.ts 负责 registerView + ribbon 图标 + openLlmPanel()（已有则激活、否则底部新建分割区）。**v0.2.0+ 激活模型双向同步**：`setActiveLlmFromChat(name)`（对话框下拉回调：写 `settings.llm.active_llm` + `saveSettings` + Notice，写作命令下一次即用新模型）与 `syncChatModelSelect()`（设置页改激活项/新建/删除/排序后，遍历已打开面板调 `refreshModels()`）。样式复用 styles.css `.aw-chat-*` 类 + `.aw-chat-view` flex 布局。渲染陷阱见 [l3-view-rendering.md](./l3-view-rendering.md)「常驻 ItemView 渲染陷阱」 |

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-view-rendering.md](./l3-view-rendering.md) | 常驻 ItemView 渲染陷阱（onClose 清理、重开重建等） |
| L3 | [l3-summary-pipeline.md](./l3-summary-pipeline.md) | 三层写作上下文结构与上下文窗口（对话系统提示词中当前小说上下文快照的输入源）、notifyContextChanged 广播口径 |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程、main.ts 通用辅助方法（新增接线/handler 时复用） |
