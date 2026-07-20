"use client";

import { CustomerJobHistory } from "@/components/customers/CustomerJobHistory";
import type { Job } from "@/lib/types";

export function HistoryTab({ job }: { job: Job }) {
  if (!job.customerId) {
    return (
      <p className="text-slate-500 text-sm py-2">
        No customer linked to this job, so there is no history to show.
      </p>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Customer history
      </h3>
      <CustomerJobHistory customerId={job.customerId} excludeJobId={job.id} />
    </div>
  );
}
