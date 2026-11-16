// The columns of a board (a stage field with many stages): a sheet with the stages the board shows, in order (drag a row, or press its arrows), and under them the stages it leaves out, each a
// press to add. Nothing chosen draws every stage. The choice is the board's; it is saved with the view.
import { useRef } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Glyph } from "../sidebar/parts.tsx";
import { optionsOf } from "../table/model.ts";
import { each, moveStageKey, toggleStage } from "./model.ts";
import type { FieldDef } from "./model.ts";

/** A box that is ticked while the stage is shown. */
function Tick({ on }: { on: boolean }): ReactElement {
  return <View style={[k.box, on && k.boxOn]}>{on ? <Glyph name="check" size={11} color="var(--win)" /> : null}</View>;
}

function Arrow({
  dir,
  label,
  off,
  onPress,
  testID,
}: {
  dir: "asc" | "desc";
  label: string;
  off: boolean;
  onPress: () => void;
  testID: string;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      testID={testID}
      onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [k.arrow, hovered === true && !off && k.arrowOver, off && k.off]}
    >
      <Glyph name={dir} size={13} color="var(--ink-2)" />
    </Pressable>
  );
}

export function ColumnsSheet({
  field,
  chosen,
  onChange,
  onClose,
}: {
  field: FieldDef;
  chosen: readonly string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}): ReactElement {
  const all = optionsOf(field);
  const title = (key: string): string => all.find((o) => o.key === key)?.title ?? key;
  const left = all.filter((o) => !chosen.includes(o.key));
  const drag = useRef<string | null>(null);
  // a row dropped on another takes that row's place
  const dropOn = (to: string): void => {
    const from = drag.current;
    drag.current = null;
    if (!from || from === to) return;
    const next = chosen.filter((x) => x !== from);
    next.splice(chosen.indexOf(to), 0, from);
    onChange(next);
  };
  return (
    <Dialog
      title="Columns"
      onClose={onClose}
      size="s"
      fill
      testID="board-columns"
      {...(chosen.length === 0 ? { note: "No stage chosen: the board shows every stage." } : {})}
      actions={[
        ...(chosen.length > 0
          ? [{ label: "Show every stage", onPress: () => onChange([]), testID: "board-columns-all" }]
          : []),
        { label: "Done", primary: true, onPress: onClose, testID: "board-columns-done" },
      ]}
    >
      <ScrollView style={k.list} testID="board-columns-list">
        {chosen.length > 0 ? <Text style={k.head}>Shown, in this order</Text> : null}
        {each(chosen, (key, i) => (
          <Row
            key={key}
            id={`col:${key}`}
            title={title(key)}
            leading={<Tick on />}
            onPress={() => onChange(toggleStage(chosen, key))}
            domProps={{
              draggable: true,
              onDragStart: () => {
                drag.current = key;
              },
              onDragOver: (e: { preventDefault(): void }) => e.preventDefault(),
              onDrop: (e: { preventDefault(): void }) => {
                e.preventDefault();
                dropOn(key);
              },
            }}
            trailing={
              <View style={k.arrows}>
                <Arrow
                  dir="asc"
                  label={`Move ${title(key)} earlier`}
                  off={i === 0}
                  testID={`col-up-${key}`}
                  onPress={() => onChange(moveStageKey(chosen, key, -1))}
                />
                <Arrow
                  dir="desc"
                  label={`Move ${title(key)} later`}
                  off={i === chosen.length - 1}
                  testID={`col-down-${key}`}
                  onPress={() => onChange(moveStageKey(chosen, key, 1))}
                />
              </View>
            }
          />
        ))}
        {left.length > 0 ? <Text style={k.head}>{chosen.length > 0 ? "Not shown" : "Stages"}</Text> : null}
        {each(left, (o) => (
          <Row
            key={o.key}
            id={`col:${o.key}`}
            title={o.title}
            leading={<Tick on={false} />}
            onPress={() => onChange(toggleStage(chosen, o.key))}
          />
        ))}
      </ScrollView>
    </Dialog>
  );
}

const k = StyleSheet.create({
  list: { maxHeight: 420 },
  head: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingVertical: 8 },
  box: {
    marginRight: 6,
    width: 16,
    height: 16,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "var(--ink-4)" as string,
  },
  boxOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  arrows: { flexDirection: "row", gap: 2 },
  arrow: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  arrowOver: { backgroundColor: "var(--hover)" as string },
  off: { opacity: 0.35 },
});
