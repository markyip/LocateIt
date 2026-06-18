"""Persist last album folder for desktop mode (no IndexedDB)."""

from __future__ import annotations

import json
import os
from pathlib import Path

_LEGACY_CONFIG_DIR = "GPSClusterMap"
_APP_CONFIG_DIR = "LocateIt"


def _config_dir(base: Path) -> Path:
    return base / _APP_CONFIG_DIR


def _legacy_config_dir(base: Path) -> Path:
    return base / _LEGACY_CONFIG_DIR


def _config_file() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    else:
        base = Path.home() / ".config"
    return _config_dir(base) / "settings.json"


def _legacy_config_file() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    else:
        base = Path.home() / ".config"
    return _legacy_config_dir(base) / "settings.json"


def _read_settings(path: Path) -> dict | None:
    try:
        if not path.is_file():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def load_last_album_folder() -> str | None:
    cfg = _config_file()
    legacy = _legacy_config_file()
    data = _read_settings(cfg) or _read_settings(legacy)
    if not data:
        return None
    folder = str(data.get("last_album_folder") or "").strip()
    if folder and Path(folder).is_dir():
        resolved = str(Path(folder).resolve())
        if legacy.is_file() and not cfg.is_file():
            save_last_album_folder(resolved)
        return resolved
    return None


def save_last_album_folder(folder: str) -> None:
    folder = str(Path(folder).expanduser().resolve())
    cfg = _config_file()
    try:
        cfg.parent.mkdir(parents=True, exist_ok=True)
        cfg.write_text(
            json.dumps({"last_album_folder": folder}, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass
