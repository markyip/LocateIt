#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "Checking for an existing LocateIt server..."
bash "$ROOT/stop.sh" || true
echo

PY="$ROOT/.venv/bin/python"

if [[ ! -x "$PY" ]]; then
  echo "Creating virtual environment..."
  if command -v python3 >/dev/null 2>&1; then
    python3 -m venv .venv
  elif command -v python >/dev/null 2>&1; then
    python -m venv .venv
  else
    echo "ERROR: Could not create .venv — install Python 3.10+."
    exit 1
  fi
fi

echo "Updating dependencies..."
"$PY" -m pip install -q -r requirements.txt

echo
echo "Starting LocateIt (desktop mode)..."
echo "Native Open File dialog — pick any photo to load its folder."
echo "Note: Homebrew Python may need: brew install python-tk@3.12"
echo

exec "$PY" desktop.py "$@"
