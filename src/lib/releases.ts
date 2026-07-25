/**
 * @deprecated Prefer `@/lib/platform-releases` (DB-backed published notes).
 * Kept as a thin re-export surface for any leftover imports.
 */
export {
  getReleaseNotesPublicUrl as getReleaseNotesUrl,
  releaseAnchorId,
} from "@/lib/platform-releases";
