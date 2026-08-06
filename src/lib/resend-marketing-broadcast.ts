import "server-only";

import type { Resend } from "resend";
import { prisma } from "@/lib/db";

/** Free Marketing plan contact cap — soft guard before syncing. */
export const RESEND_MARKETING_FREE_CONTACT_CAP = 1000;

export type MarketingBroadcastRecipient = {
  email: string;
  /** Stored as Resend first_name so {{{contact.first_name}}} matches {{customerName}}. */
  displayName: string;
};

function isAlreadyExistsError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("already exists") ||
    lower.includes("already been taken") ||
    lower.includes("duplicate") ||
    lower.includes("conflict")
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Ensure a durable Resend segment exists for this shop's email-update audience.
 */
export async function ensureShopEmailUpdatesSegment(
  resend: Resend,
  shop: { id: string; name: string; subdomain: string; resendEmailUpdatesSegmentId: string | null }
): Promise<{ segmentId: string; error?: string }> {
  if (shop.resendEmailUpdatesSegmentId) {
    const existing = await resend.segments.get(shop.resendEmailUpdatesSegmentId);
    if (!existing.error && existing.data?.id) {
      return { segmentId: existing.data.id };
    }
  }

  const segmentName = `Bike Ops · ${shop.name} · email updates (${shop.subdomain})`.slice(0, 191);
  const created = await resend.segments.create({ name: segmentName });
  if (created.error || !created.data?.id) {
    return {
      segmentId: "",
      error: created.error?.message ?? "Could not create Resend Marketing segment",
    };
  }

  await prisma.shop.update({
    where: { id: shop.id },
    data: { resendEmailUpdatesSegmentId: created.data.id },
  });

  return { segmentId: created.data.id };
}

async function upsertContactInSegment(
  resend: Resend,
  segmentId: string,
  recipient: MarketingBroadcastRecipient
): Promise<{ ok: boolean; error?: string }> {
  const email = recipient.email.trim();
  const firstName = recipient.displayName.trim() || "there";

  const created = await resend.contacts.create({
    email,
    firstName,
    unsubscribed: false,
    segments: [{ id: segmentId }],
  });

  if (!created.error) {
    return { ok: true };
  }

  if (!isAlreadyExistsError(created.error.message)) {
    return { ok: false, error: created.error.message };
  }

  const updated = await resend.contacts.update({
    email,
    firstName,
    unsubscribed: false,
  });
  if (updated.error) {
    return { ok: false, error: updated.error.message };
  }

  const added = await resend.contacts.segments.add({ email, segmentId });
  if (added.error && !isAlreadyExistsError(added.error.message)) {
    // Already in segment is fine.
    const msg = added.error.message.toLowerCase();
    if (!msg.includes("already") && !msg.includes("exists")) {
      return { ok: false, error: added.error.message };
    }
  }

  return { ok: true };
}

async function listSegmentContactEmails(
  resend: Resend,
  segmentId: string
): Promise<{ emails: string[]; error?: string }> {
  const emails: string[] = [];
  let after: string | undefined;

  for (;;) {
    const page = await resend.contacts.list(
      after ? { segmentId, limit: 100, after } : { segmentId, limit: 100 }
    );
    if (page.error) {
      return { emails, error: page.error.message };
    }
    const rows = page.data?.data ?? [];
    for (const row of rows) {
      if (row.email) emails.push(row.email);
    }
    if (!page.data?.has_more || rows.length === 0) break;
    after = rows[rows.length - 1]?.id;
    if (!after) break;
  }

  return { emails };
}

/**
 * Sync consented recipients into the shop segment and remove anyone no longer opted in.
 */
export async function syncEmailUpdatesSegment(
  resend: Resend,
  segmentId: string,
  recipients: MarketingBroadcastRecipient[]
): Promise<{ synced: number; removed: number; failed: number; errors: string[] }> {
  const unique = new Map<string, MarketingBroadcastRecipient>();
  for (const r of recipients) {
    const key = r.email.trim().toLowerCase();
    if (!key || !key.includes("@")) continue;
    if (!unique.has(key)) {
      unique.set(key, { email: r.email.trim(), displayName: r.displayName });
    }
  }

  const targetEmails = new Set(unique.keys());
  const errors: string[] = [];
  let failed = 0;

  const upsertResults = await mapPool([...unique.values()], 5, async (recipient) => {
    const result = await upsertContactInSegment(resend, segmentId, recipient);
    if (!result.ok) {
      failed += 1;
      if (errors.length < 25 && result.error) {
        errors.push(`${recipient.email}: ${result.error}`);
      }
      return false;
    }
    return true;
  });
  const synced = upsertResults.filter(Boolean).length;

  const listed = await listSegmentContactEmails(resend, segmentId);
  if (listed.error) {
    errors.push(`Could not list segment contacts: ${listed.error}`);
    return { synced, removed: 0, failed, errors };
  }

  const toRemove = listed.emails.filter((email) => !targetEmails.has(email.toLowerCase()));
  let removed = 0;
  await mapPool(toRemove, 5, async (email) => {
    const result = await resend.contacts.segments.remove({ email, segmentId });
    if (result.error) {
      if (errors.length < 25) {
        errors.push(`Remove ${email}: ${result.error.message}`);
      }
      return;
    }
    removed += 1;
  });

  return { synced, removed, failed, errors };
}

/**
 * Convert Bike Ops merge fields to Resend Broadcast personalization.
 * {{shopName}} is baked in; {{customerName}} becomes contact.first_name (we store display name there).
 */
export function toResendBroadcastMergeFields(template: string, shopName: string): string {
  return template
    .replaceAll("{{shopName}}", shopName)
    .replaceAll("{{customerName}}", "{{{contact.first_name|there}}}");
}

/** Absolute HTTPS logo only — Broadcasts cannot use CID attachments. */
export function marketingBroadcastLogoSrc(headerLogoSrc: string, fallbackBaseUrl: string): string {
  const trimmed = headerLogoSrc.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }
  const base = fallbackBaseUrl.replace(/\/$/, "");
  if (base) return `${base}/bike-ops-logo.png`;
  return "";
}
