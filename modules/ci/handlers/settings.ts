// ci.settings.get and ci.settings.set: an admin's, and audited (lane l-ci-runners). The cloud key is never here: only the name of the Vault item that holds it.
import { PRICE_HOURLY } from "../cost.ts";
import { DEFAULTS, ensure, isAdmin, raise, readSettings, writeSettings } from "../projections.ts";
import type { CiCtx, Settings } from "../projections.ts";

const need = (ctx: CiCtx): void => { if (!isAdmin(ctx)) raise(ctx, "permission.no_grant", "Only an admin can see or change the CI settings."); };

/** What the GitHub App must be allowed to do for runners. */
export const APP_NEEDS: Readonly<Record<string, string>> = { actions: "read", administration: "write", secrets: "read" };
export interface AppState { ready: boolean; installed: boolean; missing: string[]; acceptUrl: string | null; orgAcceptUrl: string | null }

const RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };
/** Does the Space's GitHub App hold the permissions and the event runners need? When not, the Console says "needs new permissions. Accept on GitHub" and links to the installation's page. */
export async function appState(ctx: CiCtx): Promise<AppState> {
  const out: AppState = { ready: false, installed: false, missing: [], acceptUrl: null, orgAcceptUrl: null };
  try {
    const app = (await ctx.call("github.app.get", {})) as { permissions?: Record<string, string>; events?: string[] };
    out.installed = true;
    for (const [perm, level] of Object.entries(APP_NEEDS)) if ((RANK[app.permissions?.[perm] ?? ""] ?? 0) < (RANK[level] ?? 0)) out.missing.push(`${perm}: ${level}`);
    if (!(app.events ?? []).includes("workflow_job")) out.missing.push("event: workflow_job");
    const inst = ((await ctx.call("github.installations.list", {})) as { installations?: Array<{ id: number; account: string }> }).installations?.[0];
    if (inst && out.missing.length) { out.acceptUrl = `https://github.com/settings/installations/${inst.id}`; out.orgAcceptUrl = `https://github.com/organizations/${encodeURIComponent(inst.account)}/settings/installations/${inst.id}`; }
  } catch { /* no GitHub App yet: runners cannot start, and the Console says so */ }
  out.ready = out.installed && out.missing.length === 0;
  return out;
}

export async function settingsGet(ctx: CiCtx): Promise<{ settings: Settings; keyReady: boolean; githubApp: AppState }> {
  need(ctx);
  const settings = readSettings(ctx);
  return { settings, keyReady: settings.vaultKeyRef !== null, githubApp: await appState(ctx) };
}

type In = Partial<Omit<Settings, "provider">>;
const KEYS: Array<keyof In> = ["enabled", "vaultKeyRef", "region", "size", "image", "maxConcurrent", "monthlyCapUsd", "maxJobMinutes", "labels"];

export function settingsSet(ctx: CiCtx, input: In): { settings: Settings } {
  need(ctx);
  ensure(ctx);
  const now = readSettings(ctx), next: Settings = { ...now, labels: [...now.labels] }, changed: string[] = [];
  const set = <K extends keyof In>(k: K, v: Settings[K & keyof Settings]): void => { if (JSON.stringify(now[k as keyof Settings]) !== JSON.stringify(v)) changed.push(k); (next as unknown as Record<string, unknown>)[k] = v; };
  for (const k of KEYS) if (input[k] !== undefined) set(k, input[k] as never);
  if (!(next.size in PRICE_HOURLY)) raise(ctx, "validation.bad_input", `Vyre can price these machine sizes: ${Object.keys(PRICE_HOURLY).join(", ")}.`);
  if (next.labels.length === 0 || new Set(next.labels).size !== next.labels.length) raise(ctx, "validation.bad_input", "Give one to five different labels.");
  if (next.enabled) {
    if (!next.vaultKeyRef) raise(ctx, "validation.precondition_failed", "Choose the Vault item that holds the cloud key before turning runners on.");
    if (!(next.monthlyCapUsd > 0)) raise(ctx, "validation.precondition_failed", "Set a monthly cap above zero before turning runners on.");
  }
  writeSettings(ctx, next);
  if (changed.length) ctx.emit("ci.settings_changed", `entity/${next.enabled}`, { fields: changed, enabled: next.enabled });
  return { settings: next };
}
export { DEFAULTS };
