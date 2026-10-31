// What the chat composer's agent strip and model panel read and write (rc.8 composer). The accounts the person connected (engine.accounts.list, by the names they gave them),
// the models of the chosen account (engine.models.list), usage for that account and model (engine.usage.get: context, session and week, each left out when the engine has no
// number), the chat's mode (threads.set_mode) and an agent's model, effort and account (threads.agent.configure). Where a capability is not on the server yet, each write falls
// back to the one that does the same today (threads.set_plan_mode, engine.set_model, agents.update), so the composer works on today's backend too.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
// the panel and the logo table are imported on their own, so the chat page does not pull the whole composer in before the deferred one loads
import { ModelPanel } from "../../../../../../ui/src/Composer/ModelPanel.tsx";
import type { PanelAccount, PanelModel, PanelScope, PanelUsage } from "../../../../../../ui/src/Composer/ModelPanel.tsx";
import { brandOf } from "../../../../../../ui/src/Composer/parts.tsx";
import type { ChatMode, ComposerAgent, Effort } from "../../../../../../ui/src/Composer/brain.ts";
import { isAssistantId } from "../../../../../../ui/src/Avatar/index.tsx";
import { useOpenConnect } from "../../../shell/connect/context.ts";
import type { ConversationData } from "./data.tsx";
import type { Thread, ThreadAgent } from "./model.ts";

/* ---------- capabilities that may not exist yet ---------- */

const missing = new Set<string>();

/** True for the error a server gives for a capability it does not have (or a test double's "no write for"). */
export function isMissingCap(e: unknown): boolean {
  const err = e as { code?: string; status?: number; message?: string; error?: { code?: string } } | null;
  const code = err?.code ?? err?.error?.code ?? "";
  if (code === "validation.unknown_capability") return true;
  return /unknown_capability|no such capability|There is no such|no write for|has no HTTP route/i.test(err?.message ?? "");
}

/** Calls `cap`; when the server has no such capability, runs `fallback` instead (and remembers, so the next call goes straight there). */
export async function callOr<T>(data: Pick<ConversationData, "call">, cap: string, input: unknown, fallback: () => Promise<T>): Promise<T> {
  if (missing.has(cap)) return fallback();
  try {
    return (await data.call(cap, input)) as T;
  } catch (e) {
    if (!isMissingCap(e)) throw e;
    missing.add(cap);
    return fallback();
  }
}

/** For tests: forget which capabilities were missing. */
export function resetMissing(): void { missing.clear(); }

/* ---------- mode ---------- */

/** The chat's mode: thread.mode when the server keeps it, else Plan when plan mode is on, else Ask first. */
export function modeOf(thread: Thread): ChatMode {
  const m = (thread as Thread & { mode?: string }).mode;
  if (m === "ask" || m === "auto" || m === "plan") return m;
  return thread.planMode ? "plan" : "ask";
}

/** Sets the chat's mode. Today's backend keeps only plan mode, so Auto and Ask first both turn it off there. */
export async function setChatMode(data: Pick<ConversationData, "call" | "threadId">, mode: ChatMode): Promise<"mode" | "plan_mode"> {
  return callOr(data, "threads.set_mode", { threadId: data.threadId, mode }, async () => {
    await data.call("threads.set_plan_mode", { threadId: data.threadId, planMode: mode === "plan" });
    return "plan_mode" as const;
  }).then((r) => (r === "plan_mode" ? r : "mode"));
}

/* ---------- an agent's model, effort and account ---------- */

export interface AgentChoice { model?: string; provider?: string; effort?: Effort; accountRef?: string }

/** Sets what an agent runs on, for this chat or as the agent's default. Falls back to engine.set_model (this chat) and agents.update (the agent's own default model). */
export async function configureAgent(data: Pick<ConversationData, "call" | "threadId">, agentId: string, choice: AgentChoice, scope: PanelScope): Promise<void> {
  await callOr(data, "threads.agent.configure", { threadId: data.threadId, agentId, ...choice, scope }, async () => {
    const cur = { threadId: data.threadId, agentId, ...choice };
    await data.call("engine.set_model", cur);
    if (scope === "agent" && choice.model !== undefined) await data.call("agents.update", { agentId, patch: { model: choice.model } });
    return null;
  });
}

/* ---------- reading ---------- */

interface AccountRow { ref: string; driver: string; kind: string; title: string; name?: string; status: string }
interface UsageOut {
  account: { ref: string; name: string; provider: string; plan?: string } | null;
  context: { used: number; window: number } | null;
  session: { pct: number; resetsAt?: number } | null;
  week: { pct: number; resetsAt?: number } | null;
  source?: string;
}

/** engine.usage.get reports percent (0 to 100); the panel draws fractions. */
const frac = (pct: number): number => Math.max(0, Math.min(1, pct / 100));

export function panelUsage(out: UsageOut | null): PanelUsage | null {
  if (!out) return null;
  const meter = (m: { pct: number; resetsAt?: number } | null): PanelUsage["session"] => (m && Number.isFinite(m.pct) ? { pct: frac(m.pct), ...(m.resetsAt !== undefined ? { resetsAt: m.resetsAt } : {}) } : null);
  return { context: out.context && out.context.window > 0 ? out.context : null, session: meter(out.session), week: meter(out.week) };
}

/** Only accounts that are connected (signed in or not yet tested) are offered, by the name the person gave them. */
export function connectedAccounts(rows: readonly AccountRow[]): PanelAccount[] {
  return rows.filter((r) => r.status === "ok" || r.status === "untested").map((r) => ({ ref: r.ref, name: r.name ?? r.title, provider: r.driver, ...(r.kind === "api_key" ? { plan: "API key" } : {}) }));
}

/** "claude-sonnet-5-5" reads "Sonnet 5.5"; a model the catalog named keeps that name. */
export function prettyModel(model: string | undefined, titles?: ReadonlyMap<string, string>): string {
  if (!model) return "";
  const known = titles?.get(model);
  if (known) return known;
  const parts = model.replace(/^(claude|gpt|grok)-(?=[a-z])/i, "").split("-");
  const words: string[] = [];
  const nums: string[] = [];
  for (const p of parts) (/^\d+$/.test(p) ? nums : words).push(p);
  const name = words.map((w) => (w.length <= 3 && /^gpt$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  return [name, nums.join(".")].filter(Boolean).join(" ") || model;
}

/** The strip's view of each agent in the thread: provider, model, effort, the account's name when two accounts of one provider are connected, and the context the engine reported. */
export function stripAgents(thread: Thread, nameOf: (id: string) => string, accounts: readonly PanelAccount[], contexts: ReadonlyMap<string, { used: number; window: number } | null>): ComposerAgent[] {
  return thread.agents.map((a: ThreadAgent) => {
    const acct = accounts.find((x) => x.ref === a.accountRef);
    const sameProvider = acct ? accounts.filter((x) => brandOf(x.provider) === brandOf(acct.provider)).length : 0;
    const ctx = contexts.get(a.agentId);
    return {
      id: a.agentId, name: nameOf(a.agentId), kind: isAssistantId(a.agentId) ? "assistant" : "agent",
      ...(a.provider || acct ? { provider: a.provider ?? acct?.provider ?? "" } : {}),
      ...(a.model ? { modelTitle: prettyModel(a.model) } : {}),
      ...(a.effort ? { effort: a.effort } : {}),
      ...(acct && sameProvider > 1 ? { accountName: acct.name } : {}),
      ...(ctx !== undefined ? { context: ctx } : {}),
    } as ComposerAgent;
  });
}

/** The connected accounts, read once per conversation and again when one is connected in place. */
export function useAccounts(data: Pick<ConversationData, "call">, version = 0): PanelAccount[] | null {
  const [rows, setRows] = useState<PanelAccount[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve(data.call("engine.accounts.list", {})).then((out) => { if (live) setRows(connectedAccounts((out as { accounts?: AccountRow[] } | undefined)?.accounts ?? [])); }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, [data, version]);
  return rows;
}

/** Usage for one agent and account in this chat; null when the engine has none (or no such capability yet). Asked again when `tick` changes (a turn ended). */
export function useUsage(data: Pick<ConversationData, "call" | "threadId">, agentId: string | null, accountRef: string | null | undefined, tick = 0): PanelUsage | null | "loading" {
  const [u, setU] = useState<PanelUsage | null | "loading">("loading");
  useEffect(() => {
    if (agentId === null) { setU(null); return undefined; }
    let live = true;
    setU((cur) => (cur === null ? "loading" : cur));
    void callOr<UsageOut | null>(data, "engine.usage.get", { threadId: data.threadId, agentId, ...(accountRef ? { accountRef } : {}) }, async () => null)
      .then((out) => { if (live) setU(panelUsage(out)); }, () => { if (live) setU(null); });
    return () => { live = false; };
  }, [data, agentId, accountRef ?? "", tick]);
  return u;
}

/* ---------- the panel, wired ---------- */

export interface ChatBrainProps {
  data: ConversationData;
  thread: Thread;
  agent: ComposerAgent;
  accounts: readonly PanelAccount[] | null;
  mode: ChatMode;
  onMode(m: ChatMode): void;
  close(): void;
  narrow: boolean;
  say(text: string): void;
}

export function ChatBrain(p: ChatBrainProps): ReactElement {
  const { data, thread } = p;
  const member = thread.agents.find((a) => a.agentId === p.agent.id);
  const [scope, setScope] = useState<PanelScope>("chat");
  const [accountRef, setAccountRef] = useState<string | null>(member?.accountRef ?? null);
  const [model, setModel] = useState<string | null>(member?.model ?? null);
  const [effort, setEffort] = useState<Effort | undefined>(member?.effort);
  const [models, setModels] = useState<PanelModel[] | null>(null);
  const [fallback, setFallback] = useState<boolean | undefined>(undefined);
  const [perAccount, setPerAccount] = useState<Record<string, number | null>>({});
  const openConnect = useOpenConnect();
  const accounts = p.accounts;
  // with no account chosen on the agent yet, the first connected account of its provider (else the first) is shown as the one in use
  const shownRef = accountRef ?? (accounts ?? []).find((a) => brandOf(a.provider) === brandOf(member?.provider))?.ref ?? accounts?.[0]?.ref ?? null;
  const usage = useUsage(data, p.agent.id, shownRef);

  useEffect(() => {
    let live = true;
    setModels(null);
    void Promise.resolve(data.call("engine.models.list", { threadId: data.threadId, ...(shownRef ? { accountRef: shownRef } : {}) })).then((out) => {
      if (!live) return;
      const list = ((out as { models?: { model: string; title: string; contextTokens?: number; allowed: boolean; reason?: string }[] } | undefined)?.models ?? []);
      setModels(list.map((m) => ({ id: m.model, title: m.title, ...(m.contextTokens ? { window: m.contextTokens } : {}), allowed: m.allowed, ...(m.reason ? { reason: m.reason === "not_connected" ? "Not connected" : "Not allowed here" } : {}), ...(m.model === "auto" ? { note: "Picks per message" } : {}) })));
    }, () => { if (live) setModels([]); });
    return () => { live = false; };
  }, [data, shownRef]);

  useEffect(() => {
    let live = true;
    void Promise.resolve(data.call("engine.defaults.get", {})).then((out) => { if (live) setFallback(((out as { fallback?: unknown[] } | undefined)?.fallback ?? []).length > 0); }, () => undefined);
    return () => { live = false; };
  }, [data]);

  // each account's session, for the mini bars in the account list and the running-low suggestion
  const refs = (accounts ?? []).map((a) => a.ref).join(",");
  useEffect(() => {
    let live = true;
    for (const a of accounts ?? []) {
      void callOr<UsageOut | null>(data, "engine.usage.get", { threadId: data.threadId, agentId: p.agent.id, accountRef: a.ref }, async () => null)
        .then((out) => { if (live) setPerAccount((m) => ({ ...m, [a.ref]: panelUsage(out)?.session?.pct ?? null })); }, () => undefined);
    }
    return () => { live = false; };
  }, [data, refs, p.agent.id]);

  const withSession = useMemo(() => accounts === null ? null : accounts.map((a) => ({ ...a, session: perAccount[a.ref] ?? null })), [accounts, perAccount]);
  const providerOf = (ref: string | null): string | undefined => (accounts ?? []).find((a) => a.ref === ref)?.provider;
  const busy = useRef(0);
  const write = (choice: AgentChoice, done: string): void => {
    const n = ++busy.current;
    void configureAgent(data, p.agent.id, choice, scope).then(() => { if (n === busy.current) p.say(done); }, () => p.say("Could not change that. Try again."));
  };
  const where = scope === "chat" ? "in this chat" : "by default";

  return (
    <ModelPanel
      agent={p.agent}
      scope={scope}
      onScope={setScope}
      accounts={withSession}
      accountRef={shownRef}
      onAccount={(ref) => {
        setAccountRef(ref);
        const provider = providerOf(ref);
        // a model of another provider cannot run on this account: the engine picks this account's default until one is chosen
        const keep = provider !== undefined && brandOf(provider) === brandOf(providerOf(shownRef)) ? model : null;
        setModel(keep);
        const name = (accounts ?? []).find((a) => a.ref === ref)?.name ?? "that account";
        write({ accountRef: ref, ...(provider ? { provider } : {}), ...(keep ? { model: keep } : {}) }, `${p.agent.name} now runs on ${name} ${where}`);
      }}
      models={models}
      model={model}
      onModel={(id) => {
        setModel(id);
        const title = models?.find((m) => m.id === id)?.title ?? id;
        const provider = providerOf(shownRef);
        write({ model: id, ...(provider ? { provider } : {}), ...(shownRef ? { accountRef: shownRef } : {}) }, `${p.agent.name} now answers with ${title} ${where}`);
      }}
      effort={effort}
      onEffort={(e) => { setEffort(e); write({ effort: e, ...(model ? { model } : {}) }, `${p.agent.name} thinks with ${e} effort ${where}`); }}
      usage={usage}
      mode={p.mode}
      onMode={p.onMode}
      {...(fallback === undefined ? {} : {
        fallback,
        onFallback: (on: boolean) => {
          setFallback(on);
          const rest = (accounts ?? []).filter((a) => a.ref !== shownRef).map((a) => ({ provider: a.provider, model: "", accountRef: a.ref }));
          void Promise.resolve(data.call("engine.defaults.set", { fallback: on ? rest : [] })).then(
            () => p.say(on ? "When limits run out, the next account takes over" : "Stays on this account when limits run out"),
            () => { setFallback(!on); p.say("Could not change that. Try again."); },
          );
        },
      })}
      onAddProvider={() => { p.close(); if (openConnect) void openConnect({ kind: "ai" }); else if (data.nav.openAiSetup) data.nav.openAiSetup(); else p.say("Open the Vault and add an AI provider."); }}
      onClose={p.close}
      narrow={p.narrow}
    />
  );
}
