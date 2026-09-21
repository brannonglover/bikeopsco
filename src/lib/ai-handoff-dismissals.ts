/**
 * Which assistant handoff notes this device has already been shown.
 *
 * The note opens by itself when a handed-over thread is opened, so closing it
 * has to stick — otherwise it reappears every time staff come back to the
 * thread. The note itself is the record: a *new* handoff on the same thread
 * writes a new summary, and that one is worth opening again.
 *
 * Storage is best-effort and per-device: any failure (quota, private mode,
 * disabled storage) degrades to showing the note again rather than throwing.
 */

const KEY = "bikeops:ai-handoff-dismissed";
/** Threads remembered before the least-recently-dismissed one is dropped. */
const MAX_ENTRIES = 100;

type Entry = { id: string; summary: string };

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(store: Storage): Entry[] {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Entry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Entry).id === "string" &&
        typeof (entry as Entry).summary === "string"
    );
  } catch {
    return [];
  }
}

export function isHandoffDismissed(
  conversationId: string,
  summary: string
): boolean {
  const store = storage();
  if (!store) return false;
  return read(store).some(
    (entry) => entry.id === conversationId && entry.summary === summary
  );
}

export function markHandoffDismissed(
  conversationId: string,
  summary: string
): void {
  const store = storage();
  if (!store) return;
  const kept = read(store).filter((entry) => entry.id !== conversationId);
  kept.push({ id: conversationId, summary });
  try {
    store.setItem(KEY, JSON.stringify(kept.slice(-MAX_ENTRIES)));
  } catch {
    // Out of room or storage is off — the note simply opens again next time.
  }
}
