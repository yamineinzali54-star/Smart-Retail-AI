"""Try providers in order; first success wins. Free-tier models are
unreliable, so every LLM call site should use this."""

from __future__ import annotations

from .base import BaseLLMProvider


class FallbackLLMProvider(BaseLLMProvider):
    def __init__(self, providers: list[BaseLLMProvider]):
        if not providers:
            raise ValueError("at least one provider is required")
        self._providers = providers

    def complete(self, prompt: str, *, system: str = "", json_mode: bool = False) -> str:
        errors: list[str] = []
        for provider in self._providers:
            try:
                return provider.complete(prompt, system=system, json_mode=json_mode)
            except Exception as exc:  # noqa: BLE001 — collect and try next
                errors.append(str(exc))
        raise RuntimeError(f"all LLM providers failed: {'; '.join(errors)}")
