# 运行环境与构建部署

- 构建：`npm run build` = `tsc -noEmit -skipLibCheck && node esbuild.config.mjs --production` → 产出完整可分发目录 **`release/`**（esbuild 打包出 `main.js`，并自动把手写的 `manifest.json`、`styles.css`、写作指南 `WRITING_GUIDE.md` 一并拷入；目录已自动创建），另同步一份 `dist/main.js`——社区插件目录校验器只在仓库根 / `dist` / `build` / `out` 查找构建产物 main.js（两目录均已 gitignore，不入库）
- 打包：生成发布 zip（`articlewriter-v<版本号>.zip`）时把 `release/` 下全部文件整体压缩；**打包时，把写作指南也放进去**（`WRITING_GUIDE.md` 已由 esbuild.config.mjs 自动拷入 `release/`）
- **任何代码改动后必须跑通 `npm run build`（tsc 零错误）**；可再 `node --check release/main.js` 做语法兜底
- 部署：把 `release/` 下四个文件整体覆盖复制到 `/home/fosky/workspace/geng_bl/.obsidian/plugins/articlewriter/`，在 Obsidian 中重载插件生效
- Git：仓库远端为 Gitea `http://192.168.0.3:3000/geng_bl/articlewritter-obsidian.git`（分支 main）；`.gitignore` 排除 `node_modules/` 与 `/release/`——上传时只提交源码，不含依赖与编译产物
- **代码提交、版本打包与 Gitea Release 发布的完整流程见 [RELEASE.md](./RELEASE.md)**（含版本号规则、发布脚本与实测坑位），执行"打包发布"类任务前先读该文件
- **GitHub 镜像同步（强制）**：**每次向 Gitea 提交代码后，必须立即把改动文件同步到 GitHub 镜像并提交**——本地克隆在 `/home/fosky/workspace/articlewriter-obsidian-git`（SSH remote `git@github.com:gengbl/articlewriter-obsidian.git`；历史为工作树拷贝式独立提交、非本仓库 clone，不能直接 push 同一对象）。流程：主仓 commit+push 后 → 把本次改动的文件拷入该目录 → `git add <显式列出>` + **同消息** commit → `push origin main`。标签**无 v 前缀**（如 `0.0.9`，区别于 Gitea 的 `v0.0.9`），仅发布时打并推送。向该远端推新标签即触发 `.github/workflows/release.yml`（CI 从源码重建 + attestation 签名 + 自动创建/更新 Release，无需手动传附件）；细节与手动回落方案见 RELEASE.md「GitHub 镜像 Release」节
- esbuild 配置注意：非 watch 模式直接 `esbuild.build(options)` + `process.exit(0)`；banner 必须是对象 `{ js: "..." }` 不能是字符串
- **正则语法兼容性**：Obsidian 移动端 iOS（Safari <16.4）不支持 lookbehind 断言 `(?<=…)` / `(?<!…>`，运行时直接抛 SyntaxError——src 内所有动态 RegExp 禁用该语法；需排除匹配起点前的特定字符时统一用「(?:^|[^X])」前缀捕获组 + 替换串 `$N` 回补被消耗的前缀字符（范例见 banned_words.ts simplifyNegationContrast；改动此类规则须做新旧输出等价性对照验证）
- **API 版本上限（lib ≤ ES2018）**：tsconfig lib 最高只到 ES2018，但 `@types/node/index.d.ts` 内含 `/// <reference lib="es2020" />`，本地 tsc 会静默拉入 es2019/es2020 标准库扩展——写这些 API 本地编译能过、外部 lint / 社区目录校验器却按低版本类型环境把它们判为 error-typed（报 `no-unsafe-member-access` / `no-unsafe-assignment`）。已知踩坑实例：`String.trimStart`/`matchAll`(ES2019/2020)、`Object.fromEntries`(ES2019)。故 src 一律低版本惯用法：全局 `/g` 正则扫描用 `exec` while 循环（模块级/静态共享的正则每次扫描前先 `.lastIndex = 0` 复位防残留状态；函数内局部正则实例天然无此问题），行首空白判断用 `/^\s*…/.test()` 而非 `trimStart().startsWith()`，「键值同名」映射（如设置页下拉框 options）用 `reduce` 构造恒等 Record 而非 ES2019 的同名 API——注意本项目 patch dts 的 `addOptions`/声明式 dropdown 只接受 `Record<string,string>`，不能改传字符串数组。新增代码若发现想用 ES2019+ API，先找 ES2018 内的等价写法
- **UI 文案禁用全角空格 U+3000**：中文界面字符串里用半角空格分隔词组即可；U+3000 触发 lint `no-irregular-whitespace`（曾于 main/modals/status_view 共 30 处批量替换为半角）
- **正则控制字符与 any 捕获组**：正则字面量含控制字符转义（`\x00-\x1f` 等）会被校验器报 no-control-regex——需匹配控制字符时用模块级 `new RegExp("…\\u0000-\\u001f", "g")` 动态构造，字符集须与原实现严格一致（范例 story_types.ts `FN_BAD_CHARS_RE`，对齐 Python 仅 C0、不含 DEL/C1）；`.replace(正则, fn)` 回调的捕获组参数在低版本 lib 下解析为 any，传入 parseInt 等有类型函数前必须显式标注 `(d: string)`（no-unsafe-argument，范例 story_manager.ts renumText）。不改变类型的防御性断言（冗余 `as number | undefined`、已收窄值上的非空 `!`）会报 no-unnecessary-type-assertion，勿加
- **本地 `node_modules/obsidian`（1.13.1）是被 patch 过的 d.ts**（有 `undo.patch`），与官方类型不同，已知差异：
  - 删除统一走 `app.fileManager.trashFile(file)`（单参、跟随用户「删除方式」设置：默认移入 vault `.trash/`，或系统回收站），不用 `delete()` 硬删；旧写法 `vault.trash(file,false)` 已全项目停用
  - HTMLElement 扩展没有 `createTextArea` / `setPlaceholder` 等方法：用 `createEl("textarea") as HTMLTextAreaElement` + 原生属性（`.placeholder = ...`、`.value = ...`、`.focus()`）
  - `getAbstractFileByPath` 返回 `TAbstractFile | null`，凡要当文件用必须先 `instanceof TFile` 收窄
