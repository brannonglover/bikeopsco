import { normalizePhone } from "@/lib/phone";

const QUO_API_BASE = "https://api.openphone.com/v1";

type QuoApiErrorBody = {
  message?: string;
  title?: string;
  description?: string;
  errors?: { message?: string }[];
};

export type QuoSendMessageResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export function isQuoConfigured(): boolean {
  return Boolean(getQuoApiKey() && getQuoFromNumber());
}

export function getQuoApiKey(): string | null {
  return process.env.QUO_API_KEY?.trim() || null;
}

export function getQuoFromNumber(): string | null {
  const raw = process.env.QUO_PHONE_NUMBER?.trim();
  if (!raw) return null;
  if (raw.startsWith("PN")) return raw;
  return normalizePhone(raw) ?? raw;
}

function formatQuoApiError(status: number, data: QuoApiErrorBody | null): string {
  if (data?.title && data?.message) return `${data.title}: ${data.message}`;
  if (data?.description && data?.message) return `${data.message} (${data.description})`;
  if (data?.message) return data.message;
  const detail = data?.errors?.[0]?.message;
  if (detail) return detail;
  return `Quo API error (${status})`;
}

export function getQuoUserId(): string | null {
  return process.env.QUO_USER_ID?.trim() || null;
}

/** Prefix on API relay texts so webhooks can skip echoing into the widget. */
export const SITE_CHAT_QUO_RELAY_PREFIX = "[Bike Ops web] ";

export function formatSiteChatQuoRelay(visitorName: string, body: string): string {
  const name = visitorName.trim() || "Visitor";
  const text = body.trim();
  return `${SITE_CHAT_QUO_RELAY_PREFIX}${name}: ${text}`;
}

export function isSiteChatQuoRelayText(text: string): boolean {
  return text.startsWith(SITE_CHAT_QUO_RELAY_PREFIX);
}

/**
 * Send an SMS via Quo (OpenPhone) API.
 * @see https://www.quo.com/docs/mdx/api-reference/messages/send-a-text-message
 */
export async function sendQuoTextMessage(params: {
  toE164: string;
  content: string;
}): Promise<QuoSendMessageResult> {
  const apiKey = getQuoApiKey();
  const from = getQuoFromNumber();
  if (!apiKey || !from) {
    return { ok: false, error: "Quo is not configured" };
  }

  // Omit userId unless explicitly set — assigning a user can route sends through
  // the wrong line in multi-number workspaces.
  const userId = getQuoUserId();
  const payload: Record<string, unknown> = {
    content: params.content,
    from,
    to: [params.toE164],
  };
  if (userId) payload.userId = userId;

  try {
    const response = await fetch(`${QUO_API_BASE}/messages`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => null)) as
      | ({ data?: { id?: string }; id?: string } & QuoApiErrorBody)
      | null;

    if (!response.ok) {
      console.error("Quo send message failed:", response.status, data);
      return { ok: false, error: formatQuoApiError(response.status, data) };
    }

    const messageId =
      data?.data?.id?.trim() || (typeof data?.id === "string" ? data.id.trim() : "");
    if (!messageId) {
      return { ok: false, error: "Quo API returned no message id" };
    }

    return { ok: true, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quo request failed";
    return { ok: false, error: message };
  }
}
