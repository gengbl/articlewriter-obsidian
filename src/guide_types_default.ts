/**
 * 「不同类型写作要点」内置默认内容（玄幻仙侠 / 都市现实 / 科幻 / 历史武侠）：
 * 唯一来源为 docs/guide-types/*.md。构建时由 esbuild 以 text loader 打包进 release/main.js；
 * 运行时播种到插件数据目录 guide-types/（用户可编辑），「重新生成系统写作指南」一并覆盖重置。
 * 汇总管线按书籍题材（genre 自由文本）关键词匹配，只把命中类型的要点组装进该书《写作指南汇总.md》。
 */
import xuanhuanMd from "../docs/guide-types/玄幻仙侠.md";
import dushiMd from "../docs/guide-types/都市现实.md";
import kehanMd from "../docs/guide-types/科幻.md";
import lishiMd from "../docs/guide-types/历史武侠.md";

export interface GuideTypeDef {
	/** 文件名（不含扩展名）＝插件数据目录 guide-types/ 下的文件名 */
	key: string;
	/** 展示名（汇总节标题用） */
	name: string;
	/** 题材关键词：genre 自由文本含任一即命中（无 /g 标志，test 无状态问题） */
	keywords: RegExp;
	/** 内置默认内容（播种/重置用） */
	defaultText: string;
}

export const GUIDE_TYPES: GuideTypeDef[] = [
	{ key: "玄幻仙侠", name: "玄幻 / 仙侠", keywords: /玄幻|仙侠|修仙|修真|仙魔|洪荒/, defaultText: xuanhuanMd },
	{ key: "都市现实", name: "都市 / 现实", keywords: /都市|现实|职场|校园|生活/, defaultText: dushiMd },
	{ key: "科幻", name: "科幻", keywords: /科幻|星际|未来|机甲|赛博|太空/, defaultText: kehanMd },
	{ key: "历史武侠", name: "历史 / 武侠", keywords: /历史|武侠|古代|古风|江湖|王朝/, defaultText: lishiMd },
];

/** 题材匹配类型文件：返回全部命中（可能多个，组装时依次追加）；未命中→空数组（不注入类型要点）。
 * 当 genre 为「网文小说」时，若提供 writingStyle 则用其做关键词匹配（只注入实际题材对应的类型要点）；
 * 否则回退到 genre 本身匹配。 */
export function matchGuideTypes(genre: string, writingStyle?: string): GuideTypeDef[] {
	const g = String(genre || "").trim();
	if (!g) return [];
	// 网文小说书籍：用 writing_style 决定命中哪些类型要点（而非 genre 本身）
	const matchKey = (g === "网文小说" && writingStyle) ? writingStyle : g;
	return GUIDE_TYPES.filter((t) => t.keywords.test(matchKey));
}
