#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "Checking for an existing LocateIt server..."
bash "$ROOT/stop.sh" || true
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
