/**
 * 《使用说明.md》版本戳（v0.4.7+）：纯模块——内置说明文本的版本戳读写与「是否需要按当前插件版本重建」判定。
 * 插件每次启动比对文件里的版本戳：缺失/与当前版本不一致 → 用包内 `DEFAULT_USAGE_GUIDE` 重新生成并打开
 * （用户决策：直接覆盖、不留备份）。戳写成 HTML 注释（阅读模式不可见）＋一行可见「自动生成」提示，
 * 由 stampUsageDoc 一并产出；重复 stamp 会先剥掉旧戳与旧提示行，保证幂等。
 */

/** 版本戳注释（放文件最前）：`<!-- articlewriter:usage-doc-version 0.4.7 -->` */
const STAMP_RE = /<!--\s*articlewriter:usage-doc-version\s+([0-9][^\s>]*)\s*-->/;

/** 可见提示行（紧跟戳之后）：重建说明时刷新版本号；剥旧戳时一并剥掉，防多次重建叠加多行 */
const NOTICE_RE = /^>[^\n]*本文档由 ArticleWriter 自动生成[^\n]*\r?\n?/m;

/** 生成说明文档正文：注释戳＋可见提示行＋内置正文（内置正文本身不含戳，故直接前置即可；先剥再贴保证幂等） */
export function stampUsageDoc(body: string, version: string): string {
	const bare = body.replace(STAMP_RE, "").replace(NOTICE_RE, "").replace(/^\s+/, "");
	return `<!-- articlewriter:usage-doc-version ${version} -->\n> 本文档由 ArticleWriter 自动生成（插件版本 ${version}）：插件升级后会自动重写本文件，需要长期保留的个人笔记请另建文档。\n\n${bare}`;
}

/** 读回文件里的版本戳；无戳（旧版插件写的/用户自建的同名文档）返回 null */
export function usageDocVersion(text: string): string | null {
	const m = STAMP_RE.exec(text);
	return m ? m[1] : null;
}

/** 是否需要按 version 重建：文件不存在/为空＝需要；无戳＝需要（旧文件一次性升级）；戳版本≠version＝需要 */
export function usageDocNeedsRegen(existing: string | null, version: string): boolean {
	if (existing == null || !existing.trim()) return true;
	return usageDocVersion(existing) !== version;
}
