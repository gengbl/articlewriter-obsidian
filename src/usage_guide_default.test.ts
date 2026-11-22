import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_USAGE_GUIDE, embedUsageGuideImages, USAGE_QR_ASSET_NAME } from "./usage_guide_default";

test("使用说明包内文本：{{WECHAT_QR}} 占位符已替换为同目录资源 wikilink（阅读模式不渲染内联 data: 图）", () => {
	assert.ok(!DEFAULT_USAGE_GUIDE.includes("{{WECHAT_QR}}"), "仍残留占位符＝替换未生效");
	assert.ok(DEFAULT_USAGE_GUIDE.includes(`![[${USAGE_QR_ASSET_NAME}]]`), "缺二维码 wikilink 引用");
	assert.ok(!DEFAULT_USAGE_GUIDE.includes("data:image"), "正文不应内联 dataurl 图片");
});

test("embedUsageGuideImages 幂等：无占位符的文本原样返回；有占位符则换成 wikilink", () => {
	assert.equal(embedUsageGuideImages("abc"), "abc");
	assert.equal(embedUsageGuideImages("x {{WECHAT_QR}} y"), `x ![[${USAGE_QR_ASSET_NAME}]] y`);
});
