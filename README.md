# Meta.EX: Meta Ads MCP for local businesses

Ek hi MCP server jo Claude aur ChatGPT dono se connect hota hai. Ye pichhle ads ka audit karta hai, warm audiences banata hai, PAUSED campaign draft banata hai, kharab ads ko auto-pause karta hai, aur raat ko lead report bhejta hai.

Pehla use case: wedding anchor ka account (~₹55k ki history), ₹300-500/day.

## Why not merge the existing Meta Ads MCPs?

300+ Meta Ads MCPs already exist (pipeboard, Ryze, hashcott, mikusnuz, ...). Combining them gives you 100-200 overlapping tools. The model then picks the wrong one, and Pipeboard's BSL license blocks selling a competing service. So this repo takes their best ideas and keeps only **10 tools**:

| Idea | Taken from |
|---|---|
| Writes off by default (`ENABLE_WRITES`) | hashcott/meta-ads-mcp-server |
| Everything created PAUSED, activation needs `confirm=true` | attainmentlabs, Ryze |
| Learning-phase aware diagnosis | mathiaschu/meta-ads-analyzer |
| One remote URL for Claude + ChatGPT | pipeboard |

What this repo adds on top: lead estimates from the account's own CPL history, warm-audience-first playbook, INR budget cap, auto-pause rules, WhatsApp daily report.

## Tools

| Tool | Type | Kya karta hai |
|---|---|---|
| `list_ad_accounts` | read | Saare ad accounts |
| `check_account_setup` | read | Account active? Payment? Page + IG linked? |
| `audit_account` | read | Total spend/leads/CPL, winning ads (creative id ke saath), zero-lead ads |
| `estimate_leads` | read | "₹500 me kitni leads?" Pichhle CPL se range batata hai |
| `search_location` | read | City ka Meta key |
| `get_results` | read | Aaj/kal/7 din: spend, leads, CPL |
| `run_guard` | write | Auto-pause rules (default dry run) |
| `create_warm_audiences` | write | IG engagers (365d) + 1% lookalike |
| `create_messages_campaign_draft` | write | Messages campaign, **PAUSED**, winning creatives reuse |
| `set_status` | write | Pause / activate (`ACTIVE` ke liye `confirm=true`) |

Guard rules (`.env` me tune karo): ₹900 spend + 0 leads → pause; CPL > 2× target → pause; frequency > 3 → alert; ek ad baaki se 40% sasta → budget badhane ka alert; pehle 48 ghante kuch nahi.

## Setup

```bash
npm install
cp .env.example .env      # META_ACCESS_TOKEN, META_AD_ACCOUNT_ID bharo
npm test
npm run build
```

Token: Meta Business Settings → System Users → token generate karo (`ads_management`, `ads_read`, `pages_show_list`, `business_management`). Ye v1 sirf apne/managed accounts ke liye hai.

### Claude Desktop / Claude Code (local)

```bash
claude mcp add meta-ex -- node /path/to/Meta.EX/dist/stdio.js
```

### Claude.ai + ChatGPT (remote)

1. Deploy karo (Railway/Render): `npm run build && npm start`, saath me `.env` variables set karo, aur `MCP_PATH_SECRET` me ek lamba random string daalo.
2. URL: `https://<your-app>/mcp/<MCP_PATH_SECRET>`
3. Claude: Settings → Connectors → Add custom connector → URL paste karo.
4. ChatGPT: Settings → Connectors → Developer mode → Create → same URL.

(Menu ke naam badalte rehte hain, latest docs check kar lena.)

### Cron (auto-pause + nightly report)

MCP tabhi chalta hai jab chat use call kare. Auto-pause ke liye scheduler chahiye:

```bash
node dist/cron.js guard    # har 2-3 ghante
node dist/cron.js report   # raat 10 baje -> console + WhatsApp (template configured ho to)
```

`ENABLE_WRITES=false` hone par guard sirf dry run me chalta hai, kuch pause nahi karta.

## Recommended flow (wedding anchor example)

1. `check_account_setup`
2. `audit_account`: top 3 reels aur unka CPL nikalo
3. `estimate_leads budget_inr=500`: realistic range
4. `create_warm_audiences`: IG engagers + lookalike
5. `search_location Jaipur` → `create_messages_campaign_draft` (warm audience ids + winning creative ids, ₹250-500/day)
6. User approve kare → `set_status <campaign_id> ACTIVE confirm=true`
7. Cron guard + nightly report

## Known limits (honest)

- **Single tenant.** Abhi ek token hai. Har client ka apna login chahiye to OAuth (Facebook Login) aur Meta App Review + Business Verification lagega. Ye roadmap ka next step hai.
- **Write payloads ko tester account pe verify karo.** Messages campaign, custom audience aur lookalike ke fields Meta Marketing API docs se banaye gaye hain, par Meta har version me fields badalta rehta hai. Pehla run chhote budget pe karo. Meta error aaye to tool uska message waise hi dikha deta hai.
- `creative_ids` pichhle **Messages** ads ke hone chahiye, taaki unka CTA destination se match kare.
- Guard ke date ranges server ke timezone ke hisaab se chalte hain. Server ka `TZ` ad account ke timezone pe set karo (jaise `Asia/Kolkata`).
