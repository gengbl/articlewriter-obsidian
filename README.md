# ArticleWriter for Obsidian

> Chinese version: [README_ZN.md](./README_ZN.md)

> Current release: **0.4.11** — grab `main.js` / `manifest.json` / `styles.css` from the [GitHub Release](https://github.com/gengbl/articlewriter-obsidian/releases/latest).

## ⚠️ Disclosures & Security Statement

**Network requests.** This plugin performs no network activity except LLM chat. All outbound traffic goes exclusively through the official `openai` SDK to the OpenAI-compatible endpoint **that you configure yourself in settings** (a local server such as Ollama / LM Studio / llama.cpp, or a provider API like DeepSeek or Qwen DashScope). At runtime the plugin makes exactly three kinds of calls — non-streaming and streaming chat completions, plus one optional `GET /models` issued only when you run the LLM connection test to confirm your endpoint works; any additional request-related call sites flagged by scanners belong to the bundled SDK's generic HTTP layer and are not used elsewhere by this plugin. There is **no telemetry, no analytics, no update checking, and no connection to any author-operated server**. Your API key is entered by you in the settings panel, stored locally inside your vault with the rest of the plugin settings, and transmitted only as an authentication header to the endpoint you chose; when left empty (the normal case for local servers) a fixed placeholder value (`local-no-auth`) stands in its place, so no real secret ever leaves your machine.

**Base64 usage (`atob` / `btoa`).** The plugin's own source contains exactly **one** decode call: a single `atob` that turns a QR-code image *bundled into the build itself* (the author's contact QR inlined as a data URL at build time) back into a PNG file written next to 《使用说明.md》 in your work folder — a static bundled asset, no network, no user data, no encoding calls at all. Every other base64 occurrence in the shipped bundle originates from third-party libraries that esbuild bundles: the `yaml` parser (its standard handler for YAML `!!binary` tags) and the `openai` SDK (generic base64 ↔ binary-buffer conversion helpers). They perform ordinary data-format conversions and are **not** used to obfuscate API keys, hide URLs, or mask code payloads. Nothing in the build is minified or obfuscated — the complete human-readable source is published in [the repository](https://github.com/gengbl/articlewriter-obsidian); please audit it directly if you have concerns.

### Vault Enumeration Disclosure
This plugin inspects file structures inside your vault through Obsidian's standard `app.vault` APIs, in exactly two scopes:
* **Purpose — vault-wide *path* listing (two small UI pickers):** (a) the folder picker shown on first use / when switching the working directory (`work_dir`) lists existing folders so you can fuzzy-search where your manuscripts live; this walk starts at the vault root but is deliberately bounded — it descends only **3 levels deep**, stops after **500 entries**, and skips hidden directories such as `.obsidian/`; (b) the dockable chat panel's @reference candidate list calls `vault.getFiles()` when rendering so that *any* document in your vault can be quoted into an LLM prompt with one keystroke. Both list **paths only** — no content is read at either point. A file's text is loaded only after you act on it: picking a folder merely sets the scope for later local operations, and referencing a file adds its content to the explicit request sent to the model endpoint you configured yourself (see the Network-requests note above).
* **Purpose — working-directory-scoped operations:** Everything else (building the story status tree, listing volumes/chapters, counting words per chapter/book, loading outline / world-building / character / scene documents into writing prompts, the chat panel's tool-calling feature, the deterministic sensitive-word scanner, and typing statistics) operates exclusively inside the work folder **you select on first use** (`work_dir`), plus the plugin's own `SKILLS/` folder inside it. Files outside that folder are never opened or scanned by these features. Chat-panel tool calls (the model asking to read a chapter or run a writing command) are local executions triggered by chat turns *you* initiate, and they only touch the current story inside `work_dir`.
* **Privacy Assurance:** All enumeration runs entirely locally and in-memory on your machine. File paths and contents are processed strictly on-device and are **never** uploaded, indexed remotely, leaked, or shared with any external server — except for the deliberate LLM requests described in the Network-requests note that you trigger yourself.
* **Summary for reviewers:** Vault-wide listing happens in exactly two UI pickers and exposes **paths only** (the folder picker even caps at 3 levels deep / 500 entries); all other file access stays inside the user-selected working directory, everything runs locally in-memory, and nothing leaves the machine except LLM requests you explicitly send to your own configured endpoint.

## Overview

ArticleWriter turns your vault into an AI-assisted novel workshop. Each story is a folder of plain Markdown files (a YAML-frontmatter state doc, a `案头资料/` desk folder of reference docs, a `书稿/` manuscript folder organized into volumes and chapter folders), and on top of that sits the full writing pipeline: **six-stage fully-automatic book generation from a one-line premise** (worldview → planning guide → timeline → book outline → volume outlines → chapters), or single commands for any individual step — write / continue / rewrite / polish chapters, strip AI-sounding phrasing, detect typos and sensitive words, review from a global perspective, analyze characters & scenes out of finished prose.

A **skill system** (`SKILLS/` Markdown files, seeded with 29 built-ins) supplies craft technique, genre guides, banned-word lists and per-stage identity prompts, injected into the exact prompts per stage and fully user-editable. Five **persistent dockable panels** — Writing Desk, LLM Chat (with model tool-calling that can read your chapters and run writing commands for you), Relationship graph, Timeline and Scene canvas — keep the book's structure one click away. All data stays local; no external services are required beyond the OpenAI-compatible model endpoint you configure yourself. The plugin runs on **both desktop and mobile** (all panels work on phones; mouse-only gestures degrade gracefully).

> **Note (v0.3.5+):** the old three-tier `WRITING_GUIDE.md` system is **retired** — the files and the five related commands were removed and are auto-purged from existing vaults on startup. Its functionality moved into the skill system (genre/technique skills, banned-word list, chapter-writing requirements) plus the `word_range` field of 《故事状态.md》 (command "设置本章字数区间").

## Data Layout

```
<work_dir>/
├── SKILLS/                     # skill library (see Skills below) — seeded built-ins, plain editable .md
│   ├── 题材/<genre>.md          # genre skills (auto-loaded per book's genre)
│   ├── 编写类型/<style>.md      # writing-style skills (auto-loaded per book's style)
│   ├── 系统提示词/<name>.md     # system-prompt overrides (internal, automatic)
│   └── <technique>.md          # technique skills, opted in per stage
└── <小说名>/
    ├── 故事状态.md              # YAML frontmatter = runtime state (title/genre/word_range/prev_chapters/
    │                           #   auto_book pipeline config/book_skills per-stage skill picks/per-chapter meta);
    │                           #   legacy story_state.json auto-migrated with a _backup/ copy
    ├── 案头资料/                # desk docs: 9 default reference docs (大纲/策划指南/世界观/伏笔/笔记/
    │   │                       #   人物/人物关系/场景/时间线) + user files
    │   ├── 灵感/灵感.md         # inspiration toolkit (one ## block per idea)
    │   ├── 码字记录.md          # typing stats (auto-appended)
    │   ├── 敏感词报告.md        # whole-book sensitive-word reports (appended)
    │   ├── AI会话/              # chat-panel session transcripts (auto-saved)
    │   └── Skill/<技能名>.md    # book-level skills
    ├── 书稿/
    │   ├── 引言/                # prologue docs (auto-seeded folder)
    │   ├── <卷名>/              # volume entity folder (chapters live under it)
    │   │   ├── 文档/            # volume docs (卷大纲/人物/场景/时间线…, bare names)
    │   │   └── 卷摘要.md        # volume summary (LLM, rebuilt from chapter summaries)
    │   └── 第NN章-<标题>/       # one folder per chapter (unassigned chapters sit directly under 书稿/)
    │       ├── NN-<标题>.md             # body
    │       ├── NN-<标题>-大纲.md         # chapter outline
    │       ├── NN-<标题>-摘要.md         # chapter summary (lazy-generated)
    │       ├── NN-<标题>-人物.md / -人物关系.md / -场景.md / -信息.md / -时间线.md
    └── AI提示词/                # only if you run "Export AI prompts" (exact prompts per stage, no LLM call)
```

Missing docs are auto-created as "HTML-comment example" templates when creating a book/volume/chapter; existing files are never overwritten. All names go through `safeFilename()`. Old layouts (docs at the book root, bare `章节.md`, old prefixes like `初见-章节.md`) are detected and auto-migrated into the `案头资料/` + `书稿/` structure; legacy names can also be batch-renamed on book switch.

## Skills (`SKILLS/`)

Skills are short craft-technique Markdown docs stored in `<work_dir>/SKILLS/` (one flat level, plain files you can edit in Obsidian). Built-ins are seeded on startup **only when missing** — never overwriting your edits. They are **strictly opt-in** per stage: each of the five writing stages (worldview generation / planning guide / book & volume outline / chapter outline / chapter writing) has a reference-document list in Settings where `skill:<name>` entries decide what gets injected; built-in defaults already include the tension toolbox, per-stage identity-boost skills, the high-frequency banned-word list and the worldview framework (29 built-ins total: technique / genre / identity-boost).

* **Genre & writing-style skills** (`SKILLS/题材/`, `SKILLS/编写类型/`) auto-load based on the book's genre/style — the dropdowns in "Create story" / "Edit story info" are generated from that folder.
* **Word-range placeholders**: skill text may use `{{word_low}}` / `{{word_high}}` / `{{word_range}}`, interpolated from the book's `word_range` setting at prompt-assembly time.
* **Book-level skills**: same format, stored under `<book>/案头资料/Skill/`, picked per stage via the "书籍 Skill 阶段配置…" command; injected after system skills.
* **System-prompt overrides** (`SKILLS/系统提示词/`) replace seven internal system prompts (cast analysis, summaries, outline generation, timeline, typo check…) — automatic, not part of the opt-in list.
* Commands: **新建 Skill…** (create), **书籍 Skill 阶段配置…** (per-stage picks); editing/deleting = just edit/delete the file.

## Commands (command palette: search "ArticleWriter" or the Chinese name)

| Group | Commands & notes |
| --- | --- |
| Story & structure | Create story (三问 dialog: title/genre/writing-style) · create/insert/delete/rename/renumber chapters · volume list/add/manage · volume mode on/off · organize volumes into folders · switch current story · scan-rebuild state doc · light state sync · complete state params · complete desk docs / outline docs |
| LLM writing | Write chapter (auto de-AI before save) · consecutive writing (one chapter per run) · continue / rewrite / polish current chapter · de-AI (sentences flagged by the banned-word list get rewritten in place; unfinished runs resumable via the 《AI味清单.md》 ledger) · review chapter (global-logic report) · typo check (LLM, underlined spans with suggestions, intentionally persisted) · fix chapter-number references (LLM rewrite of meta-references) |
| Pipeline & generation | **Fully-automatic book run + its config** (six stages orchestrated from the `auto_book` block of 《故事状态.md》: one-line premise → worldview → planning guide → timeline → book outline → volume outlines → chapters; any stage as start point, missing prerequisites reported, stop command available) · generate worldview / planning guide / timeline / book outline / volume outline · volumes from book outline · chapters from volume outline · sync new chapters from volume outline · append current chapter outline |
| Entities | Characters: list/add/manage/rename (whole-vault replacement with backup)/**merge duplicate registrations** · analyze cast & scenes (per-chapter LLM analysis of finished prose writes 人物/场景/人物关系 docs by scope; incremental during outline stages) · scenes list/add/manage · foreshadow list/add/manage · worldview overview/fields · inspiration toolkit (open/locate/rename/delete/add blocks in 《案头资料/灵感/灵感.md》, template from the 灵感模板 skill) |
| Word counts & stats | Count current chapter / whole book (pure-text chars) · per-book word-range setting · desk "码字状态" tab shows live typing stats (净增字数/时长/速度; auto-logged per segment to 《案头资料/码字记录.md》, pause-aware) |
| Sensitive words (zero-LLM) | Detect in chapter (word list = `SKILLS/敏感词清单.md`, seeded ~180 entries, user-editable; hits persisted as colored spans with category tooltips) · whole-book summary appended to 《案头资料/敏感词报告.md》 · non-blocking reminders after write/continue/rewrite |
| Export & misc | Pack chapters (all / range 3-7 / list 1、4、5) · export volume collection · article → screenplay · **Export AI prompts** (assembles the exact system/user prompts of every AI stage against the book's on-disk data, one `.md` per stage under 《AI提示词/》, no LLM call — for driving local models manually) · LLM connection test (GET /models) · generate 《使用说明.md》 (built-in manual; version-stamped, rebuilt after plugin upgrades; auto-created on setup) |

Every LLM generation first streams into the unified **"生成过程" panel** and only reaches disk after you press 保存 (save) — nothing overwrites your text silently.

## Persistent Panels

* **Writing Desk** (book icon, left drawer on mobile): work dir, book list (click = switch), current-book info, **Novel-state / Typing-state tab strip**, desk-docs & manuscript tree (volumes → chapters, 引言 folder, expand/collapse, per-row right-click menus covering create/delete/rename/generate/export), Skill subfolder node, refresh. Opening a chapter file in the editor also activates that chapter on the desk.
* **LLM Chat** (message icon): multi-turn streaming chat, per-turn model-config dropdown, @-references of any vault file, natural mentions auto-load the referenced chapter/volume/doc. Sessions are **auto-saved to 《案头资料/AI会话/》** and resumed on reopen; "compress context" plus automatic window-size compression keep long sessions alive. **Tool calling**: the model can, inside a chat turn, read chapters/outlines/docs, search the vault, set the current chapter, save text to files, and actually run writing/generation commands (write / continue / rewrite / polish / de-AI / review, outline & worldview & timeline generation, consecutive writing) — all executed locally against the current story, results fed back to the model. Chat reference docs/skills are opt-in in Settings, same picker as writing stages.
* **Relationship panel**: aggregates the three tiers of 《人物关系.md》 (book / volume / chapter). **Cards mode**: grouped cards (pair + type badge + status dot + description), inline add/edit/delete. **Graph mode**: force-directed layout (protagonist centred, degree-tiered), arc edges, colour = relation type, line style = status, thicker = registered in several places; `Ctrl/Shift`+wheel zoom anchored at the cursor, drag to pan, double-click / right-click = fit-to-view, collapsible legend row; clicking a node fills the **character-state drawer** (settings from 《人物.md》, one collapsible entry per source doc) and offers merge for multiply-registered names. Doc edits auto-refresh.
* **Timeline panel**: merges the three tiers of 《时间线.md》 into one vertical timeline sorted by numeric time point (`-129-06-15` style), tier-labelled & weighted, sub-events hang off parents with rails; fully editable in-panel (add / edit via dialog / delete / toggle done / **drag the time badge to change the time point** — hold Ctrl/⌘ on desktop, long-press then drag on mobile), `Ctrl+Z` undo, filters, jump-to-source; the merged timeline is injected into writing prompts as 【时间线】.
* **Scene panel**: three tiers of 《场景.md》 as cards on a zoomable/pannable canvas — drag to arrange (positions persisted as `- 位置：x,y`), parent/child links, per-terrain tinting, in-panel add/edit/delete.

## Workflow (work_dir)

1. The first time you use any ArticleWriter command, a **work directory picker** pops up automatically — choose an existing vault folder as your `work_dir`. A version-stamped 《使用说明.md》 (built-in manual, includes the author contact QR image file) is dropped there automatically and rebuilt after plugin upgrades; `SKILLS/` built-ins are seeded alongside it.
2. From then on, **everything operates under work_dir**; each story is one subfolder, and skill files are shared across books in `work_dir/SKILLS/`.
3. To change directories, use the "Select work directory" command or the settings page; switching clears the remembered last story.
4. With multiple books, commands show a story picker and remember your last choice.

## Settings (Obsidian Settings → ArticleWriter)

* **Work directory (work_dir)** — initialized by the first-use picker, re-selectable.
* **LLM configs** — named model configurations (OpenAI-compatible), stored in `.obsidian/plugins/articlewriter/data.json`; presets for local / DeepSeek / DashScope on first run. One config is active globally; the **per-stage model tab strip** (worldview generation / planning guide / book & volume outline / chapter outline / chapter writing) assigns a specific config to each stage.
* **Per-stage reference docs** — what each stage injects: built-in docs, any vault file, any skill; drag to reorder, "添加技能…" picker. Same list for the chat panel ("对话窗口引用文档/技能").
* **Typing stats segment length** (码字记录段长, default 10 min), **include volume summary** in writing context (off by default), **auto-open doc after create** — most per-book overrides (`word_range`, `prev_chapters`, `include_volume_summary`, `auto_book`, `book_skills`) live in the book's 《故事状态.md》 frontmatter and win over global settings.

## Build & Install

```bash
npm install
npm run build        # outputs main.js + manifest.json + styles.css into release/
```

Development mode (watch): `npm run dev`. Tests: `npm test`; lint gate: `npm run lint`.

Manual install: copy `main.js`, `manifest.json`, `styles.css` from `release/` (or from the latest GitHub Release) to `<your vault>/.obsidian/plugins/articlewriter/`, then enable the plugin under "Settings → Community plugins". Reloading the plugin is required after updates.
