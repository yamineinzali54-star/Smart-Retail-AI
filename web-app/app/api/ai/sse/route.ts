import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { aiServiceAuthHeaders } from "@/lib/ai-service";
import { recordAiModelUsage, reserveAiModel } from "@/lib/ai-model-settings";
import { completeAiChatMessage, getPendingUserMessage, getRecentConversationContext, markMessageFailed } from "@/lib/ai-chat";

// GET /api/ai/sse?question= — SSE relay (PROJECT_PLAN.md §7.17). Session
// roles: admin + inventory only. Proxies the Python AI service's stepwise
// stream (GET /stream/rag) to the browser: status → sql → rows → answer →
// done. Always answers 200 with an event stream — upstream failures arrive
// as a terminal done event {ok: false} so EventSource clients need only one
// code path. POS checkout never touches this route.

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

function doneEvent(payload: unknown): string {
  return `event: done\ndata: ${JSON.stringify(payload)}\n\n`;
}

function aiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

function persistStream(body: ReadableStream<Uint8Array>, modelId: string | null, messageId: string, conversationId: string): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffered = "";
  let receivedDone = false;

  async function inspectFrame(frame: string) {
    const lines = frame.split(/\r?\n/);
    if (!lines.some((line) => line.trim() === "event: done")) return;
    receivedDone = true;
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    try {
      const payload = JSON.parse(data) as {
        ok?: boolean;
        data?: Record<string, unknown>;
        usage?: { total_tokens?: unknown; cost_usd?: unknown; cost_reported?: unknown };
      };
      if (!payload.ok) {
        await markMessageFailed(messageId);
        return;
      }
      await completeAiChatMessage({
        messageId,
        conversationId,
        modelId,
        data: payload.data ?? {},
      });
      const totalTokens = Number(payload.usage?.total_tokens);
      const costUsd = Number(payload.usage?.cost_usd);
      const costReported = payload.usage?.cost_reported === true;
      if (modelId && Number.isFinite(totalTokens) && totalTokens >= 0) {
        await recordAiModelUsage(modelId, {
          totalTokens,
          costUsd: costReported && Number.isFinite(costUsd) ? Math.max(0, costUsd) : 0,
          costReported,
        });
      }
    } catch (error) {
      console.error("Could not record AI model usage", error);
    }
  }

  async function consume(text: string) {
    buffered += text;
    let boundary: RegExpExecArray | null;
    const delimiter = /\r?\n\r?\n/;
    while ((boundary = delimiter.exec(buffered))) {
      const frame = buffered.slice(0, boundary.index);
      buffered = buffered.slice(boundary.index + boundary[0].length);
      await inspectFrame(frame);
    }
  }

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      await consume(decoder.decode(chunk, { stream: true }));
      controller.enqueue(chunk);
    },
    async flush() {
      await consume(decoder.decode());
      if (buffered.trim()) await inspectFrame(buffered);
      if (!receivedDone) await markMessageFailed(messageId);
    },
  }));
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const conversationId = params.get("conversation_id") ?? "";
  const messageId = params.get("message_id") ?? "";
  const modelId = params.get("model_id") ?? "";
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(conversationId) || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(messageId) || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(modelId)) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const savedMessage = await getPendingUserMessage({
    messageId,
    conversationId,
    userId: session.user.id,
    branchId: session.user.branchId,
  });
  if (!savedMessage || savedMessage.status !== "pending") {
    return NextResponse.json({ ok: false, error: "CHAT_MESSAGE_UNAVAILABLE" }, { status: 404 });
  }
  const question = savedMessage.content;
  let history: Awaited<ReturnType<typeof getRecentConversationContext>> = [];
  try {
    history = await getRecentConversationContext({
      conversationId,
      userId: session.user.id,
      branchId: session.user.branchId,
    });
  } catch (error) {
    console.error("Could not load recent AI chat context", error);
  }

  const reservation = await reserveAiModel(modelId);
  if (!reservation.ok) {
    await markMessageFailed(messageId);
    return new Response(doneEvent({ ok: false, error: reservation.error }), { headers: SSE_HEADERS });
  }
  const selectedModel = reservation.model;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let upstream: Response | null = null;
  try {
    const isForecastCommand = /^\s*\/(?:demand|revenue|compare)(?:\s|$)/i.test(question);
    const streamPath = isForecastCommand ? "/stream/chat-forecast" : "/stream/rag";
    const streamParams = new URLSearchParams({ question, branch_id: session.user.branchId });
    if (history.length) streamParams.set("history", JSON.stringify(history));
    if (isForecastCommand) {
      streamParams.set("locale", params.get("locale") === "my" ? "my" : "en");
    }
    const url =
      `${aiServiceUrl()}${streamPath}?` +
      streamParams;
    const headers = new Headers({ accept: "text/event-stream" });
    headers.set("x-ai-model-provider", selectedModel.provider);
    headers.set("x-ai-model", selectedModel.name);
    headers.set("x-ai-api-key", selectedModel.apiKey);
    if (selectedModel.providerMaxOutputTokens) {
      headers.set("x-ai-max-tokens", String(selectedModel.providerMaxOutputTokens));
    }
    upstream = await fetch(url, {
      headers: aiServiceAuthHeaders(headers),
      signal: controller.signal,
    });
  } catch {
    upstream = null;
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    const error = upstream?.status === 429 ? "AI_QUOTA_EXCEEDED" : "AI_UNAVAILABLE";
    await markMessageFailed(messageId);
    return new Response(doneEvent({ ok: false, error }), { headers: SSE_HEADERS });
  }
  const body = persistStream(upstream.body, selectedModel.id, messageId, conversationId);
  return new Response(body, { headers: SSE_HEADERS });
}
