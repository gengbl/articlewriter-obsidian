# L2 · LLM 对话面板

## 模块概要

- **LLM 对话窗是常驻 ItemView 不是 Modal**：`LlmChatView`（`src/llm_chat_view.ts`）经 main.ts `registerView(LlmChatView.VIEW_TYPE, ...)` 注册 + ribbon 图标；自持 history 与每轮 AbortController，配置经构造注入的 getter 实时取 settings.llm；**顶部「模型：」下拉切换即写回 data.json 的 `llm.active_llm`**（v0.2.0+，构造第 5 参 `setActiveModel` 由 main.ts 注入 `setActiveLlmFromChat`；写作命令/连接测试共用同一激活项，故切换后下一次命令立即用新模型、重启后按它加载），设置页改激活模型则经 main.ts `syncChatModelSelect()` 反向同步下拉（`refreshModels` 已改为 public 且**一律以 `active_llm` 为选中依据**）。可见时才抢焦点（offsetParent 判空），避免停靠他区打断编辑。`StatusView`（状态页）同款：数据 getter + 写动作回调注入，渲染陷阱一致（见 [l3-view-rendering.md](./l3-view-rendering.md)「常驻 ItemView 渲染陷阱」）。
- **多轮流式聊天**：Enter 发送 / Shift+Enter 换行（含中文输入法合成态保护）；「停止生成」仅中断当前轮；会话历史由面板自持、不落盘（重载即清空）。
- **@ 引用功能**：两种形式——`@[[相对路径]]`（弹窗插入、可含空格）与 `@相对路径`（手输，须含 `/` 或扩展名防误伤邮箱）；支持行范围（`:起-止`、空格分隔、紧贴 token 尾的数字）；键入 @ 弹候选列表（vault 文件按路径过滤、排除 `_resources`、上限 200 条）；Enter 发送时 token 原位内联展开为「=== 路径（第X–Y行 / 全文）=== + 带行号正文」片段（模型直接看到原文），气泡回显原始输入（保留 @ 标记）。
- **每轮系统提示词与上下文**：请求前置对话专用系统提示词（友好助手身份 + 创作规范指南 + 当前小说上下文快照〔写作上下文 + 当前章节正文截断 6000 字〕）；多轮历史经原生 messages 传递。顶部首行显示当前小说·章节，切书/切章等变更后由 main.ts 主动刷新（钩子挂在 saveSettings 与状态落盘回调两条必经路径，任何命令的状态变更无需逐处埋点）。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-llm-chat-view.md](./l3-llm-chat-view.md) | LlmChatView 实现细节（源文件职责：@ 引用、系统提示词、模型同步接线） |
| L3 | [l3-view-rendering.md](./l3-view-rendering.md) | 常驻 ItemView 渲染陷阱（onClose 清理、重开重建等） |
| L3 | [l3-summary-pipeline.md](./l3-summary-pipeline.md) | 三层写作上下文结构与上下文窗口（对话系统提示词中当前小说上下文快照的输入源）、notifyContextChanged 广播口径 |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程、main.ts 通用辅助方法（新增接线/handler 时复用） |
