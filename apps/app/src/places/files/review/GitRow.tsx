// The git row (spec 3.5; screen files.git-row): the folder's branch with what is ahead or behind, how many changes are waiting, and Pull, Push and Sync. One ui/Row line.
// A press on the branch opens the branch menu (git.list_branches); a folder that is not a repository offers to start one. A push to a protected branch raises the Gate row first.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { initRepo, pullBranch, pushBranch, switchBranch, syncFolder } from "./actions.ts";
import type { Result } from "./actions.ts";
import { useCap, useReviewData } from "./data.tsx";
import { GateRow } from "./GateRow.tsx";
import { Glyph } from "./icons.tsx";
import { aheadBehind, branchChoices, changesWords } from "./model.ts";
import type { GateView } from "./model.ts";
import { Btn, IconBtn, Note, Skeleton, anchorOf } from "./parts.tsx";

export interface GitRowProps { folderId: string }

type Line = { text: string; kind: "ok" | "error" | "warn" };

export function GitRow({ folderId }: GitRowProps): ReactElement {
  const data = useReviewData();
  const st = useCap("git.status", { folderId });
  const br = useCap("git.list_branches", { folderId });
  const [gate, setGate] = useState<GateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Line | null>(null);
  const attempt = useRef<string | null>(null);
  const { element: menu, show } = useMenu();

  if (st.status !== "ready") return <Skeleton height={28} testID="git-loading" />;
  const status = st.data;

  const done = (what: string, r: Result<unknown>): void => {
    setBusy(false);
    setLine(r.ok ? { kind: "ok", text: what } : { kind: "error", text: r.error });
  };
  const keyed = (): string => { attempt.current ??= data.key(); return attempt.current; };
  const run = (what: string, go: () => Promise<Result<unknown>>): void => {
    if (busy) return;
    setBusy(true);
    setLine(null);
    void go().then((r) => { if (r.ok) attempt.current = null; done(what, r); });
  };

  if (!status.isRepo) {
    return (
      <View style={s.wrap} testID="git-row">
        <Row
          id="git"
          title="Not a git folder"
          leading={<Glyph name="branch" size={14} />}
          trailing={<Btn label="Start a repository" small disabled={busy} onPress={() => run("Started a repository.", () => initRepo(data.call, folderId))} testID="git-init" />}
        />
        {line ? <Note text={line.text} kind={line.kind} /> : null}
      </View>
    );
  }

  const hasRemote = status.remotes.length > 0;
  const branch = status.branch ?? "detached";
  const suffix = [status.protected ? "Protected" : "", aheadBehind(status)].filter(Boolean).join(" · ");

  const pushNow = (): void => run(`Pushed ${branch}.`, () => pushBranch(data.call, folderId, keyed(), status.branch));
  const push = (): void => {
    if (busy) return;
    if (status.protected && status.branch) { setGate({ branch: status.branch, state: "waiting" }); return; }
    pushNow();
  };

  const openBranches = (e: unknown): void => {
    const at = anchorOf(e);
    const choices = br.status === "ready" ? branchChoices(br.data) : [];
    const items: MenuEntry[] = choices.length
      ? choices.map((c): MenuEntry => ({
        label: c.protected ? `${c.name} (protected)` : c.name,
        checked: c.current,
        onSelect: () => { if (!c.current) run(`Switched to ${c.name}.`, () => switchBranch(data.call, folderId, c.name)); },
      }))
      : [{ label: "No other branches" }];
    show(items, at.x, at.y, "other");
  };

  return (
    <View style={s.wrap} testID="git-row">
      <Row
        id="git"
        title={branch}
        {...(suffix ? { titleSuffix: suffix } : {})}
        leading={<Glyph name="branch" size={14} color="var(--ink-2)" />}
        trailing={
          <View style={s.acts}>
            <Text style={s.changes} testID="git-changes">{changesWords(status)}</Text>
            <IconBtn label="Switch branch" onPress={openBranches} menu testID="git-branches"><Glyph name="chevd" size={12} /></IconBtn>
            <IconBtn label="Pull" disabled={busy || !hasRemote} onPress={() => run("Pulled the latest.", () => pullBranch(data.call, folderId))} testID="git-pull"><Glyph name="pull" size={14} color="var(--ink-2)" /></IconBtn>
            <IconBtn label="Push" disabled={busy || !hasRemote} onPress={push} testID="git-push"><Glyph name="push" size={14} color="var(--ink-2)" /></IconBtn>
            <IconBtn label="Sync" disabled={busy || !hasRemote} onPress={() => run("Synced with the remote.", () => syncFolder(data.call, folderId, keyed()))} testID="git-sync"><Glyph name="sync" size={14} color="var(--ink-2)" /></IconBtn>
          </View>
        }
      />
      {gate ? (
        <GateRow
          gate={gate}
          onApprove={() => { setGate({ ...gate, state: "cleared" }); pushNow(); }}
          onCancel={() => setGate(null)}
        />
      ) : null}
      {line ? <Note text={line.text} kind={line.kind} /> : null}
      {menu}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: "100%" },
  acts: { flexDirection: "row", alignItems: "center", gap: 2 },
  changes: { fontSize: 12, color: "var(--ink-3)" as string, marginRight: 4 },
});
