# L2 · LLM 写作命令（含「生成过程」面板）

## 模块概要

LLM 写作类命令（`write-chapter`/`continue-writing`/`rewrite-chapter`/`polish-text`/`deai-clean`/`review-chapter`）共用统一流程：prompt 组装在 `src/prompts.ts`，调用层在 `src/llm_client.ts`，结果落盘+场景同步走 `story_manager.ts`；所有生成结果先在统一「生成过程」面板内流式预览并经「保存/不保存」确认才写盘（设计决策见 [l1-overview.md](./l1-overview.md)）。各命令语义/参数/坑位速查见 [command-reference.md](./command-reference.md)；摘要延迟生成管线见 [l3-summary-pipeline.md](./l3-summary-pipeline.md)，新增命令标准流程与 main.ts 辅助方法见 [l3-main-ts-flow.md](./l3-main-ts-flow.md)。

- **「生成过程」面板双阶段复用同一实例**（常驻 ItemView，可停靠任意区域）：①摘要延迟生成日志阶段——每个 LLM 任务追加一行带时间戳日志并自动滚底、本轮结束追加「✓ 摘要就绪」；②章节/报告流式阶段——流式预览正文 + 「保存/不保存」CTA。Esc 或「停止生成」＝abort 当前会话；关面板未决会话按放弃收尾；重试前清屏。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-writing-commands-impl.md](./l3-writing-commands-impl.md) | 生成过程面板与提示词组装实现细节（gen_progress_view / prompts.ts） |
| L3 | [l3-summary-pipeline.md](./l3-summary-pipeline.md) | 摘要延迟生成管线、三层写作上下文结构（buildWritingContext） |
| L3 | [l3-guide-lifecycle.md](./l3-guide-lifecycle.md) | 创作规范工具（buildEmptyGuideTemplate/serializeAggregateGuide/aggHash） |
| L3 | [l3-view-rendering.md](./l3-view-rendering.md) | 「生成过程」面板渲染陷阱（WritingStreamSink、onClose 收尾未决会话） |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程、main.ts 通用辅助方法 |
| L2 | [command-reference.md](./command-reference.md) | 各命令语义/参数/坑位速查 |
