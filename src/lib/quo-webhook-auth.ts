import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

function safeEqualBase64(a: string, b: string): boolean {
  const left = Buffer.from(a.trim(), "utf8");
  const right = Buffer.from(b.trim(), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify Quo app webhooks (Settings → Webhooks) using the signing secret
 * from "Reveal signing secret" on the webhook details page.
 *
 * @see https://support.quo.com/core-concepts/integrations/webhooks
 */
export function verifyOpenPhoneSignatureHeader(
  rawBody: string,
  signatureHeader: string | null,
  signingKeyBase64: string
): boolean {
  if (!signatureHeader?.trim() || !signingKeyBase64.trim()) return false;

  const fields = signatureHeader.trim().split(";");
  if (fields.length < 4 || fields[0] !== "hmac" || fields[1] !== "1") {
    return false;
  }

  const timestamp = fields[2]?.trim();
  const providedDigest = fields.slice(3).join(";").trim();
  if (!timestamp || !providedDigest) return false;

  const signedData = `${timestamp}.${rawBody}`;
  const signingKey = Buffer.from(signingKeyBase64.trim(), "base64");
  const computedDigest = createHmac("sha256", signingKey)
    .update(signedData, "utf8")
    .digest("base64");

  return safeEqualBase64(computedDigest, providedDigest);
}

/**
 * App webhooks: openphone-signature + signing key.
 * API/manual testing: ?secret=QUO_WEBHOOK_SECRET on the URL.
 */
export function verifyQuoWebhookRequest(
  request: NextRequest,
  rawBody: string
): boolean {
  const querySecret = request.nextUrl.searchParams.get("secret")?.trim();
  const sharedSecret = process.env.QUO_WEBHOOK_SECRET?.trim();
  if (sharedSecret && querySecret && querySecret === sharedSecret) {
    return true;
  }

  const signingKey = process.env.QUO_WEBHOOK_SIGNING_KEY?.trim();
  const signatureHeader =
    request.headers.get("openphone-signature") ??
    request.headers.get("OpenPhone-Signature");

  if (signingKey && signatureHeader) {
    return verifyOpenPhoneSignatureHeader(rawBody, signatureHeader, signingKey);
  }

  return false;
}
