# L2 · 时间线面板

## 模块概要

- **时间线面板 `TimelineView`（v0.2.x+）同属常驻 ItemView 家族**：纯展示只读——构造仅注入快照 getter（main.ts `getTimelineSnapshot()`），无写动作回调；头部＝筛选输入框＋「刷新」按钮（不显示工作目录行与小说列表，未选小说时主体区给引导文案）；主体把各层条目合并为单一按时间点升序的纵向时间轴（`.aw-tl-list` 左边线＋`.aw-tl-item` 圆点），每条＝时间点徽章（md_docs.timelineTimeText，年-月-日规范形式）＋来源层级标签 `.aw-tl-src`＋人物 chips＋事件文本。**事件层级＝标题深度**（`#`=一级、`##`=二级、`###`=三级，最深 ######，三层文档同一规则）：面板按「父＝其前最近一条级别更小的条目」把合并行列表嵌套成轮廓树（buildTree 栈算法，无更小级别前驱者为根），子事件渲染在 `.aw-tl-kids` 容器（再缩进一级＋自己的竖线）；条目带 `lv-<级别>` 类（≥5 归入 lv-5）按级别区分圆点大小/颜色与正文强调——一级最大红点＋加粗正文、二级基准强调色、三级绿点、四级黄点、五级最小灰点＋正文弱化（styles.css `.aw-tl-item.lv-* .aw-tl-dot`）。**圆点为真实元素 `.aw-tl-dot`**（替代旧 `::before` 伪元素）：**鼠标悬停条目任意位置（含圆点）时 Tip 显示该条目的描述内容**（`- 描述：` 的详细描述、可多行；经 Obsidian `setTooltip`（aria-label 驱动自绘 `.tooltip`，类 `aw-tl-tip`，styles.css 覆盖为窄幅小字）呈现——条目与圆点同挂一份，避免小圆点悬停落空回退到别的提示；无描述的条目不挂 Tip；双击定位的提示文字不占 Tip）；有子事件的圆点可点击、切换该条目的折叠状态（collapsedIds Set 记 id、重渲染不清零、切书重置；折叠后条目尾显示「（已折叠 N 条子事件）」提示且跳过子容器）；**双击**条目经 openAt 打开其来源文件并 locateHeading 定位到该时间点标题行（任意深度 ATX 标题、优先条目级别精确匹配退而任意级别同时间点、按解析值比对兼容未补零写法、250ms 重试一次、移动端降级仅打开）；筛选时显示命中条目及其祖先链、忽略折叠状态，汇总行给扁平命中数；有内容但零有效条目的文档在列表下方给可点击提示（openFile helper 打开检查格式）。主体区为画布模式——.aw-st-tree.aw-tl-body **overflow:auto**（touch-action: pan-x pan-y）：**普通滚轮/滚动条/触屏原生滚动**（内容放得下时冒泡滚动页面）、**Ctrl|Shift＋滚轮**才以鼠标位置为不动点缩放 0.4×–3×（passive:false；不动点换算 scroll′=p·z′−m，p=(scroll+m)/z）、左键按住拖动平移＝驱动容器 scrollLeft/scrollTop（document 级 pointermove/up、>3px 记 dragged 并在捕获阶段吃掉拖后 click/dblclick 防误开文档/误切折叠）；内部 .aw-tl-sizer 宽高＝内容×缩放（JS 设置）撑出可滚动范围、.aw-tl-zoom 绝对定位其中（宽度＝视口宽、transform scale origin 左上角），汇总行固定在画布外底部 .aw-tl-sumrow，头部倍率标签 ≠100% 时显示、点击复位（tlZ 重渲染不清零、平移即原生滚动位置天然保持）。空态区分「未选择小说」与「尚无时间线文档」（附三层放置位置、日期格式与 #/##/### 级别提示）。渲染陷阱同族（UI 建进 onOpen 的 contentEl、onClose 置 built=false 以便重开重建；规范原文见 [l3-view-rendering.md](./l3-view-rendering.md)「常驻 ItemView 渲染陷阱」）。样式 `.aw-tl-*`。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-timeline-view.md](./l3-timeline-view.md) | TimelineView 实现细节（源文件职责，含 readTimelineDocs 与接线） |
| L3 | [l3-md-docs-parsing.md](./l3-md-docs-parsing.md) | 《时间线.md》三层条目格式与解析规则、readTimelineDocs 枚举口径 |
| L3 | [l3-state-and-volumes.md](./l3-state-and-volumes.md) | 目录树/卷结构（时间线文档三层放置位置）、rescan 语义 |
| L3 | [l3-view-rendering.md](./l3-view-rendering.md) | 常驻 ItemView 渲染陷阱 |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程、main.ts 通用辅助方法 |
