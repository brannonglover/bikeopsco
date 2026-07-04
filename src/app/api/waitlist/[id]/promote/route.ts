import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { Stage } from "@prisma/client";
import { getAppFeatures } from "@/lib/app-settings";
import { syncCollectionJobService } from "@/lib/collection-fee";
import { sendJobEmail, getWaitlistPromotedTemplateSlug } from "@/lib/email";
import { getWaitlistPromotedSmsSlug, sendJobSms } from "@/lib/sms";
import { mirrorJobStageToCustomerChat } from "@/lib/system-chat";
import { getEffectiveEmailUpdatesConsent, getEffectiveSmsConsent } from "@/lib/sms-consent";

function safeServiceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getToken({ req: request });
  if (!token?.shopId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const shopId = token.shopId;
    const features = await getAppFeatures(shopId);

    const entry = await prisma.waitlistEntry.findUnique({
      where: { id },
      include: { bikes: { orderBy: { sortOrder: "asc" } } },
    });
    if (entry && entry.shopId !== shopId) {
      return NextResponse.json({ error: "Waitlist entry not found" }, { status: 404 });
    }
    if (!entry || entry.archivedAt) {
      return NextResponse.json({ error: "Waitlist entry not found" }, { status: 404 });
    }
    if (entry.status !== "WAITING") {
      return NextResponse.json({ error: "Waitlist entry is not waiting" }, { status: 400 });
    }

    const job = await prisma.$transaction(async (tx) => {
        // Find or create customer
        const emailNormalized = entry.email.trim().toLowerCase();
        const customer =
          (entry.customerId
            ? await tx.customer.findFirst({ where: { id: entry.customerId, shopId } })
            : null) ||
          (await tx.customer.findFirst({
            where: { shopId, email: { equals: emailNormalized, mode: "insensitive" } },
          })) ||
          (await tx.customer.create({
            data: {
              shopId,
              firstName: entry.firstName,
              lastName: entry.lastName ?? null,
              email: entry.email,
              phone: entry.phone,
            address: entry.address ?? null,
          },
        }));

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          firstName: entry.firstName,
          lastName: entry.lastName ?? null,
          phone: entry.phone,
          address: entry.address ?? customer.address,
        },
      });

      const bikeMakeSummary =
        entry.bikes.length === 1 ? entry.bikes[0].make.trim() : "Multiple";
      const bikeModelSummary =
        entry.bikes.length === 1 ? (entry.bikes[0].model?.trim() ?? "") : `${entry.bikes.length} bikes`;

      const newJob = await tx.job.create({
        data: {
          shopId,
          stage: Stage.BOOKED_IN,
          bikeMake: bikeMakeSummary,
          bikeModel: bikeModelSummary,
          customerId: customer.id,
          deliveryType: entry.deliveryType,
          dropOffDate: entry.dropOffDate ?? null,
          pickupDate: entry.pickupDate ?? null,
          collectionAddress: entry.collectionAddress ?? null,
          collectionWindowStart: entry.collectionWindowStart ?? null,
          collectionWindowEnd: entry.collectionWindowEnd ?? null,
          customerNotes: entry.customerNotes ?? null,
        },
      });

      for (let i = 0; i < entry.bikes.length; i++) {
        const b = entry.bikes[i];
        const makeNormalized = b.make.trim();
        const modelNormalized = b.model?.trim() || null;

        let bike = await tx.bike.findFirst({
          where: {
            shopId,
            customerId: customer.id,
            make: { equals: makeNormalized, mode: "insensitive" },
            model: modelNormalized ? { equals: modelNormalized, mode: "insensitive" } : null,
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

      const serviceIds = safeServiceIds(entry.serviceIds);
      if (serviceIds.length > 0) {
        const services = await tx.service.findMany({
          where: { shopId, id: { in: serviceIds }, isSystem: false },
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

      if (features.collectionServiceEnabled) {
        await syncCollectionJobService(tx, newJob.id);
      }

      await tx.waitlistEntry.update({
        where: { id: entry.id },
        data: {
          status: "PROMOTED",
          promotedJobId: newJob.id,
          promotedAt: new Date(),
        },
        select: { id: true },
      });

      return newJob;
    });

    // Promotion moves the job to BOOKED_IN, so notify the customer with the
    // dedicated "a spot opened up" waitlist templates (email + SMS + chat mirror).
    if (features.notifyCustomerEnabled) {
      try {
        const jobForNotify = await prisma.job.findUnique({
          where: { id: job.id, shopId },
          include: {
            customer: true,
            jobBikes: { include: { bike: true }, orderBy: { sortOrder: "asc" } },
            jobServices: { include: { service: true } },
            jobProducts: { include: { product: true } },
          },
        });

        if (jobForNotify) {
          const templateSlug = getWaitlistPromotedTemplateSlug(jobForNotify.deliveryType);
          const smsTemplateSlug = getWaitlistPromotedSmsSlug(jobForNotify.deliveryType);
          const customerEmail = getEffectiveEmailUpdatesConsent(jobForNotify.customer)
            ? jobForNotify.customer?.email?.trim()
            : null;
          const customerPhone = getEffectiveSmsConsent(jobForNotify.customer)
            ? jobForNotify.customer?.phone
            : null;

          const needsShop = Boolean(customerPhone && smsTemplateSlug) ||
            Boolean(features.chatEnabled && smsTemplateSlug && jobForNotify.customer?.id);
          const shop = needsShop
            ? await prisma.shop.findUnique({
                where: { id: shopId },
                select: { name: true, subdomain: true },
              })
            : null;

          if (customerEmail && templateSlug) {
            sendJobEmail(templateSlug, customerEmail, jobForNotify).catch((e) =>
              console.error("[Waitlist promote] Booking email failed:", e)
            );
          }

          if (customerPhone && smsTemplateSlug) {
            sendJobSms(smsTemplateSlug, customerPhone, jobForNotify, shop ?? undefined)
              .then((result) => {
                if (!result.ok)
                  console.error("[Waitlist promote] SMS failed:", result.error);
              })
              .catch((e) => console.error("[Waitlist promote] SMS threw:", e));
          }

          if (features.chatEnabled && jobForNotify.customer?.id && smsTemplateSlug) {
            mirrorJobStageToCustomerChat({
              shopId,
              customerId: jobForNotify.customer.id,
              job: jobForNotify,
              smsTemplateSlug,
              shopHint: shop ?? undefined,
            }).catch((e) =>
              console.error("[Waitlist promote] chat mirror failed:", e)
            );
          }
        }
      } catch (e) {
        console.error("[Waitlist promote] Customer notification failed:", e);
      }
    }

    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("POST /api/waitlist/[id]/promote error:", error);
    return NextResponse.json({ error: "Failed to promote waitlist entry" }, { status: 500 });
  }
}
