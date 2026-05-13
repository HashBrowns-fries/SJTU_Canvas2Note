"""
jAccount QR code login via WebSocket.

Flow:
  1. OAuth redirect chain → landing at jaccount/jalogin page
  2. Parse UUID + WebSocket sub token from JS
  3. Connect WebSocket to /jaccount/sub/{token}, send UPDATE_QR_CODE
  4. Receive ts+sig → build QR image URL
  5. Keep WebSocket alive in bg thread, watch for LOGIN message
  6. On LOGIN → follow redirect → extract cookies
"""
import re
import json
import time
import threading
import requests
import websocket
from dataclasses import dataclass, field
from typing import Optional, Callable
from urllib.parse import urlparse


@dataclass
class QRLoginSession:
    uuid: str = ""
    qr_url: str = ""
    cookies: dict = field(default_factory=dict)
    status: str = "pending"       # pending | scanned | confirmed | expired | error
    cookie_str: str = ""
    _ws: Optional[websocket.WebSocket] = field(default=None, repr=False)
    _ws_thread: Optional[threading.Thread] = field(default=None, repr=False)


def _follow_redirects(sess, start_url, max_hops=10):
    url = start_url
    for _ in range(max_hops):
        r = sess.get(url, timeout=15, allow_redirects=False)
        if r.status_code == 200:
            return r
        if "Location" not in r.headers:
            break
        url = r.headers["Location"]
    return r


def get_qr_code() -> Optional[QRLoginSession]:
    """Initiate jAccount OAuth flow, return QR session with live WebSocket."""
    sess = requests.Session()
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })

    try:
        r = _follow_redirects(
            sess, "https://courses.sjtu.edu.cn/app/oauth/2.0/login?login_type=outer"
        )
        if r.status_code != 200:
            return None

        html = r.text

        uuid_match = re.search(r'uuid:\s*"([a-f0-9\-]{30,})"', html)
        sub_match = re.search(r'/jaccount/sub/([a-f0-9\-]{30,})', html)
        if not uuid_match or not sub_match:
            return None

        uuid = uuid_match.group(1)
        sub_token = sub_match.group(1)

        parsed = urlparse(r.url)
        ws_url = f"wss://{parsed.netloc}/jaccount/sub/{sub_token}"

        cookie_dict = {}
        for c in sess.cookies:
            cookie_dict[c.name] = c.value

        # Connect WebSocket and get QR params
        cookie_header = "; ".join(f"{k}={v}" for k, v in cookie_dict.items())
        ws = websocket.create_connection(
            ws_url, timeout=10,
            header={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                               "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Cookie": cookie_header,
                "Origin": "https://jaccount.sjtu.edu.cn",
            },
        )

        ts, sig = "", ""
        ws.send(json.dumps({"type": "UPDATE_QR_CODE"}))
        ws.settimeout(5)
        try:
            msg = json.loads(ws.recv())
            if msg.get("type") == "UPDATE_QR_CODE":
                payload = msg.get("payload", {})
                ts = str(payload.get("ts", ""))
                sig = payload.get("sig", "")
        except websocket.WebSocketTimeoutException:
            pass

        qr_url = ""
        if ts and sig:
            qr_url = (
                f"https://jaccount.sjtu.edu.cn/jaccount/qrcode"
                f"?uuid={uuid}&ts={ts}&sig={sig}"
            )

        session = QRLoginSession(
            uuid=uuid,
            qr_url=qr_url,
            cookies=cookie_dict,
            _ws=ws,
        )

        # Start background listener for LOGIN / ERROR messages
        def _listen():
            ws.settimeout(60)
            try:
                while session.status in ("pending", "scanned"):
                    try:
                        data = ws.recv()
                        msg = json.loads(data)
                        msg_type = msg.get("type", "")

                        if msg_type == "LOGIN":
                            session.status = "confirmed"
                            # JS does: window.location.href = "expresslogin?uuid=xxx"
                            redirect_url = (
                                f"https://jaccount.sjtu.edu.cn/jaccount/"
                                f"expresslogin?uuid={session.uuid}"
                            )
                            # Follow redirect to get final cookies
                            _complete_login(session, redirect_url, cookie_dict)
                            break

                        elif msg_type == "SCANNED":
                            session.status = "scanned"

                        elif msg_type == "ERROR_MESSAGE":
                            pass  # keep waiting

                    except websocket.WebSocketTimeoutException:
                        if session.status == "pending":
                            continue
                        break
                    except Exception:
                        break
            finally:
                try:
                    ws.close()
                except Exception:
                    pass

        thread = threading.Thread(target=_listen, daemon=True)
        session._ws_thread = thread
        thread.start()

        return session

    except requests.RequestException:
        return None


def _complete_login(session: QRLoginSession, redirect_url: str, cookies: dict):
    """Follow the LOGIN redirect to get final session cookies."""
    sess = requests.Session()
    for k, v in cookies.items():
        sess.cookies.set(k, v)
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    })

    try:
        # Follow the expresslogin redirect
        r = sess.get(redirect_url, timeout=15, allow_redirects=True)

        # Collect all cookies
        cookie_dict = {}
        for c in sess.cookies:
            cookie_dict[c.name] = c.value
        for hist in r.history:
            for c in hist.cookies:
                cookie_dict[c.name] = c.value
        for k, v in cookies.items():
            cookie_dict[k] = v

        parts = [f"{k}={v}" for k, v in cookie_dict.items()]
        session.cookie_str = "; ".join(parts)

        # Also visit my.sjtu.edu.cn for JAAuthCookie specifically
        r2 = sess.get("https://my.sjtu.edu.cn", timeout=10, allow_redirects=True)
        for c in sess.cookies:
            cookie_dict[c.name] = c.value
        for hist in r2.history:
            for c in hist.cookies:
                cookie_dict[c.name] = c.value

        parts = [f"{k}={v}" for k, v in cookie_dict.items()]
        session.cookie_str = "; ".join(parts)

    except requests.RequestException:
        pass


def check_qr_status(session: QRLoginSession) -> QRLoginSession:
    """Return current session status (updated by bg thread)."""
    # The bg thread updates session.status and session.cookie_str
    # If WebSocket dies without LOGIN, mark as expired
    if session._ws_thread and not session._ws_thread.is_alive() and session.status == "pending":
        # Thread exited without confirmation — might be timeout or error
        pass  # keep as pending, let frontend decide when to retry
    return session
