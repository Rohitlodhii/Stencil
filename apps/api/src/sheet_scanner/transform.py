"""Corner ordering and perspective warp into a flat top-down scan."""

from __future__ import annotations

import cv2
import numpy as np


def order_corners(points: np.ndarray) -> np.ndarray:
    """Order 4 corners as (top-left, top-right, bottom-right, bottom-left).

    Uses the classic sum/difference heuristic: the top-left point has the
    smallest (x + y), bottom-right the largest; top-right the smallest
    (y - x), bottom-left the largest.
    """
    pts = np.asarray(points, dtype=np.float32).reshape(4, 2)
    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).ravel()  # y - x

    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(sums)]  # top-left
    ordered[2] = pts[np.argmax(sums)]  # bottom-right
    ordered[1] = pts[np.argmin(diffs)]  # top-right
    ordered[3] = pts[np.argmax(diffs)]  # bottom-left
    return ordered


def output_size(aspect_ratio_wh: float, output_width: int) -> tuple[int, int]:
    """Compute (width, height) of the scan from aspect ratio + target width."""
    height = int(round(output_width / aspect_ratio_wh))
    return int(output_width), max(height, 1)


def warp_sheet(
    frame: np.ndarray,
    quad: np.ndarray,
    aspect_ratio_wh: float,
    output_width: int,
) -> np.ndarray:
    """Map a detected quadrilateral to a flat rectangle (the "scan")."""
    ordered = order_corners(quad)
    out_w, out_h = output_size(aspect_ratio_wh, output_width)

    dst = np.array(
        [[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(ordered, dst)
    return cv2.warpPerspective(frame, matrix, (out_w, out_h))
