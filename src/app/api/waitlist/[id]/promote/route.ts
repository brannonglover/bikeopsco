import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { Stage } from "@prisma/client";
import { getAppFeatures } from "@/lib/app-settings";
import { syncCollectionJobService } from "@/lib/collection-fee";

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
    const maxActiveBikes = features.maxActiveBikes ?? 5;

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

    const entryBikeCount = entry.bikes.length;
    if (maxActiveBikes > 0) {
      const activeBikesCount = await prisma.jobBike.count({
        where: {
          shopId,
          job: { archivedAt: null, stage: { in: [Stage.RECEIVED, Stage.WORKING_ON] } },
        },
      });
      if (activeBikesCount + entryBikeCount > maxActiveBikes) {
        return NextResponse.json(
          { error: `Capacity is currently full (${activeBikesCount}/${maxActiveBikes} bikes).` },
          { status: 400 }
        );
      }
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

    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("POST /api/waitlist/[id]/promote error:", error);
    return NextResponse.json({ error: "Failed to promote waitlist entry" }, { status: 500 });
  }
}
