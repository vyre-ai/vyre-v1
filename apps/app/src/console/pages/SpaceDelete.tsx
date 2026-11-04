// Console > Space > Transfer or delete. Make someone the Owner (a person picker, spaces.transfer_ownership: you become an Admin), and Delete this Space, which asks for an export first and the Space's name typed
// out before spaces.delete runs. A person who is not the Owner can only leave the Space.
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
        <Row id="transfer-row" title="Make someone the Owner" note="You become an Admin" leading={<Lead><Glyph name="people" size={16} color="var(--ink-3)" /></Lead>}
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

function Delete({ space }: { space: CapMap["spaces.get"]["out"]["space"] }): ReactElement {
  const data = useConsoleData();
  const [open, setOpen] = useState(false), [saved, setSaved] = useState(false), [typed, setTyped] = useState("");
  const action = useAction(() => undefined);
  const name = deleteName(space);
  const ready = saved && typed.trim() === name;
  return (
    <Section title="Delete this Space">
      <Group>
        <Row id="delete-row" title="Delete this Space" note="Removes it for everyone. Export it first." leading={<Lead><Glyph name="x" size={16} color="var(--ink-3)" /></Lead>}
          trailing={<Button label="Delete…" testID="delete-open" danger onPress={() => { setOpen(!open); setSaved(false); setTyped(""); }} />} />
      </Group>
      {open ? (
        <View testID="delete-flow">
          <Group>
            <Row id="delete-export" title="Export everything first" note="Download the zip from Data, Export and keep it" trailing={<Button label="Open Export" testID="delete-export-open" onPress={() => data.nav.openPage("export")} />} />
            <Row id="delete-saved" title="I saved the export" note={saved ? "Saved" : "Needed before you can delete"} trailing={<Button label={saved ? "Undo" : "I saved it"} testID="delete-saved-toggle" onPress={() => setSaved(!saved)} />} />
          </Group>
          <Field label={`Type ${name} to confirm`} testID="delete-name" value={typed} onChange={setTyped} />
          <Note>Everyone loses access. The Space, its records and its files are removed from this server.</Note>
          <Actions>
            <Button label="Cancel" testID="delete-cancel" onPress={() => setOpen(false)} />
            <Button label="Delete this Space" testID="delete-confirm" danger disabled={!ready || action.busy} why={!saved ? "Export the Space and confirm you saved it" : !ready ? "Type the Space's name exactly" : undefined}
              onPress={() => void action.run("spaces.delete", { confirmName: typed.trim() }, "The Space is deleted.")} />
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
      {owner ? <><Transfer onDone={space.refresh} /><Delete space={space.data.space} /></> : <Leave />}
    </View>
  );
}
