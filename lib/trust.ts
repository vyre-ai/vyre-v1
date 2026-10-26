// Who is a trusted service (P-SEC_10). Several modules let a principal of kind "service" do what a person may not: act for every task slot, handle every hold, list every Run, read anyone's digest, schedule as anyone.
// That is right for the host and for the system services it runs, and wrong for a service principal a tenant can create: a Space Automation runs as its own svc_<32 hex>, a public form submits as svc_form_<id>, a site
// container as svc_site_<hex>. Those hold only the grants they were given, so they are never trusted by kind alone. The gateway never makes a caller a service at all: sessions are people (kind person) and signed-out
// callers are actors (kind actor, ruling 67); a service reaches a handler only from the host's own seams or by a module's nested call keeping the identity it was called with.
export interface PrincipalLike { kind: string; id: string }

export const HOST_SERVICE = "svc_host";

/** The server itself: the hooks, the scheduler and the engine seams run as this. */
export const isHostService = (p: PrincipalLike | null | undefined): boolean => !!p && p.kind === "service" && p.id === HOST_SERVICE;

const TENANT_SERVICE: readonly RegExp[] = [/^svc_form_/, /^svc_site_/, /^svc_[0-9a-f]{32}$/];

/** A service principal a tenant can create: a Space Automation, a public form, a site. */
export const isTenantService = (p: PrincipalLike | null | undefined): boolean => !!p && p.kind === "service" && TENANT_SERVICE.some((re) => re.test(p.id));

/** A service the host runs (svc_host, svc_engine, svc_sync...), never one a tenant made. This is what "a service caller acts for every slot" means. */
export const isTrustedService = (p: PrincipalLike | null | undefined): boolean => !!p && p.kind === "service" && !isTenantService(p);

/**
 * The system halves of sign-in, devices, audit and sessions are for other modules and the host, not for a person typing a URL. A call another capability made carries depth above zero; a call from the gateway
 * carries zero. The host (svc_host) may call them directly.
 */
export const isSystemCall = (ctx: { depth?: number; principal?: PrincipalLike | undefined }): boolean => isHostService(ctx.principal) || (ctx.depth ?? 0) > 0;
