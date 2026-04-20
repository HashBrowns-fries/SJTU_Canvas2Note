# Canvas2Note

上海交通大学课程录屏 → 语音转写 → AI 整理笔记全流程工具。

![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 功能

- **课程文件下载** — 从 Canvas (oc.sjtu.edu.cn) 下载课程 PDF/PPT/DOCX 课件，支持按文件夹浏览
- **课堂录屏下载** — 通过 JAAuthCookie + LTI 认证下载 courses.sjtu.edu.cn 课堂录屏，支持断点续传
- **语音转写** — 支持本地 `faster-whisper`（GPU/CPU）和云端 OpenAI 兼容 ASR API，可按课程批量转写视频
- **AI 笔记生成** — 将课件文字与讲义转录融合，生成结构清晰的 Markdown 笔记；笔记按转录文件名命名，不覆盖历史文件
- **LLM 对话** — 在笔记页面右侧与 AI 助手对话，支持 Markdown 渲染，历史记录按笔记自动保存
- **批量工作流** — 一键完成 下载 → 转写 → 删除视频，进度在侧边栏实时跟踪
- **Web UI** — 浏览器内管理课程、视频、转录、笔记，支持流式输出和设置配置

## 目录结构

```
Canvas2note/
├── canvas/              # Canvas API 客户端
│   ├── client.py        # 课程/文件/视频列表 API
│   └── video_client.py  # 交大录屏下载 (JAAuth + LTI)
├── asr/                 # 语音转写
│   ├── transcriber.py   # faster-whisper + ASR API 双模式
│   └── frame_extractor.py
├── parser/              # 文档解析
│   └── doc_parser.py
├── notes/               # 笔记生成
│   └── generator.py
├── llm_client.py        # 统一 LLM 调用 (OpenAI 兼容)
├── vlm_client.py        # 视觉模型客户端（截图分析）
├── pipeline.py          # 命令行全流程
├── server.py            # FastAPI 后端（所有 API + SSE 流式）
├── frontend/            # React + Vite + Tailwind CSS 前端
├── config.py            # 配置管理
└── data/                # 下载文件、转录、笔记、聊天记录的存储目录
    ├── downloads/
    ├── audio/           # 转录文本，按课程名目录存放
    ├── notes/           # 生成的 Markdown 笔记，按课程名目录存放
    └── chats/           # 聊天历史，按 "{course}_{note_stem}.json" 命名
```

## 快速开始

### 1. 安装依赖

```bash
uv sync
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
| ASR Device | `cuda`（GPU）或 `cpu`；或 `api`（云端 ASR） |
| ASR API（可选） | 当 Device=api 时，填入 ASR 服务的 Base URL / Key / Model |

配置保存在 `settings.json`，重启后保留。

### 3. 启动 Web UI

```bash
cd /path/to/Canvas2note
python -m uvicorn server:app --port 8000 --host 0.0.0.0
```

访问 http://localhost:8000

### 4. 命令行（可选）

```bash
# 列出所有课程
python pipeline.py --list-courses

# 处理指定课程
python pipeline.py --course-id 12345

# 处理所有课程
python pipeline.py
```

## 工作流程

```
Canvas 课件下载         录屏下载
      │                     │
      ▼                     ▼
┌─────────────────┐  ┌─────────────────┐
│  PDF / PPTX     │  │  视频文件        │
│  → 文字提取     │  │  → faster-whisper
│  (doc_parser)   │  │    或 ASR API    │
└────────┬────────┘  └────────┬────────┘
         │                    │
         ▼                    ▼
   【课件】文字            【讲义】转录
         │                    │
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
- **ASR**：`faster-whisper`（本地）或 OpenAI 兼容 ASR API（云端）
- **LLM**：OpenAI 兼容 API（DeepSeek / Ollama / SiliconFlow 等）
- **文档解析**：`pypdf` / `python-pptx` / `python-docx`
- **依赖管理**：`uv`

## License

MIT
