import { headers } from "next/headers";
import { getOpenLinkWebBaseUrl, getStaffCalendarDeepLink } from "@/lib/env";
import { OpenStaffCalendarPage } from "./OpenStaffCalendarPage";

export default async function Page() {
  const webBase = getOpenLinkWebBaseUrl(headers().get("host"));
  const webUrl = webBase
    ? `${webBase.replace(/\/$/, "")}/calendar`
    : "/calendar";

  return (
    <OpenStaffCalendarPage
      appUrl={webBase}
      nativeUrl={getStaffCalendarDeepLink()}
      webUrl={webUrl}
    />
  );
}
