// Recovery codes and new passwords live only in this form; the old person key is preserved by the client crypto flow.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Bar, Button, ErrorLine, FieldRow, Group, JoinFrame, Links, Panel, Step, TextButton, Title } from "./kit.tsx";
import { RecoveryAppliedError, recoveryFailureLine } from "./recover.ts";

interface Props { space: string; address: string; username?: string | undefined; onBack(): void; onAdminReset(): void; onRecover(input: { username: string; code: string; password: string }): Promise<void> }

export function RecoveryAccount(props: Props): ReactElement { return <JoinFrame><RecoveryBody {...props} /></JoinFrame>; }

function RecoveryBody({ username: known, onBack, onAdminReset, onRecover }: Props): ReactElement {
  const [username, setUsername] = useState(known ?? ""), [code, setCode] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [applied, setApplied] = useState(false);
  const flight = useRef(false);
  const mism = !!confirm && password !== confirm;
  const valid = /^[a-z0-9_.-]{2,32}$/.test(username.trim().toLowerCase()) && code.trim().length >= 8 && password.length >= 8 && password === confirm;
  const submit = async (): Promise<void> => {
    if (!valid || flight.current) return;
    flight.current = true; setBusy(true); setError("");
    try { await onRecover({ username, code, password }); setCode(""); setPassword(""); setConfirm(""); }
    catch (failure) {
      if (failure instanceof RecoveryAppliedError) { setApplied(true); setCode(""); setPassword(""); setConfirm(""); setError(""); }
      else setError(recoveryFailureLine(failure));
    } finally { flight.current = false; setBusy(false); }
  };
  if (applied) return <Panel bar={<Bar cont={<Button label="Sign in" testID="recovery-submit" onPress={onBack} />} />}><Step id="recover-done"><Title title="Password updated" /></Step></Panel>;
  return (
    <Panel
      below={<Links><TextButton label="I have a reset code" testID="recovery-admin-reset" disabled={busy} onPress={onAdminReset} /></Links>}
      bar={<Bar onBack={() => { if (!busy) onBack(); }} cont={<Button label={busy ? "Recovering" : "Set password"} testID="recovery-submit" busy={busy} disabled={!valid} onPress={() => void submit()} />} />}
    >
      <Step id="recover-account">
        <Title title="Forgot password" />
        <Group>
          <FieldRow label="Username" testID="recovery-username" value={username} onChange={setUsername} disabled={busy} autoComplete="username" />
          <FieldRow label="Recovery code" testID="recovery-code" value={code} onChange={(v) => { setCode(v); setError(""); }} disabled={busy} secure autoComplete="off" error={!!error} />
          <FieldRow label="New password" testID="recovery-password" value={password} onChange={setPassword} disabled={busy} secure autoComplete="new-password" placeholder="At least 8 characters" />
          <FieldRow label="Confirm" testID="recovery-confirm" value={confirm} onChange={setConfirm} disabled={busy} secure autoComplete="new-password" error={mism} />
        </Group>
        <ErrorLine testID="recovery-error">{error || (mism ? "The passwords do not match." : "")}</ErrorLine>
      </Step>
    </Panel>
  );
}
