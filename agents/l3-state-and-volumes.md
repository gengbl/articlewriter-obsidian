# L3 · 状态文档与卷语义

## 目录树

```
<work_dir>/<书名>/                    # work_dir 是容器，本身不是小说
├── 故事状态.md                       # Obsidian「文件属性」风格：YAML frontmatter = version 2 运行态，不存任何文档内容
#   （旧版 story_state.json 仅读兼容，首次 saveState 自动备份到 _backup/ 后不再读写）
├── WRITING_GUIDE.md                # 小说级创作规范（三层中最高优先级；用户级在 <work_dir>/WRITING_GUIDE.md）
├── 写作指南汇总.md                 # 三层合并落盘（自动生成+agg-hash 变更检测），LLM 注入【创作规范】的唯一来源
├── 大纲.md / 卷.md / 场景.md / 世界观.md / 伏笔.md / 笔记.md   # 全局文档
├── 引言/                             # 引言（全书唯一，有卷/无卷模式均置书根）：只放正文类文档，不注入写作提示词
│   └── 引言.md                       # 引言正文（建书/建卷/建章自动播种；亦可写字台「书稿」标题右键「新建引言…」手动创建）
├── 第NN章-<标题>/                     # 未归属任何卷的章节直接放书根（NN=两位零填充，卷内独立编号从 01 起）
└── <卷名>/                             # 卷实体目录：每卷一个、以卷名命名（卷名须唯一）；归属该卷的章节存放其中
    # 卷目录内模板文件物理名为新格式 <卷名>-<基名后缀>.md（与章节目录内一致）；建卷播种与 rescan 补全都按新格式落盘；读取侧 `resolveVolumeDocPath` 按「新格式→旧前缀(<卷名>-卷大纲.md)→裸基名」依次回退兼容历史
    ├── <卷名>-大纲.md             # 卷级设定（建卷时 ensureDoc 生成模板；rescan/organize 缺失补建）
    ├── <卷名>-人物.md
    ├── <卷名>-人物关系.md
    ├── <卷名>-场景.md
    ├── <卷名>-摘要.md             # v0.0.15+：本卷滚动摘要，写盘命令**不** eager 刷新——v0.1.4+ 改为延迟生成（ensureFreshVolumeSummary），上下文组装需要时按本卷全部成员章的新鲜章节摘要整体重建；默认（includeVolumeSummary 关闭）不注入也不触发
    └── 第NN章-<标题>/                  # 与书根同构（**v0.0.15 起卷内独立编号**：各容器各自从第01章起，跨卷不连续）
        # 章节目录内模板文件物理名为新格式 <编号>-<标题>-<基名后缀>.md（目录名保留「第NN章」前缀，**仅文件名用纯数字前缀**）；建章播种与 rescan 补全都按新格式落盘；读取侧 `resolveChapterDocPath` 按「新格式→旧前缀（第NN章-<标题>.md）→裸基名」依次回退兼容历史
        ├── NN-<标题>.md          # 正文（旧 `章节.md` / 旧前缀 第NN章-<标题>.md 由回退读取兼容）
        ├── NN-<标题>-大纲.md     # 章节大纲（旧 `章节大纲.md`）
        ├── NN-<标题>-人物.md     # 归属该章的角色（旧 `人物.md`）
        ├── NN-<标题>-人物关系.md
        ├── NN-<标题>-场景.md     # 本章场景（旧 `场景.md`）
        ├── NN-<标题>-信息.md     # 卷归属/标签/备注/创建更新时间（旧 `章节信息.md`）
        └── NN-<标题>-摘要.md     # v0.0.15+：本章 AI 摘要，v0.1.4+ 改为延迟生成——窗口章/前卷摘要需要时经 ensureFreshChapterSummary 触发 LLM 并落盘；建章播种**不**建此文件，首次需要时按新格式落盘（旧 `章节摘要.md` 由回退读取兼容）
```

## 章节身份模型（v0.0.15 起：卷内独立编号 + 复合键）

- **编号空间按容器重置**：书根（未归属）与各卷实体目录是独立编号空间，均从 `第01章` 起。裸章号在卷间可重复——因此一切代码内部标识一律用**复合键**：根域 `"N"`、卷域 `"volId:N"`（helper `chKey(vol,num)` / `parseChKey(key)`，state_doc.ts）。
- **故事状态.md**：`chapters` 的键 = 复合键字符串；`current_chapter` 由 number|null 改为 string|null（复合键）。解析时自动归一化旧格式：纯数字键若 meta.volume 非空 → 重映射为 `vol:N`；纯数字 current_chapter → 按 num 唯一匹配条目取复合键（老书全局唯一故必命中），无匹配置 null。写盘恒为新格式。
- **位置即编号事实**：listChapters 扫描各容器，目录名里的 N 就是该容器内的本地章号；返回项带 `key`（复合键）、`num`（本地号）、`vol?`。**阅读序（ordinal）**= 根域章节（按 num）在前 + 各卷按《卷.md》order 依次展开卷内 num 升序，序号 1..M——所有「前后 N 章/相邻大纲/角色已登场」等顺序逻辑一律基于 ordinal，不再对裸章号做算术。
- **引用改写作用域规则**：文档正文中裸 `第N章` 引用只指向**同容器**章节；跨卷引用须显式写明卷名（如「第二卷·第5章」），代码不识别、不改写。renumber/insert/delete 的文本重写 `/第(\d{1,6})章/g` 只在受影响容器内的文件里按其局部映射执行；伏笔条目按复合键结构化重映射。
- **冲突策略**：setChapterVolume / deleteVolumeCascade 解绑移入目标容器时若同号已占用 → 自动取目标容器 max+1（不做引用修复，与既有行为对齐，属已知限制）。
- **建章自动编号**：createChapter 不再接受章号参数，落点容器的 next free = max(num)+1（空容器=01）。/write 无参默认在 current_chapter 所属容器（否则 current_volume、再否则书根）续建新章。nextOrPrev 只在当前章节所在容器内导航。
- **「重排章号」命令语义变更**：现对每个容器独立压缩为连续 01..N（即旧书的卷内迁移入口——老书 vol2 的 31..50 跑一次变 1..20）；执行前把全书 md 备份到 `_backup/卷内重排_<时间戳>/`（角色改名同款 file-level copy），再做升序单遍目录迁移（目标位必空、无临时槽，中断不留大号幽灵章）+ 作用域内引用重写 + 伏笔重映射。
- **打包表达式** `/pack [卷] [范围]`：可选首 token = 卷 id 或卷名（精确/包含匹配）；缺省依次取 current_volume / 无卷则整本；有卷未激活且多容器 → pickAction 选容器。范围内数字按所选容器的本地号解析。
- **场景/人物归属字段**（SceneDoc.chapter_num / CharacterDoc.chapter）保持 number = **所在容器的本地章号**（0=全局，文件位置才是最终事实）；loadAll* 合并时由 manager 附加运行时 `vol?` 标签供跨卷展示与移动定位，不落盘新格式。**v0.2.0+ 卷级人物落盘口径**：`chapter=0 && vol=<卷id>` = 卷级人物（`loadAllCharacters` 一直按此读取卷目录《人物.md》并打 `vol` 标签），写入侧 `characterFilePath`/`saveCharactersFile` 同步支持该组合（物理落 `resolveVolumeDocPath(卷目录, 卷名, 人物.md)`，H1 用卷名 → `# <卷名> 人物`）；v0.2.0 前 `addCharacter` 把 `chapter=0` 的 vol 一律丢弃（只能落书根），故此前不存在卷级人物写入路径。

## 引言（v0.2.x+，全书唯一）

- **引言 `引言/`（v0.2.x+，全书唯一）**：书根单一文件夹 `<书名>/引言/`，有卷/无卷模式结构一致，只放正文类文档（无模板集、不参与提示词注入）。**自动播种**：createStory/addVolume/createChapterAt 各调 `ensurePrologue(storyName)`（幂等——文件夹已存在返回 false 不覆盖任何已有文件；首次创建按 `PROLOGUE_TEMPLATE` 播种 `引言.md`），best-effort（`.catch(() => {})` 失败不影响主流程）。**手动入口**：尚无引言时写字台「书稿」小节标题右键菜单出现「新建引言…」（同一幂等方法）。`listPrologueDocs` 枚举其直属 md 文件（zh 序；空数组=尚无引言，写字台据此显示淡色提示行）；`deletePrologue` 整文件夹 trashFile 入回收站（面板侧先弹二次确认）。**保留名**：「引言」不可作卷名——addVolume（loadVolumes 之前）与 updateVolume 改名路径均直接抛错，因卷名为目录名会与书根「引言」文件夹物理冲突。CHAPTER_DIR_RE（`第\d+章-...`）不匹配「引言」，listChapters/containerPaths 不会将其扫为章节；organizeByVolumes/flattenToRoot/rescanStory 均不触碰只含 md 文件的书根「引言」文件夹（已逐一核验）。

## 状态文档字段与保存语义

- **故事状态.md（frontmatter，version 2）字段**：`title`、`genre`、`writing_style`、`current_chapter`（复合键字符串）、`current_scene`、`current_volume`、`total_words`、`created_at`、`updated_at`、`use_summaries`、**`use_volumes`（v0.0.16+，无卷模式开关，见「卷 / 当前状态激活语义」）** + `chapters`（键为**复合键字符串** `"N"` / `"volId:N"`，见「章节身份模型」；值=**仅 标题/字数/卷** 的嵌套映射——tags/note 已精简移除：无代码读回，标签/备注只属于各章《章节信息.md》；旧文档残留这两个键解析忽略、下次保存消失）。空可选字段序列化时省略；key 顺序固定。磁盘是唯一事实来源；每个写操作后立即落盘，内存不持有文档内容。
- **状态文档保存语义（saveState）**：先读旧文档 → 只重写 frontmatter，**正文原样保留**（可自由写笔记）；用户在 Obsidian 属性面板加的自定义顶层属性会收进 `extra` 并透传回写（不被覆盖丢失）。新建书时用模板注释作初始正文。
- **兼容迁移**：`loadState` 优先读 `故事状态.md`，缺失时回落旧版 `story_state.json`（旧格式产物仍可直接识别加载）；对含旧 JSON 的小说首次 saveState 会把 JSON `vault.rename` 到 `_backup/story_state_<时间戳>.json`（不用回收站，保证可恢复），此后 MD 为唯一事实来源。

## 删除约定

- 删除一律走回收站：`app.fileManager.trashFile(file)`（跟随用户「删除方式」设置，默认 vault `.trash/`），不用 `delete()` 硬删、也不再调旧 API `vault.trash(file,false)`；角色改名会把被改动文件备份到 `_backup/` 后再全小说替换。

## 卷 / 当前状态激活语义（v0.0.15 起含实体目录）

- 卷是分组容器：元数据存根目录 `卷.md`，同时**每卷在书根下有同名实体目录 `<书名>/<卷名>/`**——归属该卷的章节目录物理存放其中，未归属章节留书根。**位置即归属**：`listChapters` 扫描「书根 + 各卷实体目录」（`containerPaths`），返回项带 `vol?`（所在卷 id）与 `parentPath`；《章节信息》「卷」字段与位置冲突时以位置为准并就地回填（rescanStory）。编号规则见上节「章节身份模型」（v0.0.15 起卷内独立编号、复合键标识）。
- **卷名唯一且作为目录名**：addVolume/updateVolume 重名直接抛错；「引言」为保留名（addVolume 在 loadVolumes 之前、updateVolume 改名路径均拒绝——与书根「引言」文件夹物理冲突，见上方引言条）；改卷名 = 同步 rename 实体目录（失败回滚元数据）；`deleteVolume`=解绑语义（章节先移回书根、仅清归属标记）。另有 `deleteVolumeCascade`（写字台面板右键「删除本卷」专用，弹确认框列明受影响章节后执行）=级联语义：其全部归属章节目录整体 trashFile 入回收站 → 一次清理 state（当前章悬空则回退最后一章）→ 末尾单次 renumberChapters 补洞 → 删卷元数据 + rmdir 空卷目录 + 清 current_volume。两种删卷入口不可混用语义。
- 建章自动编号：createChapter(storyName, title, volId?) 不接受章号——落点容器 next free = max+1；insertChapter 继承参照章所在容器并在其局部空间插位（同容器 ≥插入号的章顺延 +1）；rename/move/renumber 均保留父容器（`chapterDirOf` 返回 parentPath）。
- **平面结构迁移**：旧布局（已归属章节散在书根）由命令「按卷整理目录 /organize-volumes」（`manager.organizeByVolumes`，幂等）一次性归位；`needsVolumeOrganize` 检测残留。**切换书籍（`switch-story` 或状态页点选）检测到平面残留 → 强制自动整理、不可跳过**，失败则置 `flatBlocked` 锁定该书全部章节/卷结构操作直至手动整理成功；各结构命令入口另经 `ensureVolumeLayout` 门禁（弹确认框引导立即整理，取消=阻断本次操作）。纯未归属留书根的书不算平面残留。
- **无卷模式（默认，v0.0.16+）**：`use_volumes=false`=纯「书籍→章节」扁平结构——不建卷/不归卷/不按卷整理。**新书 createStory 恒置 false**。**向后兼容推断**：parseStateDoc 对旧文档（缺该字段）按磁盘事实回填——存在任一 vol 域复合键或 current_volume → true，否则 false；首次保存后恒显式写回使行为确定。切换命令 `/volume off|on`（main.ts `cmdVolumeMode(enabled)`，两命令 volume-mode-off/on）：**off=破坏性拍平**——若仍有卷则 `flattenToRoot` 逐章 `relocateChapterContainer(key,null)` 回移书根并连续重编号，**再经 salvageVolumeDocsToRoot 把各卷残留的直属文件（非章节目录：建卷播种的设定五件套/卷摘要等）挪出到书根保留——跨卷或书根已存在同名者前面加「<卷名>-」前缀避免覆盖**，随后各卷实体目录 trashFile 入回收站、清 `卷.md` 元数据与 current_volume（幂等可续跑），执行前二次确认；on=仅置位不改盘。**门控面**：addVolume/setChapterVolume/organizeByVolumes 在 no-vol 下抛 `NO_VOL_MODE_MSG`；cmdOrganizeVolumes/cmdVolumeAdd/cmdVolumeManage/cmdPackVolume 入口 Notice 拦截（先于任何弹框）；enforceVolumeLayoutOnSwitch 直接放行（no-vol 书跳过强制按卷整理）；createChapter 忽略 volId 落书根；写字台 StatusDetail.useVolumes=false 时隐藏全部「新建卷」右键入口且空态文案不提建卷。
- `current_volume` + `current_chapter` 持久化在故事状态.md 的文件属性中；建卷自动激活并可顺带建该卷第一章（直接落卷目录）；切换卷自动激活该卷最后一章；章节已归卷时切章同步补激活所属卷。
- 加载时校验：激活卷不存在→清空；激活章节不存在→回退最后一章（见 `validatedState`）。
- **激活写入自洽（防"有时激活不生效"）**：switchChapter/statusActivateChapter/activateVolume 写 current_chapter 前一律先过 manager.ensureChapterEntry——chapters 映射缺该复合键时按磁盘 listChapters 回填 {title,words:0,volume}，否则解析侧「current_chapter 须存在于 chapters」校验会把它丢弃、radio 永不点亮。current_volume 同步以**键内容器为准**（parseChKey(key).vol），不信任可能过期的 meta.volume；activateVolume 的末章号取 state 与磁盘两源 max。已知诱因：卷实体目录被外部改名后不再匹配 volumeFolderName/id → 其下章节在面板里变裸数字根域键（八仙剧本「除妖记」↔卷名「除妖记」即此）；此类书用「管理卷→分配章节 all」或切换书籍时的强制整理把章移回卷目录即可对齐。

## 相关源文件

| 文件 | 职责 |
| --- | --- |
| `src/state_doc.ts` | **纯函数层**：运行态状态文档编解码——`StoryState`/`ChapterMeta` 类型 + YAML frontmatter parse/format（依赖 `yaml` 包[eemeli/yaml，esbuild 打包进 bundle；曾从 js-yaml 换入以过社区目录校验器的依赖检查]）。载体为 Obsidian「文件属性」风格的 `<书名>/故事状态.md`；正文原样保留、用户自定义属性（extra）保存时透传不丢失。改状态字段必须同步改这里并跑往返测试 |
| `src/story_manager.ts`（状态与卷部分） | **Vault API 操作层**（唯一直接读写 vault 的模块）：小说/章节/卷/场景/人物/伏笔/世界观/大纲/打包/重扫描/编写类型；创作规范三层文件读写（bookGuidePath/userGuidePath/storyPath + readGuideAt/writeGuideAt）。**v0.2.x+ 引言**：`PROLOGUE_DIR_NAME="引言"` + `prologuePath`（书根 `<书名>/引言`）/`ensurePrologue`（幂等，返回是否本次新建；首次创建按 PROLOGUE_TEMPLATE 播种 `引言.md`；createStory/addVolume/createChapterAt 三处 best-effort 调用 `.catch(() => {})`）/`listPrologueDocs`（同步枚举直属 md、zh 序，空数组=尚无引言）/`deletePrologue`（整文件夹 trashFile）；`ensureChapterDocs(storyName, chKey)`＝检查章节目录缺失的标准模板文档并按模板创建（与建章播种/rescan 补缺同一 `chapterDocTemplates` 清单来源，已存在不覆盖，返回本次新建文件名列表），供写字台章节行右键「补全文档」；保留名守卫：addVolume（loadVolumes 之前）与 updateVolume 改名路径拒绝卷名「引言」（与书根引言文件夹物理冲突）。listChapters 存活判定＝磁盘目录存在即存活章节（无「章节.md」照常列出），旧 quarantineHollowChapters 机制已移除。其余部分见 [l3-summary-pipeline.md](./l3-summary-pipeline.md)（构造注入/摘要四件套/loadWritingData）、[l3-relationship-view.md](./l3-relationship-view.md)（人物关系数据入口）、[l3-timeline-view.md](./l3-timeline-view.md)（时间线只读枚举）、[l3-guide-lifecycle.md](./l3-guide-lifecycle.md)（插件数据目录裸文件 IO） |
