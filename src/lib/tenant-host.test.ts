/**
 * Host classification (which shop, if any, a hostname serves), forwarded-host
 * trust, the private-Blob path/signature rules and the SSRF guard. No
 * database and no outside network.
 *
 *   npm run test:security
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyHost, parseDefaultShopHosts } from "./tenant-domain";
import { blobSignatureQuery, normalizeBlobPathname, signBlobUrl, verifyBlobSignature } from "./blob-signing";
import { requestOrigin, resolveRequestHost } from "./request-host";
import {
  assertFetchableUrl,
  isPublicAddress,
  publicOnlyLookup,
  safeFetch,
  safeFetchInternals,
  UnsafeUrlError,
} from "./safe-fetch";

const opts = { rootDomain: "bikeops.co", defaultShopHosts: parseDefaultShopHosts("dev.bikeops.co, *.preview.example.com") };

describe("classifyHost", () => {
  it("a shop subdomain is that tenant, whatever the case or port", () => {
    assert.deepEqual(classifyHost("acme.bikeops.co", opts), { kind: "tenant", subdomain: "acme" });
    assert.deepEqual(classifyHost("ACME.BikeOps.co:443", opts), { kind: "tenant", subdomain: "acme" });
  });

  it("the shared app host serves no shop", () => {
    assert.deepEqual(classifyHost("app.bikeops.co", opts), { kind: "shared" });
  });

  it("unknown hosts fail closed instead of falling back to the default shop", () => {
    for (const host of [
      "bikeops.co",
      "www.bikeops.co",
      "evil.example.com",
      "bikeops-git-main-team.vercel.app",
      "acme.bikeops.co.evil.com",
      "",
      null,
    ]) {
      assert.deepEqual(classifyHost(host, opts), { kind: "unknown" }, String(host));
    }
  });

  it("a custom domain is unknown until it's mapped — it can't borrow a shop", () => {
    assert.deepEqual(classifyHost("shop.acmebikes.com", opts), { kind: "unknown" });
  });

  it("only hosts named in DEFAULT_SHOP_HOSTS serve the default shop", () => {
    assert.deepEqual(classifyHost("dev.bikeops.co", opts), { kind: "default" });
    assert.deepEqual(classifyHost("pr-12.preview.example.com", opts), { kind: "default" });
    assert.deepEqual(classifyHost("preview.example.com", opts), { kind: "unknown" }, "wildcard needs a label");
    assert.deepEqual(classifyHost("dev.bikeops.co", { rootDomain: "bikeops.co" }), { kind: "unknown" });
  });

  it("localhost is the default shop in development only", () => {
    assert.deepEqual(classifyHost("localhost:3000", { ...opts, allowLocalhost: true }), { kind: "default" });
    assert.deepEqual(classifyHost("localhost:3000", { ...opts, allowLocalhost: false }), { kind: "unknown" });
    assert.deepEqual(classifyHost("acme.localhost:3000", opts), { kind: "tenant", subdomain: "acme" });
  });
});

describe("blob pathnames", () => {
  it("accepts a store pathname, or a URL in our store", () => {
    assert.equal(normalizeBlobPathname("chat/abc.jpg"), "chat/abc.jpg");
    assert.equal(
      normalizeBlobPathname("https://store1.private.blob.vercel-storage.com/bikes/x%20y.png"),
      "bikes/x y.png"
    );
  });

  it("rejects traversal, absolute paths, odd characters and foreign hosts", () => {
    for (const raw of [
      "../secrets.txt",
      "chat/../../x",
      "/chat/abc.jpg",
      "chat//abc.jpg",
      "chat\\abc.jpg",
      "chat/abc.jpg?x=1",
      "chat/a\u0000b",
      "https://evil.example.com/chat/abc.jpg",
      "http://store1.private.blob.vercel-storage.com/chat/abc.jpg",
      "",
    ]) {
      assert.equal(normalizeBlobPathname(raw), null, JSON.stringify(raw));
    }
  });
});

describe("signed blob URLs", () => {
  process.env.BLOB_URL_SIGNING_SECRET = "unit-test-secret";

  it("a signature is good for its own pathname until it expires", () => {
    const now = Date.UTC(2026, 9, 19, 12, 0, 0);
    const q = new URLSearchParams(blobSignatureQuery("chat/a.jpg", 3600, now)!);
    assert.ok(verifyBlobSignature("chat/a.jpg", q.get("exp"), q.get("sig"), now));
    assert.equal(verifyBlobSignature("chat/b.jpg", q.get("exp"), q.get("sig"), now), false, "other file");
    const later = (Number(q.get("exp")) + 1) * 1000;
    assert.equal(verifyBlobSignature("chat/a.jpg", q.get("exp"), q.get("sig"), later), false, "expired");
    assert.equal(
      verifyBlobSignature("chat/a.jpg", String(Number(q.get("exp")) + 3600), q.get("sig"), now),
      false,
      "extended expiry"
    );
    assert.equal(verifyBlobSignature("chat/a.jpg", q.get("exp"), "x" + q.get("sig")!.slice(1), now), false, "tampered");
    assert.equal(verifyBlobSignature("chat/a.jpg", null, null, now), false, "unsigned");
  });

  it("signs proxy URLs only, absolute or relative", () => {
    const rel = signBlobUrl("/api/blob?path=chat%2Fa.jpg&v=1");
    assert.match(rel, /^\/api\/blob\?path=chat%2Fa\.jpg&v=1&exp=\d+&sig=/);
    const abs = signBlobUrl("https://acme.bikeops.co/api/blob?path=chat%2Fa.jpg");
    assert.match(abs, /^https:\/\/acme\.bikeops\.co\/api\/blob\?path=chat%2Fa\.jpg&exp=\d+&sig=/);
    assert.equal(signBlobUrl("https://cdn.example.com/x.jpg"), "https://cdn.example.com/x.jpg");
    assert.equal(signBlobUrl("/api/blob?path=..%2Fx"), "/api/blob?path=..%2Fx", "bad path left unsigned");
  });

  it("re-signing within the hour yields the same URL, so pollers keep their cache", () => {
    assert.equal(signBlobUrl("/api/blob?path=chat%2Fa.jpg"), signBlobUrl("/api/blob?path=chat%2Fa.jpg"));
  });
});

describe("forwarded host", () => {
  it("is believed only when it names the host the request was routed by", () => {
    assert.equal(resolveRequestHost("acme.bikeops.co", null), "acme.bikeops.co");
    assert.equal(resolveRequestHost("acme.bikeops.co", "acme.bikeops.co"), "acme.bikeops.co");
    assert.equal(resolveRequestHost("acme.bikeops.co:443", "ACME.bikeops.co"), "acme.bikeops.co:443");
    assert.equal(resolveRequestHost("acme.bikeops.co", "other.bikeops.co"), null, "another shop");
    assert.equal(resolveRequestHost("acme.bikeops.co", "evil.example.com"), null, "a foreign domain");
    assert.equal(resolveRequestHost("acme.bikeops.co", "acme.bikeops.co, evil.example.com"), null, "a chain");
    assert.equal(resolveRequestHost(null, "acme.bikeops.co"), null, "no Host at all");
  });

  it("links use https, and http only on local dev hosts", () => {
    const h = (host: string, fwd?: Record<string, string>) => new Headers({ host, ...fwd });
    assert.equal(requestOrigin(h("acme.bikeops.co")), "https://acme.bikeops.co");
    assert.equal(requestOrigin(h("acme.bikeops.co", { "x-forwarded-proto": "http" })), "https://acme.bikeops.co");
    assert.equal(requestOrigin(h("acme.bikeops.co", { "x-forwarded-proto": "javascript" })), "https://acme.bikeops.co");
    assert.equal(requestOrigin(h("acme.localhost:3000")), "http://acme.localhost:3000");
    assert.equal(requestOrigin(h("acme.bikeops.co", { "x-forwarded-host": "evil.example.com" })), null);
  });
});

describe("guarded fetch (SSRF)", () => {
  it("only public addresses count as public", () => {
    for (const a of ["8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(a), true, a);
    for (const a of [
      "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.1.1", "0.0.0.0",
      "224.0.0.1", "255.255.255.255", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
      "::ffff:a9fe:a9fe", "2002:7f00:1::1", "64:ff9b::7f00:1", "not-an-ip",
    ]) {
      assert.equal(isPublicAddress(a), false, a);
    }
  });

  it("refuses non-web schemes, odd ports, credentials and private literals before any request", () => {
    for (const u of [
      "file:///etc/passwd", "ftp://example.com/x", "gopher://example.com/", "javascript:alert(1)",
      "https://example.com:8443/", "http://example.com:22/", "http://user:pw@example.com/",
      "http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "http://0x7f.1/", "http://169.254.169.254/latest",
      "http://localhost/", "http://printer.local/", "http://db.internal/",
    ]) {
      assert.throws(() => assertFetchableUrl(u), UnsafeUrlError, u);
    }
    assert.equal(assertFetchableUrl("https://example.com/a.jpg").hostname, "example.com");
  });

  it("vets the address on every connect, so DNS rebinding is refused", async () => {
    const answers = [[{ address: "93.184.216.34", family: 4 }], [{ address: "127.0.0.1", family: 4 }]];
    const resolve = (_h: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) =>
      cb(null, answers.shift()!);
    const lookup = publicOnlyLookup(resolve as never);
    const call = () =>
      new Promise<string>((ok, fail) =>
        lookup("rebind.example", {}, (err, address) => (err ? fail(err) : ok(address as string)))
      );
    assert.equal(await call(), "93.184.216.34", "first answer is public");
    await assert.rejects(call(), UnsafeUrlError, "same name now points inside");

    const mixed = publicOnlyLookup(((_h: string, _o: unknown, cb: (e: null, a: unknown[]) => void) =>
      cb(null, [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.5", family: 4 }])) as never);
    await assert.rejects(
      new Promise((ok, fail) => mixed("mixed.example", {}, (err) => (err ? fail(err) : ok(null)))),
      UnsafeUrlError,
      "any private answer refuses the name"
    );
  });

  it("re-checks every redirect hop and caps the number of hops", async () => {
    const original = safeFetchInternals.requestOnce;
    const hops: string[] = [];
    const redirectTo = (target: string) => {
      safeFetchInternals.requestOnce = (async (url: URL) => {
        hops.push(url.href);
        return { status: 302, headers: { location: target }, body: Buffer.alloc(0), truncated: false, url };
      }) as never;
    };
    try {
      for (const target of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "http://[::1]:80/"]) {
        redirectTo(target);
        await assert.rejects(safeFetch("https://example.com/img.jpg", { maxBytes: 100 }), UnsafeUrlError, target);
      }
      redirectTo("/again");
      await assert.rejects(safeFetch("https://example.com/img.jpg", { maxBytes: 100 }), /Too many redirects/);
      assert.ok(hops.every((h) => h.startsWith("https://example.com/")), "never requested a private hop");
    } finally {
      safeFetchInternals.requestOnce = original;
    }
  });

  it("caps the body: refuses an oversized image, truncates a page when asked", async () => {
    const http = await import("http");
    const server = http.createServer((_req, res) => res.end(Buffer.alloc(5000, 97)));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      // Straight to the single-request step: the URL screen would (rightly) refuse 127.0.0.1.
      const url = new URL(`http://127.0.0.1:${port}/`);
      await assert.rejects(
        safeFetchInternals.requestOnce(url, { maxBytes: 1000 }, Date.now() + 5000),
        /too large/
      );
      const cut = await safeFetchInternals.requestOnce(url, { maxBytes: 1000, truncate: true }, Date.now() + 5000);
      assert.equal(cut.body.length, 1000);
      assert.equal(cut.truncated, true);
    } finally {
      server.close();
    }
  });
});
