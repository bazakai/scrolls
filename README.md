# scrolls

**Search every Claude Code session you've ever had.** Real hybrid retrieval — neural embeddings fused with BM25 full-text — over your raw transcripts. Local, free, and private: no API bills, no cloud, nothing leaves your machine. Install the plugin and every session can search every past session.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE) ![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)

*Why this and not claude-mem / episodic-memory / native memory — and why you might NOT want it: [docs/why-scrolls.md](docs/why-scrolls.md)*

```
"where did we debug that SQLITE_BUSY error?"          → the exact session, three weeks ago
"what did we decide about the retry queue?"           → the actual conversation, verbatim
"find the session where we built the eval pipeline"   → session ID, resumable
```

## Quick Start

```
/plugin marketplace add bazakai/scrolls
/plugin install scrolls@scrolls
```

On the first session start after install, the bootstrap hook installs dependencies (native builds, a couple of minutes, once) and starts the indexing daemon. Then index your existing history:

```bash
curl -X POST http://127.0.0.1:48642/backfill
```

That's it. Ask Claude things like *"search my past sessions for the cookie-banner fix"* and it will call the `search_sessions` tool.

## Requirements — what you actually need

| | |
|---|---|
| OS / runtime | macOS or Linux, Node.js >= 20, `bash` + `curl` (hooks) |
| GPU | **not needed** — embeddings run on CPU, and this workload is not compute-bound |
| Python / Ollama / MLX / Docker | **not needed** — the model runs in-process via ONNX ([details](docs/models-and-runtime.md)) |
| API keys / accounts | **none** — scrolls never calls an LLM or any service |
| Network | one-time ~90MB model download from HuggingFace on first run; fully offline after |
| Disk | ~500MB for dependencies + model, plus ~50-60MB of index per 1,000 sessions |
| Build tools | `better-sqlite3` compiles natively on install (macOS: Xcode Command Line Tools) |

The embedding model (`Xenova/all-MiniLM-L6-v2`, 384-dim) downloads automatically into the install's local cache on first use — no setup, no model registry, no separate inference server. Exactly what runs where: [docs/models-and-runtime.md](docs/models-and-runtime.md).

## How it works

```
Claude Code session
      │
      ▼ hooks: SessionStart → UserPromptSubmit → PostToolUse → Stop
hooks/ingest.sh  ──POST /ingest──▶  daemon (localhost:48642)
                                          │
                                    debounce 1.5s → serial queue
                                          │
                                    read new JSONL lines
                                    (incremental, byte-offset tracked)
                                          │
                                    embed locally (MiniLM, 384-dim, CPU)
                                          │
                                    SQLite: chunks + vec_chunks + chunks_fts
                                          │
                              MCP server (stdio, read-only, per session)
                                          │
                            hybrid search: vector KNN + FTS5/BM25
                              → weighted reciprocal rank fusion
                              → relevance floor (no junk results)
```

Two processes, deliberately separate:

- **Daemon** — one long-lived background process, the only writer. Started lazily by the `SessionStart` hook (no launchd/systemd; it survives reboots because the next session start brings it back). On startup it runs an idempotent backfill sweep, so anything written while it was down is caught up.
- **MCP server** — one per Claude session, spawned and managed by Claude Code. Opens the database read-only and serves search. Works even when the daemon is down. The embedding model loads lazily on the first search, so idle sessions cost nothing.

Everything runs on your machine. The embedding model (~25MB ONNX) is downloaded once from HuggingFace and runs on CPU — fast enough to backfill 150k chunks in minutes, because this workload is not compute-bound.

## MCP tools

Three tools, by design — one search verb you call repeatedly with different queries and filters, one drill-down, one status check:

- **search_sessions** — hybrid search with filters: `project`, `kind` (user/assistant/tool_use/tool_result), `after`/`before` timestamps, `exact` substring, and `relevance` or `recent` ordering. Returns `{results: [...]}`; an empty array means nothing cleared the relevance floor — reformulate instead of trusting weak hits.
- **get_session_window** — the surrounding conversation around a search hit (anchored by uuid or timestamp).
- **index_status** — index counts, DB path, daemon health.

## Manual install (without the plugin system)

```bash
git clone https://github.com/bazakai/scrolls && cd scrolls
npm install && npm run build
claude mcp add --scope user scrolls -- node "$(pwd)/dist/mcp-server.js"
```

Then add the four hooks to `~/.claude/settings.json` (replace the path with your clone):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "/path/to/scrolls/hooks/ensure-daemon.sh", "timeout": 600 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "/path/to/scrolls/hooks/ingest.sh", "timeout": 5, "async": true }] }
    ],
    "PostToolUse": [
      { "hooks": [{ "type": "command", "command": "/path/to/scrolls/hooks/ingest.sh", "timeout": 5, "async": true }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "/path/to/scrolls/hooks/ingest.sh", "timeout": 5, "async": true }] }
    ]
  }
}
```

Backfill: `npm run backfill` (everything) or `npm run backfill -- --project=<folder-name>`.

## Configuration

All optional, via environment variables:

| Variable                 | Default                    | Description                          |
| ------------------------ | -------------------------- | ------------------------------------ |
| `SCROLLS_PORT`           | `48642`                    | Daemon HTTP port (localhost-only)    |
| `SCROLLS_DIR`            | `~/.claude/scrolls`        | Index DB, logs, pid/lock files       |
| `SCROLLS_PROJECTS_DIR`   | `~/.claude/projects`       | Transcripts root to index            |
| `SCROLLS_MODEL`          | `Xenova/all-MiniLM-L6-v2`  | Embedding model (transformers.js)    |
| `SCROLLS_DIMS`           | `384`                      | Embedding dimensions of the model    |
| `SCROLLS_RELEVANCE_FLOOR`| `1.15`                     | Cosine-distance cutoff for results   |
| `SCROLLS_CANDIDATE_LIMIT`| `40`                       | Retrieval depth per search branch    |
| `SCROLLS_RRF_K`          | `60`                       | Reciprocal rank fusion constant      |

The daemon binds to `127.0.0.1` only, rejects requests carrying an `Origin`/`Referer` header (CSRF/DNS-rebinding hardening), and only ingests `.jsonl` paths that resolve inside the projects directory.

## Privacy

Local-only, by construction: no LLM calls, no telemetry, nothing leaves your machine. But understand what the index is — a second, long-lived, unencrypted copy of your transcripts: prompts, replies, tool inputs, tool outputs. If a secret ever appeared in a tool result, it is in this database too. Treat `~/.claude/scrolls/` with exactly the sensitivity of `~/.claude/projects/`, and exclude both from backups you wouldn't want to leak.

## Works alongside Claude Code's built-in memory

Native memory keeps a small set of curated notes (CLAUDE.md, auto-memory) that Claude reads at session start. scrolls is the opposite end: it indexes your raw, complete history and searches it on demand. Notes are the cache; scrolls is the searchable archive behind it. Use native memory for "what should always be true"; use scrolls for "where did we figure out X, three weeks ago, in that other repo".

## Related projects

- **[episodic-memory](https://github.com/obra/episodic-memory)** — the closest sibling: same local-first philosophy, same embedding foundation, also a Claude Code plugin (plus Codex support). Two differences shaped scrolls: episodic-memory's keyword search is SQLite `LIKE`, where scrolls uses FTS5/BM25 fused with vectors via reciprocal rank fusion; and episodic-memory can run a Claude Haiku summarization pass, where scrolls never calls an LLM. If you want summaries-as-memory or you're in the superpowers ecosystem, it's a great fit. If you want pure retrieval with zero token cost, that's scrolls.
- **[memex](https://github.com/nicosuave/memex)** — Rust, BM25 + optional embeddings, TUI-first. Excellent standalone tool; not a Claude Code plugin, so it doesn't plug into the in-session MCP flow.
- **[claude-mem](https://github.com/thedotmack/claude-mem)** — a different philosophy: LLM-compresses your history into memory. Powerful, but spends tokens on every consolidation. scrolls deliberately does not.
- **[graphify](https://github.com/safishamsi/graphify)** — a different axis: maps your *project* (code, docs, media) into a queryable knowledge graph. scrolls maps your *conversations*. They compose well.

## Documentation

| Doc | Answers |
|-----|---------|
| [why-scrolls.md](docs/why-scrolls.md) | the pitch, the honest anti-pitch, comparisons, "choose X if" |
| [how-it-works.md](docs/how-it-works.md) | architecture, what gets captured, hybrid search + relevance floor explained |
| [models-and-runtime.md](docs/models-and-runtime.md) | what downloads when, where it's cached, CPU vs GPU vs MLX, offline use, swapping models |
| [the-daemon.md](docs/the-daemon.md) | what the background process does, lifecycle, port, resource usage, how to stop it |
| [privacy-and-data.md](docs/privacy-and-data.md) | what's stored field-by-field, where it lives, what leaves your machine (nothing), secrets |
| [troubleshooting.md](docs/troubleshooting.md) | not indexing, daemon issues, model download failures, index rebuild |
| [uninstall.md](docs/uninstall.md) | complete removal, every path, per install method |

## Known constraints

- **Embedding window** — MiniLM embeds ~256 tokens; chunks are up to 1,500 chars, so the tail of large chunks is reachable via full-text search but not semantic search. A drop-in model upgrade (same 384 dims) is the planned v1.1.
- **No content-exclusion filters yet** — you can't mark a repo or pattern as "never index" (roadmap). See [privacy-and-data.md](docs/privacy-and-data.md).
- **Claude Code only** — no Codex or other-harness support yet.
- **Storage** — roughly 50-60MB per 1,000 sessions, no retention policy; delete `index.db*` and re-backfill to rebuild.

## License

Apache-2.0 © Bazak AI
