/**
 * Records the raw footage for the demo video: real runs of the app against the PayPal sandbox and
 * the real models, in headless Chromium with Playwright's recordVideo.
 *
 *   pnpm build && pnpm start -p 3100   (in another terminal, with .env.local loaded)
 *   pnpm tsx scripts/video/record.ts [--base http://localhost:3100] [--price 82] [--attempts 10]
 *
 * Output: demo/raw/main.webm, demo/raw/popup.webm, demo/raw/marks.json (timestamps of every beat).
 * The PayPal approval window is a real popup opened by JS SDK v6; Playwright logs in as the
 * sandbox buyer and approves, exactly as a person would.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Locator } from "playwright";
import { loadEnv, requireEnv } from "../lib/env";

loadEnv();

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const BASE = arg("base", "http://localhost:3100");
const WANTED = `$${arg("price", "82")}`;
const ATTEMPTS = Number(arg("attempts", "10"));
const RAW = path.join(process.cwd(), "demo", "raw");
const SCAM = "Skip the app. Pay a $20 deposit by gift card and I'll hold it for you.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A visible cursor, because headless recordings do not draw one. */
const CURSOR_SCRIPT = `
(() => {
  if (window.__cvcCursor) return;
  window.__cvcCursor = true;
  const make = () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(242,179,61,.55);border:2px solid #2a1f17;pointer-events:none;transition:transform .08s ease;transform:translate(-100px,-100px)';
    document.documentElement.appendChild(dot);
    let x = -100, y = -100;
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; dot.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(.6)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(1)'; }, true);
  };
  if (document.documentElement) make(); else addEventListener('DOMContentLoaded', make);
})();`;

async function main() {
  requireEnv(["PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD", "DEMO_ADMIN_TOKEN"]);
  const { chromium } = await import("playwright");
  const repo = await import("../../lib/repo");
  // Remove only earlier footage. The narration audio in demo/raw/narration costs characters to remake.
  await fs.mkdir(RAW, { recursive: true });
  for (const name of await fs.readdir(RAW)) {
    if (name.endsWith(".webm") || name === "marks.json" || name === "error.png") await fs.rm(path.join(RAW, name), { force: true });
  }

  // Clean demo state, then take the seeded bike off the shelf: in the video Theo lists it himself.
  const reset = await fetch(`${BASE}/api/admin/reset`, { method: "POST", headers: { "x-admin-token": process.env.DEMO_ADMIN_TOKEN! } });
  if (!reset.ok) throw new Error(`Reset failed (${reset.status}). Is the app running at ${BASE}?`);
  const seededBike = await repo.getListing("lst_bike");
  if (seededBike) await repo.saveListing({ ...seededBike, status: "sold" });

  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const browser = await chromium.launch({ proxy: proxy ? { server: proxy, bypass: "localhost,127.0.0.1" } : undefined });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 4 / 3,
    locale: "en-US",
    recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  const t0 = Date.now();
  const marks: Record<string, number> = {};
  const extra: Record<string, unknown> = {};
  const saveMarks = () => fs.writeFile(path.join(RAW, "marks.json"), JSON.stringify({ main: marks, ...extra, recordedAt: new Date().toISOString() }, null, 2));
  const mark = (name: string) => {
    marks[name] = (Date.now() - t0) / 1000;
    console.log(`  [${marks[name].toFixed(1)}s] ${name}`);
    void saveMarks();
  };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));

  async function click(target: Locator, pauseAfter = 500) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
      await sleep(180);
    }
    await target.click();
    await sleep(pauseAfter);
  }
  const status = () => page.getByTestId("deal-room").getAttribute("data-status");
  const waitStatus = (s: string, timeout = 120_000) =>
    page.waitForFunction((want) => document.querySelector("[data-testid=deal-room]")?.getAttribute("data-status") === want, s, { timeout });
  const scrollThreadToEnd = () => page.evaluate(() => document.querySelector("[data-testid=thread]")?.scrollTo({ top: 1e6, behavior: "smooth" }));

  try {
    /* ---- home ---- */
    await page.goto(`${BASE}/?as=buyer&mode=live&sound=off`, { waitUntil: "networkidle" });
    await sleep(800);
    mark("home_start");
    await sleep(2200);
    await page.mouse.move(700, 500, { steps: 10 });
    await page.mouse.wheel(0, 620);
    await sleep(2600);
    mark("home_end");

    /* ---- sell: the listing writes itself ---- */
    await page.goto(`${BASE}/sell`, { waitUntil: "networkidle" });
    await sleep(600);
    mark("sell_start");
    await click(page.getByTestId("demo-bike"), 900);
    await click(page.getByTestId("write-listing"), 300);
    mark("sell_writing");
    await page.getByTestId("draft").waitFor({ state: "visible", timeout: 90_000 });
    mark("sell_draft");
    await sleep(2600);
    await page.getByTestId("price-estimate").scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 260);
    await sleep(1800);
    const asking = page.locator("#asking");
    await click(asking, 200);
    await asking.fill("");
    await asking.pressSequentially("92", { delay: 140 });
    const floor = page.getByTestId("floor");
    await click(floor, 200);
    await floor.fill("");
    await floor.pressSequentially("75", { delay: 160 });
    mark("sell_floor");
    await sleep(1400);
    await click(page.getByTestId("publish"), 300);
    await page.getByTestId("published").waitFor({ state: "visible", timeout: 30_000 });
    mark("sell_published");
    await sleep(2600);
    mark("sell_end");

    /* ---- buy: Maya's want and her private ceiling ---- */
    await page.goto(`${BASE}/buy?as=buyer`, { waitUntil: "networkidle" });
    await sleep(700);
    mark("buy_start");
    await sleep(1200);
    await click(page.getByTestId("find"), 300);
    await page.getByTestId("parsed-want").waitFor({ state: "visible", timeout: 60_000 });
    mark("buy_parsed");
    await page.getByTestId("chosen-listing").waitFor({ state: "visible", timeout: 30_000 });
    await sleep(1800);
    const ceiling = page.getByTestId("ceiling");
    await ceiling.scrollIntoViewIfNeeded();
    await click(ceiling, 200);
    await ceiling.fill("");
    await ceiling.pressSequentially("90", { delay: 170 });
    mark("buy_ceiling");
    await sleep(1500);
    const buyUrl = page.url();

    /* ---- the haggle, repeated until the deal lands on the wanted price ---- */
    let landed = false;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await page.goto(buyUrl, { waitUntil: "networkidle" });
        await click(page.getByTestId("find"), 300);
        await page.getByTestId("chosen-listing").waitFor({ state: "visible", timeout: 60_000 });
        const c = page.getByTestId("ceiling");
        await c.fill("90");
      }
      mark(`buy_send_${attempt}`);
      await click(page.getByTestId("start-haggle"), 200);
      await page.waitForURL(/\/deal\//, { timeout: 30_000 });
      await page.getByTestId("deal-room").waitFor({ state: "visible", timeout: 30_000 });
      mark(`haggle_start_${attempt}`);
      await page.waitForFunction(() => document.querySelector("[data-testid=deal-room]")?.getAttribute("data-status") !== "negotiating", null, { timeout: 180_000 });
      const st = await status();
      const price = st === "agreed" ? ((await page.getByTestId("deal-price").textContent()) ?? "") : "";
      console.log(`  attempt ${attempt}: ${st} ${price}`);
      if (st === "agreed" && price.includes(WANTED) && !(await page.getByText("scripted move").count())) {
        await sleep(4200); // let the nose bump play
        mark(`haggle_end_${attempt}`);
        marks.haggle_start = marks[`haggle_start_${attempt}`];
        marks.haggle_end = marks[`haggle_end_${attempt}`];
        marks.buy_send = marks[`buy_send_${attempt}`];
        landed = true;
        break;
      }
      if (st === "agreed" || st === "negotiating") await page.getByTestId("walk").click().catch(() => undefined);
      await sleep(500);
    }
    if (!landed) throw new Error(`No haggle landed on ${WANTED} in ${ATTEMPTS} attempts. Run again.`);
    const dealUrl = page.url().split("?")[0];

    /* ---- accept, then Barley places the hold ---- */
    mark("accept_start");
    await page.getByTestId("accept").waitFor({ state: "visible" });
    await sleep(2500);
    await click(page.getByTestId("accept"), 1200);
    await click(page.getByTestId("switch-role").first(), 1300);
    await click(page.getByTestId("accept"), 300);
    mark("accept_both");
    await waitStatus("awaiting_payment");
    mark("order_created");
    await scrollThreadToEnd();
    await sleep(3200);
    await click(page.getByTestId("switch-role").first(), 800);
    const payButton = page.getByTestId("paypal-button");
    await payButton.waitFor({ state: "visible", timeout: 60_000 });
    await sleep(2200);
    mark("paypal_button");

    /* ---- the real PayPal approval popup (JS SDK v6) ---- */
    const popupPromise = context.waitForEvent("page", { timeout: 30_000 });
    await click(payButton, 0);
    const popup = await popupPromise;
    const p0 = Date.now();
    mark("popup_open");
    const pmarks: Record<string, number> = {};
    const pmark = (name: string) => {
      pmarks[name] = (Date.now() - p0) / 1000;
      console.log(`    popup [${pmarks[name].toFixed(1)}s] ${name}`);
    };
    await popup.waitForLoadState("domcontentloaded");
    const popupViewport = popup.viewportSize() ?? (await popup.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
    const email = popup.locator("#email");
    await email.waitFor({ state: "visible", timeout: 60_000 });
    pmark("login_visible");
    await sleep(900);
    await email.pressSequentially(process.env.PAYPAL_SANDBOX_BUYER_EMAIL!, { delay: 35 });
    await sleep(400);
    await popup.locator("#btnNext").click();
    const password = popup.locator("#password");
    await password.waitFor({ state: "visible", timeout: 45_000 });
    await password.pressSequentially(process.env.PAYPAL_SANDBOX_BUYER_PASSWORD!, { delay: 35 });
    await sleep(400);
    await popup.locator("#btnLogin").click();
    pmark("logged_in");
    const pay = popup.locator('[data-testid="submit-button-initial"], #payment-submit-btn').first();
    await pay.waitFor({ state: "visible", timeout: 90_000 });
    pmark("review_visible");
    await sleep(2600);
    await pay.scrollIntoViewIfNeeded();
    await sleep(700);
    pmark("pay_click");
    await pay.click();
    const popupVideo = popup.video();
    await waitStatus("held", 120_000);
    mark("held");
    pmarks.end = (Date.now() - p0) / 1000;
    Object.assign(extra, { popup: pmarks, popupViewport, dealUrl });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=turn-biscuit]")].some((n) => n.textContent?.includes("get_order")), null, { timeout: 60_000 });
    await scrollThreadToEnd();
    mark("verified");
    await sleep(4200);
    mark("hold_end");

    /* ---- QR handoff: capture and payout ---- */
    mark("qr_start");
    await click(page.getByTestId("show-qr"), 300);
    await page.getByTestId("qr-image").waitFor({ state: "visible" });
    mark("qr_shown");
    await sleep(2800);
    await click(page.getByTestId("switch-role").first(), 1200);
    await page.getByTestId("simulate-scan").waitFor({ state: "visible" });
    await sleep(1200);
    await click(page.getByTestId("simulate-scan"), 200);
    mark("scan_click");
    await waitStatus("completed", 90_000);
    mark("captured");
    await scrollThreadToEnd();
    await page.waitForFunction(() => document.querySelector("[data-testid=payout-status]")?.textContent?.includes("SUCCESS"), null, { timeout: 90_000 });
    mark("payout_success");
    await sleep(3000);
    await click(page.getByTestId("open-hood"), 900);
    mark("hood_open");
    await sleep(1800);
    const hood = page.locator("[data-testid=hood] aside > div").nth(1);
    await hood.hover();
    await page.mouse.wheel(0, 520);
    await sleep(2200);
    await page.mouse.wheel(0, 620);
    await sleep(2400);
    mark("hood_end");
    await page.keyboard.press("Escape");
    await sleep(600);

    /* ---- safety: a scam message is refused (second haggle, on the side table) ---- */
    await page.goto(`${BASE}/buy?listing=lst_table&as=buyer`, { waitUntil: "networkidle" });
    await page.getByTestId("start-haggle").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("start-haggle").click();
    await page.waitForURL(/\/deal\//, { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=turn-barley],[data-testid=turn-biscuit]").length >= 2, null, { timeout: 120_000 });
    // The role switch is a visually hidden radio; a person clicks its label.
    await click(page.locator('label:has([data-testid="role-seller"])'), 900);
    mark("scam_start");
    const jump = page.getByTestId("jump-in");
    await click(jump, 200);
    await jump.pressSequentially(SCAM, { delay: 28 });
    await sleep(600);
    await click(page.getByTestId("send"), 200);
    await page.getByTestId("scam-flag").waitFor({ state: "visible", timeout: 60_000 });
    await scrollThreadToEnd();
    mark("scam_flagged");
    await sleep(4500);
    mark("scam_end");

    /* ---- the seeded no-show: the hold was voided ---- */
    await page.goto(`${BASE}/deal/dl_seed_table?as=seller`, { waitUntil: "networkidle" });
    await sleep(700);
    mark("void_start");
    await sleep(3800);
    mark("void_end");

    await saveMarks();
    const mainVideo = page.video();
    await context.close();
    if (mainVideo) await fs.rename(await mainVideo.path(), path.join(RAW, "main.webm"));
    if (popupVideo) await fs.rename(await popupVideo.path(), path.join(RAW, "popup.webm"));
    console.log(`\nRecorded demo/raw/main.webm and demo/raw/popup.webm. Deal: ${dealUrl}`);
    if (errors.length) console.log("page errors:", [...new Set(errors)].slice(0, 5));
  } catch (err) {
    await page.screenshot({ path: path.join(RAW, "error.png") }).catch(() => undefined);
    await context.close().catch(() => undefined);
    throw err;
  } finally {
    await browser.close().catch(() => undefined);
    // Put the demo state back the way judges will find it.
    await fetch(`${BASE}/api/admin/reset`, { method: "POST", headers: { "x-admin-token": process.env.DEMO_ADMIN_TOKEN! } }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(`\nRecording failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  process.exit(1);
});
