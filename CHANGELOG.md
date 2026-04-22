# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Features

- **直播实时转写** — 从 Canvas External Tool 9487（课堂视频旧版）获取直播数据：POST `/lti/liveVideo/findLiveList` 获取课程直播列表（id、课程名、教师、时间、地点），POST `/lti/liveVideo/getLiveVideoInfos` 获取 FLV 流地址（HD/SD 双轨，auth_key 签名验证）；实时转写管道：FLV 直播流 → curl 下载 → ffmpeg 转码 16kHz mono PCM → FunASR SenseVoice（RTF ~0.004，约 25 倍实时），每 10 秒输出一段文本，延迟约 10 秒；auth_key 有效期约 30 分钟，支持直播中和回放时抓取；完整流程：Canvas OIDC 登录（JAAuthCookie）→ GET external_tool 表单 → POST LTI launch → 拿 canvasCourseId → 调用直播 API。
- **PPT 幻灯片下载与浏览** — VideosTab 每行新增 ◧ 按钮（未下载时灰紫色，已下载时亮紫色），点击直接下载 PDF 并解压为图片（img2pdf → zip fallback）；下载完成后弹出幻灯片浏览窗口，左侧为缩略图条带，右侧大图显示，支持 ←/→ 键和按钮翻页。
- **PPT 幻灯片 VLM 分析** — 笔记生成时可选「课件（PPT 幻灯片）」来源，调用 `vlm_client.describe_frame()` 逐张分析幻灯片图片，通过 SSE `status` 事件实时推送进度，分析结果以 `【课件（PPT 幻灯片）】` 区块传入 LLM 提示词；分析结果同时保存为 `{note_stem}_slides.md` 文件于笔记同目录。
- **NotesTab GenPanel 多源选择** — GenPanel 支持同时勾选课件文档、转录文本、PPT 幻灯片三路输入，PPT 幻灯片区块以紫罗兰色高亮显示。
- **LLM ASSISTANT 历史对话侧边栏** — ChatPanel 右上角新增 ☰ 按钮，展开左侧历史记录面板，显示所有笔记对话历史（按最近更新时间排序），支持按笔记名称过滤，点击条目高亮当前会话，实现跨笔记的对话上下文管理。
- **Qwen3-ASR 引擎** — 新增 `qwen3` 引擎支持，使用 Qwen/Qwen3-ASR-1.7B 本地转写（无需网络，支持 52 种语言和中文方言，RTF 0.05x，5 分钟音频仅需 13s），自动按 5 分钟分段处理任意长度音频；设置 `asr_engine: qwen3` + `asr_model: Qwen/Qwen3-ASR-1.7B` 即可启用。
- **Translate Cookie 配置界面** — Settings 页新增「AI 转录站」区块，支持直接输入 `JA_SESSION_COOKIE`，点击「◎ 测试」验证有效性，保存后自动写入 `settings.json`；后端 `/api/settings/test_translate` 提供验证接口。
- **视频双片段下载** — `/api/video/plays` 支持 `course_id` 参数，正确调用视频平台 Token；前端点击视频弹出教师摄像/屏幕录屏选择框。
- **Canvas 文件目录结构保留** — 下载课程文件时保留 Canvas 原生子目录（如 `course files/阅读文本/`），`download_file()` 新增 `get_folder_path()` 解析文件夹路径。
- **多选转录文本** — NotesTab GenPanel 转录选择从单选下拉框改为多选 Checkbox，后端支持同时传入多个 transcript 路径并合并内容生成笔记。
- **Agent CLI** — `cli.py` 提供完整的 JSON CLI 接口，支持课程/文件/视频/转写/笔记/对话/设置的所有操作，流式命令实时输出到 stderr。
- **Chat history persistence** — Chat history is now saved per note to `data/chats/`. Switching notes loads the previous conversation automatically.
- **LLM Markdown rendering** — LLM responses in the chat panel are rendered as proper Markdown (react-markdown + remark-gfm).
- **Batch transcribe workflow** — Download → transcribe → delete video all in one go. Progress shown inline in Videos tab and sidebar.
- **Note naming by transcription** — Notes named after transcription file (e.g. `生物学基础_第2讲_.md`), preventing overwrite.

### Fixes

- **settings.json 配置系统** — 所有凭证（Canvas Token、JA Auth Cookie、JA Session Cookie、LLM API Key 等）统一存储于 `settings.json`，启动时加载，支持 UI 实时修改，无需任何 `.env` 文件。
- **pptImgUrl KeyError** — 前端 `pptDownload` 请求中 API 返回的字段名为 `pptImgUrl`，而非 `ppt_img_url`，已修复。
- **img2pdf 依赖** — PPT 下载新增 `img2pdf` 库优先转换 PDF，若缺失则回退到 zip 打包图片。
- **FastAPI BackgroundTasks 不执行** — 6 处 `BackgroundTasks().add_task()` 未作为依赖参数声明，导致后台任务静默不执行；已全部改为在函数签名中声明 `background_tasks: BackgroundTasks` 参数后调用 `background_tasks.add_task()`。
- **TranslateClient 认证失败（HTTP 401）** — 添加缺失的 `Referer`、`Accept`、`Accept-Language` 请求头，这些头是 translate 服务器验证请求来源的关键；修复 `_parse_cookie_header` 对 `keepalive` 单引号值的重复截断问题；`upload` 返回值修复为 UUID 格式（文件名即 UUID）。
- **视频片段获取 500 错误** — `SJTUVideoClient.get_video_info()` 未绑定课程 Token，导致 `/api/video/plays` 返回 401；现已加入 `course_id` 参数并调用 `bind_canvas_course()`。
- **下载进度显示** — 后端每批下载数据更新 `tasks[tid]["progress"]` 和 `total`，前端 VideosTab 行内显示进度条（百分比 + MB 数）。
- **批量转写命中已有结果** — Phase 2 转写前先查询 translate 网站列表，已有的结果直接拉取保存，不重复上传；配合每日 20 个限额，确保耗尽后仍能从网站取回文本。 — 视频下载完成后自动触发 ASR 转录（单视频 `download` 任务 + 批量 `batch/transcribe` 均适用），状态流转：downloading → transcribing → done，无需手动点击转录按钮。
- **Transcription content not loading** — Split into two endpoints to avoid SPA catch-all route.
- **Wrong transcription passed to LLM** — Fetch content before sending; pass `transcript_name` for naming.
- **Transcription list not scoped to course** — Direct equality `t.course === course.name`.
- **Note generation with empty transcript** — Conditionally excludes `【课件】` section.
