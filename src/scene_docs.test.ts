// 《场景.md》场景区（书/卷/章三层通用，v0.4.7+ 场景面板字段与块级写回）纯函数测试：
// 解析/序列化往返（位置/父场景）、块级新增/编辑/删除、位置改写与快照过期防护。
import test from "node:test";
import assert from "node:assert/strict";

import {
	deleteSceneBlock,
	formatSceneBlock,
	insertSceneBlock,
	parseScenes,
	rewriteScenePosition,
	updateSceneBlock,
	type SceneBlockInput,
} from "./md_docs";

const doc = `# 场景

## 黑石城
- 描述：边境重镇
- 角色：张三、李四
- 备注：边关
- 位置：120,80
- 父场景：大陆
- 创建：2026-01-01

## 山洞
- 描述：幽深潮湿
\`\`\`text
多行正文第一行
第二行
\`\`\`
`;

void test("parseScenes 读取 位置/父场景 字段（v0.4.7+）", () => {
	const scenes = parseScenes(doc, 0);
	assert.equal(scenes["黑石城"].x, 120);
	assert.equal(scenes["黑石城"].y, 80);
	assert.equal(scenes["黑石城"].parent, "大陆");
	assert.equal(scenes["黑石城"].created_at, "2026-01-01");
	assert.equal(scenes["山洞"].x, undefined);
	assert.equal(scenes["山洞"].content, "多行正文第一行\n第二行");
});

void test("位置解析兼容中文逗号与小数坐标；畸形值不写入", () => {
	const s = parseScenes("## A\n- 位置：-12.5，40\n## B\n- 位置：abc\n", 0);
	assert.equal(s["A"].x, -12.5);
	assert.equal(s["A"].y, 40);
	assert.equal(s["B"].x, undefined);
});

void test("formatScenes/formatSceneBlock 写出 位置/父场景 并与 parse 往返一致", () => {
	const scenes = parseScenes(doc, 0);
	const out = formatSceneBlock(scenes["黑石城"]);
	assert.ok(out.includes("- 位置：120,80"));
	assert.ok(out.includes("- 父场景：大陆"));
	const back = parseScenes(out, 0);
	assert.equal(back["黑石城"].y, 80);
	assert.equal(back["黑石城"].parent, "大陆");
});

void test("insertSceneBlock 文末追加、保留既有内容、同名/非法 id 拒绝", () => {
	const out = insertSceneBlock(doc, { scene_id: "客栈", chapter_num: 0, characters: ["王五"], description: "歇脚处" });
	assert.ok(out);
	const scenes = parseScenes(out, 0);
	assert.equal(Object.keys(scenes).length, 3);
	assert.equal(scenes["客栈"].characters.join(","), "王五");
	assert.ok(out.includes("## 黑石城"), "原有条目保留");
	assert.equal(insertSceneBlock(doc, { scene_id: "黑石城", chapter_num: 0, characters: [] }), null, "同名拒绝");
	assert.equal(insertSceneBlock(doc, { scene_id: "a/b", chapter_num: 0, characters: [] }), null, "非法字符拒绝");
	const fromEmpty = insertSceneBlock("", { scene_id: "首块", chapter_num: 3, characters: [] });
	assert.ok(fromEmpty);
	assert.ok(fromEmpty.startsWith("# 场景"), "空文档按模板起底");
	assert.equal(parseScenes(fromEmpty, 0)["首块"].chapter_num, 3);
});

void test("updateSceneBlock 只改给出的字段、保留未触碰行（创建/章节/位置/自由行/围栏）", () => {
	const out = updateSceneBlock(doc, "黑石城", { description: "新描述", parent: "" });
	assert.ok(out);
	const scenes = parseScenes(out, 0);
	assert.equal(scenes["黑石城"].description, "新描述");
	assert.equal(scenes["黑石城"].parent, undefined, "空串＝删除父场景行");
	assert.equal(scenes["黑石城"].x, 120, "位置未触碰＝保留");
	assert.equal(scenes["黑石城"].created_at, "2026-01-01", "创建行保留");
	assert.ok(out.includes("- 备注：边关"), "备注未触碰＝保留");
	assert.ok(out.includes("- 角色：张三、李四"));
	const out2 = updateSceneBlock(doc, "山洞", { content: "改后的正文" });
	assert.ok(out2);
	assert.equal(parseScenes(out2, 0)["山洞"].content, "改后的正文");
	const out3 = updateSceneBlock(doc, "山洞", {});
	assert.ok(out3);
	assert.equal(parseScenes(out3, 0)["山洞"].content, "多行正文第一行\n第二行", "未给 content＝围栏原样");
	assert.equal(updateSceneBlock(doc, "不存在", {}), null, "定位失败返回 null");
});

void test("updateSceneBlock 补写缺失字段行（原文没有描述/角色行时编辑给值＝插入围栏前）＋标题编辑", () => {
	const bare = "# 场景\n\n## 荒野\n- 备注：旧备注\n\n```text\n正文\n```\n";
	const out = updateSceneBlock(bare, "荒野", { title: "大荒", description: "新描述", characters: ["甲"], notes: "新备注" });
	assert.ok(out);
	assert.ok(out.includes("- 标题：大荒"));
	assert.ok(out.includes("- 描述：新描述"));
	assert.ok(out.includes("- 角色：甲"));
	assert.ok(out.includes("- 备注：新备注"));
	assert.ok(out.includes("正文\n```"), "围栏保留");
	assert.ok(out.indexOf("- 备注：新备注") < out.indexOf("```"), "补写行在围栏前");
	const s = parseScenes(out, 0)["荒野"];
	assert.equal(s.title, "大荒");
	assert.equal(s.description, "新描述");
	assert.deepEqual(s.characters, ["甲"]);
	const out2 = updateSceneBlock(out, "荒野", { title: "" });
	assert.ok(out2);
	assert.ok(!out2.includes("- 标题："), "空串＝删除标题行");
});

void test("deleteSceneBlock 整块删除（含围栏），其余保留", () => {
	const out = deleteSceneBlock(doc, "山洞");
	assert.ok(out);
	assert.ok(!out.includes("## 山洞"));
	assert.ok(out.includes("## 黑石城"));
	assert.equal(Object.keys(parseScenes(out, 0)).length, 1);
	assert.equal(deleteSceneBlock(doc, "无此场景"), null);
});

void test("rewriteScenePosition 有行改行并校验旧值；无行插入；快照过期拒绝", () => {
	const moved = rewriteScenePosition(doc, "黑石城", { x: 120, y: 80 }, 300, 250.5);
	assert.ok(moved);
	const s1 = parseScenes(moved, 0);
	assert.equal(s1["黑石城"].x, 300);
	assert.equal(s1["黑石城"].y, 250.5);
	assert.notEqual(moved, doc);
	const added = rewriteScenePosition(doc, "山洞", null, 10, 20);
	assert.ok(added);
	const s2 = parseScenes(added, 0);
	assert.equal(s2["山洞"].x, 10);
	assert.equal(s2["山洞"].content, "多行正文第一行\n第二行", "插入位置行不吞围栏");
	assert.ok(added.indexOf("- 位置：10,20") < added.indexOf("```text"), "位置行插在围栏之前");
	assert.equal(rewriteScenePosition(doc, "黑石城", { x: 1, y: 2 }, 5, 5), null, "旧值不符＝快照过期");
	assert.equal(rewriteScenePosition(doc, "山洞", { x: 1, y: 2 }, 5, 5), null, "快照有值但原文无行＝过期");
	assert.equal(rewriteScenePosition(doc, "无此场景", null, 5, 5), null);
	assert.equal(rewriteScenePosition(doc, "黑石城", { x: 120, y: 80 }, NaN, 5), null);
});

void test("注释区同 id 标题不参与定位（模板示例不误伤）", () => {
	const commented = "# 场景\n\n<!--\n## 示例\n- 描述：注释里的示例\n-->\n\n## 真场景\n- 描述：正文\n";
	assert.equal(parseScenes(commented, 0)["示例"], undefined, "注释示例不解析");
	const out = deleteSceneBlock(commented, "示例");
	assert.equal(out, null, "注释里的同 id 不会被误定位");
	const real = updateSceneBlock(commented, "真场景", { description: "改过" });
	assert.ok(real);
	assert.ok(real.includes("<!--"), "注释保留");
	assert.ok(real.includes("- 描述：改过"));
});

void test("SceneBlockInput 全字段序列化往返（标题/章节/更新）", () => {
	const input: SceneBlockInput = { scene_id: "全字段", title: "显示名", description: "d", chapter_num: 5, characters: ["甲", "乙"], notes: "n", x: 1.5, y: -2, parent: "P", created_at: "c", updated_at: "u", content: "line1\nline2" };
	const parsed = parseScenes(formatSceneBlock(input), 0)["全字段"];
	assert.equal(parsed.title, "显示名");
	assert.equal(parsed.chapter_num, 5);
	assert.equal(parsed.x, 1.5);
	assert.equal(parsed.y, -2);
	assert.equal(parsed.parent, "P");
	assert.equal(parsed.updated_at, "u");
	assert.equal(parsed.content, "line1\nline2");
});

void test("关联场景（v0.4.7+）：解析为列表、formatSceneBlock 往返、update 重写/删行/补写", () => {
	const doc = "# 场景\n\n## A\n- 关联：B、C\n- 描述：d\n";
	assert.deepEqual(parseScenes(doc, 0)["A"].related, ["B", "C"]);
	const parsed = parseScenes(formatSceneBlock({ scene_id: "A", chapter_num: 0, characters: [], related: ["B", "C"] }), 0)["A"];
	assert.deepEqual(parsed.related, ["B", "C"], "序列化往返一致");
	const rw = updateSceneBlock(doc, "A", { related: ["D"] });
	assert.ok(rw && rw.includes("- 关联：D") && !rw.includes("B、C"), "给出的 related 整行重写");
	const del = updateSceneBlock(doc, "A", { related: [] });
	assert.ok(del && !del.includes("- 关联："), "空数组＝删行");
	const keep = updateSceneBlock(doc, "A", { description: "改" });
	assert.ok(keep && keep.includes("- 关联：B、C"), "未触碰 related＝原行保留");
	const ins = updateSceneBlock("## A\n- 描述：d\n", "A", { related: ["B", "C"] });
	assert.ok(ins && ins.includes("- 关联：B、C"), "原文缺该行＝补写");
});
