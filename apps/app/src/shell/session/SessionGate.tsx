import { activationUrl, isPackagedOrigin, storedPlace } from "./space-catalog.ts";
// The production session boundary. Signed-out and desktop-link flows stay in the startup chunk;
// the authenticated application shell is loaded only after a stored or verified session exists.
import { holdOpen } from "../reach/open-link.ts";
import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { loadCryptoKeys, loadRecoveryCrypto } from "../../../../../client/src/crypto/load.ts";
import { forgetKey, keepKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { KeyGate } from "./KeyGate.tsx";
import { holdKeyOnOwnNode, isLoopbackUrl } from "../../../../../client/src/gateway/local-key.ts";
import { JoinFlow } from "../../join/JoinFlow.tsx";
import type { JoinValues } from "../../join/JoinFlow.tsx";
import { deviceFor } from "../../join/logic.ts";
import type { JoinInvite } from "../../join/logic.ts";
import { aiHomeOf } from "../../ai-signin/own-ai.ts";
import { spaceLabel } from "../spaces/space-label.ts";
import {
  Bar,
  Button,
  ErrorLine,
  JoinFrame,
  Links,
  Opening,
  Panel,
  SpaceImageContext,
  Step,
  TextButton,
  Title,
} from "../../join/kit.tsx";
import {
  ASLEEP_SUB,
  NOT_AN_INVITE,
  RECONNECTING,
  SPACE_TROUBLE,
  asleep,
  boxNotAnswering,
  isUnreachable,
  noSpaceAt,
  notASpaceAt,
  seenAgo,
} from "../../join/failure.ts";
import { InBrowser, NotAnswering, YourSpaces } from "../../join/GettingIn.tsx";
import { OVERLAY_START, decideEntry, decideLanded, overlayStep, phaseStep } from "./getting-in-machine.ts";
import type { GatePhase, Overlay } from "./getting-in-machine.ts";
import { rememberBrowserSpace, rememberSession, siblingSessions, yourSpaces } from "./known-spaces.ts";
import type { SpaceRow } from "./known-spaces.ts";
import { spaceHost } from "../spaces/space-label.ts";
import { Welcome } from "../../join/Welcome.tsx";
import { completeReset } from "../../join/reset.ts";
import { completeRecovery } from "../../join/recover.ts";
import { SpaceEntry } from "../../join/SpaceEntry.tsx";
import { OtherComputer } from "../../join/OtherComputer.tsx";
import { FirstLaunch } from "../../onboarding/FirstLaunch.tsx";
import { deviceOf } from "../../onboarding/doors.ts";
import { wantTeamNext } from "../../onboarding/doors.ts";
import { browserLink, consumeBrowserInvite, inviteAppLink, VYRE_DOWNLOADS, entryTarget, isMacShell } from "./entry.ts";
import type { EntryTarget } from "./entry.ts";
import { useRelayAddress } from "./use-relay-address.ts";
import { ensureMacServer, ensurePersonalSpace } from "../../../../../client/src/connection/desktop-link.ts";
import type { Invoke } from "../../../../../client/src/connection/desktop-link.ts";
import { mark } from "../../startup/marks.ts";
import type { ShellHub } from "../spaces/hub.ts";
import {
  CapError,
  clearOldData,
  createCapCaller,
  findSpaceQuietly,
  hasOldData,
  healStaleWorker,
  spaceIdAt,
} from "./caps.ts";
import type { Found } from "./caps.ts";
import {
  JoinRefused,
  acceptDesktopJoin,
  consumeDesktopBootstrap,
  consumeDesktopRoute,
  desktopBridge,
  pairFromUrl,
  previewDesktopJoin,
  redeemDesktopPair,
} from "./desktop.ts";
import type { DesktopRoute } from "./desktop.ts";
import type { LoadVoiceDevice } from "./phone.ts";
import { openRealSession } from "./session.ts";
import type { OpenSessionOptions, RealSession } from "./session.ts";
import {
  clearStored,
  lockName,
  readStored,
  readStoredPersonal,
  readStoredSessions,
  readStoredSpace,
  openVerifiedSession,
  signInAndVerify,
  spaceAddress,
  spaceEndpoint,
  writeStored,
} from "./stored.ts";
import { ContinueAs } from "../../join/ContinueAs.tsx";
import { HaveAccount } from "../../join/HaveAccount.tsx";
import { knownIdentity } from "../../join/identity.ts";
import type { Carried, KnownIdentity } from "../../join/identity.ts";
import { carried, checkKnownCode, haveAccountDeps, knownProof, rememberAccount } from "../../join/carry-wiring.ts";
import type { SignInOptions, StoredSession } from "./stored.ts";
import { SSO_FAILED_LINE, SSO_SECOND_FACTOR_LINE, ssoStartUrl, takeSsoReturn } from "./sso.ts";
import { GITHUB_FAILED_LINE, GITHUB_SECOND_FACTOR_LINE, githubStartUrl, takeGithubReturn } from "./github.ts";

const RecoveryAccount = lazy(() =>
  import("../../join/RecoveryAccount.tsx").then((m) => ({ default: m.RecoveryAccount })),
);
const ResetAccount = lazy(() => import("../../join/ResetAccount.tsx").then((m) => ({ default: m.ResetAccount })));
const LocalClaim = lazy(() => import("../../claim/ClaimRoute.tsx").then((m) => ({ default: m.ClaimRoute })));
const JoinProviderSetup = lazy(() => import("./JoinProviderSetup.tsx").then((m) => ({ default: m.JoinProviderSetup })));
const SignedInShell = lazy(() => import("./ShellHost.tsx").then((m) => ({ default: m.ShellHost })));
const AllowScreen = lazy(() => import("../../oauth/AllowScreen.tsx").then((m) => ({ default: m.AllowScreen })));

export interface SessionGateProps {
  baseUrl?: string | null;
  open?: (o: OpenSessionOptions) => Promise<RealSession>;
  onHub?: (hub: ShellHub | null) => void;
  voice?: LoadVoiceDevice;
}

/** A way in that did not reach its Space: what was asked for, what the Space is called, and what was found at its address instead. A saved sign-in it belongs to is kept, never deleted. */
interface Trouble {
  target: EntryTarget;
  name: string;
  found: Found;
  stored?: StoredSession;
}
const OFFLINE: Found = { kind: "offline" };

type Phase = GatePhase<StoredSession>;
/** A host for a button: long ones are cut for display only. */
const shortHost = (h: string): string => (h.length > 40 ? `${h.slice(0, 39)}\u2026` : h);
const noHub = (): void => undefined;
const hostOf = (baseUrl: string): string => baseUrl.replace(/^https?:\/\//, "").split(":")[0] ?? baseUrl;

async function unlockOwnKey(
  baseUrl: string,
  token: string,
  password: string,
  keys: { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string },
): Promise<void> {
  try {
    const { openBundle, heldKeyOf, wipeOpened } = await loadCryptoKeys();
    const opened = await openBundle(password, { ...keys, personKeyByRecovery: keys.personKeyByRecovery ?? "" });
    // a linked Space's data is under its earlier key (keys.ts formerKey): that is the one this Space takes
    try {
      if (await holdKeyOnOwnNode(baseUrl, token, heldKeyOf(opened))) await keepKey(heldKeyOf(opened), token);
    } finally {
      wipeOpened(opened);
    }
  } catch {
    /* personal keys stay locked; signing in does not depend on them */
  }
}

export const SIGNED_OUT_LINE = "You were signed out. Sign in again to continue.";
/** Shown once to a session that has no Vault key on this device (signed in before keys were kept here): one more sign-in, then it never asks again. */
export const KEY_READY_LINE = "Sign in once more so Vyre can keep your Vault ready on this device.";

/**
 * The Space's face on the screens about one Space (sign-in, join, an invite, Continue as, recovery): the Space image, asked of the Space before sign-in (spaces.image is open to anyone, like the
 * name). While it is on its way, or when the Space has none or is too old to answer, the letter shows.
 */
export function WithSpaceImage({ address, children }: { address: string | null; children: ReactNode }): ReactElement {
  const [found, setFound] = useState<{ address: string; image: string } | null>(null);
  useEffect(() => {
    if (!address) return undefined;
    let alive = true;
    void (createCapCaller({ baseUrl: address, token: () => null })("spaces.image", {}) as Promise<{ image?: string }>)
      .then((out) => {
        if (alive && typeof out?.image === "string" && out.image.startsWith("data:image/"))
          setFound({ address, image: out.image });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [address]);
  return (
    <SpaceImageContext.Provider value={found && found.address === address ? found.image : undefined}>
      {children}
    </SpaceImageContext.Provider>
  );
}

/** `github` is true only for a caller that wires the GitHub button (the sign-in screen below); a bare invite never lists a control with nothing behind it. */
export function signInInvite(baseUrl: string, options: SignInOptions | null, github = false, sso = false): JoinInvite {
  return {
    space: spaceLabel(options?.name, baseUrl),
    host: hostOf(baseUrl),
    by: "",
    role: "",
    ...(options?.fingerprint ? { fingerprint: options.fingerprint } : {}),
    sso: sso ? (options?.sso ?? []).map((p) => p.title) : [],
    github: github && options?.github === true,
    adminKey: false, // a provider is offered only to a caller that wires its button, and only when the Space has it on
  };
}

/** Forgot password: the recovery code, or an administrator's reset code. Reached from sign-in and straight from the lock screen, so a person who forgot it is never sent round through signing out. */
function RecoverScreen({
  baseUrl,
  space,
  username,
  open,
  onBack,
  onSignedIn,
}: {
  baseUrl: string;
  space: string;
  username?: string | undefined;
  open: NonNullable<SessionGateProps["open"]>;
  onBack: () => void;
  onSignedIn: (s: StoredSession) => void;
}): ReactElement {
  const anonymous = useMemo(() => createCapCaller({ baseUrl, token: () => null }), [baseUrl]);
  const [resetting, setResetting] = useState(false);
  const verify = (token: string): Promise<StoredSession> =>
    openVerifiedSession({
      baseUrl,
      token,
      open: () => open({ baseUrl, token }),
      getSpace: () => authenticatedSpace(baseUrl, token),
    });
  const holdKey = async (token: string, key: Uint8Array): Promise<boolean> => {
    const held = await holdKeyOnOwnNode(baseUrl, token, key);
    if (held) await keepKey(key, token);
    return held;
  };
  const deviceClass = desktopBridge() ? ("desktop" as const) : ("web" as const);
  if (resetting)
    return (
      <Suspense fallback={<Opening />}>
        <ResetAccount
          space={space}
          address={baseUrl}
          onBack={() => setResetting(false)}
          onReset={async (input) => {
            const keys = await loadCryptoKeys();
            onSignedIn(
              await completeReset(
                { call: anonymous, makeBundle: (pw, rc) => keys.makeBundle(pw, rc), verify, holdKey, wipe: keys.wipe },
                { ...input, deviceClass },
              ),
            );
          }}
        />
      </Suspense>
    );
  return (
    <Suspense fallback={<Opening />}>
      <RecoveryAccount
        space={space}
        address={baseUrl}
        username={username}
        onBack={onBack}
        onAdminReset={() => setResetting(true)}
        onRecover={async (input) => {
          const [crypto, keys] = await Promise.all([loadRecoveryCrypto(), loadCryptoKeys()]);
          onSignedIn(
            await completeRecovery(
              { call: anonymous, recover: crypto.recoverAccountKeys, verify, holdKey, wipe: keys.wipe },
              { ...input, deviceClass },
            ),
          );
        }}
      />
    </Suspense>
  );
}

/** A username and password sign-in at one Space, with the person's own key handed to their own computer's daemon afterwards. The sign-in screen uses it, and so does a computer that has just
 *  joined the person's Personal Space from another computer: the password typed there opens the account, so the person is not asked for it twice (lane l-multidevice). */
async function passwordSignIn(
  baseUrl: string,
  open: NonNullable<SessionGateProps["open"]>,
  v: { username: string; password: string; code?: string },
  options?: SignInOptions | null,
) {
  const anonymous = createCapCaller({ baseUrl, token: () => null });
  let token: string | null = null;
  let keys:
    | { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string }
    | undefined;
  return signInAndVerify({
    baseUrl,
    username: v.username.trim().toLowerCase(),
    discover: async () => options ?? ((await anonymous("identity.sign_in_options", {})) as SignInOptions),
    signIn: async () => {
      const out = (await anonymous("identity.sign_in", {
        username: v.username,
        password: v.password,
        ...signInDevice(),
        ...(v.code ? { totp: v.code } : {}),
      })) as { status: "ok" | "second_factor_required"; session?: { token: string }; keys?: typeof keys };
      token = out.session?.token ?? null;
      keys = out.keys;
      return out;
    },
    open: () => open({ baseUrl, token: token ?? "" }),
    getSpace: async () => {
      const authenticated = createCapCaller({ baseUrl, token: () => token });
      const space = ((await authenticated("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
      return { id: space.id, marker: space.fingerprint };
    },
    afterVerified: async (stored) => {
      if (keys) await unlockOwnKey(baseUrl, stored.token, v.password, keys);
    },
  });
}

function SignInScreen({
  baseUrl,
  open,
  onSignedIn,
  notice,
  onBack,
  onUnreachable,
  username,
  unproven,
}: {
  baseUrl: string;
  open: NonNullable<SessionGateProps["open"]>;
  onSignedIn: (s: StoredSession) => void;
  notice?: boolean | string;
  onBack?: () => void;
  /** The Space did not answer, after the quiet retries: what was found at its address instead (the gate opens a relay Space in the browser, or says what happened with the fix). */
  onUnreachable?: (found: Found) => void;
  /** The username this device last signed in with here (Your Spaces), so a remembered Space asks for the password alone. */
  username?: string | undefined;
  /** An address nothing proves is the Space this device knows (a second saved address): its sign-in shows the plain host, never a name or picture the address supplies. */
  unproven?: boolean;
}): ReactElement {
  useEffect(() => {
    mark("app.usable");
  }, []);
  const anonymous = useMemo(() => createCapCaller({ baseUrl, token: () => null }), [baseUrl]);
  const currentAddress = useRef<string | null>(baseUrl);
  currentAddress.current = baseUrl;
  useEffect(() => {
    currentAddress.current = baseUrl;
    return () => {
      currentAddress.current = null;
    };
  }, [baseUrl]);
  const [discovery, setDiscovery] = useState<{ address: string; options: SignInOptions } | null>(null);
  const options = discovery?.address === baseUrl ? discovery.options : null;
  const [recoveryHelp, setRecoveryHelp] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const unreachable = useRef(onUnreachable);
  unreachable.current = onUnreachable;
  useEffect(() => {
    let active = true;
    const ask = (): Promise<SignInOptions> => anonymous("identity.sign_in_options", {}) as Promise<SignInOptions>;
    const got = (found: SignInOptions): void => {
      if (!active) return;
      setReconnecting(false);
      setDiscovery({ address: baseUrl, options: found });
    };
    void ask()
      .then(got)
      .catch(async () => {
        // no answer. First a worker left from before the Space moved (the page loads again without it); then the quiet retry; only then the screen that says what happened.
        if (await healStaleWorker()) return;
        if (!active) return;
        setReconnecting(true);
        const found = await findSpaceQuietly(baseUrl);
        if (!active) return;
        if (found.kind === "direct") {
          try {
            got(await ask());
            return;
          } catch {
            /* it answered the ask and not this page: said below */
          }
          if (!active) return;
        }
        setReconnecting(false);
        unreachable.current?.(found.kind === "direct" ? { kind: "offline" } : found);
      });
    return () => {
      active = false;
    };
  }, [anonymous, baseUrl]);
  const invite = useMemo(() => {
    const made = signInInvite(baseUrl, options, true, true);
    return unproven ? { ...made, space: made.host } : made;
  }, [baseUrl, options, unproven]);
  const [githubLine, setGithubLine] = useState<string | null>(null);
  useEffect(() => {
    const browser = globalThis as {
      location?: { hash: string; pathname: string; search: string };
      history?: { replaceState(d: unknown, u: string, url: string): void };
    };
    const back = takeGithubReturn(browser.location, (url) => browser.history?.replaceState(null, "", url));
    if (!back) return;
    if ("error" in back) {
      setGithubLine(GITHUB_FAILED_LINE);
      return;
    }
    let token: string | null = null;
    void signInAndVerify({
      baseUrl,
      discover: async () => options ?? ((await anonymous("identity.sign_in_options", {})) as SignInOptions),
      signIn: async () => {
        const out = (await anonymous("identity.github_sign_in", { code: back.code, ...signInDevice() })) as {
          status: "ok" | "second_factor_required";
          session?: { token: string };
        };
        token = out.session?.token ?? null;
        return out;
      },
      open: () => open({ baseUrl, token: token ?? "" }),
      getSpace: async () => {
        const space = (
          (await createCapCaller({ baseUrl, token: () => token })("spaces.get", {})) as {
            space: { id: string; fingerprint: string };
          }
        ).space;
        return { id: space.id, marker: space.fingerprint };
      },
    })
      .then((result) => {
        if (currentAddress.current !== baseUrl) return;
        if (result.status === "second_factor_required") setGithubLine(GITHUB_SECOND_FACTOR_LINE);
        else onSignedIn(result.stored);
      })
      .catch(() => {
        if (currentAddress.current === baseUrl) setGithubLine(GITHUB_FAILED_LINE);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ssoLine, setSsoLine] = useState<string | null>(null);
  useEffect(() => {
    const browser = globalThis as {
      location?: { hash: string; pathname: string; search: string };
      history?: { replaceState(d: unknown, u: string, url: string): void };
    };
    const back = takeSsoReturn(browser.location, (url) => browser.history?.replaceState(null, "", url));
    if (!back) return;
    if ("error" in back) {
      setSsoLine(SSO_FAILED_LINE);
      return;
    }
    let token: string | null = null;
    void signInAndVerify({
      baseUrl,
      discover: async () => options ?? ((await anonymous("identity.sign_in_options", {})) as SignInOptions),
      signIn: async () => {
        const out = (await anonymous("identity.sso_sign_in", {
          provider: back.provider,
          code: back.code,
          state: "-",
          ...signInDevice(),
        })) as { status: "ok" | "second_factor_required"; session?: { token: string } };
        token = out.session?.token ?? null;
        return out;
      },
      open: () => open({ baseUrl, token: token ?? "" }),
      getSpace: async () => {
        const space = (
          (await createCapCaller({ baseUrl, token: () => token })("spaces.get", {})) as {
            space: { id: string; fingerprint: string };
          }
        ).space;
        return { id: space.id, marker: space.fingerprint };
      },
    })
      .then((result) => {
        if (currentAddress.current !== baseUrl) return;
        if (result.status === "second_factor_required") setSsoLine(SSO_SECOND_FACTOR_LINE);
        else onSignedIn(result.stored);
      })
      .catch(() => {
        if (currentAddress.current === baseUrl) setSsoLine(SSO_FAILED_LINE);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const startSso = useCallback(
    (title: string) => {
      const key = options?.sso?.find((p) => p.title === title)?.key;
      const browser = globalThis as { location?: { origin: string; pathname: string; assign(url: string): void } };
      if (key && browser.location)
        browser.location.assign(ssoStartUrl(baseUrl, key, browser.location.origin + browser.location.pathname));
    },
    [baseUrl, options],
  );
  const startGithub = useCallback(() => {
    const browser = globalThis as { location?: { origin: string; pathname: string; assign(url: string): void } };
    if (browser.location)
      browser.location.assign(githubStartUrl(baseUrl, browser.location.origin + browser.location.pathname));
  }, [baseUrl]);
  const signIn = useCallback(
    async (v: { username: string; password: string; code?: string }): Promise<"ok" | "second_factor_required"> => {
      let result: Awaited<ReturnType<typeof passwordSignIn>>;
      try {
        result = await passwordSignIn(baseUrl, open, v, options);
      } catch (e) {
        if (!isUnreachable(e)) throw e;
        // the Space did not answer the sign-in: asked again quietly; once it answers the sign-in goes once more, and only a Space that stays silent is said to be
        setReconnecting(true);
        const found = await findSpaceQuietly(baseUrl);
        setReconnecting(false);
        if (found.kind !== "direct") {
          unreachable.current?.(found);
          throw e;
        }
        result = await passwordSignIn(baseUrl, open, v, options);
      }
      if (currentAddress.current !== baseUrl) throw new Error("The Space address changed. Sign in again.");
      if (result.status === "second_factor_required") return result.status;
      onSignedIn(result.stored);
      return "ok";
    },
    [anonymous, baseUrl, onSignedIn, open, options],
  );
  if (recoveryHelp)
    return (
      <RecoverScreen
        baseUrl={baseUrl}
        space={invite.space}
        open={open}
        onBack={() => setRecoveryHelp(false)}
        onSignedIn={onSignedIn}
      />
    );
  return (
    <JoinFlow
      key={`${baseUrl}|${githubLine ?? ""}|${ssoLine ?? ""}`}
      invite={invite}
      {...(reconnecting ? { status: RECONNECTING } : {})}
      initial={{
        stage: "signin",
        ...(username ? { siUser: username } : {}),
        ...((githubLine ?? ssoLine)
          ? { error: (githubLine ?? ssoLine) as string }
          : notice
            ? { error: typeof notice === "string" ? notice : SIGNED_OUT_LINE }
            : {}),
      }}
      onSignIn={signIn}
      onGithub={startGithub}
      onSso={startSso}
      onRecoveryCode={() => setRecoveryHelp(true)}
      {...(onBack ? { onBackFromSignIn: onBack } : {})}
    />
  );
}

/** Sign in on a desktop with no Space yet: first the person's own Personal Space from their other computer (OtherComputer), or a Space by its address. */
function DesktopSignInDoor({
  invoke,
  back,
  connect,
  onJoined,
  onLocal,
}: {
  invoke: Invoke;
  back: () => void;
  connect: (back: () => void) => ReactElement;
  onJoined: (o: { space: string; username: string; password: string }) => void;
  /** this computer's Personal Space already has its owner: sign in to it here instead of copying one from another computer */ onLocal: (
    address: string,
  ) => void;
}): ReactElement {
  const [byAddress, setByAddress] = useState(false);
  if (byAddress) return connect(() => setByAddress(false));
  return (
    <JoinFrame>
      <OtherComputer
        startLocal={async () => {
          const local = await ensurePersonalSpace(invoke);
          if (!local.claimUrl) {
            onLocal(local.address);
            throw new Error(OWN_SPACE_HERE);
          }
          return { address: local.address };
        }}
        onJoined={onJoined}
        onAddress={() => setByAddress(true)}
        onBack={back}
      />
    </JoinFrame>
  );
}
/** Said only for the moment before the sign-in of this computer's own Personal Space opens. */
const OWN_SPACE_HERE = "This computer has its own Personal Space. Opening its sign-in.";

export function ConnectSpaceWelcome({
  onTarget,
  onGetStarted,
  onBack,
}: {
  /** What was typed, made out as a Space, an invite or an owner link. Rejects with the line to show under the box; `onRetry` is called as each quiet retry starts. */
  onTarget: (target: EntryTarget, onRetry: () => void) => Promise<void>;
  onGetStarted?: () => void;
  onBack?: () => void;
}): ReactElement {
  useEffect(() => {
    mark("app.usable");
  }, []);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const connect = async (): Promise<void> => {
    if (busy) return;
    const target = entryTarget(address);
    if (!target) {
      setError(NOT_AN_INVITE);
      return;
    }
    const current = ++request.current;
    setBusy(true);
    setRetrying(false);
    setError("");
    try {
      await onTarget(target, () => {
        if (request.current === current) setRetrying(true);
      });
    } catch (failure) {
      if (request.current === current)
        setError(failure instanceof Error && failure.message ? failure.message : SPACE_TROUBLE);
    } finally {
      if (request.current === current) {
        setBusy(false);
        setRetrying(false);
      }
    }
  };
  return (
    <JoinFrame>
      <Welcome
        address={address}
        busy={busy}
        retrying={retrying}
        error={error}
        onAddressChange={(value) => {
          request.current++;
          setBusy(false);
          setRetrying(false);
          setAddress(value);
          setError("");
        }}
        onSignIn={() => void connect()}
        onGetStarted={onGetStarted ?? (() => setError("Ask the Space owner for an invite link."))}
        {...(onBack ? { onBack } : {})}
      />
    </JoinFrame>
  );
}

async function authenticatedSpace(baseUrl: string, token: string): Promise<{ id: string; marker: string }> {
  const authenticated = createCapCaller({ baseUrl, token: () => token });
  const space = ((await authenticated("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
  return { id: space.id, marker: space.fingerprint };
}

/** A link's first call failed: was it the link (the Space answers, so the link is spent or wrong) or the Space (it does not answer)? Asked quietly; null means the link. */
async function whyNoAnswer(address: string): Promise<Found | null> {
  const found = await findSpaceQuietly(address).catch((): Found => ({ kind: "offline" }));
  return found.kind === "direct" ? null : found;
}

function DesktopPairScreen({
  route,
  open,
  onSignedIn,
  onSignIn,
  onUnreachable,
}: {
  route: Extract<DesktopRoute, { kind: "pair" }>;
  open: NonNullable<SessionGateProps["open"]>;
  onSignedIn: (s: StoredSession) => void;
  onSignIn: () => void;
  onUnreachable: (found: Found) => void;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let alive = true;
    const anonymous = createCapCaller({ baseUrl: route.address, token: () => null });
    void redeemDesktopPair(route, {
      anonymous,
      open: (token) => open({ baseUrl: route.address, token }),
      getSpace: (token) => authenticatedSpace(route.address, token),
    })
      .then((stored) => {
        if (alive) onSignedIn(stored);
      })
      .catch(async () => {
        // an expired link and a Space that does not answer are different things: only the first is said to be the link
        const why = await whyNoAnswer(route.address);
        if (!alive) return;
        if (why) onUnreachable(why);
        else setFailed(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onUnreachable is the gate's, read when the failure comes
  }, [onSignedIn, open, route]);
  if (!failed) return <Opening title="Pairing this device" testID="pair-working" />;
  return (
    <JoinFrame>
      <Panel bar={<Bar cont={<Button label="Sign in" testID="pair-sign-in" onPress={onSignIn} />} />}>
        <Step id="pair-error">
          <Title title="This pairing link expired" />
        </Step>
      </Panel>
    </JoinFrame>
  );
}

function DesktopJoinScreen({
  route,
  open,
  onSignedIn,
  onBack,
  onSignIn,
  deviceClass,
  onUnreachable,
}: {
  route: Extract<DesktopRoute, { kind: "join" }>;
  open: NonNullable<SessionGateProps["open"]>;
  onSignedIn: (s: StoredSession) => void;
  onBack: () => void;
  onSignIn: () => void;
  deviceClass: "web" | "desktop";
  onUnreachable: (found: Found) => void;
}): ReactElement {
  const anonymous = useMemo(() => createCapCaller({ baseUrl: route.address, token: () => null }), [route.address]);
  const [join, setJoin] = useState<Awaited<ReturnType<typeof previewDesktopJoin>> | null>(null);
  const [setup, setSetup] = useState<{ stored: StoredSession; ai: JoinValues["ai"] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [ssoStarted, setSsoStarted] = useState<string | null>(null);
  const [sso, setSso] = useState<string | null>(null);
  // The account this device already has (rc.14): joining uses it unless the person asks for a different one. "I already have a Vyre account" (rc.17) brings one this device has no session for.
  const [different, setDifferent] = useState(false);
  const [have, setHave] = useState(false);
  const relay = useRelayAddress(route.address, deviceClass === "web");
  const known = useMemo(
    () =>
      join ? knownIdentity(readStoredSessions(), { spaceId: join.preview.spaceId, baseUrl: route.address }) : null,
    [join, route.address],
  );
  // where the Space runs, for the words of a refused save on the AI step (ai-signin/own-ai.ts)
  const home = aiHomeOf(route.address, deviceClass === "desktop");
  useEffect(() => {
    let alive = true;
    setJoin(null);
    setFailed(false);
    void previewDesktopJoin(route, anonymous)
      .then((found) => {
        if (alive) setJoin(found);
      })
      .catch(async () => {
        // a worker left from before the Space moved first (the page loads again without it); then: is it the invite, or the Space that does not answer?
        if (await healStaleWorker()) return;
        const why = await whyNoAnswer(route.address);
        if (!alive) return;
        if (why) onUnreachable(why);
        else setFailed(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onUnreachable is the gate's, read when the failure comes
  }, [anonymous, attempt, route]);
  const onJoin = useCallback(
    async (values: JoinValues): Promise<void> => {
      if (!join) throw new Error("This invite is unavailable. Ask for a new one.");
      try {
        const stored = await acceptDesktopJoin(join, values, {
          anonymous,
          deviceClass,
          ...(sso ? { ssoProvider: sso } : {}),
          open: (token) => open({ baseUrl: route.address, token }),
          getSpace: (token) => authenticatedSpace(route.address, token),
        });
        if (values.ai.choice === "key" || values.ai.choice === "sub") setSetup({ stored, ai: values.ai });
        else onSignedIn(stored);
      } catch (e) {
        if (e instanceof JoinRefused) throw e;
        throw new Error("Could not finish joining this Space. Try again.");
      }
    },
    [anonymous, join, onSignedIn, open, route.address, deviceClass, sso],
  );
  if (setup)
    return (
      <Suspense fallback={<Opening title="Connect your AI" />}>
        <JoinProviderSetup
          stored={setup.stored}
          ai={setup.ai}
          home={home}
          {...(join?.preview.invitedBy ? { invitedBy: join.preview.invitedBy } : {})}
          onOpen={() => onSignedIn(setup.stored)}
          onClearSecret={() =>
            setSetup((current) => {
              if (!current?.ai.key) return current;
              const { key: _secret, ...ai } = current.ai;
              return { ...current, ai };
            })
          }
        />
      </Suspense>
    );
  if (failed)
    return (
      <JoinFrame>
        <Panel
          below={
            <Links>
              <TextButton label="Sign in instead" testID="invite-sign-in" onPress={onSignIn} />
            </Links>
          }
          bar={
            <Bar
              onBack={onBack}
              cont={<Button label="Try again" testID="invite-retry" onPress={() => setAttempt((n) => n + 1)} />}
            />
          }
        >
          <Step id="invite-error">
            <Title title="This invite did not open" sub="It may have expired or been used" />
          </Step>
        </Panel>
      </JoinFrame>
    );
  if (!join) return <Opening title="Opening your invite" testID="step-invite-loading" />;
  const required = join.preview.ssoRequired ?? [];
  if (required.length > 0 && !sso)
    return (
      <JoinSso
        providers={required}
        started={ssoStarted}
        onStart={(key) => {
          void Promise.resolve(anonymous("identity.sso_join_start", { code: route.code, provider: key })).then(
            (out) => {
              const start = (out as { start?: string }).start;
              if (start) {
                (globalThis as { open?: (url: string, target: string) => unknown }).open?.(
                  `${route.address}${start}`,
                  "_blank",
                );
                setSsoStarted(key);
              }
            },
          );
        }}
        onDone={() => setSso(ssoStarted)}
      />
    );
  // one join for every way the account was proved: its username and name, the password this Space signs in with, and its bundle carried here; this device then remembers who it is
  const joinWith = async (c: Carried, from?: KnownIdentity): Promise<void> => {
    const values: JoinValues = {
      username: c.username,
      displayName: c.name,
      password: c.password,
      deviceName: deviceFor(deviceClass).deviceName,
      ai: { choice: "none" },
    };
    try {
      const stored = await acceptDesktopJoin(join, values, {
        anonymous,
        deviceClass,
        ...(sso ? { ssoProvider: sso } : {}),
        open: (token) => open({ baseUrl: route.address, token }),
        getSpace: (token) => authenticatedSpace(route.address, token),
        carry: c.carry,
      });
      const remembered: StoredSession = { ...stored, username: c.username, displayName: c.name };
      writeStored(remembered);
      // the password opened the account there too: that Space's session now knows the username, so the next Space is a plain Continue as
      if (from?.provider && c.viaPassword) rememberAccount(from, c.username);
      onSignedIn(remembered);
    } catch (e) {
      if ((e as { line?: string }).line) throw e;
      if (e instanceof JoinRefused)
        throw new Error(`The username ${c.username} is taken in ${join.preview.spaceName}. Use a different account.`);
      throw new Error("Could not finish joining this Space. Try again.");
    }
  };
  if (have) {
    return (
      <HaveAccount
        prefix="join-have"
        space={spaceLabel(join.preview.spaceName, route.address)}
        working={`Joining ${join.preview.spaceName}`}
        deps={haveAccountDeps(deviceFor(deviceClass))}
        onProof={async (proof) => joinWith(await carried(proof))}
        onBack={() => setHave(false)}
      />
    );
  }
  if (known && !different) {
    const name = known.username ?? known.name;
    return (
      <ContinueAs
        prefix="join-as"
        space={spaceLabel(join.preview.spaceName, route.address)}
        username={name}
        sub={
          known.provider
            ? `Your Vyre password (the one you set when you joined), or your recovery code, to join ${join.preview.spaceName}`
            : `Enter your Vyre password to join ${join.preview.spaceName}`
        }
        working={`Joining ${join.preview.spaceName}`}
        onContinue={async (password) => joinWith(await carried(await knownProof(known, { password })), known)}
        onOther={() => setDifferent(true)}
        onBack={onBack}
        {...(known.provider
          ? {
              either: {
                onCheckCode: (code: string) => checkKnownCode(known, code),
                onRecovery: async (code: string, newPassword: string) =>
                  joinWith(await carried(await knownProof(known, { code, newPassword })), known),
              },
            }
          : {})}
      />
    );
  }
  const invite: JoinInvite = {
    space: spaceLabel(join.preview.spaceName, route.address),
    host: hostOf(route.address),
    by: join.preview.invitedBy,
    role: join.preview.role,
    fingerprint: join.preview.fingerprint,
    sso: [],
    github: false,
    adminKey: false,
    deviceName: deviceFor(deviceClass).deviceName,
  };
  const appLink = deviceClass === "web" ? inviteAppLink(route, relay) : null;
  return (
    <JoinFlow
      invite={invite}
      onJoin={onJoin}
      onHaveAccount={() => setHave(true)}
      {...(deviceClass === "desktop"
        ? { initial: { stage: "steps" as const, step: 0 } }
        : {
            onDownload: () => {
              (globalThis as { open?: (url: string, target: string, features: string) => unknown }).open?.(
                VYRE_DOWNLOADS,
                "_blank",
                "noopener,noreferrer",
              );
            },
          })}
      {...(appLink
        ? {
            onOpenApp: () => {
              (globalThis as { location?: { assign(url: string): void } }).location?.assign(appLink);
            },
          }
        : {})}
    />
  );
}

/** Everyone in this Space must use its single sign-on: a new person proves the invitation's address first, in a browser window, and then chooses their name and the password that wraps their keys. */
function JoinSso({
  providers,
  started,
  onStart,
  onDone,
}: {
  providers: readonly { key: string; title: string }[];
  started: string | null;
  onStart: (key: string) => void;
  onDone: () => void;
}): ReactElement {
  return (
    <JoinFrame>
      <Panel
        bar={
          <Bar
            cont={
              started ? (
                <Button label="I signed in" testID="join-sso-done" onPress={onDone} />
              ) : (
                <Button
                  label={`Continue with ${providers[0]!.title}`}
                  testID="join-sso"
                  onPress={() => onStart(providers[0]!.key)}
                />
              )
            }
          />
        }
      >
        <Step id="join-sso-step">
          <Title title={started ? "Finish in the window that opened" : "This Space uses your work sign-in"} />
        </Step>
      </Panel>
    </JoinFrame>
  );
}

/** A link into a Space this device is already signed in to: open it, or use another account. Never a second account by accident. */
function AlreadyIn({
  session,
  onOpen,
  onOther,
}: {
  session: StoredSession;
  onOpen: () => void;
  onOther: () => void;
}): ReactElement {
  return (
    <JoinFrame>
      <Panel
        space={session.def.name}
        below={
          <Links>
            <TextButton label="Use another account" testID="already-other" onPress={onOther} />
          </Links>
        }
        bar={<Bar cont={<Button label={`Open ${session.def.name}`} testID="already-open" onPress={onOpen} />} />}
      >
        <Step id="already-in">
          <Title
            title={`You are in ${session.def.name}`}
            {...(session.username ? { sub: `Signed in as ${session.username}` } : {})}
          />
        </Step>
      </Panel>
    </JoinFrame>
  );
}

/** The Space on this computer did not start: say so, and offer the two things that can help. */
function StartFailed({ onRetry, onSignIn }: { onRetry: () => void; onSignIn: () => void }): ReactElement {
  return (
    <JoinFrame>
      <Panel
        below={
          <Links>
            <TextButton label="Sign in" testID="start-failed-sign-in" onPress={onSignIn} />
          </Links>
        }
        bar={<Bar cont={<Button label="Try again" testID="start-failed-retry" onPress={onRetry} />} />}
      >
        <Step id="start-failed">
          <Title title="Vyre did not start" />
          <ErrorLine testID="start-failed-line">Your Space could not start on this computer.</ErrorLine>
        </Step>
      </Panel>
    </JoinFrame>
  );
}

/** A Personal Space that never answers must end on a screen: the wait is long enough for a cold start on a slow Mac, and past it the person gets Try again. */
export function withinStart<T>(work: Promise<T>, limit = 60_000): Promise<T> {
  return new Promise((done, fail) => {
    const t = setTimeout(() => fail(new Error("Personal Space did not start")), limit);
    work.then(
      (v) => {
        clearTimeout(t);
        done(v);
      },
      (e) => {
        clearTimeout(t);
        fail(e);
      },
    );
  });
}

async function resumePersonal(
  local: { address: string; spaceId: string },
  old: StoredSession,
  open: NonNullable<SessionGateProps["open"]>,
): Promise<StoredSession> {
  const stored = await openVerifiedSession({
    baseUrl: local.address,
    token: old.token,
    ...(old.username ? { username: old.username } : {}),
    continuity: { id: local.spaceId, marker: old.marker },
    open: () => open({ baseUrl: local.address, token: old.token }),
    getSpace: () => authenticatedSpace(local.address, old.token),
  });
  if (old.baseUrl !== local.address) clearStored(undefined, old.baseUrl);
  return stored;
}

/** The device a sign-in registers: the one answer every way in gives (join/logic.ts deviceFor). */
const signInDevice = (): { deviceName: string; deviceClass: "desktop" | "web" } =>
  deviceFor(desktopBridge() ? "desktop" : "web");

export function SessionGate(props: SessionGateProps): ReactElement {
  // What the first-launch screen reads about this window (the desktop app, the Mac, the width) is known only in the browser: the static page is drawn without it, so the first client
  // render must be drawn without it too (a different door count or title is a hydration mismatch, React #418); it is read right after mount and follows the window size.
  const [windowKnown, setWindowKnown] = useState(false);
  const [windowWidth, setWindowWidth] = useState(1280);
  useEffect(() => {
    const g = globalThis as {
      innerWidth?: number;
      addEventListener?: (t: string, f: () => void) => void;
      removeEventListener?: (t: string, f: () => void) => void;
    };
    const read = (): void => setWindowWidth(g.innerWidth ?? 1280);
    read();
    setWindowKnown(true);
    g.addEventListener?.("resize", read);
    return () => g.removeEventListener?.("resize", read);
  }, []);
  const baseUrl =
    props.baseUrl === undefined ? spaceAddress() : props.baseUrl === null ? null : spaceEndpoint(props.baseUrl);
  const open = props.open ?? openRealSession;
  const onHub = props.onHub ?? noHub;
  const [phase, phaseDo] = useReducer(phaseStep<StoredSession>, { kind: "signin" } as Phase);
  const [ready, setReady] = useState(false);
  const [loadedAddress, setLoadedAddress] = useState<string | null | undefined>(undefined);
  const previousAddress = useRef<string | null | undefined>(undefined);
  const [notice, setNotice] = useState<boolean | string>(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [desktopRoute, setDesktopRoute] = useState<DesktopRoute | null>(null);
  const [entry, setEntry] = useState(false);
  const [entryStart, setEntryStart] = useState<"choice" | "join" | "team" | "add">("choice");
  // Getting in (rc.41): Your Spaces (home), a row being reached again quietly, a Space that did not answer (trouble), and a relay Space the app opened in the browser.
  const [gi, giDo] = useReducer(
    overlayStep<Trouble, { target: EntryTarget; name: string }>,
    OVERLAY_START as Overlay<Trouble, { target: EntryTarget; name: string }>,
  );
  const { home, reaching, trouble, busy: troubleBusy, browser: inBrowser } = gi;
  const [oldData, setOldData] = useState(false);
  const [signInAs, setSignInAs] = useState<string | undefined>(undefined);
  const [shellTry, setShellTry] = useState(0);
  const shellRetried = useRef(new Set<string>());
  const rowBusy = useRef(false);
  // A claim that runs in this app: the Personal Space or a Mac server (local), or a team Space's owner link pasted here or handed over from a browser (rc.14), which keeps the account this app has.
  const [personalClaim, setPersonalClaim] = useState<{
    address: string;
    token: string;
    fragment: string;
    local?: false;
  } | null>(null);
  const [returnSession, setReturnSession] = useState<StoredSession | null>(null);
  const [loadedProp, setLoadedProp] = useState<string | null | undefined>("");
  const [startTry, setStartTry] = useState(0);
  const [forgot, setForgot] = useState(false);
  const [otherAccount, setOtherAccount] = useState(false);
  const [allow, setAllow] = useState<Extract<DesktopRoute, { kind: "allow" }> | null>(null);
  const bridge = useMemo(() => desktopBridge(), []);

  useEffect(() => {
    setLoadedProp(props.baseUrl);
    if (props.baseUrl === null) {
      setLoadedAddress(null);
      setReady(true);
      return;
    }
    const changed =
      previousAddress.current !== undefined && previousAddress.current !== null && previousAddress.current !== baseUrl;
    previousAddress.current = baseUrl;
    if (changed) {
      setNotice(false);
      setDesktopRoute(null);
      setConnectedAddress(null);
    }
    // this computer's Personal Space starts on a new port after every update or restart: its saved session is found by kind and re-homed below (resumePersonal), never left behind
    // with no address named, the Space used last opens; a Space that now opens in the browser (it moved to Vyre's relay) is never opened by itself at launch: Your Spaces shows instead
    const rows = yourSpaces();
    const first = baseUrl
      ? readStored(undefined, baseUrl)
      : (rows.find((r) => r.state === "in")?.session ?? (rows.length ? null : readStored()));
    const stored = first ?? (baseUrl && bridge && isLoopbackUrl(baseUrl) ? readStoredPersonal() : null);
    const href = (globalThis as { location?: { href?: string } }).location?.href;
    const incoming = href ? entryTarget(href) : null;
    const phonePair = href && baseUrl && !stored ? pairFromUrl(href, baseUrl) : null;
    if (phonePair) {
      const loc = (globalThis as { location?: { pathname: string; hash: string }; history?: History }).location;
      const url = new URL(href!);
      url.searchParams.delete("pair");
      globalThis.history?.replaceState(null, "", url.pathname + url.search + (loc?.hash ?? ""));
      setDesktopRoute(phonePair);
      phaseDo({ e: "out" });
    } else if (baseUrl !== null && incoming?.kind === "join") {
      setDesktopRoute(incoming);
      phaseDo({ e: "out" });
    } else if (stored?.def.kind === "personal" && isLoopbackUrl(stored.baseUrl) && bridge) {
      const invoke = (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
      if (invoke) {
        let alive = true;
        phaseDo({ e: "opening" });
        setLoadedAddress(baseUrl);
        setReady(true);
        void withinStart(
          ensurePersonalSpace(invoke).then(async (local) => {
            if (local.spaceId !== stored.def.spaceId || local.claimUrl)
              throw new Error("Personal Space identity changed");
            return { local, resumed: await resumePersonal(local, stored, open) };
          }),
        )
          .then(({ local, resumed }) => {
            if (alive) {
              setConnectedAddress(local.address);
              phaseDo({ e: "in", stored: resumed });
            }
          })
          .catch((failure: unknown) => {
            if (!alive) return;
            if (failure instanceof Error && failure.message === "Personal Space identity changed") {
              phaseDo({ e: "out" });
              setNotice(true);
            } else phaseDo({ e: "start-failed", stored });
          });
        return () => {
          alive = false;
        };
      }
      phaseDo({ e: "in", stored });
    } else phaseDo({ e: "in", stored });
    setLoadedAddress(baseUrl);
    setReady(true);
  }, [baseUrl, props.baseUrl, bridge, open, startTry]);
  useEffect(() => {
    if (!bridge) return undefined;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void consumeDesktopBootstrap(bridge, (route) => {
      if (!alive) return;
      // an app asked to join: the Allow screen over whatever the person is doing. Not signed in to that Space here: the normal sign-in first, then the same screen.
      if (route.kind === "claim") {
        setEntry(false);
        setOtherAccount(false);
        setDesktopRoute(null);
        setNotice(false);
        setPersonalClaim({ address: route.address, token: route.token, fragment: route.fragment, local: false });
        return;
      }
      if (route.kind === "allow") {
        setAllow(route);
        if (!readStored(undefined, route.address)) {
          setEntry(false);
          setPersonalClaim(null);
          setDesktopRoute({ kind: "signin", address: route.address });
          phaseDo({ e: "out" });
        }
        return;
      }
      // a link to one thing in a Space this computer is signed in to opens in place, through reach: no sign-in screen, nobody signed out for it
      if (route.kind === "signin" && route.item) {
        holdOpen(route.item);
        if (readStored(undefined, route.address)) return;
      }
      // a link opens its own screen from wherever the person is: the doors, a half-filled entry, a Personal claim
      setEntry(false);
      setPersonalClaim(null);
      setOtherAccount(false);
      setDesktopRoute(route);
      setNotice(false);
      phaseDo({ e: "out" });
    })
      .then((off) => {
        if (alive) unlisten = off;
        else off();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [bridge]);

  const phaseNow = useRef(phase);
  phaseNow.current = phase;
  // a Space the person is in is remembered for Your Spaces, with the newest use first
  useEffect(() => {
    if (phase.kind === "shell") rememberSession(phase.stored);
  }, [phase]);
  const activateAddress = (stored: StoredSession, restoreTabs: boolean): boolean => {
    const loc = (
      globalThis as {
        location?: { origin: string; search: string; pathname: string; hash: string; assign(url: string): void };
        history?: History;
      }
    ).location;
    if (!loc) return true;
    const where = restoreTabs
      ? storedPlace(
          stored,
          (() => {
            try {
              return globalThis.localStorage;
            } catch {
              return undefined;
            }
          })(),
        )
      : null;
    if (where) {
      const destination = activationUrl(stored, loc, where);
      if (destination.external) {
        loc.assign(destination.url);
        return false;
      }
      globalThis.history?.replaceState(globalThis.history.state, "", destination.url);
    } else if (isPackagedOrigin(loc.origin)) {
      const query = new URLSearchParams(loc.search);
      query.set("space", stored.baseUrl);
      globalThis.history?.replaceState(globalThis.history.state, "", loc.pathname + "?" + query + loc.hash);
    }
    return true;
  };
  const switchSpace = async (spaceId: string): Promise<void> => {
    if (phase.kind !== "shell" || phase.stored.def.spaceId === spaceId) return;
    const target = readStoredSpace(spaceId);
    if (!target) return;
    const previous = phase.stored;
    setReturnSession(previous);
    setNotice(false);
    setDesktopRoute(null);
    let chosen = target;
    if (target.def.kind === "personal" && bridge) {
      const native = (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
      if (native) {
        phaseDo({ e: "opening" });
        try {
          const local = await ensurePersonalSpace(native);
          if (local.spaceId !== target.def.spaceId || local.claimUrl)
            throw new Error("Personal Space identity changed");
          chosen = await resumePersonal(local, target, open);
        } catch {
          setConnectedAddress(target.baseUrl);
          setNotice(true);
          phaseDo({ e: "out" });
          return;
        }
      }
    }
    if (!activateAddress(chosen, true)) return;
    setConnectedAddress(chosen.baseUrl);
    // the same Space again (Your Spaces over its failed screen, then its row): the shell opens afresh instead of staying on the failure
    if (phaseNow.current.kind === "shell" && phaseNow.current.stored.baseUrl === chosen.baseUrl)
      setShellTry((n) => n + 1);
    phaseDo({ e: "in", stored: chosen });
  };
  // One saved Space, entered as it was left: this computer's Personal Space is verified at the port it runs on now; any other opens at its own address.
  const enterSaved = async (target: StoredSession): Promise<void> => {
    let chosen = target;
    const native = (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
    if (target.def.kind === "personal" && isLoopbackUrl(target.baseUrl) && bridge && native) {
      phaseDo({ e: "opening" });
      try {
        const local = await withinStart(ensurePersonalSpace(native));
        if (local.spaceId !== target.def.spaceId || local.claimUrl) throw new Error("Personal Space identity changed");
        chosen = await resumePersonal(local, target, open);
      } catch {
        setConnectedAddress(target.baseUrl);
        phaseDo({ e: "out" });
        return;
      }
    }
    if (!activateAddress(chosen, true)) return;
    setEntry(false);
    giDo({ e: "enter" });
    setDesktopRoute(null);
    setConnectedAddress(chosen.baseUrl);
    phaseDo({ e: "in", stored: chosen });
  };
  // Signing out of one Space never signs out of the others (owner, 10 Nov): that Space's sign-in shows, its key alone is forgotten, and Back opens the next saved Space as it was.
  const signedOut = (why?: "manual" | "key", selected?: string): void => {
    const gone = selected ? readStored(undefined, selected) : null;
    clearStored(undefined, selected);
    if (gone) forgetKey(gone.token);
    const rest = readStoredSessions();
    if (rest.length === 0) forgetKey();
    setReturnSession(rest[0] ?? null);
    setNotice(why === "key" ? KEY_READY_LINE : why !== "manual");
    phaseDo({ e: "out" });
  };
  const signedIn = useCallback(
    (stored: StoredSession) => {
      activateAddress(stored, !!returnSession);
      setUnproven(null);
      setEntry(false);
      giDo({ e: "enter" });
      setSignInAs(undefined);
      setReturnSession(null);
      phaseDo({ e: "in", stored: stored });
    },
    [returnSession],
  );
  const signedInFromDesktop = useCallback((stored: StoredSession) => {
    activateAddress(stored, true);
    consumeBrowserInvite();
    setEntry(false);
    giDo({ e: "enter" });
    setReturnSession(null);
    setDesktopRoute((route) => consumeDesktopRoute(route));
    phaseDo({ e: "in", stored: stored });
  }, []);

  const page = (): Location | undefined => (globalThis as { location?: Location }).location;
  /** A web page (not the desktop app) on another address than this one: the browser goes there itself, and that page does the rest. */
  const elsewhere = (address: string): boolean => {
    const loc = page();
    try {
      return !!loc && !isPackagedOrigin(loc.origin) && new URL(address).origin !== loc.origin;
    } catch {
      return false;
    }
  };
  const spaceName = (address: string): string =>
    yourSpaces().find((r) => r.address === address)?.name ?? spaceHost(address);
  /** A Space on Vyre's relay, from the desktop app: the app opens it in the browser for the person (entry.ts browserLink says why it cannot carry it itself) and keeps it in Your Spaces. */
  const openInBrowser = (target: EntryTarget, name: string, remember = true): void => {
    if (remember) rememberBrowserSpace({ address: target.address, name });
    (globalThis as { open?: (url: string, target?: string) => unknown }).open?.(browserLink(target), "_blank");
    setEntry(false);
    setPersonalClaim(null);
    setDesktopRoute(null);
    giDo({ e: "browser", browser: { target, name } });
  };
  /** Where a way in goes when its address did not answer as a Space this window can use: the browser for a relay Space that is awake, else the screen that says what happened and carries the fix. */
  const landed = (target: EntryTarget, found: Found, stored?: StoredSession): void => {
    const name = (found.kind === "relay" && found.label) || stored?.def.name || spaceName(target.address);
    const where = decideLanded({ found, bridge: !!bridge, away: elsewhere(target.address) });
    if (where === "open-in-browser") {
      openInBrowser(target, name, found.kind === "relay" && found.sure);
      return;
    }
    if (where === "browser-goes") {
      page()?.assign(browserLink(target));
      return;
    }
    if (found.kind === "relay" && found.sure && bridge) rememberBrowserSpace({ address: target.address, name });
    setEntry(false);
    giDo({ e: "trouble", trouble: { target, name, found, ...(stored ? { stored } : {}) } });
  };
  /** The address answers as a Space: go in. A saved sign-in opens it; an owner link claims it; anything else is its sign-in or its invite. */
  const enterTarget = async (target: EntryTarget, stored?: StoredSession, fresh = false): Promise<void> => {
    setUnproven(fresh ? target.address : null);
    const have = fresh ? null : (stored ?? (target.kind === "signin" ? readStored(undefined, target.address) : null));
    if (have && target.kind === "signin") {
      await enterSaved(have);
      return;
    }
    if (target.kind === "claim") {
      if (bridge) {
        const link = new URL(target.url);
        setPersonalClaim({
          address: target.address,
          token: link.pathname.slice("/claim/".length),
          fragment: link.hash,
          local: false,
        });
        setEntry(false);
        giDo({ e: "leave-list" });
        return;
      }
      page()?.assign(target.url);
      return;
    }
    setEntry(false);
    giDo({ e: "enter" });
    setConnectedAddress(target.address);
    setDesktopRoute(target);
    setNotice(false);
    phaseDo({ e: "out" });
  };
  /**
   * The one address box (and every link handed to the app): find what is at the address, quietly asking again before saying anything, then go the way that fits. It rejects with the line
   * the box shows when the fix is the box itself (a wrong name, nothing answering); every other outcome is a screen of its own.
   */
  const chooseEntry = async (target: EntryTarget, onRetry?: () => void): Promise<void> => {
    const away = elsewhere(target.kind === "claim" ? target.url : target.address);
    if (!away && target.kind === "signin") {
      const have =
        readStored(undefined, target.address) ??
        (bridge && isLoopbackUrl(target.address) ? readStoredPersonal() : null);
      if (have?.def.kind === "personal" && have.baseUrl !== target.address) {
        await enterSaved(have);
        return;
      }
      if (have) {
        setConnectedAddress(have.baseUrl);
        signedIn(have);
        return;
      }
    }
    // this computer's own Space (the app started it) is not asked across the network first: its screen reaches it and says so if it cannot
    const own = !!bridge && isLoopbackUrl(target.address);
    const found: Found = own
      ? { kind: "direct" }
      : await findSpaceQuietly(target.address, onRetry ? { onRetry } : {}).catch(() => OFFLINE);
    const host = spaceHost(target.address);
    const outcome = decideEntry({ found, away });
    if (outcome.to === "box-line")
      throw new Error(
        outcome.why === "no-space"
          ? noSpaceAt(host)
          : outcome.why === "not-answering"
            ? boxNotAnswering(host)
            : notASpaceAt(host),
      );
    if (outcome.to === "browser-goes") {
      page()?.assign(browserLink(target));
      return;
    }
    if (outcome.to === "landed") {
      landed(target, found);
      return;
    }
    await enterTarget(target);
  };
  /** Try again on the screen for a Space that did not answer: asked again (quietly, more than once), then in, or the same screen with what is true now. */
  const troubleNow = useRef(trouble);
  troubleNow.current = trouble;
  const retryTrouble = async (): Promise<void> => {
    const t = trouble;
    if (!t || troubleBusy) return;
    const stillHere = (): boolean => troubleNow.current === t;
    giDo({ e: "busy", on: true });
    const found = await findSpaceQuietly(t.target.address).catch(() => OFFLINE);
    giDo({ e: "busy", on: false });
    // the person went Back (or on elsewhere) while the Space was being asked: the answer is for a screen that is gone
    if (!stillHere()) return;
    if (found.kind !== "direct") {
      landed(t.target, found, t.stored);
      return;
    }
    giDo({ e: "trouble-clear" });
    shellRetried.current.delete(t.target.address);
    setShellTry((n) => n + 1);
    await enterTarget(t.target, t.stored);
  };
  const retryTroubleNow = useRef(retryTrouble);
  retryTroubleNow.current = retryTrouble;
  // a relay Space that is asleep is asked again every 20 seconds by itself, so the screen opens the Space when its computer wakes
  useEffect(() => {
    if (!trouble || trouble.found.kind !== "relay") return undefined;
    const timer = setInterval(() => void retryTroubleNow.current(), 20_000);
    return () => clearInterval(timer);
  }, [trouble]);
  // Clear old data is offered only where there is some to clear: a browser page of this very Space that holds a worker or cached pages
  useEffect(() => {
    setOldData(false);
    if (!trouble || bridge || elsewhere(trouble.target.address)) return undefined;
    let alive = true;
    void hasOldData().then((yes) => {
      if (alive) setOldData(yes);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- elsewhere reads the page, which does not change under a screen
  }, [trouble, bridge]);
  const clearOld = async (): Promise<void> => {
    await clearOldData();
    page()?.reload();
  };
  /** One press on a row of Your Spaces. */
  const openRow = async (row: SpaceRow): Promise<void> => {
    if (rowBusy.current) return;
    const target: EntryTarget = { kind: "signin", address: row.address };
    if (row.state === "in" && row.session) {
      shellRetried.current.delete(row.address);
      await enterSaved(row.session);
      return;
    }
    if (elsewhere(row.address)) {
      page()?.assign(browserLink(target));
      return;
    }
    if (row.state === "out") {
      // its sign-in, with the username already there; that screen reaches the Space and says so quietly if it has to ask twice
      setSignInAs(row.username);
      await enterTarget(target);
      return;
    }
    // a Space that opens in the browser: asked where it is now, since it may have moved to an address of its own
    rowBusy.current = true;
    try {
      const found = await findSpaceQuietly(row.address, {
        onRetry: () => giDo({ e: "reach", address: row.address }),
      }).catch(() => OFFLINE);
      giDo({ e: "reach", address: null });
      if (found.kind === "direct") {
        setSignInAs(row.username);
        await enterTarget(target, row.session ?? undefined);
      } else landed(target, found, row.session ?? undefined);
    } finally {
      rowBusy.current = false;
    }
  };
  /** The shell could not open a saved Space: ask where the Space is now. It answers: open once more. It moved to the relay: the browser. Else the screen with the fix. The sign-in is kept. */
  // Your Spaces opened from the failed screen of a Space: the address of that Space, while the list shows (cleared when it closes)
  const [unproven, setUnproven] = useState<string | null>(null);
  const [underShell, setUnderShell] = useState<string | null>(null);
  useEffect(() => {
    if (!home) setUnderShell(null);
  }, [home]);
  /** A Space saved at two addresses whose used-last one is not answering: the person may press the other. Its own sign-in opens (the address named on the button; no username typed for them), never the saved token, and only when that address answers as a Space naming the same id. (A Space id is public, so this guards an accident, not an attack; the person decides and sees the address.) */
  const useNearby = async (from: StoredSession, other: StoredSession, on: Trouble): Promise<void> => {
    if (troubleBusy) return;
    giDo({ e: "busy", on: true });
    const found = await findSpaceQuietly(other.baseUrl).catch(() => OFFLINE);
    const named = found.kind === "direct" ? await spaceIdAt(other.baseUrl) : null;
    giDo({ e: "busy", on: false });
    // the person went Back or on elsewhere while the other address was asked: the answer is for a screen that is gone
    if (troubleNow.current !== on) return;
    if (found.kind === "direct" && named === from.def.spaceId && named === other.def.spaceId) {
      setSignInAs(undefined);
      await enterTarget({ kind: "signin", address: other.baseUrl }, undefined, true);
      return;
    }
    landed({ kind: "signin", address: other.baseUrl }, found.kind === "direct" ? { kind: "there" } : found, other);
  };
  const shellUnreachable = (stored: StoredSession): void => {
    if (isLoopbackUrl(stored.baseUrl)) return;
    // a worker left in this browser from before the Space moved comes first: the page loads again without it
    void healStaleWorker()
      .then((reloading) => (reloading ? null : findSpaceQuietly(stored.baseUrl).catch(() => OFFLINE)))
      .then((found) => {
        if (!found) return;
        const now = phaseNow.current;
        if (now.kind !== "shell" || now.stored.baseUrl !== stored.baseUrl) return;
        if (found.kind === "direct") {
          if (shellRetried.current.has(stored.baseUrl)) return;
          shellRetried.current.add(stored.baseUrl);
          setShellTry((n) => n + 1);
          return;
        }
        landed({ kind: "signin", address: stored.baseUrl }, found, stored);
      });
  };
  const invoke = (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
  const createPersonal = async (): Promise<void> => {
    if (!invoke) throw new Error("Desktop shell required");
    const local = await ensurePersonalSpace(invoke);
    if (local.claimUrl) {
      const link = new URL(local.claimUrl);
      setPersonalClaim({ address: local.address, token: link.pathname.slice("/claim/".length), fragment: link.hash });
      setEntry(false);
    } else {
      const old = readStoredSpace(local.spaceId);
      if (old?.def.kind === "personal" && isLoopbackUrl(old.baseUrl)) {
        const stored = await resumePersonal(local, old, open);
        setConnectedAddress(local.address);
        signedIn(stored);
      } else await chooseEntry({ kind: "signin", address: local.address });
    }
  };
  const createMacServer = async (): Promise<void> => {
    if (!invoke) throw new Error("Desktop shell required");
    const local = await ensureMacServer(invoke);
    if (local.claimUrl) {
      const link = new URL(local.claimUrl);
      setPersonalClaim({ address: local.address, token: link.pathname.slice("/claim/".length), fragment: link.hash });
      setEntry(false);
    } else await chooseEntry({ kind: "signin", address: local.address });
  };
  // first launch on the desktop app: three doors; elsewhere (and for a person who already has a Space) the plain connect screen
  const connectScreen = (back?: () => void): ReactElement => (
    <ConnectSpaceWelcome
      onTarget={chooseEntry}
      onGetStarted={() => {
        setEntryStart("choice");
        setEntry(true);
      }}
      {...(back ? { onBack: back } : {})}
    />
  );
  // the Personal Space this computer just joined restarts on its copy: wait for it to answer as that Space, then sign in there
  // the password typed to join already opened the account: sign in with it once here and hand the key to this computer's daemon, so the person is never asked again (owner rule). A second factor,
  // or a sign-in that fails, falls back to the sign-in screen at the joined Space.
  const joinedPersonal = async ({
    space,
    username,
    password,
  }: {
    space: string;
    username: string;
    password: string;
  }): Promise<void> => {
    if (!invoke) return;
    for (let i = 0; i < 120; i++) {
      let local: { address: string; spaceId: string; claimUrl?: string | null } | null = null;
      try {
        local = await ensurePersonalSpace(invoke);
      } catch {
        /* restarting */
      }
      if (local && local.spaceId === space && !local.claimUrl) {
        try {
          const r = await passwordSignIn(local.address, open, { username, password });
          if (r.status === "ok") {
            setConnectedAddress(local.address);
            signedIn(r.stored);
            return;
          }
        } catch {
          /* the sign-in screen says why */
        }
        await chooseEntry({ kind: "signin", address: local.address });
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    phaseDo({ e: "out" });
  };
  const existingScreen = invoke
    ? (back: () => void): ReactElement => (
        <DesktopSignInDoor
          invoke={invoke}
          back={back}
          connect={connectScreen}
          onJoined={(o) => void joinedPersonal(o)}
          onLocal={(address) => {
            const saved = readStoredPersonal();
            if (saved) void enterSaved(saved);
            else void chooseEntry({ kind: "signin", address });
          }}
        />
      )
    : connectScreen;
  const device = windowKnown
    ? deviceOf({ desktop: !!invoke, mac: isMacShell(), width: windowWidth })
    : deviceOf({ desktop: false, mac: false, width: 1280 });
  const getApp = (): void => {
    (globalThis as { open?: (url: string, target?: string) => unknown }).open?.(VYRE_DOWNLOADS, "_blank");
  };
  const emailApp = (): void => {
    (globalThis as { location?: { assign(url: string): void } }).location?.assign(
      `mailto:?subject=${encodeURIComponent("Get Vyre")}&body=${encodeURIComponent(VYRE_DOWNLOADS)}`,
    );
  };
  const rows = yourSpaces();
  const addSpace = (): void => {
    giDo({ e: "leave-list" });
    setEntryStart("add");
    setEntry(true);
  };
  const spacesScreen = (
    <YourSpaces rows={rows} reconnecting={reaching} onOpen={(row) => void openRow(row)} onAdd={addSpace} />
  );
  const firstLaunch = (
    <FirstLaunch
      device={device}
      existing={existingScreen}
      {...(device === "web" ? { onGetApp: getApp } : {})}
      onDoor={async (door) => {
        if (door === "invited") {
          setEntryStart("join");
          setEntry(true);
          return;
        }
        if (door === "server") {
          setEntryStart("team");
          setEntry(true);
          return;
        }
        if (door === "app") {
          emailApp();
          return;
        }
        wantTeamNext(door === "team");
        await createPersonal();
      }}
    />
  );
  // opening Vyre with nothing open: the Spaces this device has used, one press each; the doors only for a device that has used none
  const firstScreen = rows.length > 0 ? spacesScreen : firstLaunch;
  /** Back from a screen about one Space: Your Spaces when there are any, else the doors. */
  const backHome = (): void => {
    const spaces = yourSpaces().length > 0;
    giDo({ e: "back", spaces });
    setSignInAs(undefined);
    if (spaces) return;
    setConnectedAddress(null);
    setDesktopRoute(null);
    phaseDo({ e: "out" });
  };
  if (personalClaim)
    return (
      <Suspense fallback={<Opening />}>
        <LocalClaim
          deviceClass="desktop"
          local={personalClaim.local !== false}
          token={personalClaim.token}
          address={personalClaim.address}
          fragment={personalClaim.fragment}
          onBack={() => setPersonalClaim(null)}
          onDone={() => {
            const address = personalClaim.address,
              stored = readStored(undefined, address);
            setPersonalClaim(null);
            if (stored) {
              setConnectedAddress(address);
              signedIn(stored);
            } else void chooseEntry({ kind: "signin", address });
          }}
          onSignIn={() => {
            const address = personalClaim.address;
            setPersonalClaim(null);
            void chooseEntry({ kind: "signin", address });
          }}
        />
      </Suspense>
    );
  if (entry)
    return (
      <SpaceEntry
        startAt={entryStart}
        {...(invoke ? { onCreatePersonal: createPersonal } : {})}
        {...(invoke && isMacShell() ? { onCreateMacServer: createMacServer } : {})}
        onTarget={chooseEntry}
        onBack={() => {
          setEntry(false);
          setDesktopRoute(null);
          if (entryStart === "add") {
            setReturnSession(null);
            giDo({ e: "list" });
            return;
          }
          const previous = returnSession ?? readStored(undefined, baseUrl ?? undefined);
          if (previous) {
            activateAddress(previous, true);
            setConnectedAddress(previous.baseUrl);
            consumeBrowserInvite();
            setDesktopRoute(null);
            phaseDo({ e: "in", stored: previous });
          }
          setReturnSession(null);
        }}
      />
    );
  if (allow) {
    const present = readStored(undefined, allow.address);
    if (present)
      return (
        <Suspense fallback={<Opening />}>
          <AllowScreen
            call={createCapCaller({ baseUrl: allow.address, token: () => present.token })}
            requestId={allow.request}
            me={present.username ?? "you"}
            onDone={() => setAllow(null)}
          />
        </Suspense>
      );
  }
  // the first frame of every path: the mark on the sheet, the same in the static page, the first client render and the moment before a stored session is read, so no screen shows for one frame and swaps
  if (loadedAddress !== baseUrl || !ready || loadedProp !== props.baseUrl) return <Opening />;
  if (inBrowser)
    return (
      <SpaceImageContext.Provider value={rows.find((r) => r.address === inBrowser.target.address)?.image}>
        <InBrowser
          space={inBrowser.name}
          onAgain={() => openInBrowser(inBrowser.target, inBrowser.name)}
          onBack={backHome}
        />
      </SpaceImageContext.Provider>
    );
  if (trouble) {
    const found = trouble.found;
    const host = spaceHost(trouble.target.address);
    const words =
      found.kind === "relay"
        ? {
            title: asleep(trouble.name),
            sub: [ASLEEP_SUB, seenAgo(found.seenAt)].filter(Boolean).join(". "),
            checking: true,
          }
        : found.kind === "none"
          ? { title: `No Space at ${host}`, sub: "It may have moved. Check its address" }
          : {};
    return (
      <SpaceImageContext.Provider
        value={trouble.stored?.def.image ?? rows.find((r) => r.address === trouble.target.address)?.image}
      >
        <NotAnswering
          space={trouble.name}
          {...words}
          reconnecting={troubleBusy}
          onRetry={() => void retryTrouble()}
          {...(oldData ? { onClear: () => void clearOld() } : {})}
          {...(trouble.stored && siblingSessions(trouble.stored)[0]
            ? {
                onOther: () => void useNearby(trouble.stored!, siblingSessions(trouble.stored!)[0]!, trouble),
                otherLabel: `Sign in at ${shortHost(spaceHost(siblingSessions(trouble.stored)[0]!.baseUrl))}`,
              }
            : {})}
          {...(bridge && !isLoopbackUrl(trouble.target.address)
            ? {
                // a relay Space lives in the browser from now on; any other is only looked at there, and stays what it was here
                onBrowser: () =>
                  found.kind === "relay"
                    ? openInBrowser(trouble.target, trouble.name)
                    : void (globalThis as { open?: (url: string, target?: string) => unknown }).open?.(
                        browserLink(trouble.target),
                        "_blank",
                      ),
              }
            : {})}
          onBack={backHome}
        />
      </SpaceImageContext.Provider>
    );
  }
  const renderShell = (phase: Extract<Phase, { kind: "shell" }>): ReactElement => (
    <KeyGate
      baseUrl={phase.stored.baseUrl}
      token={phase.stored.token}
      name={lockName(phase.stored)}
      onSignOut={() => signedOut("manual", phase.stored.baseUrl)}
      onForgot={() => setForgot(true)}
    >
      <Suspense fallback={<View style={styles.fill} />}>
        <SignedInShell
          key={`${phase.stored.baseUrl}${phase.stored.personId}:${shellTry}`}
          stored={phase.stored}
          open={open}
          onUnreachable={() => shellUnreachable(phase.stored)}
          onSignedOut={(why) => signedOut(why, phase.stored.baseUrl)}
          onHub={onHub}
          voice={props.voice}
          onSwitchSpace={(id) => void switchSpace(id)}
          onYourSpaces={() => {
            setUnderShell(phase.stored.baseUrl);
            giDo({ e: "list" });
          }}
          onAddSpace={() => {
            setReturnSession(phase.stored);
            setEntryStart("choice");
            setEntry(true);
          }}
        />
      </Suspense>
    </KeyGate>
  );
  // Your Spaces from the screen for a Space that would not load: the failed shell is not kept running behind the list (nothing of it can see a key typed here); Back opens that Space again, and
  // the shell asks for its pages afresh. A Space that was open and fine is never put here.
  if (home && rows.length > 0) {
    if (phase.kind === "shell" && !forgot && underShell === phase.stored.baseUrl)
      return (
        <YourSpaces
          rows={rows}
          reconnecting={reaching}
          onOpen={(row) => void openRow(row)}
          onAdd={addSpace}
          onBack={() => {
            setShellTry((n) => n + 1);
            giDo({ e: "leave-list" });
          }}
        />
      );
    return spacesScreen;
  }
  if (phase.kind === "opening-personal") return <Opening testID="opening-personal" />;
  // Sign in from here keeps the saved session: the next launch, or Try again, still opens it (a Space that did not start is no reason to forget a sign-in)
  if (phase.kind === "start-failed")
    return (
      <StartFailed
        onRetry={() => setStartTry((n) => n + 1)}
        onSignIn={() => {
          phaseDo({ e: "out" });
          setConnectedAddress(null);
        }}
      />
    );
  if (phase.kind === "shell" && forgot)
    return (
      <SpaceImageContext.Provider value={phase.stored.def.image}>
        <RecoverScreen
          baseUrl={phase.stored.baseUrl}
          space={phase.stored.def.name}
          username={phase.stored.username}
          open={open}
          onBack={() => setForgot(false)}
          onSignedIn={(stored) => {
            setForgot(false);
            signedIn(stored);
          }}
        />
      </SpaceImageContext.Provider>
    );
  if (phase.kind === "shell") return renderShell(phase);
  if (desktopRoute?.kind === "pair")
    return (
      <DesktopPairScreen
        key={`${desktopRoute.address}:${desktopRoute.code}`}
        route={desktopRoute}
        open={open}
        onSignedIn={signedInFromDesktop}
        onSignIn={() => {
          const address = desktopRoute.address;
          setDesktopRoute({ kind: "signin", address });
        }}
        onUnreachable={(found) => landed({ kind: "signin", address: desktopRoute.address }, found)}
      />
    );
  if (desktopRoute?.kind === "join") {
    const present = otherAccount ? null : readStored(undefined, desktopRoute.address);
    if (present)
      return (
        <AlreadyIn
          session={present}
          onOpen={() => {
            setDesktopRoute(null);
            signedInFromDesktop(present);
          }}
          onOther={() => setOtherAccount(true)}
        />
      );
    return (
      <WithSpaceImage address={desktopRoute.address}>
        <DesktopJoinScreen
          key={`${desktopRoute.address}:${desktopRoute.code}`}
          route={desktopRoute}
          open={open}
          onSignedIn={signedInFromDesktop}
          onBack={() => {
            setEntryStart("choice");
            setEntry(true);
          }}
          onSignIn={() => {
            const address = desktopRoute.address;
            setDesktopRoute({ kind: "signin", address });
          }}
          deviceClass={bridge ? "desktop" : "web"}
          onUnreachable={(found) => landed(desktopRoute, found)}
        />
      </WithSpaceImage>
    );
  }
  const activeAddress = desktopRoute?.address ?? connectedAddress ?? baseUrl;
  if (!activeAddress) return firstScreen;
  return (
    <WithSpaceImage address={unproven === activeAddress ? null : activeAddress}>
      <SignInScreen
        baseUrl={activeAddress}
        unproven={unproven === activeAddress}
        open={open}
        onSignedIn={signedIn}
        notice={notice}
        username={
          unproven === activeAddress ? undefined : (signInAs ?? rows.find((r) => r.address === activeAddress)?.username)
        }
        onUnreachable={(found) => landed({ kind: "signin", address: activeAddress }, found)}
        onBack={() => {
          setUnproven(null);
          if (returnSession) {
            const back = returnSession;
            setReturnSession(null);
            void enterSaved(back);
          } else if (yourSpaces().length > 0) {
            setSignInAs(undefined);
            giDo({ e: "list" });
          } else {
            setEntryStart("choice");
            setEntry(true);
          }
        }}
      />
    </WithSpaceImage>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: "var(--win)" as string } });
