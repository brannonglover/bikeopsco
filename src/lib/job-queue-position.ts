import type { PrismaClient, Stage } from "@prisma/client";

export type JobQueueStage = "RECEIVED";

export type JobQueueInfo = {
  stage: JobQueueStage;
  position: number;
  queueSize: number;
  aheadCount: number;
  label: string;
};

const QUEUE_STAGES = new Set<Stage>(["RECEIVED"]);

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

export function formatJobQueueLabel(position: number, queueSize: number): string {
  if (queueSize <= 1) {
    return "You're the only bike waiting for service.";
  }

  if (position === 1) {
    return `You're next in the service queue (${queueSize} bikes total).`;
  }

  const ahead = position - 1;
  const aheadWord = ahead === 1 ? "bike" : "bikes";

  return `You're ${ordinal(position)} in the service queue — ${ahead} ${aheadWord} ahead of you.`;
}

type QueueJobRow = {
  id: string;
  createdAt: Date;
  receivedAt: Date | null;
};

function compareQueueJobs(a: QueueJobRow, b: QueueJobRow): number {
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

  const peers = await prisma.job.findMany({
    where: {
      shopId,
      stage: "RECEIVED",
      archivedAt: null,
    },
    select: {
      id: true,
      createdAt: true,
      receivedAt: true,
    },
  });

  const sorted = [...peers].sort(compareQueueJobs);
  const position = sorted.findIndex((peer) => peer.id === job.id) + 1;
  if (position <= 0) return null;

  const queueSize = sorted.length;

  return {
    stage: "RECEIVED",
    position,
    queueSize,
    aheadCount: Math.max(0, position - 1),
    label: formatJobQueueLabel(position, queueSize),
  };
}
