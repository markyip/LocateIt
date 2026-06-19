"""FastAPI server for folder scanning and thumbnails."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import logging

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from gps_cluster_map.album_scan import scan_album_folder
from gps_cluster_map.desktop_config import load_last_album_folder, save_last_album_folder
from gps_cluster_map.geocode import search_places
from gps_cluster_map.geotag_exiv import (
    geotag_available,
    inject_gps_into_bytes,
    inject_gps_into_file,
    is_geotag_path,
    read_gps_from_bytes,
)
from gps_cluster_map.photo_metadata import read_photo_metadata_from_bytes
from gps_cluster_map.native_dialog import pick_album_folder_via_photo
from gps_cluster_map.scanner import (
    DEFAULT_CLUSTER_RADIUS_M,
    cluster_points,
    clusters_to_json,
    extract_gps_point,
    scan_folders,
)
from gps_cluster_map.thumbnails import (
    is_safe_path,
    make_preview_bytes,
    make_preview_bytes_from_upload,
    make_thumbnail_bytes,
    make_thumbnail_bytes_from_upload,
)

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
logger = logging.getLogger(__name__)

DESKTOP_MODE = os.environ.get("GPS_CLUSTER_MAP_DESKTOP", "").strip().lower() in (
    "1",
    "true",
    "yes",
)

app = FastAPI(title="LocateIt", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_scanned_roots: list[str] = []


class ScanRequest(BaseModel):
    folders: list[str] = Field(min_length=1)
    max_subfolder_depth: int = Field(default=1, ge=0, le=10)
    cluster_radius_m: float = Field(default=DEFAULT_CLUSTER_RADIUS_M, gt=0, le=500)


class ScanResponse(BaseModel):
    folders: list[str]
    files_scanned: int
    gps_count: int
    cluster_count: int
    clusters: list[dict]


class AlbumScanResponse(BaseModel):
    folder: str
    files_scanned: int
    gps_count: int
    pending_count: int
    cluster_count: int
    geotagged: list[dict]
    pending: list[dict]
    clusters: list[dict]


class GeotagPathRequest(BaseModel):
    path: str = Field(min_length=1)
    lat: float
    lon: float


class AlbumFolderRequest(BaseModel):
    folder: str = Field(min_length=1)
    max_subfolder_depth: int = Field(default=1, ge=0, le=10)
    cluster_radius_m: float = Field(default=DEFAULT_CLUSTER_RADIUS_M, gt=0, le=500)


class DesktopPickRequest(BaseModel):
    folder: str = ""
    max_subfolder_depth: int = Field(default=1, ge=0, le=10)
    cluster_radius_m: float = Field(default=DEFAULT_CLUSTER_RADIUS_M, gt=0, le=500)


def _register_scanned_roots(folders: list[str]) -> None:
    global _scanned_roots
    _scanned_roots = folders


def _album_scan_response(folder: str, **scan_kwargs) -> AlbumScanResponse:
    result = scan_album_folder(folder, **scan_kwargs)
    _register_scanned_roots([result.folder])
    return AlbumScanResponse(
        folder=result.folder,
        files_scanned=result.files_scanned,
        gps_count=result.gps_count,
        pending_count=result.pending_count,
        cluster_count=result.cluster_count,
        geotagged=result.geotagged,
        pending=result.pending,
        clusters=result.clusters,
    )


@app.post("/api/scan", response_model=ScanResponse)
def api_scan(body: ScanRequest) -> ScanResponse:
    folders: list[str] = []
    for f in body.folders:
        p = Path(f).expanduser()
        if not p.is_dir():
            raise HTTPException(status_code=400, detail=f"Not a folder: {f}")
        folders.append(str(p.resolve()))

    gps_points, files_scanned = scan_folders(
        folders, max_subfolder_depth=body.max_subfolder_depth
    )
    clusters = cluster_points(gps_points, radius_m=body.cluster_radius_m)
    _register_scanned_roots(folders)

    return ScanResponse(
        folders=folders,
        files_scanned=files_scanned,
        gps_count=len(gps_points),
        cluster_count=len(clusters),
        clusters=clusters_to_json(clusters),
    )


@app.post("/api/album/scan", response_model=AlbumScanResponse)
def api_album_scan(body: AlbumFolderRequest) -> AlbumScanResponse:
    folder = Path(body.folder).expanduser()
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a folder: {body.folder}")
    try:
        resp = _album_scan_response(
            str(folder),
            max_subfolder_depth=body.max_subfolder_depth,
            cluster_radius_m=body.cluster_radius_m,
        )
        save_last_album_folder(resp.folder)
        return resp
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/desktop/pick-album", response_model=AlbumScanResponse)
def api_desktop_pick_album(body: DesktopPickRequest | None = None) -> AlbumScanResponse:
    if not DESKTOP_MODE:
        raise HTTPException(status_code=403, detail="Desktop mode only")

    opts = body or DesktopPickRequest()
    folder: str | None = None
    if opts.folder.strip():
        p = Path(opts.folder).expanduser()
        if not p.is_dir():
            raise HTTPException(status_code=400, detail=f"Not a folder: {opts.folder}")
        folder = str(p.resolve())
    else:
        try:
            folder = pick_album_folder_via_photo(
                initial_dir=load_last_album_folder(),
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not folder:
        raise HTTPException(status_code=400, detail="Album picker cancelled")

    try:
        resp = _album_scan_response(
            folder,
            max_subfolder_depth=opts.max_subfolder_depth,
            cluster_radius_m=opts.cluster_radius_m,
        )
        save_last_album_folder(resp.folder)
        return resp
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/desktop/last-album", response_model=AlbumScanResponse | None)
def api_desktop_last_album(
    max_subfolder_depth: int = Query(default=1, ge=0, le=10),
    cluster_radius_m: float = Query(default=DEFAULT_CLUSTER_RADIUS_M, gt=0, le=500),
) -> AlbumScanResponse | None:
    if not DESKTOP_MODE:
        raise HTTPException(status_code=403, detail="Desktop mode only")
    folder = load_last_album_folder()
    if not folder:
        return None
    try:
        return _album_scan_response(
            folder,
            max_subfolder_depth=max_subfolder_depth,
            cluster_radius_m=cluster_radius_m,
        )
    except ValueError:
        return None


@app.get("/api/thumbnail")
def api_thumbnail(path: str = Query(..., min_length=1)) -> Response:
    if not _scanned_roots:
        raise HTTPException(status_code=403, detail="Scan folders first")
    if not is_safe_path(path, _scanned_roots):
        raise HTTPException(status_code=403, detail="Path not allowed")
    data = make_thumbnail_bytes(path)
    if not data:
        raise HTTPException(status_code=404, detail="Thumbnail unavailable")
    return Response(content=data, media_type="image/jpeg")


@app.post("/api/thumbnail/upload")
async def api_thumbnail_upload(file: UploadFile = File(...)) -> Response:
    """Generate thumbnail from an uploaded file (browser folder drop, including RAW)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    thumb = make_thumbnail_bytes_from_upload(data, file.filename)
    if not thumb:
        raise HTTPException(status_code=404, detail="Thumbnail unavailable")
    return Response(content=thumb, media_type="image/jpeg")


@app.get("/api/preview")
def api_preview(path: str = Query(..., min_length=1)) -> Response:
    if not _scanned_roots:
        raise HTTPException(status_code=403, detail="Scan folders first")
    if not is_safe_path(path, _scanned_roots):
        raise HTTPException(status_code=403, detail="Path not allowed")
    data = make_preview_bytes(path)
    if not data:
        raise HTTPException(status_code=404, detail="Preview unavailable")
    return Response(content=data, media_type="image/jpeg")


@app.post("/api/preview/upload")
async def api_preview_upload(file: UploadFile = File(...)) -> Response:
    """Large JPEG preview for lightbox (RAW/HEIC/TIF and browser fallback)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    preview = make_preview_bytes_from_upload(data, file.filename)
    if not preview:
        raise HTTPException(status_code=404, detail="Preview unavailable")
    return Response(content=preview, media_type="image/jpeg")


@app.post("/api/geotag")
async def api_geotag(
    file: UploadFile = File(...),
    lat: float = Form(...),
    lon: float = Form(...),
) -> Response:
    """Write GPS metadata server-side (PyExiv2) and return modified file bytes."""
    if not geotag_available():
        raise HTTPException(status_code=503, detail="pyexiv2 not installed on server")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not is_geotag_path(file.filename):
        raise HTTPException(status_code=400, detail=f"Unsupported format: {file.filename}")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        out = inject_gps_into_bytes(data, file.filename, lat, lon)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    logger.info(
        "Geotagged %s (%d -> %d bytes) at %.5f, %.5f",
        file.filename,
        len(data),
        len(out),
        lat,
        lon,
    )

    media = file.content_type or "application/octet-stream"
    return Response(content=out, media_type=media)


@app.post("/api/geotag/path")
def api_geotag_path(body: GeotagPathRequest) -> dict:
    """Write GPS in-place on disk (desktop mode)."""
    if not geotag_available():
        raise HTTPException(status_code=503, detail="pyexiv2 not installed on server")
    if not _scanned_roots:
        raise HTTPException(status_code=403, detail="Scan an album first")
    if not is_safe_path(body.path, _scanned_roots):
        raise HTTPException(status_code=403, detail="Path not allowed")
    if not is_geotag_path(body.path):
        raise HTTPException(status_code=400, detail=f"Unsupported format: {body.path}")

    try:
        inject_gps_into_file(body.path, body.lat, body.lon)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    verified = extract_gps_point(body.path)
    if not verified:
        raise HTTPException(status_code=422, detail="GPS verify failed after save")
    return {
        "ok": True,
        "path": body.path,
        "lat": verified.lat,
        "lon": verified.lon,
        "name": verified.name or Path(body.path).name,
    }


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


@app.post("/api/gps/read")
async def api_gps_read(file: UploadFile = File(...)) -> dict:
    """Read GPS from uploaded file bytes (for RAW where browser exifr cannot)."""
    if not geotag_available():
        raise HTTPException(status_code=503, detail="pyexiv2 not installed on server")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    coords = read_gps_from_bytes(data, file.filename)
    if not coords:
        raise HTTPException(status_code=404, detail="No GPS in file")
    lat, lon = coords
    return {"lat": lat, "lon": lon, "name": file.filename}


@app.get("/api/geocode")
def api_geocode(q: str = Query(..., min_length=1), limit: int = Query(5, ge=1, le=10)) -> list[dict]:
    try:
        return search_places(q, limit=limit)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/health")
def health() -> dict:
    last_album = load_last_album_folder() if DESKTOP_MODE else None
    return {
        "ok": True,
        "desktop": DESKTOP_MODE,
        "scanned_roots": len(_scanned_roots),
        "geotag": geotag_available(),
        "last_album_folder": last_album,
    }


if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
