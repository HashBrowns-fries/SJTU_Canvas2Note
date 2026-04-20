# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Features

- **Chat history persistence** — Chat history is now saved per note to `data/chats/`. Switching notes loads the previous conversation automatically. History is debounce-saved on every message.
- **LLM Markdown rendering** — LLM responses in the chat panel are rendered as proper Markdown (with `react-markdown` + `remark-gfm`), including code blocks, tables, and lists.
- **ASR API mode** — Switch between local `faster-whisper` (GPU/CPU) and cloud ASR API (OpenAI-compatible Whisper API, with SiliconFlow preset) in the Settings modal.
- **Batch transcribe workflow** — Download → transcribe → delete video all in one go. Progress is shown inline in the Videos tab and tracked in the sidebar. Videos are processed sequentially; delete happens automatically after successful transcription.
- **Note naming by transcription** — Generated notes are now named after the selected transcription file (e.g. `生物学基础_第2讲_.md`), preventing overwrite across lectures.

### Fixes

- **Transcription content not loading** — The transcription fetch endpoint was using a path parameter that contained `/`, which hit the SPA catch-all route and returned HTML instead of content. Split into two endpoints: `GET /api/transcriptions` (list) and `GET /api/transcription?name=...` (content, query param).
- **Wrong transcription passed to LLM** — Previously the transcription filename string was passed to the LLM instead of the actual text content. Fixed to fetch content before sending.
- **Transcription list not scoped to course** — `openGenForm()` now filters transcriptions by `t.course === course.name` (direct comparison, no normalization).
- **Note generation with empty transcript** — `user_content` template now conditionally excludes the `【课件】` section when no documents are selected.
