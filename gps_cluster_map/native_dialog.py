"""Native open-file dialog (RAWviewer open_file pattern) — no browser File System Access API."""

from __future__ import annotations

import os
import sys
from pathlib import Path

_IMAGE_GLOBS = (
    "*.jpg *.jpeg *.png *.tif *.tiff *.heic *.heif *.webp "
    "*.dng *.raw *.cr2 *.cr3 *.nef *.arw *.orf *.rw2 *.pef *.srw *.raf"
)


def pick_album_folder_via_photo(*, initial_dir: str | None = None) -> str | None:
    """
    Show OS file picker (images visible), return the parent folder path.
    Matches RAWviewer: getOpenFileName → dirname(folder).
    """
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise RuntimeError("Tkinter is required for the desktop album picker.") from exc

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass

    start = initial_dir or os.path.expanduser("~")
    if initial_dir and not os.path.isdir(initial_dir):
        start = str(Path(initial_dir).parent) if Path(initial_dir).parent.is_dir() else start

    filetypes = [
        ("Photos", _IMAGE_GLOBS),
        ("All files", "*.*"),
    ]
    if sys.platform == "darwin":
        filetypes = [("Photos", _IMAGE_GLOBS)]

    selected = filedialog.askopenfilename(
        title="Open any photo from your album",
        initialdir=start,
        filetypes=filetypes,
    )
    root.destroy()

    if not selected:
        return None
    return str(Path(selected).expanduser().resolve().parent)


def pick_album_folder_via_photo_or_cancel(initial_dir: str | None = None) -> str | None:
    try:
        return pick_album_folder_via_photo(initial_dir=initial_dir)
    except Exception:
        return None
