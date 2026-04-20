# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Features

- **FunASR 支持** — 新增 `asr_engine` 配置项，支持三种 ASR 引擎：faster-whisper / FunASR / OpenAI 兼容 API。FunASR 引擎内置 SenseVoiceSmall、Fun-ASR-Nano、Paraformer-zh、Paraformer-en 等模型，可通过设置页一键切换。
- **Chat history persistence** — Chat history is now saved per note to `data/chats/`. Switching notes loads the previous conversation automatically. History is debounce-saved on every message.
- **LLM Markdown rendering** — LLM responses in the chat panel are rendered as proper Markdown (with `react-markdown` + `remark-gfm`), including code blocks, tables, and lists.
- **Batch transcribe workflow** — Download → transcribe → delete video all in one go. Progress is shown inline in the Videos tab and tracked in the sidebar.
- **Note naming by transcription** — Generated notes are now named after the selected transcription file (e.g. `生物学基础_第2讲_.md`), preventing overwrite across lectures.

### Fixes

- **Transcription content not loading** — Split into two endpoints: `GET /api/transcriptions` (list) and `GET /api/transcription?name=...` (content, query param avoids SPA catch-all).
- **Wrong transcription passed to LLM** — Fixed to fetch content before sending; pass `transcript_name` for proper note naming.
- **Transcription list not scoped to course** — Direct equality comparison `t.course === course.name`.
- **Note generation with empty transcript** — Conditionally excludes `【课件】` section when no documents selected.
