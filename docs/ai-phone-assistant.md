# AI phone assistant

With **Settings → Features → AI answers the phone** on, the AI assistant picks
up every inbound call. It answers questions about the shop and the caller's
open repairs, takes messages, and rings staff when a caller asks for a person.
If nobody picks up, the caller goes back to the assistant to leave a message
instead of hearing a voicemail beep. After every call, staff get a push with a
summary. Calls that need a reply also show up as a handoff note in the
caller's chat thread.

The live conversation runs on an **ElevenLabs agent**. Vercel functions can't
hold a call's audio stream, so Twilio streams it straight to ElevenLabs. BikeOps
handles the edges of the call:

| When | Where | What |
|---|---|---|
| Call arrives | `/api/webhooks/twilio/voice/incoming` | Registers the call with the agent. Sends the shop's prompt and the caller's open repairs with it, so the agent never has to stop mid-call to look anything up. |
| Caller asks for a person | `/api/webhooks/elevenlabs/transfer` → `/api/webhooks/twilio/voice/ai-handoff` | Moves the call into the shop queue and rings staff the same way as today. |
| Nobody answers | `/dequeued` → `/api/webhooks/twilio/voice/ai-message` | Reconnects the caller to the agent in take-a-message mode. |
| Conversation ends | `/api/webhooks/elevenlabs/post-call` | Saves the transcript and summary on the call, updates the contact and thread, and sends staff a push. |

If ElevenLabs is unreachable or slow (more than 4 s), the call falls back to
ringing staff, so callers never get dead air.

## One-time setup

One agent serves every shop. Everything shop-specific is sent with each call.

### 1. Create the agent (ElevenLabs → Agents → New agent)

- **Voice:** pick a warm, natural voice from the library. Shortlist a few, then
  call in and listen to each.
- **TTS model:** a Flash/Turbo model. These have the lowest latency.
- **LLM:** a fast model, such as Gemini Flash, GPT mini or Claude Haiku. The
  prompt already holds the shop's details, so the model doesn't need to be
  large, and a smaller one keeps the gap between turns short.
- **Conversation:** leave interruptions on. Set turn eagerness to normal or
  eager.
- **System prompt / first message:** leave a one-line placeholder. Every call
  replaces both.
- **Security → Overrides:** enable **System prompt** and **First message**.
  Register-call rejects the per-call prompt without these.
- **Tools → System tools:** enable **End call**.

### 2. Add the transfer tool (Tools → Add tool → Webhook)

- Name: `transfer_to_staff`
- Description: `Connects the caller to a person at the shop. Use only when the caller asks to speak to someone. Say a short line like "let me grab someone for you" in the same turn.`
- Method / URL: `POST https://app.bikeops.co/api/webhooks/elevenlabs/transfer`
- Headers:
  - `X-BikeOps-Tool-Secret`: type **Secret**, with the value of `VOICE_AGENT_TOOL_SECRET`
  - `X-BikeOps-Call`: type **Dynamic variable**, set to `bikeops_call_ref`
- No body parameters.

### 3. Add the post-call webhook (Settings → Webhooks)

- URL: `https://app.bikeops.co/api/webhooks/elevenlabs/post-call`
- Turn on **transcription** events for the agent.
- Copy the signing secret into `ELEVENLABS_WEBHOOK_SECRET`.

Also check **audio retention** in the agent's privacy settings. The app only
needs the transcript.

### 4. Environment variables (Vercel, Production only)

| Variable | Value |
|---|---|
| `ELEVENLABS_API_KEY` | An API key with Agents access |
| `ELEVENLABS_AGENT_ID` | The agent's id |
| `ELEVENLABS_WEBHOOK_SECRET` | The post-call webhook's signing secret |
| `VOICE_AGENT_TOOL_SECRET` | A long random string, e.g. `openssl rand -base64 48`. The same value goes in the tool's secret header. It also signs the per-call ref. |

Phone answering stays off until all four are set, even with the toggle on.
`ANTHROPIC_API_KEY`, which the text assistant already uses, writes the
after-call summary. Without it, ElevenLabs' own summary is used.

Nothing changes in Twilio. The number already points at `/incoming`.

## Turning it on for a shop

1. **Settings → Features**: under the AI assistant, fill in **What the
   assistant can say you offer**, including your opening hours. Optionally
   give the assistant a name.
2. Check that the shop's services and prices under **Settings → Services**
   are current. The assistant quotes them as starting prices.
3. Turn on **AI answers the phone**. **Voice calls** must also be on for
   transfers to ring anyone. With it off, the assistant takes a message instead.
