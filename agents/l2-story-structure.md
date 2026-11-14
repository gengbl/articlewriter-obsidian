# L2 · 故事结构（书 / 章 / 卷）

## 模块概要

负责书、章、卷的结构操作：建书、建章、卷管理（建/改名/删/分配）、重排章号、按卷整理目录、无卷模式切换、打包、重扫描等。所有结构命令的文件操作集中在 `story_manager.ts`（唯一直接读写 vault 的模块），运行态持久化在 `<书名>/故事状态.md`（frontmatter，磁盘是唯一事实来源）。

## 行为约定

- **物理布局（v0.2.22+）**：书内分两个系统容器——`案头资料/`（书级文档十件套 + 用户自建资料/文件夹）与 `书稿/`（`引言/`、章节目录、有卷模式下的 `<卷名>/` 卷目录）；卷目录直属文档统一收进 `<卷名>/文档/`（裸基名）。平铺（无卷）模式**不建** `书稿/文档/`。系统文件（`故事状态.md`/`story_state.json`/`AI提示词/`/`_backup/`/`卷.md`）留书根不动（`ROOT_SYSTEM_NAMES`；**v0.3.5+** 旧书根 `WRITING_GUIDE.md`/`写作指南汇总.md` 已随写作指南体系废弃、存量启动时自动清理）。详见 [l3-state-and-volumes.md](./l3-state-and-volumes.md)「目录树」。
- **旧格式自动迁移**：首次触达旧布局书籍时自动把书根散落文档搬入 `案头资料/`、`引言/`→`书稿/引言/`、卷目录→`书稿/<卷名>/`（直属文档归 `文档/`）、书根章节目录→`书稿/`；幂等可重跑，失败不缓存下次重试——详见 [l3-state-and-volumes.md](./l3-state-and-volumes.md)「旧布局自动迁移」。
- **位置即归属与编号事实**：章节物理存放于「`书稿/` + 各卷实体目录」，目录名里的 N 是该容器内的本地章号；一切代码内部标识用复合键（根域 `"N"` / 卷域 `"volId:N"`），顺序逻辑一律基于阅读序 ordinal——详见 [l3-state-and-volumes.md](./l3-state-and-volumes.md)「章节身份模型」。
- **卷名唯一且作为目录名**；「引言」为保留名（与书稿引言文件夹物理冲突）。
- **新书默认无卷模式**（`use_volumes=false`）；`/volume off` 是破坏性拍平（含卷残留文件 salvage 回 `案头资料/`）。
- **切换书籍检测到平面残留 → 强制自动整理、不可跳过**，失败置 `flatBlocked` 锁定该书结构操作。
- **「补全故事状态可用参数」（`state-complete`）升级旧故事状态文档**：把 frontmatter 缺失的书级提示词组装选项（`prev_chapters`/`next_chapters`（v0.4.3+）/`include_volume_summary`/`word_range`）逐项询问（预填当前全局生效值）后显式补写；均已显式设置仅提示不写盘，Esc 取消不落盘；详见 [l3-state-and-volumes.md](./l3-state-and-volumes.md)。
- 删除一律走回收站（`trashFile`），角色改名先备份 `_backup/` 再替换。
- 建章/建卷/建书自动播种标准模板文档（缺失补建、绝不覆盖用户内容），模板清单与格式见 [l3-md-docs-parsing.md](./l3-md-docs-parsing.md)。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-state-and-volumes.md](./l3-state-and-volumes.md) | 目录树、章节身份模型、引言、状态文档字段与保存语义、删除约定、卷/当前状态激活语义、相关源文件 |
| L3 | [l3-md-docs-parsing.md](./l3-md-docs-parsing.md) | md_docs 解析器、模板文档（ensureDoc/outlineTemplate）、多行围栏、字段命名陷阱、伏笔、safeFilename |
| L2 | [command-reference.md](./command-reference.md) | 各命令语义/参数/坑位速查（/pack、重排章号、organize-volumes、移动语义陷阱等） |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程 7 步 + main.ts 通用辅助方法 |
