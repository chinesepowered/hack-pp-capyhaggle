/**
 * The mascots' in-product voice lines. They are pre-rendered into public/audio by
 * scripts/voice-lines.ts, so the hosted demo never calls a speech service.
 */
export const VOICE_LINES = {
  "barley-start": { agent: "barley", text: "Let me see what I can do." },
  "barley-deal": { agent: "barley", text: "Deal. Nose bump." },
  "barley-hold": { agent: "barley", text: "The hold is set up. Your money stays put until pickup." },
  "barley-scam": { agent: "barley", text: "No deposits. No gift cards. Nice try." },
  "barley-walk": { agent: "barley", text: "Not this time. Thanks for the soak." },
  "biscuit-start": { agent: "biscuit", text: "Oh, hello there! Let's talk." },
  "biscuit-deal": { agent: "biscuit", text: "Lovely doing business with you!" },
  "biscuit-held": { agent: "biscuit", text: "I checked with PayPal myself. The money is held." },
  "biscuit-paid": { agent: "biscuit", text: "Scanned and paid. Enjoy!" },
  "biscuit-scam": { agent: "biscuit", text: "Oh, I can't do that one. PayPal hold only." },
} as const;

export type VoiceLine = keyof typeof VOICE_LINES;

export const voiceLineUrl = (line: VoiceLine) => `/audio/${line}.mp3`;
