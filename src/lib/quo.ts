const QUO_API_BASE = "https://api.openphone.com/v1";

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
  return process.env.QUO_PHONE_NUMBER?.trim() || null;
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
      | { data?: { id?: string }; id?: string; message?: string }
      | null;

    if (!response.ok) {
      const message =
        (data && "message" in data && typeof data.message === "string"
          ? data.message
          : null) ?? `Quo API error (${response.status})`;
      return { ok: false, error: message };
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
