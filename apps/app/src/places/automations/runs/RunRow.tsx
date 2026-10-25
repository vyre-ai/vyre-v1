// One run in a list (history and Failed runs): the shared Row with the status mark leading and, trailing, the Test and version badges and the time. Hovering or focusing the row swaps the
// time for Retry (a failed run nobody retried) and More. Right-click, Shift-F10 and the More button open the same menu. Click opens the run chat to the side; double click opens it in Main.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { pressPoint } from "./actions.tsx";
import { IconButton, StatusMark, TestBadge, webOnly } from "./parts.tsx";
import { isTest, metaLine, rowTime, runTitle } from "./model.ts";
import type { Run } from "./model.ts";

export interface RunRowProps {
  run: Run;
  now: number;
  selected?: boolean;
  /** A failed run nobody retried. */
  open?: boolean;
  /** The Automation's current version; a run on another one shows its own. */
  currentVersion?: number;
  /** Shows the Automation's name above the outcome (Failed runs lists runs of many Automations). */
  title?: string;
  rowKey: string;
  onOpen(run: Run): void;
  onOpenMain?(run: Run): void;
  onRetry(run: Run): void;
  onMenu(run: Run, x: number, y: number): void;
}

export function RunRow({ run, now, selected = false, open = false, currentVersion, title, rowKey, onOpen, onOpenMain, onRetry, onMenu }: RunRowProps): ReactElement {
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState(false);
  const lit = over || focus;
  const version = run.definitionVersion !== undefined && currentVersion !== undefined && run.definitionVersion !== currentVersion ? `v${run.definitionVersion}` : null;
  const trailing = (
    <View style={r.tr}>
      {isTest(run) ? <TestBadge /> : null}
      {version ? <Text style={r.ver}>{version}</Text> : null}
      {lit ? (
        <View style={r.acts}>
          {open ? <IconButton icon="retry" label="Retry" testID={`retry-${run.id}`} onPress={() => onRetry(run)} /> : null}
          <IconButton icon="more" label="More" testID={`more-${run.id}`} onPress={(e) => { const p = pressPoint(e); onMenu(run, p.x, p.y); }} />
        </View>
      ) : (
        <Text style={r.time}>{rowTime(run.startedAt, now)}</Text>
      )}
    </View>
  );
  return (
    <View
      {...menuTrigger((x, y) => onMenu(run, x, y))}
      {...webOnly({ dataSet: { row: rowKey }, onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false), onFocus: () => setFocus(true), onBlur: () => setFocus(false), onDoubleClick: () => onOpenMain?.(run) })}
    >
      <Row
        id={`run-${run.id}`} title={title ?? runTitle(run)} note={metaLine(run)} selected={selected} hovered={lit}
        onPress={() => onOpen(run)}
        leading={<StatusMark status={run.status} />}
        trailing={trailing}
      />
    </View>
  );
}

const r = StyleSheet.create({
  tr: { flexDirection: "row", alignItems: "center", gap: 8 },
  acts: { flexDirection: "row", alignItems: "center", gap: 2 },
  time: { fontSize: 12, color: "var(--ink-3)" as string, textAlign: "right" },
  ver: { fontSize: 11, color: "var(--ink-3)" as string, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
});
