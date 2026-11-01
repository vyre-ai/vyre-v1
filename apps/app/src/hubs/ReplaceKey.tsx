// The Replace key sheet: a hub's key stopped working, so the person pastes the new one. It goes to the Vault item the connection already points at (the same name, so every agent and the connection keep
// working with no other change); nothing else is asked. It opens in place from the Needs you item and anywhere else a hub key needs replacing. `call` is the caller's own, so Vault access rules apply.
import { useState } from "react";
import type { ReactElement } from "react";
import { Linking, Text, View } from "react-native";
import { hubById } from "../../../../lib/mcp-hubs.ts";
import { Dialog } from "../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../ui/src/TextField/index.tsx";
import type { Call } from "./AppHubs.tsx";

/** The item name and field a header value points at: "Bearer #Composio_key.api_key" gives { item: "Composio_key", field: "api_key" }. */
export function handleOf(value: string): { item: string; field: string } | null {
  const m = /#([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/.exec(value);
  return m ? { item: m[1]!, field: m[2]! } : null;
}

export function ReplaceKeySheet({ call, connectionId, hubId, onClose, onDone }: { call: Call; connectionId: string; hubId: string; onClose(): void; onDone(): void }): ReactElement {
  const hub = hubById(hubId);
  const name = hub?.name ?? "the hub";
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const replace = async (): Promise<void> => {
    setBusy(true); setProblem("");
    try {
      const list = (await call("plugins.connections.list", {})) as { connections: { connectionId: string; headers: Record<string, string> }[] };
      const c = list.connections.find((x) => x.connectionId === connectionId);
      const handle = Object.values(c?.headers ?? {}).map(handleOf).find((h) => h !== null) ?? null;
      if (!handle) { setProblem("This connection does not keep its key in the Vault."); return; }
      const items = (await call("vault.items.list", { q: handle.item })) as { items: { id: string; name: string }[] };
      const item = items.items.find((i) => i.name === handle.item);
      if (!item) { setProblem(`The Vault item ${handle.item} is gone.`); return; }
      await call("vault.item.update", { itemId: item.id, fieldsSet: [{ key: handle.field, value: key.trim(), secret: true }] });
      setKey("");
      onDone();
    } catch (e) {
      setProblem((e as { message?: string }).message ?? "That did not save.");
    } finally { setBusy(false); }
  };
  return (
    <Dialog title={`Replace the ${name} key`} width={440} testID="replace-key-sheet" onClose={onClose} actions={[
      ...(hub ? [{ label: `Get a ${name} key`, onPress: () => { void Linking.openURL(hub.keyUrl); }, testID: "replace-getkey" }] : []),
      { label: "Cancel", onPress: onClose, testID: "replace-cancel" },
      { label: "Replace key", primary: true, disabled: busy || key.trim() === "", why: "Paste the new key first", onPress: () => { void replace(); }, testID: "replace-submit" },
    ]}>
      <View style={{ gap: 12 }}>
        <TextField value={key} onChangeText={setKey} placeholder={`New ${name} key`} accessibilityLabel={`New ${name} key`} testID="replace-key" secureTextEntry autoCapitalize="none" autoCorrect={false} />
        {problem ? <Text accessibilityRole="alert" style={{ fontSize: 13, color: "var(--danger)" }}>{problem}</Text> : null}
      </View>
    </Dialog>
  );
}
