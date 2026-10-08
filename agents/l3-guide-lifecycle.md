# L3 · 创作规范三层与汇总文件生命周期

## 创作规范三层结构

- **创作规范三层结构**（优先级降序）：①小说级 `<书名>/WRITING_GUIDE.md` > ②用户级 `<work_dir>/WRITING_GUIDE.md` > ③系统级 **插件数据目录文件** `.obsidian/plugins/articlewriter/WRITING_GUIDE.md`（首启由 data.json 内嵌值或内置默认播种，见 `src/system_guide_default.ts`；读不到回落内置默认）。系统级路径**固定、非用户可配**——原 `llm.system_guide_path`（vault 相对路径覆盖）设置项已移除，data.json 的 `system_guide` 仅作一次性迁移种子。view：各层直接打开对应文件，仅一层直开 / 多层弹选择器 / 全无则提示「用编辑创建」；edit 选层后全量保存（缺失新建 / 存在覆盖），任一层变更后刷新该书《写作指南汇总》。**每书聚合文件 `<书名>/写作指南汇总.md`** = 三层按类目合并落盘（serializeAggregateGuide + agg-hash md5 变更检测头），是 LLM 写作命令与对话注入【创作规范】的**唯一来源**（stripComments 去注释正文）；仅当三层任一 md5 变化才重算。**空指示段自动注释**：序列化前各分类经 `commentOutEmptySections`——标题下到下一同级/更高级标题间无任何内容行的小节整体包进 HTML 注释（围栏内 # 不当标题、水平线不算内容；父节为空时含嵌套子标题一次成块，相邻空段合并一片），上方加一条提示注释引导用户回 WRITING_GUIDE.md 填写；因注入前 stripComments 剥全部注释，这些段落不参与提示词生成（变换是三层输入的确定函数，不破坏 agg-hash 幂等）。

## 相关源文件

| 文件 | 职责 |
| --- | --- |
| `src/prompts.ts`（创作规范工具部分） | **纯函数·创作规范工具**：`buildEmptyGuideTemplate(src)`（状态机抽取段名骨架：保留头部注释块/字数配置/分类±闭合标记/全部 ##/### 标题，清空正文与非结构注释；现仅用于离线重生成 `docs/WRITING_GUIDE_template.md`——运行时空模板走打包内联的 EMPTY_GUIDE_TEMPLATE）、`serializeAggregateGuide(merged)`（把 mergeGuideCategories 结果序列化为可再解析 MD：通用裸放、其余分类用「<!-- 写作指南分类:X -->…」包裹，喂回 extract/merge 即幂等）、`AGG_TITLE` + `AggHashes`/`aggHashLine`/`embedAggHash`/`parseAggHash`（《写作指南汇总》变更检测头，注入前被 stripComments 剥掉）。提示词组装部分见 [l2-llm-writing-commands.md](./l2-llm-writing-commands.md) 与 [l3-summary-pipeline.md](./l3-summary-pipeline.md) |
| `src/system_guide_default.ts` | 系统级写作指南**内置默认文本再导出层**：唯一来源为仓库根 [WRITING_GUIDE.md](../WRITING_GUIDE.md)，esbuild `.md=text` loader 打包进 release/main.js，改文档直接编辑该 md。DEFAULT_SYSTEM_GUIDE 作三处来源——①首启播种插件数据目录的 WRITING_GUIDE.md 文件（缺失时）、②「重新生成系统写作指南」命令的覆盖源、③离线重生成空模板脚本的输入。仍为三层中最低优先级层，可经 `/agents edit`「系统级」或上述重置命令改动落盘文件 |
| `src/guide_template_default.ts` | 用户级/小说级写作指南**空模板再导出层**：唯一来源 [docs/WRITING_GUIDE_template.md](../docs/WRITING_GUIDE_template.md)（仅段名+结构标记，与系统级同格式；由 buildEmptyGuideTemplate 一次性生成）。EMPTY_GUIDE_TEMPLATE 供「生成写作指南」命令对 work_dir 与当前书各投放一份（已存在非空则跳过） |
| `src/story_manager.ts`（插件数据目录文件 IO 部分） | 另含**插件数据目录裸文件 IO**——`pluginFileExists(path)`/`readPluginFile(path)`/`writePluginFile(path,text)`，走 `vault.adapter`（`.obsidian/plugins/<id>/WRITING_GUIDE.md` 不被 metadata cache 索引，不能用 getFileCache/读 TFile），供系统级写作指南生命周期使用。其余部分见 [l3-state-and-volumes.md](./l3-state-and-volumes.md)、[l3-summary-pipeline.md](./l3-summary-pipeline.md)、[l2-relationship-panel.md](./l2-relationship-panel.md)、[l2-timeline-panel.md](./l2-timeline-panel.md) |
