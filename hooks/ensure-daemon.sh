#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT="${SCROLLS_PORT:-48642}"
STATE_DIR="${SCROLLS_DIR:-$HOME/.claude/scrolls}"
LOG_FILE="$STATE_DIR/daemon.log"
LOCK_DIR="$STATE_DIR/start.lock.d"

mkdir -p "$STATE_DIR"

# Fast path: daemon already healthy
if curl -s -m 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  exit 0
fi

# Reclaim a stale lock: a start attempt killed before its EXIT trap (kill -9,
# power loss) leaves the dir behind and would otherwise block every future start.
if [ -d "$LOCK_DIR" ] && [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +2 2>/dev/null)" ]; then
  rmdir "$LOCK_DIR" 2>/dev/null || true
fi

# Serialize concurrent start attempts via a lock dir created atomically with mkdir
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Another invocation is starting the daemon; wait briefly and exit
  sleep 2
  exit 0
fi
# shellcheck disable=SC2064
trap "rmdir '$LOCK_DIR' 2>/dev/null || true" EXIT

# Re-check after acquiring lock
if curl -s -m 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  exit 0
fi

# First-run bootstrap: plugin installs ship dist/ but not node_modules.
# An existing node_modules (e.g. a dev checkout installed with pnpm) is left
# alone; the in-progress sentinel only retries installs THIS script started
# and that died midway.
INSTALLING_SENTINEL="$PROJECT_DIR/.scrolls-installing"
if [ ! -d "$PROJECT_DIR/node_modules" ] || [ -f "$INSTALLING_SENTINEL" ]; then
  echo "$(date -u +%FT%TZ) installing dependencies (first run)..." >>"$LOG_FILE"
  touch "$INSTALLING_SENTINEL"
  if (cd "$PROJECT_DIR" && npm install --no-audit --no-fund >>"$LOG_FILE" 2>&1); then
    rm -f "$INSTALLING_SENTINEL"
  else
    echo "$(date -u +%FT%TZ) dependency install failed — see above" >>"$LOG_FILE"
    exit 0
  fi
fi

nohup node "$PROJECT_DIR/dist/daemon.js" >>"$LOG_FILE" 2>&1 &

exit 0
