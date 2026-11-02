#!/usr/bin/env ts-node
/**
 * Point one job bike at a different saved bike on the same customer, in place.
 *
 * Why:
 * - Before the fix in `src/lib/resolve-profile-bike.ts`, two same-model bikes on one job
 *   shared a profile `Bike`, so renaming one renamed both. Once the job is done and paid,
 *   removing a bike and adding another is not an option: the job bike carries its done
 *   state, services, products and part notes.
 * - `repair-shared-job-bikes.ts` splits shared rows by creating a new profile bike. Use
 *   this instead when the right saved bike already exists on the customer's profile.
 *
 * What it does, in one transaction:
 * - Relinks the job bike to the target `Bike` and copies that bike's make, model, year,
 *   type, nickname and photo onto it. Done state, services and products stay as they are.
 * - Moves parts recorded from this job bike (`BikeInstalledComponent`) to the target bike,
 *   so the repair history follows the bike that was actually worked on.
 * - Clears the job bike's catalog match (it belonged to the old bike) and resets the job's
 *   bike summary ("Multiple" / "N bikes" for more than one bike).
 *
 * Catalog: the background lookup skips completed jobs, so a done job's relinked bike
 * keeps no build sheet until the job is reopened.
 *
 * Usage:
 * - Dry run (no writes): `npx tsx scripts/relink-job-bike.ts --job-bike <jobBikeId> --bike <bikeId>`
 * - Apply changes:       add `--apply`
 *
 * Requirements:
 * - `DATABASE_URL` in the environment (shell export wins over .env / .env.local).
 *   Point it at the database you intend to change — confirm before using --apply.
 */

import { PrismaClient } from "@prisma/client";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./db-url-diagnostics").loadDotEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const describe = (b: { make: string; model: string | null; year: number | null }) =>
  [b.year, b.make, b.model].filter(Boolean).join(" ");

async function main() {
  const jobBikeId = arg("--job-bike");
  const bikeId = arg("--bike");
  if (!jobBikeId || !bikeId) {
    throw new Error("Usage: --job-bike <jobBikeId> --bike <bikeId> [--apply]");
  }

  const jobBike = await prisma.jobBike.findUnique({ where: { id: jobBikeId } });
  if (!jobBike) throw new Error(`Job bike ${jobBikeId} not found`);

  const [job, target] = await Promise.all([
    prisma.job.findUniqueOrThrow({
      where: { id: jobBike.jobId },
      include: {
        jobBikes: {
          orderBy: { sortOrder: "asc" },
          include: {
            jobServices: { select: { customServiceName: true, service: { select: { name: true } } } },
            jobProducts: { select: { id: true } },
            componentOverrides: { select: { id: true } },
          },
        },
      },
    }),
    prisma.bike.findUnique({ where: { id: bikeId } }),
  ]);
  if (!target) throw new Error(`Bike ${bikeId} not found`);
  if (target.shopId !== job.shopId || target.customerId !== job.customerId) {
    throw new Error("That bike belongs to a different customer than this job");
  }
  if (job.jobBikes.some((b) => b.bikeId === target.id && b.id !== jobBike.id)) {
    throw new Error("That bike is already on this job");
  }

  const recorded = await prisma.bikeInstalledComponent.count({ where: { jobBikeId } });

  console.log(`Job ${job.id} — ${job.stage}, summary "${job.bikeMake} ${job.bikeModel}"`);
  for (const b of job.jobBikes) {
    const services =
      b.jobServices.map((s) => s.service?.name ?? s.customServiceName).join(", ") || "none";
    console.log(
      `${b.id === jobBike.id ? "→" : " "} [${b.sortOrder}] ${b.id}  ${describe(b)}  bike=${b.bikeId}` +
        `  done=${b.completedAt ? "yes" : "no"}  services: ${services}` +
        `  products: ${b.jobProducts.length}  part notes: ${b.componentOverrides.length}`
    );
  }
  console.log(`\nRelink ${jobBike.id} to ${target.id} (${describe(target)})`);
  console.log(`Recorded parts moving with it: ${recorded}`);

  const remaining = job.jobBikes.length;
  const summary =
    remaining === 1
      ? { bikeMake: target.make, bikeModel: target.model ?? "" }
      : { bikeMake: "Multiple", bikeModel: `${remaining} bikes` };
  console.log(`Job summary becomes "${summary.bikeMake} ${summary.bikeModel}"`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to make these changes.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.jobBike.update({
      where: { id: jobBike.id },
      data: {
        bikeId: target.id,
        make: target.make,
        model: target.model,
        year: target.year,
        bikeType: target.bikeType,
        nickname: target.nickname,
        imageUrl: target.imageUrl,
        catalogBikeId: null,
        catalogMatchedAt: null,
        catalogLookupAt: null,
        catalogLookupAttempts: 0,
        catalogLookupNextAt: null,
      },
    });
    await tx.bikeInstalledComponent.updateMany({
      where: { jobBikeId: jobBike.id },
      data: { bikeId: target.id },
    });
    // Clients keep their own copy of a job unless updatedAt moves.
    await tx.job.update({ where: { id: job.id }, data: { ...summary, updatedAt: new Date() } });
  });

  console.log("\nApplied.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
