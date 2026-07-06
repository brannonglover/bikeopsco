export type CustomerMagicLinkIntent = "signin" | "chat";

/**
 * Customer magic links keep the token in the URL fragment so link scanners
 * cannot burn one-time tokens on GET.
 *
 * - signin (default): /open/login — opens the app to the customer home
 * - chat: /chat/c — staff chat invites land in chat after consent
 */
export function buildCustomerMagicLinkUrl(
  baseUrl: string,
  token: string,
  intent: CustomerMagicLinkIntent = "signin"
): string {
  const origin = baseUrl.replace(/\/+$/, "");
  const path = intent === "chat" ? "/chat/c?src=chat" : "/open/login";
  return `${origin}${path}#token=${encodeURIComponent(token)}`;
}
