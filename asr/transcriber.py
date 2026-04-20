"""
语音转写：支持本地 faster-whisper、FunASR (SenseVoice/Paraformer) 和 OpenAI 兼容 ASR API
"""
import os
import subprocess
import importlib
from pathlib import Path
from config import AUDIO_DIR

_model = None
_fun_model = None


def _reload():
    """Reload config so new settings.json values take effect."""
    global _model, _fun_model
    _model = None
    _fun_model = None
    import config as _c
    importlib.reload(_c)


def _cfg() -> dict:
    """Read ASR config from settings.json (runtime overrides)."""
    f = Path(__file__).parent.parent / "settings.json"
    defaults = {"asr_engine": "funasr", "asr_device": "cuda", "asr_model": "iic/SenseVoiceSmall",
                "asr_api_base": "", "asr_api_key": "", "asr_api_model": "whisper-1"}
    if f.exists():
        import json
        return {**defaults, **json.loads(f.read_text())}
    return defaults


def _gpu_info():
    """Returns (device_str, gpu_index)."""
    cfg = _cfg()
    if cfg.get("asr_device") != "cuda":
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


# ── faster-whisper ─────────────────────────────────────────────────────────────

def _load_whisper():
    global _model
    if _model is not None:
        return _model
    device, idx = _gpu_info()
    cfg = _cfg()
    compute = "float16" if device.startswith("cuda") else "int8"
    from faster_whisper import WhisperModel
    print(f"[ASR] 加载 faster-whisper {cfg['asr_model']} on {device} ...")
    kw = {} if idx < 0 else {"device_index": idx}
    _model = WhisperModel(cfg["asr_model"],
                          device="cuda" if device.startswith("cuda") else "cpu",
                          compute_type=compute, **kw)
    print("[ASR] 模型加载完成")
    return _model


def _transcribe_whisper(audio_path: str | os.PathLike) -> str:
    print(f"[ASR] 转录: {Path(audio_path).name}")
    model = _load_whisper()
    segments, _ = model.transcribe(str(audio_path), language="zh", beam_size=5)
    text = "".join(s.text for s in segments).strip()
    print(f"[ASR] 完成，字符数: {len(text)}")
    return text


# ── FunASR ─────────────────────────────────────────────────────────────────────

def _load_funasr():
    global _fun_model
    if _fun_model is not None:
        return _fun_model
    device, _ = _gpu_info()
    cfg = _cfg()
    actual = device if device.startswith("cuda") else "cpu"
    print(f"[FunASR] 加载 {cfg['asr_model']} on {actual} ...")
    from funasr import AutoModel
    _fun_model = AutoModel(model=cfg["asr_model"], device=actual, disable_update=True)
    print("[FunASR] 模型加载完成")
    return _fun_model


def _transcribe_funasr(audio_path: str | os.PathLike) -> str:
    print(f"[FunASR] 转录: {Path(audio_path).name}")
    model = _load_funasr()
    res = model.generate(input=str(audio_path), language="auto", use_itn=True, batch_size_s=60)
    text = res[0]["text"].strip() if res else ""
    import re
    text = re.sub(r'<\|[^|]+\|>', '', text).strip()
    print(f"[FunASR] 完成，字符数: {len(text)}")
    return text


# ── OpenAI 兼容 API ────────────────────────────────────────────────────────────

def _transcribe_api(audio_path: str | os.PathLike) -> str:
    cfg = _cfg()
    print(f"[ASR API] 转录: {Path(audio_path).name}")
    base_url = cfg.get("asr_api_base", "")
    api_key  = cfg.get("asr_api_key", "")
    model    = cfg.get("asr_api_model", "whisper-1")
    if not base_url or not api_key:
        raise RuntimeError("ASR API 模式未配置，请在设置中填入 Base URL + API Key")
    from openai import OpenAI
    client = OpenAI(base_url=base_url, api_key=api_key)
    with open(audio_path, "rb") as f:
        resp = client.audio.transcriptions.create(model=model, file=f, language="zh")
    text = resp.text.strip()
    print(f"[ASR API] 完成，字符数: {len(text)}")
    return text


# ── Public API ────────────────────────────────────────────────────────────────

def transcribe(audio_path: str | os.PathLike, course_name: str = "") -> str:
    cfg = _cfg()
    engine = cfg.get("asr_engine", "funasr")
    if engine == "api":
        return _transcribe_api(audio_path)
    if engine == "funasr":
        return _transcribe_funasr(audio_path)
    return _transcribe_whisper(audio_path)


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
        ["ffmpeg", "-i", str(video_path),
         "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", "-y", str(audio_path)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return audio_path
