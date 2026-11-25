import { test } from "node:test";
import assert from "node:assert/strict";

import { TOUCH_TIP_SKIP_SELECTOR, touchTipOptions, touchTipShouldShow } from "./touch_tips";

// v0.4.11+ 触屏 Tip 通道（平板／手机）判定口径——内核事实见 touch_tips.ts 头注（悬停委托主动忽略非鼠标指针）

const base = { pointerType: "touch", inTooltip: false, interactive: false, label: "详情：黑木崖之战", connected: true };

void test("touchTipShouldShow：鼠标指针一律不弹（桌面＝核心悬停通道，本通道不得掺和）", () => {
	assert.equal(touchTipShouldShow({ ...base, pointerType: "mouse" }), false);
	assert.ok(touchTipShouldShow(base), "手指点按＝弹");
	assert.ok(touchTipShouldShow({ ...base, pointerType: "pen" }), "触控笔＝同样弹");
});

void test("touchTipShouldShow：交互件／Tip 自身／空标签／元素已脱离文档＝四种都不弹", () => {
	assert.equal(touchTipShouldShow({ ...base, interactive: true }), false);
	assert.equal(touchTipShouldShow({ ...base, inTooltip: true }), false);
	assert.equal(touchTipShouldShow({ ...base, label: null }), false);
	assert.equal(touchTipShouldShow({ ...base, label: "   " }), false);
	assert.equal(touchTipShouldShow({ ...base, connected: false }), false); // 抬手前已被重渲染换掉＝别把 Tip 挂到离档节点
});

void test("touchTipOptions：读内核自己挂的 data-tooltip-*（placement 只认四个合法值＝窄化代替断言；gap 非数＝丢弃）", () => {
	const attrs = (map: Record<string, string>) => ({ getAttribute: (k: string): string | null => (k in map ? map[k] : null) });
	assert.deepEqual(touchTipOptions(attrs({ "data-tooltip-classes": "aw-tl-tip" })), { classes: ["aw-tl-tip"] });
	assert.deepEqual(touchTipOptions(attrs({ "data-tooltip-position": "top", "data-tooltip-gap": "12" })), { placement: "top", gap: 12 });
	assert.deepEqual(touchTipOptions(attrs({ "data-tooltip-position": "sideways", "data-tooltip-gap": "abc" })), {}, "非法值一律不传");
	assert.deepEqual(touchTipOptions(attrs({ "data-tooltip-classes": "  " })), {}, "空类名不传＝不产生 classes:[]");
	assert.deepEqual(touchTipOptions(attrs({})), {});
});

void test("TOUCH_TIP_SKIP_SELECTOR：交互件豁免清单钉住关键项（漏一个词＝触屏上要么满屏噪音、要么内容 Tip 全哑）", () => {
	for (const key of ["button", "input", "select", "textarea", ".clickable-icon", "[role='button']"]) {
		assert.ok(TOUCH_TIP_SKIP_SELECTOR.includes(key), `缺交互件豁免：${key}`);
	}
});
