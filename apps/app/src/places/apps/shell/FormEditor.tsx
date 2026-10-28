import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useAppsData } from "./data.tsx";
import { actionKey, errorMessage, mutate } from "./mutations.ts";
import { Button, Card, Field, Frame, Select, s, useOnline, useRead } from "./editor-ui.tsx";
import type { AppsRoute } from "./routes.ts";
type Form = CapMap["forms.get"]["out"];
type Modes = { field: string; mode: "ask" | "show" | "hide"; prefillKey?: string; step?: number }[];
export function FormEditor({ route, back }: { route: AppsRoute; back(): void }): ReactElement {
  const d = useAppsData(), online = useOnline();
  const form = useRead<Form>(route.id ? "forms.get" : null, { formId: route.id });
  const types = useRead<CapMap["schema.types.list"]["out"]>("schema.types.list", {});
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [kind, setKind] = useState("public");
  const [minutes, setMinutes] = useState("30"), [buffer, setBuffer] = useState("0");
  const [fields, setFields] = useState<Modes>([]);
  const [consent, setConsent] = useState("");
  const [captcha, setCaptcha] = useState("keep");
  const [thankYou, setThankYou] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false), [notice, setNotice] = useState("");
  const [published, setPublished] = useState<{ url: string; embed: string } | null>(null);
  const [key, setKey] = useState(actionKey);
  const [selectedField, setSelectedField] = useState("");
  const [recordId, setRecordId] = useState(""), [singleUse, setSingleUse] = useState("once"), [expires, setExpires] = useState("48"), [linkConfirm, setLinkConfirm] = useState(false), [link, setLink] = useState("");
  const records = useRead<CapMap["records.query"]["out"]>(route.id && kind === "one_use" && type ? "records.query" : null, { type, limit: 50 });
  const schema = useRead<CapMap["schema.types.get"]["out"]>(type ? "schema.types.get" : null, { type });
  useEffect(() => { if (form.data && !dirty) { setName(form.data.form.name); setType(form.data.form.recordType); setKind(form.data.form.kind); setFields(form.data.fields); setConsent(form.data.settings.consentText); setCaptcha(form.data.settings.captcha ? "on" : "off"); setThankYou(form.data.settings.thankYou?.text ?? ""); setDirty(false); setPreview(false); } }, [form.data]);
  const perform = async (work: () => Promise<void>): Promise<void> => { setBusy(true); setError(null); try { await work(); setKey(actionKey()); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  const disabled = busy || !online;
  const change = <T,>(set: (value: T) => void, value: T): void => { set(value); setDirty(true); setPreview(false); setNotice(""); };
  const save = async (): Promise<void> => {
    if (!route.id) {
      const input = kind === "booking" ? { name: name.trim(), recordType: type, hostIds: [d.me!.id], lengthMinutes: Number(minutes), bufferMinutes: Number(buffer) } : { name: name.trim(), recordType: type, kind };
      const made = await mutate(d, kind === "booking" ? "bookings.page_create" : "forms.create", input, key);
      d.nav.open("forms", made.form.formId); return;
    }
    await mutate(d, "forms.update", { formId: route.id, name: name.trim(), consentText: consent, ...(captcha === "keep" ? {} : { captcha: captcha === "on" }) }, key);
    await mutate(d, "forms.fields_set", { formId: route.id, fields }, key);
    await mutate(d, "forms.design_set", { formId: route.id, thankYou: { text: thankYou } }, key);
    setDirty(false); setNotice("Saved the form."); form.refresh();
  };
  return <Frame testID={route.id ? "apps-form-detail" : "apps-create-form"} title={route.id ? name || "Form" : "New form"} back={back} offline={!online} error={error ?? form.error ?? types.error ?? schema.error} loading={form.loading} retry={form.refresh}>
    <Card title="Form settings">
      <Field label="Form name" value={name} onChange={(v) => change(setName, v)} disabled={disabled} />
      {!route.id ? <><Select label="Record type" value={type} options={(types.data?.types ?? []).map((t) => ({ key: t.key, title: t.title }))} onChange={(v) => change(setType, v)} disabled={disabled} /><Select label="Form kind" value={kind} options={[{ key: "public", title: "Public form" }, { key: "one_use", title: "One-use link" }, { key: "survey", title: "Survey" }, { key: "booking", title: "Booking page" }]} onChange={(v) => change(setKind, v)} disabled={disabled} />
        {kind === "booking" ? <><Text style={s.text}>{`Host: ${d.me?.name ?? "Sign in to select a host"}`}</Text><Field label="Meeting length in minutes" value={minutes} onChange={setMinutes} disabled={disabled} /><Field label="Buffer in minutes" value={buffer} onChange={setBuffer} disabled={disabled} /></> : null}</> : <Text style={s.text}>{`${type} · ${kind} · ${form.data?.form.state ?? ""}`}</Text>}
    </Card>
    {route.id ? <>
      <Card title="Questions">
        {(schema.data?.type.fields ?? []).map((field) => <Row key={field.key} id={field.key} tall title={field.title} note={field.type} onPress={() => setSelectedField(field.key)} trailing={<View style={{ width: 190 }}><Select label={`Mode for ${field.title}`} value={fields.find((f) => f.field === field.key)?.mode ?? "hide"} options={[{ key: "ask", title: "Ask" }, { key: "show", title: "Show" }, { key: "hide", title: "Hide" }]} disabled={disabled} onChange={(mode) => change(setFields, [...fields.filter((f) => f.field !== field.key), { ...fields.find((f) => f.field === field.key), field: field.key, mode: mode as Modes[number]["mode"] }])} /></View>} />)}
        {selectedField ? <><Field label={`Prefill key for ${selectedField}`} value={fields.find((f) => f.field === selectedField)?.prefillKey ?? ""} disabled={disabled} onChange={(value) => { const field = fields.find((f) => f.field === selectedField) ?? { field: selectedField, mode: "hide" as const }; const { prefillKey: _prefillKey, ...rest } = field; change(setFields, [...fields.filter((f) => f.field !== selectedField), value ? { ...rest, prefillKey: value } : rest]); }} /><Field label={`Page number for ${selectedField}`} value={String(fields.find((f) => f.field === selectedField)?.step ?? 0)} disabled={disabled} onChange={(value) => { const field = fields.find((f) => f.field === selectedField) ?? { field: selectedField, mode: "hide" as const }; change(setFields, [...fields.filter((f) => f.field !== selectedField), { ...field, step: Number(value) }]); }} /></> : null}
        <Text style={s.text}>Select a question to edit its prefill key and page number. Ask collects an answer. Show displays a prefilled value. Hide leaves the field off this form.</Text>
      </Card>
      <Card title="Consent and finish">
        <Field label="Consent statement" value={consent} onChange={(v) => change(setConsent, v)} disabled={disabled} placeholder="What visitors agree to before submitting" multiline />
        <Select label="Captcha" value={captcha} options={[{ key: "keep", title: "Keep existing setting" }, { key: "on", title: "Require a captcha" }, { key: "off", title: "Do not require a captcha" }]} onChange={(v) => change(setCaptcha, v)} disabled={disabled} />
        <Field label="Thank-you message" value={thankYou} onChange={(v) => change(setThankYou, v)} disabled={disabled} placeholder="Shown after the visitor submits" />
      </Card>
    </> : null}
    {route.id && kind === "one_use" ? <Card title="Signed record link">
      <Select label="Existing record" value={recordId} options={(records.data?.rows ?? []).map((record) => ({ key: record.id, title: String(record.fields[schema.data?.type.titleField ?? "name"] ?? record.id) }))} disabled={disabled} onChange={(v) => { setRecordId(v); setLinkConfirm(false); }} />
      <Select label="Link use" value={singleUse} options={[{ key: "once", title: "Use once" }, { key: "reusable", title: "Reusable until it expires" }]} disabled={disabled} onChange={(v) => { setSingleUse(v); setLinkConfirm(false); }} />
      <Field label="Expires in hours" value={expires} disabled={disabled} onChange={(v) => { setExpires(v); setLinkConfirm(false); }} />
      {linkConfirm ? <><Text style={s.text}>This link lets its holder update the selected record's missing form fields.</Text><View style={s.actions}><Button title="Cancel" onPress={() => setLinkConfirm(false)} /><Button title="Confirm signed link" disabled={disabled} onPress={() => void perform(async () => { const out = await mutate(d, "forms.link_create", { formId: route.id, recordId, singleUse: singleUse === "once", expiresInHours: Number(expires) }, key); setLink(out.url); setLinkConfirm(false); })} /></View></> : <Button title="Review signed link" disabled={disabled || !recordId} onPress={() => setLinkConfirm(true)} />}
      {link ? <Text selectable style={s.text}>{link}</Text> : null}
    </Card> : null}
    <View style={s.actions}><Button title={route.id ? "Save changes" : "Create draft"} testID="apps-save-form" primary disabled={disabled || !name.trim() || !type || kind === "booking" && !d.me} onPress={() => void perform(save)} />
      {route.id ? <Button title="Preview publishing" disabled={disabled || dirty} testID="apps-preview-form" onPress={() => { setPreview(true); setPublished(null); }} /> : null}
      {route.id && form.data?.form.state === "published" ? <Button title="Unpublish" disabled={disabled} onPress={() => void perform(async () => { await mutate(d, "forms.unpublish", { formId: route.id }, key); setNotice("The public form is closed."); form.refresh(); })} /> : null}
    </View>
    {notice ? <Text style={s.text}>{notice}</Text> : null}
    {preview && route.id ? <Card title="Publish this saved form?">
      <Text style={s.text}>Publishing makes the saved form public. Save any edits before continuing.</Text>
      {(form.data?.fields ?? []).filter((f) => f.mode !== "hide").map((f) => <Row key={f.field} id={`preview-${f.field}`} title={schema.data?.type.fields.find((s) => s.key === f.field)?.title ?? f.field} note={f.mode === "ask" ? "Visitor answers this question" : "Prefilled value"} />)}
      <Text style={s.text}>{form.data?.settings.consentText || "No consent statement"}</Text><Text style={s.text}>{form.data?.settings.captcha ? "Captcha required" : "Captcha not required"}</Text>
      <View style={s.actions}><Button title="Cancel" onPress={() => setPreview(false)} /><Button title="Confirm publish" testID="apps-confirm-publish" disabled={disabled} primary onPress={() => void perform(async () => { const out = await mutate(d, "forms.publish", { formId: route.id }, key); if (out.status === "held") { d.nav.openTask(out.taskId); return; } setPublished(out); setPreview(false); form.refresh(); })} /></View>
    </Card> : null}
    {published ? <Card title="Published form"><Text selectable style={s.text}>{published.url}</Text><Text selectable style={s.text}>{published.embed}</Text></Card> : null}
  </Frame>;
}
