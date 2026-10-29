import { useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";
import { Tick } from "./ai-controls.tsx";

type Finding = CapMap["governance.erase.find"]["out"];
type EraseKind = Finding["groups"][number]["kind"];
type EraseHistory = CapMap["governance.erase.list"]["out"]["erasures"][number];
export const eraseFindingExpired = (expiresAt: number, now = Date.now()): boolean => now >= expiresAt;
export function mergeEraseHistory(first: readonly EraseHistory[], second: readonly EraseHistory[]): EraseHistory[] {
  const rows = new Map(first.map((item) => [item.findingId, item]));
  for (const item of second) rows.set(item.findingId, item);
  return [...rows.values()];
}

export function ErasePerson(): ReactElement {
  const data = useConsoleData();
  const history = useRead<CapMap["governance.erase.list"]["out"]>("governance.erase.list", { limit: 100 });
  const me = useRead<CapMap["access.principals.get"]["out"]>("access.principals.get", { principal: { kind: "person", id: data.me.id } });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [finding, setFinding] = useState<Finding | null>(null);
  const [include, setInclude] = useState<ReadonlySet<EraseKind>>(new Set());
  const [overrideReason, setOverrideReason] = useState("");
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState<CapMap["governance.erase.apply"]["in"] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [moreHistory, setMoreHistory] = useState<EraseHistory[]>([]);
  const [historyPage, setHistoryPage] = useState<{ loaded: boolean; next?: string; busy: boolean }>({ loaded: false, busy: false });
  const refresh = (): void => { history.refresh(); me.refresh(); };
  const action = useAction(refresh);
  if (!history.data || !me.data) return <ReadState error={history.error ?? me.error} retry={refresh} />;
  const owner = me.data.principal.roles.includes("rol_owner");
  const erasures = mergeEraseHistory(history.data.erasures, moreHistory);
  const historyNext = historyPage.loaded ? historyPage.next : history.data.next;
  const subject = { ...(name.trim() ? { name: name.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) };
  const onEdit = (): void => { setFinding(null); setReviewed(null); setRunId(null); setError(""); };
  const find = (): void => {
    if (!Object.keys(subject).length) return;
    void action.run<Finding>("governance.erase.find", { subject }, "Erase preview ready").then((out) => {
      if (!out) return;
      setFinding(out); setInclude(new Set(out.groups.filter((group) => group.count > 0).map((group) => group.kind))); setReviewed(null); setOverrideReason(""); setOwnerConfirmed(false); setRunId(null);
    });
  };
  const review = (): void => {
    if (!finding) return;
    if (eraseFindingExpired(finding.expiresAt)) { setError("This preview expired. Find the person again before erasing."); return; }
    if (include.size === 0) { setError("Choose at least one data kind to erase."); return; }
    const held = finding.groups.some((group) => include.has(group.kind) && group.onHold > 0);
    if (held && (!owner || !ownerConfirmed || !overrideReason.trim())) { setError("Held data requires the Space owner’s confirmation and a reason."); return; }
    setReviewed({ findingId: finding.findingId, include: [...include], ...(held ? { overrideHold: { reason: overrideReason.trim() } } : {}), idempotencyKey: attempt() }); setError("");
  };
  return <>
    <Section title="Find a person"><Group>
      <Field label="Name" value={name} onChange={(value) => { setName(value); onEdit(); }} /><Field label="Email" value={email} onChange={(value) => { setEmail(value); onEdit(); }} /><Field label="Phone" value={phone} onChange={(value) => { setPhone(value); onEdit(); }} />
      <Button label="Find data" disabled={action.busy || !Object.keys(subject).length} onPress={find} />
    </Group></Section>
    {finding ? <Section title="Erase preview"><Group>
      <Row title="Preview expires" note={new Date(finding.expiresAt).toLocaleString()} />
      {/* ui-rows-lint: not a list (selectable erase-kind fieldsets containing Row samples) */}
      {finding.groups.map((group) => <Group key={group.kind}><Tick label={`Erase ${group.kind} · ${group.count}${group.onHold ? ` · ${group.onHold} on hold` : ""}`} checked={include.has(group.kind)} onChange={() => { setInclude((current) => { const next = new Set(current); if (next.has(group.kind)) next.delete(group.kind); else next.add(group.kind); return next; }); setReviewed(null); setOwnerConfirmed(false); }} />{group.samples.map((sample) => <Row key={`${group.kind}:${sample.id}`} title={sample.title} note={sample.type} />)}</Group>)}
      {finding.groups.some((group) => include.has(group.kind) && group.onHold > 0) ? <><Note>Selected data is on hold. Only the Space owner can override it.</Note><Field label="Hold override reason" value={overrideReason} onChange={(value) => { setOverrideReason(value); setReviewed(null); setOwnerConfirmed(false); }} multiline /><Button label={ownerConfirmed ? "✓ Owner confirms hold override" : "Owner confirmation required"} disabled={!owner} onPress={() => { setOwnerConfirmed((value) => !value); setReviewed(null); }} /></> : null}
      {error ? <Note>{error}</Note> : null}
      {reviewed ? <><Note>This permanently erases {reviewed.include.join(", ")}. Tombstones will prevent restore from bringing the data back.</Note><Actions><Button label="Back" onPress={() => setReviewed(null)} /><Button label="Start erasure" danger disabled={action.busy} onPress={() => void action.run<CapMap["governance.erase.apply"]["out"]>("governance.erase.apply", reviewed, (out) => { setRunId(out.runId); return `Erasure run ${out.runId} started`; }).then((out) => { if (out) setReviewed(null); })} /></Actions></> : <Button label="Review erasure" danger disabled={action.busy} onPress={review} />}
    </Group></Section> : null}
    {runId ? <EraseRun runId={runId} /> : null}
    <Section title="Past erasures" count={erasures.length}><Group>{erasures.length ? erasures.map((row) => <Row key={row.findingId} title={row.kinds.join(", ")} note={`${new Date(row.at).toLocaleString()} · ${data.name(row.by)} · ${row.tombstones} tombstones`} />) : <Note>No erasures yet.</Note>}{historyNext ? <Button label={historyPage.busy ? "Loading erasures…" : "Load more erasures"} disabled={historyPage.busy} onPress={() => { if (historyPage.busy) return; setHistoryPage((current) => ({ ...current, busy: true })); void data.call("governance.erase.list", { cursor: historyNext, limit: 100 }).then((out) => { const page = out as CapMap["governance.erase.list"]["out"]; setMoreHistory((current) => mergeEraseHistory(current, page.erasures)); setHistoryPage({ loaded: true, ...(page.next ? { next: page.next } : {}), busy: false }); }, () => setHistoryPage((current) => ({ ...current, busy: false }))); }} /> : null}</Group></Section>
    {action.note ? <Note>{action.note}</Note> : null}
  </>;
}

function EraseRun({ runId }: { runId: string }): ReactElement {
  const run = useRead<CapMap["runs.get"]["out"]>("runs.get", { runId });
  if (!run.data) return <ReadState error={run.error} retry={run.refresh} />;
  return <Section title="Erasure run"><Group><Row title="State" note={run.data.run.status} /><Row title="Started" note={new Date(run.data.run.startedAt).toLocaleString()} />{run.data.run.summary ? <Row title="Result" note={run.data.run.summary} /> : null}</Group></Section>;
}
