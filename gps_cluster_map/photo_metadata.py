"""Read display metadata (GPS, capture time, exposure) from photo bytes."""

from __future__ import annotations

import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

import exifread

from gps_cluster_map.geotag_exiv import _gps_from_pyexiv2_exif, read_gps_from_bytes
from gps_cluster_map.scanner import _extract_gps_from_tags, _ratio_to_float, _tag_text

try:
    import pyexiv2
except ImportError:  # pragma: no cover
    pyexiv2 = None  # type: ignore


@dataclass
class PhotoMetadata:
    name: str
    lat: float | None = None
    lon: float | None = None
    capture_time: str | None = None
    iso: str | None = None
    aperture: str | None = None
    shutter_speed: str | None = None

    def has_gps(self) -> bool:
        return self.lat is not None and self.lon is not None

    def to_dict(self) -> dict:
        return asdict(self)


def _format_aperture(raw) -> str | None:
    value = _ratio_to_float(raw)
    if value is None or value <= 0:
        return None
    text = f"f/{value:.1f}"
    if text.endswith(".0"):
        return text[:-2]
    return text


def _format_shutter(raw) -> str | None:
    value = _ratio_to_float(raw)
    if value is None or value <= 0:
        return None
    if value >= 1:
        text = f"{value:.1f}s"
        return text.replace(".0s", "s")
    denom = max(1, round(1 / value))
    return f"1/{denom}"


def _format_iso(raw) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, (list, tuple)) and raw:
        raw = raw[0]
    text = str(raw).strip()
    if not text:
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    if digits:
        return digits
    return text


def _metadata_from_exifread_tags(tags: dict, filename: str) -> PhotoMetadata:
    point = _extract_gps_from_tags(tags, filename)
    capture_time = _tag_text(
        tags,
        "EXIF DateTimeOriginal",
        "EXIF DateTimeDigitized",
        "Image DateTime",
        "EXIF DateTime",
    )
    iso = _format_iso(tags.get("EXIF ISOSpeedRatings") or tags.get("EXIF PhotographicSensitivity"))
    aperture = _format_aperture(tags.get("EXIF FNumber") or tags.get("EXIF ApertureValue"))
    shutter = _format_shutter(tags.get("EXIF ExposureTime"))
    return PhotoMetadata(
        name=Path(filename).name,
        lat=point.lat if point else None,
        lon=point.lon if point else None,
        capture_time=capture_time or None,
        iso=iso,
        aperture=aperture,
        shutter_speed=shutter,
    )


def _metadata_from_pyexiv2_exif(exif: dict, filename: str) -> PhotoMetadata:
    coords = _gps_from_pyexiv2_exif(exif)
    lat, lon = coords if coords else (None, None)
    capture_time = str(
        exif.get("Exif.Photo.DateTimeOriginal")
        or exif.get("Exif.Image.DateTime")
        or ""
    ).strip() or None
    iso = _format_iso(exif.get("Exif.Photo.ISOSpeedRatings"))
    aperture = _format_aperture(exif.get("Exif.Photo.FNumber"))
    shutter = _format_shutter(exif.get("Exif.Photo.ExposureTime"))
    return PhotoMetadata(
        name=Path(filename).name,
        lat=lat,
        lon=lon,
        capture_time=capture_time,
        iso=iso,
        aperture=aperture,
        shutter_speed=shutter,
    )


def _read_exifread_tags(path: str) -> dict:
    try:
        with open(path, "rb") as f:
            return exifread.process_file(f, details=False)
    except Exception:
        return {}


def _metadata_via_tempfile(data: bytes, filename: str) -> PhotoMetadata:
    suffix = Path(filename).suffix.lower() or ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        os.write(fd, data)
        os.close(fd)
        tags = _read_exifread_tags(path)
        return _metadata_from_exifread_tags(tags, filename)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def read_photo_metadata_from_bytes(data: bytes, filename: str) -> PhotoMetadata:
    """Read metadata from in-memory image bytes."""
    name = Path(filename).name or "photo"
    if not data:
        return PhotoMetadata(name=name)

    if pyexiv2 is not None:
        try:
            with pyexiv2.ImageData(data) as img:
                return _metadata_from_pyexiv2_exif(img.read_exif(), filename)
        except Exception:
            pass

    meta = _metadata_via_tempfile(data, filename)
    if meta.has_gps():
        return meta

    coords = read_gps_from_bytes(data, filename)
    if coords:
        lat, lon = coords
        return PhotoMetadata(
            name=meta.name,
            lat=lat,
            lon=lon,
            capture_time=meta.capture_time,
            iso=meta.iso,
            aperture=meta.aperture,
            shutter_speed=meta.shutter_speed,
        )
    return meta
