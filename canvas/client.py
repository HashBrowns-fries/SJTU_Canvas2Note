import requests
from pathlib import Path
from tqdm import tqdm
from config import BASE_URL, TOKEN, DOWNLOAD_DIR, DOC_EXTENSIONS, VIDEO_EXTENSIONS


class CanvasClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {token}"

    def _get_all(self, endpoint: str, **params) -> list:
        results, page = [], 1
        params.setdefault("per_page", 100)
        while True:
            r = self.session.get(
                f"{self.base_url}{endpoint}",
                params={**params, "page": page},
                timeout=30,
            )
            r.raise_for_status()
            batch = r.json()
            if not batch:
                break
            results.extend(batch)
            page += 1
        return results

    # ── 课程 ──────────────────────────────────────────────────────────────
    def list_courses(self) -> list[dict]:
        return self._get_all(
            "/api/v1/courses",
            include=["teachers", "term"],
            enrollment_state="active",
        )

    # ── 文件 ──────────────────────────────────────────────────────────────
    def list_course_files(self, course_id: int) -> list[dict]:
        return self._get_all(f"/api/v1/courses/{course_id}/files")

    def list_folder_files(self, folder_id: int) -> list[dict]:
        return self._get_all(f"/api/v1/folders/{folder_id}/files")

    def list_course_folders(self, course_id: int) -> list[dict]:
        return self._get_all(f"/api/v1/courses/{course_id}/folders")

    # ── 视频 ──────────────────────────────────────────────────────────────
    def list_media_objects(self, course_id: int) -> list[dict]:
        return self._get_all(f"/api/v1/courses/{course_id}/media_objects")

    def get_media_sources(self, media_id: str) -> list[dict]:
        r = self.session.get(
            f"{self.base_url}/api/v1/media_objects/{media_id}",
            timeout=30,
        )
        r.raise_for_status()
        return r.json().get("media_sources", [])

    # ── 下载 ──────────────────────────────────────────────────────────────
    def download(self, url: str, save_path: Path) -> Path:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        if save_path.exists():
            print(f"  [skip] {save_path.name} 已存在")
            return save_path

        with self.session.get(url, stream=True, timeout=60) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            with open(save_path, "wb") as f, tqdm(
                total=total, unit="B", unit_scale=True, desc=save_path.name, leave=False
            ) as bar:
                for chunk in r.iter_content(chunk_size=65536):
                    f.write(chunk)
                    bar.update(len(chunk))
        return save_path

    # ── 便捷方法：下载课程所有文档和视频 ──────────────────────────────────
    def download_course_docs(self, course_id: int, course_name: str) -> list[Path]:
        dest = DOWNLOAD_DIR / course_name
        dest.mkdir(parents=True, exist_ok=True)
        files = self.list_course_files(course_id)
        saved = []
        for f in files:
            ext = Path(f["display_name"]).suffix.lower()
            if ext in DOC_EXTENSIONS:
                path = self.download(f["url"], dest / f["display_name"])
                saved.append(path)
        return saved

    def download_course_videos(self, course_id: int, course_name: str) -> list[Path]:
        dest = DOWNLOAD_DIR / course_name
        dest.mkdir(parents=True, exist_ok=True)
        media_objects = self.list_media_objects(course_id)
        saved = []
        for obj in media_objects:
            sources = self.get_media_sources(obj["media_id"])
            mp4 = next(
                (s for s in sources if "mp4" in s.get("content_type", "")),
                None,
            )
            if not mp4:
                print(f"  [warn] 无 mp4 源: {obj.get('title', obj['media_id'])}")
                continue
            title = obj.get("title") or obj["media_id"]
            safe_name = "".join(c if c.isalnum() or c in " ._-" else "_" for c in title)
            path = self.download(mp4["url"], dest / f"{safe_name}.mp4")
            saved.append(path)
        return saved
