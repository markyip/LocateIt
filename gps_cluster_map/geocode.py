"""Geocode place search via server proxy (Nominatim requires User-Agent)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "GPS-Cluster-Map/0.1 (local photo geotag tool)"


def search_places(query: str, limit: int = 5) -> list[dict]:
    q = query.strip()
    if not q:
        return []

    params = urllib.parse.urlencode(
        {
            "q": q,
            "format": "json",
            "limit": max(1, min(limit, 10)),
            "addressdetails": "0",
        }
    )
    url = f"{NOMINATIM_URL}?{params}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Geocode HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Geocode network error: {exc.reason}") from exc

    out: list[dict] = []
    for row in data:
        if not row.get("lat") or not row.get("lon"):
            continue
        out.append(
            {
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "label": row.get("display_name") or q,
                "type": row.get("type") or "",
            }
        )
    return out
