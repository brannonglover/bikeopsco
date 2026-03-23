import { Resend } from "resend";
import fs from "fs";
import path from "path";
import { getAppUrl, getResendApiKey } from "./env";

function getResend(): Resend | null {
  const key = getResendApiKey();
  return key ? new Resend(key) : null;
}

function getFromEmail(): string {
  const raw = process.env.FROM_EMAIL?.trim();
  if (!raw) return "BBM Services <onboarding@resend.dev>";
  const match = raw.match(/<([^>]+)>/);
  const email = match ? match[1].trim() : raw;
  return `BBM Services <${email}>`;
}

const LOGO_CID = "receipt-logo";

function getReceiptLogoAttachment(): { content: Buffer; contentId: string } | null {
  try {
    const logoPath = path.join(process.cwd(), "public", "bbm-logo-wo.png");
    if (fs.existsSync(logoPath)) {
      return { content: fs.readFileSync(logoPath), contentId: LOGO_CID };
    }
  } catch {
    // ignore
  }
  return null;
}

function getReceiptLogoUrl(): string {
  const explicit = process.env.SHOP_LOGO_URL?.trim();
  if (explicit && explicit.startsWith("http")) return explicit;
  const base = getAppUrl();
  if (base) return `${base}/bbm-logo-wo.png`;
  return "";
}

export function mergeTemplateVariables(
  html: string,
  vars: Record<string, string>
): string {
  let result = html;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(
      new RegExp(`\\{\\{${key}\\}\\}`, "g"),
      value ?? ""
    );
  }
  return result;
}

interface JobForEmail {
  id: string;
  bikeMake: string;
  bikeModel: string;
  customer: { firstName: string; lastName: string | null } | null;
  customerNotes?: string | null;
}

export async function sendJobEmail(
  templateSlug: string,
  recipient: string,
  job: JobForEmail
): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set, skipping email");
    return { ok: false, error: "Email not configured" };
  }

  const { prisma } = await import("./db");
  const template = await prisma.emailTemplate.findUnique({
    where: { slug: templateSlug },
  });

  if (!template) {
    return { ok: false, error: "Template not found" };
  }

  const baseUrl = getAppUrl();
  const statusUrl = baseUrl ? `${baseUrl}/status/${job.id}` : "";
  const statusButtonHtml = statusUrl
    ? `<a href="${statusUrl}" style="display: inline-block; padding: 12px 24px; background-color: #f59e0b; color: white !important; text-decoration: none; font-weight: 600; border-radius: 8px;">Track your repair status</a>`
    : "";

  const vars: Record<string, string> = {
    customerName: job.customer
      ? job.customer.lastName
        ? `${job.customer.firstName} ${job.customer.lastName}`
        : job.customer.firstName
      : "Customer",
    bikeMake: job.bikeMake,
    bikeModel: job.bikeModel,
    shopName: process.env.SHOP_NAME || "Basement Bike Mechanic",
    customerNotes: job.customerNotes ?? "",
    statusUrl,
    statusButtonHtml,
  };

  const subject = mergeTemplateVariables(template.subject, vars);
  const bodyHtml = mergeTemplateVariables(template.bodyHtml, vars);

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: recipient,
      subject,
      html: bodyHtml,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    await prisma.jobEmail.create({
      data: {
        jobId: job.id,
        templateSlug,
        recipient,
      },
    });

    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: err };
  }
}

export function getTemplateForStage(
  stage: string,
  deliveryType: string
): string | null {
  if (stage === "BOOKED_IN") {
    return deliveryType === "COLLECTION_SERVICE" ? "booking_confirmation_collection" : "booking_confirmation_dropoff";
  }
  if (stage === "RECEIVED") {
    return deliveryType === "COLLECTION_SERVICE" ? "bike_collected" : "bike_arrived";
  }
  const map: Record<string, string> = {
    WORKING_ON: "working_on_bike",
    WAITING_ON_PARTS: "waiting_on_parts",
    BIKE_READY: "bike_ready",
    COMPLETED: "bike_completed",
  };
  return map[stage] ?? null;
}

export interface JobServiceForInvoice {
  service: { name: string };
  quantity: number;
  unitPrice: string | number;
}

export interface JobForInvoice {
  id: string;
  bikeMake: string;
  bikeModel: string;
  customer: { firstName: string; lastName: string | null; email: string | null } | null;
  jobServices: JobServiceForInvoice[];
}

function formatPrice(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function buildInvoiceHtml(
  job: JobForInvoice,
  subtotal: number,
  totalPaid: number,
  shopName: string,
  logoSrc: string
): string {
  const hasSurcharge = totalPaid > subtotal;
  const customerName = job.customer
    ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ").trim() || "Customer"
    : "Customer";

  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rows = job.jobServices.map((js) => {
    const unitPrice = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
    const lineTotal = unitPrice * (js.quantity || 1);
    return `
      <tr>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 16px;">${escapeHtml(js.service?.name ?? "Service")}</td>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #64748b; text-align: center; font-size: 16px;">${js.quantity}</td>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #64748b; text-align: right; font-size: 16px;">${formatPrice(unitPrice)}</td>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; text-align: right; font-size: 16px;">${formatPrice(lineTotal)}</td>
      </tr>
    `;
  }).join("");

  const headerContent = logoSrc
    ? `<img src="${logoSrc.startsWith("cid:") ? logoSrc : escapeHtml(logoSrc)}" alt="${escapeHtml(shopName)}" width="280" height="auto" style="max-height: 88px; width: auto; display: block; margin: 0 auto 20px; object-fit: contain;">
              <p style="margin: 0; font-size: 13px; color: rgba(255,255,255,0.9); letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600;">Payment Receipt</p>`
    : `<h1 style="margin: 0; font-size: 24px; font-weight: 700; color: white; letter-spacing: -0.025em;">${escapeHtml(shopName)}</h1>
              <p style="margin: 6px 0 0; font-size: 14px; color: rgba(255,255,255,0.9);">Payment Receipt</p>`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Receipt - ${escapeHtml(shopName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <style type="text/css">
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.04); overflow: hidden;">
          <tr>
            <td style="padding: 36px 32px 24px; background: linear-gradient(135deg, #b45309 0%, #d97706 100%); text-align: center;">
              ${headerContent}
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #64748b;">Thank you for your payment, ${escapeHtml(customerName)}.</p>
              <p style="margin: 0 0 24px; font-size: 14px; color: #64748b;">${escapeHtml(date)}</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8fafc;">
                    <th style="padding: 14px 18px; text-align: left; font-size: 15px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Service</th>
                    <th style="padding: 14px 18px; text-align: center; font-size: 15px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Qty</th>
                    <th style="padding: 14px 18px; text-align: right; font-size: 15px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Unit Price</th>
                    <th style="padding: 14px 18px; text-align: right; font-size: 15px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>

              <div style="padding: 16px; background-color: #f1f5f9; border-radius: 8px; border: 1px solid #e2e8f0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${hasSurcharge ? `
                  <tr>
                    <td style="font-size: 16px; font-weight: 600; color: #475569;">Subtotal</td>
                    <td style="font-size: 16px; font-weight: 600; color: #334155; text-align: right;">${formatPrice(subtotal)}</td>
                  </tr>
                  <tr>
                    <td style="font-size: 16px; font-weight: 600; color: #475569; padding-top: 8px;">Card processing fee</td>
                    <td style="font-size: 16px; font-weight: 600; color: #334155; text-align: right; padding-top: 8px;">${formatPrice(totalPaid - subtotal)}</td>
                  </tr>
                  ` : ""}
                  <tr>
                    <td style="font-size: 16px; font-weight: 700; color: #475569; padding-top: ${hasSurcharge ? "8px" : "0"};">Total paid</td>
                    <td style="font-size: 20px; font-weight: 700; color: #334155; text-align: right; padding-top: ${hasSurcharge ? "8px" : "0"};">${formatPrice(totalPaid)}</td>
                  </tr>
                </table>
              </div>

              <p style="margin: 24px 0 0; font-size: 14px; color: #64748b;">
                This receipt is for your ${escapeHtml(job.bikeMake)} ${escapeHtml(job.bikeModel)} repair.
              </p>

              <p style="margin: 20px 0 0; font-size: 14px; color: #64748b;">
                If you have any questions, please don't hesitate to get in touch.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">Thank you for choosing ${escapeHtml(shopName)}.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SHOP_NAME = process.env.SHOP_NAME || "Basement Bike Mechanic";

export async function sendChatMagicLinkEmail(
  recipient: string,
  magicLinkUrl: string,
  resendClient?: InstanceType<typeof Resend> | null
): Promise<{ ok: boolean; error?: string }> {
  const resend = resendClient ?? getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set, skipping chat magic link email");
    return { ok: false, error: "Email not configured" };
  }

  const shopName = SHOP_NAME;
  const subject = `Sign in to chat with ${shopName}`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f8fafc; color: #0f172a; }
    .container { max-width: 480px; margin: 0 auto; padding: 40px 20px; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.07); }
    .btn { display: inline-block; padding: 14px 28px; background: #059669; color: white !important; text-decoration: none; font-weight: 600; border-radius: 8px; }
    .muted { color: #64748b; font-size: 14px; margin-top: 24px; }
    .link { color: #059669; word-break: break-all; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1 style="margin: 0 0 16px; font-size: 22px;">Chat with ${escapeHtml(shopName)}</h1>
      <p style="margin: 0 0 24px; font-size: 16px; color: #475569;">
        Click the button below to sign in and start chatting with us. This link expires in 15 minutes.
      </p>
      <a href="${magicLinkUrl}" class="btn">Sign in to chat</a>
      <p class="muted">
        If you didn't request this email, you can safely ignore it.
      </p>
      <p class="muted">
        Or copy this link: <a href="${magicLinkUrl}" class="link">${magicLinkUrl}</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: recipient,
      subject,
      html,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function sendPaymentReceiptEmail(
  job: JobForInvoice,
  totalPaid?: number
): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set, skipping payment receipt email");
    return { ok: false, error: "Email not configured" };
  }

  const email = job.customer?.email;
  if (!email || !email.trim()) {
    return { ok: false, error: "No customer email" };
  }

  const subtotal = job.jobServices.reduce((sum, js) => {
    const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
    return sum + price * (js.quantity || 1);
  }, 0);

  const paid = totalPaid ?? subtotal;

  const subject = `Payment receipt – ${job.bikeMake} ${job.bikeModel} – ${SHOP_NAME}`;

  const logoAttachment = getReceiptLogoAttachment();
  const logoUrl = getReceiptLogoUrl();
  const logoSrc = logoAttachment ? `cid:${LOGO_CID}` : logoUrl;
  const html = buildInvoiceHtml(job, subtotal, paid, SHOP_NAME, logoSrc);

  const attachments = logoAttachment
    ? [
        {
          filename: "bbm-logo-wo.png",
          content: logoAttachment.content,
          contentId: LOGO_CID,
        },
      ]
    : undefined;

  try {
    const { data, error } = await resend.emails.send({
      from: getFromEmail(),
      to: email,
      subject,
      html,
      ...(attachments && { attachments }),
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    console.log(`[Email] Receipt sent to ${email} for job ${job.id}. Resend id: ${data?.id ?? "unknown"} – check resend.com/emails for delivery status`);

    const { prisma } = await import("./db");
    await prisma.jobEmail.create({
      data: {
        jobId: job.id,
        templateSlug: "payment_receipt",
        recipient: email,
      },
    });

    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: err };
  }
}
