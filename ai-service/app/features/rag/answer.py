"""Full RAG pipeline (rag_answer job): question -> guarded SQL -> execute
(read-only) -> narrated answer. Fails closed at every step; narration
failure still returns the rows with a rule-based fallback answer."""

from __future__ import annotations

import json
from typing import Any

from app.core.base_job import BaseJob, JobContext, JobResult
from app.core.db import Database
from app.core.llm.base import BaseLLMProvider
from .prompts import NARRATE_SYSTEM_PROMPT
from .sql_cache import SQLCache
from .text_to_sql import TextToSQLJob

MAX_ROWS = 50
NARRATE_ROWS = MAX_ROWS


class Narrator:
    def __init__(self, llm: BaseLLMProvider | None = None):
        self._llm = llm

    def narrate(self, *, question: str, sql: str, rows: list[dict[str, Any]]) -> str:
        return self.narrate_structured(question=question, sql=sql, rows=rows)["summary"]

    def narrate_structured(
        self, *, question: str, sql: str, rows: list[dict[str, Any]],
        history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        fallback = self.fallback(rows)
        # offline stub = missing API key → rule-based fallback, never canned SQL.
        if self._llm is None or getattr(self._llm, "offline", False):
            return {"findings": [], "summary": fallback}
        preview = json.dumps(rows[:NARRATE_ROWS], default=str)
        try:
            text = self._llm.complete(
                f"Recent conversation context (use only to resolve references): {json.dumps(history or [], ensure_ascii=False)[:6000]}\n"
                f"Current question: {question}\nSQL: {sql}\nRows ({len(rows)}): {preview}",
                system=NARRATE_SYSTEM_PROMPT,
                json_mode=True,
            )
            payload = json.loads(text.strip())
            findings = payload.get("findings") if isinstance(payload, dict) else None
            summary = payload.get("summary") if isinstance(payload, dict) else None
            clean_findings = [
                value.strip()[:500]
                for value in findings
                if isinstance(value, str) and value.strip()
            ][:8] if isinstance(findings, list) else []
            if isinstance(summary, str) and summary.strip():
                return {"findings": clean_findings, "summary": summary.strip()[:1000]}
            if text.strip():
                return {"findings": clean_findings, "summary": text.strip()[:1000]}
            return {"findings": [], "summary": fallback}
        except json.JSONDecodeError:
            return {"findings": [], "summary": text.strip()[:1000] or fallback}
        except Exception:
            return {"findings": [], "summary": fallback}

    @staticmethod
    def fallback(rows: list[dict[str, Any]]) -> str:
        if not rows:
            return "No data found for your question."
        cols = list(rows[0].keys())
        lines = [" | ".join(cols)]
        for row in rows[:NARRATE_ROWS]:
            lines.append(" | ".join(str(row.get(c, "")) for c in cols))
        extra = f" (+{len(rows) - NARRATE_ROWS} more)" if len(rows) > NARRATE_ROWS else ""
        return f"Found {len(rows)} row(s){extra}:\n" + "\n".join(lines)


class RAGAnswerJob(BaseJob):
    """params: {question}. Requires a configured Database (fails closed)."""

    name = "rag_answer"

    def __init__(
        self,
        llm: BaseLLMProvider,
        db: Database | None = None,
        narrator_llm: BaseLLMProvider | None = None,
        cache: SQLCache | None = None,
    ):
        self._sql_job = TextToSQLJob(llm, db, cache=cache)
        self._narrator = Narrator(narrator_llm or llm)
        self._db = db

    def validate(self, ctx: JobContext) -> None:
        question = ctx.params.get("question", "")
        if not isinstance(question, str) or not question.strip():
            raise ValueError("params.question is required")
        if len(question) > 500:
            raise ValueError("params.question is too long (max 500 chars)")
        if not ctx.branch_id:
            raise ValueError("branch_id is required")
        if self._db is None:
            raise ValueError("AI_DB_UNAVAILABLE")

    def run(self, ctx: JobContext) -> JobResult:
        sql_result = self._sql_job.execute(ctx)
        if not sql_result.ok:
            failure = sql_result.data or {}
            stage = str(failure.get("failure_stage") or "schema or SQL generation")
            sql = failure.get("sql_candidate")
            summary = self._sql_job.explain_failure(
                question=str(ctx.params["question"]),
                stage=stage,
                reason=sql_result.error or "unknown failure",
                sql=sql if isinstance(sql, str) else None,
            )
            return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data={
                "question": str(ctx.params["question"]),
                "answer": summary,
                "summary": summary,
                "sql": sql,
                "failure": True,
            })
        if sql_result.data.get("refused") is True:
            return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data=sql_result.data)
        sql = sql_result.data["sql"]
        try:
            assert self._db is not None
            rows = self._db.fetch_all(sql)
        except Exception as exc:
            self._sql_job.invalidate_cached()
            summary = self._sql_job.explain_failure(
                question=str(ctx.params["question"]),
                stage="database query",
                reason=str(exc),
                sql=sql,
            )
            return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data={
                "question": str(ctx.params["question"]),
                "answer": summary,
                "summary": summary,
                "sql": sql,
                "failure": True,
            })
        if not isinstance(rows, list):
            rows = []
        truncated = len(rows) > MAX_ROWS
        rows = rows[:MAX_ROWS]
        narration = self._narrator.narrate_structured(
            question=str(ctx.params["question"]), sql=sql, rows=rows,
            history=TextToSQLJob._conversation_history(ctx.params.get("history")),
        )
        return JobResult(job_id=ctx.job_id, job_name=self.name, ok=True, data={
            "question": str(ctx.params["question"]),
            "understanding": sql_result.data.get("understanding", str(ctx.params["question"])),
            "plan": sql_result.data.get("plan", []),
            "sql": sql,
            "sql_source": sql_result.data.get("sql_source", "model"),
            "rows": rows,
            "row_count": len(rows),
            "truncated": truncated,
            "findings": narration["findings"],
            "summary": narration["summary"],
            "answer": narration["summary"],
            "suggestions": sql_result.data.get("suggestions", []),
        })
