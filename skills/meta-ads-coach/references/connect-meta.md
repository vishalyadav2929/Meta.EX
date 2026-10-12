# Connecting Meta Ads to Claude

Instagram and Facebook ads both live in one Meta ad account, so a single connection covers both.

## Option 1: Export file (no setup, works today)
Ads Manager → Ads tab → date range → Reports → Export table data → .xlsx → attach the file in chat. Good enough for weekly reviews.

## Option 2: A ready connector (read live data, ~10 min)
claude.ai → Settings → Connectors → search **Windsor.ai** or **Supermetrics** (or add **Pipeboard** as a custom connector) → Connect → log in with Facebook → select the ad account → enable it in the chat. Grant read-only access if the user only wants reports. These are third-party services: read their permissions and pricing.

## Option 3: Own MCP (`meta-ex`, for running ads + auto-pause)
Repo: github.com/vishalyadav2929/Meta.EX. It needs:
1. business.facebook.com → Settings → System users → Add (Admin) → assign the ad account + Page → Generate token with `ads_read`, `ads_management`, `pages_show_list`, `business_management`.
2. Put the token in the server's `.env` (never in chat), keep `ENABLE_WRITES=false`.
3. Local: `npm install && npm run build && claude mcp add meta-ex -- node dist/stdio.js`. Remote: deploy and add `https://<host>/mcp/<secret>` as a custom connector in Claude or ChatGPT.
4. Auto-pause and the nightly report need the cron (`node dist/cron.js guard|report`), because an MCP only acts when a chat calls it.

Recommend Option 1 now and Option 2 for weekly use. Use Option 3 only when they want Claude to create, pause or launch ads.
