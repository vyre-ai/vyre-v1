import {useState} from "react";
import type {ReactElement} from "react";
import {View} from "react-native";
import type {AccessGrantsListOut,SchemaTypesGetOut,SearchResolveOut} from "../../../../../generated/types.ts";
import {Row} from "../../../../../ui/src/Row/index.tsx";
import {Group,Section} from "../shell/ui.tsx";
import { Help, Button,Field,Note,ReadState,Select,useRead} from "./shared.tsx";
type Conditions=AccessGrantsListOut["grants"][number]["conditions"];
type SchemaField=SchemaTypesGetOut["type"]["fields"][number];
export interface PredicateDraft {field:string;op:"eq"|"ne"|"lt"|"lte"|"gt"|"gte";value:string}
export interface ConditionDraft {filter:"keep"|"all"|"owner"|"rules";match:"and"|"or";rules:PredicateDraft[];hidden:"keep"|"edit";hiddenFields:string[];ceiling:string;window:"keep"|"none"|"custom";from:string;to:string}
const utc=(at:number|undefined)=>at===undefined?"":new Date(at).toISOString().slice(0,16).replace("T"," ");
export function conditionDraft(previous:Conditions):ConditionDraft{return{filter:"keep",match:"and",rules:[],hidden:"keep",hiddenFields:[...(previous.hiddenFields??[])],ceiling:"keep",window:"keep",from:utc(previous.window?.from),to:utc(previous.window?.to)};}
export function utcTime(value:string):number{if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))throw new Error("Enter UTC dates as YYYY-MM-DD HH:mm.");const time=Date.parse(value.replace(" ","T")+":00Z");if(!Number.isFinite(time)||utc(time)!==value)throw new Error("Choose a valid UTC date and time.");return time;}
export function grantConditions(previous:Conditions,draft:ConditionDraft,fields:readonly SchemaField[],now:number):Conditions{
 const next={...previous};
 if(draft.filter==="all")delete next.rowFilter;
 if(draft.filter==="owner")next.rowFilter={op:"owner_me"};
 if(draft.filter==="rules"){
  if(!draft.rules.length)throw new Error("Add at least one row condition.");
  const args=draft.rules.map(rule=>{const field=fields.find(field=>field.key===rule.field);if(!field)throw new Error("Choose a field from this record type.");let value:string|number|boolean=rule.value;
   if(["number","integer","decimal","currency","percent","duration","rating"].includes(field.type)){if(!rule.value.trim()||!Number.isFinite(Number(rule.value)))throw new Error(`${field.title} needs a number.`);value=Number(rule.value);}
   if(["boolean","checkbox"].includes(field.type)){if(!["true","false"].includes(rule.value))throw new Error(`${field.title} needs Yes or No.`);value=rule.value==="true";}
   if(!["eq","ne","lt","lte","gt","gte"].includes(rule.op))throw new Error("Choose a supported comparison.");return{op:rule.op,field:field.key,value};});
  next.rowFilter=args.length===1?args[0]:{op:draft.match,args};
 }
 if(draft.hidden==="edit"){const known=new Set(fields.map(field=>field.key));const preserved=new Set(previous.hiddenFields??[]);if(draft.hiddenFields.some(field=>!known.has(field)&&!preserved.has(field)))throw new Error("Choose hidden fields from this record type.");next.hiddenFields=[...new Set(draft.hiddenFields)];}
 if(draft.ceiling==="none")delete next.labelCeiling;
 else if(draft.ceiling!=="keep"){if(!["public","internal","confidential","restricted"].includes(draft.ceiling))throw new Error("Choose a sensitivity ceiling.");next.labelCeiling=draft.ceiling as NonNullable<Conditions["labelCeiling"]>;}
 if(draft.window==="none")delete next.window;
 if(draft.window==="custom"){const from=utcTime(draft.from),to=utcTime(draft.to);if(to<=from||to<=now)throw new Error("The access window must end after its start and after now.");next.window={from,to};}
 return next;
}
export function GrantConditions({resource,previous,value,onChange,onFields}:{resource:{type:string;id:string}|null;previous:Conditions;value:ConditionDraft;onChange(value:ConditionDraft):void;onFields(fields:readonly SchemaField[]):void}):ReactElement{
 // a grant on one record resolves that record's type, so its schema names the fields a grant can hide
 const located=useRead<SearchResolveOut>("search.resolve",{kind:"record",itemId:resource?.id??""},{enabled:resource?.type==="record"});
 const typeKey=resource?.type==="record_type"?resource.id:resource?.type==="record"?located.data?.hit?.recordType:undefined;
 const schema=useRead<SchemaTypesGetOut>("schema.types.get",{type:typeKey??""},{enabled:!!typeKey});
 const hasSchema=!!typeKey||resource?.type==="record";
 const fields=schema.data?.type.fields??[];const change=(patch:Partial<ConditionDraft>)=>{onFields(fields);onChange({...value,...patch});};
 const rules=value.rules;const[editing,setEditing]=useState<number|null>(null);
 return <Section title="Access conditions"><Select label="Rows available" value={value.filter} options={[{key:"keep",title:"Keep current row restriction"},{key:"all",title:"All rows allowed by delegation"},{key:"owner",title:"Rows owned by the recipient"},...(resource?.type==="record_type"?[{key:"rules",title:"Match record fields"}]:[])]} onChange={filter=>change({filter:filter as ConditionDraft["filter"]})}/>
 {previous.rowFilter&&value.filter==="keep"?<Help>The existing row restriction stays intact. Choose another mode only to replace it.</Help>:null}
 {value.filter==="rules"?schema.data?<><Select label="Match conditions" value={value.match} options={[{key:"and",title:"All conditions"},{key:"or",title:"Any condition"}]} onChange={match=>change({match:match as "and"|"or"})}/><Group>{rules.map((rule,index)=><Row key={index} title={`Condition ${index+1}`} note={fields.find(field=>field.key===rule.field)?.title??"Choose a field"} onPress={()=>setEditing(index)} trailing={<View><Button label="Edit condition" onPress={()=>setEditing(index)}/><Button label="Remove condition" onPress={()=>{change({rules:rules.filter((_,at)=>at!==index)});setEditing(null);}}/></View>}/>)}</Group>{editing!==null&&rules[editing]?<Predicate index={editing} rule={rules[editing]} fields={fields} onChange={rule=>change({rules:rules.map((old,at)=>at===editing?rule:old)})}/>:null}<Button label="Add row condition" testID="grant-condition-add" disabled={!fields.length} onPress={()=>{setEditing(rules.length);change({rules:[...rules,{field:fields[0]?.key??"",op:"eq",value:""}]});}}/></>:<ReadState error={schema.error} retry={schema.refresh}/>:null}
 <Select label="Hidden fields" value={value.hidden} options={[{key:"keep",title:"Keep current hidden fields"},...(typeKey?[{key:"edit",title:"Choose fields to hide"}]:[])]} onChange={hidden=>change({hidden:hidden as "keep"|"edit"})}/>
 {value.hidden==="edit"?schema.data?<Group>{fields.map(field=><Row key={field.key} id={`field-${field.key}`} title={field.title} note={value.hiddenFields.includes(field.key)?"Hidden":"Visible within the sensitivity ceiling"} onPress={()=>change({hiddenFields:value.hiddenFields.includes(field.key)?value.hiddenFields.filter(key=>key!==field.key):[...value.hiddenFields,field.key]})} trailing={<Button label={value.hiddenFields.includes(field.key)?"Show field":"Hide field"} onPress={()=>change({hiddenFields:value.hiddenFields.includes(field.key)?value.hiddenFields.filter(key=>key!==field.key):[...value.hiddenFields,field.key]})}/>}/>)}</Group>:<ReadState error={schema.error} retry={schema.refresh}/>:null}
 {resource?.type==="record"&&!typeKey?<Note>{located.error?"Couldn’t read this record’s type. Field restrictions stay as they are.":located.data?"This record’s type isn’t visible to you, so its fields can’t be named here. Existing field restrictions stay intact.":"Reading this record’s type…"}</Note>:!hasSchema?<Help>Choose a Record type or a record to hide fields.</Help>:resource?.type==="record"?<Help>This grant covers one record. Choose the fields to hide.</Help>:null}
 <Select label="Sensitivity ceiling" value={value.ceiling} options={[{key:"keep",title:"Keep current ceiling"},{key:"none",title:"Use the recipient’s clearance"},{key:"public",title:"Public"},{key:"internal",title:"Internal"},{key:"confidential",title:"Confidential"},{key:"restricted",title:"Restricted"}]} onChange={ceiling=>change({ceiling})}/>
 <Select label="Access window" value={value.window} options={[{key:"keep",title:"Keep current window"},{key:"none",title:"No additional time window"},{key:"custom",title:"Set UTC start and end"}]} onChange={window=>change({window:window as ConditionDraft["window"]})}/>{value.window==="custom"?<View><Field label="Access starts in UTC (YYYY-MM-DD HH:mm)" testID="grant-window-from" value={value.from} onChange={from=>change({from})}/><Field label="Access ends in UTC (YYYY-MM-DD HH:mm)" testID="grant-window-to" value={value.to} onChange={to=>change({to})}/></View>:null}
 </Section>;
}
function Predicate({rule,fields,onChange,index}:{rule:PredicateDraft;fields:readonly SchemaField[];onChange(rule:PredicateDraft):void;index:number}):ReactElement{
 const field=fields.find(field=>field.key===rule.field),boolean=field&&["boolean","checkbox"].includes(field.type);
 return <Section title={`Edit condition ${index+1}`}><Select label="Record field" value={rule.field} options={fields.map(field=>({key:field.key,title:field.title}))} onChange={field=>onChange({...rule,field,op:"eq",value:""})}/><Select label="Comparison" value={rule.op} options={[{key:"eq",title:"Equals"},{key:"ne",title:"Does not equal"},...(!boolean?[{key:"lt",title:"Less than"},{key:"lte",title:"At most"},{key:"gt",title:"Greater than"},{key:"gte",title:"At least"}]:[])]} onChange={op=>onChange({...rule,op:op as PredicateDraft["op"]})}/>{boolean?<Select label="Field value" value={rule.value} options={[{key:"",title:"Choose Yes or No"},{key:"true",title:"Yes"},{key:"false",title:"No"}]} onChange={value=>onChange({...rule,value})}/>:<Field label="Field value" testID={`grant-condition-value-${index}`} value={rule.value} onChange={value=>onChange({...rule,value})}/>}</Section>;
}
