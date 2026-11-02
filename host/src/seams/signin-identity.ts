// Who a subscription sign-in belongs to: the account the provider's own answer names (an email, an account id, an organization), read from what the sign-in already holds. It is never a secret: the tokens
// are not kept here, only the ids and the email inside them. Two sign-ins with the same identity are the same account, so the second refreshes the first; two identities of one provider (a personal and a
// work Claude) are two accounts. When nothing in the answer names the account the identity is null and the sign-in cannot be matched to another.
// UNVERIFIED against live accounts: the Claude token answer is read for `account` and `organization` as the Claude Code sign-in reads them, the Codex id token for its email and ChatGPT account id, and
// the Grok files for any email, user id or id token they carry. A provider that stops sending these gives a null identity, never a wrong one.

export interface SigninIdentity {
  /** Stable across sign-ins of one account. Compared, never shown. */
  id: string;
  /** What a person reads beside the provider's name: the email, else the organization's name. */
  label?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const email = (v: unknown): string => { const s = str(v).toLowerCase(); return EMAIL.test(s) ? s : ""; };

/** The claims of a JWT, or null. The signature is not checked: this names the account a token the provider just gave belongs to; it grants nothing. */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try { return rec(JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"))); } catch { return null; }
}

function made(kind: string, parts: readonly string[], label: string): SigninIdentity | null {
  const named = parts.filter((p) => p !== "");
  if (named.length === 0) return null;
  return { id: `${kind}:${named.join("/")}`, ...(label !== "" ? { label } : {}) };
}

/** The Claude token answer (the exchange that gives the setup token): `account.uuid`, `account.email_address`, `organization.uuid`, `organization.name`. */
export function claudeIdentity(answer: Record<string, unknown> | null): SigninIdentity | null {
  const account = rec(answer?.["account"]), org = rec(answer?.["organization"]);
  const who = str(account?.["uuid"]) || email(account?.["email_address"]);
  const orgId = str(org?.["uuid"]);
  if (who === "" && orgId === "") return null;
  return made("claude", [who !== "" ? `acct:${who}` : "", orgId !== "" ? `org:${orgId}` : ""], email(account?.["email_address"]) || str(org?.["name"]));
}

/** The Codex id token: the ChatGPT account (a personal or a team workspace) and the person in it, and their email. */
export function codexIdentity(idToken: string): SigninIdentity | null {
  const c = jwtClaims(idToken);
  if (!c) return null;
  const auth = rec(c["https://api.openai.com/auth"]);
  const account = str(auth?.["chatgpt_account_id"]);
  const user = str(auth?.["chatgpt_user_id"]) || str(auth?.["user_id"]) || str(c["sub"]);
  const mail = email(c["email"]);
  return made("chatgpt", [account !== "" ? `acct:${account}` : "", user !== "" ? `user:${user}` : mail !== "" ? `email:${mail}` : ""], mail);
}

/** The Grok sign-in files: the first id token, email or user id found in them. */
export function grokIdentity(files: Readonly<Record<string, string>>): SigninIdentity | null {
  let user = "", mail = "";
  const visit = (v: unknown, depth: number): void => {
    if (depth > 6 || (user !== "" && mail !== "")) return;
    if (typeof v === "string") {
      const claims = v.split(".").length === 3 ? jwtClaims(v) : null;
      if (claims) { user ||= str(claims["sub"]) || str(claims["user_id"]); mail ||= email(claims["email"]); return; }
      try { const inner = JSON.parse(v) as unknown; if (inner !== null && typeof inner === "object") visit(inner, depth + 1); } catch { /* plain text */ }
      return;
    }
    const r = rec(v);
    if (r) {
      for (const [k, x] of Object.entries(r)) {
        const key = k.toLowerCase();
        if (key === "email" || key === "email_address") mail ||= email(x);
        else if (key === "user_id" || key === "userid" || key === "sub" || key === "account_id") user ||= str(x);
        else visit(x, depth + 1);
      }
    } else if (Array.isArray(v)) for (const x of v) visit(x, depth + 1);
  };
  for (const text of Object.values(files)) visit(text, 0);
  return made("grok", [user !== "" ? `user:${user}` : mail !== "" ? `email:${mail}` : ""], mail);
}

/** The identity of a saved sign-in, from the fields its Vault item holds: Codex and Grok keep files that name the account; a Claude setup token names nobody, so its identity is null. */
export function identityOfFields(provider: string, fields: readonly { key: string; value: string }[]): SigninIdentity | null {
  const creds = fields.find((f) => f.key === "credentials")?.value;
  if (creds === undefined) return null;
  let files: Record<string, string> = {};
  try { const v = rec(JSON.parse(creds)); if (v) files = Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string")); } catch { return null; }
  if (provider === "codex") {
    const auth = files[".codex/auth.json"] ?? Object.entries(files).find(([k]) => k.endsWith("auth.json"))?.[1];
    if (auth === undefined) return null;
    try { return codexIdentity(str(rec(rec(JSON.parse(auth))?.["tokens"])?.["id_token"])); } catch { return null; }
  }
  if (provider === "grok") return grokIdentity(files);
  return null;
}
