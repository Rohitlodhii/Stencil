"""Background camera service: read -> detect -> overlay -> auto-capture.

Runs in its own thread so FastAPI can serve frames/status/captures over HTTP.
Reuses detector.py, stability.py and transform.py unchanged.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from .config import ScannerConfig
from .detector import detect_sheet
from .stability import StabilityTracker
from .transform import warp_sheet

JPEG_QUALITY = 80
PLACEHOLDER_SIZE = (640, 480)  # used when no camera is available
CAMERA_PROBE_MAX = 10  # highest device index probed by list_cameras()


class NoSheetError(RuntimeError):
    """Raised by capture_now() when no quadrilateral is currently visible."""


def list_cameras(max_index: int = CAMERA_PROBE_MAX) -> list[dict]:
    """Probe webcam device indices; return the ones that can be opened.

    Each entry is {"index": int, "label": str}. Stops early after a run of
    consecutive misses so machines without cameras return quickly.
    """
    found: list[dict] = []
    misses = 0
    for index in range(max(int(max_index), 0) + 1):
        cap = cv2.VideoCapture(index)
        try:
            if not cap.isOpened():
                misses += 1
                continue
            ok, _ = cap.read()
            if not ok:
                misses += 1
                continue
            try:
                backend = cap.getBackendName()
            except Exception:
                backend = "unknown"
            found.append({"index": index, "label": f"Camera {index} ({backend})"})
            misses = 0
        finally:
            cap.release()
        if misses >= 3 and not found:
            break
    return found


def save_scan(warped: np.ndarray, output_dir: str | Path) -> Path:
    """Save a warped scan with a timestamped filename; return its path.

    Appends a counter suffix when a file with the same timestamp already
    exists, so rapid successive captures never overwrite each other.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = out_dir / f"scan_{stamp}.jpg"
    counter = 1
    while path.exists():
        path = out_dir / f"scan_{stamp}_{counter}.jpg"
        counter += 1
    cv2.imwrite(str(path), warped)
    return path


def draw_overlay(
    frame: np.ndarray,
    quad: np.ndarray | None,
    stable_count: int,
    required_frames: int,
) -> None:
    """Draw the detected quadrilateral + status text onto the preview frame."""
    height = frame.shape[0]
    if quad is not None:
        pts = quad.reshape(-1, 1, 2).astype(int)
        is_stable = stable_count >= required_frames and required_frames > 0
        color = (0, 255, 0) if is_stable else (0, 255, 255)
        cv2.polylines(frame, [pts], True, color, 3)
        for x, y in quad.astype(int):
            cv2.circle(frame, (int(x), int(y)), 6, color, -1)
        status = f"Sheet: {stable_count}/{required_frames} stable frames"
    else:
        status = "No sheet detected — place paper on a contrasting surface"
    cv2.putText(frame, status, (12, height - 16),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)


def make_placeholder_frame() -> np.ndarray:
    """Dark placeholder frame served when no camera device is available."""
    width, height = PLACEHOLDER_SIZE
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    cv2.putText(frame, "No camera available", (150, height // 2),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
    return frame


class CameraLoop:
    """Owns the camera device and the detection pipeline (single owner)."""

    def __init__(self, config: ScannerConfig) -> None:
        self.config = config
        self.tracker = StabilityTracker(
            required_frames=config.stability_frames,
            tolerance_px=config.stability_tolerance,
            min_area_ratio=config.min_area_ratio,
        )
        self._lock = threading.Lock()
        self._frame_bytes: bytes | None = None
        self._latest_frame: np.ndarray | None = None
        self._sheet_detected = False
        self._stable = False
        self._corners: list[list[float]] | None = None
        self._latest_quad: np.ndarray | None = None
        self._cooldown_until = 0.0
        self._armed = True
        self._pending_index: int | None = None  # requested camera switch
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    # -- lifecycle ------------------------------------------------------
    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    # -- per-frame pipeline (also used directly by headless tests) ------
    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """Run detect -> stability -> auto-capture on one frame.

        Returns the annotated frame (overlay drawn). Never raises on
        frames with zero or multiple contour candidates.
        """
        config = self.config
        frame_area = float(frame.shape[0] * frame.shape[1])
        quad = detect_sheet(frame, config)

        with self._lock:
            if quad is not None:
                self._latest_quad = quad.copy()
                self._latest_frame = frame.copy()
                self._sheet_detected = True
                self._corners = [[float(x), float(y)] for x, y in quad]
            else:
                self._sheet_detected = False
                self._corners = None
                if not self._armed:
                    # Sheet was removed: re-arm auto-capture.
                    self._armed = True
                    self.tracker.reset()
                self.tracker.update(None, frame_area)
                self._stable = False

            if quad is not None and self._armed:
                now = time.monotonic()
                if now >= self._cooldown_until and self.tracker.update(quad, frame_area):
                    warped = warp_sheet(
                        frame, quad, config.aspect_ratio_wh, config.output_width
                    )
                    path = save_scan(warped, config.output_dir)
                    print(f"Auto-captured scan to {path}")
                    self._cooldown_until = now + config.cooldown_seconds
                    self._armed = False
                    self.tracker.reset()
                    self._stable = False
                else:
                    self._stable = self.tracker.stable_count >= self.tracker.required_frames
            elif quad is not None:
                self._stable = False

            stable_count = self.tracker.stable_count

        annotated = frame.copy()
        draw_overlay(annotated, quad, stable_count, config.stability_frames)
        return annotated

    # -- HTTP-facing accessors ------------------------------------------
    def get_frame_bytes(self) -> bytes | None:
        with self._lock:
            return self._frame_bytes

    def get_status(self) -> dict:
        with self._lock:
            return {
                "sheet_detected": self._sheet_detected,
                "stable": self._stable,
                "stable_count": self.tracker.stable_count,
                "required_frames": self.tracker.required_frames,
                "corners": self._corners,
                "camera_index": self.config.camera_index,
            }

    def set_camera(self, index: int) -> int:
        """Request a switch to another camera device index.

        The background thread reopens the device; detection state is reset
        so the old sheet cannot trigger a capture on the new feed.
        Returns the active index. Raises ValueError for invalid indices.
        """
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            raise ValueError(f"invalid camera index: {index!r}")
        with self._lock:
            self.config.camera_index = index
            self._pending_index = index
            self.tracker.reset()
            self._stable_count_reset()
        return index

    def _stable_count_reset(self) -> None:
        """Clear per-feed detection state (call with the lock held)."""
        self._stable = False
        self._sheet_detected = False
        self._corners = None
        self._latest_quad = None
        self._armed = True

    def capture_now(self) -> Path:
        """Manually capture the current best-guess quadrilateral.

        Same warp/save logic as the auto-capture path. Raises NoSheetError
        when no quadrilateral (or no frame) is currently available.
        """
        with self._lock:
            quad = self._latest_quad.copy() if self._latest_quad is not None else None
            frame = self._latest_frame.copy() if self._latest_frame is not None else None
        if quad is None or frame is None:
            raise NoSheetError("no quadrilateral in view")
        config = self.config
        warped = warp_sheet(frame, quad, config.aspect_ratio_wh, config.output_width)
        path = save_scan(warped, config.output_dir)
        with self._lock:
            self._cooldown_until = time.monotonic() + config.cooldown_seconds
            self._armed = False
            self.tracker.reset()
            self._stable = False
        return path

    # -- internal thread ------------------------------------------------
    def _open(self, index: int) -> tuple[cv2.VideoCapture, bool]:
        cap = cv2.VideoCapture(index)
        ok = cap.isOpened()
        if ok:
            print(f"Camera {index} opened.")
        else:
            print(f"No camera at index {index}; serving placeholder frames.")
        return cap, ok

    def _run(self) -> None:
        cap, camera_ok = self._open(self.config.camera_index)
        try:
            while not self._stop_event.is_set():
                with self._lock:
                    pending, self._pending_index = self._pending_index, None
                if pending is not None:
                    cap.release()
                    cap, camera_ok = self._open(pending)
                if camera_ok:
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        time.sleep(0.05)
                        continue
                else:
                    frame = make_placeholder_frame()
                    time.sleep(0.1)
                annotated = self.process_frame(frame)
                success, jpeg = cv2.imencode(
                    ".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
                )
                if success:
                    with self._lock:
                        self._frame_bytes = jpeg.tobytes()
        finally:
            if camera_ok:
                cap.release()

    @property
    def latest_frame(self) -> np.ndarray | None:
        with self._lock:
            return None if self._latest_frame is None else self._latest_frame.copy()
