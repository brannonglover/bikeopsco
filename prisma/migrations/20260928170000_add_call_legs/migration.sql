-- Staff devices rung for one inbound call.
--
-- Until now an inbound call rang every device with a repeated push notification
-- and there was nothing per-device to record: the ring was fire-and-forget, and
-- it stopped because the caller left the queue, not because anything cancelled
-- it. Ringing with real Twilio Client invites makes each device a live call leg
-- that has to be cancelled by hand the moment the call is settled — so each one
-- needs a row.
--
-- DECLINED is load-bearing rather than cosmetic: cancelling a leg whose device
-- has already declined crashes the iOS SDK (twilio-voice-react-native#722), so
-- the cancel sweep has to be able to tell those apart.

CREATE TYPE "CallLegStatus" AS ENUM (
  'PENDING',
  'RINGING',
  'ANSWERED',
  'DECLINED',
  'CANCELING',
  'ENDED'
);

CREATE TABLE "CallLeg" (
  "id"        TEXT NOT NULL,
  "callId"    TEXT NOT NULL,
  "identity"  TEXT NOT NULL,
  "callSid"   TEXT,
  "status"    "CallLegStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CallLeg_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallLeg_callSid_key" ON "CallLeg"("callSid");
CREATE INDEX "CallLeg_callId_status_idx" ON "CallLeg"("callId", "status");

ALTER TABLE "CallLeg"
  ADD CONSTRAINT "CallLeg_callId_fkey"
  FOREIGN KEY ("callId") REFERENCES "Call"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Which leg won the race to answer. A conditional UPDATE against this column is
-- the lock that lets exactly one device bridge to the caller; without it two
-- devices that pick up together both run <Dial><Queue> and the loser sits on an
-- empty queue for the dial timeout.
--
-- Not reusing "answeredAt": that is stamped on the caller's leg at the moment of
-- bridging, which is far too late to arbitrate between two devices.
ALTER TABLE "Call" ADD COLUMN "claimedByLegId" TEXT;
CREATE UNIQUE INDEX "Call_claimedByLegId_key" ON "Call"("claimedByLegId");

-- Per-shop kill switch for the new ring path, so it can be turned off without a
-- redeploy while it is being proven on real devices.
ALTER TABLE "AppSettings"
  ADD COLUMN "voiceNativeRingEnabled" BOOLEAN NOT NULL DEFAULT false;
