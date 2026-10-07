/**
 * Run whole threads through the assistant's real prompt and output schema, and
 * print what it collected from each turn.
 *
 * Run with: npm run check:assistant-collection
 *
 * This is the live check on the collection itself: whether a symptom, a
 * customer's guess and an actual request stay in their own lists, whether a
 * bike survives a turn spent talking about something else, and whether a name
 * given across two messages comes back whole. It calls the Anthropic API a
 * handful of times and needs ANTHROPIC_API_KEY, so it is a check you run when
 * the prompt or the collected shape changes — not on every commit.
 *
 * It does not write anything. The thread is made up, no database is touched,
 * and the replies are thrown away after they are printed.
 */
import { ASSISTANT_MODEL, getAnthropicClient } from "../src/lib/ai/client";
import { ASSISTANT_OUTPUT_SCHEMA, buildSystemPrompt } from "../src/lib/ai/prompt";
import {
  COLLECTED_CONTEXT_VERSION,
  mergeCollectedContext,
  parseCollectedContext,
  type CollectedContext,
} from "../src/lib/conversation-context/ai-collected";

import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Picks ANTHROPIC_API_KEY out of .env / .env.local, in Next's own order.
 *
 * ts-node does not load env files, and the loader the database scripts share
 * reads only the two connection URLs. Nothing but this one key is taken, and
 * a value already exported in the shell wins.
 */
function loadApiKey(): void {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return;
  for (const name of [".env", ".env.local"]) {
    const path = join(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/g, "");
      if (value) process.env.ANTHROPIC_API_KEY = value;
    }
  }
}

const SHOP_NAME = "Basement Bike Mechanic";

const KNOWLEDGE = `We do tune-ups, brake and gear adjustments, wheel truing, flat repairs, and full overhauls on regular bikes and e-bikes. Tune-ups start at $80. We are at 2272 Mellville Ave and open Tuesday to Saturday.`;

type Thread = { name: string; customerMessages: string[] };

const THREADS: Thread[] = [
  {
    name: "symptom, suspicion and request in one breath — then a retraction",
    customerMessages: [
      "Hi! I have a Trek Fuel EX 8. It's skipping under load and I think the chain might be worn. I'd also like the brakes checked.",
      "Never mind about the chain, I checked it and the chain is fine.",
      "I'm Dave Cox, dave.cox@example.com. I could come by Friday around lunchtime.",
    ],
  },
  {
    name: "a name given across two messages, with a turn in between",
    customerMessages: [
      "Hi, I saw your sign outside. My bike's been sitting for years and the tires are flat. Roger",
      "Pearce. You're replying fast!",
      "rogerspearce75@gmail.com",
    ],
  },
];

type TurnResult = { reply: string; status: string; collected: CollectedContext };

async function runTurn(
  history: { role: "user" | "assistant"; content: string }[]
): Promise<TurnResult | null> {
  const client = getAnthropicClient();
  if (!client) return null;

  const response = await client.messages.create({
    model: ASSISTANT_MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt({
      shopName: SHOP_NAME,
      knowledge: KNOWLEDGE,
      knownName: null,
      knownEmail: null,
      trigger: "inbound_sms",
      opening: history.every((turn) => turn.role === "user"),
    }),
    messages: history,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: ASSISTANT_OUTPUT_SCHEMA },
    },
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.log(`   !! unparseable output: ${text.slice(0, 200)}`);
    return null;
  }

  const collected = parseCollectedContext({
    version: COLLECTED_CONTEXT_VERSION,
    identity: {
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      email: parsed.email,
    },
    bikes: parsed.bikes,
    service: {
      symptoms: parsed.symptoms,
      customerSuspicions: parsed.customerSuspicions,
      requestedServices: parsed.requestedServices,
    },
    scheduling: { availability: parsed.availability },
  });

  return {
    reply: typeof parsed.reply === "string" ? parsed.reply : "",
    status: typeof parsed.status === "string" ? parsed.status : "?",
    collected: collected!,
  };
}

function show(label: string, context: CollectedContext): void {
  const { identity, bikes, service, scheduling } = context;
  const name = [identity.firstName, identity.lastName].filter(Boolean).join(" ");
  const list = (items: string[]) => (items.length ? items.join(" | ") : "—");
  console.log(`   ${label}`);
  console.log(`     name            ${name || "—"}`);
  console.log(`     email           ${identity.email ?? "—"}`);
  console.log(
    `     bikes           ${
      bikes
        .map((b) =>
          [
            [b.year, b.make, b.model].filter(Boolean).join(" ") || b.describedAs,
            b.electric === null ? null : b.electric ? "e-bike" : "not an e-bike",
          ]
            .filter(Boolean)
            .join(", ")
        )
        .join(" / ") || "—"
    }`
  );
  console.log(`     symptoms        ${list(service.symptoms)}`);
  console.log(`     suspicions      ${list(service.customerSuspicions)}`);
  console.log(`     requested       ${list(service.requestedServices)}`);
  console.log(`     availability    ${list(scheduling.availability)}`);
}

async function run(): Promise<void> {
  loadApiKey();
  if (!getAnthropicClient()) {
    console.error(
      "\nANTHROPIC_API_KEY is not set — put it in .env.local or export it, then run again.\n"
    );
    process.exit(1);
  }

  for (const thread of THREADS) {
    console.log(`\n${"=".repeat(72)}\n${thread.name}\n${"=".repeat(72)}`);
    const history: { role: "user" | "assistant"; content: string }[] = [];
    let merged: CollectedContext | null = null;

    for (const [index, text] of thread.customerMessages.entries()) {
      history.push({ role: "user", content: text });
      console.log(`\n-- turn ${index + 1}\n   customer: ${text}`);

      const result = await runTurn(history);
      if (!result) {
        console.log("   !! turn failed");
        break;
      }
      history.push({ role: "assistant", content: result.reply });

      console.log(`   shop:     ${result.reply}`);
      console.log(`   status:   ${result.status}\n`);
      show("collected this turn:", result.collected);
      merged = mergeCollectedContext(merged, result.collected);
    }

    if (merged) {
      console.log("");
      show("stored on the conversation:", merged);
    }
  }
  console.log("");
}

void run();
