import type { Bike, BikeType, PrismaClient } from "@prisma/client";

function bikeKey(make: string, model: string | null | undefined): string {
  return `${make.trim().toLowerCase()}|${(model ?? "").trim().toLowerCase()}`;
}

/**
 * Create customer Bike rows from past Job / JobBike history when they are
 * missing from the customer record (common for older jobs that only stored
 * make/model snapshots).
 */
export async function ensureCustomerBikesFromJobs(
  db: PrismaClient,
  shopId: string,
  customerId: string
): Promise<Bike[]> {
  const existing = await db.bike.findMany({
    where: { shopId, customerId },
    orderBy: [{ make: "asc" }, { model: "asc" }],
  });

  const byKey = new Map(existing.map((b) => [bikeKey(b.make, b.model), b]));

  const jobs = await db.job.findMany({
    where: { shopId, customerId },
    orderBy: { createdAt: "desc" },
    select: {
      bikeMake: true,
      bikeModel: true,
      jobBikes: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          make: true,
          model: true,
          nickname: true,
          imageUrl: true,
          bikeType: true,
          bikeId: true,
        },
      },
    },
  });

  type Candidate = {
    make: string;
    model: string | null;
    nickname: string | null;
    imageUrl: string | null;
    bikeType: BikeType | null;
    jobBikeIds: string[];
  };

  const candidates = new Map<string, Candidate>();

  for (const job of jobs) {
    if (job.jobBikes.length > 0) {
      for (const jb of job.jobBikes) {
        const make = jb.make?.trim();
        if (!make) continue;
        const model = jb.model?.trim() || null;
        const key = bikeKey(make, model);
        const existingBike = byKey.get(key);
        if (jb.bikeId && existingBike && jb.bikeId === existingBike.id) {
          continue;
        }
        if (jb.bikeId) {
          // Already linked to some customer bike — treat that key as covered.
          const linked = existing.find((b) => b.id === jb.bikeId);
          if (linked) {
            byKey.set(bikeKey(linked.make, linked.model), linked);
            continue;
          }
          // Orphaned bikeId — fall through and recreate from the snapshot.
        }

        const prev = candidates.get(key);
        if (!prev) {
          candidates.set(key, {
            make,
            model,
            nickname: jb.nickname?.trim() || null,
            imageUrl: jb.imageUrl?.trim() || null,
            bikeType: jb.bikeType ?? null,
            jobBikeIds: [jb.id],
          });
        } else {
          if (!prev.nickname && jb.nickname?.trim()) {
            prev.nickname = jb.nickname.trim();
          }
          if (!prev.imageUrl && jb.imageUrl?.trim()) {
            prev.imageUrl = jb.imageUrl.trim();
          }
          if (prev.bikeType == null && jb.bikeType != null) {
            prev.bikeType = jb.bikeType;
          }
          prev.jobBikeIds.push(jb.id);
        }
      }
    } else {
      const make = job.bikeMake?.trim();
      if (!make) continue;
      const model = job.bikeModel?.trim() || null;
      const key = bikeKey(make, model);
      if (byKey.has(key) || candidates.has(key)) continue;
      candidates.set(key, {
        make,
        model,
        nickname: null,
        imageUrl: null,
        bikeType: null,
        jobBikeIds: [],
      });
    }
  }

  const created: Bike[] = [];

  for (const candidate of candidates.values()) {
    const key = bikeKey(candidate.make, candidate.model);
    let bike = byKey.get(key);
    if (!bike) {
      bike = await db.bike.create({
        data: {
          shopId,
          customerId,
          make: candidate.make,
          model: candidate.model,
          nickname: candidate.nickname,
          imageUrl: candidate.imageUrl,
          bikeType: candidate.bikeType,
        },
      });
      byKey.set(key, bike);
      created.push(bike);
    }

    if (candidate.jobBikeIds.length > 0) {
      await db.jobBike.updateMany({
        where: {
          id: { in: candidate.jobBikeIds },
          OR: [{ bikeId: null }, { bikeId: { not: bike.id } }],
        },
        data: { bikeId: bike.id },
      });
    }
  }

  if (created.length === 0) {
    return existing;
  }

  return db.bike.findMany({
    where: { shopId, customerId },
    orderBy: [{ make: "asc" }, { model: "asc" }],
  });
}
