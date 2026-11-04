"""OpenAI-compatible chat-completions provider used by supported gateways."""

from __future__ import annotations

import httpx

from .base import BaseLLMProvider


def _provider_error_message(resp: httpx.Response) -> str:
    """Return a short upstream error without exposing request headers or body data."""
    try:
        payload = resp.json()
    except ValueError:
        payload = None

    detail = ""
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            detail = str(error.get("message") or error.get("code") or "")
        elif isinstance(error, str):
            detail = error
        if not detail:
            detail = str(payload.get("message") or payload.get("_tag") or "")

    detail = " ".join(detail.split())[:300]
    provider = resp.url.host or "AI provider"
    suffix = f": {detail}" if detail else ""
    return f"{provider} returned HTTP {resp.status_code} {resp.reason_phrase}{suffix}"


def _response_error_detail(body: dict) -> str:
    """Extract a short provider error from a JSON response, if present."""
    error = body.get("error")
    if isinstance(error, dict):
        detail = error.get("message") or error.get("code")
    elif isinstance(error, str):
        detail = error
    else:
        detail = body.get("message") or body.get("detail") or body.get("_tag")
    return " ".join(str(detail or "").split())[:300]


class OpenRouterProvider(BaseLLMProvider):
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str,
        timeout: float = 60.0,
        zdr: bool = True,
        data_collection: str = "deny",
        max_tokens: int | None = None,
        include_openrouter_options: bool = True,
    ):
        if not api_key:
            raise ValueError("AI provider API key is not set")
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._zdr = zdr
        self._data_collection = data_collection
        self._max_tokens = max_tokens
        self._include_openrouter_options = include_openrouter_options
        self.usage = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
            "cost_reported": False,
        }

    @property
    def model(self) -> str:
        return self._model

    def complete(self, prompt: str, *, system: str = "", json_mode: bool = False) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        payload: dict = {"model": self._model, "messages": messages}
        if self._max_tokens is not None:
            payload["max_tokens"] = self._max_tokens
        if self._include_openrouter_options:
            payload["provider"] = {
                "zdr": self._zdr,
                "data_collection": self._data_collection,
            }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        resp = httpx.post(
            f"{self._base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json=payload,
            timeout=self._timeout,
        )
        if not resp.is_success:
            raise RuntimeError(_provider_error_message(resp))
        try:
            body = resp.json()
        except ValueError as exc:
            raise RuntimeError(
                f"{resp.url.host or 'AI provider'} returned HTTP {resp.status_code} with invalid JSON"
            ) from exc
        if not isinstance(body, dict):
            raise RuntimeError(
                f"{resp.url.host or 'AI provider'} returned an unexpected chat completion response"
            )
        usage = body.get("usage") or {}
        if not isinstance(usage, dict):
            usage = {}
        prompt_tokens = usage.get("prompt_tokens") or 0
        completion_tokens = usage.get("completion_tokens") or 0
        total_tokens = usage.get("total_tokens") or (prompt_tokens + completion_tokens)
        cost = usage.get("cost")
        if cost is None:
            cost = body.get("cost")
        self.usage["prompt_tokens"] += int(prompt_tokens)
        self.usage["completion_tokens"] += int(completion_tokens)
        self.usage["total_tokens"] += int(total_tokens)
        if isinstance(cost, (float, int)):
            self.usage["cost_usd"] += max(0.0, float(cost))
            self.usage["cost_reported"] = True

        choices = body.get("choices")
        if not isinstance(choices, list) or not choices:
            detail = _response_error_detail(body)
            suffix = f": {detail}" if detail else " (missing choices)"
            raise RuntimeError(
                f"{resp.url.host or 'AI provider'} returned an incomplete chat completion response{suffix}"
            )
        choice = choices[0]
        message = choice.get("message") if isinstance(choice, dict) else None
        if not isinstance(message, dict):
            raise RuntimeError(
                f"{resp.url.host or 'AI provider'} returned a chat completion without a message"
            )
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            )
        detail = message.get("refusal")
        if isinstance(detail, str) and detail.strip():
            raise RuntimeError(f"{resp.url.host or 'AI provider'} refused the request: {detail[:300]}")
        raise RuntimeError(
            f"{resp.url.host or 'AI provider'} returned a chat completion without text content"
        )
