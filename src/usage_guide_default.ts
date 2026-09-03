/**
 * 《使用说明.md》内置默认文本来源：独立文档 docs/使用说明.md（面向 vault 内用户阅读，勿引用插件仓库路径）。
 * 构建时由 esbuild 以 text loader 打包进 release/main.js（见 esbuild.config.mjs），运行时按需写盘投放。
 * 修改使用说明请编辑 docs/使用说明.md；每次功能变更须同步该文件（AGENTS.md 全局硬规则）。
 */
import usageGuideMd from "../docs/使用说明.md";

export const DEFAULT_USAGE_GUIDE = usageGuideMd;
