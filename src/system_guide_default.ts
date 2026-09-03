/**
 * 系统级写作指南默认内容：唯一来源为仓库根 WRITING_GUIDE.md（预置自 CLI config/WRITING_GUIDE.md，可用「重新生成系统写作指南」覆盖重置）。
 * 构建时由 esbuild 以 text loader 打包进 release/main.js；运行时播种到插件数据目录的 WRITING_GUIDE.md 文件。
 */
import systemGuideMd from "../WRITING_GUIDE.md";

export const DEFAULT_SYSTEM_GUIDE = systemGuideMd;
