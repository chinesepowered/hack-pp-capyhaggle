/**
 * One error boundary for every PayPal call, and one mapping from PayPal failures to what our own
 * routes answer (the "WHEN THE API SAYS NO" table in paypal-plan.md).
 */

export interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string; field?: string }[];
  // Payouts and OAuth use slightly different shapes.
  error?: string;
  error_description?: string;
  information_link?: string;
  links?: { href: string; rel: string; method?: string }[];
}

/** PayPal answered with an error status. */
export class PayPalApiError extends Error {
  readonly kind = "api" as const;
  constructor(
    public status: number,
    public body: PayPalErrorBody,
    public debugId: string | undefined,
    public operation: string,
  ) {
    super(`PayPal ${operation} failed with ${status} ${body.name ?? body.error ?? ""}`.trim());
    this.name = "PayPalApiError";
  }
  get issue(): string | undefined {
    return this.body.details?.[0]?.issue;
  }
  get reason(): string {
    const d = this.body.details?.[0];
    return [this.body.name ?? this.body.error, d?.issue, d?.description ?? this.body.message ?? this.body.error_description]
      .filter(Boolean)
      .join(": ");
  }
}

/**
 * A write left our server but no answer came back (connection dropped, timeout). The outcome is
 * unknown, not failed: PayPal may have acted. Callers settle it with a re-read.
 */
export class PayPalUnknownOutcomeError extends Error {
  readonly kind = "unknown" as const;
  constructor(
    public operation: string,
    public cause?: unknown,
  ) {
    super(`PayPal ${operation}: no answer, outcome unknown`);
    this.name = "PayPalUnknownOutcomeError";
  }
}

/** A read got no answer. Nothing changed at PayPal. */
export class PayPalUnreachableError extends Error {
  readonly kind = "unreachable" as const;
  constructor(
    public operation: string,
    public cause?: unknown,
  ) {
    super(`PayPal ${operation}: no answer`);
    this.name = "PayPalUnreachableError";
  }
}

/** Our own rules refused the action before PayPal was called. */
export class RuleError extends Error {
  readonly kind = "rule" as const;
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
    this.name = "RuleError";
  }
}

export interface ClientError {
  status: number;
  code: string;
  message: string;
  debugId?: string;
}

/** The single ladder that turns any failure into what a caller of our API sees. */
export function toClientError(err: unknown): ClientError {
  if (err instanceof RuleError) return { status: err.status, code: err.code, message: err.message };

  if (err instanceof PayPalApiError) {
    if (err.status === 401 || err.status === 403) {
      return { status: 502, code: "PAYPAL_CREDENTIALS", message: "The marketplace's PayPal credentials were refused.", debugId: err.debugId };
    }
    if (err.status === 429) {
      return { status: 503, code: "PAYPAL_RATE_LIMIT", message: "PayPal is rate limiting us, try again shortly.", debugId: err.debugId };
    }
    if (err.status >= 400 && err.status < 500) {
      // The caller's request was refused: hand back the same status and PayPal's own reason.
      return { status: err.status, code: err.issue ?? err.body.name ?? "PAYPAL_REJECTED", message: err.reason || "PayPal rejected the request.", debugId: err.debugId };
    }
    return { status: 502, code: "PAYPAL_ERROR", message: "PayPal had a problem. Nothing was charged twice.", debugId: err.debugId };
  }

  if (err instanceof PayPalUnknownOutcomeError) {
    return { status: 202, code: "PAYPAL_OUTCOME_UNKNOWN", message: "PayPal did not answer in time. The outcome is unknown, so we are checking with PayPal." };
  }
  if (err instanceof PayPalUnreachableError) {
    return { status: 502, code: "PAYPAL_UNREACHABLE", message: "PayPal could not be reached. Nothing changed." };
  }
  if (err instanceof Error && err.name === "ReplayMissError") {
    return { status: 409, code: "REPLAY_ONLY", message: err.message };
  }
  return { status: 500, code: "UNEXPECTED", message: "Something unexpected went wrong on our side." };
}
