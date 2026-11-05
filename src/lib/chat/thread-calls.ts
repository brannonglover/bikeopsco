import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ThreadCall } from "@/lib/types";

/**
 * Phone calls shown in a staff chat thread, alongside its messages.
 *
 * A call's push sends staff to the caller's thread, so what the call was about
 * has to be readable there: the AI assistant's summary and transcript, a
 * voicemail's transcription, or just that a call happened. Calls are matched
 * by contact as well as by thread, because a known caller's call is only ever
 * linked to a thread when someone opens one for it.
 */

const THREAD_CALL_LIMIT = 30;

export const threadCallSelect = {
  id: true,
  direction: true,
  status: true,
  fromNumber: true,
  toNumber: true,
  startedAt: true,
  answeredAt: true,
  endedAt: true,
  durationSeconds: true,
  recordingUrl: true,
  recordingStatus: true,
  transcriptionText: true,
  transcriptionStatus: true,
  aiAnsweredAt: true,
  aiSummary: true,
  aiTranscript: true,
  createdAt: true,
} as const satisfies Prisma.CallSelect;

type ThreadCallRow = Prisma.CallGetPayload<{ select: typeof threadCallSelect }>;

export function serializeThreadCall(call: ThreadCallRow): ThreadCall {
  return {
    id: call.id,
    direction: call.direction,
    status: call.status,
    fromNumber: call.fromNumber,
    toNumber: call.toNumber,
    startedAt: call.startedAt?.toISOString() ?? null,
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    durationSeconds: call.durationSeconds,
    // The Twilio media URL plays for anyone holding it, so clients only learn
    // that a recording exists and stream it through /api/calls/[id]/recording.
    hasRecording: Boolean(call.recordingUrl),
    recordingStatus: call.recordingStatus,
    transcriptionText: call.transcriptionText,
    transcriptionStatus: call.transcriptionStatus,
    aiAnswered: call.aiAnsweredAt !== null,
    aiSummary: call.aiSummary,
    aiTranscript: call.aiTranscript,
    createdAt: call.createdAt.toISOString(),
  };
}

function threadCallWhere(
  shopId: string,
  conversationId: string,
  customerId: string
): Prisma.CallWhereInput {
  return { shopId, OR: [{ conversationId }, { customerId }] };
}

/** The thread's most recent calls, oldest first, ready to interleave with messages. */
export async function loadThreadCalls(
  shopId: string,
  conversationId: string,
  customerId: string
): Promise<ThreadCall[]> {
  const calls = await prisma.call.findMany({
    where: threadCallWhere(shopId, conversationId, customerId),
    orderBy: { createdAt: "desc" },
    take: THREAD_CALL_LIMIT,
    select: threadCallSelect,
  });
  return calls.reverse().map(serializeThreadCall);
}

/**
 * Changes whenever a thread's calls do: a new call, a voicemail transcription
 * landing, or the assistant's summary being filed after the caller hangs up.
 */
export async function getThreadCallsFingerprint(
  shopId: string,
  conversationId: string
) {
  const stats = await prisma.call.aggregate({
    where: {
      shopId,
      OR: [
        { conversationId },
        { customer: { conversations: { some: { id: conversationId, shopId } } } },
      ],
    },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  return { callCount: stats._count._all, lastCallUpdateAt: stats._max.updatedAt };
}
