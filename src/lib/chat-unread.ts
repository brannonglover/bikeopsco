import type { Conversation } from "@/lib/types";

/** True when the latest message is from the customer and staff has not read it since (opened thread). */
export function hasUnreadCustomerMessage(conv: Conversation): boolean {
  const last = conv.messages?.[0];
  if (!last || last.sender !== "CUSTOMER") return false;
  const lastAt = new Date(last.createdAt).getTime();
  if (Number.isNaN(lastAt)) return false;
  if (!conv.staffLastReadAt) return true;
  const readAt = new Date(conv.staffLastReadAt).getTime();
  if (Number.isNaN(readAt)) return true;
  return lastAt > readAt;
}
