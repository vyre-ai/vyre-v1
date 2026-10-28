import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";
import { Choice, Tick } from "./ai-controls.tsx";
import { policySelection } from "./ai-data-values.ts";

type Policy = CapMap["engine.policy.get"]["out"];
type Providers = CapMap["engine.providers.list"]["out"];
type ModelsOut = CapMap["engine.models.list"]["out"];
const LABELS = ["public", "internal", "confidential", "restricted"] as const;
const toggle = (values: readonly string[], key: string): string[] => values.includes(key) ? values.filter((value) => value !== key) : [...values, key];

export function Models(): ReactElement {
  const policy = useRead<Policy>("engine.policy.get");
  const providers = useRead<Providers>("engine.providers.list");
  const models = useRead<ModelsOut>("engine.models.list");
  if (!policy.data || !providers.data || !models.data) return <ReadState error={policy.error ?? providers.error ?? models.error} retry={() => { policy.refresh(); providers.refresh(); models.refresh(); }} />;
  return <ModelsEditor policy={policy.data} providers={providers.data.providers} models={models.data.models} refresh={() => { policy.refresh(); providers.refresh(); models.refresh(); }} />;
}

function ModelsEditor({ policy, providers, models, refresh }: { policy: Policy; providers: Providers["providers"]; models: ModelsOut["models"]; refresh(): void }): ReactElement {
  const data = useConsoleData();
  const [draft, setDraft] = useState<Policy | null>(null);
  const current = draft ?? policy;
  const [providerMode, setProviderMode] = useState<"all" | "selected">(policy.allowedProviders.length ? "selected" : "all");
  const [modelMode, setModelMode] = useState<"all" | "selected">(policy.allowedModels.length ? "selected" : "all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<CapMap["engine.policy.set"]["in"] | null>(null);
  const action = useAction(refresh);
  const patch = (next: Partial<Policy>): void => { setDraft({ ...current, ...next }); setPreview(null); setError(""); };
  const review = (): void => {
    try { setPreview({ allowedAccounts: current.allowedAccounts, allowedProviders: policySelection(providerMode, current.allowedProviders), allowedModels: policySelection(modelMode, current.allowedModels), labelProviders: current.labelProviders }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Check the selected models and providers."); }
  };
  const providerIds = [...new Set([...providers.map((provider) => provider.driver), ...current.allowedProviders])];
  const modelIds = [...new Set([...models.map((model) => model.model), ...current.allowedModels])];
  const q = search.trim().toLowerCase();
  return <View testID="console-models">
    <Section title="Accounts"><Group><Choice label="Accounts agents may use" value={current.allowedAccounts} options={[{ key: "any", title: "Company and personal accounts" }, { key: "company", title: "Company accounts only" }]} onChange={(value) => patch({ allowedAccounts: value as Policy["allowedAccounts"] })} /></Group></Section>
    <Section title="Providers" right={<Button label="Open Vault" onPress={() => data.nav.openApp({ screen: "vault.layout" })} />}><Group>
      <Choice label="Allowed providers" value={providerMode} options={[{ key: "all", title: "All providers" }, { key: "selected", title: "Selected providers" }]} onChange={(value) => { setProviderMode(value as "all" | "selected"); setPreview(null); }} />
      {providerIds.map((driver) => {
        const provider = providers.find((item) => item.driver === driver);
        const selected = providerMode === "all" || current.allowedProviders.includes(driver);
        const change = (): void => { setProviderMode("selected"); patch({ allowedProviders: toggle(providerMode === "all" ? providerIds : current.allowedProviders, driver) }); };
        return <Row key={driver} title={provider?.title ?? driver} note={provider ? `${provider.connected ? "Connected" : "Not connected"}${provider.reason ? ` · ${provider.reason}` : ""}` : "Not currently available"} onPress={change} trailing={<Tick label={`Allow ${provider?.title ?? driver}`} checked={selected} onChange={change} />} />;
      })}
    </Group></Section>
    <Section title="Models" count={models.length}><Group>
      <Choice label="Allowed models" value={modelMode} options={[{ key: "all", title: "All models" }, { key: "selected", title: "Selected models" }]} onChange={(value) => { setModelMode(value as "all" | "selected"); setPreview(null); }} />
      <Field label="Search models" value={search} onChange={setSearch} />
      {modelIds.filter((id) => !q || `${id} ${models.find((model) => model.model === id)?.title ?? ""}`.toLowerCase().includes(q)).map((id) => {
        const model = models.find((item) => item.model === id);
        const change = (): void => { setModelMode("selected"); patch({ allowedModels: toggle(modelMode === "all" ? modelIds : current.allowedModels, id) }); };
        return <Row key={id} title={model?.title ?? id} note={model ? `${model.provider}${model.contextTokens ? ` · ${model.contextTokens.toLocaleString()} context tokens` : ""}` : "Not currently available"} onPress={change} trailing={<Tick label={`Allow ${model?.title ?? id}`} checked={modelMode === "all" || current.allowedModels.includes(id)} onChange={change} />} />;
      })}
    </Group></Section>
    <Section title="Providers by sensitivity label"><Group>
    {/* ui-rows-lint: not a list (sensitivity label fieldsets contain policy controls and nested provider rows) */}
    {LABELS.map((label) => <View key={label} style={{ padding: 10 }}>
      <Text style={{ fontWeight: "600", fontSize: 13, color: "var(--ink)" as string }}>{label[0]!.toUpperCase() + label.slice(1)}</Text>
      <Choice label={`${label} provider rule`} value={current.labelProviders[label] === undefined ? "inherit" : "selected"} options={[{ key: "inherit", title: "Use Space provider policy" }, { key: "selected", title: "Only selected providers" }]} onChange={(value) => { const next = { ...current.labelProviders }; if (value === "inherit") delete next[label]; else next[label] ??= []; patch({ labelProviders: next }); }} />
      {current.labelProviders[label] !== undefined ? providerIds.map((driver) => <Row key={driver} title={providers.find((item) => item.driver === driver)?.title ?? driver} onPress={() => patch({ labelProviders: { ...current.labelProviders, [label]: toggle(current.labelProviders[label] ?? [], driver) } })} trailing={<Tick label={`Allow ${driver} for ${label}`} checked={current.labelProviders[label]!.includes(driver)} onChange={() => patch({ labelProviders: { ...current.labelProviders, [label]: toggle(current.labelProviders[label] ?? [], driver) } })} />} />) : null}
    </View>)}
    </Group></Section>
    {error ? <Note>{error}</Note> : null}
    {preview ? <Section title="Review policy change"><Group>
      <Note>These rules apply to subsequent AI turns throughout this Space.</Note>
      <Row title="Accounts" note={preview.allowedAccounts === "company" ? "Company accounts only" : "Company and personal accounts"} />
      <Row title="Providers" note={preview.allowedProviders?.length ? preview.allowedProviders.join(", ") : "All providers"} />
      <Row title="Models" note={preview.allowedModels?.length ? preview.allowedModels.join(", ") : "All models"} />
      <Actions><Button label="Back to editing" onPress={() => setPreview(null)} /><Button label="Apply policy" testID="models-policy-apply" disabled={action.busy} onPress={() => void action.run("engine.policy.set", preview, "AI policy saved").then((out) => { if (out) { setDraft(null); setPreview(null); } })} /></Actions>
    </Group></Section> : <Actions><Button label="Review changes" testID="models-policy-review" onPress={review} disabled={action.busy} /><Button label="Discard changes" onPress={() => { setDraft(null); setProviderMode(policy.allowedProviders.length ? "selected" : "all"); setModelMode(policy.allowedModels.length ? "selected" : "all"); setError(""); }} /></Actions>}
    {action.note ? <Note>{action.note}</Note> : null}
  </View>;
}
