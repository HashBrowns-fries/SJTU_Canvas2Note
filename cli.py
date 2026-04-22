#!/usr/bin/env python3
"""
Canvas2Note CLI — 供 Agent 调用，支持课程/文件/视频/转写/笔记的增删查操作。

用法示例：
    python cli.py list-courses
    python cli.py list-files --course-id 88220
    python cli.py transcribe --video /path/to/video.mp4 --course "生物学基础"
    python cli.py generate-notes --course "生物学基础" --transcript-path /path/to/transcript.txt
    python cli.py list-transcripts --course "生物学基础"
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import numpy as np
from pathlib import Path

BASE_URL = "http://localhost:8000/api"

# ── HTTP helpers ─────────────────────────────────────────────────────────────────

def get(path: str) -> dict:
    url = f"{BASE_URL}{path}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            err = json.loads(body)
            raise SystemExit(f"HTTP {e.code}: {err.get('detail', body)}")
        except json.JSONDecodeError:
            raise SystemExit(f"HTTP {e.code}: {body}")
    except urllib.error.URLError as e:
        raise SystemExit(f"连接失败：{e.reason}。确保 server.py 已启动（python -m uvicorn server:app）")


def post(path: str, body: dict = None) -> dict:
    url = f"{BASE_URL}{path}"
    data = json.dumps(body or {}).encode() if body else b""
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            err = json.loads(body)
            raise SystemExit(f"HTTP {e.code}: {err.get('detail', body)}")
        except json.JSONDecodeError:
            raise SystemExit(f"HTTP {e.code}: {body}")


def poll_task(task_id: str, interval: float = 2.0, timeout: float = 3600) -> dict:
    """轮询任务直到完成或超时。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        t = get(f"/tasks/{task_id}")
        status = t.get("status", "")
        if status == "done":
            return t
        if status == "error":
            raise SystemExit(f"任务失败: {t.get('error', 'unknown')}")
        print(f"  [{status}] {t.get('current', task_id)} …", file=sys.stderr)
        time.sleep(interval)
    raise SystemExit(f"任务超时（>{timeout}s）")


# ── Commands ────────────────────────────────────────────────────────────────────

def cmd_list_courses() -> dict:
    courses = get("/courses")
    out = []
    for c in courses:
        out.append({"id": c["id"], "name": c["name"], "code": c.get("course_code", "")})
    return {"courses": out}


def cmd_list_files(course_id: int) -> dict:
    items = get(f"/courses/{course_id}/files")
    return {"course_id": course_id, "files": [
        {"id": f["id"], "name": f["display_name"], "type": f["type"], "url": f.get("url", "")}
        for f in items
    ]}


def cmd_list_videos(course_id: int) -> dict:
    items = get(f"/courses/{course_id}/videos")
    return {"course_id": course_id, "videos": [
        {"id": v.get("media_id") or v.get("id"), "title": v.get("title", ""),
         "type": v.get("type", ""), "url": v.get("url", "")}
        for v in items
    ]}


def cmd_download_file(course_id: int, file_id: int, file_name: str, output_dir: str = ".") -> dict:
    print(f"下载文件 {file_id} → {output_dir}/{file_name} …", file=sys.stderr)
    resp = post("/download", {
        "type": "file", "course_id": course_id, "item": {"id": file_id, "display_name": file_name}
    })
    t = poll_task(resp["task_id"])
    return {"status": "done", "result": t.get("result")}


def cmd_transcribe(video_path: str, course_name: str, wait: bool = True) -> dict:
    video_path = str(Path(video_path).resolve())
    if not Path(video_path).exists():
        raise SystemExit(f"视频文件不存在: {video_path}")
    print(f"转写 {video_path} …", file=sys.stderr)
    resp = post("/transcribe", {"video_path": video_path, "course_name": course_name})
    if not wait:
        return {"task_id": resp["task_id"], "status": "pending"}
    t = poll_task(resp["task_id"])
    result = t.get("result", {})
    return {"status": "done", "chars": result.get("chars", 0), "path": result.get("path", ""),
            "text_preview": result.get("text", "")[:200]}


def cmd_batch_transcribe(items: list[str], course_name: str, delete_video: bool = False) -> dict:
    """
    批量转写。items 为 JSON 字符串列表，每项格式：
    {"course_id": 88220, "course_name": "生物学基础", "video_id": "...", "title": "第1讲", "play_index": 0}
    """
    parsed = [json.loads(it) for it in items]
    print(f"批量转写 {len(parsed)} 个视频（delete_video={delete_video}）…", file=sys.stderr)
    resp = post("/batch/transcribe", {"items": parsed, "delete_video": delete_video})
    t = poll_task(resp["task_id"])
    return {"status": "done", "done_count": t.get("done_count", 0),
            "total": t.get("total_count", len(parsed))}


def cmd_analyze_frames(video_path: str, interval: int = 60, max_frames: int = 16,
                        prompt: str = "") -> dict:
    from vlm_client import analyze_video
    video_path = str(Path(video_path).resolve())
    if not Path(video_path).exists():
        raise SystemExit(f"视频文件不存在: {video_path}")
    print(f"分析 {video_path}（每 {interval}s 抽一帧，最多 {max_frames} 帧）…", file=sys.stderr)
    result = analyze_video(video_path, interval=interval, max_frames=max_frames,
                           extra_prompt=prompt)
    return {"frames": len(result), "description": result}


def cmd_describe_video(video_path: str, duration: float = 0,
                        start: float = 0, prompt: str = "",
                        output: str | None = None) -> dict:
    from vlm_client import describe_video
    video_path = str(Path(video_path).resolve())
    if not Path(video_path).exists():
        raise SystemExit(f"视频文件不存在: {video_path}")
    dur_str = f"前 {duration:.0f}s" if duration > 0 else "完整视频"
    print(f"直接理解视频 {video_path}（{dur_str}）…", file=sys.stderr)
    desc = describe_video(video_path, prompt, max_duration=duration, start=start)
    if output:
        Path(output).write_text(desc, encoding="utf-8")
        print(f"已保存: {output}", file=sys.stderr)
    return {"description": desc}


def cmd_list_transcripts(course: str = "") -> dict:
    items = get("/transcriptions")
    if course:
        items = [x for x in items if x.get("course") == course]
    return {"transcriptions": [{"name": x["name"], "course": x["course"],
                                "size_kb": round(x["size"] / 1024, 1)} for x in items]}


def cmd_get_transcript(name: str) -> dict:
    """获取转写内容。name 格式：'生物学基础/生物学基础_第1讲_'"""
    resp = get(f"/transcription?name={urllib.parse.quote(name, safe='')}")
    return {"name": resp["name"], "chars": len(resp["text"]), "text": resp["text"]}


def cmd_generate_notes(
    course_name: str,
    doc_paths: list[str] = None,
    transcript_text: str = "",
    transcript_name: str = "",
    output: str = "",
) -> dict:
    """
    生成笔记。transcript_text 直接传文本内容；doc_paths 传文件路径列表（支持 PDF/PPTX/DOCX）。
    """
    body = {
        "course_name": course_name,
        "doc_paths": [str(Path(p).resolve()) for p in (doc_paths or [])],
        "transcript": transcript_text,
        "transcript_name": transcript_name,
    }
    print(f"生成笔记 '{transcript_name or course_name}' …", file=sys.stderr)

    # SSE streaming — collect delta
    import urllib.request
    url = f"{BASE_URL}/notes/generate"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    full_text = []
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            for line in r:
                line = line.decode().strip()
                if line.startswith("data: "):
                    try:
                        obj = json.loads(line[6:])
                        if obj.get("delta"):
                            full_text.append(obj["delta"])
                            sys.stderr.write(obj["delta"])
                        elif obj.get("done"):
                            break
                        elif obj.get("error"):
                            raise SystemExit(f"生成失败: {obj['error']}")
                    except json.JSONDecodeError:
                        pass
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()}")

    note_text = "".join(full_text)
    result = {"chars": len(note_text), "preview": note_text[:500]}

    if output:
        out_path = Path(output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(note_text, encoding="utf-8")
        result["path"] = str(out_path)
        print(f"\n笔记已保存: {out_path}", file=sys.stderr)
    return result


def cmd_list_notes(course: str = "") -> dict:
    items = get("/notes")
    if course:
        items = [x for x in items if x.get("course") == course]
    return {"notes": [{"filename": x["filename"], "stem": x["stem"],
                        "course": x["course"], "size_kb": round(x["size"] / 1024, 1)} for x in items]}


def cmd_get_note(course: str, filename: str) -> dict:
    resp = get(f"/notes/{urllib.parse.quote(course, safe='')}/{urllib.parse.quote(filename, safe='')}")
    return {"course": course, "filename": filename, "chars": len(resp["content"]), "content": resp["content"]}


def cmd_chat(
    messages: list[str],
    context_note: str = "",
    model: str = "",
) -> dict:
    """
    与 LLM 对话。messages 为 JSON 字符串列表，格式：{"role": "user"/"assistant", "content": "..."}
    """
    import urllib.request
    parsed_msgs = [json.loads(m) for m in messages]
    body = {"messages": parsed_msgs, "context_note": context_note}
    url = f"{BASE_URL}/chat"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    full_text = []
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            for line in r:
                line = line.decode().strip()
                if line.startswith("data: "):
                    try:
                        obj = json.loads(line[6:])
                        if obj.get("delta"):
                            full_text.append(obj["delta"])
                            sys.stdout.write(obj["delta"])
                            sys.stdout.flush()
                        elif obj.get("done"):
                            break
                    except json.JSONDecodeError:
                        pass
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()}")
    print()
    return {"reply": "".join(full_text), "chars": len("".join(full_text))}


# ── 直播命令 ─────────────────────────────────────────────────────────────────

def _get_ja_auth() -> str:
    """从 settings.json 读取 ja_auth_cookie"""
    settings_path = Path(__file__).parent / "settings.json"
    if settings_path.exists():
        try:
            with open(settings_path) as f:
                overrides = json.load(f)
            return overrides.get("ja_auth_cookie", os.getenv("JA_AUTH_COOKIE", ""))
        except Exception:
            pass
    return os.getenv("JA_AUTH_COOKIE", "")


def cmd_live_list(course_id: int) -> dict:
    ja_auth = _get_ja_auth()
    if not ja_auth:
        raise SystemExit("未配置 ja_auth_cookie，请先在 settings.json 中配置")
    from canvas.video_client import SJTUOldVideoClient
    client = SJTUOldVideoClient(ja_auth)
    streams = client.get_live_list(course_id)
    return {
        "course_id": course_id,
        "streams": [
            {"id": s.id, "title": s.title, "teacher": s.teacher,
             "room": s.room, "begin": s.begin_time, "end": s.end_time,
             "status": s.status}
            for s in streams
        ],
    }


def cmd_live_screenshot(course_id: int, live_id: str,
                         output: str = "/tmp/live_screen.jpg") -> dict:
    ja_auth = _get_ja_auth()
    if not ja_auth:
        raise SystemExit("未配置 ja_auth_cookie")
    from canvas.video_client import SJTUOldVideoClient
    client = SJTUOldVideoClient(ja_auth)
    path = client.capture_screen_frame(course_id, live_id, output_path=output)
    if path:
        return {"status": "ok", "path": path, "size_kb": os.path.getsize(path) // 1024}
    return {"status": "error", "message": "截图失败"}


def cmd_live_qr(course_id: int, live_id: str,
                 output: str = "/tmp/live_screen.jpg") -> dict:
    ja_auth = _get_ja_auth()
    if not ja_auth:
        raise SystemExit("未配置 ja_auth_cookie")
    from canvas.video_client import SJTUOldVideoClient
    client = SJTUOldVideoClient(ja_auth)
    path = client.capture_screen_frame(course_id, live_id, output_path=output)
    if not path:
        return {"status": "error", "message": "截图失败"}
    qrcodes = client.detect_qrcodes(path)
    return {"status": "ok", "screenshot": path, "qrcodes": qrcodes}


def cmd_live_transcribe(course_id: int, live_id: str = "",
                         stream_url: str = "", duration: int = 120) -> dict:
    """实时转写直播（仅电脑屏幕流）。主线程顺序执行：模型加载 → 下载+转写并发。"""
    import threading, queue, time as _time, signal, re as _re

    ja_auth = _get_ja_auth()
    if not ja_auth:
        raise SystemExit("未配置 ja_auth_cookie")

    from canvas.video_client import SJTUOldVideoClient
    client = SJTUOldVideoClient(ja_auth)

    if stream_url:
        flv_url = stream_url
    else:
        if not live_id:
            streams = client.get_live_list(course_id)
            if not streams:
                raise SystemExit("当前无直播")
            live_id = streams[0].id
            print(f"[直播] {streams[0].title} | {streams[0].teacher} | {streams[0].room}",
                  file=sys.stderr)
        urls = client.get_stream_urls(course_id, live_id)
        flv_url = urls.screen_url or urls.camera_url
        if not flv_url:
            raise SystemExit("未找到可用流地址")

    auth_m = _re.search(r"auth_key=(\d+)", flv_url)
    expires = int(auth_m.group(1)) if auth_m else 0
    remaining = (expires - int(_time.time())) // 60 if expires else 0
    print(f"[流] {flv_url[:80]}… | auth_key 剩余 ~{remaining}min", file=sys.stderr)

    # 主线程预加载模型（避免子线程 CUDA 上下文问题）
    print("[模型] 加载 FunASR SenseVoiceSmall（首次约 10s）…", file=sys.stderr)
    from funasr import AutoModel as _AutoModel
    asr_model = _AutoModel(model="iic/SenseVoiceSmall", device="cuda:0", disable_update=True)
    print("[模型] 就绪", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print("[实时转写] Ctrl+C 停止\n", file=sys.stderr)

    chunk_queue: queue.Queue = queue.Queue(maxsize=10)
    stop_event = threading.Event()

    def downloader():
        curl_cmd = [
            "curl", "-s", "--no-progress-meter",
            "-H", "User-Agent: Mozilla/5.0",
            "-H", "Referer: https://courses.sjtu.edu.cn/",
            flv_url,
        ]
        ffmpeg_cmd = [
            "ffmpeg", "-v", "quiet",
            "-flags", "low_delay", "-fflags", "nobuffer+discardcorrupt",
            "-i", "pipe:0",
            "-ar", "16000", "-ac", "1",
            "-f", "s16le", "-t", str(duration), "pipe:1",
        ]
        curl_proc = subprocess.Popen(curl_cmd, stdout=subprocess.PIPE)
        ffmpeg_proc = subprocess.Popen(
            ffmpeg_cmd, stdin=curl_proc.stdout,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        curl_proc.stdout.close()
        try:
            while not stop_event.is_set():
                data = ffmpeg_proc.stdout.read(320000)  # 10s × 16kHz × 2bytes
                if not data:
                    break
                chunk_queue.put(data)
        finally:
            stop_event.set()
            for p in [curl_proc, ffmpeg_proc]:
                try:
                    p.terminate()
                    p.wait(timeout=3)
                except Exception:
                    pass

    samples_10s = 16000 * 10 * 2
    buf = b""
    total_transcribed = 0

    def sigint_handler(signum, frame):
        print("\n[停止] …", file=sys.stderr)
        stop_event.set()
    old_handler = signal.signal(signal.SIGINT, sigint_handler)

    # 启动下载线程
    t_download = threading.Thread(target=downloader, daemon=True)
    t_download.start()

    # 主线程：等待队列 → 转写
    last_activity = _time.time()
    while not stop_event.is_set():
        # 非阻塞：把队列里已有的数据全部读完
        got_data = False
        while True:
            try:
                d = chunk_queue.get_nowait()
                buf += d
                got_data = True
            except queue.Empty:
                break
        now = _time.time()
        # 有 30s 数据就处理；或队列空时等待 0.5s 再试
        if len(buf) >= samples_10s * 3:
            block = buf[:samples_10s]
            buf = buf[samples_10s:]
            pcm_i16 = np.frombuffer(block, dtype=np.int16)
            pcm_f32 = pcm_i16.astype(np.float32) / 32768.0
            if np.abs(pcm_f32).max() >= 0.005:
                result = asr_model.generate(input=pcm_f32, language="auto", use_itn=True)
                text = _re.sub(r"<\|[a-z]{2}\|>", "", result[0]["text"]).strip()
                if text:
                    ts = _time.strftime("%H:%M:%S")
                    print(f"[{ts}] {text}", file=sys.stderr)
                    print(json.dumps({"ts": ts, "text": text}, ensure_ascii=False))
                    total_transcribed += len(text)
                    last_activity = now
        else:
            if not got_data:
                if now - last_activity > 90:
                    print("[超时] 90s 无数据，退出", file=sys.stderr)
                    break
                _time.sleep(0.5)

    # 处理剩余
    if buf and not stop_event.is_set():
        pcm_i16 = np.frombuffer(buf, dtype=np.int16)
        pcm_f32 = pcm_i16.astype(np.float32) / 32768.0
        if np.abs(pcm_f32).max() >= 0.005:
            result = asr_model.generate(input=pcm_f32, language="auto", use_itn=True)
            text = _re.sub(r"<\|[a-z]{2}\|>", "", result[0]["text"]).strip()
            if text:
                print(f"[{_time.strftime('%H:%M:%S')}] {text}", file=sys.stderr)

    t_download.join(timeout=5)
    signal.signal(signal.SIGINT, old_handler)
    print("[转写] 结束", file=sys.stderr)
    return {"status": "done", "chars": total_transcribed}


def cmd_settings(action: str = "get", key: str = "", value: str = "") -> dict:
    if action == "get":
        return get("/settings")
    if action == "set":
        current = get("/settings")
        new_settings = {**current, key: value}
        post("/settings", new_settings)
        return {"status": "updated", key: value}
    raise SystemExit(f"Unknown settings action: {action}")


# ── CLI entry point ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Canvas2Note CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  python cli.py list-courses
  python cli.py list-files --course-id 88220
  python cli.py transcribe --video /data/lecture1.mp4 --course "生物学基础"
  python cli.py generate-notes --course "生物学基础" --transcript-text "$(python cli.py get-transcript --name '生物学基础/生物学基础_第1讲_')"
  python cli.py chat --messages '[{"role":"user","content":"总结这节课"}]' --context-note "$(cat notes/生物学基础/第1讲_.md)"
        """
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    # list-courses
    sub.add_parser("list-courses", help="列出所有课程")

    # list-files
    p = sub.add_parser("list-files", help="列出课程文件")
    p.add_argument("--course-id", type=int, required=True)

    # list-videos
    p = sub.add_parser("list-videos", help="列出课程视频")
    p.add_argument("--course-id", type=int, required=True)

    # download-file
    p = sub.add_parser("download-file", help="下载课程文件")
    p.add_argument("--course-id", type=int, required=True)
    p.add_argument("--file-id", type=int, required=True)
    p.add_argument("--file-name", required=True)
    p.add_argument("--output-dir", default=".")

    # transcribe
    p = sub.add_parser("transcribe", help="转写视频（支持 faster-whisper / Qwen3 / API）")
    p.add_argument("--video", required=True, help="视频文件路径")
    p.add_argument("--course", required=True, help="课程名（用于存放路径）")
    p.add_argument("--no-wait", action="store_true", help="立即返回 task_id，不等待完成")

    # batch-transcribe
    p = sub.add_parser("batch-transcribe", help="批量转写（需 JSON 格式任务列表）")
    p.add_argument("--items", nargs="+", required=True,
                   help="JSON 字符串，如 '{\"course_id\":1,\"video_id\":\"...\",\"title\":\"...\",\"play_index\":0}'")
    p.add_argument("--course", required=True, help="课程名")
    p.add_argument("--delete", action="store_true", help="转写完成后删除原视频")

    # analyze-frames
    p = sub.add_parser("analyze-frames", help="用 Qwen3-VL 逐帧分析视频截图")
    p.add_argument("--video", required=True, help="视频文件路径")
    p.add_argument("--interval", type=int, default=60, help="抽帧间隔秒数（默认 60）")
    p.add_argument("--max-frames", type=int, default=16, help="最多帧数（默认 16）")
    p.add_argument("--prompt", default="", help="额外提示词")

    # describe-video
    p = sub.add_parser("describe-video", help="用 Qwen3-VL 直接理解视频（无需抽帧）")
    p.add_argument("--video", required=True, help="视频文件路径")
    p.add_argument("--duration", type=float, default=0, help="截取时长秒数（默认 0=完整视频，自动压缩超长视频到 600s）")
    p.add_argument("--start", type=float, default=0, help="开始时间（秒，默认 0）")
    p.add_argument("--prompt", default="", help="分析指令")
    p.add_argument("-o", "--output", help="输出文件")

    # list-transcripts
    p = sub.add_parser("list-transcripts", help="列出转写文件")
    p.add_argument("--course", default="", help="按课程名过滤")

    # get-transcript
    p = sub.add_parser("get-transcript", help="获取转写内容")
    p.add_argument("--name", required=True, help="转写文件名，格式：'课程名/文件名'")

    # generate-notes
    p = sub.add_parser("generate-notes", help="生成笔记")
    p.add_argument("--course", required=True, help="课程名")
    p.add_argument("--doc", dest="docs", action="append", default=[], help="课件路径（可多次指定）")
    p.add_argument("--transcript-text", default="", help="转写文本内容")
    p.add_argument("--transcript-name", default="", help="笔记命名用的转写文件名（不含扩展名）")
    p.add_argument("--output", "-o", default="", help="输出文件路径")

    # list-notes
    p = sub.add_parser("list-notes", help="列出笔记")
    p.add_argument("--course", default="", help="按课程名过滤")

    # get-note
    p = sub.add_parser("get-note", help="获取笔记内容")
    p.add_argument("--course", required=True)
    p.add_argument("--filename", required=True)

    # chat
    p = sub.add_parser("chat", help="与 LLM 对话")
    p.add_argument("--messages", nargs="+", required=True, help="JSON 消息字符串列表")
    p.add_argument("--context-note", default="", help="上下文笔记内容")
    p.add_argument("--model", default="", help="覆盖默认模型（当前未实现）")

    # settings
    p = sub.add_parser("settings", help="读取/修改设置")
    p.add_argument("action", nargs="?", choices=["get", "set"], default="get")
    p.add_argument("--key", default="")
    p.add_argument("--value", default="")

    # live-list
    p = sub.add_parser("live-list", help="列出课程直播列表（External Tool 9487）")
    p.add_argument("--course-id", type=int, required=True, help="Canvas 课程 ID")

    # live-screenshot
    p = sub.add_parser("live-screenshot", help="从直播截取电脑屏幕截图")
    p.add_argument("--course-id", type=int, required=True)
    p.add_argument("--live-id", required=True, help="直播 ID（来自 live-list）")
    p.add_argument("--output", default="/tmp/live_screen.jpg", help="输出路径")

    # live-qr
    p = sub.add_parser("live-qr", help="从直播屏幕截图识别二维码")
    p.add_argument("--course-id", type=int, required=True)
    p.add_argument("--live-id", required=True)
    p.add_argument("--output", default="/tmp/live_screen.jpg")

    # live-transcribe
    p = sub.add_parser("live-transcribe", help="实时转写直播（仅屏幕流，Ctrl+C 停止）")
    p.add_argument("--course-id", type=int, required=True)
    p.add_argument("--live-id", default="", help="直播 ID（省略则自动取最新）")
    p.add_argument("--stream-url", default="", help="直接传入 FLV 流地址（覆盖 live-id）")
    p.add_argument("--duration", type=int, default=120, help="最多录制秒数（默认 120）")

    args = parser.parse_args()
    cmd = args.cmd

    try:
        if cmd == "list-courses":
            out = cmd_list_courses()
        elif cmd == "list-files":
            out = cmd_list_files(args.course_id)
        elif cmd == "list-videos":
            out = cmd_list_videos(args.course_id)
        elif cmd == "download-file":
            out = cmd_download_file(args.course_id, args.file_id, args.file_name, args.output_dir)
        elif cmd == "transcribe":
            out = cmd_transcribe(args.video, args.course, wait=not args.no_wait)
        elif cmd == "batch-transcribe":
            out = cmd_batch_transcribe(args.items, args.course, delete_video=args.delete)
        elif cmd == "describe-video":
            out = cmd_describe_video(args.video, args.duration, args.start, args.prompt, args.output)
        elif cmd == "analyze-frames":
            out = cmd_analyze_frames(args.video, args.interval, args.max_frames, args.prompt)
        elif cmd == "list-transcripts":
            out = cmd_list_transcripts(args.course)
        elif cmd == "get-transcript":
            out = cmd_get_transcript(args.name)
        elif cmd == "generate-notes":
            out = cmd_generate_notes(args.course, args.docs, args.transcript_text,
                                     args.transcript_name, args.output)
        elif cmd == "list-notes":
            out = cmd_list_notes(args.course)
        elif cmd == "get-note":
            out = cmd_get_note(args.course, args.filename)
        elif cmd == "chat":
            out = cmd_chat(args.messages, args.context_note, args.model)
        elif cmd == "settings":
            out = cmd_settings(args.action, args.key, args.value)
        elif cmd == "live-list":
            out = cmd_live_list(args.course_id)
        elif cmd == "live-screenshot":
            out = cmd_live_screenshot(args.course_id, args.live_id, args.output)
        elif cmd == "live-qr":
            out = cmd_live_qr(args.course_id, args.live_id, args.output)
        elif cmd == "live-transcribe":
            out = cmd_live_transcribe(args.course_id, args.live_id, args.stream_url, args.duration)
        else:
            parser.print_help()
            return

        print(json.dumps(out, ensure_ascii=False, indent=2))

    except SystemExit as e:
        if str(e):
            print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(0 if not str(e) else 1)
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    import urllib.parse  # used by get-transcript
    main()
