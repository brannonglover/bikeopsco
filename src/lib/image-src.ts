/**
 * Images served by the private-file proxy (/api/blob) must be loaded by the
 * browser itself, with the viewer's own session or a signed link. Next's
 * image optimizer fetches the source from the server with no session, so the
 * proxy (rightly) refuses it — pass this as `unoptimized` on <Image>.
 * Kept free of server imports so client components can use it.
 */
export function isPrivateFileUrl(src: unknown): boolean {
  return typeof src === "string" && /(^|\/\/[^/]+)\/api\/blob\?/.test(src);
}
