import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useAppsData } from "./data.tsx";
import { actionKey, errorMessage, mutate } from "./mutations.ts";
import { Button, Card, Field, Frame, Select, s, useOnline, useRead } from "./editor-ui.tsx";
import { CampaignEmail } from "./CampaignEmail.tsx";
import type { AppsRoute } from "./routes.ts";
type Campaign = CapMap["campaigns.get"]["out"];
type Step = Campaign["steps"][number];
const STEP_TYPES = ["email", "wait", "branch", "sms", "task", "call_task"];
export function CampaignEditor({ route, back }: { route: AppsRoute; back(): void }): ReactElement {
  const d = useAppsData(), online = useOnline();
  const campaign = useRead<Campaign>(route.id ? "campaigns.get" : null, { campaignId: route.id }, "campaigns");
  const types = useRead<CapMap["schema.types.list"]["out"]>("schema.types.list", {}, "campaigns");
  const boxes = useRead<CapMap["mail.mailbox.list"]["out"]>(route.id ? "mail.mailbox.list" : null, {}, "campaigns");
  const [name, setName] = useState(""), [kind, setKind] = useState("one_time");
  const [type, setType] = useState(""), [viewId, setViewId] = useState("");
  const [triggerType, setTriggerType] = useState(""), [triggerEvent, setTriggerEvent] = useState("record.created");
  const views = useRead<CapMap["views.list"]["out"]>(type ? "views.list" : null, { type }, "campaigns");
  const [steps, setSteps] = useState<Step[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState("09:00"), [to, setTo] = useState("17:00"), [zone, setZone] = useState("UTC"), [days, setDays] = useState("1,2,3,4,5"), [throttle, setThrottle] = useState("50"), [stopOnReply, setStopOnReply] = useState("on");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [key, setKey] = useState(actionKey), [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<CapMap["campaigns.preview"]["out"] | null>(null);
  useEffect(() => { setPreview(null); if (campaign.data && !dirty) {
    setName(campaign.data.campaign.name); setKind(campaign.data.campaign.kind); setSteps(campaign.data.steps); setViewId(campaign.data.audienceViewId ?? "");
    const w = campaign.data.windows as { from?: string; to?: string; tz?: string; days?: number[] } | undefined;
    if (w) { setFrom(w.from ?? "09:00"); setTo(w.to ?? "17:00"); setZone(w.tz ?? "UTC"); setDays((w.days ?? [1,2,3,4,5]).join(",")); }
    const t = campaign.data.throttle as { perHour?: number; stopOnReply?: boolean } | undefined;
    if (t) { setThrottle(String(t.perHour ?? 50)); setStopOnReply(t.stopOnReply === false ? "off" : "on"); }
  } }, [campaign.data]);
  const run = async (work: () => Promise<void>): Promise<void> => { setBusy(true); setError(null); try { await work(); setKey(actionKey()); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  const change = <T,>(set: (v: T) => void, v: T): void => { set(v); setDirty(true); setPreview(null); setNotice(""); };
  const disabled = !online || busy;
  const updateStep = (step: Step): void => change(setSteps, steps.map((s) => s.key === step.key ? step : s));
  const step = steps.find((s) => s.key === selected);
  const save = async (): Promise<void> => {
    if (!route.id) { const out = await mutate(d, "campaigns.create", { name: name.trim(), kind }, key); d.nav.open("campaigns", out.campaign.campaignId); return; }
    await mutate(d, "campaigns.update", { campaignId: route.id, name: name.trim() }, key);
    await mutate(d, "campaigns.steps_set", { campaignId: route.id, steps }, key);
    const editedAB = steps.filter((step) => step.type === "email" && Object.hasOwn(step.config, "subjectB"));
    if (editedAB.length) {
      const editedKeys = new Set(editedAB.map((step) => step.key));
      const existing = Array.isArray(campaign.data?.variants) ? campaign.data.variants as Array<{ key: string; weight: number; stepKey: string; config: Record<string, unknown> }> : [];
      const variants = [...existing.filter((variant) => !editedKeys.has(variant.stepKey)), ...editedAB.flatMap((step) => typeof step.config.subjectB === "string" && step.config.subjectB ? [{ key: `${step.key}_a`, weight: 50, stepKey: step.key, config: { subject: step.config.subject } }, { key: `${step.key}_b`, weight: 50, stepKey: step.key, config: { subject: step.config.subjectB } }] : [])];
      await mutate(d, "campaigns.variants_set", { campaignId: route.id, variants }, key);
    }
    await mutate(d, "campaigns.schedule_set", { campaignId: route.id, windows: { from, to, tz: zone, days: days.split(",").map((n) => Number(n.trim())) }, throttlePerHour: Number(throttle), stopOnReply: stopOnReply === "on" }, key);
    setDirty(false); setNotice("Saved the campaign steps and send settings."); campaign.refresh();
  };
  return <Frame testID={route.id ? "apps-campaign-detail" : "apps-create-campaign"} title={route.id ? name || "Campaign" : "New campaign"} back={back} offline={!online} error={error ?? campaign.error ?? types.error ?? views.error ?? boxes.error} loading={campaign.loading} retry={campaign.refresh}>
    <Card title="Campaign"><Field label="Campaign name" value={name} onChange={(v) => change(setName, v)} disabled={disabled} />{!route.id ? <Select label="Campaign kind" value={kind} options={[{ key: "one_time", title: "One-time campaign" }, { key: "sequence", title: "Sequence" }, { key: "triggered", title: "Triggered campaign" }]} onChange={setKind} disabled={disabled} /> : <Text style={s.text}>{`${kind} · ${campaign.data?.campaign.state ?? ""} · ${campaign.data?.campaign.audienceCount ?? 0} recipients`}</Text>}</Card>
    {route.id ? <>
      <Card title="Audience"><Text style={s.text}>Choose a saved record view, or all accessible records of one type. Saving screens out suppressed and do-not-contact recipients.</Text>
        <Select label="Audience record type" value={type} options={(types.data?.types ?? []).map((t) => ({ key: t.key, title: t.title }))} onChange={(v) => { setType(v); setViewId(""); setPreview(null); }} disabled={disabled} />
        {type ? <Select label="Saved audience view" value={viewId} options={[{ key: "", title: "All accessible records" }, ...(views.data?.views ?? []).map((v) => ({ key: v.viewId, title: v.title }))]} onChange={(v) => { setViewId(v); setPreview(null); }} disabled={disabled} /> : null}
        <Button title="Set audience" testID="apps-set-audience" disabled={disabled || !type} onPress={() => void run(async () => { const out = await mutate(d, "campaigns.audience_set", { campaignId: route.id, type, ...(viewId ? { viewId } : {}) }, key); setPreview(null); setNotice(`${out.count} recipients, ${out.excluded} excluded.`); campaign.refresh(); })} />
      </Card>
      {kind === "triggered" ? <Card title="Trigger"><Select label="Trigger record type" value={triggerType} options={(types.data?.types ?? []).map((t) => ({ key: t.key, title: t.title }))} disabled={disabled} onChange={setTriggerType} /><Select label="When to start" value={triggerEvent} options={[{ key: "record.created", title: "A record is created" }, { key: "record.updated", title: "A record changes" }]} disabled={disabled} onChange={setTriggerEvent} /><Button title="Set trigger" disabled={disabled || !triggerType} onPress={() => void run(async () => { await mutate(d, "campaigns.update", { campaignId: route.id, settings: { trigger: { type: triggerType, event: triggerEvent } } }, key); setNotice("Saved the campaign trigger."); setPreview(null); })} /></Card> : null}
      <Card title="Steps">
        {steps.map((st) => <Row key={st.key} id={st.key} title={String(st.config.subject ?? st.config.title ?? st.type)} note={`${st.key} · ${st.type}`} selected={selected === st.key} onPress={() => setSelected(st.key)} />)}
        <Select label="Add step" value="" options={STEP_TYPES.map((key) => ({ key, title: key.replace("_", " ") }))} disabled={disabled} onChange={(type) => { const key = `step_${steps.length + 1}_${actionKey().slice(0, 6)}`; const config = type === "wait" ? { days: 1 } : type === "branch" ? { on: "reply" } : {}; change(setSteps, [...steps, { key, type: type as Step["type"], config }]); setSelected(key); }} />
      </Card>
      {step ? <Card title={`Edit ${step.type} step`}>
        {step.type === "email" ? <><Select label="Sending mailbox" value={String(step.config.mailboxId ?? "")} options={(boxes.data?.mailboxes ?? []).map((b) => ({ key: b.id, title: b.address }))} onChange={(mailboxId) => updateStep({ ...step, config: { ...step.config, mailboxId } })} disabled={disabled} /><CampaignEmail key={step.key} step={step} onChange={(config) => updateStep({ ...step, config: { ...step.config, ...config } })} /></> : step.type === "wait" ? <Field label="Wait in days" value={String(step.config.days ?? 1)} onChange={(v) => updateStep({ ...step, config: { days: Number(v) } })} disabled={disabled} /> : step.type === "branch" ? <><Select label="Branch condition" value={String(step.config.on ?? "reply")} options={["reply", "open", "click"].map((key) => ({ key, title: key }))} onChange={(on) => updateStep({ ...step, config: { on } })} disabled={disabled} /><Select label="If yes" value={step.next?.[0] ?? ""} options={steps.filter((s) => s.key !== step.key).map((s) => ({ key: s.key, title: s.key }))} onChange={(v) => updateStep({ ...step, next: [v, step.next?.[1] ?? ""] })} disabled={disabled} /><Select label="If no" value={step.next?.[1] ?? ""} options={steps.filter((s) => s.key !== step.key).map((s) => ({ key: s.key, title: s.key }))} onChange={(v) => updateStep({ ...step, next: [step.next?.[0] ?? "", v] })} disabled={disabled} /></> : step.type === "sms" ? <><Field label="Sending phone number ID" value={String(step.config.numberId ?? "")} onChange={(numberId) => updateStep({ ...step, config: { ...step.config, numberId } })} disabled={disabled} /><Field label="SMS message" multiline value={String(step.config.body ?? "")} onChange={(body) => updateStep({ ...step, config: { ...step.config, body } })} disabled={disabled} /></> : <Field label="Task title" value={String(step.config.title ?? "")} onChange={(title) => updateStep({ ...step, config: { ...step.config, title } })} disabled={disabled} />}
        {step.type !== "branch" ? <Select label="Next step" value={step.next?.[0] ?? ""} options={[{ key: "", title: "Continue in sequence" }, ...steps.filter((s) => s.key !== step.key).map((s) => ({ key: s.key, title: s.key }))]} onChange={(v) => { const { next: _next, ...rest } = step; updateStep(v ? { ...rest, next: [v] } : rest); }} disabled={disabled} /> : null}
        <Button title="Remove this step" disabled={disabled} onPress={() => { change(setSteps, steps.filter((s) => s.key !== step.key)); setSelected(null); }} />
      </Card> : null}
      <Card title="Send settings"><Field label="Send window starts (HH:MM)" value={from} onChange={(v) => change(setFrom, v)} disabled={disabled} /><Field label="Send window ends (HH:MM)" value={to} onChange={(v) => change(setTo, v)} disabled={disabled} /><Field label="Time zone" value={zone} onChange={(v) => change(setZone, v)} disabled={disabled} /><Field label="Send days (0 Sunday through 6 Saturday)" value={days} onChange={(v) => change(setDays, v)} disabled={disabled} /><Field label="Messages per hour" value={throttle} onChange={(v) => change(setThrottle, v)} disabled={disabled} /><Select label="Stop when a recipient replies" value={stopOnReply} options={[{ key: "on", title: "Stop on reply" }, { key: "off", title: "Keep following the sequence" }]} onChange={(v) => change(setStopOnReply, v)} disabled={disabled} /></Card>
    </> : null}
    <View style={s.actions}><Button title={route.id ? "Save campaign" : "Create draft"} testID="apps-save-campaign" primary disabled={disabled || !name.trim()} onPress={() => void run(save)} />
      {route.id && ["draft", "scheduled", "paused"].includes(campaign.data?.campaign.state ?? "") ? <Button title={campaign.data?.campaign.state === "paused" ? "Preview resume" : "Preview launch"} testID="apps-preview-campaign" disabled={disabled || dirty} onPress={() => void run(async () => { setPreview(await d.call("campaigns.preview", { campaignId: route.id }) as CapMap["campaigns.preview"]["out"]); })} /> : null}
      {route.id && campaign.data?.campaign.state === "running" ? <Button title="Pause campaign" disabled={disabled} onPress={() => void run(async () => { await mutate(d, "campaigns.pause", { campaignId: route.id }, key); campaign.refresh(); })} /> : null}
    </View>
    {notice ? <Text style={s.text}>{notice}</Text> : null}
    {preview && route.id ? <Card title="Launch this saved campaign?"><Text style={s.text}>{`${preview.counts.audience} recipients · ${preview.counts.excluded} excluded · ${preview.counts.suppressed} suppressed`}</Text><Text style={s.text}>{preview.sample.subject}</Text><Text selectable style={s.text}>{preview.sample.body}</Text><Text style={s.text}>Launch asks for approval before messages leave this Space.</Text><View style={s.actions}><Button title="Cancel" onPress={() => setPreview(null)} /><Button title={campaign.data?.campaign.state === "paused" ? "Confirm resume" : "Confirm launch"} testID="apps-confirm-launch" primary disabled={disabled || dirty} onPress={() => void run(async () => { const out = await mutate(d, campaign.data?.campaign.state === "paused" ? "campaigns.resume" : "campaigns.launch", { campaignId: route.id }, key); if (out.status === "held") { d.nav.openTask(out.taskId); setNotice("The launch is waiting for approval."); } else { setNotice(campaign.data?.campaign.state === "paused" ? "Resumed the campaign." : "Campaign launch started."); } setPreview(null); campaign.refresh(); })} /></View></Card> : null}
  </Frame>;
}
