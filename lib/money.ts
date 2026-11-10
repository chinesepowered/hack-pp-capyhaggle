/** Money is integer cents everywhere in app code. PayPal gets decimal strings at the edge. */

export const CURRENCY = "USD" as const;

/** Marketplace fee, shown to both sides before they accept: 5% of the price plus 50 cents. */
export const FEE_PERCENT = 5;
export const FEE_FIXED_CENTS = 50;

export function assertCents(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Not a valid cent amount: ${cents}`);
}

export function feeFor(priceCents: number): number {
  assertCents(priceCents);
  return Math.round((priceCents * FEE_PERCENT) / 100) + FEE_FIXED_CENTS;
}

export function sellerNetFor(priceCents: number): number {
  return priceCents - feeFor(priceCents);
}

/** 8200 -> "82.00" (the format PayPal expects). */
export function toPayPalValue(cents: number): string {
  assertCents(cents);
  return (cents / 100).toFixed(2);
}

/** "82.00" -> 8200. Rejects anything that is not a plain amount with at most two decimals. */
export function fromPayPalValue(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`Not a PayPal amount: ${value}`);
  return Math.round(parseFloat(value) * 100);
}

/** 8200 -> "$82", 7740 -> "$77.40". */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** Always two decimals: 8200 -> "$82.00". Used on money screens. */
export function formatUsdExact(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
