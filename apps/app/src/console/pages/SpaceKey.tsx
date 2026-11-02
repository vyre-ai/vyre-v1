// Console, AI, Models and providers: the Space AI key. One API key an owner or admin sets for everyone; members and agents run on it with no setup, after their own accounts. One guided step:
// pick the provider, paste the key, Vyre checks it with the provider and shows the models it unlocks. The key is never read back here: it sits Restricted in the Vault.
// A key whose prefix names another provider is caught before it is saved, with that provider one press away. Team setup draws this same component in its AI step.
import { useEffect, useState } from "react";
import { checkKey } from "../../ai-signin/key-prefix.ts";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Group, Section, StatusLabel } from "../shell/ui.tsx";
import { Choice } from "./ai-controls.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";

type KeyOut = CapMap["providers.space_key.get"]["out"];
type Catalog = CapMap["providers.catalog"]["out"];
const attempt = (): string => globalThis.crypto?.randomUUID?.() ?? `space-key-${Date.now()}`;
/** OpenCode Go first: the provider the Space AI key was made for. */
const FIRST = "opencode-go";

/** The providers a Space AI key can be: built-in API-key providers, OpenCode Go first. */
export function keyProviders(c: Catalog["providers"]): { key: string; title: string }[] {
  const rows = c.filter((p) => p.connections.includes("api_key") && p.custom !== true).map((p) => ({ key: p.key, title: p.name }));
  return [...rows.filter((p) => p.key === FIRST), ...rows.filter((p) => p.key !== FIRST)];
}

/** The status line: what covers everyone, plainly. */
export function keyHeadline(k: KeyOut): string {
  if (!k.set) return "No Space AI key";
  return k.state === "failing" ? `The ${k.name ?? "Space"} key stopped working` : `${k.name ?? "The key"} covers everyone`;
}

/** "glm-5.3, kimi-k3 and 5 more" */
export function modelsLine(models: readonly string[], shown = 3): string {
  if (models.length === 0) return "No models listed yet";
  if (models.length <= shown) return models.join(", ");
  return `${models.slice(0, shown).join(", ")} and ${models.length - shown} more`;
}

export function SpaceKey({ onState }: { /** told whether a key is set, on load and after each change (team setup arms its Continue on it) */ onState?: (set: boolean) => void } = {}): ReactElement {
  const data = useConsoleData();
  const key = useRead<KeyOut>("providers.space_key.get", {}, { direct: true });
  const catalog = useRead<Catalog>("providers.catalog", {}, { direct: true });
  const action = useAction(() => key.refresh());
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(FIRST);
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState(false);
  const set = key.data?.set;
  useEffect(() => { if (set !== undefined) onState?.(set); }, [set, onState]);
  if (!key.data || !catalog.data) return <ReadState error={key.error ?? catalog.error} retry={() => { key.refresh(); catalog.refresh(); }} />;
  const k = key.data;
  const options = keyProviders(catalog.data.providers);
  const form = !k.set || editing;
  const mismatch = checkKey(provider, value, (p) => options.find((o) => o.key === p)?.title ?? null);
  const save = async (): Promise<void> => {
    if (value.trim() === "") return;
    const out = await action.run<KeyOut>("providers.space_key.set", { providerKey: provider, apiKey: value, idempotencyKey: attempt() }, (o) => `${o.name ?? "The key"} works. It covers everyone now`);
    setValue("");
    if (out) setEditing(false);
  };
  const who = k.setBy ? `${data.name(k.setBy)} added it` : "";
  const note = k.set ? [modelsLine(k.models), who].filter(Boolean).join(" · ") : "Members with no AI account of their own use it, and can never read it";
  return (
    <View testID="console-space-key">
      <Section title="Space AI key">
        <Group>
          <Row id="space-key-status" title={keyHeadline(k)} note={note} trailing={k.set ? <StatusLabel status={k.state === "failing" ? "failed" : "active"} /> : undefined} />
        </Group>
        {!k.mayManage ? null : form ? (
          <Group>
            <Choice label="Provider" value={provider} options={options} onChange={setProvider} />
            <Field label="API key" value={value} onChange={setValue} secure testID="space-key-value" />
            {mismatch ? <Note>{mismatch.line}</Note> : null}
            <Actions>
              {mismatch?.suggest ? <Button label={`Use ${options.find((o) => o.key === mismatch.suggest)?.title ?? mismatch.suggest}`} onPress={() => setProvider(mismatch.suggest!)} testID="space-key-switch" /> : null}
              <Button label={action.busy ? "Checking" : "Check and save"} disabled={value.trim() === "" || action.busy} why="Paste the key first" onPress={() => void save()} testID="space-key-save" />
              {k.set ? <Button label="Cancel" onPress={() => { setEditing(false); setValue(""); }} testID="space-key-cancel" /> : null}
            </Actions>
          </Group>
        ) : (
          <Actions>
            <Button label="Replace key" onPress={() => { setEditing(true); setProvider(k.providerKey ?? FIRST); }} testID="space-key-replace" />
            <Button label="Check now" disabled={action.busy} onPress={() => void action.run("providers.space_key.get", { refresh: true }, "Checked")} testID="space-key-check" />
            {confirm
              ? <Button danger label="Remove for everyone" onPress={() => void action.run("providers.space_key.remove", {}, "Space AI key removed").then(() => setConfirm(false))} testID="space-key-remove-yes" />
              : <Button label="Remove key" onPress={() => setConfirm(true)} testID="space-key-remove" />}
          </Actions>
        )}
        {action.note !== "" ? <Note>{action.note}</Note> : null}
      </Section>
    </View>
  );
}
