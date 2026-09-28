/**
 * Exercise the conversation context layer against the threads that shaped it.
 *
 * Run with: npm run check:conversation-context
 *
 * Two things are being checked. The first is that a value reaches a staff form
 * at all — the bug that started this was a surname the assistant had collected
 * being suppressed by a first name the extractor found. The second is that it
 * arrives labelled with where it came from, because "their own text said so"
 * and "it was already on file" are confirmed differently.
 *
 * Cases marked GAP are behaviour that is known to be wrong and deliberately
 * left alone; they print every run rather than failing, and the day one starts
 * passing is the day to delete the case.
 */
import {
  buildCustomerIdentityContext,
  type IdentityCustomerRecord,
} from "../src/lib/conversation-context/customer-identity";
import {
  EMPTY_COLLECTED_CONTEXT,
  mergeCollectedContext,
  parseCollectedContext,
  type CollectedContext,
} from "../src/lib/conversation-context/ai-collected";
import type {
  ContextField,
  ConversationContext,
} from "../src/lib/conversation-context/types";
import {
  matchRequestedServices,
  confidentServiceIds,
  type ServiceOption,
} from "../src/lib/conversation-context/service-matching";
import { buildJobDraft } from "../src/lib/job-from-conversation";
import { resolveField } from "../src/lib/conversation-context/field";

type Message = { sender: string; body: string | null };

/** The thread the Create contact bug was reported on, lightly shortened. */
const ROGER_THREAD: Message[] = [
  {
    sender: "CUSTOMER",
    body: "Hi, I believe you live in my neighborhood and I saw a sign outside advertising bike repairs. I seem to have 2 numbers for you. Roger",
  },
  { sender: "STAFF", body: "Hi Roger! Yes — the shop is at 2272 Mellville Ave." },
  { sender: "STAFF", body: "What's your name and email so we can follow up?" },
  { sender: "CUSTOMER", body: "Pearce. You are replying very fast!" },
  { sender: "CUSTOMER", body: "rogerspearce75@gmail.com" },
];

const PROVISIONAL: IdentityCustomerRecord = {
  firstName: "(404) 917-6317",
  lastName: null,
  email: null,
  phone: "+14049176317",
  address: null,
  notes: null,
  provisional: true,
};

/**
 * A stored collection holding just a name.
 *
 * Built through the same reader the JSON column goes through, because that is
 * the only way a collection ever reaches the merge — the guards that reject a
 * narrated sentence live there, and a case that skipped them would be testing
 * a state production cannot produce.
 */
function collectedIdentity(
  firstName: string | null,
  lastName: string | null,
  email: string | null = null
): CollectedContext {
  return parseCollectedContext({ identity: { firstName, lastName, email } })!;
}

/** "Pearce [ai_collected]" — the value and the layer it was resolved from. */
function describe<T>(field: ContextField<T>): string {
  return field ? `${String(field.value)} [${field.source}]` : "—";
}

type IdentityCase = {
  name: string;
  messages: Message[];
  customer: IdentityCustomerRecord;
  collected: CollectedContext | null;
  /** Expected "firstName | lastName" once resolved, with their layers. */
  expect: string;
};

const IDENTITY_CASES: IdentityCase[] = [
  {
    name: "collected surname completes an extracted first name",
    messages: ROGER_THREAD,
    customer: PROVISIONAL,
    collected: collectedIdentity("Roger", "Pearce"),
    expect: "Roger [conversation] | Pearce [ai_collected]",
  },
  {
    name: "thread handled before collections were stored",
    messages: ROGER_THREAD,
    customer: { ...PROVISIONAL, firstName: "Roger", lastName: "Pearce" },
    collected: null,
    expect: "Roger [conversation] | Pearce [ai_collected]",
  },
  {
    name: "contact staff have confirmed is read as the file it is",
    messages: [{ sender: "CUSTOMER", body: "the brakes are loose" }],
    customer: {
      firstName: "Roger",
      lastName: "Pearce",
      email: "roger@example.com",
      phone: "+14049176317",
      address: "12 Elm St",
      notes: null,
      provisional: false,
    },
    collected: null,
    expect: "Roger [customer_record] | Pearce [customer_record]",
  },
  {
    name: "someone else named in the thread never borrows the surname",
    messages: [
      { sender: "CUSTOMER", body: "Hi, my name is Sarah, dropping my husband's bike off" },
    ],
    customer: PROVISIONAL,
    collected: collectedIdentity("Roger", "Pearce"),
    expect: "Sarah [conversation] | —",
  },
  {
    name: "a narrated sentence is not a name",
    messages: [{ sender: "CUSTOMER", body: "hello?" }],
    customer: PROVISIONAL,
    collected: collectedIdentity(
      "The customer has not given their name yet, but did say they would shortly",
      null
    ),
    expect: "— | —",
  },
  {
    name: "the placeholder number never reaches the form as a name",
    messages: [{ sender: "CUSTOMER", body: "hello?" }],
    customer: PROVISIONAL,
    collected: null,
    expect: "— | —",
  },
];

type MergeCase = {
  name: string;
  previous: CollectedContext;
  incoming: CollectedContext;
  read: (context: CollectedContext) => string;
  expect: string;
  /** Set when the expectation records behaviour we know to be wrong. */
  gap?: string;
};

const TREK = parseCollectedContext({
  identity: { firstName: "Dave", lastName: null, email: null },
  bikes: [
    { make: "Trek", model: "Fuel EX 8", year: null, electric: null, describedAs: null },
  ],
  service: {
    symptoms: ["Skipping under load"],
    customerSuspicions: ["Chain might be worn"],
    requestedServices: ["Check the brakes"],
  },
  scheduling: { availability: ["Friday around lunchtime"] },
})!;

const bike = (context: CollectedContext) =>
  context.bikes.map((b) => [b.make, b.model].filter(Boolean).join(" ")).join(", ") || "—";
const suspicions = (context: CollectedContext) =>
  context.service.customerSuspicions.join(", ") || "—";

const MERGE_CASES: MergeCase[] = [
  {
    name: "a turn that reports nothing erases nothing",
    previous: TREK,
    incoming: EMPTY_COLLECTED_CONTEXT,
    read: bike,
    expect: "Trek Fuel EX 8",
  },
  {
    name: "a correction replaces what it corrects",
    previous: TREK,
    incoming: parseCollectedContext({
      bikes: [
        { make: "Trek", model: "Fuel EX 9", year: 2021, electric: false, describedAs: null },
      ],
    })!,
    read: bike,
    expect: "Trek Fuel EX 9",
  },
  {
    name: "a withdrawn suspicion still stands",
    previous: TREK,
    // "Never mind, I checked it and the chain is fine" — the customer has
    // taken it back, and the model reports an empty list to say so.
    incoming: parseCollectedContext({
      identity: { firstName: "Dave", lastName: null, email: null },
      service: {
        symptoms: ["Skipping under load"],
        customerSuspicions: [],
        requestedServices: ["Check the brakes"],
      },
    })!,
    read: suspicions,
    expect: "Chain might be worn",
    gap: "an empty list cannot say 'they took it back' — needs explicit removals in the collection, not absence",
  },
];

/** A price list with the shapes that make matching hard. */
const SHOP_SERVICES: ServiceOption[] = [
  { id: "svc_brake", name: "Brake adjustment" },
  { id: "svc_brake_bleed", name: "Brake bleed" },
  { id: "svc_tune", name: "Tune-up" },
  { id: "svc_true", name: "Wheel truing" },
  { id: "svc_flat", name: "Flat repair" },
  { id: "svc_general", name: "General service" },
];

type MatchCase = {
  name: string;
  requested: string;
  /** Service name and confidence, or "—" for no match at all. */
  expect: string;
};

const MATCH_CASES: MatchCase[] = [
  {
    name: "a request lands on the service that covers it",
    requested: "Check the brakes",
    expect: "Brake adjustment [strong]",
  },
  {
    name: "plurals and filler do not stop a match",
    requested: "could you please check my brakes",
    expect: "Brake adjustment [strong]",
  },
  {
    name: "a partial overlap is offered but not trusted",
    requested: "my back wheel is buckled",
    expect: "Wheel truing [weak]",
  },
  {
    name: "a symptom nobody sells a fix for matches nothing",
    requested: "there is a creaking noise when I pedal",
    expect: "—",
  },
  {
    name: "a vague request is offered rather than assumed",
    requested: "just the usual service",
    expect: "General service [weak]",
  },
  {
    name: "a service named only with generic words is still reachable",
    requested: "I would like a general service",
    expect: "General service [strong]",
  },
];

/**
 * The mapping a job does, on the thread that shaped all of this.
 *
 * These are the assertions that matter most in the whole file: a guess must
 * not become billable work, and words about time must not become a booking.
 */
function jobMappingCases(): { name: string; ok: boolean; detail: string }[] {
  const matches = matchRequestedServices(
    TREK.service.requestedServices,
    SHOP_SERVICES
  );
  const context: ConversationContext = {
    conversationId: "conv_test",
    customerId: "cus_test",
    identity: buildCustomerIdentityContext({
      messages: [],
      customer: PROVISIONAL,
      collected: TREK,
    }),
    bikes: TREK.bikes.map((b) => ({
      make: resolveField<string>(["ai_collected", b.make]),
      model: resolveField<string>(["ai_collected", b.model]),
      year: resolveField<number>(["ai_collected", b.year]),
      electric: resolveField<boolean>(["ai_collected", b.electric]),
      describedAs: resolveField<string>(["ai_collected", b.describedAs]),
      customerBikeId: null,
    })),
    service: {
      symptoms: resolveField<string[]>(["ai_collected", TREK.service.symptoms]),
      customerSuspicions: resolveField<string[]>([
        "ai_collected",
        TREK.service.customerSuspicions,
      ]),
      requestedServices: resolveField<string[]>([
        "ai_collected",
        TREK.service.requestedServices,
      ]),
      serviceIds: resolveField<string[]>([
        "ai_collected",
        confidentServiceIds(matches),
      ]),
      serviceMatches: matches,
    },
    scheduling: {
      availability: resolveField<string[]>([
        "ai_collected",
        TREK.scheduling.availability,
      ]),
    },
  };

  const draft = buildJobDraft(context);

  return [
    {
      name: "the request they made becomes the line item",
      ok: draft.serviceIds.length === 1 && draft.serviceIds[0] === "svc_brake",
      detail: draft.serviceIds.join(", ") || "—",
    },
    {
      name: "their guess never becomes billable work",
      // "Chain might be worn" must not have pulled in a service, and must
      // still be on the job where staff can read it.
      ok:
        !draft.serviceIds.includes("svc_tune") &&
        draft.customerNotes.includes("Customer suspects: Chain might be worn"),
      detail: draft.customerNotes.split("\n").find((l) => l.startsWith("Customer suspects")) ?? "—",
    },
    {
      name: "the symptom is recorded as theirs, not as a diagnosis",
      ok: draft.customerNotes.includes("Customer reports: Skipping under load"),
      detail: draft.customerNotes.split("\n").find((l) => l.startsWith("Customer reports")) ?? "—",
    },
    {
      name: "what they said about timing never becomes a booking",
      // It reaches the job as words. The drop-off date is a person's job.
      ok:
        draft.availability.includes("Friday around lunchtime") &&
        draft.customerNotes.includes("Availability given: Friday around lunchtime"),
      detail: draft.availability.join(", ") || "—",
    },
    {
      name: "the bike arrives without a type nobody stated",
      ok: draft.bikes.length === 1 && draft.bikes[0].bikeType === null,
      detail: `${draft.bikes[0]?.make} ${draft.bikes[0]?.model} / ${draft.bikes[0]?.bikeType ?? "not stated"}`,
    },
  ];
}

function run(): void {
  let failures = 0;
  let gaps = 0;

  console.log("\nIdentity — resolved value and the layer it came from:\n");
  for (const test of IDENTITY_CASES) {
    const identity = buildCustomerIdentityContext({
      messages: test.messages,
      customer: test.customer,
      collected: test.collected,
    });
    const actual = `${describe(identity.firstName)} | ${describe(identity.lastName)}`;
    const ok = actual === test.expect;
    if (!ok) failures++;
    console.log(`${ok ? "  " : "!!"} ${test.name}`);
    console.log(`        ${actual}`);
    if (!ok) console.log(`        expected: ${test.expect}`);
  }

  console.log("\nCollection across turns:\n");
  for (const test of MERGE_CASES) {
    const actual = test.read(mergeCollectedContext(test.previous, test.incoming));
    const ok = actual === test.expect;
    if (!ok) failures++;
    else if (test.gap) gaps++;
    const mark = !ok ? "!!" : test.gap ? "GAP" : "  ";
    console.log(`${mark} ${test.name}`);
    console.log(`        ${actual}`);
    if (!ok) console.log(`        expected: ${test.expect}`);
    if (test.gap && ok) console.log(`        known gap: ${test.gap}`);
  }

  console.log("\nRequests matched against the price list:\n");
  for (const test of MATCH_CASES) {
    const [match] = matchRequestedServices([test.requested], SHOP_SERVICES);
    const actual = match.serviceName
      ? `${match.serviceName} [${match.confidence}]`
      : "—";
    const ok = actual === test.expect;
    if (!ok) failures++;
    console.log(`${ok ? "  " : "!!"} ${test.name}`);
    console.log(`        "${test.requested}" -> ${actual}`);
    if (!ok) console.log(`        expected: ${test.expect}`);
  }

  console.log("\nWhat a job takes from the conversation, and what it refuses:\n");
  for (const test of jobMappingCases()) {
    if (!test.ok) failures++;
    console.log(`${test.ok ? "  " : "!!"} ${test.name}`);
    console.log(`        ${test.detail}`);
  }

  console.log("\nStored JSON that cannot be trusted:\n");
  const hostile = parseCollectedContext({
    identity: { firstName: 42, email: "not-an-email" },
    bikes: [{ make: null, model: null }, "nonsense", { make: "Specialized" }],
    service: { symptoms: ["a", "A", "a", null], requestedServices: "brakes" },
  });
  const hostileOk =
    hostile !== null &&
    hostile.identity.firstName === null &&
    hostile.identity.email === null &&
    hostile.bikes.length === 1 &&
    hostile.bikes[0].make === "Specialized" &&
    hostile.service.symptoms.length === 1 &&
    hostile.service.requestedServices.length === 0;
  if (!hostileOk) failures++;
  console.log(`${hostileOk ? "  " : "!!"} junk is dropped, the rest survives`);
  console.log(`        ${JSON.stringify(hostile)}`);

  const emptyColumnOk = parseCollectedContext(null) === null;
  if (!emptyColumnOk) failures++;
  console.log(
    `${emptyColumnOk ? "  " : "!!"} a conversation the assistant never handled reads as null`
  );

  console.log(
    `\n${failures === 0 ? "PASS" : `FAIL (${failures} case${failures === 1 ? "" : "s"})`}` +
      (gaps > 0 ? ` — ${gaps} known gap${gaps === 1 ? "" : "s"}` : "")
  );
  process.exit(failures === 0 ? 0 : 1);
}

run();
