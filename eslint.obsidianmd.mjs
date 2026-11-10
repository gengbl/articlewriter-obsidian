// Obsidian 插件专用规则扫描配置（advisory，非发布门禁）：eslint-plugin-obsidianmd recommended。
// 与发布门禁 eslint.config.mjs（四类 no-unsafe-*）分开：本扫描覆盖 Obsidian 特化约定——
// prefer-create-el（createEl("div") → createDiv）、prefer-active-doc（this.app.workspace.activeLeaf
// → this.app.workspace.getActiveDoc 类）、no-floating-promises、no-useless-assignment 等。
// 定位：每次代码改动后跑 `npm run lint:obsidianmd` 查看命中；是否修复由用户决定，
// 不阻塞提交/发布。prefer-create-el 等类型感知规则需 project 配置，故保留 tsconfig 解析。
// 注意：ESLint 10 flat config 不支持 `extends` 键，必须展开 recommended 数组。
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
	...obsidianmd.configs.recommended,
	{
		name: "articlewriter/obsidianmd-scan",
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
);
