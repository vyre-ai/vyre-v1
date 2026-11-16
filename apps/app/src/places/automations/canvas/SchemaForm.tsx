// The Configure form for any step the catalog lists: one control for each property of its input schema (a text box, a number, a list, a choice, a yes or no, a person, or JSON for what has no
// simpler shape). Required ones come first and stay open; the rest sit under "More options" so a long schema does not bury the three things a step needs. Each control writes the step's input.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useOptionalAutomationsData } from "./data.tsx";
import { basicFieldEdit } from "../builder/marks.tsx";
import { presenceOf } from "../values/typed.ts";
import { Choice, TextBox, Hint } from "./fields.tsx";
import { controlText, writeControl } from "./form-model.ts";
import type { Control } from "./form-model.ts";
import { Glyph } from "./icons.tsx";
import { pointer } from "./parts.tsx";
import { THINGS, thingInput, useThingPicks, useWhoPicks } from "./steps/useLists.ts";
import type { OpenMenu } from "./steps/StepForms.tsx";

type Input = Record<string, unknown>;

function WhoField({
  control,
  value,
  onValue,
  openMenu,
}: {
  control: Control;
  value: unknown;
  onValue(next: unknown): void;
  openMenu: OpenMenu;
}): ReactElement {
  const who = useWhoPicks();
  const me = useOptionalAutomationsData()?.me ?? { id: "", name: "You" };
  const current = value && typeof value === "object" ? (value as { kind?: string; id?: string }) : null;
  const name = !current?.id
    ? "Nobody"
    : current.id === me.id
      ? `${me.name} (you)`
      : who.state === "ready"
        ? (who.items.find((p) => p.assignee.id === current.id)?.name ?? current.id)
        : current.id;
  return (
    <Choice
      label={control.label}
      value={name}
      testID={`field-${control.name}`}
      onOpen={(x, y) => {
        const entries: MenuEntry[] = [
          { label: "Nobody", checked: !current?.id, onSelect: () => onValue(undefined) },
          { separator: true },
        ];
        if (me.id)
          entries.push({
            label: `${me.name} (you)`,
            checked: current?.id === me.id,
            onSelect: () => onValue({ kind: "person", id: me.id }),
          });
        if (who.state === "ready")
          for (const p of who.items)
            if (p.assignee.id !== me.id)
              entries.push({
                label: p.name,
                checked: current?.id === p.assignee.id,
                onSelect: () => onValue(p.assignee),
              });
        openMenu(entries, x, y, "other", undefined, entries.length > 8 ? { search: "Search people" } : {});
      }}
    />
  );
}

import { ConditionField, EventField } from "./ConditionField.tsx";

/** A field that holds the id of a thing: the person picks it by name from what they may use, and the name shows once chosen. The id is never shown. */
function ThingField({
  control,
  value,
  onValue,
  openMenu,
  step,
}: {
  control: Control;
  value: unknown;
  onValue(next: unknown): void;
  openMenu: OpenMenu;
  /** The step's own settings: a record is listed once its type is named. */
  step: Input;
}): ReactElement {
  const prefix = control.ref ?? "";
  const picks = useThingPicks(prefix, step);
  const waiting = THINGS[prefix]?.needs !== undefined && thingInput(THINGS[prefix]!, step) === null;
  const word = THINGS[prefix]?.word ?? "one";
  const held = typeof value === "string" ? value : "";
  const hit = picks.state === "ready" ? picks.items.find((p) => p.value === held) : undefined;
  const shown =
    held === ""
      ? ""
      : hit
        ? hit.label
        : /\{\{/.test(held)
          ? "From earlier data"
          : picks.state === "ready"
            ? "Not available to you"
            : "";
  return (
    <Choice
      label={control.label}
      value={shown === "" ? `Choose a ${word}` : shown}
      testID={`field-${control.name}`}
      onOpen={(x, y) => {
        const entries: MenuEntry[] = [];
        if (picks.state === "ready")
          for (const p of picks.items)
            entries.push({ label: p.label, checked: held === p.value, onSelect: () => onValue(p.value) });
        if (entries.length === 0)
          entries.push({
            label: waiting
              ? "Choose the record type first"
              : picks.state === "loading"
                ? "Loading"
                : `No ${word} to choose`,
            disabled: true,
          });
        else if (!control.required && held !== "")
          entries.push({ separator: true }, { label: "None", onSelect: () => onValue(undefined), keep: true });
        // a long list is searched by typing, the way every picker in the app is
        openMenu(entries, x, y, "other", undefined, entries.length > 6 ? { search: `Search ${word}s` } : {});
      }}
    />
  );
}

function One({
  control,
  input,
  onInput,
  openMenu,
}: {
  control: Control;
  input: Input;
  onInput(next: Input): void;
  openMenu: OpenMenu;
}): ReactElement {
  const [problem, setProblem] = useState<string | null>(null);
  const has = Object.prototype.hasOwnProperty.call(input, control.name);
  const current = input[control.name];
  const label = control.label;
  const write = (text: string): void => {
    const out = writeControl(input, control, text);
    if ("problem" in out) {
      setProblem(out.problem);
      return;
    }
    setProblem(null);
    onInput(out.input);
  };
  const id = `field-${control.name}`;
  // a condition is rows, never a text box; what a Wait waits for is an event picked in words (AUTOMATIONS-BUILD-RC29 round five)
  if (control.name === "condition" || (control.name === "when" && control.kind === "text"))
    return (
      <ConditionField
        label={control.label}
        value={controlText(control, current)}
        openMenu={openMenu}
        testID={id}
        onCommit={(t) => onInput(basicFieldEdit(input, control.name, t))}
      />
    );
  if (control.name === "event" && control.kind === "json")
    return (
      <EventField
        value={current}
        openMenu={openMenu}
        testID={id}
        onCommit={(next) => onInput({ ...input, event: next })}
      />
    );
  const note = problem ? (
    <Hint danger testID={`${id}-problem`}>
      {problem}
    </Hint>
  ) : control.hint && control.kind !== "text" && control.kind !== "multiline" ? (
    <Hint>{control.hint}</Hint>
  ) : null;
  if (control.ref && THINGS[control.ref] && control.kind === "text") {
    return (
      <>
        <ThingField
          control={{ ...control, label }}
          value={current}
          step={input}
          openMenu={openMenu}
          onValue={(next) => {
            const copy = { ...input };
            if (next === undefined) delete copy[control.name];
            else copy[control.name] = next;
            onInput(copy);
          }}
        />
        {note}
      </>
    );
  }
  if (control.kind === "who") {
    return (
      <>
        <WhoField
          control={{ ...control, label }}
          value={current}
          openMenu={openMenu}
          onValue={(next) => {
            const copy = { ...input };
            if (next === undefined) delete copy[control.name];
            else copy[control.name] = next;
            onInput(copy);
          }}
        />
        {note}
      </>
    );
  }
  if (control.kind === "choice" || control.kind === "toggle") {
    const options = control.kind === "toggle" ? ["yes", "no"] : control.options;
    const shown =
      control.kind === "toggle"
        ? current === true
          ? "yes"
          : current === false
            ? "no"
            : "Not set"
        : typeof current === "string" && current !== ""
          ? current
          : "Choose";
    return (
      <>
        <Choice
          label={label}
          value={shown}
          testID={id}
          onOpen={(x, y) =>
            openMenu(
              [
                ...(control.required
                  ? []
                  : [{ label: "Not set", checked: current === undefined, onSelect: () => write("") }]),
                ...options.map((o) => ({
                  label: o,
                  checked: control.kind === "toggle" ? current === (o === "yes") : current === o,
                  onSelect: () => write(control.kind === "toggle" ? String(o === "yes") : o),
                })),
              ],
              x,
              y,
              "other",
            )
          }
        />
        {note}
      </>
    );
  }
  if (control.kind === "text" || control.kind === "multiline") {
    const presence = presenceOf(has, current);
    return (
      <>
        <TextBox
          chips
          label={`${label}${presence === "null" || presence === "empty" ? ` (${presence})` : ""}`}
          value={controlText(control, current)}
          testID={id}
          placeholder={control.placeholder}
          {...(control.kind === "multiline" ? { rows: 4 } : {})}
          onCommit={(t) => onInput(basicFieldEdit(input, control.name, t))}
        />
        {note}
      </>
    );
  }
  return (
    <>
      <TextBox
        label={label}
        value={controlText(control, current)}
        testID={id}
        mono={control.kind === "json"}
        invalid={problem !== null}
        placeholder={control.placeholder}
        {...(control.kind === "list" ? { rows: 3 } : control.kind === "json" ? { rows: 4 } : {})}
        onCommit={write}
      />
      {note}
    </>
  );
}

/** The controls for a step. `skip` leaves out the ones another part of the panel owns (the Account row, the message composer). */
export function SchemaForm({
  controls,
  input,
  onInput,
  openMenu,
  skip,
  idPrefix = "step",
}: {
  controls: readonly Control[];
  input: Input;
  onInput(next: Input): void;
  openMenu: OpenMenu;
  skip?(c: Control): boolean;
  idPrefix?: string;
}): ReactElement | null {
  const shown = controls.filter((c) => !skip?.(c));
  if (shown.length === 0) return null;
  return (
    <View style={s.wrap} testID={`${idPrefix}-form`}>
      {/* ui-rows-lint: not a list (form fields, one control each) */}
      {shown.map((c) => (
        <One key={c.name} control={c} input={input} onInput={onInput} openMenu={openMenu} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12 },
});
