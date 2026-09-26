"""Multi-frame stability tracking for the detected quadrilateral."""

from __future__ import annotations

import cv2
import numpy as np

from .transform import order_corners


class StabilityTracker:
    """Trigger a capture only once the sheet sits still.

    The corner positions (ordered consistently) must stay within
    ``tolerance_px`` across ``required_frames`` consecutive frames, and the
    quadrilateral area must cover at least ``min_area_ratio`` of the frame.
    """

    def __init__(
        self,
        required_frames: int = 12,
        tolerance_px: float = 12.0,
        min_area_ratio: float = 0.02,
    ) -> None:
        self.required_frames = max(int(required_frames), 1)
        self.tolerance_px = float(tolerance_px)
        self.min_area_ratio = float(min_area_ratio)
        self._stable_count = 0
        self._last_quad: np.ndarray | None = None

    @property
    def stable_count(self) -> int:
        return self._stable_count

    @property
    def last_quad(self) -> np.ndarray | None:
        return None if self._last_quad is None else self._last_quad.copy()

    def reset(self) -> None:
        self._stable_count = 0
        self._last_quad = None

    def update(self, quad: np.ndarray | None, frame_area: float) -> bool:
        """Feed one frame's detection; return True once the sheet is stable."""
        if quad is None:
            self.reset()
            return False

        ordered = order_corners(quad)
        area = float(cv2.contourArea(ordered))
        if area < self.min_area_ratio * float(frame_area):
            self.reset()
            return False

        if self._last_quad is not None:
            drift = float(
                np.linalg.norm(ordered - self._last_quad, axis=1).max()
            )
            if drift <= self.tolerance_px:
                self._stable_count += 1
            else:
                self._stable_count = 1
        else:
            self._stable_count = 1

        self._last_quad = ordered.copy()
        return self._stable_count >= self.required_frames
