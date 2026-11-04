// Console > AI > AI accounts: one switch (may people use their own AI sign-ins), then the AI accounts the Space itself holds with who added each and whether it works.
// Reads engine.accounts.list and engine.policy.get; writes engine.policy.set (allowedAccounts "any" or "company", read back after saving) and engine.probe_account.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { LogoTile } from "../../places/vault/layout/parts.tsx";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
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

function Tile({ title }: { title: string }): ReactElement { return <LogoTile name={title} size={30} />; }

/** The entries of an account's row menu: Check now probes it. */
export function accountMenu(a: Account, check: () => void): MenuEntry[] { return [{ label: `Check ${a.name ?? a.title} now`, onSelect: check }]; }

function RowMenu({ entries, testID }: { entries: MenuEntry[]; testID: string }): ReactElement {
  const menu = useMenu();
  const ref = useRef<unknown>(null);
  return <><Pressable ref={(r) => { ref.current = r; }} accessibilityRole="button" accessibilityLabel="More" testID={testID} onPress={() => { const box = (ref.current as { getBoundingClientRect?: () => { left: number; bottom: number } } | null)?.getBoundingClientRect?.(); menu.show(entries, box?.left ?? 0, (box?.bottom ?? 0) + 4, "other", { label: "Account" }); }} style={{ paddingHorizontal: 6 }}><Glyph name="gear" size={14} color="var(--ink-3)" /></Pressable>{menu.element}</>;
}

export function AiAccountsPage(): ReactElement {
  const accounts = useRead<CapMap["engine.accounts.list"]["out"]>("engine.accounts.list");
  const policy = useRead<Policy>("engine.policy.get");
  // who runs on their own sign-ins: a count per person from the Vault (providers.own_people), since engine.accounts.list only lists what the caller may run on
  const people = useRead<CapMap["providers.own_people"]["out"]>("providers.own_people");
  const refresh = (): void => { accounts.refresh(); policy.refresh(); people.refresh(); };
  if (!accounts.data || !policy.data) return <ReadState error={accounts.error ?? policy.error} retry={refresh} />;
  return <AiAccounts accounts={accounts.data.accounts} policy={policy.data} refresh={refresh} {...(people.data ? { ownPeople: people.data.people.map((x) => x.personId) } : {})} />;
}

function AiAccounts({ accounts, policy, refresh, ownPeople }: { accounts: readonly Account[]; policy: Policy; refresh(): void; ownPeople?: readonly string[] }): ReactElement {
  const data = useConsoleData();
  const action = useAction(refresh);
  const [confirm, setConfirm] = useState(false);
  const on = policy.allowedAccounts === "any";
  const own = ownPeople ?? ownSignIns(accounts);
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
    {space.some((a) => !accountState(a).working) ? <Section title="Needs you" count={space.filter((a) => !accountState(a).working).length}>
      <Group>{space.filter((a) => !accountState(a).working).map((a) => <Row key={a.ref} id={`ai-need-${a.ref}`} title={`${a.name ?? a.title} needs attention`} note={accountState(a).why ?? ""} leading={<Lead><View style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--warn-wash, var(--sel))" as string }}><Glyph name="warn" size={15} color="var(--warn)" /></View></Lead>} trailing={<Button label="Open Vault" testID={`ai-need-vault-${a.ref}`} onPress={() => data.nav.openApp({ screen: "vault.layout" })} />} />)}</Group>
    </Section> : null}
    <Section title="The Space's AI accounts" count={space.length} right={<Button label="Add account" testID="ai-add-account" onPress={() => data.nav.openApp({ screen: "vault.layout" })} />}>
      <Group>
        {space.length === 0 ? <Row id="ai-none" title="No AI accounts yet" note="Add one so agents have something to run on." /> : null}
        {space.map((a) => {
          const st = accountState(a);
          const by = a.ownerId ? data.name(a.ownerId) : "";
          const note = `${st.why ? `${st.why} ` : ""}${by ? `Added by ${by}` : "Added to the Space"}`;
          return <Row key={a.ref} id={`ai-acct-${a.ref}`} title={a.name ?? a.title} note={note} leading={<Lead><Tile title={a.title} /></Lead>} trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text testID={`ai-acct-state-${a.ref}`} style={{ fontSize: 12.5, color: (st.working ? "var(--ink-3)" : "var(--warn)") as string }}>{st.word}</Text>
            {st.working ? null : <Button label="Open Vault" testID={`ai-acct-vault-${a.ref}`} onPress={() => data.nav.openApp({ screen: "vault.layout" })} />}
            <RowMenu testID={`ai-acct-menu-${a.ref}`} entries={accountMenu(a, () => void action.run<CapMap["engine.probe_account"]["out"]>("engine.probe_account", { accountRef: a.ref }, (out) => out.ok ? `${a.name ?? a.title} works` : (out.error?.message ?? `${a.name ?? a.title} needs attention`)))} />
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
