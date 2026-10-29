import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { Bar, Button, ErrorLine, FieldRow, Foot, Group, JoinFrame, Panel, Row, Step, Title, baseText, useJoin } from './kit.tsx';
import { entryTarget } from '../shell/session/entry.ts';
import type { EntryTarget } from '../shell/session/entry.ts';

export function SpaceEntry({onTarget,onBack,onCreatePersonal}: {onTarget(target:EntryTarget):void|Promise<void>;onBack():void;onCreatePersonal?:()=>Promise<void>}):ReactElement{
 return <JoinFrame><SpaceEntryBody onTarget={onTarget} onBack={onBack} {...(onCreatePersonal?{onCreatePersonal}:{})}/></JoinFrame>;
}
function SpaceEntryBody({onTarget,onBack,onCreatePersonal}:{onTarget(target:EntryTarget):void|Promise<void>;onBack():void;onCreatePersonal?:()=>Promise<void>}):ReactElement{
 const {p}=useJoin();const[page,setPage]=useState<'choice'|'join'|'create'>('choice'),[value,setValue]=useState(''),[error,setError]=useState(''),[kind,setKind]=useState<'personal'|'team'>('personal'),[busy,setBusy]=useState(false);
 const back=():void=>{if(busy)return;if(page==='choice')onBack();else{setPage('choice');setValue('');setError('');}};
 useEffect(()=>{const doc=(globalThis as {document?:Document}).document;const onKey=(event:KeyboardEvent):void=>{if(event.key==='Escape'&&!busy){event.preventDefault();back();}};doc?.addEventListener('keydown',onKey);return()=>doc?.removeEventListener('keydown',onKey);},[page,busy,onBack]);
 const submit=async():Promise<void>=>{if(busy)return;const target=entryTarget(value);if(!target){setError(page==='create'?'Paste the complete owner setup link from your server.':'Enter a Space address or its complete invite link.');return;}if(page==='create'&&target.kind!=='claim'){setError('Use the owner setup link printed by your new server.');return;}setBusy(true);setError('');try{await onTarget(target);}catch(failure){setError(failure instanceof Error?failure.message:'Couldn’t open this Space. Try again.');}finally{setBusy(false);}};
 const nativePersonal=page==='create'&&kind==='personal'&&!!onCreatePersonal;
 const createPersonal=async():Promise<void>=>{if(busy||!onCreatePersonal)return;setBusy(true);setError('');try{await onCreatePersonal();}catch{setError('Couldn’t start your Personal Space. Try again.');}finally{setBusy(false);}};
 const browserPersonal=page==='create'&&kind==='personal'&&!onCreatePersonal;
 const command='curl -fsSL https://vyre.run/install.sh | sh';
 return <Panel bar={<Bar onBack={()=>{if(!busy)back();}} cont={page==='choice'||nativePersonal||browserPersonal?null:<Button testID="space-entry-continue" label={busy?'Verifying…':page==='create'?'Set up my Space':'Continue'} onPress={()=>void submit()} disabled={busy||!value.trim()}/>}/>}><Step id={`space-entry-${page}`}>
  <Title title={page==='choice'?'Your Space':page==='join'?'Join a Space':'Create a Space'} sub={page==='choice'?'Join your team, or make a place of your own.':page==='join'?'Paste an invite link, or sign in to a Space you already belong to.':'Choose where your Space lives. Your files and work stay on that server.'}/>
  {page==='choice'?<Group><Row kind="action" testID="space-entry-join" label="Join a Space" onPress={()=>setPage('join')}/><Row kind="action" testID="space-entry-create" label="Create a Space" onPress={()=>setPage('create')}/></Group>:null}
  {page==='create'?<><Group><Row kind="option" testID="space-entry-personal" title="Personal Space" help="On this computer" checked={kind==='personal'} onPress={()=>{if(!busy)setKind('personal');}}/><Row kind="option" testID="space-entry-team" title="Team Space" help="On a server your team can reach" checked={kind==='team'} onPress={()=>{if(!busy)setKind('team');}}/></Group>{nativePersonal?<View style={{marginTop:24}}><Button testID="create-personal-native" label={busy?'Starting your Space…':'Create Personal Space'} disabled={busy} onPress={()=>void createPersonal()}/></View>:browserPersonal?<><Foot>Create your Personal Space in the Vyre desktop app. It runs on your computer and keeps its files there.</Foot><Button testID="space-personal-desktop" label="Join an existing Space" onPress={()=>{setPage('join');setValue('');setError('');}}/></>:<><Foot>Run this on your Linux server. The installer verifies the release, starts your Space and prints its owner setup link.</Foot><Text selectable testID="space-setup-command" style={[baseText(p),{fontFamily:'monospace',fontSize:12,padding:14,marginTop:14,backgroundColor:p.grp,borderRadius:8}]}>{command}</Text></>}</>:null}
  {page!=='choice'&&!nativePersonal&&!browserPersonal?<Group><FieldRow stacked testID="space-entry-address" disabled={busy} label={page==='create'?'Owner setup link':'Space address or invite link'} value={value} onChange={(next)=>{setValue(next);setError('');}} placeholder={page==='create'?'https://…/claim/…':'https://your-space.example'} onSubmit={()=>void submit()}/></Group>:null}
  {error?<ErrorLine testID="space-entry-error">{error}</ErrorLine>:null}
 </Step></Panel>;
}
