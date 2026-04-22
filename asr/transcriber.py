"""
语音转写：支持 translate.sjtu.edu.cn（交大 AI 转录）、本地 faster-whisper、Qwen3-ASR 和 OpenAI 兼容 ASR API
"""
import os
import torch
import subprocess
import importlib
from pathlib import Path
from config import AUDIO_DIR

_model = None
_qwen_model = None


def _reload():
    """Reload config so new settings.json values take effect."""
    global _model, _qwen_model
    _model = None
    _qwen_model = None
    import config as _c
    importlib.reload(_c)


def _cfg() -> dict:
    """Read ASR config from settings.json (runtime overrides)."""
    f = Path(__file__).parent.parent / "settings.json"
    defaults = {"asr_engine": "translate", "asr_device": "cuda", "asr_model": "base",
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
    cfg = _cfg()
    lang = cfg.get("asr_language", "auto")   # 设置语言，如 "de"/"zh"/"auto"
    language = None if lang == "auto" else lang
    print(f"[ASR] 转录: {Path(audio_path).name} (lang={language or 'auto'})")
    model = _load_whisper()
    segments, _ = model.transcribe(str(audio_path), language=language, beam_size=5)
    text = "".join(s.text for s in segments).strip()
    print(f"[ASR] 完成，字符数: {len(text)}")
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


# ── translate.sjtu.edu.cn ──────────────────────────────────────────────────────

def _transcribe_translate(audio_or_video_path: str | os.PathLike) -> str:
    from canvas.translate_client import TranslateClient
    from dotenv import load_dotenv
    load_dotenv()
    print(f"[translate.sjtu.edu.cn] 转录: {Path(audio_or_video_path).name}")
    client = TranslateClient()
    text = client.upload_and_wait(audio_or_video_path).strip()
    print(f"[translate] 完成，字符数: {len(text)}")
    return text


# ── Qwen3-ASR ───────────────────────────────────────────────────────────────────

def _load_qwen3():
    global _qwen_model
    if _qwen_model is not None:
        return _qwen_model
    from qwen_asr import Qwen3ASRModel
    device, idx = _gpu_info()
    actual = device if device.startswith("cuda") else "cpu"
    cfg = _cfg()
    model_name = cfg.get("asr_model", "Qwen/Qwen3-ASR-1.7B")
    print(f"[Qwen3-ASR] 加载 {model_name} on {actual} ...")
    kw = {}
    if device.startswith("cuda"):
        # GPU 1 留给 vLLM，用 GPU 0
        cuda_idx = int(device.split(":")[1]) if ":" in device else 0
        if cuda_idx == 1:
            cuda_idx = 0
            actual = f"cuda:{cuda_idx}"
            print(f"[Qwen3-ASR] GPU 1 被占用，切换到 GPU 0")
        kw["device_map"] = actual
    else:
        kw["device_map"] = "cpu"
    _qwen_model = Qwen3ASRModel.from_pretrained(
        model_name,
        dtype=torch.bfloat16,
        max_new_tokens=4096,
        **kw
    )
    print("[Qwen3-ASR] 模型加载完成")
    return _qwen_model


def _transcribe_qwen3(audio_or_video_path: str | os.PathLike, chunk_minutes: int = 5) -> str:
    """
    Qwen3-ASR 转录，支持任意长度音频。
    将音频按 chunk_minutes 分段处理，拼接结果。
    支持语言：Chinese / English / Cantonese / Arabic / ...（见 Qwen3-ASR 支持列表）
    配置 asr_language 切换语言，如 asr_language=German 用于德语课程。
    """
    cfg = _cfg()
    lang = cfg.get("asr_language", "Chinese")
    path = Path(audio_or_video_path)
    print(f"[Qwen3-ASR] 转录: {path.name} (lang={lang})")
    model = _load_qwen3()

    # 提取音频（16kHz 单声道 WAV）
    audio_path = extract_audio(path, course_name="")
    if not audio_path.exists():
        raise FileNotFoundError(f"音频提取失败: {audio_path}")

    # 获取时长
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(audio_path)],
        capture_output=True, text=True, check=True,
    )
    total_sec = float(probe.stdout.strip())
    chunk_sec = chunk_minutes * 60
    texts = []

    import time
    t0 = time.time()

    for start in range(0, int(total_sec), chunk_sec):
        chunk_file = audio_path.parent / f"{audio_path.stem}_chunk_{start//chunk_sec:03d}.wav"
        end = min(start + chunk_sec, int(total_sec))
        subprocess.run([
            "ffmpeg", "-y", "-i", str(audio_path),
            "-ss", str(start), "-t", str(end - start),
            "-ar", "16000", "-ac", "1", "-f", "wav", str(chunk_file)
        ], capture_output=True, check=True)

        results = model.transcribe(audio=str(chunk_file), language=lang)
        chunk_text = results[0].text.strip() if results else ""
        if chunk_text:
            texts.append(chunk_text)
        chunk_file.unlink(missing_ok=True)

    elapsed = time.time() - t0
    full_text = "\n".join(texts)
    print(f"[Qwen3-ASR] 完成，{len(texts)} 段，耗时 {elapsed:.0f}s，字符数: {len(full_text)}")
    return full_text


# ── Public API ────────────────────────────────────────────────────────────────

def transcribe(audio_path: str | os.PathLike, course_name: str = "") -> str:
    cfg = _cfg()
    engine = cfg.get("asr_engine", "translate")
    if engine == "api":
        return _transcribe_api(audio_path)
    if engine == "faster-whisper":
        return _transcribe_whisper(audio_path)
    if engine == "qwen3":
        return _transcribe_qwen3(audio_path)
    # 默认 / translate：直接对视频/音频文件调用 translate 站点
    return _transcribe_translate(audio_path)


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
