"""
jAccount QR code login for SJTU authentication.

Flow:
  1. GET /jaccount/qrcode  → parse UUID + get session cookie
  2. Show QR image to user
  3. Poll /jaccount/qrstatus?uuid=xxx → wait for scan
  4. On success → follow redirect → get JAAuthCookie
"""
import re
import time
import requests
from dataclasses import dataclass
from typing import Optional

JACCOUNT_BASE = "https://jaccount.sjtu.edu.cn"

# Cookie names that Canvas2Note needs from the jAccount session
TARGET_COOKIES = ["JAAuthCookie", "JSESSIONID"]


@dataclass
class QRLoginSession:
    uuid: str
    qr_url: str
    cookies: dict
    status: str = "pending"       # pending | scanned | confirmed | expired | error
    cookie_str: str = ""          # final cookie string after success


def get_qr_code() -> Optional[QRLoginSession]:
    """
    Fetch jAccount QR code login page, extract UUID and session cookies.
    Returns QRLoginSession on success, None on failure.
    """
    sess = requests.Session()
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })

    try:
        # Step 1: Visit login page to get initial cookies
        login_url = f"{JACCOUNT_BASE}/jaccount/login"
        r = sess.get(login_url, timeout=10)
        r.raise_for_status()

        # Step 2: Request QR code page
        qr_url = f"{JACCOUNT_BASE}/jaccount/qrcode"
        r = sess.get(qr_url, timeout=10)
        r.raise_for_status()
        html = r.text

        # Step 3: Extract UUID from the page
        # jAccount QR page contains a UUID for this QR session
        uuid_match = re.search(r'uuid["\s:=]+["\']?([a-f0-9\-]{20,})["\']?', html, re.I)
        if not uuid_match:
            # Alternative: try to find it in JavaScript or a meta tag
            uuid_match = re.search(r'([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', html)
        if not uuid_match:
            # Try a looser pattern — jAccount sometimes uses shorter UUIDs
            uuid_match = re.search(r'uuid\s*=\s*["\']([^"\']{10,})["\']', html)

        if not uuid_match:
            return None

        uuid = uuid_match.group(1)

        # Step 4: Build QR image URL
        qr_img_url = f"{JACCOUNT_BASE}/jaccount/qrimg?uuid={uuid}"

        # Step 5: Collect cookies from this session
        cookies = dict(sess.cookies)

        return QRLoginSession(
            uuid=uuid,
            qr_url=qr_img_url,
            cookies=cookies,
        )

    except requests.RequestException:
        return None


def check_qr_status(session: QRLoginSession) -> QRLoginSession:
    """
    Poll jAccount to check if the QR code has been scanned.
    Updates session.status and session.cookie_str on success.
    """
    sess = requests.Session()
    sess.cookies.update(session.cookies)
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": f"{JACCOUNT_BASE}/jaccount/qrcode",
        "Accept": "application/json, text/plain, */*",
    })

    try:
        status_url = f"{JACCOUNT_BASE}/jaccount/qrstatus"
        r = sess.get(status_url, params={"uuid": session.uuid}, timeout=10)

        if r.status_code != 200:
            # Try alternative endpoint
            r = sess.get(
                f"{JACCOUNT_BASE}/jaccount/ajax/qrlogin",
                params={"uuid": session.uuid},
                timeout=10,
            )

        text = r.text.lower()

        # Parse status from response
        if any(kw in text for kw in ["confirmed", "success", '"status":1', '"status":"1"']):
            session.status = "confirmed"
            # Extract all cookies from the final session
            all_cookies = dict(sess.cookies)
            # Also include the original session cookies
            all_cookies.update(session.cookies)

            # Build cookie string for settings
            cookie_parts = []
            for name, value in all_cookies.items():
                cookie_parts.append(f"{name}={value}")
            # Also try to get cookies from the redirect response
            if r.history:
                for hist_resp in r.history:
                    for name, value in dict(hist_resp.cookies).items():
                        cookie_parts.append(f"{name}={value}")

            session.cookie_str = "; ".join(cookie_parts)

        elif any(kw in text for kw in ["scanned", "scan", "waiting", "pending"]):
            session.status = "scanned" if "scanned" in text else "pending"
        elif any(kw in text for kw in ["expired", "timeout", "invalid"]):
            session.status = "expired"
        else:
            session.status = "pending"

    except requests.RequestException:
        session.status = "error"

    return session


def get_jaauth_from_qr(session: QRLoginSession) -> str:
    """
    After QR confirmation, try to get the JAAuthCookie by
    visiting the my.sjtu.edu.cn portal which sets the cookie.
    """
    if session.status != "confirmed":
        return ""

    sess = requests.Session()
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    })

    # Parse cookies from the QR session
    for part in session.cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            name, _, value = part.partition("=")
            sess.cookies.set(name.strip(), value.strip())

    try:
        # Visit my.sjtu.edu.cn which should set JAAuthCookie
        r = sess.get("https://my.sjtu.edu.cn", timeout=10, allow_redirects=True)

        # Collect all cookies
        all_cookies = dict(sess.cookies)
        for hist in r.history:
            all_cookies.update(dict(hist.cookies))

        # Build final cookie string
        parts = [f"{k}={v}" for k, v in all_cookies.items()]
        return "; ".join(parts)

    except requests.RequestException:
        return session.cookie_str
