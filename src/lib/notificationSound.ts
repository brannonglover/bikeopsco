/**
 * Plays a short notification sound when a notification is shown.
 * Uses the Web Audio API so no external audio file is required.
 * Browsers require a user gesture before playing; we unlock on first click/tap/keydown.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx?.state === "suspended") {
    ctx.resume();
  }
}

export function playNotificationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") {
      ctx.resume().then(() => playTone(ctx));
    } else {
      playTone(ctx);
    }
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

/** Call on page load to unlock audio on first user interaction. */
export function initNotificationSound(): void {
  if (typeof window === "undefined") return;
  const events = ["click", "touchstart", "keydown"] as const;
  const unlock = () => {
    unlockAudio();
    events.forEach((e) => document.removeEventListener(e, unlock));
  };
  events.forEach((e) => document.addEventListener(e, unlock, { once: true, passive: true }));
}
