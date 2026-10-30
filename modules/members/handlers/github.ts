// GitHub sign-in app (spec 3.13): the OAuth app's client id and secret, set by an admin. The secret is put in the Vault as a Space item by the host and only its handle is kept here;
// no reply, event or audit row carries it. The server environment (VYRE_GH_OAUTH_CLIENT_ID and _SECRET) wins when both are present.
import type { MembersCtx } from "../projections.ts";
import { me, policyDrop, policyGet, policyPut, raise } from "../projections.ts";

interface GithubApp { clientId: string; secretHandle: string }
const KEY = "github_app";
const CLIENT_ID = /^[A-Za-z0-9._-]{8,80}$/;

function answer(ctx: MembersCtx) {
  const saved = policyGet<GithubApp>(ctx, KEY);
  const env = ctx.githubApp?.envClientId() ?? null;
  const callbackUrl = ctx.githubApp?.callbackUrl() ?? "";
  const q = new URLSearchParams({ "oauth_application[name]": "Vyre sign-in", "oauth_application[url]": callbackUrl.replace(/\/auth\/github\/callback$/, ""), "oauth_application[callback_url]": callbackUrl });
  return {
    github: {
      ...(env ?? saved?.clientId ? { clientId: (env ?? saved!.clientId) } : {}),
      secretSet: env !== null || !!saved?.secretHandle,
      source: env !== null ? "env" as const : saved ? "space" as const : "none" as const,
      callbackUrl,
      createUrl: `https://github.com/settings/applications/new?${q}`,
    },
  };
}

export async function githubGet(ctx: MembersCtx, _input: Record<string, never>) { return answer(ctx); }

export async function githubSet(ctx: MembersCtx, input: { clientId: string; clientSecret?: string }) {
  const tid = ctx.trace.traceId;
  const who = me(ctx);
  if (!ctx.githubApp) raise(tid, "internal.unavailable", "This server cannot keep a GitHub sign-in app yet.");
  const clientId = input.clientId.trim();
  if (!CLIENT_ID.test(clientId)) raise(tid, "validation.bad_input", "That does not look like a GitHub client id.");
  const secret = input.clientSecret?.trim();
  if (secret !== undefined && (secret.length < 20 || secret.length > 200 || /\s/.test(secret))) raise(tid, "validation.bad_input", "That does not look like a GitHub client secret.");
  const prev = policyGet<GithubApp>(ctx, KEY);
  if (!secret && !prev?.secretHandle) raise(tid, "validation.bad_input", "Paste the client secret too; it is kept in the Vault and not shown again.");
  const secretHandle = secret ? await ctx.githubApp.storeSecret(secret) : prev!.secretHandle;
  policyPut(ctx, KEY, { clientId, secretHandle } satisfies GithubApp);
  ctx.emit("policy.changed", "sign_in.github_app", { key: "sign_in.github_app", scope: "space", kind: "sign_in", by: who.id });
  await ctx.githubApp.reload();
  return answer(ctx);
}

export async function githubClear(ctx: MembersCtx, _input: Record<string, never>) {
  const who = me(ctx);
  if (policyDrop(ctx, KEY)) ctx.emit("policy.changed", "sign_in.github_app", { key: "sign_in.github_app", scope: "space", kind: "sign_in", by: who.id });
  await ctx.githubApp?.reload();
  return answer(ctx);
}
