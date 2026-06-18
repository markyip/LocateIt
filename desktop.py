#!/usr/bin/env python3
"""Desktop entry — native photo picker + local server (no browser File System Access API)."""

from __future__ import annotations

import os
import sys

# Must be set before server module loads.
os.environ["GPS_CLUSTER_MAP_DESKTOP"] = "1"

from gps_cluster_map.desktop import main

if __name__ == "__main__":
    sys.exit(main())
