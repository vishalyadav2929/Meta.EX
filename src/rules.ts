// Guard rules: decide which ads to pause or flag. Pure function so it is easy to test and
// can run from both the MCP tool and the cron job.
import type { AdStats } from "./meta/insights.js";

export interface RuleConfig {
  targetCplInr: number;
  noLeadSpendInr: number;
  cplMultiplier: number;
  maxFrequency: number;
  learningHours: number;
}

export interface GuardAd extends AdStats {
  status: string;
  createdTime?: string;
}

export type Decision =
  | { adId: string; adName: string; action: "pause"; reason: string }
  | { adId: string; adName: string; action: "alert"; reason: string };

export function evaluateRules(ads: GuardAd[], cfg: RuleConfig, now = new Date()): Decision[] {
  const out: Decision[] = [];
  const active = ads.filter((a) => a.status === "ACTIVE");

  for (const ad of active) {
    const base = { adId: ad.id, adName: ad.name };
    const ageHours = ad.createdTime ? (now.getTime() - new Date(ad.createdTime).getTime()) / 36e5 : Infinity;
    if (ageHours < cfg.learningHours) continue; // learning phase: hands off

    if (ad.leads === 0 && ad.spend >= cfg.noLeadSpendInr) {
      out.push({ ...base, action: "pause", reason: `₹${ad.spend} spent, 0 leads` });
      continue;
    }
    const cplCap = cfg.targetCplInr * cfg.cplMultiplier;
    if (ad.cpl !== null && ad.cpl > cplCap) {
      out.push({ ...base, action: "pause", reason: `CPL ₹${ad.cpl} > cap ₹${cplCap}` });
      continue;
    }
    if (ad.frequency > cfg.maxFrequency) {
      out.push({ ...base, action: "alert", reason: `frequency ${ad.frequency} > ${cfg.maxFrequency}: refresh creative` });
    }
  }

  // Budget-shift hint: an ad whose CPL is 40%+ below the average of the others.
  const withCpl = active.filter((a) => a.cpl !== null && a.leads >= 3);
  if (withCpl.length >= 2) {
    for (const ad of withCpl) {
      const others = withCpl.filter((o) => o.id !== ad.id);
      const avg = others.reduce((s, o) => s + o.cpl!, 0) / others.length;
      if (ad.cpl! <= avg * 0.6 && !out.some((d) => d.adId === ad.id)) {
        out.push({
          adId: ad.id,
          adName: ad.name,
          action: "alert",
          reason: `CPL ₹${ad.cpl} is 40%+ cheaper than others (avg ₹${Math.round(avg)}): consider more budget`,
        });
      }
    }
  }
  return out;
}
