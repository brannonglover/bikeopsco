import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

/**
 * Test endpoint to verify Resend email config.
 * GET /api/email/test?to=your@email.com
 * Only works when RESEND_API_KEY is set.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const to = searchParams.get("to");

  if (!to || !to.includes("@")) {
    return NextResponse.json(
      { error: "Add ?to=your@email.com to test" },
      { status: 400 }
    );
  }

  const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

  if (!resend) {
    return NextResponse.json(
      { error: "RESEND_API_KEY not set in .env" },
      { status: 500 }
    );
  }

  const from = process.env.FROM_EMAIL || "BBM Services <onboarding@resend.dev>";

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: "BBM Services – Email test",
      html: "<p>If you got this, Resend is working.</p>",
    });

    if (error) {
      return NextResponse.json(
        {
          error: "Resend rejected the send",
          details: error.message,
          hint: "Verify your FROM_EMAIL domain is added and verified in Resend. onboarding@resend.dev can only send to your Resend account email.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Test email sent to ${to}. Check inbox and spam.`,
      id: data?.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Resend failed", details: msg },
      { status: 500 }
    );
  }
}
