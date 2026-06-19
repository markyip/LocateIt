# Release notes

## v1.1.1

Bug-fix release for **LocateIt Lite** on macOS and improved GPS metadata reading.

### Fixes

- **macOS shell scripts** — `.sh` launchers self-repair CRLF line endings from Windows-built zips; release builds normalize LF
- **macOS startup** — document Terminal launch (`bash run-lite.sh`); fix `stop.sh` on external/network volumes; force-clear stale port 8765
- **GPS metadata** — PyExiv2 fallback when EXIF lacks GPS; XMP GPS parsing; HEIC BMFF support; stronger browser/server metadata path in Lite UI

### Downloads

| Package | Download |
|---------|----------|
| **LocateIt Lite** | **`LocateIt-Lite-v1.1.1.zip`** on [this release](https://github.com/markyip/LocateIt/releases/tag/v1.1.1) |
| **LocateIt (full)** | Clone or source zip from this tag — same launchers benefit from shell fixes |

**macOS Lite:** start from Terminal: `bash run-lite.sh` (see [README-LITE.md](README-LITE.md)).

---

## v1.1.0

Geotag photo albums on a map (**LocateIt**) and view where a single photo was taken (**LocateIt Lite**). Both are included in this release.

### Downloads

| Package | Use case | Install size (venv) | Download |
|---------|----------|---------------------|----------|
| **LocateIt** | Open an album, cluster map, drag ungeotagged photos, **save GPS** to originals | ~105 MB | **Source code (zip)** or clone this repo — run `run-desktop.bat` / `./run-desktop.sh` |
| **LocateIt Lite** | Drop **one geotagged photo**, read-only map + metadata | ~35 MB | **`LocateIt-Lite-v1.1.0.zip`** on [this release](https://github.com/markyip/LocateIt/releases/tag/v1.1.0) |

Requires **Python 3.10+** on all platforms. See [README.md](README.md) (full) and [README-LITE.md](README-LITE.md) (Lite).

---

### LocateIt — full app

Album workflow for geotagging photos without GPS and reviewing clusters.

- **Open album** — native file dialog (desktop) or browser folder picker
- **Cluster map** — photos with GPS grouped by location (5 m default radius)
- **Manual geotagging** — drag ungeotagged photos from the sidebar onto the map
- **Save to originals** — write GPS into JPEG and RAW (desktop mode; Chrome/Edge in browser mode)
- **Lightbox viewer** with film strip; **map search**; **Restore album** (desktop)
- Combined **cluster pin with photo count**; pointer-based drag to map; themed Save dialog

**Launchers:** `run-desktop.bat` / `run.bat` (Windows), `run-desktop.sh` / `run.sh` (macOS / Linux)

**New in v1.1.0**

- Launchers **auto-stop** any existing server on port 8765 before starting
- README branding (logo, shields) and Lite download link

---

### LocateIt Lite

Minimal read-only viewer — no album import, no GPS editing, no session memory.

- Drop **one geotagged photo** on the map (JPEG, RAW, HEIC, …)
- Pin at capture location; metadata bar: **capture time**, **lat/lon**, **ISO**, **aperture**, **shutter**
- Default map center: your **current location**
- Dismissable notice if multiple files are dropped or the photo has **no GPS**
- Standalone package: `requirements-lite.txt`, `lite_server.py`, `web-lite/` only

**Launchers:** `run-lite.bat` / `run-lite.sh` (or extract `LocateIt-Lite-v1.1.0.zip`)

---

### Known limitations

- Map tiles require internet (OpenStreetMap)
- Browser mode saving requires Chrome or Edge and folder permission
- RAW metadata / save needs PyExiv2 (and Exiv2 on PATH for full-app RAW save)
- One server instance per port (8765) — launchers auto-stop the previous instance; use `stop.bat` / `stop.sh` if stuck

---

## v1.0.0 — Initial public release

First public release of **LocateIt** (full app only).

### Highlights

- **Open album** from a native file dialog (desktop mode) or browser folder picker
- **Cluster map** — photos with GPS grouped by location (5 m default radius)
- **Manual geotagging** — drag ungeotagged photos from the sidebar onto the map
- **Save to originals** — write GPS into JPEG and RAW files (desktop mode; browser mode on Chrome/Edge)
- **Lightbox viewer** with film strip for cluster and pending-photo preview
- **Map search** — jump to a place, then place pins precisely
- **Restore album** — reopen last folder in desktop mode

### Desktop mode (`run-desktop.bat`)

- Native **Open File** → loads the photo’s parent folder (RAWviewer-style)
- No browser File System Access API or second folder dialog
- Server-side path geotag for JPEG & RAW
- Settings stored under `%LOCALAPPDATA%\LocateIt`

### Browser mode (`run.bat`)

- Runs at `http://127.0.0.1:8765/`
- File System Access API for writable albums (Chrome / Edge)
- Read-only folder preview via `run.bat "D:\Photos\..."`

### Map & gallery UX

- Combined **cluster pin with photo count** inside the pin
- **Pointer-based drag** to map (cursor = drop location; faded thumbnail follows the pointer)
- Orange **placement pins** for pending photos; drag to reposition or back to sidebar to unpin
- Themed **Save confirmation** dialog (LocateIt branding)
- Reduced cluster hover hit area so nearby pins remain easy to drag

### Platforms

- Windows: `run-desktop.bat`, `run.bat`, `stop.bat`
- macOS / Linux: `run-desktop.sh`, `run.sh`, `stop.sh`
