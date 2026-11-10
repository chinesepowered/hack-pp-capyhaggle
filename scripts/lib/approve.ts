/**
 * Approves a PayPal sandbox order as the sandbox buyer, in headless Chromium.
 *
 * PayPal requires a real buyer approval before an order can be authorized. For seed data and
 * recordings, Playwright does what a person would do in PayPal's own window: log in with the
 * sandbox buyer account and press the pay button. Sandbox only.
 */
import type { Browser, BrowserContext, Page } from "playwright";

export interface ApprovalOptions {
  approveUrl: string;
  buyerEmail: string;
  buyerPassword: string;
  /** Resolved when the browser lands on a URL that starts with this (the order's return_url). */
  returnUrlPrefix: string;
  /** Reuse a logged-in context between approvals. */
  context?: BrowserContext;
  onStep?: (step: string) => void;
  screenshotDir?: string;
}

export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  return chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
}

async function loginIfNeeded(page: Page, opts: ApprovalOptions): Promise<void> {
  const email = page.locator("#email");
  const pay = page.locator('[data-testid="submit-button-initial"], #payment-submit-btn');
  // Either the login form or (with an existing session) the review page shows up.
  await Promise.race([email.waitFor({ state: "visible", timeout: 45_000 }), pay.first().waitFor({ state: "visible", timeout: 45_000 })]);
  if (!(await email.isVisible().catch(() => false))) return;
  opts.onStep?.("logging in as the sandbox buyer");
  await email.fill(opts.buyerEmail);
  const next = page.locator("#btnNext");
  if (await next.isVisible().catch(() => false)) await next.click();
  const password = page.locator("#password");
  await password.waitFor({ state: "visible", timeout: 30_000 });
  await password.fill(opts.buyerPassword);
  await page.locator("#btnLogin").click();
}

/** Drives PayPal's approval page and resolves once PayPal redirects back to the return URL. */
export async function approveOrder(browser: Browser, opts: ApprovalOptions): Promise<void> {
  const context = opts.context ?? (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" }));
  const page = await context.newPage();
  // The return URL may not be a running server (seed runs without the app). Intercept it.
  await page.route(`${opts.returnUrlPrefix}**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>approved</body></html>" }));
  try {
    opts.onStep?.("opening PayPal's approval page");
    await page.goto(opts.approveUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await loginIfNeeded(page, opts);
    const pay = page.locator('[data-testid="submit-button-initial"], #payment-submit-btn').first();
    await pay.waitFor({ state: "visible", timeout: 60_000 });
    opts.onStep?.("pressing PayPal's pay button");
    await pay.click();
    await page.waitForURL((url) => url.toString().startsWith(opts.returnUrlPrefix), { timeout: 90_000 });
    opts.onStep?.("PayPal returned the buyer to the app");
  } catch (err) {
    if (opts.screenshotDir) await page.screenshot({ path: `${opts.screenshotDir}/approval-error-${Date.now()}.png` }).catch(() => undefined);
    throw new Error(`PayPal approval did not complete: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  } finally {
    await page.close().catch(() => undefined);
    if (!opts.context) await context.close().catch(() => undefined);
  }
}
