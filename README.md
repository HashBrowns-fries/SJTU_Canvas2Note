# Canvas2Note

上海交通大学课程录屏 → 语音转写 → AI 整理笔记全流程工具。

[![Python](https://img.shields.io/badge/python-3.11+-blue.svg)](https://python.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/HashBrowns-fries/SJTU_Canvas2Note/actions/workflows/ci.yml/badge.svg)](https://github.com/HashBrowns-fries/SJTU_Canvas2Note/actions/workflows/ci.yml)
[![v1.0.0](https://img.shields.io/badge/version-1.0.0-var(--brand))](https://github.com/HashBrowns-fries/SJTU_Canvas2Note/tags)

## 功能

- **jAccount 扫码登录** — Settings → Canvas 页一键扫码，自动获取 JAAuthCookie，无需手动从浏览器复制
- **课程文件下载** — 从 Canvas (oc.sjtu.edu.cn) 下载 PDF/PPT/DOCX 课件
- **课堂录播下载** — JAAuthCookie + LTI 认证，自动下载 courses.sjtu.edu.cn 录播
- **PPT 幻灯片下载** — 一键将 PPT 下载为 PDF 并解压为图片集，支持翻页浏览
- **语音转写** — 五种 ASR 引擎：交大 AI 转录站 / faster-whisper / Qwen3-ASR / FunASR SenseVoice / OpenAI 兼容 API
- **直播实时转写** — FLV 流 → ffmpeg PCM → FunASR SenseVoice，支持直播中抓取
- **直播 QR 码监控** — 监控电脑录屏流 (cdviChannelNum=7)，自动检测二维码并提醒扫码（beta developing，谨慎使用）
- **AI 笔记生成** — 课件文字 + PPT 幻灯片 VLM 描述 + 转录 → LLM 融合 → Markdown 笔记
- **LLM 对话** — 基于笔记上下文与 AI 对话，历史按笔记自动保存
- **批量工作流** — 下载 → 转录 → 删除视频一键完成，侧边栏实时进度
- **CLI 接口** — 完整 JSON CLI，所有命令返回 JSON，Agent 可直接调用
- **Web UI** — Paper & Ink 设计，朱砂红主色调，亮/暗双模式，响应式布局
- **Tauri 桌面应用** — Windows / macOS / Linux 原生窗口

## 快速开始

```bash
git clone https://github.com/HashBrowns-fries/SJTU_Canvas2Note.git
cd SJTU_Canvas2Note

# 基础安装（无需 GPU）
uv sync

# 启动 Web UI
uv run python -m uvicorn server:app --port 8000
# 打开 http://localhost:8000
```

### 首次配置

1. **Settings → Canvas** — 获取 Canvas Token（oc.sjtu.edu.cn → Account → Settings → New Access Token），或点击"扫码登录 jAccount"
2. **Settings → LLM** — 配置 API（如 DeepSeek / Ollama / MiniMax）
3. **Settings → ASR** — 选择引擎（交大转录站免 GPU 推荐，或 faster-whisper / API）

全部写入 `settings.json`，不入 git。

### 需要本地 ASR 时

```bash
uv sync --extra asr       # faster-whisper + torch
uv sync --extra funasr    # FunASR SenseVoice + torch
```

## 🧑 Web UI 使用

```
左侧选课程 → Videos 下载录屏 → 转录 → Notes 勾选课件+转录 → Generate → 右侧对话
```

| Tab | 功能 |
|-----|------|
| **Canvas** | 课程文件列表，一键下载 |
| **Local** | data/ 文件浏览器，预览/重命名/删除 |
| **Videos** | 录屏下载/转录/PPT 幻灯片，批量操作，**直播 QR 监控** |
| **Transcriptions** | 查看转录结果 |
| **Notes** | 预览/编辑/生成笔记，右侧 ChatPanel 基于笔记对话 |

### 直播 QR 监控（beta）

Videos 页顶部 → 点击"获取直播列表" → 选择直播 → 后台每 3 秒截取电脑录屏帧 → OpenCV 检测二维码 → 检测到时弹提醒。**beta developing，谨慎使用。**

### Tauri 桌面应用

```bash
cd frontend && npm install
npm run tauri dev     # 开发模式
npm run tauri build   # 打包 .msi / .dmg / .AppImage
```

Settings → Server 页配置后端地址。

## 🤖 Agent CLI 使用

所有命令返回 JSON。需先启动后端：`uv run python -m uvicorn server:app --port 8000 &`

### 课程 & 文件

```bash
uv run python cli.py list-courses
uv run python cli.py list-files --course-id 88220
uv run python cli.py list-videos --course-id 88220
uv run python cli.py download --course-id 88220 --course-name "现代汉语（2）" --type file --file-id 12345
```

### 转录

```bash
# 同步
uv run python cli.py transcribe --video data/downloads/课程/第1讲.mp4 --course "现代汉语（2）"

# 异步
uv run python cli.py transcribe --video /data/lecture.mp4 --course "现代汉语（2）" --no-wait
uv run python cli.py task --id a1b2c3d4

# 批量
uv run python cli.py batch-transcribe --course "现代汉语（2）" --items '[...]' --delete
```

### 笔记 & 对话

```bash
uv run python cli.py list-transcripts --course "现代汉语（2）"
uv run python cli.py get-transcript --name "现代汉语（2）/第1讲"
uv run python cli.py generate-notes --course "现代汉语（2）" --doc data/.../课件.pdf --transcript-name "第1讲"
uv run python cli.py chat --messages '[{"role":"user","content":"核心知识点？"}]' --context-note "$(cat note.md)"
```

### Pipeline 一键

```bash
uv run python cli.py pipeline --course-id 88220
# 等价：list-videos → 逐个 download+transcribe → generate-notes
```

### 设置

```bash
uv run python cli.py settings get
uv run python cli.py settings set --key llm_model --value "deepseek-chat"
uv run python cli.py settings set --key asr_engine --value "translate"
```

## ASR 引擎

| 引擎 | 硬件 | 特点 |
|------|------|------|
| **交大转录站** | 仅需网络 | 免 GPU，上传即转 |
| **faster-whisper** | CPU / GPU | 本地，99+ 语言 |
| **Qwen3-ASR-1.7B** | GPU (vLLM) | RTF 0.05，52 语言 |
| **FunASR SenseVoice** | GPU | RTF ~0.004，直播实时 |
| **API** | 云端 | OpenAI 兼容 |

## 目录结构

```
Canvas2note/
├── server.py            # FastAPI 后端（API + SSE）
├── cli.py               # Agent CLI（JSON 接口）
├── pipeline.py          # 一键全流程
├── live_monitor.py      # 直播 QR 码监控
├── config.py            # 配置管理
├── canvas/              # Canvas / 视频平台 API
│   ├── client.py        #   课程/文件
│   ├── video_client.py  #   录屏下载 (JAAuth + LTI)
│   ├── jaccount.py      #   jAccount QR 扫码登录
│   └── translate_client.py
├── asr/                 # 语音转写
├── notes/               # 笔记生成 prompt
├── parser/              # 文档解析 (PDF/DOCX/PPTX)
├── frontend/            # React + Vite + Tailwind
│   ├── src/components/ui/   # 共享 UI 组件
│   ├── src/hooks/           # useTheme / useKeyboard
│   └── src-tauri/           # Tauri v2 配置 + 图标
├── .github/workflows/   # CI / Tauri Build
└── data/                # 运行时数据（不入 git）
```

## 技术栈

- **后端**：FastAPI + Uvicorn，SSE 流式响应
- **前端**：React 18 + Vite 5 + Tailwind CSS 3 + TypeScript，"Paper & Ink" 设计
- **桌面**：Tauri v2 (Windows / macOS / Linux)
- **ASR**：交大转录站 / faster-whisper / Qwen3-ASR / FunASR / OpenAI API
- **VLM**：Qwen3-VL-8B（vLLM PPT 分析）
- **QR 检测**：OpenCV QRCodeDetector（直播监控）
- **LLM**：OpenAI 兼容 API
- **依赖管理**：`uv`（`uv.lock` 锁定版本）

## License

MIT
