// All runtime settings come from environment variables. Never hardcode secrets.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  metaAccessToken: process.env.META_ACCESS_TOKEN ?? "",
  metaApiVersion: process.env.META_API_VERSION ?? "v25.0",
  defaultAdAccountId: process.env.META_AD_ACCOUNT_ID ?? "",

  // What counts as a "lead". Messaging conversations by default; add form leads if you use lead forms.
  leadActionTypes: list("LEAD_ACTION_TYPES", [
    "onsite_conversion.messaging_conversation_started_7d",
    "lead",
    "onsite_conversion.lead_grouped",
  ]),

  // Safety rails.
  writesEnabled: process.env.ENABLE_WRITES === "true",
  maxDailyBudgetInr: num("MAX_DAILY_BUDGET_INR", 1000),

  // Guard rules (auto-pause). Starting guesses; tune from your own data.
  rules: {
    targetCplInr: num("TARGET_CPL_INR", 60),
    noLeadSpendInr: num("RULE_NO_LEAD_SPEND_INR", 900),
    cplMultiplier: num("RULE_CPL_MULTIPLIER", 2),
    maxFrequency: num("RULE_MAX_FREQUENCY", 3),
    learningHours: num("RULE_LEARNING_HOURS", 48),
    lookbackDays: num("RULE_LOOKBACK_DAYS", 3),
  },

  // HTTP transport.
  port: num("PORT", 3000),
  mcpPathSecret: process.env.MCP_PATH_SECRET ?? "",

  // Optional WhatsApp Cloud API daily report.
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    to: process.env.WHATSAPP_REPORT_TO ?? "",
    template: process.env.WHATSAPP_TEMPLATE ?? "",
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG ?? "en",
  },
};

export function normalizeAdAccountId(id?: string): string {
  const raw = (id || config.defaultAdAccountId).trim();
  if (!raw) throw new Error("No ad account id. Pass ad_account_id or set META_AD_ACCOUNT_ID.");
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}
