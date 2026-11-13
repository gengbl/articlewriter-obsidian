// 故事状态.md 的 book_skills（v0.3.4+ 书籍级技能阶段配置）与 auto_book（v0.4.1+ 全自动建书配置）纯函数测试：format/parse 往返、非法结构回落、清洗（trim/去重/丢非法项/白名单键）、固定键序与空省略、extraKeys 白名单、bookSkillPhaseKey 映射、autoBookMissing 缺参判定。
import test from "node:test";
import assert from "node:assert/strict";

import {
	BOOK_SKILL_PHASE_KEYS,
	bookSkillPhaseKey,
	autoBookMissing,
	formatStateDoc,
	parseStateDoc,
	type StoryState,
} from "./state_doc";

const baseState = (): StoryState => ({
	version: 2,
	title: "测试书",
	genre: "科幻",
	writing_style: "冷硬",
	current_chapter: null,
	total_words: 0,
	use_summaries: false,
	use_volumes: false,
	chapters: {},
	created_at: "2026-01-01",
	updated_at: "2026-01-02",
});

void test("book_skills format→parse 往返等值（五阶段各一组技能名）", () => {
	const st = baseState();
	st.book_skills = {
		worldview: ["世界观生成框架"],
		planning: ["反转钩子设计"],
		outline: ["多线叙事", "伏笔埋设"],
		volume_outline: ["卷间张力"],
		writing: ["短句节奏"],
	};
	const doc = formatStateDoc(st);
	const back = parseStateDoc(doc);
	assert.ok(back.state);
	assert.deepEqual(back.state.book_skills, {
		worldview: ["世界观生成框架"],
		planning: ["反转钩子设计"],
		outline: ["多线叙事", "伏笔埋设"],
		volume_outline: ["卷间张力"],
		writing: ["短句节奏"],
	} satisfies StoryState["book_skills"]);
	const st2 = baseState();
	st2.book_skills = { worldview: [], planning: ["甲"], outline: [], volume_outline: [], writing: ["乙"] };
	assert.deepEqual(parseStateDoc(formatStateDoc(st2)).state?.book_skills, { planning: ["甲"], writing: ["乙"] }); // 空数组阶段写出即省略、解析后不再出现
});

void test("format：按 BOOK_SKILL_PHASE_KEYS 固定键序写出；空数组阶段省略；全空则整键省略", () => {
	const st = baseState();
	st.book_skills = { worldview: ["世界观生成框架"], planning: [], outline: [], volume_outline: ["卷级节奏"], writing: ["钩子", "留白"] };
	const doc = formatStateDoc(st);
	const iWV = doc.indexOf("worldview:");
	const iVO = doc.indexOf("volume_outline:");
	const iW = doc.indexOf("writing:");
	assert.ok(iWV >= 0, "worldview 应写出");
	assert.ok(iWV < iVO, "worldview 应在 volume_outline 之前（固定键序首位）");
	assert.ok(iVO >= 0 && iW > iVO, "volume_outline 应在 writing 之前");
	assert.ok(!/^\s+planning:/m.test(doc), "空数组阶段应省略");
	assert.ok(!/^\s+outline:/m.test(doc), "空数组阶段应省略（outline 行不误匹配 volume_outline）");

	const st2 = baseState();
	st2.book_skills = { worldview: [], planning: [], outline: [], volume_outline: [], writing: [] };
	assert.ok(!formatStateDoc(st2).includes("book_skills"), "全空时整个 book_skills 键省略");

	const doc3 = formatStateDoc(baseState()); // 未配置（字段缺省）也不写
	assert.ok(!doc3.includes("book_skills"));
});

void test("parse：非法结构（数组/字符串/null）与未知键回落 undefined；未知键不误入 extra", () => {
	const bad = (bookSkillsYaml: string): string => `---\ntitle: x\nbook_skills: ${bookSkillsYaml}\n---\n正文\n`;
	for (const y of ["[]", '"反转"', "null", "42"]) {
		assert.equal(parseStateDoc(bad(y)).state?.book_skills, undefined, `标量/数组输入应回落：${y}`);
	}
	const r = parseStateDoc(bad("{ unknown_phase: [a], planning: [甲] }"));
	assert.deepEqual(r.state?.book_skills, { planning: ["甲"] });
	assert.equal(r.extra, undefined, "book_skills 属已知键，不应进入 extra");
});

void test("parse 清洗：trim、去重、空串与对象/布尔条目丢弃、裸数字转字符串；清洗后全空回落 undefined", () => {
	const doc = "---\ntitle: x\nbook_skills:\n  planning: [\" 反转 \", 反转, \"\", 5, {a: 1}, null, 钩子]\n  writing: [\"\"]\n---\n";
	const r = parseStateDoc(doc);
	assert.deepEqual(r.state?.book_skills, { planning: ["反转", "5", "钩子"] });

	const doc2 = "---\ntitle: x\nbook_skills:\n  planning: [\" \", \"\"]\n---\n";
	assert.equal(parseStateDoc(doc2).state?.book_skills, undefined);
});

void test("parse：旧文档无 book_skills 键 → 字段缺省（undefined），不影响其余字段", () => {
	const r = parseStateDoc("---\ntitle: 老书\n---\n");
	assert.ok(r.state);
	assert.equal(r.state.book_skills, undefined);
	assert.equal(r.state.title, "老书");
});

void test("BOOK_SKILL_PHASE_KEYS 与 bookSkillPhaseKey：五键固定、下标映射、越界 undefined", () => {
	assert.deepEqual([...BOOK_SKILL_PHASE_KEYS], ["worldview", "planning", "outline", "volume_outline", "writing"]);
	assert.equal(bookSkillPhaseKey(0), "worldview");
	assert.equal(bookSkillPhaseKey(4), "writing");
	assert.equal(bookSkillPhaseKey(5), undefined);
	assert.equal(bookSkillPhaseKey(-1), undefined);
});

// ---------- auto_book（v0.4.1+ 全自动建书配置并入状态文档） ----------

void test("auto_book format→parse 往返等值；format 固定键序（start/end/chapters/volumes/chapter_counts/overwrite）", () => {
	const st = baseState();
	st.use_volumes = true;
	st.one_line = "守桥人每十年换一次桥魂";
	st.auto_book = { start: "planning", end: "bodies", volumes: 3, chapter_counts: [20, 20, 20], overwrite: true };
	const doc = formatStateDoc(st);
	const back = parseStateDoc(doc);
	assert.ok(back.state);
	assert.deepEqual(back.state.auto_book, {
		start: "planning", end: "bodies", volumes: 3, chapter_counts: [20, 20, 20], overwrite: true,
	} satisfies StoryState["auto_book"]);
	// 嵌套键都带两空格缩进：避免误匹配顶层 use_volumes 等包含 "volumes:" 的键
	const iStart = doc.indexOf("\n  start:");
	const iEnd = doc.indexOf("\n  end:");
	const iVol = doc.indexOf("\n  volumes:");
	const iCnt = doc.indexOf("\n  chapter_counts:");
	const iOw = doc.indexOf("\n  overwrite:");
	assert.ok(iStart >= 0 && iStart < iEnd, "start 在 end 之前");
	assert.ok(iEnd < iVol && iVol < iCnt && iCnt < iOw, "end < volumes < chapter_counts < overwrite");
	assert.ok(doc.indexOf("auto_book:") < iStart, "auto_book 键在块内容之前（嵌套写出）");
});

void test("auto_book format：未配置/非法/清洗后全空 → 整键省略；start=worldview 默认值经 parse 归一照常写出", () => {
	assert.ok(!formatStateDoc(baseState()).includes("auto_book"), "字段缺省不写");
	const st = baseState();
	st.auto_book = {};
	assert.ok(!formatStateDoc(st).includes("auto_book"), "空对象不写");
	st.auto_book = { chapters: 0, volumes: -1, chapter_counts: [], start: "nope" as never, overwrite: undefined };
	assert.ok(!formatStateDoc(st).includes("auto_book"), "normalize 清洗后全空不写");
	st.auto_book = { start: "worldview", overwrite: false };
	const doc = formatStateDoc(st);
	assert.ok(doc.includes("start: worldview"), "start=worldview 仍写出（保持键序归一）");
	assert.ok(doc.includes("overwrite: false"), "overwrite=false 是有效配置、写出");
});

void test("auto_book parse：非法结构回落 undefined；未知键不误入 extra；字段非法各自忽略", () => {
	const bad = parseStateDoc("---\nauto_book: true\n---\n");
	assert.ok(bad.state);
	assert.equal(bad.state.auto_book, undefined);
	const arr = parseStateDoc("---\nauto_book: [1, 2]\n---\n");
	assert.equal(arr.state?.auto_book, undefined);
	const doc = parseStateDoc("---\ntitle: 老书\nauto_book:\n  chapters: 30\n  bogus: x\n---\n");
	assert.ok(doc.state);
	assert.deepEqual(doc.state.auto_book, { chapters: 30 }, "非法字段 bogus 忽略、合法字段保留");
	assert.ok(!("bogus" in (doc.extra ?? {})), "auto_book 在白名单：其内部键不误入 extra");
});

void test("auto_book parse 清洗：chapter_counts 数组含非法项整条丢弃 / 分隔字符串（逗号、顿号、空白混用）解析；posInt 宽松；非法 stage 忽略", () => {
	const s1 = parseStateDoc("---\nauto_book:\n  chapter_counts: [10, x, 12]\n---\n");
	assert.equal(s1.state?.auto_book?.chapter_counts, undefined, "数组含非法项整条丢弃");
	const s2 = parseStateDoc("---\nauto_book:\n  chapter_counts: 8，10 12\n---\n");
	assert.deepEqual(s2.state?.auto_book?.chapter_counts, [8, 10, 12], "分隔字符串（顿号/空白）解析");
	const s3 = parseStateDoc("---\nauto_book:\n  chapter_counts: \"[8, 10]\"\n---\n");
	assert.deepEqual(s3.state?.auto_book?.chapter_counts, [8, 10], "带引号的方括号字符串也解析");
	const s4 = parseStateDoc("---\nauto_book:\n  chapters: \"30\"\n  start: nope\n  end: book-outline\n---\n");
	assert.deepEqual(s4.state?.auto_book, { end: "book-outline", chapters: 30 }, "数字字符串接受、非法 stage 忽略");
	const s5 = parseStateDoc("---\nauto_book:\n  chapter_counts: 12\n---\n");
	assert.deepEqual(s5.state?.auto_book?.chapter_counts, [12], "标量单值＝各卷同章数");
});

void test("autoBookMissing：按模式与起始节点判缺参（空数组＝免交互开跑）", () => {
	assert.deepEqual(autoBookMissing("设定", { chapters: 30 }, true, "worldview"), []);
	assert.deepEqual(autoBookMissing("设定", { volumes: 3, chapter_counts: [10] }, false, "worldview"), [], "各卷章数长度 1（末值复制兜底）视为齐全");
	assert.deepEqual(autoBookMissing("", undefined, true, "worldview"), ["一句话设定（one_line）", "全书总章数（auto_book.chapters）"]);
	assert.deepEqual(autoBookMissing("设定", undefined, false, "planning"), ["卷数（auto_book.volumes）", "各卷章数（auto_book.chapter_counts）"]);
	assert.deepEqual(autoBookMissing("", { volumes: 3, chapter_counts: [10, 10, 10] }, false, "bodies"), [], "非 worldview 起跑不要求一句话设定");
	assert.deepEqual(autoBookMissing("设定", { chapters: 30, volumes: 3 }, false, "worldview"), ["各卷章数（auto_book.chapter_counts）"], "分卷模式忽略平铺 chapters 键");
});
