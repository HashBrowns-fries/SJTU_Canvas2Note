# Canvas2Note：把 SJTU 课堂录屏变成可复习的笔记

> 下载 → 转录 → AI 整理，一个工具搞定。**两种使用方式：UI 给你用，CLI 给 Agent 帮你用。**

---

## 为什么写这个

每学期几十节录屏，想复习却找不到重点。课件在 Canvas，录屏在视频站，转录在另一个系统。于是有了 Canvas2Note —— 把所有东西串起来。

```
Canvas 课件/PDF → 下载到本地
课堂录屏 .mp4  → ASR 语音转写
PPT 幻灯片     → VLM 图片分析
        ↓
  LLM 融合整理 → Markdown 笔记 → AI 对话
```

---

## 🧑 UI：浏览器或桌面都能用

### Web 界面

```
uv run python -m uvicorn server:app --port 8000
打开 http://localhost:8000
```

- **jAccount 扫码登录** — 手机扫一下就行，不用 F12 翻 Cookie
- **Paper & Ink 设计** — 朱砂红主色调，暖纸墨色体系，支持暗色模式
- **响应式布局** — 桌面/平板/手机
- **KaTeX 公式渲染** — 生物化学课里的 $CO_2$、$\xrightarrow{[H],ATP}$ 都能正确显示

### Tauri 桌面应用

```
cd frontend && npm run tauri build
→ 生成 .msi / .dmg / .AppImage
```

脱离浏览器，原生窗口，系统通知。

---

## 🤖 CLI：让 Agent 帮你做

所有命令返回 JSON，Claude Code / Cursor / 任何 Agent 都能直接调用。

```bash
# Agent 帮你查课
uv run python cli.py list-courses
# → [{"id":88220,"name":"现代汉语（2）",...}]

# Agent 帮你转录
uv run python cli.py transcribe \
  --video data/downloads/现代汉语（2）/第1讲.mp4 \
  --course "现代汉语（2）"

# Agent 帮你生成笔记
uv run python cli.py pipeline --course-id 88220
# 一条命令：下载+转录+笔记 全自动
```

你在 Claude Code 里说一句"帮我整理这学期现代汉语的笔记"，Agent 就调 CLI 去做了。

---

## 核心功能

- 五种 ASR 引擎：交大转录站（免 GPU）、faster-whisper、Qwen3-ASR、FunASR、OpenAI API
- 直播 QR 码监控：检测到 PPT 上的二维码自动提醒
- 批量工作流：一键 下载→转录→删视频
- 笔记对话：右侧 ChatPanel 基于当前笔记与 LLM 对话，面板宽度可拖动

---

## 快速开始

```bash
git clone https://github.com/HashBrowns-fries/SJTU_Canvas2Note.git
cd SJTU_Canvas2Note && uv sync
uv run python -m uvicorn server:app --port 8000
```

MIT 开源。欢迎 Star ⭐ & PR。
