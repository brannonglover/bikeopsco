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
 * How long staff devices ring before the caller is sent to voicemail. Roughly
 * what a desk phone gives you, and comfortably more than the VoIP push needs
 * to wake a sleeping device and raise the CallKit screen.
 */
export const RING_SECONDS = 25;

/** The single per-shop hold queue. <Enqueue> creates it on first use. */
export function buildQueueName(shopId: string): string {
  return `shop-${shopId}`;
}

/**
 * TwiML for /incoming: ring every registered staff device as a real call.
 *
 * Dialing <Client> is precisely what makes Twilio send a PushKit VoIP push,
 * which iOS then requires the app to hand to CallKit. That used to be the
 * thing this avoided; it is now the thing it is for. Only a CallKit call
 * rings until it is answered, declined or times out, rings through the silent
 * switch, and reaches a paired Apple Watch — an ordinary notification gets one
 * short alert, and a worn Watch takes even that off the phone. The app dresses
 * the system screen with the shop's own ringtone and icon via
 * setCallKitConfiguration, so what staff see still reads as this app.
 *
 * answerOnBridge keeps the caller hearing ringback instead of being answered
 * the instant this document runs — the same reason /outgoing sets it.
 */
export function buildIncomingCallTwiml(opts: {
  clientIdentities: string[];
  actionUrl: string;
  voicemailUrl: string;
  /**
   * Ridden along on the invite as <Parameter>, which is the only way to get
   * anything to the device before it answers. The app reads these to name the
   * caller on the ringing screen rather than showing a bare number.
   */
  clientParameters?: Record<string, string>;
  ringSeconds?: number;
}): string {
  const {
    clientIdentities,
    actionUrl,
    voicemailUrl,
    clientParameters = {},
    ringSeconds = RING_SECONDS,
  } = opts;

  // Nobody has a device registered, so there is no one to ring. Going straight
  // to voicemail beats an empty <Dial>, which would spend the whole ring
  // window on silence before arriving in the same place.
  if (clientIdentities.length === 0) {
    return twiml(`<Redirect method="POST">${escapeXml(voicemailUrl)}</Redirect>`);
  }

  // Empty values are dropped rather than sent: Twilio rejects a <Parameter>
  // with no value, which would fail the whole call over a missing name.
  const parameters = Object.entries(clientParameters)
    .filter(([, value]) => value !== "")
    .map(
      ([name, value]) =>
        `<Parameter name="${escapeXml(name)}" value="${escapeXml(value)}"/>`
    )
    .join("");

  const clients = clientIdentities
    .map(
      (identity) =>
        `<Client><Identity>${escapeXml(identity)}</Identity>${parameters}</Client>`
    )
    .join("");

  return twiml(
    `<Dial timeout="${ringSeconds}" answerOnBridge="true" ringTone="us" ` +
      `action="${escapeXml(actionUrl)}" method="POST">${clients}</Dial>`
  );
}

/**
 * TwiML for /dialed — the <Dial> action URL, reached once the ring ends
 * however it ended.
 *
 * "completed" means a device picked up and the conversation has since
 * finished, so the caller is done. Every other outcome — nobody answered in
 * time, every device declined, no device was reachable — still owes them a
 * voicemail. Branching here rather than letting TwiML fall through past <Dial>
 * is what stops an answered call from landing in voicemail after both parties
 * hang up.
 */
export function buildDialedTwiml(opts: {
  dialCallStatus: string | undefined;
  voicemailUrl: string;
}): string {
  const { dialCallStatus, voicemailUrl } = opts;
  if (dialCallStatus === "completed" || dialCallStatus === "answered") {
    return twiml("<Hangup/>");
  }
  return twiml(`<Redirect method="POST">${escapeXml(voicemailUrl)}</Redirect>`);
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
