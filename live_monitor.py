"""
Live stream QR monitor — wraps SJTUOldVideoClient's capture + detect.

Automatically fetches the computer screen stream (cdviChannelNum=7),
captures frames, and detects QR codes.
"""
import threading
import time
import queue
from typing import Callable, Optional

from canvas.video_client import SJTUOldVideoClient


class LiveQRMonitor:
    """
    Monitors a course's live screen stream for QR codes.

    Usage:
        monitor = LiveQRMonitor(course_id, live_id, ja_auth_cookie, on_qr)
        monitor.start()
        ...
        monitor.stop()
    """

    def __init__(
        self,
        course_id: int,
        live_id: str,
        ja_auth_cookie: str,
        on_qr_detected: Callable[[dict], None],
        check_interval: float = 3.0,
    ):
        self.course_id = course_id
        self.live_id = live_id
        self.cookie = ja_auth_cookie
        self.on_qr_detected = on_qr_detected
        self.check_interval = check_interval
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._client: Optional[SJTUOldVideoClient] = None
        self._screen_url: Optional[str] = None
        self._last_data = ""

    def start(self):
        if self._running:
            return

        # Init the old video client and get screen stream URL
        cfg = {}
        try:
            from config import _load_settings
            cfg = _load_settings()
        except Exception:
            pass
        cookie = self.cookie or cfg.get("ja_auth_cookie", "")

        self._client = SJTUOldVideoClient(ja_auth_cookie=cookie)
        urls = self._client.get_stream_urls(self.course_id, self.live_id)
        if not urls.screen_url:
            raise RuntimeError("无法获取电脑屏幕流地址 (cdviChannelNum=7)")

        self._screen_url = urls.screen_url
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _loop(self):
        while self._running:
            try:
                # Capture frame from screen stream
                frame_path = self._client.capture_frame(self._screen_url)
                if frame_path is None:
                    time.sleep(self.check_interval)
                    continue

                # Detect QR codes in the captured frame
                results = self._client.detect_qrcodes(frame_path)
                if results:
                    data = results[0]  # first QR code
                    if data != self._last_data:
                        self._last_data = data
                        self.on_qr_detected({
                            "type": "qr_detected",
                            "data": data,
                            "timestamp": time.time(),
                        })
                elif self._last_data:
                    # QR disappeared
                    self.on_qr_detected({
                        "type": "qr_cleared",
                        "timestamp": time.time(),
                    })
                    self._last_data = ""

            except Exception:
                pass

            time.sleep(self.check_interval)

    def get_screen_url(self) -> Optional[str]:
        return self._screen_url

    def is_running(self) -> bool:
        return self._running
