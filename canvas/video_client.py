"""
SJTU 课堂录屏下载客户端（完全对齐 CanvasHelper 逻辑）

CanvasHelper 核心流程：
  1. 前端存储 ja_auth_cookie（Cookie 值，不含 JAAuthCookie= 前缀）
  2. 后端 config.ja_auth_cookie 直接注入到 session
  3. attach_ja_auth_cookie: 把 JAAuthCookie=value 注入到 jaccount.sjtu.edu.cn 和 my.sjtu.edu.cn
  4. 调用 login_video_website：GET courses.sjtu.edu.cn/app/oauth/2.0/login?login_type=outer
     - 若最终 URL 含 jaccount → 登录失败
     - 否则成功，提取 courses.sjtu.edu.cn 上的全部 cookies 作为 video_cookies
  5. 用 Canvas Token 从 Canvas LTI tool 获取 tokenId → 换视频 API Token
  6. 调用 findVodVideoList 列录屏
  7. download_video: 多线程 Range 并行下载
"""
import re
import json
import base64
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

# ── Constants ───────────────────────────────────────────────────────────────────

CANVAS_BASE     = "https://oc.sjtu.edu.cn"
COURSES_BASE    = "https://courses.sjtu.edu.cn"
V_BASE          = "https://v.sjtu.edu.cn"
JACCOUNT_BASE   = "https://jaccount.sjtu.edu.cn"
MY_SJTU         = "https://my.sjtu.edu.cn/ui/appmyinfo"
MY_SJTU_ACCOUNT = "https://my.sjtu.edu.cn/api/account"
AUTH_URL        = f"{JACCOUNT_BASE}/jaccount"
VIDEO_LOGIN_URL = f"{COURSES_BASE}/app/oauth/2.0/login?login_type=outer"
VIDEO_OAUTH_KEY_URL = (
    f"{COURSES_BASE}/app/vodvideo/vodVideoPlay.d2j"
    f"?ssoCheckToken=ssoCheckToken&refreshToken=&accessToken=&userId=&"
)

LTI_TOOL_ID     = 8329    # Canvas external_tool ID for video platform
VIDEO_CHUNK     = 4 * 1024 * 1024   # 4 MB


@dataclass
class VideoPlayInfo:
    id: str = ""          # 该片段的 id
    name: str = ""        # 显示名称（含后缀）
    index: int = 0        # 0=主屏幕，>0=录屏轨道
    rtmp_url_hdv: str = ""


@dataclass
class VideoInfo:
    id: str = ""
    title: str = ""
    duration: int = 0
    plays: list[VideoPlayInfo] = field(default_factory=list)  # 所有片段
    rtmp_url_hdv: str = ""   # 兼容旧代码，默认取录屏轨道（index>0 的第一个）


@dataclass
class CanvasVideo:
    id: str = ""
    title: str = ""
    duration: int = 0
    thumbnail: str = ""
    size: int = 0
    cour_id: str = ""   # 用于 PPT 下载的内部 ID


@dataclass
class VideoDownloadProgress:
    uuid: str
    processed: int
    total: int


class SJTUVideoClient:
    """
    完全对齐 CanvasHelper 的录屏下载客户端

    使用步骤：
      1. init_with_cookie(ja_auth_cookie)   ← 直接注入 Cookie
      2. login_video_website()              ← 验证 Cookie 有效性，保存 video_cookies
      3. bind_canvas_course(course_id)      ← LTI 认证，换 tokenId → video_token
      4. list_videos(course_id)              ← 列出录屏
      5. download_video(...)                ← 下载
    """

    def __init__(self, ja_auth_cookie: str = "", canvas_token: str = ""):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        self._ja_auth_cookie = ja_auth_cookie
        self.canvas_token = canvas_token

        # 运行时状态
        self._video_token: str | None = None
        self._canvas_course_id: str | None = None
        self._video_cookies: str | None = None   # 登录后从 courses.sjtu.edu.cn 提取
        self._oauth_consumer_key: str | None = None

    # ─────────────────────────────────────────────────────────────────────────────
    # Step 1: 注入 JAAuthCookie（对齐 CanvasHelper attach_ja_auth_cookie）
    # ─────────────────────────────────────────────────────────────────────────────

    def _attach_ja_auth_cookie(self) -> None:
        """把 JAAuthCookie=value 注入到 jaccount 和 my.sjtu 域名"""
        cookie_str = f"JAAuthCookie={self._ja_auth_cookie}"
        for url in [AUTH_URL, MY_SJTU]:
            self.session.cookies.set(
                "JAAuthCookie", self._ja_auth_cookie,
                domain=urllib.parse.urlparse(url).netloc,
                path="/",
            )

    # ─────────────────────────────────────────────────────────────────────────────
    # Step 2: 登录 Canvas（对齐 CanvasHelper login_canvas_website）
    # ─────────────────────────────────────────────────────────────────────────────

    def login_canvas_website(self) -> bool:
        """登录 oc.sjtu.edu.cn（OpenID Connect → jAccount → 回到 Canvas）"""
        self._attach_ja_auth_cookie()
        try:
            resp = self.session.get("https://oc.sjtu.edu.cn/login/openid_connect",
                                    timeout=15, allow_redirects=True)
            final_url = resp.url
            if "jaccount" in final_url.lower():
                print(f"[Canvas 登录] 重定向到 jAccount: {final_url[:80]}")
                return False
            print("[Canvas 登录] 成功")
            return True
        except Exception as e:
            print(f"[Canvas 登录] 失败: {e}")
            return False

    # ─────────────────────────────────────────────────────────────────────────────
    # Step 2b: 登录视频平台（对齐 CanvasHelper login_video_website）
    # ─────────────────────────────────────────────────────────────────────────────

    def login_video_website(self) -> bool:
        """
        对应 CanvasHelper: login_video_website()
          - attach_ja_auth_cookie → 预热 session
          - GET VIDEO_LOGIN_URL
          - 若最终 URL 含 jaccount → 失败
          - 否则：提取 courses.sjtu.edu.cn 上所有 cookies，作为 video_cookies 保存
        返回: True=成功, False=失败
        """
        self._attach_ja_auth_cookie()

        # 预热 SSO
        self.session.get(MY_SJTU, timeout=15)

        resp = self.session.get(VIDEO_LOGIN_URL, timeout=15, allow_redirects=True)

        # 重定向到 jaccount → 登录失败
        final_url = resp.url
        if "jaccount" in final_url.lower():
            print(f"[错误] 视频平台重定向到 jaccount: {final_url[:80]}")
            return False

        # 成功：提取 courses.sjtu.edu.cn 上的所有 cookies
        jar = requests.cookies.RequestsCookieJar()
        for domain in ["courses.sjtu.edu.cn", "v.sjtu.edu.cn", "jaccount.sjtu.edu.cn"]:
            jar.update(self.session.cookies)
        self._video_cookies = "; ".join(
            f"{c.name}={c.value}" for c in self.session.cookies
            if domain in (c.domain or "")
        )

        # 获取 OAuth Consumer Key（用于直接访问视频）
        self._oauth_consumer_key = self._get_oauth_consumer_key()
        print(f"[视频平台] 登录成功 | OAuth Key: {self._oauth_consumer_key or '未找到'}")
        return True

    def _get_oauth_consumer_key(self) -> str | None:
        """从 courses.sjtu.edu.cn 页面获取 OAuth Consumer Key"""
        try:
            resp = self.session.get(VIDEO_OAUTH_KEY_URL, timeout=15)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            meta = soup.find("meta", {"id": "xForSecName"})
            if not meta:
                return None
            value = meta.get("vaule") or meta.get("value")
            if not value:
                return None
            return base64.b64decode(value).decode()
        except Exception as e:
            print(f"[警告] OAuth Key 获取失败: {e}")
            return None

    # ─────────────────────────────────────────────────────────────────────────────
    # Step 3: Canvas LTI → 获取视频 API Token（对齐 get_canvas_course_id_token）
    # ─────────────────────────────────────────────────────────────────────────────

    def _get_form_data(self, url: str, action_url: str) -> dict | None:
        """从 HTML 页面提取指定 action URL 的表单的 name=value"""
        resp = self.session.get(url, timeout=20)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        # 找 action 属性匹配 target_url 的表单
        form = soup.find("form", action=action_url)
        if not form:
            # Fallback: 找第一个表单
            form = soup.find("form")
        if not form:
            return None
        return {
            inp.get("name"): inp.get("value", "")
            for inp in form.find_all("input")
            if inp.get("name")
        }

    def _get_form_data_from_response(self, html: str, action_url: str) -> dict | None:
        """从 HTML 中提取指定 action URL 的表单"""
        soup = BeautifulSoup(html, "html.parser")
        # 精确匹配 action 属性
        form = soup.find("form", action=action_url)
        if not form:
            # Fallback: 第一个表单
            form = soup.find("form")
        if not form:
            return None
        return {
            inp.get("name"): inp.get("value", "")
            for inp in form.find_all("input")
            if inp.get("name")
        }

    def bind_canvas_course(self, course_id: int) -> None:
        """
        对应 CanvasHelper: get_token_id() → get_canvas_course_id_token_by_token_id()

        流程：
          1. GET oc.sjtu.edu.cn/courses/{id}/external_tools/8329 → 提取 LTI 表单
          2. POST v.sjtu.edu.cn/.../oidc/login_initiations → 提交表单1
          3. 从结果页面提取第二个表单
          4. POST v.sjtu.edu.cn/.../lti3/lti3Auth/ivs → 提交表单2，禁止自动重定向
          5. 从 Location header 提取 tokenId
          6. GET v.sjtu.edu.cn/.../getAccessTokenByTokenId?tokenId=xxx → 拿 video_token + canvasCourseId
        """
        oidc_url = f"{V_BASE}/jy-application-canvas-sjtu/oidc/login_initiations"

        # Step 0: 确保 Canvas 会话已认证（对齐 CanvasHelper login_canvas_website）
        self.login_canvas_website()

        # Step 1: 从 Canvas LTI tool 获取表单（精确找 action=oidc_url 的表单）
        lti_url = f"{CANVAS_BASE}/courses/{course_id}/external_tools/{LTI_TOOL_ID}"
        form1 = self._get_form_data(lti_url, oidc_url)
        if not form1:
            raise RuntimeError(f"无法从 {lti_url} 获取 LTI 表单")
        print(f"[DEBUG] form1 keys: {list(form1.keys())}")

        # Step 2: 提交 OIDC 表单（允许自动重定向，follow 到结果页面）
        resp = self.session.post(oidc_url, data=form1, timeout=20, allow_redirects=True)
        print(f"[DEBUG] oidc resp status={resp.status_code}, url={resp.url}")

        # Step 3: 从结果页面提取 LTI3 表单
        lti3_action = f"{V_BASE}/jy-application-canvas-sjtu/lti3/lti3Auth/ivs"
        form2 = self._get_form_data_from_response(resp.text, lti3_action)
        if not form2:
            raise RuntimeError("无法获取 LTI3 认证表单")
        print(f"[DEBUG] form2 keys: {list(form2.keys())}")

        # Step 4: 提交 LTI3 表单，禁止重定向 → 从 header 取 Location
        resp2 = self.session.post(lti3_action, data=form2, timeout=20, allow_redirects=False)
        print(f"[DEBUG] lti3 resp status={resp2.status_code}, headers={dict(resp2.headers)}")
        location = resp2.headers.get("Location", "")
        if not location:
            # 打印响应体用于调试
            print(f"[DEBUG] lti3 body (first 500): {resp2.text[:500]}")
            raise RuntimeError(f"LTI3 响应无 Location header")

        # 从 location 提取 tokenId（可能在 query 或 fragment 中）
        parsed = urllib.parse.urlparse(location)
        params = dict(urllib.parse.parse_qsl(parsed.query))
        if "tokenId" not in params:
            # 可能是 fragment: https://v.sjtu.edu.cn/jy.../#/path?tokenId=xxx
            frag_params = dict(urllib.parse.parse_qsl(parsed.fragment.lstrip("/")))
            # fragment 可能以 "/ivsModules/index?tokenId=xxx" 形式存在
            for part in parsed.fragment.split("?"):
                frag_params.update(dict(urllib.parse.parse_qsl(part)))
            params.update(frag_params)
        token_id = params.get("tokenId")
        if not token_id:
            raise RuntimeError(f"无法从 Location 提取 tokenId: {location}")
        print(f"[DEBUG] tokenId={token_id}")

        # Step 5: 换 video_token + canvas_course_id
        token_url = f"{V_BASE}/jy-application-canvas-sjtu/lti3/getAccessTokenByTokenId?tokenId={token_id}"
        resp3 = self.session.get(token_url, timeout=20)
        resp3.raise_for_status()
        data = resp3.json()
        self._video_token = data["data"]["token"]
        self._canvas_course_id = data["data"]["params"]["courId"]
        print(f"[视频 Token] 获取成功 | course_id={self._canvas_course_id}")

    # ─────────────────────────────────────────────────────────────────────────────
    # Step 4: 视频 API
    # ─────────────────────────────────────────────────────────────────────────────

    def _video_headers(self) -> dict:
        return {
            "token": self._video_token or "",
            "Referer": f"{V_BASE}/jy-application-canvas-sjtu-ui/",
        }

    def list_videos(self, course_id: int) -> list[CanvasVideo]:
        """列出某个 Canvas 课程的课堂录屏"""
        # 每个课程都需要单独绑定以获取对应的 canvas_course_id
        self.bind_canvas_course(course_id)

        # 用绑定后的 canvas_course_id（可能与 Canvas course_id 不同）
        cid = urllib.parse.quote(self._canvas_course_id or str(course_id), safe="")
        url = f"{V_BASE}/jy-application-canvas-sjtu/directOnDemandPlay/findVodVideoList"
        resp = self.session.post(
            url,
            headers=self._video_headers(),
            json={"canvasCourseId": cid},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        videos = []
        records = data.get("data", {}) or {}
        for r in records.get("records", []):
            # 从上课时间计算时长（秒）
            duration = 0
            begin = r.get("courseBeginTime", "") or ""
            end = r.get("courseEndTime", "") or ""
            if begin and end:
                try:
                    from datetime import datetime
                    d1 = datetime.strptime(begin, "%Y-%m-%d %H:%M:%S")
                    d2 = datetime.strptime(end, "%Y-%m-%d %H:%M:%S")
                    duration = int((d2 - d1).total_seconds())
                except Exception:
                    pass
            videos.append(CanvasVideo(
                id=str(r.get("videoId", "") or ""),
                title=r.get("videoName", "") or "",
                duration=duration,
                thumbnail=r.get("videImgUrl", "") or "",
                size=0,
                cour_id=str(r.get("courId", "") or ""),
            ))
        return videos

    def get_ppt_slides(self, cour_id: str) -> list[dict]:
        """获取某节课的 PPT 幻灯片列表"""
        url = (f"{V_BASE}/jy-application-canvas-sjtu/directOnDemandPlay"
               f"/vod-analysis/query-ppt-slice-es?ivsVideoId={cour_id}")
        resp = self.session.get(url, headers=self._video_headers(), timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data.get("data") or []

    def get_video_info(self, video_id: str, video_title: str = "") -> VideoInfo:
        """获取单个视频的下载信息（所有播放片段）"""
        url = f"{V_BASE}/jy-application-canvas-sjtu/directOnDemandPlay/getVodVideoInfos"
        resp = self.session.post(
            url,
            headers=self._video_headers(),
            data={"id": video_id, "playTypeHls": "true", "isAudit": "true"},
            timeout=30,
        )
        resp.raise_for_status()
        info = resp.json().get("data", {})

        # title 优先用传入的名称（来自视频列表），其次用 API 返回的
        title = video_title or info.get("title") or ""

        # 解析所有播放片段
        play_list: list[VideoPlayInfo] = []
        vo_list = info.get("videoPlayResponseVoList") or []
        for idx, p in enumerate(vo_list):
            part_suffix = "_录屏" if idx > 0 else ""
            suffix = f"_{idx}.mp4" if idx > 2 else ".mp4"
            play_list.append(VideoPlayInfo(
                id=str(p.get("id", "")),
                name=f"{title}{part_suffix}{suffix}",
                index=idx,
                rtmp_url_hdv=p.get("rtmpUrlHdv", "") or "",
            ))

        # 兼容旧字段：默认取录屏轨道（index>0 的第一个）
        rtmp = ""
        screen_recordings = [p for p in play_list if p.index > 0]
        if screen_recordings:
            rtmp = screen_recordings[0].rtmp_url_hdv
        elif play_list:
            rtmp = play_list[0].rtmp_url_hdv

        return VideoInfo(
            id=video_id,
            title=title,
            duration=int(info.get("duration", 0) or 0),
            plays=play_list,
            rtmp_url_hdv=rtmp,
        )

    # ─────────────────────────────────────────────────────────────────────────────
    # Step 5: 下载
    # ─────────────────────────────────────────────────────────────────────────────

    def _parse_range_support(self, resp: requests.Response) -> tuple[int, bool]:
        supports_range = (
            resp.status_code == 206
            or "content-range" in resp.headers
            or resp.headers.get("accept-ranges", "none") == "bytes"
        )
        total = 0
        cr = resp.headers.get("content-range", "")
        if cr and "/" in cr:
            try:
                total = int(cr.split("/")[-1])
            except ValueError:
                pass
        if total == 0:
            total = int(resp.headers.get("content-length", 0))
        return total, supports_range

    def _download_single_stream(
        self,
        url: str,
        save_path: Path,
        progress: Callable[[int, int], None] | None,
    ) -> Path:
        resp = self.session.get(url, stream=True, timeout=60,
                                headers={"Referer": COURSES_BASE})
        resp.raise_for_status()
        total, _ = self._parse_range_support(resp)
        downloaded = 0
        with open(save_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=65536):
                f.write(chunk)
                downloaded += len(chunk)
                if progress and total:
                    progress(downloaded, total)
        return save_path

    def _download_parallel(
        self,
        url: str,
        save_path: Path,
        total: int,
        progress: Callable[[int, int], None] | None,
    ) -> Path:
        nproc = 8
        chunk_size = max(total // nproc, 1)

        def download_chunk(i: int) -> bytes:
            begin = i * chunk_size
            end = total - 1 if i == nproc - 1 else (i + 1) * chunk_size - 1
            resp = self.session.get(
                url,
                headers={"Range": f"bytes={begin}-{end}", "Referer": COURSES_BASE},
                timeout=60,
            )
            resp.raise_for_status()
            return resp.content

        parts: list[bytes | None] = [None] * nproc
        downloaded_total = 0

        with ThreadPoolExecutor(max_workers=nproc) as ex:
            futures = [ex.submit(download_chunk, i) for i in range(nproc)]
            for fut in futures:
                i, data = futures.index(fut), fut.result()
                # Re-do properly with index tracking
                pass

        # Proper thread-safe result collection
        results: list[tuple[int, bytes]] = []
        with ThreadPoolExecutor(max_workers=nproc) as ex:
            futures = []
            for i in range(nproc):
                fut = ex.submit(download_chunk, i)
                futures.append((i, fut))

            downloaded_total = 0
            for i, fut in futures:
                data = fut.result()
                results.append((i, data))
                downloaded_total += len(data)
                if progress:
                    progress(downloaded_total, total)

        results.sort(key=lambda x: x[0])
        with open(save_path, "wb") as f:
            for _, data in results:
                f.write(data)
        return save_path

    def download_video(
        self,
        video_id: str,
        save_path: Path,
        title: str = "",
        play_index: int = -1,
        progress_handler: Callable[[VideoDownloadProgress], None] | None = None,
    ) -> Path:
        save_path = Path(save_path)
        save_path.parent.mkdir(parents=True, exist_ok=True)

        if save_path.exists():
            print(f"  [skip] {save_path.name} 已存在")
            return save_path

        info = self.get_video_info(video_id, title)
        if not info.plays:
            raise RuntimeError(f"视频 {video_id} 无可用片段")

        # 选择片段：-1=自动选录屏轨道，>=0 用指定索引
        if play_index < 0:
            screen_recs = [p for p in info.plays if p.index > 0]
            play = screen_recs[0] if screen_recs else info.plays[0]
        else:
            play = next((p for p in info.plays if p.index == play_index), info.plays[0])

        if not play.rtmp_url_hdv:
            raise RuntimeError(f"视频片段 {play_index} 无高清地址")

        display_title = title or play.name or info.title or video_id
        print(f"  [视频] {display_title}")

        def progress(processed: int, total: int):
            if progress_handler:
                progress_handler(VideoDownloadProgress(uuid=video_id, processed=processed, total=total))

        # 探测 Range 支持
        probe = self.session.get(
            play.rtmp_url_hdv,
            headers={"Range": "bytes=0-0", "Referer": COURSES_BASE},
            timeout=30,
        )
        total, supports_range = self._parse_range_support(probe)
        print(f"  [大小] {total / 1024**2:.1f} MB | Range: {'是' if supports_range else '否'}")

        if supports_range and total > 0:
            return self._download_parallel(play.rtmp_url_hdv, save_path, total, progress)
        else:
            return self._download_single_stream(play.rtmp_url_hdv, save_path, progress)

    # ─────────────────────────────────────────────────────────────────────────────
    # 便捷方法
    # ─────────────────────────────────────────────────────────────────────────────

    def init_with_cookie(self, ja_auth_cookie: str) -> None:
        """直接用 JAAuthCookie 值初始化 session（跳过登录流程）"""
        self._ja_auth_cookie = ja_auth_cookie
        self._attach_ja_auth_cookie()
        print(f"[Cookie] JAAuthCookie 已注入（值长度={len(ja_auth_cookie)}）")

    def login(self, ja_auth_cookie: str = "", canvas_token: str = "") -> bool:
        """
        一键初始化：对齐 CanvasHelper login_video_website
        只需 ja_auth_cookie，Canvas Token 由 list_videos 用 Canvas API 自行获取
        """
        self.canvas_token = canvas_token or self.canvas_token
        if not ja_auth_cookie:
            print("[错误] ja_auth_cookie 为空")
            return False

        self.init_with_cookie(ja_auth_cookie)
        return self.login_video_website()