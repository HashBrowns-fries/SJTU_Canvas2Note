"""
jAccount QR code login via WebSocket-based QR flow.

Flow:
  1. OAuth redirect chain → landing at jaccount/jalogin page
  2. Parse UUID + WebSocket sub token from page JavaScript
  3. Connect WebSocket to /jaccount/sub/{token}, send UPDATE_QR_CODE
  4. Receive ts + sig, build QR image URL: /jaccount/qrcode?uuid=xxx&ts=xxx&sig=xxx
  5. Poll login status
  6. On confirm → extract cookies
"""
import re
import json
import time
import requests
import websocket
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class QRLoginSession:
    uuid: str = ""
    qr_url: str = ""
    cookies: dict = field(default_factory=dict)
    status: str = "pending"
    cookie_str: str = ""


def _follow_redirects(sess: requests.Session, start_url: str, max_hops: int = 10) -> requests.Response:
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
    """
    Initiate jAccount OAuth flow, connect WebSocket, get QR code URL.
    """
    sess = requests.Session()
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })

    try:
        # Step 1: Follow OAuth redirects to jAccount login page
        r = _follow_redirects(
            sess, "https://courses.sjtu.edu.cn/app/oauth/2.0/login?login_type=outer"
        )
        if r.status_code != 200:
            return None

        html = r.text

        # Step 2: Extract UUID and WebSocket sub token from page JS
        uuid_match = re.search(r'uuid:\s*"([a-f0-9\-]{30,})"', html)
        sub_match = re.search(r'/jaccount/sub/([a-f0-9\-]{30,})', html)

        if not uuid_match or not sub_match:
            return None

        uuid = uuid_match.group(1)
        sub_token = sub_match.group(1)

        # Step 3: WebSocket URL is /jaccount/sub/{token}
        from urllib.parse import urlparse
        parsed = urlparse(r.url)
        ws_url = f"wss://{parsed.netloc}/jaccount/sub/{sub_token}"

        # Step 4: Collect cookies
        cookie_dict = {}
        for c in sess.cookies:
            cookie_dict[c.name] = c.value

        # Step 5: Connect WebSocket to get ts + sig
        ts, sig = _ws_get_qr_params(ws_url, cookie_dict)

        # Step 6: Build QR image URL
        if ts and sig:
            qr_url = (
                f"https://jaccount.sjtu.edu.cn/jaccount/qrcode"
                f"?uuid={uuid}&ts={ts}&sig={sig}"
            )
        else:
            qr_url = ""

        return QRLoginSession(
            uuid=uuid,
            qr_url=qr_url,
            cookies=cookie_dict,
        )

    except requests.RequestException:
        return None


def _ws_get_qr_params(ws_url: str, cookies: dict) -> tuple:
    """
    Connect to jAccount WebSocket, send UPDATE_QR_CODE, receive ts + sig.
    Returns (ts, sig) or ("", "").
    """
    try:
        cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())

        ws = websocket.create_connection(
            ws_url,
            timeout=10,
            header={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                               "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Cookie": cookie_header,
                "Origin": "https://jaccount.sjtu.edu.cn",
            },
        )

        ws.send(json.dumps({"type": "UPDATE_QR_CODE"}))
        ws.settimeout(10)

        ts, sig = "", ""
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                data = ws.recv()
                msg = json.loads(data)
                if msg.get("type") == "UPDATE_QR_CODE":
                    payload = msg.get("payload", {})
                    ts = str(payload.get("ts", ""))
                    sig = payload.get("sig", "")
                    break
            except websocket.WebSocketTimeoutException:
                continue

        ws.close()
        return ts, sig

    except Exception:
        return "", ""


def check_qr_status(session: QRLoginSession) -> QRLoginSession:
    """Poll jAccount to check if QR code was scanned and confirmed."""
    sess = requests.Session()
    for k, v in session.cookies.items():
        sess.cookies.set(k, v)
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://jaccount.sjtu.edu.cn/jaccount/jalogin",
        "Accept": "application/json, text/javascript, */*; q=0.01",
    })

    try:
        r = sess.get(
            "https://jaccount.sjtu.edu.cn/jaccount/ajax/jalogin",
            params={"uuid": session.uuid},
            timeout=10,
        )
        text = r.text.lower()

        if any(kw in text for kw in ["success", "confirmed", '"retcode":0']):
            session.status = "confirmed"
            cookie_dict = {}
            for c in sess.cookies:
                cookie_dict[c.name] = c.value
            for k, v in session.cookies.items():
                cookie_dict[k] = v
            parts = [f"{k}={v}" for k, v in cookie_dict.items()]
            session.cookie_str = "; ".join(parts)

        elif "scanned" in text:
            session.status = "scanned"
        elif any(kw in text for kw in ["expired", "timeout", "invalid"]):
            session.status = "expired"

    except requests.RequestException:
        pass

    return session


def get_jaauth_from_qr(session: QRLoginSession) -> str:
    """After QR confirmation, visit my.sjtu.edu.cn to get the full cookie set."""
    if session.status != "confirmed" or not session.cookie_str:
        return session.cookie_str

    sess = requests.Session()
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    })

    for part in session.cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            name, _, value = part.partition("=")
            sess.cookies.set(name.strip(), value.strip())

    try:
        r = sess.get("https://my.sjtu.edu.cn", timeout=10, allow_redirects=True)
        cookie_dict = {}
        for c in sess.cookies:
            cookie_dict[c.name] = c.value
        for hist in r.history:
            for c in hist.cookies:
                cookie_dict[c.name] = c.value
        parts = [f"{k}={v}" for k, v in cookie_dict.items()]
        return "; ".join(parts)
    except requests.RequestException:
        return session.cookie_str
