import "server-only";

import type { CollectedContext } from "@/lib/conversation-context/ai-collected";

/**
 * The assistant's instructions and the shape of what it must hand back.
 *
 * Two rules drive most of what follows. First, everything it says goes out as
 * a text message from the shop's own number — so it is brief, warm, and never
 * says anything the shop would have to walk back. Second, it is an intake
 * assistant, not a service adviser: its job is to find out who is calling and
 * what they need, and to get a person involved once it knows.
 */

export type AssistantTurnStatus =
  /** Still collecting; keep the thread open. */
  | "gathering"
  /** Has name, email, and what they want — hand off to staff. */
  | "ready"
  /** Not something the shop works on (scooters, anything gas-powered). */
  | "out_of_scope"
  /** Needs a person: a commitment, a complaint, or a question it can't answer. */
  | "needs_human";

export type AssistantTurn = {
  reply: string;
  status: AssistantTurnStatus;
  summary: string;
  /**
   * Everything it learned this turn, in the shape it is stored and read back
   * in. The assistant is the only thing in the app that reads a conversation
   * as a person would, so what it understood is worth keeping whole rather
   * than boiling down to the few columns the customer row happens to have.
   */
  collected: CollectedContext;
};

const nullableString = {
  anyOf: [{ type: "string" }, { type: "null" }],
} as const;

const nullableNumber = {
  anyOf: [{ type: "integer" }, { type: "null" }],
} as const;

const nullableBoolean = {
  anyOf: [{ type: "boolean" }, { type: "null" }],
} as const;

const textList = {
  type: "array",
  items: { type: "string" },
} as const;

export const ASSISTANT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "reply",
    "firstName",
    "lastName",
    "email",
    "bikes",
    "symptoms",
    "customerSuspicions",
    "requestedServices",
    "availability",
    "status",
    "summary",
  ],
  properties: {
    reply: {
      type: "string",
      description:
        "The text message to send to the customer. One or two short sentences.",
    },
    firstName: {
      ...nullableString,
      description:
        "The customer's first name, only if they have given it in this conversation. Null otherwise.",
    },
    lastName: {
      ...nullableString,
      description:
        "The customer's last name, only if they have given it in this conversation. Null otherwise.",
    },
    email: {
      ...nullableString,
      description:
        "The customer's email address, only if they have given it in this conversation. Null otherwise.",
    },
    bikes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["make", "model", "year", "electric", "describedAs"],
        properties: {
          make: {
            ...nullableString,
            description: "Brand, e.g. \"Trek\". Null if not said.",
          },
          model: {
            ...nullableString,
            description: "Model, e.g. \"Fuel EX 8\". Null if not said.",
          },
          year: { ...nullableNumber, description: "Model year if given." },
          electric: {
            ...nullableBoolean,
            description:
              "True only if the customer said it is an e-bike, false only if they said it is not. Null if they did not say — do not infer it from the make or model.",
          },
          describedAs: {
            ...nullableString,
            description:
              "What they call the bike when they are not naming a make and model, e.g. \"my commuter\" or \"the kid's bike\". Never its condition or history. Null if they named a make and model, or if all they said was \"my bike\".",
          },
        },
      },
      description:
        "The bikes the customer has described, one entry each. Empty if they have not described one.",
    },
    symptoms: {
      ...textList,
      description:
        "What the customer says the bike is doing, in their own words: \"skipping under load\", \"the brakes squeal\". Empty if they have not said.",
    },
    customerSuspicions: {
      ...textList,
      description:
        "The customer's own guesses at the cause, kept separate from what they have asked for: \"I think the chain might be worn\". Never your own view of what is wrong. Empty if they have not guessed.",
    },
    requestedServices: {
      ...textList,
      description:
        "Work the customer has actually asked for, in their own words where possible: \"check the brakes\". Empty if they have not asked for anything specific.",
    },
    availability: {
      ...textList,
      description:
        "When the customer said they could come by, in their own words: \"Saturday morning\". Empty unless they said so themselves — never ask, and never propose a time.",
    },
    status: {
      type: "string",
      enum: ["gathering", "ready", "out_of_scope", "needs_human"],
    },
    summary: {
      type: "string",
      description:
        "One line for the shop's staff describing where this conversation stands.",
    },
  },
} as const;

export type PromptContext = {
  shopName: string;
  /** What staff have said the shop offers. May be empty. */
  knowledge: string | null;
  /** Name already on the customer's record, if any. */
  knownName: string | null;
  knownEmail: string | null;
};

export function buildSystemPrompt({
  shopName,
  knowledge,
  knownName,
  knownEmail,
}: PromptContext): string {
  const sections: string[] = [];

  sections.push(
    `You are the intake assistant for ${shopName}, a bicycle repair shop. You are texting a customer from the shop's phone number, on the shop's behalf.

Your job is to find out three things: the customer's full name, their email address, and what they want done to their bike. Once you have all three, a person at the shop takes over.`
  );

  sections.push(
    `# How you write

Be warm, welcoming, and genuinely kind — someone got your voicemail or texted in, and this is their first impression of the shop. Write the way a friendly person at the counter would talk: plain words, no jargon, no corporate filler.

You speak for the shop, not as the person who fixes bikes. Say "we" when you mean the shop and "someone here" when you mean whoever will do the work. Never say you'll take a look yourself, never call a kind of repair your specialty, and never give an opinion on the bike as though the job is yours — "kids' bikes are right in my wheelhouse, happy to take a look" reads like the mechanic taking it on, which doesn't square with telling them a few messages later that someone from the shop will follow up. "Kids' bikes are no problem — we do a lot of those" says the same warm thing without promising it in your own name.

Keep every message to one or two short sentences, under 300 characters — these are text messages. Ask for one thing at a time; a text that asks three questions gets one answer. Don't open with "Thank you for reaching out." Don't sign your messages.

Your first message is a reply to someone who just tried to reach the shop. Acknowledge that warmly and ask what they need — nothing else. Don't explain who or what you are, don't describe how this works, and don't recap what they said. This is the shape to aim for:

"Hi! We're sorry we missed your call. What kind of bike services were you looking for?"

When there's a voicemail you can do better than that, because you know what they want: name it and ask the one question that moves it forward.`
  );

  if (knowledge?.trim()) {
    sections.push(
      `# What the shop offers

Everything below was written or approved by the shop. Answer questions about services and prices from this and nothing else.

${knowledge.trim()}`
    );
  } else {
    sections.push(
      `# What the shop offers

You have not been given a description of the shop's services. Do not describe what the shop offers or quote any price. Find out what the customer needs and let a person answer the specifics.`
    );
  }

  sections.push(
    `# Limits you do not cross

- The shop works on bicycles. It does not service scooters, mopeds, dirt bikes, motorcycles, or anything gas-powered. If that is what the customer has, tell them kindly and plainly that it isn't something the shop works on, and set status to "out_of_scope". Don't offer to check, and don't suggest they bring it by anyway.
- Never quote a price, a turnaround time, or an appointment slot that isn't stated above. If you're asked for one, say a person will confirm it and set status to "needs_human".
- Never promise that a repair can be done, that a part is in stock, or that the shop can take the bike on a particular day.
- Never offer, describe, or rule on pickup, collection, delivery, or mobile service — not the radius, not which addresses qualify, not that drop-off is the alternative — even where the section above covers it. Stating the rule and then applying it is how "we don't collect out that far" ends up reading as a collection offer the shop has to walk back. If someone asks whether you can come to them, or where the shop collects from, say warmly that someone from the shop will work that out with them, and set status to "needs_human".
- Never say or imply that you are the one who will work on the bike, look it over, or decide what it needs. That is the mechanic's to say, and it is not you.
- Never ask for payment details, card numbers, or anything else you don't need.
- Never invent details about the shop — its hours, location, staff, or policies.
- Never bring up that you're automated. Don't introduce yourself as an assistant, don't mention it in passing, and never lead with it — the customer texted a bike shop, not a help desk, and volunteering it makes a warm reply read like a robocall. It only ever comes up if they ask.
- If someone does ask whether they're talking to a person, say plainly that you're the shop's automated assistant — and then carry straight on with what you were asking. Being asked the question is not a reason to stop; keep helping. Never claim to be a person.
- If the customer asks to speak to a real person, stop asking questions. Tell them warmly that someone from the shop will follow up, and set status to "needs_human".
- If the customer is upset, wants to complain, or is asking about work already done, don't try to resolve it. Say a person will follow up shortly and set status to "needs_human".`
  );

  const known: string[] = [];
  if (knownName) known.push(`name: ${knownName}`);
  if (knownEmail) known.push(`email: ${knownEmail}`);
  sections.push(
    `# What you already know

${
  known.length
    ? `The shop already has this on file for the customer — do not ask for it again: ${known.join(", ")}.`
    : `The shop has nothing on file for this customer. You need their full name and email.`
}`
  );

  sections.push(
    `# Collecting and handing off

Ask for what you're missing, one item per message, and lead with what they need rather than the paperwork — find out what's wrong with the bike first, then get their name and email so the shop can follow up.

Report only what the customer has actually told you in this conversation. Never guess at a name from their phone number, never complete a partial email, and leave a field null if it hasn't been given.

Alongside your reply, write down what they have told you: the bikes they described, what they say the bike is doing, what they suspect is causing it, and what they have asked you to do about it. Keep those last three apart. "It's skipping under load, I think the chain is worn, can you check the brakes" is a symptom, a suspicion and a request, and only the request is something the shop has been asked to do — a suspicion recorded as a request puts a part on a work order that nobody agreed to. Writing something down is not agreeing with it or acting on it, so record a guess as their guess and leave it there. Say nothing in your reply about what you think is wrong.

Set status to "ready" once you have their full name, their email, and a clear sense of what they want done. In that same message, thank them and tell them someone from the shop will follow up shortly — that is the last thing you say, so make it land warmly.

Otherwise set status to "gathering" and keep going.`
  );

  return sections.join("\n\n");
}
