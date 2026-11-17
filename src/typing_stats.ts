/**
 * 码字统计纯计算模块（v0.4.5+；仿 graph_layout 纯模块范式：无 DOM、无 vault）。
 * 采集口径与落盘由 main.ts 接线（editor-change 监听＋10 分钟段边界/定时器 flush，写书级《案头资料/码字记录.md》），
 * 这里只负责：前后文本 diff 计数、10 分钟段分桶与停顿聚合、行/表头渲染——全部可单测。
 */

/** 一段的时长缺省值：10 分钟（v0.4.5+ 起可经设置项「码字记录段长」覆盖，本常量＝缺省与回落值） */
export const SEGMENT_MIN_DEFAULT = 10;
/** 段长可配置范围（分钟）：小于 1 无意义、大于 120 一段太久失去意义 */
export const SEGMENT_MIN_MIN = 1;
export const SEGMENT_MIN_MAX = 120;
/** 10 分钟（按 epoch 对齐分桶，本地整点时区下即 :00/:10/:20… 边界）——未配置时的缺省段长 */
export const SEGMENT_MS = SEGMENT_MIN_DEFAULT * 60_000;

/**
 * 设置项「码字记录段长（分钟）」→ 有效段长（分钟）：非整数向下取整；
 * 留空/非法/越界（<SEGMENT_MIN_MIN 或 >SEGMENT_MIN_MAX）一律回落缺省 10 分钟。
 */
export function normalizeSegmentMinutes(value?: string | number | null): number {
	const n = typeof value === "number" ? value : Number((value ?? "").toString().trim());
	if (!Number.isFinite(n)) return SEGMENT_MIN_DEFAULT;
	const i = Math.floor(n);
	return i < SEGMENT_MIN_MIN || i > SEGMENT_MIN_MAX ? SEGMENT_MIN_DEFAULT : i;
}
/** 停顿判定阈值：相邻两次有效键入间隔超过此值才计停顿，且只超出部分计（前 30 秒视为边想边写的思考时间） */
export const PAUSE_MS = 30_000;
/** 单次变更「非空白新增字符」上限：超过即判粘贴/程序化写入（含 LLM 落盘/外部改动），不记字也不记键入事件 */
export const MAX_TYPE_DELTA = 300;

/** 一个段的采集缓冲（edits＝段内有效键入事件时刻，升序；chars/deleted＝段内 diff 触碰区的新增/删除非空白字符数） */
export interface TypeSeg {
	start: number; // 段起点（epoch ms，已按当时段长对齐）
	edits: number[];
	chars: number; // 段内新增的非空白字符数
	deleted: number; // 段内删除的非空白字符数（v0.4.5+：算净增字数用，本身不算键入）
}

/**
 * 段的**净增字数**＝新增 − 删除（下限 0）：删掉的文字不算码字，且会把此前敲进去的抵掉
 * （先写 100 字又删掉 80 字＝只算 20 字）。
 */
export function segNetChars(seg: TypeSeg): number {
	const net = seg.chars - seg.deleted;
	return net > 0 ? net : 0;
}

/** 段长（ms）：设置项分钟数换算，缺省 10 分钟 */
export function segmentMs(minutes?: number | null): number {
	return normalizeSegmentMinutes(minutes) * 60_000;
}

/**
 * 进行中段的「写到此刻」即时汇总：字数＋此刻停顿＋此刻活跃（写作）时长。
 * 此刻＝min(now, 段起+段长)；停顿按 `segmentPauseMs` 同口径（含段首空档与尾距），故停下不写时活跃时长不再增长。
 * `from`（v0.4.5+）＝只算此刻意窗口的起点（「本次写作」锚点晚于段起点时用它夹取），窗口内无键入事件 → 活跃 0；
 * `chars` 始终是**整段**净增字数（本次写作按首次键入锚定，同一进行中段不会有锚点之前的有效键入）。
 */
export function liveSegStats(seg: TypeSeg, now: number, segMs: number, from: number = seg.start): { chars: number; pauseMs: number; activeMs: number } {
	const net = segNetChars(seg);
	const start = from > seg.start ? from : seg.start;
	if (!seg.edits.some((t) => t >= start)) return { chars: net, pauseMs: 0, activeMs: 0 }; // 窗口内无键入事件＝没有写作会话
	const lim = seg.start + segMs;
	const end = now < lim ? now : lim;
	if (end <= start) return { chars: net, pauseMs: 0, activeMs: 0 };
	const pause = pauseMsInWindow(seg.edits, start, end);
	const active = end - start - pause;
	return { chars: net, pauseMs: pause, activeMs: active > 0 ? active : 0 };
}

/** 非空白字符数（空格/换行/制表/全角空格等一律不计——与写字台「纯文字总字数」同口径的极简版） */
export function countNonSpace(s: string): number {
	let n = 0;
	for (const ch of s) if (!/\s/.test(ch)) n++;
	return n;
}

/**
 * 前后文本 diff（公共前缀/公共后缀裁剪，O(n)）→ 新增/删除的**非空白字符数**。
 * 编辑器逐次保存/键入的增量远小于全文；未触碰段不参与计数。
 */
export function diffStats(a: string, b: string): { added: number; deleted: number } {
	if (a === b) return { added: 0, deleted: 0 };
	let lo = 0;
	const la = a.length;
	const lb = b.length;
	const minLen = la < lb ? la : lb;
	while (lo < minLen && a.charCodeAt(lo) === b.charCodeAt(lo)) lo++;
	let ea = la;
	let eb = lb;
	while (ea > lo && eb > lo && a.charCodeAt(ea - 1) === b.charCodeAt(eb - 1)) { ea--; eb--; }
	return { added: countNonSpace(b.slice(lo, eb)), deleted: countNonSpace(a.slice(lo, ea)) };
}

/** 时刻 → 所在段的起点（epoch 对齐；segMs＝段长 ms，缺省 10 分钟） */
export function segmentStartOf(ms: number, segMs: number = SEGMENT_MS): number {
	return Math.floor(ms / segMs) * segMs;
}

/**
 * 新开一段的起点（v0.4.5+）：整点网格对齐，但**不得早于上一个已结算段的末时刻** `prevEnd`。
 * 改段长时旧段按旧段长提前结算、新段却按新段长回溯对齐，两者会重叠（例：5 分钟段 20:30–20:35 刚落盘，
 * 改 30 分钟后新段又从 20:30 起手）——重叠的那段时间被两段各算一次活跃时长，《码字记录.md》的
 * 「写作总时长」随之虚高。prevEnd 传 0（无上一段/换了书）时纯按网格对齐。
 */
export function nextSegmentStart(now: number, segMs: number, prevEnd: number): number {
	const grid = segmentStartOf(now, segMs);
	return prevEnd > grid ? prevEnd : grid;
}

/**
 * 段内停顿总时长（ms）＝段跨度 − 真正在敲字的活跃时长，三段同口径（各自 >PAUSE_MS 的**超出部分**才计）：
 * ① **段首空档**（段起→第一次键入，v0.4.5+ 修复：段起点是整点网格而非开敲时刻，这段发呆以前既不算停顿、
 *   又留在「跨度−停顿」里被当成码字时长，每段最多虚增一个段长）；
 * ② 相邻键入事件间隔；③ 段尾（最后一次键入→end）——「写完就走」在该段记为停顿。
 * 无任何键入事件＝0（整段无写作会话，调用方直接跳过该行）。
 */
export function segmentPauseMs(seg: TypeSeg, end: number): number {
	return pauseMsInWindow(seg.edits, seg.start, end);
}

/**
 * `segmentPauseMs` 的**窗口版**（v0.4.5+）：只统计 `[from, end]` 区间内的停顿，窗口起点之前的键入事件一律不参与。
 * 「本次写作」的锚点（首次有效键入）可以晚于段起点（段起点按整点网格对齐），面板要用它把活跃时长限制在锚点之后，
 * 否则「本次时长／总时长」会把锚点之前的发呆算进来、甚至超过墙钟跨度。窗口内无键入事件 → 0（该窗口没有写作会话）。
 */
export function pauseMsInWindow(edits: number[], from: number, end: number): number {
	const ev = edits.filter((t) => t >= from);
	if (!ev.length) return 0;
	let pause = 0;
	const head = ev[0] - from;
	if (head > PAUSE_MS) pause += head - PAUSE_MS;
	let prev = ev[0];
	for (let i = 1; i < ev.length; i++) {
		const gap = ev[i] - prev;
		if (gap > PAUSE_MS) pause += gap - PAUSE_MS;
		prev = ev[i];
	}
	const tail = end - prev;
	if (tail > PAUSE_MS) pause += tail - PAUSE_MS;
	return pause;
}

/**
 * 段（或其中 `[from, end]` 一段窗口）的**活跃码字时长**＝跨度 − 停顿（同 `pauseMsInWindow` 口径）；
 * 窗口内无键入事件或窗口非正 → 0。`from` 缺省＝段起点。
 */
export function segActiveMs(seg: TypeSeg, end: number, from: number = seg.start): number {
	const start = from > seg.start ? from : seg.start;
	if (end <= start) return 0;
	const pause = pauseMsInWindow(seg.edits, start, end);
	if (!seg.edits.some((t) => t >= start)) return 0;
	const active = end - start - pause;
	return active > 0 ? active : 0;
}

/** 停顿人读化：＜60 秒→「N 秒」；＜1 小时→「N 分 N 秒」（整分省秒）；≥1 小时→「N 时 N 分」 */
export function durText(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${String(s)} 秒`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	if (m < 60) return rs ? `${String(m)} 分 ${String(rs)} 秒` : `${String(m)} 分`;
	const h = Math.floor(m / 60);
	return `${String(h)} 时 ${String(m % 60)} 分`;
}

/** 码字速度＝有效字数 ÷（段时长−停顿）外推到小时；无有效字数或活跃时长归零 →「—」 */
export function speedText(chars: number, activeMs: number): string {
	if (chars <= 0 || activeMs <= 0) return "—";
	return `${String(Math.round((chars * 3600_000) / activeMs))} 字/小时`;
}

const pad2 = (n: number): string => (n < 10 ? `0${String(n)}` : String(n));

/** 本地日期「YYYY-MM-DD」 */
export function fmtDate(ms: number): string {
	const d = new Date(ms);
	return `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 本地时刻「HH:MM」 */
export function fmtClock(ms: number): string {
	const d = new Date(ms);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 表头（文件缺失时按此创建；追加行永远跟在既有表尾）。列名「净增字数」＝新增−删除（v0.4.5+ 口径；旧文件里的旧列名「有效字数」按位置解析、不影响读回） */
export const TYPE_STATS_HEADER = "# 码字记录\n\n| 日期 | 时间段 | 净增字数 | 停顿 | 码字速度 |\n| --- | --- | --- | --- | --- |\n";

/** 段汇总 → 表格一行（end 取段末或实际 flush 时刻，调用方已夹好；字数＝净增字数，删除把先前敲的抵掉） */
export function renderStatsRow(seg: TypeSeg, end: number): string {
	const pause = segmentPauseMs(seg, end);
	const active = end - seg.start - pause;
	const chars = segNetChars(seg);
	return `| ${fmtDate(seg.start)} | ${fmtClock(seg.start)}–${fmtClock(end)} | ${String(chars)} | ${pause > 0 ? durText(pause) : "无"} | ${speedText(chars, active)} |`;
}

/**
 * `durText` 的逆解析（读回《码字记录.md》里的停顿列）：
 * 「无」/空 → 0；「N 秒」「N 分」「N 分 N 秒」「N 时 N 分」→ ms；其它无法识别的写法 → null（调用方跳过该行）
 */
export function parseDurText(s: string): number | null {
	const t = s.trim();
	if (!t || t === "无") return 0;
	let m = /^(\d+)\s*秒$/.exec(t);
	if (m) return Number(m[1]) * 1000;
	m = /^(\d+)\s*分$/.exec(t);
	if (m) return Number(m[1]) * 60_000;
	m = /^(\d+)\s*分\s*(\d+)\s*秒$/.exec(t);
	if (m) return Number(m[1]) * 60_000 + Number(m[2]) * 1000;
	m = /^(\d+)\s*时\s*(\d+)\s*分$/.exec(t);
	if (m) return Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000;
	return null;
}

/** 《码字记录.md》一行表格的解析结果（时间跨度按本地时区还原；end<start 视为跨过零点，加一天） */
export interface StatsRowSummary {
	start: number;
	end: number;
	chars: number;
	pauseMs: number;
	activeMs: number; // 跨度 − 停顿（写作时长口径，最小 0）
}

/**
 * 表格行 → 段汇总。只认「第一列＝YYYY-MM-DD、第二列＝HH:MM–HH:MM」的五列行，
 * 表头/分隔行/空行/用户手改成无效格式的行一律返回 null（跳过不炸）。
 */
export function parseStatsRow(line: string): StatsRowSummary | null {
	const t = line.trim();
	if (!t.startsWith("|")) return null;
	const cells = t.split("|").map((c) => c.trim()); // 首尾各留一个空串：数据在 [1..5]
	if (cells.length < 6) return null;
	const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cells[1]);
	const c = /^(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})$/.exec(cells[2]);
	if (!d || !c) return null;
	const chars = Number(cells[3]);
	const pause = parseDurText(cells[4]);
	if (!Number.isFinite(chars) || chars < 0 || pause == null) return null;
	const start = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(c[1]), Number(c[2])).getTime();
	let end = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(c[3]), Number(c[4])).getTime();
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (end < start) end += 24 * 3_600_000; // 跨零点段（23:55–00:05）
	const active = end - start - pause;
	return { start, end, chars, pauseMs: pause, activeMs: active > 0 ? active : 0 };
}

/** 全文汇总《码字记录.md》：段数／有效字数／停顿／写作（活跃）时长——写字台「写作状态」的「写作总时长」事实源即此 */
export function summarizeStatsFile(text: string): { segments: number; chars: number; pauseMs: number; activeMs: number } {
	let segments = 0;
	let chars = 0;
	let pauseMs = 0;
	let activeMs = 0;
	for (const line of text.split(/\r?\n/)) {
		const r = parseStatsRow(line);
		if (!r) continue;
		segments++;
		chars += r.chars;
		pauseMs += r.pauseMs;
		activeMs += r.activeMs;
	}
	return { segments, chars, pauseMs, activeMs };
}
