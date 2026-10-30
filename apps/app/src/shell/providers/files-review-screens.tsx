// The Files review screens over the Space's runtime (spec 2.16, 3.5): the change set an agent staged (header with Discard, Request changes and Approve and commit, the git row with its Gate, and the
// diff), two versions of a file, a commit, a file's history, and an agent's instruction file with its lint bar and the agent.toml Form. Each is a screen id the shell writes to the hash (files.diff,
// files.commit-diff, files.history); the place mounts it here. Every press is one capability call inside the review components; nothing is decided here.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, View } from "react-native";
import {
  AgentFilePage, ChangesetDiff, ChangesetHeader, CommitDiff, FileDiff, GitRow, HistoryPanel, useCap,
} from "../../places/files/review/index.ts";
import { Skeleton } from "../../places/files/review/parts.tsx";
import type { HashTarget } from "../hash/hash.ts";
import type { ShellRuntime } from "./runtime.tsx";

export type ReviewKind = "changeset" | "compare" | "commit" | "history";

/** Which review screen a tab hash asks for, if any. files.diff is a change set (changesetId) or two versions of a file (fileId, from, to). */
export function reviewKind(t: HashTarget): ReviewKind | null {
  if (t.screen === "files.diff") return t.args["changesetId"] ? "changeset" : t.args["fileId"] ? "compare" : null;
  if (t.screen === "files.commit-diff") return t.args["folder"] && t.args["sha"] ? "commit" : null;
  if (t.screen === "files.history") return t.args["fileId"] ? "history" : null;
  return null;
}

/** A change set: the header, the git row when its folder is a repository, then the diff of every file. */
function ChangesetPage({ changesetId }: { changesetId: string }): ReactElement {
  const cs = useCap("changesets.get", { changesetId });
  const folderId = cs.status === "ready" ? cs.data.changeset.folderId : "";
  const git = useCap("git.status", { folderId }, folderId !== "");
  return (
    <>
      <ChangesetHeader changesetId={changesetId} />
      {git.status === "ready" && git.data.isRepo ? <GitRow folderId={folderId} /> : null}
      <ChangesetDiff changesetId={changesetId} />
    </>
  );
}

/** The name of a file, for the title of a compare and of its history. */
function useFileName(rt: ShellRuntime, fileId: string): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void rt.call("files.get", { fileId }).then((out) => { if (live) setName((out as { file: { name: string } }).file.name); }, () => { if (live) setName(fileId); });
    return () => { live = false; };
  }, [rt, fileId]);
  return name;
}

function ComparePage({ rt, fileId, from, to }: { rt: ShellRuntime; fileId: string; from?: string; to?: string }): ReactElement {
  const name = useFileName(rt, fileId);
  if (name === null) return <Skeleton height={240} testID="files-review-loading" />;
  return <FileDiff fileId={fileId} name={name} bare={false} {...(from ? { from } : {})} {...(to ? { to } : {})} />;
}

export function ReviewScreen({ rt, target }: { rt: ShellRuntime; target: HashTarget }): ReactElement | null {
  const kind = reviewKind(target);
  const a = target.args;
  let body: ReactElement | null = null;
  if (kind === "changeset") body = <ChangesetPage changesetId={a["changesetId"]!} />;
  else if (kind === "compare") body = <ComparePage rt={rt} fileId={a["fileId"]!} {...(a["from"] ? { from: a["from"] } : {})} {...(a["to"] ? { to: a["to"] } : {})} />;
  else if (kind === "commit") body = <CommitDiff folderId={a["folder"]!} sha={a["sha"]!} />;
  else if (kind === "history") body = <HistoryPanel fileId={a["fileId"]!} />;
  if (!body) return null;
  return (
    <View testID={`files-review-${kind}`} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>{body}</ScrollView>
    </View>
  );
}

export interface AgentFile { name: string; version: number; text: string; agentId: string; agentName: string }

/** The agent file behind a file id: AGENT.md or agent.toml in an agent's own folder, read as text. Null for any other file or one that cannot be read as text. */
export async function loadAgentFile(call: ShellRuntime["call"], fileId: string): Promise<AgentFile | null> {
  const { file } = (await call("files.get", { fileId })) as { file: { name: string; folderId: string; version: number } };
  if (file.name !== "agent.toml" && file.name !== "AGENT.md") return null;
  const { agents } = (await call("agents.list", {})) as { agents: Array<{ agentId: string; name: string; folderId: string }> };
  const agent = agents.find((x) => x.folderId === file.folderId);
  if (!agent) return null;
  const read = (await call("files.read", { fileId, as: "text" })) as { text?: string; version?: number };
  if (typeof read.text !== "string") return null;
  return { name: file.name, version: read.version ?? file.version, text: read.text, agentId: agent.agentId, agentName: agent.name };
}

/**
 * An agent's instruction file (AGENT.md or agent.toml in the agent's own folder) opens as the agent file page: the lint bar, the text and, for agent.toml, the Form. Any other file, and a file that
 * cannot be read as text, stays in the viewer (children).
 */
export function AgentFileGate({ rt, fileId, children }: { rt: ShellRuntime; fileId: string; children: ReactElement }): ReactElement {
  const [found, setFound] = useState<AgentFile | null | "pending">("pending");
  useEffect(() => {
    let live = true;
    setFound("pending");
    void loadAgentFile(rt.call, fileId).then((f) => { if (live) setFound(f); }, () => { if (live) setFound(null); });
    return () => { live = false; };
  }, [rt, fileId]);
  // the viewer draws at once; an agent's instruction file swaps to the agent file page when it is known to be one
  if (found === "pending" || found === null) return children;
  return (
    <ScrollView style={{ flex: 1 }} testID="agent-file-page-mount">
      <AgentFilePage key={`${fileId}:${found.version}`} fileId={fileId} name={found.name} path={`Agents/${found.agentName}`} agentId={found.agentId} saved={found.text} version={found.version} />
    </ScrollView>
  );
}
