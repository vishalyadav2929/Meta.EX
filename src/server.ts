import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config, normalizeAdAccountId } from "./config.js";
import { graph } from "./meta/client.js";
import { estimateLeads, rankAds } from "./meta/insights.js";
import { accountSetup, adDetails, adStats, assertWritesEnabled, runGuard, type DatePreset } from "./meta/ops.js";

const INSTRUCTIONS = `Meta Ads helper for Indian local businesses (wedding anchors, salons, real estate, coaches).
Work in this order: check_account_setup -> audit_account -> estimate_leads -> create_warm_audiences ->
create_messages_campaign_draft (always PAUSED) -> show the user the plan -> set_status ACTIVE only after
the user explicitly says yes -> get_results / run_guard.
Money is in INR. Never promise a lead count; quote estimate_leads ranges and say they come from past data.
Reply in the user's language (Hindi/Hinglish is fine).`;

const accountArg = z.string().optional().describe("Ad account id (act_123 or 123). Defaults to META_AD_ACCOUNT_ID.");
const presetArg = z
  .enum(["today", "yesterday", "last_3d", "last_7d", "last_14d", "last_30d", "last_90d", "this_month", "last_month", "maximum"])
  .describe("Date range. 'maximum' = full account history.");

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function wrap<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] };
    }
  };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "meta-ex", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  // ---------- Read-only ----------

  server.registerTool(
    "list_ad_accounts",
    {
      title: "List ad accounts",
      description: "Lists the Meta ad accounts this login can access.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(async () =>
      graph.getAll("me/adaccounts", { fields: "id,name,account_status,currency,amount_spent" }),
    ),
  );

  server.registerTool(
    "check_account_setup",
    {
      title: "Check account setup",
      description:
        "Checks the ad account is ready to run ads: active status, payment method, INR currency, Facebook Page with linked Instagram professional account. Run this first.",
      inputSchema: { ad_account_id: accountArg },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ ad_account_id }: { ad_account_id?: string }) => accountSetup(ad_account_id)),
  );

  server.registerTool(
    "audit_account",
    {
      title: "Audit past ads",
      description:
        "Audits past ad performance: total spend, leads, cost per lead (CPL), the cheapest-lead winning ads (with creative ids to reuse) and ads that spent money with zero leads.",
      inputSchema: {
        ad_account_id: accountArg,
        date_preset: presetArg.default("maximum"),
        min_spend_inr: z.number().min(0).default(300).describe("Ignore ads that spent less than this (not enough data)."),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a: { ad_account_id?: string; date_preset: DatePreset; min_spend_inr: number }) => {
      const { act, stats, total } = await adStats(a.ad_account_id, { datePreset: a.date_preset }, "ad");
      const { winners, wasters } = rankAds(stats, a.min_spend_inr);
      const details = await adDetails(winners.map((w) => w.id));
      const wasted = wasters.reduce((s, w) => s + w.spend, 0);
      return {
        account: act,
        range: a.date_preset,
        total,
        winners: winners.map((w) => ({
          ...w,
          creative_id: details[w.id]?.creative?.id,
          thumbnail: details[w.id]?.creative?.thumbnail_url,
          status: details[w.id]?.effective_status,
        })),
        zero_lead_ads: wasters,
        zero_lead_spend_inr: Math.round(wasted),
        note: "CPL = spend / leads. Leads counted from: " + config.leadActionTypes.join(", "),
      };
    }),
  );

  server.registerTool(
    "estimate_leads",
    {
      title: "Estimate leads for a budget",
      description:
        "Estimates how many leads a budget can buy using this account's own historical cost per lead. Returns a pessimistic / expected / optimistic range, never a promise.",
      inputSchema: {
        budget_inr: z.number().positive().describe("Total budget in INR (e.g. 500)."),
        ad_account_id: accountArg,
        date_preset: presetArg.default("last_90d").describe("History window used to compute CPL."),
        cpl_override_inr: z.number().positive().optional().describe("Use this CPL instead of history."),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a: { budget_inr: number; ad_account_id?: string; date_preset: DatePreset; cpl_override_inr?: number }) => {
      let cpl = a.cpl_override_inr;
      let basis = "override";
      if (!cpl) {
        let { total } = await adStats(a.ad_account_id, { datePreset: a.date_preset }, "campaign");
        basis = a.date_preset;
        if (!total.cpl) {
          ({ total } = await adStats(a.ad_account_id, { datePreset: "maximum" }, "campaign"));
          basis = "maximum";
        }
        if (!total.cpl) throw new Error("No leads in history, cannot estimate. Pass cpl_override_inr.");
        cpl = total.cpl;
      }
      return {
        budget_inr: a.budget_inr,
        cpl_used_inr: cpl,
        cpl_basis: basis,
        leads: estimateLeads(a.budget_inr, cpl),
        caveat:
          "Based on past average CPL. Warm/retargeting audiences usually beat it, new cold audiences and the first 1-2 days (learning phase) usually do worse.",
      };
    }),
  );

  server.registerTool(
    "search_location",
    {
      title: "Search targeting location",
      description: "Finds the Meta city key for a city name (needed for create_messages_campaign_draft).",
      inputSchema: {
        query: z.string().min(2).describe("City name, e.g. Jaipur"),
        country_code: z.string().length(2).default("IN"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a: { query: string; country_code: string }) => {
      const res = await graph.get("search", {
        type: "adgeolocation",
        location_types: ["city"],
        q: a.query,
        country_code: a.country_code,
        limit: 10,
      });
      return (res.data ?? []).map((c: any) => ({ key: c.key, name: c.name, region: c.region, country: c.country_code }));
    }),
  );

  server.registerTool(
    "get_results",
    {
      title: "Get results",
      description: "Spend, leads and cost per lead for a date range, per campaign or per ad. Use 'today' for the daily check.",
      inputSchema: {
        ad_account_id: accountArg,
        date_preset: presetArg.default("today"),
        level: z.enum(["campaign", "ad"]).default("campaign"),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a: { ad_account_id?: string; date_preset: DatePreset; level: "campaign" | "ad" }) => {
      const { act, stats, total } = await adStats(a.ad_account_id, { datePreset: a.date_preset }, a.level);
      return { account: act, range: a.date_preset, total, rows: stats.sort((x, y) => y.spend - x.spend) };
    }),
  );

  // ---------- Writes (need ENABLE_WRITES=true) ----------

  server.registerTool(
    "run_guard",
    {
      title: "Run auto-pause rules",
      description:
        "Checks active ads against the guard rules (zero leads after spend, CPL above cap, high frequency, cheap-winner hint). Skips ads still in the learning phase. dry_run=true only reports.",
      inputSchema: {
        ad_account_id: accountArg,
        dry_run: z.boolean().default(true),
      },
      annotations: { destructiveHint: true },
    },
    wrap(async (a: { ad_account_id?: string; dry_run: boolean }) => runGuard(a.ad_account_id, a.dry_run)),
  );

  server.registerTool(
    "create_warm_audiences",
    {
      title: "Create warm audiences",
      description:
        "Creates a custom audience of people who engaged with the Instagram account in the last N days, plus a lookalike of it. Warm audiences usually give the cheapest leads.",
      inputSchema: {
        ad_account_id: accountArg,
        instagram_user_id: z.string().describe("Instagram professional account id (from check_account_setup)."),
        retention_days: z.number().int().min(1).max(365).default(365),
        lookalike_ratio: z.number().min(0.01).max(0.1).default(0.01).describe("0.01 = closest 1%."),
        lookalike_country: z.string().length(2).default("IN"),
      },
    },
    wrap(async (a: {
      ad_account_id?: string;
      instagram_user_id: string;
      retention_days: number;
      lookalike_ratio: number;
      lookalike_country: string;
    }) => {
      assertWritesEnabled();
      const act = normalizeAdAccountId(a.ad_account_id);
      const engagers = await graph.post(`${act}/customaudiences`, {
        name: `IG engagers ${a.retention_days}d`,
        rule: {
          inclusions: {
            operator: "or",
            rules: [
              {
                event_sources: [{ id: a.instagram_user_id, type: "ig_business" }],
                retention_seconds: a.retention_days * 86400,
                filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "ig_business_profile_all" }] },
              },
            ],
          },
        },
        prefill: true,
      });
      const lookalike = await graph
        .post(`${act}/customaudiences`, {
          name: `LAL ${a.lookalike_ratio * 100}% IG engagers`,
          subtype: "LOOKALIKE",
          origin_audience_id: engagers.id,
          lookalike_spec: { country: a.lookalike_country, ratio: a.lookalike_ratio },
        })
        .catch((e: Error) => ({ error: `Lookalike not created yet: ${e.message}. Retry after the source audience fills (can take hours).` }));
      return { engagers_audience_id: engagers.id, lookalike };
    }),
  );

  server.registerTool(
    "create_messages_campaign_draft",
    {
      title: "Create Messages campaign (PAUSED)",
      description:
        "Creates a PAUSED click-to-message campaign: 1 campaign (daily budget) -> 1 ad set (city + radius, ages, optional warm audiences) -> 1 ad per creative id. Reuse winning creative ids from audit_account. Nothing spends until set_status ACTIVE.",
      inputSchema: {
        ad_account_id: accountArg,
        name: z.string().min(3),
        daily_budget_inr: z.number().positive(),
        page_id: z.string().describe("Facebook Page id linked to the Instagram account."),
        destination: z.enum(["INSTAGRAM_DIRECT", "MESSENGER", "WHATSAPP"]).default("INSTAGRAM_DIRECT"),
        city_key: z.string().describe("From search_location."),
        radius_km: z.number().min(10).max(80).default(30),
        age_min: z.number().int().min(18).max(65).default(24),
        age_max: z.number().int().min(18).max(65).default(45),
        custom_audience_ids: z.array(z.string()).default([]).describe("Warm/lookalike audiences to target."),
        creative_ids: z.array(z.string()).min(1).max(5).describe("Existing creative ids (e.g. winners from audit_account)."),
        advantage_audience: z.boolean().default(false).describe("Let Meta expand beyond your targeting."),
      },
    },
    wrap(async (a: {
      ad_account_id?: string;
      name: string;
      daily_budget_inr: number;
      page_id: string;
      destination: "INSTAGRAM_DIRECT" | "MESSENGER" | "WHATSAPP";
      city_key: string;
      radius_km: number;
      age_min: number;
      age_max: number;
      custom_audience_ids: string[];
      creative_ids: string[];
      advantage_audience: boolean;
    }) => {
      assertWritesEnabled();
      if (a.daily_budget_inr > config.maxDailyBudgetInr) {
        throw new Error(`Daily budget ₹${a.daily_budget_inr} is above the server cap ₹${config.maxDailyBudgetInr} (MAX_DAILY_BUDGET_INR).`);
      }
      if (a.age_min > a.age_max) throw new Error("age_min must be <= age_max");
      const act = normalizeAdAccountId(a.ad_account_id);

      const campaign = await graph.post(`${act}/campaigns`, {
        name: a.name,
        objective: "OUTCOME_ENGAGEMENT",
        special_ad_categories: [],
        daily_budget: Math.round(a.daily_budget_inr * 100), // paise
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        status: "PAUSED",
      });

      const targeting: Record<string, unknown> = {
        geo_locations: { cities: [{ key: a.city_key, radius: a.radius_km, distance_unit: "kilometer" }] },
        age_min: a.age_min,
        age_max: a.age_max,
        targeting_automation: { advantage_audience: a.advantage_audience ? 1 : 0 },
      };
      if (a.custom_audience_ids.length) targeting.custom_audiences = a.custom_audience_ids.map((id) => ({ id }));
      if (a.destination === "INSTAGRAM_DIRECT") targeting.publisher_platforms = ["instagram"];

      const adset = await graph.post(`${act}/adsets`, {
        name: `${a.name} | ad set`,
        campaign_id: campaign.id,
        optimization_goal: "CONVERSATIONS",
        billing_event: "IMPRESSIONS",
        destination_type: a.destination,
        promoted_object: { page_id: a.page_id },
        targeting,
        status: "ACTIVE", // safe: parent campaign is PAUSED, so nothing delivers
      });

      const ads = [];
      for (const [i, creative_id] of a.creative_ids.entries()) {
        const ad = await graph.post(`${act}/ads`, {
          name: `${a.name} | ad ${i + 1}`,
          adset_id: adset.id,
          creative: { creative_id },
          status: "ACTIVE", // safe: parent campaign is PAUSED
        });
        ads.push({ ad_id: ad.id, creative_id });
      }

      return {
        status: "Campaign PAUSED (nothing is spending)",
        campaign_id: campaign.id,
        adset_id: adset.id,
        ads,
        next_step: `Show this plan to the user. To go live call set_status with object_id=${campaign.id}, status=ACTIVE, confirm=true.`,
      };
    }),
  );

  server.registerTool(
    "set_status",
    {
      title: "Pause or activate",
      description:
        "Sets a campaign, ad set or ad to PAUSED or ACTIVE. ACTIVE spends real money: only call with confirm=true after the user explicitly approved.",
      inputSchema: {
        object_id: z.string(),
        status: z.enum(["PAUSED", "ACTIVE"]),
        confirm: z.boolean().default(false).describe("Must be true to set ACTIVE."),
      },
      annotations: { destructiveHint: true },
    },
    wrap(async (a: { object_id: string; status: "PAUSED" | "ACTIVE"; confirm: boolean }) => {
      assertWritesEnabled();
      if (a.status === "ACTIVE" && !a.confirm) {
        throw new Error("Activation spends money. Ask the user, then call again with confirm=true.");
      }
      await graph.post(a.object_id, { status: a.status });
      return { object_id: a.object_id, status: a.status };
    }),
  );

  return server;
}
