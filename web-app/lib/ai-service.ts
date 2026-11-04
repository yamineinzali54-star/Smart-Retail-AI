import "server-only";

/** Server-to-server authentication for the private Python AI service. */
export function aiServiceAuthHeaders(headers?: HeadersInit): Headers {
  const token = process.env.AI_SERVICE_TOKEN;
  if (!token) {
    throw new Error("AI_SERVICE_TOKEN is not configured");
  }

  const result = new Headers(headers);
  result.set("x-ai-service-token", token);
  return result;
}
