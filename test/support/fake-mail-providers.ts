// A stand-in for Google and Microsoft as a person's mailbox sees them: the token endpoint, Gmail (profile, list, message, history, send, revoke) and Graph (me, delta, message, sendMail).
// One object serves any number of accounts, each with its own refresh token and its own mail, so a test can sign two people in and look at who can read what. Nothing here opens a socket:
// `http` goes under ctx.http (daemon option `http`) and `tokenFetch` under the host seams (`seams.fetch`). Mail arrives with `deliver`, a sign-in is lost with `revoke`.
export type Provider = "google" | "microsoft";
interface Mail { id: string; folder: "inbox" | "sent"; from: string; to: string[]; subject: string; text: string; at: number; seq: number; thread: string; draft: boolean }
interface Account { provider: Provider; email: string; refresh: string; revoked: boolean; seq: number; mail: Mail[]; n: number }

const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null as string | null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const seamReply = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

export interface Seen { method: string; host: string; path: string; account?: string }

export function fakeMailProviders(now: () => number = Date.now) {
  const accounts = new Map<string, Account>();
  const tokens = new Map<string, string>();   // access token to email
  const seen: Seen[] = [];
  const sent: { email: string; to: string[]; subject: string; text: string }[] = [];
  let tokenSeq = 0;

  const account = (provider: Provider, email: string): Account => {
    let a = accounts.get(email);
    if (!a) { a = { provider, email, refresh: `rt-${email.replace(/[^a-z0-9]/gi, "_")}-LIVE`, revoked: false, seq: 1000, mail: [], n: 0 }; accounts.set(email, a); }
    return a;
  };
  const make = (a: Account, folder: Mail["folder"], from: string, to: string[], subject: string, text: string, thread?: string): Mail => {
    a.seq += 1; a.n += 1;
    const m: Mail = { id: `${a.provider === "google" ? "g" : "o"}${a.email.split("@")[0]!.replace(/[^a-z0-9]/gi, "")}${a.n}`, folder, from, to, subject, text, at: now(), seq: a.seq, thread: thread ?? `th${a.n}`, draft: false };
    a.mail.push(m);
    return m;
  };
  const owner = (init: { headers?: Record<string, string> } | undefined): Account | null => {
    const bearer = /^Bearer (.+)$/.exec(init?.headers?.["authorization"] ?? init?.headers?.["Authorization"] ?? "")?.[1];
    const email = bearer ? tokens.get(bearer) : undefined;
    const a = email ? accounts.get(email) : undefined;
    return a && !a.revoked ? a : null;
  };

  /** ctx.http: Gmail, Graph and the revoke address. */
  const http = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const entry: Seen = { method, host: u.hostname, path: u.pathname };
    seen.push(entry);
    if (u.hostname === "oauth2.googleapis.com" && u.pathname === "/revoke") {
      const t = u.searchParams.get("token");
      const a = [...accounts.values()].find((x) => x.refresh === t);
      if (a) a.revoked = true;
      return reply(200, {});
    }
    const a = owner(init);
    if (a) entry.account = a.email;
    if (!a) return reply(401, u.hostname === "gmail.googleapis.com" ? { error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } } : { error: { code: "InvalidAuthenticationToken", message: "Access token is empty or invalid." } });

    if (u.hostname === "gmail.googleapis.com") {
      const p = u.pathname.replace("/gmail/v1/users/me", "");
      if (p === "/profile") return reply(200, { emailAddress: a.email, messagesTotal: a.mail.length, threadsTotal: a.mail.length, historyId: String(a.seq) });
      if (p === "/messages" && method === "GET") return reply(200, { messages: [...a.mail].reverse().filter((m) => !m.draft).map((m) => ({ id: m.id, threadId: m.thread })), resultSizeEstimate: a.mail.length });
      if (p === "/history") {
        const from = Number(u.searchParams.get("startHistoryId") ?? 0);
        const fresh = a.mail.filter((m) => m.seq > from);
        return reply(200, { history: fresh.map((m) => ({ id: String(m.seq), messages: [{ id: m.id, threadId: m.thread }], messagesAdded: [{ message: { id: m.id, threadId: m.thread, labelIds: [m.folder === "sent" ? "SENT" : "INBOX"] } }] })), historyId: String(a.seq) });
      }
      if (p === "/messages/send" && method === "POST") {
        const raw = Buffer.from(String((JSON.parse(init.body ?? "{}") as { raw?: string }).raw), "base64url").toString("utf8");
        const header = (k: string): string => new RegExp(`^${k}: (.*)$`, "mi").exec(raw)?.[1]?.trim() ?? "";
        const rawBody = raw.split(/\r?\n\r?\n/).slice(1).join("\n").trim();
        const body = /^content-transfer-encoding:\s*base64/mi.test(raw) ? Buffer.from(rawBody.replace(/\s+/g, ""), "base64").toString("utf8") : rawBody;
        const to = header("To").split(",").map((x) => (/<([^>]+)>/.exec(x)?.[1] ?? x).trim()).filter(Boolean);
        const m = make(a, "sent", a.email, to, header("Subject"), body);
        sent.push({ email: a.email, to, subject: m.subject, text: m.text });
        return reply(200, { id: m.id, threadId: m.thread, labelIds: ["SENT"] });
      }
      const one = /^\/messages\/([^/]+)$/.exec(p);
      if (one) {
        const m = a.mail.find((x) => x.id === one[1]);
        if (!m) return reply(404, { error: { code: 404, errors: [{ reason: "notFound" }] } });
        return reply(200, {
          id: m.id, threadId: m.thread, labelIds: [m.folder === "sent" ? "SENT" : "INBOX"], snippet: m.text.slice(0, 80), historyId: String(m.seq), internalDate: String(m.at),
          payload: {
            mimeType: "text/plain",
            headers: [{ name: "From", value: m.from }, { name: "To", value: m.to.join(", ") }, { name: "Subject", value: m.subject }, { name: "Message-ID", value: `<${m.id}@fake.test>` }],
            body: { size: m.text.length, data: b64(m.text) },
          },
        });
      }
      return reply(404, { error: { code: 404, errors: [{ reason: "notFound" }] } });
    }

    if (u.hostname === "graph.microsoft.com") {
      const p = u.pathname.replace("/v1.0", "");
      if (p === "/me") return reply(200, { mail: a.email, userPrincipalName: a.email, displayName: a.email.split("@")[0] });
      if (p === "/me/sendMail" && method === "POST") {
        const msg = (JSON.parse(init.body ?? "{}") as { message: { subject: string; body: { content: string }; toRecipients: { emailAddress: { address: string } }[] } }).message;
        const to = msg.toRecipients.map((r) => r.emailAddress.address);
        make(a, "sent", a.email, to, msg.subject, msg.body.content);
        sent.push({ email: a.email, to, subject: msg.subject, text: msg.body.content });
        return reply(202, "");
      }
      const delta = /^\/me\/mailFolders\/(inbox|sentitems)\/messages\/delta$/.exec(p);
      if (delta) {
        const folder = delta[1] === "inbox" ? "inbox" : "sent";
        const since = Number(/deltatoken=(\d+)/.exec(u.search)?.[1] ?? 0);
        const fresh = a.mail.filter((m) => m.folder === folder && m.seq > since);
        return reply(200, { value: fresh.map((m) => ({ id: m.id, isDraft: false })), "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/${delta[1]}/messages/delta?$deltatoken=${a.seq}` });
      }
      const attachments = /^\/me\/messages\/([^/]+)\/attachments$/.exec(p);
      if (attachments) return reply(200, { value: [] });
      const one = /^\/me\/messages\/([^/]+)$/.exec(p);
      if (one) {
        const m = a.mail.find((x) => x.id === one[1]);
        if (!m) return reply(404, { error: { code: "ErrorItemNotFound" } });
        return reply(200, {
          id: m.id, internetMessageId: `<${m.id}@fake.test>`, conversationId: m.thread, subject: m.subject, from: { emailAddress: { address: m.from } },
          toRecipients: m.to.map((address) => ({ emailAddress: { address } })), receivedDateTime: new Date(m.at).toISOString(), sentDateTime: new Date(m.at).toISOString(),
          isDraft: false, hasAttachments: false, body: { contentType: "text", content: m.text },
        });
      }
      return reply(404, { error: { code: "ResourceNotFound" } });
    }
    return reply(404, {});
  };

  /** The host seam's fetch: the OAuth token endpoints of both providers. */
  const tokenFetch = async (url: string, init: { method?: string; body?: string | Uint8Array } = {}) => {
    const u = new URL(url);
    seen.push({ method: init.method ?? "GET", host: u.hostname, path: u.pathname });
    if (!/\/token$/.test(u.pathname)) return seamReply(404, {});
    const form = new URLSearchParams(typeof init.body === "string" ? init.body : "");
    const grant = form.get("grant_type");
    let a: Account | undefined;
    if (grant === "authorization_code") a = accounts.get(String(form.get("code")).replace(/^code-/, ""));
    else if (grant === "refresh_token") a = [...accounts.values()].find((x) => x.refresh === form.get("refresh_token"));
    if (!a || a.revoked) return seamReply(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    const token = `at-${++tokenSeq}-${a.email}`;
    tokens.set(token, a.email);
    return seamReply(200, { access_token: token, expires_in: 3600, token_type: "Bearer", ...(grant === "authorization_code" ? { refresh_token: a.refresh } : {}) });
  };

  return {
    http, tokenFetch, seen, sent,
    /** the mailbox exists at the provider; `mail` is what it already holds */
    open(provider: Provider, email: string, mail: { from: string; subject: string; text: string }[] = []): Account {
      const a = account(provider, email);
      for (const m of mail) make(a, "inbox", m.from, [email], m.subject, m.text);
      return a;
    },
    /** new mail arrives */
    deliver(email: string, m: { from: string; subject: string; text: string }): void {
      const a = accounts.get(email);
      if (!a) throw new Error(`no such account ${email}`);
      make(a, "inbox", m.from, [email], m.subject, m.text);
    },
    /** the person removes the app's access at the provider: refresh and access tokens stop working */
    revoke(email: string): void { const a = accounts.get(email); if (a) a.revoked = true; },
    /** the person lets the app in again */
    restore(email: string): void { const a = accounts.get(email); if (a) a.revoked = false; },
    /** the sign-in code the provider's page hands back for this account */
    codeFor: (email: string): string => `code-${email}`,
    refreshOf: (email: string): string => accounts.get(email)?.refresh ?? "",
    count: (email: string): number => accounts.get(email)?.mail.length ?? 0,
    calls(host: string, pathPrefix = ""): Seen[] { return seen.filter((s) => s.host === host && s.path.startsWith(pathPrefix)); },
  };
}
export type FakeMailProviders = ReturnType<typeof fakeMailProviders>;
