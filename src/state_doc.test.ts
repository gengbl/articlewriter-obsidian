// 故事状态.md 的 book_skills 字段（v0.3.4+ 书籍级技能阶段配置）纯函数测试：format/parse 往返、非法结构回落、清洗（trim/去重/丢非法项/白名单键）、固定键序与空省略、extraKeys 白名单、bookSkillPhaseKey 映射。
import test from "node:test";
import assert from "node:assert/strict";

import {
	BOOK_SKILL_PHASE_KEYS,
	bookSkillPhaseKey,
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
