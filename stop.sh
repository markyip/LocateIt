#!/usr/bin/env bash
grep -q $'\r' "$0" 2>/dev/null && tr -d '\r' < "$0" > "$0.lf" && mv "$0.lf" "$0" && chmod +x "$0" && exec bash "$0" "$@"
set -euo pipefail

PORT="${1:-8765}"

echo "Stopping LocateIt on port ${PORT}..."

# Match stop.bat: prefer localhost listeners on the default LocateIt port.
PIDS=""
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -nP -iTCP:127.0.0.1:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true)
  if [[ -z "$PIDS" ]]; then
    PIDS=$(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true)
  fi
elif command -v ss >/dev/null 2>&1; then
  PIDS=$(
    ss -H -ltnp "sport = :${PORT}" 2>/dev/null \
      | grep '127.0.0.1:' \
      | sed -n 's/.*pid=\([0-9]*\).*/\1/p' \
      | tr '\n' ' '
  )
fi

if [[ -z "$PIDS" ]]; then
  echo "No server listening on 127.0.0.1:${PORT}"
  exit 0
fi

for pid in $PIDS; do
  if [[ -n "$pid" ]]; then
    echo "  Killing PID ${pid}"
    kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  fi
done

echo "Done."
