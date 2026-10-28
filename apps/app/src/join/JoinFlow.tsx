// join/JoinFlow: the anonymous join place (spec 3.13, ARCH 7.13): the invite landing, the account steps, the setup run, the finish and sign-in for people
// who already have an account. It owns the stage machine, the run timers, the Escape key and the browser helpers; the pages only paint.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AcceptInvite } from "./AcceptInvite.tsx";
import { SignIn } from "./SignIn.tsx";
import { Welcome } from "./Welcome.tsx";
import { JoinFrame } from "./kit.tsx";
import { RUN_STEPS, createSpaceResolutionGate, fullName, initialState, normalizeSpaceAddress, reduce, resolveSpaceInvite, signInValid } from "./logic.ts";
import type { Action, ConnectIntent, FlowState, JoinInvite } from "./logic.ts";
import type { JoinMode } from "./palette.ts";

export interface JoinValues {
  username: string;
  displayName: string;
  password: string;
  deviceName: string;
  trustDevice: boolean;
  recoveryCode?: string;
  ai: { choice: "sub" | "key" | "admin" | "none"; key?: string; providerKey?: "openrouter" | "anthropic" | "openai" };
}
export interface JoinFlowProps {
  invite: JoinInvite;
  expired?: boolean;
  initial?: Partial<FlowState>;
  isTaken?: (username: string) => boolean;
  mode?: JoinMode;
  /** freeze the setup run where it is (screenshots) */
  hold?: boolean;
  /** members.accept: resolves when the account exists, rejects with an Error whose message is shown on the AI step */
  onJoin?: (v: JoinValues) => Promise<void>;
  /** identity.sign_in: resolves "second_factor_required" or "ok" */
  onSignIn?: (v: { username: string; password: string; code?: string }) => Promise<"ok" | "second_factor_required">;
  /** Resolves a verified Space before its credential form is shown. */
  onResolveSpace?: (address: string) => Promise<JoinInvite>;
  onOpen?: () => void;
  onOpenApp?: () => void;
  onDownload?: () => void;
  onEmail?: (to: string) => void;
  onSso?: (provider: string) => void;
  onGithub?: () => void;
  onRecoveryCode?: () => void;
  onPickPhoto?: () => void;
  onCopyCode?: (code: string) => void;
  onSaveCode?: (code: string) => void;
  newCode?: () => string;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
/** 16 characters in four groups, from the platform's random source. */
export function makeRecoveryCode(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (let i = 0; i < 16; i++) s += CODE_ALPHABET[b[i]! % CODE_ALPHABET.length];
  return [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12)].join("-");
}

type Browser = { navigator?: { clipboard?: { writeText(t: string): unknown } }; document?: { createElement(t: string): Record<string, unknown> & { click(): void } }; URL?: { createObjectURL(b: unknown): string }; Blob?: new (p: string[], o: { type: string }) => unknown };
function copyText(text: string): void {
  const g = globalThis as Browser;
  void g.navigator?.clipboard?.writeText(text);
}
function saveText(name: string, text: string): void {
  const g = globalThis as Browser;
  if (!g.document || !g.URL || !g.Blob) return;
  const a = g.document.createElement("a");
  a.href = g.URL.createObjectURL(new g.Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const messageOf = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Could not finish. Check the connection and try again.");

export function JoinFlow(props: JoinFlowProps) {
  const [invite, setInvite] = useState(props.invite);
  const spaceRequests = useRef(createSpaceResolutionGate());
  const resolvingSpace = useRef(false);
  const rules = useMemo(() => ({ isTaken: props.isTaken ?? ((): boolean => false) }), [props.isTaken]);
  const [state, dispatch] = useReducer((s: FlowState, a: Action) => reduce(s, a, rules), undefined, () => initialState(invite, props.initial));

  useEffect(() => () => spaceRequests.current.dispose(), []);

  // the setup run: four lines, one every 900 ms, then the finish once the account call has answered
  useEffect(() => {
    if (state.stage !== "run" || props.hold) return;
    let off = false;
    let failed = false;
    const total = RUN_STEPS(invite.space).length;
    const values: JoinValues = {
      username: state.user, displayName: fullName(state), password: state.pw, deviceName: state.device, trustDevice: state.trust,
      ...(state.rec ? { recoveryCode: state.code } : {}), ai: { choice: state.ai, providerKey: state.aiProvider, ...(state.ai === "key" ? { key: state.key } : {}) },
    };
    const joined = props.onJoin ? props.onJoin(values).catch((e: unknown) => { failed = true; if (!off) dispatch({ t: "failed", message: messageOf(e) }); }) : Promise.resolve();
    void (async () => {
      for (let i = 0; i < total - 1; i++) {
        await sleep(900);
        if (off || failed) return;
        dispatch({ t: "run_tick", total });
      }
      await joined;
      if (off || failed) return;
      dispatch({ t: "run_tick", total });
      await sleep(700);
      if (!off) dispatch({ t: "run_done" });
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the run starts once per entry into the stage
  }, [state.stage]);

  // Escape goes back or closes the sheet
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: { key: string; preventDefault(): void }) => void): void; removeEventListener(t: string, f: (e: { key: string; preventDefault(): void }) => void): void } }).document;
    if (!doc) return;
    const on = (e: { key: string; preventDefault(): void }): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      dispatch(state.sheet ? { t: "recovery_close" } : { t: "back" });
    };
    doc.addEventListener("keydown", on);
    return () => doc.removeEventListener("keydown", on);
  }, [state.sheet]);

  const signIn = async (): Promise<void> => {
    if (!signInValid(state)) return;
    if (!props.onSignIn) return dispatch({ t: "next" });
    try {
      const r = await props.onSignIn({ username: state.siUser, password: state.siPw, ...(state.si === "totp" ? { code: state.siCode } : {}) });
      if (r === "second_factor_required" && state.si === "pw") dispatch({ t: "next" });
      else dispatch({ t: "set", patch: { stage: "done", error: "" } });
    } catch (e) {
      dispatch({ t: "set", patch: { error: messageOf(e) } });
    }
  };

  const resolveSpace = async (intent: ConnectIntent): Promise<void> => {
    if (resolvingSpace.current || state.spaceResolving) return;
    if (!normalizeSpaceAddress(state.spaceAddress)) return dispatch({ t: "space_failed", message: "Enter a valid HTTPS Space address, or a local development address." });
    if (!props.onResolveSpace) return dispatch({ t: "space_failed", message: "This Space cannot be verified yet. Try again shortly." });
    const request = spaceRequests.current.begin();
    resolvingSpace.current = true;
    dispatch({ t: "space_resolving", intent });
    try {
      const verified = await resolveSpaceInvite(state.spaceAddress, props.onResolveSpace);
      if (!spaceRequests.current.isCurrent(request)) return;
      setInvite(verified);
      dispatch({ t: "space_resolved" });
    } catch (e) {
      if (!spaceRequests.current.isCurrent(request)) return;
      dispatch({ t: "space_failed", message: messageOf(e) });
    } finally {
      if (spaceRequests.current.isCurrent(request)) resolvingSpace.current = false;
    }
  };

  const changeSpaceAddress = (spaceAddress: string): void => {
    if (resolvingSpace.current || state.spaceResolving) {
      spaceRequests.current.invalidate();
      resolvingSpace.current = false;
    }
    dispatch({ t: "set", patch: { spaceAddress, spaceResolving: false, spaceError: "" } });
  };

  const page = state.stage === "connect"
    ? <Welcome address={state.spaceAddress} busy={state.spaceResolving} error={state.spaceError} onAddressChange={changeSpaceAddress} onSignIn={() => void resolveSpace("signin")} onGetStarted={() => void resolveSpace("onboarding")} />
    : state.stage === "signin"
    ? <SignIn invite={invite} state={state} dispatch={dispatch} onSubmit={() => void signIn()} onSso={props.onSso} onGithub={props.onGithub} onRecoveryCode={props.onRecoveryCode} />
    : (
      <AcceptInvite
        invite={invite} state={state} dispatch={dispatch} rules={rules} expired={props.expired}
        onOpenApp={props.onOpenApp} onDownload={props.onDownload} onPickPhoto={props.onPickPhoto}
        onCopyCode={props.onCopyCode ?? copyText} onSaveCode={props.onSaveCode ?? ((c) => saveText(`${invite.host}-recovery-code.txt`, `${invite.space} recovery code\n${c}\n`))}
        newCode={props.newCode ?? makeRecoveryCode} onEmail={props.onEmail} onOpen={props.onOpen}
      />
    );
  return <JoinFrame {...(props.mode ? { mode: props.mode } : {})} halftoneIntensity={state.stage === "connect" ? "full" : "calm"}>{page}</JoinFrame>;
}
