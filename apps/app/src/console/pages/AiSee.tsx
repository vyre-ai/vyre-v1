// Console > AI > What each provider may see: one plain sentence per provider ("Everything", "Everything except Restricted", "Only Public, Internal"); a tap opens a small sheet of label
// checkboxes. A tick saves at once through engine.policy.set labelProviders and is read back with engine.policy.get. A label with no entry in labelProviders means every provider; an entry is the list
// of providers that may see it. Restricted is open to a provider only while one of its accounts keeps nothing: an admin sets that on each account (providers.set_keeps_nothing), shown as a switch per
// account in the provider's sheet; a local model always keeps nothing, so its switch is on and locked.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Group, Lead } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Switch } from "../../places/settings/ui.tsx";
import { Note, ReadState, useAction, useRead } from "./shared.tsx";
import { policyMatches } from "./ai-data-values.ts";

type Policy = CapMap["engine.policy.get"]["out"];
type Provider = CapMap["engine.providers.list"]["out"]["providers"][number];
type Account = CapMap["engine.accounts.list"]["out"]["accounts"][number];

const KEEPS_LABEL = "This account keeps nothing (zero data retention)";

export const SEE_LABELS = [
  { id: "public", name: "Public", where: "Anything anyone may read" },
  { id: "internal", name: "Internal", where: "Fine inside the Space" },
  { id: "confidential", name: "Confidential", where: "Named people and matters only" },
  { id: "restricted", name: "Restricted", where: "The most sensitive data" },
] as const;

/** Does this account keep nothing of what it is sent: a local model always does, any other only when an admin said so. */
export const accountKeeps = (a: Pick<Account, "driver" | "keepsNothing">): boolean => a.driver === "local" || a.keepsNothing === true;

/** Whether Restricted data may go to this provider: one of its accounts keeps nothing, or it is the local driver. */
export const mayTakeRestricted = (accounts: readonly Pick<Account, "driver" | "keepsNothing">[], driver: string): boolean => driver === "local" || accounts.some((a) => a.driver === driver && accountKeeps(a));

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
  const accounts = useRead<CapMap["engine.accounts.list"]["out"]>("engine.accounts.list");
  const refresh = (): void => { policy.refresh(); providers.refresh(); accounts.refresh(); };
  if (!policy.data || !providers.data || !accounts.data) return <ReadState error={policy.error ?? providers.error ?? accounts.error} retry={refresh} />;
  return <AiSee policy={policy.data} providers={providers.data.providers} accounts={accounts.data.accounts} refresh={refresh} />;
}

function Box({ checked, disabled, label, testID, onChange }: { checked: boolean; disabled: boolean; label: string; testID: string; onChange(next: boolean): void }): ReactElement {
  return <Pressable testID={testID} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => onChange(!checked)} style={{ width: 32, minHeight: 32, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.5 : 1 }}>
    <View style={{ width: 15, height: 15, borderWidth: 1, borderColor: (checked ? "var(--accent)" : "var(--line-2)") as string, backgroundColor: (checked ? "var(--accent)" : "transparent") as string, borderRadius: 3, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, color: "#fff" }}>{checked ? "✓" : ""}</Text></View>
  </Pressable>;
}

function AiSee({ policy, providers, accounts, refresh }: { policy: Policy; providers: readonly Provider[]; accounts: readonly Account[]; refresh(): void }): ReactElement {
  const data = useConsoleData();
  const action = useAction(refresh);
  const [open, setOpen] = useState<string | null>(null);
  const [local, setLocal] = useState<Policy["labelProviders"] | null>(null);
  const labelProviders = local ?? policy.labelProviders;
  const universe = providers.map((p) => p.driver);
  const sheet = providers.find((p) => p.driver === open);
  // the accounts an admin can mark: ones shared with the Space, and local models (always on, locked)
  const sheetAccounts = sheet ? accounts.filter((a) => a.driver === sheet.driver && (!a.mine || a.driver === "local")) : [];
  const tick = async (driver: string, label: string, allow: boolean): Promise<void> => {
    const next = withTick(labelProviders, universe, label, driver, allow);
    const out = await action.run("engine.policy.set", { labelProviders: next }, async () => {
      const readback = await data.call("engine.policy.get", {}) as Policy;
      if (!policyMatches(readback, { allowedAccounts: readback.allowedAccounts, allowedProviders: readback.allowedProviders, allowedModels: readback.allowedModels, labelProviders: next })) throw new Error("The change did not save. Try again.");
      return "Saved";
    });
    if (out) setLocal(next);
  };
  // an admin's switch on one account; turning off the last account that keeps nothing also takes the provider off Restricted, so the list never names a provider that cannot take it
  const keep = async (a: Account, next: boolean): Promise<void> => {
    if (!a.providerId) return;
    const last = !next && accountKeeps(a) && !accounts.some((o) => o !== a && o.driver === a.driver && accountKeeps(o));
    if (last && mayRead(labelProviders, "restricted", a.driver)) await tick(a.driver, "restricted", false);
    await action.run("providers.set_keeps_nothing", { providerId: a.providerId, keepsNothing: next }, "Saved");
  };
  return <View testID="console-ai-see">
    <Group>
      {providers.map((p) => <Row key={p.driver} id={`see-${p.driver}`} title={p.title} note={seeSays(labelProviders, p.driver)} leading={<Lead><View style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sel)" as string }}><Text style={{ fontSize: 13, fontWeight: "600", color: "var(--ink)" as string }}>{(p.title.trim()[0] ?? "?").toUpperCase()}</Text></View></Lead>} trailing={<Glyph name="chevR" size={12} color="var(--ink-3)" />} onPress={() => setOpen(p.driver)} />)}
    </Group>
    <Text style={{ fontSize: 12, color: "var(--ink-3)" as string, marginTop: 10, marginLeft: 2 }}>Restricted data only goes to accounts that keep nothing.</Text>
    {action.note ? <Note>{action.note}</Note> : null}
    {sheet ? <Dialog title={`What ${sheet.title} may see`} width={460} testID="see-sheet" onClose={() => setOpen(null)} actions={[{ label: "Done", primary: true, onPress: () => setOpen(null), testID: "see-done" }]}>
      <Group>
        {SEE_LABELS.map((l) => {
          const blocked = l.id === "restricted" && !mayTakeRestricted(accounts, sheet.driver);
          const checked = mayRead(labelProviders, l.id, sheet.driver);
          return <Row key={l.id} id={`see-${sheet.driver}-${l.id}`} title={l.name} note={blocked ? "Only accounts that keep nothing" : l.where} trailing={<Box checked={checked} disabled={action.busy || (blocked && !checked)} label={`${l.name} for ${sheet.title}`} testID={`see-tick-${sheet.driver}-${l.id}`} onChange={(next) => void tick(sheet.driver, l.id, next)} />} />;
        })}
      </Group>
      {sheetAccounts.length > 0 ? <>
        <Text style={{ fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string, marginTop: 14, marginBottom: 6 }}>Accounts</Text>
        <Group>
          {sheetAccounts.map((a) => {
            const local = a.driver === "local";
            return <Row key={a.ref} id={`see-account-${a.ref}`} title={a.name ?? a.title} note={KEEPS_LABEL} trailing={<Switch on={accountKeeps(a)} label={`${KEEPS_LABEL}: ${a.name ?? a.title}`} testID={`see-keeps-${a.providerId ?? a.ref}`} disabled={action.busy || local || !a.providerId} onChange={(next) => void keep(a, next)} />} />;
          })}
        </Group>
      </> : null}
      <Text style={{ fontSize: 12, color: "var(--ink-3)" as string, marginTop: 12 }}>Restricted data only goes to accounts that keep nothing.</Text>
    </Dialog> : null}
  </View>;
}
