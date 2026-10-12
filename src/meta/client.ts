import { config } from "../config.js";

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly subcode?: number,
  ) {
    super(message);
  }
}

type Params = Record<string, unknown>;

function encode(params: Params): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    qs.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  return qs;
}

function token(): string {
  if (!config.metaAccessToken) throw new Error("META_ACCESS_TOKEN is not set.");
  return config.metaAccessToken;
}

async function call<T>(method: "GET" | "POST", path: string, params: Params = {}): Promise<T> {
  const base = `https://graph.facebook.com/${config.metaApiVersion}/${path.replace(/^\//, "")}`;
  const body = encode({ ...params, access_token: token() });
  const res =
    method === "GET"
      ? await fetch(`${base}?${body}`)
      : await fetch(base, { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    const msg = e.error_user_msg || e.message || `Meta API ${res.status}`;
    throw new MetaApiError(msg, res.status, e.code, e.error_subcode);
  }
  return json as T;
}

export const graph = {
  get: <T = any>(path: string, params?: Params) => call<T>("GET", path, params),
  post: <T = any>(path: string, params?: Params) => call<T>("POST", path, params),

  /** Follows cursor pagination up to `maxPages`. */
  async getAll<T = any>(path: string, params: Params = {}, maxPages = 20): Promise<T[]> {
    const out: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await call<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(
        "GET",
        path,
        { limit: 200, ...params, after },
      );
      out.push(...(res.data ?? []));
      after = res.paging?.next ? res.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return out;
  },
};
