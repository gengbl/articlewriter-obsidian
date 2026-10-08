# L2 · 人物关系面板

## 模块概要

- **v0.1.9+ `RelationshipView`（人物关系面板）同属常驻 ItemView 家族，v0.2.0+ 头部带「添加人物」**：注入快照 getter + **可选 `onAddCharacter` 写动作**（展示仍只读；切书/切章入口一律留在写字台与命令面板，业务逻辑/弹窗/落盘都在 main.ts，面板只回调不持有业务实现）、UI 建在 onOpen 的 contentEl、onClose 只管 `edgeTipEl.remove()`（tip 挂 document.body）；**头部＝「卡片 / 图表」分段切换按钮 + 筛选框 + 「添加人物」（未选小说时 disabled）+ 「刷新」**（不显示工作目录行与小说列表，未选小说/未设工作目录时在主体区给引导文案）；两种展示方式（`mode`，会话内保持不落盘）共享同一份 `lastSnap`——卡片走 `renderTree`、图表走 `renderGraph`（**纯手写 SVG，不得引入 d3 等图形依赖**），切换与筛选只重渲染主体区而**不重建头部**，避免输入焦点/光标丢失；图表的高亮/布局全本地计算（`buildGraph` 聚合 + 环形布局 + `focusGraph` 邻接高亮；`graphNodeEls`/`graphEdgeEls`/`graphAdj` 每次重渲染重建）。**滚轮缩放 + 拖动平移**（v0.2.0+ 已移除摘要行下方的「缩小 / 放大 / 重置视图」缩放条，缩放只用滚轮）：档位 `GRAPH_ZOOMS`〔0.5/0.75/1/1.25/1.5/2/3〕，`graphZoom` 与 `graphPan`〔屏幕像素偏移〕均会话内保持不落盘，`applyView()` 只写 `svg.style.transform = translate(pan) scale(zoom)`——**布局尺寸不变**（`width:100%`、`height:auto`、`max-height:70vh`），靠 viewBox 让图形与角色名一起等比缩放、不重算布局、不重建 DOM，`transform-origin: center` 令缩放围绕图心；滚轮用 `zoomAt(dir, mxView, myView)`：接 viewport 坐标、内部经 `getBoundingClientRect()` 换算到 svg layout 偏移（与 `ec = clientWidth/2` 同坐标系——早期版本把 viewport 像素与 layout 像素混算，z≠1 时"鼠标不动点"会漂移）后以鼠标位置为不动点反求 pan（公式 `pan' = m - ec - k·(m - pan - ec)`，`k = z'/z`），保证缩放前后**鼠标下的图点屏幕位置不变**；滚轮在 svg 上 `wheel` 监听（`{passive:false}` + `preventDefault` 防冒泡触发主滚动条），`deltaY` 累计 `|>=50|` 时按符号切档（上滑=放大、下滑=缩小，闭包 `wheelAcc` 在切档后清零），已达档位边界时切档早退故累加器不会"卡"；`applyView` 内用 `treeEl.clientWidth/Height` 与 `svg.clientWidth/Height × zoom` 收敛平移量（`clampNum`），**图不会被拖出视野找不回来**。拖动 = svg 上的 `pointerdown` + document 级 `pointermove/pointerup`（拖出面板也跟手，松手即解绑），位移 >3px 记 `dragged` 并在捕获阶段 `stopPropagation` 吃掉随后的 click，避免「拖到一半松手」误打开角色/关系文档（未拖动的单击照常放行）；`.aw-st-tree.is-graph` 改为**裁剪**（`overflow:hidden` + flex 纵向收缩，图例不会被裁到面板外）——**面板不出滚动条**，放大后被裁掉的部分靠拖动查看，故重渲染不再需要保持 `scrollTop/scrollLeft`，空态文案由 `placeholderFor` 两处共用；开合与筛选是纯展示态（`lastSnap` + 本地重渲染，不读盘）；整卡（含图表节点/连线）**双击**打开来源文档（`getLeaf().openFile`；v0.2.0+ 由 click 改 dblclick，单击不触发以免误开）——但图表**单击节点＝选中**：底部固定「人物状态」区显示该角色在《人物.md》的设定信息（层级标签＋「打开文档」＋身份/年龄/性别/性格/外貌/背景/能力/备注字段行、未填项跳过，同名多层登记逐层各一块，《人物.md》无记录时提示用「添加人物」补录；× 清除，`selectedChar` 会话内保持；拖后伪点击被捕获阶段拦截不误选）、选中节点 `.is-sel` 强调描边，分组头右侧「打开文档」仍为单击、须 `stopPropagation` 以免连带触发开合；容器类直接复用 `.aw-status-view` + `.aw-st-top/.aw-st-tree`（字体/滚动布局同写字台），专属样式只用 `.aw-rel-*`，勿另造容器布局样式。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-relationship-view.md](./l3-relationship-view.md) | RelationshipView 实现细节（源文件职责，含数据入口与接线） |
| L3 | [l3-md-docs-parsing.md](./l3-md-docs-parsing.md) | 《人物关系.md》三层条目格式、appendRelationships 写入模板口径 |
| L3 | [l3-state-and-volumes.md](./l3-state-and-volumes.md) | 卷级人物落盘、场景/人物归属字段口径（人物状态区数据层） |
| L3 | [l3-view-rendering.md](./l3-view-rendering.md) | Modal 选型表（AddCharacterModal）、常驻 ItemView 渲染陷阱 |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程、main.ts 通用辅助方法（面板接线/openAddCharacterDialog 复用） |
