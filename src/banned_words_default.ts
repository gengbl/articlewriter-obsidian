/**
 * 禁用词清单默认内容：唯一来源为仓库根 BANNED_WORDS.md。
 * 构建时由 esbuild 以 text loader 打包进 release/main.js；运行时播种到插件数据目录的 BANNED_WORDS.md 文件，
 * 仅在该文件缺失时作为播种内容参考——运行时只使用盘上文件内容（正文写作/AI词检测路径的唯一词表来源）。
 */
import bannedWordsMd from "../BANNED_WORDS.md";

export const DEFAULT_BANNED_WORDS_MD = bannedWordsMd;
