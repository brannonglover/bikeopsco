import { prisma } from "@/lib/db";
import { getDisplayPartsForJobBikeRow } from "@/lib/job-display";
import { sendJobEmail } from "@/lib/email";
import { customerHasPushTokens, sendPushToCustomer } from "@/lib/push";
import { sendJobSms, type BikeScopedSend, type JobForSms } from "@/lib/sms";
import { getEffectiveEmailUpdatesConsent, getEffectiveSmsConsent } from "@/lib/sms-consent";
import { mirrorJobStageToCustomerChat } from "@/lib/system-chat";
import type { Job, JobBike } from "@/lib/types";

export { findBikeEnteringPartsHold } from "@/lib/job-bike-parts-hold";

/**
 * Bike status drives bike-specific customer notifications; job stage drives board behavior.
 * This is the bike-level counterpart to the stage notification block in the job PATCH route,
 * and deliberately reuses the same templates, consent checks, chat mirror and sent-history
 * rows — the only difference is that its history rows carry a `jobBikeId`, so dedup is per
 * bike instead of per job.
 */
export const BIKE_WAITING_ON_PARTS_SLUG = "bike_waiting_on_parts";

/** Name the customer would recognize for one bike: nickname, else make + model. */
export function resolveJobBikeScope(
  job: unknown,
  jobBikeId: string
): BikeScopedSend | null {
  // The display precedence (nickname → linked profile bike → row snapshot) lives in
  // job-display; the Prisma row is structurally compatible with the client Job type.
  const typedJob = job as Job;
  const bike = (typedJob.jobBikes ?? []).find((b) => b.id === jobBikeId);
  if (!bike) return null;

  const parts = getDisplayPartsForJobBikeRow(typedJob, bike as JobBike);
  const makeModel = [parts.make, parts.model].filter(Boolean).join(" ").trim();
  const bikeName = parts.nickname?.trim() || makeModel || typedJob.bikeMake;

  return {
    bikeName,
    bikeMake: parts.make || typedJob.bikeMake,
    bikeModel: parts.model ?? "",
    jobBikeId,
  };
}

type NotifyArgs = {
  job: JobForSms & {
    shopId: string;
    customer:
      | {
          id: string;
          email: string | null;
          phone: string | null;
          smsConsent: boolean;
          smsConsentUpdatedAt: Date | string | null;
          emailUpdatesConsent?: boolean | null;
        }
      | null;
  };
  jobBikeId: string;
  shopHint: { name: string; subdomain: string | null };
  features: { chatEnabled: boolean; notifyCustomerEnabled: boolean };
  notifyCustomer: boolean;
  resend: boolean;
};

/**
 * Tell the customer that one bike is waiting on parts, without implying the whole repair
 * is blocked. Chat mirror is awaited (serverless drops work after the response); email and
 * SMS are fire-and-forget, matching the stage notification path.
 */
export async function notifyBikeWaitingOnParts({
  job,
  jobBikeId,
  shopHint,
  features,
  notifyCustomer,
  resend,
}: NotifyArgs): Promise<void> {
  const customer = job.customer;
  if (!customer?.id) return;

  const bikeScope = resolveJobBikeScope(job, jobBikeId);
  if (!bikeScope) return;

  if (features.chatEnabled) {
    try {
      await mirrorJobStageToCustomerChat({
        shopId: job.shopId,
        customerId: customer.id,
        job,
        smsTemplateSlug: BIKE_WAITING_ON_PARTS_SLUG,
        force: resend,
        shopHint,
        bikeScope,
      });
    } catch (e) {
      console.error("[bike-notify] waiting-on-parts chat mirror failed:", {
        jobId: job.id,
        jobBikeId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!features.notifyCustomerEnabled || !notifyCustomer) return;

  void (async () => {
    try {
      const customerEmail = getEffectiveEmailUpdatesConsent(job.customer)
        ? customer.email
        : null;
      // App users get push instead of SMS (token = installed + registered).
      const preferAppPush = await customerHasPushTokens(job.shopId, customer.id);
      const canSendSms = !preferAppPush && getEffectiveSmsConsent(job.customer);

      // Same dedup as the stage path, scoped to this bike so each bike notifies once.
      const sentWhere = {
        shopId: job.shopId,
        jobId: job.id,
        jobBikeId,
        templateSlug: BIKE_WAITING_ON_PARTS_SLUG,
      };
      const [emailAlreadySent, smsAlreadySent] = await Promise.all([
        customerEmail
          ? prisma.jobEmail.findFirst({ where: sentWhere })
          : Promise.resolve(null),
        canSendSms && customer.phone
          ? prisma.jobSms.findFirst({ where: sentWhere })
          : Promise.resolve(null),
      ]);

      if (customerEmail && (!emailAlreadySent || resend)) {
        sendJobEmail(
          BIKE_WAITING_ON_PARTS_SLUG,
          customerEmail,
          job,
          bikeScope
        ).catch(console.error);
      }

      if (canSendSms && customer.phone && (!smsAlreadySent || resend)) {
        const result = await sendJobSms(
          BIKE_WAITING_ON_PARTS_SLUG,
          customer.phone,
          job,
          shopHint,
          bikeScope
        );
        if (!result.ok) {
          console.warn("[bike-notify] waiting-on-parts SMS send failed:", {
            jobId: job.id,
            jobBikeId,
            error: result.error,
          });
        }
      }
    } catch (e) {
      console.error("[bike-notify] waiting-on-parts dedup/send failed:", e);
    }
  })();

  void sendPushToCustomer(job.shopId, customer.id, {
    title: shopHint.name,
    body: `${bikeScope.bikeName} is waiting on parts`,
    data: { type: "job_update", jobId: job.id },
  }).catch((e) =>
    console.error("[bike-notify] waiting-on-parts push failed:", {
      jobId: job.id,
      jobBikeId,
      error: e instanceof Error ? e.message : String(e),
    })
  );
}
