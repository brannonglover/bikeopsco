"use client";

import { useState } from "react";
import type { ThreadCall } from "@/lib/types";
import { formatChatTime } from "@/lib/format-chat-time";

/**
 * A phone call in the staff chat thread: what the caller wanted, when the AI
 * assistant answered, or a voicemail, so the push that brought staff here has
 * something to show them.
 */

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds < 1) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest.toString().padStart(2, "0")}s` : `${rest}s`;
}

function callHeadline(call: ThreadCall): string {
  if (call.aiAnswered) return "Assistant answered a call";
  if (call.direction === "OUTBOUND") {
    return call.answeredAt ? "Outgoing call" : "Outgoing call · no answer";
  }
  if (call.status === "VOICEMAIL" || call.hasRecording) return "Voicemail";
  if (call.answeredAt) return "Incoming call";
  if (call.status === "IN_PROGRESS") return "Incoming call · in progress";
  if (call.status === "QUEUED" || call.status === "RINGING") return "Incoming call · ringing";
  return "Missed call";
}

type TranscriptLine = { speaker: "Caller" | "Assistant" | null; text: string };

function parseTranscript(transcript: string): TranscriptLine[] {
  return transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(Caller|Assistant):\s*(.*)$/.exec(line);
      return match
        ? { speaker: match[1] as "Caller" | "Assistant", text: match[2] }
        : { speaker: null, text: line };
    });
}

export function ThreadCallCard({ call }: { call: ThreadCall }) {
  const [showTranscript, setShowTranscript] = useState(false);

  const duration = formatDuration(call.durationSeconds);
  const missed = callHeadline(call) === "Missed call";
  const transcript = call.aiTranscript ? parseTranscript(call.aiTranscript) : [];
  // The assistant's summary is written after the caller hangs up, which can
  // take a few seconds after the call itself ends.
  const summaryPending = call.aiAnswered && !call.aiSummary && !call.endedAt;
  // Twilio sets the recording before it has finished processing it, and a
  // player pointed at it then just fails.
  const voicemailReady = call.hasRecording && call.recordingStatus === "completed";
  const voicemailPending =
    call.hasRecording && !call.transcriptionText && call.transcriptionStatus === "in-progress";

  return (
    <div className="flex justify-center">
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
        data-call-id={call.id}
      >
        <div className="flex items-center gap-2">
          <svg
            className={`h-4 w-4 shrink-0 ${missed ? "text-amber-700" : "text-emerald-700"}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
            />
          </svg>
          <span className="font-medium text-slate-900">{callHeadline(call)}</span>
          <span className="ml-auto shrink-0 text-xs text-slate-500">
            {formatChatTime(call.startedAt ?? call.createdAt)}
            {duration ? ` · ${duration}` : ""}
          </span>
        </div>

        {call.aiSummary ? (
          <p className="mt-2 whitespace-pre-line text-slate-800">{call.aiSummary}</p>
        ) : summaryPending ? (
          <p className="mt-2 text-slate-500 italic">Summary will appear when the call ends.</p>
        ) : null}

        {call.hasRecording ? (
          <div className="mt-2 space-y-2">
            {call.transcriptionText ? (
              <p className="whitespace-pre-line text-slate-800">“{call.transcriptionText}”</p>
            ) : voicemailPending ? (
              <p className="text-slate-500 italic">Transcribing voicemail…</p>
            ) : null}
            {voicemailReady ? (
              <audio
                controls
                preload="none"
                src={`/api/calls/${encodeURIComponent(call.id)}/recording`}
                className="h-9 w-full"
              />
            ) : null}
          </div>
        ) : null}

        {transcript.length > 0 ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowTranscript((open) => !open)}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
              aria-expanded={showTranscript}
            >
              {showTranscript ? "Hide transcript" : "Show transcript"}
            </button>
            {showTranscript ? (
              <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3">
                {transcript.map((line, index) => (
                  <p key={index} className="text-[13px] leading-snug">
                    {line.speaker ? (
                      <span
                        className={`font-medium ${
                          line.speaker === "Caller" ? "text-slate-900" : "text-indigo-700"
                        }`}
                      >
                        {line.speaker}:{" "}
                      </span>
                    ) : null}
                    <span className="text-slate-700">{line.text}</span>
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
