/**
 * Hostname manipulation and private Blob access, with two real shops and real
 * signed sessions: the shop always comes from the session (or the file's
 * owner), never from the hostname alone. Middleware, direct handler calls,
 * public booking, customer sessions, custom/unknown domains and the Blob
 * proxy — against staging.
 *
 *   npm run test:security:db
 *
 * Runs only with RUN_CATALOG_DB_TESTS=1 and refuses a production database.
 * Every denial has a positive control: the same request by the rightful
 * owner succeeds, so a 401/404 here means authorization refused it.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { createTestShop, loadTestEnv, request, type TestShop } from "./test-support/route-harness";

const ENABLED = process.env.RUN_CATALOG_DB_TESTS === "1";
const RUN = Date.now().toString(36);
const UNKNOWN_HOSTS = ["bikeops.co", "www.bikeops.co", "evil.example.com", "bikeops-git-main.vercel.app"];
const DEFAULT_HOST = "dev.bikeops.co";
const CUSTOM_DOMAIN = "shop.acmebikes-test.com";

type Prisma = typeof import("@/lib/db")["prisma"];
let prisma: Prisma;
let mw: typeof import("../../middleware");
let blobAccess: typeof import("./blob-access");
let attachments: typeof import("./chat-attachments");
let R: {
  customers: typeof import("@/app/api/customers/route");
  conversations: typeof import("@/app/api/conversations/route");
  emailTemplates: typeof import("@/app/api/email-templates/route");
  branding: typeof import("@/app/api/settings/branding/route");
  reviewLinks: typeof import("@/app/api/settings/review-links/route");
  widgetServices: typeof import("@/app/api/widget/services/route");
  blob: typeof import("@/app/api/blob/route");
  chatComplete: typeof import("@/app/api/chat/upload/complete/route");
  chatToken: typeof import("@/app/api/chat/upload/token/route");
  staffMessages: typeof import("@/app/api/conversations/[id]/messages/route");
  history: typeof import("@/app/api/customers/[id]/history/route");
  sendInvite: typeof import("@/app/api/chat/send-invite/route");
  pushTokens: typeof import("@/app/api/push-tokens/route");
  importImage: typeof import("@/app/api/bikes/import-image/route");
  ogPreview: typeof import("@/app/api/og-preview/route");
  testSend: typeof import("@/app/api/email-templates/test-send/route");
  platformEmailTest: typeof import("@/app/api/platform/email-test/route");
  smsWebhook: typeof import("@/app/api/webhooks/twilio/sms/route");
  voicemail: typeof import("@/app/api/webhooks/twilio/voice/voicemail/route");
  job: typeof import("@/app/api/jobs/[id]/route");
};

let A: TestShop;
let B: TestShop;
const f: Record<string, string> = {};
const path = (name: string) => `sec-${RUN}/${name}`;
const blobUrl = (pathname: string, extra = "") => `/api/blob?path=${encodeURIComponent(pathname)}${extra}`;

function status(res: Response) {
  return res.status;
}

/** Middleware verdict: "next", a redirect target, or the error status. */
async function viaMiddleware(req: NextRequest): Promise<string> {
  const res = await mw.middleware(req);
  if (res.headers.get("x-middleware-next") === "1") return "next";
  const location = res.headers.get("location");
  return location ? `redirect ${new URL(location).host}${new URL(location).pathname}` : String(res.status);
}

async function chatSession(shopId: string, customerId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await prisma.chatSession.create({
    data: { shopId, customerId, token, expiresAt: new Date(Date.now() + 3600_000) },
  });
  return `chat_session=${token}`;
}

describe("tenant hostnames and private files", { skip: !ENABLED && "set RUN_CATALOG_DB_TESTS=1" }, () => {
  before(async () => {
    loadTestEnv();
    process.env.DEFAULT_SHOP_HOSTS = DEFAULT_HOST;
    process.env.BLOB_URL_SIGNING_SECRET = `test-${RUN}`;
    process.env.TWILIO_AUTH_TOKEN = `twilio-test-${RUN}`;
    delete process.env.TWILIO_WEBHOOK_URL;
    // Denials never reach the store; a stand-in token keeps the proxy from
    // answering 503 before it gets to authorization.
    process.env.BLOB_READ_WRITE_TOKEN ||= "vercel_blob_rw_teststore_notarealsecret";
    ({ prisma } = await import("@/lib/db"));
    mw = await import("../../middleware");
    blobAccess = await import("./blob-access");
    attachments = await import("./chat-attachments");
    R = {
      customers: await import("@/app/api/customers/route"),
      conversations: await import("@/app/api/conversations/route"),
      emailTemplates: await import("@/app/api/email-templates/route"),
      branding: await import("@/app/api/settings/branding/route"),
      reviewLinks: await import("@/app/api/settings/review-links/route"),
      widgetServices: await import("@/app/api/widget/services/route"),
      blob: await import("@/app/api/blob/route"),
      chatComplete: await import("@/app/api/chat/upload/complete/route"),
      chatToken: await import("@/app/api/chat/upload/token/route"),
      staffMessages: await import("@/app/api/conversations/[id]/messages/route"),
      history: await import("@/app/api/customers/[id]/history/route"),
      sendInvite: await import("@/app/api/chat/send-invite/route"),
      pushTokens: await import("@/app/api/push-tokens/route"),
      importImage: await import("@/app/api/bikes/import-image/route"),
      ogPreview: await import("@/app/api/og-preview/route"),
      testSend: await import("@/app/api/email-templates/test-send/route"),
      platformEmailTest: await import("@/app/api/platform/email-test/route"),
      smsWebhook: await import("@/app/api/webhooks/twilio/sms/route"),
      voicemail: await import("@/app/api/webhooks/twilio/voice/voicemail/route"),
      job: await import("@/app/api/jobs/[id]/route"),
    };
    A = await createTestShop(prisma, `zzha-${RUN}`);
    B = await createTestShop(prisma, `zzhb-${RUN}`);

    for (const [label, shop] of [["a", A], ["b", B]] as const) {
      const c1 = await prisma.customer.create({ data: { shopId: shop.id, firstName: `Host ${label}1 ${RUN}` } });
      const c2 = await prisma.customer.create({ data: { shopId: shop.id, firstName: `Host ${label}2 ${RUN}` } });
      const svc = await prisma.service.create({ data: { shopId: shop.id, name: `Svc ${label} ${RUN}`, price: 10 } });
      const conv = await prisma.conversation.create({ data: { shopId: shop.id, customerId: c1.id } });
      const loose = await prisma.messageAttachment.create({
        data: { shopId: shop.id, url: blobUrl(path(`${label}-loose.jpg`)), filename: "x.jpg", mimeType: "image/jpeg" },
      });
      const msg = await prisma.message.create({ data: { shopId: shop.id, conversationId: conv.id, sender: "CUSTOMER", body: "hi" } });
      const sent = await prisma.messageAttachment.create({
        data: { shopId: shop.id, messageId: msg.id, url: blobUrl(path(`${label}-sent.jpg`)), filename: "y.jpg", mimeType: "image/jpeg" },
      });
      Object.assign(f, {
        [`${label}Customer`]: c1.id,
        [`${label}Customer2`]: c2.id,
        [`${label}Service`]: svc.id,
        [`${label}Conversation`]: conv.id,
        [`${label}Loose`]: loose.id,
        [`${label}Sent`]: sent.id,
      });
    }

    // Shop A's files: a staff bike photo on customer a1's bike, a1's own
    // upload, a public logo. Shop B: a private chat photo.
    await blobAccess.registerBlobAsset({ pathname: path("a-bike.jpg"), shopId: A.id, kind: "bike" });
    await prisma.bike.create({
      data: { shopId: A.id, customerId: f.aCustomer, make: "Trek", imageUrl: blobUrl(path("a-bike.jpg"), "&v=1") },
    });
    await blobAccess.registerBlobAsset({ pathname: path("a-mine.jpg"), shopId: A.id, kind: "customer-upload", customerId: f.aCustomer });
    await blobAccess.registerBlobAsset({ pathname: path("a-logo.png"), shopId: A.id, kind: "logo" });
    await blobAccess.registerBlobAsset({ pathname: path("b-chat.jpg"), shopId: B.id, kind: "chat" });
    // Legacy files (uploaded before the registry): known only by reference.
    await prisma.bike.create({
      data: { shopId: A.id, customerId: f.aCustomer, make: "Giant", imageUrl: blobUrl(path("a-legacy.jpg"), "&v=2") },
    });
    await prisma.bike.create({
      data: { shopId: A.id, customerId: f.aCustomer2, make: "Cannondale", imageUrl: blobUrl(path("contested.jpg")) },
    });
    await prisma.product.create({ data: { shopId: B.id, name: `P ${RUN}`, price: 1, imageUrl: blobUrl(path("contested.jpg")) } });

    f.a1Session = await chatSession(A.id, f.aCustomer);
    f.a2Session = await chatSession(A.id, f.aCustomer2);
    f.b1Session = await chatSession(B.id, f.bCustomer);
  });

  after(async () => {
    if (!prisma) return;
    await prisma.blobAsset.deleteMany({ where: { pathname: { startsWith: `sec-${RUN}/` } } });
    await prisma.shop.deleteMany({ where: { id: { in: [A?.id, B?.id].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  describe("middleware", () => {
    it("lets a session through only on its own shop's host", async () => {
      assert.equal(await viaMiddleware(request("GET", "/api/customers", { host: A.host, as: A })), "next", "control");
      assert.equal(await viaMiddleware(request("GET", "/api/customers", { host: B.host, as: A })), "401");
      assert.equal(await viaMiddleware(request("GET", "/api/customers", { host: DEFAULT_HOST, as: A })), "401");
      assert.equal(await viaMiddleware(request("GET", "/api/customers", { host: CUSTOM_DOMAIN, as: A })), "401");
      for (const host of UNKNOWN_HOSTS) {
        assert.equal(await viaMiddleware(request("GET", "/api/customers", { host, as: A })), "401", host);
      }
    });

    it("sends a page request on an unknown or shared host to the session's own shop", async () => {
      assert.equal(await viaMiddleware(request("GET", "/customers", { host: "bikeops.co", as: A })), `redirect ${A.host}/customers`);
      assert.equal(await viaMiddleware(request("GET", "/customers", { host: "app.bikeops.co", as: A })), `redirect ${A.host}/customers`);
      assert.match(await viaMiddleware(request("GET", "/customers", { host: B.host, as: A })), /^redirect .*\/login$/);
    });

    it("leaves /api/blob to the handler, which authorizes by owner", () => {
      const [matcher] = mw.config.matcher;
      const re = new RegExp(`^${matcher}$`);
      assert.equal(re.test("/api/blob"), false);
      assert.equal(re.test("/api/customers"), true, "control: staff APIs still matched");
    });
  });

  describe("direct handler calls (no middleware)", () => {
    it("staff APIs refuse another shop's host, unknown hosts and the default-shop host", async () => {
      const ok = await R.customers.GET(request("GET", "/api/customers", { host: A.host, as: A }));
      assert.equal(ok.status, 200, "control");
      const list = (await ok.json()) as { id: string }[] | { customers: { id: string }[] };
      const ids = (Array.isArray(list) ? list : list.customers).map((c) => c.id);
      assert.ok(ids.includes(f.aCustomer) && !ids.includes(f.bCustomer), "only shop A's customers");

      for (const host of [B.host, DEFAULT_HOST, CUSTOM_DOMAIN, ...UNKNOWN_HOSTS]) {
        assert.equal(status(await R.customers.GET(request("GET", "/api/customers", { host, as: A }))), 401, host);
        assert.equal(status(await R.conversations.GET(request("GET", "/api/conversations", { host, as: A }))), 401, host);
        assert.equal(status(await R.emailTemplates.GET(request("GET", "/api/email-templates", { host, as: A }))), 401, host);
      }
    });

    it("a forwarded-host header can't move a session to another shop", async () => {
      const res = await R.customers.GET(
        request("GET", "/api/customers", { host: A.host, as: A, headers: { "x-forwarded-host": B.host } })
      );
      assert.equal(res.status, 401);
    });

    it("writes aimed at another shop's host change nothing", async () => {
      const before = await prisma.appSettings.findUnique({ where: { shopId: B.id } });
      const put = await R.branding.PUT(
        request("PUT", "/api/settings/branding", { host: B.host, as: A, body: { address: "Hijacked" } })
      );
      assert.equal(put.status, 401);
      const reviewPut = await R.reviewLinks.PUT(
        request("PUT", "/api/settings/review-links", { host: B.host, as: A, body: { googleReviewUrl: "https://evil.example.com" } })
      );
      assert.equal(reviewPut.status, 401);
      assert.deepEqual(await prisma.appSettings.findUnique({ where: { shopId: B.id } }), before);

      const own = await R.branding.PUT(
        request("PUT", "/api/settings/branding", { host: A.host, as: A, body: { address: `A street ${RUN}` } })
      );
      assert.equal(own.status, 200, "control");
    });

    it("customer history is only readable by the customer's own shop", async () => {
      const job = await prisma.job.create({ data: { shopId: B.id, customerId: f.bCustomer, bikeMake: "Trek", bikeModel: "X" } });
      const history = (as: TestShop, host: string) =>
        R.history.GET(request("GET", `/api/customers/${f.bCustomer}/history`, { host, as }), {
          params: Promise.resolve({ id: f.bCustomer }),
        });
      const own = await history(B, B.host);
      assert.equal(own.status, 200, "control");
      assert.deepEqual(((await own.json()) as { id: string }[]).map((j) => j.id), [job.id]);
      const asA = await history(A, A.host);
      assert.equal(asA.status, 200);
      assert.deepEqual(await asA.json(), [], "A's staff see none of it");
      assert.equal((await history(A, B.host)).status, 401);
    });

    it("chat sign-in invites need the shop's staff (the route is outside middleware)", async () => {
      const anon = await R.sendInvite.POST(
        request("POST", "/api/chat/send-invite", { host: B.host, body: { customerId: f.bCustomer } })
      );
      assert.notEqual(anon.status, 200);
      const crossShop = await R.sendInvite.POST(
        request("POST", "/api/chat/send-invite", { host: B.host, as: A, body: { customerId: f.bCustomer } })
      );
      assert.equal(crossShop.status, 401);
      assert.equal(await prisma.magicLinkToken.count({ where: { customerId: f.bCustomer } }), 0);
    });

    it("signed out is refused", async () => {
      const res = await R.customers.GET(request("GET", "/api/customers", { host: A.host }));
      assert.notEqual(res.status, 200);
    });
  });

  describe("public booking", () => {
    it("serves each shop's own public data by its host, and nothing on unknown hosts", async () => {
      const a = await R.widgetServices.GET(request("GET", "/api/widget/services", { host: A.host }));
      assert.equal(a.status, 200);
      const ids = ((await a.json()) as { id: string }[]).map((s) => s.id);
      assert.ok(ids.includes(f.aService) && !ids.includes(f.bService));

      for (const host of [CUSTOM_DOMAIN, ...UNKNOWN_HOSTS]) {
        assert.equal(status(await R.widgetServices.GET(request("GET", "/api/widget/services", { host }))), 404, host);
      }
    });
  });

  describe("private Blob proxy", () => {
    const blobGet = (pathname: string, opts: { host: string; as?: TestShop; cookie?: string; extra?: string; raw?: string }) =>
      R.blob.GET(
        request("GET", opts.raw ?? blobUrl(pathname, opts.extra), {
          host: opts.host,
          as: opts.as,
          headers: opts.cookie ? { cookie: opts.cookie } : undefined,
        })
      );
    const decide = async (pathname: string, opts: { host: string; as?: TestShop; cookie?: string; extra?: string }) => {
      const req = request("GET", blobUrl(pathname, opts.extra), {
        host: opts.host,
        as: opts.as,
        headers: opts.cookie ? { cookie: opts.cookie } : undefined,
      });
      const access = await blobAccess.authorizeBlobRequest(req, pathname);
      return access.ok ? access.via : "denied";
    };

    it("staff read their own shop's private files, and only those", async () => {
      assert.equal(await decide(path("a-bike.jpg"), { host: A.host, as: A }), "staff", "control");
      assert.equal(status(await blobGet(path("a-bike.jpg"), { host: B.host, as: B })), 404);
      assert.equal(status(await blobGet(path("a-bike.jpg"), { host: A.host, as: B })), 404, "B's session on A's host");
      assert.equal(status(await blobGet(path("a-bike.jpg"), { host: B.host, as: A })), 404, "A's session on B's host");
      assert.equal(status(await blobGet(path("a-bike.jpg"), { host: A.host })), 404, "signed out");
      assert.equal(status(await blobGet(path("b-chat.jpg"), { host: A.host, as: A })), 404);
      assert.equal(await decide(path("b-chat.jpg"), { host: B.host, as: B }), "staff", "control");
    });

    it("the url= form and other spellings resolve to the same owner check", async () => {
      const storeHost = `${/^vercel_blob_rw_([a-z0-9]+)_/i.exec(process.env.BLOB_READ_WRITE_TOKEN!)![1].toLowerCase()}.private.blob.vercel-storage.com`;
      const direct = `https://${storeHost}/${path("a-bike.jpg")}`;
      assert.equal(status(await blobGet("", { host: B.host, as: B, raw: `/api/blob?url=${encodeURIComponent(direct)}` })), 404);
    });

    it("rejects traversal and foreign hosts before any lookup", async () => {
      for (const raw of [
        `/api/blob?path=${encodeURIComponent(`${path("x")}/../a-bike.jpg`)}`,
        `/api/blob?path=${encodeURIComponent(`/${path("a-bike.jpg")}`)}`,
        `/api/blob?url=${encodeURIComponent(`https://evil.example.com/${path("a-bike.jpg")}`)}`,
      ]) {
        assert.equal(status(await blobGet("", { host: A.host, as: A, raw })), 400, raw);
      }
    });

    it("customers read their own files and nobody else's", async () => {
      assert.equal(await decide(path("a-mine.jpg"), { host: A.host, cookie: f.a1Session }), "customer", "control");
      assert.equal(await decide(path("a-bike.jpg"), { host: A.host, cookie: f.a1Session }), "customer", "photo of their bike");
      assert.equal(status(await blobGet(path("a-mine.jpg"), { host: A.host, cookie: f.a2Session })), 404, "same shop, other customer");
      assert.equal(status(await blobGet(path("a-bike.jpg"), { host: A.host, cookie: f.a2Session })), 404);
      assert.equal(status(await blobGet(path("a-mine.jpg"), { host: A.host, cookie: f.b1Session })), 404, "other shop's customer");
      assert.equal(status(await blobGet(path("a-mine.jpg"), { host: B.host, cookie: f.a1Session })), 404, "own session, other shop's host");
    });

    it("explicitly public files need no session", async () => {
      assert.equal(await decide(path("a-logo.png"), { host: "evil.example.com" }), "public");
      assert.equal(status(await blobGet(path("a-bike.jpg"), { host: "evil.example.com" })), 404, "a private file is not");
    });

    it("a signed URL opens exactly one file until it expires", async () => {
      const signed = new URL(blobAccess.signBlobUrl(blobUrl(path("a-bike.jpg"))), "http://x");
      const query = `&exp=${signed.searchParams.get("exp")}&sig=${signed.searchParams.get("sig")}`;
      assert.equal(await decide(path("a-bike.jpg"), { host: "evil.example.com", extra: query }), "signature", "control");
      assert.equal(status(await blobGet(path("b-chat.jpg"), { host: B.host, extra: query })), 404, "other file");
      const stale = blobAccess.blobSignatureQuery(path("a-bike.jpg"), -7200)!;
      assert.equal(status(await blobGet(path("a-bike.jpg"), { host: A.host, extra: `&${stale}` })), 404, "expired");
    });

    it("a legacy file's owner comes from the records that use it, then is registered", async () => {
      assert.equal(status(await blobGet(path("a-legacy.jpg"), { host: B.host, as: B })), 404);
      const row = await prisma.blobAsset.findUnique({ where: { pathname: path("a-legacy.jpg") } });
      assert.equal(row?.shopId, A.id);
      assert.equal(row?.customerId, f.aCustomer);
      assert.equal(await decide(path("a-legacy.jpg"), { host: A.host, as: A }), "staff", "control");
    });

    it("a file claimed by two shops is refused to both", async () => {
      assert.equal(await decide(path("contested.jpg"), { host: A.host, as: A }), "denied");
      assert.equal(await decide(path("contested.jpg"), { host: B.host, as: B }), "denied");
      assert.equal(await prisma.blobAsset.count({ where: { pathname: path("contested.jpg") } }), 0);
    });
  });

  describe("chat uploads and attachments", () => {
    const storeUrl = (pathname: string) => {
      const id = /^vercel_blob_rw_([a-z0-9]+)_/i.exec(process.env.BLOB_READ_WRITE_TOKEN!)![1].toLowerCase();
      return `https://${id}.private.blob.vercel-storage.com/${pathname}`;
    };
    const complete = (pathname: string, opts: { host: string; as?: TestShop; cookie?: string }) =>
      R.chatComplete.POST(
        request("POST", "/api/chat/upload/complete", {
          host: opts.host,
          as: opts.as,
          headers: opts.cookie ? { cookie: opts.cookie } : undefined,
          body: { url: storeUrl(pathname), pathname, filename: "v.mp4", mimeType: "video/mp4" },
        })
      );

    it("anonymous callers can't request upload tokens or record uploads", async () => {
      const token = await R.chatToken.POST(
        request("POST", "/api/chat/upload/token", { host: A.host, body: { filename: "v.mp4", mimeType: "video/mp4" } })
      );
      assert.equal(token.status, 401);
      assert.equal(status(await complete("chat/whatever.mp4", { host: A.host })), 401);
    });

    it("an upload can only be recorded for a pathname issued to that shop and uploader", async () => {
      await blobAccess.registerBlobAsset({ pathname: `chat/${RUN}-b.mp4`, shopId: B.id, kind: "chat" });
      await blobAccess.registerBlobAsset({ pathname: `chat/${RUN}-a.mp4`, shopId: A.id, kind: "chat" });
      await blobAccess.registerBlobAsset({ pathname: `chat/${RUN}-a1.mp4`, shopId: A.id, kind: "chat", customerId: f.aCustomer });
      try {
        assert.equal(status(await complete(`chat/${RUN}-b.mp4`, { host: A.host, as: A })), 400, "B's file");
        assert.equal(status(await complete(`chat/${RUN}-never-issued.mp4`, { host: A.host, as: A })), 400, "never issued");
        assert.equal(status(await complete(`chat/${RUN}-a1.mp4`, { host: A.host, cookie: f.a2Session })), 400, "another customer's");
        const ok = await complete(`chat/${RUN}-a.mp4`, { host: A.host, as: A });
        assert.equal(ok.status, 200, "control");
        assert.equal(((await ok.json()) as { shopId: string }).shopId, A.id);
      } finally {
        await prisma.blobAsset.deleteMany({ where: { pathname: { startsWith: `chat/${RUN}-` } } });
        await prisma.messageAttachment.deleteMany({ where: { shopId: A.id, filename: "v.mp4" } });
      }
    });

    it("a message can't take another shop's attachment, or one already sent", async () => {
      const send = (attachmentId: string) =>
        R.staffMessages.POST(
          request("POST", `/api/conversations/${f.aConversation}/messages`, {
            host: A.host,
            as: A,
            body: { sender: "STAFF", attachmentIds: [attachmentId] },
          }),
          { params: Promise.resolve({ id: f.aConversation }) } as never
        );
      const bLooseBefore = await prisma.messageAttachment.findUnique({ where: { id: f.bLoose } });
      assert.equal(status(await send(f.bLoose)), 400);
      assert.equal(status(await send(f.aSent)), 400);
      assert.deepEqual(await prisma.messageAttachment.findUnique({ where: { id: f.bLoose } }), bLooseBefore);
      assert.equal((await prisma.messageAttachment.findUnique({ where: { id: f.aSent } }))?.messageId !== null, true);
      assert.equal(await attachments.attachmentsAreAttachable(A.id, [f.aLoose]), true, "control");
    });
  });

  describe("remaining hardening", () => {
    it("a push token can only be removed by the account it's registered to", async () => {
      const staffToken = `ExponentPushToken[staff-${RUN}]`;
      const customerToken = `ExponentPushToken[cust-${RUN}]`;
      await prisma.pushToken.createMany({
        data: [
          { shopId: A.id, token: staffToken, platform: "ios", userId: A.userId },
          { shopId: A.id, token: customerToken, platform: "ios", customerId: f.aCustomer },
        ],
      });
      const del = (token: string, as: TestShop, host: string) =>
        R.pushTokens.DELETE(request("DELETE", `/api/push-tokens?token=${encodeURIComponent(token)}`, { host, as }));
      try {
        assert.equal((await del(staffToken, B, B.host)).status, 200, "same reply as a real delete");
        assert.ok(await prisma.pushToken.findUnique({ where: { token: staffToken } }), "another shop's staff");
        assert.equal((await del(customerToken, A, A.host)).status, 200);
        assert.ok(await prisma.pushToken.findUnique({ where: { token: customerToken } }), "a customer's device");
        assert.equal((await del(staffToken, A, A.host)).status, 200);
        assert.equal(await prisma.pushToken.findUnique({ where: { token: staffToken } }), null, "control: own token");
      } finally {
        await prisma.pushToken.deleteMany({ where: { token: { in: [staffToken, customerToken] } } });
      }
    });

    it("a customer can only send their own pending uploads", async () => {
      const own = path("a1-pending.jpg");
      const legacy = path("a-legacy-pending.jpg");
      await blobAccess.registerBlobAsset({ pathname: own, shopId: A.id, kind: "chat", customerId: f.aCustomer });
      const mine = await prisma.messageAttachment.create({
        data: { shopId: A.id, url: blobUrl(own), filename: "a.jpg", mimeType: "image/jpeg" },
      });
      const unregistered = await prisma.messageAttachment.create({
        data: { shopId: A.id, url: blobUrl(legacy), filename: "b.jpg", mimeType: "image/jpeg" },
      });
      assert.equal(await attachments.attachmentsAreAttachable(A.id, [mine.id], { uploadedBy: f.aCustomer }), true, "control");
      assert.equal(await attachments.attachmentsAreAttachable(A.id, [mine.id], { uploadedBy: f.aCustomer2 }), false);
      assert.equal(await attachments.attachmentsAreAttachable(A.id, [unregistered.id], { uploadedBy: f.aCustomer }), false);
      assert.equal(await attachments.attachmentsAreAttachable(A.id, [mine.id, unregistered.id], { uploadedBy: f.aCustomer }), false);
      assert.equal(await attachments.attachmentsAreAttachable(A.id, [mine.id]), true, "staff may send any of the shop's pending uploads");
    });

    it("the bike-photo import and link preview won't fetch internal addresses", async () => {
      for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "file:///etc/passwd", "http://localhost:5432/"]) {
        const imp = await R.importImage.POST(request("POST", "/api/bikes/import-image", { host: A.host, as: A, body: { url } }));
        assert.equal(imp.status, 400, url);
        const og = await R.ogPreview.GET(request("GET", `/api/og-preview?url=${encodeURIComponent(url)}`, { host: A.host }));
        assert.ok(og.status === 400 || og.status === 403, `${url} → ${og.status}`);
      }
      const anon = await R.importImage.POST(request("POST", "/api/bikes/import-image", { host: A.host, body: { url: "https://example.com/a.jpg" } }));
      assert.notEqual(anon.status, 200, "import needs staff");
    });

    it("template test emails only go to this shop's staff; the raw diagnostic is admin-only", async () => {
      const send = (to: string, as: TestShop, host: string) =>
        R.testSend.POST(request("POST", "/api/email-templates/test-send", { host, as, body: { slug: "job-ready", to } }));
      const stranger = await send("someone@example.com", A, A.host);
      assert.equal(stranger.status, 400);
      assert.match(((await stranger.json()) as { error: string }).error, /staff email address/);
      const otherShopStaff = await send(`${B.subdomain}@example.test`, A, A.host);
      assert.match(((await otherShopStaff.json()) as { error: string }).error, /staff email address/);
      assert.equal((await send(`${A.subdomain}@example.test`, A, B.host)).status, 401, "wrong host");
      const own = await send(`${A.subdomain}@example.test`, A, A.host);
      const ownBody = (await own.json()) as { error?: string };
      assert.doesNotMatch(ownBody.error ?? "", /staff email address/, "control: own address passes the recipient check");

      const diag = await R.platformEmailTest.POST(
        request("POST", "/api/platform/email-test", { host: A.host, as: A, body: { to: "someone@example.com" } })
      );
      assert.ok(diag.status === 401 || diag.status === 404, `staff can't use it (${diag.status})`);
    });

    it("a forwarded host that disagrees with Host routes to no shop", async () => {
      const services = (headers?: Record<string, string>) =>
        R.widgetServices.GET(request("GET", "/api/widget/services", { host: A.host, headers }));
      assert.equal((await services({ "x-forwarded-host": A.host })).status, 200, "control: matching");
      assert.equal((await services({ "x-forwarded-host": B.host })).status, 404, "another shop");
      assert.equal((await services({ "x-forwarded-host": "evil.example.com" })).status, 404);
      const staff = await R.customers.GET(request("GET", "/api/customers", { host: B.host, as: A, headers: { "x-forwarded-host": A.host } }));
      assert.equal(staff.status, 401, "can't borrow the session's own host either");
    });

    it("the Twilio webhook validates against the routed host, not a forwarded one", async () => {
      const twilio = (await import("twilio")).default;
      const params = { AccountSid: "AC_test", Body: "" };
      const post = (host: string, signedFor: string, fwd?: string) => {
        const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!, `https://${signedFor}/api/webhooks/twilio/sms`, params);
        return R.smsWebhook.POST(
          new NextRequest(`https://${host}/api/webhooks/twilio/sms`, {
            method: "POST",
            headers: {
              host,
              "content-type": "application/x-www-form-urlencoded",
              "x-twilio-signature": signature,
              ...(fwd ? { "x-forwarded-host": fwd } : {}),
            },
            body: new URLSearchParams(params).toString(),
          })
        );
      };
      assert.equal((await post(A.host, A.host)).status, 200, "control: genuine request");
      assert.equal((await post(A.host, "evil.example.com", "evil.example.com")).status, 403, "forged forwarded host");
      assert.equal((await post(A.host, B.host, B.host)).status, 403, "another shop's host");
    });
  });

  describe("links for fetchers without a session", () => {
    /** Run a URL we handed out back through the proxy's own decision, as an anonymous fetcher. */
    async function opens(link: string): Promise<string> {
      const u = new URL(link, `https://${A.host}`);
      const pathname = blobAccess.normalizeBlobPathname(u.searchParams.get("path"))!;
      const req = request("GET", `${u.pathname}${u.search}`, { host: u.host });
      const access = await blobAccess.authorizeBlobRequest(req, pathname);
      return access.ok ? access.via : "denied";
    }

    it("Twilio gets a signed greeting link that opens the private file, valid about an hour", async () => {
      const greeting = path("greeting.mp3");
      await blobAccess.registerBlobAsset({ pathname: greeting, shopId: A.id, kind: "voicemail-greeting" });
      await prisma.appSettings.upsert({
        where: { shopId: A.id },
        create: { shopId: A.id, voicemailGreetingUrl: blobUrl(greeting, "&v=1") },
        update: { voicemailGreetingUrl: blobUrl(greeting, "&v=1") },
      });
      const twilio = (await import("twilio")).default;
      const params = { AccountSid: "AC_test" };
      const url = `https://${A.host}/api/webhooks/twilio/voice/voicemail`;
      const res = await R.voicemail.POST(
        new NextRequest(url, {
          method: "POST",
          headers: {
            host: A.host,
            "content-type": "application/x-www-form-urlencoded",
            "x-twilio-signature": twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!, url, params),
          },
          body: new URLSearchParams(params).toString(),
        })
      );
      assert.equal(res.status, 200);
      const twiml = await res.text();
      const play = /<Play>([^<]+)<\/Play>/.exec(twiml)?.[1]?.replace(/&amp;/g, "&");
      assert.ok(play, `greeting played: ${twiml}`);
      assert.match(play, new RegExp(`^https://${A.host.replace(/\./g, "\\.")}/api/blob\\?`));
      assert.equal(await opens(play), "signature");
      const exp = Number(new URL(play).searchParams.get("exp"));
      const lifetime = exp - Date.now() / 1000;
      assert.ok(lifetime > 3600 - 60 && lifetime <= 2 * 3600, `about an hour (${Math.round(lifetime)} s)`);
      assert.equal(await opens(blobUrl(greeting)), "denied", "the bare path is private");
    });

    it("picture messages carry signed links good for Twilio's queue window", async () => {
      process.env.NEXT_PUBLIC_APP_URL ||= "https://app.bikeops.co";
      const { resolveOutboundMmsMediaUrls } = await import("./blob");
      const photo = path("mms.jpg");
      await blobAccess.registerBlobAsset({ pathname: photo, shopId: A.id, kind: "chat", customerId: f.aCustomer });
      const [link] = resolveOutboundMmsMediaUrls([{ url: blobUrl(photo, "&v=3"), mimeType: "image/jpeg" }], A.subdomain);
      assert.match(link, /^https:\/\/.+\/api\/blob\?path=.+&exp=\d+&sig=/);
      assert.equal(await opens(link), "signature");
      const lifetime = Number(new URL(link).searchParams.get("exp")) - Date.now() / 1000;
      assert.ok(lifetime > 4 * 3600 && lifetime <= 7 * 3600, `covers Twilio's 4 h queue (${Math.round(lifetime)} s)`);
    });

    it("a tracking-link reader gets signed bike photos; staff get plain ones", async () => {
      const job = await prisma.job.create({ data: { shopId: A.id, customerId: f.aCustomer, bikeMake: "Trek", bikeModel: "X" } });
      await prisma.jobBike.create({
        data: { shopId: A.id, jobId: job.id, make: "Trek", model: "X", sortOrder: 0, imageUrl: blobUrl(path("a-bike.jpg"), "&v=1") },
      });
      const { createJobCustomerAccessToken } = await import("./job-customer-access");
      const access = createJobCustomerAccessToken(A.id, job.id);
      const asReader = await R.job.GET(request("GET", `/api/jobs/${job.id}?access=${encodeURIComponent(access)}`, { host: A.host }), {
        params: { id: job.id },
      });
      assert.equal(asReader.status, 200);
      const readerUrl = ((await asReader.json()) as { jobBikes: { imageUrl: string }[] }).jobBikes[0].imageUrl;
      assert.equal(await opens(readerUrl), "signature");
      const lifetime = Number(new URL(readerUrl, "https://x").searchParams.get("exp")) - Date.now() / 1000;
      assert.ok(lifetime > 2 * 3600 - 60 && lifetime <= 3 * 3600, `about two hours (${Math.round(lifetime)} s)`);

      const asStaff = await R.job.GET(request("GET", `/api/jobs/${job.id}`, { host: A.host, as: A }), { params: { id: job.id } });
      const staffUrl = ((await asStaff.json()) as { jobBikes: { imageUrl: string }[] }).jobBikes[0].imageUrl;
      assert.doesNotMatch(staffUrl, /sig=/, "staff use their session");

      const stranger = await R.job.GET(request("GET", `/api/jobs/${job.id}`, { host: A.host }), { params: { id: job.id } });
      assert.equal(stranger.status, 403, "no link, no job, no photo");
    });
  });
});
