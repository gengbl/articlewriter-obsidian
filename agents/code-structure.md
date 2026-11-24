# 代码结构总览（横切参考）

本文是**源码物理结构**的横切地图：构建产物链、`src/` 各模块职责与行数、模块依赖分层、`src/main.ts` 内部区块定位、根目录遗留文件、已知重复与债务。功能语义与行为约定不在这里，按 [l1-overview.md](./l1-overview.md) 功能路由进 L2/L3。行号以 prompt_files 装配重构后的工作树为基准（`0fcf4c9` 之后），改动大文件后就近修订。

## 构建与产物链

```
src/main.ts ──esbuild(bundle)──▶ release/main.js ──非生产构建再拷──▶ dist/main.js
                 ▲ tsc -noEmit 先行门禁（npm run build = tsc + esbuild --production）
```

- **唯一入口 `src/main.ts`**；`tsconfig.json` include 仅 `src/**/*.ts`——根目录遗留 `.ts` 不参与编译（见「根目录遗留文件」）。
- `esbuild.config.mjs`：`bundle:true`、`format:cjs`、`target:es2018`（iOS Safari <16.4 约束，**正则不得用 lookbehind 断言**）、`external` = obsidian / electron / @codemirror/* / @lezer/* / node 内置模块；`loader: {".md":"text", ".png":"dataurl"}` 把 `docs/使用说明.md` 等文档以纯文本内联进包、`docs/wechat_qr.png`（作者微信二维码）以 base64 dataurl 内联（首启运行时播种，见 `src/*_default.ts`；二维码由 `usage_guide_default.ts` 替换 md 里的 `{{WECHAT_QR}}` 占位符）。
- `release/` = 可分发目录（**gitignore**）：构建后自动拷入 `manifest.json`、`styles.css`；`dist/` 同步一份 `main.js` 供社区目录校验器（同样 gitignore）。v0.3.5+：写作指南体系整体废弃，根 `WRITING_GUIDE.md`/`docs/WRITING_GUIDE_template.md`/`docs/guide-types/` 已从仓库删除、对应 import 同步移除。
- 门禁：`npm run build`（tsc 零错误）+ `npm run lint`（eslint 仅四类 `no-unsafe-*` 为 error，见 eslint.config.mjs）；另有 advisory 扫描 `npm run lint:obsidianmd`（eslint-plugin-obsidianmd recommended，配置 `eslint.obsidianmd.mjs`，约定见 process-rules.md「验证要求」）；`npm test` 用 esbuild 把 `package.json` 里 entries 列出的全部 `src/*.test.ts`（现 27 个）打包成 mjs 交 `node --test`——**新增测试文件必须同时加进 entries**，否则不会被执行。
- 约定：`src/` 不用超出 lib ES2018 的 API（flatMap/trimEnd/matchAll 均被 lint 拦），详见 [process-rules.md](./process-rules.md)「验证要求」。

## `src/` 模块职责表（行数为当前值）

| 模块 | 行 | 职责 | 关键导出 |
| --- | --- | --- | --- |
| `main.ts` | 11200 | 插件入口＋全部命令实现＋面板装配＋设置页（内部区块见下节；v0.4.9+ 场景新增的 `sceneScopeChoices`＝级别候选与各级《场景.md》路径解析；「所在位置」文案改用 md_docs 的 `docLocationLabel`（三面板共用，自带的那份已删）；人物侧新增 `characterScopeChoices`＝人物级别候选唯一口径（书籍级→卷级→章级）＋`characterScopeIdFor`/`scopeMovePatch`/`openEditCharacterDialog`/`deleteCharacterByName`/`renameCharacterTo`） | `default ArticleWriterPlugin`；v0.4.11+ 新增 `openMergeCharacterFlow`（合并人物唯一实现，面板右键／管理人员／命令 `character-merge` 三入口共用）＋`cmdCharacterMerge`，`characterScopeChoices` 的候选加 `path`＝该层《人物.md》物理路径|
| `story_manager.ts` | 4146 | 磁盘结构层：书/卷/章实体目录与文档的 CRUD、状态文档、章节重排顺延（号码算术调 `chapter_moves.ts`）、打包合集（跨容器选择连续重编号）、扫描重建 | `StoryManager`、`CHAPTER_SUFFIX_TO_BASE`、`WritingDocPaths`、章节/卷读写全套、`writeDoc`（v0.4.6+ public）；v0.4.11+ `mergeCharacter`（多份《人物.md》同名条目合并＝块级手术只动目标块＋先备份 `_backup/人物合并_<ts>/`）、私有 `backupStamp()`（改名/合并共用时间戳）、`loadCharacterEntries` 补打 `vol` 标签|
| `chapter_moves.ts` | 55 | 章节重排**纯决策层**（v0.4.6+ C10，无 obsidian 依赖）：`planRenumber`（容器内补洞压缩 1..N，升序单遍只挪变号章）、`hasAnyGap`（断档判定）、`planInsert`（插章冲突→降序顺延规划）；搬移/快照/引用重写仍在 story_manager，执行序必须与 plan 一致 | `planRenumber`、`hasAnyGap`、`planInsert` |
| `prompts.ts` | 1763 | 各生成阶段提示词组装（纯函数，不触 Vault/LLM）：编写章节、大纲族、策划指南、人物分析、deai/查重/错字等；上下文入参收 `bookDocs/volDocs/chapterDocs` 预装配文档串 | `build*Prompt`、各 `*_SYSTEM_PROMPT`、`CleanReport`、`cleanRelationshipsDoc` |
| `md_docs.ts` | 2022 | MD 文本解析/序列化：人物/场景/关系/伏笔/世界观字段级 parse↔format、章选解析、拆分卷大纲；v0.4.7+ 场景**块级写回**（`insert/update/deleteSceneBlock`、`rewriteScenePosition`、v0.4.8+ `renameSceneBlock/renameSceneRefs` 改名＋引用同步，注释掩码＋`## <scene_id>` 定位，详见 [l3-scene-view.md](./l3-scene-view.md)） | `CharacterDoc/SceneDoc/…`（SceneDoc v0.4.7+ 增 `x?/y?/parent?/related?`）、`parse*/format*`、`SceneBlockInput/SceneBlockEdit`、`splitVolOutlineByChapter`（v0.4.3+ 同族 `sliceVolOutlineChapters`：按章号窗口取块，供编写文章阶段前后 N 章大纲节选）、**v0.4.9+「级别／所在位置」三面板共用口径**＝`DOC_SCOPE_WORDS`／`docRelPath`／`docLocationLabel(scope, path, bookDir, words?)`（原 `TIMELINE_SCOPE_WORDS`/`timelineLocationLabel` 与 main.ts 的 `SCENE_SCOPE_WORDS`/`sceneLocationLabel` 全部合并到这一份）；v0.4.11+ 人物**块级手术**（`upsertCharacterBlock`／`deleteCharacterBlock`，与场景块同一定位口径）＋合并纯函数（`CHARACTER_FIELDS`／`characterFieldValue`／`applyCharacterMerge`＋`CHARACTER_MERGE_ALL`/`_EMPTY`）|
| `modals.ts` | 2631 | 通用弹窗库（31 个导出 Modal/SuggestModal，含 v0.4.3+ `InspirationKitModal` 灵感工具包弹窗、v0.4.7+ `AwGuideModal` 通用引导弹窗＝h3＋`.aw-prompt-hint` 多行＋动作按钮组（启动无书引导用它）、v0.4.7+ `SessionPickerModal` 对话历史选择器（SuggestModal，label＋sub 两行）、v0.4.7+ `SceneEditModal` 场景新建/编辑弹窗（v0.4.9+ 弹窗最上方「级别」下拉＝新建写进书级/卷级/章级哪层《场景.md》（选项只有这三词、默认卷级、不带说明文字）；编辑态该行只读＝值＝场景所在位置；**v0.4.9+ 起父场景排在场景名上面**）、v0.4.9+ `CharacterEditModal` 人物编辑弹窗（＝人物级别可换层＋姓名（改名）＋8 设定字段；`AddCharacterModal` 也新增 `defaultScopeId` 参＝级别下拉按书籍级→卷级→章级排、默认项不再顶到最前） | `TextInputModal`、`ActionMenuModal`、`TextPanelModal`、`ConfirmModal`、`InspirationKitModal`、`AwGuideModal`、`SessionPickerModal`、`SceneEditModal`…、v0.4.11+ `MergeCharacterModal`（合并人物＝最终存储文档下拉＋逐字段取值下拉＋条目预览；`CharacterScopeOption` 加 `path?`）|
| `relationship_view.ts` | 1225 | 人物关系面板（ItemView，SVG 图＋列表；v0.4.4+ 图表的节点坐标、分级与弧线 path 不再就地算，改调 `graph_layout.ts`；v0.4.8+ 图中心＝`graphCenter` 会话态＋默认中心＝《人物.md》标「主角/主人公」者→`forceLayout centerName`，**v0.4.9+ 改由右键菜单「设为中心人物」驱动**；v0.4.9+ **人物右键菜单 `openCharMenu`（三处挂载，顺序＝编辑→改名→打开来源文档→设为中心人物→新增→删除恒排最后）＋双击人物＝只弹编辑弹窗（`editChar`；单击选中压 220ms 由 `pickCharLater`/`cancelCharPick` 让路）**，导出 `REL_SCOPE_WORDS`、快照带 `storyDir`） | `RelationshipView`、`RelSnapshot`；v0.4.11+ 人物菜单「合并 N 处登记」（`charEntryCount`>1 才挂）＋状态区头部「合并」链接＋状态区恒定高度/多文档逐条展开项/可拖分隔条＋**图面平移无限位（双击空白复位）／图表上方不再有 `aw-rel-summary` 统计行／名字文字与圆点同一命中体（`pointer-events` 放开）＋**节点与连线共用同一份自定义 tip 浮层**（图面**不挂任何 SVG `<title>`**＝不会多出一条原生长条提示；节点 tip 正文＝《人物.md》设定字段，取数走 `charInfoFields`＝与状态区同一口径，右键即收起）＋**滚轮缩放的鼠标不动点公式已修正**（`zoomTo()` 内按 `translate(pan) scale(z)` 反解鼠标下的内容点）＋**滚轮每次事件独立换算倍率（删掉 `GRAPH_ZOOMS` 档位表，改用时间线同一套 `exp(-deltaY×0.0015)`＋`PANEL_ZOOM_MIN/MAX`）／**图面画布化重写＝缩放平移整体复用 `CanvasPanel`（`parentBodyEl` 复用主体、`graphBoxSize()` 让图尺寸＝画布可视区 viewBox 1:1、`setContentWidth` 撑横向范围、`resetGraphView()→resetView()`、`attachZoomLabel` 倍率标签、`panIgnoreSelector` 排除状态区）＝面板内不再自写 transform/滚轮数学／**`clearBodyKeepingCanvas()`（v0.4.11+ 事故修正＝清主体只清 zoomEl 图内容、绝不销毁常驻画布视口 `.aw-rel-canvasbody`；同轮画布视口从 `parentBodyEl` 复用 treeEl 改为独立弹性项＝缩放只动图、下面图例行与「人物状态」区不动；再同轮修「适应全图后一直闪」＝`lastGraphBoxW`＋`GRAPH_RELAYOUT_MIN_DX=20` 重排阈值门卫，见 [l3-relationship-view.md](./l3-relationship-view.md) ⑫⑬⑭）** |
| `status_view.ts` | 806 | 「写字台」面板（ItemView，书/卷/章树＋动作分发；v0.4.3+ 案头资料右键「灵感工具包…」） | `StatusView`、`StatusAction`、`StatusSnapshot` |
| `timeline_view.ts` | 1257 | 时间线面板（ItemView；定位到文档行改走共用件 `editor_nav.revealEditorLine`；v0.4.9+ 快照带 `docs: TlDocRef[]`＋`storyDir`＝弹窗「级别」下拉的候选与书内路径前缀，`levelChoices`／`locationOf`＝选文档与「所在位置」文案；**v0.4.9+ 唯一渲染＝树挂分支**（`buildTlRoots`＋`renderTlTree`/`renderTlLevel` 递归＋动态列距/固定卡片宽、`tlTimeCmp` 比较器、逐层复原 `tlPrevMs`；显示方式下拉与 line 扁平趟已删；v0.4.11+ 另有「改时间点闸门」＝桌面按住 Ctrl/⌘ 才可拖卡片、手机长按时间徽章把卡片「抓住」后再拖＝防随意拖动），细节见 [l3-timeline-view.md](./l3-timeline-view.md)「树挂分支视图」节） | `TimelineView`、`TlSnapshot`、`TlDocRef` |
| `timeline_lanes.ts` | 58 | 时间线「子时间线轨道」的**横向通道分配纯函数**（v0.4.11+，无 DOM/Obsidian 依赖）：按先序（父先于子）给每个有子事件的父事件挑一条 X 通道＝基准「父轨道 X（一级＝主轴）＋列距」，与已放置轨道同 X 且纵向区间重叠（含 vgap 缓冲）就再右移一个列距、guard 32；调用方＝`timeline_view.layoutTlLanes`（实测行块 `offsetTop/offsetHeight` 后传入），单测＝`timeline_lanes.test.ts` | `assignTlLaneXs`、`TlLaneInterval` |
| `scene_view.ts` | 1009 | 场景面板（ItemView，v0.4.7+：书/卷/章三层《场景.md》**卡片画布**（CanvasPanel 缩放/平移＋**整组**卡片拖动位置＋包含框衬底＋父子树嵌套自动布局＋v0.4.8+ 坐标网格衬底与**左上角**罗盘徽章＋v0.4.9+ **画布空白处右键菜单**＝在此添加场景/适应全图/刷新＋**首次打开自动适应全图**（`needsFit`/`fitAll`）＋**缩放以鼠标所在位置为中心**（`zoomAtPointView` 虚拟偏移口径）＋**有子场景的父场景＝区域头卡片（`.is-region`＋「N 个子场景」，名字与详情仍在卡片内）摆到包含框左上角＝v0.4.9+ 口径＝区域先由全部子场景算出、卡片的新位置随后由 `regionFor` 派生（＝父卡片旧坐标不参与区域计算），父子之间不再画线**）＋**v0.4.9+ 拖动子场景时被区域口径顺带搬走的大场景卡片也一并写回它的 `- 位置：`**（按下时快照各区域头此刻坐标，收尾只写本次真挪过的那些，嵌套区域逐层各自写回）、增删改、包含框（只给真有 `- 父场景：` 关系且有可见子场景的父行画框）；**关联连线路径不在本文件算**＝调 `scene_geometry.ts`（v0.4.9+ 折线）；见 [l2-scene-panel.md](./l2-scene-panel.md)/[l3-scene-view.md](./l3-scene-view.md)） | `SceneView`、`SceneSnapshot`、`SceneRow`、`sceneDisplayName` |
| `scene_geometry.ts` | 236 | 场景画布**几何纯函数**（v0.4.9+ 自 scene_view 抽出，无 DOM、node 可测）＝连线折径＋**区域口径（先子场景后区域头）**：`relEdgePathD`（关联＝**直角折线**，只走水平段＋垂直段，拐点取两卡之间至少外扩 12px，同轴退化成直线段，方向按几何不按调用序；**端点矩形由调用方给**＝v0.4.9+ 有子场景的场景传**包含框**，一端完整落在另一端内部＝私有 `containsBox`＋`containmentRoute` 走最短正交一段接到外框边界）、`polylineMidpoint`（按段长取半＝折线版取中点，给连线上的联通性说明定位核验）、`ScBox`；**原父子连线的 `edgePathD` 已下线删除**（v0.4.9+ 父子不再画线＝包含框＋区域标签）；另导出 **`regionFor(head, kids, gap, pad)`**＋**`regionHeadFor(head, kidsBox, gap)`**（v0.4.9+ 用户要求＝顺序不能反＝① 全部子场景包围盒 ② 派生区域头＝`x＝kids.minX`、`y＝kids.minY−h−gap`（**不吃父卡片旧坐标**）③ 区域矩形＝二者合并包围盒＋外扩；**旧 `regionAnchorFor` 已删除**）、**`autoSlotUsable(slot, est, vp, occupied, pad)`**（自动布局落点整块在视口内且不与旧卡相交＝可用）与 **`freeAnchorFor(point, occupied, step, tries)`**（视口左上角落点被卡片占住＝按阶梯往右下避让）（v0.4.9+ ＝`regionFor` 第③步复用它，成员＝全部子场景＋派生后的区域头；＝「大场景的名字在区域左上角」的实现方式，名字本身仍在卡片里）与 **`frameBoxFor(members, pad)`**（v0.4.9+ **区域尺寸唯一口径**＝成员当前包围盒四边外扩 pad＝子场景挪动后区域高宽跟着变，绝不用旧尺寸）；见 [l3-scene-view.md](./l3-scene-view.md) | `relEdgePathD`、`frameRectFor`、`polylineMidpoint`、`ScBox` |
| `panel_canvas.ts` | 384 | 面板画布共用设施（v0.4.11+ 第四轮＝`apply()` 里 sizer 宽高取整改 **`Math.floor`**＝视口宽度是小数时贴边（100%）绝不误出滚动条＝修「适应全图后一直闪」的反馈环，见 [l3-relationship-view.md](./l3-relationship-view.md) ⑭）（v0.4.9+ 换算唯一口径 **`viewPointToContent`**＝`(scroll + 视口内偏移 − pan)/z`，`toContentPoint`（右键落点）与 `viewPoint`（视口内偏移＝新建落点）共用）（v0.3.1+，自 timeline_view 抽出）：body/sizer/**pan（虚拟平移层）**/zoom 四层＋Ctrl\|Shift 滚轮**以鼠标所在位置为中心**缩放（纯函数 `zoomAtPointView`＝虚拟偏移 `v＝pan−scroll`、`v′＝m−p·z′`，滚动钳位后差额交平移层补差）＋空白处平移＝**滚动余量＋panEl translate 混合平移**（无滚动余量也能挪视野；**余量口径＝`sizer − 视口宽`＝私有 `maxScrollX/Y()` 三处共用，v0.4.9+ 修正**，原写 `sizer − 内容布局宽`＝场景画布 z=1 也滚不动）＋Alt＋左键/中键任意位置平移＋倍率标签（点击复位＝倍率＋虚拟平移＋滚动）＋ResizeObserver 尺寸自适应＋suppressClicks＋`setContentWidth`（v0.4.7+ 绝对定位内容横向撑出可平移范围）＋**`toContentPoint(clientX,clientY)`（v0.4.9+：屏幕点→内容坐标＝p=(scroll+m−pan)/z）**＋**适应全图＝纯函数 `fitZoomTo(rect,vw,vh,pad,lo,hi)`（上限 100%＝只缩小不放大）＋实例方法 `fitToRect`**；时间线/场景面板共用。**v0.4.9+ 尺寸跟随的唯一口径**＝导出 **`watchElementSize(el, onSize)`**（ResizeObserver＋**120ms 防抖**＋首帧 0 宽/0 高不回调＋回调里给出 `widthChanged`＝宽度真变化才重排内容、纯高度变化只重算尺寸与限位；返回 `{dispose, notify}`＝`dispose` 关面板时必须调、`notify`＝`ItemView.onResize` 的兜底入口，也＝无 ResizeObserver 环境里唯一触发路径）；`CanvasPanel` 内部用它并对外暴露 **`notifyResize()`**；**人物关系面板的图面观察自己的画布视口 `.aw-rel-canvasbody`**（此前完全没有尺寸观察＝窗口变化后图面平移限位停留在旧视口） | `CanvasPanel`、`CanvasPanelOptions`、`fitZoomTo`、`zoomAtPointView`、`watchElementSize`、`ElementSizeWatcher`、`PANEL_ZOOM_MIN`/`PANEL_ZOOM_MAX`（v0.4.11+ 连人物关系面板的图面缩放也引用这一对常量）、`CanvasPanelOptions.parentBodyEl`（复用视图既有元素当画布容器）／`panIgnoreSelector`（固定子项不起平移/缩放手势）／`onPanStart`/`onPanEnd(moved)`／公开 `resetView()`／`zoomLblHost`（同一头部重复 attach 倍率标签只刷新不新建） |
| `story_types.ts` | 557 | 题材指南选取、大纲详略标记、MD5（摘要过期检测）、AI 词标记剥离 | `getStoryTypeGuide`、`md5`、`stripAiWordMarks` |
| `cast_analyzer.ts` | 516 | `analyze-cast` 纯逻辑：逐章 JSON 聚合、span 定层、同名合并 | 聚合/定层函数 |
| `outline_cast.ts` | ~290 | 大纲阶段人物/关系增量分层（v0.4.3+）：附录要求/拆分、`OutlineCastTracker` 逐章定层与增量写盘计划 | `OutlineCastTracker`、`splitOutlineCastAppendix`、`outlineCastAppendixInstruction` |
| `graph_layout.ts` | 442 | 人物关系图（图表模式）纯几何＋纯排序（v0.4.4+，无 DOM/无 vault）：`nodeRadius`/`labelFontSize`（按连线数分级）、`hubOf`（连线最多者＝枢纽）、`adjacencyMap`、`chainOrder`（贪心邻接链、旋转到生效枢纽居首，可传 `centerName`）、`forceLayout`（**默认布局**：退火式力导向→硬碰撞消解→以枢纽为锚点两轴摊满画布→枢纽挪回锚点（`alignShift`）→逐点夹进画布；`hubUp` 即「把主角向上提」；v0.4.8+ `centerName`＝指定中心人物→钉**画布正中**、忽略 hubUp）、`ringLayout(count,cx,cy,rx,ry,degrees)`（椭圆环，留作对照）、`edgeCurvePath(a,b)` 出 SVG path `d`＝**向上拱的二次贝塞尔弧**（控制点＝弦两法向里朝上（−y）的一支，凸出量夹 [12,50]＝弦长·0.18，并按上边界再夹 `bow ≤ 2·(my−TOP_PAD)`；端点按节点半径裁到圆周外并按对方圆周收口；竖直弦固定向右拱）、`curvePoint(d,t)` 弧上取点 | `forceLayout`、`edgeCurvePath`、`chainOrder`、`adjacencyMap`、`nodeRadius`、`labelFontSize` |
| `llm_chat_view.ts` | 1105 | 聊天面板（ItemView，流式、工具注入；v0.4.7+ 双轨历史＋固定会话文件《当前对话.md》＋历史选择器＋截断自动续写＋碎片三级链＋压缩防抖＋闲聊闸门） | `LlmChatView` |
| `chat_intent.ts` | 32 | 对话面板「这条消息算不算纯闲聊」纯判定（v0.4.7+，无 IO）：问候套话整句正则、承认短句放行、动作意图词宽松匹配＋短句长度阈值 | `isPureChatter`、`CHATTER_MAX_CHARS` |
| `chat_tools.ts` | 306 | 对话工具登记表（21 个）＋`parseToolArgs`；v0.4.7+ 工具名/参数容错：`TOOL_NAME_ALIASES`/`resolveToolName`（串名改派）、`nearestToolNames`/`unknownToolHint`（纠正型 tool 结果）、`pickStringArg`/`pickNumberArg`/`normalizeDocName`＋`*_ARG_KEYS` | `CHAT_TOOLS`、`CHAT_TOOLS_PAYLOAD`、`resolveToolName`、`unknownToolHint`、`normalizeDocName` |
| `err.ts` | 5 | 错误对象→可读文本的共用件（v0.4.7+ 提取自聊天面板的 `e instanceof Error ? e.message : String(e)`，Notice/状态行统一用） | `errMsg` |
| `chat_session.ts` | 213 | 会话持久化/压缩纯模块（v0.4.6+）：`formatSession`/`parseSession` 往返、压缩窗口切分与提示词、token 估算与窗口识别；v0.4.7+ `LIVE_SESSION_NAME`/`SESSION_ARCHIVE_PREFIX`/`archiveSessionName` 固定文件与归档名、`AUTO_COMPRESS_HYSTERESIS_PCT`/`autoCompressMinGain` 自动压缩防抖 | `formatSession`、`parseSession`、`shouldAutoCompress`、`LIVE_SESSION_NAME`、`autoCompressMinGain` |
| `banned_words.ts` | 291 | 禁用词清单解析（唯一事实源＝`SKILLS/网文高频禁用词清单.md`，v0.3.6+ Skill 化）、句式简化、AI 词检测标红（纯函数） | `BannedWordsData`、`findAiWordHits`（~~`buildBannedWordsBlock`/`buildMergedBannedBlock`~~ 专用注入函数已随 v0.3.6+ 禁用词 Skill 化删除、~~`stripGuideCategoryBlock`~~ 曾用于剥指南「禁用词」类目，已随 v0.3.5+ 写作指南体系整体废弃删除） |
| `llm_client.ts` | 382 | OpenAI 兼容 chat/completions 封装（流式/非流式、错误装饰、前缀缓存读数） | `chatCompletion`、`chatStream`、`readCacheStats`/`cacheStatsText`、`LlmConfigDoc` 消费 |
| `prompts.test.ts` 等 27 个 `*.test.ts` | 291 起 | 纯函数单测（node --test，`npm test` 的 entries 列表在 package.json；测试打包 buildSync 也须带 `loader {'.md':'text','.png':'dataurl'}`＝`usage_guide_default.test.ts` 会 import 内置 md＋二维码 png）；v0.4.3+ 新增 `llm_client.test.ts`（缓存读数口径）、`cast_analyzer.test.ts`（逐章分析钉点落点）、`deai_ledger.test.ts`（AI 味清单渲染与状态回填）、`inspiration.test.ts`（灵感文档解析↔渲染/按行增删往返、CRLF 保住换行风格）；v0.4.4+ 新增 `graph_layout.test.ts`（力导向确定性／点全落在画布内／枢纽居首且摆到中心偏上／圆点互不重叠／弧一律向上拱且不越顶边／端点裁到圆周外与两圆重叠时不推过头／交换端点侧向一致；v0.4.8+ 加 centerName 改居中：链序居首／名字不在点集回退度数枢纽／中心钉画布正中且原枢纽让位）；v0.4.6+ 新增 `chapter_moves.test.ts`（补洞升序单遍／插章降序顺延／断档判定）；v0.4.7+ 新增 `scene_docs.test.ts`（场景块级解析/写回，现 17 条，含 v0.4.9+ 联通性说明 `relatedNotes` 覆盖/清空与 `sanitizeSceneRelNote` 往返，见 [l3-scene-view.md](./l3-scene-view.md)）；v0.4.9+ 新增 `scene_geometry.test.ts`（现 26 条：折线**不得出现曲线命令**、连接边按几何就近选边、拐点不塞进卡片内（间隙 1px 也按最小 12px 外扩）、同轴退化直线、关联线反序调用同一形状、`polylineMidpoint` 半长点位；**父子连线的 `edgePathD` 用例已随该函数下线删除**；`regionHeadFor` 3 条＝区域头与子场景左对齐＋排在子场景上方 gap 处／平移全部子场景＝区域头同步平移／异常输入＝null；`regionFor` 4 条＝左/右/下三边只由子场景决定＋顶边为区域头让行／子场景挪远＝区域宽高跟着长而区域头按新包围盒重排／子场景拖到最上最左＝区域整体让位／区域头更宽＝只有右边让路；`frameBoxFor` 4 条＝四边外扩且成员恒在框内／**子场景下移＝区域高度变大**／成员上移变矮＝区域跟着缩／空成员与 NaN 成员＝null 或跳过；`autoSlotUsable` 4 条＝视口内且不相交＝可用／越任一边界不可用（pad 贴边不算看见）／矩形相交即不可用（贴边不算交）／NaN 不可用；`freeAnchorFor` 2 条＝空闲原样＋被占按阶梯级联右下（一级不够继续避、tries 用尽不落回原处））；v0.4.9+ 新增 `panel_canvas.test.ts`（11 条：`fitZoomTo` 适应全图＝缩小包住＋四边居中/100% 不放大/夹下限/尺寸异常返回 null/与 `toContentPoint` 口径互逆；`zoomAtPointView` 以鼠标为中心缩放＝锚点不动、**已滚过再缩放不偏（漏算 scroll 的回归用例）**、无余量交平移层补差、越界钳 0/max、连滚多档不漂；`viewPointToContent` 视口内偏移→内容坐标＝÷倍率＋滚动/平移补偿＋zoom≤0 兜底按 1）；**v0.4.9+ 新增 `outline_tree.test.ts`**（轮廓树挂父口径＝父＝其前最近一条级别更小者／跳级仍挂最近更浅级／开头就是深层级则按根、`countSubtree` 含自身、**`subtreeHas` 三种命中口径**＝自身／最深层后代／整支不命中＝时间线树挂视图筛选剪枝的依据）。v0.4.11+ 新增 `timeline_lanes.test.ts`（8 条＝时间线子轨道的**通道分配**纯函数：一级事件轨道＝主轴＋列距／时间不重叠复用同一条通道／纵向重叠各占一条／`vgap` 紧松两个边界／更深一层以父轨道 X 递推／三条互叠依次右移／局部性（先占的窄通道不把后来者无限右推）／空输入＝空映射）。**新增测试文件必须同时加进 package.json 的 entries** | — |
| `gen_progress_view.ts` | 279 | 统一「生成过程」流式面板 | `GenProgressView`（implements `WritingStreamSink`） |
| `state_doc.ts` | 404 | `状态.md` 文档 ↔ `StoryState` 序列化/解析、`chKey` 复合键 | `formatStateDoc/parseStateDoc`、`chKey/parseChKey`、**`findChapterByStateKey`（v0.4.9+：`current_chapter` 复合键→章节清单定位，精确键→章号兜底、带卷前缀要求同卷；「新建场景 · 级别」的「章级」候选用）** |
| `inspiration.ts` | 203 | 灵感工具包（v0.4.3+）：书级《案头资料/灵感/灵感.md》**纯数据结构＋纯解析/渲染＋按行增删**（无 IO、不 import obsidian）：`InspirationBlock{heading,name,date,body,line,endLine}`、`parseInspirationDoc`（只按 `##` 切块、`###` 属块内）、`renderInspirationBody/Block`（模板→块：丢 H1 与注释、`#`/`##` 降为 `###`、替换 `{{name}}/{{date}}/{{time}}`）、`append/remove/renameInspirationBlock`、`inspirationPreview/inspirationMatches`、`normalizeInspirationName`、`inspirationDate`；写回保住原文件 eol | `parseInspirationDoc`、`renderInspirationBlock`、`INSPIRATION_DOC_NAME`、`INSPIRATION_FOLDER_NAME`、`INSPIRATION_SKILL_NAME` |
| `plugin_config.ts` | 160 | 设置持久化读写（`data.json` → LlmConfigDoc 列表等） | `PluginConfig` |
| `prompt_files.ts` | 105 | 提示词文件组装器：调用方声明有序 `PromptSpec[]`（file/text 条目），按序读取（注入 reader）→清洗（去注释/剥标题行/transform）→去重（路径先到先赢＋清洗后同文跳过）→header 分节包装→join 成完整块串 | `assemblePromptFiles`、`PromptSpec`、`AssembledPrompt`、`PromptFileReader` |
| `editor_nav.ts` | 32 | 「在编辑器里打开文档并定位到某一行」共用件（v0.4.3+，灵感工具包／时间线面板共用）：置光标＋滚到视口中央，0/250ms 两次尝试躲开编辑器装载完成慢 | `openFileAtLine`、`revealEditorLine` |
| `deai_ledger.ts` | 139 | 连续编写 AI 味登记表（v0.4.3+）：`DeaiLedger`/`DeaiLedgerEntry` 数据结构＋《案头资料/AI味清单.md》纯渲染（状态图标、汇总、句子折叠、每节机器可读键行 `<!-- aw-deai-key:… -->`）＋`parseDeaiLedgerDoc` 回读解析（供「补做去AI味」续做中途停止的章），无 IO | `renderDeaiLedger`、`parseDeaiLedgerDoc`、`ledgerCounts`、`DEAI_LEDGER_DOC_NAME` |
| `usage_guide_default.ts` | 25 | `.md=text` 内联文档的唯一导出壳（docs/使用说明.md → work_dir《使用说明.md》）；**v0.4.10+ 图片占位符**＝`embedUsageGuideImages` 把 md 里 `{{WECHAT_QR}}` 替换为 wikilink `![[articlewriter-wechat-qr.png]]`（**阅读模式不渲染 md 内联 data: 图＝空白**），图片本体由 main.ts `writeUsageQrAsset` 从包内 dataurl（esbuild `.png=dataurl` 内联 docs/wechat_qr.png）解码 `writeBinary` 投放到说明同目录；换二维码＝覆盖 docs/wechat_qr.png 再构建。`tension_rules_default.ts` 已随 v0.4.3+ 张力规则并入张力工具箱删除；`banned_words_default.ts` 已随 v0.3.6 禁用词 Skill 化删除 | `DEFAULT_USAGE_GUIDE`、`embedUsageGuideImages`、`USAGE_QR_ASSET_NAME`、`USAGE_QR_DATA_URL` |
| `md.d.ts` | 4 | `*.md` 模块声明（配 loader） | — |
| `usage_doc_stamp.ts` | 30 | 《使用说明.md》**版本戳**纯模块（v0.4.7+）：写出＝首行注释戳 `articlewriter:usage-doc-version X.Y.Z`＋一行可见版本提示（先剥旧戳/旧提示行＝幂等）；`usageDocNeedsRegen`＝缺失/为空/无戳/戳版本≠当前版本即重建（升级直接覆盖、不留备份）——启动自检 `syncUsageDocOnStartup`／切目录 `seedUsageDoc`／`generate-usage-doc` 命令三处共用；测试 `usage_doc_stamp.test.ts` 4 条 | `stampUsageDoc`、`usageDocVersion`、`usageDocNeedsRegen` |

## 依赖分层（相对 import，实测无环）

```
L0 叶子（零内部依赖）: md_docs, state_doc, story_types, plugin_config, banned_words, inspiration, *_default, md.d.ts
L1: llm_client(→plugin_config) · prompts(→md_docs,banned_words,story_types) · prompt_files(→md_docs) · cast_analyzer(→md_docs,state_doc) · editor_nav(→仅 obsidian)
    视图: status_view(→prompts,story_types,inspiration) · relationship_view(→md_docs,graph_layout) · timeline_view(→md_docs,editor_nav,panel_canvas,outline_tree) · scene_view(→md_docs,panel_canvas,scene_geometry)
    modals(→pipeline,md_docs,state_doc,skills_default,inspiration) · llm_chat_view(→llm_client,modals,plugin_config)
L2: story_manager(→md_docs,state_doc,prompts,cast_analyzer,story_types)
L3: main.ts(→其余全部)          prompts.test.ts(→prompts)
```

要点：`prompts ← story_manager` 单向（manager 只消费组装结果/`CleanReport`）；`banned_words` 不依赖任何人，词表注入走 `prompts` 中转；视图不 import manager，快照经 main.ts `getStatusSnapshot/getRelationshipSnapshot/getTimelineSnapshot` 拉取、动作经 `handleStatusAction` 回调。

## `src/main.ts` 内部区块图（9197 行单文件）

> 下表行号是**历史快照、长期滞后于文件增长**（多轮改动后只更新新条目）。要定位真实位置请用区块注释：`grep -n '^	// ---------- ' src/main.ts`。

| 区块 | 行 | 内容 |
| --- | --- | --- |
| 头部 | 1–65 | imports、`DEFAULT_SETTINGS`(L40)、`RELATION_TYPE_OPTIONS`(L48)、`HDR_*` 大纲族块 header 常量(L50 附近，assembleVolOutlineContext specs 与 book 族旗标判定共用) |
| `ArticleWriterPlugin` | 66–6779 | 约 140 个方法，`onload` L83–273 注册 **70 条 `addCommand`**＋视图/事件/ribbon |
| ├ 设置与守卫 | 274–304 | `loadSettings/saveSettings` |
| ├ 工作目录/切书 | 305–564 | `noteWsIoError`(L311)、`bookWorkspacePath`(L321)`/captureBookWorkspace/loadBookWorkspace/applyStorySwitch/pickWorkDir/cmdSwitchStory`(L435) |
| ├ 卷结构命令 | 565–764 | `cmdVolumeMode`(L565)`/cmdOrganizeVolumes`(L611) |
| ├ 输入助手 | 765–860 | `prompt/pickNewDoc`(L849)`/promptChapterCountInput`(L782)`/promptOutlineGenMode/promptPrevChaptersInput/promptAllVolumeChapterCounts` |
| ├ 书/章基础命令 | 861–1146 | `cmdNewStory`(L863)`…cmdStatus`(L1042)、标签与错误助手、`pickAction/confirmBox` |
| ├ 卷/场景/人物/伏笔/世界命令 | 1147–2032 | `cmdVolume*`(L1149)`/cmdScene*`(L1345)`/cmdCharacter*`(L1521)`/cmdAnalyzeCast`(L1662)`/cmdForeshadow*`(L1869)`/cmdWorld*`(L1955)、大纲追加/章大纲打开(L1989) |
| ├ 章节管理/打包 | 2033–2264 | `cmdChapterDelete`(L2053)`/Rename/Renumber/cmdPack*`(L2133)`/cmdRescanStory`(L2202) |
| ├ 文档生命周期 | 2265–2810 | `cmdCompleteState`(L2279)`/cmdSetWordRange`(L2323，v0.3.5+ 字数区间命令，写《故事状态.md》`word_range`)`/purgeWritingGuideArtifacts`(L2357，v0.3.5 启动清理：各层 WRITING_GUIDE.md＋《写作指南汇总.md》＋插件数据目录 guide-types/＋data.json 遗留字段)`/wordRangeOf`(L2398)`/tensionRulesPath`(L2405)`/bannedWordsPath`(L2423)`/promptReader`(L2727)`/cmdGenerateUsageDoc`(L2793，借用 story_manager `readGuideAt`/`writeGuideAt` 做指定路径文档读写) |
| ├ LLM 装配 | 2915–3300 | `getPhaseLlmSetup`(L2915)`/cmdLlmTest`(L2994)`/openAddCharacterDialog`(L3118)`/loadSkillsBlockFrom`(L2580，v0.4.2+ 系统级与书籍级技能块共用装配)`/loadSkillsBlock`(L2596)`/loadBookSkillsBlock`(L2646)`/writerSystemPrompt`(L3293；v0.3.5+：旧 `loadWriterGuides` 三层指南加载已随写作指南体系废弃删除) |
| ├ 面板快照/动作 | 3076–3916 | `schedule*Refresh` 防抖、`get*Snapshot`(L3129)、`handleStatusAction`(L3355 起巨型分发) |
| ├ 生成执行层 | 3917–4174 | `genFailure`(L3917)`/stream 封装`、`decorateLlmError`(L4113)`、notifyAiReport`(L4152)、字数/引用告警 |
| ├ 写作命令族 | 4175–6064 | `cmdWrite`(L4177)、`assembleVolOutlineContext`(L4519)`/assembleWritingDocGroups`(L4550) 装配 helper、`cmdVolumeOutlineToChapters`(L4402)、卷/书大纲族（`genVolOutlineIncremental` L4059 等）、`cmdWriteConsecutive`(L5459)`/cmdContinueWriting`(L5575)`/cmdRewriteChapter`(L5718)`/cmdPolishText`(L5824)`/cmdDeaiClean`(L5893)`/cmdFixChapterRefs`(L5966) |
| ├ 灵感工具包（v0.4.3+，实测行号） | 4981–5132 | `inspirationFolderPath`/`inspirationDocPath`/`readInspirationDoc`/`writeInspirationDoc`/`inspirationTemplate`/`cmdInspirationKit(storyName?)`/`locateInspiration`/`cmdNewInspiration`/`cmdRenameInspiration`/`cmdDeleteInspiration`/`findInspirationBlock`（纯逻辑与增删在 `src/inspiration.ts`，见 [l3-inspiration-impl.md](./l3-inspiration-impl.md)） |
| ├ export-ai-prompts | 6065–6614 | `fenceBlock`(L6065)`/exportSection`(L6076)`/cmdExportPrompts`(L6098 巨型导出器) |
| └ 审校命令 | 6615–6779 | `cmdTypoCheck`(L6615)`/cmdReviewChapter`(L6691) |
| `StatusModal` | 6780–6794 | 状态文本弹窗（与 `modals.TextPanelModal` 功能重复，见债务） |
| `ArticleWriterSettingTab` | 6976–7500 | 设置页：`getSettingDefinitions` 声明式渲染＋「LLM 配置」tab 区块自定义 render（固定两 tab：全局设置页 + 模型配置页列表/详情两形态，`renderLlmGlobalTab`/`renderLlmConfigList`/`renderLlmConfigDetail`，模型增删/改名/上下移；改名走 `plugin_config.renameLlmConfig`＋`refreshLlmNameSelects()` 就地重刷页面上的「模型配置」下拉（见 l3-settings-page） |

## 根目录遗留文件（git 已跟踪、不参与构建）

| 文件 | 大小 | 状态 |
| --- | --- | --- |
| `main.ts` | 416KB / 7052 行 | src/ 拆分前的旧单文件全量拷贝，**已陈旧**（src/main.ts 现为 9197 行） |
| `llm_chat_view.ts` | 24KB | 同上旧拷贝 |
| `plugin_config.ts` | 3.8KB | 同上旧拷贝 |
| `main.js` | 2.1MB | 旧构建产物直接躺在仓库根（现产物在 release//dist/，均 gitignore） |

`tsconfig include=src/**/*.ts` 与 esbuild `entryPoints=["src/main.ts"]` 证明四者零引用；**清理候选**——删除需用户确认（AGENTS.md 未声明保留理由）。

## 已知重复与债务（改动时顺手收敛，勿新增同类）

- `clampNum` 两处重复：`relationship_view.ts:120`、`timeline_view.ts:46`。
- 章节后缀→基础名映射近似重复：`status_view.ts:5 CH_SUFFIX_TO_BASE` ≈ `story_manager.ts:103 CHAPTER_SUFFIX_TO_BASE`（键集略有出入，改命名规则两处都要查）。
- `StatusModal`（main.ts:6780）与 `modals.TextPanelModal`（modals.ts:530）功能重复，新弹窗优先用后者。
- `main.ts` 7946 行：命令实现与插件壳未分离；若拆分，第一刀候选是 export-ai-prompts（L6221–6794）与写作命令族（L3038–6220）下沉独立模块。
- 70 条 `addCommand` 手写散布 onload：若再频繁增删命令，可收敛为 id→实现注册表（command-reference.md 与命令面板双处维护成本）。
