# Capy vs Capy (working name)

**PayPal AI Hackathon** (paypalaihackathon.devpost.com). Built in Claude Code web from this repo. This file is the
whole brief: read all of it, including the shared rules at the end, before you start.

**Prize targets:** Most Creative, Best Use of Agentic Commerce, Best Demo Delivery, the grand prizes. Also eligible for
APIMatic. PayPal's own inspiration list includes "two agents negotiating and settling a payment between themselves";
this is that idea, made delightful.

## The idea

Local secondhand deals where the buyer's agent and the seller's agent haggle for you. PayPal holds the buyer's money
until the handoff.

Buying used things locally is slow (endless "is this still available?" and haggling), risky (no-shows, fake payment
screenshots, "send a deposit first" scams) and awkward. With Capy vs Capy, each side tells its own capybara its limits
privately. The two agents negotiate in the open, the humans tap Accept, and PayPal holds the money until the seller
scans the buyer's QR code at pickup.

**Who it's for:** people buying and selling used furniture, bikes, baby gear and electronics locally.

## The flow

1. **List.**
   - The seller snaps photos. Vision AI writes the listing: title, condition notes, and measurements flagged as
     estimates.
   - It suggests a price range from condition and typical used prices, labeled as an estimate.
   - The seller privately sets a floor and preferences: pickup windows, bundles OK, no cash.
2. **Want.** The buyer describes what they want and a private ceiling: "a kid's bike for a 6-year-old, under $90, this
   weekend, near the Mission."
3. **Haggle.** Barley (the buyer's agent) and Biscuit (the seller's agent) negotiate in a visible thread.
   - Offers are structured (price, pickup time, extras) and checked in code.
   - Each agent can only offer within its owner's **mandate**: signed JSON with the ceiling or floor, the item scope and
     an expiry, signed with `MANDATE_SIGNING_SECRET`. This follows the intent-mandate idea from agent payment protocols
     such as AP2; say so without claiming compliance.
   - Each agent sees only its own owner's limits, never reveals them, and must stick to the listing's facts. Claims
     about condition are checked against the listing.
   - At most 8 rounds, and either side can walk away. The humans can watch, pause or jump in.
   - Animate it well. This is the money shot of the video.
4. **Deal.**
   - Both owners get a summary and tap Accept.
   - The buyer pays with PayPal: Orders `intent: AUTHORIZE`. The money is held, not sent. The seller sees "Payment held
     by PayPal: $82".
5. **Handoff.**
   - At pickup, the buyer shows a QR code (signed with `QR_SIGNING_SECRET`, single use, expiring). The seller scans it
     in the app with the camera; offer a paste or "simulate scan" fallback for desktop and the video.
   - The scan captures the authorization, and the marketplace pays the seller at once through **Payouts**, minus a small
     fee shown up front.
   - If the buyer doesn't show by the end of the window, the authorization is voided and the money goes back.
6. **Safety.** The agents refuse off-platform payment requests and flag scam patterns in messages from humans ("pay a
   deposit by gift card", "I'll send a courier, just pay the shipping"). Show one in the demo.

**Who is the merchant:** the marketplace's sandbox business account holds and settles the money. The seller is a
sandbox personal account that receives the payout.

## PayPal integration
- **Orders v2:** `AUTHORIZE` intent.
- **Authorizations:** capture, void, reauthorize if needed.
- **Payouts:** to the seller.
- **Refunds:** optional, if the buyer reports a problem within 24 hours.
- **Webhooks:** `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`,
  `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`.
- **JS SDK v6** for the buyer's approval.
- **Agent Toolkit tools** for orders where they fit, wrapped so an agent can't create an order outside its mandate.

## AI
- The listing writer (vision) and the price suggestion.
- Two negotiating agents with private context and a deterministic referee in code. The referee validates every offer
  against the mandate and the listing, enforces the round limits, and decides when a deal is reached.
- A scam detector (rules plus the LLM), and a deal summary.
- Unit tests for the referee: an agent can't bid over its ceiling, can't reveal a limit, and can't invent item facts.

## Mascots
Two capybaras, original SVG:
- **Barley**, the buyer's agent: round glasses, practical, a little frugal.
- **Biscuit**, the seller's agent: a scarf, warm and chatty.

They negotiate sitting in a hot spring. When the deal closes, they bump noses. Keep the money parts crisp and clear.

## Demo data
- Fictional people: Maya buys, Theo sells.
- Items: a kid's bike, a mid-century side table, a stroller. Use licensed stock photos (credited) or clearly synthetic
  images.

## The aha
1. About 20 seconds of two capybaras haggling (sped up), reaching a fair deal at $82 without the humans typing a word.
2. PayPal holds the money.
3. The QR scan at pickup moves it to the seller in seconds.

## Video outline
1. Cold open on haggling fatigue and no-shows.
2. The listing writes itself.
3. The buyer sets a ceiling.
4. Capy vs Capy.
5. Accept, and PayPal holds the money (approval shown).
6. The QR scan, the capture, and the payout to the seller (calls named on screen).
7. The scam message refused.
8. One limitation.
9. End card.

## Keys for this build
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (sandbox app `hack-pp-capyhaggle`, with Payouts enabled),
  `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (same value as the client id), `PAYPAL_ENVIRONMENT=sandbox`.
- `PAYPAL_SANDBOX_BUYER_EMAIL`, `PAYPAL_SANDBOX_BUYER_PASSWORD`: Maya, the buyer.
- `PAYPAL_SANDBOX_SELLER_EMAIL`: Theo's sandbox personal account, which receives payouts.
- `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_FALLBACK_MODEL`.
- `ELEVENLABS_API_KEY`.
- Generate yourself: `MANDATE_SIGNING_SECRET`, `QR_SIGNING_SECRET`, `DEMO_ADMIN_TOKEN`.

## Cut first if short on time
Camera scanning (keep the real QR plus a simulated scan), refunds, the second and third items.

---

## Shared rules (all six PayPal builds)

Six different builds from the same team share these rules. Stay inside this build's idea.

### Deadline and split
- Devpost submissions close **Thu Nov 12 2026, 12:00 PM PT**. Push the finished app, README, screenshots, Devpost
  drafts and the video to `main` by **Wed Nov 11, 9:00 PM PT**. If something isn't done by then, push what works and keep
  going; the local session takes the last push before 6:00 AM PT Thu.
- Suggested order: **Mon Nov 9** the PayPal flow working end to end in the sandbox, the seed script and the AI core;
  **Tue Nov 10** the sponsor tool, the full UI and Replay mode; **Wed Nov 11** polish, tests, screenshots, video, docs.
- You (cloud) build and test everything, record the video and write the docs. The local session deploys to Vercel,
  registers the webhook, uploads the video to YouTube, makes the repo public and submits on Devpost. Don't make the repo
  public, don't deploy and don't submit.
- If you are blocked on something only the user can do (a PayPal dashboard setting, a manual sandbox step), write it at
  the top of `docs/needs-user.md`, mention it in your next message, and carry on with everything else.

### What the hackathon requires
- Meaningful use of at least one PayPal developer technology in the **sandbox**, and meaningful use of AI. A working
  prototype: judges must be able to run or click it (we provide a hosted URL; the README also has full run
  instructions). A design mockup or static prototype doesn't count.
- Public repo with all source, assets and run instructions, and an open-source license GitHub detects. `LICENSE`
  (AGPL-3.0) is already in the repo; add `TRADEMARKS.md` reserving the product name and mascot.
- A demo video under 3 minutes that shows the project working end to end, with no third-party trademarks and no
  copyrighted music. PayPal's own UI is fine (PayPal is the sponsor). Keep other brands' logos out of frame.
- Stage one is pass/fail: the project fits the theme and really uses PayPal. Stage two scores, equally weighted:
  **Technological Implementation** (thorough, skillful, non-trivial use of PayPal and AI), **Design** (a complete,
  coherent product, not a proof of concept), **Potential Impact** (a credible, specific problem for a real audience,
  shown being solved), **Innovation**, and **Presentation** (the video shows it working end to end and says who it's for
  and why it matters).
- A project can win one main prize plus one sponsor prize. Every build also uses APIMatic (below), so it stays eligible
  for that sponsor prize on top of its own.
- Sandbox only. Never use live PayPal credentials or real money, and don't sign up for paid services.

### PayPal, done the way PayPal's judges will look for it
- Before writing PayPal code, read the PayPal AI Toolkit: `git clone https://github.com/paypal/AI-Toolkit
  /tmp/paypal-ai-toolkit` and read its skills, especially `paypal-best-practices` and the SDK v5 and v6 references.
- Install APIMatic's PayPal Context Plugin skills for TypeScript into this repo and use them while building the PayPal
  integration: `npx skills add https://github.com/context-plugins/plugin-marketplace/tree/main/plugins/paypal/skills/typescript`
  (if that fails: `npx context-plugins install paypal`, or clone `context-plugins/plugin-marketplace` and read
  `plugins/paypal`). The APIMatic prize is for builds that used the Context Plugin, so say in the README how you used it.
- Server calls: `@paypal/paypal-server-sdk` (2.5.x, generated by APIMatic) wherever it covers the API; plain REST with
  the same OAuth token helper for anything it doesn't (Disputes, Payouts, Invoicing, Subscriptions, Webhooks as needed).
  Base URL `https://api-m.sandbox.paypal.com`. Send a `PayPal-Request-Id` on every POST.
- The agent's PayPal tools come from `@paypal/agent-toolkit` (1.11.x) where it has them (orders, refunds, invoices,
  disputes, subscriptions, shipment tracking, transactions). Wrap any tool that moves money so it enforces this app's
  rules in code before PayPal is called. Write your own tools for the rest.
- Browser checkout: PayPal **JS SDK v6** where it supports the flow. If a flow isn't in v6 yet (check the toolkit's
  references), use v5 for that flow and say why in the README.
- Webhooks: `/api/paypal/webhook` with signature verification (`POST /v1/notifications/verify-webhook-signature`) and
  idempotent handlers, plus `pnpm paypal:webhook <public-url>`, which registers the URL and this build's event types
  through the API and prints the webhook id (the local session runs it after deploying). Never depend on delivery
  alone: also poll PayPal whenever a screen needs fresh state, so everything works without a public URL.
- Seed data: `pnpm seed` creates this build's realistic sandbox data through the API (idempotent, safe to re-run) and
  prints what it made. Where a step needs the buyer to approve in PayPal's window, automate it with Playwright using
  the sandbox buyer login. Sandbox facts: transaction search lags up to about 3 hours; authorizations are honored for 3
  days and valid for 29 (reauthorize when capturing after day 3); a payout to an email with no PayPal account stays
  UNCLAIMED.
- Make the PayPal work visible: an **Under the hood** drawer listing every PayPal call the current session made (method,
  path, status, `PayPal-Debug-Id`, which feature triggered it), and a small "AI" tag on every AI-produced output naming
  the model.

### AI
- Free W&B Inference, OpenAI-compatible: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` (`Qwen/Qwen3.8-27B`; tool
  calling works), `OPENAI_VISION_MODEL` (`google/gemma-4-31B-it`), and `OPENAI_FALLBACK_MODEL`
  (`zai-org/GLM-5.3-Flash`; it always returns `reasoning`, so budget `max_tokens` and handle `content: null`). Both Chat
  Completions and the Responses API answer. Server-side only, `maxRetries: 4`, 60 s timeout (about 1 call in 20 fails
  without retries); fall back to the fallback model after repeated failures.
- Use the Vercel AI SDK (or the OpenAI SDK) with tool calling. Money decisions stay deterministic: the model proposes,
  code checks the rules, and a person approves wherever this brief says so. Log each agent step so the UI can show its
  reasoning trail.
- Rate-limit AI routes per IP on the hosted demo.

### Hosting and state (the local session deploys to Vercel)
- Next.js (App Router) + TypeScript + **pnpm**, deployable to Vercel as is: no long-running processes, webhooks and jobs
  are API routes, and browser-only components (Bryntum, cameras) load with `dynamic(..., { ssr: false })`.
- Persist app state through one small `lib/store.ts` (JSON documents by key): files under `.data/` in development,
  Vercel Blob (`@vercel/blob`) when `BLOB_READ_WRITE_TOKEN` is set (the local session creates the store when deploying).
  PayPal stays the source of truth for money: store PayPal ids and re-read status from PayPal.
- A protected `POST /api/admin/reset` (header `x-admin-token`, checked against `DEMO_ADMIN_TOKEN`) that restores the
  seeded demo state, so judges land on a clean demo.
- A clearly labeled **Replay** mode that runs the main flow from recorded real sandbox and AI responses (fixtures in the
  repo), for when the sandbox or the model is down. Live is the default.

### Keys (environment variables, never in the repo)
- The keys for this build are listed in its section above. Everything is server-side except `NEXT_PUBLIC_*`. Generate
  any secrets the brief says to generate yourself, and keep them only in `.env.local`.
- `.env*` is git-ignored; `.env.example` lists the names only, with a comment on where each comes from.
- Before the last push, check the whole history for every key value in your environment:
  `for v in $(env | grep -E '^(PAYPAL_CLIENT_SECRET|PAYPAL_SANDBOX_BUYER_PASSWORD|OPENAI_API_KEY|ELEVENLABS_API_KEY|CHANNEL3_API_KEY|AG_STUDIO_LICENSE)=' | cut -d= -f2-); do git grep -nF "$v" $(git rev-list --all) && echo LEAK; done`
  must print nothing.

### Git
- Before the first commit: `git config user.name "chinesepowered"` and
  `git config user.email "22500229+chinesepowered@users.noreply.github.com"`. No `Co-Authored-By` or other AI
  attribution lines in commit messages.
- Commit to `main` and push to `origin main` at least every couple of hours. If the session makes you work on a
  `claude/*` branch, merge it into `main` at the end and delete the branch.

### Writing and quality
- **No em dashes** anywhere: UI, README, docs, commit messages, narration.
- Statistics only with a fetched, cited source (list the sources in the README). All people, businesses and products are
  fictional; stock photos only with a license that allows it, credited in `docs/CREDITS.md`.
- Mobile-first and responsive. Accessible to WCAG 2.2 AA (contrast, focus states, labels, keyboard use, live regions
  for async updates); say what you did in the README.
- `pnpm build`, `pnpm lint` and `pnpm test` (Vitest, covering the deterministic money rules) must pass.
- Keep `docs/build-log.md`: dated notes of PayPal and sponsor-tool surprises, walls and workarounds. It feeds the
  Devpost "challenges" section.

### Mascot
- An original capybara character, drawn as SVG by you. No third-party art, and nothing resembling Kapibara-san or any
  other existing character. It has a job in the product (persona, voice, empty, loading and success states) and its
  own name and look, described in this build's section. On business screens, keep it a light touch.

### Deliverables
1. The working app, live against the sandbox, plus Replay mode.
2. `README.md` for judges: a one-line pitch; the problem and who it's for; the aha; a 60-second tour with screenshots;
   how it works (a Mermaid architecture diagram); **every PayPal API and feature used, endpoint by endpoint, and where
   in the code**; the AI: which models, for what, and the guardrails; the sponsor tools (APIMatic plus this build's
   sponsor tool, if any) and how they were used; how to run it locally (sandbox app setup, env vars, `pnpm seed`);
   sandbox test logins for judges (sandbox only, no real money); limitations and what's next; credits; license.
3. `docs/screenshots/*.png`: 6 or more real app states at 1440x960.
4. `docs/devpost.md`: project name; a tagline under 200 characters; inspiration; what it does; how we built it;
   challenges; accomplishments; what we learned; what's next; a built-with list; "Tools: which AI models and services
   were used and how"; PayPal products used; sponsor tools used.
5. **The video:** `demo/video.mp4` (1920x1080 H.264, under 3:00, aim for 2:20 to 2:45, under 50 MB) plus
   `demo/thumb.png` (1200x800) and `demo/narration.txt`.
   - Record real runs of the app with Playwright (headless Chromium, `recordVideo`). Render title and caption cards
     from HTML. Compose with ffmpeg.
   - Narrate with ElevenLabs (`ELEVENLABS_API_KEY`, model `eleven_multilingual_v2` or newer, narrator voice
     `nPczCjzI2devNBz1zQrb`). The mascot may speak short lines in a different premade voice.
   - Structure: a 10-second cold open on the problem; who it's for; the flow end to end with money visibly moving in
     PayPal; the AI doing work a person would otherwise do; PayPal APIs named on screen as they're used; the sponsor
     tool on screen; one honest limitation; an end card with the name.
   - No music, unless you generate it with ElevenLabs on this key; keep any music quiet under the voice.
   - Budget: **under 15,000 ElevenLabs characters for this build in total**. Pre-render the mascot's in-product voice
     lines into `public/audio/`, so the hosted demo never calls ElevenLabs.
   - If you can't produce the video, write `docs/demo-script.md` instead (scenes, exact clicks, narration per scene)
     and put stable `data-testid` attributes on everything it touches.
6. Your last message: what works and what doesn't; how to deploy (env vars, Blob, `pnpm seed`, `pnpm paypal:webhook`);
   which sandbox accounts the seed uses; ElevenLabs characters used; where the video is.
