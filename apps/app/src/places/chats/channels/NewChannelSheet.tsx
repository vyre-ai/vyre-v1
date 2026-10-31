// The New channel sheet: a name with its live #slug, an optional topic, Public or Invite only, one picker for people and agents, an optional project. Enter creates, Esc closes. A taken name
// or a refused create shows under the field it belongs to. On a phone the sheet fills the window (ui/Dialog fill).
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { PeoplePicker } from "../../../../../../ui/src/PeoplePicker/index.tsx";
import type { PickEntry } from "../../../../../../ui/src/PeoplePicker/index.tsx";
import { Segmented } from "../../../../../../ui/src/Segmented/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Glyph } from "../sidebar/parts.tsx";
import { MAX_NAME, canCreate, createInput, createKey, nameProblem, sheetError, slugOf } from "./model.ts";
import type { CreateIn, FormState, ProjectRow, SheetError, Visibility } from "./model.ts";

export interface NewChannelSheetProps {
  people: readonly PickEntry[];
  agents: readonly PickEntry[];
  projects: readonly Pick<ProjectRow, "recordId" | "title">[];
  /** Slugs already in use. */
  taken: ReadonlySet<string>;
  /** Makes the channel; rejects with the Space's error. Resolves with the new channel's id. */
  create(input: CreateIn): Promise<string>;
  onCreated(channelId: string): void;
  onClose(): void;
  now?(): number;
}

const VISIBILITY = [
  { id: "public", label: "Public", hint: "Anyone in the Space can find it and join" },
  { id: "invite", label: "Invite only", hint: "Only the people you add can see it" },
] as const;

export function NewChannelSheet({ people, agents, projects, taken, create, onCreated, onClose, now = Date.now }: NewChannelSheetProps): ReactElement {
  const [form, setForm] = useState<FormState>({ name: "", topic: "", visibility: "public", picked: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SheetError | null>(null);
  const key = useRef<string | null>(null);
  const menu = useMenu();
  const slug = slugOf(form.name);
  const inline = nameProblem(form.name, taken) ?? (error?.field === "name" ? error.text : null);
  const ok = canCreate(form, taken) && !busy;
  const patch = (p: Partial<FormState>): void => { setForm((f) => ({ ...f, ...p })); if (error) setError(null); };
  const toggle = (id: string): void => { setForm((f) => ({ ...f, picked: f.picked.includes(id) ? f.picked.filter((x) => x !== id) : [...f.picked, id] })); if (error) setError(null); };
  const submit = (): void => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    // one key per sheet, so a retry after a dropped answer makes the same channel
    key.current ??= createKey(now(), Math.random());
    create(createInput(form, key.current)).then(
      (id) => { setBusy(false); onCreated(id); },
      (e: unknown) => { setBusy(false); setError(sheetError(e)); },
    );
  };
  const project = projects.find((p) => p.recordId === form.recordId);
  const projectMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = [{ label: "No project", checked: !form.recordId, onSelect: () => patch({ recordId: undefined }) }, { separator: true }];
    for (const p of projects) items.push({ label: p.title, checked: p.recordId === form.recordId, onSelect: () => patch({ recordId: p.recordId }) });
    menu.show(items, x, y, "other");
  };
  const entries: PickEntry[] = [...people, ...agents];
  return (
    <Dialog
      title="New channel" onClose={onClose} width={480} fill testID="new-channel-sheet"
      actions={[{ label: "Cancel", onPress: onClose, testID: "new-channel-cancel" }, { label: busy ? "Creating" : "Create", onPress: submit, primary: true, disabled: !ok, testID: "new-channel-create" }]}
    >
      <View style={s.field}>
        <TextField
          value={form.name} onChangeText={(v) => patch({ name: v })} placeholder="Channel name" accessibilityLabel="Channel name" testID="new-channel-name" maxLength={MAX_NAME}
          autoCapitalize="none" autoCorrect={false} onSubmitEditing={submit} style={inline ? s.bad : null}
        />
        <Text testID="new-channel-slug" style={[s.slug, slug === "" && s.slugEmpty, inline ? s.slugBad : null]} numberOfLines={1}>{inline ?? `#${slug === "" ? "name" : slug}`}</Text>
      </View>
      <TextField value={form.topic} onChangeText={(v) => patch({ topic: v })} placeholder="Topic (optional)" accessibilityLabel="Topic" testID="new-channel-topic" maxLength={250} onSubmitEditing={submit} />
      <Segmented label="Who can join" options={VISIBILITY} value={form.visibility} onChange={(v: Visibility) => patch({ visibility: v })} testID="new-channel-visibility" />
      <PeoplePicker entries={entries} selected={form.picked} onToggle={toggle} placeholder="Add people and agents" testID="new-channel-people" />
      {projects.length ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel={project ? `Project: ${project.title}` : "Link a project"} testID="new-channel-project"
          onPress={(e) => {
            const ev = e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
            const box = ev.currentTarget?.getBoundingClientRect?.();
            projectMenu(box ? box.left : ev.nativeEvent?.pageX ?? 0, box ? box.bottom + 4 : ev.nativeEvent?.pageY ?? 0);
          }}
          style={({ hovered }: { hovered?: boolean }) => [s.project, hovered === true && s.projectOver]}
        >
          <Glyph name="project" size={14} />
          <Text numberOfLines={1} style={[s.projectText, project ? s.projectOn : null]}>{project ? project.title : "Link a project (optional)"}</Text>
          <Glyph name="chev" size={11} color="var(--ink-4)" />
        </Pressable>
      ) : null}
      {error && error.field === "form" ? <Text testID="new-channel-error" accessibilityRole="alert" style={s.error}>{error.text}</Text> : null}
      {menu.element}
    </Dialog>
  );
}

const s = StyleSheet.create({
  field: { gap: 4 },
  bad: { borderColor: "var(--danger)" as string },
  slug: { fontSize: 12, color: "var(--accent)" as string, paddingHorizontal: 2 },
  slugEmpty: { color: "var(--ink-4)" as string },
  slugBad: { color: "var(--danger)" as string },
  project: { flexDirection: "row", alignItems: "center", gap: 8, height: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string },
  projectOver: { backgroundColor: "var(--hover)" as string },
  projectText: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink-3)" as string },
  projectOn: { color: "var(--ink)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
