import { createElement, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import { pendingAction, safeDownload } from "./infra-model.ts";
import { States } from "../../../../../ui/src/States/index.tsx";
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import { useConsoleData } from "../shell/data.tsx";

export function useRead<T>(cap: string, input: Record<string, unknown> = {}, options: { direct?: boolean } = {}) {
  const { call, screens } = useConsoleData();
  const key = JSON.stringify(input);
  const query = useMemo(() => options.direct ? undefined : (screens as { capQuery?: (cap: string, input: Record<string, unknown>) => LiveQuery<T> }).capQuery?.(cap, JSON.parse(key)), [screens, cap, key, options.direct]);
  const never = useMemo<LiveQuery<T>>(() => { const loading: QueryState<T> = { status: "loading" }; return { subscribe: () => () => undefined, getSnapshot: () => loading }; }, []);
  const snapshot = useSyncExternalStore((query ?? never).subscribe, (query ?? never).getSnapshot, (query ?? never).getSnapshot);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const refresh = useCallback(() => { (screens as { invalidate?: () => void }).invalidate?.(); setRevision((n) => n + 1); }, [screens]);
  useEffect(() => {
    if (query) return;
    let alive = true;
    void call(cap, JSON.parse(key)).then((data) => { if (alive) setState({ data: data as T }); }, () => { if (alive) setState({ error: "Couldn’t load this page. Check access and try again." }); });
    return () => { alive = false; };
  }, [call, cap, key, revision, query]);
  return query ? { data: snapshot.status === "ready" ? snapshot.data : undefined, error: snapshot.status === "loading" && snapshot.error ? "Couldn’t load this page. Check access and try again." : undefined, refresh } : { ...state, refresh };
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
    if(value&&('idempotencyKey' in value||['health.support_bundle','backup.run','backup.export_start'].includes(cap))){
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
export function Button({ label, onPress, disabled = false, testID, danger = false }: { label: string; onPress: () => void; disabled?: boolean; testID?: string; danger?: boolean }): ReactElement {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} testID={testID} style={[s.button, disabled && { opacity: 0.5 }]}><Text style={[s.buttonText, danger && { color: "var(--danger)" as string }]}>{label}</Text></Pressable>;
}
export function Actions({ children }: { children: ReactNode }): ReactElement { return <View style={s.actions}>{children}</View>; }
export function Note({ children }: { children: ReactNode }): ReactElement { return <Text accessibilityRole="status" style={s.note}>{children}</Text>; }
export function ReadState({ error, retry }: { error?: string | undefined; retry: () => void }): ReactElement { return error ? <States kind="error" message={error} retryable onRetry={retry} /> : <Text accessibilityRole="progressbar">Loading…</Text>; }
export function Select({label,value,options,onChange,disabled=false}:{label:string;value:string;options:readonly {key:string;title:string}[];onChange(value:string):void;disabled?:boolean}):ReactElement{
 const menu=useMenu();return <View style={s.field}><Text style={s.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} style={s.button} onPress={(event)=>{const rect=(event.currentTarget as unknown as {getBoundingClientRect?():{left:number;bottom:number}})?.getBoundingClientRect?.();menu.show(options.map((item)=>({label:item.title,checked:item.key===value,onSelect:()=>onChange(item.key)})),rect?.left??20,rect?.bottom??100,'other');}}><Text style={s.buttonText}>{options.find((item)=>item.key===value)?.title??(value||'Choose…')}</Text></Pressable>{menu.element}</View>;
}
export function useFileDownload(){
 const {call}=useConsoleData();const urls=useRef<string[]>([]);const [url,setUrl]=useState(''),[name,setName]=useState('');
 useEffect(()=>()=>{for(const item of urls.current)URL.revokeObjectURL(item);},[]);
 const read=async(fileId:string):Promise<void>=>{const metadata=await call('files.get',{fileId}) as {file:{name:string}};setName(metadata.file.name);const file=await call('files.read',{fileId,as:'base64'}) as {base64?:string;url?:string;mime:string;truncated:boolean};if(file.truncated)throw new Error('This export was truncated. Narrow its filters and try again.');if(file.base64!==undefined){const binary=globalThis.atob(file.base64),bytes=Uint8Array.from(binary,(c)=>c.charCodeAt(0));const next=URL.createObjectURL(new Blob([bytes],{type:file.mime}));urls.current.push(next);setUrl(next);}else if(file.url&&safeDownload(file.url))setUrl(file.url);else throw new Error('The server did not return downloadable content.');};
 return {url,name,read};
}
export function Download({url,label='Download file',name}:{url:string;label?:string;name?:string}):ReactElement{return safeDownload(url)?createElement('a',{href:url,download:name??true,target:'_blank',rel:'noopener noreferrer',style:{color:'var(--accent)',fontSize:13}},label):<Note>The server did not provide a valid download address.</Note>;}
export const attempt = (): string => globalThis.crypto.randomUUID();
const s = StyleSheet.create({ field: { gap: 6, marginVertical: 8 }, label: { fontSize: 12, color: "var(--ink-3)" as string }, input: { height: 34, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, paddingHorizontal: 10, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string }, actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginVertical: 10 }, button: { paddingHorizontal: 12, height: 32, justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, backgroundColor: "var(--raised)" as string }, buttonText: { color: "var(--ink)" as string, fontSize: 13 }, note: { fontSize: 13, color: "var(--ink-2)" as string, marginVertical: 8 } });
