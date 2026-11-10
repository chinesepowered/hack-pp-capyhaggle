# Needs the user (things only the local session can do)

Everything below is outside what the cloud build session could do or verify. Most important first.

## 1. Deploy and seed (required for the hosted demo)

1. Import the repo into Vercel (framework: Next.js, package manager: pnpm). No build settings to change.
2. Create a **Vercel Blob** store and connect it to the project so `BLOB_READ_WRITE_TOKEN` is set.
   The store code defaults to `BLOB_ACCESS=private`. If you created a public store, set `BLOB_ACCESS=public`.
3. Set the environment variables from `.env.example` on Vercel. Required by the running app:
   `PAYPAL_ENVIRONMENT`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`,
   `PAYPAL_SANDBOX_SELLER_EMAIL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_VISION_MODEL`,
   `OPENAI_FALLBACK_MODEL`, `MANDATE_SIGNING_SECRET`, `QR_SIGNING_SECRET`, `DEMO_ADMIN_TOKEN`.
   Not needed on Vercel: the buyer login and `ELEVENLABS_API_KEY`.
   Use the same `MANDATE_SIGNING_SECRET` locally and on Vercel, because the seed signs mandates.
4. Seed the hosted store from your machine, with the same variables plus the Blob token in `.env.local`:

   ```bash
   pnpm install
   ```

   ```bash
   pnpm exec playwright install chromium
   ```

   ```bash
   pnpm seed
   ```

   The seed needs `PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD` locally: it approves two sandbox
   orders in PayPal's window with headless Chromium. It takes about three minutes and prints the PayPal ids it made.

## 2. Register the webhook (untested end to end from the cloud)

```bash
pnpm paypal:webhook https://YOUR-DEPLOYMENT
```

Set the printed `PAYPAL_WEBHOOK_ID` on Vercel and redeploy. The cloud session had no public URL, so signature
verification and delivery were **not** exercised against real PayPal deliveries. The route follows PayPal's documented
verification call and the app does not depend on webhooks (every screen re-reads PayPal), but please make one live
deal after deploying and check that events show up in the "Under the hood" drawer under "Webhook events".

## 3. Vercel Blob path is untested

`lib/store.ts` was written against `@vercel/blob` 2.9 types (private access, `useCache: false` reads, atomic
create-if-absent for claims) but no Blob token existed in the cloud session, so only the file store ran. After
deploying, open `/api/state` and run one deal. If Blob reads or writes fail, the error is logged by the route.

## 4. Devpost

- Paste from `docs/devpost.md`.
- Put the **sandbox buyer login** (the email and password behind `PAYPAL_SANDBOX_BUYER_EMAIL` and
  `PAYPAL_SANDBOX_BUYER_PASSWORD`) in Devpost's testing instructions. The password is deliberately not in this repo.
  Judges need it to approve the PayPal window in Live mode. Without it they can still use Replay mode.
- Upload `demo/video.mp4` to YouTube and use `demo/thumb.png` as the thumbnail.

## 5. Repository housekeeping

- Make the repo public before submitting.
- The cloud session pushed to `main` and to its working branch `claude/busy-babbage-r9tbig`. Delete that branch if it
  is still there (the cloud sandbox blocks some branch operations).
- One early commit (`41bfbbc`) contains a single literal em dash inside a regular expression in `lib/ai.ts` (code that
  strips em dashes from model output). It was replaced in the next commit and the current tree has none, but a
  history rewrite was blocked in the cloud sandbox. Squash it if you want the history to be clean as well.

## 6. APIMatic installer

`npx skills add https://github.com/context-plugins/plugin-marketplace/tree/main/plugins/paypal/skills/typescript`
was blocked by the cloud sandbox (it refuses to run code fetched from an external repository). The nine TypeScript
skills were installed by copying them from a clone of the marketplace at commit `7cbdf85` into `.claude/skills/`,
which is the fallback the brief allows. Nothing to do unless you want to re-run the official installer locally.

## 7. Sandbox balance

Payouts are funded from the marketplace's sandbox business balance. Captures add more than payouts remove, so the
balance should only grow, but if a payout is ever refused with insufficient funds, add test funds to the sandbox
business account in the PayPal developer dashboard.
