// Console > Messaging > Rules > Do-not-contact list: everyone Vyre will not email, text or call. Search it, add people (one address or a pasted list), and remove someone with a reason.
// The list is contacts.suppression.list; Add is contacts.suppression.add (one call per channel); Add from a file reads a CSV (one column of emails or phone numbers, an optional reason column), says how many people it
// would add, and on confirm stores one small file per channel and reason and calls contacts.suppression.import; Remove is contacts.suppression.remove with the reason as its note. Automatic screening only adds people.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Empty, Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, Segmented, useAction } from "./shared.tsx";
import { useIntegrationRows } from "./integration-data.ts";
import { pickFiles } from "../../shell/providers/files-actions.ts";
import { addLabel, describeFile, parseDncFile } from "./dnc-import-model.ts";
import { storeGroup } from "./dnc-import.ts";

/** A file the person chose: its name and something that reads as text. */
export interface ChosenFile { name: string; mime: string; file: unknown }
const textOfFile = async (f: ChosenFile): Promise<string> => {
  const blob = f.file as { text?: () => Promise<string> };
  if (typeof blob.text !== "function") throw new Error(`${f.name} cannot be read`);
  return blob.text();
};

type Entry = CapMap["contacts.suppression.list"]["out"]["rows"][number];
type Reason = CapMap["contacts.suppression.add"]["in"]["reason"];

export const REASON_LABEL: Readonly<Record<Entry["reason"], string>> = { bounce_hard: "Bounced", complaint: "Complaint", unsubscribe: "Unsubscribed", stop: "STOP", manual: "Added by hand", do_not_contact: "Do not contact", import: "Imported" };
export const CHANNEL_LABEL: Readonly<Record<Entry["channel"], string>> = { email: "Email", sms: "Text", call: "Call" };
export const ADD_REASONS: readonly { key: Reason; title: string }[] = [{ key: "do_not_contact", title: "Do not contact" }, { key: "unsubscribe", title: "Unsubscribed" }, { key: "stop", title: "STOP" }];

/** Splits what a person typed or pasted into addresses, one per line or separated by commas, and sorts them into email and phone. */
export function parseAddresses(text: string): { email: string[]; sms: string[] } {
  const out = { email: [] as string[], sms: [] as string[] };
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,;]+/)) {
    const value = raw.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    (/^\+?[\d\s().-]{6,}$/.test(value) ? out.sms : out.email).push(value);
  }
  return out;
}

export function DncPage({ pick = pickFiles }: { pick?: () => Promise<ChosenFile[]> } = {}): ReactElement {
  const data = useConsoleData();
  const [query, setQuery] = useState(""), [adding, setAdding] = useState(false), [text, setText] = useState(""), [why, setWhy] = useState<Reason>("do_not_contact"), [removing, setRemoving] = useState(""), [reason, setReason] = useState(""), [problem, setProblem] = useState("");
  const [chosen, setChosen] = useState<{ name: string; text: string } | null>(null), [fileProblem, setFileProblem] = useState(""), [filing, setFiling] = useState(false), [filed, setFiled] = useState("");
  const file = useMemo(() => (chosen ? parseDncFile(chosen.text, why) : null), [chosen, why]);
  const list = useIntegrationRows<Entry>("contacts.suppression.list", "rows", query.trim() ? { query: query.trim() } : {});
  const action = useAction(list.refresh);
  const add = async (): Promise<void> => {
    const found = parseAddresses(text);
    if (!found.email.length && !found.sms.length) { setProblem("Enter an email or a phone number."); return; }
    setProblem("");
    const channels: ("email" | "sms")[] = ["email", "sms"];
    for (const channel of channels) {
      const addresses = found[channel];
      if (!addresses.length) continue;
      const out = await action.run("contacts.suppression.add", { channel, addresses, reason: why }, "Added to the do-not-contact list");
      if (out === undefined) return;
    }
    setText(""); setAdding(false);
  };
  const choose = async (): Promise<void> => {
    setFileProblem(""); setFiled("");
    try {
      const picked = (await pick())[0];
      if (!picked) return;
      const text = await textOfFile(picked);
      const read = parseDncFile(text, why);
      if (read.total === 0) { setChosen(null); setFileProblem("No email addresses or phone numbers in that file. Put them in the first column, one a row."); return; }
      setChosen({ name: picked.name, text });
    } catch (e) { setChosen(null); setFileProblem(e instanceof Error ? e.message : "That file could not be read."); }
  };
  const addFile = async (): Promise<void> => {
    if (!file || !chosen) return;
    setFiling(true); setFiled("");
    let added = 0, skipped = 0;
    try {
      for (const [i, group] of file.groups.entries()) {
        const stamp = `${Date.now()}-${i}`;
        const fileId = await storeGroup(data.call, group, `${group.channel === "email" ? "emails" : "phones"}-${group.reason}-${stamp}.csv`, `dnc-file:${stamp}`);
        const out = await action.run<CapMap["contacts.suppression.import"]["out"]>("contacts.suppression.import", { channel: group.channel, fileId, reason: group.reason, idempotencyKey: "" }, () => "Added to the do-not-contact list");
        if (out === undefined) return;
        added += out.added; skipped += out.skipped;
      }
      setChosen(null);
      setFiled(`Added ${added.toLocaleString("en-US")} ${added === 1 ? "person" : "people"} to the do-not-contact list.${skipped > 0 ? ` ${skipped.toLocaleString("en-US")} ${skipped === 1 ? "was" : "were"} already on it or could not be added.` : ""}`);
    } catch (e) { setFileProblem(e instanceof Error ? e.message : "That file could not be added."); }
    finally { setFiling(false); }
  };
  const remove = async (): Promise<void> => {
    const out = await action.run("contacts.suppression.remove", { suppressionId: removing, note: reason.trim() }, "Removed from the do-not-contact list");
    if (out !== undefined) { setRemoving(""); setReason(""); }
  };
  return (
    <View testID="console-dnc">
      <Section title="Do-not-contact list" count={list.rows.length} right={<Actions><Button label="Add from a file" testID="dnc-file-open" disabled={filing} onPress={() => void choose()} /><Button label="Add" testID="dnc-add-open" onPress={() => { setAdding(!adding); setProblem(""); }} /></Actions>}>
        <Field label="Search the list" testID="dnc-search" value={query} onChange={setQuery} />
        {adding ? (
          <View testID="dnc-add-form">
            <Field label="Emails or phone numbers" testID="dnc-add-text" multiline value={text} onChange={setText} />
            <Segmented options={ADD_REASONS.map((r) => ({ key: r.key, title: r.title }))} value={why} onChange={(k) => setWhy(k as Reason)} />
            {problem ? <Note>{problem}</Note> : null}
            <Actions><Button label="Cancel" testID="dnc-add-cancel" onPress={() => setAdding(false)} /><Button label="Add" testID="dnc-add-save" disabled={action.busy} onPress={() => void add()} /></Actions>
          </View>
        ) : null}
        {fileProblem ? <Note>{fileProblem}</Note> : null}
        {filed ? <Note>{filed}</Note> : null}
        {chosen && file ? (
          <View testID="dnc-file-form">
            <Note>{chosen.name}: {describeFile(file)} The first column is read. Rows with a reason column keep it; the others are added as:</Note>
            <Segmented options={ADD_REASONS.map((r) => ({ key: r.key, title: r.title }))} value={why} onChange={(k) => setWhy(k as Reason)} />
            <Actions><Button label="Cancel" testID="dnc-file-cancel" disabled={filing} onPress={() => setChosen(null)} /><Button label={addLabel(file.total)} testID="dnc-file-confirm" disabled={filing || action.busy} onPress={() => void addFile()} /></Actions>
          </View>
        ) : null}
        {!list.ready ? <ReadState error={list.error} retry={list.refresh} /> : (
          <Group testID="dnc-list">
            {list.rows.map((e) => (
              <Row key={e.id} id={`dnc-${e.id}`} title={e.address} note={`${CHANNEL_LABEL[e.channel]} · ${REASON_LABEL[e.reason]} · Added by ${data.name(e.addedBy)} · ${new Date(e.addedAt).toLocaleDateString()}`}
                trailing={<Button label="Remove…" testID={`dnc-remove-${e.id}`} onPress={() => { setRemoving(e.id); setReason(""); }} />} />
            ))}
            {!list.rows.length ? <Empty icon="x" testID="dnc-empty">Nobody is on the list</Empty> : null}
          </Group>
        )}
        {list.pagination.next ? <Button label="Load more" testID="dnc-more" disabled={list.pagination.busy} onPress={list.pagination.onMore} /> : null}
        {removing ? (
          <View testID="dnc-remove-form">
            <Note>Remove {list.rows.find((e) => e.id === removing)?.address ?? "this person"}? They can be contacted again. Say why.</Note>
            <Field label="Reason for removing" testID="dnc-remove-reason" value={reason} onChange={setReason} />
            <Actions><Button label="Cancel" testID="dnc-remove-cancel" onPress={() => setRemoving("")} /><Button label="Remove" testID="dnc-remove-confirm" danger disabled={!reason.trim() || action.busy} why={!reason.trim() ? "Say why you are removing them" : undefined} onPress={() => void remove()} /></Actions>
          </View>
        ) : null}
        <Note>Automatic screening only adds people to this list. It never removes anyone. A person leaves the list only when they opt in again, or when an admin removes them with a reason.</Note>
        {action.note ? <Note>{action.note}</Note> : null}
      </Section>
    </View>
  );
}
