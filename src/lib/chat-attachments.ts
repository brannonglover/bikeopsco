import { prisma } from "@/lib/db";
import { normalizeBlobPathname } from "@/lib/blob-signing";

/**
 * True when every id is an upload of this shop that no message has claimed
 * yet. `connect` by id alone would move an attachment out of another shop's
 * or another conversation's message into this one.
 *
 * With `uploadedBy`, each file must also be that customer's own upload (its
 * BlobAsset row, written when the upload was issued, names them): a customer
 * can't send another customer's pending upload, even in the same shop. An
 * attachment with no such row — one that predates the registry — is refused.
 */
export async function attachmentsAreAttachable(
  shopId: string,
  attachmentIds: string[],
  opts?: { uploadedBy?: string }
): Promise<boolean> {
  const ids = [...new Set(attachmentIds)];
  if (ids.length === 0) return true;
  const rows = await prisma.messageAttachment.findMany({
    where: { id: { in: ids }, shopId, messageId: null },
    select: { url: true },
  });
  if (rows.length !== ids.length) return false;
  if (opts?.uploadedBy === undefined) return true;

  const pathnames = rows.map((r) => pathnameOf(r.url));
  if (pathnames.some((p) => !p)) return false;
  const owned = await prisma.blobAsset.count({
    where: { pathname: { in: pathnames as string[] }, shopId, customerId: opts.uploadedBy },
  });
  return owned === new Set(pathnames).size;
}

/** The store pathname an attachment URL (proxy or direct) points at. */
function pathnameOf(url: string): string | null {
  if (url.startsWith("/api/blob?")) {
    return normalizeBlobPathname(new URLSearchParams(url.slice("/api/blob?".length)).get("path"));
  }
  return normalizeBlobPathname(url);
}
