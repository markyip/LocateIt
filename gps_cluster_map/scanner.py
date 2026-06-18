"""Scan folders for GPS-tagged images and cluster by proximity."""

from __future__ import annotations

import math
import os
import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

import exifread

DEFAULT_CLUSTER_RADIUS_M = 5.0

IMAGE_SUFFIXES = {
    ".jpg",
    ".jpeg",
    ".png",
    ".tif",
    ".tiff",
    ".heic",
    ".heif",
    ".webp",
    ".dng",
    ".raw",
    ".cr2",
    ".cr3",
    ".nef",
    ".arw",
    ".orf",
    ".rw2",
    ".pef",
    ".srw",
    ".raf",
}


@dataclass(frozen=True)
class GpsPoint:
    path: str
    lat: float
    lon: float
    name: str = ""
    capture_time: str = ""


@dataclass(frozen=True)
class GpsCluster:
    cluster_id: int
    centroid_lat: float
    centroid_lon: float
    members: tuple[GpsPoint, ...]

    @property
    def count(self) -> int:
        return len(self.members)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _ratio_to_float(v) -> Optional[float]:
    try:
        if hasattr(v, "num") and hasattr(v, "den"):
            den = float(v.den) if float(v.den) != 0 else 1.0
            return float(v.num) / den
        if isinstance(v, str) and "/" in v:
            num, den = v.split("/", 1)
            d = float(den) if float(den) != 0 else 1.0
            return float(num) / d
        return float(v)
    except Exception:
        return None


def gps_to_decimal(gps_vals, ref: str) -> Optional[float]:
    try:
        vals = gps_vals
        if hasattr(vals, "values"):
            vals = vals.values
        if isinstance(vals, str):
            parts = re.split(r"[\s,]+", vals.strip())
            if len(parts) >= 3:
                parsed = []
                for p in parts:
                    if "/" in p:
                        num, den = p.split("/", 1)
                        parsed.append(float(num) / (float(den) if float(den) != 0 else 1.0))
                    else:
                        parsed.append(float(p))
                vals = parsed
        if not vals or not isinstance(vals, (list, tuple)) or len(vals) < 3:
            return None
        d = _ratio_to_float(vals[0])
        m = _ratio_to_float(vals[1])
        s = _ratio_to_float(vals[2])
        if d is None or m is None or s is None:
            return None
        dec = float(d) + float(m) / 60.0 + float(s) / 3600.0
        ref_str = str(ref or "").strip().upper()
        if ref_str in ("S", "W"):
            dec = -dec
        return dec
    except Exception:
        return None


def _tag_text(tags: dict, *keys: str) -> str:
    for key in keys:
        tag = tags.get(key)
        if tag is None:
            continue
        val = getattr(tag, "values", tag)
        if isinstance(val, (list, tuple)) and val:
            val = val[0]
        s = str(val).strip()
        if s:
            return s
    return ""


def _extract_gps_from_tags(tags: dict, file_path: str) -> Optional[GpsPoint]:
    lat = tags.get("GPS GPSLatitude") or tags.get("EXIF GPSLatitude")
    lon = tags.get("GPS GPSLongitude") or tags.get("EXIF GPSLongitude")
    if not lat or not lon:
        return None
    lat_ref = _tag_text(tags, "GPS GPSLatitudeRef", "EXIF GPSLatitudeRef")
    lon_ref = _tag_text(tags, "GPS GPSLongitudeRef", "EXIF GPSLongitudeRef")
    lat_dec = gps_to_decimal(lat, lat_ref)
    lon_dec = gps_to_decimal(lon, lon_ref)
    if lat_dec is None or lon_dec is None:
        return None
    if abs(lat_dec) <= 0.001 and abs(lon_dec) <= 0.001:
        return None
    capture_time = _tag_text(
        tags,
        "EXIF DateTimeOriginal",
        "Image DateTime",
        "EXIF DateTime",
    )
    return GpsPoint(
        path=file_path,
        lat=lat_dec,
        lon=lon_dec,
        name=os.path.basename(file_path),
        capture_time=capture_time,
    )


def _read_exif_tags(file_path: str) -> dict:
    try:
        with open(file_path, "rb") as f:
            return exifread.process_file(f, details=False, stop_tag="GPS GPSLongitudeRef")
    except Exception:
        return {}


def _read_sort_tags(file_path: str) -> dict:
    try:
        with open(file_path, "rb") as f:
            return exifread.process_file(f, details=False, stop_tag="EXIF DateTimeOriginal")
    except Exception:
        return {}


def _capture_sort_key(file_path: str) -> tuple[float, str]:
    """Oldest-first sort key: EXIF capture time, then mtime, then filename."""
    tags = _read_sort_tags(file_path)
    capture_time = _tag_text(
        tags,
        "EXIF DateTimeOriginal",
        "EXIF DateTimeDigitized",
        "Image DateTime",
        "EXIF DateTime",
    )
    if capture_time:
        try:
            ts = datetime.strptime(capture_time, "%Y:%m:%d %H:%M:%S").timestamp()
            return ts, os.path.basename(file_path).lower()
        except ValueError:
            pass
    try:
        return os.path.getmtime(file_path), os.path.basename(file_path).lower()
    except OSError:
        return 0.0, os.path.basename(file_path).lower()


def extract_gps_point(file_path: str) -> Optional[GpsPoint]:
    tags = _read_exif_tags(file_path)
    return _extract_gps_from_tags(tags, file_path)


def iter_image_files(
    folders: Iterable[str], *, max_subfolder_depth: int = 1
) -> list[str]:
    """List image files under each folder, up to max_subfolder_depth subfolder levels."""
    paths: list[str] = []
    seen: set[str] = set()

    def walk(root: Path, depth: int) -> None:
        for entry in root.iterdir():
            if entry.is_file():
                if entry.suffix.lower() not in IMAGE_SUFFIXES:
                    continue
                p = str(entry)
                norm = os.path.normcase(os.path.abspath(p))
                if norm in seen:
                    continue
                seen.add(norm)
                paths.append(p)
            elif entry.is_dir() and depth < max_subfolder_depth:
                walk(entry, depth + 1)

    for folder in folders:
        root = Path(folder).expanduser().resolve()
        if not root.is_dir():
            continue
        walk(root, 0)
    paths.sort(key=_capture_sort_key)
    return paths


def scan_folders(
    folders: Iterable[str],
    *,
    max_subfolder_depth: int = 1,
    progress_callback=None,
) -> tuple[list[GpsPoint], int]:
    files = iter_image_files(folders, max_subfolder_depth=max_subfolder_depth)
    points: list[GpsPoint] = []
    total = len(files)
    for i, fp in enumerate(files, start=1):
        pt = extract_gps_point(fp)
        if pt:
            points.append(pt)
        if progress_callback and (i <= 3 or i >= total or i % 50 == 0):
            progress_callback(i, total, len(points))
    return points, total


def cluster_points(
    points: Iterable[GpsPoint],
    radius_m: float = DEFAULT_CLUSTER_RADIUS_M,
) -> list[GpsCluster]:
    pts = list(points)
    n = len(pts)
    if not pts:
        return []

    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(n):
        for j in range(i + 1, n):
            if haversine_m(pts[i].lat, pts[i].lon, pts[j].lat, pts[j].lon) <= radius_m:
                union(i, j)

    groups: dict[int, list[GpsPoint]] = defaultdict(list)
    for i, pt in enumerate(pts):
        groups[find(i)].append(pt)

    clusters: list[GpsCluster] = []
    for cluster_id, members in enumerate(groups.values()):
        members_sorted = tuple(sorted(members, key=lambda m: (m.capture_time, m.path)))
        lat = sum(m.lat for m in members_sorted) / len(members_sorted)
        lon = sum(m.lon for m in members_sorted) / len(members_sorted)
        clusters.append(
            GpsCluster(
                cluster_id=cluster_id,
                centroid_lat=lat,
                centroid_lon=lon,
                members=members_sorted,
            )
        )
    clusters.sort(key=lambda c: (-c.count, c.cluster_id))
    return clusters


def clusters_to_json(clusters: list[GpsCluster]) -> list[dict]:
    out = []
    for c in clusters:
        out.append(
            {
                "id": c.cluster_id,
                "lat": c.centroid_lat,
                "lon": c.centroid_lon,
                "count": c.count,
                "members": [
                    {
                        "path": m.path,
                        "name": m.name or os.path.basename(m.path),
                        "lat": m.lat,
                        "lon": m.lon,
                        "capture_time": m.capture_time,
                    }
                    for m in c.members
                ],
            }
        )
    return out
