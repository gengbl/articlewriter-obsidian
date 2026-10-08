# AGENTS.md（articlewriter-obsidian）— 入口索引

本文件只做路由，不含具体约定。本插件是独立维护的 Obsidian 小说创作工具（确定性文件操作 + LLM 写作命令），行为约定自成体系、见各 `agents/*.md` 子文件。

**执行任务前**：先按下方导航表判断要改哪个功能域，加载对应的 `agents/*.md` 子文件并遵循其中内容后再动手；跨多个功能域就都加载。收尾时按 `process-rules.md` 写回对应子文件 + CHANGELOG.md。

## 三层文档体系

- **L1 整体功能**（`l1-*.md`）：项目定位、设计决策、功能边界与术语——先读它建立全局认知。
- **L2 模块功能**（`l2-*.md`）：每个功能模块的行为约定与交互语义，一模块一文件。
- **L3 实现细节**（`l3-*.md`）：源文件职责、数据格式、管线与流程细节，改动代码前必读对应条目。

## 导航表

| 你要做的事 | 加载文件 | 覆盖范围 |
| --- | --- | --- |
| 判断项目定位 / 功能边界 / 术语 / 找功能入口 | [agents/l1-overview.md](./agents/l1-overview.md) | 项目概述与范围、设计决策、明确不做清单、「小说」术语约定、功能地图 |
| 书/章/卷结构操作（建书/建章/卷管理/重排/整理/打包/重扫描） | [agents/l2-story-structure.md](./agents/l2-story-structure.md) | 结构命令行为约定、位置即归属、无卷模式、平面迁移门禁 |
| 设定实体（人物/场景/世界观/伏笔/大纲） | [agents/l2-setting-entities.md](./agents/l2-setting-entities.md) | 三层归属口径、卷级人物、伏笔复合键、大纲标记、字段命名陷阱 |
| 写字台（StatusView 常驻面板） | [agents/l2-writing-desk.md](./agents/l2-writing-desk.md) | 树节点约定、书稿/章节行右键动作、引言入口、状态展示 |
| LLM 对话面板 | [agents/l2-llm-chat-panel.md](./agents/l2-llm-chat-panel.md) | 常驻视图交互、模型切换、流式输出 |
| 人物关系面板 | [agents/l2-relationship-panel.md](./agents/l2-relationship-panel.md) | 卡片/图表双模式、缩放平移、添加人物写动作、数据入口与接线 |
| 时间线面板 | [agents/l2-timeline-panel.md](./agents/l2-timeline-panel.md) | 只读时间轴、画布缩放、双击定位、三层文档枚举 |
| LLM 写作命令（/write /continue /rewrite /polish /review /deai 等） | [agents/l2-llm-writing-commands.md](./agents/l2-llm-writing-commands.md) | 命令语义、生成过程面板、提示词组装分工 |
| 写作指南（创作规范三层） | [agents/l2-writing-guide.md](./agents/l2-writing-guide.md) | 三层优先级、聚合文件唯一注入源、空模板重生成规则 |
| 设置页与 LLM 配置 | [agents/l2-settings-llm-config.md](./agents/l2-settings-llm-config.md) | 声明式设置实现、data.json 约定、激活项双向同步 |
| work_dir 初始化 / 切换小说 / 每本书独立工作区 | [agents/l2-workdir-story-switch.md](./agents/l2-workdir-story-switch.md) | 工作目录等价语义、lastStory 记忆、强制迁移、布局存档 |
| 动 MD 文档格式 / 解析器 / 模板 | [agents/l3-md-docs-parsing.md](./agents/l3-md-docs-parsing.md) | md_docs 全部类型与 parse/format、人物关系/时间线格式、围栏与 safeFilename |
| 动状态文档 / 卷语义 / 章节身份 | [agents/l3-state-and-volumes.md](./agents/l3-state-and-volumes.md) | 目录树、复合键、引言、frontmatter 字段、删除约定、卷/激活语义 |
| 动摘要管线 / 写作上下文窗口 | [agents/l3-summary-pipeline.md](./agents/l3-summary-pipeline.md) | 卷摘要、三层上下文结构、v0.1.4+ 延迟生成与角色范围收窄 |
| 动创作规范三层 / 汇总文件生命周期 | [agents/l3-guide-lifecycle.md](./agents/l3-guide-lifecycle.md) | 三层结构条款、agg-hash 变更检测、空段注释、相关源文件 |
| 新增或修改交互 UI（Modal / 常驻视图） | [agents/l3-view-rendering.md](./agents/l3-view-rendering.md) | Modal 选型表、submitted/resolved 模式、常驻 ItemView 渲染陷阱、文案风格 |
| 改 main.ts / 新增命令 / 查通用辅助方法 | [agents/l3-main-ts-flow.md](./agents/l3-main-ts-flow.md) | 插件入口、新增命令标准流程 7 步、handler 复用清单 |
| 构建 / 打包 / 部署 / Git 提交发布 / CI | [agents/l3-build-deploy.md](./agents/l3-build-deploy.md) | npm run build、release/ 产出、Gitea+GitHub 镜像同步、esbuild/正则/API 兼容坑位 |
| 查各命令的语义 / 参数 / 坑位速查 | [agents/command-reference.md](./agents/command-reference.md) | 命令速查表、移动语义陷阱（updateScene/updateCharacter） |
| 任务收尾（写回 + 验证） | [agents/process-rules.md](./agents/process-rules.md) | 工作更新写回约定、验证要求、CHANGELOG 引用 |

## 推送指南（主仓 → GitHub 镜像，强制）

主仓（Gitea `geng_bl/articlewritter-obsidian`）每次提交并推送代码/文档后，**立即**把改动同步到 GitHub 镜像并在该目录内推送：

1. 把本次改动的文件逐一拷入 `/home/fosky/workspace/articlewriter-obsidian-git/`（GitHub 镜像 `gengbl/articlewriter-obsidian` 的本地克隆；历史为工作树拷贝式独立提交、非主仓 clone，不能直接 push 同一对象）。
2. **所有 git 操作都在 `/home/fosky/workspace/articlewriter-obsidian-git` 里执行**：`git add <显式列出>` + **与主仓同消息** commit + `git push origin main`（SSH remote `git@github.com:gengbl/articlewriter-obsidian.git`）。
3. 发布日另在两个仓库分别打标签并推送：Gitea 带 v 前缀（`v0.0.12`）、GitHub 镜像**无 v 前缀**（`0.0.12`）。向镜像推新 tag 即触发 `.github/workflows/release.yml`——CI 从源码重建、attestation 签名并自动创建/更新 GitHub Release（资产 = `main.js` / `manifest.json` / `styles.css` 三个散文件；写作指南 `WRITING_GUIDE.md` 已全面停止发布——不上 GitHub Release，Gitea zip 亦不再包含（其文本由 `.md=text` 内联进 main.js、首启运行时播种系统级文件）；不上传 zip）。tag 触发的运行取**打 tag 那一刻**的 workflow 文件，改过 CI 须确保改动已包含在被 tag 的 commit 中。

凭据提取陷阱、手动回落方案等细节见 [agents/l3-build-deploy.md](./agents/l3-build-deploy.md)「GitHub 镜像同步（强制）」与 [RELEASE.md](./RELEASE.md)。

## 全局硬规则（任何改动都适用）

- **禁止并行处理**：执行任何任务一律串行——一次只发起一个工具调用 / 操作，拿到其结果后再进行下一步；即便多个操作彼此独立、本可并发，也不得批量或同时发起。逐步推进以便每步可核验、避免相互覆盖的并发改动。
- **代码改动后必须跑通 `npm run build`（tsc 零错误）**；可再 `node --check release/main.js` 兜底。
- **每次有代码变化，必须检查新增/修改行有无冗余类型断言**：接收方已接受原始窄化类型的断言一律删除、直接赋值（连同关联 eslint-disable 注释）；合法保留场景与判定细则见 [agents/process-rules.md](./agents/process-rules.md)「验证要求」。
- **每次有功能/命令/交互修改，必须同步更新对应内置文档**——以下文件均为独立 Markdown、由 esbuild `.md=text` loader 打包进 release/main.js，运行时按需从包内恢复写盘：[docs/使用说明.md](./docs/使用说明.md)（→ work_dir《使用说明.md》，仅缺失/空才写）、根 [WRITING_GUIDE.md](./WRITING_GUIDE.md)（系统级创作规范默认内容，播种到插件数据目录；「重新生成系统写作指南」用它覆盖重置）、[docs/WRITING_GUIDE_template.md](./docs/WRITING_GUIDE_template.md)（用户级/小说级空模板，「生成写作指南」投放；**改动 WRITING_GUIDE.md 段落结构后须用 prompts.ts `buildEmptyGuideTemplate` 重生成它**）。改完文档照常走 npm run build + 部署即可生效。
- 「打包发布」类任务先读 [RELEASE.md](./RELEASE.md)（版本号规则、GitHub 镜像 tag + CI 自动上架流程与坑位；**Gitea 侧无任何自动化工作流——Release + `articlewriter-v<版本>.zip` 附件按 RELEASE.md §step5 Web 会话表单流手动维护**，GitHub CI 只上三个散文件、不传 zip）。
- **发布后必核对 Gitea Release（手动维护）**：每个已打 tag 的版本都要在 Gitea 有对应 Release + `articlewriter-v<版本>.zip` 附件。收尾用 REST API `GET …/releases/tags/v<版本>` 校验其存在且该附件字节数 == 本地同名 zip（`stat -c %s`）；缺失则按 RELEASE.md §step5 走 Web 会话表单流手动补建（纯 API 无法带附件）。实测坑位见 l3-build-deploy.md「Gitea Release」条（临时上传字段名 file / 隐藏域 files=<uuid> / 上传 part 不写显式 ;type= / tag_target 必须为命名 ref 如 main，填 SHA 或留空会触发 invalid-input-type 假报错而静默失败）。凭据坑位：`~/.git-credentials` gitea 行存的是 token——REST Basic 鉴权可通、Web 登录需真实账号密码（token 返回 200 非 303）。详见 [agents/l3-build-deploy.md](./agents/l3-build-deploy.md)。
- 变更历史见 **[CHANGELOG.md](./CHANGELOG.md)**（每次任务收尾向其末尾追加一行，了解历史先读它）。
