# PayPal integration plan and contract sheet

This file is the plan-first artifact that APIMatic's PayPal Context Plugin asks for (`typescript-integrate-paypal`,
Step 1: "write the plan and its contract sheet to `paypal-plan.md` at the repo root" before any PayPal code exists).
The skills live in `.claude/skills/typescript-*`.

One deviation, stated up front: the plugin's lookup layer documents the newer generated package (`paypal`, client
`PaypalClient`, 2.29.0, installed from git and built from source). This build's brief pins the APIMatic-generated
package that is on npm, **`@paypal/paypal-server-sdk` 2.5.0**. We kept the plugin's method (no SDK fact from memory,
every signature and field looked up in the installed package, one contract sheet, claims before writes, unknown
outcomes settled by a re-read, optional fields left out unless something requires them, refusals mapped per status)
and pointed the lookups at `node_modules/@paypal/paypal-server-sdk/src`, which ships the full generated source.

## Repo survey (read-only prerequisites)

| Fact | Value |
| --- | --- |
| Runtime | Node 22 locally, Vercel Node functions in production. Next.js 16 App Router route handlers. |
| Module format | ESM (`"module": "esnext"`, bundler resolution). The SDK is imported from its package root only. |
| Package manager | pnpm 10 |
| Checks | `pnpm typecheck` (tsc), `pnpm lint` (eslint), `pnpm test` (vitest), `pnpm build` |
| Host | Sandbox only: `https://api-m.sandbox.paypal.com`. `lib/paypal/core.ts` refuses to start unless `PAYPAL_ENVIRONMENT=sandbox`. |
| Credentials | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` from the environment, server-side only. |
| Smoke (2026-11-10) | Create order (AUTHORIZE) 200, buyer approval in headless Chromium, authorize 201, capture 201, payout batch 201 then SUCCESS, all against the real sandbox credential before any project code was written. |

## Operations in scope

Signatures are copied from `src/controllers/ordersController.ts` and `src/controllers/paymentsController.ts`. Every
call returns `Promise<ApiResponse<T>>` (`request`, `statusCode`, `headers`, `result`, `body`); a non-2xx status rejects
with `ApiError` (same fields, `result` is the decoded error body). Request objects are flat: `body` is the JSON body and
the other fields are headers or path parameters.

| # | Operation | SDK call or REST | Wire | Returns |
| --- | --- | --- | --- | --- |
| 1 | Create the hold order | `ordersController.createOrder({ body: OrderRequest, paypalRequestId, prefer })` | `POST /v2/checkout/orders` | `Order` |
| 2 | Read the order | `ordersController.getOrder({ id })` | `GET /v2/checkout/orders/{id}` | `Order` |
| 3 | Authorize after approval | `ordersController.authorizeOrder({ id, paypalRequestId, prefer })` | `POST /v2/checkout/orders/{id}/authorize` | `OrderAuthorizeResponse` |
| 4 | Read the authorization | `paymentsController.getAuthorizedPayment({ authorizationId })` | `GET /v2/payments/authorizations/{id}` | `PaymentAuthorization` |
| 5 | Reauthorize (capture after day 3) | `paymentsController.reauthorizePayment({ authorizationId, paypalRequestId, prefer, body })` | `POST /v2/payments/authorizations/{id}/reauthorize` | `PaymentAuthorization` |
| 6 | Capture at handoff | `paymentsController.captureAuthorizedPayment({ authorizationId, paypalRequestId, prefer, body: CaptureRequest })` | `POST /v2/payments/authorizations/{id}/capture` | `CapturedPayment` |
| 7 | Void on no-show | `paymentsController.voidPayment({ authorizationId, paypalRequestId, prefer })` | `POST /v2/payments/authorizations/{id}/void` | `PaymentAuthorization or null` |
| 8 | Read the capture | `paymentsController.getCapturedPayment({ captureId })` | `GET /v2/payments/captures/{id}` | `CapturedPayment` |
| 9 | Refund (problem within 24 hours) | Agent Toolkit `create_refund` behind our guard, which posts `POST /v2/payments/captures/{id}/refund` | same | refund JSON |
| 10 | Pay the seller | REST (not in the SDK) | `POST /v1/payments/payouts` | batch header |
| 11 | Read the payout | REST | `GET /v1/payments/payouts/{batch_id}` | batch with items |
| 12 | Verify a webhook | REST | `POST /v1/notifications/verify-webhook-signature` | `verification_status` |
| 13 | Register the webhook | REST | `POST /v1/notifications/webhooks`, `GET /v1/notifications/webhooks` | webhook |
| 14 | Agent reads an order | Agent Toolkit `get_order` behind our guard | `GET /v2/checkout/orders/{id}` | order JSON |

Enum members used (from `src/models/*.ts`): `CheckoutPaymentIntent.Authorize`; `OrderStatus` CREATED, SAVED, APPROVED,
VOIDED, COMPLETED, PAYER_ACTION_REQUIRED; `AuthorizationStatus` CREATED, CAPTURED, DENIED, PARTIALLY_CAPTURED, VOIDED,
PENDING; `CaptureStatus` COMPLETED, DECLINED, PARTIALLY_REFUNDED, PENDING, REFUNDED, FAILED.

## DURABLE WRITES

### DUPLICATE CLAIMS

Every write is keyed on something every caller computes the same way: the deal id. The claim is a document created
with an atomic create-if-absent (`store.claim`, file `wx` flag locally, `allowOverwrite: false` on Vercel Blob), and the
same deal-derived value is sent to PayPal as `PayPal-Request-Id` (or `sender_batch_id` for payouts), so a second click,
a retry, or two tabs cannot produce two orders, two captures or two payouts.

| Write | Where the claim is stored | What rejects the second one | Where that rejection is caught | Where in the code |
| --- | --- | --- | --- | --- |
| Create order | `claims/{dealId}/order` | `store.claim` returns false; PayPal also replays the first response for the same `PayPal-Request-Id` | loser re-reads the deal and returns the stored order id | `lib/deals.ts` `placeHold` |
| Authorize order | `claims/{dealId}/authorize` | same | loser re-reads the order from PayPal | `lib/deals.ts` `authorizeHold` |
| Capture | `claims/{dealId}/capture` (also guarded by the single-use QR nonce) | same | loser re-reads the authorization | `lib/deals.ts` `completeHandoff` |
| Payout | `claims/{dealId}/payout`, `sender_batch_id = cvc-{dealId}-{salt}-payout` | same; PayPal rejects a repeated `sender_batch_id` | loser reads the stored batch id | `lib/deals.ts` `payoutSeller` |
| Void | `claims/{dealId}/void` | same | loser re-reads the authorization | `lib/deals.ts` `voidHold` |
| Refund | `claims/{dealId}/refund` | same | loser re-reads the capture | `lib/deals.ts` `refundBuyer` |

A claim is released when PayPal refuses the call with a 4xx, so a later legitimate attempt is not blocked.

### UNKNOWN OUTCOMES

| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |
| --- | --- | --- | --- | --- |
| Create order | repeat `createOrder` with the same `PayPal-Request-Id` (PayPal returns the original order) | the request id `cvc-{dealId}-{salt}-order` | `lib/paypal/orders.ts` `createHoldOrder` | `tests/paypal-unknown.test.ts` |
| Authorize order | `getOrder` | order id | `lib/paypal/orders.ts` `authorizeOrder` | `tests/paypal-unknown.test.ts` |
| Capture | `getAuthorizedPayment` then `getOrder` | authorization id | `lib/paypal/payments.ts` `captureAuthorization` | `tests/paypal-unknown.test.ts` |
| Void | `getAuthorizedPayment` | authorization id | `lib/paypal/payments.ts` `voidAuthorization` | `tests/paypal-unknown.test.ts` |
| Payout | repeat the POST with the same `sender_batch_id`; a duplicate answer carries the existing batch link | `sender_batch_id` | `lib/paypal/payouts.ts` `createPayout` | `tests/paypal-unknown.test.ts` |

A network failure or timeout on a write is reported to the caller as "unknown, checking with PayPal", never as
"failed". A request that never left (no credentials, bad input) is a different outcome and is not re-read.

## CROSS-OPERATION INVARIANTS

| Invariant | Where the legal set comes from | Enforced where | The test that proves it |
| --- | --- | --- | --- |
| An order amount equals the agreed price, and the agreed price is inside both mandates | the deal record and the two signed mandates | `lib/guards.ts` `guardCreateHold`, before the claim | `tests/money-rules.test.ts` (guards) |
| An agent may only read or refund objects of its own deal | `deal.payment.orderId`, `deal.payment.captureId` | `lib/guards.ts` `guardGetOrder`, `guardRefund` | `tests/money-rules.test.ts` (guards) |
| Capture only for a deal whose QR token verifies, is unexpired and unused | `QR_SIGNING_SECRET`, the nonce stored on the deal | `lib/qr.ts`, `lib/deals.ts` `completeHandoff` | `tests/money-rules.test.ts` (pickup QR) and `tests/replay.test.ts` |
| Payout amount equals price minus the fee shown at Accept | `lib/money.ts` `feeFor` | `lib/deals.ts` `payoutSeller` | `tests/money-rules.test.ts` (money) |
| Refund only within 24 hours of capture and never more than was captured | capture time and amount re-read from PayPal | `lib/guards.ts` `guardRefund` | `tests/money-rules.test.ts` (guards) |

## OPTIONAL FIELDS

| Operation | Field | What requires it | Set it? |
| --- | --- | --- | --- |
| createOrder | `paypalRequestId` | DUPLICATE CLAIMS row, and the brief (a request id on every POST) | yes |
| createOrder | `prefer` | we read the full order back from the response | yes, `return=representation` |
| createOrder | `paymentSource.paypal.experienceContext` (`brandName`, `shippingPreference: NO_SHIPPING`, `userAction: PAY_NOW`, `returnUrl`, `cancelUrl`) | local pickup means no shipping address; the seed approves through the redirect flow, which needs return and cancel URLs | yes |
| createOrder | `purchaseUnits[0].customId`, `referenceId`, `description`, `items` | the deal id is how webhooks and re-reads find the deal; items show the buyer what they are approving | yes |
| createOrder | `paypalPartnerAttributionId`, `paypalClientMetadataId`, `paypalAuthAssertion`, `payer`, `applicationContext`, `processingInstruction` | nothing | no |
| authorizeOrder | `paypalRequestId`, `prefer` | as above | yes |
| authorizeOrder | `body`, `paypalClientMetadataId`, `paypalAuthAssertion` | nothing | no |
| captureAuthorizedPayment | `body.finalCapture: true`, `body.invoiceId`, `body.noteToPayer` | one capture per deal; the invoice id is the deal id so the capture is findable; the note tells the buyer why they were charged | yes |
| captureAuthorizedPayment | `body.amount`, `body.softDescriptor`, `body.paymentInstruction` | nothing (full amount is the default) | no |
| voidPayment | `paypalRequestId` | DUPLICATE CLAIMS row | yes |
| reauthorizePayment | `body.amount` | nothing (same amount) | no |
| payouts POST | `sender_batch_header.sender_batch_id`, `items[0].sender_item_id` | DUPLICATE CLAIMS row | yes |
| payouts POST | `email_subject`, `email_message`, `note`, `recipient_wallet: PAYPAL` | the seller should see why money arrived | yes |

## WHEN THE API SAYS NO

One mapping for every money route (`lib/paypal/errors.ts` `toClientError`):

| status from PayPal | our route answers | the caller reads | test |
| --- | --- | --- | --- |
| 4xx other than 401, 403, 429 | the same 4xx | PayPal's `name`, `message`, first `details[].issue` and the `debug_id` | `tests/money-rules.test.ts` (when PayPal says no) |
| 401, 403 | 502 | "The marketplace's PayPal credentials were refused." | `tests/money-rules.test.ts` (when PayPal says no) |
| 429 | 503 | "PayPal is rate limiting us, try again shortly." | `tests/money-rules.test.ts` (when PayPal says no) |
| 5xx | 502 | "PayPal had a problem. Nothing was charged twice." | `tests/money-rules.test.ts` (when PayPal says no) |
| no response, on a write | per UNKNOWN OUTCOMES | "Outcome unknown, checking with PayPal" then the settled state | `tests/paypal-unknown.test.ts` |
| no response, on a read | 502 | fixed message | - |

`INSTRUMENT_DECLINED` (422) on authorize is passed through so the buyer can pick another funding source.

## Configuration decisions

- One long-lived `Client` per server instance (`lib/paypal/core.ts`), `Environment.Sandbox`, 20 s timeout.
- One OAuth token helper (`getAccessToken`) caches the token until shortly before `expires_in`. The SDK uses it through
  `clientCredentialsAuthCredentials.oAuthTokenProvider`, and the REST helper uses it directly, so there is one token for
  both.
- Retries: the SDK default retry policy for GET stays on. Writes are not retried blindly; an unknown outcome is settled
  by the re-read in the table above.
- Logging: SDK logging stays off (order bodies carry the buyer's email on responses). Our own call log records only
  method, path, status, `PayPal-Debug-Id`, feature and duration.
- No pagination or streaming is needed by any operation in scope.

## Assumptions and blockers

- The Agent Toolkit's `create_order` hardcodes `intent: "CAPTURE"` (1.11.0), so it cannot place a hold. The hold order
  is our own tool on the server SDK. The toolkit is used for `get_order` and `create_refund`. Minor, no user input
  needed.
- Payouts are sent from the marketplace's sandbox balance to the seller's email. Verified working in the sandbox.
- No blockers.

## REQUIRED READING

- `typescript-error-handling`: MUST load before writing the error boundary (`lib/paypal/errors.ts`).
- `typescript-client-initialization`: MUST load before `new Client(...)` (`lib/paypal/core.ts`).
- `typescript-testing`: MUST load before the first test that fakes the transport.
- `typescript-configuration-resilience`: MUST load before choosing timeouts and retry behavior.
