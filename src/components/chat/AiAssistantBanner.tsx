"use client";

import { useCallback, useEffect, useState } from "react";
import type { Conversation } from "@/lib/types";
import { AiHandoffModal } from "./AiHandoffModal";
import {
  isHandoffDismissed,
  markHandoffDismissed,
} from "@/lib/ai-handoff-dismissals";

/**
 * The per-conversation kill switch, shown above the thread.
 *
 * Staff mostly never press it — sending a message pauses the assistant on its
 * own. It exists for the case where you want it to stop *before* you have
 * anything to say, and to put it back to work once you're done.
 */
export function AiAssistantBanner({
  conversation,
  onChange,
}: {
  conversation: Conversation;
  /** Called with the conversation as the server returned it after the change. */
  onChange: (conversation: Conversation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHandoff, setShowHandoff] = useState(false);

  const state = conversation.aiAssistantState ?? "OFF";
  const summary = conversation.aiAssistantSummary;

  // A handoff note is news, so it opens by itself when the thread is opened —
  // the banner line only ever shows the start of it. Closing it is final: the
  // dismissal is remembered on this device, and only a fresh handoff on the
  // same thread opens the note again.
  useEffect(() => {
    // Also covers leaving for a thread with nothing to hand over, and the
    // assistant being put back to work: neither should leave the note up.
    if (!summary || state === "ACTIVE" || state === "OFF") {
      setShowHandoff(false);
      return;
    }
    setShowHandoff(!isHandoffDismissed(conversation.id, summary));
  }, [conversation.id, summary, state]);

  const closeHandoff = useCallback(() => {
    if (summary) markHandoffDismissed(conversation.id, summary);
    setShowHandoff(false);
  }, [conversation.id, summary]);

  // A thread the assistant has never touched says nothing at all — staff
  // shouldn't have to read a banner about a feature that isn't in play.
  if (state === "OFF") return null;

  const setState = async (next: "ACTIVE" | "PAUSED") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiAssistantState: next }),
      });
      if (!res.ok) {
        setError("Couldn't change that. Try again.");
        return;
      }
      onChange((await res.json()) as Conversation);
    } catch {
      setError("Couldn't change that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const active = state === "ACTIVE";
  // Only colour levels that globals.css remaps for dark mode. text-indigo-900
  // and border-indigo-200 have no dark rule, so in the dark theme they render
  // near-black navy on a dark indigo ground — which is how this banner shipped
  // unreadable. indigo-700 and slate-200 are both remapped.
  const tone = active
    ? "border-slate-200 bg-indigo-50 text-indigo-700"
    : "border-slate-200 bg-slate-50 text-slate-600";

  const headline = active
    ? "The AI assistant is answering this conversation."
    : state === "DONE"
      ? "The AI assistant has handed this over to you."
      : "The AI assistant is paused on this conversation.";

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-xs ${tone}`}
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${
            active ? "bg-indigo-500" : "bg-slate-400"
          }`}
        />
        {headline}
      </span>

      {/* The note is routinely a couple of sentences — far more than fits on
          one banner line — so the banner shows the start of it and the whole
          thing opens in a dialog. */}
      {summary && (
        <button
          type="button"
          onClick={() => setShowHandoff(true)}
          className="min-w-0 flex-1 truncate text-left font-normal underline decoration-dotted underline-offset-2 hover:decoration-solid"
          title="See the whole note"
        >
          {summary}
        </button>
      )}

      {active && (
        <span className="font-normal text-text-secondary">
          Sending a message stops it.
        </span>
      )}

      <button
        type="button"
        onClick={() => void setState(active ? "PAUSED" : "ACTIVE")}
        disabled={busy}
        className="ml-auto flex-shrink-0 rounded-lg border border-current px-2.5 py-1 font-semibold transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "…" : active ? "Take over" : "Let the assistant reply"}
      </button>

      {error && <span className="w-full text-red-700">{error}</span>}

      {showHandoff && summary && (
        <AiHandoffModal
          conversation={conversation}
          summary={summary}
          onClose={closeHandoff}
        />
      )}
    </div>
  );
}
