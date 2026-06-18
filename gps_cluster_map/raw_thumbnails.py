"""RAW preview extraction (embedded JPEG / rawpy), aligned with RAWviewer."""

from __future__ import annotations

import io
import re
import struct
from pathlib import Path

import exifread
from PIL import Image, ImageOps, ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = True

RAW_SUFFIXES = {
    ".3fr", ".arw", ".cr2", ".cr3", ".dng", ".erf", ".iiq", ".nef", ".nrw",
    ".orf", ".pef", ".raf", ".raw", ".rw2", ".srw", ".x3f", ".cap", ".fff",
    ".mef", ".mos", ".rwl", ".srf",
}

_ORIENTATION_NAMES = {
    "Horizontal (normal)": 1,
    "Mirrored horizontal": 2,
    "Rotated 180": 3,
    "Mirrored vertical": 4,
    "Mirrored horizontal then rotated 90 CCW": 5,
    "Rotated 90 CW": 6,
    "Mirrored horizontal then rotated 90 CW": 7,
    "Rotated 90 CCW": 8,
}

_MAX_SEGMENT_READ = 16 * 1024 * 1024
_SCAN_CHUNK = 4 * 1024 * 1024


def is_raw_path(file_path: str) -> bool:
    return Path(file_path).suffix.lower() in RAW_SUFFIXES


def get_jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or not data.startswith(b"\xff\xd8"):
        return None
    offset = 2
    data_len = len(data)
    while offset < data_len:
        while offset < data_len and data[offset] == 0xFF:
            offset += 1
        if offset >= data_len:
            break
        marker = data[offset]
        offset += 1
        if marker in (0xDA, 0xD9):
            break
        if marker in (0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8):
            continue
        if offset + 2 > data_len:
            break
        segment_len = int.from_bytes(data[offset : offset + 2], byteorder="big")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if offset + 7 <= data_len:
                height = int.from_bytes(data[offset + 3 : offset + 5], byteorder="big")
                width = int.from_bytes(data[offset + 5 : offset + 7], byteorder="big")
                return width, height
            break
        offset += segment_len
    return None


def is_raw_path(file_path: str) -> bool:
    return Path(file_path).suffix.lower() in RAW_SUFFIXES


def get_orientation_from_file(file_path: str) -> int:
    """Read EXIF orientation from the main file (RAWviewer-style)."""
    try:
        with open(file_path, "rb") as f:
            tags = exifread.process_file(f, details=False, stop_tag="Image Orientation")
        tag = tags.get("Image Orientation")
        if not tag:
            return 1
        label = str(tag).strip()
        if label in _ORIENTATION_NAMES:
            return _ORIENTATION_NAMES[label]
        values = getattr(tag, "values", None)
        if values:
            try:
                val = int(values[0])
                if 1 <= val <= 8:
                    return val
            except (TypeError, ValueError):
                pass
        match = re.search(r"\b([1-8])\b", label)
        if match:
            return int(match.group(1))
    except OSError:
        pass
    except Exception:
        pass
    return 1


def apply_orientation_to_image(im: Image.Image, orientation: int) -> Image.Image:
    """Apply main-file EXIF orientation to decoded pixels (RAWviewer manual transpose)."""
    if orientation == 1:
        return im
    if orientation == 2:
        return im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if orientation == 3:
        return im.transpose(Image.Transpose.ROTATE_180)
    if orientation == 4:
        return im.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    if orientation == 5:
        return im.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(
            Image.Transpose.ROTATE_270
        )
    if orientation == 6:
        return im.transpose(Image.Transpose.ROTATE_270)
    if orientation == 7:
        return im.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(
            Image.Transpose.ROTATE_90
        )
    if orientation == 8:
        return im.transpose(Image.Transpose.ROTATE_90)
    return im


def _strip_exif_metadata(im: Image.Image) -> Image.Image:
    """Return a copy without EXIF so orientation is not applied twice."""
    if im.mode != "RGB":
        im = im.convert("RGB")
    return Image.frombytes("RGB", im.size, im.tobytes())


def decode_embedded_jpeg_bytes(
    jpeg_bytes: bytes, max_edge: int = 0, *, source_path: str | None = None
) -> Image.Image | None:
    try:
        im = Image.open(io.BytesIO(jpeg_bytes))
        if source_path and is_raw_path(source_path):
            orientation = get_orientation_from_file(source_path)
            im = apply_orientation_to_image(im, orientation)
            im = _strip_exif_metadata(im)
        else:
            im = ImageOps.exif_transpose(im)
        if im.mode != "RGB":
            im = im.convert("RGB")
        if max_edge > 0:
            im.thumbnail((max_edge, max_edge), Image.Resampling.BICUBIC)
        return im
    except Exception:
        return None


def extract_previews_via_tiff_parse(file_path: str) -> list[bytes]:
    previews: list[bytes] = []
    try:
        with open(file_path, "rb") as f:
            header = f.read(8)
            if len(header) < 8:
                return previews
            if header[:2] == b"II":
                endian = "<"
            elif header[:2] == b"MM":
                endian = ">"
            else:
                return previews
            magic = struct.unpack(endian + "H", header[2:4])[0]
            if magic != 42:
                return previews
            first_ifd_offset = struct.unpack(endian + "I", header[4:8])[0]
            ifds_to_visit = [first_ifd_offset]
            visited: set[int] = set()

            while ifds_to_visit:
                offset = ifds_to_visit.pop(0)
                if offset == 0 or offset in visited:
                    continue
                visited.add(offset)
                f.seek(offset)
                num_entries_bytes = f.read(2)
                if len(num_entries_bytes) < 2:
                    continue
                num_entries = struct.unpack(endian + "H", num_entries_bytes)[0]
                entry_data = f.read(num_entries * 12)
                if len(entry_data) < num_entries * 12:
                    continue
                next_ifd_bytes = f.read(4)
                if len(next_ifd_bytes) == 4:
                    next_ifd = struct.unpack(endian + "I", next_ifd_bytes)[0]
                    if next_ifd != 0:
                        ifds_to_visit.append(next_ifd)

                jpeg_offset = None
                jpeg_length = None
                sub_ifd_offsets: list[int] = []

                for i in range(num_entries):
                    entry = entry_data[i * 12 : (i + 1) * 12]
                    tag = struct.unpack(endian + "H", entry[0:2])[0]
                    type_val = struct.unpack(endian + "H", entry[2:4])[0]
                    count = struct.unpack(endian + "I", entry[4:8])[0]
                    value_offset = struct.unpack(endian + "I", entry[8:12])[0]
                    if tag == 0x0201:
                        jpeg_offset = value_offset
                    elif tag == 0x0202:
                        jpeg_length = value_offset
                    elif tag == 0x014A and (type_val == 4 or type_val == 13):
                        if count == 1:
                            sub_ifd_offsets.append(value_offset)
                        elif count > 1:
                            pos = f.tell()
                            f.seek(value_offset)
                            offsets_bytes = f.read(count * 4)
                            if len(offsets_bytes) == count * 4:
                                sub_ifd_offsets.extend(
                                    struct.unpack(endian + count * "I", offsets_bytes)
                                )
                            f.seek(pos)

                if jpeg_offset is not None and jpeg_length is not None:
                    f.seek(jpeg_offset)
                    jpeg_bytes = f.read(jpeg_length)
                    if len(jpeg_bytes) == jpeg_length:
                        previews.append(jpeg_bytes)

                for sub_offset in sub_ifd_offsets:
                    if sub_offset != 0 and sub_offset not in visited:
                        ifds_to_visit.append(sub_offset)
    except Exception:
        pass
    return previews


def _read_jpeg_segment_from_file(file_path: str, abs_offset: int) -> bytes | None:
    try:
        with open(file_path, "rb") as f:
            f.seek(abs_offset)
            remaining = f.read(_MAX_SEGMENT_READ)
            end = remaining.find(b"\xff\xd9")
            if end >= 0:
                return remaining[: end + 2]
            if remaining.startswith(b"\xff\xd8"):
                return remaining
    except OSError:
        pass
    return None


def _scan_chunk_for_jpegs(chunk_bytes: bytes, base_offset: int) -> list[tuple[int, bytes | None, int, int, int]]:
    candidates: list[tuple[int, bytes | None, int, int, int]] = []
    start = 0
    chunk_len = len(chunk_bytes)
    while True:
        idx = chunk_bytes.find(b"\xff\xd8\xff", start)
        if idx < 0:
            break
        header_chunk = chunk_bytes[idx : min(chunk_len, idx + 65536)]
        dims = get_jpeg_dimensions(header_chunk)
        if dims is not None:
            w, h = dims
            if w >= 32 and h >= 32:
                end_marker = chunk_bytes.find(b"\xff\xd9", idx + 3)
                if end_marker >= 0:
                    segment = chunk_bytes[idx : end_marker + 2]
                    candidates.append((w * h, segment, base_offset + idx, w, h))
                else:
                    candidates.append((w * h, None, base_offset + idx, w, h))
        start = idx + 3
    return candidates


def _collect_embedded_jpeg_candidates(file_path: str) -> list[tuple[int, bytes | None, int, int, int]]:
    candidates: list[tuple[int, bytes | None, int, int, int]] = []

    for jpeg_bytes in extract_previews_via_tiff_parse(file_path):
        dims = get_jpeg_dimensions(jpeg_bytes)
        if dims is not None:
            w, h = dims
            if w >= 32 and h >= 32:
                candidates.append((w * h, jpeg_bytes, 0, w, h))

    try:
        size = Path(file_path).stat().st_size
    except OSError:
        return sorted(candidates, key=lambda x: x[0], reverse=True)

    with open(file_path, "rb") as f:
        if size <= _SCAN_CHUNK * 2:
            head = f.read()
            tail = b""
        else:
            head = f.read(_SCAN_CHUNK)
            f.seek(size - _SCAN_CHUNK)
            tail = f.read(_SCAN_CHUNK)

    candidates.extend(_scan_chunk_for_jpegs(head, 0))
    if tail:
        candidates.extend(_scan_chunk_for_jpegs(tail, size - _SCAN_CHUNK))

    if file_path.lower().endswith(".dng"):
        best_w = max((c[3] for c in candidates), default=0)
        if not candidates or best_w < 1500:
            candidates.extend(_scan_whole_file_for_jpegs(file_path))

    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates


def _scan_whole_file_for_jpegs(file_path: str) -> list[tuple[int, bytes | None, int, int, int]]:
    found: list[tuple[int, bytes | None, int, int, int]] = []
    chunk_size = 8 * 1024 * 1024
    overlap = 65536
    offset = 0
    try:
        with open(file_path, "rb") as f:
            while True:
                f.seek(offset)
                chunk = f.read(chunk_size + overlap)
                if not chunk:
                    break
                found.extend(_scan_chunk_for_jpegs(chunk, offset))
                if len(chunk) < chunk_size + overlap:
                    break
                offset += chunk_size
    except OSError:
        pass
    return found


def _resolve_jpeg_segment(
    segment: bytes | None, file_path: str, abs_offset: int
) -> bytes | None:
    if segment is not None:
        return segment
    return _read_jpeg_segment_from_file(file_path, abs_offset)


def extract_largest_embedded_jpeg_bytes(file_path: str) -> bytes | None:
    """Return the largest embedded JPEG preview as raw bytes (RAWviewer-style)."""
    for _area, segment, abs_offset, _w, _h in _collect_embedded_jpeg_candidates(file_path):
        jpeg_bytes = _resolve_jpeg_segment(segment, file_path, abs_offset)
        if jpeg_bytes and decode_embedded_jpeg_bytes(jpeg_bytes, 0, source_path=file_path) is not None:
            return jpeg_bytes
    return None


def extract_embedded_jpeg_by_scan(file_path: str, max_edge: int) -> Image.Image | None:
    """Scan for embedded JPEG (TIFF tags + head/tail), decode largest match."""
    for _area, segment, abs_offset, _w, _h in _collect_embedded_jpeg_candidates(file_path):
        jpeg_bytes = _resolve_jpeg_segment(segment, file_path, abs_offset)
        if not jpeg_bytes:
            continue
        im = decode_embedded_jpeg_bytes(jpeg_bytes, max_edge, source_path=file_path)
        if im is not None:
            return im
    return None


def extract_via_rawpy(file_path: str, max_edge: int) -> Image.Image | None:
    try:
        import rawpy
    except ImportError:
        return None
    try:
        with rawpy.imread(file_path) as raw:
            thumb = raw.extract_thumb()
            if thumb.format == rawpy.ThumbFormat.JPEG:
                return decode_embedded_jpeg_bytes(thumb.data, max_edge, source_path=file_path)
            if thumb.format == rawpy.ThumbFormat.BITMAP:
                data = thumb.data
                if data is None or not hasattr(data, "shape"):
                    return None
                h, w = int(data.shape[0]), int(data.shape[1])
                if data.ndim == 3:
                    rgb = data[:, :, :3]
                else:
                    rgb = data
                im = Image.frombytes("RGB", (w, h), rgb.tobytes())
                im = apply_orientation_to_image(im, get_orientation_from_file(file_path))
                im = _strip_exif_metadata(im)
                if max_edge > 0:
                    im.thumbnail((max_edge, max_edge), Image.Resampling.BICUBIC)
                return im
    except Exception:
        return None
    return None


def extract_raw_preview_image(file_path: str, max_edge: int) -> Image.Image | None:
    """Embedded JPEG scan first (fast, full preview), then rawpy fallback."""
    scan_max = max_edge if max_edge > 0 else 8192
    im = extract_embedded_jpeg_by_scan(file_path, scan_max)
    if im is not None:
        return im
    return extract_via_rawpy(file_path, max_edge)


def extract_raw_thumbnail(file_path: str, max_edge: int) -> Image.Image | None:
    """Small map/gallery thumb — same order as RAWviewer."""
    im = extract_embedded_jpeg_by_scan(file_path, max_edge)
    if im is not None:
        return im
    return extract_via_rawpy(file_path, max_edge)
