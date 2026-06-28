#!/usr/bin/env ts-node
/**
 * Backfill missing SYSTEM chat messages for job status transitions.
 *
 * Why:
 * - Stage-change chat mirroring was previously skipped when notifyCustomer was false
 *   or when serverless dropped post-response async work.
 * - Staff-created jobs never received a BOOKED_IN chat message until a stage PATCH.
 *
 * What it does:
 * - Loads a job (with customer + shop) and posts SYSTEM messages for each status
 *   template from BOOKED_IN up to the job's current stage (in board order).
 * - Uses the same SMS template text as live mirroring (see src/lib/sms.ts).
 *
 * Usage:
 *   # Dry run (default) — log stages/templates only, no DB writes
 *   npx ts-node scripts/backfill-job-status-chat.ts
 *   npx ts-node scripts/backfill-job-status-chat.ts cmqt0vnvu0001la04457tx7k1
 *
 *   # Apply — create chat messages (force: true bypasses duplicate detection)
 *   npx ts-node scripts/backfill-job-status-chat.ts cmqt0vnvu0001la04457tx7k1 --apply
 *
 * Requirements:
 *   - DATABASE_URL in .env / .env.local (see scripts/db-url-diagnostics.js)
 *   - CUSTOMER_JOB_ACCESS_SECRET or NEXTAUTH_SECRET (for status links in message body)
 *
 * Caveats:
 *   - Re-running with --apply always posts new messages (force: true). Check the thread first.
 *   - Does not send SMS/email — chat history only.
 *   - CANCELLED jobs are skipped unless the job id is explicitly provided and you accept
 *     that backfill may not match the customer's actual journey.
 */

import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const DEFAULT_JOB_ID = "cmqt0vnvu0001la04457tx7k1";

/** Board column order — stages at or before the job's current stage are backfilled. */
const STAGE_FLOW = [
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
] as const;

type FlowStage = (typeof STAGE_FLOW)[number];

const SMS_TEMPLATES: Record<string, string> = {
  booking_confirmation_dropoff:
    "{{shopName}}\n\nBooking confirmed! Your {{bikeMake}} {{bikeModel}} is scheduled.\n\nDrop off at the shop.\n\nTrack: {{statusUrl}}\n\nReply STOP to opt out.",
  booking_confirmation_collection:
    "{{shopName}}\n\nBooking confirmed! We'll collect your {{bikeMake}} {{bikeModel}} as arranged.\n\nTrack: {{statusUrl}}\n\nReply STOP to opt out.",
  bike_arrived:
    "{{shopName}}\n\nYour {{bikeMake}} {{bikeModel}} has arrived.\n\nTrack status: {{statusUrl}}\n\nReply STOP to opt out.",
  bike_collected:
    "{{shopName}}\n\nWe've collected your {{bikeMake}} {{bikeModel}}.\n\nTrack status: {{statusUrl}}\n\nReply STOP to opt out.",
  working_on_bike:
    "{{shopName}}\n\nWe're working on your {{bikeMake}} {{bikeModel}}.\n\nTrack: {{statusUrl}}\n\nReply STOP to opt out.",
  waiting_on_parts:
    "{{shopName}}\n\nWaiting on parts for your {{bikeMake}} {{bikeModel}}.\n\nTrack status: {{statusUrl}}\n\nReply STOP to opt out.",
  waiting_on_customer:
    "{{shopName}}\n\nWe need your approval to continue work on your {{bikeMake}} {{bikeModel}}.\n\nTrack: {{statusUrl}}\n\nReply STOP to opt out.",
  bike_ready_invoice:
    "{{shopName}}\n\n{{bikeReadyMessage}}\n\nView your itemized bill: {{billUrl}}\n\nReply STOP to opt out.",
};

function loadDotEnvIfPresent() {
  const cwd = process.cwd();
  for (const name of [".env", ".env.local"]) {
    const envPath = path.join(cwd, name);
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (!key) continue;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function getTemplateSlugForStage(stage: string, deliveryType: string): string | null {
  if (stage === "BOOKED_IN") {
    return deliveryType === "COLLECTION_SERVICE"
      ? "booking_confirmation_collection"
      : "booking_confirmation_dropoff";
  }
  if (stage === "RECEIVED") {
    return deliveryType === "COLLECTION_SERVICE" ? "bike_collected" : "bike_arrived";
  }
  const map: Record<string, string> = {
    WORKING_ON: "working_on_bike",
    WAITING_ON_CUSTOMER: "waiting_on_customer",
    WAITING_ON_PARTS: "waiting_on_parts",
    BIKE_READY: "bike_ready_invoice",
  };
  return map[stage] ?? null;
}

function getSigningSecret(): string {
  const secret =
    process.env.CUSTOMER_JOB_ACCESS_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "CUSTOMER_JOB_ACCESS_SECRET or NEXTAUTH_SECRET must be set for status links in chat messages"
    );
  }
  return secret;
}

function getShopAppUrl(shopSubdomain: string | null | undefined): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");
  if (shopSubdomain?.trim()) {
    const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim() || "bikeops.co";
    return `https://${shopSubdomain.trim()}.${root}`;
  }
  return "";
}

function getCustomerStatusUrl(
  jobId: string,
  shopId: string,
  shopSubdomain: string | null | undefined
): string {
  const shopUrl = getShopAppUrl(shopSubdomain);
  if (!shopUrl) return "";
  const token = createHmac("sha256", getSigningSecret())
    .update(`${shopId}:${jobId}`)
    .digest("base64url");
  const base = `${shopUrl}/status/${encodeURIComponent(jobId)}`;
  return `${base}?access=${encodeURIComponent(token)}`;
}

function getCustomerBillUrl(
  jobId: string,
  shopId: string,
  shopSubdomain: string | null | undefined
): string {
  const shopUrl = getShopAppUrl(shopSubdomain);
  if (!shopUrl) return "";
  const token = createHmac("sha256", getSigningSecret())
    .update(`${shopId}:${jobId}`)
    .digest("base64url");
  const base = `${shopUrl}/pay/${encodeURIComponent(jobId)}`;
  return `${base}?access=${encodeURIComponent(token)}`;
}

function getBikeReadyMessage(
  bikeMake: string,
  bikeModel: string,
  deliveryType: string
): string {
  const bikeName = `${bikeMake} ${bikeModel}`.trim();
  if (deliveryType === "COLLECTION_SERVICE") {
    return `Good news! Your ${bikeName} is ready and raring to roll. We'll be in touch to schedule its return home.`;
  }
  return `Good news! Your ${bikeName} is ready for pickup.`;
}

function buildJobStatusChatMessage(
  templateSlug: string,
  job: {
    id: string;
    shopId: string;
    bikeMake: string;
    bikeModel: string;
    deliveryType: string;
    customer: { firstName: string; lastName: string | null } | null;
  },
  shop: { name: string; subdomain: string | null }
): { ok: true; message: string } | { ok: false; error: string } {
  const template = SMS_TEMPLATES[templateSlug];
  if (!template) {
    return { ok: false, error: `SMS template not found: ${templateSlug}` };
  }

  const customerName = job.customer
    ? job.customer.lastName
      ? `${job.customer.firstName} ${job.customer.lastName}`
      : job.customer.firstName
    : "Customer";

  const vars: Record<string, string> = {
    customerName,
    bikeMake: job.bikeMake,
    bikeModel: job.bikeModel,
    bikeReadyMessage: getBikeReadyMessage(job.bikeMake, job.bikeModel, job.deliveryType),
    shopName: shop.name,
    statusUrl: getCustomerStatusUrl(job.id, job.shopId, shop.subdomain),
    billUrl: getCustomerBillUrl(job.id, job.shopId, shop.subdomain),
  };

  let message = template;
  for (const [key, value] of Object.entries(vars)) {
    message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value ?? "");
  }
  return { ok: true, message };
}

function stageIndex(stage: string): number {
  if (stage === "COMPLETED") return STAGE_FLOW.length - 1;
  return STAGE_FLOW.indexOf(stage as FlowStage);
}

function stagesToBackfill(currentStage: string): FlowStage[] {
  const idx = stageIndex(currentStage);
  if (idx < 0) return [];
  return STAGE_FLOW.slice(0, idx + 1);
}

function parseArgs() {
  const positional = process.argv.filter((a) => !a.startsWith("-"));
  const jobId = positional[2] ?? DEFAULT_JOB_ID;
  const apply = process.argv.includes("--apply");
  return { jobId, apply };
}

async function findOrCreateGeneralConversation(
  prisma: PrismaClient,
  shopId: string,
  customerId: string
) {
  const existing = await prisma.conversation.findFirst({
    where: { shopId, customerId, archived: false },
    orderBy: [{ jobId: "asc" }, { updatedAt: "desc" }],
  });
  if (existing) {
    if (existing.jobId !== null) {
      return prisma.conversation.update({
        where: { id: existing.id },
        data: { jobId: null },
      });
    }
    return existing;
  }
  return prisma.conversation.create({
    data: { shopId, customerId, jobId: null },
  });
}

async function mirrorStageMessage(
  prisma: PrismaClient,
  opts: {
    shopId: string;
    customerId: string;
    job: {
      id: string;
      shopId: string;
      bikeMake: string;
      bikeModel: string;
      deliveryType: string;
      customer: { firstName: string; lastName: string | null } | null;
    };
    shop: { name: string; subdomain: string | null };
    stage: FlowStage;
    templateSlug: string;
    apply: boolean;
    force: boolean;
  }
): Promise<"posted" | "skipped" | "dry-run" | "failed"> {
  const built = buildJobStatusChatMessage(opts.templateSlug, opts.job, opts.shop);
  if (!built.ok) {
    console.error(`  ✗ ${opts.stage} (${opts.templateSlug}): ${built.error}`);
    return "failed";
  }

  const conversation = await findOrCreateGeneralConversation(
    prisma,
    opts.shopId,
    opts.customerId
  );

  if (!opts.force) {
    const existing = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        sender: "SYSTEM",
        body: built.message,
      },
      select: { id: true },
    });
    if (existing) {
      console.log(
        `  ○ ${opts.stage} (${opts.templateSlug}): skipped — identical message already exists (${existing.id})`
      );
      return "skipped";
    }
  }

  if (!opts.apply) {
    console.log(`  → ${opts.stage} (${opts.templateSlug}): would post`);
    console.log(`    ${built.message.split("\n").join("\n    ")}`);
    return "dry-run";
  }

  const message = await prisma.message.create({
    data: {
      shopId: opts.shopId,
      conversationId: conversation.id,
      sender: "SYSTEM",
      body: built.message,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  console.log(
    `  ✓ ${opts.stage} (${opts.templateSlug}): posted message ${message.id} → conversation ${conversation.id}`
  );
  return "posted";
}

async function main() {
  loadDotEnvIfPresent();
  const { jobId, apply } = parseArgs();
  const mode = apply ? "APPLY" : "DRY RUN";

  console.log(`[${mode}] Backfilling status chat messages for job ${jobId}`);

  const prisma = new PrismaClient();

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true },
        },
        shop: {
          select: { id: true, name: true, subdomain: true },
        },
      },
    });

    if (!job) {
      console.error(`Job not found: ${jobId}`);
      process.exitCode = 1;
      return;
    }

    if (!job.customer) {
      console.error(`Job ${jobId} has no linked customer — nothing to backfill.`);
      process.exitCode = 1;
      return;
    }

    if (job.stage === "CANCELLED") {
      console.warn(`Job ${jobId} is CANCELLED — skipping backfill.`);
      return;
    }

    const stages = stagesToBackfill(job.stage);
    if (stages.length === 0) {
      console.warn(
        `Job ${jobId} is at stage ${job.stage} — no chat templates to backfill (needs BOOKED_IN or later).`
      );
      return;
    }

    console.log(
      `Job: ${job.bikeMake} ${job.bikeModel} | stage=${job.stage} | customer=${job.customer.firstName} ${job.customer.lastName ?? ""}`.trim()
    );
    console.log(`Shop: ${job.shop.name} (${job.shop.id})`);
    console.log(`Stages to backfill: ${stages.join(" → ")}`);
    console.log("");

    let posted = 0;
    let skipped = 0;
    let failed = 0;
    let dryRun = 0;

    for (const stage of stages) {
      const templateSlug = getTemplateSlugForStage(stage, job.deliveryType);
      if (!templateSlug) {
        console.log(`  ○ ${stage}: no template slug — skipped`);
        skipped++;
        continue;
      }

      const result = await mirrorStageMessage(prisma, {
        shopId: job.shopId,
        customerId: job.customer.id,
        job: {
          id: job.id,
          shopId: job.shopId,
          bikeMake: job.bikeMake,
          bikeModel: job.bikeModel,
          deliveryType: job.deliveryType,
          customer: job.customer,
        },
        shop: job.shop,
        stage,
        templateSlug,
        apply,
        force: true,
      });

      if (result === "posted") posted++;
      else if (result === "skipped") skipped++;
      else if (result === "failed") failed++;
      else if (result === "dry-run") dryRun++;
    }

    console.log("");
    if (apply) {
      console.log(`Done. Posted ${posted}, skipped ${skipped}, failed ${failed}.`);
    } else {
      console.log(
        `Done (dry run). Would post ${dryRun} message(s). Run with --apply to write.`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
