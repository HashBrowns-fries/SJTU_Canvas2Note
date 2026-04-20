"""
统一 LLM 调用模块
自动识别 base_url：包含 anthropic/mimaxi 用 Anthropic SDK，否则用 OpenAI SDK
"""
import json
from openai import AsyncOpenAI

_anthropic = None

def _is_anthropic(base_url: str) -> bool:
    u = base_url.lower()
    return "anthropic" in u or "minimaxi" in u or "minimax" in u


def _get_anthropic():
    global _anthropic
    if _anthropic is None:
        import anthropic
        _anthropic = anthropic
    return _anthropic


async def llm_stream(
    base_url: str,
    api_key: str,
    model: str,
    system: str,
    messages: list[dict],
    temperature: float = 0.3,
    extra: dict | None = None,
):
    """
    生成器：yield 每个 delta SSE 行
    结束时 yield {"done": True, "content": full_text}
    出错时 yield {"error": "..."}
    """
    if _is_anthropic(base_url):
        async for line in _anthropic_stream(base_url, api_key, model, system, messages, temperature, extra):
            yield line
    else:
        async for line in _openai_stream(base_url, api_key, model, system, messages, temperature, extra):
            yield line


async def _openai_stream(
    base_url: str, api_key: str, model: str,
    system: str, messages: list[dict],
    temperature: float, extra: dict | None,
):
    client = AsyncOpenAI(base_url=base_url, api_key=api_key, timeout=300)
    all_messages = [{"role": "system", "content": system}]
    all_messages.extend(messages)

    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=all_messages,
            temperature=temperature,
            stream=True,
            **(extra or {}),
        )
        full = []
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                full.append(delta)
                yield f"data: {json.dumps({'delta': delta})}\n\n"
        yield f"data: {json.dumps({'done': True, 'content': ''.join(full)})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


async def _anthropic_stream(
    base_url: str, api_key: str, model: str,
    system: str, messages: list[dict],
    temperature: float, extra: dict | None,
):
    Anthropic = _get_anthropic()
    client = Anthropic(base_url=base_url, api_key=api_key, timeout=30)

    # Anthropic 格式：user 消息是 content blocks
    anthropic_messages = []
    for m in messages:
        role = m.get("role", "user")
        if role == "system":
            # prepend to system
            continue
        content = m.get("content", "")
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        anthropic_messages.append({"role": role, "content": content})

    extra = extra or {}
    try:
        with client.messages.stream(
            model=model,
            system=system,
            messages=anthropic_messages,
            temperature=temperature,
            **extra,
        ) as stream:
            full = []
            for event in stream:
                if event.type == "content_block_delta":
                    delta = event.delta.text or ""
                    if delta:
                        full.append(delta)
                        yield f"data: {json.dumps({'delta': delta})}\n\n"
                elif event.type == "message_delta":
                    pass
            yield f"data: {json.dumps({'done': True, 'content': ''.join(full)})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


# ── 同步版本（用于 test） ──────────────────────────────────────────────────────

def llm_chat(base_url: str, api_key: str, model: str, prompt: str, max_tokens: int = 10) -> str:
    if _is_anthropic(base_url):
        Anthropic = _get_anthropic()
        client = Anthropic(base_url=base_url, api_key=api_key, timeout=15)
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        )
        for block in resp.content:
            if block.type == "text":
                return block.text
        return ""
    else:
        from openai import OpenAI
        client = OpenAI(base_url=base_url, api_key=api_key, timeout=15)
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
        )
        return resp.choices[0].message.content or ""
