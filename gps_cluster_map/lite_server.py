"""Minimal FastAPI server for LocateIt Lite (metadata read only)."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from gps_cluster_map.geotag_exiv import geotag_available
from gps_cluster_map.photo_metadata import read_photo_metadata_from_bytes

WEB_DIR = Path(__file__).resolve().parent.parent / "web-lite"

app = FastAPI(title="LocateIt Lite", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "lite": True, "geotag": geotag_available()}


@app.post("/api/metadata/read")
async def api_metadata_read(file: UploadFile = File(...)) -> dict:
    """Read GPS and camera metadata from a single uploaded photo."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    meta = read_photo_metadata_from_bytes(data, file.filename)
    if not meta.has_gps():
        raise HTTPException(status_code=404, detail="No GPS in file")
    return meta.to_dict()


if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web-lite")
