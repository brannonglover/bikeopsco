/** Minutes to wait after the last message before sending a nudge email (default 10). */
export function getChatReminderMinutes(): number {
  const raw = process.env.CHAT_REMINDER_MINUTES?.trim();
  const n = raw ? parseInt(raw, 10) : 10;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function getChatReminderMs(): number {
  return getChatReminderMinutes() * 60 * 1000;
}
