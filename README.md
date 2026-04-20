# Canvas2Note

上海交通大学课程录屏 → 语音转写 → AI 整理笔记全流程工具。

![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 功能

- **课程文件下载** — 从 Canvas (oc.sjtu.edu.cn) 下载课程 PDF/PPT/DOCX 课件，支持按文件夹浏览
- **课堂录屏下载** — 通过 JAAuthCookie + LTI 认证下载 courses.sjtu.edu.cn 课堂录屏，支持断点续传
- **语音转写** — 支持三种 ASR 引擎：本地 `faster-whisper`、FunASR (SenseVoice/Paraformer)、OpenAI 兼容 ASR API，可按课程批量转写
- **录屏截图分析** — 使用 SmolVLM2-500M 提取视频帧并理解幻灯片内容，生成图片描述文字，融入笔记
- **AI 笔记生成** — 将课件文字、录屏截图描述与讲义转录融合，生成结构清晰的 Markdown 笔记；笔记按转录文件名命名，不覆盖历史文件
- **LLM 对话** — 在笔记页面右侧与 AI 助手对话，支持 Markdown 渲染，历史记录按笔记自动保存
- **批量工作流** — 一键完成 下载 → 转写 → 删除视频，进度在侧边栏实时跟踪
- **CLI 接口** — 完整 JSON CLI，Agent 可调用所有功能（课程/文件/视频/转写/截图分析/笔记/对话/设置）
- **Web UI** — 浏览器内管理课程、视频、转录、笔记，支持流式输出和设置配置

## 目录结构

```
Canvas2note/
├── canvas/              # Canvas API 客户端
│   ├── client.py        # 课程/文件/视频列表 API
│   └── video_client.py  # 交大录屏下载 (JAAuth + LTI)
├── asr/                 # 语音转写
│   ├── transcriber.py   # faster-whisper + FunASR + ASR API 三引擎
│   └── frame_extractor.py
├── parser/              # 文档解析
│   └── doc_parser.py
├── notes/               # 笔记生成
│   └── generator.py
├── llm_client.py        # 统一 LLM 调用 (OpenAI 兼容)
├── vlm_client.py        # SmolVLM2-500M 截图分析 (HuggingFace transformers)
├── pipeline.py          # 命令行全流程
├── cli.py               # Agent CLI（所有操作的 JSON 接口）
├── server.py            # FastAPI 后端（所有 API + SSE 流式）
├── frontend/            # React + Vite + Tailwind CSS 前端
├── config.py            # 配置管理
└── data/                # 下载文件、转录、笔记、聊天记录
    ├── downloads/
    ├── audio/           # 转录文本，按课程名目录存放
    ├── notes/           # 生成的 Markdown 笔记，按课程名目录存放
    └── chats/           # 聊天历史，按 "{course}_{note_stem}.json" 命名
```

## 快速开始

### 1. 安装依赖

```bash
uv sync
# FunASR（推荐用于中文课程）
pip install funasr
# SmolVLM2 截图分析（GPU，推荐）
pip install transformers torch
```

### 2. 配置

首次启动后访问 http://localhost:8000 ，在右上角 **SETTINGS** 填写：

| 字段 | 说明 |
|---|---|
| Canvas Base URL | `https://oc.sjtu.edu.cn` |
| Canvas Token | 登录 oc.sjtu.edu.cn → Account → Settings → New Access Token |
| JA Auth Cookie | 录屏下载认证：浏览器登录 courses.sjtu.edu.cn → F12 → Application → Cookies → `JAAuthCookie` |
| LLM Base URL | API 地址，如 `https://api.deepseek.com/v1` |
| LLM API Key | 你的 API 密钥 |
| LLM Model | 模型名称，如 `deepseek-chat` |
| ASR 引擎 | `faster-whisper` / `FunASR` / `API` |
| ASR 模型 | 引擎对应模型名（如 FunASR: SenseVoiceSmall） |
| ASR 硬件 | `cuda`（GPU）或 `cpu` |

配置保存在 `settings.json`，重启后保留。

### 3. 启动 Web UI

```bash
cd /path/to/Canvas2note
python -m uvicorn server:app --port 8000 --host 0.0.0.0
```

访问 http://localhost:8000

### 4. CLI（Agent 调用）

所有命令返回 JSON，流式命令实时输出到 stderr：

```bash
# 课程 / 文件 / 视频
python cli.py list-courses
python cli.py list-files --course-id 88220
python cli.py list-videos --course-id 88220

# 转写（自动根据设置选择引擎）
python cli.py transcribe --video /data/lecture.mp4 --course "生物学基础"
python cli.py batch-transcribe --items '{"course_id":88220,"video_id":"...","title":"第1讲","play_index":0}'

# 转写文件
python cli.py list-transcripts --course "生物学基础"
python cli.py get-transcript --name "生物学基础/生物学基础_第1讲_"

# 截图分析（SmolVLM2）
python cli.py analyze-frames --video /data/lecture.mp4 --interval 60

# 笔记
python cli.py generate-notes --course "生物学基础" \
    --doc slides.pdf \
    --transcript-text "$(cat transcript.txt)" \
    --frame-descriptions "$(python cli.py analyze-frames --video lecture.mp4 --interval 60)" \
    --transcript-name "生物学基础_第1讲_" \
    -o notes/生物学基础_第1讲_.md
python cli.py list-notes --course "生物学基础"
python cli.py get-note --course "生物学基础" --filename "生物学基础_第1讲_.md"

# 对话
python cli.py chat \
    --messages '[{"role":"user","content":"总结这节课的核心内容"}]' \
    --context-note "$(cat notes/生物学基础_第1讲_.md)"

# 设置
python cli.py settings get
python cli.py settings set --key asr_model --value "iic/SenseVoiceSmall"
```

## ASR 引擎对比

| 引擎 | 模型 | 中文 | 其他语言 | 硬件 |
|---|---|---|---|---|
| **FunASR（推荐）** | SenseVoiceSmall | ✓ 粤语/普通话 | 英/日/韩 | GPU/CPU |
| | Fun-ASR-Nano | ✓ 7种方言+26口音 | 英/日 | GPU/CPU |
| | Paraformer-zh | ✓ 专精 | — | GPU/CPU |
| **faster-whisper** | base~large-v3 | ✓ | ✓ 99+语言 | GPU/CPU |
| **API** | OpenAI 兼容 | ✓ | ✓ | 云端 |

## VLM 截图分析

使用 HuggingFace `SmolVLM2-500M-Video-Instruct` 分析录屏画面：

- 从视频中按固定间隔提取帧
- 每帧通过 SmolVLM2 理解幻灯片内容
- 输出标题、文字、图表、公式、代码的中文描述
- 描述结果可传入笔记生成（`--frame-descriptions`），让 LLM 融合视觉信息

## 工作流程

```
Canvas 课件下载         录屏下载
      │                     │
      ▼                     ▼
┌─────────────────┐  ┌─────────────────┐
│  PDF / PPTX     │  │  视频文件        │
│  → 文字提取     │  │  → ASR 转写      │
│  (doc_parser)   │  │  FunASR/Whisper  │
└────────┬────────┘  └────────┬────────┘
         │                   │
         │            ┌─────┴──────┐
         │            │ SmolVLM2   │
         │            │ 截图分析    │
         │            └─────┬──────┘
         ▼                   ▼
   【课件】文字        【录屏截图描述】
         │                   │
         │            【讲义】转录
         │                   │
         └────────┬───────────┘
                  ▼
         ┌─────────────────┐
         │  LLM 融合整理    │
         │  → Markdown 笔记 │
         │  → 笔记对话      │
         └─────────────────┘
```

## 技术栈

- **后端**：FastAPI + Uvicorn（SSE 流式响应）
- **前端**：React + Vite + Tailwind CSS
- **ASR**：faster-whisper / FunASR (SenseVoice/Paraformer) / OpenAI 兼容 API
- **VLM**：HuggingFace SmolVLM2-500M（截图分析）
- **LLM**：OpenAI 兼容 API（DeepSeek / Ollama / SiliconFlow 等）
- **文档解析**：`pypdf` / `python-pptx` / `python-docx`
- **依赖管理**：`uv`

## License

MIT
