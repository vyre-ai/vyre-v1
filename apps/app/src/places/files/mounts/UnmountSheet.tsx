// Unmount (spec 2.16): "Unmount “Marketing”? The files stay in Google Drive." Two buttons, and one choice the contract carries: keep a copy of the files in Vyre as a plain folder, or delete the copy.
// The call is mounts.remove; an agent's call is held by the Gate (the manifest gate), a person's goes straight through.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { removeMount } from "./actions.ts";
import { useMountsData } from "./data.tsx";
import { Mark } from "./icons.tsx";
import type { MarkKind } from "./icons.tsx";
import { sourceOfKind, unmountWords } from "./model.ts";
import type { MountRow } from "./model.ts";
import { Actions, Btn, ErrorLine, Field, Sheet, SheetHead, Switch } from "./parts.tsx";

export interface UnmountSheetProps {
  mount: Pick<MountRow, "mountId" | "name" | "kind" | "provider">;
  onClose(): void;
  onRemoved(mountId: string): void;
}

export function UnmountSheet({ mount, onClose, onRemoved }: UnmountSheetProps): ReactElement {
  const data = useMountsData();
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = unmountWords(mount);
  const go = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void removeMount(data.call, mount.mountId, keep).then((r) => {
      setBusy(false);
      if (r.ok) onRemoved(mount.mountId); else setError(r.error);
    });
  };
  return (
    <Sheet label={words.title} onClose={onClose} onKey={(e) => { if (e.key === "Enter") { go(); return true; } return false; }} testID="unmount-sheet">
      <SheetHead title={words.title} mark={<Mark kind={sourceOfKind(mount.kind) as MarkKind} size={16} />} onClose={onClose} />
      <Text style={st.body}>{words.body}</Text>
      <View>
        <Field label="Keep a copy of the files in Vyre" first>
          <Switch on={keep} onChange={setKeep} label="Keep a copy of the files in Vyre" testID="unmount-keep" />
        </Field>
      </View>
      {error ? <ErrorLine text={error} /> : null}
      <Actions>
        <Btn label="Cancel" onPress={onClose} testID="unmount-cancel" />
        <Btn label={busy ? "Unmounting…" : "Unmount"} primary disabled={busy} onPress={go} testID="unmount-go" />
      </Actions>
    </Sheet>
  );
}

const st = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
});
