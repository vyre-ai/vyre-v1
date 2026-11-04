// The host half of the CI runners (lane l-ci-runners). The CI module calls CiHost through setCiHost (it arrives as hostSeams, ruling 31). The cloud key is read from the Vault here, for one call,
// and goes only to the cloud provider's API host: it never reaches the module, an event, a log or a machine. Only DigitalOcean today (AWS comes later).
// The Vault item is the one an admin named in the CI settings (vaultKeyRef); it must be written as a handle. The address is checked (https, the provider's host, no credentials) before a header is built.
import { fail } from "../routes/errors.ts";
import { checked, secretOf } from "./mail-providers.ts";
import type { SeamCtx, SeamFetch, VaultPort } from "./ports.ts";

export const CI_DOMAINS = ["api.digitalocean.com"] as const;
const HANDLE = /^#[A-Za-z0-9_]{1,64}(\.[A-Za-z0-9_]{1,64})?$/;

export interface CloudRequest { method: "GET" | "POST" | "DELETE"; path: string; query?: Record<string, string | number> | undefined; body?: unknown }
/** The shape of CiHost (modules/ci/projections.ts), kept here so the host never imports a module. */
export interface CiHostSeam { cloud(ctx: SeamCtx, handle: string, req: CloudRequest): Promise<{ status: number; text: string }> }

export function createCiHost(d: { vault: Pick<VaultPort, "secret">; fetch: SeamFetch }): CiHostSeam {
  return {
    async cloud(ctx, handle, req) {
      if (!HANDLE.test(handle)) throw fail("validation.bad_input", ctx.trace.traceId, { message: "The cloud key is a Vault item written like #Name." });
      if (!req.path.startsWith("/v2/") || req.path.includes("..")) throw fail("validation.bad_input", ctx.trace.traceId, { message: "That is not a cloud API path." });
      const qs = Object.entries(req.query ?? {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
      const url = checked(ctx, `https://api.digitalocean.com${req.path}${qs ? `?${qs}` : ""}`, CI_DOMAINS);   // the address first: a refused address never reaches the Vault
      const key = await secretOf(d, ctx, handle, [handle], "The cloud provider");
      const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: "application/json" };
      if (req.body !== undefined) headers["content-type"] = "application/json";
      const r = await d.fetch(url, { method: req.method, headers, ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}) });
      return { status: r.status, text: await r.text() };
    },
  };
}
