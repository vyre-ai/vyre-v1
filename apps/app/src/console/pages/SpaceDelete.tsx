// Console > Space > Transfer or delete. Make someone the Owner (a person picker, spaces.transfer_ownership: you become an Admin), and Delete this Space, which asks for an export from the last 24 hours (or an explicit Delete without an export) and the Space's name typed
// out, then schedules the deletion 14 days out (spaces.delete); until the date a Cancel deletion button (spaces.delete_cancel) undoes it. A person who is not the Owner can only leave the Space.
import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Lead, Section } from "../shell/ui.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";

/** The name a person types to delete the Space: its legal name when it has one. */
export const deleteName = (space: { name: string; legalName?: string }): string => (space.legalName?.trim() ? space.legalName : space.name).trim();

function Transfer({ onDone }: { onDone: () => void }): ReactElement {
  const data = useConsoleData();
  const people = useRead<CapMap["access.principals.list"]["out"]>("access.principals.list", { kind: "person", status: "active", limit: 100 });
  const [open, setOpen] = useState(false), [to, setTo] = useState("");
  const action = useAction(onDone);
  const candidates = (people.data?.principals ?? []).filter((p) => p.id !== data.me.id);
  return (
    <Section title="Transfer ownership">
      <Group>
        <Row id="transfer-row" title="Hand over ownership" note="You become an Admin" leading={<Lead><Glyph name="people" size={16} color="var(--ink-3)" /></Lead>}
          trailing={<Button label="Choose a person" testID="transfer-choose" onPress={() => { setOpen(!open); setTo(""); }} />} />
        {open ? (people.data ? candidates.map((p) => (
          <Row key={p.id} id={`transfer-person-${p.id}`} title={p.name} {...(p.title ? { note: p.title } : {})} selected={to === p.id} onPress={() => setTo(p.id)} trailing={<Button label="Choose" testID={`transfer-pick-${p.id}`} onPress={() => setTo(p.id)} />} />
        )) : <ReadState error={people.error} retry={people.refresh} />) : null}
        {open && people.data && !candidates.length ? <Row title="Nobody else is in this Space yet" /> : null}
      </Group>
      {to ? (
        <>
          <Note>Make {data.name(to)} the Owner? You become an Admin and cannot undo this yourself.</Note>
          <Actions>
            <Button label="Cancel" testID="transfer-cancel" onPress={() => setTo("")} />
            <Button label="Make Owner" testID="transfer-confirm" danger disabled={action.busy} onPress={() => void action.run("spaces.transfer_ownership", { to }, `${data.name(to)} is the Owner now.`).then((out) => { if (out) setTo(""); })} />
          </Actions>
        </>
      ) : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </Section>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** A date in words, in UTC, the way the emails say it: 18 November 2026. */
export const deleteDate = (ms: number): string => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** An export counts for the delete check when it finished within this long (the server checks the same). */
export const EXPORT_FRESH_MS = 24 * 60 * 60 * 1000;

/** The Space is scheduled for deletion: the date, and one click to undo it. Any admin sees it, not only the Owner. */
function Scheduled({ at, onDone }: { at: number; onDone: () => void }): ReactElement {
  const action = useAction(() => undefined);
  return (
    <Section title="Delete this Space">
      <Group>
        <Row id="delete-scheduled" title={`Scheduled for deletion on ${deleteDate(at)}`} note="Everything is removed then" leading={<Lead><Glyph name="warn" size={16} color="var(--warn)" /></Lead>}
          trailing={<Button label="Cancel deletion" testID="deletion-cancel" disabled={action.busy} onPress={() => void action.run("spaces.delete_cancel", {}, "Deletion cancelled. The Space carries on.").then((out) => { if (out) onDone(); })} />} />
      </Group>
      {action.note ? <Note>{action.note}</Note> : null}
    </Section>
  );
}

function Delete({ space, onDone }: { space: CapMap["spaces.get"]["out"]["space"]; onDone: () => void }): ReactElement {
  const data = useConsoleData();
  const latest = useRead<CapMap["spaces.export_latest"]["out"]>("spaces.export_latest");
  const [open, setOpen] = useState(false), [skip, setSkip] = useState(false), [typed, setTyped] = useState("");
  const action = useAction(() => undefined);
  const name = deleteName(space);
  // scheduled: the date, and one click to undo it; everything keeps working until then
  if (space.deletionAt !== undefined) return <Scheduled at={space.deletionAt} onDone={onDone} />;
  const exported = latest.data?.at !== undefined && data.clock().now - latest.data.at <= EXPORT_FRESH_MS;
  const ready = (exported || skip) && typed.trim() === name;
  return (
    <Section title="Delete this Space">
      <Group>
        <Row id="delete-row" title="Delete this Space" note="Removes it for everyone after 14 days. You can cancel until then." leading={<Lead><Glyph name="x" size={16} color="var(--ink-3)" /></Lead>}
          trailing={<Button label="Delete…" testID="delete-open" danger onPress={() => { setOpen(!open); setSkip(false); setTyped(""); }} />} />
      </Group>
      {open ? (
        <View testID="delete-flow">
          <Group>
            {exported
              ? <Row id="delete-export" title="Export taken" note="From the last 24 hours" leading={<Lead><Glyph name="ok" size={16} color="var(--ok)" /></Lead>} />
              : <Row id="delete-export" title="Take an export first" note="A zip of everything, to keep" trailing={<Button label="Export…" testID="delete-export-run" disabled={action.busy} onPress={() => void action.run("spaces.export", {}, "Export taken. It is in Data, Export.").then((out) => { if (out) latest.refresh(); })} />} />}
            {exported ? null : <Row id="delete-skip" title="Delete without an export" note={skip ? "Nothing is kept once the date passes" : "Only if you do not need a copy"} trailing={<Button label={skip ? "Take an export instead" : "Delete without an export"} testID="delete-skip-toggle" onPress={() => setSkip(!skip)} />} />}
          </Group>
          <Field label={`Type ${name} to confirm`} testID="delete-name" value={typed} onChange={setTyped} />
          <Note>Deletion happens after 14 days and you can cancel until then. Everyone keeps working until the date.</Note>
          <Actions>
            <Button label="Cancel" testID="delete-cancel" onPress={() => setOpen(false)} />
            <Button label="Delete the Space" testID="delete-confirm" danger disabled={!ready || action.busy} why={!exported && !skip ? "Take an export first, or choose to delete without one" : typed.trim() !== name ? "Type the Space's name exactly" : undefined}
              onPress={() => void action.run("spaces.delete", { confirmName: typed.trim(), ...(!exported && skip ? { withoutExport: true } : {}) }, "Scheduled. Everything is removed in 14 days unless you cancel.").then((out) => { if (out) { setOpen(false); onDone(); } })} />
          </Actions>
        </View>
      ) : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </Section>
  );
}

function Leave(): ReactElement {
  const [open, setOpen] = useState(false);
  const action = useAction(() => undefined);
  return (
    <Section title="Leave this Space">
      <Group>
        <Row id="leave-row" title="Leave this Space" note="Your local copy is wiped and your access ends" trailing={<Button label="Leave…" testID="leave-open" danger onPress={() => setOpen(true)} />} />
      </Group>
      {open ? <><Note>Leave this Space? Your local copy is wiped and your access ends.</Note><Actions><Button label="Cancel" testID="leave-cancel" onPress={() => setOpen(false)} /><Button label="Leave" testID="leave-confirm" danger disabled={action.busy} onPress={() => void action.run("spaces.leave", { confirm: true }, "You left the Space.")} /></Actions></> : null}
      {action.note ? <Note>{action.note}</Note> : null}
    </Section>
  );
}

export function SpaceDeletePage(): ReactElement {
  const data = useConsoleData(), space = useRead<CapMap["spaces.get"]["out"]>("spaces.get");
  if (!space.data) return <ReadState error={space.error} retry={space.refresh} />;
  const owner = space.data.space.owner === data.me.id;
  return (
    <View testID="console-space-delete">
      {owner ? <><Transfer onDone={space.refresh} /><Delete space={space.data.space} onDone={space.refresh} /></> : <>{space.data.space.deletionAt !== undefined ? <Scheduled at={space.data.space.deletionAt} onDone={space.refresh} /> : null}<Leave /></>}
    </View>
  );
}
