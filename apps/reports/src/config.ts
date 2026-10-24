// Settings from the environment, checked once at start so a missing token stops the service with a plain sentence instead of failing a report later.

import { DEFAULT_LIMITS } from "./service.ts";
import type { Config } from "./service.ts";

export interface Settings { port: number; dataDir: string; trustProxy: boolean; config: Config }

type Env = Record<string, string | undefined>;

function int(env: Env, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min}`);
  return n;
}

export function loadConfig(env: Env): Settings {
  const need = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`${name} is not set`);
    return v;
  };
  const publicUrl = need("REPORTS_PUBLIC_URL").replace(/\/+$/, "");
  const insecure = env.REPORTS_ALLOW_INSECURE === "1";
  if (!/^https:\/\//.test(publicUrl) && !(insecure && /^http:\/\//.test(publicUrl))) throw new Error("REPORTS_PUBLIC_URL must start with https://");
  const teamUrl = env.TEAM_SPACE_URL, teamToken = env.TEAM_SPACE_TOKEN;
  if (Boolean(teamUrl) !== Boolean(teamToken)) throw new Error("TEAM_SPACE_URL and TEAM_SPACE_TOKEN are set together or not at all");
  const repo = env.GITHUB_REPO || "vyre-ai/vyre";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("GITHUB_REPO is owner/name");
  const limits = {
    perSpace: int(env, "REPORTS_PER_SPACE", DEFAULT_LIMITS.perSpace, 1),
    perSpaceWindowMs: int(env, "REPORTS_PER_SPACE_WINDOW_MS", DEFAULT_LIMITS.perSpaceWindowMs, 1000),
    perIp: int(env, "REPORTS_PER_IP", DEFAULT_LIMITS.perIp, 1),
    perIpWindowMs: int(env, "REPORTS_PER_IP_WINDOW_MS", DEFAULT_LIMITS.perIpWindowMs, 1000),
    registerPerIp: int(env, "REPORTS_REGISTER_PER_IP", DEFAULT_LIMITS.registerPerIp, 1),
    skewMs: int(env, "REPORTS_SKEW_MS", DEFAULT_LIMITS.skewMs, 1000),
  };
  return {
    port: int(env, "PORT", 8080, 0),
    dataDir: env.REPORTS_DATA_DIR || "./data",
    trustProxy: env.REPORTS_TRUST_PROXY === "1",
    config: {
      publicUrl,
      github: { repo, token: need("GITHUB_TOKEN"), webhookSecret: need("GITHUB_WEBHOOK_SECRET") },
      team: teamUrl && teamToken ? { baseUrl: teamUrl, token: teamToken, recordType: env.TEAM_RECORD_TYPE || "report" } : null,
      limits,
      allowInsecureWebhooks: insecure,
    },
  };
}
