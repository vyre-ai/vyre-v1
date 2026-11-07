// The key request card of a chat (rc.8): an agent that needs a key from the person asks here, where they are. The card says which key and why, takes the value in a secure field that goes straight to the Vault
// (vault.requests.fulfil; the value is in the call, never in a message, a block or a log), or Declines. Once provided the agent carries on in this chat by itself. Needs you keeps a linked row; both close together
// because both read the one request. A person who cannot decide it (a member asking in a Team Space) sees who it is waiting on, never a field.
import { useCallback, useEffect, useState } from "react";
import { useFollow } from "./use-follow.ts";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, CardActions, CardDeny, CardDone, CardField, CardHead } from "../../../../../../ui/src/Card/index.tsx";
import type { ConversationData } from "./data.tsx";
import { Glyph } from "./parts.tsx";
import { Face } from "../needsyou/parts.tsx";
import { AUDIENCES, keyWords, requestOf } from "./keyrequest-model.ts";
import type { KeyAudience, KeyRequest } from "./keyrequest-model.ts";

type Data = Pick<ConversationData, "call" | "changes">;

export function isKeyRequest(type: string): boolean { return type === "vault_request"; }

export function KeyRequestCard({ requestId, agent, agentId, data }: { requestId: string; agent: string; agentId: string; data: Data }): ReactElement | null {
  const [req, setReq] = useState<KeyRequest | null | undefined>(undefined);
  const [canDecide, setCanDecide] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // who may use the key through the agent (owner ruling, 3 Nov 2026): only the person who asked, unless the approver picks anyone who asks this agent
  const [audience, setAudience] = useState<KeyAudience>("asker");

  const load = useCallback(async (): Promise<void> => {
    try {
      const got = requestOf(await data.call("vault.requests.get", { requestId }));
      const toDecide = (await data.call("vault.requests.list", { mine: false })) as { requests?: { id: string }[] };
      setReq(got);
      setCanDecide((toDecide.requests ?? []).some((r) => r.id === requestId));
    } catch { setReq(null); }
  }, [data, requestId]);
  useEffect(() => { void load(); }, [load]);
  useFollow(data.changes, load, req === undefined || req === null || req.state === "waiting");

  if (req === undefined || req === null) return null;
  const words = keyWords(req.name);

  if (req.state !== "waiting") {
    const ok = req.state === "fulfilled";
    return (
      <CardDone testID={`keyreq-done-${requestId}`} ok={ok} glyph={<Glyph name={ok ? "check" : "x"} size={13} color={ok ? "var(--ok)" : "var(--ink-3)"} />} text={ok ? `Added · ${words}` : req.state === "declined" ? `Declined · ${words}` : `Withdrawn · ${words}`} />
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
      await data.call("vault.requests.fulfil", { requestId, folderId, fields: req.fields.map((k) => ({ key: k, value: (values[k] ?? "").trim() })), audience });
      setValues({});
      await load();
    } catch (e) { setProblem((e as { message?: string }).message ?? "That did not save. Try again."); void load(); }
    finally { setBusy(false); }
  };
  const decline = async (reason: string): Promise<void> => {
    setBusy(true); setProblem("");
    try { await data.call("vault.requests.decline", { requestId, ...(reason ? { note: reason } : {}) }); await load(); }
    catch (e) { setProblem((e as { message?: string }).message ?? "That did not send. Try again."); void load(); }
    finally { setBusy(false); }
  };
  const ready = req.fields.every((k) => (values[k] ?? "").trim() !== "");

  return (
    <Card kind="input" testID={`keyreq-${requestId}`} label={`${agent} needs the ${words}`} onCancel={declining ? () => setDeclining(false) : undefined} {...(canDecide && !declining && ready && !busy ? { onEnter: () => void add() } : {})}>
      <CardHead title={`${agent} needs the ${words}`} lead={<Face name={agent} seedId={agentId} kind="agent" size={20} />} />
      {req.reason ? <Text style={st.reason}>{req.reason}</Text> : null}
      {!canDecide ? (
        <Text testID={`keyreq-wait-${requestId}`} style={st.reason}>Asked an admin to add it. It carries on when they do.</Text>
      ) : declining ? (
        <CardDeny ids={{ reason: `keyreq-reason-${requestId}`, back: `keyreq-back-${requestId}`, go: `keyreq-decline-go-${requestId}` }} busy={busy} onBack={() => setDeclining(false)} onDeny={(r) => void decline(r)} />
      ) : (
        <View style={st.col}>
          {/* ui-rows-lint: not a list (one secure field per field of the key) */}
          {req.fields.map((k, i) => (
            <CardField key={k} label={req.fields.length === 1 ? "Key" : k} accessLabel={req.fields.length === 1 ? `${words} value` : `${words}, ${k}`} testID={`keyreq-field-${requestId}-${k}`} value={values[k] ?? ""} onChange={(v) => setValues({ ...values, [k]: v })}
              placeholder={req.fields.length === 1 ? "Paste the key" : k} secure hint={i === 0 ? "It goes straight to the Vault. No message holds it." : " "} error={null} disabled={busy} />
          ))}
          <View accessibilityRole="radiogroup" accessibilityLabel={`Who can use it through ${agent}`} testID={`keyreq-audience-${requestId}`} style={st.col}>
            <Text style={st.ask}>{`Who can use it through ${agent}?`}</Text>
            {/* ui-rows-lint: not a list (the two choices of one question) */}
            {AUDIENCES.map((a) => (
              <Pressable key={a.key} accessibilityRole="radio" accessibilityState={{ checked: audience === a.key }} aria-checked={audience === a.key} accessibilityLabel={a.label} testID={`keyreq-audience-${a.key}-${requestId}`} onPress={() => setAudience(a.key)} style={st.choice}>
                <View style={[st.dot, audience === a.key && st.dotOn]} />
                <Text style={st.choiceText}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
          <CardActions busy={busy} secondary={[{ label: "Deny", onPress: () => setDeclining(true), testID: `keyreq-decline-${requestId}` }]} primary={{ label: "Add the key", disabled: !ready, onPress: () => void add(), testID: `keyreq-add-${requestId}` }} />
        </View>
      )}
      {problem ? <Text accessibilityRole="alert" style={st.err}>{problem}</Text> : null}
    </Card>
  );
}

const st = StyleSheet.create({
  reason: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  col: { gap: 8 },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  ask: { fontSize: 13, color: "var(--ink-2)" as string },
  choice: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: "var(--ink-3)" as string },
  dotOn: { borderWidth: 4.5, borderColor: "var(--accent)" as string },
  choiceText: { fontSize: 13, color: "var(--ink)" as string },
});
