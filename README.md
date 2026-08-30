# ArticleWriter for Obsidian

> Chinese version: [README_ZN.md](./README_ZN.md)

## ⚠️ Disclosures & Security Statement

**Network requests.** This plugin performs no network activity except LLM chat. All outbound traffic goes exclusively through the official `openai` SDK to the OpenAI-compatible endpoint **that you configure yourself in settings** (a local server such as Ollama / LM Studio / llama.cpp, or a provider API like DeepSeek or Qwen DashScope). At runtime only two kinds of requests are ever triggered — non-streaming and streaming chat completions; any additional request-related call sites flagged by scanners belong to the bundled SDK's generic HTTP layer and are not used elsewhere by this plugin. There is **no telemetry, no analytics, no update checking, and no connection to any author-operated server**. Your API key is entered by you in the settings panel, stored locally inside your vault with the rest of the plugin settings, and transmitted only as an authentication header to the endpoint you chose; when left empty (the normal case for local servers), no credential is sent at all.

**Base64 usage (`atob` / `btoa`).** The plugin's own source code contains **zero** base64 encode/decode calls. Every occurrence present in the shipped bundle originates from third-party libraries that esbuild bundles: the `yaml` parser (its standard handler for YAML `!!binary` tags) and the `openai` SDK (generic base64 ↔ binary-buffer conversion helpers). They perform ordinary data-format conversions and are **not** used to obfuscate API keys, hide URLs, or mask code payloads. Nothing in the build is minified or obfuscated — the complete human-readable source is published in [the repository](https://github.com/gengbl/articlewriter-obsidian); please audit it directly if you have concerns.

### 3. Vault Enumeration Disclosure
This plugin inspects file structures inside your vault through Obsidian's standard `app.vault` APIs, in exactly two scopes:
* **Purpose — vault-wide *path* listing (two small UI pickers):** (a) the folder picker shown on first use / when switching the working directory (`work_dir`) lists existing folders so you can fuzzy-search where your manuscripts live; this walk starts at the vault root but is deliberately bounded — it descends only **3 levels deep**, stops after **500 entries**, and skips hidden directories such as `.obsidian/`; (b) the dockable chat panel's @reference candidate list calls `vault.getFiles()` when rendering so that *any* document in your vault can be quoted into an LLM prompt with one keystroke. Both list **paths only** — no content is read at either point. A file's text is loaded only after you act on it: picking a folder merely sets the scope for later local operations, and referencing a file adds its content to the explicit request sent to the model endpoint you configured yourself (see §1 above).
* **Purpose — working-directory-scoped operations:** Everything else (building the story status tree, listing volumes/chapters, counting words per chapter/book, and loading outline / world-building / character / scene documents into writing prompts) operates exclusively inside the work folder **you select on first use** (`work_dir`). Files outside that folder are never opened or scanned by these features.
* **Privacy Assurance:** All enumeration runs entirely locally and in-memory on your machine. File paths and contents are processed strictly on-device and are **never** uploaded, indexed remotely, leaked, or shared with any external server — except for the deliberate LLM requests described in §1 that you trigger yourself.

## Overview

ArticleWriter turns your vault into an AI-assisted novel workshop. It organizes each story as a folder of plain Markdown files (state doc, outline, world-building, characters, scenes, foreshadowing notes and one folder per chapter) and adds LLM-powered writing commands on top: write / continue / rewrite / polish chapters, strip AI-sounding phrasing, review from a global perspective, plus a dockable chat panel that can quote any vault file via @references. All data stays local; no external services are required beyond the OpenAI-compatible model endpoint you configure yourself.

It is the Obsidian port of the `articlewriter` Python CLI. Nothing depends on external services — every operation works on the Markdown documents inside your vault through Obsidian's built-in Vault / Workspace APIs. **The sync feature was not ported.**

## Data Layout (identical to the Python version)

```
<novel root>/<book title>/
├── 故事状态.md              # Obsidian "file properties" style: YAML frontmatter holds the version-2 runtime state (title/genre/current volume·scene·chapter/per-chapter metadata); body is free-form notes; legacy story_state.json is auto-migrated with a backup in _backup/ on first save
├── WRITING_GUIDE.md         # User-level writing guide (moved here from ~/.articlewriter/)
├── 大纲.md                  # Master outline
├── 世界观.md                # World-building template
├── 卷.md                    # Volumes (grouping container)
├── 伏笔.md                  # Foreshadowing log
├── 笔记.md                  # Notes
└── 第NN章-<标题>/           # One folder per chapter
    ├── 章节.md              # Chapter body
    ├── 章节大纲.md          # Chapter outline
    ├── 人物.md              # Characters
    ├── 人物关系.md          # Character relations
    ├── 场景.md              # Scenes
    └── 章节信息.md          # Chapter info
```

Missing documents are auto-created as "HTML comment example" templates when creating a new book/chapter; existing files are skipped and never overwrite user content. All file names are normalized through `safeFilename()` (mirrors `fsutil.safe_filename`).

## Commands

Search the command palette for "ArticleWriter" or the Chinese description.

| Command | CLI equivalent | Implementation notes |
| --- | --- | --- |
| Create new story | `/new` | `vault.createFolder` + `vault.create` build the book folder and all template docs, then write the state doc |
| New chapter | `/chapter add` | Creates the `第NN章-title/` directory with its 6 documents and updates the current chapter |
| Chapter list | `/chapter list` / `/open` | Scans chapter folders; picking one opens its body via `workspace.getLeaf("tab").openFile` and sets it as the current chapter |
| Open outline / world-building / foreshadowing / notes | `/outline show`, etc. | Created from template first if missing, then opened |
| Next / previous chapter | `/chapter next` / `prev` | With no current chapter: next → first, prev → last; at a boundary a notice is shown without switching |
| Word count of current chapter / whole book | `/count` | Counts pure text characters only (ported `count_pure_words`: excludes punctuation/symbols/whitespace) |
| Save current chapter | `/save` | Reads the focused editor's content and force-flushes it to disk via `vault.modify` |
| Story status | `/status` | Shows title / genre / current chapter / chapter count / total word count |
| View / edit writing guide | `/agents view` / `edit` | Three tiers: story-level `<book>/WRITING_GUIDE.md` > user-level file of the same name under work_dir > system level (by default stored in plugin settings data.json with the CLI built-in content preset; the Settings page can point `system_guide_path` at your own guide file inside the vault to override). Multiple tiers open a picker; viewing the system tier shows a read-only panel; editing saves the full text for the chosen tier |
| LLM connection test | `/llm test` | Uses the openai SDK against any OpenAI-compatible endpoint (DeepSeek/DashScope/Ollama/LM Studio/llama.cpp…); verifies the active config via GET /models |
| LLM chat window | — (plugin addition) | **Persistent dockable panel** (custom view, draggable into any workspace area, position survives reloads; message icon in the sidebar as quick entry): multi-turn streaming chat, Enter sends / Shift+Enter newline, dropdown on top switches saved model configs, "Stop generating" only interrupts the current turn; every turn automatically carries a chat-specific prompt (friendly-assistant identity + writing guide + snapshot of the current story context, consistent with the CLI's `/llm` Q&A behavior), the current story·chapter is shown on top, history is not persisted |
| Work status panel | — (plugin addition) | **Persistent dockable panel** (book icon in the sidebar as quick entry): work directory, list of all stories (click to switch the current book), genre / writing type / total word count / update time of the current story, chapter list (activating a chapter also syncs its volume), global docs and per-chapter files (click opens them in the editor); story/chapter/file lists all support folder-like expand/collapse (title row or the arrow before a chapter); **right-clicking** a story/chapter/file row shows a shortcut menu: create/delete story, create/delete chapter, create an article .md at the book root or inside a chapter dir / delete file (all destructive actions require a second confirmation; deletions go to the Obsidian trash so they are recoverable); manual reload via "Refresh" at the top right |
| LLM model configuration | (replaces `~/.articlewriter/config.json`) | Obsidian Settings → ArticleWriter, stored in the plugin data directory `.obsidian/plugins/articlewriter/data.json` (first run presets three standard templates local/deepseek/qwen-dashscope awaiting api_key/model name) |

## Workflow (work_dir)

1. The first time you use any ArticleWriter command, a **work directory picker** pops up automatically — choose an existing vault folder as your `work_dir` for novel writing (mirrors the CLI's `--work_dir` / `/dir`).
2. From then on, **creating stories, creating chapters, opening documents, switching chapters, word counts — everything operates under work_dir**; each story is one subfolder of work_dir.
3. To change directories, use the "Select work directory" command or the "Re-select…" button on the settings page (switching clears the remembered last story, same behavior as CLI `/dir`).
4. With multiple books, commands show a story picker and remember your last choice.

## Settings

- **Work directory (work_dir)**: the folder where novels live; initialized by the automatic picker on first use, can be changed/re-selected manually.
- **Auto-open document after creation**: opens `大纲.md` when a book is created, `章节.md` when a chapter is created.

## Build & Install

```bash
npm install
npm run build        # outputs main.js + manifest.json + styles.css (+ WRITING_GUIDE.md) into release/
```

Development mode (watch): `npm run dev`.

Manual install: copy `main.js`, `manifest.json`, `styles.css` and `WRITING_GUIDE.md` from `release/` to `<your vault>/.obsidian/plugins/articlewriter/`, then enable the plugin in Obsidian under "Settings → Community plugins".
