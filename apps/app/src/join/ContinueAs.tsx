// "Continue as <username>" (rc.14): owning or joining a Space with the account this device already has. It asks only for the current password; "Use a different account" is the quiet way to
// today's form. The claim (claim/ClaimOwner.tsx) and the join (shell/session/SessionGate.tsx) both use it, so the two read the same.
import { useState } from "react";
import type { ReactElement } from "react";
import { Bar, Button, ErrorLine, Field, Foot, Group, JoinFrame, Links, Panel, Step, TextButton, Title, Working } from "./kit.tsx";

export interface ContinueAsProps {
  /** testID prefix: claim-as or join-as. */
  prefix: string;
  /** The Space being set up or joined, or null when the link does not name it. */
  space: string | null;
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
}

const lineOf = (e: unknown): string => (e as { line?: string } | null)?.line ?? ((e instanceof Error && e.message) || "Couldn't finish. Try again.");

export function ContinueAs({ prefix, space, username, sub, working, onContinue, onOther, initialError, onBack }: ContinueAsProps): ReactElement {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const go = async (): Promise<void> => {
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try { await onContinue(password); } catch (e) { setError(lineOf(e)); setPassword(""); } finally { setBusy(false); }
  };
  if (busy) {
    return <JoinFrame><Panel wait><Step id={`${prefix}-run`}><Working testID={`${prefix}-working`} title={working} line={`Signing in as ${username}`} /></Step></Panel></JoinFrame>;
  }
  return (
    <JoinFrame>
      <Panel
        {...(space ? { space } : {})}
        bar={<Bar {...(onBack ? { onBack } : {})} cont={<Button testID={prefix} label="Continue" disabled={!password} onPress={() => void go()} />} />}
        below={<Links><TextButton testID={`${prefix}-other`} label="Use a different account" onPress={onOther} /></Links>}
      >
        <Step id={prefix}>
          <Title title={`Continue as ${username}`} sub={sub} />
          <Group>
            <Field testID={`${prefix}-password`} label="Password" value={password} onChange={(v) => { setPassword(v); setError(""); }} placeholder="Your Vyre password" secure autoComplete="current-password" autoFocus onSubmit={() => void go()} visibilityTestID={`${prefix}-password-toggle`} />
          </Group>
          <ErrorLine testID={`${prefix}-error`}>{error}</ErrorLine>
          <Foot testID={`${prefix}-note`} top={4}>Your password and recovery code stay the same.</Foot>
        </Step>
      </Panel>
    </JoinFrame>
  );
}
