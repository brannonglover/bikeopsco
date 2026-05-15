import { getAppUrl, getStaffChatDeepLink } from "@/lib/env";
import { OpenStaffChatPage } from "./OpenStaffChatPage";

export default async function Page({
  params,
}: {
  params: { conversationId: string };
}) {
  const { conversationId } = params;
  const appUrl = getAppUrl();
  const webUrl = appUrl ? `${appUrl}/chat` : "/chat";

  return (
    <OpenStaffChatPage
      appUrl={appUrl}
      conversationId={conversationId}
      nativeUrl={getStaffChatDeepLink(conversationId)}
      webUrl={webUrl}
    />
  );
}
