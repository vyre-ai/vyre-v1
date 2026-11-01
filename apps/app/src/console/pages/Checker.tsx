import {RecordsPreview} from "./RecordsPreview.tsx";
import type {RecordsPreviewReader} from "../../../../../client/src/gateway/records-preview.ts";
import {useEffect,useRef,useState} from "react";
import type {ReactElement} from "react";
import {Text,View} from "react-native";
import {Row} from "../../../../../ui/src/Row/index.tsx";
import {permissions} from "../../../../../generated/permissions.ts";
import type {AccessCheckIn,AccessCheckOut} from "../../../../../generated/types.ts";
import {ResourcePicker,SubjectPicker} from "../objects/pickers.tsx";
import type {ResourceRef} from "../objects/pickers.tsx";
import {useIdentityName,useResourceName} from "../objects/names.ts";
import {useConsoleData} from "../shell/data.tsx";
import {Group,Section} from "../shell/ui.tsx";
import { Help, Actions,Button,Note,Select} from "./shared.tsx";
export function Checker():ReactElement{
 const data=useConsoleData();const[person,setPerson]=useState<AccessCheckIn["principal"]>({kind:"person",id:data.me.id});const[actingFor,setActingFor]=useState<AccessCheckIn["principal"]|null>(null);const[resource,setResource]=useState<ResourceRef|null>(null);const[permission,setPermission]=useState("");const[level,setLevel]=useState<AccessCheckIn["action"]["level"]>("view");const[choose,setChoose]=useState<"person"|"resource"|"acting"|null>("resource");const[out,setOut]=useState<AccessCheckOut|null>(null);const[error,setError]=useState("");const[busy,setBusy]=useState(false);
 const[preview,setPreview]=useState<{reader:RecordsPreviewReader;expiresAt:number;name:string}|null>(null);
 const personName=useIdentityName(person);
 const startPreview=async()=>{if(busy||person.kind!=="person"||!data.createRecordsPreview)return;setBusy(true);setError("");try{const ticket=await data.call("access.view_as",{person:person.id}) as {previewToken:string;expiresAt:number};setPreview({reader:data.createRecordsPreview({token:ticket.previewToken,expiresAt:ticket.expiresAt}),expiresAt:ticket.expiresAt,name:personName});}catch(e){setError(e instanceof Error?e.message:"Couldn’t open this preview.");}finally{setBusy(false);}};
 const key=JSON.stringify({person,actingFor,resource,permission,level});const active=useRef(key);active.current=key;useEffect(()=>{setOut(null);setError("");},[key]);
 const run=async()=>{if(busy||!resource||person.kind==="agent"&&!actingFor)return;const requested=active.current;setBusy(true);setError("");try{const result=await data.call("access.check",{principal:person,...(actingFor?{actingFor}:{}),resource,action:{level,...(permission?{perm:permission}:{})}}) as AccessCheckOut;if(active.current===requested)setOut(result);}catch(error){if(active.current===requested)setError(error instanceof Error?error.message:"Couldn’t check this access. Retry after checking your connection and permission.");}finally{setBusy(false);}};
 if(preview)return <RecordsPreview {...preview} onClose={()=>setPreview(null)}/>;
 return <View testID="console-checker"><Section title="Check effective access"><Group><IdentityRow title="Person or actor" value={person} onChange={()=>setChoose("person")}/>{resource?<ResourceRow value={resource} onChange={()=>setChoose("resource")}/>:<Button label="Choose resource" onPress={()=>setChoose("resource")}/>}</Group>{choose==="person"?<SubjectPicker value={person} kinds={["person","agent","actor","service"]} label="Principal" testID="checker-person-picker" onChange={value=>{setPerson(value as AccessCheckIn["principal"]);setActingFor(null);setChoose(null);}}/>:choose==="resource"?<ResourcePicker value={resource} testID="checker-resource-picker" onChange={value=>{setResource(value);setChoose(null);}}/>:choose==="acting"?<SubjectPicker value={actingFor} kinds={["person"]} label="Acting person" testID="checker-acting-picker" onChange={value=>{setActingFor(value as AccessCheckIn["principal"]);setChoose(null);}}/>:null}
 {person.kind==="agent"?<Group>{actingFor?<IdentityRow title="Acting for" value={actingFor} onChange={()=>setChoose("acting")}/>:<Button label="Choose the person this agent acts for" onPress={()=>setChoose("acting")}/>}<Help>Agents are checked with the person they act for.</Help></Group>:null}
 <Select label="Action level" value={level} options={[{key:"view",title:"View"},{key:"use",title:"Use"},{key:"edit",title:"Edit"},{key:"manage",title:"Manage"}]} onChange={value=>setLevel(value as typeof level)}/><Select label="Capability permission" value={permission} options={[{key:"",title:"Resource access only"},...permissions.map(item=>({key:item.key,title:item.title}))]} onChange={setPermission}/><Actions><Button label={busy?"Checking…":"Check access"} testID="checker-run" disabled={busy||!resource||person.kind==="agent"&&!actingFor} why={!resource?"Pick a resource first":undefined} onPress={()=>void run()}/>{person.kind==="person"&&person.id!==data.me.id&&data.createRecordsPreview?<Button label="Preview shared records" testID="checker-preview" disabled={busy} onPress={()=>void startPreview()}/>:null}</Actions></Section>
 {error?<Note>{error}</Note>:null}{out?<Section title="Decision"><Text testID="checker-decision">{out.decision.effect}</Text><Note>{out.decision.reason.replaceAll("_"," ")}</Note><Group>{out.decision.steps.map((step,index)=><Row key={index} title={step.text} leading={<Text accessibilityLabel={step.ok?"Passed":"Failed"}>{step.ok?"✓":"×"}</Text>}/>)}</Group><Help>The server's answer at the time of the check.</Help></Section>:null}
 </View>;
}
function IdentityRow({title,value,onChange}:{title:string;value:{kind:string;id:string};onChange:()=>void}):ReactElement{const name=useIdentityName(value);return <Row title={title} note={name} trailing={<Button label={`Change ${title.toLowerCase()}`} onPress={onChange}/>}/>;}
function ResourceRow({value,onChange}:{value:ResourceRef;onChange:()=>void}):ReactElement{const name=useResourceName(value);return <Row title="Resource" note={name} trailing={<Button label="Change resource" onPress={onChange}/>}/>;}
