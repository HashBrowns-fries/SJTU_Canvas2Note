# Canvas2Note

上海交通大学课程录屏 → 语音转写 → AI 整理笔记全流程工具。

![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
[![CI](https://github.com/HashBrowns-fries/SJTU_Canvas2Note/actions/workflows/ci.yml/badge.svg)](https://github.com/HashBrowns-fries/SJTU_Canvas2Note/actions/workflows/ci.yml)

## 功能

- **课程文件下载** — 从 Canvas (oc.sjtu.edu.cn) 下载课程 PDF/PPT/DOCX 课件，支持按文件夹浏览
- **PPT 幻灯片下载** — 每行视频新增 ◧ 按钮，一键下载 PPT 为 PDF 并解压为图片集，支持缩略图浏览和翻页导航
- **课堂录播下载** — 通过 JAAuthCookie + LTI 认证下载 courses.sjtu.edu.cn 课堂录播，支持断点续传
- **直播实时转写** — 从 Canvas External Tool（课堂视频旧版，LTI tool ID 9487）获取直播列表和 FLV 流地址（HD/SD 双轨，auth_key 签名）；实时转写管道：FLV 流 → ffmpeg 16kHz PCM → FunASR SenseVoice（RTF ~0.004，约 25 倍实时），每 10 秒输出一段文本，延迟约 10 秒；支持直播中和结束后抓取；完整认证流程：JAAuthCookie → Canvas OIDC 登录 → GET external_tool 表单 → POST LTI launch → 调用直播 API。
- **语音转写** — 支持四种 ASR 引擎：交大 AI 转录站（translate.sjtu.edu.cn）、本地 faster-whisper、Qwen3-ASR-1.7B（vLLM 加速）、FunASR SenseVoice（直播实时转写），可按课程批量转写
- **PPT 幻灯片分析** — 从 Canvas 下载课程 PPT（PDF 格式），解压为图片，逐张输入 Qwen3-VL-8B（vLLM 推理），提取幻灯片文字、图表、公式内容
- **AI 笔记生成** — 将课件文字、PPT 幻灯片 VLM 描述、录屏截图与讲义转录融合，生成结构清晰的 Markdown 笔记；笔记按转录文件名命名，不覆盖历史文件；PPT 幻灯片通过 Qwen3-VL-8B 分析，VLM 进度实时显示在生成面板。
- **LLM 对话** — 在笔记页面右侧与 AI 助手对话，支持 Markdown 渲染，历史记录按笔记自动保存；侧边栏展示所有对话历史，支持按笔记名称过滤
- **批量工作流** — 一键完成 下载 → 自动转录 → 删除视频，进度在侧边栏实时跟踪（转录状态透传自 ASR 引擎）
- **jAccount 扫码登录** — Settings → Canvas 页一键扫码登录 jAccount，自动获取 JAAuthCookie，无需手动从浏览器复制 Cookie
- **CLI 接口** — 完整 JSON CLI，Agent 可调用所有功能（课程/文件/视频/转写/截图分析/笔记/对话/设置）
- **Web UI** — 浏览器内管理课程、视频、转录、笔记，支持流式输出和设置配置

## 目录结构

```
Canvas2note/
├── canvas/              # Canvas API 客户端
│   ├── client.py        # 课程/文件/视频列表 API
│   ├── video_client.py  # 交大录屏下载 (JAAuth + LTI)
│   └── jaccount.py      # jAccount QR 扫码登录
├── asr/                 # 语音转写
│   ├── transcriber.py   # translate + faster-whisper + Qwen3-ASR + ASR API
│   └── frame_extractor.py
├── parser/              # 文档解析
│   └── doc_parser.py
├── notes/               # 笔记生成
│   └── generator.py
├── llm_client.py        # 统一 LLM 调用 (OpenAI 兼容)
├── vlm_client.py        # Qwen3-VL-8B PPT 幻灯片分析 (vLLM)
├── pipeline.py          # 命令行全流程
├── cli.py               # Agent CLI（所有操作的 JSON 接口）
├── server.py            # FastAPI 后端（所有 API + SSE 流式）
├── frontend/            # React + Vite + Tailwind CSS 前端
│   ├── src/
│   │   ├── components/ui/       # 共享 UI 组件
│   │   ├── hooks/               # useTheme / useKeyboard
│   │   └── ...
│   └── src-tauri/               # Tauri v2 桌面应用配置
├── .github/workflows/   # GitHub Actions CI / Tauri Build
├── config.py            # 配置管理
└── data/                # 下载文件、转录、笔记、聊天记录
    ├── downloads/
    ├── audio/           # 转录文本，按课程名目录存放
    ├── notes/           # 生成的 Markdown 笔记，按课程名目录存放
    └── chats/           # 聊天历史，按 "{course}_{note_stem}.json" 命名
```

## 快速开始

### 1. 安装

```bash
# 安装 uv
pip install uv

# 基础安装（无需 GPU，77 个包）
git clone https://github.com/HashBrowns-fries/SJTU_Canvas2Note.git
cd SJTU_Canvas2Note
uv sync

# 需要本地 ASR 时（可选）
uv sync --extra asr       # faster-whisper + torch
uv sync --extra funasr    # FunASR SenseVoice + torch
```

### 2. 配置

启动后在 Web UI 右上角 **SETTINGS** 填写凭证：

| 字段 | 说明 |
|---|---|
| Canvas Token | oc.sjtu.edu.cn → Account → Settings → New Access Token |
| jAccount 扫码 | Canvas 页点击按钮，手机扫码自动登录（无需手动复制 Cookie）|
| LLM Base URL | 如 `https://api.deepseek.com/v1` |
| LLM API Key | 你的 API 密钥 |
| LLM Model | 如 `deepseek-chat` |

配置写入 `settings.json`（不入 git）。录屏下载、转录站等高级选项见 Settings 各 Tab 内提示。

## 🧑 用户使用

### Web UI（推荐）

```bash
uv run python -m uvicorn server:app --port 8000
# 打开 http://localhost:8000
```

**典型流程**：左侧选课程 → Videos 页下载录屏 → 点击转录按钮 → Notes 页勾选课件+转录 → Generate 生成笔记 → 右侧 ChatPanel 基于笔记对话。

页面功能：

| Tab | 用途 |
|-----|------|
| **Canvas** | 浏览课程文件（PDF/PPT/DOCX），一键下载 |
| **Local** | 文件浏览器，预览/重命名/删除 data/ 下文件 |
| **Videos** | 课堂录屏列表，下载/转录/PPT幻灯片，支持批量 |
| **Transcriptions** | 查看转录结果，按单词数统计 |
| **Notes** | 预览/编辑/生成 Markdown 笔记，支持课件+转录+PPT 融合 |

### Tauri 桌面应用

```bash
cd frontend
npm install
npm run tauri dev     # 开发
npm run tauri build   # 打包 .msi / .dmg / .AppImage
```

Settings → Server 页设置 Python 后端地址（如 `http://localhost:8000`）。

## 🤖 Agent 使用

Agent 通过 CLI 调用，**所有命令返回 JSON**，支持管道组合。需先启动后端服务。

```bash
# 启动后端（Agent 操作前）
uv run python -m uvicorn server:app --port 8000 &

# 或直接用 uv run，无需手动启动
uv run python cli.py <command>
```

### 基础操作

```bash
# 列出课程
uv run python cli.py list-courses
# → [{"id":88220,"name":"现代汉语（2）","course_code":"CHN202"}]

# 列出课程文件
uv run python cli.py list-files --course-id 88220
# → [{"id":1234,"display_name":"课件.pdf","size":2048000,...}]

# 下载文件
uv run python cli.py download --course-id 88220 --course-name "现代汉语（2）" \
    --type file --file-id 12345

# 列出录屏视频
uv run python cli.py list-videos --course-id 88220
```

### 转录

```bash
# 单视频转录（同步，返回完整结果）
uv run python cli.py transcribe \
    --video data/downloads/现代汉语（2）/第1讲.mp4 \
    --course "现代汉语（2）"

# 异步转录（返回 task_id，后台轮询）
uv run python cli.py transcribe \
    --video /data/lecture.mp4 \
    --course "现代汉语（2）" \
    --no-wait
# → {"task_id":"a1b2c3d4"}

# 查询任务状态
uv run python cli.py task --id a1b2c3d4
# → {"status":"done","result":{"text":"...","chars":12345},"progress":100}

# 批量转录（下载+转录+删视频一键完成）
uv run python cli.py batch-transcribe \
    --course "现代汉语（2）" \
    --items '[{"course_id":88220,"course_name":"现代汉语（2）","video_id":"xxx","title":"第1讲","play_index":0}]' \
    --delete
```

### 笔记生成

```bash
# 查看已有转录
uv run python cli.py list-transcripts --course "现代汉语（2）"
uv run python cli.py get-transcript --name "现代汉语（2）/第1讲"

# 生成笔记：课件 + 转录 → Markdown
uv run python cli.py generate-notes \
    --course "现代汉语（2）" \
    --doc data/downloads/现代汉语（2）/课件.pdf \
    --transcript-name "第1讲" \
    --transcript-text "$(uv run python cli.py get-transcript --name '现代汉语（2）/第1讲' | jq -r .text)"
# → SSE 流式输出，完成后保存到 data/notes/现代汉语（2）/第1讲.md

# 查看笔记
uv run python cli.py list-notes --course "现代汉语（2）"
uv run python cli.py get-note --course "现代汉语（2）" --filename "第1讲.md"
```

### 对话

```bash
# 基于笔记内容与 LLM 对话（流式输出到 stderr，JSON 到 stdout）
uv run python cli.py chat \
    --messages '[{"role":"user","content":"总结这节课的核心知识点"}]' \
    --context-note "$(cat data/notes/现代汉语（2）/第1讲.md)"
```

### 设置管理

```bash
# 读取全部设置
uv run python cli.py settings get

# 修改单项
uv run python cli.py settings set --key llm_model --value "deepseek-chat"
uv run python cli.py settings set --key asr_engine --value "translate"
```

### Agent 典型工作流

```bash
# 一条命令：查课程 → 下载+转录 → 生成笔记
uv run python cli.py pipeline --course-id 88220

# 等价于手动执行：
# 1. list-videos --course-id 88220
# 2. 对每个视频: download + transcribe
# 3. generate-notes（合并所有转录+课件）
```

## ASR 引擎对比

| 引擎 | 模型 | 中文 | 其他语言 | 硬件 | 特点 |
|---|---|---|---|---|---|
| **交大转录站（推荐）** | — | ✓ | 英日韩 | 仅需网络 | 免 GPU，上传即转，速度快 |
| **faster-whisper** | base~large-v3 | ✓ | ✓ 99+语言 | GPU/CPU | 本地，高精度 |
| **Qwen3-ASR** | Qwen/Qwen3-ASR-1.7B | ✓ 方言 | ✓ 52语言 | GPU (vLLM) | 本地，RTF 0.05x，需 13GB 显存 |
| **FunASR SenseVoice** | iic/SenseVoiceSmall | ✓ 中英混合 | ✓ 多语言 | GPU (cuda) | 本地，RTF ~0.004，**支持直播实时转写**（25x 实时） |
| **API** | OpenAI 兼容 | ✓ | ✓ | 云端 | 通用 |

## VLM 视觉理解

- **PPT 幻灯片分析（Qwen3-VL-8B）** — 从 Canvas 下载课程 PPT（PDF 格式）解压为图片集，笔记生成时可选，vlm_client 逐张输入 Qwen3-VL-8B（vLLM），提取幻灯片文字、图表、公式内容；SSE 实时推送分析进度；需 vLLM 运行 Qwen3-VL-8B，服务地址通过 `VLLM_BASE_URL` 环境变量配置。

## 工作流程

```
Canvas 课件/PPT下载                            录播下载              直播实时转写
      │                                         │                       │
      ▼                                         ▼                       ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  PDF            │  │  PPT 幻灯片图片  │  │  视频文件        │  │  FLV 直播流     │
│  → 文字提取     │  │  → VLM 分析     │  │  → ASR 转写     │  │  → ffmpeg PCM  │
│  (doc_parser)   │  │  (Qwen3-VL-8B) │  │  translate /    │  │  → FunASR      │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └─────────────────┘
         │                     │                     │
         └─────────────────────┴─────────────────────┘
                              ▼
                     ┌─────────────────┐
                     │  LLM 融合整理    │
                     │  → Markdown 笔记 │
                     │  → 笔记对话      │
                     └─────────────────┘
```

## 技术栈

- **后端**：FastAPI + Uvicorn（SSE 流式响应）
- **前端**：React 18 + Vite 5 + Tailwind CSS 3 + TypeScript
  - "Paper & Ink" 设计 — 朱砂红主色调，暖纸墨色体系，支持亮/暗双模式
  - Lucide React 图标库，响应式布局（桌面 / 平板 / 手机）
  - 共享 UI 组件：Button、Input、Modal、Badge、Skeleton、EmptyState、Progress
- **桌面应用**：Tauri v2（Windows / macOS / Linux 原生窗口，部分功能需 Python 后端）
- **ASR**：交大 AI 转录站 / faster-whisper / Qwen3-ASR-1.7B / FunASR SenseVoice / OpenAI 兼容 API
- **VLM**：Qwen3-VL-8B vLLM（PPT 幻灯片分析）
- **LLM**：OpenAI 兼容 API（DeepSeek / Ollama / SiliconFlow 等）
- **文档解析**：`pypdf` / `python-pptx` / `python-docx`
- **依赖管理**：`uv`（`uv sync` 同步，`uv.lock` 已提交保证版本一致）

## Tauri 桌面应用

```bash
cd frontend

# 开发模式（Python 后端需单独启动）
uv run python -m uvicorn server:app --port 8000
npm run tauri dev

# 生产构建（生成 .msi / .dmg / .AppImage）
npm run tauri build
```

首次使用在 Settings → Server 页设置后端地址（如 `http://localhost:8000`）。
Windows 需 Node.js 18+、Rust、Python 3.10+、WebView2（Win10 已内置）。

## License

MIT
