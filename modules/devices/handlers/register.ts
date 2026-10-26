// devices.register is the host's own half of sign-in: it creates the device and the session for a person, so whoever can call it can get a session for anyone. Only the host itself
// (svc_host) may. A person, an admin, an agent and every other service are refused with permission.no_grant, whatever the gateway let through (P-SEC_08).
import { raise } from "../projections.ts";
import type { DevicesCtx } from "../projections.ts";
import type { DeviceClass } from "../projections.ts";
import { register as createDeviceAndSession } from "./sessions.ts";

export const HOST_PRINCIPAL = "svc_host";

export async function register(ctx: DevicesCtx, input: { person: string; name: string; class: DeviceClass }) {
  if (ctx.principal?.kind !== "service" || ctx.principal.id !== HOST_PRINCIPAL) {
    raise(ctx, "permission.no_grant", "Only the server itself can register a device.");
  }
  return createDeviceAndSession(ctx, input);
}
