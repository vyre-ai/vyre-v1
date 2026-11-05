// The app's answers to Vyre for Chrome (apps/chrome): the bridge operations and capability calls the extension sends over the native host. Every call runs as the person signed in to
// the Vyre app on this computer, in the Space they picked in the extension, with that person's own session for that Space: the desktop shell hands each signed-in session to its
// daemons (apps/desktop/src-tauri/src/chrome.rs link_chrome_space, host/src/routes/team-links.ts), and a call goes to that Space's gateway with that session, exactly as the app's own
// calls do. Nothing here can act as the Space owner or with the daemon's admin token: with nobody signed in, every call is refused with "Sign in to Vyre on this computer".
// One pure module, so the extension's end-to-end tests run it against fakes and the daemon (host/src/daemon/daemon.ts) runs it against the real gateway.
//
// Capability calls are allowed only from the list below (the extension's own list, apps/chrome/src/worker/protocol.js, must match it: a test checks). Bridge operations are built
// from capabilities too:
//
//   hello          the Spaces the person is signed in to here, and the one picked, as the extension's Space switcher shows them
//   space.select   pick one of them
//   whoami         identity.whoami in the picked Space: who the extension acts as
//   agents.list    agents.list, with the Assistant marked and suggested, and each agent that has a computer marked (a watch or a recorded skill runs there when it can)
//   chat.ask       chat.start (first message) or chat.post (later ones), the page as a web_page block and the selection as a quote; the reply streams back as chat.delta pushes
//   chat.search    chat.search (words) or chat.recent (empty search), one row per chat
//   chat.thread    threads.get and chat.messages.list
//   records.match  search.query for the email addresses and phone numbers on the page, then search.related for the record's chats
//   app.open       answered "not_available" here: the desktop app opens places itself; the extension then opens the web app

export const CHROME_CAPABILITIES = Object.freeze([
  "vault.items.match", "vault.items.list", "vault.use", "vault.fill", "vault.item.put", "vault.item.update", "vault.folders.list", "vault.site_rules.list", "vault.site_rules.set", "vault.share",
  "notes.clip", "skills.mine.add", "skills.mine.set", "skills.share", "engine.models.list",
  "browser.sites.list", "automations.watches.list", "automations.watches.save", "automations.watches.remove", "automations.watches.check", "automations.watches.report",
]);

/** Capabilities whose gateway route takes an idempotency key (generated/routes.ts "key"); a test holds this list to the route table. */
export const KEYED = Object.freeze(["vault.item.put", "vault.share", "chat.start", "chat.post", "notes.clip", "skills.mine.add", "skills.mine.set", "skills.share", "automations.watches.save", "automations.watches.remove"]);

/** A capability's gateway path: /v1/ and the name with its dots as slashes (the route table's rule). */
export const routeOf = (cap: string): string => `/v1/${cap.split(".").join("/")}`;

/**
 * One capability call to a Space's gateway with the person's own session, the way the app makes it (client/src/gateway createCapCaller, which host may not import).
 * Throws an Error with the gateway's error code; 401 is "auth.unauthenticated".
 */
export async function gatewayCall(session: ChromeSession, cap: string, input: Record<string, unknown>, o: { fetch?: typeof fetch; key?: () => string } = {}): Promise<unknown> {
  const f = o.fetch ?? fetch;
  const body = KEYED.includes(cap) && input["idempotencyKey"] === undefined ? { ...input, idempotencyKey: (o.key ?? (() => `chr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`))() } : input;
  let res: Response;
  try {
    res = await f(`${session.address.replace(/\/+$/, "")}${routeOf(cap)}`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${session.token}` }, body: JSON.stringify(body) });
  } catch { throw new AppError("offline", `${session.name || "That Space"} did not answer.`); }
  let out: any = null;
  try { out = await res.json(); } catch { /* the status decides */ }
  if (res.status >= 400 || (isObject(out) && out["error"] !== undefined)) {
    const e = isObject(out) && isObject(out["error"]) ? out["error"] : {};
    throw new AppError(typeof e["code"] === "string" ? e["code"] : res.status === 401 ? "auth.unauthenticated" : "error", typeof e["message"] === "string" ? e["message"] : res.status === 401 ? SIGNED_OUT : "Something went wrong.");
  }
  return isObject(out) ? out["data"] : undefined;
}

/** One signed-in session the desktop app handed over: the Space, its address and the person's own session token for it. */
export interface ChromeSession { id: string; name: string; address: string; token: string }

export interface ChromeAppDeps {
  /** The sessions the person is signed in with on this computer, newest last. Empty when nobody is signed in. */
  sessions: () => ChromeSession[];
  /** One capability call in a Space with that session: the Space's gateway decides access as that person. Throws with the gateway's code. */
  call: (session: ChromeSession, cap: string, input: Record<string, unknown>) => Promise<unknown>;
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
export const SIGNED_OUT = "Sign in to Vyre on this computer.";

export function createChromeApp(deps: ChromeAppDeps) {
  const pollMs = deps.pollMs ?? 700;
  const replyTimeoutMs = deps.replyTimeoutMs ?? 180_000;
  const setTimer = deps.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const now = deps.now ?? Date.now;
  let picked: string | null = null;
  const whoCache = new Map<string, string>();

  /** The session calls run with: the picked Space's, else the newest. Refused when nobody is signed in. */
  function session(): ChromeSession {
    const all = deps.sessions();
    const s = all.find((x) => x.id === picked) ?? all[all.length - 1];
    if (!s) throw new AppError("signed_out", SIGNED_OUT);
    return s;
  }

  async function call(cap: string, input: Record<string, unknown>): Promise<any> {
    return deps.call(session(), cap, input);
  }

  /** The person this session is, for telling their own messages apart. */
  async function me(): Promise<string> {
    const s = session();
    const key = `${s.id}:${s.token.slice(-8)}`;
    const hit = whoCache.get(key);
    if (hit) return hit;
    const w = await call("identity.whoami", {}).catch(() => null);
    const id = String(w?.principal?.id ?? "");
    if (id) whoCache.set(key, id);
    return id;
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
    return { threads: [...rows.values()].slice(0, limit).map((r) => ({ ...r, agentName: r["agentId"] ? agents.get(String(r["agentId"]))?.name ?? "" : "", face: r["agentId"] ? agents.get(String(r["agentId"]))?.face ?? "" : "" })) };
  }

  async function agentsById(section?: string) {
    session(); // signed out is an answer, not an empty list
    const out = await call("agents.list", { limit: 100, ...(section === "personal" ? { section } : {}) }).catch(() => ({ agents: [] }));
    // which agents have a computer: a watch or a recorded skill runs there when it can (computers.list needs the person to see computers; without it nobody is marked)
    const computers = new Set<string>();
    const cl = await call("computers.list", {}).catch(() => null);
    for (const c of Array.isArray(cl?.computers) ? cl.computers : []) if (c?.agentId) computers.add(String(c.agentId));
    const map = new Map<string, { id: string; name: string; role: string; assistant: boolean; computer: boolean; face: string }>();
    for (const a of Array.isArray(out?.agents) ? out.agents : []) {
      const assistant = a.role === "assistant" || a.kind === "assistant";
      map.set(String(a.agentId), { id: String(a.agentId), name: String(a.name ?? "Agent"), role: str(a.roleLine ?? a.description ?? "", 60), assistant, computer: computers.has(String(a.agentId)), face: typeof a.face === "string" ? a.face : "" });
    }
    return map;
  }

  async function chatThread(input: Record<string, unknown>) {
    const threadId = str(input["threadId"], 80);
    const [t, list, agents] = await Promise.all([call("threads.get", { threadId }).catch(() => null), call("chat.messages.list", { threadId, limit: 50 }), agentsById()]);
    const mine = await me();
    const messages = (Array.isArray(list?.messages) ? list.messages : []).filter((m: any) => m.kind !== "quiet" && m.kind !== "system").map((m: any) => ({
      id: String(m.messageId), text: String(m.body ?? ""), at: m.createdAt ?? m.at ?? null,
      artifacts: (Array.isArray(m.blocks) ? m.blocks : []).filter((b: any) => b?.type === "artifact" && /^sit_[a-z0-9]+$/.test(String(b?.data?.artifactId ?? ""))).slice(0, 4).map((b: any) => ({ id: String(b.data.artifactId), title: str(b.data.title ?? "Artifact", 120) })),
      author: { kind: m.author?.kind ?? "agent", id: m.author?.id ?? "", me: m.author?.kind === "person" && m.author?.id === mine, name: m.author?.kind === "agent" ? agents.get(m.author.id)?.name ?? "Agent" : m.author?.id === mine ? "You" : "Someone", assistant: m.author?.kind === "agent" ? Boolean(agents.get(m.author.id)?.assistant) : false, face: m.author?.kind === "agent" ? agents.get(m.author.id)?.face ?? "" : "" },
    }));
    return { threadId, title: t?.thread?.title ?? "", agentId: t?.thread?.agents?.[0]?.agentId ?? null, messages };
  }

  async function recordsMatch(input: Record<string, unknown>) {
    session();
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
        case "hello": {
          const all = deps.sessions();
          const active = all.find((x) => x.id === picked) ?? all[all.length - 1] ?? null;
          return { version: "1", spaces: all.map((x) => ({ id: x.id, name: x.name, webUrl: x.address })), active: active ? active.id : null, locked: false, signedIn: all.length > 0 };
        }
        case "space.select": {
          const id = str(input["id"], 124);
          if (!deps.sessions().some((x) => x.id === id)) throw new AppError("validation.not_found", "You are not signed in to that Space on this computer.");
          picked = id;
          return { active: id };
        }
        case "artifact.open": {
          // The person's own session mints the single-use code (sites.artifact_open, View level: a non-shared artifact is refused by the Space). The extension then opens the address in a tab; it never touches page cookies.
          const raw = str(input["url"], 2000);
          let id = str(input["artifactId"], 80);
          let s: ChromeSession | undefined;
          if (raw) {
            let u: URL;
            try { u = new URL(raw); } catch { throw new AppError("validation.bad_input", "That is not an address."); }
            const m = /^\/a\/(sit_[a-z0-9]+)\/?$/.exec(u.pathname);
            if (!m) throw new AppError("validation.bad_input", "That is not an artifact link.");
            id = m[1]!;
            // the link is for the Space it points at: a link to a Space this person is not signed in to here is not ours to open
            s = deps.sessions().find((x) => { try { return new URL(x.address).host === u.host; } catch { return false; } });
            if (!s) { if (deps.sessions().length === 0) throw new AppError("signed_out", SIGNED_OUT); throw new AppError("not_this_space", "You are not signed in to that Space on this computer."); }
          } else s = session();
          if (!/^sit_[a-z0-9]+$/.test(id)) throw new AppError("validation.bad_input", "Say which artifact.");
          const out = await deps.call(s, "sites.artifact_open", { artifactId: id });
          const url = typeof out?.url === "string" ? out.url : "";
          // the artifact host's one-time code, never an address with a token in it; a Space on this computer uses http://a.localhost:<port>
          if (!/^https:\/\/[^/]+\/x\/[A-Za-z0-9]+$|^http:\/\/a\.localhost(:\d+)?\/x\/[A-Za-z0-9]+$/.test(url)) throw new AppError("provider.unavailable", "The Space did not give an address to open.");
          return { url, expiresAt: out?.expiresAt ?? null };
        }
        case "artifact.thumb": {
          // A picture the extension took of an artifact the person has open. The Space keeps it only when there is none yet or the artifact changed (sites.artifact_thumb_set, View level).
          const id = str(input["artifactId"], 80);
          const thumb = str(input["thumb"], 60_000);
          if (!/^sit_[a-z0-9]+$/.test(id)) throw new AppError("validation.bad_input", "Say which artifact.");
          if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb)) throw new AppError("validation.bad_input", "That is not a small picture.");
          const out = await deps.call(session(), "sites.artifact_thumb_set", { artifactId: id, thumb });
          return { set: out?.set === true };
        }
        case "whoami": {
          const w = await call("identity.whoami", {});
          return { person: w?.principal?.id ?? null, name: w?.name ?? "", spaceId: w?.spaceId ?? session().id };
        }
        case "agents.list": {
          const list = [...(await agentsById(typeof input["section"] === "string" ? input["section"] : undefined)).values()];
          const suggested = list.find((a) => a.assistant) ?? list[0] ?? null;
          return { agents: list, suggested: suggested ? { id: suggested.id, name: suggested.name } : null };
        }
        case "people.list": {
          // who the person may pick to tell or to share with: the people of the Space they can see, and the channels they can see (with the chat each one is). Nothing beyond what their own session may read.
          session();
          const q = str(input["q"], 80).trim().toLowerCase();
          const [ps, cs] = await Promise.all([call("access.principals.list", { kind: "person", status: "active", limit: 200 }).catch(() => null), call("channels.list", {}).catch(() => null)]);
          const people = (Array.isArray(ps?.principals) ? ps.principals : []).map((p: any) => ({ id: String(p.id), name: String(p.name ?? "") })).filter((p: any) => p.name && (!q || p.name.toLowerCase().includes(q)));
          const channels = (Array.isArray(cs?.channels) ? cs.channels : []).filter((c: any) => !c.archived).map((c: any) => ({ id: String(c.channelId), threadId: String(c.mainThreadId ?? ""), name: String(c.name ?? "") })).filter((c: any) => c.threadId && (!q || c.name.toLowerCase().includes(q)));
          return { people, channels, me: await me() };
        }
        case "goals.pick": {
          // the goals the person owns that have a number to reach: a watch can count toward one
          session();
          const out = await call("goals.list", { scope: "mine", open: true }).catch(() => null);
          return { goals: (Array.isArray(out?.goals) ? out.goals : []).filter((g: any) => typeof g?.progress?.target === "number").map((g: any) => ({ id: String(g.id), title: String(g.title ?? ""), value: g.progress.value ?? null, target: g.progress.target })) };
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
