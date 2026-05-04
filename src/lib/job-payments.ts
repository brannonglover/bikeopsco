type LineItem = {
  quantity?: number | null;
  unitPrice: unknown;
};

type PaymentRecord = {
  amount: unknown;
  paymentMethod?: string | null;
  status: unknown;
  stripePaymentIntentId?: string | null;
};

type DerivedPaymentStatus = "UNPAID" | "PENDING" | "PAID" | "REFUNDED";

const DEFAULT_SURCHARGE_PERCENT = 2.9;
const DEFAULT_SURCHARGE_FIXED_CENTS = 30;

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function getCardSurchargeConfig(): { fixed: number; pct: number } {
  const percent = Number(process.env.CARD_SURCHARGE_PERCENT);
  const fixedCents = Number(process.env.CARD_SURCHARGE_FIXED_CENTS);
  const useDefaults =
    Number.isNaN(percent) || process.env.CARD_SURCHARGE_PERCENT === undefined;
  const pct = useDefaults ? DEFAULT_SURCHARGE_PERCENT : percent;
  const fixed = Number.isNaN(fixedCents)
    ? DEFAULT_SURCHARGE_FIXED_CENTS / 100
    : fixedCents / 100;
  return { pct, fixed };
}

function computeTotalFromChargedAmount(
  amountCharged: number,
  mode: "online" | "in_person" | "terminal"
): number {
  if (mode === "terminal") return amountCharged;
  const { pct, fixed } = getCardSurchargeConfig();
  if (pct === 0 && fixed === 0) return amountCharged;
  const total = amountCharged - (amountCharged * (pct / 100) + fixed);
  return roundCurrency(total);
}

function parseMoney(value: unknown): number {
  const parsed =
    typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function computeLineItemsTotal(items: LineItem[] | null | undefined): number {
  const total = (items ?? []).reduce((sum, item) => {
    return sum + parseMoney(item.unitPrice) * (item.quantity || 1);
  }, 0);
  return roundCurrency(total);
}

export function computeJobSubtotal(input: {
  jobProducts?: LineItem[] | null;
  jobServices?: LineItem[] | null;
}): number {
  return roundCurrency(
    computeLineItemsTotal(input.jobServices) + computeLineItemsTotal(input.jobProducts)
  );
}

export function computeTotalPaid(
  payments: PaymentRecord[] | null | undefined
): number {
  const totalPaid = (payments ?? []).reduce((sum, payment) => {
    const status = String(payment.status ?? "").toLowerCase();
    if (status !== "succeeded") return sum;

    const amount = Number.parseFloat(String(payment.amount));
    if (!Number.isFinite(amount)) return sum;

    const method = String(payment.paymentMethod ?? "").toLowerCase();
    const isStripe = Boolean(payment.stripePaymentIntentId);
    const mode =
      method === "terminal" || method === "card_present" ? "terminal" : "online";

    const amountTowardJobTotal = isStripe
      ? computeTotalFromChargedAmount(amount, mode)
      : amount;

    return sum + amountTowardJobTotal;
  }, 0);

  return roundCurrency(totalPaid);
}

export function getJobPaymentSummary(input: {
  currentStatus?: string | null;
  subtotal: number;
  totalPaid: number;
}): {
  isPaidInFull: boolean;
  paymentStatus: DerivedPaymentStatus;
  remaining: number;
  subtotal: number;
  totalPaid: number;
} {
  const subtotal = roundCurrency(input.subtotal);
  const totalPaid = roundCurrency(input.totalPaid);
  const currentStatus = String(input.currentStatus ?? "").toUpperCase();
  const isMarkedPaid = currentStatus === "PAID" && toCents(subtotal) > 0;
  const rawRemainingCents = Math.max(0, toCents(subtotal) - toCents(totalPaid));
  const remainingCents = isMarkedPaid || (rawRemainingCents <= 1 && toCents(totalPaid) > 0)
    ? 0
    : rawRemainingCents;
  const remaining = remainingCents / 100;
  const isPaidInFull = isMarkedPaid || (remainingCents === 0 && toCents(subtotal) > 0);

  let paymentStatus: DerivedPaymentStatus;
  if (isPaidInFull) {
    paymentStatus = "PAID";
  } else if (toCents(totalPaid) > 0) {
    paymentStatus = "PENDING";
  } else if (currentStatus === "REFUNDED") {
    paymentStatus = "REFUNDED";
  } else {
    paymentStatus = "UNPAID";
  }

  return {
    isPaidInFull,
    paymentStatus,
    remaining,
    subtotal,
    totalPaid,
  };
}
