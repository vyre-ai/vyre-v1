// A connection built on this Vault item that waits for another secret (Resend's webhook signing secret). The person pastes it here: it goes into the Vault as its own item through the Vault's write,
// and the connection is told its handle. The pasted value lives in this field until Save and is cleared after; it never goes into a message, a log or a title.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useVaultData } from "../layout/data.tsx";
import { Btn, Glyph } from "../layout/parts.tsx";

export interface PendingSlot { connectionId: string; connector: string; title: string; slot: string; description: string }

/** The empty slots of the pending connections that use this item, out of connections.list and connectors.list. Anything unexpected is no rows. */
export function pendingSlots(connectionsOut: unknown, connectorsOut: unknown, handle: string): PendingSlot[] {
  const conns = (connectionsOut as { connections?: unknown } | null)?.connections;
  const cons = (connectorsOut as { connectors?: unknown } | null)?.connectors;
  if (!Array.isArray(conns) || !Array.isArray(cons)) return [];
  const out: PendingSlot[] = [];
  for (const c of conns) {
    const r = c as { connectionId?: unknown; connector?: unknown; state?: unknown; handles?: unknown; filled?: unknown } | null;
    if (!r || r.state !== "pending" || typeof r.connectionId !== "string" || typeof r.connector !== "string" || !Array.isArray(r.handles) || !r.handles.some((h) => typeof h === "string" && h.startsWith(handle))) continue;
    const def = cons.find((x) => (x as { key?: unknown }).key === r.connector) as { title?: unknown; secrets?: { name?: unknown; description?: unknown }[] } | undefined;
    const filled = new Set(Array.isArray(r.filled) ? r.filled : []);
    for (const s of def?.secrets ?? []) {
      if (typeof s.name !== "string" || filled.has(s.name)) continue;
      out.push({ connectionId: r.connectionId, connector: r.connector, title: typeof def?.title === "string" ? def.title : r.connector, slot: s.name, description: typeof s.description === "string" ? s.description : s.name });
    }
  }
  return out;
}

export function PendingSecrets({ slots, folderId, onSaved }: { slots: readonly PendingSlot[]; folderId: string; onSaved: () => void }): ReactElement | null {
  const data = useVaultData();
  const [value, setValue] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (slots.length === 0) return null;
  const save = async (p: PendingSlot): Promise<void> => {
    const key = `${p.connectionId}:${p.slot}`;
    const secret = (value[key] ?? "").trim();
    if (secret === "") return;
    setBusy(key); setError(null);
    try {
      const put = (await data.call("vault.item.put", { folderId, name: `${p.title} ${p.slot.replace(/_/g, " ")}`, kind: "api_key", fields: [{ key: "secret", value: secret, secret: true }] })) as { item?: { handle?: string } };
      const handle = put.item?.handle;
      if (!handle) throw new Error("The Vault did not save it.");
      await data.call("connections.set_secret", { connectionId: p.connectionId, slot: p.slot, handle: `${handle}.secret` });
      setValue((v) => ({ ...v, [key]: "" }));
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "That did not save. Try again."); } finally { setBusy(null); }
  };
  return (
    <View style={s.wrap} testID="pending-secrets">
      {slots.map((p) => {
        const key = `${p.connectionId}:${p.slot}`;
        return (
          <View key={key} style={s.row} testID={`pending-${key}`}>
            <Glyph name="lock" size={15} />
            <Text style={s.text} numberOfLines={2}>{`${p.title} needs ${p.description}.`}</Text>
            <TextInput secureTextEntry value={value[key] ?? ""} onChangeText={(t) => setValue((v) => ({ ...v, [key]: t }))} placeholder="Paste it" placeholderTextColor="var(--ink-3)" accessibilityLabel={`${p.title} ${p.slot}`} testID={`pending-field-${key}`} style={s.input} />
            <Btn label="Save" primary disabled={busy === key || (value[key] ?? "").trim() === ""} onPress={() => { void save(p); }} testID={`pending-save-${key}`} />
          </View>
        );
      })}
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, backgroundColor: "var(--accent-wash)" as string },
  text: { flex: 1, minWidth: 180, fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  input: { minWidth: 160, flexGrow: 1, height: 28, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string, fontSize: 13, color: "var(--ink)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
