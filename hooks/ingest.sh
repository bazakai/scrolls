#!/usr/bin/env bash
PORT="${SCROLLS_PORT:-48642}"
exec curl -s -m 2 -X POST "http://127.0.0.1:$PORT/ingest" \
  -H 'Content-Type: application/json' \
  --data-binary @- >/dev/null 2>&1 || true
