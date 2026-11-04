// ci.settings.get and ci.settings.set: an admin's, and audited (lane l-ci-runners). The cloud key is never here: only the name of the Vault item that holds it.
import { PRICE_HOURLY } from "../cost.ts";
import { DEFAULTS, ensure, isAdmin, raise, readSettings, writeSettings } from "../projections.ts";
import type { CiCtx, Settings } from "../projections.ts";

const need = (ctx: CiCtx): void => { if (!isAdmin(ctx)) raise(ctx, "permission.no_grant", "Only an admin can see or change the CI settings."); };

export function settingsGet(ctx: CiCtx): { settings: Settings; keyReady: boolean } {
  need(ctx);
  const settings = readSettings(ctx);
  return { settings, keyReady: settings.vaultKeyRef !== null };
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
