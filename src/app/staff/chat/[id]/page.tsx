import { redirect } from "next/navigation";

/**
 * Universal Link target (/staff/chat/:id). iOS/Android open the native app when
 * installed. Otherwise send the browser through the /open trampoline (correct
 * native scheme + web fallback).
 */
export default async function StaffChatDeepLinkPage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/open/staff/chat/${encodeURIComponent(params.id)}`);
}
