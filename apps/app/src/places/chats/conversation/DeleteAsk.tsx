// "Delete this message?" asked once, wherever Delete is chosen from the desktop message menu (the phone sheet asks in its own list): Delete and Cancel, Return confirms, Escape cancels. A message that is
// gone at one click with no way back is not acceptable on either surface.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";

export function DeleteAsk({ onDelete, onClose }: { onDelete(): void; onClose(): void }): ReactElement {
  useEffect(() => {
    const doc = (
      globalThis as unknown as {
        document?: {
          addEventListener(t: string, f: (e: { key?: string; preventDefault(): void }) => void, c: boolean): void;
          removeEventListener(t: string, f: (e: { key?: string; preventDefault(): void }) => void, c: boolean): void;
        };
      }
    ).document;
    if (!doc) return undefined;
    const key = (e: { key?: string; preventDefault(): void }): void => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      onDelete();
    };
    doc.addEventListener("keydown", key, true);
    return () => doc.removeEventListener("keydown", key, true);
  }, [onDelete]);
  return (
    <Dialog
      title="Delete this message?"
      size="s"
      testID="delete-ask"
      onClose={onClose}
      actions={[
        { label: "Cancel", onPress: onClose, testID: "delete-ask-cancel" },
        { label: "Delete", danger: true, onPress: onDelete, testID: "delete-ask-go" },
      ]}
    />
  );
}
