"""Write GPS EXIF/XMP via PyExiv2 (JPEG, TIFF, DNG, common RAW)."""

from __future__ import annotations

import os
from pathlib import Path

try:
    import pyexiv2
except ImportError:  # pragma: no cover
    pyexiv2 = None  # type: ignore

from gps_cluster_map.raw_thumbnails import RAW_SUFFIXES

GEOTAG_SUFFIXES = RAW_SUFFIXES | {
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".heic",
    ".heif",
    ".webp",
}


def geotag_available() -> bool:
    return pyexiv2 is not None


def is_geotag_path(filename: str) -> bool:
    return Path(filename).suffix.lower() in GEOTAG_SUFFIXES


def _dec_to_dms_exif_string(decimal: float) -> str:
    """EXIF GPS rationals as 'deg/1 min/1 sec/100' string (Exiv2 / exifread compatible)."""
    abs_val = abs(decimal)
    degrees = int(abs_val)
    minutes_float = (abs_val - degrees) * 60
    minutes = int(minutes_float)
    sec_hundredths = round((minutes_float - minutes) * 60 * 100)
    return f"{degrees}/1 {minutes}/1 {sec_hundredths}/100"


def _gps_exif_changes(lat: float, lon: float) -> dict:
    if not (-90 <= lat <= 90):
        raise ValueError(f"Latitude out of range: {lat}")
    if not (-180 <= lon <= 180):
        raise ValueError(f"Longitude out of range: {lon}")

    return {
        "Exif.GPSInfo.GPSVersionID": "2 2 0 0",
        "Exif.GPSInfo.GPSLatitudeRef": "N" if lat >= 0 else "S",
        "Exif.GPSInfo.GPSLatitude": _dec_to_dms_exif_string(lat),
        "Exif.GPSInfo.GPSLongitudeRef": "E" if lon >= 0 else "W",
        "Exif.GPSInfo.GPSLongitude": _dec_to_dms_exif_string(lon),
        "Exif.Image.GPSTag": "26",
    }


def _dec_to_xmp_gps(decimal: float, is_lat: bool) -> str:
    abs_val = abs(decimal)
    degrees = int(abs_val)
    minutes = (abs_val - degrees) * 60
    hemi = ("N" if decimal >= 0 else "S") if is_lat else ("E" if decimal >= 0 else "W")
    return f"{degrees},{minutes:.3f}{hemi}"


def _gps_xmp_changes(lat: float, lon: float) -> dict:
    return {
        "Xmp.exif.GPSLatitude": _dec_to_xmp_gps(lat, True),
        "Xmp.exif.GPSLongitude": _dec_to_xmp_gps(lon, False),
    }


def _is_raw_path(filename: str) -> bool:
    return Path(filename).suffix.lower() in RAW_SUFFIXES


def _parse_dms_exif_value(raw) -> float | None:
    """Parse pyexiv2 EXIF GPS DMS (string rationals or tuple list) to decimal degrees."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        parts = raw.replace("(", "").replace(")", "").split()
        rationals: list[float] = []
        for part in parts:
            if "/" in part:
                num, den = part.split("/", 1)
                rationals.append(float(num) / (float(den) if float(den) else 1.0))
            elif part:
                try:
                    rationals.append(float(part))
                except ValueError:
                    continue
        if len(rationals) >= 3:
            return rationals[0] + rationals[1] / 60.0 + rationals[2] / 3600.0
        return None
    if isinstance(raw, (list, tuple)):
        vals: list[float] = []
        for item in raw:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                vals.append(float(item[0]) / (float(item[1]) if float(item[1]) else 1.0))
            elif isinstance(item, str):
                part = item.strip("()")
                if "/" in part:
                    num, den = part.split("/", 1)
                    vals.append(float(num) / (float(den) if float(den) else 1.0))
        if len(vals) >= 3:
            return vals[0] + vals[1] / 60.0 + vals[2] / 3600.0
    return None


def _gps_from_pyexiv2_exif(exif: dict) -> tuple[float, float] | None:
    lat_ref = str(exif.get("Exif.GPSInfo.GPSLatitudeRef") or "N").strip().upper()
    lon_ref = str(exif.get("Exif.GPSInfo.GPSLongitudeRef") or "E").strip().upper()
    lat = _parse_dms_exif_value(exif.get("Exif.GPSInfo.GPSLatitude"))
    lon = _parse_dms_exif_value(exif.get("Exif.GPSInfo.GPSLongitude"))
    if lat is None or lon is None:
        return None
    if lat_ref == "S":
        lat = -lat
    if lon_ref == "W":
        lon = -lon
    return lat, lon


def read_gps_from_bytes(data: bytes, filename: str) -> tuple[float, float] | None:
    """Read GPS coordinates from image bytes (PyExiv2 + exifread fallback)."""
    if pyexiv2 is None or not data:
        return None

    try:
        with pyexiv2.ImageData(data) as img:
            coords = _gps_from_pyexiv2_exif(img.read_exif())
            if coords:
                return coords
    except Exception:
        pass

    # exifread via temp file (handles JPEG and many RAW containers)
    import os
    import tempfile

    from gps_cluster_map.scanner import extract_gps_point

    suffix = Path(filename).suffix.lower() or ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        os.write(fd, data)
        os.close(fd)
        pt = extract_gps_point(path)
        if pt:
            return pt.lat, pt.lon
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    return None


def inject_gps_into_bytes(data: bytes, filename: str, lat: float, lon: float) -> bytes:
    if pyexiv2 is None:
        raise RuntimeError("pyexiv2 is not installed — run pip install -r requirements.txt")
    if not data:
        raise ValueError("Empty file")
    if not is_geotag_path(filename):
        ext = Path(filename).suffix.lower() or "(no extension)"
        raise ValueError(f"Unsupported format for GPS write: {ext}")

    exif_changes = _gps_exif_changes(lat, lon)
    xmp_changes = _gps_xmp_changes(lat, lon)
    try:
        with pyexiv2.ImageData(data) as img:
            img.modify_exif(exif_changes)
            try:
                img.modify_xmp(xmp_changes)
            except Exception:
                pass
            out = img.get_bytes()
            if not out:
                raise RuntimeError("empty output after metadata write")
            return out
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Could not write GPS to {filename}: {exc}") from exc


def inject_gps_into_file(file_path: str, lat: float, lon: float) -> None:
    """Write GPS in-place to an on-disk file (desktop mode)."""
    path = Path(file_path).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"File not found: {file_path}")
    data = path.read_bytes()
    if not data:
        raise ValueError("Empty file")
    out = inject_gps_into_bytes(data, path.name, lat, lon)
    if out != data:
        path.write_bytes(out)
