// A GitHub REST read for CI scripts: pages of 30, and a 5xx, a rate limit or a dropped connection is retried with a pause before it counts as a failure.
// The budget and report jobs and the release's reuse lookup used one 100-item request and failed the run on the first 502 (rc.22 and rc.23, run jobs lists of 150 jobs).
// Only reads: nothing here writes. A 4xx other than 403 and 429 is final at once (a wrong token or run id is not going to heal).

export type GetResult = { status: number; json(): Promise<unknown> };
export type Getter = (url: string, headers: Record<string, string>) => Promise<GetResult>;

export const PAGE = 30;
// GITHUB_API_URL is set by Actions (and is how the tests point this at a local server)
export const API = process.env["GITHUB_API_URL"] ?? "https://api.github.com";

const realGet: Getter = async (url, headers) => {
  const r = await globalThis.fetch(url, { headers, signal: AbortSignal.timeout(60_000) } as never);
  return { status: r.status, json: () => r.json() as Promise<unknown> };
};

export interface GetOptions { token: string; get?: Getter; attempts?: number; pauseMs?: number; sleep?: (ms: number) => Promise<void> }

const retryable = (status: number): boolean => status === 0 || status === 403 || status === 429 || status >= 500;

/** One JSON document, retried while the answer is 5xx, 403, 429 or no answer. Throws "github api <status>" when it never came. */
export async function getJson<T>(url: string, o: GetOptions): Promise<T> {
  const get = o.get ?? realGet;
  const attempts = o.attempts ?? 5;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const headers = { authorization: `Bearer ${o.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  let status = 0;
  for (let n = 1; n <= attempts; n++) {
    try {
      const r = await get(url, headers);
      status = r.status;
      if (status === 200) return (await r.json()) as T;
    } catch { status = 0; }
    if (!retryable(status) || n === attempts) break;
    await sleep((o.pauseMs ?? Number(process.env["GH_API_PAUSE_MS"] ?? 5000)) * 2 ** (n - 1));
  }
  throw new Error(`github api ${status || "no answer"} for ${url.replace(API, "")}`);
}

/** Every item of a list endpoint that answers `{ [key]: T[] }`, 30 a page, until a short page. `url` may already carry a query string. */
export async function getAll<T>(url: string, key: string, o: GetOptions): Promise<T[]> {
  const out: T[] = [];
  const sep = url.includes("?") ? "&" : "?";
  for (let page = 1; page <= 100; page++) {
    const body = await getJson<Record<string, unknown>>(`${url}${sep}per_page=${PAGE}&page=${page}`, o);
    const items = (body[key] ?? []) as T[];
    out.push(...items);
    if (items.length < PAGE) return out;
  }
  throw new Error(`github api: ${url.replace(API, "")} has more than 3000 items`);
}
