// Administrator-issued reset codes stay in this component, never URLs or storage.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Bar, Button, CheckBox, CodeShown, ErrorLine, FieldRow, Group, JoinFrame, Panel, QuietLine, Step, Title } from "./kit.tsx";
import { makeRecoveryCode } from "./JoinFlow.tsx";
import { ResetAppliedError } from "./reset.ts";

interface Props { space: string; address: string; onBack(): void; onReset(input: { code: string; password: string; recoveryCode: string }): Promise<void> }

export function ResetAccount(props: Props): ReactElement { return <JoinFrame><ResetBody {...props} /></JoinFrame>; }

function ResetBody({ onBack, onReset }: Props): ReactElement {
  const [code, setCode] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState(""), [ack, setAck] = useState(false), [saved, setSaved] = useState(false), [stage, setStage] = useState<"details" | "recovery">("details"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [applied, setApplied] = useState(false);
  const recovery = useRef(makeRecoveryCode()), flight = useRef(false);
  const valid = /^rst_[A-Za-z0-9_-]{16,128}$/.test(code.trim()) && password.length >= 8 && password === confirm && ack;
  const submit = async (): Promise<void> => {
    if (flight.current || !valid || !saved) return;
    flight.current = true; setBusy(true); setError("");
    try { await onReset({ code: code.trim(), password, recoveryCode: recovery.current }); setCode(""); setPassword(""); setConfirm(""); }
    catch (failure) {
      if (failure instanceof ResetAppliedError) { setApplied(true); setCode(""); setPassword(""); setConfirm(""); setError(""); }
      else { setStage("details"); setError("Check the code, or ask your administrator for a new one."); }
    } finally { flight.current = false; setBusy(false); }
  };
  const back = (): void => { if (busy) return; if (stage === "recovery") { setStage("details"); setSaved(false); setError(""); } else onBack(); };
  if (applied) return <Panel bar={<Bar cont={<Button testID="reset-signin" label="Sign in" onPress={onBack} />} />}><Step id="reset-done"><Title title="Password updated" /></Step></Panel>;
  return (
    <Panel bar={<Bar onBack={back} cont={<Button testID="reset-next" label={busy ? "Resetting" : stage === "details" ? "Continue" : "Reset password"} busy={busy} disabled={!valid || (stage === "recovery" && !saved)} onPress={() => { if (stage === "details") { if (valid) setStage("recovery"); } else void submit(); }} />} />}>
      {stage === "details" ? (
        <Step id="reset-account">
          <Title title="Reset code" />
          <Group>
            <FieldRow testID="reset-code" label="Reset code" value={code} disabled={busy} onChange={(v) => { setCode(v); setError(""); }} placeholder="rst_" autoComplete="off" error={!!error} />
            <FieldRow testID="reset-password" label="New password" value={password} disabled={busy} onChange={setPassword} placeholder="At least 8 characters" secure autoComplete="new-password" />
            <FieldRow testID="reset-confirm" label="Confirm" value={confirm} disabled={busy} onChange={setConfirm} secure autoComplete="new-password" error={!!confirm && confirm !== password} />
          </Group>
          <CheckBox testID="reset-ack" checked={ack} label="Private items may stay locked" onChange={setAck} />
          <ErrorLine testID="reset-error">{error}</ErrorLine>
        </Step>
      ) : (
        <Step id="reset-recovery-code">
          <Title title="Your recovery code" />
          <CodeShown code={recovery.current} testID="reset-recovery" />
          <CheckBox testID="reset-saved" checked={saved} label="I saved it" onChange={setSaved} />
          <QuietLine>{""}</QuietLine>
        </Step>
      )}
    </Panel>
  );
}
