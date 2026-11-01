// The key request card of a chat (rc.8): an agent that needs a key from the person asks here, where they are. The card says which key and why, takes the value in a secure field that goes straight to the Vault
// (vault.requests.fulfil; the value is in the call, never in a message, a block or a log), or Declines. Once provided the agent carries on in this chat by itself. Needs you keeps a linked row; both close together
// because both read the one request. A person who cannot decide it (a member asking in a Team Space) sees who it is waiting on, never a field.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { ConversationData } from "./data.tsx";
import { Glyph, TextButton } from "./parts.tsx";
import { Face } from "../needsyou/parts.tsx";
import { keyWords, requestOf } from "./keyrequest-model.ts";
import type { KeyRequest } from "./keyrequest-model.ts";

type Data = Pick<ConversationData, "call">;

export function isKeyRequest(type: string): boolean { return type === "vault_request"; }

export function KeyRequestCard({ requestId, agent, agentId, data }: { requestId: string; agent: string; agentId: string; data: Data }): ReactElement | null {
  const [req, setReq] = useState<KeyRequest | null | undefined>(undefined);
  const [canDecide, setCanDecide] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback(async (): Promise<void> => {
    try {
      const got = requestOf(await data.call("vault.requests.get", { requestId }));
      const toDecide = (await data.call("vault.requests.list", { mine: false })) as { requests?: { id: string }[] };
      setReq(got);
      setCanDecide((toDecide.requests ?? []).some((r) => r.id === requestId));
    } catch { setReq(null); }
  }, [data, requestId]);
  useEffect(() => { void load(); }, [load]);

  if (req === undefined || req === null) return null;
  const words = keyWords(req.name);

  if (req.state !== "waiting") {
    const ok = req.state === "fulfilled";
    return (
      <View testID={`keyreq-done-${requestId}`} style={st.done} accessibilityRole="text">
        <Glyph name={ok ? "check" : "x"} size={13} color={ok ? "var(--ok)" : "var(--ink-3)"} />
        <Text style={st.doneText}>{ok ? `Added · ${words}` : req.state === "declined" ? `Declined · ${words}` : `Withdrawn · ${words}`}</Text>
      </View>
    );
  }

  const folderFor = async (): Promise<string> => {
    if (req.folderId) return req.folderId;
    const folders = ((await data.call("vault.folders.list", {})) as { folders: { id: string; scope: string }[] }).folders;
    const pick = folders.find((f) => f.scope === "shared") ?? folders.find((f) => f.scope === "mine");
    if (pick) return pick.id;
    return ((await data.call("vault.folders.create", { name: "Mine", scope: "mine", idempotencyKey: `kr-${requestId}-folder` })) as { folder: { id: string } }).folder.id;
  };
  const add = async (): Promise<void> => {
    setBusy(true); setProblem("");
    try {
      const folderId = await folderFor();
      await data.call("vault.requests.fulfil", { requestId, folderId, fields: req.fields.map((k) => ({ key: k, value: (values[k] ?? "").trim() })) });
      setValues({});
      await load();
    } catch (e) { setProblem((e as { message?: string }).message ?? "That did not save. Try again."); }
    finally { setBusy(false); }
  };
  const decline = async (): Promise<void> => {
    setBusy(true); setProblem("");
    try { await data.call("vault.requests.decline", { requestId, ...(reason.trim() ? { note: reason.trim() } : {}) }); await load(); }
    catch (e) { setProblem((e as { message?: string }).message ?? "That did not send. Try again."); }
    finally { setBusy(false); }
  };
  const ready = req.fields.every((k) => (values[k] ?? "").trim() !== "");

  return (
    <View testID={`keyreq-${requestId}`} style={st.card} accessibilityRole="summary" accessibilityLabel={`${agent} needs the ${words}`}>
      <View style={st.head}>
        <Face name={agent} seedId={agentId} kind="agent" size={20} />
        <Text style={st.title}>{`${agent} needs the ${words}`}</Text>
      </View>
      {req.reason ? <Text style={st.reason}>{req.reason}</Text> : null}
      {!canDecide ? (
        <Text testID={`keyreq-wait-${requestId}`} style={st.reason}>Asked an admin to add it. It carries on when they do.</Text>
      ) : declining ? (
        <View style={st.col}>
          <TextInput accessibilityLabel="Why not (optional)" testID={`keyreq-reason-${requestId}`} value={reason} onChangeText={setReason} placeholder="Reason (optional)" placeholderTextColor="var(--ink-4)" style={st.input} />
          <View style={st.acts}>
            <TextButton label="Back" onPress={() => setDeclining(false)} testID={`keyreq-back-${requestId}`} />
            <TextButton label="Decline" danger disabled={busy} onPress={() => void decline()} testID={`keyreq-decline-go-${requestId}`} />
          </View>
        </View>
      ) : (
        <View style={st.col}>
          {/* ui-rows-lint: not a list (one secure field per field of the key) */}
          {req.fields.map((k) => (
            <TextInput key={k} accessibilityLabel={req.fields.length === 1 ? `${words} value` : `${words}, ${k}`} testID={`keyreq-field-${requestId}-${k}`} value={values[k] ?? ""} onChangeText={(v) => setValues({ ...values, [k]: v })}
              placeholder={req.fields.length === 1 ? "Paste the key" : k} placeholderTextColor="var(--ink-4)" secureTextEntry autoCapitalize="none" autoCorrect={false} style={st.input} />
          ))}
          <View style={st.acts}>
            <TextButton label="Decline" onPress={() => setDeclining(true)} disabled={busy} testID={`keyreq-decline-${requestId}`} />
            <TextButton label="Add the key" primary disabled={busy || !ready} onPress={() => void add()} testID={`keyreq-add-${requestId}`} />
          </View>
        </View>
      )}
      {problem ? <Text accessibilityRole="alert" style={st.err}>{problem}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginTop: 8, padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, maxWidth: 560 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  reason: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  col: { gap: 8 },
  acts: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  input: { minHeight: 36, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, fontSize: 13, color: "var(--ink)" as string },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  done: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  doneText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
