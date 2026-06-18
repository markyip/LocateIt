# Release notes

## v1.0.0 — Initial public release

First public release of **LocateIt** — geotag photo albums on an interactive map.

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

### Known limitations

- Map tiles require internet (OpenStreetMap)
- Browser mode saving requires Chrome or Edge and folder permission
- RAW geotag needs Exiv2 available to the Python process
- Only one server instance per port (8765) — launchers auto-stop the previous instance; use `stop.bat` / `stop.sh` if the port is still stuck

### Requirements

- Python 3.10+
- See [README.md](README.md) for full setup and troubleshooting
