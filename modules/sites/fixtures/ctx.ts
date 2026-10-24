// Fake handler context for sites tests: memory tables, a recording platform, a seal that round-trips.
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { Level } from "../../../packages/contracts/src/types.ts";
import { raise, memoryPlatform, type MemoryPlatform } from "../handlers/deploy.ts";
import { memoryDb, type MemoryDb } from "./memory-db.ts";

const TRACE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SPAN = "bbbbbbbbbbbbbbbb";
const RANK: Record<Level, number> = { view: 0, use: 1, edit: 2, manage: 3 };

export interface SitesWorld {
  ctx: Ctx & { platform: MemoryPlatform };
  platform: MemoryPlatform;
  db: MemoryDb;
  events: { name: string; subject: string; payload: unknown }[];
  filled: { handle: string; into: { kind: string; ref: string } }[];
  dispatch: { fn: ((cap: string, input: unknown) => Promise<unknown>) | null };
}

export function testCtx(options?: { maxLevel?: Level; handles?: string[]; denyAll?: boolean }): SitesWorld {
  const maxLevel = options?.maxLevel ?? "edit";
  const denyAll = options?.denyAll === true;
  const allowed = new Set(options?.handles ?? ["#Staging"]);
  const platform = memoryPlatform();
  const db = memoryDb();
  const events: SitesWorld["events"] = [];
  const filled: SitesWorld["filled"] = [];
  const dispatch: SitesWorld["dispatch"] = { fn: null };
  let tick = 1_760_000_000_000;
  const now = (): number => {
    tick += 1;
    return tick;
  };
  const encode = (bytes: Uint8Array): string => {
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  };
  const decode = (text: string): Uint8Array => {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const ctx = {
    space: "spc_test",
    principal: { kind: "person" as const, id: "usr_owner" },
    trace: { traceId: TRACE, spanId: SPAN },
    origin: "user",
    depth: 0,
    now,
    db,
    platform,
    emit(name: string, subject: string, payload: unknown): EventEnvelope {
      events.push({ name: String(name), subject, payload });
      return {
        seq: events.length, id: `evt_${events.length}`, type: String(name), sv: 1, hlc: "0:0", at: tick,
        traceId: TRACE, spanId: SPAN, actor: "usr_owner", origin: "user", depth: 0, label: 0, vis: "space", enc: 0, payload,
      };
    },
    async call(cap: string, input: unknown): Promise<unknown> {
      if (!dispatch.fn) raise("internal.not_implemented", TRACE);
      return dispatch.fn(cap, input);
    },
    authorize(action: { perm: string | null; level: Level }) {
      if (denyAll || RANK[action.level] > RANK[maxLevel]) return { effect: "deny" as const, reason: "no_grant", decisionId: "dec_deny" };
      return { effect: "allow" as const, reason: "ok", decisionId: "dec_allow" };
    },
    vault: {
      async fill(handle: string, into: { kind: string; ref: string }) {
        if (!allowed.has(handle)) raise("permission.no_grant", TRACE);
        filled.push({ handle, into });
      },
      use(handle: string) {
        if (!allowed.has(handle)) raise("permission.no_grant", TRACE);
        return { handle };
      },
    },
    http: () => Promise.reject(new Error("sites tests do not call http")),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: () => Promise.reject(new Error("sites tests do not schedule")),
    seal: {
      seal(bytes: Uint8Array, scope: string) { return { keyId: "sites-test", nonce: scope, bytes: encode(bytes) }; },
      unseal(sealed: { bytes: string }) { return decode(sealed.bytes); },
    },
  };
  return { ctx: ctx as SitesWorld["ctx"], platform, db, events, filled, dispatch };
}
