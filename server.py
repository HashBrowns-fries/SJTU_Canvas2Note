"""FastAPI backend for Canvas2note web UI."""
import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import AsyncGenerator

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from canvas.client import CanvasClient
from config import (
    BASE_URL as DEFAULT_CANVAS_BASE,
    DOWNLOAD_DIR, NOTES_DIR, AUDIO_DIR,
    LLM_BASE_URL as DEFAULT_LLM_BASE,
    LLM_API_KEY  as DEFAULT_LLM_KEY,
    LLM_MODEL    as DEFAULT_LLM_MODEL,
)

app = FastAPI(title="Canvas2note")

# Settings persistence
SETTINGS_FILE = Path(__file__).parent / "settings.json"

DEFAULTS = {
    "canvas_base_url": DEFAULT_CANVAS_BASE,
    "canvas_token":    "",
    "ja_auth_cookie":  "",
    "llm_base_url":    DEFAULT_LLM_BASE,
    "llm_api_key":     DEFAULT_LLM_KEY,
    "llm_model":       DEFAULT_LLM_MODEL,
    "asr_model":       "base",
    "asr_device":      "cuda",
}

def _load_settings() -> dict:
    if SETTINGS_FILE.exists():
        return {**DEFAULTS, **json.loads(SETTINGS_FILE.read_text())}
    return DEFAULTS.copy()

def _save_settings(data: dict):
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))

def _cfg() -> dict:
    return _load_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory task store ───────────────────────────────────────────────────────
tasks: dict[str, dict] = {}  # task_id -> {status, progress, result, error}


def make_task(kind: str) -> str:
    tid = str(uuid.uuid4())[:8]
    tasks[tid] = {"id": tid, "kind": kind, "status": "pending", "progress": 0, "result": None, "error": None}
    return tid


# ═══════════════════════════════════════════════════════════════════════════════
# API — Courses
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/courses")
def list_courses():
    return canvas().list_courses()


@app.get("/api/courses/{course_id}/files")
def list_files(course_id: int):
    return canvas().list_course_files(course_id)


@app.get("/api/courses/{course_id}/videos")
def list_videos(course_id: int):
    return canvas().list_media_objects(course_id)


# ═══════════════════════════════════════════════════════════════════════════════
# API — Downloads
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# API — File Manager
# ═══════════════════════════════════════════════════════════════════════════════

import shutil
from datetime import datetime

DATA_ROOT = Path(__file__).parent / "data"
TEXT_EXTS  = {".md", ".txt", ".json", ".yaml", ".yml", ".xml", ".csv", ".log", ".py", ".js", ".ts"}
BIN_EXTS   = {".pdf", ".mp4", ".mov", ".avi", ".mkv", ".webm", ".mp3", ".wav", ".zip", ".tar", ".gz", ".png", ".jpg", ".jpeg", ".gif", ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls"}


def _node(path: Path) -> dict:
    stat = path.stat()
    rel  = path.relative_to(DATA_ROOT).as_posix()
    if path.is_dir():
        return {
            "name":     path.name,
            "path":     rel,
            "type":     "dir",
            "size":     0,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        }
    ext = path.suffix.lower()
    ftype = "text" if ext in TEXT_EXTS else ("binary" if ext in BIN_EXTS else "other")
    return {
        "name":     path.name,
        "path":     rel,
        "type":     "file",
        "ext":      ext.lstrip("."),
        "size":     stat.st_size,
        "fileType": ftype,
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }


@app.get("/api/files")
def list_files(path: str = ""):
    """List files/dirs under a relative path inside data/. path='' means root."""
    target = DATA_ROOT / path if path else DATA_ROOT
    if not target.exists():
        raise HTTPException(404, "Path not found")
    if not target.is_dir():
        raise HTTPException(400, "Not a directory")
    # safety: stay inside DATA_ROOT
    try:
        target.resolve().relative_to(DATA_ROOT.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
    items = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    return [_node(p) for p in items]


class FileDeleteRequest(BaseModel):
    path: str  # relative posix path inside data/


class FileRenameRequest(BaseModel):
    path:    str  # relative posix path
    newName: str


class FileMkdirRequest(BaseModel):
    path:     str  # parent dir relative path ("" = root)
    name:     str


@app.post("/api/files/delete")
def delete_file(body: FileDeleteRequest):
    target = DATA_ROOT / body.path
    try:
        target.resolve().relative_to(DATA_ROOT.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
    if not target.exists():
        raise HTTPException(404, "Not found")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"ok": True}


@app.post("/api/files/rename")
def rename_file(body: FileRenameRequest):
    src = DATA_ROOT / body.path
    try:
        src.resolve().relative_to(DATA_ROOT.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
    if not src.exists():
        raise HTTPException(404, "Not found")
    new_path = src.parent / body.newName
    if new_path.exists():
        raise HTTPException(409, "A file with that name already exists")
    src.rename(new_path)
    return {"ok": True, "newPath": new_path.relative_to(DATA_ROOT).as_posix()}


@app.post("/api/files/mkdir")
def mkdir(body: FileMkdirRequest):
    parent = DATA_ROOT / body.path if body.path else DATA_ROOT
    try:
        parent.resolve().relative_to(DATA_ROOT.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
    if not parent.exists() or not parent.is_dir():
        raise HTTPException(404, "Parent directory not found")
    new_dir = parent / body.name
    if new_dir.exists():
        raise HTTPException(409, "Directory already exists")
    new_dir.mkdir()
    return {"ok": True, "path": new_dir.relative_to(DATA_ROOT).as_posix()}


@app.get("/api/files/preview")
def preview_file(path: str):
    target = DATA_ROOT / path
    try:
        target.resolve().relative_to(DATA_ROOT.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "Not found")
    ext = target.suffix.lower()
    if ext not in TEXT_EXTS:
        raise HTTPException(400, "Cannot preview this file type")
    # limit preview to 200 KB
    content = target.read_text(encoding="utf-8", errors="replace")
    if len(content) > 200_000:
        content = content[:200_000] + "\n\n… (truncated)"
    return {"name": target.name, "path": path, "ext": ext.lstrip("."), "content": content}


@app.get("/api/files/download/{path:path}")
def download_file(path: str):
    target = DATA_ROOT / path
    try:
        target.resolve().relative_to(DATA_ROOT.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(target)


# ═══════════════════════════════════════════════════════════════════════════════
# API — Downloads
# ═══════════════════════════════════════════════════════════════════════════════

class DownloadRequest(BaseModel):
    type: str          # "file" | "video"
    course_id: int
    course_name: str
    item: dict


def _safe_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in " ._-" else "_" for c in name).strip()


def _do_download_file(tid: str, req: DownloadRequest):
    try:
        tasks[tid]["status"] = "running"
        dest = DOWNLOAD_DIR / _safe_name(req.course_name)
        dest.mkdir(parents=True, exist_ok=True)
        f = req.item
        path = canvas().download(f["url"], dest / f["display_name"])
        tasks[tid].update(status="done", progress=100, result=str(path))
    except Exception as e:
        tasks[tid].update(status="error", error=str(e))


def _do_download_video(tid: str, req: DownloadRequest):
    try:
        tasks[tid]["status"] = "running"
        dest = DOWNLOAD_DIR / _safe_name(req.course_name)
        dest.mkdir(parents=True, exist_ok=True)
        obj = req.item
        sources = canvas().get_media_sources(obj["media_id"])
        mp4 = next((s for s in sources if "mp4" in s.get("content_type", "")), None)
        if not mp4:
            tasks[tid].update(status="error", error="No mp4 source found")
            return
        title = _safe_name(obj.get("title") or obj["media_id"])
        path = canvas().download(mp4["url"], dest / f"{title}.mp4")
        tasks[tid].update(status="done", progress=100, result=str(path))
    except Exception as e:
        tasks[tid].update(status="error", error=str(e))


@app.post("/api/download")
def download(req: DownloadRequest, background_tasks: BackgroundTasks):
    tid = make_task("download")
    if req.type == "file":
        background_tasks.add_task(_do_download_file, tid, req)
    elif req.type == "video":
        background_tasks.add_task(_do_download_video, tid, req)
    else:
        raise HTTPException(400, "type must be 'file' or 'video'")
    return {"task_id": tid}


@app.get("/api/downloads")
def list_downloads():
    result = []
    for course_dir in DOWNLOAD_DIR.iterdir():
        if course_dir.is_dir():
            for f in course_dir.iterdir():
                result.append({
                    "path": str(f),
                    "name": f.name,
                    "course": course_dir.name,
                    "size": f.stat().st_size,
                    "is_video": f.suffix.lower() in {".mp4", ".mov", ".avi", ".mkv"},
                })
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# API — SJTU 课堂录屏（v.sjtu.edu.cn）
# ═══════════════════════════════════════════════════════════════════════════════

_video_client: "SJTUVideoClient | None" = None
_saved_ja_auth_cookie: str = ""   # persisted so new client instances can reuse it

def _get_video_client() -> "SJTUVideoClient":
    global _video_client
    if _video_client is None:
        from canvas.video_client import SJTUVideoClient
        cfg = _cfg()
        cookie = _saved_ja_auth_cookie or cfg.get("ja_auth_cookie", "")
        _video_client = SJTUVideoClient(
            ja_auth_cookie=cookie,
            canvas_token=cfg.get("canvas_token", ""),
        )
    return _video_client


@app.post("/api/video/login")
def video_login():
    """登录 jAccount + 视频平台"""
    import threading

    def _do():
        global _video_client, _saved_ja_auth_cookie
        cfg = _cfg()
        cookie = cfg.get("ja_auth_cookie", "")
        _saved_ja_auth_cookie = cookie
        _video_client = None
        client = _get_video_client()
        try:
            ok = client.login(
                ja_auth_cookie=cookie,
                canvas_token=cfg.get("canvas_token", ""),
            )
            tasks["video_login"] = {
                "id": "video_login", "kind": "video_login",
                "status": "done" if ok else "error",
                "progress": 100, "result": "ok" if ok else None,
                "error": None if ok else "Login failed",
            }
        except Exception as e:
            tasks["video_login"] = {
                "id": "video_login", "kind": "video_login",
                "status": "error", "progress": 100,
                "result": None, "error": str(e),
            }

    tasks["video_login"] = {
        "id": "video_login", "kind": "video_login",
        "status": "running", "progress": 0,
        "result": None, "error": None,
    }
    t = threading.Thread(target=_do, daemon=True)
    t.start()
    return {"task_id": "video_login"}


@app.get("/api/video/courses/{course_id}/videos")
def video_list(course_id: int):
    client = _get_video_client()
    if client._video_token is None:
        try:
            client.bind_canvas_course(course_id)
        except Exception as e:
            print(f"[ERROR] bind_canvas_course({course_id}) failed: {e}")
            raise HTTPException(503, f"视频平台登录失败: {e}")
    videos = client.list_videos(course_id)
    return [{"id": v.id, "title": v.title, "duration": v.duration,
             "thumbnail": v.thumbnail, "size": v.size,
             "cour_id": v.cour_id} for v in videos]


@app.get("/api/video/plays")
def video_plays(video_id: str, title: str = ""):
    """获取某个视频的所有播放片段（主屏幕 / 录屏轨道）"""
    client = _get_video_client()
    info = client.get_video_info(video_id, video_title=title)
    return [
        {"id": p.id, "name": p.name, "index": p.index, "url": p.rtmp_url_hdv}
        for p in info.plays
    ]


class VideoDownloadRequest(BaseModel):
    course_id: int
    course_name: str
    video_id: str
    title: str = ""
    play_index: int = -1   # -1=自动选录屏轨道，>=0=指定片段


@app.post("/api/video/download")
def video_download(req: VideoDownloadRequest, background_tasks: BackgroundTasks):
    tid = make_task("video_download")
    tasks[tid]["progress"] = 0

    def _do():
        try:
            tasks[tid]["status"] = "running"
            client = _get_video_client()
            dest = DOWNLOAD_DIR / _safe_name(req.course_name)
            dest.mkdir(parents=True, exist_ok=True)

            class _Prog:
                def __init__(self):
                    self.processed = 0
                    self.total = 1
            _prog = _Prog()

            def on_progress(p: "VideoDownloadProgress"):
                _prog.processed = p.processed
                _prog.total = max(p.total, 1)
                tasks[tid]["progress"] = int(_prog.processed * 100 // _prog.total)

            # 获取片段信息用于命名
            info = client.get_video_info(req.video_id, req.title)
            screen_recs = [p for p in info.plays if p.index > 0]
            selected_play = screen_recs[0] if req.play_index < 0 else next(
                (p for p in info.plays if p.index == req.play_index), info.plays[0]
            )
            if selected_play:
                path = dest / selected_play.name

            client.download_video(req.video_id, path, title=req.title,
                                  play_index=req.play_index, progress_handler=on_progress)
            tasks[tid].update(status="done", progress=100, result=str(path))
        except Exception as e:
            tasks[tid].update(status="error", error=str(e))

    background_tasks.add_task(_do)
    return {"task_id": tid}


# ═══════════════════════════════════════════════════════════════════════════════
# API — PPT 录屏
# ═══════════════════════════════════════════════════════════════════════════════

class PPTDownloadRequest(BaseModel):
    course_name: str
    video_title: str
    cour_id: str


@app.get("/api/video/ppt")
def ppt_list(cour_id: str, course_id: int):
    """获取某节课的 PPT 幻灯片列表"""
    client = _get_video_client()
    slides = client.get_ppt_slides(cour_id)
    return [{"url": s.get("ppt_img_url") or "", "sec": s.get("create_sec", "")} for s in slides]


@app.post("/api/video/ppt/download")
def ppt_download(req: PPTDownloadRequest, background_tasks: BackgroundTasks):
    """下载 PPT 幻灯片并合并为 PDF"""
    tid = make_task("ppt_download")
    tasks[tid]["progress"] = 0

    def _do():
        try:
            tasks[tid]["status"] = "running"
            client = _get_video_client()
            slides = client.get_ppt_slides(req.cour_id)
            if not slides:
                tasks[tid].update(status="error", error="该课程无 PPT")
                return

            dest = DOWNLOAD_DIR / _safe_name(req.course_name)
            dest.mkdir(parents=True, exist_ok=True)
            safe = re.sub(r"[^\w\u4e00-\u9fff ._-]", "_", req.video_title).strip()
            pdf_path = dest / f"{safe}_PPT.pdf"

            from PIL import Image
            import io

            images = []
            for i, slide in enumerate(slides):
                img_url = slide.get("ppt_img_url")
                if not img_url:
                    continue
                img_data = client.session.get(img_url, timeout=30).content
                img = Image.open(io.BytesIO(img_data)).convert("RGB")
                images.append(img)
                tasks[tid]["progress"] = int((i + 1) * 100 // max(len(slides), 1))

            if images:
                images[0].save(str(pdf_path), save_all=True, append_images=images[1:])
            tasks[tid].update(status="done", progress=100, result=str(pdf_path))
        except Exception as e:
            tasks[tid].update(status="error", error=str(e))

    background_tasks.add_task(_do)
    return {"task_id": tid}





# ═══════════════════════════════════════════════════════════════════════════════
# API — Transcriptions
# ═══════════════════════════════════════════════════════════════════════════════

class TranscribeRequest(BaseModel):
    video_path: str
    course_name: str


def _do_transcribe(tid: str, video_path: str, course_name: str):
    try:
        tasks[tid]["status"] = "running"
        from asr.transcriber import transcribe_video
        text = transcribe_video(Path(video_path), course_name)
        stem = Path(video_path).stem
        course_dir = AUDIO_DIR / course_name
        course_dir.mkdir(parents=True, exist_ok=True)
        out = course_dir / (stem + ".txt")
        out.write_text(text, encoding="utf-8")
        tasks[tid].update(status="done", progress=100, result=str(out))
    except Exception as e:
        tasks[tid].update(status="error", error=str(e))


@app.post("/api/transcribe")
def transcribe(req: TranscribeRequest, background_tasks: BackgroundTasks):
    tid = make_task("transcribe")
    background_tasks.add_task(_do_transcribe, tid, req.video_path, req.course_name)
    return {"task_id": tid}


@app.get("/api/transcriptions")
def list_transcriptions():
    result = []
    for course_dir in AUDIO_DIR.iterdir():
        if course_dir.is_dir():
            for f in sorted(course_dir.glob("*.txt")):
                result.append({
                    "name": f"{course_dir.name}/{f.stem}",
                    "path": str(f),
                    "size": f.stat().st_size,
                    "course": course_dir.name,
                })
    return result


@app.get("/api/transcriptions/{name}")
def get_transcription(name: str):
    # name 格式: {course}/{stem}
    if "/" in name:
        course, stem = name.split("/", 1)
        path = AUDIO_DIR / course / (stem + ".txt")
    else:
        path = AUDIO_DIR / (name + ".txt")
    if not path.exists():
        raise HTTPException(404, "Not found")
    return {"name": name, "text": path.read_text(encoding="utf-8")}


# ═══════════════════════════════════════════════════════════════════════════════
# API — Notes
# ═══════════════════════════════════════════════════════════════════════════════

class NotesRequest(BaseModel):
    course_name: str
    doc_paths: list[str] = []
    transcript: str = ""


async def _stream_notes(req: NotesRequest) -> AsyncGenerator[str, None]:
    from notes.generator import SYSTEM_PROMPT
    from parser.doc_parser import parse_document
    from llm_client import llm_stream

    cfg = _cfg()

    # 解析所有文档并拼接
    doc_text_parts = []
    for i, dp in enumerate(req.doc_paths):
        try:
            text = parse_document(Path(dp))
            doc_text_parts.append(f"=== 文档 {i+1}: {Path(dp).name} ===\n{text}")
        except Exception as e:
            yield f"data: {json.dumps({'error': f'文档解析失败 [{Path(dp).name}]: {e}'})}\n\n"
            return

    doc_text = "\n\n".join(doc_text_parts)

    def smart_truncate(text: str, limit: int) -> str:
        if len(text) <= limit:
            return text
        chunk = text[:limit]
        last_newline = chunk.rfind('\n')
        cutoff = last_newline if last_newline > limit * 0.7 else int(limit * 0.85)
        return text[:cutoff].rstrip()

    user_content = f"""课程：{req.course_name}

【课件】
{smart_truncate(doc_text, 12000)}

【讲义】
{smart_truncate(req.transcript, 16000)}"""

    course_dir = NOTES_DIR / _safe_name(req.course_name)
    course_dir.mkdir(parents=True, exist_ok=True)
    doc_stem = Path(req.doc_paths[0]).stem if req.doc_paths else "lecture"
    out_path = course_dir / f"{doc_stem}_notes.md"

    full_text: list[str] = []
    try:
        async for raw in llm_stream(
            base_url=cfg["llm_base_url"],
            api_key=cfg["llm_api_key"],
            model=cfg["llm_model"],
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
            temperature=0.3,
        ):
            try:
                line = raw.strip()
                if line.startswith("data: "):
                    json_str = line[6:].rsplit("\n", 1)[0]
                    obj = json.loads(json_str)
                    if "error" in obj:
                        yield f"data: {json.dumps({'error': obj['error']})}\n\n"
                        return
                    if obj.get("delta"):
                        full_text.append(obj["delta"])
                        yield f"data: {json.dumps({'delta': obj['delta']})}\n\n"
                    elif obj.get("done"):
                        out_path.write_text("".join(full_text), encoding="utf-8")
                        yield f"data: {json.dumps({'done': True, 'path': str(out_path)})}\n\n"
            except json.JSONDecodeError:
                pass
    except Exception as e:
        yield f"data: {json.dumps({'error': f'生成失败: {e}'})}\n\n"


@app.post("/api/notes/generate")
def generate_notes(req: NotesRequest):
    return StreamingResponse(_stream_notes(req), media_type="text/event-stream")


@app.get("/api/notes")
def list_notes():
    result = []
    for course_dir in NOTES_DIR.iterdir():
        if course_dir.is_dir():
            for f in course_dir.glob("*.md"):
                result.append({
                    "filename": f.name,
                    "stem": f.stem,
                    "course": course_dir.name,
                    "path": str(f),
                    "size": f.stat().st_size,
                })
    return result


@app.get("/api/notes/{course}/{filename}")
def get_note(course: str, filename: str):
    path = NOTES_DIR / course / filename
    if not path.exists():
        raise HTTPException(404, "Not found")
    return {"content": path.read_text(encoding="utf-8"), "path": str(path)}


@app.put("/api/notes/{course}/{filename}")
def save_note(course: str, filename: str, body: dict):
    path = NOTES_DIR / course / filename
    if not path.exists():
        raise HTTPException(404, "Not found")
    path.write_text(body.get("content", ""), encoding="utf-8")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════════
# API — LLM Chat
# ═══════════════════════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    messages: list[dict]
    context_note: str = ""


async def _stream_chat(req: ChatRequest) -> AsyncGenerator[str, None]:
    from llm_client import llm_stream

    cfg = _cfg()

    system = """你是一个学术笔记助手，帮助学生理解和完善课堂笔记。

回答规范：
- 回答简洁，命中要点，不要废话
- 专业术语保留原文英文
- 如引用笔记内容，用 > 引用块标注来源章节
- 可主动建议补充遗漏的知识点
- 若发现笔记内容有误，指出并给出正确表述"""
    if req.context_note:
        system += f"\n\n当前笔记内容：\n{req.context_note[:8000]}"

    try:
        async for raw in llm_stream(
            base_url=cfg["llm_base_url"],
            api_key=cfg["llm_api_key"],
            model=cfg["llm_model"],
            system=system,
            messages=req.messages,
            temperature=0.5,
        ):
            try:
                line = raw.strip()
                if line.startswith("data: "):
                    json_str = line[6:].rsplit("\n", 1)[0]
                    obj = json.loads(json_str)
                    if "error" in obj:
                        yield f"data: {json.dumps({'error': obj['error']})}\n\n"
                        return
                    if obj.get("delta"):
                        yield f"data: {json.dumps({'delta': obj['delta']})}\n\n"
                    elif obj.get("done"):
                        yield f"data: {json.dumps({'done': True})}\n\n"
            except json.JSONDecodeError:
                pass
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


@app.post("/api/chat")
def chat(req: ChatRequest):
    return StreamingResponse(_stream_chat(req), media_type="text/event-stream")


# ═══════════════════════════════════════════════════════════════════════════════
# API — Tasks
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(404, "Task not found")
    return tasks[task_id]


@app.get("/api/tasks")
def list_tasks():
    return list(tasks.values())


# ═══════════════════════════════════════════════════════════════════════════════
# API — Settings
# ═══════════════════════════════════════════════════════════════════════════════

class SettingsBody(BaseModel):
    canvas_base_url: str | None = None
    canvas_token:    str | None = None
    ja_auth_cookie:  str | None = None
    llm_base_url:    str | None = None
    llm_api_key:     str | None = None
    llm_model:       str | None = None
    asr_model:       str | None = None
    asr_device:      str | None = None


@app.get("/api/settings")
def get_settings():
    return _load_settings()


@app.put("/api/settings")
def update_settings(body: SettingsBody):
    data = _load_settings()
    for k, v in body.model_dump().items():
        if v is not None:
            data[k] = v
    _save_settings(data)
    # Reset clients so they pick up new credentials
    _reset_clients()
    return {"ok": True}


class LLMTestBody(BaseModel):
    base_url: str
    api_key: str
    model: str


@app.post("/api/settings/test_llm")
def test_llm(body: LLMTestBody):
    try:
        from openai import OpenAI
        client = OpenAI(base_url=body.base_url, api_key=body.api_key, timeout=15)
        resp = client.chat.completions.create(
            model=body.model,
            messages=[{"role": "user", "content": "回复 ok"}],
            max_tokens=10,
        )
        return {"ok": True, "reply": resp.choices[0].message.content}
    except Exception as e:
        raise HTTPException(500, str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# Client re-init helpers
# ═══════════════════════════════════════════════════════════════════════════════

_canvas: CanvasClient | None = None
_llm_client: "AsyncOpenAI | None" = None
_asr_model:  object | None = None


def _reset_clients():
    global _canvas, _llm_client, _asr_model, _video_client, _saved_ja_auth_cookie
    _canvas = None
    _llm_client = None
    _asr_model = None
    _video_client = None
    _saved_ja_auth_cookie = ""


def canvas() -> CanvasClient:
    global _canvas
    if _canvas is None:
        cfg = _cfg()
        _canvas = CanvasClient(base_url=cfg["canvas_base_url"], token=cfg["canvas_token"])
    return _canvas


def _llm_client_sync():
    from openai import AsyncOpenAI
    global _llm_client
    if _llm_client is None:
        cfg = _cfg()
        _llm_client = AsyncOpenAI(base_url=cfg["llm_base_url"], api_key=cfg["llm_api_key"])
    return _llm_client


def _cfg() -> dict:
    return _load_settings()


# ═══════════════════════════════════════════════════════════════════════════════
# Serve built frontend
# ═══════════════════════════════════════════════════════════════════════════════

_frontend_dist = Path(__file__).parent / "frontend" / "dist"

if _frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=_frontend_dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        return FileResponse(_frontend_dist / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, timeout_keep_alive=300)


def run():
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, timeout_keep_alive=300)
