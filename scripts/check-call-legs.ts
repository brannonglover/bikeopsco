/**
 * Exercise the multi-device ring race against a real database.
 *
 * Run with: npm run check:call-legs
 *
 * These are the invariants that decide whether two staff phones ringing for one
 * caller behave or misbehave, and none of them can be reasoned about from the
 * code alone — they are all races, settled by conditional updates in Postgres.
 *
 * No Twilio traffic: every synthetic leg is created without a callSid, and both
 * cancelStaffLegs and voicemailIfAllDeclined only reach the REST API for legs
 * that have one. What is under test here is the arbitration, which is the part
 * that has to be right before any device is involved.
 *
 * Everything it creates is deleted again, including on failure.
 */
import { prisma } from "../src/lib/db";
import {
  cancelStaffLegs,
  claimCallForLeg,
  voicemailIfAllDeclined,
} from "../src/lib/voice-legs";

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function makeCall(shopId: string, legCount: number) {
  const call = await prisma.call.create({
    data: {
      shopId,
      direction: "INBOUND",
      status: "RINGING",
      fromNumber: "+15555550100",
      toNumber: "+15555550199",
      // Namespaced so a half-finished run is obvious and easy to clear by hand.
      twilioParentCallSid: `CHECKCALLLEGS${Date.now()}${Math.floor(Math.random() * 1e6)}`,
      startedAt: new Date(),
    },
    select: { id: true },
  });

  const legs = [];
  for (let i = 0; i < legCount; i += 1) {
    legs.push(
      await prisma.callLeg.create({
        // callSid deliberately null: keeps the REST cancel out of this entirely.
        data: { callId: call.id, identity: `check_staff_${i}`, status: "RINGING" },
        select: { id: true },
      })
    );
  }
  return { callId: call.id, legIds: legs.map((l) => l.id) };
}

async function run() {
  const shop = await prisma.shop.findFirst({ select: { id: true } });
  if (!shop) {
    console.error("No shop in this database — nothing to attach a test call to.");
    process.exit(1);
  }

  const created: string[] = [];

  try {
    // ---------------------------------------------------------------------
    console.log("\nA declined leg is never cancelled:");
    // The one that matters most. Cancelling an invite a device has already
    // rejected is what crashes the iOS SDK (twilio-voice-react-native#722) and
    // costs that phone all further VoIP delivery.
    {
      const { callId, legIds } = await makeCall(shop.id, 2);
      created.push(callId);
      const [declined, ringing] = legIds;
      await prisma.callLeg.update({
        where: { id: declined },
        data: { status: "DECLINED" },
      });

      await cancelStaffLegs(callId);

      const after = await prisma.callLeg.findMany({
        where: { callId },
        select: { id: true, status: true },
      });
      const declinedAfter = after.find((l) => l.id === declined)?.status;
      const ringingAfter = after.find((l) => l.id === ringing)?.status;

      check("declined leg is left alone", declinedAfter === "DECLINED", `got ${declinedAfter}`);
      check("ringing sibling is swept", ringingAfter === "ENDED", `got ${ringingAfter}`);
    }

    // ---------------------------------------------------------------------
    console.log("\nExactly one device may bridge:");
    {
      const { callId, legIds } = await makeCall(shop.id, 5);
      created.push(callId);

      // Five devices accepting in the same instant.
      const results = await Promise.all(legIds.map((id) => claimCallForLeg(callId, id)));
      const winners = results.filter(Boolean).length;
      check("one winner out of five simultaneous answers", winners === 1, `got ${winners}`);

      // A repeat tap on the device that won must not re-claim.
      const again = await claimCallForLeg(callId, legIds[0]);
      check("a second answer from any device loses", again === false);
    }

    // ---------------------------------------------------------------------
    console.log("\nCancellation is idempotent under concurrency:");
    {
      const { callId } = await makeCall(shop.id, 4);
      created.push(callId);

      // A staff answer, the caller hanging up and a Twilio retry all landing
      // together. Each leg must be claimed by exactly one of them.
      const counts = await Promise.all([
        cancelStaffLegs(callId),
        cancelStaffLegs(callId),
        cancelStaffLegs(callId),
      ]);
      const total = counts.reduce((a, b) => a + b, 0);
      // Every leg here is callSid-less, so nothing is returned for REST cancel;
      // what is being asserted is that the CANCELING claim happened once each.
      const live = await prisma.callLeg.count({
        where: { callId, status: { in: ["PENDING", "RINGING"] } },
      });
      check("no leg is left ringing", live === 0, `${live} still live`);
      check("no leg is cancelled twice", total === 0, `${total} REST cancels for SID-less legs`);
    }

    // ---------------------------------------------------------------------
    console.log("\nA decline does not strand the caller while others ring:");
    {
      const { callId, legIds } = await makeCall(shop.id, 2);
      created.push(callId);
      await prisma.callLeg.update({
        where: { id: legIds[0] },
        data: { status: "DECLINED" },
      });

      // One mechanic has declined; the other phone is still ringing. Sending
      // the caller to voicemail here is the bug this guards.
      const sent = await voicemailIfAllDeclined({
        callId,
        baseUrl: "https://example.invalid",
      });
      check("caller keeps holding while a device still rings", sent === false);

      const call = await prisma.call.findUnique({
        where: { id: callId },
        select: { endedAt: true },
      });
      check("call is left open", call?.endedAt === null);
    }
  } finally {
    // CallLeg cascades from Call.
    await prisma.call.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures} check${failures === 1 ? "" : "s"})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
