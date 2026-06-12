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

if [ -f "$PID_FILE" ] && kill "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "daemon stopped (pid $(cat "$PID_FILE"))"
else
  pkill -f "scrolls.*dist/daemon.js" 2>/dev/null && echo "daemon stopped (by name)" \
    || echo "daemon not running"
fi

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
