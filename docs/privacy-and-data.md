# Privacy and data

## The one-paragraph answer

Everything stays on your machine. scrolls makes no LLM calls, has no telemetry, no sync, no accounts, and no network access except a one-time embedding-model download from HuggingFace. The trade you're making is local: the index is a **second, unencrypted copy of your transcripts**, and you should treat it with exactly the sensitivity of the transcripts themselves.

## What is stored, field by field

Each indexed chunk in `chunks`:

| Field | Content |
|-------|---------|
| `text` | the chunk itself: user/assistant text, tool name + input (800 chars), or tool result (1,200 chars) |
| `session_id`, `uuid`, `seq`, `source`, `is_sidechain` | position within the conversation |
| `project`, `cwd` | which project folder and working directory it came from |
| `ts`, `kind` | timestamp and message kind |

Plus `vec_chunks` (the 384-dim embedding of each chunk), `chunks_fts` (the full-text index over the same text), and `files` (per-transcript byte offsets). Thinking blocks are never stored.

## Where everything lives

| Artifact | Path |
|----------|------|
| Index database | `~/.claude/scrolls/index.db` (+ `-wal`, `-shm`) |
| Daemon log | `~/.claude/scrolls/daemon.log` |
| PID / lock files | `~/.claude/scrolls/daemon.pid`, `start.lock.d` |
| Embedding model cache | `node_modules/@huggingface/transformers/.cache/` inside the install dir |
| Source transcripts (Claude Code's own, not ours) | `~/.claude/projects/` |

Override the state directory with `SCROLLS_DIR`.

## What leaves your machine

Nothing, with one bounded exception: the first embedding triggers a model download from `huggingface.co` (~90MB, no auth, standard transformers.js flow). After that, scrolls runs fully offline. There is no telemetry of any kind - you can verify this in about two minutes of reading: the codebase contains exactly one outbound-capable component (the model loader) and ~1,700 lines total.

## Secrets

Be clear-eyed about this: **if a secret was ever printed in a tool result, it is in your transcripts, and therefore it is in this index too.** scrolls does not currently scrub or redact content, and there are no exclusion filters yet (per-path ignores and pattern redaction are on the roadmap). Your controls today:

- `SCROLLS_PROJECTS_DIR` - index a narrower transcripts root.
- Delete and rebuild - remove `~/.claude/scrolls/index.db*`, restart the daemon, and backfill only what you want.
- Exclude `~/.claude/scrolls/` (and `~/.claude/projects/`) from backups, sync clients, and anything else you wouldn't want a secret to reach.

## Inspecting, exporting, deleting

It's one SQLite file - use any SQLite client:

```bash
sqlite3 ~/.claude/scrolls/index.db "SELECT count(*) FROM chunks"
sqlite3 ~/.claude/scrolls/index.db "SELECT text FROM chunks WHERE session_id='...' ORDER BY seq"
```

Delete everything: stop the daemon, `rm ~/.claude/scrolls/index.db*`. The source transcripts in `~/.claude/projects/` are Claude Code's and are never modified by scrolls (the entire codebase opens them read-only).
