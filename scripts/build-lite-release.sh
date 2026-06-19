#!/usr/bin/env bash
# Build LocateIt-Lite release zip (source only — no venv).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-1.0.0}"
NAME="LocateIt-Lite-v${VERSION}"
STAGE="$ROOT/dist/$NAME"
ZIP="$ROOT/dist/${NAME}.zip"

rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE/gps_cluster_map"

copy() {
  cp "$1" "$STAGE/$2"
}

for f in lite.py run-lite.bat run-lite.sh stop.bat stop.sh requirements-lite.txt README-LITE.md; do
  copy "$f" "$f"
done

for m in __init__.py formats.py photo_metadata.py geotag_exiv.py scanner.py lite_server.py; do
  copy "gps_cluster_map/$m" "gps_cluster_map/$m"
done

cp -R web-lite "$STAGE/web-lite"

mkdir -p "$ROOT/dist"
(cd dist && zip -r "${NAME}.zip" "$NAME")

echo "Created $ZIP"
du -sh "$STAGE" "$ZIP" 2>/dev/null || ls -la "$ZIP"
