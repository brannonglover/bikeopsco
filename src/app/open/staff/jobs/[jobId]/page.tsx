import { getAppUrl, getStaffJobDeepLink } from "@/lib/env";
import { OpenStaffJobPage } from "./OpenStaffJobPage";

export default async function Page({
  params,
}: {
  params: { jobId: string };
}) {
  const { jobId } = params;
  const appUrl = getAppUrl();
  const webUrl = appUrl
    ? `${appUrl}/calendar?openJob=${encodeURIComponent(jobId)}`
    : `/calendar?openJob=${encodeURIComponent(jobId)}`;

  return (
    <OpenStaffJobPage
      appUrl={appUrl}
      jobId={jobId}
      nativeUrl={getStaffJobDeepLink(jobId)}
      webUrl={webUrl}
    />
  );
}
