"""Shared image format suffix constants (no heavy dependencies)."""

from __future__ import annotations

RAW_SUFFIXES = {
    ".3fr",
    ".arw",
    ".cr2",
    ".cr3",
    ".dng",
    ".erf",
    ".iiq",
    ".nef",
    ".nrw",
    ".orf",
    ".pef",
    ".raf",
    ".raw",
    ".rw2",
    ".srw",
    ".x3f",
    ".cap",
    ".fff",
    ".mef",
    ".mos",
    ".rwl",
    ".srf",
}

GEOTAG_SUFFIXES = RAW_SUFFIXES | {
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".heic",
    ".heif",
    ".webp",
}

IMAGE_SUFFIXES = GEOTAG_SUFFIXES | {".png"}
