# Devpost submission draft

## Project name

Capy vs Capy

## Tagline

Two capybara agents haggle your local secondhand deal for you. PayPal holds the buyer's money until the seller scans a QR code at pickup.

(137 characters)

## Inspiration

Buying something used from a neighbor should be the easy kind of shopping. Instead it is "is this still available?",
a week of haggling over five dollars, a buyer who never shows up, a payment screenshot you cannot verify, and every so
often someone asking for a deposit by gift card.

PayPal's own inspiration list for this hackathon includes "two agents negotiating and settling a payment between
themselves". We wanted to make exactly that, for a deal people actually dread, and make it delightful: two capybaras
in a hot spring, each one quietly holding its owner's limit, haggling in the open while the humans watch.

## What it does

Capy vs Capy is a local secondhand marketplace where the awkward parts are done by agents and the risky part is done
by PayPal.

- **List.** The seller picks photos. A vision model writes the listing: title, condition notes, visible wear, and
  measurements flagged as estimates. A second model suggests a price range, labeled as an estimate. The seller sets a
  private floor.
- **Want.** The buyer describes what they want in plain words and sets a private ceiling.
- **Haggle.** Barley (the buyer's agent) and Biscuit (the seller's agent) negotiate in a visible thread with
  structured offers: price, pickup window, extras. Each agent acts only inside its owner's signed mandate and sees
  only its own owner's limit. A referee in code checks every move: no bidding over the ceiling or under the floor, no
  revealing a limit, no claims about the item that the listing does not back, no payment outside the app, at most 8
  rounds. The humans can watch, pause, jump in or walk away.
- **Deal.** Both owners read a summary and tap Accept. The buyer approves with PayPal and the money is held, not
  sent. The seller's agent checks the order with PayPal itself, so nobody has to trust a screenshot.
- **Handoff.** At pickup the buyer shows a signed, single-use QR code. The seller scans it. The scan captures the
  hold and the seller is paid out at once, minus a small fee shown up front.
- **No-show.** If the buyer does not show by the end of the pickup window, the authorization is voided and the money
  goes back.
- **Safety.** Messages typed by humans are checked for scam patterns ("pay a deposit by gift card", "I'll send a
  courier, just pay the shipping"). The other side's agent refuses and the thread shows why.

An "Under the hood" drawer lists every PayPal call a deal made, with its debug id, and every AI output carries a tag
naming the model. A Replay mode runs the whole flow from a recorded real run for when the sandbox or the model is
down.

## How we built it

- **Next.js (App Router) and TypeScript**, deployable to Vercel as is. No long-running processes: the haggle is driven
  one agent turn per request, and jobs and webhooks are API routes. State is small JSON documents in one store module
  (files locally, Vercel Blob in production). PayPal stays the source of truth for money.
- **PayPal.** Orders v2 with intent AUTHORIZE, then authorize, capture, void and reauthorize on the Payments API, all
  through `@paypal/paypal-server-sdk`. Payouts and Webhooks over REST with the same token helper. The buyer's approval
  uses JS SDK v6. The agents' PayPal tools come from the Agent Toolkit where it fits (`get_order`, `create_refund`),
  each wrapped in a guard that enforces the mandate before PayPal is called.
- **Agents.** Two LLM agents with tool calling and private context, and a deterministic referee between them. Money
  decisions are code: the model proposes, the referee and the guards check, a person approves.
- **Plan first.** Before writing the PayPal layer we wrote a contract sheet with APIMatic's PayPal Context Plugin:
  which write is claimed where, how an unknown outcome is settled, which optional fields are sent and why, and what
  our API answers when PayPal says no. The code follows that sheet.
- **Tests.** 76 unit tests on the deterministic rules, including one that runs a recorded real sandbox run through the
  real referee, guards and state machine with no network.
- **Mascots.** Barley and Biscuit are original SVG, animated with CSS, with a few pre-recorded voice lines.

## Challenges we ran into

- **The Agent Toolkit's order tool only does immediate capture.** Our product is a hold, so the order tool had to be
  our own, and we used the toolkit for reading the order and for refunds. The toolkit also returns no response
  headers, so to show its `PayPal-Debug-Id` in the drawer we observe its HTTP calls through Node's diagnostics
  channel.
- **A write with no answer is not a failure.** If the connection drops on a capture, the money may have moved.
  Every write has a claim, a deal-derived request id, and a re-read that settles what really happened.
- **The model thought itself into silence.** Our chat model is a reasoning model and sometimes spent its whole token
  budget thinking, returning nothing. Capping its reasoning effort fixed both reliability and speed.
- **Keeping agents honest.** An agent that says the bike is "like new" to win a negotiation is a liability. The
  referee checks claims and measurements against the listing. During recording it caught an agent calling the bike
  "worn", which the listing does not say.
- **Automating a human approval.** PayPal rightly requires the buyer to approve in its own window. For seed data and
  the video we drive that window with Playwright and the sandbox buyer login.
- **Landing on a fair price on purpose.** Two free-running agents do not hit the same number twice. We measured where
  haggles end and chose an asking price at which they usually meet at $82.

## Accomplishments that we're proud of

- The whole flow is real in the sandbox: a live haggle, a real approval, a real hold, a real capture, a real payout,
  with every call visible.
- The agents cannot spend outside their mandate, and that is enforced and tested in code, not asked for in a prompt.
- The seller's agent verifying the hold with PayPal is a small thing that removes a very common scam.
- It is fun to watch. Two capybaras bumping noses over $82 is a better loading state than a spinner.

## What we learned

- Agentic commerce gets simple once the roles are strict: models negotiate and choose tools, code holds the rules,
  people approve, and the payment provider holds the money.
- Authorize-then-capture is a very good fit for in-person handoffs. The hold is the trust.
- Writing the contract sheet first made the integration boring in the good way: the hard cases were decided before
  they were coded.

## What's next for Capy vs Capy

- Real marketplaces: seller onboarding and identity checks instead of payouts to an email.
- Accounts, so each side sees only its own view by login and not by a demo switch.
- Claims that cite listing facts exactly, replacing the lexicon check.
- Bundles across several listings from one seller, and counter-offers on pickup time.
- Receiving live webhooks on the deployed URL and showing them arrive.

## Built with

Next.js, React, TypeScript, Tailwind CSS, pnpm, Vercel, Vercel Blob, PayPal Orders API v2, PayPal Payments API v2,
PayPal Payouts API, PayPal Webhooks API, PayPal JS SDK v6, PayPal Server SDK (TypeScript), PayPal Agent Toolkit,
APIMatic PayPal Context Plugin, W&B Inference, OpenAI SDK, Vitest, Playwright, ffmpeg, ElevenLabs

## Tools: which AI models and services were used and how

- **google/gemma-4-31B-it** (vision, through W&B Inference): writes each listing from the seller's photos.
- **Qwen/Qwen3.8-27B** (through W&B Inference, with tool calling): the two negotiating agents, the price estimate,
  understanding the buyer's request, the deal summary, the second opinion in the scam check, and the agents' tool
  calls for the hold, the verification and the refund.
- **zai-org/GLM-5.3-Flash** (through W&B Inference): fallback when the main model fails or returns nothing.
- **ElevenLabs** (eleven_multilingual_v2): the video narration and the mascots' pre-recorded voice lines. The running
  app never calls it.
- **Claude Code**: used as the coding agent to build the project, with PayPal's AI Toolkit references and APIMatic's
  PayPal Context Plugin skills as its PayPal guidance.
- **Playwright**: automates the sandbox buyer's approval for seed data, records the demo video and takes the
  screenshots.

## PayPal products used

- Orders API v2 (intent AUTHORIZE)
- Payments API v2: authorizations (capture, void, reauthorize), captures, refunds
- Payouts API
- Webhooks API (signature verification, registration by script)
- JavaScript SDK v6
- PayPal Server SDK for TypeScript
- PayPal Agent Toolkit
- PayPal sandbox accounts (business merchant, personal buyer, personal seller)

## Sponsor tools used

- **APIMatic**: the PayPal Context Plugin (TypeScript skills) guided the integration plan and contract sheet
  (`paypal-plan.md`), and the APIMatic-generated `@paypal/paypal-server-sdk` makes the Orders and Payments calls.

## Links

- Hosted demo: https://hack-pp-capyhaggle.vercel.app
- Video: https://youtu.be/E1axdRQ-5Zk
- Repository: https://github.com/chinesepowered/hack-pp-capyhaggle
- Testing instructions: Live mode needs the sandbox buyer login for PayPal's approval window. It is in the Devpost
  submission's testing instructions, not in the repository. Replay mode needs no login.
