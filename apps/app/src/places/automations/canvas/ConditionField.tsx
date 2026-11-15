// Conditions as real controls (AUTOMATIONS-BUILD-RC29 round five, item 3): a path's "if", the If step, and what a Wait waits for. Rows of a field (from Insert data), an operator in words and a value with chips, joined by "and" or "or";
// a condition the rows cannot write back exactly is one read-only line, "Advanced condition". Nothing here is a JSON box.
import { useContext } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { build, OP_WORDS, OPS, parse } from "./conditions.ts";
import type { Clause, Op, Parsed } from "./conditions.ts";
import { Choice, DataWordsContext, TextBox } from "./fields.tsx";
import { chipLabel, joinTemplate, splitTemplate } from "./steps/edits.ts";
import { pointer } from "./parts.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";

type OpenMenu = (entries: MenuEntry[], x: number, y: number, source: "other") => void;

const refOf = (put: string): string | null => {
  const seg = splitTemplate(put).find((x) => x.kind === "chip");
  return seg && seg.kind === "chip" ? seg.ref : null;
};

export function ConditionField({
  label,
  value,
  onCommit,
  openMenu,
  testID,
}: {
  label: string;
  value: string;
  onCommit(next: string): void;
  openMenu: OpenMenu;
  testID?: string;
}): ReactElement {
  const words = useContext(DataWordsContext);
  const parsed = parse(value);
  if (parsed === null)
    return (
      <View style={s.wrap} testID={testID}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.advanced} testID={testID ? `${testID}-advanced` : undefined}>{`Advanced condition: ${value}`}</Text>
      </View>
    );
  const write = (next: Parsed): void => onCommit(build(next));
  const setClause = (i: number, c: Clause): void => write({ ...parsed, clauses: parsed.clauses.map((x, at) => (at === i ? c : x)) });
  const titleOf = words?.titleOf ?? ((id: string) => id);
  const rows = parsed.clauses.length === 0 ? [{ left: "", op: "==" as Op, value: "" }] : parsed.clauses;
  return (
    <View style={s.wrap} testID={testID}>
      <Text style={s.label}>{label}</Text>
      {/* ui-rows-lint: not a list (the condition's rows: field, operator, value) */}
      {rows.map((c, i) => (
        <View key={i} style={s.row}>
          {i > 0 ? (
            <Choice
              label=""
              value={parsed.join === "&&" ? "and" : "or"}
              testID={testID ? `${testID}-join-${i}` : undefined}
              onOpen={(x, y) =>
                openMenu(
                  [
                    { label: "and", checked: parsed.join === "&&", onSelect: () => write({ ...parsed, join: "&&" }) },
                    { label: "or", checked: parsed.join === "||", onSelect: () => write({ ...parsed, join: "||" }) },
                  ],
                  x,
                  y,
                  "other",
                )
              }
            />
          ) : null}
          <Choice
            label={i === 0 ? "Field" : ""}
            value={c.left ? chipLabel(c.left, titleOf) : "Choose a field"}
            testID={testID ? `${testID}-field-${i}` : undefined}
            onOpen={(x, y) =>
              words?.insert?.(x, y, "", (put) => {
                const ref = refOf(put);
                if (ref) setClause(i, { ...c, left: ref });
              })
            }
          />
          <Choice
            label={i === 0 ? "Is" : ""}
            value={OP_WORDS[c.op]}
            testID={testID ? `${testID}-op-${i}` : undefined}
            onOpen={(x, y) =>
              openMenu(
                OPS.map((op) => ({ label: OP_WORDS[op], checked: op === c.op, onSelect: () => setClause(i, { ...c, op }) })),
                x,
                y,
                "other",
              )
            }
          />
          {c.op === "is empty" || c.op === "is not empty" ? null : (
            <TextBox
              chips
              label={i === 0 ? "Value" : ""}
              value={c.value}
              testID={testID ? `${testID}-value-${i}` : undefined}
              onCommit={(t) => setClause(i, { ...c, value: t })}
            />
          )}
        </View>
      ))}
      {rows[0]!.left !== "" ? (
        <Pressable
          accessibilityRole="button"
          testID={testID ? `${testID}-add` : undefined}
          onPress={() => write({ ...parsed, clauses: [...parsed.clauses, { left: "", op: "==", value: "" }] })}
          style={pointer}
        >
          <Text style={s.add}>Add a condition</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** What a Wait waits for: an event picked by name in words, then its conditions as field-is-value rows. Anything the rows cannot show stays whole. */
// the events an Automation commonly waits for (the full list is the server's; a name already in the step is always kept and shown)
const EVENT_NAMES: readonly string[] = [
  "record.updated",
  "task.completed",
  "email.received",
  "message.received",
  "calendar_event.updated",
  "journey.stage_entered",
  "approval.decided",
  "run.child_terminal",
];
export const eventWords = (name: string): string => {
  const w = name.replace(/[._]+/g, " ").trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

export function EventField({
  value,
  onCommit,
  openMenu,
  testID,
}: {
  value: unknown;
  onCommit(next: unknown): void;
  openMenu: OpenMenu;
  testID?: string;
}): ReactElement {
  const v = (typeof value === "object" && value !== null ? value : {}) as { event?: string; filter?: unknown };
  const flat =
    v.filter === undefined ||
    (typeof v.filter === "object" &&
      v.filter !== null &&
      !Array.isArray(v.filter) &&
      Object.values(v.filter as Record<string, unknown>).every((x) => typeof x === "string" || typeof x === "number"));
  return (
    <View style={s.wrap} testID={testID}>
      <Choice
        label="Wait for this to happen"
        value={v.event ? eventWords(v.event) : "Choose what to wait for"}
        testID={testID ? `${testID}-event` : undefined}
        onOpen={(x, y) =>
          openMenu(
            [...EVENT_NAMES, ...(v.event && !EVENT_NAMES.includes(v.event) ? [v.event] : [])].map((n) => ({ label: eventWords(n), checked: n === v.event, onSelect: () => onCommit({ ...v, event: n }) })),
            x,
            y,
            "other",
          )
        }
      />
      {flat ? (
        <ConditionField
          label="Only when"
          value={Object.entries((v.filter ?? {}) as Record<string, unknown>)
            .map(([k, x]) => `${k} == ${typeof x === "number" ? String(x) : `"${String(x).replace(/"/g, '\\"')}"`}`)
            .join(" && ")}
          openMenu={openMenu}
          onCommit={(t) => {
            const p = parse(t);
            const filter: Record<string, string | number> = {};
            for (const c of p?.clauses ?? []) if (c.op === "==") filter[c.left] = /^-?\d+(\.\d+)?$/.test(c.value) ? Number(c.value) : c.value;
            onCommit({ ...v, ...(Object.keys(filter).length > 0 ? { filter } : { filter: undefined }) });
          }}
          {...(testID ? { testID: `${testID}-when` } : {})}
        />
      ) : (
        <Text style={s.advanced}>Advanced condition: kept as it is</Text>
      )}
    </View>
  );
}
void joinTemplate;

const s = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12.5, color: "var(--ink-2)" as string },
  row: { gap: 6 },
  advanced: { fontSize: 13, color: "var(--ink-3)" as string, backgroundColor: "var(--sunk)" as string, padding: 8, borderRadius: 8 },
  add: { fontSize: 12.5, color: "var(--accent)" as string },
});
