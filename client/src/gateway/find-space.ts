// What is at a Space address, asked of the address: a Space server of its own (direct), a name Vyre's relay holds (relay), something this page cannot read as a Space (there), nothing (none),
// or no answer at all (offline). One answer for every
// way in (the address box, a link, a saved Space, a join, a claim), so a failure can say what happened and offer the fix that fits, and a Space that moved between the relay and its own
// address is found where it is now. In the client layer because apps never fetch (boundary B4).
//
// The relay answers /__vyre/info.json for a name it holds ({ name, label, route, relay, online }) and, from rc.41, for a vyre.run name nobody holds ({ name, held: false }), both readable from
// any page. A relay deployed before that sends no CORS header, so another page cannot read its answer: then only "something answered" is known and the name rule stands, marked unsure.
import { probeDirectSpace, PROBE_TIMEOUT_MS, type ProbeOptions } from "./space-probe.ts";

export type Found =
  | { kind: "direct" }
  /** `sure` is false when only the name says so (an older relay, see above). `online`: a computer of the Space is awake. `seenAt`: when one last was, in ms. */
  | { kind: "relay"; sure: boolean; label: string; online: boolean; seenAt: number | null }
  /** Something answers at the address, but not as a Space this page can read: another website, or (from a web page of another address, which a Space server does not answer) a Space. */
  | { kind: "there" }
  | { kind: "none" }
  | { kind: "offline" };

export interface RelayName {
  name: string;
  label: string;
  online: boolean;
  seenAt: number | null;
}

export interface FindOptions extends ProbeOptions {
  /** The zone relay names live under. */
  zone?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** <name>.<zone>: the only shape a relay name has. */
export function relayShaped(address: string, zone = "vyre.run"): boolean {
  try {
    const host = new URL(address).hostname.toLowerCase();
    return host.endsWith(`.${zone}`) && host.split(".").length === zone.split(".").length + 1;
  } catch {
    return false;
  }
}

async function timed<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(ctl.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctl.abort();
          reject(new Error("timed out"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * What the relay says about a name. `held`: the relay holds it for a Space. `answered`: something answered at the name at all (false: no network, or no such host).
 * `free` is true only when the relay itself said nobody holds the name.
 */
export async function relayName(
  address: string,
  o: FindOptions = {},
): Promise<{ held: RelayName | null; answered: boolean; free?: boolean }> {
  let origin: string;
  try {
    origin = new URL(address).origin;
  } catch {
    return { held: null, answered: false };
  }
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ms = o.timeoutMs ?? PROBE_TIMEOUT_MS;
  const url = `${origin}/__vyre/info.json`;
  try {
    return await timed(ms, async (signal) => {
      const res = await doFetch(url, { method: "GET", cache: "no-store", redirect: "error", signal });
      if (!/^application\/json\b/i.test(res.headers.get("content-type") ?? "")) return { held: null, answered: true };
      const j: unknown = await res.json().catch(() => null);
      if (!isObj(j)) return { held: null, answered: true };
      if (res.status === 200 && typeof j["name"] === "string" && typeof j["route"] === "string") {
        const computers = Array.isArray(j["computers"]) ? j["computers"].filter(isObj) : [];
        const seen = [j["seenAt"], ...computers.map((c) => c["seenAt"])].filter(
          (n): n is number => typeof n === "number" && Number.isFinite(n),
        );
        return {
          held: {
            name: j["name"],
            label: typeof j["label"] === "string" ? j["label"] : "",
            online: j["online"] === true,
            seenAt: seen.length ? Math.max(...seen) : null,
          },
          answered: true,
        };
      }
      return { held: null, answered: true, ...(j["held"] === false ? { free: true } : {}) };
    });
  } catch {
    /* unreadable from this page (no CORS header), offline or slow: ask whether anything is there at all */
  }
  try {
    await timed(ms, (signal) => doFetch(url, { method: "GET", mode: "no-cors", cache: "no-store", signal }));
    return { held: null, answered: true };
  } catch {
    return { held: null, answered: false };
  }
}

/** One ask. See the top of the file for what each answer means. */
export async function findSpace(address: string, o: FindOptions = {}): Promise<Found> {
  let origin: string;
  try {
    const u = new URL(address);
    if (u.protocol !== "https:" && u.protocol !== "http:") return { kind: "none" };
    origin = u.origin;
  } catch {
    return { kind: "none" };
  }
  const named = relayShaped(origin, o.zone);
  const [direct, relay] = await Promise.all([
    probeDirectSpace(origin, o),
    named ? relayName(origin, o) : Promise.resolve(null),
  ]);
  if (direct) return { kind: "direct" };
  if (!relay) {
    // an address of its own that did not answer as a Space: is anything there at all?
    const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    try {
      const res = await timed(o.timeoutMs ?? PROBE_TIMEOUT_MS, (signal) =>
        doFetch(`${origin}/healthz`, { method: "GET", mode: "no-cors", cache: "no-store", signal }),
      );
      // an answer this page can read that is a server error (the page's own address, with the Space's server down behind its proxy) is a Space that is not answering, not "no Space"
      return res.type !== "opaque" && res.status >= 500 ? { kind: "offline" } : { kind: "there" };
    } catch {
      return { kind: "offline" };
    }
  }
  if (relay.held)
    return {
      kind: "relay",
      sure: true,
      label: relay.held.label,
      online: relay.held.online,
      seenAt: relay.held.seenAt,
    };
  if (relay.free) return { kind: "none" };
  if (relay.answered) return { kind: "relay", sure: false, label: "", online: true, seenAt: null };
  return { kind: "offline" };
}

export interface QuietOptions extends FindOptions {
  /** How long to wait before each new try; its length is the number of quiet retries. */
  waits?: readonly number[];
  /** Injectable for tests. */
  wait?: (ms: number) => Promise<void>;
  /** Called as each quiet retry starts (1, 2, ...): the screen shows "Reconnecting". */
  onRetry?: (attempt: number) => void;
}

export const QUIET_WAITS: readonly number[] = [700, 1600];
let quietWaits: readonly number[] = QUIET_WAITS;
/** Test seam: how long the quiet retries wait, for a test that walks a screen through them. Answers the way back to the product's waits. */
export function setQuietWaitsForTests(waits: readonly number[]): () => void {
  const was = quietWaits;
  quietWaits = waits;
  return () => {
    quietWaits = was;
  };
}

/** findSpace with the quiet retry every way in shares: no answer at all is asked again, twice, before anyone is told. A sure answer (direct, the relay's, none) is final at once. */
export async function findSpaceQuietly(address: string, o: QuietOptions = {}): Promise<Found> {
  const waits = o.waits ?? quietWaits;
  const wait = o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let found = await findSpace(address, o);
  for (let i = 0; i < waits.length && found.kind === "offline"; i++) {
    o.onRetry?.(i + 1);
    await wait(waits[i]!);
    found = await findSpace(address, o);
  }
  return found;
}
