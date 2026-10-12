// Scheduled jobs. An MCP only acts when a chat calls it, so auto-pause and the daily
// report run here, from a scheduler (Railway cron, GitHub Actions, crontab).
//   node dist/cron.js guard   -> every 2-3 hours
//   node dist/cron.js report  -> once a night
import { config } from "./config.js";
import { adStats, runGuard } from "./meta/ops.js";

const accounts = (process.env.CRON_AD_ACCOUNT_IDS || config.defaultAdAccountId).split(",").map((s) => s.trim()).filter(Boolean);

async function guard() {
  const dryRun = !config.writesEnabled;
  for (const act of accounts) {
    const r = await runGuard(act, dryRun);
    console.log(JSON.stringify({ account: act, dryRun, ...r }));
  }
}

async function report() {
  for (const act of accounts) {
    const { total } = await adStats(act, { datePreset: "today" }, "campaign");
    const text = `Aaj ka report (${act}): ₹${total.spend} kharch, ${total.leads} leads, ${total.cpl ? `₹${total.cpl}/lead` : "abhi koi lead nahi"}.`;
    console.log(text);
    await sendWhatsApp([String(total.spend), String(total.leads), total.cpl ? String(total.cpl) : "-"]);
  }
}

// Business-initiated WhatsApp messages need an approved template with 3 body params: spend, leads, CPL.
async function sendWhatsApp(params: string[]) {
  const w = config.whatsapp;
  if (!w.token || !w.phoneNumberId || !w.to || !w.template) return;
  const res = await fetch(`https://graph.facebook.com/${config.metaApiVersion}/${w.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${w.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: w.to,
      type: "template",
      template: {
        name: w.template,
        language: { code: w.templateLang },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  if (!res.ok) console.error("WhatsApp send failed:", res.status, await res.text());
}

const job = process.argv[2];
if (!accounts.length) throw new Error("Set CRON_AD_ACCOUNT_IDS or META_AD_ACCOUNT_ID.");
if (job === "guard") await guard();
else if (job === "report") await report();
else throw new Error("Usage: cron.js guard|report");
