# The daemon

scrolls runs one background process per machine. This page is everything a skeptical user should want to know about it.

## What it actually does

Four jobs, nothing else:

1. Receives "this transcript changed" pings from the hooks (`POST /ingest`) and indexes the new bytes after a 1.5s debounce.
2. Runs an idempotent catch-up sweep over all transcripts at startup (recovers anything written while it was down).
3. Serves `GET /health` and `GET /stats` so you (and the MCP `index_status` tool) can see what it's doing.
4. Accepts `POST /backfill` to index history on demand.

It is the **only writer** to the index. It never reads anything outside your transcripts directory, never makes network requests (the one-time model download happens through the local HuggingFace cache, see [models-and-runtime.md](models-and-runtime.md)), and has no telemetry.

## Lifecycle

- **Start:** lazily, by the `SessionStart` hook (`ensure-daemon.sh`). The hook health-checks first and is a no-op when the daemon is already up - sub-second on every session start after the first.
- **No boot persistence by design:** there's no launchd/systemd unit. After a reboot the daemon is simply started by your next Claude Code session, and its startup sweep closes the gap.
- **Stop:** `kill $(cat ~/.claude/scrolls/daemon.pid)` (or `scripts/uninstall.sh`). It stays down until the next session start. To stop it permanently, disable/uninstall the plugin (see [uninstall.md](uninstall.md)).
- **Uninstall awareness:** the daemon checks once a minute that its own install directory still exists; if you delete the plugin or the clone, it shuts itself down within a minute instead of running orphaned.
- **Crash safety:** all writes are transactional (SQLite WAL); a killed daemon can't corrupt the index. Concurrent start attempts are serialized with a lock that self-heals if a previous attempt died mid-start.

## Surface area

| Thing | Value |
|-------|-------|
| Bind address | `127.0.0.1` only - never reachable from the network |
| Port | `48642` (override: `SCROLLS_PORT`) |
| PID file | `~/.claude/scrolls/daemon.pid` |
| Log | `~/.claude/scrolls/daemon.log` |
| Start lock | `~/.claude/scrolls/start.lock.d` |

Hardening: requests carrying an `Origin` or `Referer` header are rejected (a browser can't make your daemon do anything via CSRF/DNS-rebinding), and `/ingest` only accepts `.jsonl` paths that resolve inside the transcripts directory, so no other local process can trick it into reading arbitrary files into the index.

## Resource usage

- **RAM:** ~200-300MB RSS once the embedding model is loaded.
- **CPU:** bursts during indexing (seconds per session's worth of new content), effectively zero at idle.
- **Disk:** the index grows ~50-60MB per 1,000 sessions.

## Verifying it's healthy

```bash
curl -s http://127.0.0.1:48642/health   # {"ok":true,"queueDepth":0,"model":"loaded"}
curl -s http://127.0.0.1:48642/stats    # counts, last index time, error count
```

Or ask Claude to call the `index_status` tool, which includes a daemon reachability check.
