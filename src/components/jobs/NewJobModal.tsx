"use client";

import { useEffect } from "react";
import { JobForm } from "./JobForm";
import type { Job } from "@/lib/types";

interface NewJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (job: Job) => void;
}

export function NewJobModal({ isOpen, onClose, onSuccess }: NewJobModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSuccess = (job: Job) => {
    onSuccess(job);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-soft-lg max-w-xl w-full max-h-[95vh] sm:max-h-[90vh] flex flex-col border border-slate-200/80 sm:border-t-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-xl font-bold text-slate-900">New Job</h2>
          <button
            onClick={onClose}
            className="p-3 -mr-2 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto overflow-x-hidden p-4 sm:p-6 flex-1 min-w-0">
          <JobForm onSuccess={handleSuccess} embedded />
        </div>
      </div>
    </div>
  );
}
