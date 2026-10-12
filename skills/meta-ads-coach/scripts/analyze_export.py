#!/usr/bin/env python3
"""Analyze a Meta Ads Manager export (.xlsx or .csv) and print a markdown report.

Usage:
  python3 analyze_export.py <export.xlsx|.csv> [--min-spend 200] [--json out.json]

Works with the default English Ads Manager export (campaign or ad level).
Only uses the standard library + openpyxl.
"""
import argparse
import csv
import json
import re
import sys
from collections import defaultdict

# Ads Manager "Result indicator" -> human label + whether it is a real lead signal.
RESULT_TYPES = {
    "actions:link_click": ("Link clicks", False),
    "link_click": ("Link clicks", False),
    "profile_visit_view": ("Profile visits", False),
    "actions:visit_instagram_profile": ("Profile visits", False),
    "actions:onsite_conversion.messaging_conversation_started_7d": ("Messaging conversations", True),
    "onsite_conversion.messaging_conversation_started_7d": ("Messaging conversations", True),
    "actions:onsite_conversion.lead_grouped": ("Leads (form)", True),
    "actions:lead": ("Leads", True),
    "lead": ("Leads", True),
    "actions:offsite_conversion.fb_pixel_lead": ("Website leads", True),
    "reach": ("Reach", False),
    "actions:video_view": ("Video views", False),
    "video_thruplay_watched_actions": ("ThruPlays", False),
    "actions:post_engagement": ("Post engagement", False),
    "actions:like": ("Page likes / follows", False),
}

# Content themes for wedding / event businesses. Extend for other niches.
THEMES = {
    "baraat": ["baraat", "barat", "बारात"],
    "haldi": ["haldi", "हल्दी"],
    "mehndi": ["mehndi", "mehendi", "मेहंदी"],
    "sangeet": ["sangeet", "संगीत"],
    "varmala": ["varmala", "jaimala", "वरमाला"],
    "reception": ["reception"],
    "highlights": ["highlight"],
    "corporate/college": ["corporate", "college", "fest"],
}

COLS = {
    "name": ["Ad name", "Campaign name", "Ad set name"],
    "status": ["Ad delivery", "Campaign delivery", "Ad set delivery", "Delivery"],
    "indicator": ["Result indicator", "Result type"],
    "results": ["Results"],
    "spend": ["Amount spent (INR)", "Amount spent"],
    "reach": ["Reach"],
    "impressions": ["Impressions"],
    "frequency": ["Frequency"],
    "cpr": ["Cost per results", "Cost per result"],
    "link_clicks": ["Link clicks"],
    "cpc": ["CPC (cost per link click) (INR)", "CPC (cost per link click)"],
    "ctr": ["CTR (link click-through rate)"],
    "ctr_all": ["CTR (all)"],
    "ends": ["Ends", "Reporting ends"],
    "start": ["Starts", "Reporting starts"],
}


def load_rows(path):
    if path.lower().endswith(".csv"):
        with open(path, newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(wb.active.iter_rows(values_only=True))
    header = [str(h).strip() if h is not None else "" for h in rows[0]]
    return [dict(zip(header, r)) for r in rows[1:]]


def pick(row, key):
    for c in COLS[key]:
        if c in row and row[c] not in (None, ""):
            return row[c]
    return None


def num(v):
    if v in (None, ""):
        return 0.0
    try:
        return float(str(v).replace(",", "").replace("₹", ""))
    except ValueError:
        return 0.0


def clean_name(n):
    n = re.sub(r"^Instagram (पोस्ट|post):\s*", "", str(n or ""), flags=re.I)
    n = re.sub(r"\s+", " ", n.replace("\n", " ")).strip(" .")
    return (n[:60] + "…") if len(n) > 60 else n


def themes_of(name):
    low = str(name or "").lower()
    found = [t for t, kws in THEMES.items() if any(k in low for k in kws)]
    return found or ["other"]


def normalize(raw):
    out = []
    for r in raw:
        name = pick(r, "name")
        if not name:  # the totals row has no name
            continue
        ind = str(pick(r, "indicator") or "").strip()
        label, is_lead = RESULT_TYPES.get(ind, (ind or "No result set", False))
        spend = num(pick(r, "spend"))
        results = num(pick(r, "results"))
        out.append({
            "name": clean_name(name),
            "full_name": str(name),
            "status": pick(r, "status"),
            "result_type": label,
            "is_lead_signal": is_lead,
            "results": results,
            "spend": round(spend, 2),
            "cost_per_result": round(spend / results, 2) if results else None,
            "reach": num(pick(r, "reach")),
            "impressions": num(pick(r, "impressions")),
            "frequency": round(num(pick(r, "frequency")), 2),
            "link_clicks": num(pick(r, "link_clicks")),
            "cpc": round(num(pick(r, "cpc")), 2) or None,
            "ctr": round(num(pick(r, "ctr")) or num(pick(r, "ctr_all")), 2),
            "ends": str(pick(r, "ends") or "")[:10],
            "themes": themes_of(name),
        })
    return out


def analyze(ads, min_spend):
    total_spend = sum(a["spend"] for a in ads)
    lead_spend = sum(a["spend"] for a in ads if a["is_lead_signal"])
    by_type = defaultdict(list)
    for a in ads:
        by_type[a["result_type"]].append(a)

    groups = {}
    for t, items in by_type.items():
        spend = sum(a["spend"] for a in items)
        results = sum(a["results"] for a in items)
        trusted = [a for a in items if a["spend"] >= min_spend and a["cost_per_result"]]
        trusted.sort(key=lambda a: a["cost_per_result"])
        groups[t] = {
            "ads": len(items),
            "spend": round(spend, 2),
            "results": int(results),
            "avg_cost": round(spend / results, 2) if results else None,
            "best": trusted[:5],
            "worst": list(reversed(trusted[-5:])) if len(trusted) > 5 else [],
            "no_result_spenders": sorted([a for a in items if a["spend"] >= min_spend and not a["results"]],
                                         key=lambda a: -a["spend"])[:5],
        }

    themes = defaultdict(lambda: defaultdict(lambda: {"spend": 0.0, "results": 0.0, "ads": 0}))
    for a in ads:
        for th in a["themes"]:
            g = themes[a["result_type"]][th]
            g["spend"] += a["spend"]
            g["results"] += a["results"]
            g["ads"] += 1

    by_year = defaultdict(float)
    for a in ads:
        by_year[a["ends"][:4] if a["ends"][:4].isdigit() else "ongoing"] += a["spend"]

    suspicious = [a for a in ads if a["result_type"] == "Link clicks" and a["cpc"] and a["cpc"] < 0.2 and a["spend"] >= min_spend]

    return {
        "total_spend": round(total_spend, 2),
        "ads": len(ads),
        "lead_tracked_spend": round(lead_spend, 2),
        "groups": groups,
        "themes": {t: {k: {**v, "cost": round(v["spend"] / v["results"], 2) if v["results"] else None} for k, v in d.items()} for t, d in themes.items()},
        "spend_by_year": {k: round(v, 2) for k, v in sorted(by_year.items())},
        "suspicious_cheap_clicks": suspicious,
    }


def inr(v):
    return "-" if v is None else f"₹{v:,.2f}" if v < 10 else f"₹{v:,.0f}"


def report(res, min_spend):
    L = []
    L.append(f"# Meta Ads report\n\n**{res['ads']} ads, total spend {inr(res['total_spend'])}**\n")
    if res["lead_tracked_spend"] == 0:
        L.append("> ⚠️ **No ad was optimized for messages or leads.** Every rupee went to clicks/visits/reach, "
                 "so this file cannot say how many enquiries or bookings came from ads.\n")
    else:
        pct = 100 * res["lead_tracked_spend"] / res["total_spend"]
        L.append(f"Spend on lead-tracked objectives (messages/leads): {inr(res['lead_tracked_spend'])} ({pct:.0f}%).\n")

    L.append("## Spend by year (ad end date)\n")
    L.append(" | ".join(f"{y}: {inr(s)}" for y, s in res["spend_by_year"].items()) + "\n")

    for t, g in sorted(res["groups"].items(), key=lambda kv: -kv[1]["spend"]):
        if not g["spend"]:
            continue
        L.append(f"## {t}: {g['ads']} ads, {inr(g['spend'])}, {g['results']:,} results, avg {inr(g['avg_cost'])} each\n")
        if g["best"]:
            L.append(f"**Best (spend ≥ ₹{min_spend:.0f})**\n\n| # | Ad | Spend | Results | Cost each | Reach | CTR % |\n|---|---|---|---|---|---|---|")
            for i, a in enumerate(g["best"], 1):
                L.append(f"| {i} | {a['name']} | {inr(a['spend'])} | {int(a['results']):,} | {inr(a['cost_per_result'])} | {int(a['reach']):,} | {a['ctr']} |")
            L.append("")
        if g["worst"]:
            L.append("**Most expensive**\n\n| Ad | Spend | Results | Cost each |\n|---|---|---|---|")
            for a in g["worst"]:
                L.append(f"| {a['name']} | {inr(a['spend'])} | {int(a['results']):,} | {inr(a['cost_per_result'])} |")
            L.append("")
        if g["no_result_spenders"]:
            L.append("**Spent money, zero results:** " + "; ".join(f"{a['name']} ({inr(a['spend'])})" for a in g["no_result_spenders"]) + "\n")

    L.append("## Content themes (cost per result, lower is better)\n")
    for t, d in res["themes"].items():
        rows = sorted([(k, v) for k, v in d.items() if v["spend"] >= min_spend and v["cost"]], key=lambda kv: kv[1]["cost"])
        if not rows:
            continue
        L.append(f"**{t}:** " + " · ".join(f"{k} {inr(v['cost'])} ({v['ads']} ads, {inr(v['spend'])})" for k, v in rows) + "\n")

    if res["suspicious_cheap_clicks"]:
        L.append("## ⚠️ Suspiciously cheap clicks\n")
        L.append("Link clicks under ₹0.20 usually come from accidental taps or low-quality placements, not buyers. "
                 "Check placement breakdown in Ads Manager before calling these winners: "
                 + ", ".join(f"{a['name']} (CPC {inr(a['cpc'])})" for a in res["suspicious_cheap_clicks"][:5]) + "\n")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--min-spend", type=float, default=200)
    ap.add_argument("--json")
    args = ap.parse_args()
    ads = normalize(load_rows(args.path))
    if not ads:
        sys.exit("No ad rows found. Export from Ads Manager with the default English columns.")
    res = analyze(ads, args.min_spend)
    print(report(res, args.min_spend))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"summary": res, "ads": ads}, f, ensure_ascii=False, indent=2, default=str)


if __name__ == "__main__":
    main()
