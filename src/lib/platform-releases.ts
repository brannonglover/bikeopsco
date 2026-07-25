import "server-only";

import { prisma } from "@/lib/db";
import type { PlatformRelease, PlatformReleaseStatus } from "@prisma/client";
import { DEFAULT_ROOT_DOMAIN } from "@/lib/tenant-domain";

export type ReleaseBulletPayload = {
  id: string;
  version: string;
  gitSha: string;
  title: string | null;
  bullets: string[];
  status: PlatformReleaseStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

function marketingSiteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_MARKETING_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return `https://${DEFAULT_ROOT_DOMAIN}`;
}

export function serializeRelease(release: PlatformRelease): ReleaseBulletPayload {
  return {
    id: release.id,
    version: release.version,
    gitSha: release.gitSha,
    title: release.title,
    bullets: release.bullets,
    status: release.status,
    createdAt: release.createdAt.toISOString(),
    updatedAt: release.updatedAt.toISOString(),
    publishedAt: release.publishedAt?.toISOString() ?? null,
  };
}

/** HTML id / URL fragment for a version section (dots → safe id). */
export function releaseAnchorId(version: string): string {
  return `v-${version.trim()}`;
}

export function getReleaseNotesPublicUrl(version?: string | null): string {
  const base = `${marketingSiteBaseUrl()}/releases`;
  if (!version?.trim()) return base;
  return `${base}#${releaseAnchorId(version)}`;
}

export function getPlatformReleaseWebhookSecret(): string | null {
  return process.env.PLATFORM_RELEASE_WEBHOOK_SECRET?.trim() || null;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export async function listPlatformReleases(statuses?: PlatformReleaseStatus[]) {
  return prisma.platformRelease.findMany({
    where: statuses?.length ? { status: { in: statuses } } : undefined,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function listPublishedReleases() {
  return prisma.platformRelease.findMany({
    where: { status: "published" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function findPublishedReleaseByGitSha(gitSha: string) {
  const trimmed = gitSha.trim();
  if (!trimmed || trimmed === "local-dev") return null;

  const exact = await prisma.platformRelease.findFirst({
    where: { gitSha: trimmed, status: "published" },
    orderBy: { publishedAt: "desc" },
  });
  if (exact) return exact;

  if (trimmed.length >= 7) {
    return prisma.platformRelease.findFirst({
      where: {
        status: "published",
        gitSha: { startsWith: trimmed.slice(0, 7) },
      },
      orderBy: { publishedAt: "desc" },
    });
  }

  return null;
}

export async function createReleaseDraft(input: {
  version: string;
  gitSha: string;
  title?: string | null;
  bullets: string[];
}) {
  const version = input.version.trim();
  const gitSha = input.gitSha.trim();
  const bullets = input.bullets.map((b) => b.trim()).filter(Boolean);

  if (!version || !gitSha) {
    return { ok: false as const, error: "version and gitSha are required" };
  }
  if (bullets.length === 0) {
    return { ok: false as const, error: "At least one bullet is required" };
  }

  const existing = await prisma.platformRelease.findUnique({ where: { version } });
  if (existing) {
    if (existing.status === "discarded") {
      const updated = await prisma.platformRelease.update({
        where: { id: existing.id },
        data: {
          gitSha,
          title: input.title?.trim() || null,
          bullets,
          status: "draft",
          publishedAt: null,
        },
      });
      return { ok: true as const, release: updated, created: false };
    }
    return { ok: false as const, error: `Version ${version} already exists`, release: existing };
  }

  const release = await prisma.platformRelease.create({
    data: {
      version,
      gitSha,
      title: input.title?.trim() || null,
      bullets,
      status: "draft",
    },
  });
  return { ok: true as const, release, created: true };
}

export async function updatePlatformRelease(
  id: string,
  input: {
    title?: string | null;
    bullets?: string[];
    status?: PlatformReleaseStatus;
  }
) {
  const existing = await prisma.platformRelease.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, error: "not_found" as const };

  const data: {
    title?: string | null;
    bullets?: string[];
    status?: PlatformReleaseStatus;
    publishedAt?: Date | null;
  } = {};

  if (input.title !== undefined) {
    data.title = input.title?.trim() || null;
  }
  if (input.bullets !== undefined) {
    const bullets = input.bullets.map((b) => b.trim()).filter(Boolean);
    if (bullets.length === 0) {
      return { ok: false as const, error: "empty_bullets" as const };
    }
    data.bullets = bullets;
  }
  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === "published") {
      data.publishedAt = existing.publishedAt ?? new Date();
    }
    if (input.status === "draft" || input.status === "discarded") {
      if (input.status === "discarded") {
        data.publishedAt = null;
      }
    }
  }

  const release = await prisma.platformRelease.update({
    where: { id },
    data,
  });
  return { ok: true as const, release };
}

/**
 * Next calver for today in America/New_York (shop-facing date).
 * Existing versions for today bump .2, .3, …
 */
export async function allocateNextReleaseVersion(now = new Date()): Promise<string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA → YYYY-MM-DD
  const ymd = formatter.format(now);
  const base = ymd.replace(/-/g, ".");

  const existing = await prisma.platformRelease.findMany({
    where: {
      OR: [{ version: base }, { version: { startsWith: `${base}.` } }],
    },
    select: { version: true },
  });

  if (existing.length === 0) return base;

  let maxSuffix = 1;
  for (const row of existing) {
    if (row.version === base) {
      maxSuffix = Math.max(maxSuffix, 1);
      continue;
    }
    const match = row.version.match(new RegExp(`^${base.replace(/\./g, "\\.")}\\.(\\d+)$`));
    if (match) {
      maxSuffix = Math.max(maxSuffix, Number(match[1]));
    }
  }
  return `${base}.${maxSuffix + 1}`;
}
