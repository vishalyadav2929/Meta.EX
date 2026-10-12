import { test } from "node:test";
import assert from "node:assert/strict";
import { countLeads, estimateLeads, rankAds, summarize, toStats } from "../src/meta/insights.ts";

const TYPES = ["onsite_conversion.messaging_conversation_started_7d", "lead"];

test("countLeads takes the max of overlapping lead types, ignores others", () => {
  const actions = [
    { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "12" },
    { action_type: "lead", value: "3" },
    { action_type: "link_click", value: "400" },
  ];
  assert.equal(countLeads(actions, TYPES), 12);
  assert.equal(countLeads(undefined, TYPES), 0);
});

test("toStats computes CPL and null CPL for zero leads", () => {
  const s = toStats({ ad_id: "1", ad_name: "Reel A", spend: "480", actions: [{ action_type: "lead", value: "12" }] }, TYPES);
  assert.equal(s.cpl, 40);
  assert.equal(toStats({ ad_id: "2", spend: "900" }, TYPES).cpl, null);
});

test("rankAds: winners by CPL, wasters by spend, low-spend ads ignored", () => {
  const mk = (id: string, spend: number, leads: number) => toStats(
    { ad_id: id, ad_name: id, spend: String(spend), actions: leads ? [{ action_type: "lead", value: String(leads) }] : [] },
    TYPES,
  );
  const stats = [mk("cheap", 1000, 50), mk("ok", 1000, 20), mk("waste", 2000, 0), mk("tiny", 50, 5)];
  const { winners, wasters } = rankAds(stats, 300);
  assert.deepEqual(winners.map((w) => w.id), ["cheap", "ok"]);
  assert.deepEqual(wasters.map((w) => w.id), ["waste"]);
  assert.deepEqual(summarize(stats), { spend: 4050, leads: 75, cpl: 54, ads: 4 });
});

test("estimateLeads: ₹500 at ₹40 CPL", () => {
  assert.deepEqual(estimateLeads(500, 40), { pessimistic: 7, expected: 13, optimistic: 17 });
  assert.throws(() => estimateLeads(500, 0));
});
