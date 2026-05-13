# Canvas2Note：把课堂录屏变成可复习的笔记，一条命令搞定

> 上海交大课程录屏 → 语音转写 → AI 整理笔记，全流程自动化。
> 支持 Web UI 和 Agent CLI 两种使用方式，适配不同场景。

---

## 它解决什么问题

交大 Canvas 上有大量课程录屏和课件，但——

- 录屏回看效率低，1.5 小时的课没法搜索定位
- 课件分散在 Canvas、视频站、转录站三个系统
- 想用 AI 整理笔记，却要手动下载、转写、拼接、调 prompt

Canvas2Note 把整个流程串起来：**下载 → 转录 → 课件解析 → LLM 融合 → 结构化笔记**。同时提供 Web 界面给普通用户，CLI JSON 接口给 Agent 调用。

---

## 功能一览

### 1. 课件 & 录屏下载

Canvas 上的 PDF/PPT/DOCX 课件一键下载到本地，课堂录屏通过 JAAuth + LTI 认证自动拉取。PPT 幻灯片可下载并解压为图片集，支持翻页浏览。

```bash
# 列出课程所有文件
uv run python cli.py list-files --course-id 88220

# 一键下载
uv run python cli.py download \
  --course-id 88220 --course-name "现代汉语（2）" \
  --type file --file-id 12345
```

### 2. 多种 ASR 转录引擎

| 引擎 | 适用场景 |
|------|---------|
| **交大 AI 转录站** (translate.sjtu.edu.cn) | 免 GPU，上传即转，推荐 SJTU 用户 |
| **faster-whisper** | 本地 Whisper，支持 99+ 语言，CPU/GPU 均可 |
| **API 模式** (OpenAI 兼容) | 任意 Whisper API，如 SiliconFlow |
| **FunASR SenseVoice** | 本地实时转写，RTF 0.004，支持直播流 |

批量模式一键完成 下载 → 转录 → 删除视频 全流程，侧边栏实时显示进度。

```bash
# 批量转录
uv run python cli.py batch-transcribe \
    --course "现代汉语（2）" \
    --items '[...]' --delete
```

### 3. LLM 笔记生成

将**课件文字 + PPT 幻灯片描述 + 课堂转录**融合输入 LLM，生成结构清晰的 Markdown 笔记。

- 课件自动解析（PDF/DOCX/PPTX）
- PPT 幻灯片通过 VLM（Qwen3-VL-8B）逐张提取文字和图表
- 生成结果流式输出，不覆盖历史文件
- 命名规则：按转录文件名，便于追溯

```bash
# 一路到底：一键 pipeline
uv run python cli.py pipeline --course-id 88220
```

### 4. 基于笔记的 AI 对话

在笔记右侧可直接与 LLM 对话，上下文自动携带当前笔记内容。对话历史按笔记自动保存，支持跨会话恢复。

提供快捷提问：
- "解释这份笔记的核心概念"
- "总结为 5 个要点"
- "找出不清晰的章节"
- "提取所有定义和公式"

---

## 两种使用方式

### 🧑 Web UI — 给人用的

```bash
uv sync              # 基础安装，无需 GPU
uv run python -m uvicorn server:app --port 8000
```

打开 `http://localhost:8000`，左侧选课程，按 Tab 操作：

```
Canvas → 下载课件
Videos → 下载录屏、转录、PPT 幻灯片
Notes  → 勾选课件+转录 → Generate → 获得笔记
        右侧 ChatPanel 基于笔记对话
```

> 支持暗色模式、响应式布局、桌面端 Tauri 打包。

### 🤖 CLI JSON — 给 Agent 用的

所有命令返回 JSON，支持管道组合，方便 Agent 编排工作流。

```bash
# 查课程
uv run python cli.py list-courses
# → [{"id":88220,"name":"现代汉语（2）",...}]

# 查文件
uv run python cli.py list-files --course-id 88220

# 转录
uv run python cli.py transcribe \
    --video data/downloads/课程/第1讲.mp4 \
    --course "现代汉语（2）"

# 生成笔记
uv run python cli.py generate-notes \
    --course "现代汉语（2）" \
    --doc data/downloads/课程/课件.pdf \
    --transcript-name "第1讲" \
    --transcript-text "$(uv run python cli.py get-transcript --name '现代汉语（2）/第1讲' | jq -r .text)"

# 对话
uv run python cli.py chat \
    --messages '[{"role":"user","content":"这节课讲了哪些核心理论？"}]' \
    --context-note "$(cat data/notes/课程/第1讲.md)"
```

---

## 技术架构

```
Canvas 课件/PPT 下载          录播视频下载           直播 FLV 流
      │                          │                      │
      ▼                          ▼                      ▼
 PDF/DOCX/PPTX → 文字解析    .mp4 → ASR 转录      ffmpeg PCM → FunASR
      │                          │                      │
      └──────────────────────────┴──────────────────────┘
                                 ▼
                        LLM 融合整理
                         → Markdown 笔记
                         → AI 对话
```

| 层 | 技术 |
|----|------|
| 后端 | FastAPI + Uvicorn（SSE 流式） |
| 前端 | React 18 + Vite 5 + Tailwind CSS 3 + TypeScript |
| 设计 | "Paper & Ink" — 朱砂红主色调，暖纸墨色，亮/暗双模式 |
| 桌面 | Tauri v2（Windows / macOS / Linux） |
| ASR | 交大转录站 / faster-whisper / OpenAI API / FunASR |
| LLM | OpenAI 兼容（DeepSeek / Ollama / SiliconFlow / MiniMax） |
| VLM | Qwen3-VL-8B（vLLM PPT 分析） |

## 安装

```bash
git clone https://github.com/HashBrowns-fries/SJTU_Canvas2Note.git
cd SJTU_Canvas2Note
uv sync                          # 基础安装，77 个包，无需 GPU
uv sync --extra asr              # 需要本地 ASR 时（faster-whisper + torch）

# 启动
uv run python -m uvicorn server:app --port 8000
```

## 路线图

- [ ] 视频帧提取 + VLM 板书/公式识别（替代 PPT 分析）
- [ ] 笔记导出为 PDF（保留排版）
- [ ] 多课程知识图谱关联
- [ ] Anki 卡片自动生成
- [ ] 一键部署 Docker 镜像

---

*如果你是 SJTU 学生，这个工具能帮你省下 80% 的课后整理时间。如果你是 Agent 开发者，CLI JSON 接口可以直接集成到你的工作流中。*
