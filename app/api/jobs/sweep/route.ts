import { refreshFromPayPal } from "@/lib/deals";
import { json, route } from "@/lib/http";
import { listDeals } from "@/lib/repo";
import { withDeal } from "@/lib/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A job as an API route (no long-running process): re-reads every held deal and releases holds
 * whose pickup window ended without a scan. Safe to call from a cron or by hand; the deal screens
 * run the same check whenever they are opened.
 */
export const GET = route(async () => {
  const held = (await listDeals()).filter((d) => d.mode === "live" && d.status === "held");
  const results: { id: string; status: string }[] = [];
  for (const d of held.slice(0, 20)) {
    try {
      const { deal } = await withDeal(d.id, "Job: sweep held deals", (dd, ll) => refreshFromPayPal(dd, ll));
      results.push({ id: deal.id, status: deal.status });
    } catch (err) {
      results.push({ id: d.id, status: `error: ${err instanceof Error ? err.message : "unknown"}` });
    }
  }
  return json({ checked: results.length, results });
});
