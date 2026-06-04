"use client";

import { useParams, useSearchParams } from "next/navigation";
import { jobAccessApiSuffix, readJobAccessParam, withJobAccessQuery } from "@/lib/job-access-url";
import { NotificationPreferencesPanel } from "@/components/customer/NotificationPreferencesPanel";

export default function JobNotificationPreferencesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const jobId = params?.jobId as string;
  const jobAccess = readJobAccessParam(searchParams);

  return (
    <NotificationPreferencesPanel
      endpoint={`/api/jobs/${encodeURIComponent(jobId)}/preferences${jobAccessApiSuffix(jobAccess)}`}
      backHref={withJobAccessQuery(`/status/${encodeURIComponent(jobId)}`, jobAccess)}
      backLabel="Back to repair status"
    />
  );
}
