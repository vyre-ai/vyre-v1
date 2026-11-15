// "Delete this message?" asked once, wherever Delete is chosen from the desktop message menu (the phone sheet asks in its own list): Delete and Cancel. Focus opens on Cancel, the safe button, and
// Enter or Space press only the button that has focus; Escape cancels. A destructive ask never confirms on a stray Enter, so there is no document-level key handler. When it closes, focus goes back
// to the composer (the menu that opened it is gone), unless something else already holds it.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";

type Doc = {
  activeElement?: { isConnected?: boolean; tagName?: string } | null;
  querySelector?(q: string): { focus?: () => void } | null;
};

export function DeleteAsk({ onDelete, onClose }: { onDelete(): void; onClose(): void }): ReactElement {
  useEffect(() => {
    const doc = (globalThis as unknown as { document?: Doc }).document;
    return () => {
      // after the card's own focus return has run: if focus is on nothing real (the menu that opened the ask is gone), the composer takes it
      setTimeout(() => {
        const a = doc?.activeElement;
        if (a && a.isConnected !== false && a.tagName !== "BODY") return;
        doc?.querySelector?.("[data-testid=composer-field]")?.focus?.();
      }, 0);
    };
  }, []);
  return (
    <Dialog
      title="Delete this message?"
      size="s"
      testID="delete-ask"
      onClose={onClose}
      actions={[
        { label: "Cancel", onPress: onClose, testID: "delete-ask-cancel", initial: true },
        { label: "Delete", danger: true, onPress: onDelete, testID: "delete-ask-go" },
      ]}
    />
  );
}
