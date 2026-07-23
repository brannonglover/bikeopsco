import { prisma } from "@/lib/db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoPushMessage {
  to: string;
  sound?: "default" | null;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  badge?: number;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

function isExpoPushToken(token: string): boolean {
  return /^ExponentPushToken\[.+\]$/.test(token) || /^ExpoPushToken\[.+\]$/.test(token);
}

async function sendPushToTokens(
  tokens: string[],
  message: Omit<ExpoPushMessage, "to">
): Promise<void> {
  const valid = tokens.filter(isExpoPushToken);
  if (valid.length === 0) return;

  const messages: ExpoPushMessage[] = valid.map((to) => ({ to, sound: "default", ...message }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      console.error("Expo push error:", res.status, await res.text());
      return;
    }

    const result = (await res.json()) as { data: ExpoPushTicket[] };
    const tickets = result.data ?? [];

    // Clean up stale tokens that are no longer registered
    const staleTokens: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
        staleTokens.push(valid[i]);
      }
    });
    if (staleTokens.length > 0) {
      await prisma.pushToken
        .deleteMany({ where: { token: { in: staleTokens } } })
        .catch(() => {});
    }
  } catch (err) {
    console.error("Push send error:", err);
  }
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** True when the customer has registered the mobile app for this shop (push token present). */
export async function customerHasPushTokens(
  shopId: string,
  customerId: string
): Promise<boolean> {
  const count = await prisma.pushToken.count({ where: { shopId, customerId } });
  return count > 0;
}

export async function sendPushToCustomer(
  shopId: string,
  customerId: string,
  payload: PushPayload
): Promise<void> {
  const records = await prisma.pushToken.findMany({ where: { shopId, customerId } });
  await sendPushToTokens(
    records.map((r) => r.token),
    { title: payload.title, body: payload.body, data: payload.data }
  );
}

export async function sendPushToAllStaff(shopId: string, payload: PushPayload): Promise<void> {
  const records = await prisma.pushToken.findMany({
    where: { shopId, userId: { not: null } },
  });
  if (records.length === 0) {
    console.warn(
      `[push] No staff push tokens for shop ${shopId} — open the staff app on a device and allow notifications`
    );
    return;
  }
  await sendPushToTokens(
    records.map((r) => r.token),
    { title: payload.title, body: payload.body, data: payload.data }
  );
}
