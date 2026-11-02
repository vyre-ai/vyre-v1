// Telephony in the Console (owner, 2 Nov): paste the Twilio credentials, they go straight to the Vault, Vyre tests them at once and brings in every number, then each number is assigned to one or several people.
// Nothing is set up number by number, and webhooks set themselves. In a Personal Space the same page shows in Settings, where there is nobody to assign.
import{useState}from'react';import type{ReactElement}from'react';import{View}from'react-native';import type{CapMap}from'../../../../../../generated/types.ts';import{useMenu}from'../../../../../../ui/src/Menu/index.tsx';import{Row}from'../../../../../../ui/src/Row/index.tsx';import{useConsoleData}from'../../shell/data.tsx';import{Group,Section}from'../../shell/ui.tsx';import{Button,Field,Help,Note,useAction,useRead}from'../shared.tsx';import{storeInVault}from'../suite/flow.ts';import{TWILIO_ACCOUNT_HANDLE,TWILIO_AUTH_HANDLE,connectLine,credentialProblem,toggled,whoLabel}from'./telephony-model.ts';import type{Assignee}from'./telephony-model.ts';
type NumberOut=CapMap['telephony.number.list']['out']['numbers'][number];
type Folders=CapMap['vault.folders.list']['out'];
type Items=CapMap['vault.items.list']['out'];
type People=CapMap['access.principals.list']['out'];

/** Before anything is connected: the two fields, tested at once. */
export function TelephonyConnect({onConnected}:{onConnected():void}):ReactElement{
 const data=useConsoleData();const action=useAction(()=>undefined);const[sid,setSid]=useState(''),[token,setToken]=useState(''),[line,setLine]=useState(''),[busy,setBusy]=useState(false);
 const connect=async():Promise<void>=>{
  const problem=credentialProblem(sid,token);if(problem){setLine(problem);return;}
  setBusy(true);setLine('');
  try{
   // read fresh for each key: the first makes the folder, and a retry after a refused token updates what is there
   for(const [handle,text] of [[TWILIO_ACCOUNT_HANDLE,sid.trim()],[TWILIO_AUTH_HANDLE,token.trim()]] as const){
    const name=handle.replace(/^#/,'');const folders=await data.call('vault.folders.list',{scope:'shared'}) as Folders;const items=await data.call('vault.items.list',{q:name}) as Items;const existingItemId=items.items.find(i=>i.name===name)?.id;
    if(!await storeInVault(action.run,{name,handle,text,folders:folders.folders,...(existingItemId?{existingItemId}:{})})){setLine('The keys could not be stored in the Vault. Nothing was connected.');return;}
   }
   setToken('');
   const out=await action.run<CapMap['telephony.connect']['out']>('telephony.connect',{idempotencyKey:''},(o)=>connectLine(o));
   if(out?.connected)onConnected();
  }finally{setBusy(false);}
 };
 return <View testID="telephony-connect"><Section title="Connect Twilio"><Group>
  <Row id="tel-intro" title="Bring your Twilio numbers into this Space" note="Both keys are on the first page of your Twilio Console. Vyre tests them and brings in every number."/>
  <Field label="Account SID" value={sid} onChange={setSid} testID="telephony-sid"/>
  <Field label="Auth Token" value={token} onChange={setToken} testID="telephony-token" secure/>
 </Group></Section><Button label={busy?'Connecting…':'Connect'} testID="telephony-connect-button" disabled={busy} onPress={()=>void connect()}/>{line?<Note>{line}</Note>:null}{action.note?<Note>{action.note}</Note>:null}</View>;
}

/** Once connected: the account line, and bringing in numbers added at Twilio later. */
export function TelephonyAccount({onChanged}:{onChanged():void}):ReactElement{
 const action=useAction(onChanged);const health=useRead<CapMap['twilio.health']['out']>('twilio.health',{});
 return <View testID="telephony-account"><Section title="Twilio"><Group><Row id="tel-account" title="Twilio account" note={health.data?.detail??(health.data?'Calls and texts reach this Space.':'Checking…')} trailing={<Button label="Bring in new numbers" testID="telephony-refresh" onPress={()=>void action.run<CapMap['telephony.connect']['out']>('telephony.connect',{idempotencyKey:''},(o)=>o.connected?(o.imported===0?'No new numbers.':connectLine({...o,total:o.imported})):connectLine(o))}/>}/></Group></Section>{action.note?<Note>{action.note}</Note>:null}</View>;
}

/** One number: who is on it, changed from a menu that lists the Space's people. */
export function NumberRow({row,onOpen,onChanged}:{row:NumberOut;onOpen():void;onChanged():void}):ReactElement{
 const data=useConsoleData();const menu=useMenu();const action=useAction(onChanged);const people=useRead<People>('access.principals.list',{kind:'person',limit:200});
 const rows=(people.data?.principals??[]) as {id:string;name?:string}[];const nameOf=(a:Assignee):string=>rows.find(p=>p.id===a.id)?.name??data.name(a.id);
 const entries=rows.map(p=>{const who:Assignee={kind:'person',id:p.id};return{label:p.name??p.id,checked:row.assignees.some(a=>a.id===p.id),onSelect:()=>void action.run('telephony.number.set_assignees',{numberId:row.id,assignees:toggled(row.assignees,who)},'Saved.')};});
 return <View testID={`number-${row.id}`}><Row id={`number-row-${row.id}`} title={row.e164} note={[row.title,row.capabilities.join(', ')].filter(Boolean).join(' · ')} onPress={onOpen} trailing={<Button label={whoLabel(row.assignees,nameOf)} testID={`number-assign-${row.id}`} onPress={(e)=>menu.show(entries,e?.clientX??e?.nativeEvent?.pageX??40,e?.clientY??e?.nativeEvent?.pageY??120)}/>}/>{action.note?<Note>{action.note}</Note>:null}{menu.element}</View>;
}
