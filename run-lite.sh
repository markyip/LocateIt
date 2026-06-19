#!/usr/bin/env bash
grep -q $'\r' "$0" 2>/dev/null && tr -d '\r' < "$0" > "$0.lf" && mv "$0.lf" "$0" && chmod +x "$0" && exec bash "$0" "$@"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
[ -f "$ROOT/stop.sh" ] && grep -q $'\r' "$ROOT/stop.sh" 2>/dev/null && tr -d '\r' < "$ROOT/stop.sh" > "$ROOT/stop.sh.lf" && mv "$ROOT/stop.sh.lf" "$ROOT/stop.sh" && chmod +x "$ROOT/stop.sh"
cd "$ROOT"

echo "Checking for an existing LocateIt server..."
bash "$ROOT/stop.sh" || true
sleep 0.2
if command -v lsof >/dev/null 2>&1; then
  STALE_PIDS=$(lsof -nP -iTCP:127.0.0.1:8765 -sTCP:LISTEN -t 2>/dev/null || true)
  if [[ -n "$STALE_PIDS" ]]; then
    echo "Port 8765 still busy — force-stopping stale process(es)..."
    for pid in $STALE_PIDS; do
      kill -9 "$pid" 2>/dev/null || true
    done
    sleep 0.2
  fi
fi
echo

VENV="$ROOT/.venv-lite"
PY="$VENV/bin/python"

if [[ ! -x "$PY" ]]; then
  echo "Creating Lite virtual environment..."
  if command -v python3 >/dev/null 2>&1; then
    python3 -m venv "$VENV"
  elif command -v python >/dev/null 2>&1; then
    python -m venv "$VENV"
  else
    echo "ERROR: Could not create .venv-lite — install Python 3.10+."
    exit 1
  fi
fi

echo "Updating Lite dependencies..."
"$PY" -m pip install -q -r requirements-lite.txt

echo
echo "Starting LocateIt Lite..."
echo "Drop a geotagged photo on the map to see where it was taken."
echo

exec "$PY" lite.py "$@"
