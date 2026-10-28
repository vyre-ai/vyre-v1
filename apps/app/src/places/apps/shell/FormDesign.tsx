import { useState } from "react";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Button, Card, Field, Select, s } from "./editor-ui.tsx";
import { isObject, rulesOf, updateRules } from "./form-design.ts";
import type { FormRule, PreviewField } from "./form-design.ts";
export function FormDesign({fields,theme,logic,onTheme,onLogic,disabled}:{fields:readonly PreviewField[];theme:Record<string,unknown>;logic:unknown;onTheme(value:Record<string,unknown>):void;onLogic(value:unknown):void;disabled:boolean}):ReactElement {
 const [editing,setEditing]=useState(-1);
 const rules=rulesOf(logic), opts=fields.map((f)=>({key:f.key,title:f.title}));
 const changeTheme=(key:string,value:string):void=>{const next={...theme};if(value)next[key]=value;else delete next[key];onTheme(next);};
 const replace=(index:number,rule:FormRule):void=>onLogic(updateRules(logic,rules.map((r,i)=>i===index?rule:r)));
 const summary=(rule:FormRule):string=>{const when=rule.when;if(!isObject(when)||typeof when.field!=='string')return 'Combined condition';return `When ${fields.find((f)=>f.key===when.field)?.title??when.field} ${({'eq':'equals','ne':'does not equal','contains':'contains','empty':'is empty','not_empty':'has an answer','gt':'is greater than','lt':'is less than'} as Record<string,string>)[String(when.op)]??String(when.op)} ${String(when.value??'')}`;};
 const renderRule=(rule:FormRule,index:number):ReactElement=>{ const when=isObject(rule.when)?rule.when:{};const simple=typeof when.field==="string"&&!when.all&&!when.any&&!when.not; const action=rule.show?.length?"show":rule.hide?.length?"hide":"require";const targets=(rule[action]??[]) as string[];return <View key={index} style={{gap:10,paddingBottom:14,borderBottomWidth:1,borderColor:"var(--line)" as string}}>
   <Text style={s.text}>{`Rule ${index+1}`}</Text>
   {simple ? <><Select label={`When field ${index+1}`} value={String(when.field)} options={opts} disabled={disabled} onChange={(field)=>replace(index,{...rule,when:{...when,field}})} />
    <Select label={`Comparison ${index+1}`} value={String(when.op)} disabled={disabled} options={[{key:"eq",title:"equals"},{key:"ne",title:"does not equal"},{key:"contains",title:"contains"},{key:"empty",title:"is empty"},{key:"not_empty",title:"has an answer"},{key:"gt",title:"is greater than"},{key:"lt",title:"is less than"}]} onChange={(op)=>replace(index,{...rule,when:{...when,op}})} />
    {!['empty','not_empty'].includes(String(when.op))?<Field label={`Match value ${index+1}`} value={String(when.value??"")} disabled={disabled} onChange={(value)=>replace(index,{...rule,when:{...when,value}})} />:null}
    <Select label={`Then ${index+1}`} value={action} disabled={disabled} options={[{key:"show",title:"Show question"},{key:"hide",title:"Hide question"},{key:"require",title:"Require answer"}]} onChange={(next)=>{const {show:_s,hide:_h,require:_r,...rest}=rule;replace(index,{...rest,[next]:targets});}} />
    <Select label={`Target question ${index+1}`} value={targets[0]??""} options={opts} disabled={disabled} onChange={(field)=>replace(index,{...rule,[action]:[field,...targets.slice(1)]})} /></>:<Text style={s.text}>Combined condition. Its existing conditions are preserved when you save.</Text>}
   <Button title={`Remove rule ${index+1}`} disabled={disabled} onPress={()=>onLogic(updateRules(logic,rules.filter((_,i)=>i!==index)))} />
  </View>;};
 return <><Card title="Design">
  <Field label="Accent color" value={String(theme.accent??"")} placeholder="#5B5BD6" disabled={disabled} onChange={(v)=>changeTheme("accent",v)} />
  <Field label="Background color" value={String(theme.background??"")} placeholder="#ffffff" disabled={disabled} onChange={(v)=>changeTheme("background",v)} />
  <Field label="Text color" value={String(theme.text??"")} placeholder="#1a1a1c" disabled={disabled} onChange={(v)=>changeTheme("text",v)} />
  <Select label="Font" value={String(theme.font??"")} disabled={disabled} options={[{key:"",title:"System font"},{key:"Inter, sans-serif",title:"Inter"},{key:"Arial, sans-serif",title:"Arial"},{key:"Georgia, serif",title:"Georgia"}]} onChange={(v)=>changeTheme("font",v)} />
  <Select label="Corner radius" value={String(theme.radius??"")} disabled={disabled} options={[{key:"",title:"Default"},{key:"0px",title:"Square"},{key:"4px",title:"Small"},{key:"10px",title:"Rounded"},{key:"16px",title:"Large"}]} onChange={(v)=>changeTheme("radius",v)} />
  <Select label="Form width" value={String(theme.maxWidth??"")} disabled={disabled} options={[{key:"",title:"Default"},{key:"480px",title:"Narrow"},{key:"640px",title:"Medium"},{key:"760px",title:"Wide"}]} onChange={(v)=>changeTheme("maxWidth",v)} />
  <Field label="Cover image URL" value={String(theme.cover??"")} placeholder="https://…" disabled={disabled} onChange={(v)=>changeTheme("cover",v)} />
 </Card><Card title="Conditional logic">
  <Text style={s.text}>Show, hide or require a question when an answer matches. Preview answers stay on this device.</Text>
  {rules.map((rule,index)=><Row key={index} id={`condition-${index}`} title={`Rule ${index+1}`} note={summary(rule)} selected={editing===index} onPress={()=>setEditing(index)}/>)}
  {editing>=0&&rules[editing]?renderRule(rules[editing]!,editing):null}
  <Button title="Add condition" disabled={disabled||fields.length===0} onPress={()=>{setEditing(rules.length);onLogic(updateRules(logic,[...rules,{when:{field:fields[0]!.key,op:"eq",value:""},show:[fields.at(-1)!.key]}]));}} />
 </Card></>;
}
