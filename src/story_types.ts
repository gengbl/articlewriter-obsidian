// 移植自 Python 版 fsutil.safe_filename 与 story_types.count_pure_words

const WINDOWS_RESERVED_NAMES = new Set([
	"CON", "PRN", "AUX", "NUL",
	"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
	"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

// 动态构造以规避 lint no-control-regex；字符集与 Python fsutil.safe_filename 完全一致（仅 C0 控制符 \u0000-\u001f，不含 DEL/C1）
const FN_BAD_CHARS_RE = new RegExp("[<>:\"/\\\\|?*\\u0000-\\u001f]", "g");

/**
 * 生成在 Windows / Linux 上均可安全使用的文件名：
 * 去掉 <>:"/\|?* 与控制字符、结尾的点与空格、Windows 保留设备名。
 */
export function safeFilename(name: string, fallback = "未命名"): string {
	if (!name) return fallback;
	let cleaned = name.replace(FN_BAD_CHARS_RE, "").replace(/\.+$/, "");
	cleaned = cleaned.replace(/\s+$/g, "");
	if (!cleaned) return fallback;
	const dotIdx = cleaned.lastIndexOf(".");
	const base = dotIdx >= 0 ? cleaned.slice(0, dotIdx) : cleaned;
	const ext = dotIdx >= 0 ? cleaned.slice(dotIdx) : "";
	return (WINDOWS_RESERVED_NAMES.has(base.toUpperCase()) ? "_" + base : base) + ext;
}

const SPACE_RE = /\s/u;
const PUNCT_RE = /^\p{P}/u;
const SYMBOL_RE = /^\p{S}/u;

/** 统计纯文字字符数：只计汉字/字母/数字等正文字符，不含标点、符号与空白（对齐 Python count_pure_words） */
export function countPureWords(text: string): number {
	if (!text) return 0;
	let n = 0;
	for (const ch of text) {
		if (SPACE_RE.test(ch)) continue;
		if (PUNCT_RE.test(ch) || SYMBOL_RE.test(ch)) continue;
		n++;
	}
	return n;
}

/** ISO 时间串 → 本地时间展示文本（存储恒为 UTC ISO，仅显示层换算；解析失败退回原串截断）。full=false: MM-DD HH:mm；full=true: YYYY-MM-DD HH:mm */
export function formatLocalDateTime(iso: string, full = false): string {
	const d = new Date(iso);
	if (isNaN(d.getTime())) return iso.slice(0, full ? 16 : 11).replace("T", " ");
	const p = (n: number) => String(n).padStart(2, "0");
	return `${full ? `${d.getFullYear()}-` : ""}${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ===== 新建小说模板文档（HTML 注释为示例说明，程序读取时过滤）=====

/** 总大纲模板（对齐 CLI create_book_docs：标题行用书名 + 示例注释 + 文末大纲详略标记帮助） */
export const outlineTemplate = (title: string): string =>
	appendOutlineMarkerHelp(
		`# ${title.trim() || "未命名小说"} 大纲\n\n` +
			"<!-- 示例（按需填充；填充内容会自动注入 /write /continue /review /rewrite /edit 的提示词）：\n" +
			"- 全书主线：……\n" +
			"- 卷/篇章划分：\n" +
			"  - 第1-10章：……\n" +
			"- 结局：……\n" +
			"- 涉及角色/场景用标记标注：<角色：张三、李四> <场景：山洞、擂台>（多个名字用 、 分隔；标记处写作时会提示简单描写角色与场景，详见文末帮助）\n" +
			"-->\n"
	);

export const WORLD_TEMPLATE = `# 世界观

<!--
世界观编写模板：在注释外填写实际设定即可被注入提示词。

## 背景
（时代、地点、社会结构）

## 力量体系
\`\`\`text
（多行内容用三反引号 text 围栏包裹）
\`\`\`

## 历史
\`\`\`text
（重大事件时间线）
\`\`\`
-->
`;

export const VOLUME_TEMPLATE = `# 卷

<!--
卷是分组容器（小说->卷->章节）。格式：每行一个卷
## 卷ID | 名称 | 描述
例：## v01 | 第一卷 风起 | 主角入世
-->
`;

export const FORESHADOW_TEMPLATE = `# 伏笔记录

<!--
伏笔字段：章节 / 人物 / 事由 / 是否完成。示例：
| 章节 | 人物 | 事由 | 状态 |
| --- | --- | --- | --- |
| 1 | 林川 | 古玺来历不明 | 未完成 |
-->
`;

export const NOTES_TEMPLATE = `# 笔记

<!-- 随手记录灵感与备忘 -->
`;

export const CHAPTER_BODY_TEMPLATE = (num: number, title: string) =>
	`# 第${num}章 ${title}\n\n`;

/** 章节大纲模板（对齐 CLI create_chapter_dir：标题行「第N章 标题 大纲」+ 示例注释 + 文末大纲详略标记帮助） */
export const chapterOutlineTemplate = (num: number, title: string): string => {
	const heading = title.trim() ? `第${num}章 ${title}` : `第${num}章`;
	return appendOutlineMarkerHelp(
		`# ${heading} 大纲\n\n` +
			"<!-- 示例（按需填充；填充内容会自动注入 /write /continue /review /rewrite /edit 的提示词）：\n" +
			"- 本章目标：……\n" +
			"- 情节要点：\n" +
			"  - ……\n" +
			"- 结尾：……\n" +
			"- 涉及角色/场景用标记标注：<角色：张三、李四> <场景：山洞、擂台>（多个名字用 、 分隔；标记处写作时会提示简单描写角色与场景，详见文末帮助）\n" +
			"-->\n"
	);
};

export const CHAPTER_CHARACTERS_TEMPLATE = `# 人物

<!--
归属本章节的角色设定。格式：每行一个字段
## 角色名
- 身份：
- 性别：
- 性格：
- 外貌：
- 背景：
- 能力：
- 备注：
-->
`;

export const CHAPTER_RELATIONSHIPS_TEMPLATE = `# 人物关系

<!--
本章节涉及的人物关系。示例：
## 林川 - 苏晚
\`\`\`text
兄妹，因古玺失散多年
\`\`\`
-->
`;

export const CHAPTER_SCENES_TEMPLATE = `# 场景

<!--
本章出现的场景。示例：
## 山洞
- 描述：幽深潮湿，石壁上有古老刻痕
- 角色：
\`\`\`text
（多行正文用三反引号 text 围栏包裹）
\`\`\`
-->
`;

export const CHAPTER_INFO_TEMPLATE = (num: number) => `# 章节信息

- 章节号：${num}
- 卷：
- 标签：
- 备注：
`;

// ===== 大纲详略标记使用帮助（写入 大纲.md / 章节大纲.md，HTML 注释包裹）=====
export const OUTLINE_MARKER_HELP = `<!--
# 大纲详略标记使用帮助
在大纲（总大纲 / 章节大纲）中使用以下标记，可控制生成正文时各要点的篇幅分配：

- [详] 重点展开、详细描写
- [扩] 扩展补充情节与细节
- [补] 在不偏离主线的前提下，补充大纲没提到的细节或小情节
- [略] 简略带过、几句话交代
- [跳] 可跳过不写
- [伏] 标注伏笔：内容自动记入伏笔记录（根目录 伏笔.md），如 [伏]人物：铁拐李 事由：丢失拐杖[/]

角色/场景标记（用于提取写作上下文）：
- <角色：张三、李四> 标注本段涉及的角色名
- <场景：山洞、擂台> 标注涉及场景名（多个名字用 、 或 ， 分隔）

用法示例：
- 第1章：山间遇袭 [详]打斗场面，招式往来，双方心理博弈 [略]赶路回村 [跳]村口闲聊
- 标记默认作用于整行；用 [/]（或 [/详] [/扩] [/补] [/略] [/跳]）结束作用域，
  可在同一行内分段控制详略，如：[详]打斗场面 [/详] [略]赶路回村

生成正文时，程序会自动把标记转化为显式篇幅要求注入提示词：
详写/扩写/补充的要点重点占用篇幅，略写/跳过的要点点到即止。
-->`;

/** 在文档末尾追加大纲标记使用帮助（已存在则不重复） */
export function appendOutlineMarkerHelp(text: string): string {
	if (!text || text.includes("大纲详略标记使用帮助")) return text;
	const sep = text.endsWith("\n") ? "\n" : "\n\n";
	return text + sep + OUTLINE_MARKER_HELP + "\n";
}

// ===== 预设编写类型（键=存储值 writing_style；值=[展示名, 说明, 格式模板]）=====
export const STORY_TYPES: Record<string, [string, string, string]> = {
	网文小说: [
		"网文小说",
		"适合连载的通俗小说，章节长、节奏快、爽点密（默认）",
		"【编写类型：网文小说】\n" +
			"请严格按网络小说的格式与风格创作：\n" +
			"1. 采用第三人称叙述，语言通俗流畅，多用短句与口语化表达，读起来轻松不费力\n" +
			"2. 节奏明快：每章要有明确推进（新信息、冲突、转折或小高潮），避免大段静态描写\n" +
			"3. 对话占比高、生动直白，符合角色性格；心理活动点到为止\n" +
			"4. 每章篇幅约4500字，段落3-5行，场景转换用空行分隔\n" +
			"5. 不要用华丽书面语，形容词能省则省，具体细节优先",
	],
	剧本: [
		"剧本",
		"影视/舞台剧本，场景描述+角色对话+舞台指示",
		"【编写类型：剧本】\n" +
			"请严格按剧本的格式创作：\n" +
			'1. 使用标准剧本体例：场景标题（如“第X幕/场 地点，时间”）、场景描述、角色名+台词、舞台指示\n' +
			"2. 舞台指示用括号标注在台词前或后，说明动作、神态、语气，简洁具体\n" +
			"3. 台词要符合角色身份与性格，靠潜台词与动作传递情绪，不要旁白解释\n" +
			"4. 每个场景交代清楚地点、时间、在场角色\n" +
			"5. 不需要叙述性心理描写，情绪全部通过台词、动作、沉默呈现\n" +
			"6. 场景转换用明确的幕/场分隔标记",
	],
	普通小说: [
		"普通小说",
		"传统文学小说，注重叙事、人物与细节",
		"【编写类型：普通小说】\n" +
			"请严格按传统小说的格式与风格创作：\n" +
			"1. 采用第三人称叙事，语言平实耐读，可以有克制的书面表达，但不堆砌辞藻\n" +
			"2. 注重人物塑造与细节：通过动作、对话、环境传递情绪，表现胜于告知\n" +
			"3. 节奏从容，允许留白与跳跃，不需要每章都有强冲突\n" +
			"4. 对话自然有潜台词，符合人物性格与身份\n" +
			"5. 段落3-5行，场景转换用空行分隔，章节结尾自然收束\n" +
			"6. 避免套路化桥段与模板化煽情，情感靠细节自然流露",
	],
	散文随笔: [
		"散文随笔",
		"散文随笔，重意境、语言与个人表达",
		"【编写类型：散文随笔】\n" +
			"请严格按散文随笔的风格创作：\n" +
			"1. 以作者视角展开，语言自然有文气，可以有个性化的修辞，但不矫饰\n" +
			"2. 重在写意：环境、情绪、思绪并重，允许大段内心独白与联想\n" +
			"3. 不追求强情节，以情绪与意境的流动推进\n" +
			"4. 句子长短错落，有个人印记，避免四平八稳的范文腔\n" +
			"5. 篇幅灵活，以完整表达一个情境或心绪为准\n" +
			"6. 结尾留有余韵，不强行总结或升华",
	],
};

/** 类型列表顺序（创建新书时的选择菜单） */
export const STORY_TYPE_KEYS = Object.keys(STORY_TYPES);
/** 默认类型（未选择/旧数据未设置时回退） */
export const DEFAULT_STORY_TYPE = "网文小说";

// 自定义类型的格式提示词模板
const CUSTOM_TYPE_TEMPLATE = (storyType: string) =>
	`【编写类型：${storyType}】\n` +
	`请严格按“${storyType}”的格式与风格创作。\n` +
	"如果这是一种文类或文体，请遵循该类别的通行格式、叙事方式与语言风格；" +
	"如果是你自定义的风格要求，请严格按其描述执行。";

const TYPE_BLOCK_START_RE = /<!--\s*编写类型\s*[:：]\s*(.+?)\s*-->/;
const TYPE_BLOCK_END_RE = /<!--\s*\/\s*编写类型\s*-->/;

/** 返回类型的展示名（预设类型返回展示名，未知类型原样返回） */
export function getStoryTypeDisplay(storyType: string): string {
	if (STORY_TYPES[storyType]) return STORY_TYPES[storyType][0];
	return storyType || "";
}

/** 返回类型的简短说明（未知类型返回空串） */
export function getStoryTypeDescription(storyType: string): string {
	if (STORY_TYPES[storyType]) return STORY_TYPES[storyType][1];
	return "";
}

/**
 * 从写作指南文本中解析【编写类型】区块，返回 {类型名: 区块内容}。
 * 只取每个类型第一个区块；内容为空/未闭合的区块被忽略。
 */
export function extractGuideTypeBlocks(guideText: string): Record<string, string> {
	const result: Record<string, string> = {};
	if (!guideText) return result;
	const lines = guideText.split("\n");
	let i = 0;
	while (i < lines.length) {
		const m = TYPE_BLOCK_START_RE.exec(lines[i]);
		if (m) {
			const name = m[1].trim();
			const block: string[] = [];
			i += 1;
			while (i < lines.length && !TYPE_BLOCK_END_RE.test(lines[i])) {
				block.push(lines[i]);
				i += 1;
			}
			if (i >= lines.length) break; // 未闭合：忽略该区块
			const content = block.join("\n").trim();
			if (name && content && !(name in result)) result[name] = content;
		}
		i += 1;
	}
	return result;
}

/**
 * 根据编写类型生成注入提示词的【编写类型】格式要求块。
 * 优先级：写作指南中的对应类型区块 > 内置模板 > 自定义类型模板。
 */
export function getStoryTypeGuide(
	storyType: string,
	guideText = "",
	title = "",
	charNames?: Array<string | null>,
): string {
	storyType = (storyType || "").trim();
	if (!storyType) return "";
	let guide = extractGuideTypeBlocks(guideText)[storyType];
	if (guide === undefined) {
		guide = STORY_TYPES[storyType]?.[2] ?? CUSTOM_TYPE_TEMPLATE(storyType);
	}
	guide = guide.replace("{title}", title || "");
	guide = guide.replace(
		"{char_names}",
		charNames ? charNames.filter((n) => n).map(String).join("、") : "",
	);
	return guide;
}

// ---------- MD5（章节摘要过期检测哈希，对齐 Python hashlib.md5().hexdigest()）----------

/** 剥离 /deai 写入正文的 AI 用语标红标签，读回内存时恢复纯净文本 */
export function stripAiWordMarks(text: string): string {
	return String(text ?? "")
		.replace(/<span style="color:red">/g, "")
		.replace(/<\/span>/g, "");
}

const MD5_S: number[] = [];
for (const grp of [
	[7, 12, 17, 22],
	[5, 9, 14, 20],
	[4, 11, 16, 23],
	[6, 10, 15, 21],
]) {
	for (let r = 0; r < 4; r++) for (const v of grp) MD5_S.push(v);
}
const MD5_K: number[] = [];
for (let i = 0; i < 64; i++) MD5_K.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));

/** RFC 1321；输入按 UTF-8 编码，输出小写十六进制 */
export function md5(input: string): string {
	const data = new TextEncoder().encode(input);
	const len = data.length;
	const paddedLen = (((len + 8) >> 6) + 1) << 6;
	const buf = new Uint8Array(paddedLen);
	buf.set(data);
	buf[len] = 0x80;
	const dv = new DataView(buf.buffer);
	dv.setUint32(paddedLen - 8, (len * 8) >>> 0, true);
	dv.setUint32(paddedLen - 4, Math.floor((len * 8) / 4294967296), true);

	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;
	for (let off = 0; off < paddedLen; off += 64) {
		const M: number[] = [];
		for (let j = 0; j < 16; j++) M.push(dv.getUint32(off + j * 4, true));
		let A = a0;
		let B = b0;
		let C = c0;
		let D = d0;
		for (let i = 0; i < 64; i++) {
			let F: number;
			let g: number;
			if (i < 16) {
				F = (B & C) | (~B & D);
				g = i;
			} else if (i < 32) {
				F = (D & B) | (~D & C);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				F = B ^ C ^ D;
				g = (3 * i + 5) % 16;
			} else {
				F = C ^ (B | ~D);
				g = (7 * i) % 16;
			}
			let t = (A + F + MD5_K[i] + M[g]) >>> 0;
			t = ((t << MD5_S[i]) | (t >>> (32 - MD5_S[i]))) >>> 0;
			t = (t + B) >>> 0;
			A = D;
			D = C;
			C = B;
			B = t;
		}
		a0 = (a0 + A) >>> 0;
		b0 = (b0 + B) >>> 0;
		c0 = (c0 + C) >>> 0;
		d0 = (d0 + D) >>> 0;
	}
	const out: string[] = [];
	for (const v of [a0, b0, c0, d0]) {
		out.push(
			(v & 0xff).toString(16).padStart(2, "0"),
			((v >> 8) & 0xff).toString(16).padStart(2, "0"),
			((v >> 16) & 0xff).toString(16).padStart(2, "0"),
			((v >> 24) & 0xff).toString(16).padStart(2, "0")
		);
	}
	return out.join("");
}
