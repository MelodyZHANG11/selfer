# Selfer

Local-first desktop app that indexes, searches, tags, edits, and digests AI-coding-tool sessions. v1 supports Claude Code; the adapter layer is built to extend to Copilot CLI, Codex, and OpenCode later.

## What it does

- **Index** every Claude Code session under `~/.claude/projects/` into a local SQLite database with FTS5 full-text search.
- **Browse / search / filter** sessions by project, tag, date, or content.
- **Tag** and **rename** sessions without touching source files.
- **Edit** message content safely via copy-on-write — original JSONL files are never modified.
- **Daily digest** — summarize a day's work into a Markdown file (feeds an Obsidian vault if you point it at one).

All data stays on your machine. Digests default to your local `claude` CLI — no API key needed. Swap providers in Settings:

- **Claude CLI** (default) — spawns `claude -p --bare`. Uses your existing Claude Code auth.
- **Anthropic API** — direct SDK call with your key.
- **OpenAI-compatible** — any `POST /v1/chat/completions` endpoint (lllm, Ollama, LM Studio, etc.).

## Run

Via [just](https://just.systems):

```bash
just install
just dev
```

or plain npm:

```bash
npm install
npm run dev
```

## Other tasks

```bash
just              # list all recipes
just check        # typecheck
just verify       # typecheck + build
just dist         # build .dmg, quit running Selfer, open dmg to drag into /Applications
just reset-index  # wipe local index (after a schema change)
just paths        # show where Selfer keeps state
```

## Where state lives

| Path                               | What                           |
| ---------------------------------- | ------------------------------ |
| `~/.claude/projects/**/*.jsonl`    | Source session files (untouched) |
| `~/.selfer/selfer.db`              | Index + tags + FTS             |
| `~/.selfer/edits/<session-id>/`    | Copy-on-write edits            |
| `~/.selfer/digests/YYYY-MM-DD.md`  | Daily digests (configurable)   |
| `~/.selfer/settings.json`          | API key + digests dir          |

## Safety notes

- **Source files are never modified.** Editing a message copies the JSONL to `~/.selfer/edits/<id>/edited.jsonl` and works from the copy.
- **Live-session guard.** If a source file has been modified within the last 10 minutes, editing is disabled — prevents races with a running `claude` process.
- **Revert** restores the original by deleting the edit directory.

## Architecture

- `src/main/` — Electron main process (Node). Filesystem, SQLite, adapters, IPC handlers, Anthropic SDK calls.
- `src/preload/` — `contextBridge` exposing a typed `window.selfer` API.
- `src/renderer/` — React UI (Tailwind, HashRouter).
- `src/shared/` — Types shared between main and renderer.

### Adding another tool adapter

Implement the shape of `src/main/adapters/claudeCode.ts` (`discover()` + `read()`), wire it into `src/main/indexer.ts`, and add a `ToolName` in `src/shared/types.ts`.
