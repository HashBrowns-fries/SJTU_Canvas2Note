# Canvas2Note

上海交通大学课程录屏 → 语音转写 → AI 整理笔记全流程工具。

![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

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
- **CLI 接口** — 完整 JSON CLI，Agent 可调用所有功能（课程/文件/视频/转写/截图分析/笔记/对话/设置）
- **Web UI** — 浏览器内管理课程、视频、转录、笔记，支持流式输出和设置配置

## 目录结构

```
Canvas2note/
├── canvas/              # Canvas API 客户端
│   ├── client.py        # 课程/文件/视频列表 API
│   └── video_client.py  # 交大录屏下载 (JAAuth + LTI)
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
# 安装 uv（如已有可跳过）
pip install uv

# 克隆后同步依赖（自动创建虚拟环境）
uv sync

# 可选：验证环境
uv run python -c "import fastapi; print('OK')"
```

> `uv.lock` 已提交到 git，`uv sync` 装的是锁定版本，与 CI 保持一致。

### 2. 配置

首次启动后访问 http://localhost:8000 ，在右上角 **SETTINGS** 填写：

| 字段 | 说明 |
|---|---|
| Canvas Base URL | `https://oc.sjtu.edu.cn` |
| Canvas Token | 登录 oc.sjtu.edu.cn → Account → Settings → New Access Token |
| JA Auth Cookie | 录屏下载认证：浏览器登录 courses.sjtu.edu.cn → F12 → Application → Cookies → `JAAuthCookie` |
| JA Session Cookie | AI 转录站认证：浏览器登录 translate.sjtu.edu.cn → F12 → Application → Cookies → 复制完整 Cookie（包含 JSESSIONID、keepalive 等）|
| LLM Base URL | API 地址，如 `https://api.deepseek.com/v1` |
| LLM API Key | 你的 API 密钥 |
| LLM Model | 模型名称，如 `deepseek-chat` |
| ASR 引擎 | `translate`（交大转录站）/ `faster-whisper` / `qwen3` / `API` |
| ASR 模型 | 引擎对应模型名（如 faster-whisper: base/small/medium/large-v3） |
| ASR 硬件 | `cuda`（GPU）或 `cpu` |

配置写入 `settings.json`（也可手动编辑），支持 ASR 引擎选择、vLLM 端点、VLM 模型名等高级选项。

### 3. 启动 Web UI

```bash
cd /path/to/Canvas2note
python -m uvicorn server:app --port 8000 --host 0.0.0.0
```

访问 http://localhost:8000

### 4. CLI（Agent 调用）

所有命令返回 JSON，流式命令实时输出到 stderr。启动后端：`python -m uvicorn server:app --port 8000`

```bash
# ── 课程 / 文件 / 视频 ───────────────────────────────────────────
python cli.py list-courses
python cli.py list-files --course-id 88220
python cli.py list-videos --course-id 88220

# ── 转写（translate.sjtu.edu.cn，无需 GPU）────────────────────────
# 单视频转写（完成后自动保存到 data/audio/课程名/）
python cli.py transcribe --video /data/lecture.mp4 --course "现代汉语（2）"

# 不等待，拿到 task_id 后手动查询进度
python cli.py transcribe --video /data/lecture.mp4 --course "现代汉语（2）" --no-wait

# 批量转写（需先从 /api/video/courses/{id}/videos 获取视频列表）
python cli.py batch-transcribe     --items '{"course_id":87767,"course_name":"现代汉语（2）","video_id":"j8J65fn+3OIYKMqAfXgcpQ==","title":"第1讲","play_index":0}'     --course "现代汉语（2）"     --delete   # 转写完成后删除原视频节省空间

# ── 直播（LTI External Tool 9487）───────────────────────────────
# 列出课程直播
python cli.py live-list --course-id 89343

# 从直播截取电脑屏幕截图
python cli.py live-screenshot --course-id 89343 --live-id "$LIVE_ID" --output /tmp/screen.jpg

# 从直播屏幕截图识别二维码
python cli.py live-qr --course-id 89343 --live-id "$LIVE_ID"

# 实时转写直播（默认 120 秒，可选 --stream-url 直接传入 FLV 地址）
python cli.py live-transcribe --course-id 89343 --live-id "$LIVE_ID" --duration 300

# ── 转写文件管理 ─────────────────────────────────────────────────
python cli.py list-transcripts --course "现代汉语（2）"
python cli.py get-transcript --name "现代汉语（2）/现代汉语(2)(第1讲)"

# ── 笔记生成 ─────────────────────────────────────────────────────
# 转写文本 + 课件 PDF → AI 生成 Markdown 笔记
python cli.py generate-notes --course "现代汉语（2）" \
    --doc data/downloads/现代汉语（2）/课件.pdf \
    --transcript-text "$(python cli.py get-transcript --name '现代汉语（2）/现代汉语(2)(第1讲)' | jq -r .text)" \
    --transcript-name "现代汉语(2)(第1讲)" \
    -o data/notes/现代汉语（2）/现代汉语(2)(第1讲).md

python cli.py list-notes --course "现代汉语（2）"
python cli.py get-note --course "现代汉语（2）" --filename "现代汉语(2)(第1讲).md"

# ── 对话（基于笔记上下文）─────────────────────────────────────────
python cli.py chat \
    --messages '[{"role":"user","content":"这节课的核心知识点有哪些？"}]' \
    --context-note "$(cat data/notes/现代汉语（2）/现代汉语(2)(第1讲).md)"

# ── 设置 ────────────────────────────────────────────────────────
python cli.py settings get
# 修改 ASR 引擎
python cli.py settings set --key asr_engine --value "translate"   # 交大转录站（默认）
python cli.py settings set --key asr_engine --value "faster-whisper"  # 本地 Whisper
python cli.py settings set --key asr_engine --value "qwen3"          # Qwen3-ASR-1.7B（需 vLLM）
python cli.py settings set --key asr_model --value "base"
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
- **前端**：React + Vite + Tailwind CSS
- **ASR**：交大 AI 转录站 / faster-whisper / Qwen3-ASR-1.7B / FunASR SenseVoice / OpenAI 兼容 API
- **VLM**：Qwen3-VL-8B vLLM（PPT 幻灯片分析）
- **LLM**：OpenAI 兼容 API（DeepSeek / Ollama / SiliconFlow 等）
- **文档解析**：`pypdf` / `python-pptx` / `python-docx`
- **依赖管理**：`uv`（`uv sync` 同步，`uv.lock` 已提交保证版本一致）

## License

MIT
