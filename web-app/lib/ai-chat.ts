import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { aiChatConversations, aiChatMessages } from "@/db/schema";

export async function createConversation(input: {
  userId: string;
  branchId: string;
  question: string;
}) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx.insert(aiChatConversations).values({
      userId: input.userId,
      branchId: input.branchId,
      title: input.question.slice(0, 160),
    }).returning({ id: aiChatConversations.id, title: aiChatConversations.title });
    const [message] = await tx.insert(aiChatMessages).values({
      conversationId: conversation.id,
      role: "user",
      content: input.question,
      status: "pending",
    }).returning({ id: aiChatMessages.id });
    return { conversation, message };
  });
}

export async function addUserMessage(input: {
  conversationId: string;
  userId: string;
  branchId: string;
  question: string;
}) {
  const [conversation] = await db.select({ id: aiChatConversations.id })
    .from(aiChatConversations)
    .where(and(
      eq(aiChatConversations.id, input.conversationId),
      eq(aiChatConversations.userId, input.userId),
      eq(aiChatConversations.branchId, input.branchId),
    )).limit(1);
  if (!conversation) return null;
  const [message] = await db.insert(aiChatMessages).values({
    conversationId: conversation.id,
    role: "user",
    content: input.question,
    status: "pending",
  }).returning({ id: aiChatMessages.id });
  await db.update(aiChatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(aiChatConversations.id, conversation.id));
  return message;
}

export async function getPendingUserMessage(input: {
  messageId: string;
  conversationId: string;
  userId: string;
  branchId: string;
}) {
  const [row] = await db.select({
    id: aiChatMessages.id,
    content: aiChatMessages.content,
    status: aiChatMessages.status,
  })
    .from(aiChatMessages)
    .innerJoin(aiChatConversations, eq(aiChatMessages.conversationId, aiChatConversations.id))
    .where(and(
      eq(aiChatMessages.id, input.messageId),
      eq(aiChatMessages.conversationId, input.conversationId),
      eq(aiChatMessages.role, "user"),
      eq(aiChatConversations.userId, input.userId),
      eq(aiChatConversations.branchId, input.branchId),
    )).limit(1);
  return row ?? null;
}

export async function getRecentConversationContext(input: {
  conversationId: string;
  userId: string;
  branchId: string;
}) {
  const rows = await db.select({
    role: aiChatMessages.role,
    content: aiChatMessages.content,
    metadata: aiChatMessages.metadata,
  })
    .from(aiChatMessages)
    .innerJoin(aiChatConversations, eq(aiChatMessages.conversationId, aiChatConversations.id))
    .where(and(
      eq(aiChatMessages.conversationId, input.conversationId),
      eq(aiChatMessages.status, "complete"),
      eq(aiChatConversations.userId, input.userId),
      eq(aiChatConversations.branchId, input.branchId),
    ))
    .orderBy(desc(aiChatMessages.createdAt))
    .limit(4);

  return rows.reverse().map((row) => {
    const entry: { role: "user" | "assistant"; content: string; forecast?: Record<string, unknown> } = {
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content.slice(0, 400),
    };
    const forecast = row.metadata?.forecast;
    if (row.role === "assistant" && forecast && typeof forecast === "object" && !Array.isArray(forecast)) {
      const value = forecast as Record<string, unknown>;
      const items = Array.isArray(value.items) ? value.items.slice(0, 10) : undefined;
      const recent = Array.isArray(value.forecast) ? value.forecast.slice(0, 4) : undefined;
      const topProducts = Array.isArray(value.top_products) ? value.top_products.slice(0, 5) : undefined;
      const series = Array.isArray(value.series) ? value.series.slice(0, 8) : undefined;
      entry.forecast = {
        type: value.type,
        comparison_type: value.comparison_type,
        available: value.available,
        period_days: value.period_days,
        days: value.days,
        need_order_count: value.need_order_count,
        total_suggested_units: value.total_suggested_units,
        history_weeks: value.history_weeks,
        weeks_required: value.weeks_required,
        metrics: value.metrics,
        trained_at: value.trained_at,
        items,
        forecast: recent,
        top_products: topProducts,
        series,
        actual: value.actual,
        forecast_period: value.forecast_period,
        current: value.current,
        previous: value.previous,
        change_amount: value.change_amount,
        change_pct: value.change_pct,
      };
    }
    return entry;
  });
}

export async function markMessageFailed(messageId: string) {
  await db.update(aiChatMessages)
    .set({ status: "failed", updatedAt: new Date() })
    .where(and(eq(aiChatMessages.id, messageId), eq(aiChatMessages.role, "user")));
}

export async function completeAiChatMessage(input: {
  messageId: string;
  conversationId: string;
  modelId: string | null;
  data: Record<string, unknown>;
}) {
  const rows = Array.isArray(input.data.rows) ? input.data.rows.slice(0, 50) : [];
  const metadata = {
    understanding: input.data.understanding,
    plan: input.data.plan,
    findings: input.data.findings,
    summary: input.data.summary,
    suggestions: input.data.suggestions,
    sql: input.data.sql,
    forecast: input.data.forecast,
    sqlError: input.data.sql_error,
    failure: input.data.failure === true,
    rows,
    rowCount: input.data.row_count,
    truncated: input.data.truncated,
  };
  const content = typeof input.data.summary === "string"
    ? input.data.summary.slice(0, 10_000)
    : typeof input.data.answer === "string"
      ? input.data.answer.slice(0, 10_000)
      : "";

  await db.transaction(async (tx) => {
    await tx.update(aiChatMessages)
      .set({ status: "complete", updatedAt: new Date() })
      .where(and(eq(aiChatMessages.id, input.messageId), eq(aiChatMessages.role, "user")));
    await tx.insert(aiChatMessages).values({
      conversationId: input.conversationId,
      role: "assistant",
      content,
      status: "complete",
      modelId: input.modelId,
      metadata,
    });
    await tx.update(aiChatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(aiChatConversations.id, input.conversationId));
  });
}

export async function listConversations(userId: string, branchId: string) {
  return db.select({
    id: aiChatConversations.id,
    title: aiChatConversations.title,
    updatedAt: aiChatConversations.updatedAt,
  })
    .from(aiChatConversations)
    .where(and(
      eq(aiChatConversations.userId, userId),
      eq(aiChatConversations.branchId, branchId),
    ))
    .orderBy(desc(aiChatConversations.updatedAt))
    .limit(50);
}

export async function getConversation(userId: string, branchId: string, conversationId: string) {
  const [conversation] = await db.select({
    id: aiChatConversations.id,
    title: aiChatConversations.title,
    updatedAt: aiChatConversations.updatedAt,
  })
    .from(aiChatConversations)
    .where(and(
      eq(aiChatConversations.id, conversationId),
      eq(aiChatConversations.userId, userId),
      eq(aiChatConversations.branchId, branchId),
    )).limit(1);
  if (!conversation) return null;
  const messages = await db.select({
    id: aiChatMessages.id,
    role: aiChatMessages.role,
    content: aiChatMessages.content,
    status: aiChatMessages.status,
    metadata: aiChatMessages.metadata,
    modelId: aiChatMessages.modelId,
    createdAt: aiChatMessages.createdAt,
  })
    .from(aiChatMessages)
    .where(eq(aiChatMessages.conversationId, conversationId))
    .orderBy(aiChatMessages.createdAt);
  return { ...conversation, messages };
}

export async function deleteConversation(userId: string, branchId: string, conversationId: string) {
  const deleted = await db.delete(aiChatConversations)
    .where(and(
      eq(aiChatConversations.id, conversationId),
      eq(aiChatConversations.userId, userId),
      eq(aiChatConversations.branchId, branchId),
    ))
    .returning({ id: aiChatConversations.id });
  return deleted.length > 0;
}
