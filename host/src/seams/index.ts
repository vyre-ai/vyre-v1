// Seam wiring at boot (rulings 31 and 32): every setter or configure function a module exports through `hostSeams` is called with the host driver registered under the same name.
// The built-in registry builds the Google, Microsoft, IMAP and sources seams from the Vault; the daemon adds the drivers that need its own state (push, event log reader, dispatcher)
// through `SeamDeps.drivers`. A setter nobody has a driver for is not ignored and not a boot failure: it is listed in `missing`, and the daemon reports it in health.
// Host never imports a module (layer rule, and boundaries.ts rejects a non-literal import()), so the three registration functions arrive as arguments: the daemon passes
// setGoogleHost and setImapSecretResolver from the module files it already imports for the loader, a test passes fakes. A setter that is not given (the Microsoft module is not in the
// tree yet) leaves that seam "absent"; it is reported in the result, not a boot failure.
import { createEngineHost } from "./engine.ts";
import type { EngineHostDeps, EngineHostSeam, EngineInvoke, EngineSessionPorts } from "./engine.ts";
import { createGoogleHost } from "./google.ts";
import type { GoogleHostSeam, GoogleSeamDeps } from "./google.ts";
import { createImapSecretResolver } from "./imap.ts";
import type { ImapSecretResolver } from "./imap.ts";
import { createMailgunHost, createResendHost } from "./mail-providers.ts";
import type { MailgunHostSeam, ResendHostSeam } from "./mail-providers.ts";
import { createMsHost } from "./microsoft.ts";
import { createSourcesSecretResolver } from "./sources.ts";
import type { SourcesSecretResolver } from "./sources.ts";
import type { MsHostSeam, MsSeamDeps } from "./microsoft.ts";
import type { FetchedResponse, SeamFetch, SpaceBlobs, SpaceFiles, SpaceMembers, VaultPort } from "./ports.ts";

export { createEngineHost, createGoogleHost, createImapSecretResolver, createMailgunHost, createMsHost, createResendHost, createSourcesSecretResolver };
export type { EngineHostDeps, EngineHostSeam, EngineInvoke, EngineSessionPorts, FetchedResponse, GoogleHostSeam, MailgunHostSeam, ResendHostSeam, GoogleSeamDeps, ImapSecretResolver, MsHostSeam, SourcesSecretResolver, MsSeamDeps, SeamFetch, SpaceBlobs, SpaceFiles, SpaceMembers, VaultPort };

/** Every host driver is built from the same deps; a driver may return anything the setter accepts (a seam object, a function, a config). */
export type SeamDriver = (d: SeamDriverDeps) => unknown;
export interface SeamDriverDeps extends SeamDeps {
  fetch: SeamFetch;
  /** the {vault, fetch, files, blobs, members} bundle the connector seams are built from */
  common: GoogleSeamDeps & MsSeamDeps;
}

/**
 * A setter or configure function a module exports in `hostSeams`. The known names are typed; any other name (ruling 32: a module's own `configureX`) is accepted and
 * matched to a driver by name at boot.
 */
export interface SeamSetters {
  /** the engine runtime's host half: a way to run capabilities for a person, and the session opener's ports (P-L2_23) */
  setEngineHost?: ((h: EngineHostSeam | null) => void) | undefined;
  setGoogleHost?: ((h: GoogleHostSeam | null) => void) | undefined;
  setMsHost?: ((h: MsHostSeam | null) => void) | undefined;
  setImapSecretResolver?: ((fn: ImapSecretResolver | null) => void) | undefined;
  /** the sources module's deps.secret: webhook signing secrets from the Vault */
  setSourcesSecretResolver?: ((fn: SourcesSecretResolver | null) => void) | undefined;
  /** the Space sending backends (P-L5_05): key, files, downloads; Mailgun also uploads and the public address */
  setResendHost?: ((h: ResendHostSeam | null) => void) | undefined;
  setMailgunHost?: ((h: MailgunHostSeam | null) => void) | undefined;
  [name: string]: ((driver: never) => void) | undefined;
}

export interface SeamDeps {
  vault: VaultPort;
  fetch?: SeamFetch;
  files: SpaceFiles;
  blobs: SpaceBlobs;
  members: SpaceMembers;
  /** the Space the Vault is read for (the sources seam is fixed to it) */
  space: string;
  /** the address people reach this Space at, for Mailgun's inbound route; omitted: that call answers unavailable */
  publicUrl?: ((space: string) => Promise<string>) | undefined;
  /** drivers by setter name, added to (and overriding) the built-in registry: the daemon supplies the ones that need its own state */
  drivers?: Record<string, SeamDriver>;
  /** which module exported each setter, for the report of what is missing */
  owners?: ReadonlyMap<string, string>;
}

export type SeamState = "wired" | "absent";
export interface MissingDriver { setter: string; module?: string; reason: string }
export interface WiredSeams {
  /** the four connector seams, kept for the callers that read them by name */
  state: { google: SeamState; microsoft: SeamState; imap: SeamState; sources: SeamState; resend: SeamState; mailgun: SeamState };
  /** every setter that was called with its driver */
  wired: string[];
  /** every setter that was exported but could not be given a driver (none registered, or the driver threw), with the module that offered it */
  missing: MissingDriver[];
  /** Take every seam back out (shutdown, tests). */
  unwire(): void;
}

const defaultFetch: SeamFetch = async (url, init) => {
  // a token request or a bearer download never follows a redirect off the listed host, so redirects are errors here
  const r = await globalThis.fetch(url, {
    ...(init?.method ? { method: init.method } : {}), ...(init?.headers ? { headers: init.headers } : {}),
    ...(init?.body !== undefined ? { body: init.body } : {}), redirect: "error",
  } as never);
  return { status: r.status, text: () => r.text(), arrayBuffer: () => r.arrayBuffer() };
};

/** The drivers the host builds from the Vault and the Space ports alone. */
export const BUILTIN_DRIVERS: Readonly<Record<string, SeamDriver>> = Object.freeze({
  setGoogleHost: (d: SeamDriverDeps) => createGoogleHost(d.common),
  setMsHost: (d: SeamDriverDeps) => createMsHost(d.common),
  setImapSecretResolver: (d: SeamDriverDeps) => createImapSecretResolver(d.vault),
  setSourcesSecretResolver: (d: SeamDriverDeps) => createSourcesSecretResolver(d.vault, d.space),
  setResendHost: (d: SeamDriverDeps) => createResendHost({ vault: d.vault, fetch: d.fetch, files: d.files, blobs: d.blobs, publicUrl: d.publicUrl }),
  setMailgunHost: (d: SeamDriverDeps) => createMailgunHost({ vault: d.vault, fetch: d.fetch, files: d.files, blobs: d.blobs, publicUrl: d.publicUrl }),
});

const LEGACY: Readonly<Record<string, keyof WiredSeams["state"]>> = Object.freeze({
  setGoogleHost: "google", setMsHost: "microsoft", setImapSecretResolver: "imap", setSourcesSecretResolver: "sources", setResendHost: "resend", setMailgunHost: "mailgun",
});

/** What the notifications module hands the transport (the structural subset of its PushMessage). */
export interface PushSendMessage {
  device: string; platform: string; token: string;
  /** the only text of a push */
  title: string; deepLink: string; tag: string;
  category?: "needs_you";
  actions?: { key: string; cap: string }[];
}
/**
 * The push transport the notifications module sends through (spec 2.24, ARCH 7.11). The host owns the choice of transport; with none configured every send throws, which the module
 * records as "not pushed" while the row still lands in the app.
 */
export interface PushTransportDeps {
  /** the real APNs/FCM sender; omitted until the push keys are in the Vault */
  send?: (msg: PushSendMessage) => Promise<"ok" | "gone">;
  /** milliseconds since the person last used a computer; omitted: unknown */
  computerIdleMs?: (person: string) => Promise<number | undefined>;
  /** the Space's display name for the push title; omitted: the Space id */
  spaceName?: (space: string) => Promise<string | undefined> | string | undefined;
  email?: (msg: { to: string; subject: string; deepLink: string }) => Promise<void>;
}
export interface PushPortSeam extends Omit<PushTransportDeps, "send"> {
  send(msg: PushSendMessage): Promise<"ok" | "gone">;
}
export function createPushPort(deps: PushTransportDeps = {}): PushPortSeam {
  return {
    send: (msg) => (deps.send ? deps.send(msg) : Promise.reject(new Error("No push transport is configured on this server."))),
    ...(deps.computerIdleMs ? { computerIdleMs: deps.computerIdleMs } : {}),
    ...(deps.spaceName ? { spaceName: deps.spaceName } : {}),
    ...(deps.email ? { email: deps.email } : {}),
  };
}

export function wireSeams(setters: SeamSetters, deps: SeamDeps): WiredSeams {
  const fetch = deps.fetch ?? defaultFetch;
  const common = { vault: deps.vault, fetch, files: deps.files, blobs: deps.blobs, members: deps.members };
  const driverDeps: SeamDriverDeps = { ...deps, fetch, common };
  const registry: Record<string, SeamDriver> = { ...BUILTIN_DRIVERS, ...(deps.drivers ?? {}) };
  const state: WiredSeams["state"] = { google: "absent", microsoft: "absent", imap: "absent", sources: "absent", resend: "absent", mailgun: "absent" };
  const wired: string[] = [];
  const missing: MissingDriver[] = [];
  const called: ((driver: unknown) => void)[] = [];
  for (const [name, fn] of Object.entries(setters)) {
    if (typeof fn !== "function") continue;
    const module = deps.owners?.get(name);
    const where = module ? { module } : {};
    const make = registry[name];
    if (!make) { missing.push({ setter: name, ...where, reason: "The host has no driver registered under this name." }); continue; }
    const set = fn as (driver: unknown) => void;
    try { set(make(driverDeps)); } catch (e) { missing.push({ setter: name, ...where, reason: `The driver failed: ${e instanceof Error ? e.message : String(e)}` }); continue; }
    wired.push(name);
    called.push(set);
    const legacy = LEGACY[name];
    if (legacy) state[legacy] = "wired";
  }
  return {
    state, wired, missing,
    unwire() {
      for (const set of called) { try { set(null); } catch { /* shutting down: one module's refusal must not keep the others wired */ } }
    },
  };
}
