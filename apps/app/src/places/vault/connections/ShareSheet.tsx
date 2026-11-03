// Share a Space connection: Everyone, or the groups an admin picks. A Mine connection is never shared; it is yours and your agents'.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useVaultData } from "../layout/data.tsx";
import { Btn, Glyph } from "../layout/parts.tsx";
import { Sheet } from "../layout/Sheet.tsx";
import { attemptKey, messageOf } from "./actions.ts";
import type { ConnRow } from "./model.ts";

export function ShareSheet({ row, groups, onClose, onSaved }: { row: ConnRow; groups: ReadonlyMap<string, string>; onClose(): void; onSaved(text: string): void }): ReactElement {
  const data = useVaultData();
  const [pick, setPick] = useState<Set<string>>(new Set(row.share.includes("everyone") ? ["everyone"] : row.share));
  const [error, setError] = useState("");
  const everyone = pick.has("everyone");
  const flip = (id: string): void => setPick((p) => {
    if (id === "everyone") return new Set(["everyone"]);
    const x = new Set(p); x.delete("everyone");
    if (x.has(id)) x.delete(id); else x.add(id);
    return x.size === 0 ? new Set(["everyone"]) : x;
  });
  const rows: ReactElement[] = [<Row key="everyone" id="share-everyone" title="Everyone in the Space" note="Every person and their agents" onPress={() => flip("everyone")} trailing={everyone ? <Glyph name="check" color="var(--accent)" /> : undefined} />];
  for (const [id, name] of groups) rows.push(<Row key={id} id={`share-${id}`} title={name} note="A group" onPress={() => flip(id)} trailing={pick.has(id) ? <Glyph name="check" color="var(--accent)" /> : undefined} />);
  const save = async (): Promise<void> => {
    try { await data.call("plugins.connection.update", { connectionId: row.connectionId, share: [...pick], idempotencyKey: attemptKey() }); onSaved(everyone ? `${row.title} is for everyone` : `Shared ${row.title} with ${pick.size} ${pick.size === 1 ? "group" : "groups"}`); }
    catch (e) { setError(messageOf(e)); }
  };
  return (
    <Sheet title={`Who can use ${row.title}`} onClose={onClose} testID="connection-share-sheet" footer={<><View style={{ flex: 1 }} /><Btn label="Cancel" onPress={onClose} /><Btn label="Save" primary onPress={() => { void save(); }} testID="share-save" /></>}>
      <Text style={s.quiet}>People outside these groups do not see it, and their agents cannot call it.</Text>
      <View>{rows}</View>
      {groups.size === 0 ? <Text style={s.quiet}>This Space has no groups yet. Make one in the Console under Groups.</Text> : null}
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
