"""MiniMax-M3 streaming multimodal client (OpenAI-compatible endpoint)."""
import base64
import json
import os
from typing import AsyncIterator

import httpx

API_BASE = os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io")
ENDPOINT = f"{API_BASE}/v1/chat/completions"
MODEL = "MiniMax-M3"

SYSTEM_PROMPT = """You are a careful, focused reading assistant. The user is reading a PDF and has highlighted a specific region of one page (sent to you as an image crop) and asked a question about it.

Rules:
- Answer the question using BOTH the highlighted image crop AND the page text provided.
- Be precise and concise. Quote relevant text from the page when it clarifies the answer.
- If the highlighted region is ambiguous or the question can't be answered from the page text + image, say so directly. Do not invent content.
- The user is anchored to one specific page; do not pretend to know about other pages unless context is provided.
- Use plain prose. Avoid bullet lists unless they genuinely help. No headings unless the answer is long.
"""


def _user_content(page_image_b64, page_text, question):
    parts = []
    if page_image_b64:
        parts.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{page_image_b64}"},
        })
    context_lines = []
    if page_text:
        context_lines.append("PAGE TEXT:\n" + page_text[:6000])
    else:
        context_lines.append("PAGE TEXT: (this page has no extractable text layer; image-only context)")
    context_lines.append("USER QUESTION:\n" + question)
    parts.append({"type": "text", "text": "\n\n".join(context_lines)})
    return parts


async def stream_chat(
    api_key: str,
    question: str,
    page_image_b64,
    page_text,
    history,
):
    """Yield SSE-style events: {"type":"token","text":"..."} and {"type":"done"}.

    history is a list of {"role": "user"|"assistant", "content": "..."} turns
    (no anchors in the history — context is carried by the current user turn).
    """
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    # Limit history to last 8 turns to stay within budget
    for turn in history[-16:]:  # 16 = 8 user + 8 assistant
        messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({
        "role": "user",
        "content": _user_content(page_image_b64, page_text, question),
    })

    body = {
        "model": MODEL,
        "max_tokens": 2048,
        "temperature": 0.3,
        "stream": True,
        "messages": messages,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    # M3 sometimes embeds  think...  think inside the content field instead
    # of (or in addition to) the reasoning_content field. Strip it.
    state = {"in_think": False}

    def _strip(text):
        out = text
        # Handle opening tag
        if not state["in_think"]:
            i = out.find('<think>')
            if i != -1:
                out = out[:i]
                state["in_think"] = True
            return out
        # Inside a think block
        i = out.find('</think>')
        if i != -1:
            out = out[i + len('</think>'):]
            state["in_think"] = False
            # Recurse in case there's another open tag further in
            return _strip(out)
        return ""

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, read=120.0)) as client:
        async with client.stream("POST", ENDPOINT, headers=headers, json=body) as r:
            if r.status_code >= 400:
                err_body = await r.aread()
                try:
                    err = json.loads(err_body)
                    msg = err.get("error", {}).get("message") or err.get("message") or err_body.decode("utf-8", "replace")
                except Exception:
                    msg = err_body.decode("utf-8", "replace")
                yield {"type": "error", "message": f"HTTP {r.status_code}: {msg}"}
                return

            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if payload == "[DONE]":
                    yield {"type": "done"}
                    return
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choice = (obj.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                # Drop reasoning_content if provided separately
                if delta.get("reasoning_content"):
                    yield {"type": "reasoning", "text": delta["reasoning_content"]}
                content = delta.get("content")
                if content:
                    cleaned = _strip(content)
                    if cleaned:
                        yield {"type": "token", "text": cleaned}
                # Some implementations nest under "message"
                if not content and not delta.get("reasoning_content"):
                    msg = delta.get("message") or {}
                    inner = msg.get("content") or ""
                    if inner:
                        cleaned = _strip(inner)
                        if cleaned:
                            yield {"type": "token", "text": cleaned}
            yield {"type": "done"}
