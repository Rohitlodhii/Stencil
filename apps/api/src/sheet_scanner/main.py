"""Entry point: run the sheet-scanner HTTP server.

The scanner is no longer a desktop ``cv2.imshow`` app — the Python process
owns the camera in a background thread (see camera.py) and serves the live
feed, detection status and captures over HTTP (see server.py).
"""

from __future__ import annotations

from .camera import draw_overlay, save_scan  # noqa: F401 (kept import path stable)
from .config import parse_args
from .server import build_app

__all__ = ["main", "draw_overlay", "save_scan"]


def main(argv: list[str] | None = None) -> int:
    config = parse_args(argv)
    import uvicorn

    print(f"Sheet scanner server on http://{config.host}:{config.port} "
          "(Ctrl+C to stop).")
    uvicorn.run(build_app(config), host=config.host, port=config.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
