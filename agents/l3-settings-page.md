# L3 · 设置页与 LLM 配置实现细节

设置页与 LLM 配置模块的实现级说明（源文件职责：调用层 / 类型与默认模板 / 设置页声明式实现）；模块级行为见 [l2-settings-llm-config.md](./l2-settings-llm-config.md)。

## 相关源文件

| 文件 | 职责 |
| --- | --- |
| `src/llm_client.ts` | LLM 调用层（openai SDK v7，esbuild 打包进 bundle）：`normalizeBaseURL`（base_url 未含 /vN 自动补 /v1）+ `createClient`（无 api_key 时用占位值过 SDK 校验，本地服务忽略该头）+ `testConnection`（GET /models）+ `chatCompletion`/`chatStream`（流式逐块回调）。配置来源=插件 data.json 中 active_llm 指向的配置。注意 openai v7 类型走 `OpenAI.Xxx` 命名空间导入，流式 create 需显式断言 `ChatCompletionCreateParamsStreaming` 重载。buildParams 返回本地接口 `LlmChatBody`（含 `[k:string]:unknown` 索引签名以透传 openai_extras、`model?:string` 允许本地服务留空）而非 `as any`——新增请求体字段要么在接口里声明、要么靠该签名兜底，勿回退到 any |
| `src/plugin_config.ts` | LLM 配置类型与默认模板：`LlmConfigDoc` + `PluginConfig`（active_llm/llm_configs/system_prompt/desc_style/system_guide）+ `buildDefaultLlmConf()`（首次运行预置 local/deepseek/qwen-dashscope 三组标准模板，api_key/model_name 留空待填；`system_guide`/`system_guide_path` 为历史遗留字段——系统级写作指南已迁至插件数据目录文件 `WRITING_GUIDE.md`，data.json 内嵌值仅作首启一次性迁移种子、运行时不再读取，设置页对应行亦已移除）。载体为 Obsidian 标准插件数据目录 `data.json`（saveData/loadData），不再使用 MD 文件 |
| `src/main.ts`（设置页部分） | **设置页为声明式单实现** `getSettingDefinitions()`+`getControlValue/setControlValue`；因该 API @since 1.13.0、`fileManager.trashFile` @since 1.6.6，v0.0.7 起 manifest minAppVersion 由 1.4.0→**1.13.0**（社区插件目录校验规则 obsidianmd/no-unsupported-api 的硬性要求）——当前 manifest 下框架恒走声明式路径；pre-1.13 的已废弃 `display()/renderLlm()` 渲染路径已删除（校验器禁 deprecated API，勿再引入；连带移除 llmSelName 状态与孤儿 Setting import）。key 约定：顶层 `workDir`/`autoOpenOnCreate`/`prevChapters`(v0.1.4+ 前文参考章数 N，留空=默认 3)；全局 `llm.active_llm`/`system_prompt`/`desc_style`（系统级写作指南路径**固定**为插件数据目录文件，非用户可配——原 `llm.system_guide_path` 设置行已移除）；每份配置 `cfg.<数组下标>.<field>`（用下标而非 name 避免解析歧义，增删/重排后靠 `update()` 重建）。模型配置渲染为 list+子页（支持新建 config-N/删除[激活项被删则回落第一个]/拖拽重排 + 每页「设为激活」「测试连接」动作行）；数值字段 temperature/max_tokens 仍用 text 控件在 setControlValue 里 parse（空=undefined，对齐旧 UI，不用 number 控件以免空值被强转 0） |
