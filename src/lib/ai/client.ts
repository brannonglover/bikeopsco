import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * The assistant answers inside a Twilio webhook, which Twilio abandons after
 * ~15 seconds. Everything here is tuned for that budget: a short timeout, one
 * retry, and low effort — a two-sentence text back to a customer does not need
 * deep reasoning, and a reply that arrives after Twilio has given up is worse
 * than a slightly plainer one that arrives.
 */
export const ASSISTANT_MODEL = "claude-opus-5";
export const ASSISTANT_TIMEOUT_MS = 12_000;

let cached: Anthropic | null = null;

/** Null when no API key is configured — callers skip the turn rather than throw. */
export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  if (!cached) {
    cached = new Anthropic({
      apiKey,
      timeout: ASSISTANT_TIMEOUT_MS,
      maxRetries: 1,
    });
  }
  return cached;
}
