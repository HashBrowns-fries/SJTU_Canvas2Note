"""
FastAPI backend for Canvas2note web UI.
"""
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

SLIDES_DIR = DOWNLOAD_DIR  # PPT slide images live under data/downloads/<course>/<title>_ppt_imgs/

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
    "asr_model":       "iic/SenseVoiceSmall",
    "asr_engine":      "funasr",  # faster-whisper / funasr / api
    "asr_device":      "cuda",   # cuda / cpu（仅 faster-whisper 模式有效）
    "asr_language":    "German",   # Qwen3-ASR / faster-whisper 语言：German / Chinese / English / auto 等
    "asr_api_base":    "",
    "asr_api_key":     "",
    "asr_api_model":   "whisper-1",
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

def canvas() -> CanvasClient:
    cfg = _cfg()
    return CanvasClient(base_url=cfg["canvas_base_url"], token=cfg["canvas_token"])


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
def download_file(path: str, background_tasks: BackgroundTasks):
    target = DATA_ROOT / path
    try:
        target.resolve().relative_to(DATA_ROOT.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(target)


# ═══════════════════════════════════════════════════════════════════════════════
# Canvas Downloads
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/download")
def start_download(body: dict):
    kind = body.get("type", "file")
    tid = make_task(kind)
    tasks[tid].update({"course_id": body.get("course_id"), "course_name": body.get("course_name"), "item": body.get("item")})
    if kind == "file":
        background_tasks.add_task(_do_download, tid, body)
    return {"task_id": tid}


def _do_download(tid: str, body: dict):
    import asyncio
    async def _run():
        from canvas.client import CanvasClient
        cfg = _cfg()
        c = CanvasClient(base_url=cfg["canvas_base_url"], token=cfg["canvas_token"])
        item = body["item"]
        course_id = body["course_id"]
        course_name = body["course_name"]
        out_dir = DOWNLOAD_DIR / course_name
        out_dir.mkdir(parents=True, exist_ok=True)
        tasks[tid]["status"] = "done"
        tasks[tid]["result"] = f"Downloaded: {item['display_name']}"
        await c.download_file(course_id, item["id"], item["display_name"], str(out_dir))
    asyncio.run(_run())


# ═══════════════════════════════════════════════════════════════════════════════
# Video Downloads
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/video/login")
def video_login(background_tasks: BackgroundTasks):
    from canvas.video_client import VideoClient
    cfg = _cfg()
    tid = make_task("video_login")
    tasks[tid]["status"] = "pending"
    background_tasks.add_task(_do_video_login, tid, cfg["ja_auth_cookie"])
    return {"task_id": tid}


def _do_video_login(tid: str, cookie: str):
    import asyncio
    async def _run():
        from canvas.video_client import VideoClient
        cfg = _cfg()
        vc = VideoClient(ja_auth_cookie=cookie)
        await vc.login()
        tasks[tid]["status"] = "done"
        tasks[tid]["result"] = "Login OK"
    asyncio.run(_run())


@app.get("/api/video/courses/{course_id}/videos")
def list_video_videos(course_id: int):
    from canvas.video_client import VideoClient
    cfg = _cfg()
    vc = VideoClient(ja_auth_cookie=cfg.get("ja_auth_cookie", ""))
    return vc.list_course_videos(course_id)


@app.post("/api/video/download")
def start_video_download(body: dict, background_tasks: BackgroundTasks):
    from canvas.video_client import VideoClient
    import asyncio
    cfg = _cfg()
    tid = make_task("video")
    tasks[tid].update({
        "course_id": body.get("course_id"),
        "course_name": body.get("course_name"),
        "video_id": body.get("video_id"),
        "title": body.get("title"),
        "play_index": body.get("play_index"),
    })
    background_tasks.add_task(_do_video_download, tid, body, cfg["ja_auth_cookie"])
    return {"task_id": tid}


def _do_video_download(tid: str, body: dict, cookie: str):
    import asyncio
    async def _run():
        from canvas.video_client import VideoClient
        cfg = _cfg()
        vc = VideoClient(ja_auth_cookie=cookie)
        await vc.login()
        course_id = body["course_id"]
        course_name = body["course_name"]
        video_id = body["video_id"]
        title = body.get("title", video_id)
        play_index = body.get("play_index")
        out_dir = DOWNLOAD_DIR / course_name
        out_dir.mkdir(parents=True, exist_ok=True)
        tasks[tid]["status"] = "downloading"
        await vc.download_video(course_id, video_id, title, str(out_dir), play_index=play_index)
        tasks[tid]["status"] = "done"
        tasks[tid]["result"] = f"Downloaded: {title}"
    asyncio.run(_run())


# ═══════════════════════════════════════════════════════════════════════════════
# Batch Transcribe
# ═══════════════════════════════════════════════════════════════════════════════

class BatchItem(BaseModel):
    course_id:    int
    course_name:  str
    video_id:     str
    title:        str
    play_index:   int = 0


class BatchTranscribeRequest(BaseModel):
    items:        list[BatchItem]
    delete_video: bool = True


@app.post("/api/batch/transcribe")
def batch_transcribe(req: BatchTranscribeRequest, background_tasks: BackgroundTasks):
    tid = make_task("batch")
    # Normalize Pydantic models to plain dicts
    items = [x.model_dump() if hasattr(x, "model_dump") else x for x in req.items]
    tasks[tid].update({"items": items, "done_count": 0, "total_count": len(items), "current": "", "status": "running"})
    background_tasks.add_task(_do_batch_transcribe, tid, items, req.delete_video)
    return {"task_id": tid}


def _do_batch_transcribe(tid: str, items: list[dict], delete_video: bool):
    import asyncio, shutil
    async def _run():
        from canvas.video_client import VideoClient
        from asr.transcriber import transcribe_video
        cfg = _cfg()
        vc = VideoClient(ja_auth_cookie=cfg.get("ja_auth_cookie", ""))
        await vc.login()
        updated_items = []
        for i, raw_item in enumerate(items):
            item = raw_item.model_dump() if hasattr(raw_item, 'model_dump') else raw_item
            course_name = item["course_name"]
            video_id = item["video_id"]
            title = item["title"]
            play_index = item.get("play_index", 0)
            tasks[tid]["current"] = title
            tasks[tid]["done_count"] = i
            try:
                # Download
                out_dir = DOWNLOAD_DIR / course_name
                out_dir.mkdir(parents=True, exist_ok=True)
                video_path = await vc.download_video(item["course_id"], video_id, title, str(out_dir), play_index=play_index)
                tasks[tid]["items"] = updated_items + [{"title": title, "status": "↓"}]
                # Transcribe
                text = transcribe_video(Path(video_path), course_name)
                tasks[tid]["items"] = updated_items + [{"title": title, "status": "◎"}]
                # Delete video
                if delete_video and video_path and Path(video_path).exists():
                    Path(video_path).unlink()
                    tasks[tid]["items"] = updated_items + [{"title": title, "status": "✓"}]
                else:
                    tasks[tid]["items"] = updated_items + [{"title": title, "status": "✓"}]
                updated_items = tasks[tid]["items"]
            except Exception as e:
                tasks[tid]["items"] = updated_items + [{"title": title, "status": "✗", "error": str(e)}]
                updated_items = tasks[tid]["items"]
        tasks[tid]["status"] = "done"
        tasks[tid]["done_count"] = len(items)
        tasks[tid]["current"] = ""
    asyncio.run(_run())


# ═══════════════════════════════════════════════════════════════════════════════
# PPT
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/video/ppt")
def list_ppt(cour_id: str, course_id: int):
    from canvas.video_client import VideoClient
    import asyncio
    cfg = _cfg()
    vc = VideoClient(ja_auth_cookie=cfg.get("ja_auth_cookie", ""))
    return vc.list_ppt_slides(cour_id, course_id)


@app.post("/api/video/ppt/download")
def download_ppt(body: dict, background_tasks: BackgroundTasks):
    from canvas.video_client import VideoClient
    import asyncio
    cfg = _cfg()
    tid = make_task("ppt")
    tasks[tid]["status"] = "running"
    background_tasks.add_task(_do_ppt_download, tid, body, cfg["ja_auth_cookie"])
    return {"task_id": tid}


def _do_ppt_download(tid: str, body: dict, cookie: str):
    from canvas.video_client import VideoClient
    cfg = _cfg()
    vc = VideoClient(ja_auth_cookie=cookie)
    vc.login(cookie)
    course_name = body["course_name"]
    video_title = body["video_title"]
    cour_id = body["cour_id"]
    course_id = int(body.get("course_id", 0))
    out_dir = DOWNLOAD_DIR / course_name
    out_dir.mkdir(parents=True, exist_ok=True)
    if course_id:
        vc.bind_canvas_course(course_id)
    vc.download_ppt(cour_id, video_title, str(out_dir))
    tasks[tid]["status"] = "done"


# ═══════════════════════════════════════════════════════════════════════════════
# API — Downloads / Transcriptions / Notes
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/transcribe")
def start_transcribe(body: dict, background_tasks: BackgroundTasks):
    from asr.transcriber import transcribe_video
    video_path = body.get("video_path", "")
    course_name = body.get("course_name", "")
    if not video_path:
        raise HTTPException(400, "video_path required")
    tid = make_task("transcribe")
    tasks[tid]["course_name"] = course_name
    tasks[tid]["status"] = "running"
    background_tasks.add_task(_do_transcribe, tid, video_path, course_name)
    return {"task_id": tid}


def _do_transcribe(tid: str, video_path: str, course_name: str):
    try:
        from asr.transcriber import transcribe_video
        text = transcribe_video(Path(video_path), course_name)
        stem = Path(video_path).stem
        course_dir = AUDIO_DIR / course_name
        course_dir.mkdir(parents=True, exist_ok=True)
        out = course_dir / (stem + ".txt")
        out.write_text(text, encoding="utf-8")
        tasks[tid]["status"] = "done"
        tasks[tid]["result"] = {"text": text, "path": str(out), "chars": len(text)}
    except Exception as e:
        tasks[tid]["status"] = "error"
        tasks[tid]["error"] = str(e)


@app.get("/api/downloads")
def list_downloads():
    result = []
    for course_dir in DOWNLOAD_DIR.iterdir():
        if course_dir.is_dir():
            for f in sorted(course_dir.iterdir()):
                if f.is_file():
                    result.append({
                        "name":     f.name,
                        "path":     str(f),
                        "size":     f.stat().st_size,
                        "is_video": f.suffix.lower() in {".mp4", ".mov", ".avi", ".mkv", ".webm", ".wav"},
                        "course":   course_dir.name,
                    })
    return result


@app.get("/api/transcriptions")
def list_transcriptions():
    result = []
    for course_dir in AUDIO_DIR.iterdir():
        if course_dir.is_dir():
            for f in sorted(course_dir.glob("*.txt")):
                result.append({
                    "name": course_dir.name + "/" + f.stem,
                    "path": "data/audio/" + f"{course_dir.name}/{f.stem}",
                    "size": f.stat().st_size,
"course": course_dir.name,
                })
    return result


@app.get("/api/slides")
def list_slides(course_name: str = ""):
    """列出已下载的 PPT 幻灯片（来自各课程的 _ppt_imgs 目录）"""
    result = []
    if course_name:
        dirs = [DOWNLOAD_DIR / course_name]
    else:
        dirs = [d for d in DOWNLOAD_DIR.iterdir() if d.is_dir()]
    for course_dir in sorted(dirs, key=lambda d: d.name):
        ppt_dirs = [d for d in course_dir.iterdir() if d.is_dir() and d.name.endswith("_ppt_imgs")]
        for ppt_dir in sorted(ppt_dirs, key=lambda d: d.name):
            imgs = sorted(ppt_dir.glob("*.jpg")) + sorted(ppt_dir.glob("*.png")) + sorted(ppt_dir.glob("*.webp"))
            if imgs:
                result.append({
                    "course":   course_dir.name,
                    "title":    ppt_dir.name.replace("_ppt_imgs", ""),
                    "dir":      str(ppt_dir),
                    "count":    len(imgs),
                    "images":   [f.name for f in imgs],
                    "pdf":      str(course_dir / (ppt_dir.name.replace("_ppt_imgs", "") + ".pdf")),
                })
    return result


@app.get("/api/slides/{course_name}/{title}/{filename}")
def serve_slide(course_name: str, title: str, filename: str):
    """提供单张幻灯片图片访问（URL: /api/slides/<course>/<title>/<img>.jpg）"""
    slide_dir = DOWNLOAD_DIR / course_name / (title + "_ppt_imgs")
    target = slide_dir / filename
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "Slide not found")
    try:
        target.resolve().relative_to(DOWNLOAD_DIR.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
    import mimetypes
    ext = filename.rsplit(".", 1)[-1].lower()
    mt = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "application/octet-stream")
    from fastapi.responses import FileResponse
    return FileResponse(target, media_type=mt)


@app.get("/api/transcription")
def get_transcription(name: str = ""):
    """返回单个转写文件内容"""
    if not name:
        raise HTTPException(400, "name query parameter required")
    if "/" in name:
        course, stem = name.split("/", 1)
        path = AUDIO_DIR / course / (stem + ".txt")
    else:
        path = AUDIO_DIR / (name + ".txt")
    if not path.exists():
        raise HTTPException(404, f"Not found: {path}")
    return {"name": name, "text": path.read_text(encoding="utf-8")}


# ═══════════════════════════════════════════════════════════════════════════════
# API — Notes
# ═══════════════════════════════════════════════════════════════════════════════

class NotesRequest(BaseModel):
    course_name: str
    doc_paths: list[str] = []
    transcript: str = ""
    transcript_name: str = ""
    slide_dirs: list[str] = []


async def _stream_notes(req: NotesRequest) -> AsyncGenerator[str, None]:
    from notes.generator import SYSTEM_PROMPT
    from parser.doc_parser import parse_document
    from llm_client import llm_stream
    import vlm_client

    cfg = _cfg()

    # Parse documents
    doc_text_parts = []
    for i, dp in enumerate(req.doc_paths):
        try:
            text = parse_document(Path(dp))
            doc_text_parts.append(f"=== 文档 {i+1}: {Path(dp).name} ===\n{text}")
        except Exception as e:
            yield f"data: {json.dumps({'error': f'文档解析失败 [{Path(dp).name}]: {e}'})}\n\n"
            return

    doc_text = "\n\n".join(doc_text_parts)

    # Parse PPT slides with VLM
    note_stem = req.transcript_name or (Path(req.doc_paths[0]).stem if req.doc_paths else "lecture")
    course_dir = NOTES_DIR / _safe_name(req.course_name)
    course_dir.mkdir(parents=True, exist_ok=True)

    slide_text_parts = []
    for i, slide_dir in enumerate(req.slide_dirs):
        slide_path = Path(slide_dir)
        if not slide_path.is_dir():
            continue
        imgs = sorted(slide_path.glob("*.jpg")) + sorted(slide_path.glob("*.png")) + sorted(slide_path.glob("*.webp"))
        if not imgs:
            continue
        yield f"data: {json.dumps({'status': f'分析幻灯片 {i+1}/{len(req.slide_dirs)}: {slide_path.name} ({len(imgs)}张)'})}\n\n"
        slide_desc_lines = [f"=== {slide_path.name} ==="]
        for j, img in enumerate(imgs):
            try:
                desc = vlm_client.describe_frame(img, "请提取所有文字、公式、图表、代码等内容。简洁描述。")
                slide_desc_lines.append(f"[第{j+1}页] {desc}")
            except Exception as e:
                slide_desc_lines.append(f"[第{j+1}页] (解析失败: {e})")
        slide_text_parts.append("\n".join(slide_desc_lines))

    slide_text = "\n\n".join(slide_text_parts)

    # Save VLM slide analysis to MD file alongside the note
    if slide_text:
        slides_md_path = course_dir / f"{note_stem}_slides.md"
        slides_md_path.write_text(slide_text, encoding="utf-8")

    def smart_truncate(text: str, limit: int) -> str:
        if len(text) <= limit:
            return text
        chunk = text[:limit]
        last_newline = chunk.rfind('\n')
        cutoff = last_newline if last_newline > limit * 0.7 else int(limit * 0.85)
        return text[:cutoff].rstrip()

    out_path = course_dir / f"{note_stem}.md"

    user_content = f"""课程：{req.course_name}""" + (
        f"\n\n【课件（文档）】\n{smart_truncate(doc_text, 8000)}" if doc_text else ""
    ) + (
        f"\n\n【课件（PPT 幻灯片）】\n{smart_truncate(slide_text, 8000)}" if slide_text else ""
    ) + f"""

【讲义】
{smart_truncate(req.transcript, 12000)}"""

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
                if '_slides' in f.name.lower() or f.name.endswith('.txt'):
                    continue
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


async def _stream_chat(messages: list[dict], context_note: str) -> AsyncGenerator[str, None]:
    from llm_client import llm_stream
    cfg = _cfg()
    from notes.generator import CHAT_SYSTEM_PROMPT
    ctx = f"\n\n下面是当前笔记内容（供参考）：\n{context_note}" if context_note else ""
    sys = CHAT_SYSTEM_PROMPT + ctx
    full_text: list[str] = []
    try:
        async for raw in llm_stream(
            base_url=cfg["llm_base_url"],
            api_key=cfg["llm_api_key"],
            model=cfg["llm_model"],
            system=sys,
            messages=messages,
            temperature=0.7,
        ):
            try:
                line = raw.strip()
                if line.startswith("data: "):
                    json_str = line[6:].rsplit("\n", 1)[0]
                    obj = json.loads(json_str)
                    if obj.get("delta"):
                        full_text.append(obj["delta"])
                        yield f"data: {json.dumps({'delta': obj['delta']})}\n\n"
                    elif obj.get("done"):
                        yield f"data: {json.dumps({'done': True})}\n\n"
            except json.JSONDecodeError:
                pass
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


@app.post("/api/chat")
def chat(req: ChatRequest):
    return StreamingResponse(_stream_chat(req.messages, req.context_note), media_type="text/event-stream")


# ═══════════════════════════════════════════════════════════════════════════════
# API — Chat History
# ═══════════════════════════════════════════════════════════════════════════════

CHATS_DIR = Path(__file__).parent / "data" / "chats"


class ChatHistoryRequest(BaseModel):
    conversation_id: str
    messages: list[dict]


@app.get("/api/chats/{conversation_id}")
def get_chat_history(conversation_id: str):
    path = CHATS_DIR / f"{conversation_id}.json"
    if not path.exists():
        return {"messages": []}
    import json
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"messages": data.get("messages", [])}


@app.post("/api/chats")
def save_chat_history(body: ChatHistoryRequest):
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    path = CHATS_DIR / f"{body.conversation_id}.json"
    import json
    path.write_text(json.dumps({"messages": body.messages}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════════
# API — Settings
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/settings")
def get_settings():
    return _cfg()


@app.put("/api/settings")
def put_settings(body: dict):
    _save_settings(body)
    _reset_clients()
    return {"ok": True}


def _reset_clients():
    import importlib, config as _conf_mod
    importlib.reload(_conf_mod)
    # Reset ASR engines so they reload with new settings
    import asr.transcriber as _asr
    _asr._reload()


@app.post("/api/settings/test_llm")
def test_llm(body: dict):
    import httpx
    try:
        client = httpx.Client(timeout=30)
        r = client.post(
            body["base_url"] + "/chat/completions",
            headers={"Authorization": f"Bearer {body['api_key']}", "Content-Type": "application/json"},
            json={"model": body["model"], "messages": [{"role": "user", "content": "Hi"}], "max_tokens": 5},
        )
        if r.status_code == 200:
            return {"ok": True, "reply": r.json().get("choices", [{}])[0].get("message", {}).get("content", "ok")}
        return {"ok": False, "error": r.text[:200]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/settings/test_asr")
def test_asr(body: dict):
    from openai import OpenAI
    try:
        client = OpenAI(base_url=body["base_url"], api_key=body["api_key"])
        # Use a very short silence as test audio (minimal valid WAV header)
        import io
        import struct
        # Minimal valid WAV: 1 sample at 16kHz mono
        wav = io.BytesIO()
        import wave as _wave
        with _wave.open(wav, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(struct.pack('<h', 0))
        wav.seek(0)
        resp = client.audio.transcriptions.create(
            model=body["model"],
            file=("silence.wav", wav, "audio/wav"),
        )
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# API — Tasks
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/tasks/{tid}")
def get_task(tid: str):
    return tasks.get(tid, {})


@app.get("/api/tasks")
def list_tasks():
    return list(tasks.values())


# ═══════════════════════════════════════════════════════════════════════════════
# SPA + Static Files
# ═══════════════════════════════════════════════════════════════════════════════

_frontend_dist = Path(__file__).parent / "frontend" / "dist"


@app.get("/")
def serve_index():
    return FileResponse(_frontend_dist / "index.html")


@app.get("/{full_path:path}")
def serve_frontend(full_path: str):
    p = _frontend_dist / full_path
    if p.is_file():
        return FileResponse(p)
    return FileResponse(_frontend_dist / "index.html")


if _frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=_frontend_dist / "assets"), name="assets")


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _safe_name(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip()
