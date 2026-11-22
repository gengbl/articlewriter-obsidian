// 《场景.md》场景区（书/卷/章三层通用，v0.4.7+ 场景面板字段与块级写回）纯函数测试：
// 解析/序列化往返（位置/父场景）、块级新增/编辑/删除、位置改写与快照过期防护。
import test from "node:test";
import assert from "node:assert/strict";

import {
	deleteSceneBlock,
	formatSceneBlock,
	insertSceneBlock,
	parseScenes,
	renameSceneBlock,
	renameSceneRefs,
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

void test("renameSceneBlock（v0.4.8+）：换块锚＋同文档引用/等值标题行同步", () => {
	const src = `# 场景\n\n## 旧名\n- 标题：旧名\n- 描述：d\n- 位置：1,2\n\n## 子甲\n- 父场景：旧名\n\n## 丙\n- 关联：旧名、别的\n\n## 丁\n- 关联：别的\n\`\`\`text\n正文里也写 旧名 不改\n\`\`\`\n\n<!-- 注释里的 ## 旧名 与 - 关联：旧名 都不改 -->\n`;
	const out = renameSceneBlock(src, "旧名", "新名");
	assert.ok(out, "改名成功");
	assert.ok(out.includes("## 新名"), "块锚换名");
	assert.ok(!out.includes("## 旧名\n"), "旧块锚标题行不再存在（注释区里的旧名不算）");
	assert.ok(out.includes("- 标题：新名"), "等值标题行同步");
	assert.ok(out.includes("- 父场景：新名"), "同文档子场景引用同步");
	assert.ok(out.includes("- 关联：新名、别的"), "关联列表项同步");
	assert.ok(out.includes("正文里也写 旧名 不改"), "围栏内不改动");
	assert.ok(out.includes("注释里的 ## 旧名"), "注释区不改动");
	assert.ok(out.includes("- 位置：1,2"), "其余字段保留");
	const parsed = parseScenes(out, 0);
	assert.equal(parsed["子甲"].parent, "新名");
	assert.deepEqual(parsed["丙"].related, ["新名", "别的"]);
	assert.equal(parsed["旧名"], undefined);
	// 拒绝路径
	assert.equal(renameSceneBlock(src, "旧名", "子甲"), null, "目标名在同文档已有块＝冲突拒绝");
	assert.equal(renameSceneBlock(src, "旧名", "非/法"), null, "非法字符拒绝");
	assert.equal(renameSceneBlock(src, "旧名", "旧名"), null, "同名＝noop 拒绝");
	assert.equal(renameSceneBlock(src, "不存在", "新名"), null, "旧块找不到（快照过期）拒绝");
});

void test("renameSceneRefs（v0.4.8+）：跨文档引用同步＋去重＋无引用原样返回", () => {
	const src = `# 场景\n\n## 甲\n- 父场景：旧名\n\n## 乙\n- 关联：旧名、新名\n\n## 无引用\n- 描述：x\n`;
	const out = renameSceneRefs(src, "旧名", "新名");
	assert.ok(out.includes("- 父场景：新名"), "父场景引用同步");
	assert.ok(out.includes("- 关联：新名"), "关联去重（新名已有＝只删旧项）");
	assert.ok(!out.includes("旧名"), "旧名全部替换");
	const same = renameSceneRefs(src, "不存在的引用", "新名");
	assert.equal(same, src, "无引用可改＝原样返回");
});

void test("多行描述（v0.4.8+）：解析续行、updateSceneBlock 重写吞旧续行、序列化往返", () => {
	const src = `# 场景\n\n## 甲\n- 描述：第一行\n  第二行\n  第三行\n- 角色：张三\n\n## 乙\n- 描述：单行\n  续行\n- 位置：1,2\n`;
	const parsed = parseScenes(src, 0);
	assert.equal(parsed["甲"].description, "第一行\n第二行\n第三行", "两空格缩进续行归入描述");
	const upd = updateSceneBlock(src, "甲", { description: "新首行\n新次行" });
	assert.ok(upd);
	const back = parseScenes(upd, 0)["甲"];
	assert.equal(back.description, "新首行\n新次行", "重写后旧续行不残留");
	assert.ok(!upd.includes("第二行"), "旧续行被吞");
	assert.ok(upd.includes("  新次行"), "续行两空格缩进写出");
	assert.deepEqual(back.characters, ["张三"], "其余字段保留");
	const del = updateSceneBlock(src, "乙", { description: "" });
	assert.ok(del && !del.includes("- 描述：单行") && !del.includes("续行"), "空描述＝删描述行及续行");
	assert.ok(del && del.includes("- 位置：1,2"), "删描述不动其它字段");
	const out = formatSceneBlock({ scene_id: "丙", chapter_num: 0, characters: [], description: "A\nB" });
	assert.ok(out.includes("- 描述：A\n  B"), "formatSceneBlock 多行序列化");
	assert.equal(parseScenes(out, 0)["丙"].description, "A\nB", "往返一致");
});

void test("地形/颜色（v0.4.8+）：解析、非法色忽略、序列化往返、update 未触碰保留", () => {
	const src = `# 场景\n\n## 甲\n- 地形：森林\n- 颜色：#22aa33\n- 描述：x\n\n## 乙\n- 颜色：#xyz\n- 地形：未知地貌\n`;
	const parsed = parseScenes(src, 0);
	assert.equal(parsed["甲"].terrain, "森林");
	assert.equal(parsed["甲"].color, "#22aa33");
	assert.equal(parsed["乙"].color, undefined, "非法 #hex 不写入");
	assert.equal(parsed["乙"].terrain, "未知地貌", "未识别地形值仍可解析");
	const fmt = formatSceneBlock({ scene_id: "丙", chapter_num: 0, characters: [], terrain: "海洋", color: "#123456" });
	assert.ok(fmt.includes("- 地形：海洋") && fmt.includes("- 颜色：#123456"), "序列化写出两字段");
	assert.equal(parseScenes(fmt, 0)["丙"].color, "#123456", "往返一致");
	const upd = updateSceneBlock(src, "甲", { description: "y" });
	assert.ok(upd && upd.includes("- 地形：森林") && upd.includes("- 颜色：#22aa33"), "弹窗不编辑＝地形/颜色行原样保留");
	const setT = updateSceneBlock(src, "甲", { terrain: "海洋" });
	assert.ok(setT && setT.includes("- 地形：海洋") && !setT.includes("- 地形：森林"), "弹窗下拉改地形＝原位重写该行");
	const delT = updateSceneBlock(src, "甲", { terrain: "" });
	assert.ok(delT && !delT.includes("- 地形：森林") && delT.includes("- 颜色：#22aa33"), "空串＝删地形行、颜色行不动");
	const addT = updateSceneBlock(src.replace("- 地形：未知地貌\n", ""), "乙", { terrain: "城市" });
	assert.ok(addT && addT.includes("- 地形：城市"), "原文缺地形行＝补写");
});

void test("关联路标（v0.4.8+）：`id（路标）` 解析与往返、update 重写按 id 保留路标、rename 路标随项走", () => {
	const src = `# 场景\n\n## 甲\n- 关联：黑风寨（官道·三日路程）、峡谷（传送阵）\n\n## 乙\n`;
	const parsed = parseScenes(src, 0);
	assert.deepEqual(parsed["甲"].related, ["黑风寨", "峡谷"], "related 只存 id");
	assert.equal(parsed["甲"].relatedLabels?.["黑风寨"], "官道·三日路程");
	assert.equal(parsed["甲"].relatedLabels?.["峡谷"], "传送阵");
	const fmt = formatSceneBlock({ scene_id: "甲", chapter_num: 0, characters: [], related: ["黑风寨", "峡谷"], relatedLabels: { "峡谷": "传送阵" } });
	assert.ok(fmt.includes("- 关联：黑风寨、峡谷（传送阵）"), "无路标的项不加括号");
	const upd = updateSceneBlock(src, "甲", { related: ["峡谷", "乙"] });
	assert.ok(upd && upd.includes("- 关联：峡谷（传送阵）、乙"), "重写关联按 id 找回原路标；新增项无路标");
	const ren = renameSceneRefs(src, "黑风寨", "黑风岭");
	assert.ok(ren.includes("- 关联：黑风岭（官道·三日路程）、峡谷（传送阵）"), "改名只换 id、路标原样保留");
});

void test("场景挂事件（v0.4.8+）：`- 事件：名（备注）` 解析与序列化往返、update 重写按名字保留备注、空数组删行、缺行补写", () => {
	const src = `# 场景\n\n## 黑木崖\n- 地形：山脉\n- 事件：黑木崖之战（高潮）、夜袭\n- 描述：x\n\n## 乙\n`;
	const parsed = parseScenes(src, 0);
	assert.deepEqual(parsed["黑木崖"].events, ["黑木崖之战", "夜袭"], "events 只存事件名");
	assert.equal(parsed["黑木崖"].eventLabels?.["黑木崖之战"], "高潮");
	assert.equal(parsed["黑木崖"].eventLabels?.["夜袭"], undefined, "无备注项不入表");
	const fmt = formatSceneBlock({ scene_id: "丙", chapter_num: 0, characters: [], events: ["黑木崖之战", "夜袭"], eventLabels: { "黑木崖之战": "高潮" } });
	assert.ok(fmt.includes("- 事件：黑木崖之战（高潮）、夜袭"), "序列化按名字回填备注、无备注项不加括号");
	assert.deepEqual(parseScenes(fmt, 0)["丙"].events, ["黑木崖之战", "夜袭"], "往返一致");
	const keep = updateSceneBlock(src, "黑木崖", { events: ["夜袭", "黑木崖之战"] });
	assert.ok(keep && keep.includes("- 事件：夜袭、黑木崖之战（高潮）"), "弹窗只交名字＝备注按名字找回、顺序随弹窗");
	const del = updateSceneBlock(src, "黑木崖", { events: [] });
	assert.ok(del && !del.includes("- 事件：") && del.includes("- 地形：山脉"), "空数组＝删事件行、其它字段行不动");
	const addEv = updateSceneBlock(src.replace("- 事件：黑木崖之战（高潮）、夜袭\n", ""), "黑木崖", { events: ["夜袭"] });
	assert.ok(addEv && addEv.includes("- 事件：夜袭"), "原文缺事件行＝补写");
	const untouched = updateSceneBlock(src, "黑木崖", { description: "y" });
	assert.ok(untouched && untouched.includes("- 事件：黑木崖之战（高潮）、夜袭"), "未交 events＝原行原样保留");
});

void test("联通性说明（v0.4.9+）：relatedNotes 按行覆盖/清空、未列出的 id 沿用原说明、说明里的括号与顿号写盘前净化保证往返", () => {
	const src = `# 场景\n\n## 甲\n- 关联：黑风寨（官道·三日路程）、峡谷\n\n## 乙\n`;
	const upd = updateSceneBlock(src, "甲", {
		related: ["黑风寨", "峡谷", "乙"],
		relatedNotes: { "黑风寨": "山间小径，半日", "峡谷": "传送阵（当日可达）", "乙": "" },
	});
	assert.ok(upd);
	assert.ok(upd.includes("- 关联：黑风寨（山间小径·半日）、峡谷（传送阵·当日可达）、乙"), "逗号/括号被换成「·」＝不会被 splitList 拆项、括号不会错位");
	const reParsed = parseScenes(upd, 0);
	assert.equal(reParsed["甲"].relatedLabels?.["峡谷"], "传送阵·当日可达", "写出去能原样读回");
	assert.deepEqual(reParsed["甲"].related, ["黑风寨", "峡谷", "乙"]);
	const cleared = updateSceneBlock(src, "甲", { related: ["黑风寨", "峡谷"], relatedNotes: { "黑风寨": "" } });
	assert.ok(cleared && cleared.includes("- 关联：黑风寨、峡谷"), "说明留空＝清掉该行括号说明");
	const untouched = updateSceneBlock(src, "甲", { description: "换段描述" });
	assert.ok(untouched && untouched.includes("- 关联：黑风寨（官道·三日路程）、峡谷"), "不提交关联＝原说明原样保留");
});
