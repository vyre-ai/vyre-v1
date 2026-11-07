// The desktop adapter keeps the narrow validated bridge at the session boundary.
// It turns native links into the same URL-backed flows used by the browser.
import { shellDesktopLinkBridge } from "../../../../../client/src/connection/desktop-link.ts";
import type { DesktopDeepLink, DesktopLinkBridge, Unlisten } from "../../../../../client/src/connection/desktop-link.ts";
import { keepKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { holdKeyOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { loadCryptoKeys, type MadeBundle } from "../../../../../client/src/crypto/load.ts";
import type { JoinValues } from "../../join/JoinFlow.tsx";
import { deviceFor } from "../../join/logic.ts";
import { openVerifiedSession, writeStored } from "./stored.ts";
import type { StoredSession, VerifiedSpace } from "./stored.ts";

export type { DesktopDeepLink } from "../../../../../client/src/connection/desktop-link.ts";

export type DesktopRoute =
  | { kind: "signin"; address: string; /** a link to one thing in that Space (vyre://open?address=&kind=&id=): it opens once signed in, through reach */ item?: { kind: string; id: string } }
  /** An app outside Vyre asked to join a Space this computer is signed in to: the Allow sheet. Never a sign-in to an address a link named. */
  | { kind: "allow"; address: string; request: string }
  | { kind: "pair"; address: string; code: string; /** a phone opened the pairing link in its browser */ phone?: true }
  | { kind: "join"; address: string; code: string; fingerprint: string }
  /** An owner claim link a browser handed over (rc.14): the claim runs here, where the person's account already is. `fragment` is the link's own #s=&fp=&n=. */
  | { kind: "claim"; address: string; token: string; fragment: string };

export type DesktopBootstrapBridge = DesktopLinkBridge;

/** The anonymous pre-auth caller is deliberately the only network surface these flows receive. */
export type AnonymousCall = (capability: string, input: unknown) => Promise<unknown>;

type OpenedSession = { def: { spaceId: string }; me: { id: string }; close(): void };
type Open = (token: string) => Promise<OpenedSession>;
type Persist = (stored: StoredSession) => void;

export interface DesktopSessionDeps {
  anonymous: AnonymousCall;
  open: Open;
  getSpace: (token: string) => Promise<VerifiedSpace>;
  persist?: Persist;
  /** Browser invite links share the verified acceptance path without pretending to be native devices. */
  deviceClass?: "web" | "desktop";
  /** Everyone here must use single sign-on: the provider the invitation's address was proved at. */
  ssoProvider?: string;
  /** Join with the account this device already has (rc.14): its bundle, opened with the current password, with a Space key for this Space. No new bundle and no new recovery code. */
  carry?: (spaceId: string) => Promise<MadeBundle>;
}

export interface DesktopInvitePreview {
  spaceId: string;
  spaceName: string;
  /** Everyone here must use single sign-on: join by proving the invitation's address at one of these. */
  ssoRequired?: { key: string; title: string }[];
  invitedBy: string;
  role: string;
  expiresAt: number;
  /** Display continuity only, never trust material. */
  fingerprint: string;
}

export interface PreviewedDesktopJoin {
  route: Extract<DesktopRoute, { kind: "join" }>;
  preview: DesktopInvitePreview;
}

function address(value: string | undefined, httpsOnly = false): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const loopback = parsed.hostname.toLowerCase() === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
    if ((parsed.protocol !== "https:" && (parsed.protocol !== "http:" || !loopback)) || (httpsOnly && parsed.protocol !== "https:") || !parsed.host) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;

/** makeBundle makes both wraps; when recovery was not chosen, this throwaway secret lets us discard that optional wrap rather than weaken it. */
function fallbackRecoveryCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sessionToken(value: unknown): string | null {
  const response = object(value);
  const session = response && object(response["session"]);
  const token = session && text(session["token"]);
  return token;
}

function needsSecondFactor(value: unknown): boolean {
  return object(value)?.["status"] === "second_factor_required";
}

async function preauth(call: AnonymousCall, capability: string, input: unknown, failure: string): Promise<unknown> {
  try { return await call(capability, input); } catch { throw new Error(failure); }
}

async function verifyAndPersist(baseUrl: string, answer: unknown, expectedSpaceId: string | undefined, deps: Omit<DesktopSessionDeps, "anonymous">): Promise<StoredSession> {
  if (needsSecondFactor(answer)) throw new Error("Finish second-factor sign-in in your Space, then try again.");
  const token = sessionToken(answer);
  if (!token) throw new Error("The Space did not return a session. Try again.");
  let saved: StoredSession | undefined;
  const stored = await openVerifiedSession({
    baseUrl,
    token,
    ...(expectedSpaceId ? { continuity: { id: expectedSpaceId } } : {}),
    open: () => deps.open(token),
    getSpace: () => deps.getSpace(token),
    persist: (candidate) => {
      saved = candidate;
      (deps.persist ?? writeStored)(saved);
    },
  });
  return saved ?? stored;
}

/** Converts a validated native payload into a constrained existing session flow. */
export function routeDesktopLink(link: DesktopDeepLink): DesktopRoute | null {
  const space = address(link.params["address"]);
  const request = link.params["allow"];
  if (link.action === "open" && space && typeof request === "string" && /^oar_[a-z0-9]{1,64}$/.test(request)) return { kind: "allow", address: space, request };
  if (link.action === "open" && space && /^[a-z_]{2,24}$/.test(link.params["kind"] ?? "") && /^[A-Za-z0-9_.-]{1,128}$/.test(link.params["id"] ?? "")) return { kind: "signin", address: space, item: { kind: link.params["kind"]!, id: link.params["id"]! } };
  if (link.action === "open" || link.action === "signin") return space ? { kind: "signin", address: space } : null;
  if (link.action === "pair") {
    const code = link.params["code"];
    return space && code ? { kind: "pair", address: space, code } : null;
  }
  if (link.action === "claim") {
    const at = address(link.params["address"], true), token = link.params["token"], s = link.params["s"];
    if (!at || !token || !/^[A-Za-z0-9_-]{8,200}$/.test(token) || !s || !/^[A-Za-z0-9_-]{3,64}$/.test(s)) return null;
    const fragment = new URLSearchParams({ s });
    for (const k of ["fp", "n"]) { const v = link.params[k]; if (v) fragment.set(k, v); }
    return { kind: "claim", address: at, token, fragment: `#${fragment}` };
  }
  const code = link.params["code"];
  const fingerprint = link.params["fp"];
  const verifiedSpace = address(link.params["address"], true);
  return verifiedSpace && code && fingerprint ? { kind: "join", address: verifiedSpace, code, fingerprint } : null;
}

/** One-time pair, join and claim links become an ordinary sign-in address after success, so sign-out cannot replay their codes. */
export function consumeDesktopRoute(route: DesktopRoute | null): DesktopRoute | null {
  return route?.kind === "pair" || route?.kind === "join" || route?.kind === "claim" ? { kind: "signin", address: route.address } : route;
}

/** Pairing spends the anonymous one-time code, then requires whoami and spaces.get before storing a session. Returned key ciphertext is intentionally ignored: Mine remains locked. */
export async function redeemDesktopPair(route: Extract<DesktopRoute, { kind: "pair" }>, deps: DesktopSessionDeps): Promise<StoredSession> {
  const answer = await preauth(deps.anonymous, "identity.pair_redeem", { code: route.code, deviceName: route.phone ? "Phone" : "Vyre desktop", deviceClass: route.phone ? "phone" : "desktop" }, "This pairing link is unavailable. Ask to pair again.");
  return verifyAndPersist(route.address, answer, undefined, deps);
}

function previewOf(value: unknown): DesktopInvitePreview {
  const response = object(value);
  const spaceId = response && text(response["spaceId"]);
  const spaceName = response && text(response["spaceName"]);
  const invitedBy = response && text(response["invitedBy"]);
  const role = response && text(response["role"]);
  const expiresAt = response?.["expiresAt"];
  const fingerprint = response && text(response["fingerprint"]);
  if (!spaceId || !spaceName || !invitedBy || !role || typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || !fingerprint) throw new Error("This invite is unavailable. Ask for a new one.");
  const required = response?.["ssoRequired"];
  return { spaceId, spaceName, invitedBy, role, expiresAt, fingerprint, ...(Array.isArray(required) ? { ssoRequired: required as { key: string; title: string }[] } : {}) };
}

/** The preview's public Space id routes key sealing. It is checked again against the authenticated session after acceptance. */
export async function previewDesktopJoin(route: Extract<DesktopRoute, { kind: "join" }>, anonymous: AnonymousCall): Promise<PreviewedDesktopJoin> {
  return { route, preview: previewOf(await preauth(anonymous, "members.invites.preview", { code: route.code }, "This invite is unavailable. Ask for a new one.")) };
}

/** A join the Space refused for a reason the person can fix on an earlier step. `step` is the join step to go back to. */
export class JoinRefused extends Error {
  readonly step: 1;
  constructor(message: string) { super(message); this.name = "JoinRefused"; this.step = 1; }
}

async function acceptOnSpace(call: AnonymousCall, input: unknown): Promise<unknown> {
  try { return await call("members.accept", input); } catch (e) {
    if ((e as { code?: string } | null)?.code === "validation.duplicate") throw new JoinRefused("That username is taken.");
    throw new Error("Could not finish joining this Space. Try again.");
  }
}

/** Creates a real client key bundle, sends only wrapped fields, and persists only after post-accept Space-ID agreement. */
export async function acceptDesktopJoin(join: PreviewedDesktopJoin, values: JoinValues, deps: DesktopSessionDeps): Promise<StoredSession> {
  const { makeBundle, wipe } = await loadCryptoKeys();
  const made = deps.carry ? await deps.carry(join.preview.spaceId) : await makeBundle(values.password, values.recoveryCode ?? fallbackRecoveryCode(), { spaceId: join.preview.spaceId });
  // A carried account keeps the recovery wrap it has (none when it never kept a code); a new one sends it only when a code was made and saved.
  const keepRecovery = deps.carry ? !!made.personKeyByRecovery : !!values.recoveryCode;
  try {
    if (!made.spaceKeys?.length) throw new Error("This device could not create the Space key. Try again.");
    const { personKey: _personKey, personKeyByRecovery, spaceKeys, ...wrappedKeys } = made;
    const answer = await acceptOnSpace(deps.anonymous, {
      code: join.route.code,
      username: values.username,
      displayName: values.displayName,
      password: values.password,
      deviceName: values.deviceName || deviceFor(deps.deviceClass ?? "desktop").deviceName,
      deviceClass: deps.deviceClass ?? "desktop",
      keys: { ...wrappedKeys, ...(keepRecovery ? { personKeyByRecovery } : {}), spaceKeys },
      ...(deps.ssoProvider ? { ssoProvider: deps.ssoProvider } : {}),
    });
    const accepted = object(answer);
    const stored = await verifyAndPersist(join.route.address, { status: "ok", session: { token: accepted?.["token"] } }, join.preview.spaceId, deps);
    // This helper sends nothing to a remote Space. Only the person's own loopback node may hold their Mine key.
    try { if (await holdKeyOnOwnNode(join.route.address, stored.token, made.personKey)) await keepKey(made.personKey); } catch { /* setup reports a locked Vault if the own node is unavailable */ }
    return stored;
  } finally {
    wipe(made.personKey);
  }
}

/** The typed bridge is present only in the packaged desktop shell. */
export function desktopBridge(): DesktopBootstrapBridge | null {
  return shellDesktopLinkBridge();
}

/** Delivers bootstrap before live links, preserving the bridge's established order. */
export async function consumeDesktopBootstrap(bridge: DesktopBootstrapBridge, onRoute: (route: DesktopRoute) => void): Promise<Unlisten> {
  const boot = await bridge.bootstrap();
  const pending = boot.pendingLink && routeDesktopLink(boot.pendingLink);
  if (pending) onRoute(pending);
  const unlisten = await bridge.listenLinks((link) => {
    const route = routeDesktopLink(link);
    if (route) onRoute(route);
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    unlisten();
  };
}

export { phoneCanReach } from "./reach.ts";

/** A pairing link opened in a phone's browser: `<Space address>/chat?pair=<code>`. Only the code shape is accepted; the code itself is spent by the redeem, once. */
export function pairLink(address: string, code: string, boxKey?: string): string {
  // a phone reaching this computer through its vyre.run name pins the box key from the fragment, which never reaches a server
  return `${address.replace(/\/+$/, "")}/chat?pair=${encodeURIComponent(code)}${boxKey && /^[A-Za-z0-9_-]{43}$/.test(boxKey) ? `#box=${boxKey}` : ""}`;
}
export function pairFromUrl(href: string, address: string): Extract<DesktopRoute, { kind: "pair" }> | null {
  try {
    const url = new URL(href);
    const code = url.searchParams.get("pair");
    return code && /^[A-Za-z0-9_-]{4,64}$/.test(code) ? { kind: "pair", address, code, phone: true } : null;
  } catch { return null; }
}
