// The desktop adapter keeps the Tauri bridge at the session boundary. It turns
// validated native links into the same URL-backed flows used by the browser;
// it never gives the React app a general native invoke surface.
import { makeBridge, shellInvoke, shellListen } from "../../../../desktop/src/bridge.ts";
import type { Bridge, DesktopDeepLink, Unlisten } from "../../../../desktop/src/bridge.ts";
import { makeBundle, wipe } from "../../../../../client/src/crypto/keys.ts";
import type { JoinValues } from "../../join/JoinFlow.tsx";
import { openVerifiedSession } from "./stored.ts";
import type { StoredSession, VerifiedSpace } from "./stored.ts";

export type DesktopRoute =
  | { kind: "signin"; address: string }
  | { kind: "pair"; address: string; code: string }
  | { kind: "join"; address: string; code: string; fingerprint: string };

export type DesktopBootstrapBridge = Pick<Bridge, "bootstrap" | "listenLinks">;

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
}

export interface DesktopInvitePreview {
  spaceId: string;
  spaceName: string;
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
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || (httpsOnly && parsed.protocol !== "https:") || !parsed.host) return null;
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

function sessionToken(value: unknown): { token: string; epoch?: number } | null {
  const response = object(value);
  const session = response && object(response["session"]);
  const token = session && text(session["token"]);
  if (!token) return null;
  const epoch = session["epoch"];
  return { token, ...(typeof epoch === "number" && Number.isInteger(epoch) && epoch >= 0 ? { epoch } : {}) };
}

function needsSecondFactor(value: unknown): boolean {
  return object(value)?.["status"] === "second_factor_required";
}

async function preauth(call: AnonymousCall, capability: string, input: unknown, failure: string): Promise<unknown> {
  try { return await call(capability, input); } catch { throw new Error(failure); }
}

async function verifyAndPersist(baseUrl: string, answer: unknown, expectedSpaceId: string | undefined, deps: Omit<DesktopSessionDeps, "anonymous">): Promise<StoredSession> {
  if (needsSecondFactor(answer)) throw new Error("Finish second-factor sign-in in your Space, then try again.");
  const session = sessionToken(answer);
  if (!session) throw new Error("The Space did not return a session. Try again.");
  let saved: StoredSession | undefined;
  const stored = await openVerifiedSession({
    baseUrl,
    token: session.token,
    ...(expectedSpaceId ? { continuity: { id: expectedSpaceId } } : {}),
    open: () => deps.open(session.token),
    getSpace: () => deps.getSpace(session.token),
    persist: (candidate) => {
      saved = { ...candidate, ...(session.epoch === undefined ? {} : { syncEpoch: session.epoch }) };
      deps.persist?.(saved);
    },
  });
  return saved ?? stored;
}

/** Converts a validated native payload into a constrained existing session flow. */
export function routeDesktopLink(link: DesktopDeepLink): DesktopRoute | null {
  const space = address(link.params["address"]);
  if (link.action === "open" || link.action === "signin") return space ? { kind: "signin", address: space } : null;
  if (link.action === "pair") {
    const code = link.params["code"];
    return space && code ? { kind: "pair", address: space, code } : null;
  }
  const code = link.params["code"];
  const fingerprint = link.params["fp"];
  const verifiedSpace = address(link.params["address"], true);
  return verifiedSpace && code && fingerprint ? { kind: "join", address: verifiedSpace, code, fingerprint } : null;
}

/** Pairing spends the anonymous one-time code, then requires whoami and spaces.get before storing a session. Returned key ciphertext is intentionally ignored: Mine remains locked. */
export async function redeemDesktopPair(route: Extract<DesktopRoute, { kind: "pair" }>, deps: DesktopSessionDeps): Promise<StoredSession> {
  const answer = await preauth(deps.anonymous, "identity.pair_redeem", { code: route.code, deviceName: "Vyre desktop", deviceClass: "desktop" }, "This pairing link is unavailable. Ask to pair again.");
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
  return { spaceId, spaceName, invitedBy, role, expiresAt, fingerprint };
}

/** The preview's public Space id routes key sealing. It is checked again against the authenticated session after acceptance. */
export async function previewDesktopJoin(route: Extract<DesktopRoute, { kind: "join" }>, anonymous: AnonymousCall): Promise<PreviewedDesktopJoin> {
  return { route, preview: previewOf(await preauth(anonymous, "members.invites.preview", { code: route.code }, "This invite is unavailable. Ask for a new one.")) };
}

/** Creates a real client key bundle, sends only wrapped fields, and persists only after post-accept Space-ID agreement. */
export async function acceptDesktopJoin(join: PreviewedDesktopJoin, values: JoinValues, deps: DesktopSessionDeps): Promise<StoredSession> {
  const made = await makeBundle(values.password, values.recoveryCode ?? fallbackRecoveryCode(), { spaceId: join.preview.spaceId });
  try {
    if (!made.spaceKeys?.length) throw new Error("This device could not create the Space key. Try again.");
    const { personKey: _personKey, personKeyByRecovery, spaceKeys, ...wrappedKeys } = made;
    const answer = await preauth(deps.anonymous, "invites.accept_create_account", {
      code: join.route.code,
      username: values.username,
      displayName: values.displayName,
      password: values.password,
      deviceName: values.deviceName || "Vyre desktop",
      deviceClass: "desktop",
      keys: { ...wrappedKeys, ...(values.recoveryCode ? { personKeyByRecovery } : {}), spaceKeys },
    }, "Could not finish joining this Space. Try again.");
    return verifyAndPersist(join.route.address, answer, join.preview.spaceId, deps);
  } finally {
    wipe(made.personKey);
  }
}

/** The typed bridge is present only in the packaged desktop shell. */
export function desktopBridge(): DesktopBootstrapBridge | null {
  const invoke = shellInvoke();
  const listen = shellListen();
  return invoke && listen ? makeBridge(invoke, listen) : null;
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
