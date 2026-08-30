# 数据模型与存储约定（继承 Python 版，必须保持兼容）

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

## 卷 / 当前状态激活语义（对齐 CLI `/volume`、`/chapter switch`）

- 卷只是分组容器：数据存根目录 `卷.md`，章节通过 `章节信息.md` 的「卷」字段标记归属；卷不改变全局连续编号；删卷只清空其下章节标记并返回受影响章节号列表。
- `current_volume` + `current_chapter` 持久化在故事状态.md 的文件属性中；建卷自动激活并可顺带建该卷第一章；切换卷自动激活该卷最后一章；章节已归卷时切章同步补激活所属卷。
- 加载时校验：激活卷不存在→清空；激活章节不存在→回退最后一章（见 `validatedState`）。
