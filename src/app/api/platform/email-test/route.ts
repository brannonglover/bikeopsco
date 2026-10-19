import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  buildReadOnlyCustomerEmailHtml,
  customerEmailBrandingAttachments,
  getCustomerEmailBrandingAssets,
  getCustomerEmailSendOptions,
  sendResendEmail,
} from "@/lib/email";
import {
  getEmailRedirectTo,
  getEmailSendingDisabledReason,
  getResendApiKey,
} from "@/lib/env";
import { requirePlatformAdmin } from "@/lib/platform-admin";

/**
 * Platform-admin diagnostic: send one test email to check the Resend setup.
 * POST /api/platform/email-test { "to": "you@example.com" } on the admin host.
 *
 * It sends from our domain to any address, so it is not a shop endpoint (shop
 * sign-up is open) and it is a POST, so a link can't trigger it.
 */
export async function POST(request: NextRequest) {
  const admin = await requirePlatformAdmin(request);
  if (!admin.ok) return admin.response;

  const body = (await request.json().catch(() => null)) as { to?: unknown } | null;
  const to = typeof body?.to === "string" ? body.to.trim() : "";

  if (!to || !to.includes("@")) {
    return NextResponse.json(
      { error: 'Send { "to": "your@email.com" } to test' },
      { status: 400 }
    );
  }

  const disableReason = getEmailSendingDisabledReason();
  if (disableReason) {
    return NextResponse.json(
      { error: disableReason },
      { status: 503 }
    );
  }

  const redirectTo = getEmailRedirectTo();

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
    heading: "Bike Ops – Email test",
  });
  const attachments = customerEmailBrandingAttachments(branding);

  try {
    const { data, error, redirectedFrom } = await sendResendEmail(resend, {
      ...getCustomerEmailSendOptions(),
      to,
      subject: "Bike Ops – Email test",
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
      message: redirectedFrom
        ? `Test email redirected to ${redirectTo} (requested ${redirectedFrom}). Check inbox and spam.`
        : `Test email sent to ${to}. Check inbox and spam.`,
      id: data?.id,
      redirectedTo: redirectTo ?? undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Resend failed", details: msg },
      { status: 500 }
    );
  }
}
