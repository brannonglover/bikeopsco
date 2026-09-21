"use client";

import { useEffect } from "react";
import type { Conversation } from "@/lib/types";

type Detail = { label: string; value: string };

/**
 * Pulls apart the summary the assistant left behind. buildSummary() writes it
 * as `prose (Name · email · wants: …)`, so the trailing parenthetical is a
 * list of what it collected — but the prose itself may also contain brackets,
 * hence the balanced scan from the end rather than a regex.
 *
 * Anything that doesn't match that shape is shown as-is: a summary that isn't
 * parsed is still readable, one that is mis-parsed isn't.
 */
function splitSummary(summary: string): {
  prose: string;
  details: Detail[];
} {
  const text = summary.trim();
  if (!text.endsWith(")")) {
    // Nothing to split: with no prose at all, buildSummary() writes the
    // collected details on their own.
    return looksLikeDetails(text)
      ? { prose: "", details: toDetails(text) }
      : { prose: text, details: [] };
  }

  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === ")") depth++;
    if (text[i] !== "(") continue;
    depth--;
    if (depth > 0) continue;

    const inner = text.slice(i + 1, -1);
    const prose = text.slice(0, i).trim();
    // Only a parenthetical that looks like the collected-details list gets
    // lifted out — an ordinary aside at the end of a sentence stays prose.
    if (!prose || !looksLikeDetails(inner)) break;
    return { prose, details: toDetails(inner) };
  }

  return { prose: text, details: [] };
}

/** Whether a chunk reads as the collected-details list rather than prose. */
function looksLikeDetails(text: string): boolean {
  return text.includes("\u00b7") || text.toLowerCase().startsWith("wants:");
}

function toDetails(text: string): Detail[] {
  return text
    .split("\u00b7")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(describeDetail);
}

/** Labels a detail by its shape — the same three buildSummary() can write. */
function describeDetail(part: string): Detail {
  if (part.toLowerCase().startsWith("wants:")) {
    return { label: "Wants", value: part.slice("wants:".length).trim() };
  }
  if (part.includes("@")) return { label: "Email", value: part };
  return { label: "Name", value: part };
}

/**
 * The handoff note, full length.
 *
 * The banner can only show the first line of it, and the note is the whole
 * point of the handoff — what the customer wants, and what the assistant
 * managed to collect before it stepped aside.
 */
export function AiHandoffModal({
  conversation,
  summary,
  onClose,
}: {
  conversation: Conversation;
  summary: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const { prose, details } = splitSummary(summary);
  const customerName =
    [conversation.customer.firstName, conversation.customer.lastName]
      .filter(Boolean)
      .join(" ") || null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white sm:max-h-[85vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-handoff-title"
      >
        <div className="border-b border-slate-200 p-4">
          <h3
            id="ai-handoff-title"
            className="text-lg font-semibold text-slate-900"
          >
            Handed over to you
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {customerName
              ? `What the assistant found out from ${customerName}.`
              : "What the assistant found out before it stepped aside."}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {prose && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {prose}
            </p>
          )}

          {details.length > 0 && (
            <dl className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {details.map((detail) => (
                <div key={`${detail.label}-${detail.value}`}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {detail.label}
                  </dt>
                  <dd className="mt-0.5 break-words text-sm text-slate-900">
                    {detail.label === "Email" ? (
                      <a
                        href={`mailto:${detail.value}`}
                        className="underline underline-offset-2"
                      >
                        {detail.value}
                      </a>
                    ) : (
                      detail.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="border-t border-slate-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
