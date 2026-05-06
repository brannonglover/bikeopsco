"use client";

import { useParams } from "next/navigation";
import { NotificationPreferencesPanel } from "@/components/customer/NotificationPreferencesPanel";

export default function JobNotificationPreferencesPage() {
  const params = useParams();
  const jobId = params?.jobId as string;

  return (
    <NotificationPreferencesPanel
      endpoint={`/api/jobs/${encodeURIComponent(jobId)}/preferences`}
      backHref={`/status/${encodeURIComponent(jobId)}`}
      backLabel="Back to repair status"
    />
  );
}
