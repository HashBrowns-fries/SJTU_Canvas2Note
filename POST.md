# 开源了一个工具：SJTU Canvas 录屏 → 转录 → AI 笔记，全自动

标题够长了，直接说正事。

## 解决什么问题

大家都知道交大有 Canvas 课程系统对吧？课件在上面、录屏在另一个视频站、转录还得去 translate.sjtu.edu.cn。每学期十几门课，想系统整理笔记真的累。

所以写了个工具把整个流程串起来：**下载课件/录屏 → 语音转写 → LLM 生成结构化笔记**。

GitHub 开源：`https://github.com/HashBrowns-fries/SJTU_Canvas2Note`

## 怎么用

两种方式：

**普通人 → Web UI**：浏览器打开，点点鼠标，下载、转录、生成笔记全搞定。也支持打包成 Windows/macOS 原生桌面应用（Tauri）。

**开发者 / Agent → CLI**：所有命令返回 JSON。

```bash
# 查课
uv run python cli.py list-courses
# → [{"id":88220,"name":"现代汉语（2）","course_code":"CHN202"}]

# 转录
uv run python cli.py transcribe --video 第1讲.mp4 --course "现代汉语（2）"

# 一键 pipeline：下载全部录屏 → 转录 → 生成笔记
uv run python cli.py pipeline --course-id 88220
```

你在 Claude Code / Cursor 里说"帮我整理这学期 XX 课的笔记"，Agent 直接调 CLI 全自动做完了。这就是 **CLI 给 Agent 用**的意思。

## 几个好用的功能

1. **jAccount 扫码登录**：手机扫一下就好，不用去 F12 翻 Cookie 了
2. **五种 ASR 引擎可选**：交大转录站（免 GPU 推荐）、faster-whisper、Qwen3-ASR、FunASR、OpenAI API
3. **直播 QR 码监控**：监控电脑录屏流，PPT 上出现二维码自动弹窗提醒（beta）
4. **批量工作流**：选一堆录屏 → 一键下载+转录+删视频，进度条实时刷新
5. **KaTeX 公式渲染**：生化课笔记里的 $CO_2 + C_5 \rightarrow 2C_3$ 能正确显示
6. **暗色模式**：深夜学习必备
7. **笔记 + 对话**：右侧 ChatPanel 基于当前笔记内容跟 LLM 聊天，面板宽度可拖拽

## 安装

```bash
git clone https://github.com/HashBrowns-fries/SJTU_Canvas2Note.git
cd SJTU_Canvas2Note
uv sync  # 基础安装 78 个包，无需 GPU

uv run python -m uvicorn server:app --port 8000
# 打开浏览器 → http://localhost:8000
```

需要本地 ASR 再加：
```bash
uv sync --extra asr      # faster-whisper
uv sync --extra funasr   # FunASR SenseVoice
```

## 技术栈

Python FastAPI + React 18 + Tailwind CSS + Tauri v2
ASR/LLM/VLM 都接的是 OpenAI 兼容 API 或交大自己的服务

## 最后

MIT 开源，欢迎 Star ⭐ 和 PR。有问题直接提 Issue。

大四快毕业了，就当送给学弟学妹的礼物。
