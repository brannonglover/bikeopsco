import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";
import { syncCollectionJobService } from "@/lib/collection-fee";

export const dynamic = "force-dynamic";

const updateBikeSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional().nullable(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional().nullable(),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
});

async function requireCustomerSession() {
  const shop = await requireCurrentShop();
  const features = await getAppFeatures(shop.id);
  if (!features.chatEnabled) {
    return {
      error: NextResponse.json({ error: "Chat is disabled" }, { status: 404 }),
    };
  }

  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return {
      error: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }

  return { shop, customerId };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ bikeId: string }> }
) {
  try {
    const session = await requireCustomerSession();
    if ("error" in session) return session.error;

    const { bikeId } = await params;
    const body = await request.json();
    const data = updateBikeSchema.parse(body);

    const bike = await prisma.bike.findFirst({
      where: {
        id: bikeId,
        customerId: session.customerId,
        shopId: session.shop.id,
      },
    });
    if (!bike) {
      return NextResponse.json({ error: "Bike not found" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedBike = await tx.bike.update({
        where: { id: bikeId },
        data: {
          ...(data.make !== undefined && { make: data.make.trim() }),
          ...(data.model !== undefined && { model: data.model?.trim() ?? null }),
          ...(data.bikeType !== undefined && { bikeType: data.bikeType }),
          ...(data.nickname !== undefined && {
            nickname: data.nickname?.trim() || null,
          }),
          ...(data.imageUrl !== undefined && {
            imageUrl: data.imageUrl?.trim() || null,
          }),
        },
      });

      const jobBikeUpdateData = {
        ...(data.make !== undefined && { make: updatedBike.make }),
        ...(data.model !== undefined && { model: updatedBike.model }),
        ...(data.bikeType !== undefined && { bikeType: updatedBike.bikeType }),
        ...(data.nickname !== undefined && { nickname: updatedBike.nickname }),
        ...(data.imageUrl !== undefined && { imageUrl: updatedBike.imageUrl }),
      };

      if (Object.keys(jobBikeUpdateData).length > 0) {
        await tx.jobBike.updateMany({
          where: { bikeId },
          data: jobBikeUpdateData,
        });

        if (
          data.make !== undefined ||
          data.model !== undefined ||
          data.bikeType !== undefined
        ) {
          const affectedJobBikes = await tx.jobBike.findMany({
            where: { bikeId },
            select: { jobId: true },
          });
          const jobIds = Array.from(
            new Set(affectedJobBikes.map((jb) => jb.jobId))
          );

          for (const jobId of jobIds) {
            await syncCollectionJobService(tx, jobId);
          }
        }

        if (data.make !== undefined || data.model !== undefined) {
          const affectedJobBikes = await tx.jobBike.findMany({
            where: { bikeId },
            select: { jobId: true },
          });
          const jobIds = Array.from(
            new Set(affectedJobBikes.map((jb) => jb.jobId))
          );

          for (const jobId of jobIds) {
            const firstJobBike = await tx.jobBike.findFirst({
              where: { jobId },
              orderBy: { sortOrder: "asc" },
              select: { bikeId: true },
            });

            if (firstJobBike?.bikeId === bikeId) {
              await tx.job.update({
                where: { id: jobId },
                data: {
                  bikeMake: updatedBike.make,
                  bikeModel: updatedBike.model ?? "",
                },
              });
            }
          }
        }
      }

      return updatedBike;
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = Object.entries(error.flatten().fieldErrors)
        .flatMap(([field, msgs]) =>
          (Array.isArray(msgs) ? msgs : [msgs])
            .filter(Boolean)
            .map((m) => `${field}: ${m}`)
        )
        .join("; ");
      return NextResponse.json(
        { error: messages || "Invalid bike data" },
        { status: 400 }
      );
    }
    console.error("PATCH /api/customer/bikes/[bikeId] error:", error);
    return NextResponse.json(
      { error: "Failed to update bike" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ bikeId: string }> }
) {
  try {
    const session = await requireCustomerSession();
    if ("error" in session) return session.error;

    const { bikeId } = await params;
    const bike = await prisma.bike.findFirst({
      where: {
        id: bikeId,
        customerId: session.customerId,
        shopId: session.shop.id,
      },
    });
    if (!bike) {
      return NextResponse.json({ error: "Bike not found" }, { status: 404 });
    }

    await prisma.bike.delete({ where: { id: bikeId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/customer/bikes/[bikeId] error:", error);
    return NextResponse.json(
      { error: "Failed to delete bike" },
      { status: 500 }
    );
  }
}
