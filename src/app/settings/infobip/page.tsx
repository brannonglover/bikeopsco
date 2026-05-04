import { ExternalLink, KeyRound, MessageSquareText, PhoneCall, ShieldCheck } from "lucide-react";

const INFOBIP_SETUP_STEPS = [
  {
    title: "Create and verify the Infobip account",
    description:
      "Sign up with the legal business name, billing details, service country, and a monitored admin email. Send a first test SMS from Infobip before connecting it to Bike Ops.",
  },
  {
    title: "Buy or register an SMS sender",
    description:
      "Use a leased SMS number when customers need to reply in chat. A branded sender name can work for one-way updates, but replies and STOP/START handling require a real number.",
  },
  {
    title: "Create an API key",
    description:
      "Create a restricted API key for Bike Ops with SMS sending access. Store it somewhere secure; Infobip only shows the full secret when the key is created.",
  },
  {
    title: "Add inbound forwarding",
    description:
      "Configure the SMS number to push inbound messages to the Bike Ops webhook URL for your workspace so customer replies appear in Chat.",
  },
  {
    title: "Run a live test",
    description:
      "Send a booking or job-status test to an opted-in customer number, reply to it from the phone, then confirm the reply appears in Bike Ops Chat.",
  },
] as const;

const INFOBIP_ENV_VARS = [
  {
    name: "INFOBIP_BASE_URL",
    detail: "Your Infobip API base URL, for example https://xxxxx.api.infobip.com, without a trailing slash.",
  },
  {
    name: "INFOBIP_API_KEY",
    detail: "The API key value generated for Bike Ops. Treat this like a password.",
  },
  {
    name: "INFOBIP_SENDER",
    detail: "The SMS number or sender ID Bike Ops should send from. Use the number format Infobip shows for the resource.",
  },
  {
    name: "INFOBIP_WEBHOOK_SECRET",
    detail: "Optional shared secret used to reject unknown inbound webhook calls.",
  },
] as const;

export default function InfobipSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Infobip SMS setup</h1>
        <p className="mt-1 text-text-secondary">
          Connect a shop-owned Infobip account so Bike Ops can send service texts and receive customer replies.
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
              Inbound SMS forwarding lets customer replies land in the Bike Ops chat inbox.
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
          Infobip credentials are configured by the Bike Ops workspace admin today. Do not paste API keys into chat or
          email unless your team has a secure handoff process.
        </div>

        <div className="mt-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Setup checklist</h2>
          <ol className="space-y-3">
            {INFOBIP_SETUP_STEPS.map((step, index) => (
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
              {INFOBIP_ENV_VARS.map((item) => (
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
              Set the forwarding method to HTTP POST and use this URL, replacing the host with the shop workspace:
            </p>
            <code className="mt-3 block break-all rounded-lg border border-surface-border bg-background px-3 py-2 text-xs text-foreground">
              https://yourshop.bikeops.co/api/webhooks/infobip/sms?secret=your-secret
            </code>
            <p className="mt-3 text-xs leading-5 text-text-secondary">
              If Infobip lets you add custom headers instead, send the same secret as{" "}
              <span className="font-mono">x-webhook-secret</span>. Use HTTPS only.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <a
            href="https://www.infobip.com/docs/sms/get-started/send-test-message"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-subtle-bg"
          >
            Test SMS guide
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
          <a
            href="https://www.infobip.com/docs/essentials/api-essentials/api-authorization"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-subtle-bg"
          >
            API key scopes
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
          <a
            href="https://www.infobip.com/docs/numbers"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-subtle-bg"
          >
            Numbers setup
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </section>
    </div>
  );
}
