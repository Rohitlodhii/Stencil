"""Frame -> quadrilateral detection (classical CV only, no ML)."""

from __future__ import annotations

import cv2
import numpy as np


def detect_sheet(frame: np.ndarray, config) -> np.ndarray | None:
    """Detect the largest plausible sheet-of-paper quadrilateral in a frame.

    Pipeline: grayscale -> Gaussian blur -> Canny edges -> dilate ->
    findContours -> min-area filter -> approxPolyDP -> keep 4-point
    convex polygons -> return the largest.

    Returns a float32 array of shape (4, 2) with corner (x, y) points,
    or None when no valid quadrilateral is found.
    """
    if frame is None or frame.size == 0:
        return None

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (config.blur_kernel, config.blur_kernel), 0)
    edges = cv2.Canny(blurred, config.canny_low, config.canny_high)
    dilated = cv2.dilate(edges, None, iterations=config.dilate_iterations)

    contours, _ = cv2.findContours(
        dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    frame_area = float(frame.shape[0] * frame.shape[1])
    area_floor = max(
        float(config.min_contour_area),
        float(config.min_area_ratio) * frame_area,
    )

    best_quad: np.ndarray | None = None
    best_area = 0.0

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < area_floor:
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        epsilon = float(config.approx_epsilon_ratio) * perimeter
        approx = cv2.approxPolyDP(contour, epsilon, True)
        if len(approx) != 4:
            continue
        if not cv2.isContourConvex(approx):
            continue
        if area > best_area:
            best_area = area
            best_quad = approx.reshape(4, 2).astype(np.float32)

    return best_quad
