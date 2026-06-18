"""Desktop launcher — one process, native dialogs, browser UI."""

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


def _open_browser(url: str, delay: float = 0.9) -> None:
    time.sleep(delay)
    webbrowser.open(url)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="LocateIt — desktop app (native Open File → load folder)",
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)

    if not _port_available(args.host, args.port):
        print(
            f"ERROR: Port {args.port} is already in use on {args.host}.",
            file=sys.stderr,
        )
        print("Close the other LocateIt window, or use --port 8766.", file=sys.stderr)
        return 1

    url = f"http://{args.host}:{args.port}/?desktop=1"
    print(f"LocateIt (desktop): {url}")
    print("Open album uses your system photo picker — no second folder dialog.")

    if not args.no_browser:
        threading.Thread(target=_open_browser, args=(url,), daemon=True).start()

    uvicorn.run(
        "gps_cluster_map.server:app",
        host=args.host,
        port=args.port,
        reload=False,
        log_level="info",
    )
    return 0
