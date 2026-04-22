"""
ffmpeg 截图：从视频中按时间间隔均匀采样关键帧
"""
import subprocess
from pathlib import Path


def extract_frames(
    video_path: Path,
    output_dir: Path,
    interval_sec: int = 30,
) -> list[Path]:
    """
    每隔 interval_sec 秒截取一帧，保存为 JPEG。

    Returns: 截图路径列表，按时间排序
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # 获取视频总时长（秒）
    result = subprocess.run(
        ["ffprobe", "-v", "error",
         "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1",
         str(video_path)],
        capture_output=True, text=True,
    )
    try:
        total_sec = float(result.stdout.strip())
    except ValueError:
        total_sec = 60  # fallback

    frames = []
    for t in range(0, int(total_sec), interval_sec):
        out_path = output_dir / f"frame_{t:06d}.jpg"
        r = subprocess.run(
            ["ffmpeg", "-ss", str(t),
             "-i", str(video_path),
             "-vframes", "1",
             "-q:v", "2",          # quality (2=high)
             "-y",
             str(out_path)],
            capture_output=True,
            stderr=subprocess.DEVNULL,
        )
        if r.returncode == 0 and out_path.exists():
            frames.append(out_path)

    print(f"[frames] 截取 {len(frames)} 帧: {output_dir.name}")
    return frames
