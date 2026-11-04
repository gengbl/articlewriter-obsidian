# 角色定义
- 你是一个资深的编辑，网文作家
- 你是一个写作助手开发专家
- 你是一个Obsidian插件开发专家

# AGENTS.md（articlewriter-obsidian）— 入口索引

本文件只做路由，不含具体约定。本插件是独立维护的 Obsidian 小说创作工具（确定性文件操作 + LLM 写作命令），行为约定自成体系、见各 `agents/*.md` 子文件。

**执行任务前**：先加载 [agents/l1-overview.md](./agents/l1-overview.md)（项目概述 + 功能地图），按功能地图定位到对应 **L2 模块文档**并遵循其中内容；需要动代码时再按 L2「引用索引（相关文档）」表下钻到对应 **L3 实现细节**。跨多个功能域就都加载。收尾时按 `process-rules.md` 写回对应子文件 + CHANGELOG.md。

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
| [agents/process-rules.md](./agents/process-rules.md) | 任务收尾：工作更新写回约定、验证要求、CHANGELOG 引用 |

## 推送指南（主仓 → GitHub 镜像，强制）

主仓（Gitea `geng_bl/articlewritter-obsidian`）每次提交并推送代码/文档后，**立即**把改动同步到 GitHub 镜像并在该目录内推送：

1. 把本次改动的文件逐一拷入 `/home/fosky/workspace/articlewriter-obsidian-git/`（GitHub 镜像 `gengbl/articlewriter-obsidian` 的本地克隆；历史为工作树拷贝式独立提交、非主仓 clone，不能直接 push 同一对象）。
2. **所有 git 操作都在 `/home/fosky/workspace/articlewriter-obsidian-git` 里执行**：`git add <显式列出>` + **与主仓同消息** commit + `git push origin main`（SSH remote `git@github.com:gengbl/articlewriter-obsidian.git`）。
3. 发布日另在两个仓库分别打标签并推送：Gitea 带 v 前缀（`v0.0.12`）、GitHub 镜像**无 v 前缀**（`0.0.12`）。向镜像推新 tag 即触发 `.github/workflows/release.yml`——CI 从源码重建、attestation 签名并自动创建/更新 GitHub Release（资产 = `main.js` / `manifest.json` / `styles.css` 三个散文件；写作指南 `WRITING_GUIDE.md` 已全面停止发布——不上 GitHub Release，Gitea zip 亦不再包含（其文本由 `.md=text` 内联进 main.js、首启运行时播种系统级文件）；不上传 zip）。tag 触发的运行取**打 tag 那一刻**的 workflow 文件，改过 CI 须确保改动已包含在被 tag 的 commit 中。

凭据提取陷阱、手动回落方案等细节见 [agents/l3-build-deploy.md](./agents/l3-build-deploy.md)「GitHub 镜像同步（强制）」与 [RELEASE.md](./RELEASE.md)。

## 发布流程（标准 vX.Y.Z，严格串行执行）

完整脚本在 [RELEASE.md](./RELEASE.md)「发布打包与上线流程」；此处记录顺序、门禁与易错点：

1. **版本号 bump**：`manifest.json` version = 目标版本；两仓提交消息约定 `vX.Y.Z：<中文功能摘要>`（同消息同步）。
2. **发布门禁**（全部通过才继续）：`npm run build`（tsc 零错误）→ `node --check release/main.js` → `npm run lint`（四类 no-unsafe-* 零违规）→ 检查新增/修改行无冗余类型断言。
3. **打 zip**：`cd release && zip ../articlewriter-v<版本>.zip *`（release/ 恰含 main.js / manifest.json / styles.css 三文件），记下字节数（`stat -c %s`）。
4. **Gitea 主仓推送 + tag**：一切 Gitea git 操作在专用克隆 `/tmp/opencode/aw-gitea` 内执行——本地工作树 `.git` 的 origin 指向 GitHub、历史为拷贝式独立提交（同消息不同 SHA、与 Gitea 无共同祖先），从它或镜像目录直推必被 non-fast-forward 拒绝，禁止 force push。流程：改动文件逐一拷入克隆 → 显式 `git add` → 同消息 commit → `push origin main` → **tag `vX.Y.Z` 打在版本号 bump 那个 commit 上**再推送（不指 HEAD）。
5. **GitHub 镜像同步 + CI 上架**：同一批文件拷入 `/home/fosky/workspace/articlewriter-obsidian-git/`，同消息 commit + `push origin main`；随后推**无 v 前缀** tag `<版本>`——CI 自动从源码重建、attestation 签名并创建/更新 GitHub Release（仅三个散文件、不传 zip）；等 workflow completed/success 再继续。
6. **Gitea Release 手动创建**：REST API 无法带附件，必须走 Web 会话表单流（脚本见 RELEASE.md §step5）；整条链每个 curl 都带 `-b $CJ -c $CJ`；submit 返回 303 才算成功（上传端点返回 uuid 不代表 submit 会过）。
7. **双端资产核验**：Gitea REST `GET …/releases/tags/v<版本>` 确认附件字节数 == 本地 zip；GitHub Release 恰为三个散文件且与本地尺寸一致。
8. **tag 后 CHANGELOG 条目**：CHANGELOG.md 末尾追加「CHANGELOG：追加 vX.Y.Z 发布条目」一行（＋相关文档写回）→ 两仓各自 commit+push；该提交落在被 tag 的 commit **之后**。
9. **部署 vault**：`release/` 三文件覆盖复制到 `/home/fosky/workspace/geng_bl/.obsidian/plugins/articlewriter/`，md5 核对 main.js 一致；Obsidian 内重载插件生效。

凭据 / CSRF cookie 轮换 / 代理绕行等坑位见 [agents/l3-build-deploy.md](./agents/l3-build-deploy.md)（「Gitea Release」「API 版本上限」条）与 RELEASE.md「坑位记录」。

## 全局硬规则（任何改动都适用）

- **禁止并行处理**：执行任何任务一律串行——一次只发起一个工具调用 / 操作，拿到其结果后再进行下一步；即便多个操作彼此独立、本可并发，也不得批量或同时发起。逐步推进以便每步可核验、避免相互覆盖的并发改动。
- **代码改动后必须跑通 `npm run build`（tsc 零错误）**；可再 `node --check release/main.js` 兜底。**发布门禁**：提交/发布前 `npm run lint`（eslint 类型感知检测四类 no-unsafe-*：assignment/call/member-access/return）必须零违规，命中任一即不得发布——配置在仓库根 `eslint.config.mjs`，规则与背景见 [RELEASE.md](./RELEASE.md)「发布门禁」节。
- **每次有代码变化，必须检查新增/修改行有无冗余类型断言**：接收方已接受原始窄化类型的断言一律删除、直接赋值（连同关联 eslint-disable 注释）；合法保留场景与判定细则见 [agents/process-rules.md](./agents/process-rules.md)「验证要求」。
- **每次有功能/命令/交互修改，必须同步更新对应内置文档**——以下文件均为独立 Markdown、由 esbuild `.md=text` loader 打包进 release/main.js，运行时按需从包内恢复写盘：[docs/使用说明.md](./docs/使用说明.md)（→ work_dir《使用说明.md》，仅缺失/空才写）、根 [WRITING_GUIDE.md](./WRITING_GUIDE.md)（系统级创作规范默认内容，播种到插件数据目录；「重新生成系统写作指南」用它覆盖重置）、[docs/WRITING_GUIDE_template.md](./docs/WRITING_GUIDE_template.md)（用户级/小说级空模板，「生成写作指南」投放；**改动 WRITING_GUIDE.md 段落结构后须用 prompts.ts `buildEmptyGuideTemplate` 重生成它**）。改完文档照常走 npm run build + 部署即可生效。
- 「打包发布」类任务先读 [RELEASE.md](./RELEASE.md)（版本号规则、GitHub 镜像 tag + CI 自动上架流程与坑位；**Gitea 侧无任何自动化工作流——Release + `articlewriter-v<版本>.zip` 附件按 RELEASE.md §step5 Web 会话表单流手动维护**，GitHub CI 只上三个散文件、不传 zip）。
- **发布后必核对 Gitea Release（手动维护）**：每个已打 tag 的版本都要在 Gitea 有对应 Release + `articlewriter-v<版本>.zip` 附件。收尾用 REST API `GET …/releases/tags/v<版本>` 校验其存在且该附件字节数 == 本地同名 zip（`stat -c %s`）；缺失则按 RELEASE.md §step5 走 Web 会话表单流手动补建（纯 API 无法带附件）。实测坑位见 l3-build-deploy.md「Gitea Release」条（临时上传字段名 file / 隐藏域 files=<uuid> / 上传 part 不写显式 ;type= / tag_target 必须为命名 ref 如 main，填 SHA 或留空会触发 invalid-input-type 假报错而静默失败）。凭据坑位：`~/.git-credentials` gitea 行的值可能是 token 也可能是真实密码，行为随 Gitea 服务端状态变化——REST Basic 鉴权一般可通；Web 登录先试一次看是否 303（以 token 当密码会返回 200 而非 303），失败再向用户要密码。详见 [agents/l3-build-deploy.md](./agents/l3-build-deploy.md)「Gitea Release」条。
- 变更历史见 **[CHANGELOG.md](./CHANGELOG.md)**（每次任务收尾向其末尾追加一行，了解历史先读它）。
