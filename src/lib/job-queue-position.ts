import type { PrismaClient, Stage } from "@prisma/client";

export type JobQueueStage = "BOOKED_IN" | "RECEIVED";

export type JobQueueInfo = {
  stage: JobQueueStage;
  position: number;
  queueSize: number;
  aheadCount: number;
  label: string;
};

const QUEUE_STAGES = new Set<Stage>(["BOOKED_IN", "RECEIVED"]);

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formatJobQueueLabel(
  stage: JobQueueStage,
  position: number,
  queueSize: number
): string {
  if (queueSize <= 1) {
    return stage === "BOOKED_IN"
      ? "You're the only booking in the queue."
      : "You're the only bike waiting for service.";
  }

  if (position === 1) {
    return stage === "BOOKED_IN"
      ? `You're next in the booking queue (${queueSize} bookings total).`
      : `You're next in the service queue (${queueSize} bikes total).`;
  }

  const ahead = position - 1;
  const aheadWord = ahead === 1 ? "bike" : "bikes";
  const bookingWord = ahead === 1 ? "booking" : "bookings";

  if (stage === "BOOKED_IN") {
    return `You're ${ordinal(position)} in the booking queue — ${ahead} ${bookingWord} ahead of you.`;
  }

  return `You're ${ordinal(position)} in the service queue — ${ahead} ${aheadWord} ahead of you.`;
}

type QueueJobRow = {
  id: string;
  stage: Stage;
  createdAt: Date;
  receivedAt: Date | null;
};

function compareQueueJobs(a: QueueJobRow, b: QueueJobRow, stage: JobQueueStage): number {
  if (stage === "BOOKED_IN") {
    return a.createdAt.getTime() - b.createdAt.getTime();
  }

  const aReceived = a.receivedAt?.getTime() ?? a.createdAt.getTime();
  const bReceived = b.receivedAt?.getTime() ?? b.createdAt.getTime();
  if (aReceived !== bReceived) return aReceived - bReceived;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export async function getJobQueueInfo(
  prisma: PrismaClient,
  shopId: string,
  job: { id: string; stage: Stage; createdAt: Date; receivedAt: Date | null }
): Promise<JobQueueInfo | null> {
  if (!QUEUE_STAGES.has(job.stage)) return null;

  const stage = job.stage as JobQueueStage;

  const peers = await prisma.job.findMany({
    where: {
      shopId,
      stage,
      archivedAt: null,
    },
    select: {
      id: true,
      stage: true,
      createdAt: true,
      receivedAt: true,
    },
  });

  const sorted = [...peers].sort((a, b) => compareQueueJobs(a, b, stage));
  const position = sorted.findIndex((peer) => peer.id === job.id) + 1;
  if (position <= 0) return null;

  const queueSize = sorted.length;

  return {
    stage,
    position,
    queueSize,
    aheadCount: Math.max(0, position - 1),
    label: formatJobQueueLabel(stage, position, queueSize),
  };
}
