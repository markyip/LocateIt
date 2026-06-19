# LocateIt Lite

Drop **one geotagged photo** on the map to see where it was taken. Read-only — no album import, no GPS editing, no session memory.

Full **LocateIt** (album geotagging): [github.com/markyip/LocateIt](https://github.com/markyip/LocateIt)

## Quick start

### Windows

```batch
run-lite.bat
```

### macOS / Linux

```bash
chmod +x run-lite.sh stop.sh
./run-lite.sh
```

Requires **Python 3.10+**. First run creates a small `.venv-lite` (no Pillow/rawpy — about **~40 MB** vs ~105 MB for full LocateIt).

## How to use

1. Keep the terminal window open.
2. Drag **one** photo with GPS onto the map.
3. View the pin and metadata bar (capture time, lat/lon, ISO, aperture, shutter).

If you drop multiple files or a photo **without GPS**, a dismissable notice appears and nothing is loaded.

## Stop

Close the terminal window, or run `stop.bat` / `./stop.sh` if port 8765 is stuck.

## Requirements

- Internet for map tiles (OpenStreetMap)
- RAW / HEIC metadata uses **PyExiv2** (installed automatically)

## Manual run

```bash
python3 -m venv .venv-lite
.venv-lite/bin/pip install -r requirements-lite.txt   # Windows: .venv-lite\Scripts\pip
.venv-lite/bin/python lite.py
```

Open `http://127.0.0.1:8765/`
