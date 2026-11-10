/**
 * Orders v2 through the server SDK. Orders are created with intent AUTHORIZE: the buyer's money is
 * held, not sent, until the seller scans the pickup QR code.
 */
import {
  CheckoutPaymentIntent,
  ItemCategory,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
  type Order,
  type OrderAuthorizeResponse,
  type OrderRequest,
} from "@paypal/paypal-server-sdk";
import { fromPayPalValue, toPayPalValue } from "../money";
import { sdk, sdkCall } from "./core";
import { PayPalApiError, PayPalUnknownOutcomeError } from "./errors";

export interface HoldOrderInput {
  dealId: string;
  /** Deal-derived, so a retry or a second click reaches PayPal with the same key. */
  requestId: string;
  amountCents: number;
  title: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface OrderSnapshot {
  id: string;
  status: string;
  approveUrl?: string;
  amountCents?: number;
  customId?: string;
  authorization?: AuthorizationSnapshot;
  captureId?: string;
  captureStatus?: string;
  payerName?: string;
}

export interface AuthorizationSnapshot {
  id: string;
  status: string;
  amountCents?: number;
  expiresAt?: string;
  createdAt?: string;
}

function snapshot(order: Order | OrderAuthorizeResponse): OrderSnapshot {
  const unit = order.purchaseUnits?.[0];
  const auth = unit?.payments?.authorizations?.[0];
  const capture = unit?.payments?.captures?.[0];
  const payer = order.paymentSource?.paypal?.name ?? order.payer?.name;
  return {
    id: order.id ?? "",
    status: order.status ?? "UNKNOWN",
    approveUrl: order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href,
    amountCents: unit?.amount?.value ? fromPayPalValue(unit.amount.value) : undefined,
    customId: unit?.customId,
    authorization: auth?.id
      ? {
          id: auth.id,
          status: auth.status ?? "UNKNOWN",
          amountCents: auth.amount?.value ? fromPayPalValue(auth.amount.value) : undefined,
          expiresAt: auth.expirationTime,
          createdAt: auth.createTime,
        }
      : undefined,
    captureId: capture?.id,
    captureStatus: capture?.status,
    payerName: payer ? [payer.givenName, payer.surname].filter(Boolean).join(" ") : undefined,
  };
}

export function buildHoldOrderRequest(input: HoldOrderInput): OrderRequest {
  const value = toPayPalValue(input.amountCents);
  return {
    intent: CheckoutPaymentIntent.Authorize,
    purchaseUnits: [
      {
        referenceId: input.dealId,
        customId: input.dealId,
        description: input.description.slice(0, 127),
        amount: {
          currencyCode: "USD",
          value,
          breakdown: { itemTotal: { currencyCode: "USD", value } },
        },
        items: [
          {
            name: input.title.slice(0, 127),
            quantity: "1",
            category: ItemCategory.PhysicalGoods,
            unitAmount: { currencyCode: "USD", value },
          },
        ],
      },
    ],
    paymentSource: {
      paypal: {
        experienceContext: {
          brandName: "Capy vs Capy",
          // Local pickup: there is no shipping address to collect.
          shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
          userAction: PaypalExperienceUserAction.PayNow,
          returnUrl: input.returnUrl,
          cancelUrl: input.cancelUrl,
        },
      },
    },
  };
}

/** POST /v2/checkout/orders with intent AUTHORIZE. */
export async function createHoldOrder(input: HoldOrderInput): Promise<OrderSnapshot> {
  const call = () =>
    sdkCall({ name: "orders.create", method: "POST", path: "/v2/checkout/orders", requestId: input.requestId }, () =>
      sdk().orders.createOrder({ body: buildHoldOrderRequest(input), paypalRequestId: input.requestId, prefer: "return=representation" }),
    );
  try {
    return snapshot((await call()).result);
  } catch (err) {
    if (err instanceof PayPalUnknownOutcomeError) {
      // Unknown outcome: repeat with the same PayPal-Request-Id. PayPal answers with the original
      // order if the first request arrived, so this can never create a second order.
      return snapshot((await call()).result);
    }
    throw err;
  }
}

/** GET /v2/checkout/orders/{id}. */
export async function getOrder(id: string): Promise<OrderSnapshot> {
  const res = await sdkCall({ name: "orders.get", method: "GET", path: `/v2/checkout/orders/${id}` }, () => sdk().orders.getOrder({ id }));
  return snapshot(res.result);
}

/** POST /v2/checkout/orders/{id}/authorize, after the buyer approved in PayPal's window. */
export async function authorizeOrder(id: string, requestId: string): Promise<OrderSnapshot> {
  try {
    const res = await sdkCall({ name: "orders.authorize", method: "POST", path: `/v2/checkout/orders/${id}/authorize`, requestId }, () =>
      sdk().orders.authorizeOrder({ id, paypalRequestId: requestId, prefer: "return=representation" }),
    );
    return snapshot(res.result);
  } catch (err) {
    const alreadyDone = err instanceof PayPalApiError && err.status === 422 && err.issue === "ORDER_ALREADY_AUTHORIZED";
    if (alreadyDone || err instanceof PayPalUnknownOutcomeError) {
      // Settle by re-reading the order: if PayPal holds an authorization, the write happened.
      const order = await getOrder(id);
      if (order.authorization) return order;
    }
    throw err;
  }
}
