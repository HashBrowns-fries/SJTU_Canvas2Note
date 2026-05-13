"""
Live stream QR code monitor.

Captures frames from an FLV stream (computer screen track, cdviChannelNum=7),
detects QR codes using OpenCV, and pushes detections via callback.
"""
import subprocess
import threading
import time
import json
import queue
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np


class LiveQRMonitor:
    """
    Monitors a live FLV stream for QR codes.

    Usage:
        monitor = LiveQRMonitor(stream_url, on_qr_detected)
        monitor.start()
        ...
        monitor.stop()
    """

    def __init__(
        self,
        stream_url: str,
        on_qr_detected: Callable[[dict], None],
        check_interval: float = 2.0,
    ):
        self.stream_url = stream_url
        self.on_qr_detected = on_qr_detected
        self.check_interval = check_interval
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._detector = cv2.QRCodeDetector()
        self._last_data = ""  # dedup: don't alert same QR repeatedly

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _capture_frame(self) -> Optional[np.ndarray]:
        """Grab a single frame from the FLV stream using ffmpeg."""
        cmd = [
            "ffmpeg",
            "-y",
            "-rtsp_transport", "tcp",
            "-i", self.stream_url,
            "-vframes", "1",
            "-f", "image2pipe",
            "-pix_fmt", "bgr24",
            "-vcodec", "rawvideo",
            "-",
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=10,
            )
            if proc.returncode != 0 or len(proc.stdout) < 100:
                return None
            # We need to know dimensions — ffmpeg rawvideo needs explicit size
            # Let's use a different approach: output to a temp file
        except subprocess.TimeoutExpired:
            return None
        return None

    def _capture_frame_png(self) -> Optional[np.ndarray]:
        """Grab a frame as PNG via ffmpeg pipe, decode with OpenCV."""
        cmd = [
            "ffmpeg",
            "-y",
            "-rtsp_transport", "tcp",
            "-i", self.stream_url,
            "-vframes", "1",
            "-f", "image2pipe",
            "-vcodec", "png",
            "-",
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=10,
            )
            if proc.returncode != 0 or len(proc.stdout) < 100:
                return None
            arr = np.frombuffer(proc.stdout, np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            return frame
        except subprocess.TimeoutExpired:
            return None

    def _loop(self):
        while self._running:
            try:
                frame = self._capture_frame_png()
                if frame is None:
                    time.sleep(self.check_interval)
                    continue

                # Detect QR codes
                data, bbox, _ = self._detector.detectAndDecode(frame)

                if data and data != self._last_data:
                    self._last_data = data
                    # Extract bounding box info
                    bbox_info = None
                    if bbox is not None and len(bbox) > 0:
                        bbox_info = bbox.astype(int).tolist()

                    event = {
                        "type": "qr_detected",
                        "data": data,
                        "timestamp": time.time(),
                        "bbox": bbox_info,
                    }
                    self.on_qr_detected(event)

                elif not data and self._last_data:
                    # QR code disappeared
                    event = {
                        "type": "qr_cleared",
                        "timestamp": time.time(),
                    }
                    self._last_data = ""
                    self.on_qr_detected(event)

            except Exception:
                pass

            time.sleep(self.check_interval)

    def is_running(self) -> bool:
        return self._running
