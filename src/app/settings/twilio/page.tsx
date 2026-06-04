import { ExternalLink, KeyRound, MessageSquareText, PhoneCall, ShieldCheck } from "lucide-react";

const TWILIO_SETUP_STEPS = [
  {
    title: "Verify your Twilio account",
    description:
      "Complete Twilio's business verification and toll-free or A2P 10DLC registration so your number can send to customers in production.",
  },
  {
    title: "Buy an SMS-capable phone number",
    description:
      "Use a number that can send and receive SMS so customer replies appear in Bike Ops Chat. Configure it under Phone Numbers in the Twilio Console.",
  },
  {
    title: "Copy Account SID and Auth Token",
    description:
      "Find these on the Twilio Console home page. If you rotate the auth token, update Bike Ops env vars and redeploy.",
  },
  {
    title: "Configure the inbound webhook",
    description:
      "On your Twilio number, set Messaging → A message comes in → Webhook POST to the Bike Ops inbound URL for your workspace.",
  },
  {
    title: "Run a live test",
    description:
      "Hit GET /api/sms/test?to=%2B15551234567 with your mobile in E.164 format, then reply from the phone and confirm the message appears in Chat.",
  },
] as const;

const TWILIO_ENV_VARS = [
  {
    name: "TWILIO_ACCOUNT_SID",
    detail: "Starts with AC. Found on the Twilio Console dashboard.",
  },
  {
    name: "TWILIO_AUTH_TOKEN",
    detail: "Primary or secondary auth token for the account. Treat this like a password.",
  },
  {
    name: "TWILIO_PHONE_NUMBER",
    detail: "Your Twilio SMS number in E.164 format, e.g. +15551234567. Must match the sender configured in Console.",
  },
  {
    name: "TWILIO_WEBHOOK_URL",
    detail: "Optional override for inbound webhook signature validation when the public URL differs from the request host.",
  },
] as const;

export default function TwilioSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Twilio SMS setup</h1>
        <p className="mt-1 text-text-secondary">
          Connect a shop-owned Twilio account so Bike Ops can send service texts and receive customer replies.
        </p>
      </div>

      <section className="rounded-xl border border-surface-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-surface-border bg-subtle-bg p-3">
            <MessageSquareText className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
            <h2 className="mt-2 text-sm font-semibold text-foreground">Service SMS</h2>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              Sends booking confirmations, repair updates, payment links, reminders, and chat nudges.
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-subtle-bg p-3">
            <PhoneCall className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
            <h2 className="mt-2 text-sm font-semibold text-foreground">Two-way replies</h2>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              Inbound SMS webhooks let customer replies land in the Bike Ops chat inbox.
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-subtle-bg p-3">
            <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
            <h2 className="mt-2 text-sm font-semibold text-foreground">Consent aware</h2>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              Bike Ops respects customer SMS consent and handles STOP, START, and HELP replies.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Twilio credentials are configured by the Bike Ops workspace admin. Do not paste API keys into chat or email
          unless your team has a secure handoff process.
        </div>

        <div className="mt-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Setup checklist</h2>
          <ol className="space-y-3">
            {TWILIO_SETUP_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                  {index + 1}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">{step.title}</span>
                  <span className="block text-sm leading-6 text-text-secondary">{step.description}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-lg border border-surface-border bg-subtle-bg p-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-foreground" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">Values Bike Ops needs</h2>
            </div>
            <dl className="mt-3 space-y-3">
              {TWILIO_ENV_VARS.map((item) => (
                <div key={item.name}>
                  <dt className="font-mono text-xs font-semibold text-foreground">{item.name}</dt>
                  <dd className="mt-0.5 text-xs leading-5 text-text-secondary">{item.detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-lg border border-surface-border bg-subtle-bg p-3">
            <h2 className="text-sm font-semibold text-foreground">Inbound webhook</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              On your Twilio number, set &quot;A message comes in&quot; to HTTP POST:
            </p>
            <code className="mt-3 block break-all rounded-lg border border-surface-border bg-background px-3 py-2 text-xs text-foreground">
              https://yourshop.bikeops.co/api/webhooks/twilio/sms
            </code>
            <p className="mt-3 text-xs leading-5 text-text-secondary">
              Twilio signs requests with your auth token. If you use a custom domain or proxy, set{" "}
              <span className="font-mono">TWILIO_WEBHOOK_URL</span> to the exact URL configured in Console.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <a
            href="https://console.twilio.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-subtle-bg"
          >
            Twilio Console
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
          <a
            href="https://www.twilio.com/docs/messaging/tutorials/how-to-receive-and-reply"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-subtle-bg"
          >
            Inbound SMS guide
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
          <a
            href="https://www.twilio.com/docs/messaging/api/message-resource"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-subtle-bg"
          >
            Send API docs
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </section>
    </div>
  );
}
