"""Minimal stdlib HTTP server for LocateIt Lite (no FastAPI / uvicorn)."""

from __future__ import annotations

import json
import mimetypes
import re
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar
from urllib.parse import unquote, urlparse

from gps_cluster_map.geotag_exiv import geotag_available
from gps_cluster_map.photo_metadata import read_photo_metadata_from_bytes

WEB_DIR = Path(__file__).resolve().parent.parent / "web-lite"
_FILENAME_RE = re.compile(r'filename\*?=(?:UTF-8\'\')?"?([^";\r\n]+)"?', re.IGNORECASE)


def _json_bytes(payload: dict, *, status: int = 200) -> tuple[int, bytes]:
    return status, json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _parse_multipart_file(body: bytes, content_type: str) -> tuple[str | None, bytes]:
    """Extract the first uploaded file from multipart/form-data."""
    if "multipart/form-data" not in content_type.lower():
        return None, b""
    match = re.search(r"boundary=(?P<b>[^;]+)", content_type, flags=re.IGNORECASE)
    if not match:
        return None, b""
    boundary = match.group("b").strip().strip('"').encode("ascii", errors="ignore")
    delimiter = b"--" + boundary

    for chunk in body.split(delimiter):
        if not chunk or chunk in (b"--", b"--\r\n"):
            continue
        part = chunk
        if part.startswith(b"\r\n"):
            part = part[2:]
        if part.endswith(b"\r\n"):
            part = part[:-2]
        if part.endswith(b"--"):
            part = part[:-2]
        header_end = part.find(b"\r\n\r\n")
        if header_end < 0:
            continue
        headers = part[:header_end].decode("utf-8", errors="replace")
        data = part[header_end + 4 :]
        if data.endswith(b"\r\n"):
            data = data[:-2]
        if "content-disposition:" not in headers.lower():
            continue
        filename = None
        for line in headers.split("\r\n"):
            if not line.lower().startswith("content-disposition:"):
                continue
            m = _FILENAME_RE.search(line)
            if m:
                filename = unquote(m.group(1).strip())
            break
        if filename is not None:
            return filename, data
    return None, b""


class LiteHTTPRequestHandler(BaseHTTPRequestHandler):
    web_dir: ClassVar[Path] = WEB_DIR

    def log_message(self, fmt: str, *args) -> None:
        print(f"[lite] {self.address_string()} - {fmt % args}")

    def _send_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def _send_body(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, payload: dict) -> None:
        _, body = _json_bytes(payload, status=status)
        self._send_body(status, body, "application/json; charset=utf-8")

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "lite": True, "geotag": geotag_available()},
            )
            return
        self._serve_static(path)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/metadata/read":
            self._send_json(HTTPStatus.NOT_FOUND, {"detail": "Not found"})
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {"detail": "Empty file"})
            return

        content_type = self.headers.get("Content-Type", "")
        body = self.rfile.read(length)
        filename, data = _parse_multipart_file(body, content_type)
        if not filename:
            self._send_json(HTTPStatus.BAD_REQUEST, {"detail": "Missing filename"})
            return
        if not data:
            self._send_json(HTTPStatus.BAD_REQUEST, {"detail": "Empty file"})
            return

        meta = read_photo_metadata_from_bytes(data, filename)
        if not meta.has_gps():
            self._send_json(HTTPStatus.NOT_FOUND, {"detail": "No GPS in file"})
            return
        self._send_json(HTTPStatus.OK, meta.to_dict())

    def _resolve_static(self, url_path: str) -> Path | None:
        rel = url_path.lstrip("/")
        if not rel or rel.endswith("/"):
            rel = "index.html"
        candidate = (self.web_dir / rel).resolve()
        root = self.web_dir.resolve()
        if not str(candidate).startswith(str(root)):
            return None
        if candidate.is_file():
            return candidate
        if (self.web_dir / "index.html").is_file():
            return (self.web_dir / "index.html").resolve()
        return None

    def _serve_static(self, url_path: str) -> None:
        file_path = self._resolve_static(url_path)
        if file_path is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"detail": "Not found"})
            return
        content_type, _ = mimetypes.guess_type(str(file_path))
        if not content_type:
            content_type = "application/octet-stream"
        data = file_path.read_bytes()
        self._send_body(HTTPStatus.OK, data, content_type)


def serve(host: str, port: int) -> None:
    if not WEB_DIR.is_dir():
        raise RuntimeError(f"web-lite directory not found: {WEB_DIR}")

    handler = LiteHTTPRequestHandler
    handler.web_dir = WEB_DIR
    server = ThreadingHTTPServer((host, port), handler)
    print(f"[lite] Serving {WEB_DIR} on http://{host}:{port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[lite] Shutting down.")
    finally:
        server.server_close()


def serve_async(host: str, port: int) -> threading.Thread:
    thread = threading.Thread(target=serve, args=(host, port), daemon=True)
    thread.start()
    return thread
