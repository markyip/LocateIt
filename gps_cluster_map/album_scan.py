"""Full album scan — GPS clusters plus pending files (desktop / server path mode)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from gps_cluster_map.scanner import (
    DEFAULT_CLUSTER_RADIUS_M,
    GpsPoint,
    _read_sort_tags,
    _tag_text,
    cluster_points,
    clusters_to_json,
    extract_gps_point,
    iter_image_files,
)


@dataclass
class AlbumScanResult:
    folder: str
    files_scanned: int
    gps_count: int
    pending_count: int
    cluster_count: int
    geotagged: list[dict]
    pending: list[dict]
    clusters: list[dict]


def scan_album_folder(
    folder: str,
    *,
    max_subfolder_depth: int = 1,
    cluster_radius_m: float = DEFAULT_CLUSTER_RADIUS_M,
) -> AlbumScanResult:
    root = Path(folder).expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"Not a folder: {folder}")

    files = iter_image_files([str(root)], max_subfolder_depth=max_subfolder_depth)
    geotagged_pts: list[GpsPoint] = []
    pending: list[dict] = []

    for fp in files:
        pt = extract_gps_point(fp)
        if pt:
            geotagged_pts.append(pt)
            continue
        tags = _read_sort_tags(fp)
        capture_time = _tag_text(
            tags,
            "EXIF DateTimeOriginal",
            "EXIF DateTimeDigitized",
            "Image DateTime",
            "EXIF DateTime",
        )
        pending.append(
            {
                "path": fp,
                "name": os.path.basename(fp),
                "capture_time": capture_time,
            }
        )

    clusters = cluster_points(geotagged_pts, radius_m=cluster_radius_m)
    geotagged = [
        {
            "path": p.path,
            "name": p.name or os.path.basename(p.path),
            "lat": p.lat,
            "lon": p.lon,
            "capture_time": p.capture_time,
        }
        for p in geotagged_pts
    ]

    return AlbumScanResult(
        folder=str(root),
        files_scanned=len(files),
        gps_count=len(geotagged_pts),
        pending_count=len(pending),
        cluster_count=len(clusters),
        geotagged=geotagged,
        pending=pending,
        clusters=clusters_to_json(clusters),
    )
