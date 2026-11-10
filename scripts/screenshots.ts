/**
 * Captures the README screenshots (1440x960) from a real live run against the PayPal sandbox.
 *
 *   pnpm build && pnpm start -p 3100   (in another terminal, with .env.local loaded)
 *   pnpm tsx scripts/screenshots.ts [--base http://localhost:3100]
 *
 * Output: docs/screenshots/*.png. The demo state is reset before and after.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadEnv, requireEnv } from "./lib/env";

loadEnv();

const i = process.argv.indexOf("--base");
const BASE = i > 0 ? process.argv[i + 1] : "http://localhost:3100";
const OUT = path.join(process.cwd(), "docs", "screenshots");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  requireEnv(["PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD", "DEMO_ADMIN_TOKEN"]);
  const { chromium } = await import("playwright");
  await fs.mkdir(OUT, { recursive: true });
  const reset = () => fetch(`${BASE}/api/admin/reset`, { method: "POST", headers: { "x-admin-token": process.env.DEMO_ADMIN_TOKEN! } });
  if (!(await reset()).ok) throw new Error(`Reset failed. Is the app running at ${BASE}?`);

  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const browser = await chromium.launch({ proxy: proxy ? { server: proxy, bypass: "localhost,127.0.0.1" } : undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "en-US" });
  const page = await context.newPage();
  const shot = async (name: string) => {
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  ${name}.png`);
  };
  const waitStatus = (s: string, timeout = 120_000) =>
    page.waitForFunction((want) => document.querySelector("[data-testid=deal-room]")?.getAttribute("data-status") === want, s, { timeout });
  const threadEnd = () => page.evaluate(() => document.querySelector("[data-testid=thread]")?.scrollTo({ top: 1e6 }));
  const roleLabel = (role: "buyer" | "seller") => page.locator(`label:has([data-testid="role-${role}"])`);

  try {
    await page.goto(`${BASE}/?as=buyer&mode=live&sound=off`, { waitUntil: "networkidle" });
    await shot("01-home");

    await page.goto(`${BASE}/sell`, { waitUntil: "networkidle" });
    await page.getByTestId("demo-bike").click();
    await page.getByTestId("write-listing").click();
    await page.getByTestId("draft").waitFor({ state: "visible", timeout: 90_000 });
    await shot("02-listing-writes-itself");

    // The haggle, repeated until it lands on the price from the brief.
    for (let attempt = 1; attempt <= 8; attempt++) {
      await page.goto(`${BASE}/buy?listing=lst_bike&as=buyer`, { waitUntil: "networkidle" });
      await page.getByTestId("start-haggle").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("ceiling").fill("90");
      if (attempt === 1) await shot("03-private-ceiling");
      await page.getByTestId("start-haggle").click();
      await page.waitForURL(/\/deal\//, { timeout: 30_000 });
      await page.waitForFunction(() => document.querySelectorAll("[data-testid=turn-barley],[data-testid=turn-biscuit]").length >= 3, null, { timeout: 120_000 });
      await threadEnd();
      await shot("04-haggle");
      await page.waitForFunction(() => document.querySelector("[data-testid=deal-room]")?.getAttribute("data-status") !== "negotiating", null, { timeout: 180_000 });
      const price = (await page.getByTestId("deal-price").textContent().catch(() => "")) ?? "";
      console.log(`  attempt ${attempt}: ${price}`);
      if (price.includes("$82")) break;
      await page.getByTestId("walk").click().catch(() => undefined);
      if (attempt === 8) throw new Error("No haggle landed on $82.");
    }
    await page.waitForFunction(() => !document.querySelector("[data-testid=deal-room]")?.textContent?.includes("Writing your summary"), null, { timeout: 60_000 });
    await sleep(2500);
    await threadEnd();
    await shot("05-deal-reached");

    await page.getByTestId("accept").click();
    await page.getByTestId("switch-role").first().click();
    await page.getByTestId("accept").click();
    await waitStatus("awaiting_payment");
    await page.getByTestId("switch-role").first().click();
    const payButton = page.getByTestId("paypal-button");
    await payButton.waitFor({ state: "visible", timeout: 60_000 });
    await threadEnd();
    await sleep(1500);
    await shot("06-barley-places-the-hold");

    const popupPromise = context.waitForEvent("page", { timeout: 30_000 });
    await payButton.click();
    const popup = await popupPromise;
    await popup.locator("#email").waitFor({ state: "visible", timeout: 60_000 });
    await popup.locator("#email").fill(process.env.PAYPAL_SANDBOX_BUYER_EMAIL!);
    await popup.locator("#btnNext").click();
    await popup.locator("#password").waitFor({ state: "visible", timeout: 45_000 });
    await popup.locator("#password").fill(process.env.PAYPAL_SANDBOX_BUYER_PASSWORD!);
    await popup.locator("#btnLogin").click();
    const pay = popup.locator('[data-testid="submit-button-initial"], #payment-submit-btn').first();
    await pay.waitFor({ state: "visible", timeout: 90_000 });
    await pay.click();
    await waitStatus("held", 120_000);
    await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=turn-biscuit]")].some((n) => n.textContent?.includes("get_order")), null, { timeout: 60_000 });
    await threadEnd();
    await shot("07-payment-held-by-paypal");

    await page.getByTestId("show-qr").click();
    await page.getByTestId("qr-image").waitFor({ state: "visible" });
    await shot("08-pickup-qr");

    await page.getByTestId("switch-role").first().click();
    await page.getByTestId("simulate-scan").click();
    await waitStatus("completed", 90_000);
    await page.waitForFunction(() => document.querySelector("[data-testid=payout-status]")?.textContent?.includes("SUCCESS"), null, { timeout: 90_000 });
    await threadEnd();
    await shot("09-captured-and-paid-out");

    await page.getByTestId("open-hood").click();
    await shot("10-under-the-hood");
    await page.keyboard.press("Escape");

    // Safety: a scam message typed by the seller is refused by the buyer's agent.
    await page.goto(`${BASE}/buy?listing=lst_table&as=buyer`, { waitUntil: "networkidle" });
    await page.getByTestId("start-haggle").click();
    await page.waitForURL(/\/deal\//, { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=turn-barley],[data-testid=turn-biscuit]").length >= 2, null, { timeout: 120_000 });
    await roleLabel("seller").click();
    await page.getByTestId("scam-example").click();
    await page.getByTestId("send").click();
    await page.getByTestId("scam-flag").waitFor({ state: "visible", timeout: 60_000 });
    await threadEnd();
    await shot("11-scam-refused");

    await page.goto(`${BASE}/deal/dl_seed_table?as=seller`, { waitUntil: "networkidle" });
    await sleep(1200);
    await shot("12-no-show-hold-released");

    // Replay mode, clearly labeled.
    await page.goto(`${BASE}/?mode=replay`, { waitUntil: "networkidle" });
    await shot("13-replay-mode");
  } finally {
    await browser.close().catch(() => undefined);
    await reset().catch(() => undefined);
  }
  console.log(`Screenshots are in ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(`Screenshots failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  process.exit(1);
});
