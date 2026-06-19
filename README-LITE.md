# LocateIt Lite v1.1.1

Read-only single-photo GPS viewer. Part of the **LocateIt v1.1.1** release — see [RELEASE_NOTES.md](RELEASE_NOTES.md) for full + Lite downloads and changelog.

Full **LocateIt** (album geotagging): [github.com/markyip/LocateIt](https://github.com/markyip/LocateIt) · [Release v1.1.1](https://github.com/markyip/LocateIt/releases/tag/v1.1.1)

## Quick start

Lite runs in your **browser**: a local server opens **http://127.0.0.1:8765/** — drag one geotagged photo onto the map. (Full **LocateIt** album geotagging uses **desktop mode** — see [README.md](README.md).)

### Windows

```batch
run-lite.bat
```

### macOS / Linux

**Start from Terminal** (double-clicking `run-lite.sh` is not supported on macOS):

```bash
cd /path/to/LocateIt-Lite-v1.1.1
bash run-lite.sh
```

Keep the Terminal window open while using the app. Your browser should open **http://127.0.0.1:8765/** automatically.

On external or network drives (e.g. `/Volumes/Development/...`), always use `bash run-lite.sh` — do not use `./run-lite.sh` (macOS cannot set execute permission on those volumes).

Requires **Python 3.10+**. First run creates `.venv-lite` (~**5 MB** site-packages: exifread + pyexiv2 only). If you upgraded from an older Lite build and `.venv-lite` is still large, delete it and run again:

```bash
rm -rf .venv-lite
bash run-lite.sh
```

If `bash run-lite.sh` fails with `pipefail: invalid option name`, the zip was built on Windows with CRLF line endings — re-download a fixed build, or run `tr -d '\r' < run-lite.sh > run-lite-fixed.sh && bash run-lite-fixed.sh`. Current scripts also self-repair on first launch.

**Download zip:** [LocateIt-Lite-v1.1.1.zip](https://github.com/markyip/LocateIt/releases/download/v1.1.1/LocateIt-Lite-v1.1.1.zip) (from the v1.1.1 release page)

## How to use

1. Keep the terminal window open.
2. Drag **one** photo with GPS onto the map.
3. View the pin and metadata bar (capture time, lat/lon, ISO, aperture, shutter).

If you drop multiple files or a photo **without GPS**, a dismissable notice appears and nothing is loaded.

## Stop

Close the Terminal window, or run `bash stop.sh` (macOS/Linux) / `stop.bat` (Windows) if port 8765 is stuck.

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
