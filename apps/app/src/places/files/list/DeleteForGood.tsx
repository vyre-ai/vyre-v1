// Delete for good, from Trash (F77). One sheet for what Trash holds: an agent (with what goes and what will need someone, from one server read), a file or a folder. It is the one ui/Dialog with a body:
// Cancel takes focus first and Escape closes it; the one danger button names the thing. No typed name. The sentence a refusal brings shows in the sheet.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";

export type ForGood =
  | { kind: "agent"; id: string; name: string }
  | { kind: "file" | "folder"; id: string; name: string };

interface Preview {
  chats: number;
  memory: number;
  bytes: number;
  routines: number;
  chatPeople: Array<{ id: string; name: string }>;
  folderPeople: Array<{ id: string; name: string }>;
  named: Array<{ kind: "automation" | "task" | "goal" | "project"; id: string; title: string; link: string }>;
  backups: string;
  backupsKeptDays?: number;
  refused?: string;
}

/** A size in a person's units. */
export function bytesText(n: number): string {
  if (n < 1000) return n === 0 ? "nothing" : `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** "3 people have their own folder on its computer", or the names when there are five or fewer: "Noah and Maya have a chat with it". */
export function peopleLine(people: ReadonlyArray<{ name: string }>, many: string, one: string): string {
  if (people.length > 5) return `${people.length} people ${many}`;
  const names = people.map((p) => p.name);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  return `${list} ${names.length === 1 ? one : many}`;
}
const KIND_WORD = { automation: "Automation", task: "Task", goal: "Goal", project: "Project" } as const;

export function DeleteForGoodSheet({
  target,
  call,
  openItem,
  onClose,
  onDone,
}: {
  target: ForGood;
  call(cap: string, input: unknown): Promise<unknown>;
  openItem?(type: "task" | "goal" | "automation" | "project", id: string): void;
  onClose(): void;
  onDone(): void;
}): ReactElement {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (target.kind !== "agent") return;
    let live = true;
    call("agents.delete_preview", { agentId: target.id }).then(
      (p) => live && setPreview(p as Preview),
      (e: unknown) => live && setError(sentence(e)),
    );
    return () => {
      live = false;
    };
  }, [target.kind, target.id, call]);
  const go = (): void => {
    setBusy(true);
    const run =
      target.kind === "agent"
        ? call("agents.delete_for_good", { agentId: target.id })
        : target.kind === "file"
          ? call("files.purge", { fileId: target.id })
          : call("files.folder.purge", { folderId: target.id });
    run.then(
      () => onDone(),
      (e: unknown) => {
        setBusy(false);
        setError(sentence(e));
      },
    );
  };
  const ready = target.kind !== "agent" || (preview !== null && preview.refused === undefined);
  return (
    <Dialog
      title={`Delete ${target.name} for good?`}
      testID="forgood-sheet"
      titleTestID="forgood-title"
      onClose={onClose}
      width={440}
      actions={[
        { label: "Cancel", initial: true, testID: "forgood-cancel", onPress: onClose },
        {
          label: `Delete ${target.name} for good`,
          danger: true,
          disabled: !ready || busy,
          testID: "forgood-go",
          onPress: go,
        },
      ]}
    >
      {target.kind === "agent" ? (
        <View testID="forgood-body">
          {preview ? (
            <>
              {preview.chats > 0 ? (
                <Text style={s.line}>
                  {plural(preview.chats, "chat", "chats")} with {target.name}
                </Text>
              ) : null}
              {preview.memory > 0 ? (
                <Text style={s.line}>Its memory ({plural(preview.memory, "fact", "facts")})</Text>
              ) : null}
              {preview.bytes > 0 ? (
                <Text style={s.line}>Its computer and files ({bytesText(preview.bytes)})</Text>
              ) : null}
              {preview.routines > 0 ? (
                <Text style={s.line}>{plural(preview.routines, "routine", "routines")}</Text>
              ) : null}
              {preview.folderPeople.length > 0 ? (
                <Text style={s.line} testID="forgood-folder-people">
                  {peopleLine(preview.folderPeople, "have their own folder on its computer", "has their own folder on its computer")}
                </Text>
              ) : null}
              {preview.chatPeople.length > 0 ? (
                <Text style={s.line} testID="forgood-chat-people">
                  {peopleLine(preview.chatPeople, "have a chat with it", "has a chat with it")}
                </Text>
              ) : null}
              {preview.named.length > 0 ? (
                <View style={s.need} testID="forgood-need">
                  <Text style={s.head}>These will need someone:</Text>
                  {preview.named.map((n) => (
                    <Row
                      key={`${n.kind}:${n.id}`}
                      id={`forgood-open-${n.id}`}
                      title={`${KIND_WORD[n.kind]}: ${n.title}`}
                      onPress={() => openItem?.(n.kind, n.id)}
                    />
                  ))}
                </View>
              ) : null}
              <Text style={s.warn} testID="forgood-final">
                This cannot be undone.
              </Text>
              {preview.backupsKeptDays !== undefined ? (
                <Text
                  style={s.quiet}
                  testID="forgood-backups"
                >{`Backups made before today keep it for ${preview.backupsKeptDays} days.`}</Text>
              ) : null}
              {preview.refused ? <Text style={s.error}>{preview.refused}</Text> : null}
            </>
          ) : error === null ? (
            <Text style={s.quiet}>Counting what goes…</Text>
          ) : null}
        </View>
      ) : (
        <Text style={s.line}>It cannot be brought back.</Text>
      )}
      {error ? (
        <Text style={s.error} accessibilityRole="alert" testID="forgood-error">
          {error}
        </Text>
      ) : null}
    </Dialog>
  );
}

function sentence(e: unknown): string {
  const m =
    (e as { error?: { message?: string }; message?: string } | null)?.error?.message ??
    (e as { message?: string } | null)?.message;
  return m && m.length < 240 ? m : "It could not be deleted. Try again.";
}

const s = StyleSheet.create({
  line: { fontSize: 14, lineHeight: 22, color: "var(--ink)" as string },
  need: { marginTop: 12 },
  head: { fontSize: 13, color: "var(--ink-2)" as string, marginBottom: 4 },
  link: { fontSize: 14, lineHeight: 22, color: "var(--accent)" as string },
  warn: { fontSize: 13, color: "var(--ink-2)" as string, marginTop: 12 },
  quiet: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 12 },
  error: { fontSize: 13, color: "var(--danger, #c0392b)" as string, marginTop: 10 },
});
