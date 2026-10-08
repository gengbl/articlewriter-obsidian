# L2 · 故事结构（书 / 章 / 卷）

## 模块概要

负责书、章、卷的结构操作：建书、建章、卷管理（建/改名/删/分配）、重排章号、按卷整理目录、无卷模式切换、打包、重扫描等。所有结构命令的文件操作集中在 `story_manager.ts`（唯一直接读写 vault 的模块），运行态持久化在 `<书名>/故事状态.md`（frontmatter，磁盘是唯一事实来源）。

## 行为约定

- **位置即归属与编号事实**：章节物理存放于「书根 + 各卷实体目录」，目录名里的 N 是该容器内的本地章号；一切代码内部标识用复合键（根域 `"N"` / 卷域 `"volId:N"`），顺序逻辑一律基于阅读序 ordinal——详见 [l3-state-and-volumes.md](./l3-state-and-volumes.md)「章节身份模型」。
- **卷名唯一且作为目录名**；「引言」为保留名（与书根引言文件夹物理冲突）。
- **新书默认无卷模式**（`use_volumes=false`）；`/volume off` 是破坏性拍平（含卷残留文件 salvage 回书根）。
- **切换书籍检测到平面残留 → 强制自动整理、不可跳过**，失败置 `flatBlocked` 锁定该书结构操作。
- 删除一律走回收站（`trashFile`），角色改名先备份 `_backup/` 再替换。
- 建章/建卷/建书自动播种标准模板文档（缺失补建、绝不覆盖用户内容），模板清单与格式见 [l3-md-docs-parsing.md](./l3-md-docs-parsing.md)。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-state-and-volumes.md](./l3-state-and-volumes.md) | 目录树、章节身份模型、引言、状态文档字段与保存语义、删除约定、卷/当前状态激活语义、相关源文件 |
| L3 | [l3-md-docs-parsing.md](./l3-md-docs-parsing.md) | md_docs 解析器、模板文档（ensureDoc/outlineTemplate）、多行围栏、字段命名陷阱、伏笔、safeFilename |
| L2 | [command-reference.md](./command-reference.md) | 各命令语义/参数/坑位速查（/pack、重排章号、organize-volumes、移动语义陷阱等） |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程 7 步 + main.ts 通用辅助方法 |
