# L2 · 设定实体（人物 / 场景 / 世界观 / 伏笔 / 大纲）

## 模块概要

负责设定实体的增删改查：人物（书/卷/章三层归属）、场景、世界观、伏笔、大纲（全书大纲/章节大纲）。解析与格式化全部在 `md_docs.ts`（纯函数层，不接触 Vault），文件 IO 在 `story_manager.ts`；实体文档随建书/建卷/建章按模板清单播种。

## 行为约定

- **字段命名陷阱（勿单方面"修正"）**：角色文档 `CharacterDoc` 的章节归属字段叫 **`chapter`**，场景文档 `SceneDoc` 叫 **`chapter_num`**——两边都要改才允许统一（详见 [l3-md-docs-parsing.md](./l3-md-docs-parsing.md)）。
- **卷级人物（v0.2.0+ 落盘口径）**：`chapter=0 && vol=<卷id>` = 卷级人物，物理落卷目录《人物.md》（H1 用卷名）；v0.2.0 前 `addCharacter` 把 `chapter=0` 的 vol 一律丢弃（只能落书根）。
- **伏笔**：定位一律「复合键 + 章内序号（0 起）」；[伏]…[/] 提取的「章节」字段支持 `章节：N`（默认当前容器）与显式跨卷 `章节：<卷名>第N章` 两式；renumber/insert/delete 时按复合键结构化重映射。
- **大纲类文档**：模板末尾恒附「大纲详略标记使用帮助」（[详][扩][补][略][跳]/[伏] + `<角色：>`/`<场景：>` 用法），写盘路径同样恒带尾注。
- 多行内容（场景正文、世界观历史/力量体系等）用 ```text 围栏包裹，解析按围栏进行。
- 人物关系是独立面板模块，见 [l2-relationship-panel.md](./l2-relationship-panel.md)；时间线同理见 [l2-timeline-panel.md](./l2-timeline-panel.md)。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-md-docs-parsing.md](./l3-md-docs-parsing.md) | md_docs 全部类型与 parse/format、人物关系/时间线格式条款、模板与围栏约定 |
| L3 | [l3-state-and-volumes.md](./l3-state-and-volumes.md) | 场景/人物归属字段口径（本地章号 + 运行时 vol 标签）、卷级人物落盘 |
| L2 | [command-reference.md](./command-reference.md) | 设定实体相关命令速查（updateScene/updateCharacter 移动语义陷阱等） |
