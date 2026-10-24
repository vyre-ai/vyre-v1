// Vault use by name, at run time (ARCH 6.11, spec 2.17). The model works with handles. For a tool that really uses a secret the executor receives a copy of the arguments with
// values substituted; the transcript keeps the arguments as written; the output is scrubbed before anything else sees it; a value that still shows is a vault.scrub_miss.
import { createScrubber, FRAGMENT_TAIL, MIN_SECRET_LENGTH, WITHHELD } from "./scrub.ts";
import type { Secret } from "./scrub.ts";
import { DEPLOY_TOOLS, FILL_TOOLS, handlesInArgs, substitute } from "./handles.ts";
import type { Place } from "./handles.ts";

export type Where = "host" | "device" | "computer";

export type Lookup =
  | { kind: "value"; itemId: string; value: string; spaceOnly: boolean; injectIntoDeployments: boolean }
  | { kind: "unknown" }
  | { kind: "denied"; reason: "no_access" | "provider_label" | "other" };

export interface ValueSource {
  /** Resolve a handle for the agent acting for the asker, in the process that will use it. The value stays in this process. */
  lookup(handle: string, who: { agentId: string; asker: string; where: Where }): Promise<Lookup>;
}

export interface VaultRunDeps {
  source: ValueSource;
  /** vault.report_scrub_miss: ids and place only, never a value. */
  reportMiss(r: { itemId: string; place: Place; traceId: string }): void | Promise<void>;
}

export interface VaultCall { tool: string; args: unknown; traceId: string; agentId: string; asker: string; where: Where }

export interface Used { handle: string; itemId: string }

export type VaultRun =
  | {
    ok: true;
    /** The arguments as the model wrote them: what the transcript keeps. */
    display: unknown;
    /** Scrubbed. A stream stays a stream. */
    output: string | AsyncIterable<string>;
    used: Used[];
    /** Set when the scrubber found a leftover fragment and withheld the output. */
    scrubMiss: boolean;
  }
  | { ok: false; display: unknown; used: Used[]; error: { code: "permission.no_grant" | "permission.provider_label" | "validation.bad_input" | "provider.unavailable"; message: string; handle?: string } };

export type Executor = (args: unknown) => Promise<string | AsyncIterable<string>>;

/** Run one tool call with Vault handles filled in at the last moment. */
export async function runWithVault(deps: VaultRunDeps, call: VaultCall, exec: Executor): Promise<VaultRun> {
  const place = FILL_TOOLS[call.tool];
  const named = place === undefined ? [] : handlesInArgs(call.args);
  const values = new Map<string, string>();
  const secrets: Secret[] = [];
  const used: Used[] = [];

  for (const h of named) {
    const r = await deps.source.lookup(h, { agentId: call.agentId, asker: call.asker, where: call.where });
    if (r.kind === "unknown") continue;   // not a Vault handle after all (a hashtag, a color): leave the text alone
    if (r.kind === "denied") {
      const code = r.reason === "provider_label" ? "permission.provider_label" : "permission.no_grant";
      return { ok: false, display: call.args, used, error: { code, handle: h, message: `You cannot use ${h} here.` } };
    }
    if (r.spaceOnly && call.where !== "host") {
      return { ok: false, display: call.args, used, error: { code: "permission.no_grant", handle: h, message: `${h} fills on the Space host only.` } };
    }
    if (DEPLOY_TOOLS.has(call.tool) && !r.injectIntoDeployments) {
      return { ok: false, display: call.args, used, error: { code: "permission.no_grant", handle: h, message: `${h} is not set to inject into deployments.` } };
    }
    if (r.value.length < MIN_SECRET_LENGTH) {
      return { ok: false, display: call.args, used, error: { code: "validation.bad_input", handle: h, message: `${h} is too short to fill safely.` } };
    }
    values.set(h, r.value);
    secrets.push({ handle: h, itemId: r.itemId, value: r.value });
    used.push({ handle: h, itemId: r.itemId });
  }

  if (secrets.length === 0) {
    // Nothing was filled, so nothing needs scrubbing.
    try { return { ok: true, display: call.args, output: await exec(call.args), used, scrubMiss: false }; }
    catch (e) { return { ok: false, display: call.args, used, error: { code: "provider.unavailable", message: e instanceof Error ? e.message : "The tool failed." } }; }
  }

  const scrubber = createScrubber(secrets);
  const filled = substitute(call.args, values);
  const miss = async (hit: Secret[]): Promise<void> => {
    for (const s of hit) await deps.reportMiss({ itemId: s.itemId, place: place ?? "terminal", traceId: call.traceId });
  };

  let raw: string | AsyncIterable<string>;
  try { raw = await exec(filled); }
  catch (e) {
    // An error message can echo the command line or a header; it goes through the same scrubber.
    const text = scrubber.scrub(e instanceof Error ? e.message : "The tool failed.");
    const hit = scrubber.residual(text);
    if (hit.length) await miss(hit);
    return { ok: false, display: call.args, used, error: { code: "provider.unavailable", message: hit.length ? WITHHELD : text } };
  }

  if (typeof raw === "string") {
    const text = scrubber.scrub(raw);
    const hit = scrubber.residual(text);
    if (hit.length) { await miss(hit); return { ok: true, display: call.args, output: WITHHELD, used, scrubMiss: true }; }
    return { ok: true, display: call.args, output: text, used, scrubMiss: false };
  }

  // A stream cannot be withheld after the fact, so the leftover check runs on every emitted piece and the rest of the stream is replaced from the first miss.
  const guarded = (async function* (): AsyncGenerator<string> {
    let tripped = false;
    let tail = "";   // a fragment can straddle two pieces
    for await (const piece of scrubber.stream(raw)) {
      if (tripped) continue;
      const hit = scrubber.residual(tail + piece);
      if (hit.length) { tripped = true; await miss(hit); yield WITHHELD; continue; }
      tail = (tail + piece).slice(-(FRAGMENT_TAIL));
      yield piece;
    }
  })();
  return { ok: true, display: call.args, output: guarded, used, scrubMiss: false };
}

