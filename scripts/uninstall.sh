#!/usr/bin/env bash
# Stops the scrolls daemon and (optionally) removes all local data.
# Usage:
#   ./scripts/uninstall.sh               # stop daemon, keep index/logs
#   ./scripts/uninstall.sh --purge-data  # stop daemon, delete ~/.claude/scrolls
#
# Run this BEFORE `claude plugin uninstall` so the script is still on disk.
# (If you forgot: the daemon also detects its install dir is gone and exits
# on its own within a minute; data removal is then just `rm -rf ~/.claude/scrolls`.)
set -uo pipefail

STATE_DIR="${SCROLLS_DIR:-$HOME/.claude/scrolls}"
PORT="${SCROLLS_PORT:-48642}"
PID_FILE="$STATE_DIR/daemon.pid"

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

if [ "${1:-}" = "--purge-data" ]; then
  rm -rf "$STATE_DIR"
  echo "removed $STATE_DIR (index, logs, pid/lock files)"
else
  echo "kept $STATE_DIR — pass --purge-data to delete the index and logs"
fi

cat <<'EOF'

To finish removal:
  claude plugin uninstall scrolls@scrolls
  claude plugin marketplace remove scrolls

(Plugin removal deletes the install dir including node_modules and the
embedding-model cache. Your transcripts in ~/.claude/projects/ are untouched —
scrolls never modifies them.)
EOF
