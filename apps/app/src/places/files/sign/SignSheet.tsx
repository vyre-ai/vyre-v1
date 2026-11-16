// Send for signature: ONE sheet, from a file's viewer, a file's row menu, a record, and the command palette. Who signs (a name, an email if there is one, add another), an optional message and Send.
// After Send the same sheet shows each signer's link with Copy and says, in the server's own words, whether anything was emailed: a Space with no mailbox is never a dead end.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { Switch } from "../../../../../../ui/src/Switch/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { copyText, sendForSignature } from "./actions.ts";
import type { Sent } from "./actions.ts";
import { useSignData } from "./data.tsx";
import { blankSigner, first, mailWords, problemsOf, sendInput } from "./model.ts";
import type { SentLink, SignerDraft } from "./model.ts";

const web = Platform.OS === "web";
const originOf = (): string => (globalThis as { location?: { origin?: string } }).location?.origin ?? "";

export interface SignSheetProps {
  fileId: string;
  fileName: string;
  /** The record this is sent from: the envelope is linked to it and the signed copy lands in its folder. */
  recordId?: string;
  /** People to start the list with (a record's person and email fields). Never invented. */
  suggest?: readonly { name: string; email?: string }[];
  onClose(): void;
  onSent?(envelopeId: string | null): void;
}

export function SignSheet({ fileId, fileName, recordId, suggest, onClose, onSent }: SignSheetProps): ReactElement {
  const d = useSignData();
  const [rows, setRows] = useState<SignerDraft[]>(() =>
    suggest && suggest.length > 0 ? suggest.map((p) => blankSigner(p.name, p.email ?? "")) : [blankSigner()],
  );
  const [message, setMessage] = useState("");
  const [inOrder, setInOrder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const key = useRef(`sign-${fileId}-${Date.now()}`);
  const problems = tried ? problemsOf(rows) : [];
  const change = (k: string, patch: Partial<SignerDraft>): void =>
    setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const send = (): void => {
    if (busy) return;
    setTried(true);
    if (problemsOf(rows).length > 0) return;
    setBusy(true);
    setError(null);
    void sendForSignature(
      d.call,
      sendInput(fileId, recordId, rows, message, key.current, inOrder),
      d.origin ?? originOf(),
    ).then((r) => {
      setBusy(false);
      if (r.ok) {
        setSent(r.sent);
        onSent?.(r.sent.id);
      } else setError(r.error);
    });
  };
  if (sent)
    return (
      <Dialog
        title="Sent for signature"
        onClose={onClose}
        width={520}
        fill
        testID="sign-sheet-sent"
        actions={[{ label: "Done", primary: true, onPress: onClose, testID: "sign-done" }]}
      >
        <SentLinks sent={sent} fileName={fileName} />
      </Dialog>
    );
  const sheetProblem = problems.find((p) => p.key === null)?.text;
  return (
    <Dialog
      title="Send for signature"
      onClose={onClose}
      width={520}
      fill
      testID="sign-sheet"
      actions={[
        { label: "Cancel", onPress: onClose, testID: "sign-cancel" },
        { label: busy ? "Sending…" : "Send", primary: true, disabled: busy, onPress: send, testID: "sign-send" },
      ]}
    >
      <View style={st.stack}>
        <Text numberOfLines={1} style={st.file} testID="sign-file">
          {fileName}
        </Text>
        <Text style={st.label}>Who signs</Text>
        {/* ui-rows-lint: not a list (the signer fields of the form: a name, an email and a remove control in each) */}
        {rows.map((r, i) => {
          const p = problems.find((x) => x.key === r.key)?.text;
          return (
            <View key={r.key} style={st.rowWrap}>
              <View style={st.row}>
                <View style={st.fields}>
                  <View style={st.name}>
                    <TextField
                      value={r.name}
                      onChangeText={(v) => change(r.key, { name: v })}
                      accessibilityLabel={`Signer ${i + 1} name`}
                      placeholder="Name"
                      autoComplete="name"
                      testID={`sign-name-${i}`}
                      style={st.input}
                    />
                  </View>
                  <View style={st.email}>
                    <TextField
                      value={r.email}
                      onChangeText={(v) => change(r.key, { email: v })}
                      accessibilityLabel={`Signer ${i + 1} email`}
                      placeholder="Email (optional)"
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      inputMode="email"
                      keyboardType="email-address"
                      autoComplete="email"
                      testID={`sign-email-${i}`}
                      style={st.input}
                    />
                  </View>
                </View>
                {rows.length > 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove signer ${i + 1}`}
                    testID={`sign-remove-${i}`}
                    onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    style={({ hovered }: { hovered?: boolean }) => [st.x, hovered === true && st.over]}
                  >
                    <Text style={st.xText}>×</Text>
                  </Pressable>
                ) : null}
              </View>
              {p ? (
                <Text accessibilityRole="alert" role="alert" style={st.problem} testID={`sign-problem-${i}`}>
                  {p}
                </Text>
              ) : null}
            </View>
          );
        })}
        {sheetProblem ? (
          <Text accessibilityRole="alert" role="alert" style={st.problem} testID="sign-problem">
            {sheetProblem}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add another signer"
          testID="sign-add"
          onPress={() => setRows((rs) => [...rs, blankSigner()])}
          style={({ hovered }: { hovered?: boolean }) => [st.add, hovered === true && st.over]}
        >
          <Text style={st.addText}>+ Add another</Text>
        </Pressable>
        {rows.filter((r) => r.name.trim() !== "").length > 1 ? (
          <Switch on={inOrder} onChange={setInOrder} label="One after another" labelled testID="sign-order" />
        ) : null}
        <TextField
          value={message}
          onChangeText={setMessage}
          accessibilityLabel="Message"
          placeholder="Message (optional)"
          multiline
          numberOfLines={3}
          maxLength={1000}
          testID="sign-message"
          style={[st.input, st.message]}
        />
        {error ? (
          <Text accessibilityRole="alert" role="alert" style={st.problem} testID="sign-error">
            {error}
          </Text>
        ) : null}
      </View>
    </Dialog>
  );
}

function SentLinks({ sent, fileName }: { sent: Sent; fileName: string }): ReactElement {
  return (
    <View style={st.stack}>
      <Text style={st.file} numberOfLines={1}>
        {fileName}
      </Text>
      <Text style={st.said} testID="sign-mail-line">
        {mailWords(sent.emailed, sent.notice, sent.links.length)}
      </Text>
      <LinkRows links={sent.links} />
    </View>
  );
}

/** Copy for one link. When the page may not reach the clipboard it says so; the link is still on the row. */
export function CopyLink({ name, url }: { name: string; url: string }): ReactElement {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy ${first(name)}'s link`}
      testID={`sign-copy-${first(name)}`}
      onPress={() =>
        void copyText(url).then((ok) => {
          setState(ok ? "copied" : "failed");
          timer.current = setTimeout(() => setState("idle"), 2200);
        })
      }
      style={({ hovered }: { hovered?: boolean }) => [st.copy, hovered === true && st.over]}
    >
      <Text style={st.copyText}>{state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : "Copy"}</Text>
    </Pressable>
  );
}

/** The sent links, one Row each: the person, the address, Copy. */
export function LinkRows({ links }: { links: readonly SentLink[] }): ReactElement {
  return (
    <View style={st.links} testID="sign-links-list">
      {/* ui-rows-lint: not a list (each slot holds one ui/Row; the wrapper only carries its test id) */}
      {links.map((l) => (
        <View key={l.index} testID={`sign-link-${first(l.name)}`} style={st.linkSlot}>
          <Row
            id={`sign-link:${l.index}`}
            title={l.name}
            {...(l.email ? { titleSuffix: l.email } : {})}
            note={l.url}
            trailing={<CopyLink name={l.name} url={l.url} />}
          />
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  stack: { gap: 10 },
  file: { fontSize: 12.5, color: "var(--ink-3)" as string },
  label: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string, marginTop: 4 },
  rowWrap: { gap: 4 },
  row: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  fields: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  name: { flexGrow: 1, flexBasis: 150, minWidth: 140 },
  email: { flexGrow: 1.4, flexBasis: 190, minWidth: 160 },
  input: { width: "100%" },
  message: { minHeight: 64, textAlignVertical: "top" },
  x: { marginTop: 6, width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  xText: { fontSize: 18, lineHeight: 20, color: "var(--ink-3)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  add: { alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 8, marginLeft: -8, borderRadius: 7 },
  addText: { fontSize: 13, color: "var(--accent)" as string, fontWeight: "500" },
  problem: { fontSize: 12.5, color: "var(--danger)" as string },
  said: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  links: { marginHorizontal: -6 },
  linkSlot: { paddingHorizontal: 0 },
  copy: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, minWidth: 64, alignItems: "center" },
  copyText: { fontSize: 13, fontWeight: "600", color: "var(--accent)" as string },
});
