import { NextRequest, NextResponse } from "next/server";
import { getConfiguredSmsProvider, sendSmsTest } from "@/lib/sms";

export const runtime = "nodejs";

/**
 * Test Twilio SMS. GET /api/sms/test?to=%2B1XXXXXXXXXX
 * If SMS_TEST_SECRET is set, add &secret=... (avoid open sends in production).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const to = searchParams.get("to");
  const secret = searchParams.get("secret");
  const expected = process.env.SMS_TEST_SECRET?.trim();

  if (expected && secret !== expected) {
    return NextResponse.json(
      { error: "Unauthorized — set ?secret= to match SMS_TEST_SECRET" },
      { status: 401 }
    );
  }

  const provider = getConfiguredSmsProvider();

  if (!to || to.length < 10) {
    return NextResponse.json(
      {
        error: "Add ?to= with your mobile in E.164, e.g. ?to=%2B15551234567",
      },
      { status: 400 }
    );
  }

  const { ok, error, externalMessageId } = await sendSmsTest(to);

  if (!ok) {
    return NextResponse.json(
      {
        error: error ?? "Send failed",
        hint:
          provider === "twilio"
            ? "Check Twilio logs and that TWILIO_PHONE_NUMBER matches your SMS-capable sender."
            : "Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER first.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: `Test SMS sent to ${to} using Twilio.`,
    externalMessageId,
  });
}
