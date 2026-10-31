// Delete a record type: the sheet asks schema.diff what it would remove and says it once, with the record count, before schema.apply.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { confirmLine, dropTypeOps } from "./model.ts";
import type { Call } from "./model.ts";
import { useSchemaChange } from "./useChange.ts";

export function TypeDelete({ call, type, title, onClose, onDone }: { call: Call; type: string; title: string; onClose(): void; onDone(): void }): ReactElement {
  const change = useSchemaChange(call);
  useEffect(() => { void change.run(dropTypeOps(type)); }, [type]);
  const staged = change.staged;
  const done = (): void => { void change.confirm().then((ok) => { if (ok) { onDone(); onClose(); } }); };
  return (
    <Dialog
      title="Delete record type" onClose={onClose} width={420} testID="type-delete"
      actions={[{ label: "Cancel", onPress: onClose, testID: "type-delete-cancel" }, { label: "Delete", danger: true, disabled: staged === null || change.busy, onPress: done, testID: "type-delete-yes" }]}
    >
      {staged !== null
        ? <Text style={{ fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string }} testID="type-delete-text">{confirmLine("type.drop", title, staged.rows)}</Text>
        : change.error
          ? <Text style={{ fontSize: 13, color: "var(--danger)" as string }} accessibilityRole="alert" testID="type-delete-error">{change.error}</Text>
          : <Text style={{ fontSize: 13, color: "var(--ink-3)" as string }}>Checking what is inside</Text>}
    </Dialog>
  );
}
