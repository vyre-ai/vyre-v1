import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAppsData } from "./data.tsx";
import { actionKey, errorMessage, mutate } from "./mutations.ts";
import { Button, Card, Field, Frame, Select, s, useOnline, useRead } from "./editor-ui.tsx";
import type { AppsRoute } from "./routes.ts";
export function TemplateEditor({ route, back }: { route: AppsRoute; back(): void }): ReactElement {
  const d = useAppsData(), online = useOnline();
  const preview = useRead<CapMap["templates.preview"]["out"]>(route.id ? "templates.preview" : null, { templateId: route.id }, "templates");
  const [title, setTitle] = useState(""), [kind, setKind] = useState("agent"), [ref, setRef] = useState("");
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [key, setKey] = useState(actionKey);
  useEffect(() => setConfirm(false), [preview.data]);
  const run = async (): Promise<void> => { setBusy(true); setError(null); try {
    if (route.id) {
      const out = await mutate(d, "templates.install", { templateId: route.id }, key);
      if (out.status === "held") { d.nav.openTask(out.taskId); return; }
      setNotice(`Installed ${preview.data?.template.title ?? "the template"}. Added ${out.installed.length} items.`); setConfirm(false);
    } else { const out = await mutate(d, "templates.save", { title: title.trim(), kind, ref: ref.trim() }, key); d.nav.open("templates", out.template.templateId); }
    setKey(actionKey());
  } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  return <Frame testID={route.id ? "apps-template-detail" : "apps-create-template"} title={route.id ? preview.data?.template.title ?? "Template" : "Save a template"} back={back} offline={!online} error={error ?? preview.error} loading={preview.loading} retry={preview.refresh}>
    {route.id ? preview.data ? <>
      <Card title="What this template adds"><Text style={s.text}>{preview.data.template.summary}</Text>{preview.data.template.adds.map((item, i) => <Row key={i} id={String(i)} title={item} />)}
        <Text style={s.text}>{`Record types: ${preview.data.record_types.join(", ") || "None"}`}</Text><Text style={s.text}>{`Network domains: ${preview.data.domains.join(", ") || "None"}`}</Text><Text style={s.text}>{`Vault handles: ${preview.data.vaultNames.join(", ") || "None"}`}</Text>
      </Card>
      {!confirm ? <Button title="Review installation" testID="apps-preview-install" disabled={!online || busy} onPress={() => setConfirm(true)} /> : <Card title="Install this template into this Space?"><Text style={s.text}>The items, record types and service access listed above will be added to this Space.</Text><View style={s.actions}><Button title="Cancel" onPress={() => setConfirm(false)} /><Button title="Confirm install" testID="apps-confirm-install" primary disabled={!online || busy} onPress={() => void run()} /></View></Card>}
    </> : null : <Card title="Reuse something you already built">
      <Field label="Template title" value={title} onChange={setTitle} disabled={busy} /><Select label="Source kind" value={kind} options={["agent", "automation", "journey", "record_type", "runbook", "project", "form"].map((key) => ({ key, title: key.replace("_", " ") }))} onChange={setKind} disabled={busy} />
      <Field label="Existing source ID" value={ref} onChange={setRef} placeholder="The agent, project, form or record type to save" disabled={busy} />
      <Button title="Save template" testID="apps-save-template" primary disabled={!online || busy || !title.trim() || !ref.trim()} onPress={() => void run()} />
    </Card>}
    {notice ? <Text style={s.text}>{notice}</Text> : null}
  </Frame>;
}
