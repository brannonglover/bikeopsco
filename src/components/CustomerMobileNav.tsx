"use client";

import Link from "next/link";
import { usePathname, useParams, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

type Job = { id: string; bikeMake: string; bikeModel: string; stage: string };

export function CustomerMobileNav() {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const jobIdFromUrl = params?.jobId as string | undefined;
  const jobIdFromQuery = searchParams?.get("jobId") ?? undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(true);

  const isStatusPage = pathname?.startsWith("/status/");
  const isPayPage = pathname?.startsWith("/pay/");
  const isChatPage = pathname?.startsWith("/chat/c");
  const jobId = jobIdFromUrl ?? jobIdFromQuery;

  useEffect(() => {
    fetch("/api/widget/features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (data && typeof data === "object" && "chatEnabled" in data) {
          setChatEnabled(Boolean((data as { chatEnabled?: unknown }).chatEnabled));
        }
      })
      .catch(() => {});
  }, []);

  // Fetch customer's jobs when on chat without jobId
  useEffect(() => {
    if (!isChatPage || jobId) {
      setJobs([]);
      return;
    }
    setJobsLoading(true);
    fetch("/api/chat/my-jobs", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setJobs(Array.isArray(data) ? data : []))
      .catch(() => setJobs([]))
      .finally(() => setJobsLoading(false));
  }, [isChatPage, jobId]);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const statusJobId = jobId ?? jobs[0]?.id;
  const chatUrl = jobId ? `/chat/c?jobId=${jobId}` : "/chat/c";

  return (
    <>
      {/* Hamburger - mobile only */}
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        className="md:hidden p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 touch-manipulation"
        aria-label="Open menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Overlay */}
      {menuOpen && (
        <button
          type="button"
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Slide-out menu */}
      <aside
        className={`
          md:hidden fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] bg-white shadow-xl
          flex flex-col pt-[env(safe-area-inset-top,0px)]
          transform transition-transform duration-200 ease-out
          ${menuOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Menu</h2>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="p-2 -mr-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="p-4 space-y-1">
          {chatEnabled && (isStatusPage || isPayPage) && (
            <Link
              href={chatUrl}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
            >
              <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Chat with us
            </Link>
          )}
          {isPayPage && jobId && (
            <Link
              href={`/status/${jobId}`}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
            >
              <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Job status
            </Link>
          )}
          {isChatPage && statusJobId && (
            <Link
              href={`/status/${statusJobId}`}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
            >
              <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Job status
            </Link>
          )}
          {isChatPage && !statusJobId && !jobsLoading && jobs.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-500">
              Sign in to chat to see your job status.
            </p>
          )}
          {isChatPage && !statusJobId && jobsLoading && (
            <p className="px-4 py-3 text-sm text-slate-500">Loading…</p>
          )}
          {jobs.length > 1 && isChatPage && (
            <div className="pt-2 border-t border-slate-200 space-y-1">
              <p className="px-4 py-1 text-xs font-medium text-slate-500 uppercase tracking-wide">Other jobs</p>
              {jobs.slice(1).map((j) => (
                <Link
                  key={j.id}
                  href={`/status/${j.id}`}
                  onClick={() => setMenuOpen(false)}
                  className="flex px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
                >
                  {j.bikeMake} {j.bikeModel}
                </Link>
              ))}
            </div>
          )}
        </nav>
      </aside>
    </>
  );
}
