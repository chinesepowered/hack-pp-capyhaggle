/**
 * Payouts v1 over plain REST (the server SDK does not cover Payouts). The marketplace pays the
 * seller from its sandbox balance as soon as the handoff capture completes.
 */
import { fromPayPalValue, toPayPalValue } from "../money";
import { rest } from "./core";
import { PayPalApiError, PayPalUnknownOutcomeError } from "./errors";

export interface PayoutInput {
  /** Deal-derived: PayPal rejects a second batch with the same sender_batch_id. */
  senderBatchId: string;
  senderItemId: string;
  receiverEmail: string;
  amountCents: number;
  note: string;
  emailSubject: string;
  emailMessage: string;
}

export interface PayoutSnapshot {
  batchId: string;
  batchStatus: string;
  itemId?: string;
  itemStatus?: string;
  transactionId?: string;
  amountCents?: number;
  feeCents?: number;
  error?: string;
  timeCompleted?: string;
}

interface PayoutBatchWire {
  batch_header?: {
    payout_batch_id?: string;
    batch_status?: string;
    time_completed?: string;
    amount?: { value?: string };
    fees?: { value?: string };
  };
  items?: {
    payout_item_id?: string;
    transaction_id?: string;
    transaction_status?: string;
    errors?: { name?: string; message?: string };
  }[];
  links?: { href: string; rel: string }[];
}

function snapshot(wire: PayoutBatchWire): PayoutSnapshot {
  const h = wire.batch_header ?? {};
  const item = wire.items?.[0];
  return {
    batchId: h.payout_batch_id ?? "",
    batchStatus: h.batch_status ?? "UNKNOWN",
    itemId: item?.payout_item_id,
    itemStatus: item?.transaction_status,
    transactionId: item?.transaction_id,
    amountCents: h.amount?.value ? fromPayPalValue(h.amount.value) : undefined,
    feeCents: h.fees?.value ? fromPayPalValue(h.fees.value) : undefined,
    error: item?.errors ? [item.errors.name, item.errors.message].filter(Boolean).join(": ") : undefined,
    timeCompleted: h.time_completed,
  };
}

export function buildPayoutBody(input: PayoutInput) {
  return {
    sender_batch_header: {
      sender_batch_id: input.senderBatchId,
      email_subject: input.emailSubject.slice(0, 255),
      email_message: input.emailMessage.slice(0, 1000),
    },
    items: [
      {
        recipient_type: "EMAIL",
        recipient_wallet: "PAYPAL",
        amount: { value: toPayPalValue(input.amountCents), currency: "USD" },
        receiver: input.receiverEmail,
        note: input.note.slice(0, 1000),
        sender_item_id: input.senderItemId,
      },
    ],
  };
}

/** A repeated sender_batch_id is refused with a link to the batch that already exists. */
function existingBatchId(err: PayPalApiError): string | undefined {
  const link = err.body.links?.find((l) => /\/v1\/payments\/payouts\/[A-Z0-9]+/.test(l.href));
  return link?.href.match(/\/v1\/payments\/payouts\/([A-Z0-9]+)/)?.[1];
}

/** POST /v1/payments/payouts. */
export async function createPayout(input: PayoutInput): Promise<PayoutSnapshot> {
  const post = () =>
    rest<PayoutBatchWire>({
      name: "payouts.create",
      method: "POST",
      path: "/v1/payments/payouts",
      requestId: input.senderBatchId,
      body: buildPayoutBody(input),
    });
  const settleDuplicate = async (err: unknown) => {
    if (err instanceof PayPalApiError && err.status === 400) {
      const batchId = existingBatchId(err);
      if (batchId) return getPayout(batchId);
    }
    throw err;
  };
  try {
    return snapshot((await post()).result);
  } catch (err) {
    if (err instanceof PayPalUnknownOutcomeError) {
      // Unknown outcome: repeat with the same sender_batch_id. Either it goes through now, or
      // PayPal refuses the duplicate and points at the batch the first request created.
      try {
        return snapshot((await post()).result);
      } catch (second) {
        return settleDuplicate(second);
      }
    }
    return settleDuplicate(err);
  }
}

/** GET /v1/payments/payouts/{batch_id}. */
export async function getPayout(batchId: string): Promise<PayoutSnapshot> {
  const res = await rest<PayoutBatchWire>({ name: "payouts.get", method: "GET", path: `/v1/payments/payouts/${batchId}` });
  return snapshot(res.result);
}
