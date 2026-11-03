// The app's answers to Vyre for Chrome (apps/chrome): the bridge operations and capability calls the extension sends over the native host, answered on the daemon that hosts the
// Space, as the signed-in person (the daemon's admin token is the Space owner on this computer, the same principal the local admin door uses). One pure module, so the
// extension's end-to-end tests run it against a fake invoke and the daemon (host/src/daemon/daemon.ts) runs it against the real one.
//
// Capability calls are allowed only from the list below (the extension's own list, apps/chrome/src/worker/protocol.js, must match it: a test checks). Each runs through the
// invoke pipeline, so access, the Gate, audit and validation are the ones every other door gets. Bridge operations are built from capabilities too:
//
//   hello          the Space this daemon hosts, as the extension's Space switcher shows it
//   agents.list    agents.list, with the Assistant marked and suggested
//   chat.ask       chat.start (first message) or chat.post (later ones), the page as a web_page block and the selection as a quote; the reply streams back as chat.delta pushes
//   chat.search    chat.search (words) or chat.recent (empty search), one row per chat
//   chat.thread    threads.get and chat.messages.list
//   records.match  search.query for the email addresses and phone numbers on the page, then search.related for the record's chats
//   app.open       answered "not_available" here: the desktop app opens places itself; the extension then opens the web app

export const CHROME_CAPABILITIES = Object.freeze([
  "vault.items.match", "vault.use", "vault.fill", "vault.item.put", "vault.item.update", "vault.folders.list", "vault.folders.tree", "vault.site_rules.list", "vault.site_rules.set", "vault.share",
  "notes.clip", "skills.mine.add", "skills.share", "engine.models.list",
  "browser.sites.list", "browser.watches.list", "browser.watches.save", "browser.watches.remove", "browser.watches.report",
]);

export type InvokeResult = { status: "ok"; output: unknown } | { status: string; output?: unknown; [k: string]: unknown };
export type InvokeAs = (cap: string, input: Record<string, unknown>) => Promise<InvokeResult>;

export interface ChromeAppDeps {
  /** One capability call as the person this daemon serves. */
  invoke: InvokeAs;
  /** The Space this daemon hosts. */
  space: () => { id: string; name: string; webUrl: string };
  /** The person the calls run as (to tell their own messages apart). */
  me: () => string;
  /** Push one message to the extension (chromeBridge.push). */
  push: (m: unknown) => void;
  /** Polling for a streamed reply: how often and for how long. */
  pollMs?: number;
  replyTimeoutMs?: number;
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  now?: () => number;
}

class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "ChromeAppError"; }
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => String(v ?? "").slice(0, max);

export function createChromeApp(deps: ChromeAppDeps) {
  const pollMs = deps.pollMs ?? 700;
  const replyTimeoutMs = deps.replyTimeoutMs ?? 180_000;
  const setTimer = deps.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const now = deps.now ?? Date.now;

  async function call(cap: string, input: Record<string, unknown>): Promise<any> {
    const r = await deps.invoke(cap, input);
    if (r.status !== "ok") throw new AppError("held", `${cap} is waiting for approval in Vyre.`);
    return r.output;
  }

  /** Watch a thread for the agent's reply after `afterSeq` and push it as it grows; done when it has stopped changing for a while. */
  function streamReply(threadId: string, turnId: string, afterSeq: number): void {
    const started = now();
    let last = "";
    let still = 0;
    const tick = async (): Promise<void> => {
      try {
        const out = await call("chat.messages.list", { threadId, after: afterSeq, limit: 20 });
        const msgs = (Array.isArray(out?.messages) ? out.messages : []).filter((m: any) => m?.author?.kind === "agent" && m.kind !== "quiet");
        const text = msgs.map((m: any) => String(m.body ?? "")).filter(Boolean).join("\n\n");
        if (text && text === last) still++; else still = 0;
        if (text !== last) { last = text; deps.push({ type: "chat.delta", threadId, turnId, text, done: false }); }
        if (text && still >= 3) { deps.push({ type: "chat.delta", threadId, turnId, text, done: true }); return; }
      } catch (e) {
        deps.push({ type: "chat.delta", threadId, turnId, text: last, done: true, error: e instanceof Error ? e.message : "The reply could not be read." });
        return;
      }
      if (now() - started > replyTimeoutMs) { deps.push({ type: "chat.delta", threadId, turnId, text: last, done: true, ...(last ? {} : { error: "No reply yet. It will show in Vyre Chats." }) }); return; }
      setTimer(() => { void tick(); }, pollMs);
    };
    setTimer(() => { void tick(); }, pollMs);
  }

  async function chatAsk(input: Record<string, unknown>) {
    const text = str(input["text"], 20_000).trim();
    if (!text) throw new AppError("validation.bad_input", "Write a message first.");
    const blocks: { type: string; v: number; data: unknown }[] = [];
    const page = isObject(input["page"]) ? input["page"] : null;
    if (page && /^https?:\/\//i.test(String(page["url"] ?? ""))) {
      blocks.push({ type: "web_page", v: 1, data: { url: str(page["url"], 2000), title: str(page["title"], 300), text: str(page["text"], 20_000), ...(typeof page["shot"] === "string" && page["shot"].startsWith("data:image/") ? { shot: page["shot"] } : {}), from: "chrome" } });
    }
    const sel = isObject(input["selection"]) ? input["selection"] : null;
    if (sel && String(sel["text"] ?? "").trim()) blocks.push({ type: "quote", v: 1, data: { text: str(sel["text"], 4000), url: str(sel["url"], 2000), from: "chrome" } });
    const screen = page ? { place: "chrome", title: str(page["title"], 300) } : undefined;
    const model = typeof input["model"] === "string" && input["model"].includes("/") ? input["model"] : null;
    const [provider, modelName] = model ? [model.slice(0, model.indexOf("/")), model.slice(model.indexOf("/") + 1)] : [null, null];
    let threadId = typeof input["threadId"] === "string" && input["threadId"] ? input["threadId"] : null;
    const agentId = typeof input["agentId"] === "string" && input["agentId"] ? input["agentId"] : null;
    if (!threadId) {
      if (!agentId) throw new AppError("validation.bad_input", "Pick an agent to ask.");
      const started = await call("chat.start", { kind: "chat", agentIds: [agentId], title: text.slice(0, 80), ...(modelName ? { model: modelName, provider } : {}) });
      threadId = String(started?.thread?.threadId ?? "");
      if (!threadId) throw new AppError("internal", "The chat could not be started.");
    } else if (agentId && modelName) {
      await call("threads.agent.configure", { threadId, agentId, model: modelName, provider, scope: "chat" }).catch(() => {});
    }
    const posted = await call("chat.post", { threadId, body: text, ...(blocks.length ? { blocks } : {}), ...(screen ? { screen } : {}) });
    const seq = Number(posted?.message?.threadSeq ?? 0);
    const turnId = String(posted?.message?.messageId ?? `t${now()}`);
    streamReply(threadId, turnId, seq);
    return { threadId, turnId };
  }

  async function chatSearch(input: Record<string, unknown>) {
    const q = str(input["q"], 200).trim();
    const limit = Math.min(50, Math.max(1, Number(input["limit"] ?? 40) || 40));
    const rows = new Map<string, Record<string, unknown>>();
    if (q) {
      const out = await call("chat.search", { q, limit });
      for (const h of Array.isArray(out?.hits) ? out.hits : []) {
        if (rows.has(h.threadId)) continue;
        rows.set(h.threadId, { threadId: h.threadId, title: h.thread?.title || h.snippet || "Chat", snippet: h.snippet ?? "", updatedAt: h.at, agentId: h.thread?.agentIds?.[0] ?? null, host: null });
      }
    } else {
      const out = await call("chat.recent", {});
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (!isObject(v)) return;
        if (typeof v["threadId"] === "string" && !rows.has(v["threadId"])) rows.set(v["threadId"], { threadId: v["threadId"], title: v["title"] ?? "Chat", updatedAt: v["lastAt"] ?? v["updatedAt"] ?? null, agentId: Array.isArray(v["agentIds"]) ? v["agentIds"][0] ?? null : null, host: null });
        for (const x of Object.values(v)) if (typeof x === "object") walk(x);
      };
      walk(out);
    }
    const agents = await agentsById();
    return { threads: [...rows.values()].slice(0, limit).map((r) => ({ ...r, agentName: r["agentId"] ? agents.get(String(r["agentId"]))?.name ?? "" : "" })) };
  }

  async function agentsById() {
    const out = await call("agents.list", { limit: 100 }).catch(() => ({ agents: [] }));
    const map = new Map<string, { id: string; name: string; role: string; assistant: boolean }>();
    for (const a of Array.isArray(out?.agents) ? out.agents : []) {
      const assistant = a.role === "assistant" || a.kind === "assistant";
      map.set(String(a.agentId), { id: String(a.agentId), name: String(a.name ?? "Agent"), role: str(a.roleLine ?? a.description ?? "", 60), assistant });
    }
    return map;
  }

  async function chatThread(input: Record<string, unknown>) {
    const threadId = str(input["threadId"], 80);
    const [t, list, agents] = await Promise.all([call("threads.get", { threadId }).catch(() => null), call("chat.messages.list", { threadId, limit: 50 }), agentsById()]);
    const me = deps.me();
    const messages = (Array.isArray(list?.messages) ? list.messages : []).filter((m: any) => m.kind !== "quiet" && m.kind !== "system").map((m: any) => ({
      id: String(m.messageId), text: String(m.body ?? ""), at: m.createdAt ?? m.at ?? null,
      author: { kind: m.author?.kind ?? "agent", id: m.author?.id ?? "", me: m.author?.kind === "person" && m.author?.id === me, name: m.author?.kind === "agent" ? agents.get(m.author.id)?.name ?? "Agent" : m.author?.id === me ? "You" : "Someone", assistant: m.author?.kind === "agent" ? Boolean(agents.get(m.author.id)?.assistant) : false },
    }));
    return { threadId, title: t?.thread?.title ?? "", agentId: t?.thread?.agents?.[0]?.agentId ?? null, messages };
  }

  async function recordsMatch(input: Record<string, unknown>) {
    const keys = [...(Array.isArray(input["emails"]) ? input["emails"] : []), ...(Array.isArray(input["phones"]) ? input["phones"] : [])].map((k) => str(k, 120)).filter(Boolean).slice(0, 6);
    const found = new Map<string, Record<string, unknown>>();
    for (const k of keys) {
      const out = await call("search.query", { q: k, types: ["record"], mode: "keyword", limit: 3 }).catch(() => null);
      for (const h of Array.isArray(out?.hits) ? out.hits : []) {
        if (found.has(h.id) || h.kind !== "record") continue;
        found.set(h.id, { id: h.id, name: h.title, kind: h.recordType ?? "Record", why: k.includes("@") ? "by email address" : "by phone number" });
      }
      if (found.size >= 3) break;
    }
    const records = [];
    for (const r of [...found.values()].slice(0, 3)) {
      const rel = await call("search.related", { kind: "record", itemId: r["id"], limit: 10 }).catch(() => null);
      const chats = (Array.isArray(rel?.hits) ? rel.hits : []).filter((h: any) => h.kind === "chat").slice(0, 3).map((h: any) => ({ threadId: h.id, title: h.title, at: h.updatedAt ?? null, agentName: "" }));
      records.push({ ...r, chats, goals: [] });
    }
    return { records };
  }

  return {
    /** A capability call from the extension. */
    async invoke(cap: string, input: Record<string, unknown>): Promise<unknown> {
      if (!CHROME_CAPABILITIES.includes(cap)) throw new AppError("not_allowed", `The extension may not call ${cap}.`);
      return call(cap, input);
    },
    /** A bridge operation from the extension. */
    async op(op: string, input: Record<string, unknown>): Promise<unknown> {
      switch (op) {
        case "hello": { const s = deps.space(); return { version: "1", spaces: [s], active: s.id, locked: false }; }
        case "space.select": { if (str(input["id"], 80) !== deps.space().id) throw new AppError("validation.not_found", "This computer serves one Space."); return { active: deps.space().id }; }
        case "agents.list": {
          const list = [...(await agentsById()).values()];
          const suggested = list.find((a) => a.assistant) ?? list[0] ?? null;
          return { agents: list, suggested: suggested ? { id: suggested.id, name: suggested.name } : null };
        }
        case "ask.page": {
          const r = await chatAsk({ agentId: input["agentId"], text: input["question"], page: isObject(input["page"]) ? { url: input["page"]["url"], title: input["page"]["title"] } : null });
          return r;
        }
        case "chat.ask": return chatAsk(input);
        case "chat.search": return chatSearch(input);
        case "chat.thread": return chatThread(input);
        case "records.match": return recordsMatch(input);
        default: throw new AppError("not_available", "The Vyre app cannot answer that here.");
      }
    },
  };
}
