import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export const PASSWORD_RESET_EXPIRY_MINUTES = 60;

/** A second request inside this window sends nothing. */
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
/** Cap on links issued per account per hour, so the form can't be used to flood an inbox. */
const PASSWORD_RESET_MAX_PER_HOUR = 5;

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The token rides in the URL fragment, like customer magic links: it never
 * reaches server logs or a Referer header, and a link scanner fetching the page
 * can't spend it (only the POST with a new password does).
 */
export function buildPasswordResetUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/login/reset#token=${encodeURIComponent(token)}`;
}

type IssueResult = { ok: true; token: string } | { ok: false; reason: "throttled" };

export async function issuePasswordResetToken(userId: string): Promise<IssueResult> {
  const now = Date.now();
  const recent = await prisma.passwordResetToken.findMany({
    where: { userId, createdAt: { gt: new Date(now - 60 * 60 * 1000) } },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (
    recent.length >= PASSWORD_RESET_MAX_PER_HOUR ||
    (recent[0] && now - recent[0].createdAt.getTime() < PASSWORD_RESET_COOLDOWN_MS)
  ) {
    return { ok: false, reason: "throttled" };
  }

  const token = randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashPasswordResetToken(token),
      expiresAt: new Date(now + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000),
    },
  });

  // Housekeeping: links that can no longer be used, for anyone.
  await prisma.passwordResetToken
    .deleteMany({ where: { expiresAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } } })
    .catch(() => {});

  return { ok: true, token };
}

type ResetResult = { ok: true; userId: string } | { ok: false; reason: "invalid" | "expired" };

/**
 * Sets a new password from a reset link. `shopId` is the shop the request's
 * host serves: a link only works on its own shop's host, the same rule login
 * follows.
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
  shopId: string,
): Promise<ResetResult> {
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashPasswordResetToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { shopId: true } } },
  });
  if (!row || row.usedAt || row.user.shopId !== shopId) {
    return { ok: false, reason: "invalid" };
  }
  if (row.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  const claimed = await prisma.$transaction(async (tx) => {
    // Claim the token first so two concurrent submits can't both succeed.
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (count !== 1) return false;

    // Bumping the session version signs out every existing web and mobile login.
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    // Any other outstanding links for this account stop working too.
    await tx.passwordResetToken.deleteMany({ where: { userId: row.userId, id: { not: row.id } } });
    return true;
  });

  return claimed ? { ok: true, userId: row.userId } : { ok: false, reason: "invalid" };
}
