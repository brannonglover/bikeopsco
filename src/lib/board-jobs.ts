import { Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withPrismaRetry } from "@/lib/prisma-retry";
import { computeJobSubtotal, computeTotalPaid, getJobPaymentSummary } from "@/lib/job-payments";
import { getEffectiveEmailUpdatesConsent, getEffectiveSmsConsent } from "@/lib/sms-consent";
import type { Job } from "@/lib/types";

export const BOARD_JOBS_QUERY_KEY = ["jobs", "board"] as const;

export const EMPTY_BOARD_JOBS: Job[] = [];

/** Prisma select for the staff kanban / archive board payload. */
export const boardJobSelect = {
  id: true,
  bikeMake: true,
  bikeModel: true,
  stage: true,
  deliveryType: true,
  dropOffDate: true,
  receivedAt: true,
  pickupDate: true,
  collectionAddress: true,
  collectionWindowStart: true,
  collectionWindowEnd: true,
  collectionReturnWindowStart: true,
  collectionReturnWindowEnd: true,
  customerId: true,
  customerNotes: true,
  completedAt: true,
  archivedAt: true,
  columnSortOrder: true,
  paymentStatus: true,
  workingOnJobBikeId: true,
  mechanicId: true,
  createdAt: true,
  updatedAt: true,
  mechanic: {
    select: {
      id: true,
      fullName: true,
      imageUrl: true,
    },
  },
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      emailUpdatesConsent: true,
      smsConsent: true,
      address: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  jobBikes: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      jobId: true,
      make: true,
      model: true,
      bikeType: true,
      nickname: true,
      imageUrl: true,
      bikeId: true,
      sortOrder: true,
      completedAt: true,
      waitingOnPartsAt: true,
      bike: {
        select: {
          make: true,
          model: true,
          bikeType: true,
          nickname: true,
          imageUrl: true,
        },
      },
    },
  },
  jobServices: {
    select: {
      id: true,
      serviceId: true,
      customServiceName: true,
      quantity: true,
      unitPrice: true,
      notes: true,
      jobBikeId: true,
      service: { select: { name: true, price: true } },
      jobBike: {
        select: {
          id: true,
          make: true,
          model: true,
          nickname: true,
        },
      },
    },
  },
  jobProducts: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      notes: true,
      jobBikeId: true,
      product: { select: { name: true, price: true } },
      jobBike: {
        select: {
          id: true,
          make: true,
          model: true,
          nickname: true,
        },
      },
    },
  },
  payments: {
    select: {
      amount: true,
      status: true,
      stripePaymentIntentId: true,
      paymentMethod: true,
    },
  },
} as const;

type BoardJobsOptions = {
  archived?: boolean;
};

function boardJobsWhere(shopId: string, opts?: BoardJobsOptions) {
  const where: Record<string, unknown> = { shopId };
  const andClauses: Record<string, unknown>[] = [];

  if (opts?.archived) {
    andClauses.push({
      OR: [{ archivedAt: { not: null } }, { stage: Stage.CANCELLED }],
    });
  } else {
    where.archivedAt = null;
    andClauses.push({ stage: { not: Stage.CANCELLED } });
  }

  if (andClauses.length > 0) {
    where.AND = andClauses;
  }

  return where;
}

function boardJobsOrderBy(archived?: boolean) {
  return archived
    ? { updatedAt: "desc" as const }
    : [
        { columnSortOrder: { sort: "asc" as const, nulls: "last" as const } },
        { dropOffDate: { sort: "asc" as const, nulls: "last" as const } },
        { createdAt: "asc" as const },
      ];
}

function mapBoardJobs(
  jobs: Array<{
    jobServices: Parameters<typeof computeJobSubtotal>[0]["jobServices"];
    jobProducts: Parameters<typeof computeJobSubtotal>[0]["jobProducts"];
    payments: Parameters<typeof computeTotalPaid>[0];
    paymentStatus: Parameters<typeof getJobPaymentSummary>[0]["currentStatus"];
    customer: {
      email: string | null;
      phone: string | null;
      emailUpdatesConsent?: boolean | null;
      smsConsent: boolean;
      smsConsentUpdatedAt?: Date | string | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  }>
) {
  return jobs.map((job) => {
    const subtotal = computeJobSubtotal({
      jobServices: job.jobServices,
      jobProducts: job.jobProducts,
    });
    const totalPaid = computeTotalPaid(job.payments);
    const paymentSummary = getJobPaymentSummary({
      currentStatus: job.paymentStatus,
      subtotal,
      totalPaid,
    });
    const { payments, ...rest } = job;
    void payments;
    return {
      ...rest,
      customer: job.customer
        ? {
            ...job.customer,
            emailUpdatesConsent: getEffectiveEmailUpdatesConsent(job.customer),
            smsConsent: getEffectiveSmsConsent({
              phone: job.customer.phone,
              smsConsent: job.customer.smsConsent,
              smsConsentUpdatedAt: job.customer.smsConsentUpdatedAt ?? null,
            }),
          }
        : null,
      paymentStatus: paymentSummary.paymentStatus,
      totalPaid,
    };
  });
}

/** Active (or archived) board jobs for a shop — same shape as `GET /api/jobs?view=board`. */
export async function getBoardJobsForShop(
  shopId: string,
  opts?: BoardJobsOptions
): Promise<Job[]> {
  const jobs = await withPrismaRetry(() =>
    prisma.job.findMany({
      where: boardJobsWhere(shopId, opts),
      select: boardJobSelect,
      orderBy: boardJobsOrderBy(opts?.archived),
    })
  );

  // Match NextResponse.json date serialization for client props / React Query cache.
  return JSON.parse(JSON.stringify(mapBoardJobs(jobs))) as Job[];
}

export async function fetchBoardJobsClient(): Promise<Job[]> {
  const res = await fetch("/api/jobs?view=board", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load jobs (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data) ? (data as Job[]) : EMPTY_BOARD_JOBS;
}
