# 角色定义
- 你是一个资深的编辑，网文作家
- 你是一个写作助手开发专家
- 你是一个Obsidian插件开发专家

# AGENTS.md（articlewriter-obsidian）— 入口索引

本文件只做路由，不含具体约定。本插件是独立维护的 Obsidian 小说创作工具（确定性文件操作 + LLM 写作命令），行为约定自成体系、见各 `agents/*.md` 子文件。

**执行任务前**：先加载 [agents/l1-overview.md](./agents/l1-overview.md)（项目概述 + 功能地图），按功能地图定位到对应 **L2 模块文档**并遵循其中内容；需要动代码时再按 L2「引用索引（相关文档）」表下钻到对应 **L3 实现细节**。跨多个功能域就都加载。收尾时按 `process-rules.md` 写回对应子文件。

## 三层文档体系（上层 = 说明 + 向下的引用索引）

- **L1 整体功能**（`l1-*.md`）：进一步的功能说明——项目定位、设计决策、功能边界与术语 + 功能地图（L2/L3 的引用索引）。
- **L2 模块功能**（`l2-*.md`）：模块级别说明——每个功能模块的行为约定与交互语义，一模块一文件 + 引用索引表（L3 的引用索引）。
- **L3 实现细节**（`l3-*.md`）：实现说明——源文件职责、数据格式、管线与流程细节，改动代码前必读对应条目。

## L1 索引

| L1 文档 | 覆盖范围 |
| --- | --- |
| [agents/l1-overview.md](./agents/l1-overview.md) | 项目概述与范围、设计决策、明确不做清单、「小说」术语约定、功能地图（L2 模块 → L3 实现细节的入口索引） |

## 横切参考（不属于三层）

| 文档 | 覆盖范围 |
| --- | --- |
| [agents/command-reference.md](./agents/command-reference.md) | 各命令语义/参数/坑位速查表、移动语义陷阱（updateScene/updateCharacter） |
| **等等命令**[agents/code-structure.md](./agents/code-structure.md) | 源码物理结构横切地图：构建产物链、src/ 模块职责与行数、依赖分层、main.ts 内部区块定位、根目录遗留文件、已知重复与债务 |
| **等等命令**[agents/process-rules.md](./agents/process-rules.md) | 任务收尾：工作完成后更新写回约定、验证要求 |
| **等等命令**[PROMPT_MATRIX.md](./PROMPT_MATRIX.md) | 分阶段生成提示词矩阵：阶段 0–3 × 命令 → system/user prompt 来源与行号、上下文注入点、输出解析校验；与 export-ai-prompts 17 节交叉核对（改提示词组装时同步更新） |

## 推送指南（GitHub 镜像，强制）

每次提交并推送代码/文档后，**等待用户指令**把改动同步到 GitHub 镜像并在该目录内推送：

1. 把本次改动的文件逐一拷入 `/home/fosky/workspace/articlewriter-obsidian-git/`（GitHub 镜像 `gengbl/articlewriter-obsidian` 的本地克隆；历史为工作树拷贝式独立提交、非主仓 clone，不能直接 push 同一对象）。
2. **所有 git 操作都在 `/home/fosky/workspace/articlewriter-obsidian-git` 里执行**：`git add <显式列出>` + **与主仓同消息** commit + `git push origin main`（SSH remote `git@github.com:gengbl/articlewriter-obsidian.git`）。
3. 发布日在 GitHub 镜像打标签并推送：**无 v 前缀**（`0.0.12`）。推新 tag 即触发 `.github/workflows/release.yml`——CI 从源码重建、attestation 签名并自动创建/更新 GitHub Release（资产 = `main.js` / `manifest.json` / `styles.css` 三个散文件；写作指南 `WRITING_GUIDE.md` 已全面停止发布——不上 GitHub Release；不上传 zip）。tag 触发的运行取**打 tag 那一刻**的 workflow 文件，改过 CI 须确保改动已包含在被 tag 的 commit 中。

手动回落方案等细节见 [agents/l3-build-deploy.md](./agents/l3-build-deploy.md)「GitHub 镜像同步（强制）」与 [RELEASE.md](./RELEASE.md)。

## 发布流程（标准 vX.Y.Z，严格串行执行）

完整脚本在 [RELEASE.md](./RELEASE.md)「发布打包与上线流程」；此处记录顺序、门禁与易错点：

1. **版本号 bump**：`manifest.json` version = 目标版本；提交消息约定 `vX.Y.Z：<中文功能摘要>`。
2. **发布门禁**（全部通过才继续）：`npm run build`（tsc 零错误）→ `node --check release/main.js` → `npm run lint`（四类 no-unsafe-* 零违规）→ 检查新增/修改行无冗余类型断言。
3. **打 zip**：`cd release && zip ../articlewriter-v<版本>.zip *`（release/ 恰含 main.js / manifest.json / styles.css 三文件），记下字节数（`stat -c %s`）。
4. **GitHub 镜像推送 + tag**：把改动文件拷入 `/home/fosky/workspace/articlewriter-obsidian-git/`，同消息 commit + `push origin main`；**tag `vX.Y.Z` 打在版本号 bump 那个 commit 上**再推送（不指 HEAD）——CI 自动从源码重建、attestation 签名并创建/更新 GitHub Release（仅三个散文件、不传 zip）；等 workflow completed/success 再继续。
5. **GitHub Release 资产核验**：确认 Release 恰为三个散文件且与本地尺寸一致。
6. **tag 后 CHANGELOG 条目**：CHANGELOG.md 末尾追加「CHANGELOG：追加 vX.Y.Z 发布条目」一行（＋相关文档写回）→ commit+push；该提交落在被 tag 的 commit **之后**。
7. **部署 vault**：`release/` 三文件覆盖复制到 `/home/fosky/workspace/geng_bl/.obsidian/plugins/articlewriter/`，md5 核对 main.js 一致；Obsidian 内重载插件生效。

凭据 / CSRF cookie 轮换 / 代理绕行等坑位见 [agents/l3-build-deploy.md](./agents/l3-build-deploy.md)（「API 版本上限」条）与 RELEASE.md「坑位记录」。

## 全局硬规则（任何改动都适用）

- **修改后不立即推送**：每次代码/文档改动完成后，先完成构建验证（`npm run build` + `node --check` + `npm run lint`）并告知用户结果，**等待用户明确发出推送指令后再执行 git commit + push**。不得在用户未确认时自动推送。
- **禁止并行处理**：执行任何任务一律串行——一次只发起一个工具调用 / 操作，拿到其结果后再进行下一步；即便多个操作彼此独立、本可并发，也不得批量或同时发起。逐步推进以便每步可核验、避免相互覆盖的并发改动。
- **代码改动后必须跑通 `npm run build`（tsc 零错误）**；可再 `node --check release/main.js` 兜底。**发布门禁**：提交/发布前 `npm run lint`（eslint 类型感知检测四类 no-unsafe-*：assignment/call/member-access/return）必须零违规，命中任一即不得发布——配置在仓库根 `eslint.config.mjs`，规则与背景见 [RELEASE.md](./RELEASE.md)「发布门禁」节。
- **每次有代码变化，必须检查新增/修改行有无冗余类型断言**：接收方已接受原始窄化类型的断言一律删除、直接赋值（连同关联 eslint-disable 注释）；合法保留场景与判定细则见 [agents/process-rules.md](./agents/process-rules.md)「验证要求」。
- **每次有功能/命令/交互修改，马上更新对应内置文档**——以下文件均为独立 Markdown、由 esbuild `.md=text` loader 打包进 release/main.js，运行时按需从包内恢复写盘：[docs/使用说明.md](./docs/使用说明.md)（→ work_dir《使用说明.md》，仅缺失/空才写）、根 [WRITING_GUIDE.md](./WRITING_GUIDE.md)（系统级创作规范默认内容，播种到插件数据目录；「重新生成系统写作指南」用它覆盖重置）、[docs/WRITING_GUIDE_template.md](./docs/WRITING_GUIDE_template.md)（用户级/小说级空模板，「生成写作指南」投放；**改动 WRITING_GUIDE.md 段落结构后须用 prompts.ts `buildEmptyGuideTemplate` 重生成它**）。改完文档照常走 npm run build + 部署即可生效。
- 「打包发布」类任务先读 [RELEASE.md](./RELEASE.md)（版本号规则、GitHub 镜像 tag + CI 自动上架流程与坑位；GitHub CI 只上三个散文件、不传 zip）。
- **发布后必核对 GitHub Release**：每个已打 tag 的版本都要在 GitHub 有对应 Release，且资产恰为 `main.js` / `manifest.json` / `styles.css` 三个散文件。收尾用 REST API `GET …/releases/tags/v<版本>` 校验其存在；缺失则走手动回落方案（Web UI 上传）。详见 [agents/l3-build-deploy.md](./agents/l3-build-deploy.md)。
- 变更历史见 **推送时修改[CHANGELOG.md](./CHANGELOG.md)**（增加本次修改的汇总，摘要为一到两条记录）。
- **代码重用**：如果有两处或以上有相同功能，马上进行代码的重构把相同功能封装成函数或模块供使用方调用。
- **AGENGS清理**：当功能完成后马上从上下文中去除无关的AGENTS。
- **新功能增加**：有新功能时，新功能的使用和实现描述要下放到L2和L3级别的AGENTS，必要时可以新建L2、L3级文档


