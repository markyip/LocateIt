"""Small JPEG thumbnails for map hover previews."""

from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path

from PIL import Image, ImageOps, ImageFile

from gps_cluster_map.raw_thumbnails import (
    decode_embedded_jpeg_bytes,
    extract_largest_embedded_jpeg_bytes,
    extract_raw_preview_image,
    extract_raw_thumbnail,
    get_jpeg_dimensions,
    is_raw_path,
)

ImageFile.LOAD_TRUNCATED_IMAGES = True

MAX_EDGE = 160
PREVIEW_MAX_EDGE = 1920
_JPEG_OPTS = {"format": "JPEG", "quality": 82, "optimize": True}
_PREVIEW_JPEG_OPTS = {"format": "JPEG", "quality": 88, "optimize": True}


def _image_to_jpeg_bytes(
    im: Image.Image, max_edge: int = MAX_EDGE, *, jpeg_opts: dict | None = None
) -> bytes:
    im = ImageOps.exif_transpose(im)
    if im.mode != "RGB":
        im = im.convert("RGB")
    im.thumbnail((max_edge, max_edge), Image.Resampling.BICUBIC)
    buf = io.BytesIO()
    im.save(buf, **(jpeg_opts or _JPEG_OPTS))
    return buf.getvalue()


def make_thumbnail_bytes(file_path: str, max_edge: int = MAX_EDGE) -> bytes | None:
    path = Path(file_path)
    if not path.is_file():
        return None

    if is_raw_path(str(path)):
        im = extract_raw_thumbnail(str(path), max_edge)
        if im is not None:
            try:
                return _image_to_jpeg_bytes(im, max_edge)
            except Exception:
                return None
        return None

    try:
        with Image.open(path) as im:
            return _image_to_jpeg_bytes(im, max_edge)
    except Exception:
        return None


def make_preview_bytes(file_path: str, max_edge: int = PREVIEW_MAX_EDGE) -> bytes | None:
    path = Path(file_path)
    if not path.is_file():
        return None

    if is_raw_path(str(path)):
        embedded = extract_largest_embedded_jpeg_bytes(str(path))
        if embedded:
            dims = get_jpeg_dimensions(embedded)
            if dims and max(dims) > max_edge:
                im = extract_raw_preview_image(str(path), max_edge)
                if im is not None:
                    try:
                        return _image_to_jpeg_bytes(im, max_edge, jpeg_opts=_PREVIEW_JPEG_OPTS)
                    except Exception:
                        return None
            im = decode_embedded_jpeg_bytes(embedded, max_edge, source_path=str(path))
            if im is not None:
                try:
                    return _image_to_jpeg_bytes(im, max_edge, jpeg_opts=_PREVIEW_JPEG_OPTS)
                except Exception:
                    return None
            return embedded

        im = extract_raw_preview_image(str(path), max_edge)
        if im is not None:
            try:
                return _image_to_jpeg_bytes(im, max_edge, jpeg_opts=_PREVIEW_JPEG_OPTS)
            except Exception:
                return None
        return None

    try:
        with Image.open(path) as im:
            return _image_to_jpeg_bytes(im, max_edge, jpeg_opts=_PREVIEW_JPEG_OPTS)
    except Exception:
        return None


def make_preview_bytes_from_upload(
    data: bytes, filename: str, max_edge: int = PREVIEW_MAX_EDGE
) -> bytes | None:
    suffix = Path(filename).suffix.lower() or ".jpg"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        return make_preview_bytes(tmp_path, max_edge=max_edge)
    except Exception:
        return None
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def make_thumbnail_bytes_from_upload(data: bytes, filename: str, max_edge: int = MAX_EDGE) -> bytes | None:
    suffix = Path(filename).suffix.lower() or ".jpg"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        return make_thumbnail_bytes(tmp_path, max_edge=max_edge)
    except Exception:
        return None
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def is_safe_path(file_path: str, allowed_roots: list[str]) -> bool:
    try:
        resolved = Path(file_path).expanduser().resolve()
        if not resolved.is_file():
            return False
        for root in allowed_roots:
            root_res = Path(root).expanduser().resolve()
            try:
                resolved.relative_to(root_res)
                return True
            except ValueError:
                continue
    except OSError:
        pass
    return False
