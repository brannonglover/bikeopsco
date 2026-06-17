import { sendPaymentReceivedNotification } from "@/lib/email";
import { sendPushToAllStaff } from "@/lib/push";
import { sendPlainSms } from "@/lib/sms";

export interface PaymentReceivedDetails {
  shopId: string;
  jobId: string;
  amount: number;
  currency?: string;
  paymentMethod: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  bikeMake: string;
  bikeModel: string;
  isPaidInFull?: boolean;
  remainingBalance?: number;
  subtotal?: number;
  totalPaid?: number;
}

function formatMoney(amount: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount);
}

function formatPaymentMethodLabel(method: string): string {
  const normalized = method.trim().toLowerCase();
  if (!normalized || normalized === "unknown") return "payment";
  if (normalized === "cash") return "cash";
  if (normalized === "terminal" || normalized === "card_present") return "card (in person)";
  if (normalized === "apple_pay") return "Apple Pay";
  if (normalized === "google_pay") return "Google Pay";
  if (normalized === "online" || normalized === "card") return "card (online)";
  return normalized.replace(/_/g, " ");
}

export function buildPaymentReceivedDetails(input: {
  shopId: string;
  jobId: string;
  amount: number;
  currency?: string;
  paymentMethod: string | null | undefined;
  bikeMake: string;
  bikeModel: string;
  customer: {
    firstName: string;
    lastName: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  paymentSummary?: {
    isPaidInFull: boolean;
    remaining: number;
    subtotal: number;
    totalPaid: number;
  };
}): PaymentReceivedDetails {
  const customerName = input.customer
    ? input.customer.lastName
      ? `${input.customer.firstName} ${input.customer.lastName}`
      : input.customer.firstName
    : "Unknown";

  return {
    shopId: input.shopId,
    jobId: input.jobId,
    amount: input.amount,
    currency: input.currency,
    paymentMethod: input.paymentMethod?.trim() || "unknown",
    customerName,
    customerEmail: input.customer?.email,
    customerPhone: input.customer?.phone,
    bikeMake: input.bikeMake,
    bikeModel: input.bikeModel,
    isPaidInFull: input.paymentSummary?.isPaidInFull,
    remainingBalance: input.paymentSummary?.remaining,
    subtotal: input.paymentSummary?.subtotal,
    totalPaid: input.paymentSummary?.totalPaid,
  };
}

/** Notify shop staff by email, push, and optional SMS when a payment is recorded. */
export function notifyShopOfPayment(details: PaymentReceivedDetails): void {
  const currency = details.currency ?? "usd";
  const amountFormatted = formatMoney(details.amount, currency);
  const customerLabel = details.customerName || "Customer";
  const bikeLabel = `${details.bikeMake} ${details.bikeModel}`.trim();
  const methodLabel = formatPaymentMethodLabel(details.paymentMethod);

  sendPaymentReceivedNotification(details)
    .then((result) => {
      if (!result.ok) console.error("[Payment] Staff email failed:", result.error);
    })
    .catch((e) => console.error("[Payment] Staff email threw:", e));

  sendPushToAllStaff(details.shopId, {
    title: "Payment received",
    body: `${amountFormatted} from ${customerLabel} — ${bikeLabel}`,
    data: { type: "payment_received", jobId: details.jobId },
  }).catch((e) => console.error("[Payment] Staff push failed:", e));

  const notifyPhone = process.env.SHOP_NOTIFY_PHONE?.trim();
  if (notifyPhone) {
    const balanceSuffix =
      details.isPaidInFull === true
        ? " Paid in full."
        : details.remainingBalance != null && details.remainingBalance > 0
          ? ` ${formatMoney(details.remainingBalance, currency)} remaining.`
          : "";
    const smsBody = `Payment received: ${amountFormatted} via ${methodLabel} for ${bikeLabel} (${customerLabel}).${balanceSuffix}`;
    sendPlainSms(notifyPhone, smsBody)
      .then((result) => {
        if (!result.ok) console.error("[Payment] Staff SMS failed:", result.error);
      })
      .catch((e) => console.error("[Payment] Staff SMS threw:", e));
  }
}
