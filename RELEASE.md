# RELEASE.md — 代码提交与版本发布约定（articlewriter-obsidian）

## 仓库与凭据

- Gitea 远端 `http://192.168.0.3:3000/geng_bl/articlewritter-obsidian.git`，分支 main；版本标签 `vX.Y.Z`
- git 操作使用 `~/.git-credentials` 中 geng_bl 的既有凭据；REST API 用 curl `-u user:pass` Basic 鉴权即可通过
- **凭据提取陷阱**：URL 里端口是百分号编码（`%3a`），从整行解析 user/pass 时只取 `@` 之前的部分，否则主机名混进密码导致 401
- `.gitignore` 排除 `node_modules/`、`/release/`、`articlewriter-v*.zip`：**只有源码 + manifest.json + 文档进 git，zip 永不入库**（本地留一份 + Gitea Release 附件各一份）

## 版本号规则

- `manifest.json` 语义化版本；每批功能新增 / 修复在发布时 patch +1（如 0.0.3 → 0.0.4）。改完必须重新构建让 esbuild 把新 manifest.json 同步进 `release/` 再打包。

## 代码提交流程（每次任务收尾）

1. `npm run build && node --check release/main.js` 通过
2. 部署：`release/` 下全部文件覆盖复制到 `/home/fosky/workspace/geng_bl/.obsidian/plugins/articlewriter/`
3. 按 AGENTS.md「工作更新写回约定」修订条目 + CHANGELOG.md 末尾追加一行摘要
4. `git add <显式列出改动文件>`（不用 `git add .`）
5. `git commit -m "vX.Y.Z：中文摘要"`（非发布的普通提交直接写功能描述即可）
6. `git push origin main`

## 发布打包与上线流程（用户要求"打包发布"时）

1. bump `manifest.json` version
2. `npm run build` 重建（esbuild 自动拷入新版 manifest.json、styles.css、WRITING_GUIDE.md）
3. **整体压缩 `release/` 全部文件**：`cd release && zip ../articlewriter-v<版本>.zip *`——必须含 WRITING_GUIDE.md，不要手工枚举文件名漏掉
4. 提交打标签：`git add manifest.json …` → commit → `git push origin main` → `git tag v<版本> && git push origin v<版本>`
5. 创建 Gitea Release：**REST API 会忽略上传的文件，只能走 Web 会话表单流**（脚本如下；凭据用上面提到的 user/pass）：

```bash
B=http://192.168.0.3:3000; CJ=/tmp/opencode/cj.txt
# ① 登录拿会话 cookie（已有有效会话可跳过）
CSRF=$(curl -s -c $CJ $B/user/login | grep '_csrf' | grep -o 'value="[^"]*"' | head -1 | cut -d'"' -f2)
curl -s -b $CJ -c $CJ -e "$B/user/login" --data-urlencode "_csrf=$CSRF" \
  --data-urlencode "user_name=geng_bl" --data-urlencode "password=<密码>" \
  -o /dev/null -w "%{http_code}\n" $B/user/login    # 期望 303
PAGE=$B/geng_bl/articlewritter-obsidian/releases/new
# ② 取新建页及其 _csrf
curl -s -b $CJ $PAGE -o /tmp/opencode/relnew.html
CSRF=$(grep '_csrf' /tmp/opencode/relnew.html | grep -o 'value="[^"]*"' | head -1 | cut -d'"' -f2)
# ③ 上传临时文件 → uuid（字段名是 file，不是 attachment！）
UUID=$(curl -s -b $CJ --referer "$PAGE" -X POST $B/geng_bl/articlewritter-obsidian/releases/attachments \
  -F "_csrf=$CSRF" -F "file=@articlewriter-v<版本>.zip;type=application/zip" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['uuid'])")
# ④ 提交表单创建 Release（隐藏域 files=<uuid> 关联附件；期望 303）
curl -s -b $CJ --referer "$PAGE" -X POST $PAGE -F "_csrf=$CSRF" -F "tag_name=v<版本>" \
  -F "tag_target=main" -F "title=v<版本>" -F "content=<发布说明>" -F "files=$UUID" \
  -o /dev/null -w "%{http_code}\n"
```

6. **验证**：`GET $B/api/v1/repos/geng_bl/articlewritter-obsidian/releases` 确认该 tag 的 asset 字节数与本地 zip `stat -c %s` 一致
7. 需要修正已发布的附件时：API `DELETE .../releases/{id}` 删掉整个 release → 重做 ②–⑥（没有单独增删资产的端点）

## GitHub 镜像 Release 要求（社区插件目录校验）

- GitHub 镜像仓库 `gengbl/articlewriter-obsidian`（标签**无 v 前缀**，如 `0.0.6`；历史为工作树拷贝式独立提交，非 clone），其 tag 对应的 Release **必须把 `main.js`、`manifest.json`、`styles.css` 作为独立资产直接上传**——校验器只认 Release assets 里的散文件，zip 内的不算；`articlewriter-v<版本>.zip` 可并存作额外资产（多余文件仅 recommendation 级提示，不阻塞）。
- 本机无 gh CLI / PAT，走 Web UI 手动创建：`https://github.com/gengbl/articlewriter-obsidian/releases/new?tag=<版本>&target=main`，发布说明用下方模板。
- manifest minAppVersion 必须覆盖代码用到的全部 API 的 @since 版本（当前 =1.13.0：声明式设置 getSettingDefinitions 等 @since 1.13.0、fileManager.trashFile @since 1.6.6），否则 `obsidianmd/no-unsupported-api` 报错。

## 发布说明模板

```
**vX.Y.Z**

- 中文要点，每条一个改动（功能 / 修复 / 行为变更），保持精简
```

## 坑位记录（Gitea 1.25.x 实测）

- REST API `POST /releases` 忽略 multipart 里的文件 part；也没有独立资产上传端点（`POST /releases/{id}/assets` 报 500）→ 一律走上面的 Web 会话流
- `/releases/attachments` 临时上传的文件字段名是 **`file`**（用 `attachment` 会 500 "FormFile: http: no such file"）；表单提交时用隐藏域 **`files=<uuid>`** 关联（直接发 `attachment=` part 会被静默忽略、release 建出来但无附件）
- CSRF token 必须取自对应页面本身，且带匹配的 Referer
- zsh 行首不要写未加引号的 `===`（= 展开报错）；本机 curl 不支持 `-F "body<文件"` 语法（报 "badly used here"），正文用 shell 变量经 -F 传或改用 JSON
- 标签已存在 release 时必须先删再重建；删除后重新取新建页（csrf 可能变化）
