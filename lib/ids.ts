import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function shortId(prefix: string, length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}
