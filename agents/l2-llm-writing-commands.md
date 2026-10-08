# L2 · LLM 写作命令（含「生成过程」面板）

## 模块概要

LLM 写作类命令（`write-chapter`/`continue-writing`/`rewrite-chapter`/`polish-text`/`deai-clean`/`review-chapter`）共用统一流程：prompt 组装在 `src/prompts.ts`，调用层在 `src/llm_client.ts`，结果落盘+场景同步走 `story_manager.ts`；所有生成结果先在统一「生成过程」面板内流式预览并经「保存/不保存」确认才写盘（设计决策见 [l1-overview.md](./l1-overview.md)）。各命令语义/参数/坑位速查见 [command-reference.md](./command-reference.md)；摘要延迟生成管线见 [l3-summary-pipeline.md](./l3-summary-pipeline.md)，新增命令标准流程与 main.ts 辅助方法见 [l3-main-ts-flow.md](./l3-main-ts-flow.md)。

## 相关源文件

| 文件 | 职责 |
| --- | --- |
| `src/gen_progress_view.ts` | **统一生成过程面板**（v0.1.4+，自定义 ItemView「生成过程」，可停靠任意区域、重载保留位置）。双阶段复用同一实例：**①摘要延迟生成日志阶段**——由 main.ts notifyGenProgress 驱动：startRun 清空旧内容写轮次分隔行（时间+书名）、appendLine 每个 LLM 任务追加一行带时间戳日志并自动滚底（step 普通步骤 / ok 完成行 / div 分隔行原样显示）、finishRun 本轮结束追加「✓ 摘要就绪」；**②章节/报告流式阶段**——beginStream(title) 进入（移除上轮流式小节元素、日志行保留为历史），实现导出接口 **WritingStreamSink**（signal/fullText/done + append/reset/setStatus/finish(保存·不保存 CTA)/fail）——原独立 StreamingPreviewModal 的全部语义并入此处（Esc 或「停止生成」=abort 且 done→false、关面板未决会话按放弃收尾 resolve(false)、重试前 reset 清屏）；纯展示视图无构造注入数据。渲染陷阱见 [l3-view-rendering.md](./l3-view-rendering.md)「常驻 ItemView 渲染陷阱」（本地 patch dts 要求 onClose 为 async Promise<void>——onClose 里先收尾未决流式会话再置 built=false 以便重开重建）。样式 styles.css `.aw-gen-*` 类（`.aw-stream-pre` 供流式正文换行复用） |
| `src/prompts.ts`（写作命令部分） | **纯函数·提示词组装**（src/prompts.ts 节选）：各 LLM 命令的系统/用户提示词拼装——大纲标记 OUTLINE_MARKERS、编写类型块+禁用词的 buildStoryTypeSystemPrompt、章节/续写/重写/审阅/润色/去AI味各自的 prompt builder；三层书/卷/章写作上下文 buildWritingContext 与摘要相关 prompt（buildVolRebuildPrompt/buildChapterSummaryPrompt）见 [l3-summary-pipeline.md](./l3-summary-pipeline.md)，创作规范工具（buildEmptyGuideTemplate/serializeAggregateGuide/AGG_TITLE/aggHash）见 [l3-guide-lifecycle.md](./l3-guide-lifecycle.md) |

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-summary-pipeline.md](./l3-summary-pipeline.md) | 摘要延迟生成管线、三层写作上下文结构（buildWritingContext） |
| L3 | [l3-guide-lifecycle.md](./l3-guide-lifecycle.md) | 创作规范工具（buildEmptyGuideTemplate/serializeAggregateGuide/aggHash） |
| L3 | [l3-view-rendering.md](./l3-view-rendering.md) | 「生成过程」面板渲染陷阱（WritingStreamSink、onClose 收尾未决会话） |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程、main.ts 通用辅助方法 |
| L2 | [command-reference.md](./command-reference.md) | 各命令语义/参数/坑位速查 |
