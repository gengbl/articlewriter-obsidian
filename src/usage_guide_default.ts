/**
 * 《使用说明.md》内置默认文本来源：独立文档 docs/使用说明.md（面向 vault 内用户阅读，勿引用插件仓库路径）。
 * 构建时由 esbuild 以 text loader 打包进 release/main.js（见 esbuild.config.mjs），运行时按需写盘投放。
 * 修改使用说明请编辑 docs/使用说明.md；每次功能变更须同步该文件（AGENTS.md 全局硬规则）。
 *
 * 图片占位符 `{{WECHAT_QR}}`（v0.4.10+）：导出前替换为 wikilink `![[articlewriter-wechat-qr.png]]`——
 * Obsidian **阅读模式不渲染 md 内联 data:base64 图片**（试过＝显示空白），所以二维码走**同目录资源文件**：
 * 写《使用说明.md》的同时把 `docs/wechat_qr.png`（esbuild `.png=dataurl` 内联进包，运行时 base64→二进制）
 * 投放到该文档旁边（main.ts `writeUsageDoc`/`ensureUsageQrAsset`），wikilink 按全库最短路径解析。
 * 换二维码＝覆盖 docs/wechat_qr.png（保持文件名）再构建。
 */
import usageGuideMd from "../docs/使用说明.md";
import wechatQrDataUrl from "../docs/wechat_qr.png";

/** 二维码资源文件名（投放到《使用说明.md》同目录；名字带插件前缀避免与用户库内文件撞名） */
export const USAGE_QR_ASSET_NAME = "articlewriter-wechat-qr.png";

/** 包内二维码图片（dataurl＝`data:image/png;base64,…`，写盘时解码为二进制） */
export const USAGE_QR_DATA_URL = wechatQrDataUrl;

/** 替换包内 md 的图片占位符（幂等：md 不含占位符时原样返回） */
export function embedUsageGuideImages(md: string): string {
	return md.replace(/\{\{WECHAT_QR\}\}/g, `![[${USAGE_QR_ASSET_NAME}]]`);
}

export const DEFAULT_USAGE_GUIDE = embedUsageGuideImages(usageGuideMd);
