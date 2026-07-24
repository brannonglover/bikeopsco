/**
 * Writes public/bikeops-sw.js with the current deploy SHA baked in.
 * Run before `next build` so production deploys get a new worker byte-for-byte
 * (which is how the browser detects an update and parks it in `waiting`).
 */
const fs = require("fs");
const path = require("path");

const version =
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
  "local-dev";

const sw = `/* Bike Ops soft-update service worker — ${version} */
/* eslint-disable no-restricted-globals */
const VERSION = ${JSON.stringify(version)};
const CACHE_NAME = "bikeops-app-" + VERSION;

/** Paths that must always hit the network (never freeze on an old response). */
function isNetworkOnly(url) {
  const p = url.pathname;
  if (p.startsWith("/api/")) return true;
  if (p.startsWith("/_next/webpack-hmr")) return true;
  if (p === "/login" || p.startsWith("/login/")) return true;
  if (p === "/signup" || p.startsWith("/signup/")) return true;
  if (p.startsWith("/admin")) return true;
  if (p.startsWith("/widget")) return true;
  if (p === "/book" || p.startsWith("/book/")) return true;
  if (p.startsWith("/status/")) return true;
  if (p.startsWith("/pay/")) return true;
  if (p.startsWith("/preferences/")) return true;
  if (p === "/chat/c" || p.startsWith("/chat/c/")) return true;
  if (p === "/bikeops-sw.js") return true;
  return false;
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

self.addEventListener("install", (event) => {
  // Stay in waiting until the staff user clicks "Update now".
  event.waitUntil(caches.open(CACHE_NAME).then(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("bikeops-app-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (isNetworkOnly(url)) return;

  const isNavigate = request.mode === "navigate";
  const isRsc =
    request.headers.get("RSC") === "1" ||
    request.headers.get("Next-Router-Prefetch") === "1" ||
    url.searchParams.has("_rsc");

  // Freeze the staff UI on the version that first controlled this browser:
  // serve cache when present; only populate cache on a miss (first visit).
  if (isNavigate || isRsc || isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    try {
      await cache.put(request, response.clone());
    } catch {
      // Ignore quota / opaque failures — still return the network response.
    }
  }
  return response;
}
`;

const outPath = path.join(__dirname, "..", "public", "bikeops-sw.js");
fs.writeFileSync(outPath, sw);
console.log(`Wrote ${outPath} (version ${version})`);
