// The changeset header (spec 2.16, 3.5; screen files.changeset-header): "Docs changed 3 files · Review" with Discard, Request changes and Approve and commit, from the prototype's diff tab.
// Approve and commit takes a message and, in a git folder, whether to push; a protected branch shows the Gate row and keeps Approve off until the Gate says yes. Discard asks first. Request changes takes a note.
// Cmd-Enter approves. The header reads changesets.get live and the git status of the folder; every press is one capability call and the answer comes back as a line under the header.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { approveChangeset, discardChangeset, requestChanges, reviewExternally } from "./actions.ts";
import { useCap, useReviewData, useReviewLayout } from "./data.tsx";
import { GateRow } from "./GateRow.tsx";
import { Glyph } from "./icons.tsx";
import {
  APPROVE_LABEL, approveBlocked, baseLine, blockedReason, changedLine, isOpen, needsGate, requestLabel, settledWords, totalsWords,
} from "./model.ts";
import type { GateState, GateView } from "./model.ts";
import { Btn, IconBtn, Note, Segmented, Skeleton, Switch, TextField, anchorOf, webProps } from "./parts.tsx";

export interface ChangesetHeaderProps {
  changesetId: string;
  /** Comments written but not yet sent to the agent, for "Request changes (2)". */
  unsent?: number;
  /** Open on the Request changes note or the Discard confirm (the screenshot mount and the tests start there). */
  panel?: "request" | "discard";
}

type Panel = "request" | "discard" | null;
type Line = { text: string; kind: "ok" | "error" | "warn" };

export function ChangesetHeader({ changesetId, unsent = 0, panel: startPanel }: ChangesetHeaderProps): ReactElement {
  const data = useReviewData();
  const q = useCap("changesets.get", { changesetId });
  const cs = q.status === "ready" ? q.data.changeset : null;
  const git = useCap("git.status", { folderId: cs?.folderId ?? "" }, cs !== null);
  const status = git.status === "ready" ? git.data : undefined;
  const isRepo = status?.isRepo === true;
  const hasRemote = (status?.remotes.length ?? 0) > 0;

  const [message, setMessage] = useState("");
  const [pushChoice, setPushChoice] = useState<boolean | null>(null);
  const [panel, setPanel] = useState<Panel>(startPanel ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Line | null>(null);
  const [gateState, setGateState] = useState<GateState>("waiting");
  const attempt = useRef<string | null>(null);
  const [layout, setLayout] = useReviewLayout();
  const { element: menu, show } = useMenu();

  const push = isRepo && hasRemote && (pushChoice ?? true);
  const gate: GateView | null = push && needsGate(status) && status?.branch ? { branch: status.branch, state: gateState } : null;
  const open = cs !== null && isOpen(cs.state);
  const blocked = approveBlocked(gate);

  const approve = (): void => {
    if (cs === null || busy || !open) return;
    if (blocked) { setLine({ kind: "warn", text: blockedReason(gate) }); return; }
    attempt.current ??= data.key();
    const key = attempt.current;
    setBusy(true);
    setLine(null);
    void approveChangeset(data.call, { changesetId, message, push, key }).then((r) => {
      setBusy(false);
      if (r.ok) {
        attempt.current = null;
        const sha = r.value.commit ? r.value.commit.slice(0, 7) : "";
        setLine({ kind: "ok", text: sha ? `Committed ${sha}${push ? " and pushed" : ""}.` : "Approved." });
        data.nav.settled(changesetId, "approved");
      } else setLine({ kind: "error", text: r.error });
    });
  };

  const sendBack = (): void => {
    if (busy) return;
    setBusy(true);
    void requestChanges(data.call, changesetId, note).then((r) => {
      setBusy(false);
      if (r.ok) {
        const who = data.nameOf(cs?.by ?? "");
        setPanel(null);
        setNote("");
        setLine({ kind: "ok", text: r.value.sent > 0 ? `Sent ${r.value.sent} ${r.value.sent === 1 ? "comment" : "comments"} to ${who}.` : `Sent back to ${who}.` });
        data.nav.settled(changesetId, "changes_requested");
      } else setLine({ kind: "error", text: r.error });
    });
  };

  const discard = (): void => {
    if (busy) return;
    setBusy(true);
    void discardChangeset(data.call, changesetId).then((r) => {
      setBusy(false);
      if (r.ok) {
        setPanel(null);
        setLine({ kind: "ok", text: "Discarded. Nothing was changed." });
        data.nav.settled(changesetId, "discarded");
      } else setLine({ kind: "error", text: r.error });
    });
  };

  const outside = (actorId?: string): void => {
    void reviewExternally(data.call, changesetId, actorId).then((r) => {
      setLine(r.ok ? { kind: "ok", text: `Asked ${data.nameOf(r.value.actorId)} to review these changes.` } : { kind: "error", text: r.error });
    });
  };

  const openMore = (e: unknown): void => {
    const at = anchorOf(e);
    const people = data.reviewers ?? [];
    const outsideItems: MenuEntry[] = people.length
      ? [{ head: "Review externally" }, ...people.map((p): MenuEntry => ({ label: p.name, onSelect: () => outside(p.id) }))]
      : [{ label: "Review externally", onSelect: () => outside() }];
    show([{ label: "Review changes", onSelect: () => data.nav.openChangeset(changesetId) }, { separator: true }, ...outsideItems], at.x, at.y, "other");
  };

  const onKeyDown = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void }): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault?.(); approve(); }
    else if (e.key === "Escape" && panel) { e.preventDefault?.(); setPanel(null); }
  };

  if (cs === null) return <Skeleton height={64} testID="changeset-loading" />;

  const totals = totalsWords(cs.added, cs.removed);
  const settled = settledWords(cs);
  const by = data.nameOf(cs.by);

  return (
    <View style={st.wrap} testID="changeset-header" role="group" aria-label={changedLine(by, cs.fileCount)} {...webProps({ onKeyDown })}>
      <View style={st.head}>
        <View style={st.left}>
          <View style={st.t1}>
            <Avatar name={by} kind={cs.by.startsWith("agt_") ? "agent" : "person"} size={24} />
            <Text accessibilityRole="header" aria-level={2} numberOfLines={1} style={st.h2} testID="changeset-title">
              {changedLine(by, cs.fileCount)}
              <Text style={st.rv}>{" · Review"}</Text>
            </Text>
          </View>
          <View style={st.t2}>
            <Text style={st.where} testID="changeset-where">{data.nameOf(cs.folderId)}</Text>
            {baseLine(cs) ? <Text style={st.mut} numberOfLines={3}>{baseLine(cs)}</Text> : null}
          </View>
        </View>
        <View style={st.acts}>
          {open ? (
            <>
              <Btn label="Discard" onPress={() => setPanel(panel === "discard" ? null : "discard")} pressed={panel === "discard"} testID="changeset-discard" />
              <Btn label={requestLabel(unsent)} onPress={() => setPanel(panel === "request" ? null : "request")} pressed={panel === "request"} testID="changeset-request" />
              <Btn label={APPROVE_LABEL} primary disabled={busy || blocked} hint={blockedReason(gate)} onPress={approve} testID="changeset-approve" />
            </>
          ) : null}
          <Segmented options={[{ id: "unified", label: "Unified" }, { id: "split", label: "Split" }]} value={layout} onChange={setLayout} label="Layout" testID="changeset-layout" />
          <IconBtn label="More" onPress={openMore} menu testID="changeset-more"><Glyph name="more" size={15} color="var(--ink-2)" width={1.8} /></IconBtn>
        </View>
      </View>

      <View style={st.totals} testID="changeset-totals">
        <Text style={st.totalsText}>{cs.fileCount} {cs.fileCount === 1 ? "file" : "files"}</Text>
        <Text style={st.add}>{totals.added}</Text>
        <Text style={st.del}>{totals.removed}</Text>
        <View style={st.grow} />
        {Platform.OS === "web" && open ? <Text style={st.hint}>{"⌘↵ approves"}</Text> : null}
      </View>

      {open && isRepo ? (
        <View style={st.commit} testID="changeset-commit">
          <TextField value={message} onChange={setMessage} label="Commit message" placeholder="Commit message (optional)" onSubmit={approve} testID="changeset-message" />
          {hasRemote ? (
            <View style={st.pushRow}>
              <Switch on={push} onChange={setPushChoice} label="Push after committing" testID="changeset-push" />
              <Text style={st.pushText}>Push</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {gate ? <GateRow gate={gate} onApprove={() => setGateState("cleared")} onCancel={() => setGateState("cancelled")} onAsk={() => setGateState("waiting")} /> : null}

      {panel === "discard" ? (
        <View style={st.panel} testID="changeset-discard-confirm" role="alertdialog" aria-label="Discard these changes?">
          <Text style={st.panelText}>Discard these changes?</Text>
          <Btn label="Cancel" small onPress={() => setPanel(null)} testID="changeset-discard-cancel" />
          <Btn label="Discard" small danger disabled={busy} onPress={discard} testID="changeset-discard-go" />
        </View>
      ) : null}
      {panel === "request" ? (
        <View style={st.panel} testID="changeset-request-panel" role="group" aria-label="Request changes">
          <TextField value={note} onChange={setNote} label="Note to the agent" placeholder={`What should ${by} change?`} onSubmit={sendBack} onEscape={() => setPanel(null)} testID="changeset-note" autoFocus />
          <Btn label="Cancel" small onPress={() => setPanel(null)} testID="changeset-request-cancel" />
          <Btn label="Send" small primary disabled={busy} onPress={sendBack} testID="changeset-request-go" />
        </View>
      ) : null}

      {line ? <Note text={line.text} kind={line.kind} /> : settled ? <Note text={settled} kind={cs.state === "discarded" ? "warn" : "ok"} /> : null}
      {menu}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: "100%" },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 12, paddingTop: 14, paddingBottom: 10, paddingHorizontal: 22 },
  left: { flexGrow: 1, flexShrink: 1, flexBasis: 280, minWidth: 0 },
  t1: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  h2: { flexShrink: 1, fontSize: 18, fontWeight: "600", letterSpacing: -0.18, color: "var(--ink)" as string },
  rv: { color: "var(--ink-3)" as string, fontWeight: "500" },
  t2: { marginTop: 5, gap: 2 },
  where: { fontSize: 12.5, color: "var(--ink-2)" as string },
  mut: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  acts: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  totals: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 22, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" },
  totalsText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  add: { fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--ok)" as string },
  del: { fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--danger)" as string },
  grow: { flex: 1 },
  hint: { fontSize: 11.5, color: "var(--ink-4)" as string },
  commit: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 22, paddingTop: 10 },
  pushRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pushText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  panel: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 22, paddingTop: 10 },
  panelText: { flex: 1, fontSize: 12.5, color: "var(--ink-2)" as string },
});
