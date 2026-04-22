"""
视频帧分析：Qwen3-VL-8B（vLLM 推理）
ffmpeg 抽帧 → vLLM API → 合并描述

依赖：requests, vllm 服务运行在 VLLM_BASE_URL（默认 http://localhost:8080）
"""
from __future__ import annotations

import base64
import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable

import requests

logger = logging.getLogger(__name__)

VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8080")
VLLM_MODEL    = os.getenv("VLLM_MODEL",    "Qwen/Qwen3-VL-8B-Instruct")
VLLM_TIMEOUT  = int(os.getenv("VLLM_TIMEOUT", "120"))

_http = None

def _session() -> requests.Session:
    global _http
    if _http is None:
        _http = requests.Session()
        _http.headers["Content-Type"] = "application/json"
    return _http


def health_check() -> bool:
    try:
        r = _session().get(f"{VLLM_BASE_URL}/health", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


# ── 抽帧 ─────────────────────────────────────────────────────────────────────

def _extract_frames(video_path: str, interval_sec: float = 60, max_frames: int = 16):
    """
    ffmpeg 均匀抽帧。

    Returns:
        ([(帧路径, 时间戳秒), ...], tmpdir)
    """
    tmpdir = tempfile.mkdtemp(prefix="qwen3vl_")
    probe = subprocess.run(
        ["ffprobe", "-v", "error",
         "-show_entries", "format=duration",
         "-of", "csv=p=0", str(video_path)],
        capture_output=True, text=True, check=True,
    )
    duration = float(probe.stdout.strip())

    # 每隔 interval_sec 抽一帧，最多 max_frames
    if max_frames <= 0:
        max_frames = 16
    step = max(duration / max_frames, interval_sec)
    timestamps = []
    t = 0.0
    while t < duration and len(timestamps) < max_frames:
        timestamps.append(round(t, 2))
        t += step

    frames = []
    for i, ts in enumerate(timestamps):
        out = os.path.join(tmpdir, f"frame_{i:04d}.jpg")
        subprocess.run(
            ["ffmpeg", "-ss", str(ts), "-i", str(video_path),
             "-vframes", "1", "-q:v", "2", "-y", out],
            capture_output=True, check=True,
        )
        frames.append((out, ts))

    logger.info(f"[VLM] 抽取 {len(frames)} 帧 -> {tmpdir}")
    return frames, tmpdir


# ── 单帧推理 ────────────────────────────────────────────────────────────────

def describe_frame(image_path: str | Path, prompt: str = "") -> str:
    """
    分析单张图片（base64 编码，通过 vLLM API 调用）。

    Args:
        image_path: 图片路径
        prompt:     补充指令
    """
    path = str(Path(image_path).resolve())
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")

    ext = Path(path).suffix.lstrip(".").lower()
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "webp": "image/webp"}.get(ext, "image/jpeg")

    messages = [{
        "role": "user",
        "content": [
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            },
            {
                "type": "text",
                "text": (
                    "你是一个幻灯片分析助手。请详细描述这张幻灯片，包括：\n"
                    "1. 所有可见文字（保留原语言）\n"
                    "2. 图表、流程图、公式、示意图\n"
                    "3. 代码片段或技术内容\n"
                    "4. 主要视觉元素和布局\n"
                    + (f"\n附加要求：{prompt}" if prompt else "")
                ),
            },
        ],
    }]

    resp = _session().post(
        f"{VLLM_BASE_URL}/v1/chat/completions",
        json={
            "model": VLLM_MODEL,
            "messages": messages,
            "max_tokens": 512,
            "temperature": 0.0,
        },
        timeout=VLLM_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


# ── 直接视频理解 ─────────────────────────────────────────────────────────

def describe_video(
    video_path: str | Path,
    prompt: str = "",
    max_duration: float = 0,
    start: float = 0,
) -> str:
    """
    直接理解视频（Qwen3-VL 原生视频输入，无需抽帧）。

    Args:
        video_path:    视频文件路径
        prompt:        分析指令
        max_duration: 截取时长（秒），默认 0=完整视频（超过 600s 自动压缩到 600s）
        start:        开始时间（秒），默认 0
    """
    path = str(Path(video_path).resolve())

    # 预处理：截取片段（减少 base64 大小）
    clip_path = path
    tmpdir = None

    probe = subprocess.run(
        ["ffprobe", "-v", "error",
         "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    duration = float(probe.stdout.strip())

    # max_duration <= 0 表示完整视频，但超长视频压缩到 600s
    target = max_duration if max_duration > 0 else min(duration, 600)

    if duration > target:
        tmpdir = tempfile.mkdtemp(prefix="qwen3vl_video_")
        clip_path = os.path.join(tmpdir, "clip.mp4")
        subprocess.run(
            ["ffmpeg", "-y",
             "-ss", str(start),
             "-i", path,
             "-t", str(target),
             "-vf", "scale=448:-1",
             "-r", "2",
             "-c:v", "libx264", "-preset", "fast", "-crf", "28",
             "-c:a", "aac", "-ar", "16000", "-ac", "1",
             clip_path],
            capture_output=True, check=True,
        )
        logger.info(f"[VLM] 视频截取 {target}s -> {clip_path}")

    with open(clip_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")

    # 清理截取文件
    if tmpdir:
        try:
            os.remove(clip_path)
            os.rmdir(tmpdir)
        except OSError:
            pass

    extra = f"\n附加要求：{prompt}" if prompt else ""

    messages = [{
        "role": "user",
        "content": [
            {
                "type": "video_url",
                "video_url": {"url": f"data:video/mp4;base64,{b64}"},
            },
            {
                "type": "text",
                "text": (
                    "请详细描述这个视频的内容，包括：\n"
                    "1. 视频的主要场景和活动\n"
                    "2. 所有可见的文字（保留原语言）\n"
                    "3. 人物外貌、语言（如果有）\n"
                    "4. 图表、幻灯片、代码或屏幕内容\n"
                    "5. 整体目的和主题\n"
                    + extra
                ),
            },
        ],
    }]

    resp = _session().post(
        f"{VLLM_BASE_URL}/v1/chat/completions",
        json={
            "model": VLLM_MODEL,
            "messages": messages,
            "max_tokens": 512,
            "temperature": 0.0,
        },
        timeout=VLLM_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


# ── 全视频分析 ─────────────────────────────────────────────────────────────

def analyze_video(
    video_path: str | Path,
    interval: int = 60,
    max_frames: int = 16,
    extra_prompt: str = "",
    progress: Callable[[str, str], None] | None = None,
) -> str:
    """
    视频分析：ffmpeg 均匀抽帧 → Qwen3-VL-8B 逐帧推理 → 合并描述。

    Args:
        video_path:   视频文件路径
        interval:     抽帧间隔（秒），默认 60s
        max_frames:   最大帧数，默认 16
        extra_prompt: 追加到每帧分析的指令
        progress:     回调 (status, detail) -> None
    """
    video_path = str(Path(video_path).resolve())
    frames, tmpdir = _extract_frames(video_path, interval_sec=float(interval), max_frames=max_frames)

    t0 = time.time()
    results: list[tuple[float, float, str]] = []

    for i, (frame_path, ts) in enumerate(frames):
        status = f"分析帧 {i+1}/{len(frames)} (t={ts:.0f}s)"
        logger.info(f"[VLM] {status} …")
        if progress:
            progress("分析中", status)

        try:
            desc = describe_frame(frame_path, extra_prompt)
            elapsed = round(time.time() - t0, 1)
            results.append((ts, elapsed, desc))
        except Exception as e:
            import traceback
            traceback.print_exc()
            results.append((ts, 0.0, f"[失败: {e}]"))

    total = time.time() - t0
    logger.info(f"[VLM] 完成: {total:.1f}s ({total/len(frames):.2f}s/帧)")

    # 清理临时帧
    for fp, _ in frames:
        try:
            os.remove(fp)
        except OSError:
            pass
    try:
        os.rmdir(tmpdir)
    except OSError:
        pass

    parts = [f"=== t={t:.0f}s ({e:.1f}s) ===\n{d}" for t, e, d in results]
    return "\n\n".join(parts)
