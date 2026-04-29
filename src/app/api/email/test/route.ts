import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  buildReadOnlyCustomerEmailHtml,
  customerEmailBrandingAttachments,
  getCustomerEmailBrandingAssets,
  getCustomerEmailSendOptions,
} from "@/lib/email";
import { getResendApiKey } from "@/lib/env";

/**
 * Test endpoint to verify Resend email config.
 * GET /api/email/test?to=your@email.com
 * Uses RESEND_API_KEY or BIKEOPS_RESEND_API_KEY.
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

  const apiKey = getResendApiKey();
  const resend = apiKey ? new Resend(apiKey) : null;

  if (!resend) {
    return NextResponse.json(
      { error: "RESEND_API_KEY / BIKEOPS_RESEND_API_KEY not set in Vercel" },
      { status: 500 }
    );
  }

  const branding = await getCustomerEmailBrandingAssets();
  const html = buildReadOnlyCustomerEmailHtml({
    innerHtml: "<p style=\"margin:0\">If you got this, Resend is working.</p>",
    headerLogoSrc: branding.headerLogoSrc,
    heading: "BBM Services – Email test",
  });
  const attachments = customerEmailBrandingAttachments(branding);

  try {
    const { data, error } = await resend.emails.send({
      ...getCustomerEmailSendOptions(),
      to,
      subject: "BBM Services – Email test",
      html,
      ...(attachments && { attachments }),
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
