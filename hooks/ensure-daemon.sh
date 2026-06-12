#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT="${SCROLLS_PORT:-48642}"
STATE_DIR="${SCROLLS_DIR:-$HOME/.claude/scrolls}"
LOG_FILE="$STATE_DIR/daemon.log"
LOCK_DIR="$STATE_DIR/start.lock.d"
INSTALLING_SENTINEL="$PROJECT_DIR/.scrolls-installing"

mkdir -p "$STATE_DIR"

deps_ready() {
  [ -d "$PROJECT_DIR/node_modules" ] && [ ! -f "$INSTALLING_SENTINEL" ]
}

daemon_healthy() {
  curl -s -m 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1
}

# Fast path. Deps must be checked even when the daemon is healthy: the MCP
# server runs from THIS directory too, and a fresh plugin install/update ships
# no node_modules while a daemon from another install may already be running.
if deps_ready && daemon_healthy; then
  exit 0
fi

# Reclaim a stale lock: a holder killed before its EXIT trap (kill -9, power
# loss) leaves the dir behind and would otherwise block every future start.
# 10 min covers a slow first-run npm install.
if [ -d "$LOCK_DIR" ] && [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
  rmdir "$LOCK_DIR" 2>/dev/null || true
fi

# Serialize concurrent attempts via a lock dir created atomically with mkdir
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Another invocation is bootstrapping/starting; let it finish
  sleep 2
  exit 0
fi
# shellcheck disable=SC2064
trap "rmdir '$LOCK_DIR' 2>/dev/null || true" EXIT

# First-run bootstrap: plugin installs ship dist/ but not node_modules.
# An existing node_modules (e.g. a dev checkout installed with pnpm) is left
# alone; the in-progress sentinel only retries installs THIS script started
# and that died midway.
if ! deps_ready; then
  echo "$(date -u +%FT%TZ) installing dependencies (first run)..." >>"$LOG_FILE"
  touch "$INSTALLING_SENTINEL"
  if (cd "$PROJECT_DIR" && npm install --no-audit --no-fund >>"$LOG_FILE" 2>&1); then
    rm -f "$INSTALLING_SENTINEL"
  else
    echo "$(date -u +%FT%TZ) dependency install failed — see above" >>"$LOG_FILE"
    exit 0
  fi
fi

# Prune superseded plugin versions: each carries its own node_modules + model
# cache (~500MB). Only lower versions, and only after 2 days — sessions started
# before an update may still run the previous version's MCP server.
case "$PROJECT_DIR" in
  "$HOME/.claude/plugins/cache/"*)
    CURRENT_VERSION="$(basename "$PROJECT_DIR")"
    for sibling in "$(dirname "$PROJECT_DIR")"/*/; do
      sibling="${sibling%/}"
      SIB_VERSION="$(basename "$sibling")"
      [ "$SIB_VERSION" = "$CURRENT_VERSION" ] && continue
      newest="$(printf '%s\n%s\n' "$SIB_VERSION" "$CURRENT_VERSION" | sort -V | tail -1)"
      if [ "$newest" = "$CURRENT_VERSION" ] && [ -z "$(find "$sibling" -maxdepth 0 -mtime -2 2>/dev/null)" ]; then
        echo "$(date -u +%FT%TZ) pruning superseded plugin version $SIB_VERSION" >>"$LOG_FILE"
        rm -rf "$sibling"
      fi
    done
    ;;
esac

if daemon_healthy; then
  exit 0
fi

nohup node "$PROJECT_DIR/dist/daemon.js" >>"$LOG_FILE" 2>&1 &

exit 0
