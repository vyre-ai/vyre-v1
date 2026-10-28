import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { FormDesign } from "./FormDesign.tsx";
import { choicesOf } from "./form-design.ts";
import type { Choice } from "./form-design.ts";
import { FormWorkspace } from "./FormWorkspace.tsx";
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
  const [css, setCss] = useState("");
  const [theme, setTheme] = useState<Record<string, unknown>>({}), [logic, setLogic] = useState<unknown>(null);
  const [answers, setAnswers] = useState<Record<string,unknown>>({});
  const [relations, setRelations] = useState<Record<string,Choice[]>>({});
  const [relationError, setRelationError] = useState("");
  const [previewStep,setPreviewStep]=useState("all");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false), [notice, setNotice] = useState("");
  const [published, setPublished] = useState<{ url: string; embed: string } | null>(null);
  const [key, setKey] = useState(actionKey);
  const [selectedField, setSelectedField] = useState("");
  const [recordId, setRecordId] = useState(""), [singleUse, setSingleUse] = useState("once"), [expires, setExpires] = useState("48"), [linkConfirm, setLinkConfirm] = useState(false), [link, setLink] = useState("");
  const records = useRead<CapMap["records.query"]["out"]>(route.id && kind === "one_use" && type ? "records.query" : null, { type, limit: 50 });
  const schema = useRead<CapMap["schema.types.get"]["out"]>(type ? "schema.types.get" : null, { type });
  useEffect(() => { if (form.data && !dirty) { setName(form.data.form.name); setType(form.data.form.recordType); setKind(form.data.form.kind); setFields(form.data.fields); setCss(form.data.css ?? ""); setTheme(form.data.theme ?? {}); setLogic(form.data.logic ?? null); setConsent(form.data.settings.consentText); setCaptcha(form.data.settings.captcha ? "on" : "off"); setThankYou(form.data.settings.thankYou?.text ?? ""); setDirty(false); setPreview(false); } }, [form.data]);
  useEffect(() => {
    let live=true;
    const targets=(schema.data?.type.fields??[]).filter((field)=>field.type==='relation'&&typeof field.options?.target==='string'&&fields.some((f)=>f.field===field.key&&f.mode!=='hide'));
    setRelationError("");
    void Promise.all(targets.map(async(field)=>{
      const target=String(field.options!.target);
      const [definition,result]=await Promise.all([d.call('schema.types.get',{type:target}) as Promise<CapMap['schema.types.get']['out']>,d.call('records.query',{type:target,limit:50}) as Promise<CapMap['records.query']['out']>]);
      return [field.key,result.rows.map((row)=>({key:row.id,title:String(row.fields[definition.type.titleField]??'Untitled record')}))] as const;
    })).then((entries)=>{if(live)setRelations(Object.fromEntries(entries));}).catch((e)=>{if(live){setRelations({});setRelationError(errorMessage(e));}});
    return ()=>{live=false;};
  },[d,schema.data,fields]);
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
    await mutate(d, "forms.design_set", { formId: route.id, thankYou: { text: thankYou }, css, theme, logic }, key);
    setDirty(false); setNotice("Saved the form."); form.refresh();
  };
  const selected=schema.data?.type.fields.find((field)=>field.key===selectedField);
  const selectedOptions=selected ? selected.type==='relation' ? relations[selected.key]??[] : ['bool','boolean','checkbox'].includes(selected.type) ? [{key:'true',title:'Yes'},{key:'false',title:'No'}] : choicesOf(selected) : [];
  const setAnswer=(value:string):void=>setAnswers({...answers,[selectedField]:selected?.type==='multichoice'?(Array.isArray(answers[selectedField])?(answers[selectedField] as string[]).includes(value)?(answers[selectedField] as string[]).filter((v)=>v!==value):[...(answers[selectedField] as string[]),value]:[value]):value});
  const moveQuestion=(direction:number):void=>{const index=fields.findIndex((f)=>f.field===selectedField),next=index+direction;if(index<0||next<0||next>=fields.length)return;const copy=[...fields];[copy[index],copy[next]]=[copy[next]!,copy[index]!];change(setFields,copy);};
  const questions = (<Card title={`Fields of ${schema.data?.type.title ?? "this record type"}`}>
        <View>{(schema.data?.type.fields ?? []).map((field) => <Row key={field.key} id={field.key} title={field.title} onPress={() => setSelectedField(field.key)} trailing={<View style={{ width: 60 }}><Select compact label={`Mode for ${field.title}`} value={fields.find((f) => f.field === field.key)?.mode ?? "hide"} options={[{ key: "ask", title: "Ask" }, { key: "show", title: "Show" }, { key: "hide", title: "Hide" }]} disabled={disabled} onChange={(mode) => change(setFields, [...fields.filter((f) => f.field !== field.key), { ...fields.find((f) => f.field === field.key), field: field.key, mode: mode as Modes[number]["mode"] }])} /></View>} />)}</View>
        {selectedField ? <><Field label={`Prefill key for ${selectedField}`} value={fields.find((f) => f.field === selectedField)?.prefillKey ?? ""} disabled={disabled} onChange={(value) => { const field = fields.find((f) => f.field === selectedField) ?? { field: selectedField, mode: "hide" as const }; const { prefillKey: _prefillKey, ...rest } = field; change(setFields, [...fields.filter((f) => f.field !== selectedField), value ? { ...rest, prefillKey: value } : rest]); }} /><Field label={`Page number for ${selectedField}`} value={String(fields.find((f) => f.field === selectedField)?.step ?? 0)} disabled={disabled} onChange={(value) => { const field = fields.find((f) => f.field === selectedField) ?? { field: selectedField, mode: "hide" as const }; change(setFields, [...fields.filter((f) => f.field !== selectedField), { ...field, step: Number(value) }]); }} /></> : null}
        {selected ? <><Text style={s.text}>Preview answer for {selected.title}. This does not change a record.</Text>{selectedOptions.length?<Select label="Preview answer" value={selected.type==='multichoice'?'':String(answers[selectedField]??'')} options={[{key:'',title:'No answer'},...selectedOptions]} onChange={setAnswer}/>:<Field label="Preview answer" value={Array.isArray(answers[selectedField])?(answers[selectedField] as string[]).join(','):String(answers[selectedField]??'')} onChange={setAnswer}/>}<Text style={s.text}>{selected.type==='multichoice'&&Array.isArray(answers[selectedField])?selectedOptions.filter((o)=>(answers[selectedField] as string[]).includes(o.key)).map((o)=>o.title).join(', '):''}</Text><View style={s.actions}><Button title="Move question earlier" disabled={disabled||fields.findIndex((f)=>f.field===selectedField)<=0} onPress={()=>moveQuestion(-1)}/><Button title="Move question later" disabled={disabled||fields.findIndex((f)=>f.field===selectedField)<0||fields.findIndex((f)=>f.field===selectedField)>=fields.length-1} onPress={()=>moveQuestion(1)}/></View></>:null}
        <Text style={s.text}>Select a question to edit its prefill key and page number. Ask collects an answer. Show displays a prefilled value. Hide leaves the field off this form.</Text>
      </Card>);
  const controls = (<View style={s.actions}><Button title={route.id ? "Save changes" : "Create draft"} testID="apps-save-form" primary disabled={disabled || !name.trim() || !type || kind === "booking" && !d.me} onPress={() => void perform(save)} />
      {route.id ? <Button title="Preview publishing" disabled={disabled || dirty} testID="apps-preview-form" onPress={() => { setPreview(true); setPublished(null); }} /> : null}
      {route.id && form.data?.form.state === "published" ? <Button title="Unpublish" disabled={disabled} onPress={() => void perform(async () => { await mutate(d, "forms.unpublish", { formId: route.id }, key); setNotice("The public form is closed."); form.refresh(); })} /> : null}
    </View>);
  const content = <>
    <Card title="Form settings">
      <Field label="Form name" value={name} onChange={(v) => change(setName, v)} disabled={disabled} />
      {!route.id ? <><Select label="Record type" value={type} options={(types.data?.types ?? []).map((t) => ({ key: t.key, title: t.title }))} onChange={(v) => change(setType, v)} disabled={disabled} /><Select label="Form kind" value={kind} options={[{ key: "public", title: "Public form" }, { key: "one_use", title: "One-use link" }, { key: "survey", title: "Survey" }, { key: "booking", title: "Booking page" }]} onChange={(v) => change(setKind, v)} disabled={disabled} />
        {kind === "booking" ? <><Text style={s.text}>{`Host: ${d.me?.name ?? "Sign in to select a host"}`}</Text><Field label="Meeting length in minutes" value={minutes} onChange={setMinutes} disabled={disabled} /><Field label="Buffer in minutes" value={buffer} onChange={setBuffer} disabled={disabled} /></> : null}</> : <Text style={s.text}>{`Writes to ${schema.data?.type.title ?? type} · ${kind === "public" ? "Public link" : kind === "one_use" ? "One-use link" : kind === "booking" ? "Booking page" : "Survey"} · ${form.data?.form.state === "published" ? "Published" : "Draft"}`}</Text>}
    </Card>
    {route.id ? <>
      <Card title="Consent and finish">
        <Field label="Consent statement" value={consent} onChange={(v) => change(setConsent, v)} disabled={disabled} placeholder="What visitors agree to before submitting" multiline />
        <Select label="Captcha" value={captcha} options={[{ key: "keep", title: "Keep existing setting" }, { key: "on", title: "Require a captcha" }, { key: "off", title: "Do not require a captcha" }]} onChange={(v) => change(setCaptcha, v)} disabled={disabled} />
        <Field label="Thank-you message" value={thankYou} onChange={(v) => change(setThankYou, v)} disabled={disabled} placeholder="Shown after the visitor submits" />
      </Card>
    </> : null}
    {route.id ? <><FormDesign fields={schema.data?.type.fields??[]} theme={theme} logic={logic} onTheme={(v)=>change(setTheme,v)} onLogic={(v)=>change(setLogic,v)} disabled={disabled}/><Select label="Preview page" value={previewStep} options={[{key:'all',title:'All pages'},...[...new Set(fields.map((f)=>f.step??0))].sort((a,b)=>a-b).map((page)=>({key:String(page),title:`Page ${page+1}`}))]} onChange={setPreviewStep}/>{relationError?<Text accessibilityRole="alert" style={s.text}>{relationError}</Text>:null}</>:null}
    {route.id && kind === "one_use" ? <Card title="Signed record link">
      <Select label="Existing record" value={recordId} options={(records.data?.rows ?? []).map((record) => ({ key: record.id, title: String(record.fields[schema.data?.type.titleField ?? "name"] ?? record.id) }))} disabled={disabled} onChange={(v) => { setRecordId(v); setLinkConfirm(false); }} />
      <Select label="Link use" value={singleUse} options={[{ key: "once", title: "Use once" }, { key: "reusable", title: "Reusable until it expires" }]} disabled={disabled} onChange={(v) => { setSingleUse(v); setLinkConfirm(false); }} />
      <Field label="Expires in hours" value={expires} disabled={disabled} onChange={(v) => { setExpires(v); setLinkConfirm(false); }} />
      {linkConfirm ? <><Text style={s.text}>This link lets its holder update the selected record's missing form fields.</Text><View style={s.actions}><Button title="Cancel" onPress={() => setLinkConfirm(false)} /><Button title="Confirm signed link" disabled={disabled} onPress={() => void perform(async () => { const out = await mutate(d, "forms.link_create", { formId: route.id, recordId, singleUse: singleUse === "once", expiresInHours: Number(expires) }, key); setLink(out.url); setLinkConfirm(false); })} /></View></> : <Button title="Review signed link" disabled={disabled || !recordId} onPress={() => setLinkConfirm(true)} />}
      {link ? <Text selectable style={s.text}>{link}</Text> : null}
    </Card> : null}
    {!route.id ? controls : null}
    {notice ? <Text style={s.text}>{notice}</Text> : null}
    {preview && route.id ? <Card title="Publish this saved form?">
      <Text style={s.text}>Publishing makes the saved form public. Save any edits before continuing.</Text>
      {(form.data?.fields ?? []).filter((f) => f.mode !== "hide").map((f) => <Row key={f.field} id={`preview-${f.field}`} title={schema.data?.type.fields.find((s) => s.key === f.field)?.title ?? f.field} note={f.mode === "ask" ? "Visitor answers this question" : "Prefilled value"} />)}
      <Text style={s.text}>{form.data?.settings.consentText || "No consent statement"}</Text><Text style={s.text}>{form.data?.settings.captcha ? "Captcha required" : "Captcha not required"}</Text>
      <View style={s.actions}><Button title="Cancel" onPress={() => setPreview(false)} /><Button title="Confirm publish" testID="apps-confirm-publish" disabled={disabled} primary onPress={() => void perform(async () => { const out = await mutate(d, "forms.publish", { formId: route.id }, key); if (out.status === "held") { d.nav.openTask(out.taskId); return; } setPublished(out); setPreview(false); form.refresh(); })} /></View>
    </Card> : null}
    {published ? <Card title="Published form"><Text selectable style={s.text}>{published.url}</Text><Text selectable style={s.text}>{published.embed}</Text></Card> : null}
  </>;
  const frame = { title: route.id ? name || "Form" : "New form", back, offline: !online, error: error ?? form.error ?? types.error ?? schema.error, loading: form.loading && form.data === null, retry: form.refresh };
  return route.id ? <FormWorkspace {...frame} fields={schema.data?.type.fields ?? []} modes={fields} previewOptions={{theme,logic,answers,relations,...(previewStep==='all'?{}:{step:Number(previewStep)})}} consent={consent} ask={d.assistantId ? () => void perform(async () => { const out = await d.call("chat.start", { kind: "ask", agentIds: [d.assistantId], scopeType: "form", scopeId: route.id, title: name, idempotencyKey: key }) as { thread: { id: string; threadId?: string } }; d.nav.openThread(out.thread.threadId ?? out.thread.id); }) : undefined} css={css} onCss={(v) => change(setCss, v)} rail={questions} actions={controls}>{content}</FormWorkspace> : <Frame {...frame} testID="apps-create-form">{content}</Frame>;
}
