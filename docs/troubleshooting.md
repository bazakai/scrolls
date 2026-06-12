# Troubleshooting

First step for almost everything:

```bash
curl -s http://127.0.0.1:48642/health
curl -s http://127.0.0.1:48642/stats
tail -50 ~/.claude/scrolls/daemon.log
```

## Search finds nothing / new sessions aren't indexed

1. `curl -s http://127.0.0.1:48642/stats` - if `chunks` is 0 or tiny, you haven't backfilled: `curl -X POST http://127.0.0.1:48642/backfill`.
2. If `health` fails, the daemon isn't running - start a new Claude Code session (the `SessionStart` hook starts it) or run `hooks/ensure-daemon.sh` directly.
3. Check the hooks are registered: `/hooks` in Claude Code should show the scrolls entries (or your plugin enabled in `/plugin`). Hooks only fire in sessions started *after* the plugin was enabled.
4. Searches in an already-open session use that session's MCP server snapshot of tool wiring; brand-new content appears as it's indexed, but config changes need a new session.

## Daemon won't start

- `tail -50 ~/.claude/scrolls/daemon.log` - the reason is almost always there.
- **Port in use:** something else owns 48642. Set `SCROLLS_PORT` (remember to set it for hooks, daemon, and MCP server alike).
- **Stale start lock:** a lock dir older than 2 minutes is reclaimed automatically; if you see repeated "another invocation is starting" behavior with no daemon, `rmdir ~/.claude/scrolls/start.lock.d` and retry.
- **Native module errors** (`Could not locate the bindings file`, `ERR_DLOPEN_FAILED`): the install didn't build `better-sqlite3`. In the install dir run `npm rebuild better-sqlite3` (npm) - or with pnpm, ensure `pnpm-workspace.yaml` allows the build (`allowBuilds`) and run `pnpm rebuild better-sqlite3 onnxruntime-node`.

## First run / model download problems

- The model (~90MB) downloads from `huggingface.co` on the first embedding. Behind a proxy or offline, that fails; the daemon logs `model load error`. Connect once, or copy `node_modules/@huggingface/transformers/.cache/` from another machine.
- Plugin first-run bootstrap (`npm install`) failed: see `~/.claude/scrolls/daemon.log`. It retries on the next session start; the usual cause is missing build tools for `better-sqlite3` (on macOS: `xcode-select --install`).

## Index problems

Any suspicion of a corrupt or inconsistent index has one clean fix - rebuild from source transcripts (they are never modified, so this is always safe):

```bash
kill "$(cat ~/.claude/scrolls/daemon.pid)"
rm ~/.claude/scrolls/index.db*
./hooks/ensure-daemon.sh        # startup sweep reindexes everything
```

Expect a full rebuild of ~10k sessions to take tens of minutes of background CPU.

## "It's slow" / high resource usage

- Indexing bursts are normal after a big backfill; idle CPU should be ~0. Check `queueDepth` in `/health`.
- Each Claude session's MCP server stays at ~50MB RAM until the first search (the model loads lazily). If you run very many parallel sessions and search in all of them, expect ~200-300MB per searching session.
- Hooks are `async` with a 5s timeout and a 2s curl cap - they cannot block your prompt even when the daemon is down.
