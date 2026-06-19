#!/usr/bin/env python3
"""Start LocateIt Lite — single-photo GPS viewer."""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import webbrowser

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
    parser = argparse.ArgumentParser(
        description="LocateIt Lite — drop one geotagged photo to see where it was taken"
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/"

    if not args.no_browser:
        def _open() -> None:
            time.sleep(0.8)
            webbrowser.open(url)

        threading.Thread(target=_open, daemon=True).start()

    if not _port_available(args.host, args.port):
        print(f"ERROR: Port {args.port} is already in use on {args.host}.", file=sys.stderr)
        print("Close the other LocateIt window, or start on another port:", file=sys.stderr)
        print(f"  python lite.py --port {args.port + 1}", file=sys.stderr)
        return 1

    print(f"LocateIt Lite: {url}")
    print("Drop a geotagged photo on the map.")
    uvicorn.run(
        "gps_cluster_map.lite_server:app",
        host=args.host,
        port=args.port,
        reload=False,
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
