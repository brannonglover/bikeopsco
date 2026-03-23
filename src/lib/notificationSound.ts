/**
 * Plays a short notification sound when a notification is shown.
 * Uses the Web Audio API so no external audio file is required.
 * May be silenced by the browser if the user has not interacted with the page.
 */
export function playNotificationSound(): void {
  if (typeof window === "undefined") return;
  try {
    const ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
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
    // Ignore if Web Audio API is unavailable or blocked
  }
}
