"""
translate.sjtu.edu.cn AI 音视频转录客户端

依赖：requests, python-dotenv
认证：浏览器登录后复制 Cookies（JSESSIONID + keepalive）
"""

from __future__ import annotations

import os
import re
import time
import logging
from pathlib import Path
from dataclasses import dataclass
from typing import Callable

import requests
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

requests.packages.urllib3.disable_warnings()

# ── 常量 ─────────────────────────────────────────────────────────────
TRANSLATE_BASE = "https://translate.sjtu.edu.cn/ai"
UPLOAD_URL     = f"{TRANSLATE_BASE}/file/audioVideo/upload"
LIST_URL       = f"{TRANSLATE_BASE}/file/audioVideo/list"
DELETE_URL     = f"{TRANSLATE_BASE}/file/audioVideo/delete"

AUDIO_TYPES = {"mp3", "wav", "m4a", "aac"}
VIDEO_TYPES = {"mp4", "m4v", "mov", "avi"}
ALL_TYPES   = AUDIO_TYPES | VIDEO_TYPES

MAX_AUDIO_SIZE = 500 * 1024 * 1024
MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024

# errno "0" = 成功
def _ok(data: dict) -> bool:
    return str(data.get("errno", "")) == "0"


@dataclass
class TranscribeFile:
    id:            str
    file_name:     str
    file_type:     str
    original_text: str = ""
    deal_mark:     str = "-1"   # -1=待处理 0=加载中 1=转录中 2=完成 3=错误
    del_mark:      str = "N"
    created_time:  str = ""

    @property
    def is_done(self)  -> bool: return self.deal_mark == "2"
    @property
    def is_error(self) -> bool: return self.deal_mark == "3"

    @classmethod
    def from_dict(cls, d: dict) -> "TranscribeFile":
        return cls(
            id=d["id"],
            file_name=d.get("fileName", ""),
            file_type=d.get("fileType", ""),
            original_text=d.get("originalText") or d.get("text") or "",
            deal_mark=str(d.get("dealMark", "-1")),
            del_mark=d.get("delMark", "N"),
            created_time=d.get("createdTime", ""),
        )


def _parse_cookie_header(cookie_str: str) -> dict[str, str]:
    """
    解析 Cookie 字符串，正确处理带引号的值。
    例: "JSESSIONID=abc; keepalive='xyz'" → {"JSESSIONID": "abc", "keepalive": "xyz"}
    浏览器 DevTools 复制的 keepalive 通常带首尾单引号，去掉它们。
    """
    result = {}
    for part in cookie_str.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, _, value = part.partition("=")
        key = key.strip()
        value = value.strip()
        # 去除首尾单引号（DevTools 复制时 keepalive 带首尾单引号，如 'abc=xyz'）
        if value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        elif value.startswith("'"):
            value = value[1:]
        result[key] = value
    return result


class TranslateClient:
    def __init__(self, cookie_str: str | None = None):
        if cookie_str is None:
            cookie_str = os.getenv("JA_SESSION_COOKIE", "")

        self.session = requests.Session()
        self.session.headers["User-Agent"] = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/147.0.0.0 Safari/537.36"
        )
        self.session.headers["Referer"] = "https://translate.sjtu.edu.cn/ai/ui/transcribe"
        self.session.headers["Accept"] = "application/json, text/plain, */*"

        # 直接设置 Cookie header，不走 CookieJar（避免同名冲突）
        cookie_header = "; ".join(
            f"{k}={v}" for k, v in _parse_cookie_header(cookie_str).items()
        )
        self.session.headers["Cookie"] = cookie_header

    def is_authenticated(self) -> bool:
        r = self.session.get(f"{TRANSLATE_BASE}/ui/transcribe", verify=False, timeout=15)
        return r.status_code == 200 and "jaccount" not in r.url.lower()

    def upload(self, file_path: str | Path) -> str:
        path = Path(file_path)
        suffix = path.suffix.lstrip(".").lower()
        if suffix not in ALL_TYPES:
            raise ValueError(f"不支持格式: {suffix}，支持: {', '.join(sorted(ALL_TYPES))}")
        size = path.stat().st_size
        limit = MAX_VIDEO_SIZE if suffix in VIDEO_TYPES else MAX_AUDIO_SIZE
        if size > limit:
            raise ValueError(f"文件过大: {size/1024/1024:.0f} MB > {limit/1024/1024:.0f} MB")
        mime_map = {
            "mp3": "audio/mpeg",  "wav": "audio/wav",   "m4a": "audio/mp4",
            "aac": "audio/aac",   "mp4": "video/mp4",   "m4v": "video/mp4",
            "mov": "video/quicktime", "avi": "video/x-msvideo",
        }
        with open(path, "rb") as f:
            r = self.session.post(
                UPLOAD_URL,
                files={"file": (path.name, f, mime_map.get(suffix, "application/octet-stream"))},
                verify=False, timeout=300,
            )
        if r.status_code == 401:
            raise Exception("上传 HTTP 401: Cookie 已失效，请重新登录 translate.sjtu.edu.cn")
        if r.status_code != 200:
            raise Exception(f"上传 HTTP {r.status_code}: {r.text[:200]}")
        data = r.json()
        if not _ok(data):
            raise Exception(f"上传失败: {data.get('msg', data)}")
        # data 为文件名，UUID 即文件名去掉扩展名
        return Path(data["data"]).stem

    def list_files(self) -> list[TranscribeFile]:
        r = self.session.get(LIST_URL, verify=False, timeout=15)
        if r.status_code == 401:
            raise Exception("文件列表 HTTP 401: Cookie 已失效")
        data = r.json()
        if not _ok(data):
            raise Exception(f"列表获取失败: {data.get('msg', data)}")
        return [TranscribeFile.from_dict(d) for d in data.get("data", [])]

    def get_result(self, file_id: str) -> str:
        for f in self.list_files():
            if f.id == file_id:
                if f.is_error:
                    raise Exception("转录失败，请重新上传")
                if not f.is_done:
                    return ""
                return f.original_text
        raise KeyError(f"未找到文件 id={file_id}")

    def wait_until_done(self, file_id: str, interval: int = 5, max_wait: int = 3600,
                        progress: Callable[[str], None] | None = None) -> str:
        """
        轮询直到转录完成，返回原文。
        progress(status) 会在每次轮询时被调用。
        """
        waited = 0
        while waited < max_wait:
            result = self.get_result(file_id)
            if result:
                return result
            status = f"转录中... ({waited}s)"
            if progress:
                progress(status)
            time.sleep(interval)
            waited += interval
        raise TimeoutError(f"转录超时（{max_wait}s），请稍后重试")

    def delete(self, file_id: str) -> None:
        r = self.session.post(
            DELETE_URL,
            data={"id": file_id},
            verify=False, timeout=15,
        )
        if r.status_code != 200:
            raise Exception(f"删除失败 HTTP {r.status_code}: {r.text[:200]}")

    def upload_and_wait(self, file_path: str | Path, interval: int = 5,
                       max_wait: int = 3600,
                       progress: Callable[[str], None] | None = None) -> str:
        """
        上传 + 轮询，返回转录文本。
        适用于一次性任务（上传 → 等待 → 返回结果）。
        """
        file_id = self.upload(file_path)
        return self.wait_until_done(file_id, interval=interval,
                                   max_wait=max_wait, progress=progress)
