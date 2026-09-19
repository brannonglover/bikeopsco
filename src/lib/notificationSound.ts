/**
 * Plays a short notification sound when a notification is shown.
 * Uses the Web Audio API so no external audio file is required.
 * Browsers require a user gesture before playing; we unlock on interaction.
 */

let audioCtx: AudioContext | null = null;

/**
 * How late a tone may arrive and still be worth playing. Browsers leave
 * `resume()` pending until the page has user activation, so a tone requested
 * while the context was asleep would otherwise fire on the user's next click —
 * long after the message it was announcing.
 */
const RESUME_GRACE_MS = 1000;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function unlockAudioIfVisible(): void {
  if (!document.hidden) unlockAudio();
}

function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx?.state === "suspended") {
    ctx.resume().catch(() => {
      // Ignore: the gesture wasn't enough to start audio on this browser.
    });
  }
}

export function playNotificationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") {
      const requestedAt = Date.now();
      ctx
        .resume()
        .then(() => {
          // Dropped rather than queued: a ding that lands on an unrelated
          // click reads as "the app dinged because I clicked".
          if (Date.now() - requestedAt > RESUME_GRACE_MS) return;
          playTone(ctx);
        })
        .catch(() => {
          // Ignore if the browser refuses to start audio.
        });
      return;
    }
    playTone(ctx);
  } catch {
    // Ignore if Web Audio API is unavailable or blocked
  }
}

function playTone(ctx: AudioContext): void {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Ignore
  }
}

/**
 * Call on page load to keep audio unlocked. The listeners stay registered for
 * the life of the page: browsers re-suspend an idle AudioContext when the tab
 * is hidden, so unlocking only on the first gesture would leave later
 * notifications silent — or worse, deferred until the next click.
 */
export function initNotificationSound(): void {
  if (typeof window === "undefined") return;
  const events = ["click", "touchstart", "keydown"] as const;
  events.forEach((e) => document.addEventListener(e, unlockAudio, { passive: true }));
  // Named handlers, so a re-run (React strict mode) re-registers the same
  // listener rather than stacking a second one.
  document.addEventListener("visibilitychange", unlockAudioIfVisible);
}
