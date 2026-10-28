import {useEffect,useRef,useState} from 'react';
import {useConsoleData} from '../shell/data.tsx';
import {useRead} from './shared.tsx';

/** Page through the caller's ordinary list capability, discarding late pages after filters change. */
export function useIntegrationRows<T>(cap:string,field:string,input:Record<string,unknown>={}){
 const data=useConsoleData();const key=cap+JSON.stringify(input);const active=useRef(key);active.current=key;
 const first=useRead<Record<string,unknown>>(cap,{...input,limit:100});
 const[extra,setExtra]=useState<{key:string;rows:T[];next?:string}|null>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState('');const flight=useRef(false);
 useEffect(()=>{setExtra(null);setError('');},[key]);
 const current=extra?.key===key?extra:null;
 const rows=[...((first.data?.[field]??[]) as T[]),...(current?.rows??[])];
 const next=current?current.next:first.data?.next as string|undefined;
 const refresh=()=>{setExtra(null);setError('');first.refresh();};
 const more=async()=>{if(!next||flight.current)return;flight.current=true;setBusy(true);setError('');const requested=key;try{const out=await data.call(cap,{...input,cursor:next,limit:100}) as Record<string,unknown>;if(active.current!==requested)return;setExtra({key:requested,rows:[...(current?.rows??[]),...(out[field] as T[])],...(typeof out.next==='string'?{next:out.next}:{})});}catch{if(active.current===requested)setError('Couldn’t load the next page. Try again.');}finally{flight.current=false;setBusy(false);}};
 return{rows,ready:!!first.data,error:first.error??error,refresh,pagination:{...(next?{next}:{}),busy,onMore:()=>void more()}};
}

export function safeProviderUrl(value:string):string{
 const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw new Error('The provider did not return a secure sign-in address.');return url.href;
}

export function commaValues(value:string):string[]{return [...new Set(value.split(',').map(part=>part.trim()).filter(Boolean))];}
