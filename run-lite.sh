#!/usr/bin/env bash
grep -q $'\r' "$0" 2>/dev/null && tr -d '\r' < "$0" > "$0.lf" && mv "$0.lf" "$0" && chmod +x "$0" && exec bash "$0" "$@"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
[ -f "$ROOT/stop.sh" ] && grep -q $'\r' "$ROOT/stop.sh" 2>/dev/null && tr -d '\r' < "$ROOT/stop.sh" > "$ROOT/stop.sh.lf" && mv "$ROOT/stop.sh.lf" "$ROOT/stop.sh" && chmod +x "$ROOT/stop.sh"
cd "$ROOT"

# Bump when Lite Python dependencies or server stack changes (triggers venv recreate).
LITE_PROFILE="stdlib-http-1"

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
PROFILE_FILE="$VENV/.lite-profile"

if [[ -d "$VENV" ]]; then
  if [[ ! -f "$PROFILE_FILE" ]] || [[ "$(cat "$PROFILE_FILE")" != "$LITE_PROFILE" ]]; then
    echo "Lite dependency profile changed — recreating .venv-lite..."
    rm -rf "$VENV"
  fi
fi

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
  echo "$LITE_PROFILE" > "$PROFILE_FILE"
fi

_pip_install() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -m pip --python "$PY" install --no-cache-dir -q -r "$ROOT/requirements-lite.txt"
  else
    python -m pip --python "$PY" install --no-cache-dir -q -r "$ROOT/requirements-lite.txt"
  fi
}

_prune_lite_packages() {
  # Drop legacy FastAPI stack and other packages no longer in requirements-lite.txt.
  if "$PY" -m pip --version >/dev/null 2>&1; then
    "$PY" -m pip uninstall -y \
      fastapi uvicorn starlette pydantic pydantic_core python-multipart \
      anyio annotated-doc annotated-types click h11 httptools idna \
      python-dotenv PyYAML typing_extensions typing-inspection \
      uvloop watchfiles websockets 2>/dev/null || true
  fi
  rm -rf "$VENV"/lib/python3.*/site-packages/pip "$VENV"/lib/python3.*/site-packages/pip-*.dist-info 2>/dev/null || true
}

echo "Updating Lite dependencies..."
_pip_install
_prune_lite_packages

echo
echo "Starting LocateIt Lite..."
echo "Drop a geotagged photo on the map to see where it was taken."
echo

exec "$PY" lite.py "$@"
