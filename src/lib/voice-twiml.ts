/**
 * Pure TwiML construction — string in, string out.
 *
 * Deliberately free of prisma, next/server and every other server-side import
 * so the documents Twilio will actually execute can be rendered and checked
 * in isolation. voice.ts re-exports all of this.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

/**
 * How long a caller waits in the queue before being sent to voicemail. This
 * replaces the old <Dial timeout>: it has to cover push delivery plus app
 * launch plus the dequeue leg, so it is longer than the 20s a direct
 * <Client> ring needed.
 */
export const RING_SECONDS = 25;

/**
 * The instant a caller stops being answerable: RING_SECONDS after they joined
 * the queue, at which point they are on their way to voicemail.
 *
 * One definition for every side of the ring — the push that tells the app how
 * long is left, and the answer path that refuses to bridge past it — so the
 * two can never disagree about whose clock decides. `startedAt` is nullable on
 * the row, so callers pass the creation time as the fallback rather than
 * letting a missing value read as "started now".
 */
export function ringDeadline(startedAt: Date): Date {
  return new Date(startedAt.getTime() + RING_SECONDS * 1000);
}

/** True once a caller who joined at `startedAt` has run out of ring window. */
export function hasRungOut(startedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= ringDeadline(startedAt).getTime();
}

/**
 * The query form of the same deadline: the join time before which a caller is
 * already out of time, for `startedAt > cutoff` comparisons in SQL. Derived
 * from RING_SECONDS like the rest, so there is still only one window.
 */
export function ringWindowCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RING_SECONDS * 1000);
}

/** The single per-shop hold queue. <Enqueue> creates it on first use. */
export function buildQueueName(shopId: string): string {
  return `shop-${shopId}`;
}

/**
 * TwiML for /incoming: park the caller in the shop's queue and let the push
 * notification do the ringing.
 *
 * This deliberately does NOT <Dial><Client>. Dialing a Client makes Twilio
 * send a PushKit VoIP push, and iOS then *requires* the app to hand the call
 * to CallKit — which is the native call screen we are trying not to show.
 * Parking the caller instead means staff are alerted by an ordinary push
 * notification and answer by dialing into this queue (see buildDequeueTwiml).
 */
export function buildIncomingCallTwiml(opts: {
  queueName: string;
  waitUrl: string;
  actionUrl: string;
}): string {
  const { queueName, waitUrl, actionUrl } = opts;
  return twiml(
    `<Enqueue waitUrl="${escapeXml(waitUrl)}" waitUrlMethod="POST" ` +
      `action="${escapeXml(actionUrl)}" method="POST">` +
      `${escapeXml(queueName)}</Enqueue>`
  );
}

/**
 * TwiML for /wait — what the caller hears while staff are being notified.
 * Twilio re-requests this every time the document finishes, passing QueueTime,
 * so it doubles as the ring timer: past RING_SECONDS it emits <Leave/>, which
 * pops the caller out of the queue and fires the <Enqueue> action URL with
 * QueueResult=leave, where /dequeued sends them to voicemail.
 *
 * The cutoff is a floor, not an exact deadline — it is only re-evaluated
 * between documents, so the real hangup lands within about one document of it.
 *
 * A held caller should hear what they'd hear on any other phone line: ringing,
 * until someone picks up. Queued calls get no ringback from the carrier — the
 * call is already answered as far as the network is concerned — so we play it
 * ourselves. Announcing "connecting you now" and then going quiet sounded like
 * a dropped call, which is why there is no longer anything spoken here.
 *
 * VOICE_HOLD_MUSIC_URL still overrides, for a shop that would rather play
 * music or its own message than a ring.
 */
export function buildQueueWaitTwiml(opts: {
  queueTimeSeconds: number;
  holdMusicUrl?: string | null;
  ringbackUrl?: string | null;
  ringSeconds?: number;
}): string {
  const {
    queueTimeSeconds,
    holdMusicUrl = null,
    ringbackUrl = null,
    ringSeconds = RING_SECONDS,
  } = opts;

  if (queueTimeSeconds >= ringSeconds) return twiml("<Leave/>");

  if (holdMusicUrl) return twiml(`<Play>${escapeXml(holdMusicUrl)}</Play>`);

  // One 6s cadence per document (2s ring, 4s gap). Ending the document is what
  // re-requests this URL and re-checks the elapsed time above, so the file
  // length also sets how precisely the ring window is honoured.
  if (ringbackUrl) return twiml(`<Play>${escapeXml(ringbackUrl)}</Play>`);

  // Last resort with no audio asset reachable: silence in short chunks.
  return twiml('<Pause length="5"/>');
}

/**
 * TwiML for /dequeued — the <Enqueue> action URL, hit whenever the caller
 * leaves the queue for any reason. Branching on QueueResult here (rather than
 * letting TwiML fall through past <Enqueue>) is what keeps an answered call
 * from landing in voicemail after the two parties hang up.
 */
export function buildDequeuedTwiml(opts: {
  queueResult: string | undefined;
  voicemailUrl: string;
}): string {
  const { queueResult, voicemailUrl } = opts;

  switch (queueResult) {
    case "bridged":
      // Staff took the call and it has now ended. Nothing left to do.
      return twiml("<Hangup/>");
    case "hangup":
      // Caller gave up while holding; no leg left to send anywhere.
      return twiml("<Hangup/>");
    case "leave":
    case "redirected":
    case "queue-full":
    default:
      // Nobody answered in time, staff declined, or the queue misbehaved —
      // all of which should still let the caller leave a message.
      return twiml(`<Redirect method="POST">${escapeXml(voicemailUrl)}</Redirect>`);
  }
}

/**
 * TwiML for a staff device answering a queued call: bridge this leg to the
 * longest-waiting caller in the shop queue.
 *
 * The timeout matters. Dialing an empty queue makes Twilio *wait* for someone
 * to join rather than failing fast, so a stale notification tap would sit on
 * dead air for the full duration without a short one here.
 *
 * <Queue url> is not a status callback — it is TwiML executed on the *caller's*
 * leg at the instant of bridging. That makes it the one precise signal for
 * "staff actually picked up", which is why answeredUrl points at /answered.
 */
export function buildDequeueTwiml(opts: {
  queueName: string;
  answeredUrl: string;
  timeoutSeconds?: number;
}): string {
  const { queueName, answeredUrl, timeoutSeconds = 10 } = opts;
  return twiml(
    `<Dial timeout="${timeoutSeconds}">` +
      `<Queue url="${escapeXml(answeredUrl)}" method="POST">` +
      `${escapeXml(queueName)}</Queue></Dial>`
  );
}

/**
 * TwiML for /outgoing: the TwiML App's Voice Request URL, hit when the
 * mobile Voice SDK places an outbound call. Dials the PSTN leg to the
 * customer, showing the shop's Twilio number as caller ID.
 *
 * answerOnBridge is what makes the staff device behave like a phone. Without
 * it Twilio answers the app's leg the instant this document runs, so the
 * Voice SDK jumps straight to Connected while the customer's phone has not
 * even rung: the app starts its duration timer on a call nobody has picked
 * up, and — because the SDK only plays ringback from its own `callDidStartRinging`
 * / `onRinging` callback, which that shortcut skips — the line is silent.
 * Staff had no way to tell a ringing phone from an answered one.
 *
 * With it, the app's leg stays unanswered until the customer picks up, so
 * the SDK passes through Ringing (audible ringback, "Calling…" on screen)
 * and reaches Connected — the timer's start — only on a real answer.
 *
 * ringTone is pinned to "us" so a caller Twilio does generate ringback for
 * hears a familiar US tone rather than Twilio's foreign-sounding default.
 */
export function buildOutgoingCallTwiml(opts: {
  toNumber: string;
  callerId: string;
  statusCallbackUrl: string;
}): string {
  const { toNumber, callerId, statusCallbackUrl } = opts;
  return twiml(
    `<Dial callerId="${escapeXml(callerId)}" answerOnBridge="true" ringTone="us">` +
      `<Number statusCallback="${escapeXml(statusCallbackUrl)}" ` +
      `statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">` +
      `${escapeXml(toNumber)}</Number></Dial>`
  );
}

/**
 * TwiML for /voicemail: greets and records. Deliberately does not persist
 * the recording itself — that arrives asynchronously via /recording once
 * Twilio finishes processing it, and the transcript later still via
 * /transcription. Three separate callbacks, three separate arrival times.
 *
 * Transcription is opt-in per call so a shop that doesn't want the per-minute
 * charge simply gets no transcribeCallback URL. Twilio only transcribes the
 * first 120 seconds, which is exactly maxLength here.
 */
export function buildVoicemailTwiml(opts: {
  recordingStatusCallbackUrl: string;
  transcribeCallbackUrl?: string | null;
  /** Absolute URL of a recorded greeting. Takes precedence over `greeting`. */
  greetingAudioUrl?: string | null;
  greeting?: string;
}): string {
  const {
    recordingStatusCallbackUrl,
    transcribeCallbackUrl = null,
    greetingAudioUrl = null,
    greeting = "Sorry we missed you. Please leave a message after the tone.",
  } = opts;
  const transcribeAttrs = transcribeCallbackUrl
    ? ` transcribe="true" transcribeCallback="${escapeXml(transcribeCallbackUrl)}"`
    : "";
  // A recorded greeting wins, but <Say> stays the fallback so a shop that
  // never records one still gets a working voicemail.
  const intro = greetingAudioUrl
    ? `<Play>${escapeXml(greetingAudioUrl)}</Play>`
    : `<Say>${escapeXml(greeting)}</Say>`;
  return twiml(
    intro +
      `<Record maxLength="120" playBeep="true" ` +
      `recordingStatusCallback="${escapeXml(recordingStatusCallbackUrl)}" ` +
      `recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST"` +
      `${transcribeAttrs} />`
  );
}
