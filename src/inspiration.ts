/**
 * v0.4.3+ 「灵感工具包」——书级《案头资料/灵感/灵感.md》的**纯数据结构＋纯解析/渲染**，不做 IO（IO 在 main.ts）。
 *
 * 文档形态：一级标题＝文档头（说明＋用法），每条灵感＝一个**二级标题块**
 *   `## 灵感名 · YYYY-MM-DD` → 标题下的正文（块内允许 ### 及更深层小节，它们属于本块、不再切块）。
 * 为什么单文件多块：用户要的是一处攒所有灵感、按名与日期快速跳到/删除/追加；拆成每灵感一文件会让「定位」变成开一堆标签页。
 * 块标题里的日期＝新增那天的本地日期（YYYY-MM-DD），不给灵感名时名字用「未命名」。
 * 正文模板走系统技能 `SKILLS/灵感模板.md`（DEFAULT_SKILLS 播种、用户可编辑），占位符 {{name}}/{{date}}/{{time}}。
 */

/** 灵感文件夹名（在书级《案头资料/》下） */
export const INSPIRATION_FOLDER_NAME = "灵感";
/** 灵感文件名（全部灵感块都在这一份文件里） */
export const INSPIRATION_DOC_NAME = "灵感.md";
/** 灵感模板块＝系统技能名（SKILLS/灵感模板.md，用户可编辑；缺失时回落内置 DEFAULT_SKILLS） */
export const INSPIRATION_SKILL_NAME = "灵感模板";
/** 不给灵感名时用的名字 */
export const DEFAULT_INSPIRATION_NAME = "未命名";
/** 块标题里「灵感名」与「日期」的分隔符（渲染/解析共用） */
export const HEADING_DATE_SEP = " · ";

/** 一条灵感块（解析结果带定位所需的行号/偏移，工具包据此跳转与删除） */
export interface InspirationBlock {
	heading: string; // 标题原文（不含 ##），＝「灵感名 · YYYY-MM-DD」
	name: string; // 灵感名（标题去掉尾段日期）
	date: string; // 标题尾段日期（YYYY-MM-DD）；标题里没有日期时为 ""
	body: string; // 标题行之后、下一块之前的正文（trim）
	line: number; // 标题行的 0-based 行号（编辑器定位）
	endLine: number; // 块结束的 0-based 行号（不含该行＝下一块标题行或文件末）
}

const ATX_RE = /^(#{1,6})\s+(.*\S)\s*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 按行拆开并记住原文件的换行风格（写回时用同一种 eol，避免把用户文件的 CRLF 改成 LF） */
function splitDoc(md: string): { lines: string[]; eol: string } {
	return { lines: (md || "").split(/\r?\n/), eol: (md || "").includes("\r\n") ? "\r\n" : "\n" };
}

/** 行数组重新拼回文档：压掉多余的空行（首部无空行、内部最多一层空行、末尾单个换行） */
function tidyBlankLines(text: string): string {
	return `${text.replace(/\s+$/, "").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "")}\n`;
}

/** 本地日期串 YYYY-MM-DD（工具包新增灵感时写入块标题） */
export function inspirationDate(d: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 灵感名清洗：压平空白、去掉会破坏标题/链接的字符（#、[[]]、|、制表），剥掉用户顺手写上的「· 日期」尾巴，限长 40 字。空串→「未命名」 */
export function normalizeInspirationName(raw: string): string {
	let s = (raw || "").replace(/[[\]|#]/g, " ").replace(/\s+/g, " ").trim();
	s = s.replace(new RegExp(`${HEADING_DATE_SEP}\\d{4}-\\d{2}-\\d{2}$`), "").replace(/[·・-]+$/, "").trim();
	if (s.length > 40) s = s.slice(0, 40).trim();
	return s || DEFAULT_INSPIRATION_NAME;
}

/** 块标题文本＝「灵感名 · 日期」（日期不合格式则只留名字，解析时 date 为空） */
export function inspirationHeading(name: string, date: string): string {
	const n = normalizeInspirationName(name);
	return date && DATE_RE.test(date) ? `${n}${HEADING_DATE_SEP}${date}` : n;
}

/** 标题文本 → {name, date}：尾段是 YYYY-MM-DD 就剥出来当日期，否则整串都是名字 */
export function parseInspirationHeading(heading: string): { name: string; date: string } {
	const h = heading.trim();
	const cut = h.lastIndexOf(HEADING_DATE_SEP);
	if (cut > 0 && DATE_RE.test(h.slice(cut + HEADING_DATE_SEP.length).trim())) {
		return { name: h.slice(0, cut).trim(), date: h.slice(cut + HEADING_DATE_SEP.length).trim() };
	}
	return { name: h, date: "" };
}

/**
 * 解析灵感文档：只把**二级标题**当灵感块边界（一级标题＝文档头、三级及以下属于块内正文）。
 * 非灵感文档（没有任何二级标题）→ 空数组，工具包按「还没有灵感」处理。
 * 行号/`endLine` 均为 0-based，供编辑器跳转与按行增删（`splitDoc`/`joinDoc` 保住原文件换行风格）。
 */
export function parseInspirationDoc(md: string): InspirationBlock[] {
	const out: InspirationBlock[] = [];
	if (!md) return out;
	const { lines } = splitDoc(md);
	let cur: { idx: number; heading: string } | null = null;
	const close = (endLine: number): void => {
		if (!cur) return;
		const blockText = lines.slice(cur.idx + 1, endLine).join("\n");
		const { name, date } = parseInspirationHeading(cur.heading);
		out.push({ heading: cur.heading, name, date, body: blockText.trim(), line: cur.idx, endLine });
		cur = null;
	};
	for (let i = 0; i < lines.length; i++) {
		const m = ATX_RE.exec(lines[i].trim());
		if (!m) continue; // 非标题行属于当前块
		const level = m[1].length;
		if (level === 2) {
			close(i); // 上一块到此结束
			cur = { idx: i, heading: m[2].trim() };
		} else if (level === 1 && cur) {
			close(i); // 一级标题＝文档头/分隔，同样收尾当前块
		}
	}
	close(lines.length);
	return out;
}

/** 文档头（首次创建文件时写入；已有 H1 的文件不动） */
export function inspirationDocHeader(storyTitle: string): string {
	return `# 灵感${storyTitle.trim() ? `（${storyTitle.trim()}）` : ""}\n\n` +
		"<!-- 每条灵感是一个二级标题块：## 灵感名 · 日期。用命令「灵感工具包」快速打开、定位、改名、删除、新增；新增时按 SKILLS/灵感模板.md 在文末追加模板块供填充。 -->\n";
}

/** 保证文档有 H1 文档头（空文件/无标题时补上），并统一以单个换行结尾（保住原文件换行风格） */
export function ensureInspirationDocHeader(md: string, storyTitle: string): string {
	const { lines, eol } = splitDoc(md);
	const body = lines.join(eol).replace(/\s+$/, "");
	if (/^\s*#\s/.test(body)) return `${body}${eol}`;
	const head = inspirationDocHeader(storyTitle).replace(/\r?\n/g, eol);
	return `${head}${body ? `${eol}${body}${eol}` : ""}`;
}

/**
 * 模板文件 → 追加进灵感块的正文（不含标题行）：
 * 去掉文件首个一级标题（标题由插件按「灵感名 · 日期」生成）、去掉 HTML 注释块（技能文件头部说明），
 * 把模板里出现的一/二级标题降为三级（保证灵感块的二级边界不被模板破坏），最后替换 {{name}}/{{date}}/{{time}} 占位符。
 */
export function renderInspirationBody(template: string, vars: { name: string; date: string; time?: string }): string {
	const lines = (template || "").split(/\r?\n/);
	const kept: string[] = [];
	let inComment = false;
	let droppedTitle = false;
	for (const line of lines) {
		const t = line.trim();
		if (!inComment && t.startsWith("<!--")) {
			if (!t.includes("-->")) inComment = true;
			continue;
		}
		if (inComment) {
			if (t.includes("-->")) inComment = false;
			continue;
		}
		if (!droppedTitle && kept.length === 0 && t === "") continue; // 标题前的空行跳过
		const m = ATX_RE.exec(t);
		if (!droppedTitle && m && m[1].length === 1) { droppedTitle = true; continue; } // 首个一级标题＝模板自己的名字，丢弃
		droppedTitle = true;
		kept.push(m && m[1].length <= 2 ? `### ${m[2]}` : line);
	}
	return kept
		.join("\n")
		.replace(/\{\{\s*name\s*\}\}/g, vars.name)
		.replace(/\{\{\s*date\s*\}\}/g, vars.date)
		.replace(/\{\{\s*time\s*\}\}/g, vars.time ?? vars.date)
		.trim();
}

/** 追加进文档末尾的完整灵感块文本（标题行＋模板正文） */
export function renderInspirationBlock(name: string, date: string, template: string, time?: string): string {
	const heading = inspirationHeading(name, date);
	const body = renderInspirationBody(template, { name: normalizeInspirationName(name), date, time });
	return body ? `## ${heading}\n\n${body}` : `## ${heading}`;
}

/** 在文档末尾追加一块（块与块之间恒留一个空行；新块沿用原文件的换行风格） */
export function appendInspirationBlock(md: string, blockText: string): string {
	const { lines, eol } = splitDoc(md);
	const body = lines.join(eol).replace(/\s+$/, "");
	const block = blockText.replace(/\r?\n/g, eol).replace(/\s+$/, "");
	if (!body) return `${block}${eol}`;
	return `${body}${eol}${eol}${block}${eol}`;
}

/** 删除一块（按行切除）：块与块之间不留两层以上空行 */
export function removeInspirationBlock(md: string, block: InspirationBlock): string {
	const { lines, eol } = splitDoc(md);
	const count = Math.max(0, block.endLine - block.line);
	lines.splice(block.line, count);
	return tidyBlankLines(lines.join(eol));
}

/** 改一块的标题（改名/改日期用）：只换标题行，块内正文原样保留 */
export function renameInspirationBlock(md: string, block: InspirationBlock, name: string, date: string): string {
	const { lines, eol } = splitDoc(md);
	lines[block.line] = `## ${inspirationHeading(name, date)}`;
	return `${lines.join(eol).replace(/\s+$/, "")}\n`;
}

/** 列表行摘要：注释/标记去掉、空白压平、截断（工具包弹窗里每条灵感的一行预览） */
export function inspirationPreview(body: string, max = 70): string {
	const s = (body || "")
		.replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
		.replace(/^#{1,6}\s+/gm, " ")
		.replace(/^[->*+]\s+/gm, " ")
		.replace(/\s+/g, " ")
		.trim();
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 弹窗过滤：名字/标题/正文任一命中关键词即保留（空关键词＝全部保留） */
export function inspirationMatches(block: InspirationBlock, keyword: string): boolean {
	const k = (keyword || "").trim().toLowerCase();
	if (!k) return true;
	return `${block.heading}\n${block.body}`.toLowerCase().includes(k);
}
