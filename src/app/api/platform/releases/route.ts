import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  compareCalverVersions,
  createReleaseDraft,
  getPlatformReleaseWebhookSecret,
  listPlatformReleases,
  serializeRelease,
  timingSafeEqualString,
} from "@/lib/platform-releases";

export const dynamic = "force-dynamic";

const draftSchema = z.object({
  version: z.string().trim().min(1).max(32),
  gitSha: z.string().trim().min(7).max(64),
  title: z.string().trim().max(200).optional().nullable(),
  bullets: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
});

function authorizeDraftWebhook(request: NextRequest): boolean {
  const secret = getPlatformReleaseWebhookSecret();
  if (!secret) return false;
  const header = request.headers.get("authorization")?.trim() ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const alt = request.headers.get("x-platform-release-secret")?.trim() ?? "";
  return (
    (bearer.length > 0 && timingSafeEqualString(bearer, secret)) ||
    (alt.length > 0 && timingSafeEqualString(alt, secret))
  );
}

/** Platform admin: list drafts + published (and optionally discarded). */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const includeDiscarded = request.nextUrl.searchParams.get("includeDiscarded") === "1";
  const releases = await listPlatformReleases(
    includeDiscarded ? undefined : ["draft", "published"]
  );

  const statusRank: Record<string, number> = { draft: 0, published: 1, discarded: 2 };
  const sorted = [...releases].sort((a, b) => {
    const rank = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (rank !== 0) return rank;
    const versionCmp = compareCalverVersions(b.version, a.version);
    if (versionCmp !== 0) return versionCmp;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return NextResponse.json({
    releases: sorted.map(serializeRelease),
  });
}

/**
 * Create a draft release.
 * - Platform admin session, or
 * - Bearer / x-platform-release-secret matching PLATFORM_RELEASE_WEBHOOK_SECRET (CI)
 */
export async function POST(request: NextRequest) {
  const webhookOk = authorizeDraftWebhook(request);
  if (!webhookOk) {
    const admin = await requirePlatformAdmin(request);
    if (!admin.ok) return admin.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid release payload" }, { status: 400 });
  }

  const result = await createReleaseDraft(parsed.data);
  if (!result.ok) {
    const status = result.release ? 409 : 400;
    return NextResponse.json(
      {
        error: result.error,
        release: result.release ? serializeRelease(result.release) : undefined,
      },
      { status }
    );
  }

  return NextResponse.json(
    { ok: true, created: result.created, release: serializeRelease(result.release) },
    { status: result.created ? 201 : 200 }
  );
}
