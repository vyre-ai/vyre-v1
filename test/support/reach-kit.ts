// The kit for the "made for me, usable by the maker" sweep (owner rule, 14 Nov 2026): a booted daemon with the seeded Team Space, three people (an owner, a member, a guest) and each person's own
// Assistant, and one call, `act(person, tool, input)`, that has that person's Assistant call one agent tool through the real tool pipeline (tool_search first, then the tool) and returns what the model
// was given back. Nothing inside the daemon is faked; the model stand-in only makes the one call a message names.
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, seededDir, stop, waitFor } from "./eco-live.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../../agent/src/turn-engine/types.ts";

export const PEOPLE = { owner: "usr_olivia", member: "usr_noah", guest: "usr_tess" } as const;
export type Who = keyof typeof PEOPLE;
export interface ToolOut {
  ok: boolean;
  /** what the model was given back, as text */
  text: string;
  /** the same, parsed when it is JSON */
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** One call in a chain: `input` builds the call from what the earlier steps returned, and returns null to skip the step (what it needed was never made). */
export interface Step {
  k: string;
  tool: string;
  input: (got: Record<string, ToolOut>) => Record<string, unknown> | null;
}
interface Pending {
  steps: readonly Step[];
  out: Record<string, ToolOut>;
  started?: boolean;
}

export interface Reach {
  d: Daemon;
  /** a capability as a person, over HTTP */
  as(who: Who | string, cap: string, input?: Record<string, unknown>): Promise<{ status: number; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** as(), and the call must succeed */
  must(who: Who | string, cap: string, input?: Record<string, unknown>): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** the person's own Assistant calls a tool for them */
  act(who: Who, tool: string, input: Record<string, unknown>): Promise<ToolOut>;
  /** the person's own Assistant makes calls one after another in one turn; each is a row, kept under its key */
  chain(who: Who, steps: readonly Step[], seed?: Record<string, ToolOut>): Promise<Record<string, ToolOut>>;
  assistant(who: Who): string;
  /** a Personal Space: one person and no one else to look */
  personal?: boolean;
  stop(): Promise<void>;
}

let n = 0;
const uniq = (p: string): string => `${p}-${(++n).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function scripted(): { pending: Map<string, Pending>; results: Map<string, ToolOut>; model: OpenSession } {
  const pending = new Map<string, Pending>();
  const results = new Map<string, ToolOut>();
  const model: OpenSession = async () => {
    const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
    let c = 0;
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        const body = String(input.trigger?.body ?? "");
        const m = /REACH-ACT (\S+)/.exec(body);
        const job = m ? pending.get(m[1]!) : undefined;
        if (!m || !job || job.started) {
          yield { type: "done" };
          return;
        }
        job.started = true;
        const call = (tool: string, args: unknown) => {
          const id = `c${++c}`;
          const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
          return { p, ev: { type: "tool_call" as const, id, name: tool, input: args } };
        };
        let inflight = "";
        try {
          for (const st of job.steps) {
            let input: Record<string, unknown> | null;
            try {
              input = st.input(job.out);
            } catch {
              input = null;
            }
            if (input === null) continue;
            if (process.env["REACH_TRACE"]) row({ trace: "start", tool: st.tool, t: Date.now() % 1e6 });
            const s1 = call("tool_search", { query: st.tool });
            yield s1.ev;
            await s1.p;
            if (process.env["REACH_TRACE"]) row({ trace: "searched", tool: st.tool, t: Date.now() % 1e6 });
            inflight = st.k;
            const s2 = call(st.tool, { idempotencyKey: uniq("ra"), ...input });
            yield s2.ev;
            const r = await Promise.race([
              s2.p,
              new Promise<{ ok: boolean; content: unknown }>((res) =>
                setTimeout(() => res({ ok: false, content: "NO ANSWER in 8 s (held for approval, or stuck)" }), 8_000),
              ),
            ]);
            if (typeof r.content === "string" && r.content.startsWith("NO ANSWER")) {
              job.out[st.k] = { ok: false, text: r.content, json: null };
              break;
            }
            const text = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
            let json: unknown = r.content;
            if (typeof r.content === "string") {
              try {
                json = JSON.parse(r.content);
              } catch {
                json = null;
              }
            }
            if (json !== null && typeof json === "object" && "data" in (json as object))
              json = (json as { data: unknown }).data;
            inflight = "";
            if (process.env["REACH_TRACE"]) row({ trace: "answered", tool: st.tool, t: Date.now() % 1e6, ok: r.ok });
            job.out[st.k] = { ok: r.ok, text, json };
          }
        } finally {
          if (inflight !== "" && !job.out[inflight])
            job.out[inflight] = {
              ok: false,
              text: "NO ANSWER: the turn was stopped while the call waited (held?)",
              json: null,
            };
          results.set(m[1]!, { ok: true, text: "", json: null });
        }
        yield { type: "text", text: "done" };
        yield { type: "done" };
      },
      sendToolResult(id: string, r: { ok: boolean; content: unknown }) {
        waiting.get(id)?.(r);
      },
      inject() {},
      async cancel() {},
      async close() {},
    } as EngineSession;
  };
  return { pending, results, model };
}

export async function bootReach(): Promise<Reach> {
  const { pending, results, model } = scripted();
  const ids = [...(Object.values(PEOPLE) as string[]), "usr_sana", "usr_mia", "usr_adam"];
  const ownerToken = { v: "" };
  const dir = seededDir();
  const d: Daemon = await boot(dir, model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? PEOPLE.owner : t;
      return ids.includes(id)
        ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "reach" }
        : null;
    },
  });
  ownerToken.v = d.token;
  const as: Reach["as"] = async (who, cap, input = {}) => {
    const id = (PEOPLE as Record<string, string>)[who] ?? who;
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${id}` },
      body: JSON.stringify({ idempotencyKey: uniq("rk"), ...input }),
    });
    const b = (await r.json()) as { data?: unknown };
    return { status: r.status, data: b.data ?? b };
  };
  const must: Reach["must"] = async (who, cap, input) => {
    const r = await as(who, cap, input);
    if (r.status !== 200) throw new Error(`${cap} as ${who}: ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
    return r.data;
  };
  await connect(d); // Olivia's Claude account
  // the Space's own AI account, so every person's Assistant can answer: a shared key in a shared folder, the way a team sets one up
  const keys = await must("owner", "vault.folders.create", { name: "AI accounts", scope: "shared" });
  await must("owner", "providers.add", {
    providerKey: "anthropic",
    connection: "api_key",
    apiKey: `${KEY}T`,
    name: "Team AI",
    scope: "shared",
    folderId: keys.folder.id,
  });
  const assistants = new Map<string, string>();
  const threads = new Map<string, string>();
  const seen = new Map<string, number>();
  const reach: Reach = {
    d,
    as,
    must,
    assistant(who) {
      const a = assistants.get(who);
      if (!a) throw new Error(`no assistant for ${who}`);
      return a;
    },
    async act(who, tool, input) {
      return (
        (await this.chain(who, [{ k: "x", tool, input: () => input }]))["x"] ?? {
          ok: false,
          text: "not run",
          json: null,
        }
      );
    },
    async chain(who, steps, seed) {
      const id = uniq("job");
      const job: Pending = { steps: steps.filter((s) => s.tool !== ""), out: { ...(seed ?? {}) } };
      pending.set(id, job);
      const thread = (await must(who, "chat.start", { kind: "chat", agentIds: [assistants.get(who)!] })).thread
        .threadId as string;
      await must(who, "chat.post", {
        threadId: thread,
        body: `REACH-ACT ${id}`,
        mentions: [{ kind: "agent", id: assistants.get(who)! }],
      });
      void seen;
      await waitFor(
        async () => {
          await d.hooks?.pump?.();
          return results.get(id) ?? null;
        },
        110_000,
        () =>
          JSON.stringify(
            (JSON.parse(hostLog(d)) as string[]).filter((l) => /turn failed|engine|error/i.test(l)).slice(0, 4),
          ).slice(0, 900),
      );
      return job.out;
    },
    stop: async () => {
      await stop(d);
      rmSync(dir, { recursive: true, force: true });
    },
  };
  try {
    await d.hooks?.pump?.();
    // the guest (a temporary person) holds nothing until given something by name, so she has no agent here; she is only ever "someone else" in a check
    for (const who of ["owner", "member"] as Who[]) {
      let a = await must(who, "agents.assistant_of", { personId: PEOPLE[who] });
      // a seeded person has no Assistant (the server makes one when an account is created): the person's own private agent stands in, made the way the person makes one
      if (!a.agentId) a = (await must(who, "agents.create", { name: `${who} helper`, role: "You help." })).agent;
      assistants.set(who, a.agentId);
      const t = await must(who, "chat.start", { kind: "chat", agentIds: [a.agentId] });
      threads.set(who, t.thread.threadId);
    }
  } catch (e) {
    await stop(d);
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return reach;
}

/** One line of the survey, kept in a file the lane reads afterwards (a passing test file prints nothing). */
export function row(o: Record<string, unknown>): void {
  const file = process.env["REACH_ROWS"] ?? `${process.env["TMPDIR"] ?? "/tmp"}/reach-rows.jsonl`;
  appendFileSync(file, `${JSON.stringify(o)}\n`);
}

/** The first value in a JSON tree under `key` that satisfies `want` (a depth-first look), for ids a tool answered in a shape the case does not fix. */
export function find(json: unknown, want: (o: Record<string, any>) => boolean): Record<string, any> | undefined {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  if (json === null || typeof json !== "object") return undefined;
  if (!Array.isArray(json) && want(json as Record<string, any>)) return json as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const v of Object.values(json as object)) {
    const f = find(v, want);
    if (f) return f;
  }
  return undefined;
}

/** What the sweep records for one step: `ok`, or the first words of what the model was told. */
export function said(o: ToolOut | undefined): string {
  if (!o) return "skipped";
  if (o.ok) return "ok";
  return o.text.replace(/\s+/g, " ").slice(0, Number(process.env["REACH_WIDE"] ?? 220));
}

/** Record one case's chain: a row per step, then what a person and someone else see through `peek` (a capability as a person). */
export async function record(
  r: Reach,
  c: { id: string; who: Who; outs: Record<string, ToolOut>; order: readonly string[] },
  peeks: ReadonlyArray<{ k: string; who: string; cap: string; input: Record<string, unknown> | null }> = [],
): Promise<Record<string, string>> {
  const seen: Record<string, string> = {};
  for (const k of c.order) {
    seen[k] = said(c.outs[k]);
    row({
      case: c.id,
      who: c.who,
      step: k,
      result: seen[k],
      ...(k.startsWith("make") && c.outs[k]?.ok ? { out: c.outs[k]!.text.slice(0, 260) } : {}),
    });
  }
  for (const p of peeks) {
    if (p.input === null) {
      seen[p.k] = "skipped";
      row({ case: c.id, who: c.who, step: p.k, result: "skipped" });
      continue;
    }
    const x = await r.as(p.who, p.cap, p.input);
    seen[p.k] = x.status === 200 ? "ok" : `${x.status} ${JSON.stringify(x.data).slice(0, 160)}`;
    row({ case: c.id, who: c.who, step: p.k, result: seen[p.k] });
  }
  return seen;
}

const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};

/** A Personal Space: one person who claimed it from a desktop, their own Assistant, and no one else. The same `chain` and `as`, with "owner" the only person. */
export async function bootPersonal(): Promise<Reach> {
  const { pending, results, model } = scripted();
  const dir = mkdtempSync(join(tmpdir(), "vyre-reach-personal-"));
  const d: Daemon = await boot(dir, model, {
    vault: undefined,
    workspaceRuntimeOff: true,
    config: loadConfig(
      [
        "--data-dir",
        dir,
        "--port",
        "0",
        "--space",
        "spc_reach",
        "--space-name",
        "Personal",
        "--space-kind",
        "personal",
        "--role",
        "space,device",
      ],
      {},
      "1.2.3",
    ),
  });
  const raw = async (
    token: string | null,
    cap: string,
    input: Record<string, unknown>,
  ): Promise<{ status: number; data: any }> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ idempotencyKey: uniq("rk"), ...input }),
    });
    const b = (await r.json()) as { data?: unknown };
    return { status: r.status, data: b.data ?? b };
  };
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
    const claimed = await raw(null, "identity.claim_owner", {
      code,
      spaceId: "spc_reach",
      username: "dana",
      displayName: "Dana Reyes",
      password: "correct horse battery staple 9",
      ...device,
      keys: KEYS,
    });
    if (claimed.status !== 200) throw new Error(`claim: ${JSON.stringify(claimed.data).slice(0, 300)}`);
    const signed = await raw(null, "identity.sign_in", {
      username: "dana",
      password: "correct horse battery staple 9",
      ...device,
    });
    const token = (signed.data.session as { token: string }).token;
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
      }),
    });
    if (unlock.status !== 204) throw new Error(`unlock ${unlock.status}`);
    const as: Reach["as"] = async (who, cap, input = {}) =>
      who === "owner" ? raw(token, cap, input) : { status: 401, data: { error: "no such person in a Personal Space" } };
    const must: Reach["must"] = async (who, cap, input) => {
      const r = await as(who, cap, input);
      if (r.status !== 200) throw new Error(`${cap} as ${who}: ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
      return r.data;
    };
    const folder = await must("owner", "vault.folders.create", { name: "Accounts", scope: "mine" });
    const flow = await must("owner", "providers.subscription_start", { providerKey: "claude-code" });
    await must("owner", "vault.item.put", {
      folderId: folder.folder.id,
      name: "Dana_Claude",
      kind: "ai_subscription",
      fields: [{ key: "setup_token", value: KEY, secret: true }],
    });
    const provider = await must("owner", "providers.subscription_complete", { flowId: flow.flowId });
    await must("owner", "providers.set_space_use", { providerId: provider.provider.id, allow: true });
    await d.hooks?.pump?.();
    const me = /usr_[a-z0-9]+/.exec(JSON.stringify((await as("owner", "identity.whoami", {})).data))?.[0];
    if (!me) throw new Error("no person id in the sign-in");
    const a = await must("owner", "agents.assistant_of", { personId: me });
    if (!a.agentId) throw new Error("the person has no Assistant");
    const reach: Reach = {
      d,
      as,
      must,
      assistant: () => a.agentId as string,
      async act(who, tool, input) {
        return (
          (await this.chain(who, [{ k: "x", tool, input: () => input }]))["x"] ?? {
            ok: false,
            text: "not run",
            json: null,
          }
        );
      },
      async chain(who, steps, seed) {
        const id = uniq("job");
        const job: Pending = { steps: steps.filter((st) => st.tool !== ""), out: { ...(seed ?? {}) } };
        pending.set(id, job);
        const thread = (await must(who, "chat.start", { kind: "chat", agentIds: [a.agentId] })).thread
          .threadId as string;
        await must(who, "chat.post", {
          threadId: thread,
          body: `REACH-ACT ${id}`,
          mentions: [{ kind: "agent", id: a.agentId }],
        });
        await waitFor(async () => {
          await d.hooks?.pump?.();
          return results.get(id) ?? null;
        }, 110_000);
        return job.out;
      },
      personal: true,
      stop: async () => {
        await stop(d);
        rmSync(dir, { recursive: true, force: true });
      },
    };
    return reach;
  } catch (e) {
    await stop(d);
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
