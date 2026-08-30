# ArticleWriter for Obsidian

## Overview (English)

ArticleWriter turns your vault into an AI-assisted novel workshop. It organizes each story as a folder of plain Markdown files (state doc, outline, world-building, characters, scenes, foreshadowing notes and one folder per chapter) and adds LLM-powered writing commands on top: write / continue / rewrite / polish chapters, strip AI-sounding phrasing, review from a global perspective, plus a dockable chat panel that can quote any vault file via @references. All data stays local; no external services are required beyond the OpenAI-compatible model endpoint you configure yourself.

See the Chinese sections below for full command reference and data layout.

---

AI 小说创作工具 `articlewriter`（Python CLI）的 Obsidian 插件版。不依赖任何外部服务，全部使用 Obsidian 内置能力（Vault / Workspace API）操作 vault 内的 Markdown 文档，**未移植同步功能**。

## 数据约定（与 Python 版一致）

```
<小说根目录>/<书名>/
├── 故事状态.md              # Obsidian「文件属性」风格：YAML frontmatter 存 version 2 运行态（标题/类型/当前卷场景章节/各章元数据），正文可自由写笔记；旧版 story_state.json 首次保存时自动迁移备份到 _backup/
├── WRITING_GUIDE.md         # 用户级创作规范（原 ~/.articlewriter/ 移入此处）
├── 大纲.md               # 总大纲
├── 世界观.md             # 世界观模板
├── 卷.md                 # 卷（分组容器）
├── 伏笔.md               # 伏笔记录
├── 笔记.md
└── 第NN章-<标题>/        # 每章一个文件夹
    ├── 章节.md           # 正文
    ├── 章节大纲.md
    ├── 人物.md
    ├── 人物关系.md
    ├── 场景.md
    └── 章节信息.md
```

新建时缺失文档自动创建为「HTML 注释示例」模板；已存在则跳过、不覆盖用户内容。文件名统一经 `safeFilename()` 清理（对齐 `fsutil.safe_filename`）。

## 命令（命令面板搜索 "ArticleWriter" 或中文说明）

| 命令 | 对应 CLI | 实现方式 |
| --- | --- | --- |
| 创建新小说 | `/new` | `vault.createFolder` + `vault.create` 建书与模板文档，写 `story_state.json` |
| 新建章节 | `/chapter add` | 建 `第NN章-标题/` 目录及 6 份文档，更新当前章节 |
| 章节列表 | `/chapter list` / `/open` | 扫描章节目录，选择后 `workspace.getLeaf("tab").openFile` 打开正文并切换当前章节 |
| 打开总大纲 / 世界观 / 伏笔 / 笔记 | `/outline show` 等 | 不存在先按模板创建再打开 |
| 下一章 / 上一章 | `/chapter next` / `prev` | 无当前章节时 next→第一章、prev→最后一章；到边界提示不再切换 |
| 统计当前章节字数 / 全书字数 | `/count` | 只计纯文字字符（移植 `count_pure_words`：不含标点/符号/空白） |
| 保存当前章节 | `/save` | 读取聚焦编辑器内容经 `vault.modify` 强制落盘 |
| 小说状态 | `/status` | 展示标题/类型/当前章节/章节数/总字数 |
| 查看 / 编辑创作规范 | `/agents view` / `edit` | 三层：小说级 `<书名>/WRITING_GUIDE.md` > 用户级 work_dir 下同名文件 > 系统级（默认存插件设置 data.json、预置 CLI 内置内容；设置页可配 system_guide_path 指向 vault 内自己的指南文件覆盖）；多层弹选择器，view 系统级为只读面板，edit 选层后全量保存 |
| LLM 连接测试 | `/llm test` | 用 openai SDK 走任意 OpenAI 兼容端点（DeepSeek/DashScope/Ollama/LM Studio/llama.cpp…），GET /models 验证激活配置 |
| LLM 对话窗口 | —（插件新增） | **常驻可停靠面板**（自定义视图，拖到任意区域、重载后位置保留，侧边栏有消息图标快捷入口）：多轮流式聊天，Enter 发送 / Shift+Enter 换行、顶部下拉切换已保存模型、「停止生成」只中断当前轮；每轮自动携带对话专用提示词（友好助手身份+创作规范+当前小说上下文快照，与 CLI /llm 问答行为一致），顶部显示当前小说·章节，历史不落盘 |
| 工作状态面板 | —（插件新增） | **常驻可停靠面板**（侧边栏书本图标快捷入口）：工作目录、全部小说列表（点击切换当前书）、当前小说的题材/编写类型/总字数/更新时间、章节列表（点击激活该章并同步所属卷）、全局文档与各章文件（点击在编辑器打开），小说/章节/文件列表均支持像文件夹一样展开折叠（点标题行或章节前的箭头）；**右键**小说/章节/文件行有快捷菜单：新建或删除小说、新建或删除章节、在书根目录或章节目录下新建文章 .md / 删除文件（危险操作均有二次确认，删除进 Obsidian 回收站可找回），右上「刷新」手动重载数据 |
| LLM 模型配置 | （替代 `~/.articlewriter/config.json`） | Obsidian 设置 → ArticleWriter，存于插件数据目录 `.obsidian/plugins/articlewriter/data.json`（首次运行预置 local/deepseek/qwen-dashscope 三组标准模板待填 api_key/模型名） |

## 工作流程（work_dir）

1. **首次使用**任何 ArticleWriter 命令时，会自动弹出**工作目录选择器**——从 vault 内已有文件夹中选定写小说的文件夹，作为 `work_dir`（对齐 CLI 的 `--work_dir` / `/dir`）。
2. 以后**创建小说、创建章节、打开文档、切换章节、字数统计等全部在 work_dir 下操作**；每个小说是 work_dir 下的一个子文件夹。
3. 需要换目录时用「选择工作目录」命令或设置页的「重新选择…」按钮（切换后清空旧小说记忆，同 CLI `/dir` 行为）。
4. 多本书时各命令会弹小说选择器并记住上次选择。

## 设置

- **工作目录（work_dir）**：写小说的文件夹，首次使用时自动弹出选择器初始化，也可手动修改/重选。
- **创建后自动打开文档**：建书打开 `大纲.md`、建章打开 `章节.md`。

## 构建与安装

```bash
npm install
npm run build        # 产物 main.js + manifest.json + styles.css
```

开发模式（watch）：`npm run dev`。

手动安装：把 `main.js`、`manifest.json`、`styles.css` 复制到 `<你的vault>/.obsidian/plugins/articlewriter/`，在 Obsidian「设置 → 第三方插件」中启用。
