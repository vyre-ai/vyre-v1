import { createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import { Tip, Info } from "../../../../../ui/src/Tip/index.tsx";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import type { CapMap } from "../../../../../generated/types.ts";
import { pendingAction, safeDownload } from "./infra-model.ts";
import { States } from "../../../../../ui/src/States/index.tsx";
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import { useConsoleData } from "../shell/data.tsx";
import { Lead, PageHelpContext, useInGroup } from "../shell/ui.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Glyph } from "../shell/glyphs.tsx";

export function useRead<T>(cap: string, input: Record<string, unknown> = {}, options: { direct?: boolean; enabled?: boolean } = {}) {
  const { call, screens } = useConsoleData();
  const key = JSON.stringify(input);
  const enabled = options.enabled !== false;
  const query = useMemo(() => !enabled || options.direct ? undefined : (screens as { capQuery?: (cap: string, input: Record<string, unknown>) => LiveQuery<T> }).capQuery?.(cap, JSON.parse(key)), [screens, cap, key, options.direct, enabled]);
  const never = useMemo<LiveQuery<T>>(() => { const loading: QueryState<T> = { status: "loading" }; return { subscribe: () => () => undefined, getSnapshot: () => loading }; }, []);
  const snapshot = useSyncExternalStore((query ?? never).subscribe, (query ?? never).getSnapshot, (query ?? never).getSnapshot);
  const [revision, setRevision] = useState(0);
  const stateKey=cap+key;
  const [state, setState] = useState<{ key?:string; data?: T; error?: string }>({});
  const refresh = useCallback(() => { (screens as { invalidate?: () => void }).invalidate?.(); setRevision((n) => n + 1); }, [screens]);
  useEffect(() => {
    if (query || !enabled) return;
    let alive = true;
    void call(cap, JSON.parse(key)).then((data) => { if (alive) setState({key:stateKey, data: data as T }); }, () => { if (alive) setState({key:stateKey, error: "Couldn’t load this page. Check access and try again." }); });
    return () => { alive = false; };
  }, [call, cap, key, revision, query, stateKey, enabled]);
  if (!enabled) return {data: undefined, error: undefined, refresh};
  return query ? { data: snapshot.status === "ready" ? snapshot.data : undefined, error: snapshot.status === "loading" && snapshot.error ? "Couldn’t load this page. Check access and try again." : undefined, refresh } : { ...(state.key===stateKey?state:{}), refresh };
}
export function useAction(refresh: () => void) {
  const { call, connection } = useConsoleData();
  const retryKey = useRef<{ digest: string; key: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const run = async <T,>(cap: string, input: unknown, success: string | ((out: T) => string | Promise<string>)): Promise<T | undefined> => {
    if (inflight.current) return undefined;
    if(connection?.get()==='offline'){setNote('Reconnect to this Space before changing it.');return undefined;}
    let payload=input;
    const value=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:null;
    if(value&&('idempotencyKey' in value||['health.support_bundle','backup.run','backup.export_start','spaces.export'].includes(cap))){
      const {idempotencyKey:_key,...rest}=value;const digest=cap+JSON.stringify(rest);
      if(retryKey.current?.digest!==digest)retryKey.current={digest,key:attempt()};
      payload={...rest,idempotencyKey:retryKey.current.key};
    }
    inflight.current = true; setBusy(true); setNote("");
    try { const out = await call(cap, payload);const pending=pendingAction(out);if(pending){setNote(pending);return undefined;}const status=out as {status?:string;message?:string};if(status?.status==='failed'||status?.status==='error')throw new Error(status.message??'This action failed.'); setNote(typeof success === "function" ? await success(out as T) : success); retryKey.current=null;refresh(); return out as T; }
    catch (e) { const error = e as { code?: string; traceId?: string; message?: string }; setNote(`${error.message ?? "Couldn’t complete this action"}${error.code ? ` (${error.code})` : ""}.${error.traceId ? ` Trace ${error.traceId}` : ""}`); return undefined; }
    finally { inflight.current = false; setBusy(false); }
  };
  return { note, busy, run };
}
export function Field({ label, value, onChange, testID, secure = false, multiline = false }: { label: string; value: string; onChange: (value: string) => void; testID?: string; secure?: boolean; multiline?: boolean }): ReactElement {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput multiline={multiline} value={value} onChangeText={onChange} accessibilityLabel={label} testID={testID} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} style={s.input} /></View>;
}
/** `why`: a disabled button says why as its tooltip, so nobody meets a dead button without a reason and no sentence sits beside it. */
export function Button({ label, onPress, disabled = false, testID, danger = false, why }: { label: string; onPress: () => void; disabled?: boolean; testID?: string; danger?: boolean; why?: string }): ReactElement {
  const button = <Pressable accessibilityRole="button" accessibilityState={{ disabled }} {...(disabled && why ? { accessibilityHint: why } : {})} onPress={onPress} disabled={disabled} testID={testID} style={[s.button, { alignSelf: "flex-start" }, disabled && { opacity: 0.5 }]}><Text style={[s.buttonText, danger && { color: "var(--danger)" as string }]}>{label}</Text></Pressable>;
  return disabled && why ? <Tip help={why}>{button}</Tip> : button;
}
/** A help sentence as a quiet info mark with the sentence in its tooltip. */
export function Help({ children }: { children: string }): ReactElement | null {
  const inGroup = useInGroup();
  const register = useContext(PageHelpContext);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (!register || inGroup) return undefined;
    setMoved(true);
    const off = register(children);
    return () => { off(); setMoved(false); };
  }, [register, inGroup, children]);
  if (inGroup) return <View style={{ position: "absolute", top: 6, right: 8, zIndex: 1 }}><Info help={children} /></View>;
  return moved ? null : <Info help={children} />;
}
export function Actions({ children }: { children: ReactNode }): ReactElement { return <View style={s.actions}>{children}</View>; }
export function Note({ children }: { children: ReactNode }): ReactElement { return <Text accessibilityRole="status" style={s.note}>{children}</Text>; }
export function ReadState({ error, retry }: { error?: string | undefined; retry: () => void }): ReactElement { return error ? <States kind="error" message={error} retryable onRetry={retry} /> : <Text accessibilityRole="progressbar">Loading…</Text>; }
export function Select({label,value,options,onChange,disabled=false}:{label:string;value:string;options:readonly {key:string;title:string}[];onChange(value:string):void;disabled?:boolean}):ReactElement{
 const menu=useMenu();return <View style={s.field}><Text style={s.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} style={s.button} onPress={(event)=>{const rect=(event.currentTarget as unknown as {getBoundingClientRect?():{left:number;bottom:number}})?.getBoundingClientRect?.();menu.show(options.map((item)=>({label:item.title,checked:item.key===value,onSelect:()=>onChange(item.key)})),rect?.left??20,rect?.bottom??100,'other');}}><View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}}><Text style={[s.buttonText,{flexShrink:1}]} numberOfLines={1}>{options.find((item)=>item.key===value)?.title??(value||'Choose…')}</Text><Glyph name="chevD" size={11} color="var(--ink-3)"/></View></Pressable>{menu.element}</View>;
}
/** A whole number you nudge with - and +, with its explanation as a tooltip. */
export function Stepper({ label, value, onChange, min = 1, max = 999, help }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; help?: string }): ReactElement {
  const step = (by: number): void => onChange(Math.min(max, Math.max(min, value + by)));
  const btn = (text: string, by: number, off: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${by < 0 ? "Fewer" : "More"} ${label}`} disabled={off} onPress={() => step(by)} testID={`step-${by < 0 ? "down" : "up"}`} style={[s.button, { width: 32, alignItems: "center", opacity: off ? 0.4 : 1 }]}><Text style={s.buttonText}>{text}</Text></Pressable>
  );
  return (
    <Tip help={help}>
      <View style={[s.field, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <Text style={s.label}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{btn("-", -1, value <= min)}<Text testID="step-value" style={{ minWidth: 28, textAlign: "center", fontSize: 14, color: "var(--ink)" as string }}>{value}</Text>{btn("+", 1, value >= max)}</View>
      </View>
    </Tip>
  );
}
/** The props of a pick list row you tap: a face, a name, a check when chosen. Spread into a Row; never a Select button per row. */
export function pickRow({ id, title, note, face, picked, disabled = false, onPress }: { id: string; title: string; note?: string | undefined; face?: ReactNode; picked: boolean; disabled?: boolean; onPress: () => void }) {
  return { id, title, ...(note ? { note } : {}), ...(face ? { leading: <Lead>{face}</Lead> } : {}), selected: picked, onPress: () => { if (!disabled) onPress(); }, trailing: picked ? <Glyph name="check" size={14} color="var(--accent)" /> : null };
}
/** A row of views on one page ("Server logs", "Services", "Storage"): the open one is filled, the others are quiet. */
export function Segmented({ options, value, onChange }: { options: readonly { key: string; title: string }[]; value: string; onChange: (key: string) => void }): ReactElement {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 4, marginBottom: 12 }}>
      {/* ui-rows-lint: not a list (the views of one page, drawn as tabs) */}
      {options.map((o) => (
        <Pressable key={o.key} accessibilityRole="tab" accessibilityState={{ selected: o.key === value }} testID={`seg-${o.key}`} onPress={() => onChange(o.key)} style={{ height: 30, paddingHorizontal: 12, borderRadius: 7, justifyContent: "center", backgroundColor: (o.key === value ? "var(--sel)" : "transparent") as string }}>
          <Text style={{ fontSize: 13, fontWeight: o.key === value ? "600" : "400", color: (o.key === value ? "var(--ink)" : "var(--ink-3)") as string }}>{o.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}
/** The button in a section header that opens a create sheet ("New agent"). Create forms are never open on the page. */
export function NewButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }): ReactElement {
  return <Button label={label} onPress={onPress} {...(testID ? { testID } : {})} />;
}
/** A create sheet on the shared Dialog: the fields, one quiet line saying what is missing, Cancel and the one primary action. */
export function FormSheet({ title, onClose, onSubmit, submit = "Create", disabled = false, why, note, children, testID }: { title: string; onClose: () => void; onSubmit: () => void; submit?: string; disabled?: boolean; why?: string | undefined; note?: string; children: ReactNode; testID?: string }): ReactElement {
  return (
    <Dialog title={title} onClose={onClose} width={480} {...(testID ? { testID } : {})} actions={[{ label: "Cancel", onPress: onClose, testID: "sheet-cancel" }, { label: submit, primary: true, disabled, ...(why ? { why } : {}), onPress: onSubmit, testID: "sheet-submit" }]}>
      {children}
      {note ? <Info help={note} testID="sheet-help" /> : null}
    </Dialog>
  );
}
/** The model list as a picker: every model the Space can run, by its title, and Default when none is chosen. A model that is set but no longer listed still shows. */
export function ModelSelect({ label, value, onChange, none = "Default" }: { label: string; value: string; onChange: (value: string) => void; none?: string }): ReactElement {
  const list = useRead<CapMap["engine.models.list"]["out"]>("engine.models.list");
  const models = list.data?.models ?? [];
  const options = [{ key: "", title: none }, ...models.filter((m) => m.allowed || m.model === value).map((m) => ({ key: m.model, title: `${m.title} · ${m.provider}` }))];
  if (value && !options.some((o) => o.key === value)) options.push({ key: value, title: value });
  return <Select label={label} value={value} options={options} onChange={onChange} />;
}
export function useFileDownload(){
 const {call}=useConsoleData();const urls=useRef<string[]>([]);const [url,setUrl]=useState(''),[name,setName]=useState('');
 useEffect(()=>()=>{for(const item of urls.current)URL.revokeObjectURL(item);},[]);
 const read=async(fileId:string):Promise<void>=>{
  const metadata=await call('files.get',{fileId}) as {file:{name:string;size:number}};if(metadata.file.size>256*1024*1024)throw new Error('This download exceeds the browser limit.');setName(metadata.file.name);
  const chunks:Uint8Array<ArrayBuffer>[]=[];let offset=0,mime='application/octet-stream';
  for(;;){const file=await call('files.read',{fileId,as:'base64',offset,length:1024*1024}) as {base64?:string;mime:string;size:number;truncated:boolean};if(file.size!==metadata.file.size||file.base64===undefined)throw new Error('The export changed or is unavailable. Request it again.');mime=file.mime;const binary=globalThis.atob(file.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));chunks.push(bytes);offset+=bytes.length;if(!file.truncated)break;if(!bytes.length||offset>=metadata.file.size)throw new Error('The server returned an incomplete export.');}
  if(offset!==metadata.file.size)throw new Error('The export did not finish downloading.');const next=URL.createObjectURL(new Blob(chunks,{type:mime}));urls.current.push(next);setUrl(next);
 };
 return {url,name,read};
}
export function Download({url,label='Download file',name}:{url:string;label?:string;name?:string}):ReactElement{return safeDownload(url)?createElement('a',{href:url,download:name??true,target:'_blank',rel:'noopener noreferrer',style:{color:'var(--accent)',fontSize:13}},label):<Note>The server did not provide a valid download address.</Note>;}
export const attempt = (): string => globalThis.crypto.randomUUID();
const s = StyleSheet.create({ field: { gap: 6, marginVertical: 8, maxWidth: 520 }, label: { fontSize: 12, color: "var(--ink-3)" as string }, input: { height: 34, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, paddingHorizontal: 10, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string }, actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginVertical: 10 }, button: { paddingHorizontal: 12, height: 32, justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, backgroundColor: "var(--raised)" as string }, buttonText: { color: "var(--ink)" as string, fontSize: 13 }, note: { fontSize: 13, color: "var(--ink-2)" as string, marginVertical: 8 } });
