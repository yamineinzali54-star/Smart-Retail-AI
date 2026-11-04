"""LLM provider abstraction. Heavy math stays in Python; the LLM is only
used for NL→SQL translation and insight narration."""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseLLMProvider(ABC):
    # True when this provider is a canned stand-in for a missing API key
    # (offline mode). Narration layers skip offline providers and use their
    # rule-based fallbacks instead of surfacing canned text to end users.
    offline: bool = False

    @abstractmethod
    def complete(self, prompt: str, *, system: str = "", json_mode: bool = False) -> str:
        """Return the raw completion text. Raise on failure."""


class StubLLMProvider(BaseLLMProvider):
    """Deterministic stand-in for tests / offline dev. With `script`, each
    call pops the next response (last one repeats); otherwise `canned`.
    Pass `offline=True` for the missing-API-key stand-in so narrators treat
    it as "no LLM" and fall back to rule-based text."""

    def __init__(
        self,
        canned: str = "SELECT 1",
        script: list[str] | None = None,
        offline: bool = False,
    ):
        self._script = list(script) if script else [canned]
        self.offline = offline

    def complete(self, prompt: str, *, system: str = "", json_mode: bool = False) -> str:
        if len(self._script) > 1:
            return self._script.pop(0)
        return self._script[0]
