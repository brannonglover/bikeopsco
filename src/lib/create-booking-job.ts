/**
 * Turning a public booking request into a job.
 *
 * Two callers need this and must not drift apart: `/api/widget/book`, when a
 * submission is accepted straight away, and the booking review screen, when
 * staff release a booking the spam scorer held back. A released false positive
 * has to end up as exactly the job it would have been had it never been held,
 * which is only reliably true if both paths run the same code.
 */
import type { Prisma } from "@prisma/client";
import { Stage } from "@prisma/client";
import { buildSmsConsentOptInUpdate } from "@/lib/sms-consent";
import { syncCollectionJobService } from "@/lib/collection-fee";

export type BookingJobBike = {
  make: string;
  model?: string | null;
  bikeType?: "REGULAR" | "E_BIKE" | null;
};

export type BookingJobInput = {
  shopId: string;
  /** Existing customer to reuse, when the booking form identified one. */
  customerId?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  /** Already normalized to E.164 where possible. */
  phone: string | null;
  address?: string | null;
  smsConsent?: boolean;
  deliveryType: "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE";
  dropOffDate: Date | null;
  pickupDate: Date | null;
  collectionAddress?: string | null;
  collectionWindowStart?: string | null;
  collectionWindowEnd?: string | null;
  customerNotes?: string | null;
  serviceIds: string[];
  bikes: BookingJobBike[];
  collectionServiceEnabled: boolean;
};

type TransactionClient = Prisma.TransactionClient;

/**
 * Create the job, its bikes and its services inside an existing transaction.
 *
 * Returns the job with the relations the notification emails read, or null in
 * the (not expected) case where it cannot be read back.
 */
export async function createBookingJob(
  tx: TransactionClient,
  input: BookingJobInput
) {
  const { shopId } = input;
  const emailNormalized = input.email.trim().toLowerCase();

  let customer = null;

  if (input.customerId) {
    customer = await tx.customer.findFirst({
      where: { id: input.customerId, shopId },
    });
  }

  if (!customer) {
    customer = await tx.customer.findFirst({
      where: {
        shopId,
        email: { equals: emailNormalized, mode: "insensitive" },
      },
    });
  }

  const consentUpdate = buildSmsConsentOptInUpdate(
    Boolean(input.smsConsent),
    "BOOKING_FORM"
  );

  if (!customer) {
    customer = await tx.customer.create({
      data: {
        shopId,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email: input.email.trim(),
        phone: input.phone,
        ...consentUpdate,
        address: input.address ?? null,
      },
    });
  } else {
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        phone: input.phone,
        ...consentUpdate,
        address: input.address ?? customer.address,
      },
    });
  }

  // Job-level summary fields: the first bike when there is only one, otherwise
  // a count, since the individual bikes live on JobBike rows.
  const bikeMakeSummary =
    input.bikes.length === 1 ? input.bikes[0].make.trim() : "Multiple";
  const bikeModelSummary =
    input.bikes.length === 1
      ? (input.bikes[0].model?.trim() ?? "")
      : `${input.bikes.length} bikes`;

  const newJob = await tx.job.create({
    data: {
      shopId,
      stage: Stage.PENDING_APPROVAL,
      bikeMake: bikeMakeSummary,
      bikeModel: bikeModelSummary,
      customerId: customer.id,
      deliveryType: input.deliveryType,
      dropOffDate: input.dropOffDate,
      pickupDate: input.pickupDate,
      collectionAddress: input.collectionAddress ?? null,
      collectionWindowStart: input.collectionWindowStart ?? null,
      collectionWindowEnd: input.collectionWindowEnd ?? null,
      customerNotes: input.customerNotes ?? null,
    },
  });

  // Find-or-create the customer's Bike record per submitted bike, then attach a
  // JobBike to this job.
  for (let i = 0; i < input.bikes.length; i++) {
    const b = input.bikes[i];
    const makeNormalized = b.make.trim();
    const modelNormalized = b.model?.trim() || null;

    let bike = await tx.bike.findFirst({
      where: {
        shopId,
        customerId: customer.id,
        make: { equals: makeNormalized, mode: "insensitive" },
        model: modelNormalized
          ? { equals: modelNormalized, mode: "insensitive" }
          : null,
      },
    });
    if (!bike) {
      bike = await tx.bike.create({
        data: {
          shopId,
          customerId: customer.id,
          make: makeNormalized,
          model: modelNormalized,
          bikeType: b.bikeType ?? null,
        },
      });
    }

    await tx.jobBike.create({
      data: {
        shopId,
        jobId: newJob.id,
        make: makeNormalized,
        model: modelNormalized,
        sortOrder: i,
        bikeType: b.bikeType ?? null,
        bikeId: bike.id,
      },
    });
  }

  if (input.serviceIds.length > 0) {
    const services = await tx.service.findMany({
      where: { shopId, id: { in: input.serviceIds }, isSystem: false },
    });
    await tx.jobService.createMany({
      data: services.map((s) => ({
        shopId,
        jobId: newJob.id,
        serviceId: s.id,
        quantity: 1,
        unitPrice: s.price,
      })),
    });
  }

  if (input.collectionServiceEnabled) {
    await syncCollectionJobService(tx, newJob.id);
  }

  return tx.job.findUnique({
    where: { id: newJob.id },
    include: {
      customer: true,
      jobBikes: { orderBy: { sortOrder: "asc" } },
      jobServices: { include: { service: true } },
    },
  });
}
