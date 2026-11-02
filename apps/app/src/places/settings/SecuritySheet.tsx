import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TextField } from "../../../../../ui/src/TextField/index.tsx";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { SmallButton, Switch } from "./ui.tsx";
import { changeOwnPassword, makeNewRecoveryCode } from "./security.ts";
import type { OtherSpace } from "./security.ts";
import { makeRecoveryCode } from "../../join/recovery-code.ts";

type Action = "password" | "totp-on" | "totp-off" | "passkey" | "github-on" | "github-off" | "recovery";

type Browser = { navigator?: { clipboard?: { writeText(t: string): unknown } }; document?: { createElement(t: string): Record<string, unknown> & { click(): void } }; URL?: { createObjectURL(b: unknown): string }; Blob?: new (p: string[], o: { type: string }) => unknown };
const copyCode = (code: string): void => { void (globalThis as unknown as Browser).navigator?.clipboard?.writeText(code); };
function saveCode(code: string): void {
  const g = globalThis as unknown as Browser;
  if (!g.document || !g.URL || !g.Blob) return;
  const a = g.document.createElement("a");
  a.href = g.URL.createObjectURL(new g.Blob([`Vyre recovery code\n${code}\n`], { type: "text/plain" }));
  a.download = "vyre-recovery-code.txt";
  a.click();
}

/** `others`: the other Spaces this device is in, so a new recovery code replaces the old one there too. `newCode` is a seam for tests and screenshots. */
export function SecuritySheet({ action, call, onClose, others = [], spaceName = "This Space", newCode = makeRecoveryCode, initialCode }: { action: Action; call: (cap: string, input: unknown) => Promise<unknown>; onClose: () => void; others?: readonly OtherSpace[]; spaceName?: string; newCode?: () => string; /** screenshots: open on the code already made */ initialCode?: { code: string; updated: string[]; missed: string[] } }): ReactElement {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [enrolment, setEnrolment] = useState<{ enrolmentId: string; setupUri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  // the new recovery code: shown once, here, until the sheet closes
  const [made, setMade] = useState<{ code: string; updated: string[]; missed: string[] } | null>(initialCode ?? null);
  const [kept, setKept] = useState(false);
  const inFlight = useRef(false);
  const title = action === "recovery" ? "New recovery code" : action === "password" ? "Change your password" : action === "totp-on" ? "Set up authenticator" : action === "totp-off" ? "Remove authenticator" : action.startsWith("github") ? "GitHub sign-in" : "Passkeys";
  const allowed = action === "password" || action === "recovery" || action.startsWith("totp") || action === "github-off";
  const submit = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (action === "recovery") { const code = newCode(); const out = await makeNewRecoveryCode(call, current, code, others, spaceName); setCurrent(""); setMade({ code, ...out }); return; }
      if (action === "password") await changeOwnPassword(call, current, password);
      else if (action === "totp-on" && !enrolment) { setEnrolment(await call("identity.totp_begin", {}) as { enrolmentId: string; setupUri: string }); return; }
      else if (action === "totp-on") await call("identity.totp_confirm", { enrolmentId: enrolment!.enrolmentId, code });
      else if (action === "totp-off") await call("identity.totp_remove", { password: current });
      else if (action === "github-off") await call("identity.github_unlink", {});
      setCurrent(""); setPassword(""); setConfirm(""); setCode(""); setEnrolment(null); setDone(true);
    } catch { setError(action === "recovery" ? "Couldn’t make a new code. Check your password and try again. Your current code still works." : action === "password" ? "Couldn’t change your password. Check the current password and try again. Your existing keys stay unchanged." : "Couldn’t complete this change. Check your password or authenticator code. The Space may require a second factor."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const valid = action === "recovery" ? !!current : action === "password" ? !!current && password.length >= 8 && password === confirm : action === "totp-off" ? !!current : action === "totp-on" && enrolment ? /^\d{6}$/.test(code) : true;
  const input = (id: string, label: string, value: string, set: (text: string) => void, secret = true): ReactElement => <View style={s.row}><Text style={s.label}>{label}</Text><TextField testID={id} accessibilityLabel={label} value={value} onChangeText={set} secureTextEntry={secret} autoCapitalize="none" autoCorrect={false} /></View>;
  const para = (t: string): ReactElement => <Text style={s.para}>{t}</Text>;
  if (action === "recovery" && made) {
    const where = made.updated.length > 1 ? `It works in ${made.updated.join(", ")}.` : "";
    return (
      <Dialog title={title} testID="security-sheet" onClose={onClose} width={480} actions={[{ label: "Done", primary: true, disabled: !kept, testID: "security-close", onPress: onClose }]}>
        {para("Keep this code somewhere safe. It is shown only now. Your old code no longer works.")}
        <Text selectable testID="recovery-code" style={s.code}>{made.code}</Text>
        <View style={s.pair}>
          <SmallButton label="Copy" testID="recovery-copy" onPress={() => copyCode(made.code)} />
          <SmallButton label="Save" testID="recovery-save" onPress={() => saveCode(made.code)} />
        </View>
        {where ? <Text testID="recovery-where" style={s.para}>{where}</Text> : null}
        {made.missed.length ? <Text testID="recovery-missed" style={s.error}>{`Couldn’t reach ${made.missed.join(", ")}. Open ${made.missed.length === 1 ? "it" : "each one"} and make a new code there.`}</Text> : null}
        <View style={s.kept}><Text style={s.label}>I saved it</Text><Switch testID="recovery-kept" on={kept} onChange={setKept} label="I saved it" /></View>
      </Dialog>
    );
  }
  const body = done ? <Text accessibilityRole="status" testID="security-saved" style={s.para}>Saved</Text> : <>
    {error ? <Text accessibilityRole="alert" style={s.error} testID="security-error">{error}</Text> : null}
    {action === "password" ? <>{input("security-current-password", "Current password", current, setCurrent)}{input("security-new-password", "New password", password, setPassword)}{input("security-confirm-password", "Confirm password", confirm, setConfirm)}</> : null}
    {action === "totp-off" ? input("security-current-password", "Current password", current, setCurrent) : null}
    {action === "recovery" ? <>{para("Your current recovery code stops working, and a new one is shown once. Enter your password to make it.")}{input("security-current-password", "Password", current, setCurrent)}</> : null}
    {action === "totp-on" ? enrolment ? <>{para("Add this setup URI to your authenticator, then enter its six-digit code.")}<Text selectable testID="security-setup-uri" style={s.uri}>{enrolment.setupUri}</Text>{input("security-totp-code", "Authenticator code", code, (text) => setCode(text.replace(/\D/g, "").slice(0, 6)), false)}</> : para("Create a setup code, add it to your authenticator, then confirm a code before Vyre enables the factor.") : null}
    {!allowed ? para(action === "passkey" ? "Passkey sign-in is planned for a later version. Use your password and an authenticator app." : "GitHub linking needs the Space’s configured GitHub authorization flow. Continue with your password while that flow is unavailable.") : null}
    {action === "github-off" ? para("Disconnect GitHub from this account? Your password still works.") : null}
  </>;
  return (
    <Dialog
      title={title} testID="security-sheet" onClose={onClose} width={480}
      actions={[{ label: done ? "Done" : "Cancel", testID: "security-close", onPress: onClose }, ...(!done && allowed ? [{ label: busy ? "Saving…" : action === "totp-on" && !enrolment ? "Create setup code" : action === "recovery" ? "Make new code" : "Save", primary: true, disabled: busy || !valid, testID: "security-save", onPress: () => void submit() }] : [])]}
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
  code: { color: "var(--ink)" as string, fontSize: 18, letterSpacing: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", textAlign: "center", paddingVertical: 14, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  pair: { flexDirection: "row", gap: 8, justifyContent: "center" },
  kept: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
});
