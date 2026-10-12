// Pure helpers for turning Meta insights rows into lead / cost numbers. No network here.

export interface ActionValue {
  action_type: string;
  value: string;
}

export interface InsightRow {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  frequency?: string;
  actions?: ActionValue[];
  date_start?: string;
  date_stop?: string;
  [k: string]: unknown;
}

export interface AdStats {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  frequency: number;
  leads: number;
  cpl: number | null;
}

/** Highest count among the configured lead action types (avoids double counting overlapping types). */
export function countLeads(actions: ActionValue[] | undefined, leadTypes: string[]): number {
  if (!actions?.length) return 0;
  let best = 0;
  for (const a of actions) {
    if (leadTypes.includes(a.action_type)) best = Math.max(best, Number(a.value) || 0);
  }
  return best;
}

export function toStats(row: InsightRow, leadTypes: string[]): AdStats {
  const spend = Number(row.spend ?? 0);
  const leads = countLeads(row.actions, leadTypes);
  return {
    id: String(row.ad_id ?? row.campaign_id ?? ""),
    name: String(row.ad_name ?? row.campaign_name ?? ""),
    spend,
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    clicks: Number(row.clicks ?? 0),
    ctr: Number(row.ctr ?? 0),
    frequency: Number(row.frequency ?? 0),
    leads,
    cpl: leads > 0 ? round(spend / leads) : null,
  };
}

export function summarize(stats: AdStats[]) {
  const spend = round(stats.reduce((s, a) => s + a.spend, 0));
  const leads = stats.reduce((s, a) => s + a.leads, 0);
  return { spend, leads, cpl: leads > 0 ? round(spend / leads) : null, ads: stats.length };
}

/**
 * Splits ads into winners (cheapest leads, with enough spend to trust) and wasters
 * (spent real money, zero leads). minSpend filters out ads with too little data.
 */
export function rankAds(stats: AdStats[], minSpend: number, top = 5) {
  const trusted = stats.filter((a) => a.spend >= minSpend);
  const winners = trusted
    .filter((a) => a.cpl !== null)
    .sort((a, b) => (a.cpl! - b.cpl!) || b.leads - a.leads)
    .slice(0, top);
  const wasters = trusted
    .filter((a) => a.leads === 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, top);
  return { winners, wasters };
}

/** Expected leads for a budget, using a historical CPL with a pessimistic/optimistic band. */
export function estimateLeads(budgetInr: number, historicalCpl: number) {
  if (historicalCpl <= 0) throw new Error("historicalCpl must be > 0");
  const expected = budgetInr / historicalCpl;
  return {
    pessimistic: Math.floor(expected * 0.6),
    expected: Math.round(expected),
    optimistic: Math.ceil(expected * 1.3),
  };
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
