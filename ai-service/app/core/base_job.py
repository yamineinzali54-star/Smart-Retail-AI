"""Base classes every AI job inherits from (PROJECT_PLAN.md §6.12, §7.17).

Job types: rag_query | forecast | promotion_suggest | price_optimize
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4


@dataclass
class JobContext:
    branch_id: str
    params: dict[str, Any] = field(default_factory=dict)
    job_id: str = field(default_factory=lambda: uuid4().hex)


@dataclass
class JobResult:
    job_id: str
    job_name: str
    ok: bool
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class BaseJob(ABC):
    """All feature jobs subclass this. `execute` is the only entry point."""

    name: str = "base"

    @abstractmethod
    def validate(self, ctx: JobContext) -> None:
        """Raise ValueError on bad input."""

    @abstractmethod
    def run(self, ctx: JobContext) -> JobResult:
        """Do the work. Assumes validated input."""

    def execute(self, ctx: JobContext) -> JobResult:
        try:
            self.validate(ctx)
        except Exception as exc:
            return JobResult(job_id=ctx.job_id, job_name=self.name, ok=False, error=str(exc))
        try:
            return self.run(ctx)
        except Exception as exc:
            return JobResult(job_id=ctx.job_id, job_name=self.name, ok=False, error=str(exc))
