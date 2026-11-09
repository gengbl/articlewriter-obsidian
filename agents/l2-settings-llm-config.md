# L2 · 设置页与 LLM 配置

## 模块概要

- **LLM 配置存插件数据目录 `data.json`**（`.obsidian/plugins/articlewriter/data.json`，经 saveData/loadData）：`settings.llm` = `PluginConfig`（`chat_model`〔对话框模型〕+ `active_llm`〔旧版激活态，仅作对话框模型回落〕+ `llm_configs[]` + `system_prompt` + `desc_style` + `system_guide`/`system_guide_path`[历史遗留字段：系统级已迁插件数据目录文件、运行时不再读取，仅作首启播种种子]，见 [l3-guide-lifecycle.md](./l3-guide-lifecycle.md)「创作规范三层结构」），类型与默认模板在 `src/plugin_config.ts`。首次运行（data.json 无 llm 段）由 `buildDefaultLlmConf()` 预置 local/deepseek/qwen-dashscope 三组标准模板并弹通知提示填写 api_key/model_name；**不读取也不迁移旧的 work_dir MD 设置文档**（该方案已废弃）。**api_key 明文存于 data.json——勿将 .obsidian 同步/共享到不可信位置**。所有 LLM 命令读配置一律走 `getPhaseLlmSetup(phaseIndex)`（按所属写作阶段取模型；回退链＝该阶段 `llm_config_name` → 第一个配置 `cfgs[0]`，对话框 `chat_model` 与旧版激活态 `active_llm` 均不参与阶段回退；无可用配置返回 null、不弹通知），不再依赖 work_dir（旧 `getLlmSetup()`/`loadWriterSetup()` 全局激活入口已删除）。**v0.2.22+ 对话框模型同步**：LLM 对话框顶部下拉切换模型即写回 `llm.chat_model` 并落盘（`main.ts setActiveLlmFromChat` → `saveSettings`）；对话框模型**只影响对话框自身**——写作命令/连接测试各按所属阶段映射取模型（getPhaseLlmSetup）、不受其影响；反向由设置页驱动——改「LLM 全局设置」组的对话框模型下拉 / 新建 / 删除 / 重命名配置后调 `main.ts syncChatModelSelect()` 让已打开的对话框下拉跟随（`LlmChatView.refreshModels` 一律以 `chat_model || active_llm` 为选中依据）。每配置页「设为激活」写 `active_llm`（旧版激活态），仅在对话框 `chat_model` 留空时作回落、不影响任何写作阶段。**v0.2.21+ 多值配置项改下拉框**：每份配置的 `reasoning_effort`（留空/none/low/medium/high/max）与 `thinking`（留空/on/off）由文本输入改为下拉框——取值集合封闭、手填易错；存量值不在标准集时动态并入选项并标「（存量值）」防丢失（实现细节见 [l3-settings-page.md](./l3-settings-page.md)）。**v0.2.22+ 写作阶段模型配置**：`writing_phases[]` 字段定义四阶段（0=策划方案生成 / 1=书籍大纲和卷级大纲生成 / 2=文章大纲生成 / 3=编写文章）各自使用的模型配置名（留空=回落第一个配置 `cfgs[0]`，`active_llm`/`chat_model` 均不参与回落），设置页「写作阶段模型配置」区块每阶段一个下拉框列出所有已配置模型供选择。全部 LLM 命令（含章节/卷摘要生成、剧本转换、连接测试等辅助任务）按所属阶段调用 `getPhaseLlmSetup(phaseIndex)` 获取对应配置（完整阶段分类见 [l2-llm-writing-commands.md](./l2-llm-writing-commands.md)「v0.2.22+ 全部 LLM 调用按写作阶段取模型（阶段分类）」）。

## 引用索引（相关文档）

| 层 | 文件 | 承载内容 |
| --- | --- | --- |
| L3 | [l3-settings-page.md](./l3-settings-page.md) | 设置页与 LLM 配置实现细节（调用层 / 类型默认模板 / 设置页声明式实现） |
| L3 | [l3-guide-lifecycle.md](./l3-guide-lifecycle.md) | 创作规范三层结构（system_guide 遗留字段迁移史、插件数据目录播种） |
| L3 | [l3-main-ts-flow.md](./l3-main-ts-flow.md) | 新增命令标准流程、main.ts 通用辅助方法（设置页 handler 复用） |
