# AGENTS.md（articlewriter-obsidian）— 入口索引

本文件只做路由，不含具体约定。行为语义的最终依据是 Python 原版项目 `/home/fosky/workspace/articlewriter/`（其 `AGENTS.md` + 源码）；本插件是其功能集的 Obsidian 移植版（确定性文件操作 + LLM 写作命令）。

**执行任务前**：先按下方路由表判断要改哪个功能域，加载对应的 `agents/*.md` 子文件并遵循其中内容后再动手；跨多个功能域就都加载。收尾时按 `process-rules.md` 写回对应子文件 + CHANGELOG.md。

## 功能域 → 子文件路由表

| 你要做的事 | 加载文件 | 覆盖范围 |
| --- | --- | --- |
| 判断需求是否在移植范围内 / 术语与边界 | [agents/scope.md](./agents/scope.md) | 项目概述与范围、与 CLI 的有意差异、明确未移植项、「小说」术语约定 |
| 构建 / 打包 / 部署 / Git 提交发布 / CI | [agents/build-deploy.md](./agents/build-deploy.md) | npm run build、release/ 产出、Gitea+GitHub 镜像同步、esbuild/正则/API 兼容坑位 |
| 改任何 src 模块 / 新增命令 / 加 Modal 数据流 | [agents/code-structure.md](./agents/code-structure.md) | 各 src 文件职责、新增命令标准流程、main.ts 通用辅助方法（一律复用） |
| 动文档格式 / 状态文档 / 创作规范三层 / LLM 配置存储 | [agents/data-model.md](./agents/data-model.md) | 目录结构、故事状态.md frontmatter、卷/当前章激活语义、data.json 约定 |
| 对齐某条命令行为 / 查插件↔CLI 对照 | [agents/command-reference.md](./agents/command-reference.md) | 已移植命令速查表、移动语义陷阱（updateScene/updateCharacter） |
| 新增或修改交互 UI（Modal / 常驻视图） | [agents/ui-conventions.md](./agents/ui-conventions.md) | Modal 选型表、submitted/resolved 模式、文案风格 |
| work_dir 初始化 / 切换小说相关逻辑 | [agents/workdir-behavior.md](./agents/workdir-behavior.md) | `/pwd`、`/dir` 等价语义，lastStory 记忆规则 |
| 任务收尾（写回 + 验证） | [agents/process-rules.md](./agents/process-rules.md) | 工作更新写回约定、验证要求、CHANGELOG 引用 |

## 全局硬规则（任何改动都适用）

- **代码改动后必须跑通 `npm run build`（tsc 零错误）**；可再 `node --check release/main.js` 兜底。
- 「打包发布」类任务先读 [RELEASE.md](./RELEASE.md)（版本号规则、GitHub 镜像 tag + CI 自动上架流程与坑位；Gitea Release 仍按版本手动维护但不建任何自动化工作流，GitHub CI 不上传 zip）。
- 变更历史见 **[CHANGELOG.md](./CHANGELOG.md)**（每次任务收尾向其末尾追加一行，了解历史先读它）。
