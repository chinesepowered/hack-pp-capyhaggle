/**
 * The demo video, scene by scene: what the narrator says, which recorded footage plays, and which
 * captions name the PayPal call or the AI doing the work on screen.
 *
 * Footage ranges refer to marks written by scripts/video/record.ts (demo/raw/marks.json).
 * A range end may carry an offset in seconds, for example ["popup", "pay_click", 1.5].
 */
export type Source = "main" | "popup";
export type Point = [mark: string, offset?: number];

export interface Part {
  source: Source;
  from: Point;
  to: Point;
}

export interface Caption {
  text: string;
  /** Where in the scene's footage the caption starts and ends. */
  from: [Source, ...Point];
  to: [Source, ...Point];
}

export interface Scene {
  id: string;
  narration: string;
  card?: { file: string; seconds: number };
  parts?: Part[];
  captions?: Caption[];
  /** Pre-rendered mascot lines (public/audio). They play in order after the narrator has finished, never over her. */
  voices?: { file: string }[];
}

export const SCENES: Scene[] = [
  {
    id: "01-cold-open",
    narration:
      "Buying something used nearby should be easy. Instead it's: is this still available? A week of haggling. A no-show. And someone asking for a deposit first.",
    card: { file: "cold-open.html", seconds: 11 },
  },
  {
    id: "02-what",
    narration:
      "Capy vs Capy is for people buying and selling used bikes, furniture and baby gear locally. Each side gets a capybara. They haggle for you, and PayPal holds the money until the handoff.",
    parts: [{ source: "main", from: ["home_start"], to: ["home_end"] }],
  },
  {
    id: "03-list",
    narration:
      "Theo is selling his kid's bike. He picks two photos, and a vision model writes the listing: the rust on the chain, the chipped fender, the wheel size flagged as an estimate, and a price range. Then he sets a private floor that only his capybara, Biscuit, will see.",
    parts: [{ source: "main", from: ["sell_start"], to: ["sell_end"] }],
    captions: [
      { text: "AI  vision model writes the listing  google/gemma-4-31B-it", from: ["main", "sell_writing"], to: ["main", "sell_draft", 2.4] },
      { text: "AI  price range estimate  Qwen/Qwen3.8-27B", from: ["main", "sell_draft", 2.6], to: ["main", "sell_published"] },
    ],
  },
  {
    id: "04-want",
    narration:
      "Maya wants a kid's bike for under ninety dollars. She says it in plain words, and gives her capybara, Barley, a signed mandate: this bike only, never above her ceiling.",
    parts: [{ source: "main", from: ["buy_start"], to: ["buy_send_1"] }],
    captions: [{ text: "Signed mandate  private ceiling, item scope, expiry  HMAC-SHA256", from: ["main", "buy_parsed", 1.5], to: ["main", "buy_send_1"] }],
  },
  {
    id: "05-haggle",
    narration:
      "Now they haggle. Every offer is structured, and a referee in code checks it against the mandate and the listing. An agent can't overbid, can't reveal a limit, and can't invent facts about the bike. Nobody types a word. Deal, at eighty-two dollars.",
    parts: [{ source: "main", from: ["haggle_start"], to: ["haggle_end"] }],
    captions: [{ text: "Live  two agents on Qwen/Qwen3.8-27B  deterministic referee in code", from: ["main", "haggle_start", 1], to: ["main", "haggle_end", -4.5] }],
    voices: [{ file: "barley-deal" }, { file: "biscuit-deal" }],
  },
  {
    id: "06-hold",
    narration:
      "Both tap Accept. Barley calls his one payment tool, and a guard in code only lets the exact agreed amount through. That creates a PayPal order with intent authorize. Maya approves in PayPal's own window, opened by the version six JavaScript SDK, and the money is held, not sent. Biscuit doesn't trust screenshots. She checks the order herself, with PayPal's Agent Toolkit.",
    parts: [
      { source: "main", from: ["accept_start"], to: ["popup_open", 0.6] },
      // The popup footage starts after the sandbox login, so no account email is shown on screen.
      { source: "popup", from: ["logged_in", 0.6], to: ["pay_click", 1.4] },
      { source: "main", from: ["held", -0.4], to: ["hold_end"] },
    ],
    captions: [
      { text: "PayPal Orders v2  POST /v2/checkout/orders  intent: AUTHORIZE  server SDK", from: ["main", "accept_both"], to: ["main", "paypal_button"] },
      { text: "PayPal JS SDK v6  createPayPalOneTimePaymentSession  buyer approves in PayPal's window", from: ["main", "paypal_button"], to: ["popup", "pay_click", 1.4] },
      { text: "POST /v2/checkout/orders/{id}/authorize  the money is held", from: ["main", "held", -0.4], to: ["main", "verified"] },
      { text: "PayPal Agent Toolkit  get_order  behind a guard in code", from: ["main", "verified"], to: ["main", "hold_end"] },
    ],
  },
  {
    id: "07-handoff",
    narration:
      "At pickup, Maya shows a signed, single-use QR code. Theo scans it. That scan captures the authorization, and Payouts sends Theo his money at once, minus a small fee shown up front. Every PayPal call is listed under the hood, with its debug ID.",
    parts: [{ source: "main", from: ["qr_start"], to: ["hood_end"] }],
    captions: [
      { text: "Pickup code  signed, single use, expires in 10 minutes", from: ["main", "qr_shown"], to: ["main", "scan_click"] },
      { text: "POST /v2/payments/authorizations/{id}/capture", from: ["main", "scan_click"], to: ["main", "captured", 1.5] },
      { text: "PayPal Payouts  POST /v1/payments/payouts  seller paid", from: ["main", "captured", 1.5], to: ["main", "hood_open"] },
      { text: "Under the hood  method, path, status, PayPal-Debug-Id, feature", from: ["main", "hood_open"], to: ["main", "hood_end"] },
    ],
    voices: [{ file: "biscuit-paid" }],
  },
  {
    id: "08-safety",
    narration:
      "And if someone asks for a deposit by gift card, the capybaras refuse and flag the scam pattern. If the buyer never shows up, the authorization is voided and the money goes back.",
    parts: [
      { source: "main", from: ["scam_start"], to: ["scam_end"] },
      { source: "main", from: ["void_start"], to: ["void_end"] },
    ],
    captions: [
      { text: "Scam check  rules + LLM  the agent refuses", from: ["main", "scam_start", 1], to: ["main", "scam_end"] },
      { text: "POST /v2/payments/authorizations/{id}/void  hold released", from: ["main", "void_start"], to: ["main", "void_end"] },
    ],
  },
  {
    id: "09-built",
    narration:
      "We built the PayPal layer plan first, with APIMatic's Context Plugin and PayPal's server SDK. One honest limitation: this is a sandbox demo where the marketplace account holds and settles the money. A real launch needs seller onboarding and identity checks.",
    card: { file: "built.html", seconds: 17 },
  },
  {
    id: "10-end",
    narration: "Capy vs Capy. Two capybaras haggle. PayPal holds the money.",
    card: { file: "end.html", seconds: 6 },
  },
];

export const NARRATION_TEXT = SCENES.map((s) => s.narration).join("\n\n");
