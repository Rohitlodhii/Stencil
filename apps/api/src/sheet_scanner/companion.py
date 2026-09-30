"""Packaged Stencil scanner companion entry point."""

from __future__ import annotations

import logging
import os
import sys
import threading
import webbrowser
from logging.handlers import RotatingFileHandler
from pathlib import Path

import uvicorn

from sheet_scanner.config import ScannerConfig
from sheet_scanner.server import build_app


def app_data_dir() -> Path:
    if sys.platform == "win32":
        root = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return root / "Stencil" / "Scanner"


def configure_logging(directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    log_path = directory / "scanner.log"
    handler = RotatingFileHandler(log_path, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(handler)
    return log_path


def companion_config() -> ScannerConfig:
    directory = app_data_dir()
    origins = tuple(
        value.strip()
        for value in os.getenv("STENCIL_SCANNER_ORIGINS", "").split(",")
        if value.strip()
    )
    camera_index = int(os.getenv("STENCIL_SCANNER_CAMERA", "0"))
    camera_enabled = os.getenv("STENCIL_SCANNER_DISABLE_CAMERA", "").strip().lower() not in {
        "1", "true", "yes", "on"
    }
    port = int(os.getenv("STENCIL_SCANNER_PORT", "8000"))
    defaults = ScannerConfig()
    return ScannerConfig(
        camera_index=camera_index,
        camera_enabled=camera_enabled,
        output_dir=str(directory / "scans"),
        host="127.0.0.1",
        port=port,
        allowed_origins=origins or defaults.allowed_origins,
    )


def main() -> int:
    config = companion_config()
    log_path = configure_logging(app_data_dir())
    logger = logging.getLogger(__name__)
    logger.info("Starting scanner companion at 127.0.0.1:%s; logs=%s", config.port, log_path)

    uvicorn_config = uvicorn.Config(
        build_app(config), host="127.0.0.1", port=config.port, log_config=None, access_log=False
    )
    server = uvicorn.Server(uvicorn_config)
    server.config.app = build_app(config, lambda: setattr(server, "should_exit", True))
    if os.getenv("STENCIL_SCANNER_OPEN_STATUS", "1").strip().lower() not in {"0", "false", "no"}:
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{config.port}/")).start()
    try:
        server.run()
    except OSError:
        logger.exception("Scanner companion could not start")
        return 1
    logger.info("Scanner companion stopped cleanly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
