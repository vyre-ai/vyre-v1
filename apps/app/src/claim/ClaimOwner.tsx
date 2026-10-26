// /claim/<token> (ruling 71, spec 3.13): the first screen on a fresh install. The person picks a username and password, keeps a recovery code, and becomes the Space's owner; the app
// signs them in, hands the key to their own computer's daemon and opens Home. A link that was already used (or has expired) shows one plain line and no form.
// Presentational over ./claim.ts; it uses the join kit so it reads like the rest of Join (Setup Assistant style).
import { useReducer, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { AppIcon, Bar, Button, CheckBox, ErrorLine, FieldRow, Foot, Group, JoinFrame, Meter, Panel, Row, Step, TextButton, Title, baseText, useJoin } from "../join/kit.tsx";
import { MONO } from "../join/palette.ts";
import { FAILURE_LINE, cleanUsername, isDeadLink, meter, problemOf, strength } from "./logic.ts";
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
  /** Sign in instead (the link was used by the owner already). */
  onSignIn?(): void;
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

function Dead({ failure, onSignIn }: { failure: ClaimFailure; onSignIn?: () => void }): ReactElement {
  return (
    <Step id="dead">
      <AppIcon kind="clock" />
      <Title title={FAILURE_LINE[failure]} sub={failure === "expired" ? "Ask whoever set up this Space for a new link." : failure === "invalid" ? "Open the link exactly as the server printed it." : "If this was you, sign in. Otherwise ask whoever set up this Space."} />
      {onSignIn ? <View style={{ alignItems: "center", marginTop: 24 }}><Button large testID="claim-sign-in" label="Sign in" onPress={onSignIn} /></View> : null}
    </Step>
  );
}

function DetailsStep({ s, space, fingerprint, dispatch, next }: { s: State; space: string | null; fingerprint?: string | null; dispatch: (a: Action) => void; next: () => void }): ReactElement {
  const set = (patch: Partial<Details>): void => dispatch({ t: "set", patch });
  const problem = problemOf(s);
  const showUser = !!s.username && problem === "username";
  const mism = !!s.confirm && s.confirm !== s.password;
  return (
    <Step id="claim-details" dir={s.dir}>
      <AppIcon kind="space" letter={space ?? "V"} />
      <Title title={`Set up ${space ?? "your Space"}`} sub="You are the owner. Choose how you sign in." />
      <Group>
        <FieldRow testID="claim-name" label="Name" value={s.name} onChange={(v) => set({ name: v })} placeholder="Required" onSubmit={next} autoComplete="name" />
        <FieldRow testID="claim-username" label="Username" value={s.username} onChange={(v) => set({ username: cleanUsername(v) })} placeholder="name" onSubmit={next} autoComplete="username" />
        <FieldRow testID="claim-password" label="Password" value={s.password} onChange={(v) => set({ password: v })} placeholder="Required" secure autoComplete="new-password" onSubmit={next} />
        <FieldRow testID="claim-confirm" label="Confirm" value={s.confirm} onChange={(v) => set({ confirm: v })} placeholder="Required" secure autoComplete="new-password" onSubmit={next} />
      </Group>
      {showUser ? <ErrorLine testID="claim-username-error">{LINES.username}</ErrorLine> : mism ? <ErrorLine testID="claim-mismatch">{LINES.mismatch}</ErrorLine> : s.error ? <ErrorLine testID="claim-error">{s.error}</ErrorLine> : null}
      <Meter level={meter(strength(s.password))} />
      {fingerprint ? <Foot testID="claim-fingerprint">{`Space fingerprint ${fingerprint}. It should match what the server printed.`}</Foot> : null}
      <Foot>Vyre never sees your password. If you forget it, your recovery code gets you back in; without both, your private items are lost.</Foot>
    </Step>
  );
}

function RecoveryStep({ s, dispatch, onCopyCode, onSaveCode }: { s: State; dispatch: (a: Action) => void } & Pick<ClaimOwnerProps, "onCopyCode" | "onSaveCode">): ReactElement {
  const { p } = useJoin();
  return (
    <Step id="claim-recovery" dir={s.dir}>
      <AppIcon kind="key" />
      <Title title="Keep your recovery code" sub="It is the only way back in if you forget your password." />
      <Text selectable testID="claim-code" style={[baseText(p), { marginTop: 18, textAlign: "center", fontFamily: MONO, fontSize: 20, lineHeight: 28, fontWeight: "500", letterSpacing: 1.2 }]}>{s.code}</Text>
      <View style={{ marginTop: 18, backgroundColor: p.grp, borderRadius: 10 }}>
        <Row><View style={{ flex: 1, alignItems: "center" }}><TextButton testID="claim-copy" label="Copy" onPress={() => onCopyCode?.(s.code)} /></View></Row>
        <Row divider><View style={{ flex: 1, alignItems: "center" }}><TextButton testID="claim-save" label="Save…" onPress={() => onSaveCode?.(s.code)} /></View></Row>
      </View>
      <CheckBox testID="claim-saved" checked={s.saved} label="I saved it" onChange={(v) => dispatch({ t: "saved", on: v })} />
    </Step>
  );
}

export function ClaimOwner(props: ClaimOwnerProps): ReactElement {
  const [s, dispatch] = useReducer(reduce, undefined, () => ({ ...first(props.newCode(), props.dead ?? null), ...(props.stage === "recovery" ? { stage: "recovery" as const, name: "Irfad Imtiaz", username: "irfad", password: "correct horse", confirm: "correct horse" } : {}) }));
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

  if (s.stage === "dead") return <JoinFrame><Panel center><Dead failure={s.dead ?? "used"} {...(props.onSignIn ? { onSignIn: props.onSignIn } : {})} /></Panel></JoinFrame>;
  if (s.stage === "run") {
    return (
      <JoinFrame>
        <Panel center>
          <Step id="claim-run">
            <AppIcon kind="space" letter={props.space ?? "V"} />
            <Title title={`Setting up ${props.space ?? "your Space"}`} />
            <Text accessibilityLiveRegion="polite" testID="claim-working" style={{ textAlign: "center", marginTop: 14, color: "var(--ink-2)" as string }}>Creating your account…</Text>
          </Step>
        </Panel>
      </JoinFrame>
    );
  }
  const onDetails = s.stage === "details";
  const cont = onDetails
    ? <Button testID="claim-next" label="Continue" disabled={problem !== null} onPress={() => dispatch({ t: "to", stage: "recovery", dir: 1 })} />
    : <Button testID="claim-create" label="Create my Space" disabled={!s.saved || busy} onPress={() => void submit()} />;
  const bar = <Bar hideBack={onDetails} onBack={() => dispatch({ t: "to", stage: "details", dir: -1 })} step={onDetails ? 0 : 1} steps={2} cont={cont} />;
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
