import { prisma } from "@/lib/db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * The staff app's ring, named on both sides of the push.
 *
 * iOS takes the sound by filename; Android takes it from the channel, and
 * drops outright any notification naming a channel the device has not created
 * yet. Both must match lib/notifications.ts in the staff app — and because the
 * ringtone is bundled into the binary and an Android channel's settings freeze
 * the first time it is created, an app build carrying them has to reach staff
 * devices before this server starts asking for them.
 */
export const INCOMING_CALL_SOUND = "incoming_call.wav";
export const INCOMING_CALL_CHANNEL_ID = "incoming_call_v1";

interface ExpoPushMessage {
  to: string;
  /** "default" for the stock notification tone, or a filename bundled in the app. */
  sound?: string | null;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  badge?: number;
  /** Android only — which notification channel rings, vibrates and shows this. */
  channelId?: string;
  /** "high" wakes a dozing Android device instead of batching for later. */
  priority?: "default" | "normal" | "high";
  /** iOS only — "time-sensitive" lets it through Focus modes. */
  interruptionLevel?: "active" | "critical" | "passive" | "time-sensitive";
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

  const messages: ExpoPushMessage[] = valid.map((to) => ({ to, ...message }));

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

    // Expo answers 200 even when it refuses individual messages, so the
    // per-ticket status is the only place a failed push shows up. Leaving it
    // unlogged made a push that never arrived look exactly like one that did,
    // which is worth a line even though nothing here can retry it.
    const failures = tickets.filter((t) => t.status === "error");
    if (failures.length > 0) {
      console.error(
        `[push] Expo rejected ${failures.length}/${tickets.length} message(s):`,
        failures.map((t) => t.details?.error ?? t.message ?? "unknown").join(", ")
      );
    }

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
  /**
   * How loudly this one should arrive. Left out, a notification gets the
   * stock tone on the default channel, which is right for everything that can
   * wait; an inbound call cannot, so it sets all of these.
   */
  sound?: string;
  channelId?: string;
  priority?: "default" | "normal" | "high";
  interruptionLevel?: "active" | "critical" | "passive" | "time-sensitive";
}

/** The fields Expo sends, with the defaults every ordinary notification uses. */
function toExpoMessage(payload: PushPayload): Omit<ExpoPushMessage, "to"> {
  return {
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: payload.sound ?? "default",
    ...(payload.channelId ? { channelId: payload.channelId } : {}),
    ...(payload.priority ? { priority: payload.priority } : {}),
    ...(payload.interruptionLevel
      ? { interruptionLevel: payload.interruptionLevel }
      : {}),
  };
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
  console.log(
    `[push] sending "${payload.title}" to ${records.length} staff device(s) in shop ${shopId}`
  );
  await sendPushToTokens(
    records.map((r) => r.token),
    toExpoMessage(payload)
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
  console.log(
    `[push] sending "${payload.title}" to ${records.length} staff device(s) in shop ${shopId}`
  );
  await sendPushToTokens(
    records.map((r) => r.token),
    toExpoMessage(payload)
  );
}
