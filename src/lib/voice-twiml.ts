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
 * between documents, so the real hangup lands within about one <Pause> of it.
 *
 * holdMusicUrl is optional so this works with no external audio asset at all;
 * set VOICE_HOLD_MUSIC_URL to play real ringback instead of the spoken hold.
 */
export function buildQueueWaitTwiml(opts: {
  queueTimeSeconds: number;
  holdMusicUrl?: string | null;
  ringSeconds?: number;
}): string {
  const { queueTimeSeconds, holdMusicUrl = null, ringSeconds = RING_SECONDS } = opts;

  if (queueTimeSeconds >= ringSeconds) return twiml("<Leave/>");

  if (holdMusicUrl) return twiml(`<Play>${escapeXml(holdMusicUrl)}</Play>`);

  // No audio asset configured. Greet once, then hold in silence in short
  // chunks — each chunk ends the document, which re-requests this URL and
  // re-checks the elapsed time above.
  if (queueTimeSeconds < 2) {
    return twiml("<Say>Thanks for calling. Connecting you now.</Say><Pause length=\"5\"/>");
  }
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
 * ringTone is pinned to "us" so the caller hears a familiar US ringback
 * while the customer's phone rings. Without it Twilio picks its own default,
 * which sounds foreign enough that staff mistake it for a failed call.
 */
export function buildOutgoingCallTwiml(opts: {
  toNumber: string;
  callerId: string;
  statusCallbackUrl: string;
}): string {
  const { toNumber, callerId, statusCallbackUrl } = opts;
  return twiml(
    `<Dial callerId="${escapeXml(callerId)}" ringTone="us">` +
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
  greeting?: string;
}): string {
  const {
    recordingStatusCallbackUrl,
    transcribeCallbackUrl = null,
    greeting = "Sorry we missed you. Please leave a message after the tone.",
  } = opts;
  const transcribeAttrs = transcribeCallbackUrl
    ? ` transcribe="true" transcribeCallback="${escapeXml(transcribeCallbackUrl)}"`
    : "";
  return twiml(
    `<Say>${escapeXml(greeting)}</Say>` +
      `<Record maxLength="120" playBeep="true" ` +
      `recordingStatusCallback="${escapeXml(recordingStatusCallbackUrl)}" ` +
      `recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST"` +
      `${transcribeAttrs} />`
  );
}
