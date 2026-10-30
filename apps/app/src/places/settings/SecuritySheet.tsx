import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TextField } from "../../../../../ui/src/TextField/index.tsx";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { changeOwnPassword } from "./security.ts";

type Action = "password" | "totp-on" | "totp-off" | "passkey" | "github-on" | "github-off";
export function SecuritySheet({ action, call, onClose }: { action: Action; call: (cap: string, input: unknown) => Promise<unknown>; onClose: () => void }): ReactElement {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [enrolment, setEnrolment] = useState<{ enrolmentId: string; setupUri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);
  const title = action === "password" ? "Change your password" : action === "totp-on" ? "Set up authenticator" : action === "totp-off" ? "Remove authenticator" : action.startsWith("github") ? "GitHub sign-in" : "Passkeys";
  const allowed = action === "password" || action.startsWith("totp") || action === "github-off";
  const submit = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (action === "password") await changeOwnPassword(call, current, password);
      else if (action === "totp-on" && !enrolment) { setEnrolment(await call("identity.totp_begin", {}) as { enrolmentId: string; setupUri: string }); return; }
      else if (action === "totp-on") await call("identity.totp_confirm", { enrolmentId: enrolment!.enrolmentId, code });
      else if (action === "totp-off") await call("identity.totp_remove", { password: current });
      else if (action === "github-off") await call("identity.github_unlink", {});
      setCurrent(""); setPassword(""); setConfirm(""); setCode(""); setEnrolment(null); setDone(true);
    } catch { setError(action === "password" ? "Couldn’t change your password. Check the current password and try again. Your existing keys stay unchanged." : "Couldn’t complete this change. Check your password or authenticator code. The Space may require a second factor."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const valid = action === "password" ? !!current && password.length >= 8 && password === confirm : action === "totp-off" ? !!current : action === "totp-on" && enrolment ? /^\d{6}$/.test(code) : true;
  const input = (id: string, label: string, value: string, set: (text: string) => void, secret = true): ReactElement => <View style={s.row}><Text style={s.label}>{label}</Text><TextField testID={id} accessibilityLabel={label} value={value} onChangeText={set} secureTextEntry={secret} autoCapitalize="none" autoCorrect={false} /></View>;
  const para = (t: string): ReactElement => <Text style={s.para}>{t}</Text>;
  const body = done ? <Text accessibilityRole="status" testID="security-saved" style={s.para}>Saved</Text> : <>
    {error ? <Text accessibilityRole="alert" style={s.error} testID="security-error">{error}</Text> : null}
    {action === "password" ? <>{input("security-current-password", "Current password", current, setCurrent)}{input("security-new-password", "New password", password, setPassword)}{input("security-confirm-password", "Confirm password", confirm, setConfirm)}</> : null}
    {action === "totp-off" ? input("security-current-password", "Current password", current, setCurrent) : null}
    {action === "totp-on" ? enrolment ? <>{para("Add this setup URI to your authenticator, then enter its six-digit code.")}<Text selectable testID="security-setup-uri" style={s.uri}>{enrolment.setupUri}</Text>{input("security-totp-code", "Authenticator code", code, (text) => setCode(text.replace(/\D/g, "").slice(0, 6)), false)}</> : para("Create a setup code, add it to your authenticator, then confirm a code before Vyre enables the factor.") : null}
    {!allowed ? para(action === "passkey" ? "Passkey sign-in is planned for a later version. Use your password and an authenticator app." : "GitHub linking needs the Space’s configured GitHub authorization flow. Continue with your password while that flow is unavailable.") : null}
    {action === "github-off" ? para("Disconnect GitHub from this account? Your password still works.") : null}
  </>;
  return (
    <Dialog
      title={title} testID="security-sheet" onClose={onClose} width={480}
      actions={[{ label: done ? "Done" : "Cancel", testID: "security-close", onPress: onClose }, ...(!done && allowed ? [{ label: busy ? "Saving…" : action === "totp-on" && !enrolment ? "Create setup code" : "Save", primary: true, disabled: busy || !valid, testID: "security-save", onPress: () => void submit() }] : [])]}
    >
      {body}
    </Dialog>
  );
}
const s = StyleSheet.create({
  row: { gap: 6 },
  label: { color: "var(--ink-2)" as string, fontSize: 12.5, fontWeight: "500" },
  para: { color: "var(--ink-2)" as string, fontSize: 13.5, lineHeight: 20 },
  uri: { color: "var(--ink)" as string, fontSize: 12, lineHeight: 18, padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  error: { color: "var(--danger)" as string, fontSize: 13 },
});
