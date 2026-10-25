// Sign-in policy, second-factor report and SSO providers (spec 3.13, 3.10, ARCH 7.13). TOTP itself lives in identity; this module sets the Space rule around it and reports who has it.
// SSO is reserved in v1: providers are configured and tested here, the sign-in screens offer them, and the secret is a Vault handle, never a value stored in this module.
import type { MembersCtx } from "../projections.ts";
import { OWNER_ROLE, me, page, policyDrop, policyGet, policyPut, raise } from "../projections.ts";

const ok = { ok: true } as const;
type SsoKey = "google" | "microsoft" | "okta";
export interface Policy { secondFactor: "off" | "required"; requireSso: boolean; allowPassword: boolean; allowGithub: boolean }
export interface Sso { key: SsoKey; title: string; issuer: string; clientId: string; clientSecretHandle: string; enabled: boolean; domainHint?: string }

export const DEFAULT_POLICY: Policy = { secondFactor: "off", requireSso: false, allowPassword: true, allowGithub: true };
const SSO_KEYS: readonly SsoKey[] = ["google", "microsoft", "okta"];
const POLICY_KEYS: Record<keyof Policy, string> = {
  secondFactor: "sign_in.second_factor", requireSso: "sign_in.require_sso", allowPassword: "sign_in.allow_password", allowGithub: "sign_in.allow_github",
};

export function currentPolicy(ctx: MembersCtx): Policy { return { ...DEFAULT_POLICY, ...(policyGet<Partial<Policy>>(ctx, "sign_in") ?? {}) }; }
function providers(ctx: MembersCtx): Sso[] {
  const out: Sso[] = [];
  for (const k of SSO_KEYS) { const p = policyGet<Sso>(ctx, `sso:${k}`); if (p) out.push(p); }
  return out;
}

async function isOwner(ctx: MembersCtx, personId: string): Promise<boolean> {
  const out = (await ctx.call("access.principals.get", { principal: { kind: "person", id: personId } })) as { principal: { roles: string[] } };
  return out.principal.roles.includes(OWNER_ROLE);
}

export async function policyGetH(ctx: MembersCtx, _input: Record<string, never>) { return { policy: currentPolicy(ctx) }; }

export async function policySet(ctx: MembersCtx, input: { policy: Policy }) {
  const tid = ctx.trace.traceId;
  const who = me(ctx);
  const next = input.policy;
  const cur = currentPolicy(ctx);
  if (!next.allowPassword && !next.allowGithub && !next.requireSso) raise(tid, "validation.precondition_failed", "at least one way to sign in has to stay on");
  if (next.requireSso && !providers(ctx).some((p) => p.enabled)) raise(tid, "validation.precondition_failed", "turn on a single sign-on provider before requiring it");
  // the owner floor: only the owner may take a requirement away
  const lowers = (cur.secondFactor === "required" && next.secondFactor === "off") || (cur.requireSso && !next.requireSso);
  if (lowers && !(await isOwner(ctx, who.id))) raise(tid, "permission.role_lacks_permission", "only the owner can lower a sign-in requirement");
  // do not lock yourself out
  if (next.secondFactor === "required" && cur.secondFactor !== "required" && ctx.factors && ctx.factors.of(who.id).length === 0) {
    raise(tid, "validation.precondition_failed", "set up your own second factor first, or you would be locked out");
  }
  policyPut(ctx, "sign_in", next);
  for (const k of Object.keys(POLICY_KEYS) as (keyof Policy)[]) {
    if (cur[k] !== next[k]) ctx.emit("policy.changed", POLICY_KEYS[k], { key: POLICY_KEYS[k], scope: "space", kind: "sign_in", by: who.id });
  }
  return { policy: next };
}

export async function secondFactorReport(ctx: MembersCtx, input: { cursor?: string; limit?: number }) {
  const all: { person: { kind: "person"; id: string }; name: string; factors: "totp"[] }[] = [];
  let cursor: string | undefined;
  do {
    const out = (await ctx.call("access.principals.list", { kind: "person", status: "active", limit: 500, ...(cursor ? { cursor } : {}) })) as
      { principals: { id: string; name: string }[]; next?: string };
    for (const p of out.principals) all.push({ person: { kind: "person", id: p.id }, name: p.name, factors: ctx.factors?.of(p.id) ?? [] });
    cursor = out.next;
  } while (cursor);
  // the ones without a factor come first: they are who the floor locks out
  all.sort((a, b) => a.factors.length - b.factors.length || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
  const p = page(all, input.cursor, input.limit);
  return { people: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function ssoList(ctx: MembersCtx, _input: Record<string, never>) { return { providers: providers(ctx) }; }

export async function ssoSet(ctx: MembersCtx, input: { provider: Sso }) {
  const tid = ctx.trace.traceId;
  const p = input.provider;
  if (!SSO_KEYS.includes(p.key)) raise(tid, "validation.bad_input", "unknown provider");
  if (!p.title.trim() || !p.clientId.trim()) raise(tid, "validation.bad_input", "a provider needs a title and a client id");
  let url: URL;
  try { url = new URL(p.issuer); } catch { raise(tid, "validation.bad_input", "the issuer is not a web address"); }
  if (url.protocol !== "https:") raise(tid, "validation.bad_input", "the issuer must be an https address");
  if (!/^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/.test(p.clientSecretHandle)) raise(tid, "validation.bad_input", "the client secret is a Vault handle such as #Okta_Secret, never the value");
  const prev = providers(ctx).find((x) => x.key === p.key);
  if (prev?.enabled && !p.enabled && currentPolicy(ctx).requireSso && providers(ctx).filter((x) => x.enabled).length === 1) {
    raise(tid, "validation.precondition_failed", "single sign-on is required and this is the only provider that is on");
  }
  const row: Sso = { key: p.key, title: p.title.trim(), issuer: p.issuer.replace(/\/+$/, ""), clientId: p.clientId.trim(), clientSecretHandle: p.clientSecretHandle, enabled: p.enabled };
  if (p.domainHint?.trim()) row.domainHint = p.domainHint.trim().toLowerCase();
  policyPut(ctx, `sso:${p.key}`, row);
  ctx.emit("policy.changed", `sso.${p.key}`, { key: `sso.${p.key}`, scope: "space", kind: "sign_in", by: me(ctx).id });
  return { provider: row };
}

export async function ssoRemove(ctx: MembersCtx, input: { key: SsoKey }) {
  const tid = ctx.trace.traceId;
  const have = providers(ctx).find((x) => x.key === input.key);
  if (!have) return ok;
  if (currentPolicy(ctx).requireSso && have.enabled && providers(ctx).filter((x) => x.enabled).length === 1) {
    raise(tid, "validation.precondition_failed", "single sign-on is required and this is the only provider that is on");
  }
  policyDrop(ctx, `sso:${input.key}`);
  ctx.emit("policy.changed", `sso.${input.key}`, { key: `sso.${input.key}`, scope: "space", kind: "sign_in", by: me(ctx).id });
  return ok;
}

interface Discovery { issuer?: unknown; authorization_endpoint?: unknown; token_endpoint?: unknown; jwks_uri?: unknown }
const https = (v: unknown): v is string => typeof v === "string" && v.startsWith("https://");

export async function ssoTest(ctx: MembersCtx, input: { key: SsoKey }) {
  const p = providers(ctx).find((x) => x.key === input.key);
  if (!p) raise(ctx.trace.traceId, "validation.not_found", "that provider is not set up");
  if (!ctx.http) return { ok: false, detail: "this host cannot reach the provider" };
  try {
    const d = await ctx.http(`${p.issuer}/.well-known/openid-configuration`);
    if (d.status !== 200) return { ok: false, detail: `the discovery document answered ${d.status}` };
    const doc = JSON.parse(await d.text()) as Discovery;
    if (typeof doc.issuer !== "string" || doc.issuer.replace(/\/+$/, "") !== p.issuer) return { ok: false, detail: "the discovery document names a different issuer" };
    if (!https(doc.authorization_endpoint) || !https(doc.token_endpoint) || !https(doc.jwks_uri)) return { ok: false, detail: "the discovery document is missing an https endpoint" };
    const k = await ctx.http(doc.jwks_uri);
    const keys = k.status === 200 ? (JSON.parse(await k.text()) as { keys?: unknown }).keys : undefined;
    if (!Array.isArray(keys) || keys.length === 0) return { ok: false, detail: "the provider published no signing keys" };
    return { ok: true, detail: `${keys.length} signing key${keys.length === 1 ? "" : "s"} found; the callback to register with the provider is /auth/sso/${p.key}/callback` };
  } catch (e) {
    return { ok: false, detail: `could not read the provider: ${String(e).slice(0, 100)}` };
  }
}
