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

const CUSTOMER_EMAIL_HEADER_LOGO_CID = "customer-email-header-logo";
const DEFAULT_HEADER_LOGO_FILE = "bbm-logo-wo.png";

export interface CustomerEmailBrandingAssets {
  /** Centered header image (bbm-logo-wo.png or HTTPS override). */
  headerLogoSrc: string;
  attachments?: { filename: string; content: Buffer; contentId: string }[];
}

/**
 * Single centered header logo for customer emails (`/public/bbm-logo-wo.png`).
 * URL from app base when set; otherwise CID-embedded file.
 * Override: CUSTOMER_EMAIL_HEADER_LOGO_URL or CUSTOMER_EMAIL_LOGO_URL / SHOP_LOGO_URL (HTTPS).
 */
export function getCustomerEmailBrandingAssets(): CustomerEmailBrandingAssets {
  const base = getAppUrl();
  const logoOverride =
    process.env.CUSTOMER_EMAIL_HEADER_LOGO_URL?.trim() ||
    process.env.CUSTOMER_EMAIL_LOGO_URL?.trim() ||
    process.env.SHOP_LOGO_URL?.trim();

  if (logoOverride?.startsWith("http")) {
    return { headerLogoSrc: logoOverride };
  }

  if (base) {
    return { headerLogoSrc: `${base}/${DEFAULT_HEADER_LOGO_FILE}` };
  }

  try {
    const logoPath = path.join(process.cwd(), "public", DEFAULT_HEADER_LOGO_FILE);
    if (fs.existsSync(logoPath)) {
      return {
        headerLogoSrc: `cid:${CUSTOMER_EMAIL_HEADER_LOGO_CID}`,
        attachments: [
          {
            filename: DEFAULT_HEADER_LOGO_FILE,
            content: fs.readFileSync(logoPath),
            contentId: CUSTOMER_EMAIL_HEADER_LOGO_CID,
          },
        ],
      };
    }
  } catch {
    // ignore
  }

  return { headerLogoSrc: "" };
}

export function customerEmailBrandingAttachments(
  assets: CustomerEmailBrandingAssets
): { filename: string; content: Buffer; contentId: string }[] | undefined {
  return assets.attachments;
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Aligns with src/app/globals.css --primary, --background, --foreground, --muted, --border */
const BIKE_OPS_EMAIL = {
  font: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  bgPage: "#f8fafc",
  bgCard: "#ffffff",
  bgFooter: "#f1f5f9",
  border: "#e2e8f0",
  text: "#334155",
  heading: "#0f172a",
  muted: "#64748b",
  primary: "#4f46e5",
  accentBar: "#4f46e5",
} as const;

const CUSTOMER_EMAIL_FOOTER_BRAND = "Basement Bike Mechanic";

function bikeOpsEmailShopSubtitle(): string | null {
  const shop = process.env.SHOP_NAME?.trim();
  if (!shop) return null;
  const norm = shop.replace(/\s+/g, " ").toLowerCase();
  if (norm === "bike ops" || norm === "basement bike mechanic") return null;
  return shop;
}

/** Header logo: height-led so wide wordmarks stay proportional (not full-card width). */
const EMAIL_HEADER_LOGO_MAX_HEIGHT_PX = 64;
const EMAIL_HEADER_LOGO_MAX_WIDTH_PX = 220;

function buildCustomerEmailHeaderBlock(headerLogoSrc: string): string {
  if (!headerLogoSrc) return "";
  const src = headerLogoSrc.startsWith("cid:") ? headerLogoSrc : escapeHtml(headerLogoSrc);
  const h = EMAIL_HEADER_LOGO_MAX_HEIGHT_PX;
  const w = EMAIL_HEADER_LOGO_MAX_WIDTH_PX;
  return `<img src="${src}" alt="Basement Bike Mechanic" height="${h}" style="display:block;margin:0 auto;border:0;height:${h}px;max-height:${h}px;width:auto;max-width:${w}px;object-fit:contain;outline:none;text-decoration:none" />`;
}

/**
 * Shared HTML shell for customer emails — table layout, Plus Jakarta Sans, Bike Ops colors (matches web app).
 */
export function buildCustomerEmailHtml(options: {
  innerHtml: string;
  headerLogoSrc: string;
  heading?: string;
}): string {
  const { innerHtml, headerLogoSrc, heading } = options;
  const { font, bgPage, bgCard, bgFooter, border, text, heading: headColor, muted, accentBar } =
    BIKE_OPS_EMAIL;

  const headerBlock = buildCustomerEmailHeaderBlock(headerLogoSrc);

  const headingRow = heading
    ? `<tr>
    <td style="padding:8px 40px 4px;font-family:${font};color:${headColor};text-align:center">
      <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${headColor}">${escapeHtml(heading)}</h1>
    </td>
  </tr>`
    : "";

  const shopSub = bikeOpsEmailShopSubtitle();
  const footerSecondary = shopSub
    ? `<p style="margin:6px 0 0;font-family:${font};font-size:13px;line-height:1.5;color:${muted}">${escapeHtml(shopSub)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(CUSTOMER_EMAIL_FOOTER_BRAND)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&amp;display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background-color:${bgPage};-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${bgPage}">
  <tbody><tr><td align="center" style="padding:28px 16px 40px">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background-color:${bgCard};border:1px solid ${border};border-radius:12px;overflow:hidden">
      <tbody>
        <tr>
          <td style="height:4px;line-height:4px;font-size:0;background-color:${accentBar};mso-line-height-rule:exactly">&nbsp;</td>
        </tr>
        <tr>
          <td align="center" style="padding:28px 40px 12px">${headerBlock}</td>
        </tr>
        ${headingRow}
        <tr>
          <td style="padding:${heading ? "16px" : "8px"} 40px 8px;font-family:${font};font-size:15px;line-height:1.65;color:${text}">
            ${innerHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px 28px;background-color:${bgFooter};border-top:1px solid ${border}">
            <p style="margin:0;font-family:${font};font-size:14px;line-height:1.5;font-weight:600;color:${headColor}">${escapeHtml(CUSTOMER_EMAIL_FOOTER_BRAND)}</p>
            ${footerSecondary}
            <p style="margin:10px 0 0;font-family:${font};font-size:12px;line-height:1.5;color:${muted}">Thanks for choosing us for your bike care.</p>
          </td>
        </tr>
      </tbody>
    </table>
    <p style="margin:16px 0 0;font-family:${font};font-size:11px;line-height:1.4;color:${muted};max-width:640px">
      You are receiving this because you booked or interacted with our shop. If this was not you, you can ignore this message.
    </p>
  </td></tr></tbody>
</table>
</body>
</html>`;
}

/** Primary action button — Bike Ops indigo (matches app --primary). */
export function buildCustomerEmailCtaButton(href: string, label: string): string {
  const { font, primary } = BIKE_OPS_EMAIL;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto 0;border-collapse:separate;width:100%;max-width:100%">
  <tbody><tr>
    <td align="center" style="padding:0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:400px;border-collapse:separate">
        <tbody><tr>
          <td align="center" bgcolor="${primary}" style="background-color:${primary};border-radius:10px;mso-padding-alt:0">
            <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:14px 28px;font-family:${font};font-size:15px;font-weight:600;line-height:1.25;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(label)}</a>
          </td>
        </tr></tbody>
      </table>
    </td>
  </tr></tbody>
</table>`;
}

/** Sample merge values for staff preview and test sends (Email Templates settings). */
export function getEmailTemplatePreviewVars(): Record<string, string> {
  const base = getAppUrl();
  const statusUrl = base ? `${base}/status/preview` : "https://example.com/status/preview";
  const shopName = process.env.SHOP_NAME?.trim() || "Basement Bike Mechanic";
  return {
    customerName: "Alex Rider",
    bikeMake: "Trek",
    bikeModel: "Domane SL 5",
    shopName,
    customerNotes: "Please check the rear derailleur.",
    statusUrl,
    statusButtonHtml: buildCustomerEmailCtaButton(statusUrl, "Track your repair status"),
    rejectionReason:
      "We are fully booked for your requested dates. We hope to serve you another time.",
    dropOffDate: new Date(Date.now() + 86400000).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    pickupDate: new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

export function mergeEmailTemplateWithPreviewVars(bodyHtml: string): string {
  return mergeTemplateVariables(bodyHtml, getEmailTemplatePreviewVars());
}

/**
 * Send one customer-style email using a DB template slug + preview merge data (for staff testing).
 */
export async function sendEmailTemplateTestEmail(
  slug: string,
  recipient: string
): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "Email not configured (set RESEND_API_KEY)" };
  }

  const trimmedTo = recipient.trim();
  if (!trimmedTo || !trimmedTo.includes("@")) {
    return { ok: false, error: "Invalid email address" };
  }

  const { prisma } = await import("./db");
  const template = await prisma.emailTemplate.findUnique({
    where: { slug: slug.trim() },
  });
  if (!template) {
    return { ok: false, error: "Template not found" };
  }

  const vars = getEmailTemplatePreviewVars();
  const subject = `${mergeTemplateVariables(template.subject, vars)} [test]`;
  const mergedBody = mergeTemplateVariables(template.bodyHtml, vars);
  const branding = getCustomerEmailBrandingAssets();
  const html = buildCustomerEmailHtml({
    innerHtml: mergedBody,
    headerLogoSrc: branding.headerLogoSrc,
  });
  const attachments = customerEmailBrandingAttachments(branding);

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: trimmedTo,
      subject,
      html,
      ...(attachments && { attachments }),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

/** Full customer email HTML as sent (wrapper + logo + sample variable merge). */
export function buildCustomerEmailPreviewDocument(bodyHtml: string): string {
  const merged = mergeEmailTemplateWithPreviewVars(bodyHtml);
  const branding = getCustomerEmailBrandingAssets();
  return buildCustomerEmailHtml({
    innerHtml: merged,
    headerLogoSrc: branding.headerLogoSrc,
  });
}

interface JobForEmail {
  id: string;
  bikeMake: string;
  bikeModel: string;
  stage?: string;
  customer: { firstName: string; lastName: string | null } | null;
  customerNotes?: string | null;
  dropOffDate?: Date | string | null;
  pickupDate?: Date | string | null;
  collectionWindowStart?: string | null;
  collectionWindowEnd?: string | null;
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

  // Never send booking confirmation to customer for pending-approval jobs
  const isBookingConfirmation =
    templateSlug === "booking_confirmation_dropoff" ||
    templateSlug === "booking_confirmation_collection";
  if (isBookingConfirmation && job.stage === "PENDING_APPROVAL") {
    return { ok: false, error: "Booking not yet approved" };
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
    ? buildCustomerEmailCtaButton(statusUrl, "Track your repair status")
    : "";

  const formatDate = (d: Date | string | null | undefined): string => {
    if (!d) return "";
    const date = typeof d === "string" ? new Date(d) : d;
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

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
    dropOffDate: formatDate(job.dropOffDate),
    pickupDate: formatDate(job.pickupDate),
    collectionWindow: (() => {
      const s = job.collectionWindowStart;
      const e = job.collectionWindowEnd;
      if (!s && !e) return "";
      const fmt = (t: string) => {
        const [h, m] = t.split(":");
        const hour = parseInt(h, 10);
        const ampm = hour >= 12 ? "pm" : "am";
        const h12 = hour % 12 || 12;
        return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
      };
      if (s && e) return `${fmt(s)} – ${fmt(e)}`;
      if (s) return `from ${fmt(s)}`;
      return `until ${fmt(e!)}`;
    })(),
  };

  const subject = mergeTemplateVariables(template.subject, vars);
  const bodyHtml = mergeTemplateVariables(template.bodyHtml, vars);
  const branding = getCustomerEmailBrandingAssets();
  const html = buildCustomerEmailHtml({
    innerHtml: bodyHtml,
    headerLogoSrc: branding.headerLogoSrc,
  });
  const attachments = customerEmailBrandingAttachments(branding);

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: recipient,
      subject,
      html,
      ...(attachments && { attachments }),
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

export async function sendBookingRequestNotification(
  job: {
    id: string;
    bikeMake: string;
    bikeModel: string;
    deliveryType: string;
    dropOffDate: Date | string | null;
    pickupDate: Date | string | null;
    collectionWindowStart?: string | null;
    collectionWindowEnd?: string | null;
    customerNotes?: string | null;
    customer: { firstName: string; lastName: string | null; email: string | null; phone: string | null } | null;
    jobServices?: { service?: { name: string } | null; customServiceName?: string | null; quantity: number }[];
  }
): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "Email not configured" };
  }

  const notifyEmail =
    process.env.SHOP_NOTIFY_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim();
  if (!notifyEmail) {
    console.warn("SHOP_NOTIFY_EMAIL and ADMIN_EMAIL not set, skipping booking notification");
    return { ok: false, error: "No notification email configured" };
  }

  const baseUrl = getAppUrl();
  const calendarUrl = baseUrl ? `${baseUrl}/calendar` : "";
  const shopName = process.env.SHOP_NAME || "Basement Bike Mechanic";
  const customerName = job.customer
    ? job.customer.lastName
      ? `${job.customer.firstName} ${job.customer.lastName}`
      : job.customer.firstName
    : "Unknown";
  const servicesList =
    job.jobServices
      ?.map((js) => `${js.service?.name ?? js.customServiceName ?? "Service"}${js.quantity > 1 ? ` × ${js.quantity}` : ""}`)
      .join(", ") || "None specified";
  const dropOff = job.dropOffDate
    ? new Date(job.dropOffDate).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not set";
  const pickup = job.pickupDate
    ? new Date(job.pickupDate).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not set";

  const formatWindowTime = (t: string) => {
    const [h, m] = t.split(":");
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? "pm" : "am";
    const h12 = hour % 12 || 12;
    return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
  };
  let collectionWindowLine = "";
  if (job.deliveryType === "COLLECTION_SERVICE" && (job.collectionWindowStart || job.collectionWindowEnd)) {
    const s = job.collectionWindowStart ? formatWindowTime(job.collectionWindowStart) : null;
    const e = job.collectionWindowEnd ? formatWindowTime(job.collectionWindowEnd) : null;
    const windowText = s && e ? `${s} – ${e}` : s ? `from ${s}` : `until ${e}`;
    collectionWindowLine = `<br/><strong>Collection window:</strong> ${windowText}`;
  }

  const subject = `New booking request: ${job.bikeMake} ${job.bikeModel}`;
  const innerHtml = `
<p style="margin:0 0 20px">A new booking request has been submitted and is awaiting your approval.</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <tbody>
    <tr style="background-color:#f8fafc">
      <td colspan="2" style="padding:12px 16px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Customer</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#475569;width:40%;border-top:1px solid #e2e8f0">Name</td>
      <td style="padding:10px 16px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0">${escapeHtml(customerName)}</td>
    </tr>
    <tr style="background-color:#f8fafc">
      <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#475569;border-top:1px solid #e2e8f0">Email</td>
      <td style="padding:10px 16px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0">${escapeHtml(job.customer?.email ?? "—")}</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#475569;border-top:1px solid #e2e8f0">Phone</td>
      <td style="padding:10px 16px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0">${escapeHtml(job.customer?.phone ?? "—")}</td>
    </tr>
  </tbody>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <tbody>
    <tr style="background-color:#f8fafc">
      <td colspan="2" style="padding:12px 16px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Booking details</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#475569;width:40%;border-top:1px solid #e2e8f0">Bike</td>
      <td style="padding:10px 16px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0">${escapeHtml(job.bikeMake)} ${escapeHtml(job.bikeModel)}</td>
    </tr>
    <tr style="background-color:#f8fafc">
      <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#475569;border-top:1px solid #e2e8f0">Delivery</td>
      <td style="padding:10px 16px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0">${job.deliveryType === "COLLECTION_SERVICE" ? "Collection service" : "Drop-off at shop"}</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#475569;border-top:1px solid #e2e8f0">Preferred drop-off</td>
      <td style="padding:10px 16px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0">${escapeHtml(dropOff)}${collectionWindowLine}</td>
    </tr>
    <tr style="background-color:#f8fafc">
      <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#475569;border-top:1px solid #e2e8f0">Preferred pickup</td>
      <td style="padding:10px 16px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0">${escapeHtml(pickup)}</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#475569;border-top:1px solid #e2e8f0">Services</td>
      <td style="padding:10px 16px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0">${escapeHtml(servicesList)}</td>
    </tr>
    ${job.customerNotes ? `<tr style="background-color:#f8fafc">
      <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#475569;border-top:1px solid #e2e8f0">Notes</td>
      <td style="padding:10px 16px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0">${escapeHtml(job.customerNotes)}</td>
    </tr>` : ""}
  </tbody>
</table>

${calendarUrl ? buildCustomerEmailCtaButton(calendarUrl, "Review & accept or reject") : ""}
`.trim();

  const branding = getCustomerEmailBrandingAssets();
  const html = buildCustomerEmailHtml({
    innerHtml,
    headerLogoSrc: branding.headerLogoSrc,
    heading: "New booking request",
  });
  const attachments = customerEmailBrandingAttachments(branding);

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: notifyEmail,
      subject,
      html,
      ...(attachments && { attachments }),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: err };
  }
}

export async function sendBookingDeclinedEmail(
  recipient: string,
  job: {
    bikeMake: string;
    bikeModel: string;
    cancellationReason: string;
    customer: { firstName: string; lastName: string | null } | null;
  }
): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: false, error: "Email not configured" };
  }

  const { prisma } = await import("./db");
  const template = await prisma.emailTemplate.findUnique({
    where: { slug: "booking_declined" },
  });

  if (!template) {
    console.warn("booking_declined template not found – run db:seed");
    return { ok: false, error: "Template not found" };
  }

  const shopName = process.env.SHOP_NAME || "Basement Bike Mechanic";
  const customerName = job.customer
    ? job.customer.lastName
      ? `${job.customer.firstName} ${job.customer.lastName}`
      : job.customer.firstName
    : "Customer";

  const vars: Record<string, string> = {
    customerName,
    bikeMake: job.bikeMake,
    bikeModel: job.bikeModel,
    shopName,
    rejectionReason: job.cancellationReason || "We're unable to accommodate this booking at this time.",
  };

  const subject = mergeTemplateVariables(template.subject, vars);
  const bodyHtml = mergeTemplateVariables(template.bodyHtml, vars);
  const branding = getCustomerEmailBrandingAssets();
  const html = buildCustomerEmailHtml({
    innerHtml: bodyHtml,
    headerLogoSrc: branding.headerLogoSrc,
  });
  const attachments = customerEmailBrandingAttachments(branding);

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: recipient,
      subject,
      html,
      ...(attachments && { attachments }),
    });
    if (error) return { ok: false, error: error.message };
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
  service?: { name: string } | null;
  customServiceName?: string | null;
  quantity: number;
  unitPrice: string | number;
}

export interface JobProductForInvoice {
  product: { name: string };
  quantity: number;
  unitPrice: string | number;
}

export interface JobForInvoice {
  id: string;
  bikeMake: string;
  bikeModel: string;
  customer: { firstName: string; lastName: string | null; email: string | null } | null;
  jobServices: JobServiceForInvoice[];
  jobProducts?: JobProductForInvoice[];
}

function formatPrice(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function buildInvoiceInnerHtml(
  job: JobForInvoice,
  subtotal: number,
  totalPaid: number,
  shopName: string
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

  const serviceRows = (job.jobServices ?? []).map((js) => {
    const unitPrice = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
    const lineTotal = unitPrice * (js.quantity || 1);
    return `
      <tr>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 16px;">${escapeHtml(js.service?.name ?? js.customServiceName ?? "Service")}</td>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #64748b; text-align: center; font-size: 16px;">${js.quantity}</td>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #64748b; text-align: right; font-size: 16px;">${formatPrice(unitPrice)}</td>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; text-align: right; font-size: 16px;">${formatPrice(lineTotal)}</td>
      </tr>
    `;
  }).join("");
  const productRows = (job.jobProducts ?? []).map((jp) => {
    const unitPrice = typeof jp.unitPrice === "string" ? parseFloat(jp.unitPrice) : Number(jp.unitPrice);
    const lineTotal = unitPrice * (jp.quantity || 1);
    return `
      <tr>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 16px;">${escapeHtml(jp.product?.name ?? "Product")}</td>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #64748b; text-align: center; font-size: 16px;">${jp.quantity}</td>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #64748b; text-align: right; font-size: 16px;">${formatPrice(unitPrice)}</td>
        <td style="padding: 14px 18px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; text-align: right; font-size: 16px;">${formatPrice(lineTotal)}</td>
      </tr>
    `;
  }).join("");
  const rows = serviceRows + productRows;

  return `
<p style="margin:0 0 20px;font-size:16px;color:#64748b">Thank you for your payment, ${escapeHtml(customerName)}.</p>
<p style="margin:0 0 24px;font-size:14px;color:#64748b">${escapeHtml(date)}</p>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <thead>
    <tr style="background-color:#f8fafc">
      <th style="padding:14px 18px;text-align:left;font-size:15px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Item</th>
      <th style="padding:14px 18px;text-align:center;font-size:15px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Qty</th>
      <th style="padding:14px 18px;text-align:right;font-size:15px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Unit Price</th>
      <th style="padding:14px 18px;text-align:right;font-size:15px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div style="padding:16px;background-color:#f1f5f9;border-radius:8px;border:1px solid #e2e8f0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    ${hasSurcharge ? `
    <tr>
      <td style="font-size:16px;font-weight:600;color:#475569">Subtotal</td>
      <td style="font-size:16px;font-weight:600;color:#334155;text-align:right">${formatPrice(subtotal)}</td>
    </tr>
    <tr>
      <td style="font-size:16px;font-weight:600;color:#475569;padding-top:8px">Card processing fee</td>
      <td style="font-size:16px;font-weight:600;color:#334155;text-align:right;padding-top:8px">${formatPrice(totalPaid - subtotal)}</td>
    </tr>
    ` : ""}
    <tr>
      <td style="font-size:16px;font-weight:700;color:#475569;padding-top:${hasSurcharge ? "8px" : "0"}">Total paid</td>
      <td style="font-size:20px;font-weight:700;color:#334155;text-align:right;padding-top:${hasSurcharge ? "8px" : "0"}">${formatPrice(totalPaid)}</td>
    </tr>
  </table>
</div>

<p style="margin:24px 0 0;font-size:14px;color:#64748b">This receipt is for your ${escapeHtml(job.bikeMake)} ${escapeHtml(job.bikeModel)} repair.</p>
<p style="margin:20px 0 0;font-size:14px;color:#64748b">If you have any questions, please don't hesitate to get in touch.</p>
<p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Thank you for choosing ${escapeHtml(shopName)}.</p>
  `.trim();
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
  const branding = getCustomerEmailBrandingAssets();
  const innerHtml = `
<p style="margin:0 0 24px;color:#475569">Click the button below to sign in and start chatting with us. This link expires in 15 minutes.</p>
${buildCustomerEmailCtaButton(magicLinkUrl, "Sign in to chat")}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">If you didn't request this email, you can safely ignore it.</p>
<p style="margin:12px 0 0;font-size:12px;color:#64748b;word-break:break-all">Or copy this link: <a href="${escapeHtml(magicLinkUrl)}" style="color:#4f46e5;text-decoration:underline">${escapeHtml(magicLinkUrl)}</a></p>
`.trim();
  const html = buildCustomerEmailHtml({
    innerHtml,
    headerLogoSrc: branding.headerLogoSrc,
    heading: `Chat with ${shopName}`,
  });
  const attachments = customerEmailBrandingAttachments(branding);

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: recipient,
      subject,
      html,
      ...(attachments && { attachments }),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function sendChatCustomerReplyReminder(
  customerEmail: string,
  customerFirstName: string,
  chatUrl: string,
  reminderMinutes: number,
  staffMessageBody: string | null,
  attachmentFilenames: string[] = []
): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set, skipping chat reminder email");
    return { ok: false, error: "Email not configured" };
  }

  const shopName = SHOP_NAME;
  const name = customerFirstName.trim() || "there";
  const subject = `${shopName} is waiting for your reply`;
  const trimmedBody = staffMessageBody?.trim() ?? "";
  const files = attachmentFilenames.map((f) => f.trim()).filter(Boolean);
  const hasLatestInBody = trimmedBody.length > 0 || files.length > 0;

  const latestMessageHtml = hasLatestInBody
    ? `<div style="margin: 0 0 24px; padding: 16px; background: #f1f5f9; border-radius: 8px; border-left: 4px solid #4f46e5; font-size: 15px; color: #334155;">
        ${trimmedBody.length > 0 ? `<div style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(trimmedBody)}</div>` : ""}
        ${files.length > 0 ? `<p style="margin: ${trimmedBody.length > 0 ? "12px" : "0"} 0 0; font-size: 14px; color: #475569;"><span style="color: #64748b;">Included:</span> ${files.map((f) => escapeHtml(f)).join(", ")}</p>` : ""}
      </div>`
    : `<p style="margin: 0 0 24px; font-size: 16px; color: #475569;">We sent you a message in chat at least ${reminderMinutes} minute${reminderMinutes === 1 ? "" : "s"} ago. When you have a moment, please open the conversation and reply.</p>`;

  const intro = hasLatestInBody
    ? `<p style="margin: 0 0 16px; font-size: 16px; color: #475569;">We sent you a message in chat at least ${reminderMinutes} minute${reminderMinutes === 1 ? "" : "s"} ago. Here is the latest message:</p>`
    : "";

  const plainLatest =
    trimmedBody.length > 0
      ? trimmedBody + (files.length > 0 ? `\n\nIncluded: ${files.join(", ")}` : "")
      : files.length > 0
        ? `Included: ${files.join(", ")}`
        : "";

  const textBody = hasLatestInBody
    ? `Hi ${name},\n\nWe sent you a message in chat at least ${reminderMinutes} minute${reminderMinutes === 1 ? "" : "s"} ago. Here is the latest message:\n\n${plainLatest}\n\nOpen chat: ${chatUrl}\n\nIf you already replied, you can ignore this email.`
    : `Hi ${name},\n\nWe sent you a message in chat at least ${reminderMinutes} minute${reminderMinutes === 1 ? "" : "s"} ago. When you have a moment, please open the conversation and reply.\n\n${chatUrl}\n\nIf you already replied, you can ignore this email.`;

  const branding = getCustomerEmailBrandingAssets();
  const innerHtml = `
${intro}
${latestMessageHtml}
${buildCustomerEmailCtaButton(chatUrl, "Open chat")}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">If you already replied, you can ignore this email.</p>
`.trim();
  const html = buildCustomerEmailHtml({
    innerHtml,
    headerLogoSrc: branding.headerLogoSrc,
    heading: `Hi ${name}`,
  });
  const attachments = customerEmailBrandingAttachments(branding);

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: customerEmail,
      subject,
      text: textBody,
      html,
      ...(attachments && { attachments }),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function sendChatStaffReplyReminder(
  staffEmail: string,
  customerDisplayName: string,
  chatUrl: string,
  reminderMinutes: number
): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set, skipping chat reminder email");
    return { ok: false, error: "Email not configured" };
  }

  const shopName = SHOP_NAME;
  const subject = `Chat: ${customerDisplayName} is waiting for a reply`;
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
    .btn { display: inline-block; padding: 14px 28px; background: #0f766e; color: white !important; text-decoration: none; font-weight: 600; border-radius: 8px; }
    .muted { color: #64748b; font-size: 14px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1 style="margin: 0 0 16px; font-size: 22px;">${escapeHtml(customerDisplayName)} messaged you</h1>
      <p style="margin: 0 0 24px; font-size: 16px; color: #475569;">
        It has been at least ${reminderMinutes} minute${reminderMinutes === 1 ? "" : "s"} since their last message. Open ${escapeHtml(shopName)} chat to reply when you can.
      </p>
      <a href="${chatUrl}" class="btn">Open staff chat</a>
      <p class="muted">
        If you already replied, you can ignore this email.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  try {
    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: staffEmail,
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

  const subtotal =
    (job.jobServices ?? []).reduce((sum, js) => {
      const price = typeof js.unitPrice === "string" ? parseFloat(js.unitPrice) : Number(js.unitPrice);
      return sum + price * (js.quantity || 1);
    }, 0) +
    (job.jobProducts ?? []).reduce((sum, jp) => {
      const price = typeof jp.unitPrice === "string" ? parseFloat(jp.unitPrice) : Number(jp.unitPrice);
      return sum + price * (jp.quantity || 1);
    }, 0);

  const paid = totalPaid ?? subtotal;

  const subject = `Payment receipt – ${job.bikeMake} ${job.bikeModel} – ${SHOP_NAME}`;

  const branding = getCustomerEmailBrandingAssets();
  const innerHtml = buildInvoiceInnerHtml(job, subtotal, paid, SHOP_NAME);
  const html = buildCustomerEmailHtml({
    innerHtml,
    headerLogoSrc: branding.headerLogoSrc,
    heading: "Payment receipt",
  });
  const attachments = customerEmailBrandingAttachments(branding);

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
