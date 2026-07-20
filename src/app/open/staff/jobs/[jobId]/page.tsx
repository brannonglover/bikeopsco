import { headers } from "next/headers";
import { getOpenLinkWebBaseUrl, getStaffJobDeepLink } from "@/lib/env";
import { OpenStaffJobPage } from "./OpenStaffJobPage";

export default async function Page({
  params,
}: {
  params: { jobId: string };
}) {
  const { jobId } = params;
  const webBase = getOpenLinkWebBaseUrl(headers().get("host"));
  const webUrl = webBase
    ? `${webBase.replace(/\/$/, "")}/calendar?openJob=${encodeURIComponent(jobId)}`
    : `/calendar?openJob=${encodeURIComponent(jobId)}`;

  return (
    <OpenStaffJobPage
      appUrl={webBase}
      jobId={jobId}
      nativeUrl={getStaffJobDeepLink(jobId)}
      webUrl={webUrl}
    />
  );
}
