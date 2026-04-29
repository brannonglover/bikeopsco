import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Resend } from "resend";
import {
  buildCustomerEmailHtml,
  buildCustomerEmailCtaButton,
  getCustomerEmailBrandingAssets,
  customerEmailBrandingAttachments,
} from "@/lib/email";
import { sendPushToAllStaff } from "@/lib/push";
import { getAppUrl } from "@/lib/env";

const DEFAULT_SHOP_ID = "shop_default";

function getResend(): Resend | null {
  const key =
    process.env.RESEND_API_KEY?.trim() ||
    process.env.BIKEOPS_RESEND_API_KEY?.trim();
  return key ? new Resend(key) : null;
}

function getFromEmail(): string {
  const raw = process.env.FROM_EMAIL?.trim();
  if (!raw) return "BBM Services <onboarding@resend.dev>";
  const match = raw.match(/<([^>]+)>/);
  const email = match ? match[1].trim() : raw;
  return `BBM Services <${email}>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Returns the UTC start and end timestamps that correspond to midnight→23:59:59
 * on the date that is `daysOffset` days from today in the given IANA timezone.
 *
 * Works correctly across DST transitions for all US timezones.
 */
function getLocalDayBounds(
  timezone: string,
  daysOffset: number = 0
): { gte: Date; lte: Date } {
  const now = new Date();

  // Today's date string (YYYY-MM-DD) in the shop's local timezone
  const localDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Shift by daysOffset by nudging noon-UTC of the local date forward/back
  const baseNoon = new Date(localDateStr + "T12:00:00Z");
  baseNoon.setUTCDate(baseNoon.getUTCDate() + daysOffset);

  // Re-derive the target date string after the shift
  const targetDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(baseNoon);

  // Compute the UTC offset for this timezone on the target date.
  // Noon UTC → local hour; offset = localHour − 12 (whole hours; fine for all US zones).
  const noonUtc = new Date(targetDateStr + "T12:00:00Z");
  const localNoonHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(noonUtc)
  );
  const offsetHours = localNoonHour - 12;

  // Midnight local = midnight UTC shifted by the inverse of the offset
  const [y, m, d] = targetDateStr.split("-").map(Number);
  const midnightUtc = new Date(
    Date.UTC(y, m - 1, d, 0, 0, 0) - offsetHours * 3600_000
  );
  const endUtc = new Date(midnightUtc.getTime() + 86_400_000 - 1);

  return { gte: midnightUtc, lte: endUtc };
}

function formatDate(d: Date, timezone: string): string {
  return d.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(d: Date, timezone: string): string {
  return d.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getLocalHour(timezone: string, at: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(at)
  );
}

interface JobRow {
  id: string;
  bikeMake: string;
  bikeModel: string;
  deliveryType: string;
  dropOffDate: Date | null;
  collectionWindowStart: string | null;
  collectionWindowEnd: string | null;
  customer: {
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

function buildJobTableRows(jobs: JobRow[]): string {
  if (jobs.length === 0) return "";

  const rows = jobs
    .map((job) => {
      const customerName = job.customer
        ? [job.customer.firstName, job.customer.lastName]
            .filter(Boolean)
            .join(" ")
        : "Unknown";
      const contact = [job.customer?.email, job.customer?.phone]
        .filter(Boolean)
        .join(" · ");
      const deliveryLabel =
        job.deliveryType === "COLLECTION_SERVICE"
          ? "Collection"
          : "Drop-off";

      let windowText = "";
      if (
        job.deliveryType === "COLLECTION_SERVICE" &&
        (job.collectionWindowStart || job.collectionWindowEnd)
      ) {
        const fmt = (t: string) => {
          const [h, m] = t.split(":");
          const hour = parseInt(h, 10);
          const ampm = hour >= 12 ? "pm" : "am";
          const h12 = hour % 12 || 12;
          return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
        };
        const s = job.collectionWindowStart
          ? fmt(job.collectionWindowStart)
          : null;
        const e = job.collectionWindowEnd
          ? fmt(job.collectionWindowEnd)
          : null;
        if (s && e) windowText = ` (${s} – ${e})`;
        else if (s) windowText = ` (from ${s})`;
        else if (e) windowText = ` (until ${e})`;
      }

      return `
    <tr>
      <td style="padding:12px 16px;font-size:14px;color:#0f172a;border-bottom:1px solid #e2e8f0;font-weight:600">${escapeHtml(customerName)}</td>
      <td style="padding:12px 16px;font-size:14px;color:#334155;border-bottom:1px solid #e2e8f0">${escapeHtml(job.bikeMake)} ${escapeHtml(job.bikeModel)}</td>
      <td style="padding:12px 16px;font-size:14px;color:#64748b;border-bottom:1px solid #e2e8f0">${escapeHtml(deliveryLabel)}${escapeHtml(windowText)}</td>
      <td style="padding:12px 16px;font-size:13px;color:#94a3b8;border-bottom:1px solid #e2e8f0">${escapeHtml(contact)}</td>
    </tr>`;
    })
    .join("");

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <thead>
    <tr style="background-color:#f8fafc">
      <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Customer</th>
      <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Bike</th>
      <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Type</th>
      <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Contact</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

/**
 * Daily staff digest: notifies the shop owner/staff about customers dropping off
 * or being collected today and tomorrow.
 *
 * Sends an email to SHOP_NOTIFY_EMAIL (or ADMIN_EMAIL) and a push notification
 * to all registered staff devices.
 *
 * Runs daily at 8:00 AM in the shop timezone via Vercel Cron (see vercel.json).
 * Vercel cron schedules are UTC-only, so vercel.json invokes this route at both
 * 12:00 and 13:00 UTC; this handler sends only when the shop's local hour is 8.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const timezone =
      process.env.SHOP_TIMEZONE?.trim() || "America/New_York";

    const localHour = getLocalHour(timezone);
    if (localHour !== 8) {
      return NextResponse.json({
        skipped: true,
        reason: "outside_send_window",
        timezone,
        localHour,
      });
    }

    const { gte: todayStart, lte: todayEnd } = getLocalDayBounds(timezone, 0);
    const { gte: tomorrowStart, lte: tomorrowEnd } = getLocalDayBounds(timezone, 1);

    const [todayJobs, tomorrowJobs] = await Promise.all([
      prisma.job.findMany({
        where: {
          shopId: DEFAULT_SHOP_ID,
          stage: "BOOKED_IN",
          dropOffDate: { gte: todayStart, lte: todayEnd },
        },
        include: {
          customer: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: { dropOffDate: "asc" },
      }),
      prisma.job.findMany({
        where: {
          shopId: DEFAULT_SHOP_ID,
          stage: "BOOKED_IN",
          dropOffDate: { gte: tomorrowStart, lte: tomorrowEnd },
        },
        include: {
          customer: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: { dropOffDate: "asc" },
      }),
    ]);

    const totalJobs = todayJobs.length + tomorrowJobs.length;

    // Send push notification to all staff devices
    if (totalJobs > 0) {
      const parts: string[] = [];
      if (todayJobs.length > 0) {
        parts.push(
          `${todayJobs.length} today`
        );
      }
      if (tomorrowJobs.length > 0) {
        parts.push(`${tomorrowJobs.length} tomorrow`);
      }
      await sendPushToAllStaff(DEFAULT_SHOP_ID, {
        title: "Upcoming customer drop-offs",
        body: parts.join(", "),
      });
    }

    // Send email digest to shop
    const resend = getResend();
    const notifyEmail =
      process.env.SHOP_NOTIFY_EMAIL?.trim() ||
      process.env.ADMIN_EMAIL?.trim();

    if (!resend || !notifyEmail) {
      console.warn(
        "Email not sent: RESEND_API_KEY or SHOP_NOTIFY_EMAIL/ADMIN_EMAIL not configured"
      );
      return NextResponse.json({
        pushed: totalJobs > 0,
        emailed: false,
        today: todayJobs.length,
        tomorrow: tomorrowJobs.length,
      });
    }

    const baseUrl = getAppUrl();
    const calendarUrl = baseUrl ? `${baseUrl}/calendar` : "";
    const todayLabel = formatDate(todayStart, timezone);
    const tomorrowLabel = formatDate(tomorrowStart, timezone);

    let innerHtml = "";

    if (totalJobs === 0) {
      innerHtml = `<p style="margin:0 0 16px;color:#64748b">No customers are booked in for today (${escapeHtml(formatShortDate(todayStart, timezone))}) or tomorrow (${escapeHtml(formatShortDate(tomorrowStart, timezone))}).</p>`;
    } else {
      if (todayJobs.length > 0) {
        innerHtml += `
<h2 style="margin:0 0 12px;font-size:17px;font-weight:700;color:#0f172a">Today — ${escapeHtml(todayLabel)}</h2>
${buildJobTableRows(todayJobs)}`;
      } else {
        innerHtml += `<p style="margin:0 0 20px;color:#64748b">No customers booked for today (${escapeHtml(formatShortDate(todayStart, timezone))}).</p>`;
      }

      if (tomorrowJobs.length > 0) {
        innerHtml += `
<h2 style="margin:${todayJobs.length > 0 ? "8px" : "0"} 0 12px;font-size:17px;font-weight:700;color:#0f172a">Tomorrow — ${escapeHtml(tomorrowLabel)}</h2>
${buildJobTableRows(tomorrowJobs)}`;
      } else {
        innerHtml += `<p style="margin:0 0 20px;color:#64748b">No customers booked for tomorrow (${escapeHtml(formatShortDate(tomorrowStart, timezone))}).</p>`;
      }
    }

    if (calendarUrl) {
      innerHtml += buildCustomerEmailCtaButton(calendarUrl, "Open calendar");
    }

    const branding = await getCustomerEmailBrandingAssets(DEFAULT_SHOP_ID);
    const html = buildCustomerEmailHtml({
      innerHtml: innerHtml.trim(),
      headerLogoSrc: branding.headerLogoSrc,
      heading: "Upcoming bookings",
    });
    const attachments = customerEmailBrandingAttachments(branding);

    const subjectParts: string[] = [];
    if (todayJobs.length > 0)
      subjectParts.push(
        `${todayJobs.length} today`
      );
    if (tomorrowJobs.length > 0)
      subjectParts.push(`${tomorrowJobs.length} tomorrow`);

    const subject =
      totalJobs === 0
        ? `No upcoming bookings for ${formatShortDate(todayStart, timezone)} or ${formatShortDate(tomorrowStart, timezone)}`
        : `Upcoming bookings: ${subjectParts.join(", ")}`;

    const { error } = await resend.emails.send({
      from: getFromEmail(),
      to: notifyEmail,
      subject,
      html,
      ...(attachments && { attachments }),
    });

    if (error) {
      console.error("staff-booking-reminders email error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      pushed: totalJobs > 0,
      emailed: true,
      today: todayJobs.length,
      tomorrow: tomorrowJobs.length,
    });
  } catch (err) {
    console.error("Cron staff-booking-reminders error:", err);
    return NextResponse.json(
      { error: "Failed to send staff booking reminders" },
      { status: 500 }
    );
  }
}
