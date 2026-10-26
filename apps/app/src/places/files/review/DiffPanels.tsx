// The diff tabs (spec 2.16, 4.5; screens files.diff and files.commit-diff): the shared ui/DiffTab fed by files.diff (two versions of a file), changesets.diff with the comments (an agent's changes) and
// git.show (a commit). Revert of one change and a comment call their capabilities through DiffTab's own invoke. Nothing here draws a line of the diff.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { DiffTab } from "../../../../../../ui/src/DiffTab/index.tsx";
import type { Density, DiffComment, DiffFile, DiffLayout } from "../../../../../../ui/src/DiffTab/index.tsx";
import { useCap, useCapMany, useReviewData } from "./data.tsx";
import { totalsWords, commentsOf, commitFiles, diffFileOf } from "./model.ts";
import { Glyph } from "./icons.tsx";
import { Segmented, Skeleton, webProps } from "./parts.tsx";

const LOADING_HEIGHT = 240;

function Empty({ text }: { text: string }): ReactElement {
  return <View style={st.empty} testID="diff-empty"><Text style={st.emptyText}>{text}</Text></View>;
}

export interface FileDiffProps {
  fileId: string;
  /** Version ids. Without them the file's current version against the one before. */
  from?: string;
  to?: string;
  /** The file's name, for the title and the path. */
  name: string;
  density?: Density;
  /** A version compare: no toolbar, the changed lines between "..." marks with their neighbours. */
  bare?: boolean;
}

/** files.diff: two versions of one file. */
export function FileDiff({ fileId, from, to, name, density = "regular", bare = true }: FileDiffProps): ReactElement {
  const data = useReviewData();
  const q = useCap("files.diff", { fileId, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const files = useMemo<DiffFile[]>(() => (q.status === "ready" ? [diffFileOf(name, q.data)] : []), [q, name]);
  if (q.status !== "ready") return <Skeleton height={LOADING_HEIGHT} testID="diff-loading" />;
  if (q.data.identical) return <Empty text="These two versions are the same." />;
  return (
    <DiffTab title={name} layout="unified" wordMarks files={files} comments={[]} selectedPath={name} density={density} bare={bare} invoke={(c, i) => data.call(c, i)} testID="file-diff" />
  );
}

export interface ChangesetDiffProps {
  changesetId: string;
  density?: Density;
  /** The file to open on; the others start collapsed when given. */
  path?: string;
}

/** One file of the stack: a ui/Row card header (chevron, file name, v2 to v3, +added -removed) over the shared DiffTab for that file. */
function FileCard({ file, versions, comments, layout, density, changesetId, collapsed, onToggle }: {
  file: DiffFile; versions: string; comments: readonly DiffComment[]; layout: DiffLayout; density: Density; changesetId: string; collapsed: boolean; onToggle: () => void;
}): ReactElement {
  const data = useReviewData();
  const totals = totalsWords(file.added, file.removed);
  return (
    <View style={st.card} testID={`diff-card-${file.path}`}>
      <Row
        id={`diff-card-${file.path}`}
        title={file.path}
        onPress={onToggle}
        leading={(
          <Pressable accessibilityRole="button" accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${file.path}`} accessibilityState={{ expanded: !collapsed }} onPress={onToggle} testID={`diff-card-toggle-${file.path}`} style={st.chev} {...webProps({ "aria-expanded": !collapsed })}>
            <Glyph name={collapsed ? "chev" : "chevd"} size={12} color="var(--ink-3)" width={1.6} />
          </Pressable>
        )}
        trailing={(
          <View style={st.stats}>
            {versions ? <Text style={st.ver}>{versions}</Text> : null}
            {file.body === "image" ? <Text style={st.ver}>image</Text> : <><Text style={st.add}>{totals.added}</Text><Text style={st.del}>{totals.removed}</Text></>}
          </View>
        )}
      />
      {collapsed ? null : (
        <DiffTab
          key={layout}
          title={file.path} layout={layout} wordMarks files={[file]} comments={comments} selectedPath={file.path} density={density} changesetId={changesetId} bare
          invoke={(c, i) => data.call(c, i)} testID={`changeset-diff-${file.path}`}
        />
      )}
    </View>
  );
}

/** changesets.get for the files, then changesets.diff for each and the comments: a stack of file cards, each the shared DiffTab. */
export function ChangesetDiff({ changesetId, density = "regular", path }: ChangesetDiffProps): ReactElement {
  const data = useReviewData();
  const cs = useCap("changesets.get", { changesetId });
  const paths = useMemo<string[]>(() => (cs.status === "ready" ? cs.data.files.map((f) => f.path) : []), [cs]);
  const diffs = useCapMany("changesets.diff", paths.map((p) => ({ changesetId, path: p })));
  const comments = useCap("changesets.comments.list", { changesetId });
  const [layout, setLayout] = useState<DiffLayout>("unified");
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const files = useMemo<DiffFile[]>(() => {
    const out: DiffFile[] = [];
    paths.forEach((p, i) => { const d = diffs.items[i]; if (d) out.push(diffFileOf(p, d)); });
    return out;
  }, [paths, diffs]);
  const notes = useMemo(() => (comments.status === "ready" ? commentsOf(comments.data.comments, files, data.nameOf) : []), [comments, files, data]);
  if (cs.status !== "ready" || !diffs.ready) return <Skeleton height={LOADING_HEIGHT} testID="diff-loading" />;
  if (!files.length) return <Empty text="Nothing to review in this changeset." />;
  const base = Number(cs.data.changeset.baseVersion);
  const versions = Number.isFinite(base) && base > 0 ? `v${base} \u2192 v${base + 1}` : "";
  const isShut = (p: string): boolean => shut[p] ?? (path !== undefined && p !== path);
  return (
    <View style={st.stack} testID="changeset-diff" role="region" aria-label={`Changes to ${data.nameOf(cs.data.changeset.folderId)}`}>
      <View style={st.bar}>
        <Text style={st.barText} testID="changeset-diff-title">{data.nameOf(cs.data.changeset.folderId)}</Text>
        <View style={st.grow} />
        <Segmented options={[{ id: "unified", label: "Unified" }, { id: "split", label: "Split" }]} value={layout} onChange={setLayout} label="Layout" testID="changeset-layout" />
      </View>
      {/* ui-rows-lint: not a list (file cards: a ui/Row header over a diff, one per changed file) */}
      {files.map((f) => (
        <FileCard key={f.path} file={f} versions={versions} comments={notes} layout={layout} density={density} changesetId={changesetId} collapsed={isShut(f.path)} onToggle={() => setShut({ ...shut, [f.path]: !isShut(f.path) })} />
      ))}
    </View>
  );
}

export interface CommitDiffProps {
  folderId: string;
  sha: string;
  path?: string;
  density?: Density;
}

/** git.show: one commit. */
export function CommitDiff({ folderId, sha, path, density = "regular" }: CommitDiffProps): ReactElement {
  const q = useCap("git.show", { folderId, sha, ...(path ? { path } : {}) });
  const files = useMemo<DiffFile[]>(() => (q.status === "ready" ? commitFiles(q.data, path) : []), [q, path]);
  if (q.status !== "ready") return <Skeleton height={LOADING_HEIGHT} testID="diff-loading" />;
  return (
    <DiffTab title={q.data.commit.message} layout="unified" wordMarks files={files} comments={[]} selectedPath={files[0]?.path ?? null} density={density} testID="commit-diff" />
  );
}

const st = StyleSheet.create({
  stack: { width: "100%", paddingBottom: 16 },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 22, paddingVertical: 10 },
  barText: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  grow: { flex: 1 },
  card: { marginHorizontal: 22, marginTop: 12, borderRadius: 10, overflow: "hidden", backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line)" },
  chev: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  stats: { flexDirection: "row", alignItems: "center", gap: 10 },
  ver: { fontSize: 11.5, color: "var(--ink-3)" as string },
  add: { fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--ok)" as string },
  del: { fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--danger)" as string },
  empty: { padding: 24, alignItems: "center" },
  emptyText: { fontSize: 13, color: "var(--ink-3)" as string },
});
