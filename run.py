#!/usr/bin/env python3
"""Start LocateIt and open the browser."""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def _port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def main() -> int:
    parser = argparse.ArgumentParser(description="LocateIt — geotag photos on a Leaflet map")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument(
        "folders",
        nargs="*",
        help="Optional folder path(s) to pre-fill in the scan box",
    )
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/"
    if args.folders:
        from urllib.parse import quote

        paths = "\n".join(str(Path(f).resolve()) for f in args.folders)
        url = f"{url}?paths={quote(paths)}"

    if not args.no_browser:
        def _open() -> None:
            time.sleep(0.8)
            webbrowser.open(url)

        threading.Thread(target=_open, daemon=True).start()

    if not _port_available(args.host, args.port):
        print(f"ERROR: Port {args.port} is already in use on {args.host}.", file=sys.stderr)
        print("Close the other LocateIt window, or start on another port:", file=sys.stderr)
        print(f"  python run.py --port {args.port + 1}", file=sys.stderr)
        return 1

    print(f"LocateIt: {url}")
    print("Drop a photo folder on the page to begin.")
    uvicorn.run(
        "gps_cluster_map.server:app",
        host=args.host,
        port=args.port,
        reload=False,
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
