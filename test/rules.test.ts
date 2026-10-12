import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRules, type GuardAd } from "../src/rules.ts";

const cfg = { targetCplInr: 60, noLeadSpendInr: 900, cplMultiplier: 2, maxFrequency: 3, learningHours: 48 };
const now = new Date("2026-10-12T12:00:00Z");
const old = "2026-10-01T00:00:00Z";

function ad(id: string, p: Partial<GuardAd>): GuardAd {
  return { id, name: id, spend: 0, impressions: 0, reach: 0, clicks: 0, ctr: 0, frequency: 1, leads: 0, cpl: null, status: "ACTIVE", createdTime: old, ...p };
}

test("pauses zero-lead spenders and CPL above cap", () => {
  const d = evaluateRules([
    ad("noLeads", { spend: 950 }),
    ad("expensive", { spend: 1300, leads: 10, cpl: 130 }),
    ad("fine", { spend: 500, leads: 10, cpl: 50 }),
  ], cfg, now);
  assert.deepEqual(d.filter((x) => x.action === "pause").map((x) => x.adId), ["noLeads", "expensive"]);
});

test("leaves learning-phase and paused ads alone", () => {
  const d = evaluateRules([
    ad("new", { spend: 2000, createdTime: "2026-10-11T20:00:00Z" }),
    ad("paused", { spend: 2000, status: "PAUSED" }),
  ], cfg, now);
  assert.equal(d.length, 0);
});

test("alerts on high frequency and on a much cheaper winner", () => {
  const d = evaluateRules([
    ad("tired", { spend: 300, leads: 6, cpl: 50, frequency: 3.4 }),
    ad("star", { spend: 300, leads: 15, cpl: 20 }),
    ad("avg", { spend: 300, leads: 6, cpl: 50 }),
  ], cfg, now);
  assert.ok(d.some((x) => x.adId === "tired" && x.action === "alert" && x.reason.includes("frequency")));
  assert.ok(d.some((x) => x.adId === "star" && x.action === "alert" && x.reason.includes("cheaper")));
  assert.ok(!d.some((x) => x.action === "pause"));
});
