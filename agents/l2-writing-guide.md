# L2 · 写作指南（创作规范三层）

## 模块概要

负责创作规范三层文件（小说级 > 用户级 > 系统级）与各书《写作指南汇总.md》聚合文件：各层查看/编辑、「生成写作指南」投放空模板、「重新生成系统写作指南」覆盖重置、汇总持久化与变更检测。LLM 写作命令与对话注入的【创作规范】**唯一来源**是该书聚合文件（去注释正文）。

## 行为约定

- **优先级降序**：①小说级 `<书名>/WRITING_GUIDE.md` > ②用户级 `<work_dir>/WRITING_GUIDE.md` > ③系统级插件数据目录文件 `.obsidian/plugins/articlewriter/WRITING_GUIDE.md`——系统级路径**固定、非用户可配**（原 `llm.system_guide_path` 设置项已移除，data.json 的 `system_guide` 仅作一次性迁移种子）。
- **聚合文件 = 三层按类目合并落盘**（serializeAggregateGuide + agg-hash md5 变更检测头），仅当三层任一 md5 变化才重算；任一层变更后刷新该书汇总。
- **空指示段自动注释**（commentOutEmptySections）：空小节整体包进 HTML 注释并加引导提示；注入前 stripComments 剥全部注释，这些段落不参与提示词生成（不破坏 agg-hash 幂等）。
- **改动根 WRITING_GUIDE.md 段落结构后须用 prompts.ts `buildEmptyGuideTemplate` 重生成 `docs/WRITING_GUIDE_template.md`**（空模板再导出层，「生成写作指南」投放用）。
- 使用说明《使用说明.md》（work_dir 根）由 seedUsageDoc 在设置/切换工作目录后自动投放（仅缺失或为空写入），手动重建走 `cmdGenerateUsageDoc()`。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-guide-lifecycle.md](./l3-guide-lifecycle.md) | 创作规范三层结构完整条款 + 相关源文件（prompts 创作规范工具 / system_guide_default / guide_template_default / story_manager 插件数据目录 IO） |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | main.ts 创作规范生命周期辅助方法（systemGuidePath/persistAggregatedGuide/rebuildAggregatedGuide/两个命令 handler/使用说明侧） |
| L2 | [command-reference.md](./command-reference.md) | /agents view/edit、生成写作指南等命令速查 |
