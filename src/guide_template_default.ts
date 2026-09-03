/**
 * 用户级 / 小说级写作指南空模板（仅段名+结构标记）：唯一来源为 docs/WRITING_GUIDE_template.md。
 * 与系统级同格式——若改动 WRITING_GUIDE.md 的段落结构须同步重生成该文件（AGENTS.md 全局硬规则）。
 * 构建时由 esbuild 以 text loader 打包进 release/main.js；「生成写作指南」命令从包内恢复写盘。
 */
import emptyTemplateMd from "../docs/WRITING_GUIDE_template.md";

export const EMPTY_GUIDE_TEMPLATE = emptyTemplateMd;
