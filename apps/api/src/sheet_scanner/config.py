"""CLI args and defaults for the sheet scanner.

All detection parameters live here as named defaults so they can be tuned
for different desks/lighting without digging through the CV logic.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass


# A4 portrait aspect ratio (width / height), used as the default target shape.
A4_ASPECT_WH = 210.0 / 297.0


@dataclass
class ScannerConfig:
    """Runtime configuration for the sheet scanner."""

    camera_index: int = 0
    output_dir: str = "output"

    # -- Detection pipeline --
    blur_kernel: int = 5
    canny_low: int = 50
    canny_high: int = 150
    dilate_iterations: int = 2
    approx_epsilon_ratio: float = 0.02
    min_contour_area: float = 25_000.0
    min_area_ratio: float = 0.02  # quad must cover >= 2% of the frame

    # -- Stability tracking --
    stability_frames: int = 12
    stability_tolerance: float = 12.0  # max corner drift in pixels

    # -- Output scan shape --
    aspect_ratio_wh: float = A4_ASPECT_WH  # width / height of the warped scan
    output_width: int = 1240  # output height is derived from the aspect ratio

    # -- Capture behaviour --
    cooldown_seconds: float = 3.0  # pause auto-capture after each save

    # -- HTTP server --
    host: str = "127.0.0.1"
    port: int = 8000


def _parse_aspect_ratio(value: str) -> float:
    """Parse 'W:H' (e.g. '210:297') into a width/height float."""
    try:
        width_str, height_str = value.split(":")
        width, height = float(width_str), float(height_str)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"aspect ratio must look like 'WIDTH:HEIGHT', got {value!r}"
        )
    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("aspect ratio dimensions must be positive")
    return width / height


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sheet-scanner",
        description="Detect a sheet of paper on a desk via webcam and save "
        "a perspective-corrected scan.",
    )
    parser.add_argument("--camera", type=int, default=0, dest="camera_index",
                        help="webcam device index (default: 0)")
    parser.add_argument("--output-dir", default="output",
                        help="directory for saved scans (default: output)")
    parser.add_argument("--min-area", type=float, default=25_000.0,
                        dest="min_contour_area",
                        help="minimum contour area in px to consider (default: 25000)")
    parser.add_argument("--min-area-ratio", type=float, default=0.02,
                        help="minimum quad area as a fraction of frame area (default: 0.02)")
    parser.add_argument("--stability-frames", type=int, default=12,
                        help="consecutive stable frames before auto-capture (default: 12)")
    parser.add_argument("--stability-tolerance", type=float, default=12.0,
                        help="max corner movement in px between frames (default: 12)")
    parser.add_argument("--canny-low", type=int, default=50,
                        help="Canny lower threshold (default: 50)")
    parser.add_argument("--canny-high", type=int, default=150,
                        help="Canny upper threshold (default: 150)")
    parser.add_argument("--aspect-ratio", type=_parse_aspect_ratio,
                        default=A4_ASPECT_WH,
                        help="target 'W:H' aspect, e.g. '210:297' for A4 "
                             "(default: 210:297)")
    parser.add_argument("--output-width", type=int, default=1240,
                        help="scan output width in px (default: 1240)")
    parser.add_argument("--cooldown", type=float, default=3.0,
                        dest="cooldown_seconds",
                        help="seconds to pause auto-capture after a save (default: 3)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="interface for the HTTP server (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000,
                        help="port for the HTTP server (default: 8000)")
    return parser


def parse_args(argv: list[str] | None = None) -> ScannerConfig:
    """Parse CLI args into a ScannerConfig."""
    args = build_parser().parse_args(argv)
    return ScannerConfig(
        camera_index=args.camera_index,
        output_dir=args.output_dir,
        blur_kernel=ScannerConfig.blur_kernel,
        canny_low=args.canny_low,
        canny_high=args.canny_high,
        dilate_iterations=ScannerConfig.dilate_iterations,
        approx_epsilon_ratio=ScannerConfig.approx_epsilon_ratio,
        min_contour_area=args.min_contour_area,
        min_area_ratio=args.min_area_ratio,
        stability_frames=args.stability_frames,
        stability_tolerance=args.stability_tolerance,
        aspect_ratio_wh=args.aspect_ratio,
        output_width=args.output_width,
        cooldown_seconds=args.cooldown_seconds,
        host=args.host,
        port=args.port,
    )
