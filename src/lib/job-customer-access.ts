import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getShopAppUrl } from "./env";

const ACCESS_PARAM = "access";

function getSigningSecret(): string {
  const secret =
    process.env.CUSTOMER_JOB_ACCESS_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "CUSTOMER_JOB_ACCESS_SECRET or NEXTAUTH_SECRET must be set for customer job links"
    );
  }
  return secret;
}

/** Opaque token bound to shop + job; include as ?access= on customer-facing URLs. */
export function createJobCustomerAccessToken(shopId: string, jobId: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(`${shopId}:${jobId}`)
    .digest("base64url");
}

export function verifyJobCustomerAccessToken(
  shopId: string,
  jobId: string,
  token: string | null | undefined
): boolean {
  if (!token?.trim()) return false;
  const expected = createJobCustomerAccessToken(shopId, jobId);
  try {
    const a = Buffer.from(token.trim());
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function getJobCustomerAccessFromRequest(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get(ACCESS_PARAM)?.trim() || null;
}

export function buildJobCustomerAccessQuery(shopId: string, jobId: string): string {
  return `${ACCESS_PARAM}=${encodeURIComponent(createJobCustomerAccessToken(shopId, jobId))}`;
}

export function appendJobCustomerAccessToUrl(
  url: string,
  shopId: string,
  jobId: string
): string {
  const q = buildJobCustomerAccessQuery(shopId, jobId);
  return url.includes("?") ? `${url}&${q}` : `${url}?${q}`;
}

export function getCustomerStatusUrl(
  jobId: string,
  shopId: string,
  shopSubdomain?: string | null
): string {
  const shopUrl = getShopAppUrl(shopSubdomain);
  if (!shopUrl) return "";
  return appendJobCustomerAccessToUrl(
    `${shopUrl}/status/${encodeURIComponent(jobId)}`,
    shopId,
    jobId
  );
}

export function getCustomerBillUrl(
  jobId: string,
  shopId: string,
  shopSubdomain?: string | null
): string {
  const shopUrl = getShopAppUrl(shopSubdomain);
  if (!shopUrl) return "";
  return appendJobCustomerAccessToUrl(
    `${shopUrl}/pay/${encodeURIComponent(jobId)}`,
    shopId,
    jobId
  );
}

export function getCustomerChatUrl(
  jobId: string,
  shopId: string,
  shopSubdomain?: string | null
): string {
  const shopUrl = getShopAppUrl(shopSubdomain);
  if (!shopUrl) return "";
  return appendJobCustomerAccessToUrl(
    `${shopUrl}/chat/c?jobId=${encodeURIComponent(jobId)}`,
    shopId,
    jobId
  );
}

export async function hasStaffJobAccess(
  request: NextRequest,
  shopId: string
): Promise<boolean> {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  return Boolean(token?.shopId && token.shopId === shopId);
}

/** Staff session or valid signed ?access= for this job. */
export async function hasJobReadAccess(
  request: NextRequest,
  shopId: string,
  jobId: string
): Promise<boolean> {
  if (await hasStaffJobAccess(request, shopId)) return true;
  const access = getJobCustomerAccessFromRequest(request);
  return verifyJobCustomerAccessToken(shopId, jobId, access);
}
