import { prisma } from "@/lib/db";

/**
 * Whether a staff session JWT is still good: its user exists and it was issued
 * at the user's current session version. A password reset bumps the version,
 * which is what signs out every web and mobile login made before it.
 *
 * Tokens issued before the version was stamped carry none and count as 0, the
 * column's default, so they keep working until the first reset.
 *
 * A single primary-key read, no transaction or lock: chat read paths run it on
 * every request. Throws if the database can't be reached; callers decide
 * whether that fails open or closed.
 */
export async function isSessionCurrent(token: { id?: unknown; sessionVersion?: unknown }): Promise<boolean> {
  if (typeof token.id !== "string") return false;
  const user = await prisma.user.findUnique({
    where: { id: token.id },
    select: { sessionVersion: true },
  });
  if (!user) return false;
  const version = typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
  return user.sessionVersion === version;
}
