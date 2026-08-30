# ArticleWriter for Obsidian

> Chinese version: [README.md](./README.md)

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
