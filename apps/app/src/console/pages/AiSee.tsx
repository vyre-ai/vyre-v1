// Console > AI > What each provider may see: one plain sentence per provider ("Everything", "Everything except Restricted", "Only Public, Internal"); a tap opens a small sheet of label
// checkboxes. A tick saves at once through engine.policy.set labelProviders and is read back with engine.policy.get. A label with no entry in labelProviders means every provider; an entry is the list
// of providers that may see it.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Group, Lead } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Note, ReadState, useAction, useRead } from "./shared.tsx";
import { policyMatches } from "./ai-data-values.ts";

type Policy = CapMap["engine.policy.get"]["out"];
type Provider = CapMap["engine.providers.list"]["out"]["providers"][number];

export const SEE_LABELS = [
  { id: "public", name: "Public", where: "Anything anyone may read" },
  { id: "internal", name: "Internal", where: "Fine inside the Space" },
  { id: "confidential", name: "Confidential", where: "Named people and matters only" },
  { id: "restricted", name: "Restricted", where: "The most sensitive data" },
] as const;

/** Providers that keep nothing of what they are sent. Only these may take Restricted data. */
export const KEEPS_NOTHING: ReadonlySet<string> = new Set(["local"]);

/** Whether the provider may see data with this label: a label with no entry is open to every provider. */
export const mayRead = (labelProviders: Policy["labelProviders"], label: string, driver: string): boolean => labelProviders[label] === undefined || labelProviders[label]!.includes(driver);

/** The one sentence for a provider. */
export function seeSays(labelProviders: Policy["labelProviders"], driver: string): string {
  const ok = SEE_LABELS.filter((l) => mayRead(labelProviders, l.id, driver));
  const no = SEE_LABELS.filter((l) => !mayRead(labelProviders, l.id, driver));
  if (no.length === 0) return "Everything";
  if (ok.length === 0) return "Nothing";
  if (no.length === 1) return `Everything except ${no[0]!.name}`;
  return `Only ${ok.map((l) => l.name).join(", ")}`;
}

/** The label map after one tick. A label every provider may read goes back to having no entry. */
export function withTick(labelProviders: Policy["labelProviders"], universe: readonly string[], label: string, driver: string, allow: boolean): Policy["labelProviders"] {
  const now = labelProviders[label] ?? [...universe];
  const next = allow ? [...new Set([...now, driver])] : now.filter((d) => d !== driver);
  const out = { ...labelProviders };
  if (universe.every((d) => next.includes(d))) delete out[label]; else out[label] = next;
  return out;
}

export function AiSeePage(): ReactElement {
  const policy = useRead<Policy>("engine.policy.get");
  const providers = useRead<CapMap["engine.providers.list"]["out"]>("engine.providers.list");
  const refresh = (): void => { policy.refresh(); providers.refresh(); };
  if (!policy.data || !providers.data) return <ReadState error={policy.error ?? providers.error} retry={refresh} />;
  return <AiSee policy={policy.data} providers={providers.data.providers} refresh={refresh} />;
}

function Box({ checked, disabled, label, testID, onChange }: { checked: boolean; disabled: boolean; label: string; testID: string; onChange(next: boolean): void }): ReactElement {
  return <Pressable testID={testID} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => onChange(!checked)} style={{ width: 32, minHeight: 32, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.5 : 1 }}>
    <View style={{ width: 15, height: 15, borderWidth: 1, borderColor: (checked ? "var(--accent)" : "var(--line-2)") as string, backgroundColor: (checked ? "var(--accent)" : "transparent") as string, borderRadius: 3, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, color: "#fff" }}>{checked ? "✓" : ""}</Text></View>
  </Pressable>;
}

function AiSee({ policy, providers, refresh }: { policy: Policy; providers: readonly Provider[]; refresh(): void }): ReactElement {
  const data = useConsoleData();
  const action = useAction(refresh);
  const [open, setOpen] = useState<string | null>(null);
  const [local, setLocal] = useState<Policy["labelProviders"] | null>(null);
  const labelProviders = local ?? policy.labelProviders;
  const universe = providers.map((p) => p.driver);
  const sheet = providers.find((p) => p.driver === open);
  const tick = async (driver: string, label: string, allow: boolean): Promise<void> => {
    const next = withTick(labelProviders, universe, label, driver, allow);
    const out = await action.run("engine.policy.set", { labelProviders: next }, async () => {
      const readback = await data.call("engine.policy.get", {}) as Policy;
      if (!policyMatches(readback, { allowedAccounts: readback.allowedAccounts, allowedProviders: readback.allowedProviders, allowedModels: readback.allowedModels, labelProviders: next })) throw new Error("The change did not save. Try again.");
      return "Saved";
    });
    if (out) setLocal(next);
  };
  return <View testID="console-ai-see">
    <Group>
      {providers.map((p) => <Row key={p.driver} id={`see-${p.driver}`} title={p.title} note={seeSays(labelProviders, p.driver)} leading={<Lead><View style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sel)" as string }}><Text style={{ fontSize: 13, fontWeight: "600", color: "var(--ink)" as string }}>{(p.title.trim()[0] ?? "?").toUpperCase()}</Text></View></Lead>} trailing={<Glyph name="chevR" size={12} color="var(--ink-3)" />} onPress={() => setOpen(p.driver)} />)}
    </Group>
    <Text style={{ fontSize: 12, color: "var(--ink-3)" as string, marginTop: 10, marginLeft: 2 }}>Restricted data only goes to providers that keep nothing.</Text>
    {action.note ? <Note>{action.note}</Note> : null}
    {sheet ? <Dialog title={`What ${sheet.title} may see`} width={460} testID="see-sheet" onClose={() => setOpen(null)} actions={[{ label: "Done", primary: true, onPress: () => setOpen(null), testID: "see-done" }]}>
      <Group>
        {SEE_LABELS.map((l) => {
          const blocked = l.id === "restricted" && !KEEPS_NOTHING.has(sheet.driver);
          const checked = mayRead(labelProviders, l.id, sheet.driver);
          return <Row key={l.id} id={`see-${sheet.driver}-${l.id}`} title={l.name} note={blocked ? "Only providers that keep nothing" : l.where} trailing={<Box checked={checked} disabled={action.busy || (blocked && !checked)} label={`${l.name} for ${sheet.title}`} testID={`see-tick-${sheet.driver}-${l.id}`} onChange={(next) => void tick(sheet.driver, l.id, next)} />} />;
        })}
      </Group>
      <Text style={{ fontSize: 12, color: "var(--ink-3)" as string, marginTop: 12 }}>Restricted data only goes to providers that keep nothing.</Text>
    </Dialog> : null}
  </View>;
}
