# Hosted demo: how it was deployed

The hosted demo is https://hack-pp-capyhaggle.vercel.app. Everything runs against the PayPal sandbox.

## Steps

1. A Vercel project from this repository (Next.js, pnpm). No build settings changed.
2. A private Vercel Blob store connected to the project, which sets `BLOB_READ_WRITE_TOKEN`. `BLOB_ACCESS=private`.
3. The variables from `.env.example` set on Vercel, except the sandbox buyer login and `ELEVENLABS_API_KEY`. The
   running app uses neither. `APP_URL` is left unset: on Vercel the app derives it from the production domain.
4. `pnpm seed`, run once from a machine with the same variables plus the production Blob token. It makes one completed
   deal and one no-show deal in the sandbox (Playwright approves in PayPal's window) and saves a snapshot that
   `POST /api/admin/reset` restores. Safe to re-run.
5. The webhook registered for `https://hack-pp-capyhaggle.vercel.app/api/paypal/webhook`
   (`pnpm paypal:webhook <url>`), then `PAYPAL_WEBHOOK_ID` set on Vercel and a redeploy.

## Checked on the hosted demo

- One full live deal in a real browser, about a minute and a half end to end: the haggle, both owners accept, the
  buyer approves in PayPal's JS SDK v6 window on the real domain, the hold, Biscuit's `get_order` check through the
  Agent Toolkit, the QR handoff, the capture, and a payout that reached SUCCESS.
- Real PayPal webhook deliveries (`PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`), with their
  signatures verified.
- State in Vercel Blob, and `POST /api/admin/reset` restoring the seeded state.

## Not exercised live

Camera QR scanning (only paste and the simulated scan), reauthorization after day 3, and the duplicate payout batch
branch.

## Sandbox buyer login

The sandbox buyer's email and password are not in this repository. Judges get them in the Devpost submission's
testing instructions. Replay mode and the two seeded deals need no login.
