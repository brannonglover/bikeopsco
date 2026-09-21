import "server-only";

import type { AiAssistantState, MessageSender } from "@prisma/client";
import { prisma } from "@/lib/db";
import { publishChatEvent } from "@/lib/realtime/publish-chat-event";
import { deliverStaffMessage } from "@/lib/chat/send-staff-message";
import { sendPushToAllStaff } from "@/lib/push";
import { ASSISTANT_MODEL, getAnthropicClient } from "@/lib/ai/client";
import {
  ASSISTANT_OUTPUT_SCHEMA,
  buildSystemPrompt,
  type AssistantTurn,
  type AssistantTurnStatus,
} from "@/lib/ai/prompt";

/**
 * Runs one turn of the AI assistant in a customer conversation.
 *
 * Every entry point lands in `runAssistantTurn`, which is the only place that
 * decides whether the assistant is allowed to speak. Callers are webhooks, so
 * it never throws: a failed turn leaves the thread exactly as a shop with the
 * feature switched off would have left it, waiting for a person.
 */

/** Thread history handed to the model. Long enough to hold a full intake chat. */
const HISTORY_LIMIT = 30;
/** Hard ceiling on what goes out over SMS, whatever the model returns. */
const MAX_REPLY_CHARS = 320;

export type AssistantTrigger =
  /** The customer left a voicemail. */
  | "voicemail"
  /** The customer called and hung up without leaving one. */
  | "missed_call"
  /** The customer sent a text. */
  | "inbound_sms";

type TurnOutcome =
  | { ok: true; state: AiAssistantState }
  | { ok: false; reason: string };

/** Reads what a customer says as text; attachments are noted, not described. */
function describeMessage(message: {
  sender: MessageSender;
  body: string | null;
  attachments: { mimeType: string }[];
}): string {
  const text = message.body?.trim();
  if (text) return text;
  if (message.attachments.length > 0) return "[sent a photo or video]";
  return "";
}

function clampReply(reply: string): string {
  const trimmed = reply.trim().replace(/\s+/g, " ");
  if (trimmed.length <= MAX_REPLY_CHARS) return trimmed;
  // Cut at a sentence end where one is close to the limit, so a truncated
  // text doesn't read as though the shop lost signal mid-word.
  const head = trimmed.slice(0, MAX_REPLY_CHARS);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (lastStop > MAX_REPLY_CHARS * 0.6) return head.slice(0, lastStop + 1);
  return `${head.slice(0, MAX_REPLY_CHARS - 1).trimEnd()}…`;
}

function stateForStatus(status: AssistantTurnStatus): AiAssistantState {
  switch (status) {
    case "gathering":
      return "ACTIVE";
    case "ready":
    case "out_of_scope":
      return "DONE";
    case "needs_human":
      return "PAUSED";
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value.trim());
}

/** Parses and sanity-checks the model's structured output. */
function parseTurn(raw: string): AssistantTurn | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const value = parsed as Record<string, unknown>;
  const reply = typeof value.reply === "string" ? value.reply.trim() : "";
  if (!reply) return null;

  const status =
    value.status === "ready" ||
    value.status === "out_of_scope" ||
    value.status === "needs_human"
      ? value.status
      : "gathering";

  const asName = (input: unknown): string | null => {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    // A name long enough to be a sentence is the model narrating, not a name.
    return trimmed && trimmed.length <= 60 ? trimmed : null;
  };

  const email =
    typeof value.email === "string" && isValidEmail(value.email)
      ? value.email.trim().toLowerCase()
      : null;

  const services = Array.isArray(value.services)
    ? value.services
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  return {
    reply,
    firstName: asName(value.firstName),
    lastName: asName(value.lastName),
    email,
    services,
    status,
    summary: typeof value.summary === "string" ? value.summary.trim() : "",
  };
}

/**
 * Whether the assistant may speak in this thread right now.
 *
 * PAUSED and DONE mean a person owns the conversation — only staff move it out
 * of those, so nothing here does. An OFF thread can be picked up, but only when
 * no one from the shop has already replied: the assistant must never talk over
 * a conversation a person has started.
 */
async function assistantMaySpeak(conversation: {
  id: string;
  aiAssistantState: AiAssistantState;
}): Promise<boolean> {
  if (conversation.aiAssistantState === "ACTIVE") return true;
  if (conversation.aiAssistantState !== "OFF") return false;

  const humanReply = await prisma.message.findFirst({
    where: {
      conversationId: conversation.id,
      sender: "STAFF",
      aiGenerated: false,
    },
    select: { id: true },
  });
  return !humanReply;
}

async function notifyStaffOfHandoff({
  shopId,
  conversationId,
  customerName,
  turn,
}: {
  shopId: string;
  conversationId: string;
  customerName: string;
  turn: AssistantTurn;
}): Promise<void> {
  const title =
    turn.status === "out_of_scope"
      ? `Not a bike job — ${customerName}`
      : turn.status === "needs_human"
        ? `Assistant needs you — ${customerName}`
        : `Ready for you — ${customerName}`;

  await sendPushToAllStaff(shopId, {
    title,
    body: turn.summary || "The assistant has handed this conversation over.",
    data: { type: "new_message", conversationId },
  }).catch((error) =>
    console.error("[ai] staff handoff push failed:", error)
  );
}

/**
 * Writes back what the customer told the assistant.
 *
 * Only ever fills blanks. A name or email already on the record was put there
 * by a person or by the customer themselves, and is not overwritten by
 * something read out of a text message.
 */
async function applyCollectedContact({
  shopId,
  customer,
  turn,
}: {
  shopId: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    provisional: boolean;
  };
  turn: AssistantTurn;
}): Promise<void> {
  const data: { firstName?: string; lastName?: string; email?: string } = {};

  // A provisional contact's firstName is the formatted phone number standing in
  // for a real one, so a name from the conversation is an improvement, not an
  // overwrite. A named contact is left alone.
  //
  // The contact stays provisional either way. What the assistant read out of a
  // text message is a suggestion, and clearing the flag would retire the
  // "Create contact" step where staff confirm it.
  if (turn.firstName && customer.provisional) {
    data.firstName = turn.firstName;
  }
  if (turn.lastName && !customer.lastName) data.lastName = turn.lastName;
  if (turn.email && !customer.email) data.email = turn.email;

  if (Object.keys(data).length === 0) return;

  await prisma.customer
    .updateMany({ where: { id: customer.id, shopId }, data })
    .catch((error) => console.error("[ai] contact update failed:", error));
}

/** Builds the staff-facing summary line stored on the conversation. */
function buildSummary(turn: AssistantTurn): string {
  const parts: string[] = [];
  const name = [turn.firstName, turn.lastName].filter(Boolean).join(" ");
  if (name) parts.push(name);
  if (turn.email) parts.push(turn.email);
  if (turn.services.length) parts.push(`wants: ${turn.services.join(", ")}`);
  const collected = parts.join(" · ");
  if (turn.summary && collected) return `${turn.summary} (${collected})`;
  return turn.summary || collected || "Handed over to staff.";
}

export async function runAssistantTurn({
  shopId,
  conversationId,
  trigger,
  /** Voicemail transcript, when this turn is opening the conversation. */
  voicemailTranscript,
}: {
  shopId: string;
  conversationId: string;
  trigger: AssistantTrigger;
  voicemailTranscript?: string | null;
}): Promise<TurnOutcome> {
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { shopId },
      select: {
        aiAssistantEnabled: true,
        aiAssistantKnowledge: true,
        chatEnabled: true,
      },
    });
    if (!settings?.aiAssistantEnabled) return { ok: false, reason: "disabled" };
    if (!settings.chatEnabled) return { ok: false, reason: "chat-disabled" };

    const client = getAnthropicClient();
    if (!client) {
      console.warn("[ai] ANTHROPIC_API_KEY is not set — assistant turn skipped");
      return { ok: false, reason: "no-api-key" };
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, shopId },
      select: {
        id: true,
        aiAssistantState: true,
        archived: true,
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            smsConsent: true,
            smsConsentUpdatedAt: true,
            provisional: true,
          },
        },
      },
    });
    if (!conversation) return { ok: false, reason: "no-conversation" };
    if (conversation.archived) return { ok: false, reason: "archived" };
    if (!(await assistantMaySpeak(conversation))) {
      return { ok: false, reason: `state:${conversation.aiAssistantState}` };
    }

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, name: true, subdomain: true },
    });
    if (!shop) return { ok: false, reason: "no-shop" };

    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        sender: true,
        body: true,
        createdAt: true,
        attachments: { select: { mimeType: true } },
      },
    });

    const turns = history
      .slice()
      .reverse()
      .map((message) => ({
        // SYSTEM notices are shop-authored status updates, so they read as the
        // shop's own side of the thread rather than as something to reply to.
        role: message.sender === "CUSTOMER" ? ("user" as const) : ("assistant" as const),
        content: describeMessage(message),
      }))
      .filter((turn) => turn.content);

    // The model needs an opening user turn. On a missed call there is no
    // customer message at all, so the call itself is stated as the prompt.
    const opener =
      trigger === "voicemail"
        ? voicemailTranscript?.trim()
          ? `[The customer just called and left this voicemail: "${voicemailTranscript.trim()}"]`
          : "[The customer just called and left a voicemail, but there is no transcript of it.]"
        : trigger === "missed_call"
          ? "[The customer just called the shop and hung up before leaving a voicemail.]"
          : null;

    const messages: { role: "user" | "assistant"; content: string }[] = [];
    if (opener) messages.push({ role: "user", content: opener });
    messages.push(...turns);

    // A thread whose last word is the shop's has nothing to answer. This is
    // what stops the assistant talking to itself if a webhook fires twice.
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return { ok: false, reason: "nothing-to-answer" };
    }

    const knownName =
      conversation.customer.provisional
        ? null
        : [conversation.customer.firstName, conversation.customer.lastName]
            .filter(Boolean)
            .join(" ") || null;

    const response = await client.messages.create({
      model: ASSISTANT_MODEL,
      // Room for the model's own reasoning plus the JSON payload; the reply
      // itself is two sentences, but a tight ceiling here truncates the JSON
      // and costs the whole turn.
      max_tokens: 4096,
      system: buildSystemPrompt({
        shopName: shop.name,
        knowledge: settings.aiAssistantKnowledge,
        knownName,
        knownEmail: conversation.customer.email,
      }),
      messages,
      output_config: {
        // A text message back to a waiting customer is not a reasoning task,
        // and the whole turn has to finish inside Twilio's webhook window.
        effort: "low",
        format: { type: "json_schema", schema: ASSISTANT_OUTPUT_SCHEMA },
      },
    });

    if (response.stop_reason === "refusal") {
      console.warn("[ai] assistant turn refused:", response.stop_details);
      return { ok: false, reason: "refusal" };
    }

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");

    const turn = parseTurn(text);
    if (!turn) {
      console.error("[ai] assistant returned unusable output:", text.slice(0, 500));
      return { ok: false, reason: "unparseable" };
    }

    const nextState = stateForStatus(turn.status);
    const reply = clampReply(turn.reply);

    const message = await prisma.message.create({
      data: {
        shopId,
        conversationId: conversation.id,
        // Sent as STAFF so the customer hears one voice from the shop and the
        // existing delivery path applies unchanged; aiGenerated is what tells
        // staff — and the auto-pause check — that a person did not write it.
        sender: "STAFF",
        body: reply,
        aiGenerated: true,
      },
      select: { id: true, conversationId: true, body: true },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        updatedAt: new Date(),
        aiAssistantState: nextState,
        aiAssistantSummary:
          nextState === "ACTIVE" ? null : buildSummary(turn),
      },
    });

    await publishChatEvent("chat:message", {
      shopId,
      conversationId: conversation.id,
      messageId: message.id,
    });

    await applyCollectedContact({
      shopId,
      customer: conversation.customer,
      turn,
    });

    await deliverStaffMessage({
      shop,
      customer: conversation.customer,
      message: { ...message, attachments: [] },
      // A caller who reached voicemail has no open thread for the usual chat
      // access check to find — the call they just placed is the thread. Their
      // consent is still checked inside deliverStaffMessage.
      bypassChatAccessGate: trigger !== "inbound_sms",
    });

    if (nextState !== "ACTIVE") {
      const customerName =
        [conversation.customer.firstName, conversation.customer.lastName]
          .filter(Boolean)
          .join(" ") || "a customer";
      await notifyStaffOfHandoff({
        shopId,
        conversationId: conversation.id,
        customerName,
        turn,
      });
    }

    return { ok: true, state: nextState };
  } catch (error) {
    // Webhooks call this; a thrown error here would fail a Twilio callback and
    // cost the shop the call log, which is worse than a missing reply.
    console.error("[ai] assistant turn failed:", {
      shopId,
      conversationId,
      trigger,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "error" };
  }
}
