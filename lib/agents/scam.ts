/**
 * Safety check for messages typed by humans: rules first, then the model.
 *
 * The rules are deterministic and always run. The model is a second opinion for wording the rules
 * do not know. A message is flagged when either one says so, and the flag records which.
 */
import { aiChat, AiUnavailableError, extractJson } from "../ai";
import { shortId } from "../ids";
import type { AiTag, Role, ScamFlag } from "../types";

export interface ScamRule {
  id: string;
  label: string;
  pattern: RegExp;
  why: string;
}

export const SCAM_RULES: ScamRule[] = [
  {
    id: "gift-card",
    label: "Payment by gift card",
    pattern: /\bgift ?cards?\b|\b(itunes|google play|steam) cards?\b|\bprepaid cards?\b/i,
    why: "Gift cards cannot be traced or reversed. Real sellers and buyers do not ask for them.",
  },
  {
    id: "advance-deposit",
    label: "Deposit or fee before the handoff",
    pattern: /\b(deposit|down ?payment|holding fee|reservation fee|pay (?:half|part) (?:up ?front|first|now)|send (?:the )?money first|pay (?:up ?front|in advance|before pickup)|to hold it)\b/i,
    why: "Money sent before the handoff is the classic advance-fee scam. Here PayPal holds the money until pickup instead.",
  },
  {
    id: "courier",
    label: "Courier or shipping agent",
    pattern: /\b(courier|shipping agent|shipper|mover|my (?:assistant|cousin|agent) will (?:pick|collect)|pick-?up agent|pay (?:for )?(?:the )?(?:shipping|delivery|insurance|courier)|shipping (?:fee|cost|label))\b/i,
    why: "A stranger sending a courier and asking you to cover shipping or insurance is a well known fake-buyer pattern.",
  },
  {
    id: "off-platform",
    label: "Payment outside the PayPal hold",
    pattern: /\b(venmo|zelle|cash ?app|wire(?: transfer)?|western union|moneygram|bank transfer|crypto|bitcoin|usdt|money order|cashier'?s che(?:ck|que)|friends (?:and|&) family|pay (?:me )?directly|outside (?:of )?(?:paypal|the app)|off the app|skip (?:the )?(?:app|paypal))\b/i,
    why: "Paying outside the app removes the hold that protects both sides.",
  },
  {
    id: "overpayment",
    label: "Overpayment and refund the difference",
    pattern: /\b(overpa(?:y|id|yment)|send (?:you )?(?:extra|more than)|refund (?:me )?the (?:difference|rest|extra)|send back the (?:difference|rest|extra))\b/i,
    why: "Overpaying and asking for the difference back is a fake-payment scam.",
  },
  {
    id: "code-or-link",
    label: "Verification code or outside link",
    pattern: /\b(verification code|security code|one[- ]time code|otp|6[- ]digit code|click (?:this|the) link|confirm your (?:account|identity)|log ?in (?:here|at)|https?:\/\/|bit\.ly|tinyurl)\b/i,
    why: "Codes and outside links are used to take over accounts.",
  },
  {
    id: "contact-off-app",
    label: "Moving the chat elsewhere",
    pattern: /\b(whats ?app|telegram|text me (?:at|on)|email me at|call me (?:at|on)|my number is|\+?\d[\d\s().-]{8,}\d)\b/i,
    why: "Moving the conversation off the app is usually the first step of a scam.",
  },
  {
    id: "screenshot-proof",
    label: "Screenshot as proof of payment",
    pattern: /\b(screenshot|proof of payment|already paid|payment (?:is )?pending on your end|check your email for (?:the )?payment)\b/i,
    why: "A screenshot is not a payment. The seller sees the real PayPal hold in the app.",
  },
];

export interface RuleHit {
  id: string;
  label: string;
  why: string;
}

/** The deterministic half: which rules a message trips. */
export function scamRuleHits(text: string): RuleHit[] {
  return SCAM_RULES.filter((r) => r.pattern.test(text)).map(({ id, label, why }) => ({ id, label, why }));
}

interface ModelOpinion {
  scam: boolean;
  pattern: string;
  reason: string;
  tag: AiTag;
}

async function modelOpinion(text: string, from: Role): Promise<ModelOpinion | undefined> {
  try {
    const res = await aiChat({
      purpose: "scam.check",
      label: "Scam check",
      temperature: 0,
      maxTokens: 500,
      messages: [
        {
          role: "system",
          content: [
            "You are the safety check of a local secondhand marketplace. In this app, the buyer's money is held by PayPal and released when the seller scans the buyer's QR code at pickup. There is never a reason to pay any other way.",
            "Decide if a message typed by a human in a deal thread matches a known scam pattern: advance fees or deposits, gift cards, couriers or shipping agents, overpayment, payment outside the app, fake payment proof, phishing links or codes, or moving the chat off the app.",
            'Ordinary haggling, questions about the item, and scheduling are NOT scams. Answer with JSON only: {"scam": true or false, "pattern": "short name or none", "reason": "one plain sentence"}',
          ].join("\n"),
        },
        { role: "user", content: `Message from the ${from}: """${text.slice(0, 600)}"""` },
      ],
    });
    const json = extractJson(res.content) as { scam?: unknown; pattern?: unknown; reason?: unknown };
    return { scam: json.scam === true, pattern: String(json.pattern ?? "none"), reason: String(json.reason ?? ""), tag: res.tag };
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof SyntaxError || err instanceof Error) return undefined;
    throw err;
  }
}

/** Rules plus the model. Returns a flag when the message looks like a scam, otherwise undefined. */
export async function checkMessage(text: string, from: Role): Promise<ScamFlag | undefined> {
  const hits = scamRuleHits(text);
  const opinion = await modelOpinion(text, from);
  const byRules = hits.length > 0;
  const byModel = opinion?.scam === true;
  if (!byRules && !byModel) return undefined;
  const explanation = byRules ? hits[0].why : opinion!.reason;
  return {
    id: shortId("flag", 6),
    at: new Date().toISOString(),
    from,
    text,
    source: byRules && byModel ? "rules+llm" : byRules ? "rules" : "llm",
    patterns: byRules ? hits.map((h) => h.label) : [opinion!.pattern],
    explanation: byRules && byModel && opinion!.reason ? `${explanation} ${opinion!.reason}` : explanation,
    ai: opinion?.tag,
  };
}

/** What the other side's agent says when a human message is flagged. Deterministic on purpose. */
export function refusalLine(agent: "barley" | "biscuit", flag: ScamFlag): string {
  const pattern = flag.patterns[0]?.toLowerCase() ?? "that request";
  return agent === "barley"
    ? `I have to say no to that. It matches a known scam pattern (${pattern}). We only pay through the PayPal hold in this app, and the money is released when the QR code is scanned at pickup.`
    : `Oh, I can't do that one. It matches a known scam pattern (${pattern}). The only payment I accept is the PayPal hold in this app, released by the QR scan at pickup.`;
}
