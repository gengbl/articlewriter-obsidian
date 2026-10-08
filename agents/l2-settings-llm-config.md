# L2 · 设置页与 LLM 配置

## 模块概要

- **LLM 配置存插件数据目录 `data.json`**（`.obsidian/plugins/articlewriter/data.json`，经 saveData/loadData）：`settings.llm` = `PluginConfig`（`active_llm` + `llm_configs[]` + `system_prompt` + `desc_style` + `system_guide`/`system_guide_path`[历史遗留字段：系统级已迁插件数据目录文件、运行时不再读取，仅作首启播种种子]，见 [l3-guide-lifecycle.md](./l3-guide-lifecycle.md)「创作规范三层结构」），类型与默认模板在 `src/plugin_config.ts`。首次运行（data.json 无 llm 段）由 `buildDefaultLlmConf()` 预置 local/deepseek/qwen-dashscope 三组标准模板并弹通知提示填写 api_key/model_name；**不读取也不迁移旧的 work_dir MD 设置文档**（该方案已废弃）。**api_key 明文存于 data.json——勿将 .obsidian 同步/共享到不可信位置**。所有 LLM 命令读配置一律走 `getLlmSetup()`（激活项+全局字段），不再依赖 work_dir。**v0.2.0+ 激活项双向同步**：LLM 对话框顶部下拉切换模型即写回 `llm.active_llm` 并落盘（`main.ts setActiveLlmFromChat` → `saveSettings`），写作命令/连接测试读同一激活项故**下一次命令立即生效**、Obsidian 重启后对话框与写作命令都按它加载；反向由设置页驱动——改「当前激活配置」下拉 / 点「设为激活」/新建 / 删除 / 排序后调 `main.ts syncChatModelSelect()` 让已打开的对话框下拉跟随（`LlmChatView.refreshModels` 一律以 `active_llm` 为选中依据，不再"优先保持原选择"，因此两边永远指向同一个模型）。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-settings-page.md](./l3-settings-page.md) | 设置页与 LLM 配置实现细节（调用层 / 类型默认模板 / 设置页声明式实现） |
| L3 | [l3-guide-lifecycle.md](./l3-guide-lifecycle.md) | 创作规范三层结构（system_guide 遗留字段迁移史、插件数据目录播种） |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程、main.ts 通用辅助方法（设置页 handler 复用） |
