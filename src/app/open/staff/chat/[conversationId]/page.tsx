import { headers } from "next/headers";
import { getOpenLinkWebBaseUrl, getStaffChatDeepLink } from "@/lib/env";
import { OpenStaffChatPage } from "./OpenStaffChatPage";

export default async function Page({
  params,
  searchParams,
}: {
  params: { conversationId: string };
  searchParams: { messageId?: string };
}) {
  const { conversationId } = params;
  const messageId =
    typeof searchParams.messageId === "string" ? searchParams.messageId : undefined;
  const webBase = getOpenLinkWebBaseUrl(headers().get("host"));
  const webQs = new URLSearchParams({ conversation: conversationId });
  if (messageId) webQs.set("messageId", messageId);
  const webUrl = webBase
    ? `${webBase.replace(/\/$/, "")}/chat?${webQs.toString()}`
    : `/chat?${webQs.toString()}`;

  return (
    <OpenStaffChatPage
      appUrl={webBase}
      conversationId={conversationId}
      nativeUrl={getStaffChatDeepLink(conversationId, messageId)}
      webUrl={webUrl}
    />
  );
}
