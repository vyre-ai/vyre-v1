// Console > AI > AI accounts: one switch (may people use their own AI sign-ins), then the AI accounts the Space itself holds with who added each and whether it works.
// Reads engine.accounts.list and engine.policy.get; writes engine.policy.set (allowedAccounts "any" or "company", read back after saving) and engine.probe_account.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Group, Lead, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Switch } from "../../places/settings/ui.tsx";
import { Actions, Button, Note, ReadState, useAction, useRead } from "./shared.tsx";

type Account = CapMap["engine.accounts.list"]["out"]["accounts"][number];
type Policy = CapMap["engine.policy.get"]["out"];

/** A Space account is one the Space holds for everyone: a Space key, or an account that says what it may pay for. A person's own sign-in carries neither. */
export const isSpaceAccount = (a: Account): boolean => a.spaceKey === true || a.uses !== undefined;

/** The people who use their own AI sign-in today: one entry per owner of an account that is not the Space's. */
export function ownSignIns(accounts: readonly Account[]): string[] {
  return [...new Set(accounts.filter((a) => !isSpaceAccount(a)).map((a) => a.ownerId ?? "me"))];
}

/** Working, or Needs attention with the reason in plain words. */
export function accountState(a: Account): { working: boolean; word: string; why: string } {
  if (a.status === "ok") return { working: true, word: "Working", why: "" };
  if (a.status === "untested") return { working: true, word: "Not checked yet", why: "" };
  const why = a.why ?? (a.status === "expired" ? "The sign-in ran out. Add a new one in Vault." : "The key was turned down. Add a new one in Vault.");
  return { working: false, word: "Needs attention", why };
}

const firstName = (full: string): string => full.split(" ")[0] ?? full;
const letter = (title: string): string => (title.trim()[0] ?? "?").toUpperCase();

function Tile({ title }: { title: string }): ReactElement {
  return <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sel)" as string }}><Text style={{ fontSize: 13, fontWeight: "600", color: "var(--ink)" as string }}>{letter(title)}</Text></View>;
}

export function AiAccountsPage(): ReactElement {
  const accounts = useRead<CapMap["engine.accounts.list"]["out"]>("engine.accounts.list");
  const policy = useRead<Policy>("engine.policy.get");
  const refresh = (): void => { accounts.refresh(); policy.refresh(); };
  if (!accounts.data || !policy.data) return <ReadState error={accounts.error ?? policy.error} retry={refresh} />;
  return <AiAccounts accounts={accounts.data.accounts} policy={policy.data} refresh={refresh} />;
}

function AiAccounts({ accounts, policy, refresh }: { accounts: readonly Account[]; policy: Policy; refresh(): void }): ReactElement {
  const data = useConsoleData();
  const action = useAction(refresh);
  const [confirm, setConfirm] = useState(false);
  const on = policy.allowedAccounts === "any";
  const own = ownSignIns(accounts);
  const names = own.map((id) => firstName(id === "me" ? "You" : data.name(id)));
  const space = accounts.filter(isSpaceAccount);
  const save = async (allowedAccounts: Policy["allowedAccounts"]): Promise<void> => {
    await action.run("engine.policy.set", { allowedAccounts }, async () => {
      const readback = await data.call("engine.policy.get", {}) as Policy;
      if (readback.allowedAccounts !== allowedAccounts) throw new Error("The change did not save. Try again.");
      return allowedAccounts === "any" ? "People can use their own AI sign-ins" : "Everyone uses the Space's AI accounts";
    });
    setConfirm(false);
  };
  const flip = (next: boolean): void => {
    if (next) { void save("any"); return; }
    if (own.length > 0) { setConfirm(true); return; }
    void save("company");
  };
  return <View testID="console-ai-accounts">
    <Group>
      <Row id="ai-own" title="People can use their own AI sign-ins" note={on ? `${own.length} ${own.length === 1 ? "person does" : "people do"} today` : "Everyone uses the Space's AI accounts"} trailing={<Switch on={on} label="People can use their own AI sign-ins" testID="ai-own-switch" disabled={action.busy} onChange={flip} />} />
      {confirm ? <View testID="ai-own-confirm" style={{ padding: 12, gap: 10 }}>
        <Text style={{ fontSize: 13, color: "var(--ink)" as string }}>{`${own.length} ${own.length === 1 ? "person" : "people"} will switch to the Space's AI accounts: ${names.join(", ")}. Their agents keep running.`}</Text>
        <Actions><Button label="Switch" testID="ai-own-switch-confirm" disabled={action.busy} onPress={() => void save("company")} /><Button label="Cancel" testID="ai-own-cancel" onPress={() => setConfirm(false)} /></Actions>
      </View> : null}
    </Group>
    <Section title="The Space's AI accounts" count={space.length} right={<Button label="Add account" testID="ai-add-account" onPress={() => data.nav.openApp({ screen: "vault.layout" })} />}>
      <Group>
        {space.length === 0 ? <Row id="ai-none" title="No AI accounts yet" note="Add one so agents have something to run on." /> : null}
        {space.map((a) => {
          const st = accountState(a);
          const by = a.ownerId ? data.name(a.ownerId) : "";
          const note = `${st.why ? `${st.why} ` : ""}${by ? `Added by ${by}` : "Added to the Space"}`;
          return <Row key={a.ref} id={`ai-acct-${a.ref}`} title={a.name ?? a.title} note={note} leading={<Lead><Tile title={a.title} /></Lead>} trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text testID={`ai-acct-state-${a.ref}`} style={{ fontSize: 12.5, color: (st.working ? "var(--ink-3)" : "var(--danger)") as string }}>{st.word}</Text>
            <Button label="Check now" testID={`ai-acct-check-${a.ref}`} disabled={action.busy} onPress={() => void action.run<CapMap["engine.probe_account"]["out"]>("engine.probe_account", { accountRef: a.ref }, (out) => out.ok ? `${a.name ?? a.title} works` : (out.error?.message ?? `${a.name ?? a.title} needs attention`))} />
          </View>} />;
        })}
      </Group>
    </Section>
    <Group>
      <Row id="ai-spend" title="Spend and limits" note="What AI costs this month and the caps" leading={<Lead><Glyph name="chart" size={16} color="var(--ink-3)" /></Lead>} trailing={<Glyph name="chevR" size={12} color="var(--ink-3)" />} onPress={() => data.nav.openPage("spend")} />
    </Group>
    {action.note ? <Note>{action.note}</Note> : null}
  </View>;
}
