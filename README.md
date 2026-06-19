<p align="center">
  <img src="web/img/logo.png" alt="LocateIt" width="256">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.0-blue" alt="Version">
  <img src="https://img.shields.io/github/downloads/markyip/LocateIt/total" alt="Downloads">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <a href="https://www.buymeacoffee.com/markyip"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-orange?logo=buy-me-a-coffee" alt="Buy Me a Coffee"></a>
</p>

**LocateIt** is a standalone desktop tool to open a photo album, view **GPS clusters** on an interactive map, and **geotag photos without GPS** by dragging them onto the map.

Each cluster pin shows **how many photos** share that location (default **5 m** radius). Hover a pin for thumbnail previews; click to open a lightbox with a film strip.

Repository: [github.com/markyip/LocateIt](https://github.com/markyip/LocateIt)

**LocateIt Lite** (single-photo GPS viewer, smaller install): [Download v1.1.0](https://github.com/markyip/LocateIt/releases/tag/v1.1.0-lite) · [README-LITE.md](README-LITE.md)

---

## Quick start

### Recommended — Desktop mode (Windows)

Best for everyday use: **one native “Open File” dialog**, no browser folder picker, full JPEG & RAW save support.

```batch
run-desktop.bat
```

Pick **any photo** in your album — the **whole folder** loads. GPS is written back to the original files when you click **Save**.

### Browser mode (Windows)

```batch
run.bat
```

Opens **http://127.0.0.1:8765/** in your browser. Uses the File System Access API (Chrome / Edge). Saving GPS requires granting folder access; the first open may ask for folder permission again.

Pre-fill folders via server scan (read-only map preview):

```batch
run.bat "D:\Photos\Trip2024"
```

### LocateIt Lite — one photo, read-only

Drop **one geotagged photo** on the map to see where it was taken (capture time, lat/lon, ISO, aperture, shutter). No album import, no GPS editing, no session memory. Uses a smaller Python install (~35 MB venv vs ~105 MB for full LocateIt).

**Download:** [LocateIt-Lite v1.1.0 zip](https://github.com/markyip/LocateIt/releases/download/v1.1.0-lite/LocateIt-Lite-v1.1.0.zip) · [Release notes](https://github.com/markyip/LocateIt/releases/tag/v1.1.0-lite)

From this repo (developers):

```batch
run-lite.bat
```

```bash
./run-lite.sh
```

See [README-LITE.md](README-LITE.md) for details.

### macOS / Linux

```bash
chmod +x run-desktop.sh run.sh           # first time only
./run-desktop.sh                         # desktop mode (recommended)
# or
./run.sh                                 # browser mode
```

Manual setup:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python desktop.py           # desktop mode
# or
python run.py               # browser mode
```

**macOS notes:** Homebrew Python often needs Tkinter for desktop mode: `brew install python-tk@3.12`. If RAW save fails to load, try `brew install gettext inih`.

---

## How to use

1. Click **Open album** (desktop mode remembers your last folder via **Restore album** when applicable).
2. Photos **with GPS** appear as numbered cluster pins on the map.
3. Photos **without GPS** appear in the sidebar — **drag** them to the map (pin follows your **cursor**), then **Save**.
4. Use **map search** to jump to a place, then fine-tune placement.
5. To move a pin, drag the orange placement pin on the map. Drag it back to the sidebar or click **×** on the thumbnail to unpin.

### Tips

| Action | How |
|--------|-----|
| Preview a photo | Click its thumbnail |
| Select several photos | Click the title area under a thumbnail |
| Drag to map | Press and drag from a thumbnail (semi-transparent preview follows the cursor) |
| Save GPS | **Save** — confirms before writing to original files |

---

## Stopping the app & port conflicts

LocateIt runs a **local web server** on `127.0.0.1:8765` while the launcher is active.

### What happens if I close windows?

| What you close | What happens |
|----------------|--------------|
| **Browser tab/window only** | Server **keeps running** in the command window. Refresh the page or reopen `http://127.0.0.1:8765/?desktop=1`. |
| **The black command window** (`run-desktop.bat` / `run.bat`) | Server **stops**. Port 8765 is freed. This is the normal way to quit. |
| **Command window** while server still running, then run the batch again | The launcher **automatically stops** any process listening on port 8765, then starts fresh. |

### If port 8765 is stuck

`run-desktop.bat`, `run.bat`, and their shell equivalents call `stop.bat` / `stop.sh` at startup. You usually do not need to stop manually.

If something else is using the port (not LocateIt), use another port:

**Windows** (manual stop):

```batch
stop.bat
```

**macOS / Linux** (manual stop):

```bash
./stop.sh
```

Or use another port:

```batch
.venv\Scripts\python.exe desktop.py --port 8766
```

### Guidance for end users

- **Minimize** the command window if you do not want to see it — do not close it until you are finished.
- Closing only the browser is fine; closing the command window exits LocateIt.
- If “port already in use” still appears, run `stop.bat` / `./stop.sh` manually or close the previous command window.

---

## Browser vs desktop

| | **run-desktop.bat** | **run.bat** |
|---|---------------------|-------------|
| Open album | Native file dialog | Browser file + folder API |
| Save GPS to disk | Always (paths on server) | Chrome/Edge + folder permission |
| Extra folder dialog | No | Sometimes (browser limitation) |
| Best for | Daily use, RAW workflows | Quick try in browser |

---

## Architecture

```
LocateIt/                     # repo (Python package: gps_cluster_map)
  run-desktop.bat / run.bat   # Windows launchers (full app)
  run-lite.bat / run-lite.sh  # LocateIt Lite (metadata viewer only)
  run-desktop.sh / run.sh     # macOS / Linux launchers
  stop.bat / stop.sh          # Free port 8765
  desktop.py / run.py         # Full app entry points
  lite.py                       # Lite entry point
  requirements-lite.txt         # Lite deps (no Pillow/rawpy)
  gps_cluster_map/
    server.py                 # FastAPI — scan, thumbnails, geotag, desktop APIs
    lite_server.py            # Lite — metadata read only
    album_scan.py             # Full album scan (GPS + pending)
    native_dialog.py          # Tkinter Open File → parent folder (desktop)
    desktop_config.py         # Last album path (%LOCALAPPDATA%/LocateIt)
    scanner.py                # EXIF GPS + union-find clustering
    geotag_exiv.py            # In-place GPS write (desktop save)
    photo_metadata.py         # Lite metadata read
  web/                        # Full app UI
  web-lite/                   # Lite UI only
```

---

## Requirements

- Python 3.10+
- **Desktop mode:** Tkinter (included with standard Python on Windows)
- Network access for map tiles (OpenStreetMap)
- **RAW save:** [Exiv2](https://exiv2.org/) on PATH (optional; JPEG works without it)

---

## Development

```batch
run-desktop.bat
```

The batch file creates `.venv`, installs `requirements.txt`, and starts `desktop.py`.

---

## License

MIT — use freely for personal workflows.
