// 发布门禁 lint 配置（v0.2.13+）：只做一件事——用项目 tsconfig 的类型信息检测四类
// no-unsafe-* 错误（error/any 类型的赋值 / 调用 / 成员访问 / 返回），任一命中即发布失败。
// 背景：外部检查器（不含 @types/node 传递 lib 的类型环境）曾把 ES2019+ API（如 flatMap）
// 判为 error 类型而误报；本门禁保证代码在项目自身类型环境下无 unsafe 传播，
// 且 src/ 约定不使用超出 tsconfig lib（止于 ES2018）的 API（见 prompts.ts matchAll 注释）。
import tseslint from "typescript-eslint";

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
		},
	},
);
