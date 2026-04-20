"""
语音转写：支持本地 faster-whisper 和 OpenAI 兼容 ASR API
"""
import os
import subprocess
from pathlib import Path
from config import AUDIO_DIR, ASR_DEVICE, ASR_MODEL

_model = None


def _get_device():
    if ASR_DEVICE != "cuda":
        return "cpu", -1
    free_mem = []
    try:
        for line in os.popen("nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits").readlines():
            free_mem.append(int(line.strip().split()[0]))
    except Exception:
        return "cpu", -1
    if not free_mem:
        return "cpu", -1
    idx = free_mem.index(max(free_mem))
    return f"cuda:{idx}", idx if max(free_mem) >= 6000 else -1


def _load_model():
    global _model
    if _model is not None:
        return _model

    device, idx = _get_device()
    compute = "float16" if device.startswith("cuda") else "int8"

    from faster_whisper import WhisperModel
    print(f"[ASR] 加载 faster-whisper {ASR_MODEL} on {device} ...")
    kw = {} if idx < 0 else {"device_index": idx}
    _model = WhisperModel(ASR_MODEL, device="cuda" if device.startswith("cuda") else "cpu",
                          compute_type=compute, **kw)
    print("[ASR] 模型加载完成")
    return _model


def transcribe(audio_path: str | os.PathLike, course_name: str = "") -> str:
    """
    转写音频文件。
    - ASR_DEVICE=cuda/cpu  → 本地 faster-whisper
    - ASR_DEVICE=api         → OpenAI 兼容 ASR API（需配合 settings 中的 asr_api_* 配置）
    """
    if ASR_DEVICE == "api":
        return _transcribe_api(audio_path, course_name)
    return _transcribe_local(audio_path, course_name)


def _transcribe_local(audio_path: str | os.PathLike, course_name: str = "") -> str:
    audio_path = os.fspath(audio_path)
    ap = Path(audio_path)
    print(f"[ASR] 转录: {ap.name}")
    model = _load_model()
    segments, _ = model.transcribe(
        audio_path,
        language="zh",
        beam_size=5,
    )
    text = "".join(s.text for s in segments).strip()
    print(f"[ASR] 完成，字符数: {len(text)}")
    return text


def _load_settings() -> dict:
    settings_file = Path(__file__).parent.parent / "settings.json"
    if settings_file.exists():
        import json
        return {
            "asr_api_base":  "",
            "asr_api_key":   "",
            "asr_api_model": "whisper-1",
            **json.loads(settings_file.read_text()),
        }
    return {"asr_api_base": "", "asr_api_key": "", "asr_api_model": "whisper-1"}


def _transcribe_api(audio_path: str | os.PathLike, course_name: str = "") -> str:
    """通过 OpenAI 兼容 ASR API 转写。"""
    cfg = _load_settings()
    ap = Path(audio_path)
    print(f"[ASR API] 转录: {ap.name}")

    base_url = cfg.get("asr_api_base", "")
    api_key  = cfg.get("asr_api_key", "")
    api_model = cfg.get("asr_api_model", "whisper-1")

    if not base_url or not api_key:
        raise RuntimeError(
            "ASR 已切换为 API 模式，请在设置中配置 ASR API（Base URL + API Key）。"
        )

    from openai import OpenAI
    client = OpenAI(base_url=base_url, api_key=api_key)
    with open(audio_path, "rb") as f:
        resp = client.audio.transcriptions.create(
            model=api_model,
            file=f,
            language="zh",
        )
    text = resp.text.strip()
    print(f"[ASR API] 完成，字符数: {len(text)}")
    return text


def transcribe_video(video_path: Path, course_name: str = "") -> str:
    audio_path = extract_audio(video_path, course_name)
    return transcribe(audio_path, course_name)


def extract_audio(video_path: Path, course_name: str = "") -> Path:
    audio_dir = AUDIO_DIR / course_name if course_name else AUDIO_DIR
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_path = audio_dir / (video_path.stem + ".wav")
    if audio_path.exists():
        return audio_path
    print(f"[ffmpeg] 提取音频: {video_path.name}")
    subprocess.run(
        ["ffmpeg", "-i", str(video_path), "-vn",
         "-ar", "16000", "-ac", "1", "-f", "wav", "-y", str(audio_path)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return audio_path
