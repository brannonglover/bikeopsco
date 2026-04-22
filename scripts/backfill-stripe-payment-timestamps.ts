#!/usr/bin/env ts-node
/**
 * Backfill Stripe payment timestamps.
 *
 * Why:
 * - Stats reporting uses `Payment.createdAt` as the payment timestamp.
 * - If a Stripe payment is recorded after the fact (e.g., via "Reprocess Stripe payment"),
 *   `createdAt` may reflect when it was recorded, not when it happened in Stripe.
 *
 * What it does:
 * - For each `Payment` with a `stripePaymentIntentId`, fetch the PaymentIntent from Stripe and
 *   derive an "actual payment time" from `latest_charge.created` (preferred) or
 *   `payment_intent.created` (fallback).
 * - In `--apply` mode, updates `Payment.createdAt` when it differs significantly.
 * - Optionally updates `Job.completedAt` when it appears to have been set at the same time as the
 *   (old) payment timestamp.
 *
 * Usage:
 * - Dry run (no DB writes): `npx ts-node scripts/backfill-stripe-payment-timestamps.ts --limit=50`
 * - Apply changes:          `npx ts-node scripts/backfill-stripe-payment-timestamps.ts --apply --limit=50`
 *
 * Requirements:
 * - `DATABASE_URL` and `STRIPE_SECRET_KEY` available in the environment (e.g. via `.env`).
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { getStripe } from "../src/lib/stripe";

function loadDotEnvIfPresent() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseNumberArg(name: string, fallback: number): number {
  const prefix = `${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return fallback;
  const n = Number.parseInt(raw.slice(prefix.length), 10);
  return Number.isFinite(n) ? n : fallback;
}

function ms(n: number) {
  return n;
}

const APPLY = process.argv.includes("--apply");
const LIMIT = parseNumberArg("--limit", 200);
const MIN_DIFF_MS = ms(5 * 60 * 1000); // ignore small clock skew / webhook delays

async function main() {
  loadDotEnvIfPresent();

  const prisma = new PrismaClient();
  const stripe = getStripe();

  const payments = await prisma.payment.findMany({
    where: { stripePaymentIntentId: { not: null } },
    select: {
      id: true,
      jobId: true,
      stripePaymentIntentId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });

  let wouldUpdate = 0;
  let updated = 0;
  let wouldUpdateJobs = 0;
  let updatedJobs = 0;

  for (const p of payments) {
    const piId = p.stripePaymentIntentId;
    if (!piId) continue;

    const intent = await stripe.paymentIntents.retrieve(piId, {
      expand: ["latest_charge"],
    });

    const paymentAt = (() => {
      const latestCharge = intent.latest_charge;
      if (latestCharge && typeof latestCharge !== "string") {
        return new Date(latestCharge.created * 1000);
      }
      return new Date(intent.created * 1000);
    })();

    const diff = Math.abs(paymentAt.getTime() - p.createdAt.getTime());
    if (diff < MIN_DIFF_MS) continue;

    wouldUpdate++;
    const mode = APPLY ? "APPLY" : "DRY";
    console.log(
      `[${mode}] Payment ${p.id}: createdAt ${p.createdAt.toISOString()} → ${paymentAt.toISOString()} (pi ${piId})`
    );

    if (APPLY) {
      await prisma.payment.update({
        where: { id: p.id },
        data: { createdAt: paymentAt },
      });
      updated++;
    }

    // If job.completedAt appears to have been set at the same time as the old payment timestamp,
    // update it too so bike-completion stats follow the real Stripe timestamp.
    const job = await prisma.job.findUnique({
      where: { id: p.jobId },
      select: { stage: true, completedAt: true },
    });

    if (job?.stage === "COMPLETED" && job.completedAt) {
      const jobVsOld = Math.abs(job.completedAt.getTime() - p.createdAt.getTime());
      if (jobVsOld < MIN_DIFF_MS) {
        wouldUpdateJobs++;
        console.log(
          `  ↳ Job ${p.jobId}: completedAt ${job.completedAt.toISOString()} → ${paymentAt.toISOString()}`
        );
        if (APPLY) {
          await prisma.job.update({
            where: { id: p.jobId },
            data: { completedAt: paymentAt },
          });
          updatedJobs++;
        }
      }
    }
  }

  console.log(
    APPLY
      ? `Done. Updated ${updated}/${payments.length} payment(s) and ${updatedJobs} job(s).`
      : `Done (dry run). Would update ${wouldUpdate}/${payments.length} payment(s) and ${wouldUpdateJobs} job(s).`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

