// 发布门禁 lint 配置（v0.2.13+，v0.4.6+ 加强）：用项目 tsconfig 的类型信息检测四类
// no-unsafe-* 错误（error/any 类型的赋值 / 调用 / 成员访问 / 返回），任一命中即发布失败。
// 背景：外部检查器（不含 @types/node 传递 lib 的类型环境）曾把 ES2019+ API（如 flatMap）
// 判为 error 类型而误报；本门禁保证代码在项目自身类型环境下无 unsafe 传播，
// 且 src/ 约定不使用超出 tsconfig lib（止于 ES2018）的 API（见 prompts.ts matchAll 注释）。
// v0.4.6+ 加强（v0.4.6 发版后外部评审实测命中）：
// ① no-restricted-properties/globals＝把「ES2019+ API 黑名单」从注释约定升级为硬拦截——
//    trimEnd/matchAll 这类代码在项目环境合法、在外部检查器退化为 any 触发 no-unsafe-*，本地曾测不出；
// ② no-irregular-whitespace＝模板字面量禁全角空格等不规则空白（评审实测：Notice 文案里 U+3000 缩进被报）；
//    普通字符串/注释/正则不拦（skipStrings/skipComments/skipRegExps 默认放行，测试数据里的全角字符不误伤）。
// ③ @typescript-eslint/no-unused-vars＝未用变量/参数硬拦（评审 Recommendation 级同样会被列出）。
import tseslint from "typescript-eslint";

const es2019plus = (name, year) => ({
	property: name,
	message: `ES${year} API：外部检查器类型环境（缺 @types/node 传递 lib）会把它退化为 error/any、触发 no-unsafe-* 误报；src/ 约定只用 ES2018 以内（见 eslint.config.mjs 头注/prompts.ts matchAll 注释）`,
});

export default tseslint.config(
	{
		name: "articlewriter/unsafe-release-gate",
		files: ["src/**/*.ts"],
		plugins: { "@typescript-eslint": tseslint.plugin },
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-unsafe-assignment": "error",
			"@typescript-eslint/no-unsafe-call": "error",
			"@typescript-eslint/no-unsafe-member-access": "error",
			"@typescript-eslint/no-unsafe-return": "error",

			// v0.4.6+ ES2019+ API 黑名单（按实际误报史逐步扩充；确需豁免用 eslint-disable 并注明理由）
			"no-restricted-properties": [
				"error",
				{ object: "Object", property: "fromEntries", message: "Object.fromEntries 是 ES2019：外部检查器会退化 error/any；手写 reduce/for 组装" },
				es2019plus("flatMap", 2019),
				es2019plus("flat", 2019),
				es2019plus("trimStart", 2019),
				es2019plus("trimEnd", 2019),
				es2019plus("matchAll", 2020),
				es2019plus("replaceAll", 2021),
				es2019plus("at", 2022),
			],
			"no-restricted-globals": [
				"error",
				{ name: "structuredClone", message: "structuredClone 是 ES2021+/DOM API：外部检查器类型环境不可用" },
				{ name: "globalThis", message: "globalThis 是 ES2020：用 window 或模块作用域变量" },
			],

			// v0.4.6+ 不规则空白：模板字面量内 U+3000/NBSP 等＝error（Notice/生成文案常用全角空格缩进的坑）
			"no-irregular-whitespace": ["error", { skipStrings: true, skipComments: true, skipRegExps: true, skipTemplates: false }],

			// v0.4.6+ 未用变量/参数（_前缀豁免＝有意占位）
			"@typescript-eslint/no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
		},
	},
);
