import "server-only";

import { sign } from "crypto";

const APP_STORE_PRODUCTION = "https://api.storekit.itunes.apple.com";
const APP_STORE_SANDBOX = "https://api.storekit-sandbox.itunes.apple.com";

export function getAppleSubscriptionProductId(): string {
  return (
    process.env.APPLE_BIKEOPS_SUBSCRIPTION_PRODUCT_ID?.trim() ||
    "com.brannonglover.bikeops.app.subscription.monthly"
  );
}

function getAppleCredentials() {
  const issuerId = process.env.APPLE_APP_STORE_ISSUER_ID?.trim();
  const keyId = process.env.APPLE_APP_STORE_KEY_ID?.trim();
  const privateKeyRaw = process.env.APPLE_APP_STORE_PRIVATE_KEY?.trim();
  const bundleId =
    process.env.APPLE_APP_STORE_BUNDLE_ID?.trim() ||
    "com.brannonglover.bikeops.app";

  if (!issuerId || !keyId || !privateKeyRaw) {
    return null;
  }

  const privateKey = privateKeyRaw.includes("\\n")
    ? privateKeyRaw.replace(/\\n/g, "\n")
    : privateKeyRaw;

  return { issuerId, keyId, privateKey, bundleId };
}

function base64Url(input: Buffer | string): string {
  const value = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createAppStoreJwt(credentials: {
  issuerId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
}): string {
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(
    JSON.stringify({
      iss: credentials.issuerId,
      iat: now,
      exp: now + 1200,
      aud: "appstoreconnect-v1",
      bid: credentials.bundleId,
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: credentials.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${base64Url(signature)}`;
}

type AppleTransactionInfo = {
  productId?: string;
  originalTransactionId?: string;
  expiresDate?: number;
  appAccountToken?: string;
};

function decodeAppleJwsPayload<T>(jws: string): T | null {
  const parts = jws.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

async function fetchAppleTransaction(
  transactionId: string,
  sandbox: boolean
): Promise<AppleTransactionInfo | null> {
  const credentials = getAppleCredentials();
  if (!credentials) return null;

  const base = sandbox ? APP_STORE_SANDBOX : APP_STORE_PRODUCTION;
  const jwt = createAppStoreJwt(credentials);
  const response = await fetch(`${base}/inApps/v1/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { signedTransactionInfo?: string };
  if (!data.signedTransactionInfo) return null;
  return decodeAppleJwsPayload<AppleTransactionInfo>(data.signedTransactionInfo);
}

export async function verifyAppleSubscriptionPurchase(input: {
  transactionId: string;
  productId: string;
  shopId: string;
}): Promise<
  | {
      ok: true;
      originalTransactionId: string;
      productId: string;
      currentPeriodEnd: Date | null;
      billingStatus: string;
    }
  | { ok: false; reason: string }
> {
  const expectedProductId = getAppleSubscriptionProductId();
  if (input.productId !== expectedProductId) {
    return { ok: false, reason: "invalid_product" };
  }

  const credentials = getAppleCredentials();
  if (!credentials) {
    return { ok: false, reason: "apple_not_configured" };
  }

  let transaction =
    (await fetchAppleTransaction(input.transactionId, false)) ??
    (await fetchAppleTransaction(input.transactionId, true));

  if (!transaction?.originalTransactionId) {
    return { ok: false, reason: "invalid_transaction" };
  }

  if (transaction.productId && transaction.productId !== expectedProductId) {
    return { ok: false, reason: "invalid_product" };
  }

  if (
    transaction.appAccountToken &&
    transaction.appAccountToken.toLowerCase() !== input.shopId.toLowerCase()
  ) {
    return { ok: false, reason: "shop_mismatch" };
  }

  const currentPeriodEnd =
    typeof transaction.expiresDate === "number"
      ? new Date(transaction.expiresDate)
      : null;
  const billingStatus =
    currentPeriodEnd && currentPeriodEnd.getTime() > Date.now() ? "active" : "expired";

  return {
    ok: true,
    originalTransactionId: transaction.originalTransactionId,
    productId: transaction.productId ?? input.productId,
    currentPeriodEnd,
    billingStatus: billingStatus === "expired" ? "past_due" : "active",
  };
}
