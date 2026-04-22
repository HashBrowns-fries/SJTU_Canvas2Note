# Canvas2Note — Claude Code 项目指南

## 项目概述

上海交通大学课程录屏 → 语音转写 → AI 整理笔记全流程工具。

- **前端**：React + Vite + Tailwind CSS（`frontend/`）
- **后端**：FastAPI（`server.py`），JSON CLI（`cli.py`）
- **核心模块**：`canvas/` `asr/` `notes/` `llm_client.py` `vlm_client.py`
- **数据目录**：`data/downloads/` `data/audio/` `data/notes/` `data/chats/`
- **配置**：所有凭证写入 `settings.json`（启动时加载，支持 UI 实时修改）

## 技术栈

- **ASR**：交大 AI 转录站（translate.sjtu.edu.cn）/ faster-whisper / Qwen3-ASR-1.7B（vLLM）/ FunASR SenseVoice（直播实时转写）
- **VLM**：HuggingFace SmolVLM2-2.2B（视频帧分析）+ Qwen3-VL-8B vLLM（PPT 幻灯片分析）
- **LLM**：OpenAI 兼容 API（DeepSeek / Ollama / SiliconFlow 等）
- **依赖管理**：`uv`（`uv sync` 同步，`uv.lock` 已提交保证版本一致）

## 核心工作流

### 直播实时转写（重点）

完整认证链：`JAAuthCookie` → Canvas OIDC 登录 → GET `/courses/{id}/external_tools/{tool_id}` 表单 → POST `/lti/launch` → 获取 `canvasCourseId` → 调用 `/lti/liveVideo/*` API。

两种直播流：
- `cdviChannelNum=0` — 教师摄像
- `cdviChannelNum=7` — 电脑屏幕（PPT 录屏）

实时转写管道：
```
FLV 流（16kHz AAC）→ curl → ffmpeg（-ar 16000 -ac 1 -f s16le）→ PCM 16k → FunASR SenseVoice（RTF ~0.004）
```

auth_key 有效期约 30 分钟。

### 笔记生成

`transcript.txt` + 课件 PDF → LLM → Markdown 笔记（按转录文件名命名，不覆盖历史）

## 编码惯例

- 所有凭证（Canvas Token、JAAuthCookie、LLM API Key 等）存储于 `settings.json`，**禁止硬编码**
- 异步任务用 `BackgroundTasks.add_task()`，必须在函数签名中声明参数才能生效
- 队列处理用非阻塞 `queue.get_nowait()` + `sleep(0.5)`，避免阻塞延迟
- 模型加载放在主线程，避免子线程 CUDA 上下文问题

## 常见坑

- **ffmpeg raw PCM**：只用 `-f s16le`，**不要** 加 `-c:a pcm_s16le`（会报 codec not supported）
- **FunASR 输入**：需要 `numpy.float32` 归一化音频（`pcm_int16.astype(np.float32) / 32768.0`）
- **translate 转录**：请求头需包含 `Referer` `Accept` `Accept-Language`，否则 401
- **LTI launch**：Canvas 预先签名了 34 个表单字段，只需提取并原样 POST，不可修改
- **视频片段下载**：`SJTUVideoClient.get_video_info()` 需先 `bind_canvas_course()`，否则 401

## 工具链

```bash
uv sync                    # 安装/同步依赖
uv run python cli.py ...   # CLI 命令
uv run python -m uvicorn server:app --port 8000  # 启动 Web UI
```