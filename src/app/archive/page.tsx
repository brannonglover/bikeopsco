"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { JobDetailModal } from "@/components/jobs/JobDetailModal";
import { JobCardContent } from "@/components/calendar/JobCard";
import type { Job } from "@/lib/types";

function formatArchivedDate(d: Date | string | null) {
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
  const [query, setQuery] = useState("");

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((job) => {
      const bike = `${job.bikeMake ?? ""} ${job.bikeModel ?? ""}`.toLowerCase();
      const customer = `${job.customer?.firstName ?? ""} ${job.customer?.lastName ?? ""}`.toLowerCase();
      const notes = `${job.customerNotes ?? ""} ${job.notes ?? ""}`.toLowerCase();
      return (
        job.id.toLowerCase().includes(q) ||
        bike.includes(q) ||
        customer.includes(q) ||
        notes.includes(q)
      );
    });
  }, [jobs, query]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-1">Archive</h1>
          <p className="text-text-secondary">
            Completed jobs archived for later reference.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M8.5 3.5a5 5 0 103.916 8.104l3.24 3.24a.75.75 0 101.06-1.06l-3.24-3.24A5 5 0 008.5 3.5zm-3.5 5a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search jobs…"
              className="w-full sm:w-80 rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <button
            type="button"
            onClick={fetchJobs}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          {loading
            ? "Loading…"
            : `${filtered.length} job${filtered.length === 1 ? "" : "s"} shown${query.trim() ? ` (of ${jobs.length})` : ""}`}
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          Loading archive…
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 8v13H3V8" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l9-6 9 6" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 21V12h6v9" />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">No archived jobs yet</h2>
          <p className="mt-1 text-sm text-slate-600">
            Archive jobs from a job’s details, or use &quot;Archive&quot; on the Job Board when you’re done for the day.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-slate-700 font-semibold">No matches</p>
          <p className="mt-1 text-sm text-slate-500">Try a different search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => setSelectedJob(job)}
              className="text-left rounded-2xl border border-slate-200 bg-white p-4 shadow-soft hover:shadow-soft-lg hover:border-slate-300 transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <JobCardContent job={job} />
                </div>
                <div className="flex-shrink-0">
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    Archived {job.archivedAt ? formatArchivedDate(job.archivedAt) : "—"}
                  </span>
                </div>
              </div>
            </button>
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
