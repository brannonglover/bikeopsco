import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { getShopForHost } from "@/lib/shop";
import { BLOB_HOST_SUFFIX, verifyBlobSignature } from "@/lib/blob-signing";
import { requestHost } from "@/lib/request-host";

export { blobSignatureQuery, normalizeBlobPathname, signBlobUrl, verifyBlobSignature } from "@/lib/blob-signing";

/**
 * Who may read a file from the private Blob store.
 *
 * Ownership comes from the BlobAsset row written at upload (or, for files that
 * predate it, from the records that reference the file) — never from the
 * pathname, its prefix, or anything the client sends. A pathname is only a
 * lookup key: knowing one grants nothing.
 */

export type BlobKind =
  | "bike"
  | "customer-upload"
  | "chat"
  | "product"
  | "mechanic"
  | "logo"
  | "voicemail-greeting";

/** Shown to anyone: marketing-grade images the shop puts in front of customers. */
const PUBLIC_KINDS: ReadonlySet<BlobKind> = new Set(["logo", "mechanic", "product"]);

export function isPublicBlobKind(kind: string): boolean {
  return PUBLIC_KINDS.has(kind as BlobKind);
}

export type BlobOwner = {
  shopId: string;
  kind: string;
  customerId: string | null;
  isPublic: boolean;
};

/** Record who owns a freshly uploaded file. Never reassigns an existing owner. */
export async function registerBlobAsset(input: {
  pathname: string;
  shopId: string;
  kind: BlobKind;
  customerId?: string | null;
}): Promise<void> {
  await prisma.blobAsset.upsert({
    where: { pathname: input.pathname },
    create: {
      pathname: input.pathname,
      shopId: input.shopId,
      kind: input.kind,
      customerId: input.customerId ?? null,
      isPublic: isPublicBlobKind(input.kind),
    },
    update: {},
  });
}

/**
 * The owner of a stored file: its BlobAsset row, or — for a file uploaded
 * before the registry — the records that reference it, which are then
 * registered so the search happens once. Null when nothing owns it, or when
 * records in more than one shop claim it (refused rather than guessed).
 */
export async function resolveBlobOwner(pathname: string): Promise<BlobOwner | null> {
  const row = await prisma.blobAsset.findUnique({
    where: { pathname },
    select: { shopId: true, kind: true, customerId: true, isPublic: true },
  });
  if (row) return row;

  const claims = await legacyClaims(pathname);
  const shops = new Set(claims.map((c) => c.shopId));
  if (shops.size !== 1) {
    if (shops.size > 1) {
      console.warn("[blob] refusing file claimed by more than one shop", { pathname, shops: [...shops] });
    }
    return null;
  }

  // Most specific claim wins: one tied to a customer over a shop-wide one,
  // and a private kind over a public one.
  const ranked = [...claims].sort(
    (a, b) =>
      Number(Boolean(b.customerId)) - Number(Boolean(a.customerId)) ||
      Number(isPublicBlobKind(a.kind)) - Number(isPublicBlobKind(b.kind))
  );
  const claim = ranked[0];
  const owner: BlobOwner = {
    shopId: claim.shopId,
    kind: claim.kind,
    customerId: claim.customerId,
    isPublic: claims.every((c) => isPublicBlobKind(c.kind)),
  };
  try {
    await prisma.blobAsset.upsert({
      where: { pathname },
      create: { pathname, ...owner },
      update: {},
    });
  } catch (error) {
    console.error("[blob] could not register legacy owner", error);
  }
  return owner;
}

function refersTo(stored: string, pathname: string): boolean {
  return stored.includes(`path=${encodeURIComponent(pathname)}`) || stored.endsWith(`${BLOB_HOST_SUFFIX}/${pathname}`);
}

type Claim = { shopId: string; kind: BlobKind; customerId: string | null };

/** Every record that stores a URL for this pathname, proxied or direct. */
async function legacyClaims(pathname: string): Promise<Claim[]> {
  const proxied = { contains: `path=${encodeURIComponent(pathname)}` };
  const direct = { endsWith: `${BLOB_HOST_SUFFIX}/${pathname}` };
  const url = (field: string) => ({ OR: [{ [field]: proxied }, { [field]: direct }] });

  const [customers, bikes, jobBikes, products, mechanics, rentalBikes, attachments, settings] =
    await Promise.all([
      prisma.customer.findMany({ where: url("imageUrl"), select: { shopId: true, id: true } }),
      prisma.bike.findMany({ where: url("imageUrl"), select: { shopId: true, customerId: true } }),
      prisma.jobBike.findMany({
        where: url("imageUrl"),
        select: { shopId: true, job: { select: { customerId: true } } },
      }),
      prisma.product.findMany({ where: url("imageUrl"), select: { shopId: true } }),
      prisma.mechanic.findMany({ where: url("imageUrl"), select: { shopId: true } }),
      prisma.rentalBike.findMany({ where: url("imageUrl"), select: { shopId: true } }),
      prisma.messageAttachment.findMany({
        where: url("url"),
        select: { shopId: true, message: { select: { conversation: { select: { customerId: true } } } } },
      }),
      prisma.appSettings.findMany({
        where: { OR: [url("logoUrl"), url("voicemailGreetingUrl")] },
        select: { shopId: true, logoUrl: true },
      }),
    ]);

  return [
    ...customers.map((c) => ({ shopId: c.shopId, kind: "customer-upload" as const, customerId: c.id })),
    ...bikes.map((b) => ({ shopId: b.shopId, kind: "bike" as const, customerId: b.customerId })),
    ...jobBikes.map((b) => ({ shopId: b.shopId, kind: "bike" as const, customerId: b.job.customerId })),
    ...products.map((p) => ({ shopId: p.shopId, kind: "product" as const, customerId: null })),
    ...mechanics.map((m) => ({ shopId: m.shopId, kind: "mechanic" as const, customerId: null })),
    ...rentalBikes.map((r) => ({ shopId: r.shopId, kind: "bike" as const, customerId: null })),
    ...attachments.map((a) => ({
      shopId: a.shopId,
      kind: "chat" as const,
      customerId: a.message?.conversation.customerId ?? null,
    })),
    ...settings.map((s) => ({
      shopId: s.shopId,
      kind: s.logoUrl && refersTo(s.logoUrl, pathname) ? ("logo" as const) : ("voicemail-greeting" as const),
      customerId: null,
    })),
  ];
}

// ---------------------------------------------------------------------------
// The decision.

export type BlobAccess =
  | { ok: true; via: "signature" | "public" | "staff" | "customer"; owner: BlobOwner | null; expiresAt?: number }
  | { ok: false };

/** Staff shop from the session JWT (cookie or Bearer); null when absent or unreadable. */
async function staffShopId(request: NextRequest): Promise<string | null> {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    return typeof token?.shopId === "string" && typeof token?.id === "string" ? token.shopId : null;
  } catch {
    return null;
  }
}

/** The customer behind a chat session cookie or Bearer token, with its shop. */
export async function customerSessionFromRequest(
  request: NextRequest
): Promise<{ customerId: string; shopId: string } | null> {
  const cookie = request.cookies.get("chat_session")?.value;
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
  const token = cookie || bearer;
  if (!token) return null;
  const session = await prisma.chatSession.findUnique({
    where: { token },
    select: { customerId: true, shopId: true, expiresAt: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    // Same allowance as getCustomerFromSession: an expired session still
    // works while the customer has an ongoing chat/SMS/push relationship.
    const { customerHasExtendedChatSessionAccess } = await import("@/lib/chat-session");
    if (!(await customerHasExtendedChatSessionAccess(session.shopId, session.customerId))) return null;
  }
  return { customerId: session.customerId, shopId: session.shopId };
}

/** Is the file the customer's own: registered to them, on their bike, or in their chat? */
async function customerOwnsBlob(pathname: string, owner: BlobOwner, customerId: string): Promise<boolean> {
  if (owner.customerId === customerId) return true;
  if (owner.kind !== "chat" && owner.kind !== "bike") return false;
  const claims = await legacyClaims(pathname);
  return claims.some((c) => c.shopId === owner.shopId && c.customerId === customerId);
}

/**
 * May this request read this file? Order: a valid signature; an explicitly
 * public file; staff of the owning shop; the customer it belongs to. A host
 * that names a different shop is refused for session-based access, so a
 * session can't be replayed against another tenant's hostname either.
 */
export async function authorizeBlobRequest(request: NextRequest, pathname: string): Promise<BlobAccess> {
  const params = request.nextUrl.searchParams;
  const exp = params.get("exp");
  if (verifyBlobSignature(pathname, exp, params.get("sig"))) {
    return { ok: true, via: "signature", owner: null, expiresAt: Number(exp) };
  }

  const owner = await resolveBlobOwner(pathname);
  if (!owner) return { ok: false };
  if (owner.isPublic) return { ok: true, via: "public", owner };

  const host = requestHost(request.headers);
  const hostShop = await getShopForHost(host);
  if (hostShop && hostShop.id !== owner.shopId) return { ok: false };

  if ((await staffShopId(request)) === owner.shopId) return { ok: true, via: "staff", owner };

  const customer = await customerSessionFromRequest(request);
  if (customer && customer.shopId === owner.shopId && (await customerOwnsBlob(pathname, owner, customer.customerId))) {
    return { ok: true, via: "customer", owner };
  }

  return { ok: false };
}

/**
 * Who is uploading chat media for this shop: its staff, or one of its
 * customers. Null for anyone else — chat uploads are never anonymous.
 */
export async function chatUploader(
  request: NextRequest,
  shopId: string
): Promise<{ kind: "staff" } | { kind: "customer"; customerId: string } | null> {
  if ((await staffShopId(request)) === shopId) return { kind: "staff" };
  const customer = await customerSessionFromRequest(request);
  if (customer && customer.shopId === shopId) return { kind: "customer", customerId: customer.customerId };
  return null;
}
