# Canvas2Note

上海交通大学课程录屏 → 语音转写 → AI 整理笔记全流程工具。

![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 功能

- **课程文件下载** — 从 Canvas (oc.sjtu.edu.cn) 下载课程 PDF/PPT/DOCX 课件
- **课堂录屏下载** — 通过 JAAuthCookie + LTI 认证下载 courses.sjtu.edu.cn 课堂录屏，支持多线程断点续传
- **语音转写** — 使用 faster-whisper（Whisper）将视频转为文字，自动选录屏轨道，优先使用 GPU
- **AI 笔记生成** — 将课件文字与讲义转录融合，生成结构清晰的 Markdown 讲义笔记
- **Web UI** — 浏览器内管理课程、视频、转录、笔记，支持流式输出和设置配置

## 架构

```
用户上传录屏
    │
    ▼
┌─────────────────┐
│  ASR 转写        │  ← faster-whisper (Whisper)
│  视频 → 文字     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Canvas 课件     │  ← Canvas API (PDF/PPT/DOCX)
│  文档 → 文字     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LLM 融合整理    │  ← DeepSeek / OpenAI 兼容 API
│  课件 + 讲义     │
│  → Markdown 笔记 │
└─────────────────┘
```

## 目录结构

```
Canvas2note/
├── canvas/           # Canvas API 客户端
│   ├── client.py    # 课程/文件/视频列表 API
│   └── video_client.py  # 交大录屏下载 (JAAuth + LTI)
├── asr/              # 语音转写
│   └── transcriber.py
├── parser/           # 文档解析
│   └── doc_parser.py
├── notes/            # 笔记生成
│   └── generator.py
├── llm_client.py     # 统一 LLM 调用 (OpenAI / Anthropic 兼容)
├── pipeline.py       # 命令行全流程
├── server.py         # FastAPI 后端
├── frontend/         # React + Vite 前端
├── config.py         # 配置管理
└── build_frontend.py # 前端构建脚本
```

## 快速开始

### 1. 安装依赖

```bash
uv sync
```

或使用 pip：

```bash
pip install -e .
```

### 2. 配置

复制 `.env.example` 为 `.env`，填入以下信息：

```bash
# Canvas
CANVAS_BASE_URL=https://oc.sjtu.edu.cn
CANVAS_TOKEN=你的Canvas访问令牌

# LLM（支持 OpenAI 兼容接口）
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=你的API密钥
LLM_MODEL=deepseek-chat

# ASR（Whisper 模型大小）
ASR_MODEL=base       # base / small / medium / large-v3
ASR_DEVICE=cuda      # cuda / cpu
```

> **Canvas Token 获取**：登录 oc.sjtu.edu.cn → 右上角 Account → Settings → New Access Token

> **JAAuthCookie**（用于录屏下载）：浏览器登录课程后，按 F12 → Application → Cookies → 找到 `JAAuthCookie` 的值，填入 Web UI 设置页。

### 3. 命令行全流程

```bash
# 列出所有课程
python pipeline.py --list-courses

# 处理指定课程
python pipeline.py --course-id 12345

# 处理所有课程
python pipeline.py
```

### 4. 启动 Web UI

```bash
python server.py
```

访问 http://localhost:8000

## 配置说明

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `CANVAS_BASE_URL` | Canvas 域名 | https://oc.sjtu.edu.cn |
| `CANVAS_TOKEN` | Canvas Access Token | — |
| `LLM_BASE_URL` | LLM API 地址 | http://localhost:11434/v1 |
| `LLM_API_KEY` | LLM API 密钥 | ollama |
| `LLM_MODEL` | 模型名称 | qwen3:8b |
| `ASR_MODEL` | Whisper 模型大小 | base |
| `ASR_DEVICE` | ASR 运行设备 | cuda |

## 技术栈

- **后端**：FastAPI + Uvicorn
- **前端**：React + Vite + Tailwind CSS
- **ASR**：faster-whisper (Whisper)
- **LLM**：OpenAI 兼容 API（支持 DeepSeek / Ollama / Anthropic）
- **文档解析**：pypdf / python-pptx / python-docx
- **依赖管理**：uv

## License

MIT
