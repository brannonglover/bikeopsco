#!/usr/bin/env ts-node
/**
 * Split job bikes that share one customer profile bike.
 *
 * Why:
 * - Adding a bike to a job auto-matched an existing profile `Bike` by make + model. Two
 *   bikes of the same make and model on one job both matched the first row, so they ended
 *   up sharing a `Bike`.
 * - `PATCH /api/customers/[id]/bikes/[bikeId]` propagates make, model and nickname to every
 *   `JobBike` linked to that row, so editing one of them rewrote all of them.
 * - `src/lib/resolve-profile-bike.ts` stops this happening to new jobs; this repairs rows
 *   written before that fix.
 *
 * What it does:
 * - Finds each (jobId, bikeId) group holding more than one `JobBike`.
 * - Leaves the first bike (lowest sortOrder) on the existing profile row.
 * - Gives every other bike in the group its own new profile `Bike`, copied from that job
 *   bike's own snapshot, and relinks it.
 *
 * What it cannot do:
 * - Recover models or nicknames that the fan-out already overwrote. Those values are gone
 *   from the database. After this runs the bikes are independent, so re-entering the
 *   correct model and nickname per bike will stick.
 *
 * Usage:
 * - Dry run (no writes): `npx tsx scripts/repair-shared-job-bikes.ts`
 * - Apply changes:       `npx tsx scripts/repair-shared-job-bikes.ts --apply`
 *
 * Requirements:
 * - `DATABASE_URL` in the environment (shell export wins over .env / .env.local).
 *   Point it at the database you intend to change — confirm before using --apply.
 */

import { PrismaClient } from "@prisma/client";

// Shell env wins, then .env / .env.local — so `export DATABASE_URL=...` targets production
// without editing any file. Matches prisma.config.js so both read the same source.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./db-url-diagnostics").loadDotEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

type Group = { jobId: string; bikeId: string };

async function main() {
  const groups = await prisma.$queryRawUnsafe<Group[]>(`
    SELECT "jobId", "bikeId"
    FROM "JobBike"
    WHERE "bikeId" IS NOT NULL
    GROUP BY "jobId", "bikeId"
    HAVING COUNT(*) > 1
  `);

  if (groups.length === 0) {
    console.log("Nothing to repair — no job has two bikes sharing a profile row.");
    return;
  }

  console.log(
    `${groups.length} shared profile row(s) across ${new Set(groups.map((g) => g.jobId)).size} job(s).`
  );
  console.log(APPLY ? "Mode: APPLY\n" : "Mode: DRY RUN (no writes)\n");

  let splits = 0;

  for (const group of groups) {
    const [job, profileBike, jobBikes] = await Promise.all([
      prisma.job.findUnique({
        where: { id: group.jobId },
        select: { id: true, shopId: true, customerId: true, stage: true },
      }),
      prisma.bike.findUnique({ where: { id: group.bikeId } }),
      prisma.jobBike.findMany({
        where: { jobId: group.jobId, bikeId: group.bikeId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    if (!job?.customerId || !profileBike) {
      console.log(`  ! job ${group.jobId}: missing job customer or profile bike — skipped`);
      continue;
    }

    const [keep, ...toSplit] = jobBikes;
    const label = (b: (typeof jobBikes)[number]) =>
      `${b.make}${b.model ? ` ${b.model}` : ""}${b.nickname ? ` "${b.nickname}"` : ""}`;

    console.log(`  job ${job.id} (${job.stage}) — profile bike ${profileBike.id}`);
    console.log(`    keep  ${keep.id}  ${label(keep)}`);

    for (const bike of toSplit) {
      console.log(`    split ${bike.id}  ${label(bike)}  -> new profile bike`);
      splits++;

      if (!APPLY) continue;

      await prisma.$transaction(async (tx) => {
        const created = await tx.bike.create({
          data: {
            shopId: job.shopId,
            customerId: job.customerId!,
            // Prefer this bike's own snapshot; fall back to the row it was sharing.
            make: bike.make?.trim() || profileBike.make,
            model: bike.model?.trim() || profileBike.model,
            year: bike.year ?? profileBike.year,
            bikeType: bike.bikeType ?? profileBike.bikeType,
            nickname: bike.nickname?.trim() || null,
            imageUrl: bike.imageUrl?.trim() || profileBike.imageUrl,
          },
        });
        await tx.jobBike.update({
          where: { id: bike.id },
          data: { bikeId: created.id },
        });
      });
    }
  }

  console.log(
    `\n${APPLY ? "Split" : "Would split"} ${splits} job bike(s) onto their own profile row.`
  );
  if (!APPLY) console.log("Re-run with --apply to write these changes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
