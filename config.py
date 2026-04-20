import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.getenv("CANVAS_BASE_URL", "https://oc.sjtu.edu.cn")
TOKEN    = os.getenv("CANVAS_TOKEN", "")

DATA_DIR      = Path("data")
DOWNLOAD_DIR  = DATA_DIR / "downloads"
AUDIO_DIR     = DATA_DIR / "audio"
NOTES_DIR     = DATA_DIR / "notes"

for d in [DOWNLOAD_DIR, AUDIO_DIR, NOTES_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ASR
ASR_MODEL   = "base"
ASR_DEVICE  = "cuda"

# LLM（本地 Ollama 或 OpenAI 兼容接口）
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_API_KEY  = os.getenv("LLM_API_KEY", "ollama")
LLM_MODEL    = os.getenv("LLM_MODEL", "qwen3:8b")

# 文件类型过滤
DOC_EXTENSIONS = {".pdf", ".pptx", ".ppt", ".docx", ".doc"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
