"use client";

import { useState, useEffect, useCallback } from "react";
import { JobDetailModal } from "@/components/jobs/JobDetailModal";
import { JobCardContent } from "@/components/calendar/JobCard";
import type { Job } from "@/lib/types";

function formatDate(d: Date | string | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ArchivePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const fetchJobs = useCallback(() => {
    setLoading(true);
    fetch("/api/jobs?archived=true&view=board")
      .then((res) => res.json())
      .then((data) => setJobs(Array.isArray(data) ? data : []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500 font-medium">
        Loading archive...
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Archive</h1>
      <p className="text-slate-600 mb-8">
        Completed jobs archived for later reference. Sorted by when they were archived.
      </p>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <p className="text-slate-500">No archived jobs yet.</p>
          <p className="text-sm text-slate-400 mt-1">
            Completed jobs appear on the Job Board. Use &quot;Archive completed&quot; at end of day to move them here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              onClick={() => setSelectedJob(job)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedJob(job);
                }
              }}
              role="button"
              tabIndex={0}
              className="cursor-pointer hover:ring-2 hover:ring-slate-200 rounded-xl transition-shadow"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-soft hover:shadow-soft-lg transition-shadow">
                <div className="flex-1 min-w-0">
                  <JobCardContent job={job} />
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className="text-xs font-medium text-slate-500">
                    Archived {job.archivedAt ? formatDate(job.archivedAt) : "—"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <JobDetailModal
        job={selectedJob}
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onJobUpdated={(updated) => {
          // If the job was unarchived, it no longer belongs in this list.
          if (!updated.archivedAt) {
            setSelectedJob(null);
            setJobs((prev) => prev.filter((j) => j.id !== updated.id));
            return;
          }
          setSelectedJob(updated);
          setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
        }}
        onJobDeleted={(jobId) => {
          setSelectedJob(null);
          setJobs((prev) => prev.filter((j) => j.id !== jobId));
        }}
      />
    </div>
  );
}
