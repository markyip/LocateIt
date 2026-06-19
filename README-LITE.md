# LocateIt Lite v1.1.0

Read-only single-photo GPS viewer. Part of the **LocateIt v1.1.0** release — see [RELEASE_NOTES.md](RELEASE_NOTES.md) for full + Lite downloads and changelog.

Full **LocateIt** (album geotagging): [github.com/markyip/LocateIt](https://github.com/markyip/LocateIt) · [Release v1.1.0](https://github.com/markyip/LocateIt/releases/tag/v1.1.0)

## Quick start

Lite runs in your **browser**: a local server opens **http://127.0.0.1:8765/** — drag one geotagged photo onto the map. (Full **LocateIt** album geotagging uses **desktop mode** — see [README.md](README.md).)

### Windows

```batch
run-lite.bat
```

### macOS / Linux

```bash
chmod +x run-lite.sh stop.sh
./run-lite.sh
```

Requires **Python 3.10+**. First run creates a small `.venv-lite` (about **~35 MB** vs ~105 MB for full LocateIt).

**Download zip:** [LocateIt-Lite-v1.1.0.zip](https://github.com/markyip/LocateIt/releases/download/v1.1.0/LocateIt-Lite-v1.1.0.zip) (from the v1.1.0 release page)

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
