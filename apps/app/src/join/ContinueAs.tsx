// "Continue as <username>" (rc.14): owning or joining a Space with the account this device already has. It asks only for the current password; "Use a different account" is the quiet way to
// today's form. The claim (claim/ClaimOwner.tsx) and the join (shell/session/SessionGate.tsx) both use it, so the two read the same.
// rc.17: a person this device knows from a Google, Microsoft or GitHub sign-in (`either`) gets one field, "Password or recovery code": the password they set when they joined, or their recovery
// code, after which they choose a password once. "I already have a Vyre account" is for a device that has no session at all (HaveAccount.tsx).
import { useState } from "react";
import type { ReactElement } from "react";
import { Bar, Button, ErrorLine, Field, Foot, Group, JoinFrame, Links, Panel, Step, TextButton, Title, Working } from "./kit.tsx";
import { cleanCode, isRecoveryCode } from "./identity.ts";
import { PASSWORD_MIN } from "./logic.ts";

export interface ContinueAsProps {
  /** testID prefix: claim-as or join-as. */
  prefix: string;
  /** The Space being set up or joined, or null when the link does not name it. */
  space: string | null;
  /** who to greet: the username, or the name when this device knows the person from a provider sign-in */
  username: string;
  /** The line under the title: what the password is for. */
  sub: string;
  /** The title while it works, e.g. "Setting up MLA". */
  working: string;
  /** Rejects with an error whose `line` (or message) is shown; the password field is cleared. */
  onContinue(password: string): Promise<void>;
  onOther(): void;
  /** A screen in a test or a screenshot starts with this line shown. */
  initialError?: string;
  /** Leave without setting anything up. */
  onBack?(): void;
  /**
   * rc.17, a person known from a provider sign-in: the field takes the password or the recovery code. A code is checked first (`onCheckCode`), then a password is chosen once and
   * `onRecovery` runs with both.
   */
  either?: { onCheckCode(code: string): Promise<void>; onRecovery(code: string, newPassword: string): Promise<void> };
  /** screenshots: open on choosing the password after a recovery code */
  initialStage?: "secret" | "newpass";
}

const lineOf = (e: unknown): string => (e as { line?: string } | null)?.line ?? ((e instanceof Error && e.message) || "Couldn't finish. Try again.");

export function ContinueAs({ prefix, space, username, sub, working, onContinue, onOther, initialError, onBack, either, initialStage }: ContinueAsProps): ReactElement {
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<"secret" | "newpass">(initialStage ?? "secret");
  const [code, setCode] = useState(initialStage === "newpass" ? "K7QM-4TXD-9WPA-H3NE" : "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(initialError ?? "");
  const run = async (title: string, work: () => Promise<void>, clear: () => void): Promise<void> => {
    if (busy) return;
    setBusy(title); setError("");
    try { await work(); } catch (e) { setError(lineOf(e)); clear(); } finally { setBusy(null); }
  };
  const go = (): void => {
    if (stage === "newpass" && either) { if (pw.length >= PASSWORD_MIN && pw === pw2) void run(working, () => either.onRecovery(code, pw), () => undefined); return; }
    if (!password) return;
    if (either && isRecoveryCode(password)) {
      const typed = cleanCode(password);
      void run("Checking your recovery code", async () => { await either.onCheckCode(typed); setCode(typed); setPassword(""); setStage("newpass"); }, () => setPassword(""));
      return;
    }
    void run(working, () => onContinue(password), () => setPassword(""));
  };
  if (busy) {
    return <JoinFrame><Panel wait><Step id={`${prefix}-run`}><Working testID={`${prefix}-working`} title={busy} line={`Signing in as ${username}`} /></Step></Panel></JoinFrame>;
  }
  if (stage === "newpass" && either) {
    const short = !!pw && pw.length < PASSWORD_MIN, mism = !!pw2 && pw2 !== pw;
    return (
      <JoinFrame>
        <Panel {...(space ? { space } : {})} bar={<Bar onBack={() => { setStage("secret"); setPw(""); setPw2(""); setError(""); }} cont={<Button testID={`${prefix}-newpass-next`} label="Continue" disabled={pw.length < PASSWORD_MIN || pw !== pw2} onPress={go} />} />}>
          <Step id={`${prefix}-newpass`}>
            <Title title="Choose your Vyre password" sub={space ? `You sign in to ${space} with it. Your recovery code stays the same.` : "Your recovery code stays the same."} />
            <Group>
              <Field testID={`${prefix}-new-password`} label="Password" value={pw} onChange={setPw} placeholder="At least 8 characters" secure autoComplete="new-password" autoFocus visibilityTestID={`${prefix}-new-toggle`} onSubmit={go} />
              <Field testID={`${prefix}-confirm`} label="Confirm" value={pw2} onChange={setPw2} secure autoComplete="new-password" error={mism} onSubmit={go} />
            </Group>
            <ErrorLine testID={`${prefix}-error`}>{short ? "Use at least 8 characters." : mism ? "The passwords do not match." : error}</ErrorLine>
          </Step>
        </Panel>
      </JoinFrame>
    );
  }
  return (
    <JoinFrame>
      <Panel
        {...(space ? { space } : {})}
        bar={<Bar {...(onBack ? { onBack } : {})} cont={<Button testID={prefix} label="Continue" disabled={!password} onPress={go} />} />}
        below={<Links><TextButton testID={`${prefix}-other`} label="Use a different account" onPress={onOther} /></Links>}
      >
        <Step id={prefix}>
          <Title title={`Continue as ${username}`} sub={sub} />
          <Group>
            <Field testID={`${prefix}-password`} label={either ? "Password or recovery code" : "Password"} value={password} onChange={(v) => { setPassword(v); setError(""); }} placeholder={either ? "Your password, or XXXX-XXXX-XXXX-XXXX" : "Your Vyre password"} secure autoComplete="current-password" autoFocus onSubmit={go} visibilityTestID={`${prefix}-password-toggle`} />
          </Group>
          <ErrorLine testID={`${prefix}-error`}>{error}</ErrorLine>
          <Foot testID={`${prefix}-note`} top={4}>{either ? "The password you set when you joined, or your recovery code. You are asked once on this device." : "Your password and recovery code stay the same."}</Foot>
        </Step>
      </Panel>
    </JoinFrame>
  );
}
