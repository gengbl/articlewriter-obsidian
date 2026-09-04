# ArticleWriter for Obsidian

> 英文版见 [README.md](./README.md)

## ⚠️ 信息披露与安全声明（Disclosures & Security Statement）

**网络请求。** 本插件除 LLM 对话外不进行任何联网活动。所有出站流量仅通过官方 `openai` SDK 发往**你在设置中自行配置的** OpenAI 兼容端点（本地服务如 Ollama / LM Studio / llama.cpp，或 DeepSeek、通义千问 DashScope 等服务商 API）。运行时只会触发两种请求——非流式与流式 chat completions；扫描器标记出的其余请求相关调用点属于打包进 bundle 的 SDK 通用 HTTP 层，本插件不会在其他地方使用它们。**没有任何遥测、统计上报、更新检查，也不连接任何作者自建的服务器。** API Key 由你本人在设置面板输入，随其他插件配置一起保存在你的 vault 本地，只作为认证头发送给你所选的端点；留空时（本地服务的常见情况）不发送任何凭证。

**Base64 用法（`atob` / `btoa`）。** 插件自身源码中**零** base64 编解码调用。发布产物中出现的所有实例均来自 esbuild 打包进来的第三方库：`yaml` 解析器（其处理 YAML `!!binary` 标签的标准代码）和 openai SDK（通用的 base64 ↔ 二进制缓冲转换辅助函数），只做常规数据格式转换，**未用于混淆 API Key、隐藏 URL 或掩盖任何代码载荷**。构建产物未经压缩混淆，完整可读源码已发布于[仓库](https://github.com/gengbl/articlewriter-obsidian)，如有疑虑请直接审计。

### 3. Vault 遍历披露（Vault Enumeration Disclosure）
本插件通过 Obsidian 标准 `app.vault` API 查看 vault 内的文件结构，范围严格分为两类：
* **用途——全库级「路径」列举（两个小的 UI 选择器）**：(a) 首次使用 / 切换工作目录（`work_dir`）时弹出的文件夹选择器会列出已有文件夹供模糊搜索；该遍历从 vault 根开始但刻意设限——**最深只下探 3 层、最多收集 500 个条目、跳过 `.obsidian/` 等隐藏目录**；(b) 可停靠聊天面板的 @引用候选列表在渲染时调用一次 `vault.getFiles()`，让你能用一个快捷键把 vault 里任意文档引用进 LLM 提示词。两者都只列文件**路径**，当时不读取任何内容。只有你实际操作后才会加载文本：选定文件夹只是为后续本地操作定界；引用某文件则会把其内容并入你自己发起的、发往你所配置模型端点的请求（见上文 §1）。
* **用途——限定工作目录的操作**：其余全部功能（构建小说状态树、列卷/列章、统计每章/全书字数、把大纲 / 世界观 / 人物 / 场景等文档载入写作提示词）都只在**你首次使用时自选的工作文件夹**（`work_dir`）内进行，该目录之外的文件从不被这些功能打开或扫描。
* **隐私保证**：所有遍历完全在你本机本地内存中进行。文件路径与内容仅在设备内处理，**绝不**上传、远程索引、泄露或共享给任何外部服务器——唯一例外是你自己主动触发的、上文 §1 已披露的 LLM 请求。

## Overview (English)

ArticleWriter turns your vault into an AI-assisted novel workshop. It organizes each story as a folder of plain Markdown files (state doc, outline, world-building, characters, scenes, foreshadowing notes and one folder per chapter) and adds LLM-powered writing commands on top: write / continue / rewrite / polish chapters, strip AI-sounding phrasing, review from a global perspective, plus a dockable chat panel that can quote any vault file via @references. All data stays local; no external services are required beyond the OpenAI-compatible model endpoint you configure yourself.

See the Chinese sections below for full command reference and data layout.

---

AI 小说创作工具 `articlewriter`（Python CLI）的 Obsidian 插件版。不依赖任何外部服务，全部使用 Obsidian 内置能力（Vault / Workspace API）操作 vault 内的 Markdown 文档，**未移植同步功能**。

## 数据约定（与 Python 版一致）

```
<小说根目录>/<书名>/
├── 故事状态.md              # Obsidian「文件属性」风格：YAML frontmatter 存 version 2 运行态（标题/类型/当前卷场景章节/各章元数据），正文可自由写笔记；旧版 story_state.json 首次保存时自动迁移备份到 _backup/
├── WRITING_GUIDE.md         # 小说级创作规范（同名的用户级在 work_dir 下）
├── 写作指南汇总.md           # 每书合并落盘（自动生成+哈希变更检测），注入 LLM 提示词的唯一来源
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
| 查看 / 编辑创作规范 | `/agents view` / `edit` | 三层：小说级 `<书名>/WRITING_GUIDE.md` > 用户级 work_dir 下同名文件 > **系统级 = 固定的插件数据目录文件** `.obsidian/plugins/articlewriter/WRITING_GUIDE.md`（首启由内置默认播种；不再用户可配——原 `system_guide_path` 设置已移除）。各层直接打开对应文件，多层弹选择器；edit 选层后全量保存并刷新该书《写作指南汇总》 |
| 生成空写作指南模板 | —（插件新增） | 对用户级 `work_dir/WRITING_GUIDE.md` 与当前书 `WRITING_GUIDE.md` 各建一份同格式骨架（保留段名、清空正文），目标已有非空内容则跳过并提示；不触碰系统级 |
| 重新生成系统写作指南 | —（插件新增） | 二次确认后把内置默认覆盖写回系统级 `.obsidian/plugins/articlewriter/WRITING_GUIDE.md`，再尽力刷新当前书《写作指南汇总》 |
| 生成使用说明 | —（插件新增） | 按代码内置文本在 work_dir 根建《使用说明.md》（命令面板可手动触发；**设置/切换工作目录后及插件启动时发现缺失都会自动创建并打开**——仅缺失或为空时创建），已存在非空则跳过并提示、不覆盖用户修改 |
| LLM 连接测试 | `/llm test` | 用 openai SDK 走任意 OpenAI 兼容端点（DeepSeek/DashScope/Ollama/LM Studio/llama.cpp…），GET /models 验证激活配置 |
| LLM 对话窗口 | —（插件新增） | **常驻可停靠面板**（自定义视图，拖到任意区域、重载后位置保留，侧边栏有消息图标快捷入口）：多轮流式聊天，Enter 发送 / Shift+Enter 换行、顶部下拉切换已保存模型、「停止生成」只中断当前轮；每轮自动携带对话专用提示词（友好助手身份+创作规范+当前小说上下文快照，与 CLI /llm 问答行为一致），顶部显示当前小说·章节，历史不落盘 |
| 写字台 | —（插件新增） | **常驻可停靠面板**（侧边栏书本图标快捷入口）：工作目录、全部小说列表（点击切换当前书）、当前小说的题材/编写类型/总字数/更新时间、章节列表（点击激活该章并同步所属卷）、案头资料与书稿（点击在编辑器打开），小说/章节/文件列表均支持像文件夹一样展开折叠（点标题行或章节前的箭头）；**右键**小说/章节/文件行有快捷菜单：新建或删除小说、新建或删除章节、在书根目录或章节目录下新建文章 .md / 删除文件（危险操作均有二次确认，删除进 Obsidian 回收站可找回），右上「刷新」手动重载数据 |
| LLM 模型配置 | （替代 `~/.articlewriter/config.json`） | Obsidian 设置 → ArticleWriter，存于插件数据目录 `.obsidian/plugins/articlewriter/data.json`（首次运行预置 local/deepseek/qwen-dashscope 三组标准模板待填 api_key/模型名） |

## 工作流程（work_dir）

1. **首次使用**任何 ArticleWriter 命令时，会自动弹出**工作目录选择器**——从 vault 内已有文件夹中选定写小说的文件夹，作为 `work_dir`（对齐 CLI 的 `--work_dir` / `/dir`）。确定后该目录下会自动多一份《使用说明.md》（本插件用法速查，可随时编辑；「生成使用说明」命令可在文件缺失/为空时重建）。
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
