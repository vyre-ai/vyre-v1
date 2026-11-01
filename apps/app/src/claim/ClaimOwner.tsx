// /claim/<token> (ruling 71, spec 3.13): the first screen on a fresh install. The person picks a username and password, keeps a recovery code, and becomes the Space's owner; the app
// signs them in, hands the key to their own computer's daemon and opens Home. A link that was already used (or has expired) shows one plain line and no form.
// Presentational over ./claim.ts; it uses the join kit so it reads like the rest of Join (Setup Assistant style).
import { useReducer, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { Bar, Button, CheckBox, CodeShown, ErrorLine, Field, Foot, Group, JoinFrame, Meter, Panel, Step, Title, Working } from "../join/kit.tsx";
import { FAILURE_LINE, PASSWORD_MIN, cleanUsername, isDeadLink, meter, problemOf, strength, usernameOk } from "./logic.ts";
import type { ClaimFailure, Details, Problem } from "./logic.ts";

export interface ClaimOwnerProps {
  /** The Space's name when the server told us (the preflight), else its address. */
  /** The Space's name, or null when the server has not given one yet (the screen then says "your Space"; it never shows a host or an address). */
  space: string | null;
  /** The Space's key fingerprint from the link, to compare with the one the server printed. */
  fingerprint?: string | null;
  /** A fresh recovery code (16 characters in four groups). */
  newCode(): string;
  /** Makes the key bundle, claims the Space and signs in. Rejects with a ClaimError. Resolves when Home may open. */
  onClaim(input: { name: string; username: string; password: string; recoveryCode: string }): Promise<void>;
  /** Where the screen opens: the details, or the recovery code (screenshots and tests). */
  stage?: "details" | "recovery";
  /** The link is already known to be spent or expired (the preflight said so). */
  dead?: ClaimFailure | null;
  onCopyCode?(code: string): void;
  onSaveCode?(code: string): void;
  /** The name and username from a Personal Space claimed a moment ago, offered again here; the password is always typed again. */
  prefill?: { name: string; username: string } | null;
  /** Sign in instead (the link was used by the owner already). */
  onSignIn?(): void;
  /** Leave before anything is claimed: back to the first screen. */
  onBack?(): void;
}

type Stage = "details" | "recovery" | "run" | "dead";
interface State extends Details { stage: Stage; code: string; saved: boolean; error: string; dead: ClaimFailure | null; dir: 1 | -1 }
type Action =
  | { t: "set"; patch: Partial<Details> }
  | { t: "to"; stage: Stage; dir: 1 | -1 }
  | { t: "saved"; on: boolean }
  | { t: "fail"; failure: ClaimFailure; line: string };

const first = (code: string, dead: ClaimFailure | null): State => ({ name: "", username: "", password: "", confirm: "", stage: dead ? "dead" : "details", code, saved: false, error: "", dead, dir: 1 });

function reduce(s: State, a: Action): State {
  switch (a.t) {
    case "set": return { ...s, ...a.patch, error: "" };
    case "to": return { ...s, stage: a.stage, dir: a.dir, error: "" };
    case "saved": return { ...s, saved: a.on };
    case "fail": return isDeadLink(a.failure) ? { ...s, stage: "dead", dead: a.failure, error: "" } : { ...s, stage: "details", dir: -1, error: a.line };
  }
}

const LINES: Record<Problem, string> = { name: "", username: "Use 3 to 24 letters or digits, starting with a letter.", password: "Use at least 8 characters.", mismatch: "The passwords do not match." };

function Dead({ failure }: { failure: ClaimFailure }): ReactElement {
  return <Step id="dead"><Title title={FAILURE_LINE[failure]} sub={failure === "expired" ? "Ask whoever set up this Space for a new link" : failure === "invalid" ? "Open the link exactly as the server printed it" : undefined} /></Step>;
}

function DetailsStep({ s, space, fingerprint, dispatch, next }: { s: State; space: string | null; fingerprint?: string | null; dispatch: (a: Action) => void; next: () => void }): ReactElement {
  const set = (patch: Partial<Details>): void => dispatch({ t: "set", patch });
  // An error shows once there is something to be wrong about: a field the person has not touched is not red.
  const userBad = !!s.username && !usernameOk(s.username);
  const passShort = !!s.password && s.password.length < PASSWORD_MIN;
  const mism = !!s.confirm && s.confirm !== s.password;
  const line = userBad ? LINES.username : passShort ? LINES.password : mism ? LINES.mismatch : s.error;
  return (
    <Step id="claim-details" dir={s.dir}>
      <Title title={space ? `Set up ${space}` : "Create your account"} />
      <Group>
        <Field testID="claim-name" label="Name" value={s.name} onChange={(v) => set({ name: v })} placeholder="Your name" onSubmit={next} autoComplete="name" autoFocus valid={!!s.name.trim()} />
        <Field testID="claim-username" label="Username" value={s.username} onChange={(v) => set({ username: cleanUsername(v) })} placeholder="name" onSubmit={next} autoComplete="username" valid={usernameOk(s.username)} error={userBad} />
        <Field testID="claim-password" label="Password" value={s.password} onChange={(v) => set({ password: v })} placeholder="At least 8 characters" secure autoComplete="new-password" onSubmit={next} visibilityTestID="claim-password-toggle" error={passShort} />
        <Meter level={meter(strength(s.password))} />
        <Field testID="claim-confirm" label="Confirm" value={s.confirm} onChange={(v) => set({ confirm: v })} placeholder="Type it again" secure autoComplete="new-password" onSubmit={next} valid={!!s.confirm && !mism} error={mism} />
      </Group>
      <ErrorLine testID={userBad ? "claim-username-error" : mism ? "claim-mismatch" : "claim-error"}>{line}</ErrorLine>
      {fingerprint ? <Foot testID="claim-fingerprint" top={4}>{`Fingerprint ${fingerprint}`}</Foot> : null}
    </Step>
  );
}

function RecoveryStep({ s, dispatch, onCopyCode, onSaveCode }: { s: State; dispatch: (a: Action) => void } & Pick<ClaimOwnerProps, "onCopyCode" | "onSaveCode">): ReactElement {
  return (
    <Step id="claim-recovery" dir={s.dir}>
      <Title title="Your recovery code" />
      <CodeShown code={s.code} testID="claim-code" />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <View style={{ flex: 1 }}><Button quiet testID="claim-copy" label="Copy" onPress={() => onCopyCode?.(s.code)} /></View>
        <View style={{ flex: 1 }}><Button quiet testID="claim-save" label="Save" onPress={() => onSaveCode?.(s.code)} /></View>
      </View>
      <CheckBox testID="claim-saved" checked={s.saved} label="I saved it" onChange={(v) => dispatch({ t: "saved", on: v })} />
    </Step>
  );
}

export function ClaimOwner(props: ClaimOwnerProps): ReactElement {
  const [s, dispatch] = useReducer(reduce, undefined, () => ({ ...first(props.newCode(), props.dead ?? null), ...(props.prefill ? { name: props.prefill.name, username: props.prefill.username } : {}), ...(props.stage === "recovery" ? { stage: "recovery" as const, name: "Dana Wills", username: "dana", password: "correct horse", confirm: "correct horse" } : {}) }));
  const [busy, setBusy] = useState(false);
  const problem = problemOf(s);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    dispatch({ t: "to", stage: "run", dir: 1 });
    try {
      await props.onClaim({ name: s.name, username: s.username, password: s.password, recoveryCode: s.code });
    } catch (e) {
      const failure = (e as { failure?: ClaimFailure }).failure ?? "other";
      const said = (e as Error).message;
      dispatch({ t: "fail", failure, line: (failure === "other" || failure === "weak") && said ? said : FAILURE_LINE[failure] });
    } finally {
      setBusy(false);
    }
  };

  if (s.stage === "dead") return <JoinFrame><Panel {...(props.space ? { space: props.space } : {})} bar={props.onSignIn ? <Bar cont={<Button testID="claim-sign-in" label="Sign in" onPress={props.onSignIn} />} /> : undefined}><Dead failure={s.dead ?? "used"} /></Panel></JoinFrame>;
  if (s.stage === "run") {
    return (
      <JoinFrame>
        <Panel wait>
          <Step id="claim-run">
            <Working testID="claim-run-working" lineTestID="claim-working" title={props.space ? `Setting up ${props.space}` : "Creating your Space"} line="Creating your account" />
          </Step>
        </Panel>
      </JoinFrame>
    );
  }
  const onDetails = s.stage === "details";
  const cont = onDetails
    ? <Button testID="claim-next" label="Continue" disabled={problem !== null} onPress={() => dispatch({ t: "to", stage: "recovery", dir: 1 })} />
    : <Button testID="claim-create" label="Create my Space" disabled={!s.saved || busy} onPress={() => void submit()} />;
  const bar = <Bar hideBack={onDetails && !props.onBack} onBack={onDetails ? props.onBack : () => dispatch({ t: "to", stage: "details", dir: -1 })} step={onDetails ? 0 : 1} steps={2} cont={cont} />;
  return (
    <JoinFrame>
      <Panel bar={bar}>
        {onDetails
          ? <DetailsStep s={s} space={props.space} fingerprint={props.fingerprint ?? null} dispatch={dispatch} next={() => { if (problem === null) dispatch({ t: "to", stage: "recovery", dir: 1 }); }} />
          : <RecoveryStep s={s} dispatch={dispatch} {...(props.onCopyCode ? { onCopyCode: props.onCopyCode } : {})} {...(props.onSaveCode ? { onSaveCode: props.onSaveCode } : {})} />}
      </Panel>
    </JoinFrame>
  );
}
