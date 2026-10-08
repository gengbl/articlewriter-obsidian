# L2 · 时间线面板

## 模块概要

- **时间线面板 `TimelineView`（v0.2.x+）同属常驻 ItemView 家族**：纯展示只读——构造仅注入快照 getter（main.ts `getTimelineSnapshot()`），无写动作回调；头部＝筛选输入框＋「刷新」按钮（不显示工作目录行与小说列表，未选小说时主体区给引导文案）；主体把各层条目合并为单一按时间点升序的纵向时间轴（`.aw-tl-list` 左边线＋`.aw-tl-item` 圆点），每条＝时间点徽章（md_docs.timelineTimeText，年-月-日规范形式）＋来源层级标签 `.aw-tl-src`＋人物 chips＋事件文本；条目带 `is-<scope>` 类按来源层级区分重要性（书 > 卷 > 章）：书籍级节点圆点最大＋正文加粗、卷级基准样式、章级节点最小＋正文弱化（styles.css `.aw-tl-item.is-*`）；**双击**条目经 openAt 打开其来源文件并 locateHeading 定位到该时间点的 `##` 标题行（按解析值比对兼容未补零写法、250ms 重试一次、移动端降级仅打开）；有内容但零有效条目的文档在列表下方给可点击提示（openFile helper 打开检查格式）；主体区为画布模式——.aw-st-tree.aw-tl-body overflow:hidden＋内部 .aw-tl-zoom 内联 transform（origin 左上角），滚轮以鼠标位置为不动点缩放 0.4×–3×（passive:false 拦冒泡）、左键按住拖动平移（document 级 pointermove/up、>3px 记 dragged 并在捕获阶段吃掉拖后 click/dblclick 防误开文档），汇总行固定在画布外底部 .aw-tl-sumrow，头部倍率标签 ≠100% 时显示、点击复位（tlZ/tlX/tlY 状态重渲染不清零）。空态区分「未选择小说」与「尚无时间线文档」（附三层放置位置与日期格式提示）。渲染陷阱同族（UI 建进 onOpen 的 contentEl、onClose 置 built=false 以便重开重建；规范原文见 [l3-view-rendering.md](./l3-view-rendering.md)「常驻 ItemView 渲染陷阱」）。样式 `.aw-tl-*`。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-timeline-view.md](./l3-timeline-view.md) | TimelineView 实现细节（源文件职责，含 readTimelineDocs 与接线） |
| L3 | [l3-md-docs-parsing.md](./l3-md-docs-parsing.md) | 《时间线.md》三层条目格式与解析规则、readTimelineDocs 枚举口径 |
| L3 | [l3-state-and-volumes.md](./l3-state-and-volumes.md) | 目录树/卷结构（时间线文档三层放置位置）、rescan 语义 |
| L3 | [l3-view-rendering.md](./l3-view-rendering.md) | 常驻 ItemView 渲染陷阱 |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程、main.ts 通用辅助方法 |
