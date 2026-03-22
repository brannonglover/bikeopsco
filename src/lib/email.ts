import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || "BikeOps <onboarding@resend.dev>";

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

  const vars: Record<string, string> = {
    customerName: job.customer
      ? job.customer.lastName
        ? `${job.customer.firstName} ${job.customer.lastName}`
        : job.customer.firstName
      : "Customer",
    bikeMake: job.bikeMake,
    bikeModel: job.bikeModel,
    shopName: "BikeOps",
    customerNotes: job.customerNotes ?? "",
  };

  const subject = mergeTemplateVariables(template.subject, vars);
  const bodyHtml = mergeTemplateVariables(template.bodyHtml, vars);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
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
  total: number,
  shopName: string
): string {
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
        <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #334155;">${escapeHtml(js.service?.name ?? "Service")}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; text-align: center;">${js.quantity}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; text-align: right;">${formatPrice(unitPrice)}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; text-align: right;">${formatPrice(lineTotal)}</td>
      </tr>
    `;
  }).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Receipt - ${escapeHtml(shopName)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #334155;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); overflow: hidden;">
          <tr>
            <td style="padding: 32px 32px 24px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: white; letter-spacing: -0.025em;">${escapeHtml(shopName)}</h1>
              <p style="margin: 6px 0 0; font-size: 14px; color: #94a3b8;">Payment Receipt</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #64748b;">Thank you for your payment, ${escapeHtml(customerName)}.</p>
              <p style="margin: 0 0 24px; font-size: 14px; color: #64748b;">${escapeHtml(date)}</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8fafc;">
                    <th style="padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Service</th>
                    <th style="padding: 12px 16px; text-align: center; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Qty</th>
                    <th style="padding: 12px 16px; text-align: right; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Unit Price</th>
                    <th style="padding: 12px 16px; text-align: right; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>

              <div style="padding: 16px; background-color: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="font-size: 16px; font-weight: 700; color: #166534;">Total paid</td>
                    <td style="font-size: 20px; font-weight: 700; color: #166534; text-align: right;">${formatPrice(total)}</td>
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

const SHOP_NAME = process.env.SHOP_NAME || "BikeOps";

export async function sendPaymentReceiptEmail(job: JobForInvoice): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    console.warn("RESEND_API_KEY not set, skipping payment receipt email");
    return { ok: false, error: "Email not configured" };
  }

  const email = job.customer?.email;
  if (!email || !email.trim()) {
    return { ok: false, error: "No customer email" };
  }

  const total = job.jobServices.reduce((sum, js) => {
    const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
    return sum + price * (js.quantity || 1);
  }, 0);

  const subject = `Payment receipt – ${job.bikeMake} ${job.bikeModel} – ${SHOP_NAME}`;
  const html = buildInvoiceHtml(job, total, SHOP_NAME);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      html,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    console.log(`[Email] Receipt sent to ${email} for job ${job.id}`);

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
