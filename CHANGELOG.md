# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Features

- **Agent CLI** — `cli.py` 提供完整的 JSON CLI 接口，支持课程/文件/视频/转写/截图分析/笔记/对话/设置的所有操作，流式命令实时输出到 stderr。
- **SmolVLM2 截图分析** — `vlm_client.py` 使用 HuggingFace `SmolVLM2-500M-Video-Instruct` 分析录屏画面，提取帧后理解幻灯片内容（标题/图表/公式/代码），描述文字可传入笔记生成流程。
- **FunASR 支持** — 新增 `asr_engine` 配置项，支持三种 ASR 引擎：faster-whisper / FunASR / OpenAI 兼容 API。FunASR 引擎内置 SenseVoiceSmall、Fun-ASR-Nano、Paraformer-zh、Paraformer-en 等模型，可通过设置页一键切换。
- **Chat history persistence** — Chat history is now saved per note to `data/chats/`. Switching notes loads the previous conversation automatically.
- **LLM Markdown rendering** — LLM responses in the chat panel are rendered as proper Markdown (react-markdown + remark-gfm).
- **Batch transcribe workflow** — Download → transcribe → delete video all in one go. Progress shown inline in Videos tab and sidebar.
- **Note naming by transcription** — Notes named after transcription file (e.g. `生物学基础_第2讲_.md`), preventing overwrite.

### Fixes

- **Transcription content not loading** — Split into two endpoints to avoid SPA catch-all route.
- **Wrong transcription passed to LLM** — Fetch content before sending; pass `transcript_name` for naming.
- **Transcription list not scoped to course** — Direct equality `t.course === course.name`.
- **Note generation with empty transcript** — Conditionally excludes `【课件】` section.
