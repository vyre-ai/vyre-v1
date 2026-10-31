// The Configure form for any step the catalog lists: one control for each property of its input schema (a text box, a number, a list, a choice, a yes or no, a person, or JSON for what has no
// simpler shape). Required ones come first and stay open; the rest sit under "More options" so a long schema does not bury the three things a step needs. Each control writes the step's input.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useOptionalAutomationsData } from "./data.tsx";
import { basicFieldEdit } from "../builder/marks.tsx";
import { presenceOf } from "../values/typed.ts";
import { Choice, Field, Hint } from "./fields.tsx";
import { controlText, writeControl } from "./form-model.ts";
import type { Control } from "./form-model.ts";
import { Glyph } from "./icons.tsx";
import { pointer } from "./parts.tsx";
import { useWhoPicks } from "./steps/useLists.ts";
import type { OpenMenu } from "./steps/StepForms.tsx";

type Input = Record<string, unknown>;

function WhoField({ control, value, onValue, openMenu }: { control: Control; value: unknown; onValue(next: unknown): void; openMenu: OpenMenu }): ReactElement {
  const who = useWhoPicks();
  const me = useOptionalAutomationsData()?.me ?? { id: "", name: "You" };
  const current = value && typeof value === "object" ? value as { kind?: string; id?: string } : null;
  const name = !current?.id ? "Nobody" : current.id === me.id ? `${me.name} (you)` : who.state === "ready" ? (who.items.find((p) => p.assignee.id === current.id)?.name ?? current.id) : current.id;
  return (
    <Choice
      label={control.label} value={name} testID={`field-${control.name}`}
      onOpen={(x, y) => {
        const entries: MenuEntry[] = [{ label: "Nobody", checked: !current?.id, onSelect: () => onValue(undefined) }, { separator: true }];
        if (me.id) entries.push({ label: `${me.name} (you)`, checked: current?.id === me.id, onSelect: () => onValue({ kind: "person", id: me.id }) });
        if (who.state === "ready") for (const p of who.items) if (p.assignee.id !== me.id) entries.push({ label: p.name, checked: current?.id === p.assignee.id, onSelect: () => onValue(p.assignee) });
        openMenu(entries, x, y, "other");
      }}
    />
  );
}

function One({ control, input, onInput, openMenu }: { control: Control; input: Input; onInput(next: Input): void; openMenu: OpenMenu }): ReactElement {
  const [problem, setProblem] = useState<string | null>(null);
  const has = Object.prototype.hasOwnProperty.call(input, control.name);
  const current = input[control.name];
  const label = control.required ? `${control.label} (required)` : control.label;
  const write = (text: string): void => {
    const out = writeControl(input, control, text);
    if ("problem" in out) { setProblem(out.problem); return; }
    setProblem(null);
    onInput(out.input);
  };
  const id = `field-${control.name}`;
  const note = problem ? <Hint danger testID={`${id}-problem`}>{problem}</Hint> : control.hint ? <Hint>{control.hint}</Hint> : null;
  if (control.kind === "who") {
    return <><WhoField control={{ ...control, label }} value={current} openMenu={openMenu} onValue={(next) => { const copy = { ...input }; if (next === undefined) delete copy[control.name]; else copy[control.name] = next; onInput(copy); }} />{note}</>;
  }
  if (control.kind === "choice" || control.kind === "toggle") {
    const options = control.kind === "toggle" ? ["yes", "no"] : control.options;
    const shown = control.kind === "toggle" ? (current === true ? "yes" : current === false ? "no" : "Not set") : typeof current === "string" && current !== "" ? current : "Choose";
    return (
      <>
        <Choice
          label={label} value={shown} testID={id}
          onOpen={(x, y) => openMenu([
            ...(control.required ? [] : [{ label: "Not set", checked: current === undefined, onSelect: () => write("") }]),
            ...options.map((o) => ({ label: o, checked: control.kind === "toggle" ? current === (o === "yes") : current === o, onSelect: () => write(control.kind === "toggle" ? String(o === "yes") : o) })),
          ], x, y, "other")}
        />
        {note}
      </>
    );
  }
  if (control.kind === "text" || control.kind === "multiline") {
    const presence = presenceOf(has, current);
    return (
      <>
        <Field
          label={`${label}${presence === "null" || presence === "empty" ? ` (${presence})` : ""}`} value={controlText(control, current)} testID={id} placeholder={control.placeholder || (control.required ? "Required" : "Optional")}
          {...(control.kind === "multiline" ? { rows: 4 } : {})}
          onCommit={(t) => onInput(basicFieldEdit(input, control.name, t))}
        />
        {note}
      </>
    );
  }
  return (
    <>
      <Field
        label={label} value={controlText(control, current)} testID={id} mono={control.kind === "json"} invalid={problem !== null}
        placeholder={control.placeholder || (control.required ? "Required" : "Optional")}
        {...(control.kind === "list" ? { rows: 3 } : control.kind === "json" ? { rows: 4 } : {})}
        onCommit={write}
      />
      {note}
    </>
  );
}

/** The controls for a step. `skip` leaves out the ones another part of the panel owns (the Account row, the message composer). */
export function SchemaForm({ controls, input, onInput, openMenu, skip, idPrefix = "step" }: {
  controls: readonly Control[]; input: Input; onInput(next: Input): void; openMenu: OpenMenu; skip?(c: Control): boolean; idPrefix?: string;
}): ReactElement | null {
  const [more, setMore] = useState(false);
  const shown = controls.filter((c) => !(skip?.(c)));
  // a field that already holds a value stays in view, so nothing a person set is hidden behind the disclosure
  const open = shown.filter((c) => c.required || Object.prototype.hasOwnProperty.call(input, c.name));
  const rest = shown.filter((c) => !open.includes(c));
  if (shown.length === 0) return null;
  return (
    <View style={s.wrap} testID={`${idPrefix}-form`}>
      {/* ui-rows-lint: not a list (form fields, one control each) */}
      {open.map((c) => <One key={c.name} control={c} input={input} onInput={onInput} openMenu={openMenu} />)}
      {rest.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: more }} accessibilityLabel={more ? "Hide more options" : `More options, ${rest.length}`} testID={`${idPrefix}-more`} onPress={() => setMore(!more)} style={[s.more, pointer]}>
          <Glyph name={more ? "chevD" : "chevR"} size={12} color="var(--ink-3)" />
          <Text style={s.moreText}>{more ? "Fewer options" : `More options (${rest.length})`}</Text>
        </Pressable>
      ) : null}
      {/* ui-rows-lint: not a list (form fields, one control each) */}
      {more ? rest.map((c) => <One key={c.name} control={c} input={input} onInput={onInput} openMenu={openMenu} />) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12 },
  more: { flexDirection: "row", alignItems: "center", gap: 6, height: 26 },
  moreText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
