import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const updateBikeSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional().nullable(),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; bikeId: string }> }
) {
  try {
    const { id: customerId, bikeId } = await params;
    const body = await request.json();
    const data = updateBikeSchema.parse(body);

    const bike = await prisma.bike.findFirst({
      where: { id: bikeId, customerId },
    });
    if (!bike) {
      return NextResponse.json({ error: "Bike not found" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedBike = await tx.bike.update({
        where: { id: bikeId },
        data: {
          ...(data.make !== undefined && { make: data.make.trim() }),
          ...(data.model !== undefined && { model: data.model.trim() }),
          ...(data.bikeType !== undefined && { bikeType: data.bikeType }),
          ...(data.nickname !== undefined && {
            nickname: data.nickname?.trim() || null,
          }),
          ...(data.imageUrl !== undefined && {
            imageUrl: data.imageUrl?.trim() || null,
          }),
        },
      });

      // Propagate changes to all JobBike snapshots linked to this bike
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

        // Refresh Job.bikeMake / Job.bikeModel summary for jobs where this
        // bike is the first (lowest sortOrder) JobBike
        if (data.make !== undefined || data.model !== undefined) {
          const affectedJobBikes = await tx.jobBike.findMany({
            where: { bikeId },
            select: { jobId: true, sortOrder: true },
          });

          const jobIds = Array.from(new Set(affectedJobBikes.map((jb) => jb.jobId)));

          for (const jobId of jobIds) {
            const firstJobBike = await tx.jobBike.findFirst({
              where: { jobId },
              orderBy: { sortOrder: "asc" },
              select: { bikeId: true, make: true, model: true },
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
      return NextResponse.json(
        { error: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("PATCH /api/customers/[id]/bikes/[bikeId] error:", error);
    return NextResponse.json(
      { error: "Failed to update bike" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; bikeId: string }> }
) {
  try {
    const { id: customerId, bikeId } = await params;

    const bike = await prisma.bike.findFirst({
      where: { id: bikeId, customerId },
    });
    if (!bike) {
      return NextResponse.json({ error: "Bike not found" }, { status: 404 });
    }

    await prisma.bike.delete({ where: { id: bikeId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/customers/[id]/bikes/[bikeId] error:", error);
    return NextResponse.json(
      { error: "Failed to delete bike" },
      { status: 500 }
    );
  }
}
