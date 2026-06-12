#!/usr/bin/env bash
# Stops the scrolls daemon and (optionally) removes local data and plugin caches.
# Usage:
#   ./scripts/uninstall.sh                       # stop daemon, keep everything else
#   ./scripts/uninstall.sh --purge-data          # also delete ~/.claude/scrolls (index, logs)
#   ./scripts/uninstall.sh --purge-cache         # also delete ~/.claude/plugins/cache/scrolls
#   ./scripts/uninstall.sh --purge-data --purge-cache   # full cleanup
#
# Note: `claude plugin uninstall` only UNREGISTERS the plugin — it does not
# delete the cached install tree (which holds node_modules and the embedding
# model, ~500MB per version). --purge-cache is how that actually gets removed.
set -uo pipefail

STATE_DIR="${SCROLLS_DIR:-$HOME/.claude/scrolls}"
PORT="${SCROLLS_PORT:-48642}"
PID_FILE="$STATE_DIR/daemon.pid"
PLUGIN_CACHE="$HOME/.claude/plugins/cache/scrolls"

PURGE_DATA=""
PURGE_CACHE=""
for arg in "$@"; do
  case "$arg" in
    --purge-data) PURGE_DATA=1 ;;
    --purge-cache) PURGE_CACHE=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# Stop ONLY this instance's daemon: pid file first, then the listener on OUR
# port (verified to be a scrolls daemon). Never match by process name alone —
# that would kill unrelated scrolls daemons (other state dirs/ports).
stopped=""
if [ -f "$PID_FILE" ] && kill "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "daemon stopped (pid $(cat "$PID_FILE"))"
  stopped=1
else
  pid="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -1)"
  if [ -n "$pid" ] && ps -o command= -p "$pid" 2>/dev/null | grep -q "dist/daemon.js"; then
    kill "$pid" 2>/dev/null && echo "daemon stopped (pid $pid, via port $PORT)"
    stopped=1
  fi
fi
[ -z "$stopped" ] && echo "daemon not running"

if [ -n "$PURGE_DATA" ]; then
  rm -rf "$STATE_DIR"
  echo "removed $STATE_DIR (index, logs, pid/lock files)"
else
  echo "kept $STATE_DIR — pass --purge-data to delete the index and logs"
fi

if [ -n "$PURGE_CACHE" ]; then
  rm -rf "$PLUGIN_CACHE"
  echo "removed $PLUGIN_CACHE (all cached plugin versions, node_modules, model cache)"
elif [ -d "$PLUGIN_CACHE" ]; then
  echo "kept $PLUGIN_CACHE ($(du -sh "$PLUGIN_CACHE" 2>/dev/null | cut -f1)) — Claude Code does NOT delete this on plugin uninstall; pass --purge-cache to remove it"
fi

cat <<'EOF'

To finish removal:
  claude plugin uninstall scrolls@scrolls
  claude plugin marketplace remove scrolls

(Your transcripts in ~/.claude/projects/ are untouched — scrolls never
modifies them. Any daemon left behind also self-terminates within a minute
of its install directory being deleted.)
EOF
