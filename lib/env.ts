/**
 * Server-side environment access. Nothing here is ever sent to the browser except
 * NEXT_PUBLIC_PAYPAL_CLIENT_ID, which PayPal designs to be public.
 */
function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function required(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  get paypalEnvironment() {
    return read("PAYPAL_ENVIRONMENT") ?? "sandbox";
  },
  get paypalClientId() {
    return required("PAYPAL_CLIENT_ID");
  },
  get paypalClientSecret() {
    return required("PAYPAL_CLIENT_SECRET");
  },
  get paypalWebhookId() {
    return read("PAYPAL_WEBHOOK_ID");
  },
  get sellerEmail() {
    return required("PAYPAL_SANDBOX_SELLER_EMAIL");
  },
  get openaiBaseUrl() {
    return required("OPENAI_BASE_URL");
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY");
  },
  get model() {
    return read("OPENAI_MODEL") ?? "Qwen/Qwen3.8-27B";
  },
  get visionModel() {
    return read("OPENAI_VISION_MODEL") ?? "google/gemma-4-31B-it";
  },
  get fallbackModel() {
    return read("OPENAI_FALLBACK_MODEL") ?? "zai-org/GLM-5.3-Flash";
  },
  get mandateSecret() {
    return required("MANDATE_SIGNING_SECRET");
  },
  get qrSecret() {
    return required("QR_SIGNING_SECRET");
  },
  get adminToken() {
    return read("DEMO_ADMIN_TOKEN");
  },
  get blobToken() {
    return read("BLOB_READ_WRITE_TOKEN");
  },
  /** Public origin used for PayPal return and cancel URLs. */
  get appUrl() {
    const prod = read("VERCEL_PROJECT_PRODUCTION_URL");
    const preview = read("VERCEL_URL");
    return (
      read("APP_URL") ?? (prod ? `https://${prod}` : undefined) ?? (preview ? `https://${preview}` : undefined) ?? "http://localhost:3000"
    );
  },
  has(name: string) {
    return read(name) !== undefined;
  },
};

export const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";

/** This build is sandbox only. Refuse to run against anything else. */
export function assertSandbox(): void {
  if (env.paypalEnvironment !== "sandbox") {
    throw new Error("Capy vs Capy runs against the PayPal sandbox only. Set PAYPAL_ENVIRONMENT=sandbox.");
  }
}
