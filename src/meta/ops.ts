// Meta Marketing API operations shared by MCP tools and the cron job.
import { config, normalizeAdAccountId } from "../config.js";
import { evaluateRules, type Decision, type GuardAd } from "../rules.js";
import { graph } from "./client.js";
import { toStats, summarize, type AdStats, type InsightRow } from "./insights.js";

const INSIGHT_FIELDS = "ad_id,ad_name,campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,frequency,actions";

export type DatePreset =
  | "today" | "yesterday" | "last_3d" | "last_7d" | "last_14d" | "last_30d" | "last_90d"
  | "this_month" | "last_month" | "maximum";

export interface Range {
  datePreset?: DatePreset;
  since?: string; // YYYY-MM-DD
  until?: string;
}

function rangeParams(r: Range) {
  if (r.since && r.until) return { time_range: { since: r.since, until: r.until } };
  return { date_preset: r.datePreset ?? "last_30d" };
}

export function assertWritesEnabled() {
  if (!config.writesEnabled) {
    throw new Error("Write actions are disabled. Set ENABLE_WRITES=true on the server after testing in read-only mode.");
  }
}

export async function adStats(adAccountId: string | undefined, range: Range, level: "ad" | "campaign" = "ad") {
  const act = normalizeAdAccountId(adAccountId);
  const rows = await graph.getAll<InsightRow>(`${act}/insights`, {
    level,
    fields: INSIGHT_FIELDS,
    ...rangeParams(range),
  });
  const stats = rows.map((r) => toStats(r, config.leadActionTypes));
  return { act, stats, total: summarize(stats) };
}

export async function accountSetup(adAccountId?: string) {
  const act = normalizeAdAccountId(adAccountId);
  const account = await graph.get(act, {
    fields: "name,account_status,disable_reason,currency,timezone_name,amount_spent,spend_cap,funding_source_details",
  });
  const pages = await graph
    .getAll("me/accounts", { fields: "id,name,instagram_business_account{id,username}" })
    .catch((e: Error) => ({ error: e.message }));

  const problems: string[] = [];
  if (account.account_status !== 1) problems.push(`Ad account not active (status ${account.account_status}, reason ${account.disable_reason}).`);
  if (!account.funding_source_details) problems.push("No payment method visible on the ad account.");
  if (account.currency !== "INR") problems.push(`Account currency is ${account.currency}, budgets in this tool assume INR.`);
  if (Array.isArray(pages)) {
    if (!pages.length) problems.push("No Facebook Page found for this token.");
    else if (!pages.some((p: any) => p.instagram_business_account)) problems.push("No Page has a linked Instagram professional account.");
  }

  return {
    ad_account: {
      id: act,
      name: account.name,
      status: account.account_status,
      currency: account.currency,
      timezone: account.timezone_name,
      lifetime_spend: Number(account.amount_spent ?? 0) / 100, // minor units
    },
    pages,
    ready: problems.length === 0,
    problems,
  };
}

/** Looks up creative ids + current status for a set of ads (batched by Graph `ids`). */
export async function adDetails(adIds: string[]): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    if (!chunk.length) continue;
    Object.assign(out, await graph.get("", { ids: chunk.join(","), fields: "name,effective_status,created_time,creative{id,name,thumbnail_url}" }));
  }
  return out;
}

export async function guardCandidates(adAccountId: string | undefined, lookbackDays: number): Promise<GuardAd[]> {
  const act = normalizeAdAccountId(adAccountId);
  const ads = await graph.getAll(`${act}/ads`, {
    fields: "id,name,effective_status,created_time",
    effective_status: ["ACTIVE"],
  });
  if (!ads.length) return [];
  const until = new Date();
  const since = new Date(until.getTime() - (lookbackDays - 1) * 864e5);
  const { stats } = await adStats(act, { since: ymd(since), until: ymd(until) }, "ad");
  const byId = new Map<string, AdStats>(stats.map((s) => [s.id, s]));
  return ads.map((a: any) => ({
    ...(byId.get(a.id) ?? { id: a.id, name: a.name, spend: 0, impressions: 0, reach: 0, clicks: 0, ctr: 0, frequency: 0, leads: 0, cpl: null }),
    name: a.name,
    status: a.effective_status,
    createdTime: a.created_time,
  }));
}

export async function runGuard(adAccountId: string | undefined, dryRun: boolean) {
  const ads = await guardCandidates(adAccountId, config.rules.lookbackDays);
  const decisions = evaluateRules(ads, config.rules);
  const applied: (Decision & { result: string })[] = [];
  for (const d of decisions) {
    if (d.action !== "pause" || dryRun) {
      applied.push({ ...d, result: d.action === "pause" ? "would pause (dry run)" : "alert only" });
      continue;
    }
    assertWritesEnabled();
    await graph.post(d.adId, { status: "PAUSED" });
    applied.push({ ...d, result: "paused" });
  }
  return { checked: ads.length, rules: config.rules, decisions: applied };
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
