import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findOrCreateProvisionalCustomer } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { formatPhoneDisplay } from "@/lib/phone";
import { sendPushToAllStaff } from "@/lib/push";
import { ASSISTANT_MODEL, getAnthropicClient } from "@/lib/ai/client";
import { applyCollectedContact } from "@/lib/ai/assistant";
import { ASSISTANT_OUTPUT_SCHEMA } from "@/lib/ai/prompt";
import { verifyCallRef } from "@/lib/ai/voice-agent";
import {
  COLLECTED_CONTEXT_VERSION,
  EMPTY_COLLECTED_CONTEXT,
  mergeCollectedContext,
  parseCollectedContext,
  type CollectedContext,
} from "@/lib/conversation-context/ai-collected";

/**
 * Files a finished phone-assistant conversation with its call.
 *
 * ElevenLabs posts the transcript once the conversation ends. This turns it
 * into what staff actually act on: a one-line summary on the call, the
 * caller's details folded into their contact and thread the same way the text
 * assistant does it, and a push so the shop knows a call came in at all —
 * someone who never answers the phone otherwise never hears about it.
 *
 * Runs after the webhook has already said 200, so it never throws.
 */

type TranscriptTurn = { role?: unknown; message?: unknown };

export type PostCallEvent = {
  type?: string;
  data?: {
    conversation_id?: string;
    transcript?: TranscriptTurn[];
    analysis?: { transcript_summary?: string | null } | null;
    conversation_initiation_client_data?: {
      dynamic_variables?: Record<string, unknown> | null;
    } | null;
  };
};

type CallAnalysis = {
  summary: string;
  needsFollowUp: boolean;
  callbackNumber: string | null;
  collected: CollectedContext;
};

const COLLECTED_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "bikes",
  "symptoms",
  "customerSuspicions",
  "requestedServices",
  "availability",
] as const;

const CALL_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "needsFollowUp", "callbackNumber", ...COLLECTED_FIELDS],
  properties: {
    summary: {
      type: "string",
      description:
        "One or two plain sentences for the shop's staff: what the caller wanted, and anything they are now waiting on. No preamble.",
    },
    needsFollowUp: {
      type: "boolean",
      description:
        "True when the caller is waiting to hear back from the shop: they left a message, asked for a call back, want to book or drop off a bike, or asked something the assistant could not settle. False only when the call was fully handled, such as a question about opening hours that got its answer.",
    },
    callbackNumber: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "A different phone number the caller asked to be reached on, exactly as they said it. Null if they gave none.",
    },
    ...Object.fromEntries(
      COLLECTED_FIELDS.map((field) => [field, ASSISTANT_OUTPUT_SCHEMA.properties[field]])
    ),
  },
} as const;

const ANALYSIS_SYSTEM_PROMPT = `You read transcripts of phone calls that a bicycle repair shop's AI assistant answered, and write them up for the shop's staff.

Report only what the caller actually said. Never guess a name from anything else, never complete a partial email address, and leave a field null or empty if it wasn't given. Speech recognition garbles things, so if an email address or name is too mangled to trust, leave it out.

Keep the caller's symptoms, their own guesses at the cause, and the work they actually asked for apart: only a request is something the shop has been asked to do.`;

function transcriptText(turns: TranscriptTurn[]): string {
  return turns
    .map((turn) => {
      const message = typeof turn.message === "string" ? turn.message.trim() : "";
      if (!message) return null;
      return `${turn.role === "user" ? "Caller" : "Assistant"}: ${message}`;
    })
    .filter(Boolean)
    .join("\n");
}

async function analyzeTranscript(
  transcript: string,
  fallbackSummary: string | null
): Promise<CallAnalysis> {
  // Without a model, the call is still filed — on ElevenLabs' own summary,
  // and assumed to need a look, since nothing has read it to say otherwise.
  const fallback: CallAnalysis = {
    summary: fallbackSummary?.trim() || "The assistant answered a call.",
    needsFollowUp: true,
    callbackNumber: null,
    collected: EMPTY_COLLECTED_CONTEXT,
  };

  const client = getAnthropicClient();
  if (!client) return fallback;

  try {
    const response = await client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 4096,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `<transcript>\n${transcript}\n</transcript>` }],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: CALL_ANALYSIS_SCHEMA },
      },
    });
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    const value = JSON.parse(text) as Record<string, unknown>;

    const collected =
      parseCollectedContext({
        version: COLLECTED_CONTEXT_VERSION,
        identity: {
          firstName: value.firstName,
          lastName: value.lastName,
          email: value.email,
        },
        bikes: value.bikes,
        service: {
          symptoms: value.symptoms,
          customerSuspicions: value.customerSuspicions,
          requestedServices: value.requestedServices,
        },
        scheduling: { availability: value.availability },
      }) ?? EMPTY_COLLECTED_CONTEXT;

    return {
      summary:
        typeof value.summary === "string" && value.summary.trim()
          ? value.summary.trim()
          : fallback.summary,
      needsFollowUp: value.needsFollowUp !== false,
      callbackNumber:
        typeof value.callbackNumber === "string" && value.callbackNumber.trim()
          ? value.callbackNumber.trim()
          : null,
      collected,
    };
  } catch (error) {
    console.error("[voice-agent] transcript analysis failed:", error);
    return fallback;
  }
}

function appendSection(existing: string | null, next: string): string {
  return existing?.trim() ? `${existing.trim()}\n\n${next}` : next;
}

export async function fileVoiceAgentConversation(event: PostCallEvent): Promise<void> {
  const data = event.data;
  const conversationId = data?.conversation_id ?? null;
  try {
    const rawRef = data?.conversation_initiation_client_data?.dynamic_variables?.bikeops_call_ref;
    const ref = verifyCallRef(typeof rawRef === "string" ? rawRef : null);
    if (!ref || !conversationId) {
      console.warn("[voice-agent] post-call event without a usable call ref", { conversationId });
      return;
    }

    const call = await prisma.call.findFirst({
      where: { id: ref.callId, shopId: ref.shopId },
      select: {
        id: true,
        shopId: true,
        fromNumber: true,
        customerId: true,
        conversationId: true,
        aiConversationId: true,
        aiSummary: true,
        aiTranscript: true,
      },
    });
    if (!call) return;
    // A redelivered webhook for the stretch already filed.
    if (call.aiConversationId === conversationId) return;

    const turns = Array.isArray(data?.transcript) ? data.transcript : [];
    const transcript = transcriptText(turns);
    const callerSpoke = turns.some(
      (turn) => turn.role === "user" && typeof turn.message === "string" && turn.message.trim()
    );

    if (!callerSpoke) {
      // Rang off during the greeting, or the line was silent. Kept on the
      // call for the record, but there is nothing for staff to act on.
      await prisma.call.update({
        where: { id: call.id },
        data: {
          aiConversationId: conversationId,
          aiTranscript: transcript ? appendSection(call.aiTranscript, transcript) : call.aiTranscript,
        },
      });
      return;
    }

    const analysis = await analyzeTranscript(
      transcript,
      data?.analysis?.transcript_summary ?? null
    );
    const summary = analysis.callbackNumber
      ? `${analysis.summary} Call back on ${analysis.callbackNumber}.`
      : analysis.summary;

    // Same as a texter: an unknown caller gets a provisional contact so the
    // call lands in one inbox thread. No SMS consent is recorded — nobody is
    // texting them, and a phone call is not consent to be texted.
    const customerId =
      call.customerId ??
      (await findOrCreateProvisionalCustomer(call.shopId, call.fromNumber, null)).customerId;
    const conversation = await findOrCreateGeneralConversation(call.shopId, customerId);

    await prisma.call.update({
      where: { id: call.id },
      data: {
        customerId,
        conversationId: conversation.id,
        aiConversationId: conversationId,
        aiSummary: appendSection(call.aiSummary, summary),
        aiTranscript: appendSection(call.aiTranscript, transcript),
      },
    });

    const thread = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: {
        aiCollectedContext: true,
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            provisional: true,
          },
        },
      },
    });
    if (!thread) return;

    const collected = mergeCollectedContext(
      parseCollectedContext(thread.aiCollectedContext),
      analysis.collected
    );
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        updatedAt: new Date(),
        aiCollectedContext: collected as unknown as Prisma.InputJsonObject,
        // Waiting on the shop is a handoff, shown to staff as the note that
        // opens with the thread — and it keeps the text assistant from
        // starting its own intake on a caller a person now owes a reply.
        ...(analysis.needsFollowUp
          ? { aiAssistantState: "DONE" as const, aiAssistantSummary: `Phone call: ${summary}` }
          : {}),
      },
    });
    await applyCollectedContact({
      shopId: call.shopId,
      customer: thread.customer,
      identity: collected.identity,
    });

    const name =
      [collected.identity.firstName, collected.identity.lastName].filter(Boolean).join(" ") ||
      (thread.customer.provisional
        ? null
        : [thread.customer.firstName, thread.customer.lastName].filter(Boolean).join(" ")) ||
      formatPhoneDisplay(call.fromNumber);

    await sendPushToAllStaff(call.shopId, {
      title: analysis.needsFollowUp
        ? `Call needs you — ${name}`
        : `Assistant took a call — ${name}`,
      body: summary,
      data: { type: "new_message", conversationId: conversation.id, callId: call.id },
    }).catch((error) => console.error("[voice-agent] post-call push failed:", error));
  } catch (error) {
    console.error("[voice-agent] could not file conversation:", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
