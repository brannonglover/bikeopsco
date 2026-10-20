import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { syncCollectionJobService } from "@/lib/collection-fee";
import { requireStaffShop } from "@/lib/api-auth";
import { matchCatalogFieldsForJobBike } from "@/lib/bike-catalog-client";
import { scheduleCatalogLookup } from "@/lib/bike-catalog-lookup";
import { RepairHistoryConflictError } from "@/lib/job-bike-replacement";
import {
  assertNoRepairHistory,
  logRepairHistoryDeletion,
  readRepairHistoryOverride,
} from "@/lib/bike-installed-components";

const updateBikeSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional().nullable(),
  year: z.number().int().min(1980).max(2100).optional().nullable(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional().nullable(),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; bikeId: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id: customerId, bikeId } = await params;
    const body = await request.json();
    const data = updateBikeSchema.parse(body);

    const bike = await prisma.bike.findFirst({
      where: { id: bikeId, customerId, shopId: auth.shopId },
    });
    if (!bike) {
      return NextResponse.json({ error: "Bike not found" }, { status: 404 });
    }

    // A new year changes which build sheet the bike is: its open jobs get the
    // year, a fresh catalog match and a lookup. Matched once, up front, with
    // the bike's final make/model.
    const yearChanged = data.year !== undefined && (data.year ?? null) !== (bike.year ?? null);
    const yearMatch = yearChanged
      ? await matchCatalogFieldsForJobBike(
          data.make?.trim() ?? bike.make,
          data.model !== undefined ? data.model?.trim() ?? null : bike.model,
          data.year ?? null
        )
      : null;
    let relookupJobBikeIds: string[] = [];

    const updated = await prisma.$transaction(async (tx) => {
      const updatedBike = await tx.bike.update({
        where: { id: bikeId },
        data: {
          ...(data.make !== undefined && { make: data.make.trim() }),
          ...(data.model !== undefined && { model: data.model?.trim() ?? null }),
          ...(data.year !== undefined && { year: data.year ?? null }),
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

        const affectedJobBikes = await tx.jobBike.findMany({
          where: { bikeId },
          select: { jobId: true, sortOrder: true },
        });
        const jobIds = Array.from(new Set(affectedJobBikes.map((jb) => jb.jobId)));

        /**
         * Clients merge job payloads by Job.updatedAt and keep their own jobBikes when the
         * incoming copy is not newer. Editing a profile bike rewrites JobBike rows without
         * touching the parent job, so without this bump an open board keeps showing the old
         * name and, worse, the stale bikeId — which made an already-attached bike look
         * available in the "Add saved bike" list.
         */
        if (jobIds.length > 0) {
          await tx.job.updateMany({
            where: { id: { in: jobIds } },
            data: { updatedAt: new Date() },
          });
        }

        if (
          data.make !== undefined ||
          data.model !== undefined ||
          data.bikeType !== undefined
        ) {
          for (const jobId of jobIds) {
            await syncCollectionJobService(tx, jobId);
          }
        }

        // Refresh Job.bikeMake / Job.bikeModel summary for jobs where this
        // bike is the first (lowest sortOrder) JobBike
        if (data.make !== undefined || data.model !== undefined) {
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

      if (yearChanged) {
        // Open jobs only: a completed or cancelled visit keeps what it recorded.
        const open = await tx.jobBike.findMany({
          where: { bikeId, shopId: auth.shopId, job: { stage: { notIn: ["COMPLETED", "CANCELLED"] } } },
          select: { id: true, jobId: true },
        });
        if (open.length > 0) {
          await tx.jobBike.updateMany({
            where: { id: { in: open.map((jb) => jb.id) } },
            data: {
              year: updatedBike.year,
              catalogBikeId: yearMatch?.catalogBikeId ?? null,
              catalogMatchedAt: yearMatch?.catalogMatchedAt ?? null,
              catalogLookupAt: null,
              catalogLookupAttempts: 0,
              catalogLookupNextAt: null,
            },
          });
          await tx.job.updateMany({
            where: { id: { in: [...new Set(open.map((jb) => jb.jobId))] } },
            data: { updatedAt: new Date() },
          });
          relookupJobBikeIds = open.map((jb) => jb.id);
        }
      }

      return updatedBike;
    });

    // Bikes the catalog still doesn't know get their web lookup after the response.
    scheduleCatalogLookup(relookupJobBikeIds);

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = Object.entries(error.flatten().fieldErrors)
        .flatMap(([field, msgs]) =>
          (Array.isArray(msgs) ? msgs : [msgs]).filter(Boolean).map((m) => `${field}: ${m}`)
        )
        .join("; ");
      return NextResponse.json(
        { error: messages || "Invalid bike data" },
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string; bikeId: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id: customerId, bikeId } = await params;

    const bike = await prisma.bike.findFirst({
      where: { id: bikeId, customerId, shopId: auth.shopId },
    });
    if (!bike) {
      return NextResponse.json({ error: "Bike not found" }, { status: 404 });
    }

    // Deleting the bike deletes the repair history recorded on it. Refuse
    // unless the caller deliberately confirms (e.g. a privacy request).
    const override = readRepairHistoryOverride(request.nextUrl.searchParams);
    if ("error" in override) {
      return NextResponse.json({ error: override.error }, { status: 400 });
    }
    const erased = await prisma.$transaction(async (tx) => {
      if (!override.confirmed) {
        await assertNoRepairHistory(
          tx,
          { bikeId },
          "This bike has repair history (parts fitted on completed jobs). Deleting it would erase that history, so it wasn't deleted."
        );
      }
      const count = await tx.bikeInstalledComponent.count({ where: { bikeId } });
      await tx.bike.delete({ where: { id: bikeId } });
      return count;
    });
    if (override.confirmed && erased > 0) {
      logRepairHistoryDeletion({
        shopId: auth.shopId,
        userId: auth.userId,
        entity: "bike",
        entityId: bikeId,
        recordCount: erased,
        reason: override.reason,
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RepairHistoryConflictError) {
      return NextResponse.json(
        { error: error.message, code: "repair_history", recordCount: error.recordCount },
        { status: 409 }
      );
    }
    console.error("DELETE /api/customers/[id]/bikes/[bikeId] error:", error);
    return NextResponse.json(
      { error: "Failed to delete bike" },
      { status: 500 }
    );
  }
}
