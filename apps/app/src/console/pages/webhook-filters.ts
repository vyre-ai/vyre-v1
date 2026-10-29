export type FilterValue={kind:'text'|'number'|'boolean'|'empty';value:string};
export type FilterCondition={id:string;field:string;pointer?:string;many:boolean;values:FilterValue[]};
const scalar=(value:unknown):FilterValue=>value===null?{kind:'empty',value:''}:typeof value==='boolean'?{kind:'boolean',value:String(value)}:typeof value==='number'?{kind:'number',value:String(value)}:{kind:'text',value:String(value)};
export function readWebhookFilter(value:unknown):FilterCondition[]{
 if(!value||typeof value!=='object'||Array.isArray(value))return[];
 return Object.entries(value).map(([pointer,value],index)=>({id:String(index),field:pointer.slice(1).split('/').map(part=>part.replaceAll('~1','/').replaceAll('~0','~')).join('.'),pointer,many:Array.isArray(value),values:(Array.isArray(value)?value:[value]).map(scalar)}));
}
export function writeWebhookFilter(rows:readonly FilterCondition[]):Record<string,unknown>|null{
 const out:Record<string,unknown>={};for(const row of rows){
  if(!row.pointer&&!/^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(row.field.trim()))throw new Error('Name the payload field, using dots for nested fields.');
  const pointer=row.pointer??'/'+row.field.trim().split('.').map(part=>part.replaceAll('~','~0').replaceAll('/','~1')).join('/');
  if(Object.hasOwn(out,pointer))throw new Error('Use each payload field once. Add its alternative values to the same condition.');
  const values=row.values.map(value=>{if(value.kind==='empty')return null;if(value.kind==='boolean')return value.value==='true';if(value.kind==='number'){const number=Number(value.value);if(!value.value.trim()||!Number.isFinite(number))throw new Error('Enter a valid number for this condition.');return number;}return value.value;});
  out[pointer]=row.many?values:values[0]??null;
 }return rows.length?out:null;
}
