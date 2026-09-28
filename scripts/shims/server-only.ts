/**
 * Stands in for the `server-only` marker when a check script runs outside Next.
 *
 * `server-only` is not a real package here — Next resolves it internally to a
 * module that throws if it ever reaches a client bundle. A plain ts-node run
 * has no such resolution, so importing anything that carries the marker fails
 * to start. Mapped in scripts/tsconfig.scripts.json, for scripts only; the app
 * build still gets Next's own version and the guarantee it provides.
 */
export {};
