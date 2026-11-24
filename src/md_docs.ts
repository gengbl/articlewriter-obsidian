// 移植自 Python 版 story/documents.py + context_builder.py + foreshadow.py：
// 纯函数（字符串进、字符串出）的 MD 文档解析与格式化，格式与 CLI 版完全兼容。

export interface VolumeInfo {
	id: string;
	name: string;
	description: string;
	order: number;
}

export interface SceneDoc {
	scene_id: string;
	title?: string;
	description?: string;
	chapter_num: number; // 0 = 全局未归属；卷内本地章号（v0.0.15 起各容器独立编号）
	vol?: string; // 运行态卷归属标签（仅加载时打标、不写盘），供跨卷展示与移动定位
	characters: string[];
	notes?: string;
	created_at?: string;
	updated_at?: string;
	content?: string;
	/** v0.4.7+ 场景面板：画布坐标（单位 px，文档坐标系；未设置＝缺省，面板自动布局）。写盘行 `- 位置：x,y` */
	x?: number;
	y?: number;
	/** v0.4.7+ 场景面板：父场景 scene_id（大场景包含小场景）。写盘行 `- 父场景：<id>` */
	parent?: string;
	/** v0.4.7+ 场景面板：关联场景 scene_id 列表（同角色口径「、」连接）。写盘行 `- 关联：甲、乙`；卡片上渲染成可点 chip */
	related?: string[];
	/** v0.4.8+ 地形/地貌区块（场景面板＝地图着色）：写盘行 `- 地形：森林 / 海洋 / 城市 / 秘境`；包含框衬底按内置色板上色，未识别值＝不涂色仍可解析 */
	terrain?: string;
	/** v0.4.8+ 自定义区域色：写盘行 `- 颜色：#rrggbb`（优先于地形色板） */
	color?: string;
	/** v0.4.8+ 关联路标：`- 关联：甲（官道·三日路程）` → relatedLabels["甲"]＝"官道·三日路程"（连线中点画路标；编辑弹窗只改 id，路标随 id 保留） */
	relatedLabels?: Record<string, string>;
	/** v0.4.8+ 场景挂载的时间线事件名（`- 事件：黑木崖之战、夜袭（高潮）`，名字口径＝时间线条目事件名；卡片「🕐」区展示、点击跳时间线面板定位） */
	events?: string[];
	/** v0.4.8+ 事件备注（`名字（备注）` 括号文字）：卡片列表/弹窗展示用，编辑弹窗只改名字、备注随名字保留 */
	eventLabels?: Record<string, string>;
}

export interface CharacterDoc {
	name: string;
	chapter: number; // 归属章节号（0 = 全局；卷内本地章号）
	vol?: string; // 运行态卷归属标签（仅加载时打标、不写盘）
	identity?: string;
	age?: string;
	gender?: string;
	personality?: string;
	appearance?: string;
	background?: string;
	abilities: string[];
	notes?: string;
}

export interface ForeshadowItem {
	chapter: string; // v0.0.15：复合键「N」（书根）或「卷id:N」；章号按容器独立编号，裸号只在本容器内有效
	index?: number; // 章内序号（0 起，保存时按顺序重编号；解析自标题「第N章 伏笔K」/「<卷名>·第N章 伏笔K」）
	character?: string;
	reason?: string;
	done: boolean;
}

export interface WorldSettingDoc {
	name?: string;
	world_type?: string;
	rules: string[];
	factions: string[];
	locations: string[];
	history?: string;
	magic_system?: string;
	/** v0.2.x+：清洗后（去 HTML 注释）的《世界观.md》全文——自由格式设定（人物/时间线/自定义小节等 parseWorld 不识别的内容）也由此注入提示词；由 readWorldDoc 填充，parseWorld 不产生 */
	fullText?: string;
}

export interface ChapterInfoDoc {
	volume?: string;
	tags: string[];
	notes?: string;
	created_at?: string;
	updated_at?: string;
}

// ---------- 通用工具 ----------

/** 去掉 HTML 注释（<!-- ... -->，跨行），读取解析前统一调用 */
export function stripComments(text: string): string {
	return text.replace(/<!--[\s\S]*?-->/g, "");
}

export function joinList(items: Array<string | undefined | null>): string {
	return (items || []).filter((x) => x != null && String(x).trim() !== "").map(String).join("、");
}

export function splitList(text: string): string[] {
	return String(text || "")
		.split(/[、,，]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** 按 "## " 二级标题切块，返回各块正文（含首行标题） */
function h2Blocks(text: string): string[] {
	const parts = text.split(/^##\s+/m);
	return parts.slice(1);
}

// ---------- 中文数字（打包/导出用，对齐 ExportManager._chapter_num_cn）----------

const CN_DIGITS = "零一二三四五六七八九";

/** 章节号转中文数字：1→一、12→十二、21→二十一；<0 或 >=1000 原样返回十进制串 */
export function numToCn(num: number): string {
	num = Math.trunc(num);
	if (num <= 0 || num >= 1000) return String(num);
	if (num < 10) return CN_DIGITS[num];
	if (num < 20) return "十" + (num % 10 ? CN_DIGITS[num % 10] : "");
	if (num < 100) {
		const [tens, ones] = divmod(num, 10);
		return CN_DIGITS[tens] + "十" + (ones ? CN_DIGITS[ones] : "");
	}
	const [hundreds, rest] = divmod(num, 100);
	let s = CN_DIGITS[hundreds] + "百";
	if (rest) s += rest < 10 ? "零" + CN_DIGITS[rest] : numToCn(rest);
	return s;
}

function divmod(n: number, d: number): [number, number] {
	return [Math.floor(n / d), n % d];
}

/** 中文数字转整数（支持 零一二两三四五六七八九十百，<1000）；失败返回 null */
export function cnToNum(text: string): number | null {
	const t = String(text || "").trim().replace(/两/g, "二");
	if (!t) return null;
	if (/^\d+$/.test(t)) return parseInt(t, 10);
	if (!/^[零一二三四五六七八九十百]+$/.test(t)) return null;
	let total = 0; // 十位段累计
	let section = 0; // 百位段
	let digit = 0; // 当前单个数字（待乘单位）
	for (const ch of t) {
		if (ch === "零") continue;
		if (ch === "百") {
			section = (digit || 1) * 100;
			digit = 0;
		} else if (ch === "十") {
			total += (digit || 1) * 10;
			digit = 0;
		} else {
			const d = "一二三四五六七八九".indexOf(ch) + 1;
			if (d <= 0) return null;
			digit = d;
		}
	}
	return total + section + digit;
}

/**
 * 导出合辑用：剥掉正文开头自带的章节号行（「第3章 标题」/「第三章：标题」/「## 第3章 标题」等，连续重复一并剥掉），
 * 避免与导出代码生成的「## 第N章 标题」重复。只处理开头连续的标记行，不碰正文中间的「第X章」引用；
 * 同行剩余若带句末标点或明显过长则视为正文叙述、不剥。
 */
export function stripLeadingChapterHeading(text: string): string {
	let s = String(text ?? "").replace(/^\s+/, "");
	const lineRe = /^#{0,6}[^\S\n]*(?:第[^\S\n]*)?(?:\d+|[零〇一二两三四五六七八九十百千万]+)[^\S\n]*(?:章|回|节|话)(?:(?:[^\S\n]+|[:：、.．\-—·][^\S\n]*)([^\n]*))?[^\S\n]*(?:\n|$)/;
	for (let i = 0; i < 3; i++) {
		const m = lineRe.exec(s);
		if (!m) break;
		const tail = (m[1] ?? "").trim();
		if (tail && (/[。！？!?…]$/.test(tail) || tail.length > 40)) break; // 开头是完整句子/长段 → 正文，不剥
		s = s.slice(m[0].length).replace(/^\s+/, "");
	}
	return s;
}

// ---------- 卷（卷.md）----------

export function parseVolumes(text: string): Record<string, VolumeInfo> {
	const result: Record<string, VolumeInfo> = {};
	let cur: VolumeInfo | null = null;
	for (const line of stripComments(text).split("\n")) {
		const s = line.trim();
		let m = /^##\s+(.+)$/.exec(s);
		if (m) {
			cur = { id: m[1].trim(), name: "", description: "", order: 0 };
			result[cur.id] = cur;
			continue;
		}
		if (!cur) continue;
		m = /^-?\s*名称[：:]\s*(.+)$/.exec(s);
		if (m) {
			cur.name = m[1].trim();
			continue;
		}
		m = /^-?\s*描述[：:]\s*(.+)$/.exec(s);
		if (m) {
			cur.description = m[1].trim();
			continue;
		}
		m = /^-?\s*顺序[：:]\s*(\d+)$/.exec(s);
		if (m) cur.order = parseInt(m[1], 10);
	}
	return result;
}

export function formatVolumes(title: string, vols: Record<string, VolumeInfo>): string {
	const lines = [`# ${title} 卷`, ""];
	for (const vol of Object.values(vols).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
		lines.push(`## ${vol.id}`);
		lines.push(`- 名称：${vol.name}`);
		if (vol.description) lines.push(`- 描述：${vol.description}`);
		lines.push(`- 顺序：${vol.order}`);
		lines.push("");
	}
	return lines.join("\n");
}

/** 卷大纲按章切分出的段落（v0.2.10+「从卷大纲生成章节」用） */
export interface VolOutlineSegment {
	num: number; // 卷内本地章号
	title: string; // 章标题（纯段落标记时为空 → 建章时回落「第N章」）
	content: string; // 段正文（标题标记不含标题行本身；纯段落标记含标记行剩余部分）
}

/** 卷大纲章标记行（H2 `## 第N章 <标题>` 或行首纯段落 `第N章`，N 为阿拉伯数字或中文数字一~九十九，可带「：/:」分隔）；splitVolOutlineByChapter / splitVolOutlineRawBlocks 共用 */
const CH_RE = /^(#{1,6}\s*)?第\s*(\d+|[零一二两三四五六七八九十百]+)\s*章\s*[:：]?\s*(.*)$/;

/**
 * 按章号切分卷大纲文本（v0.2.10+「从卷大纲生成章节」核心解析）：
 * 同时识别 H2 标题 `## 第N章 <标题>` 与行首纯段落 `第N章`（N 为阿拉伯数字或中文数字一~九十九，可带「：/:」分隔；
 * AI 拆分输出偶发以中文数字写章号（如「## 第一章」），解析侧兼容以免整次拆分被判为无标记而白跑一次 LLM）；
 * 首个章标记之前的内容视为卷级前言（不分发到任何章节）；
 * 重复章号合并为一段（正文按文档顺序拼接，后出现的标题标记补空标题）；
 * ``` / ~~~ 围栏内的行不作为标记（仍计入当前段正文）。返回按文档顺序的 segments。
 */
export function splitVolOutlineByChapter(text: string): { segments: VolOutlineSegment[]; preamble: string } {
	interface SegAcc { num: number; title: string; lines: string[] }
	const accs: SegAcc[] = [];
	const byNum = new Map<number, SegAcc>();
	const preambleLines: string[] = [];
	let inFence = false;
	for (const line of String(text ?? "").split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence; // 围栏开关行只计正文、不作标记
		const m = inFence ? null : CH_RE.exec(line);
		const num = m ? (/^\d+$/.test(m[2]) ? parseInt(m[2], 10) : cnToNum(m[2])) : null; // 阿拉伯数字直转；中文数字走 cnToNum（防御性判空：理论上字符类内必可转换）
		if (!m || num == null) {
			if (accs.length === 0) preambleLines.push(line);
			else accs[accs.length - 1].lines.push(line);
			continue;
		}
		const rest = (m[3] || "").trim();
		const isHeading = !!m[1];
		let seg = byNum.get(num);
		if (!seg) {
			seg = { num, title: isHeading ? rest : "", lines: [] };
			byNum.set(num, seg);
			accs.push(seg);
		} else if (isHeading && rest && !seg.title) {
			seg.title = rest; // 重复章号以标题形式出现 → 补标题
		}
		if (!isHeading && rest) seg.lines.push(rest); // 纯段落标记：同行剩余部分计入正文
	}
	const trimEnd = (s: string) => s.replace(/^\s+/, "").replace(/\s+$/, "");
	return {
		segments: accs.map((a) => ({ num: a.num, title: a.title, content: trimEnd(a.lines.join("\n")) })),
		preamble: trimEnd(preambleLines.join("\n")),
	};
}

/**
 * 提取卷大纲中声明的目标章数（v0.2.10+「从卷大纲生成章节」AI 兜底拆分用）：
 * 匹配「共N章 / 合计N章 / 总计N章 / 总共N章 / 最多N章 / 分为N章 / 拆成N章 / 分成N单 / 分N章 / 计划写N章 / 预计N章 / 约N章」等常见写法（N 为阿拉伯数字，量词「章」或「单」）；
 * 无匹配或不是正安全整数返回 null（调用方回落弹窗收集）。取文档顺序首个匹配；v0.2.x+ 起不设 99 上限。
 */
export function extractPlannedChapterCount(text: string): number | null {
	const m = /(?:共|合计|总计|总共|最多|(?:拆分|分割|划分|分|拆)\s*[为成]?|(?:计划|预计|约|打算|准备)\s*(?:写|创作|安排)?)\s*(\d+)\s*[章单]/.exec(String(text ?? ""));
	if (!m) return null;
	const n = Number(m[1]);
	return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** 卷大纲原始块（围栏感知切分）：blocks[0] 为前言（num=null），其后各块按文档顺序；全部块的行拼回即原文（逐字节保留，含注释与标记行本身） */
export interface VolOutlineRawBlock {
	num: number | null; // null = 前言
	lines: string[];
}

/** 按章号切分卷大纲为原始行块（v0.2.x+「从书级大纲生成卷」合并落盘用）：与 splitVolOutlineByChapter 同一 CH_RE、同样围栏感知（``` / ~~~ 内不作标记），但逐行原样保留——标记行计入其所属块首行，不做标题/正文拆分与去空白 */
export function splitVolOutlineRawBlocks(text: string): VolOutlineRawBlock[] {
	const blocks: VolOutlineRawBlock[] = [{ num: null, lines: [] }];
	let inFence = false;
	for (const line of String(text ?? "").split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence; // 围栏开关行只计正文、不作标记
		const m = inFence ? null : CH_RE.exec(line);
		const num = m ? (/^\d+$/.test(m[2]) ? parseInt(m[2], 10) : cnToNum(m[2])) : null; // 阿拉伯数字直转；中文数字走 cnToNum（防御性判空：理论上字符类内必可转换）
		if (!m || num == null) {
			blocks[blocks.length - 1].lines.push(line);
			continue;
		}
		blocks.push({ num, lines: [line] }); // 标记行归入其所属块的首行
	}
	return blocks;
}

/**
 * 取卷大纲中章号落在 [lo,hi] 的章节块（v0.4.3+ 编写文章阶段「前后 N 章大纲节选」用）：
 * 复用 splitVolOutlineRawBlocks 的围栏感知切分，**逐行原样保留**（`## 第N章 <标题>` 标记行与章块内注释都在，由调用方统一清洗/剥标记）；
 * **前言块恒保留**（卷设计、本卷定位等卷级信息对正文写作仍有用，且不属于任何章号）；
 * lo>hi 或窗口内无章块时只剩前言（可能为空串）——调用方据此决定是否回退整份大纲。
 */
export function sliceVolOutlineChapters(text: string, lo: number, hi: number): string {
	const out: string[] = [];
	for (const b of splitVolOutlineRawBlocks(text)) {
		if (b.num != null && (b.num < lo || b.num > hi)) continue; // 章块不在窗口内 → 丢弃；前言（num=null）恒保留
		out.push(...b.lines);
	}
	return out.join("\n").trim();
}

/**
 * 把新生成的章块合并进现有卷大纲（v0.2.x+「从书级大纲生成卷」按章补全落盘）：
 * oldBody 为现有《卷大纲.md》剥去首部 H1 的原始文本（保留注释），newContent 为 LLM 新产出；
 * 两侧各按章标记切分为原始行块，新内容中每个章号——已存在于旧内容（或新内容自身重复）→ 丢弃并计入 dropped（已有章原样保留、绝不重写）；
 * 其余按章号升序插入到首个章号更大的旧块之前（无更大旧块则追加末尾），旧内容逐字节保留（含前言与注释）；
 * 返回合并后正文（尾部空白已去）与新增/丢弃的章号列表。
 */
export function mergeVolOutlineChapters(oldBody: string, newContent: string): { body: string; added: number[]; dropped: number[] } {
	const newBlocks = splitVolOutlineRawBlocks(newContent);
	const oldBlocks = String(oldBody ?? "").trim() ? splitVolOutlineRawBlocks(oldBody) : [{ num: null, lines: [] }];
	const preamble = oldBlocks[0];
	const result: VolOutlineRawBlock[] = oldBlocks.slice(1);
	const taken = new Set<number>(result.map((b) => b.num as number));
	const added: number[] = [];
	const dropped: number[] = [];
	for (const b of newBlocks.slice(1)) {
		if (b.num == null || taken.has(b.num)) { dropped.push(b.num ?? 0); continue; } // 与已有章重复 / 新内容自身重复 → 丢弃
		taken.add(b.num);
		added.push(b.num);
	}
	added.sort((a, b) => a - b);
	for (const num of added) {
		const blk = newBlocks.find((b) => b.num === num)!; // added 中的号必来自 newBlocks（上方 find 取首个同号角）
		const idx = result.findIndex((b) => (b.num ?? 0) > num); // 升序插入到首个更大旧块之前
		if (idx < 0) result.push(blk);
		else result.splice(idx, 0, blk);
	}
	const bodyLines: string[] = [...preamble.lines]; // 显式收集替代 flatMap(ES2019)：tsconfig lib 止于 ES2018，flatMap 在不含 @types/node 传递 lib 的类型检查器下会成 error 类型、触发 no-unsafe-* 告警
	for (const b of result) bodyLines.push(...b.lines);
	return { body: bodyLines.join("\n").replace(/\s+$/, ""), added, dropped };
}

/** 书级《大纲.md》中解析出的卷声明（v0.2.x+「从书级大纲生成卷」） */
export interface VolumeDeclaration {
	name: string;
	description: string;
}

/**
 * 解析书级大纲中的卷声明（v0.2.x+「从书级大纲生成卷」）：
 * 只认 bullet 行（`-`/`*` 前缀、可缩进）且以「第X卷」开头（X 为阿拉伯或中文数字），形如 `第X卷[·・、\-—]<名>[（第A-B章）][:：]<描述>`；
 * 要求 bullet 前缀以防正文里「第一卷……」之类叙述误报；章号区间注记（如「（第1-8章）」）仅展示、不作章数来源，从卷名中剥除；
 * 无名（冒号前为空）或无冒号的行跳过；按名去重留首个，返回文档序。
 */
export function parseVolumeDeclarations(text: string): VolumeDeclaration[] {
	const out: VolumeDeclaration[] = [];
	const seen = new Set<string>();
	for (const line of String(text ?? "").split("\n")) {
		const m = /^\s*[-*]\s*第\s*(?:\d+|[零一二两三四五六七八九十百]+)\s*卷\s*[·・、\-—]?\s*(.+)$/.exec(line);
		if (!m) continue;
		const rest = m[1].trim();
		const ci = rest.search(/[:：]/);
		if (ci < 0) continue; // 无冒号 → 不是声明行
		const name = rest.slice(0, ci).replace(/[（(]\s*第\s*\d+\s*[-–—~～至到]\s*\d+\s*章\s*[)）]/g, "").trim(); // 剥「（第A-B章）」区间注记
		const description = rest.slice(ci + 1).trim();
		if (!name || seen.has(name)) continue; // 无名跳过 / 重名留首个
		seen.add(name);
		out.push({ name, description });
	}
	return out;
}

/** v0.2.x+ 书级大纲「继续生成」（有卷模式）：扫描卷声明行的卷号 X（阿拉伯或中文数字），即已有大纲已规划到的最大卷号；无声明行返回 0。
 *  旧格式卷声明（带「（第A-B章）」区间注记）同样可解析卷号——继续生成不再依赖区间注记。 */
export function maxDeclaredVolumeNum(text: string): number {
	let max = 0;
	for (const line of String(text ?? "").split("\n")) {
		const m = /^\s*[-*]\s*第\s*(\d+|[零一二两三四五六七八九十百]+)\s*卷/.exec(line);
		if (!m) continue;
		const n = cnToNum(m[1]);
		if (n != null && n > max) max = n;
	}
	return max;
}

// ---------- 场景（场景.md，全局或章节内）----------

/** v0.4.8+ 关联条目 `id（路标）` 语法：括号前＝scene_id、括号内＝连线路标标签（全/半角括号均可；标签内不能含顿号/逗号——`- 关联：` 按顿号/逗号切项，建议用「·」分隔）。无括号＝纯 id */
export function parseSceneRelItem(item: string): { id: string; label?: string } {
	const m = /^(.+?)[（(]\s*([^）)]+?)\s*[）)]\s*$/.exec(item.trim());
	if (!m) return { id: item.trim() };
	const id = m[1].trim();
	if (!id) return { id: item.trim() };
	return { id, label: m[2].trim() };
}

/** v0.4.9+ 联通性说明净化（写盘前统一走一遍）：括号会让 `id（说明）` 解析错位、顿号/逗号会被 `splitList` 拆成两项＝都换成间隔号「·」；换行/连续空白折叠成一个空格，首尾多余的「·」剥掉。
 *  这样弹窗里随手写的说明（含中英文标点）写出去一定能原样读回。 */
export function sanitizeSceneRelNote(note: string): string {
	return String(note ?? "")
		.replace(/[（）()]/g, "·")
		.replace(/[、，,]/g, "·")
		.replace(/\s+/g, " ")
		.replace(/·{2,}/g, "·")
		.replace(/^[·\s]+|[·\s]+$/g, "")
		.trim();
}

/** v0.4.8+ 关联条目回写（与 parseSceneRelItem 往返）：有路标＝`id（路标）`；v0.4.9+ 说明先经 `sanitizeSceneRelNote` 净化（保证往返） */
export function formatSceneRelItem(id: string, label?: string): string {
	const note = sanitizeSceneRelNote(label ?? "");
	return note ? `${id}（${note}）` : id;
}

/** v0.4.8+ 列表字段行序列化（formatScenes/formatSceneBlock/updateSceneBlock 共用）：id 列表＋按 id 保留的括号标签；field＝「关联」或「事件」 */
function sceneRelLine(related: readonly string[], labels?: Record<string, string>, field: "关联" | "事件" = "关联"): string {
	return `- ${field}：${joinList(related.map((id) => formatSceneRelItem(id, labels?.[id])))}`;
}

/** v0.4.8+ 地形色板（`- 地形：` 值→地图区域色）：先精确后「值含键名」匹配；未识别＝不涂色（默认衬底）。事实源在此＝面板着色与编辑弹窗下拉共用 */
export const SCENE_TERRAIN_COLORS: Record<string, string> = {
	森林: "#3f9b46", 丛林: "#2e8b57", 草原: "#8ab648", 平原: "#b3a55b", 丘陵: "#7f9b5a",
	山脉: "#8a6d4b", 沙漠: "#d2a24c", 雪原: "#5fb2d6", 沼泽: "#5f8f6e", 海洋: "#2f7fd1",
	湖泊: "#4aa6c9", 岛屿: "#2f9e8f", 城市: "#c07a3a", 秘境: "#9a5cc7", 火山: "#c2554a",
	峡谷: "#a5773c", 高原: "#a08a63",
};

/** v0.4.8+ 场景区域色＝`- 颜色：#hex`（合法时优先）→ `- 地形：` 查色板（精确→包含）→ undefined＝默认衬底 */
export function sceneTerrainColor(row: { terrain?: string; color?: string }): string | undefined {
	const c = (row.color ?? "").trim();
	if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
	const t = (row.terrain ?? "").trim();
	if (!t) return undefined;
	const exact = SCENE_TERRAIN_COLORS[t];
	if (exact) return exact;
	return Object.entries(SCENE_TERRAIN_COLORS).find(([k]) => t.includes(k))?.[1];
}

export function parseScenes(text: string, defaultChapter: number): Record<string, SceneDoc> {
	const result: Record<string, SceneDoc> = {};
	for (const block of h2Blocks(stripComments(text))) {
		const lines = block.split("\n");
		const sid = lines[0].trim();
		if (!sid) continue;
		const scene: SceneDoc = { scene_id: sid, chapter_num: defaultChapter, characters: [] };
		const contentParts: string[] = [];
		const descParts: string[] = []; // v0.4.8+ 多行描述：`- 描述：首行`＋两空格缩进续行（面板写回格式）
		let descContOpen = false;
		let inFence = false;
		for (let i = 1; i < lines.length; i++) {
			const s = lines[i].trim();
			const cont = descContOpen; // 续行只对「紧接上一条是 描述行或另一续行」的缩进行生效
			descContOpen = false;
			if (s.startsWith("```")) {
				inFence = !inFence;
				continue;
			}
			if (inFence) {
				contentParts.push(lines[i]);
				continue;
			}
			let m = /^-?\s*标题[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.title = m[1].trim();
				continue;
			}
			m = /^-?\s*描述[：:]\s*(.+)$/.exec(s);
			if (m) {
				descParts.push(m[1].trim());
				descContOpen = true;
				continue;
			}
			m = /^-?\s*章节[：:]\s*(\d+)$/.exec(s);
			if (m) {
				scene.chapter_num = parseInt(m[1], 10);
				continue;
			}
			m = /^-?\s*角色[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.characters = splitList(m[1]);
				continue;
			}
			m = /^-?\s*备注[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.notes = m[1].trim();
				continue;
			}
			m = /^-?\s*创建[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.created_at = m[1].trim();
				continue;
			}
			m = /^-?\s*更新[：:]\s*(.+)$/.exec(s);
			if (m) scene.updated_at = m[1].trim();
			// v0.4.7+ 场景面板字段：画布坐标与父场景（大小场景）
			m = /^-?\s*位置[：:]\s*(-?\d+(?:\.\d+)?)\s*[，,]\s*(-?\d+(?:\.\d+)?$)/.exec(s);
			if (m) {
				const x = Number(m[1]);
				const y = Number(m[2]);
				if (Number.isFinite(x) && Number.isFinite(y)) {
					scene.x = x;
					scene.y = y;
				}
				continue;
			}
			m = /^-?\s*父场景[：:]\s*(.+)$/.exec(s);
			if (m) {
				scene.parent = m[1].trim();
				continue;
			}
			m = /^-?\s*关联[：:]\s*(.+)$/.exec(s); // v0.4.7+ 关联场景（同角色口径、列表）；v0.4.8+ 支持 `id（路标）` 带标签项
			if (m) {
				const ids: string[] = [];
				const labels: Record<string, string> = {};
				for (const raw of splitList(m[1])) {
					const it = parseSceneRelItem(raw);
					if (!it.id) continue;
					if (!ids.includes(it.id)) ids.push(it.id);
					if (it.label) labels[it.id] = it.label;
				}
				scene.related = ids;
				if (Object.keys(labels).length) scene.relatedLabels = labels;
				continue;
			}
			m = /^-?\s*地形[：:]\s*(.+)$/.exec(s); // v0.4.8+ 地形/地貌区块（包含框衬底着色）
			if (m) {
				scene.terrain = m[1].trim();
				continue;
			}
			m = /^-?\s*颜色[：:]\s*(.+)$/.exec(s); // v0.4.8+ 自定义区域色（#hex，优先于地形色板）
			if (m) {
				const c = m[1].trim();
				if (/^#[0-9a-fA-F]{3,8}$/.test(c)) scene.color = c;
				continue;
			}
			m = /^-?\s*事件[：:]\s*(.+)$/.exec(s); // v0.4.8+ 场景挂载时间线事件（名字口径＝条目事件名；`名字（备注）` 项＝eventLabels）
			if (m) {
				const names: string[] = [];
				const labels: Record<string, string> = {};
				for (const raw of splitList(m[1])) {
					const it = parseSceneRelItem(raw);
					if (!it.id) continue;
					if (!names.includes(it.id)) names.push(it.id);
					if (it.label) labels[it.id] = it.label;
				}
				scene.events = names;
				if (Object.keys(labels).length) scene.eventLabels = labels;
				continue;
			}
			if (cont && /^[ \t]{2,}\S/.test(lines[i])) { // v0.4.8+ 描述续行（缩进≥2、非字段/围栏/正文标签行）
				descParts.push(s);
				descContOpen = true;
			}
		}
		if (descParts.length) scene.description = descParts.join("\n");
		if (contentParts.length) scene.content = contentParts.join("\n").trim();
		result[sid] = scene;
	}
	return result;
}

export function formatScenes(heading: string, scenes: Record<string, SceneDoc>): string {
	const lines = [`# ${heading} 场景`, ""];
	for (const scene of Object.values(scenes).sort((a, b) => a.scene_id.localeCompare(b.scene_id))) {
		lines.push(`## ${scene.scene_id}`);
		if (scene.description) lines.push(...sceneDescLines(scene.description)); // v0.4.8+ 多行描述（缩进续行）
		if (scene.chapter_num) lines.push(`- 章节：${scene.chapter_num}`);
		if (scene.characters.length) lines.push(`- 角色：${joinList(scene.characters)}`);
		if (scene.notes) lines.push(`- 备注：${scene.notes}`);
		if (scene.x != null && scene.y != null) lines.push(`- 位置：${String(scene.x)},${String(scene.y)}`); // v0.4.7+ 场景面板画布坐标
		if (scene.parent) lines.push(`- 父场景：${scene.parent}`); // v0.4.7+ 大场景包含小场景
		if (scene.terrain) lines.push(`- 地形：${scene.terrain}`); // v0.4.8+ 地图着色（地形/地貌区块）
		if (scene.color) lines.push(`- 颜色：${scene.color}`);
		if (scene.related?.length) lines.push(sceneRelLine(scene.related, scene.relatedLabels)); // v0.4.7+ 关联场景
		if (scene.events?.length) lines.push(sceneRelLine(scene.events, scene.eventLabels, "事件")); // v0.4.8+ 场景挂载时间线事件
		if (scene.created_at) lines.push(`- 创建：${scene.created_at}`);
		if (scene.updated_at) lines.push(`- 更新：${scene.updated_at}`);
		if (scene.content) lines.push("", "正文：", "```text", scene.content, "```");
		lines.push("");
	}
	return lines.join("\n");
}

// ---------- 场景面板块级写回（v0.4.7+：定位＝ `## <scene_id>` 标题行，注释掩码后精确匹配；只改动目标块）----------

/** 场景面板写回用的条目输入＝SceneDoc 去运行态字段（vol 不落盘） */
export type SceneBlockInput = Omit<SceneDoc, "vol">;

/** 场景面板编辑弹窗提交结果（未触碰的字段 undefined＝写回保留原文该行，不臆造覆盖） */
export interface SceneBlockEdit {
	title?: string; // 显示名（空串＝删除 `- 标题：` 行）
	description?: string;
	characters?: string[];
	notes?: string;
	parent?: string; // 空串＝删除 `- 父场景：` 行（升为顶层）
	related?: string[]; // v0.4.7+ 关联场景 id 列表（空数组＝删除 `- 关联：` 行）
	events?: string[]; // v0.4.8+ 场景挂载时间线事件名列表（空数组＝删除 `- 事件：` 行；按名字保留既有括号备注）
	/** v0.4.9+ 关联项的**联通性说明**（id→说明，写盘＝`id（说明）`）：列出的 id 覆盖旧说明（空串＝清掉该行说明）、未列出的 id 沿用原说明；undefined＝整批不动 */
	relatedNotes?: Record<string, string>;
	terrain?: string; // v0.4.8+ 地形（弹窗下拉选择；空串＝删除 `- 地形：` 行；undefined＝未触碰原样保留）
	content?: string; // 多行正文（```text 围栏）
}

/** 原文中定位 `## <scene_id>` 块（注释掩码后标题行 trim 比对，标题后空白忽略；围栏内 `#` 行不算标题）。返回起始行号（含）与尾行号（不含，下一条 H1/H2 之前或文档尾）；找不到返回 null（＝文档自解析后已变化，调用方应提示刷新重试） */
function findSceneBlockLines(text: string, sceneId: string): { start: number; end: number } | null {
	const mLines = maskCommentSpans(text).split("\n");
	const lines = text.split("\n");
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
		if (inFence) continue;
		const hm = /^##\s+(.*)$/.exec(mLines[i]);
		if (hm && hm[1].trim() === sceneId.trim()) {
			let end = lines.length;
			for (let j = i + 1; j < lines.length; j++) {
				if (/^\s*```/.test(lines[j])) { inFence = !inFence; continue; }
				if (inFence) continue;
				if (/^#{1,2}\s+/.test(mLines[j])) { end = j; break; }
			}
			return { start: i, end };
		}
	}
	return null;
}

/** 场景条目序列化为文档块（与 parseScenes 往返一致）：字段顺序＝标题/描述/章节/角色/备注/位置/父场景/地形/颜色/关联/创建/更新＋正文围栏（`正文：`＋```text）。块尾带空行 */
export function formatSceneBlock(s: SceneBlockInput): string {
	const lines = [`## ${s.scene_id}`];
	if (s.title?.trim()) lines.push(`- 标题：${s.title.trim()}`);
	if (s.description) lines.push(...sceneDescLines(s.description)); // v0.4.8+ 多行描述（缩进续行）
	if (s.chapter_num) lines.push(`- 章节：${String(s.chapter_num)}`);
	if (s.characters.length) lines.push(`- 角色：${joinList(s.characters)}`);
	if (s.notes) lines.push(`- 备注：${s.notes}`);
	if (s.x != null && s.y != null) lines.push(`- 位置：${String(s.x)},${String(s.y)}`);
	if (s.parent) lines.push(`- 父场景：${s.parent}`);
	if (s.terrain) lines.push(`- 地形：${s.terrain}`); // v0.4.8+ 地图着色字段（与 parseScenes 往返）
	if (s.color) lines.push(`- 颜色：${s.color}`);
	if (s.related?.length) lines.push(sceneRelLine(s.related, s.relatedLabels));
	if (s.events?.length) lines.push(sceneRelLine(s.events, s.eventLabels, "事件")); // v0.4.8+ 场景挂载时间线事件
	if (s.created_at) lines.push(`- 创建：${s.created_at}`);
	if (s.updated_at) lines.push(`- 更新：${s.updated_at}`);
	if (s.content) lines.push("", "正文：", "```text", s.content.replace(/\s+$/, ""), "```");
	lines.push("");
	return lines.join("\n");
}

/** 在《场景.md》文末追加一个新场景块（已有内容原样保留；空文档/缺文件按 "# 场景" 起底）。scene_id 已存在或为空时返回 null（调用方先查重） */
export function insertSceneBlock(text: string, scene: SceneBlockInput): string | null {
	const id = String(scene.scene_id ?? "").trim();
	if (!id || /[\\/:*?"<>|]/.test(id)) return null;
	if (findSceneBlockLines(text, id)) return null; // 同名场景已存在
	const base = text.trim() ? text.replace(/\s+$/, "") : "# 场景";
	return `${base}\n\n${formatSceneBlock(scene)}`.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** 字段行识别（编辑写回时用于区分「保留的自由/未知行」；正文围栏整体保留或整体替换） */
const SCENE_FIELD_LINE_RE = /^\s*-?\s*(标题|描述|章节|角色|备注|位置|父场景|地形|颜色|关联|事件|创建|更新)\s*[：:]/;

/** v0.4.8+ 多行描述字段序列化＝`- 描述：首行`＋两空格缩进续行（与 parseScenes 续行口径互逆）；返回行数组，调用方逐行 push。空值返回 [] */
function sceneDescLines(value: string): string[] {
	const norm = String(value).replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/^\n+/, "").replace(/\s+$/, "");
	if (!norm) return [];
	const ls = norm.split("\n");
	return [`- 描述：${ls[0]}`, ...ls.slice(1).map((l) => `  ${l}`)];
}

/** 编辑更新《场景.md》中的场景块：edit 中 undefined 的字段保留原行（含创建/更新/章节与未识别的自由行、围栏外自由文本），给出的字段整行重写（空值＝删除该字段行）；正文围栏按 edit.content 整段替换/删除/保留。定位失败返回 null（＝文档已被外部改动，调用方提示刷新） */
export function updateSceneBlock(text: string, sceneId: string, edit: SceneBlockEdit): string | null {
	const loc = findSceneBlockLines(text, sceneId);
	if (!loc) return null;
	const lines = text.split("\n");
	const out: string[] = [lines[loc.start]];
	let inFence = false;
	let fenceBuf: string[] = [];
	let fenceHandled = false;
	const seenKeys = new Set<string>();
	const pending: string[] = []; // 原文缺该行但编辑给出了值＝补写（插在正文围栏前）
	// v0.4.8+ 预扫描旧块的 `- 关联：` 路标与 `- 事件：` 备注（弹窗多选只交名字列表——重写时按名字找回原括号标签，地图标注/事件备注不丢）
	const oldRelLabels: Record<string, string> = {};
	const oldEvLabels: Record<string, string> = {};
	{
		const mL = maskCommentSpans(text).split("\n");
		let inF0 = false;
		let gotRel = false;
		let gotEv = false;
		for (let i = loc.start + 1; i < loc.end && !(gotRel && gotEv); i++) {
			if (/^\s*```/.test(lines[i])) { inF0 = !inF0; continue; }
			if (inF0) continue;
			for (const [field, store] of [["关联", oldRelLabels], ["事件", oldEvLabels]] as const) {
				if ((field === "关联" ? gotRel : gotEv)) continue;
				const rm = new RegExp("^\\s*-?\\s*" + field + "\\s*[：:]\\s*(.+)$").exec(mL[i]);
				if (!rm) continue;
				for (const raw of splitList(rm[1])) {
					const it = parseSceneRelItem(raw);
					if (it.id && it.label) store[it.id] = it.label;
				}
				if (field === "关联") gotRel = true;
				else gotEv = true;
			}
		}
	}
	// v0.4.9+ 弹窗交来的联通性说明＝覆盖口径：给出的 id 有非空说明＝写入（经 formatSceneRelItem 净化）、说明为空串＝清掉该 id 原说明、未列出的 id 沿用原说明（＝弹窗只改 id 时地图标注不丢）
	const relLines = (ids: string[]): string[] => {
		const labels: Record<string, string> = { ...oldRelLabels };
		if (edit.relatedNotes) {
			for (const [id, note] of Object.entries(edit.relatedNotes)) {
				if (note.trim()) labels[id] = note.trim();
				else delete labels[id];
			}
		}
		return [sceneRelLine(ids, labels)];
	};
	// v0.4.8+ 事件行＝弹窗交名字列表；括号备注按名字沿用旧值（同关联口径）
	const evLines = (names: string[]): string[] => [sceneRelLine(names, oldEvLabels, "事件")];
	const wanted: Array<[string, string[] | null | undefined]> = [ // 值＝行数组（描述可多行＝首行＋缩进续行）；null＝删除该字段行；undefined＝未触碰
		["标题", edit.title === undefined ? undefined : edit.title.trim() ? [`- 标题：${edit.title.trim()}`] : null],
		["描述", edit.description === undefined ? undefined : sceneDescLines(edit.description)],
		["角色", edit.characters === undefined ? undefined : edit.characters.length ? [`- 角色：${joinList(edit.characters)}`] : null],
		["备注", edit.notes === undefined ? undefined : edit.notes.trim() ? [`- 备注：${edit.notes.trim()}`] : null],
		["父场景", edit.parent === undefined ? undefined : edit.parent.trim() ? [`- 父场景：${edit.parent.trim()}`] : null],
		["地形", edit.terrain === undefined ? undefined : edit.terrain.trim() ? [`- 地形：${edit.terrain.trim()}`] : null],
		["事件", edit.events === undefined ? undefined : edit.events.length ? evLines(edit.events) : null], // v0.4.8+ 场景挂载时间线事件（空数组＝删行）
		["关联", edit.related === undefined ? undefined : edit.related.length ? relLines(edit.related) : null],
	];
	let pendingFlushed = false;
	const flushPending = (): void => {
		if (pendingFlushed) return;
		pendingFlushed = true;
		for (const [key, ls] of wanted) {
			if (seenKeys.has(key) || ls == null || ls.length === 0) continue;
			pending.push(...ls);
			seenKeys.add(key);
		}
		out.push(...pending);
	};
	let labelSeen = false; // 块内「正文：」标签行（围栏的引导行）：捕获后不直接回写，由本函数统一重排
	let skipDescCont = false; // v0.4.8+ 描述被重写＝紧随其后的旧缩进续行一并吞掉（与 parseScenes 续行口径一致）
	const emitContent = (): void => {
		flushPending(); // 补写的字段行排在正文围栏前
		if (edit.content === undefined) {
			if (fenceBuf.length) { if (labelSeen) out.push("", "正文："); out.push(...fenceBuf); } // 未触碰正文＝原围栏原样（标签行按原位置语义回排）
			else if (labelSeen) out.push("正文："); // 孤儿标签行（无围栏跟随）原样保留
			return;
		}
		const t = edit.content.replace(/\s+$/, "");
		if (t) out.push("", "正文：", "```text", t, "```");
	};
	for (let i = loc.start + 1; i < loc.end; i++) {
		const line = lines[i];
		if (/^\s*```/.test(line)) {
			skipDescCont = false; // 围栏行中断描述续行链
			if (!inFence) { inFence = true; fenceBuf = [line]; }
			else { fenceBuf.push(line); inFence = false; emitContent(); fenceHandled = true; } // 收尾 ``` 也入缓冲（未触碰时原围栏须原样）
			continue;
		}
		if (inFence) { fenceBuf.push(line); continue; }
		if (skipDescCont && /^[ \t]{2,}\S/.test(line) && !SCENE_FIELD_LINE_RE.test(line)) continue; // 旧描述的续行（随描述重写一并删除；缩进字段行不算续行＝与 parseScenes 口径一致）
		skipDescCont = false;
		if (!inFence && !line.trim() && /^正文\s*[：:]\s*$/.test(line.trim())) { labelSeen = true; continue; } // 「正文：」标签行由 emitContent 统一回排
		const fm = SCENE_FIELD_LINE_RE.test(line);
		if (!fm) { if (!line.trim() && !fenceHandled) continue; out.push(line); continue; } // 围栏前空行由正文段自带，防重复；围栏后自由文本行原样
		const key = (/^\s*-?\s*(\S+?)\s*[：:]/.exec(line) ?? [])[1] ?? "";
		seenKeys.add(key);
		if (key === "描述" && edit.description !== undefined) skipDescCont = true;
		const written: string[] | null = (() => {
			switch (key) {
				case "标题": return edit.title === undefined ? [line] : edit.title.trim() ? [`- 标题：${edit.title.trim()}`] : null;
				case "描述": return edit.description === undefined ? [line] : sceneDescLines(edit.description);
				case "角色": return edit.characters === undefined ? [line] : edit.characters.length ? [`- 角色：${joinList(edit.characters)}`] : null;
				case "备注": return edit.notes === undefined ? [line] : edit.notes.trim() ? [`- 备注：${edit.notes.trim()}`] : null;
				case "父场景": return edit.parent === undefined ? [line] : edit.parent.trim() ? [`- 父场景：${edit.parent.trim()}`] : null;
				case "地形": return edit.terrain === undefined ? [line] : edit.terrain.trim() ? [`- 地形：${edit.terrain.trim()}`] : null; // v0.4.8+ 弹窗下拉可改（空串＝删行）
				case "关联": return edit.related === undefined ? [line] : edit.related.length ? relLines(edit.related) : null;
				case "事件": return edit.events === undefined ? [line] : edit.events.length ? evLines(edit.events) : null; // v0.4.8+ 场景挂载时间线事件（弹窗多选；空数组＝删行）
				default: return [line]; // 标题/章节/位置/颜色/创建/更新＝面板不编辑、原样保留（显示名输入已删——场景名即显示名）
			}
		})();
		if (written !== null) out.push(...written);
	}
	if (inFence) { emitContent(); } // 围栏未闭合（原文残缺）＝按已读内容处理
	if (!pendingFlushed) flushPending(); // 块内没有围栏时补写行直接落字段区尾
	if (edit.content !== undefined && !fenceHandled) {
		const t = edit.content.replace(/\s+$/, "");
		if (t) out.push("", "正文：", "```text", t, "```");
	}
	out.push("");
	const merged = [...lines.slice(0, loc.start), ...out, ...lines.slice(loc.end)];
	return merged.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** 删除《场景.md》中的场景块（整块含正文围栏）。定位失败返回 null（＝文档已被外部改动） */
export function deleteSceneBlock(text: string, sceneId: string): string | null {
	const loc = findSceneBlockLines(text, sceneId);
	if (!loc) return null;
	const lines = text.split("\n");
	const merged = [...lines.slice(0, loc.start), ...lines.slice(loc.end)];
	return merged.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** 改写场景块的 `- 位置：x,y` 行（场景面板拖动更新位置的写回路径）：expectOld＝面板快照里的旧坐标（null＝尚无位置行）。校验目标块内旧位置行与 expectOld 一致后写规范值（保留 2 位小数、整数不带小数点）；无该行时在字段区末尾（正文围栏前）插入。定位/校验失败返回 null（＝快照过期，调用方应提示刷新重试） */
export function rewriteScenePosition(text: string, sceneId: string, expectOld: { x: number; y: number } | null, x: number, y: number): string | null {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	const loc = findSceneBlockLines(text, sceneId);
	if (!loc) return null;
	const lines = text.split("\n");
	const fmt = (v: number): string => String(Math.round(v * 100) / 100);
	const posLine = `- 位置：${fmt(x)},${fmt(y)}`;
	let inFence = false;
	let posIdx = -1;
	let insertAt = loc.end; // 默认插到块尾
	for (let i = loc.start + 1; i < loc.end; i++) {
		if (/^\s*```/.test(lines[i])) { if (!inFence) insertAt = Math.min(insertAt, i); inFence = !inFence; continue; }
		if (inFence) continue;
		if (SCENE_FIELD_LINE_RE.test(lines[i]) && /^\s*-?\s*位置\s*[：:]/.test(lines[i])) {
			if (posIdx >= 0) return null; // 重复位置行＝文档异常，放弃防误写
			posIdx = i;
		}
	}
	if (posIdx >= 0) {
		const m = /^\s*-?\s*位置\s*[：:]\s*(-?\d+(?:\.\d+)?)\s*[，,]\s*(-?\d+(?:\.\d+)?)/.exec(lines[posIdx]);
		if (!m) return null; // 旧位置行解析不出＝快照过期
		const ox = Number(m[1]);
		const oy = Number(m[2]);
		const same = expectOld != null && Math.abs(ox - expectOld.x) < 0.51 && Math.abs(oy - expectOld.y) < 0.51;
		const empty = expectOld == null && !Number.isFinite(ox);
		if (!same && !empty) return null;
		lines[posIdx] = posLine;
	} else {
		if (expectOld != null) return null; // 快照有坐标但原文无该行＝文档已变化
		while (insertAt > loc.start + 1 && !lines[insertAt - 1].trim()) insertAt--; // 回退到块尾空行之前
		lines.splice(insertAt, 0, posLine);
	}
	return lines.join("\n");
}

/** 同步《场景.md》内对旧场景名的引用（改名收尾）：非围栏行里 `- 父场景：<old>` → `<new>`、`- 关联：…` 列表项 `<old>` → `<new>`（列表去重：new 已存在时只删旧项）。注释区经掩码不参与、围栏内不改动。无任何引用可改时原样返回（调用方可据此跳过写盘） */
export function renameSceneRefs(text: string, oldId: string, newId: string): string {
	const old = oldId.trim();
	const nw = newId.trim();
	if (!old || !nw || old === nw) return text;
	const mLines = maskCommentSpans(text).split("\n");
	const lines = text.split("\n");
	const parentRe = /^(\s*-?\s*父场景\s*[：:]\s*)(.+)$/;
	const relRe = /^(\s*-?\s*关联\s*[：:]\s*)(.+)$/;
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
		if (inFence) continue;
		const m = parentRe.exec(mLines[i]);
		if (m && m[2].trim() === old) {
			lines[i] = lines[i].replace(parentRe, (all, p1: string) => p1 + nw);
			continue;
		}
		const r = relRe.exec(mLines[i]);
		if (!r) continue;
		const items = splitList(r[2]).map(parseSceneRelItem); // v0.4.8+ 项可带 `（路标）`——比对/映射只看 id，路标原样跟着走
		if (!items.some((it) => it.id === old)) continue;
		const mapped: Array<{ id: string; label?: string }> = [];
		for (const it of items) {
			const id = it.id === old ? nw : it.id;
			if (!mapped.some((o) => o.id === id)) mapped.push({ id, label: it.label });
		}
		lines[i] = lines[i].replace(relRe, (all, p1: string) => p1 + joinList(mapped.map((o) => formatSceneRelItem(o.id, o.label))));
	}
	return lines.join("\n");
}

/** 改场景名（＝`## <oldId>` 块锚改名）：标题行改 `## <newId>`、块内 `- 标题：` 恰等于旧名时同步（旧文档「标题＝场景名」写法显示名跟着走）、全文档引用同步（renameSceneRefs，同文档引用同文档优先必指向本块）。newId 空/含非法字符、旧块找不到（文档已变）、newId 在同文档已有块（块锚冲突）→ null（调用方拒绝并提示） */
export function renameSceneBlock(text: string, oldId: string, newId: string): string | null {
	const old = oldId.trim();
	const nw = newId.trim();
	if (!old || !nw || old === nw || /[\\/:*?"<>|]/.test(nw)) return null;
	const loc = findSceneBlockLines(text, old);
	if (!loc) return null;
	if (findSceneBlockLines(text, nw)) return null; // 同文档已有同名块＝块锚冲突
	const lines = text.split("\n");
	lines[loc.start] = `## ${nw}`; // 标题行规范化重写（原行可能有尾随空白）
	const titleRe = /^(\s*-?\s*标题\s*[：:]\s*)(.+)$/;
	const mTitle = titleRe.exec(lines[loc.start + 1]); // `- 标题：` 行按惯例紧随标题；仅其值恰等于旧名时同步
	if (mTitle && mTitle[2].trim() === old) lines[loc.start + 1] = mTitle[1] + nw;
	return renameSceneRefs(lines.join("\n"), old, nw);
}

// ---------- 人物（人物.md，全局或章节内）----------

export function parseCharacters(text: string, chapterNum: number): Record<string, CharacterDoc> {
	const result: Record<string, CharacterDoc> = {};
	for (const block of h2Blocks(stripComments(text))) {
		const lines = block.split("\n");
		const name = lines[0].trim();
		if (!name) continue;
		const char: CharacterDoc = { name, chapter: chapterNum, abilities: [] };
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i].trim().replace(/^-\s*/, "");
			const m = /^(身份|年龄|性别|性格|外貌|背景|能力|备注)[：:]\s*(.+)$/.exec(line);
			if (!m) continue;
			const key = m[1];
			const val = m[2].trim();
			switch (key) {
				case "身份": char.identity = val; break;
				case "年龄": char.age = val; break;
				case "性别": char.gender = val; break;
				case "性格": char.personality = val; break;
				case "外貌": char.appearance = val; break;
				case "背景": char.background = val; break;
				case "能力": char.abilities = splitList(val); break;
				case "备注": char.notes = val; break;
			}
		}
		result[name] = char;
	}
	return result;
}

export function formatCharacters(heading: string, chars: Record<string, CharacterDoc>): string {
	const lines = [`# ${heading} 人物`, ""];
	for (const char of Object.values(chars).sort((a, b) => a.name.localeCompare(b.name))) {
		lines.push(formatCharacterBlock(char));
		lines.push("", "---", "");
	}
	return lines.join("\n");
}

/** 单个角色块（对齐 DocumentStore._format_character） */
export function formatCharacterBlock(char: CharacterDoc): string {
	const lines = [`## ${char.name}`];
	if (char.identity) lines.push(`- 身份：${char.identity}`);
	if (char.age) lines.push(`- 年龄：${char.age}`);
	if (char.gender) lines.push(`- 性别：${char.gender}`);
	if (char.personality) lines.push(`- 性格：${char.personality}`);
	if (char.appearance) lines.push(`- 外貌：${char.appearance}`);
	if (char.background) lines.push(`- 背景：${char.background}`);
	if (char.abilities.length) lines.push(`- 能力：${joinList(char.abilities)}`);
	if (char.notes) lines.push(`- 备注：${char.notes}`);
	return lines.join("\n");
}

// ---------- 人物块的块级手术＋合并（v0.4.11+「合并人物信息」；与时间线/关系块同一套路）----------

/** 定位《人物.md》里某个角色块（`## 名字` 起、到下一个 `#`/`##` 标题前止）。
 *  与 `findSceneBlockLines` 同口径：先 `maskCommentSpans` 掩掉 HTML 注释（模板里的示例角色标题不误命中）、围栏内不认标题。未找到＝null */
function findCharacterBlockLines(text: string, name: string): { start: number; end: number } | null {
	const masked = maskCommentSpans(text).split("\n");
	const lines = text.split("\n");
	const want = name.trim();
	if (!want) return null;
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		if (!inFence && /^\s*```/.test(lines[i])) { inFence = true; continue; }
		if (inFence) {
			if (/^\s*```/.test(lines[i])) inFence = false;
			continue;
		}
		const hm = /^##\s+(.*)$/.exec(masked[i]);
		if (!hm || hm[1].trim() !== want) continue;
		let end = lines.length;
		let fence = false;
		for (let j = i + 1; j < lines.length; j++) {
			if (!fence && /^\s*```/.test(lines[j])) { fence = true; continue; }
			if (fence) {
				if (/^\s*```/.test(lines[j])) fence = false;
				continue;
			}
			if (/^#{1,2}\s/.test(masked[j])) { end = j; break; }
		}
		return { start: i, end };
	}
	return null;
}

/** 接缝处收口：删块后把块前后多余空白折成「空行＋空行」，文档整体仍保持原换行风格 */
function joinAround(before: string, after: string): string {
	const a = before.replace(/\s+$/, "");
	const b = after.replace(/^\s+/, "");
	if (!a) return b;
	if (!b) return `${a}\n`;
	return `${a}\n\n${b}`;
}

/** 删掉《人物.md》中某个角色块（连带其前后多余空行与紧随的 `---` 分隔行）＝**只动这一块**，文档其余内容与模板注释原样保留。
 *  找不到该块＝null（调用方据此提示刷新重试，不做有损写入） */
export function deleteCharacterBlock(text: string, name: string): string | null {
	const loc = findCharacterBlockLines(text, name);
	if (!loc) return null;
	const lines = text.split("\n");
	let start = loc.start;
	let end = loc.end;
	while (start > 0 && lines[start - 1].trim() === "") start--;
	while (end < lines.length && lines[end].trim() === "") end++;
	if (end < lines.length && /^\s*---\s*$/.test(lines[end])) {
		end++;
		while (end < lines.length && lines[end].trim() === "") end++;
	}
	return joinAround(lines.slice(0, start).join("\n"), lines.slice(end).join("\n"));
}

/** 写入／替换某个角色块：同文档已有同名块＝原位替换（不打乱既有顺序），否则追加到文档末尾（已有其它角色块时补一条 `---` 分隔行，与 `formatCharacters` 的排版一致）。
 *  只动目标块＝文档其余内容（含 HTML 注释模板、自定义段落）原样保留——与 `saveCharactersFile` 的整篇重写有意不同 */
export function upsertCharacterBlock(text: string, char: CharacterDoc): string {
	const block = formatCharacterBlock(char);
	const loc = findCharacterBlockLines(text, char.name);
	const lines = text.split("\n");
	if (loc) {
		let end = loc.end;
		// 块尾的空行与 `---` 分隔行不属于块内容＝留在原地，替换后与下一块之间的排版照旧（与 `deleteCharacterBlock` 同一口径）
		while (end > loc.start && (lines[end - 1].trim() === "" || /^---\s*$/.test(lines[end - 1]))) end--;
		const tail = lines.slice(end);
		const gap = tail.length && tail[0].trim() !== "" ? [""] : []; // 原文没有空行隔开（手写文档）＝补一行，防 `##` 紧贴上一块
		return [...lines.slice(0, loc.start), ...block.split("\n"), ...gap, ...tail].join("\n");
	}
	const hasBlocks = maskCommentSpans(text).split("\n").some((l) => /^##\s+\S/.test(l));
	const base = text.replace(/\s+$/, "");
	if (!base) return `${block}\n`;
	return `${base}\n\n${hasBlocks ? "---\n\n" : ""}${block}\n`;
}

/** 人物设定字段（合并弹窗逐字段选择来源＝顺序与「编辑人物」弹窗一致） */
export const CHARACTER_FIELDS: Array<{ key: keyof Omit<CharacterDoc, "name" | "chapter" | "vol">; label: string }> = [
	{ key: "identity", label: "身份" },
	{ key: "age", label: "年龄" },
	{ key: "gender", label: "性别" },
	{ key: "personality", label: "性格" },
	{ key: "appearance", label: "外貌" },
	{ key: "background", label: "背景" },
	{ key: "abilities", label: "能力" },
	{ key: "notes", label: "备注" },
];

/** 合并取值的特殊选择：`__all__`＝各份登记全部保留（文本按「；」拼接去重、能力取并集）、`__empty__`＝留空；数字＝取第 N 份登记的值 */
export const CHARACTER_MERGE_ALL = "__all__";
export const CHARACTER_MERGE_EMPTY = "__empty__";
export type CharacterMergePick = number | typeof CHARACTER_MERGE_ALL | typeof CHARACTER_MERGE_EMPTY;
export type CharacterMergePicks = Record<string, CharacterMergePick>;

/** 一份待合并的登记（＝某份《人物.md》里该人物的条目＋其所在文档出处） */
export interface CharacterMergeSource {
	path: string; // 该登记所在《人物.md》的 vault 相对路径
	label: string; // 展示出处（书籍级／卷级／章级 · 书内路径）
	char: CharacterDoc;
}

/** 该字段在某份登记里的展示值（能力取顿号连接串）＝弹窗候选与预览共用 */
export function characterFieldValue(char: CharacterDoc, key: (typeof CHARACTER_FIELDS)[number]["key"]): string {
	return key === "abilities" ? joinList(char.abilities) : String(char[key] ?? "").trim();
}

/** 按用户逐字段的选择把多份登记合成一条条目（＝纯计算、不碰 Vault；`chapter` 由调用方按目标文档定位时再打） */
export function applyCharacterMerge(name: string, sources: readonly CharacterMergeSource[], picks: CharacterMergePicks): CharacterDoc {
	const merged: CharacterDoc = { name, chapter: 0, abilities: [] };
	for (const { key } of CHARACTER_FIELDS) {
		const pick = picks[key];
		if (pick === CHARACTER_MERGE_EMPTY) continue; // 留空＝该字段不写
		if (pick === CHARACTER_MERGE_ALL) {
			if (key === "abilities") {
				const set: string[] = [];
				for (const s of sources) for (const a of s.char.abilities) if (a.trim() && !set.includes(a.trim())) set.push(a.trim());
				merged.abilities = set;
			} else {
				const parts: string[] = [];
				for (const s of sources) {
					const v = characterFieldValue(s.char, key);
					if (v && !parts.includes(v)) parts.push(v);
				}
				merged[key] = parts.join("；");
			}
			continue;
		}
		if (typeof pick === "number") {
			const src = sources[pick];
			if (!src) continue; // 快照过期（该登记已被删）＝当留空处理，不报错打断整次合并
			if (key === "abilities") merged.abilities = src.char.abilities.map((a) => a.trim()).filter(Boolean);
			else merged[key] = characterFieldValue(src.char, key);
		}
	}
	return merged;
}

// ---------- 伏笔（伏笔.md + [伏]...[/] 标记解析，对齐 story/foreshadow.py；v0.0.15 起章节号为复合键「N」/「卷id:N」）----------

const FORESHADOW_BLOCK_RE = /\[伏\]([\s\S]*?)\[\/?(?:伏)?\]/g;

/** 卷名/卷ID → 卷ID 的解析表（跨卷引用与标题前缀共用） */
export type VolumeKeyIndex = Record<string, string>;

/** 把「卷前缀+本地章号」拼成复合键：无前缀=书根裸号 */
function scopeChapterKey(volId: string | null | undefined, num: number): string {
	return volId ? `${volId}:${num}` : String(num);
}

/** 拆复合键为 {vol,num}（无冒号=书根） */
export function splitChKey(key: string): { vol: string | null; num: number } {
	const i = key.indexOf(":");
	if (i < 0) return { vol: null, num: parseInt(key, 10) };
	return { vol: key.slice(0, i), num: parseInt(key.slice(i + 1), 10) };
}

/**
 * 解析单条伏笔文本（章节/人物/事由字段任意顺序；无字段时按「人物：事由」再退回整段为事由）。
 * 「章节：N」继承 defaultScope 所在容器；「章节：<卷名>第N章」（或 <卷ID>:N）显式跨卷。
 */
export function parseForeshadowText(text: string, defaultScope: string, volIndex?: VolumeKeyIndex): ForeshadowItem {
	const defVol = splitChKey(defaultScope).vol;
	let chapter = defaultScope;
	const mChap = /章节\s*[:：=]\s*(?:(\S+?)\s*第)?(\d+)/.exec(text);
	if (mChap) {
		const prefix = mChap[1] ?? "";
		const n = parseInt(mChap[2], 10);
		chapter = prefix ? scopeChapterKey(volIndex?.[prefix] ?? prefix, n) : scopeChapterKey(defVol, n);
	}
	let character = "";
	const mChar = /人物\s*[:：=]\s*([^；;，,\n]*?)(?=\s*事由\s*[:：=]|[；;，,\n]|$)/.exec(text);
	if (mChar) character = mChar[1].trim();
	const mReason = /事由\s*[:：=]\s*([\s\S]+)/.exec(text);
	if (mReason) return { chapter, character, reason: mReason[1].trim(), done: false };
	// 无显式事由：去掉已识别的 章节/人物 字段后看剩余
	let rest = text.replace(/章节\s*[:：=]\s*(?:\S+\s*第)?\d+\s*/g, "");
	rest = rest.replace(/人物\s*[:：=]\s*[^；;，,\n]*?(?=\s*事由\s*[:：=]|[；;，,\n]|$)/g, "");
	rest = rest.trim().replace(/^[\s \t，,；;。:：\-–—|、()（）]+|[\s \t，,；;。:：\-–—|、()（）]+$/g, "");
	if (!rest) return { chapter, character, reason: character || "", done: false };
	if (rest.includes("：") && !/^(人物|事由|章节)/.test(rest)) {
		const idx = rest.indexOf("：");
		const c = rest.slice(0, idx).trim();
		const r = rest.slice(idx + 1).trim();
		if (c && r) return { chapter, character: c, reason: r, done: false };
	}
	return { chapter, character, reason: rest, done: false };
}

/** 解析大纲中的 [伏]...[/]（或 [/伏]）标记 */
export function extractForeshadows(outline: string, defaultScope: string, volIndex?: VolumeKeyIndex): ForeshadowItem[] {
	const items: ForeshadowItem[] = [];
	if (!outline) return items;
	FORESHADOW_BLOCK_RE.lastIndex = 0; // 模块级 /g 正则：扫描前复位，防上次调用残留状态
	let fm: RegExpExecArray | null;
	while ((fm = FORESHADOW_BLOCK_RE.exec(outline)) !== null) {
		const content = fm[1].trim();
		if (!content) continue;
		const item = parseForeshadowText(content, defaultScope, volIndex);
		if (item.reason || item.character) items.push(item);
	}
	return items;
}

/** 去掉伏笔标志 [伏]/[/伏]（保留内容文本；[/] 是详略通用结束标记，不删） */
export function stripForeshadowMarks(outline: string): string {
	return String(outline || "").replace(/\[伏\]/g, "").replace(/\[\s*\/\s*伏\s*\]/g, "");
}

/**
 * 读取 伏笔.md：按「章节+序号」块解析，返回按 (复合键, 序号) 排序的列表。
 * 标题兼容两种形态：书根 `## 第N章 伏笔K`（旧格式原样可读）、卷内 `## <卷名或ID>·第N章 伏笔K`（前缀经 volIndex 归一为卷 ID）。
 */
export function parseForeshadows(text: string, volIndex?: VolumeKeyIndex): ForeshadowItem[] {
	const result: Array<[string, number, ForeshadowItem]> = [];
	for (const block of h2Blocks(stripComments(text))) {
		const lines = block.split("\n");
		const head = lines[0].trim();
		const m = /^(?:(.+?)·)?第\s*(\d+)\s*章\s*伏笔\s*(\d+)\s*$/.exec(head);
		if (!m) continue;
		const idx = parseInt(m[3], 10);
		const prefix = (m[1] ?? "").trim();
		const num = parseInt(m[2], 10);
		const chapter = prefix ? scopeChapterKey(volIndex?.[prefix] ?? prefix, num) : String(num);
		const item: ForeshadowItem = { chapter, index: idx, done: false };
		for (let i = 1; i < lines.length; i++) {
			const s = lines[i].trim();
			let m2 = /^-?\s*人物[：:]\s*(.+)$/.exec(s);
			if (m2) {
				item.character = m2[1].trim();
				continue;
			}
			m2 = /^-?\s*事由[：:]\s*(.+)$/.exec(s);
			if (m2) {
				item.reason = m2[1].trim();
				continue;
			}
			m2 = /^-?\s*状态[：:]\s*(.+)$/.exec(s);
			if (m2) item.done = m2[1].includes("已完成");
		}
		result.push([chapter, idx, item]);
	}
	return result.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]).map((x) => x[2]);
}

/**
 * 写 伏笔.md（按复合键分组、组内按序号重新编号，对齐 DocumentStore.write_foreshadows）。
 * volNames 提供卷 ID→名称 映射时卷内标题用卷名展示；缺省退回卷 ID。
 */
export function formatForeshadows(title: string, items: ForeshadowItem[], volNames?: Record<string, string>): string {
	const byChapter = new Map<string, ForeshadowItem[]>();
	for (const item of items) {
		if (!byChapter.has(item.chapter)) byChapter.set(item.chapter, []);
		byChapter.get(item.chapter)!.push(item);
	}
	const lines = [`# ${title} 伏笔`, ""];
	for (const chap of [...byChapter.keys()].sort((a, b) => a.localeCompare(b))) {
		const { vol, num } = splitChKey(chap);
		const head = vol ? `${volNames?.[vol] ?? vol}·第${num}章` : `第${num}章`;
		byChapter.get(chap)!.forEach((item, idx) => {
			lines.push(`## ${head} 伏笔${idx}`);
			if (item.character) lines.push(`- 人物：${item.character}`);
			if (item.reason) lines.push(`- 事由：${item.reason}`);
			lines.push(`- 状态：${item.done ? "已完成" : "未完成"}`);
			lines.push("");
		});
	}
	return lines.join("\n");
}

// ---------- 世界观（世界观.md）----------

export function parseWorld(text: string): WorldSettingDoc {
	const ws: WorldSettingDoc = { rules: [], factions: [], locations: [] };
	let fenceTarget: "history" | "magic_system" | null = null; // ```text 围栏归属（显式 - 历史：/- 力量体系：或 ## 标题）
	let buf: string[] = [];
	let inFence = false;
	for (const line of stripComments(text).split("\n")) {
		const s = line.trim();
		if (s.startsWith("```")) {
			if (inFence) {
				if (fenceTarget) ws[fenceTarget] = buf.join("\n").trim();
				inFence = false;
				fenceTarget = null;
				buf = [];
			} else {
				inFence = true;
			}
			continue;
		}
		if (inFence) {
			buf.push(line);
			continue;
		}
		let m = /^##\s+(.+)$/.exec(s);
		if (m) {
			const h = m[1].trim();
			if (/^(历史|背景)$/.test(h)) fenceTarget = "history";
			else if (h === "力量体系") fenceTarget = "magic_system";
			else fenceTarget = null;
			continue;
		}
		m = /^-?\s*世界[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.name = m[1].trim();
			continue;
		}
		m = /^-?\s*类型[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.world_type = m[1].trim();
			continue;
		}
		m = /^-?\s*规则[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.rules = splitList(m[1]);
			continue;
		}
		m = /^-?\s*势力[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.factions = splitList(m[1]);
			continue;
		}
		m = /^-?\s*地点[：:]\s*(.+)$/.exec(s);
		if (m) {
			ws.locations = splitList(m[1]);
			continue;
		}
		if (/^-?\s*历史[：:]?\s*$/.test(s)) {
			fenceTarget = "history";
			buf = [];
			continue;
		}
		if (/^-?\s*力量体系[：:]?\s*$/.test(s)) {
			fenceTarget = "magic_system";
			buf = [];
		}
	}
	return ws;
}

export function formatWorld(title: string, ws: WorldSettingDoc): string {
	const lines = [`# ${title} 世界观`, ""];
	if (ws.name) lines.push(`- 世界：${ws.name}`);
	if (ws.world_type) lines.push(`- 类型：${ws.world_type}`);
	if (ws.rules.length) lines.push(`- 规则：${joinList(ws.rules)}`);
	if (ws.factions.length) lines.push(`- 势力：${joinList(ws.factions)}`);
	if (ws.locations.length) lines.push(`- 地点：${joinList(ws.locations)}`);
	if (ws.history) lines.push("", "- 历史：", "```text", ws.history, "```");
	if (ws.magic_system) lines.push("", "- 力量体系：", "```text", ws.magic_system, "```");
	return lines.join("\n");
}

// ---------- 章节信息（章节信息.md）----------

/** 解析章节信息文档；保留无法识别的行由调用方处理 */
export function parseChapterInfo(text: string): ChapterInfoDoc & { preservedLines: string[] } {
	const info: ChapterInfoDoc & { preservedLines: string[] } = { tags: [], preservedLines: [] };
	let inComment = false;
	for (const line of String(text || "").split("\n")) {
		const s = line.trim();
		if (!s) continue;
		if (inComment) {
			info.preservedLines.push(line);
			if (s.includes("-->")) inComment = false;
			continue;
		}
		if (s.startsWith("#")) continue;
		if (s.includes("<!--")) {
			inComment = !s.includes("-->");
			info.preservedLines.push(line);
			continue;
		}
		const m = /^-?\s*(卷|标签|备注|创建时间|更新时间)[：:]\s*/.exec(s);
		if (m) {
			const key = m[1];
			const val = s.slice(m[0].length).trim();
			switch (key) {
				case "卷": if (val) info.volume = val; break;
				case "标签": info.tags = splitList(val); break;
				case "备注": if (val) info.notes = val; break;
				case "创建时间": if (val) info.created_at = val; break;
				case "更新时间": if (val) info.updated_at = val; break;
			}
			continue;
		}
		info.preservedLines.push(line);
	}
	return info;
}

/** 重写章节信息文档（对齐 DocumentStore.write_chapter_info：保留注释与未管理行） */
export function formatChapterInfo(num: number, heading: string, info: ChapterInfoDoc): string {
	const lines = [`# 第${num}章 ${heading} 章节信息`];
	if (info.volume) lines.push(`- 卷：${info.volume}`);
	if (info.tags.length) lines.push(`- 标签：${joinList(info.tags)}`);
	if (info.notes) lines.push(`- 备注：${info.notes}`);
	if (info.created_at) lines.push(`- 创建时间：${info.created_at}`);
	if (info.updated_at) lines.push(`- 更新时间：${info.updated_at}`);
	lines.push(...(info as ChapterInfoDoc & { preservedLines?: string[] }).preservedLines ?? []);
	return lines.join("\n") + "\n";
}

// ---------- 人物关系（人物关系.md，书/卷/章三层通用；v0.1.9+ 人物关系面板解析器）----------

/** 一条人物关系（书/卷/章三层通用；type/status 未标注时为空串） */
export interface RelationshipEntry {
	a: string; // 角色1（关系主体）
	b: string; // 角色2（关系对象）
	type: string; // 关系类型（如 师徒/队友），空=未标注
	status: string; // 关系状态原文（如 active/进行中），空=未标注
	desc: string; // 关系描述（多行原文，已去字段行与代码围栏）
}

/** 关系状态归一化类别：面板据此上色（active=进行中、pending=铺垫中、ended=已结束、unknown=未标注/未识别） */
export function relationshipStatusKind(status: string): "active" | "pending" | "ended" | "unknown" {
	const s = String(status || "").trim().toLowerCase();
	if (!s) return "unknown";
	if (/(end|over|close|done|finish|已结束|结束|终止|解除|断裂|决裂|反目|死亡|已死|逝|完结|失效|结束)/.test(s)) return "ended";
	if (/(pending|plan|待定|待|计划|铺垫|未定|将来|未来|拟|筹划|萌芽|酝酿|伏笔)/.test(s)) return "pending";
	if (/(active|on\b|进行中|生效|有效|持续|正在|当前|存续|进行|已建立|成立)/.test(s)) return "active";
	return "unknown";
}

/** 关系条目字段行（- 角色1：X / - 类型：X / - 状态：X / - 描述：X） */
const REL_FIELD_RE = /^\s*[-*+]?\s*([^：:]{1,8})[：:]\s*(.*)$/;

/** 标题行拆角色对：支持 "林川 - 苏晚" / "林川 ↔ 苏晚" / "林川与苏晚"；无分隔符时整体作角色1（角色2 由字段行补） */
function splitRelationshipTitle(title: string): { a: string; b: string } {
	const t = title.trim();
	const m = /^(.+?)\s*(?:[-–—~〜↔=]|与|\/|／|、)\s*(.+)$/.exec(t);
	if (m) return { a: m[1].trim(), b: m[2].trim() };
	return { a: t, b: "" };
}

/**
 * 解析《人物关系.md》：按 `## ` 分块，每块一条关系。
 * 兼容两种写法——①标题带角色对：`## 林川 - 苏晚` + 描述（旧模板）；②字段式：`## 关系1` + `- 角色1：…` `- 角色2：…`（可带 `- 类型：` `- 状态：` `- 描述：`）。
 * 描述可为 `- 描述：` 后接正文、或 ```text 围栏内容、或块内剩余自由文本行（三者合并）。角色1/2 都解析不出的块整块忽略。
 */
export function parseRelationships(text: string): RelationshipEntry[] {
	const body = stripComments(text || "");
	const out: RelationshipEntry[] = [];
	let cur: { a: string; b: string; type: string; status: string; descLines: string[] } | null = null;
	let inFence = false;
	const flush = (): void => {
		if (!cur) return;
		const { a, b, type, status, descLines } = cur;
		cur = null;
		if (!a.trim() && !b.trim()) return; // 非关系块（如「概述」）忽略
		out.push({ a: a.trim(), b: b.trim(), type: type.trim(), status: status.trim(), desc: descLines.join("\n").trim() });
	};
	for (const rawLine of body.split("\n")) {
		const line = rawLine.replace(/\s+$/, "");
		if (/^\s*```/.test(line)) {
			inFence = !inFence; // 围栏标记行本身不进正文
			continue;
		}
		if (inFence) {
			if (cur) cur.descLines.push(line);
			continue;
		}
		if (/^##\s+/.test(line)) {
			flush();
			const { a, b } = splitRelationshipTitle(line.replace(/^##\s+/, ""));
			cur = { a, b, type: "", status: "", descLines: [] };
			continue;
		}
		if (/^#\s+/.test(line)) continue; // 文档 H1 标题行忽略
		if (!cur) continue; // 尚未进入任何 ## 块的内容（如块外散文）忽略
		const m = REL_FIELD_RE.exec(line);
		if (m) {
			const key = m[1].trim();
			const val = m[2].trim();
			if (/^(角色1|角色一|角色A|角色a|甲方|主体|角色名1|角色1名)$/.test(key)) {
				if (val) cur.a = val;
				continue;
			}
			if (/^(角色2|角色二|角色B|角色b|乙方|对象|角色名2|角色2名)$/.test(key)) {
				if (val) cur.b = val;
				continue;
			}
			if (/^(类型|关系类型|关系)$/.test(key)) {
				cur.type = val;
				continue;
			}
			if (/^(状态|关系状态)$/.test(key)) {
				cur.status = val;
				continue;
			}
			if (/^(描述|说明|详情|备注|简介)$/.test(key)) {
				if (val) cur.descLines.push(val);
				continue;
			}
			continue; // 其它字段（如「出场章节」）不并入描述
		}
		if (!line.trim()) continue;
		cur.descLines.push(line.trim()); // 无字段前缀的自由文本行也算描述
	}
	flush();
	return out;
}

/** 关系条目序列化为文档块（与 parseRelationships 往返一致；供模板/迁移使用） */
export function formatRelationshipBlock(e: RelationshipEntry): string {
	const head = e.b ? `${e.a} - ${e.b}` : e.a;
	const lines = [`## ${head}`];
	if (e.type) lines.push(`- 类型：${e.type}`);
	if (e.status) lines.push(`- 状态：${e.status}`);
	if (e.desc) lines.push("- 描述：", "```text", e.desc, "```");
	lines.push("");
	return lines.join("\n");
}

/** 在《人物关系.md》原文里定位一条关系块（按角色对匹配 `## A - B` 及等价分隔符写法，注释掩码后匹配；ordinal＝同名角色对的第 N 处，0 起）：
 *  跳过 ``` 围栏里的 `#` 行；块尾＝下一条标题行（不含）。找不到返回 null。 */
export function findRelationshipBlock(text: string, a: string, b: string, ordinal = 0): { start: number; end: number } | null {
	const mLines = maskCommentSpans(text).split("\n");
	const oLines = text.split("\n");
	let seen = -1;
	let start = -1;
	let inFence = false;
	for (let i = 0; i < mLines.length; i++) {
		if (/^\s*```/.test(mLines[i])) { inFence = !inFence; continue; }
		if (inFence) continue;
		const t = mLines[i].trim();
		const hm = /^(#{1,6})\s+(.*)$/.exec(t);
		if (!hm) continue;
		const pair = splitRelationshipTitle(hm[2]);
		if (pair.a !== a.trim() || pair.b !== b.trim()) continue;
		seen++;
		if (seen === ordinal) { start = i; break; }
	}
	if (start < 0) return null;
	let end = oLines.length;
	inFence = false;
	for (let i = start + 1; i < oLines.length; i++) {
		if (/^\s*```/.test(oLines[i])) { inFence = !inFence; continue; }
		if (inFence) continue;
		if (/^\s*#{1,6}\s+/.test(oLines[i])) { end = i; break; }
	}
	return { start, end };
}

/** 改写《人物关系.md》里的一条关系块（只换自块、其余文档内容原样保留）：按角色对＋出现序号定位，
 *  校验该块解析出的仍是同一对角色（防快照过期误写）→ 用 formatRelationshipBlock 重写。失败返回 null，调用方应提示刷新重试 */
export function updateRelationshipBlock(text: string, old: RelationshipEntry, updated: RelationshipEntry, ordinal = 0): string | null {
	const range = findRelationshipBlock(text, old.a, old.b, ordinal);
	if (!range) return null;
	const lines = text.split("\n");
	const blockLines = lines.slice(range.start, range.end).join("\n");
	const parsed = parseRelationships(`# 人物关系\n\n${blockLines}`);
	if (!parsed.length || parsed[0].a !== old.a.trim() || parsed[0].b !== old.b.trim()) return null; // 原文该处已不是这条关系
	const replacement = formatRelationshipBlock(updated).replace(/\n+$/, "").split("\n");
	lines.splice(range.start, range.end - range.start, ...replacement, "");
	return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** 删除《人物关系.md》里的一条关系块（只删自块、其余原样保留）：按角色对＋出现序号定位并校验仍是同一对角色；失败返回 null */
export function deleteRelationshipBlock(text: string, old: RelationshipEntry, ordinal = 0): string | null {
	const range = findRelationshipBlock(text, old.a, old.b, ordinal);
	if (!range) return null;
	const lines = text.split("\n");
	const parsed = parseRelationships(`# 人物关系\n\n${lines.slice(range.start, range.end).join("\n")}`);
	if (!parsed.length || parsed[0].a !== old.a.trim() || parsed[0].b !== old.b.trim()) return null;
	lines.splice(range.start, range.end - range.start);
	return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** 关系列表序列化为完整文档（标题恒为 `# 人物关系`） */
export function formatRelationships(items: RelationshipEntry[]): string {
	return ["# 人物关系", "", ...items.map((e) => formatRelationshipBlock(e))].join("\n").replace(/\n+$/, "\n");
}

// ---------- 时间线（时间线.md，书/卷/章三层通用；v0.2.x+ 时间线面板解析器）----------

/** 一条时间线事件（书/卷/章三层通用；合并大事件后字段与之对齐）：时间点＝整年＋可选月日（如 -129 / -129-06 / -129-06-15），兼容旧版纯数字写法（小数/科学计数法按「仅年份」处理）；标题行＝时间点＋可选空格分隔事件名（如 `## 120-06-15 黑市陷阱`）；level＝标题深度（#=一级、##=二级、###=三级，最深 ######）决定事件层级；面板按 (年,月,日) 升序自上而下渲染并按级别嵌套折叠 */
export interface TimelineEntry {
	level: number; // 事件级别＝标题深度（1–6）：决定嵌套层级与圆点大小/颜色
	time: number; // 年份（任意数字，负数/小数兼容旧数据）
	month?: number; // 月份（1-12；未写则缺省）
	day?: number; // 日期（1-31；未写则缺省）
	title?: string; // 事件名（标题行时间点之后的空格分隔文本；旧纯时间点标题缺省＝无名）
	chars: string[]; // 涉及人物（空数组=未标注）
	desc?: string; // 详情（唯一正文内容字段：面板内联显示＋悬停 Tip；写回出 `- 详情：`。旧 `- 描述：` 与更旧的 `- 事件：` 及其别名都并入这里，不再单独保留「事件」字段；未写则缺省）
	impact?: string; // 影响（别名 后果/代价/事件影响；合并自大事件列表）
	related?: string[]; // 关联（别名 相关/关联事件；顿号/逗号分隔的其它事件名，面板 chip 跳转）
	done?: boolean; // 完成状态（仅 true 时写出 `- 完成：是` 行；缺省＝未完成，面板 ✓/○ 快速切换）
	srcHeading?: string; // 来源文档中标题行的原样全文（尾部空白已去）：面板拖动更新时间点时据此在原文中定位本条目
	srcOrdinal?: number; // 同文本标题行在该文档内的出现序号（0 起）：同名重复标题的消歧定位
}

/** 面板/生成侧写回用的时间线条目输入（＝TimelineEntry 去掉原文定位字段；updateTimelineBlock/insertTimelineBlock/formatTimelineBlock 入参） */
export type TimelineEntryInput = Pick<TimelineEntry, "level" | "time" | "month" | "day" | "title" | "chars" | "desc" | "impact" | "related" | "done">;

/** 时间点结构化值（标题解析结果；序列化经 timelineTimeText 往返一致） */
export type TimelinePoint = Pick<TimelineEntry, "time" | "month" | "day">;

/** 纯数字时间点判定（支持 -3 / +2 / 1.5 / .5 / 1e4 等旧写法；带任何文字即非有效时间点） */
const TL_TIME_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** 年-月[-日] 整数时间点判定（如 -129-06、120-03-07；月日必须成对出现于连字符后，小数/科学计数法不允许挂月日后缀） */
const TL_DATE_MD_RE = /^([+-]?\d+)-(\d{1,2})(?:-(\d{1,2}))?$/;

export function parseTimelineTime(title: string): TimelinePoint | null {
	const t = title.trim();
	if (!t) return null;
	const dm = TL_DATE_MD_RE.exec(t); // 先试「年-月[-日]」：裸年份走下方纯数字分支，两路结果等价
	if (dm) {
		const mo = Number(dm[2]);
		const da = dm[3] ? Number(dm[3]) : undefined;
		if (mo < 1 || mo > 12) return null; // 非法月份整块视为非有效时间点
		if (da !== undefined && (da < 1 || da > 31)) return null;
		return { time: Number(dm[1]), month: mo, day: da };
	}
	if (!TL_TIME_RE.test(t)) return null;
	const n = Number(t);
	return Number.isFinite(n) ? { time: n } : null;
}

/** 时间点的规范文本（面板展示与写回标题共用）：纯数字原样；写了月/日则补零到两位（-129-06 / -129-06-15），可被 parseTimelineTime 原样解析回 */
export function timelineTimeText(p: TimelinePoint): string {
	let s = String(p.time);
	if (p.month != null) s += `-${String(p.month).padStart(2, "0")}`;
	if (p.day != null) s += `-${String(p.day).padStart(2, "0")}`;
	return s;
}

/** 一天的毫秒数（时间点间隔/拖动换算共用） */
export const TIMELINE_DAY_MS = 86_400_000;

/** 时间点 → 绝对毫秒时刻（时间线面板间隔与拖动换算共用口径）：缺月按一月、缺日按一号；极端超范围年份得 NaN 时退化为「年 × 365 天」近似，保证结果有限且对升序输入单调不减 */
export function timelinePointEpochMs(p: TimelinePoint): number {
	const y = Math.trunc(p.time);
	const ms = Date.UTC(y, (p.month ?? 1) - 1, p.day ?? 1);
	return Number.isFinite(ms) ? ms : y * 365 * TIMELINE_DAY_MS;
}

/** 拖动改时的精度单位（＝条目自身精度：含日＝天、只含月＝月、纯年＝年） */
export type TimelineUnit = "day" | "month" | "year";

/** 某年某月的天数（用于月/年平移时把 31 日夹到目标月最后一天） */
function tlDaysInMonth(year: number, month: number): number {
	const d = new Date(Date.UTC(year, month, 0)).getUTCDate(); // 下月第 0 天＝本月最后一天
	return Number.isFinite(d) ? d : 31;
}

/** 按「父事件的精度单位」平移时间点并保持目标自身的精度（日→精确日期、月→年月、年→年）：
 *  拖动父事件时子事件同步平移用——父含日就整体挪同样天数、父只含月就挪同样月数、父纯年就挪同样年数
 *  （月/年平移按日历算，闰年与月末自动夹到合法日期；年精度条目只取结果年份）。 */
export function shiftTimelinePointBy(p: TimelinePoint, unit: TimelineUnit, steps: number): TimelinePoint {
	if (!steps) return { time: p.time, month: p.month, day: p.day };
	if (unit === "day") {
		const dt = new Date(timelinePointEpochMs(p) + steps * TIMELINE_DAY_MS);
		if (!Number.isFinite(dt.getTime())) return { time: p.time + Math.round(steps / 365), month: p.month, day: p.day }; // 极端年份：退化按年近似
		const y = dt.getUTCFullYear();
		if (p.day != null) return { time: y, month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
		if (p.month != null) return { time: y, month: dt.getUTCMonth() + 1 };
		return { time: y };
	}
	if (unit === "month") {
		const nIdx = Math.trunc(p.time) * 12 + ((p.month ?? 1) - 1) + steps;
		const y = Math.floor(nIdx / 12);
		const m = ((nIdx % 12) + 12) % 12 + 1;
		if (p.month == null) return { time: y }; // 年精度：月平移只可能带动年份
		if (p.day == null) return { time: y, month: m };
		return { time: y, month: m, day: Math.min(p.day, tlDaysInMonth(y, m)) };
	}
	const y = (p.month == null ? p.time : Math.trunc(p.time)) + steps; // 纯年精度保留原值（旧数据可能有小数年）；含月/日先截断为整年
	if (p.month == null) return { time: y };
	if (p.day == null) return { time: y, month: p.month };
	return { time: y, month: p.month, day: Math.min(p.day, tlDaysInMonth(y, p.month)) };
}

/** 标题行文本解析为「时间点＋可选事件名」（v0.3.3+ 合并大事件）：整串即有效时间点＝旧纯时间点标题（无名）；否则首个空白分隔 token 取时间点、其剩余文本整段为事件名（`120-06-15 黑市陷阱`）。首 token 非有效时间点返回 null（`# 时间线`、「概述」等非时间点标题块） */
export function parseTimelineHeading(head: string): { point: TimelinePoint; title?: string } | null {
	const t = head.trim();
	const direct = parseTimelineTime(t);
	if (direct) return { point: direct };
	const m = /^(\S+)\s+(\S.*)$/.exec(t);
	if (!m) return null;
	const point = parseTimelineTime(m[1]);
	if (!point) return null;
	return { point, title: m[2] };
}

/** 正文行并入 cur 块最近出现的详情/影响字段（围栏内容与无字段前缀自由文本同口径；v0.4.11+ 不再有独立的「事件」字段，旧 `- 事件：` 也并入详情） */
function tlPushBody(cur: { target: "desc" | "impact"; descLines: string[]; impactLines: string[] }, line: string): void {
	cur[cur.target === "desc" ? "descLines" : "impactLines"].push(line);
}

/**
 * 解析《时间线.md》：按 ATX 标题（`# `–`###### `，任意深度）分块，每块一条事件，标题深度即事件级别（#=一级、##=二级、###=三级，可更深）。
 * 标题＝时间点＋可选空格分隔事件名（parseTimelineHeading 口径）——`# 120`、`## 120-06-15 黑市陷阱`、`### -129-06`〔旧纯时间点标题，无名〕；非有效时间点标题的块（文档标题 `# 时间线`、「概述」、月份越界等）整块忽略。
 * 块内字段行（复用 REL_FIELD_RE）：`- 人物：A、B`（别名 角色/登场人物/涉及人物/出场人物）、`- 详情：…`（唯一正文内容字段，面板内联显示＋悬停 Tip；别名 描述/事件/经过/简述/说明/备注/简介——旧 `- 事件：` 内容一并并入，不再单独存储）、`- 影响：…`（别名 后果/代价/事件影响）、`- 关联：…`（别名 相关/关联事件/相关事件，顿号/逗号分隔）、`- 完成：是/否`（别名 完成状态/状态/是否完成；是/已完成/完成→true、空值视作勾选、其余→false）。
 * 正文归属：`- 详情：`（旧 `- 描述：`／`- 事件：` 兼容）/`- 影响：` 行后接的文本、```text 围栏内容、无字段前缀的自由文本行，均并入**最近出现**的详情/影响字段（块内尚未出现两者时归详情）；其它字段行与其它列表行不并入。
 */
export function parseTimelines(text: string): TimelineEntry[] {
	const body = stripComments(text || "");
	const out: TimelineEntry[] = [];
	let cur: (TimelinePoint & { level: number; title?: string; chars: string[]; descLines: string[]; impactLines: string[]; related: string[]; done: boolean; target: "desc" | "impact"; rawHead: string; ordinal: number }) | null = null;
	let inFence = false;
	const headSeen = new Map<string, number>(); // 各标题行文本的出现计数（写回时同名重复标题消歧）
	const flush = (): void => {
		if (!cur) return;
		const e: TimelineEntry = { level: cur.level, time: cur.time, chars: [...new Set(cur.chars)] };
		if (cur.title) e.title = cur.title; // 旧纯时间点标题保持字段缺省（无名）
		const d = cur.descLines.join("\n").trim();
		if (d) e.desc = d; // 详情（含旧 `- 事件：` 内容）；未写的条目保持字段缺省
		const im = cur.impactLines.join("\n").trim();
		if (im) e.impact = im;
		if (cur.related.length) e.related = [...cur.related];
		if (cur.done) e.done = true; // 未完成条目字段缺省（仅 true 写出 `- 完成：是` 行，保证往返一致）
		if (cur.month != null) e.month = cur.month; // 未写月/日的条目保持字段缺省（不显式落 undefined）
		if (cur.day != null) e.day = cur.day;
		e.srcHeading = cur.rawHead; // 写回定位信息：标题行原样全文＋文档内出现序号（面板拖动更新时间点/编辑写回时用）
		e.srcOrdinal = cur.ordinal;
		out.push(e);
		cur = null;
	};
	for (const rawLine of body.split("\n")) {
		const line = rawLine.replace(/\s+$/, "");
		if (/^\s*```/.test(line)) {
			inFence = !inFence; // 围栏标记行本身不进正文
			continue;
		}
		if (inFence) {
			if (cur) tlPushBody(cur, line); // 围栏内容归最近出现的事件/描述/影响字段
			continue;
		}
		const hm = /^(#{1,6})\s+(.*)$/.exec(line);
		if (hm) {
			flush();
			const hp = parseTimelineHeading(hm[2]);
			if (hp === null) continue; // 非有效时间点标题块整块忽略（含文档 H1 标题；cur 已被 flush 置空，其下内容自然丢弃）
			const ordinal = headSeen.get(line) ?? 0; // 本标题行文本出现序号（写回定位用，同名重复标题消歧）
			headSeen.set(line, ordinal + 1);
			cur = { ...hp.point, level: hm[1].length, title: hp.title, chars: [], descLines: [], impactLines: [], related: [], done: false, target: "desc", rawHead: line, ordinal };
			continue;
		}
		if (!cur) continue; // 尚未进入任何有效时间点块的内容（如块外散文）忽略
		const m = REL_FIELD_RE.exec(line);
		if (m) {
			const key = m[1].trim();
			const val = m[2].trim();
			if (/^(人物|角色|登场人物|涉及人物|出场人物)$/.test(key)) {
				for (const c of splitList(val)) if (c && !cur.chars.includes(c)) cur.chars.push(c);
				continue;
			}
			if (/^(详情|描述|事件|经过|简述|说明|备注|简介)$/.test(key)) { // v0.4.11+ 唯一正文内容字段＝详情：旧 `- 事件：` 及其别名、旧 `- 描述：` 一律并入详情（写回统一出 `- 详情：`）
				if (val) cur.descLines.push(val);
				cur.target = "desc"; // 后续自由文本/围栏归详情（支持 ```text 围栏多行写法）
				continue;
			}
			if (/^(影响|后果|代价|事件影响)$/.test(key)) {
				if (val) cur.impactLines.push(val);
				cur.target = "impact"; // 后续自由文本/围栏归影响
				continue;
			}
			if (/^(关联|相关|关联事件|相关事件)$/.test(key)) {
				for (const r of splitList(val)) if (r && !cur.related.includes(r)) cur.related.push(r);
				continue;
			}
			if (/^(完成|完成状态|状态|是否完成)$/.test(key)) {
				cur.done = !val || /^(是|已完成|完成|true|yes)$/i.test(val); // 空值＝只写字段名视作勾选；「否/未完成」等落入 false
				continue;
			}
			continue; // 其它字段（如「发生章节」）不并入正文
		}
		if (!line.trim()) continue;
		if (/^\s*[-*+]/.test(line)) continue; // 其它列表行（未识别字段等）不并入正文
		tlPushBody(cur, line.trim()); // 无字段前缀的自由文本行归最近出现的事件/描述/影响字段
	}
	flush();
	return out;
}

/** HTML 注释内容逐字符替换为空格（保留换行 → 行号与原文一一对应）：用于在**原文**中定位「可见」标题行——模板示例等注释里的同名标题不得误命中 */
function maskCommentSpans(text: string): string {
	let out = "";
	let inC = false;
	for (let i = 0; i < text.length; i++) {
		if (!inC && text.startsWith("<!--", i)) { inC = true; out += "    "; i += 3; continue; } // "<!--" 整体掩掉
		if (inC && text.startsWith("-->", i)) { inC = false; out += "   "; i += 2; continue; } // "-->" 整体掩掉
		out += inC ? (text[i] === "\n" ? "\n" : " ") : text[i];
	}
	return out;
}

/** 改写《时间线.md》原文中单条目的时间点（时间线面板拖动更新的写回路径）：先用 maskCommentSpans 掩去注释区，再按 srcHeading 全文精确匹配＋文档内出现序号 srcOrdinal 定位目标标题行；校验该行能反解出 expectOld 后，把标题号之后的时间点部分替换为 timelineTimeText(newPoint) 规范值（保留原标题深度与其后的事件名）。任一环节不满足返回 null——调用方应提示用户刷新重试而非继续。标题行内含行内注释不支持（整行替换会将其丢失），同样返回 null */
/** 批量改时的一处移动：来源标题行＋出现序号（原样定位）＋旧时间点（防快照过期）＋新时间点 */
export interface TimelineTimeMove {
	srcHeading: string;
	srcOrdinal: number;
	expectOld: TimelinePoint;
	newPoint: TimelinePoint;
}

/** 批量改写多个条目的时间点（拖动父事件时子事件同步平移）：**先按原文本一次性解析全部行号并校验旧值**，再统一替换——
 *  避免逐条改写后标题文本变化导致同名标题的出现序号漂移。任一条定位失败/旧值不符 → 整批放弃返回 null。 */
export function rewriteTimelineEntryTimes(text: string, moves: TimelineTimeMove[]): string | null {
	if (!moves.length) return text;
	const mLines = maskCommentSpans(text).split("\n");
	const oLines = text.split("\n");
	const idxs: number[] = [];
	const seenIdx = new Set<number>();
	for (const mv of moves) {
		let seen = -1;
		let idx = -1;
		for (let i = 0; i < mLines.length; i++) {
			if (mLines[i].trim() !== mv.srcHeading) continue;
			seen++;
			if (seen === mv.srcOrdinal) { idx = i; break; }
		}
		if (idx < 0) return null; // 原文自解析后已变化（对应标题不存在/位置改变）→ 放弃防误写
		if (seenIdx.has(idx)) return null; // 同一条目被重复移动＝调用侧数据异常
		seenIdx.add(idx);
		const target = oLines[idx];
		if (/<!--|-->/ .test(target)) return null; // 标题行带行内注释：不做有损替换
		const hm = /^(#{1,6})\s+(.*)$/.exec(target.trim());
		if (!hm) return null;
		const hp = parseTimelineHeading(hm[2]);
		if (!hp || hp.point.time !== mv.expectOld.time || (hp.point.month ?? 0) !== (mv.expectOld.month ?? 0) || (hp.point.day ?? 0) !== (mv.expectOld.day ?? 0)) return null; // 快照过期：该处时间点与本条目旧值不符
		idxs.push(idx);
	}
	for (let k = 0; k < moves.length; k++) {
		const idx = idxs[k];
		const hm = /^(#{1,6})\s+(.*)$/.exec(oLines[idx].trim());
		if (!hm) return null;
		const hp = parseTimelineHeading(hm[2]);
		if (!hp) return null;
		oLines[idx] = `${hm[1]} ${timelineTimeText(moves[k].newPoint)}${hp.title ? ` ${hp.title}` : ""}`; // 只换时间点、保留其后的事件名
	}
	return oLines.join("\n");
}

/** 改写单个条目的时间点（保留事件名）：rewriteTimelineEntryTimes 的单条特例 */
export function rewriteTimelineEntryTime(
	text: string,
	srcHeading: string,
	srcOrdinal: number,
	expectOld: TimelinePoint,
	newPoint: TimelinePoint,
): string | null {
	return rewriteTimelineEntryTimes(text, [{ srcHeading, srcOrdinal, expectOld, newPoint }]);
}

/** 时间线条目序列化为文档块（与 parseTimelines 往返一致）：标题行＝`#`×级别＋空格＋规范时间点＋可选空格＋事件名；字段顺序＝人物/完成/详情/影响/关联——人物、关联单行，完成仅 done=true 写出 `- 完成：是`，详情/影响非空时以 `- 字段：`＋```text 围栏写出（多行安全；v0.4.11+ 不再写 `- 事件：`，旧文档的事件内容已在解析时并入详情）。块尾带空行 */
export function formatTimelineBlock(e: TimelineEntryInput): string {
	const head = `${"#".repeat(Math.max(1, Math.min(6, e.level)))} ${timelineTimeText(e)}`;
	const lines = [e.title?.trim() ? `${head} ${e.title.trim()}` : head];
	if (e.chars.length) lines.push(`- 人物：${joinList(e.chars)}`);
	if (e.done) lines.push("- 完成：是");
	const pushFenced = (label: string, text: string | undefined): void => {
		const t = String(text ?? "").replace(/\s+$/, "");
		if (!t) return;
		lines.push(`- ${label}：`, "```text", t, "```");
	};
	pushFenced("详情", e.desc); // v0.4.11+ 唯一正文内容字段：旧 `- 事件：`／`- 描述：` 解析时已并入 desc，写回只出 `- 详情：`
	pushFenced("影响", e.impact);
	if (e.related?.length) lines.push(`- 关联：${joinList(e.related)}`);
	lines.push("");
	return lines.join("\n");
}

/** 时间线列表序列化为完整文档（标题恒为 `# 时间线`） */
export function formatTimelines(items: TimelineEntryInput[]): string {
	return ["# 时间线", "", ...items.map((e) => formatTimelineBlock(e))].join("\n").replace(/\n+$/, "\n");
}

/** 生成侧格式校验（ensureTimeline 落盘前把关）：正文须含至少一个时间点标题块（parseTimelineHeading 同口径，含事件名与否不限；围栏内标题行不算节点） */
export function timelineGenFormatOk(text: string): boolean {
	let heads = 0;
	let inFence = false;
	for (const rawLine of stripComments(text || "").split("\n")) {
		const line = rawLine.replace(/\s+$/, "");
		if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
		if (inFence) continue;
		const hm = /^(#{1,6})\s+(.*)$/.exec(line);
		if (hm && parseTimelineHeading(hm[2])) heads++;
	}
	return heads > 0;
}

/** 时间线节点起始行判定：任意 ATX 标题行（`######` 更深不算）。比「时间点标题」更保守的块边界口径——`# 时间线`、「概述」等非时间点标题同样是边界，其下内容不会被误当作上一条目正文被增删改写回吞掉 */
function tlNodeLevel(line: string): number | null {
	const hm = /^(#{1,6})\s+/.exec(line);
	return hm ? hm[1].length : null;
}

/** 原文中定位时间线节点的起始行号（注释掩码后按 srcHeading 全文 trim 匹配＋出现序号；同拖动写回口径）。找不到返回 -1 */
function findTimelineNodeLine(text: string, srcHeading: string, srcOrdinal: number): number {
	const mLines = maskCommentSpans(text).split("\n");
	let seen = -1;
	for (let i = 0; i < mLines.length; i++) {
		if (mLines[i].trim() !== srcHeading.trim()) continue;
		seen++;
		if (seen === srcOrdinal) return i;
	}
	return -1;
}

/** 时间线节点自块尾行号（不含子节点）＝起始行之后下一条标题行的前一行；subtree=true 时含全部后代（直到下一条级别≤本级的标题行或文档尾）。``` 围栏区整体跳过（围栏内的 `#` 行不算标题）。返回尾行号（不含） */
function timelineNodeEnd(lines: string[], start: number, level: number, subtree: boolean): number {
	let inFence = false;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i].replace(/\s+$/, "");
		if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
		if (inFence) continue;
		const lv = tlNodeLevel(line);
		if (lv === null) continue;
		if (!subtree || lv <= level) return i;
	}
	return lines.length;
}

/** 写回公共前处理：定位起始行并给出原行数组（写回前原文自解析后已变化则返回 null——调用方应提示刷新重试而非继续） */
function timelineEditBase(text: string, srcHeading: string, srcOrdinal: number): { lines: string[]; start: number } | null {
	const start = findTimelineNodeLine(text, srcHeading, srcOrdinal);
	if (start < 0) return null;
	return { lines: text.split("\n"), start };
}

/** 增删改后规范化：块间连续空行压缩为一个（块尾空行由 formatTimelineBlock 提供，删除/插入交界处可能出现 0 或 2+ 个空行） */
function normalizeTimelineGaps(text: string): string {
	return text.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** 更新时间线节点自块（保留其子节点）：定位后把 [start, 自块尾) 替换为条目序列化块。起始行校验必须仍是标题行；定位失败返回 null */
export function updateTimelineBlock(text: string, srcHeading: string, srcOrdinal: number, entry: TimelineEntryInput): string | null {
	const base = timelineEditBase(text, srcHeading, srcOrdinal);
	if (!base) return null;
	if (tlNodeLevel(base.lines[base.start].replace(/\s+$/, "")) === null) return null;
	const end = timelineNodeEnd(base.lines, base.start, entry.level, false);
	const block = formatTimelineBlock(entry).split("\n");
	block.pop(); // 块尾空行单列处理
	return normalizeTimelineGaps([...base.lines.slice(0, base.start), ...block, "", ...base.lines.slice(end)].join("\n"));
}

/** 在锚点节点之后插入新时间线节点：subtree=true 挂锚点末尾＝最后一个子/兄弟之后（加子节点传父锚点＋entry.level=父+1；加兄弟传锚点自身＋entry.level=同级）；锚点为 null＝追加到文档末尾。定位失败返回 null */
export function insertTimelineBlock(text: string, entry: TimelineEntryInput, afterHeading: string | null, afterOrdinal: number): string | null {
	const lines = text.split("\n");
	let at = lines.length;
	if (afterHeading !== null) {
		const start = findTimelineNodeLine(text, afterHeading, afterOrdinal);
		if (start < 0) return null;
		const lv = tlNodeLevel(lines[start].replace(/\s+$/, ""));
		if (lv === null) return null;
		at = timelineNodeEnd(lines, start, lv, true); // 锚点整棵子树末尾
	}
	while (at > 0 && !lines[at - 1].trim()) at--; // 回退掉块间空行，紧贴最后一个内容行插入
	const block = formatTimelineBlock(entry).split("\n");
	return normalizeTimelineGaps([...lines.slice(0, at), ...(at > 0 ? [""] : []), ...block, ...lines.slice(at)].join("\n")); // block 自带块尾空行与锚点后内容衔接；多余空行由 normalize 收拢
}

/** 删除时间线节点：subtree=true 连同全部后代删除（面板默认），false 只删自块。定位失败返回 null */
export function deleteTimelineBlock(text: string, srcHeading: string, srcOrdinal: number, level: number, subtree: boolean): string | null {
	const base = timelineEditBase(text, srcHeading, srcOrdinal);
	if (!base) return null;
	const lv = tlNodeLevel(base.lines[base.start].replace(/\s+$/, ""));
	if (lv === null) return null;
	const end = timelineNodeEnd(base.lines, base.start, subtree ? lv : level, subtree);
	return normalizeTimelineGaps([...base.lines.slice(0, base.start), ...base.lines.slice(end)].join("\n"));
}

// ---------- 大纲读取辅助 ----------

/** 去掉文档开头的 "# " 标题行，返回 [正文, 标题] */
/** v0.4.7+ 多时间线：文件名是否为「时间线开头」的时间线文档（默认 `时间线.md` 或扩展 `时间线-***.md`） */
export function isTimelineDocName(name: string): boolean {
	return name === "时间线.md" || /^时间线-.+\.md$/.test(name);
}

/** v0.4.7+ 从时间线物理文件名提取泳道名：`时间线.md`→"默认"；`时间线-战斗线.md`→"战斗线"；带容器前缀的旧命名（`01-初见-时间线-战斗线.md`／`风起-时间线.md`）先剥前缀再取名 */
export function timelineLaneOf(name: string, prefixes: string[] = []): string {
	let base = name.replace(/\.md$/i, "");
	for (const p of prefixes) {
		if (p && base.startsWith(`${p}-`)) {
			base = base.slice(p.length + 1);
			break;
		}
	}
	if (base === "时间线") return "默认";
	if (base.startsWith("时间线-")) return base.slice("时间线-".length) || "默认";
	return "默认";
}

/** v0.4.9+ **层级词**默认口径（＝场景面板／时间线面板的「级别」行与级别下拉前缀）：book＝书级／volume＝卷级／chapter＝章级。
 *  个别面板用别的词（人物关系面板＝书籍级／卷级／章级）＝调 `docLocationLabel` 时传自己的 `words`，三个面板共用同一套拼法（代码重用） */
export const DOC_SCOPE_WORDS: Record<"book" | "volume" | "chapter", string> = { book: "书级", volume: "卷级", chapter: "章级" };

/** 文档的**书内相对路径**（＝「级别」行与级别下拉里显示的位置，用户要求＝从书籍目录起算、不带仓库里的《工作目录/<书名>/》前缀）：
 *  `bookDir` 空或路径不在该书目录下＝原样返回（异常/全局文档不吞路径） */
export function docRelPath(path: string, bookDir: string): string {
	if (!bookDir) return path;
	return path.startsWith(`${bookDir}/`) ? path.slice(bookDir.length + 1) : path;
}

/** 某个文档/条目（事件、场景、人物、关系…）**所在位置**文案＝`层级词 · 书内路径`（场景/时间线/人物关系三个面板的「级别」行同一口径；
 *  卷名/章名/泳道名本就在路径的目录名与文件名里）；`words`＝该面板的层级词，默认 `DOC_SCOPE_WORDS`（书级／卷级／章级） */
export function docLocationLabel(
	scope: "book" | "volume" | "chapter",
	path: string,
	bookDir: string,
	words: Record<"book" | "volume" | "chapter", string> = DOC_SCOPE_WORDS,
): string {
	return `${words[scope]} · ${docRelPath(path, bookDir)}`;
}

export function stripTitleLine(text: string): [string, string] {
	const lines = String(text || "").split("\n");
	if (lines[0]?.trim().startsWith("# ")) {
		const title = lines[0].trim().replace(/^#+\s*/, "");
		return [lines.slice(1).join("\n").trim(), title];
	}
	return [String(text || "").trim(), ""];
}

// ---------- 章节号选择解析（pack/统计用；支持阿拉伯数字与中文数字、范围、列表）----------

export interface ChapterSelection {
	nums: number[]; // 去重升序，仅含 available 中存在的章
	invalid: string[]; // 无法识别的片段原文
}

/**
 * 解析章节选择表达式：
 * - "all"/"全部"/空 → 全部可用章
 * - 单章："3" / "三"
 * - 范围："3-7" / "3到7" / "三至七" / "3~7"
 * - 列表："1,2,5" / "1、2、5" / "1 2 5"（空白分隔）
 */
export function parseChapterSelection(text: string, available: number[]): ChapterSelection {
	const avail = new Set(available);
	const nums = new Set<number>();
	const invalid: string[] = [];
	const addNum = (n: number | null) => {
		if (n === null || n <= 0 || !avail.has(n)) {
			return false;
		}
		nums.add(n);
		return true;
	};
	const raw = String(text ?? "").trim();
	if (!raw || /^(all|全部)$/i.test(raw)) {
		for (const n of available) nums.add(n);
		return { nums: [...nums].sort((a, b) => a - b), invalid };
	}
	// 先按逗号/顿号切分，再处理其中的范围与纯数字片段
	let parts = raw.split(/[,，、]/).map((p) => p.trim()).filter(Boolean);
	// 无逗号时尝试按空白切分（如 "3 7 12"），但保留含连接符的完整范围片段
	if (parts.length === 1 && /\s/.test(parts[0])) {
		parts = parts[0].split(/\s+/).filter(Boolean);
	}
	for (let part of parts) {
		part = part.replace(/[～~]/g, "-");
		const rangeM = /^\s*(\d{1,6}|[一二三四五六七八九十百零两]+)\s*[-到至]\s*(\d{1,6}|[一二三四五六七八九十百零两]+)\s*$/.exec(part);
		if (rangeM) {
			const lo = cnToNum(rangeM[1]);
			const hi = cnToNum(rangeM[2]);
			if (lo === null || hi === null || lo > hi) {
				invalid.push(part);
				continue;
			}
			for (let n = lo; n <= hi; n++) addNum(n);
			continue;
		}
		const n = cnToNum(part);
		if (n !== null) {
			addNum(n);
		} else {
			invalid.push(part);
		}
	}
	return { nums: [...nums].sort((a, b) => a - b), invalid };
}
