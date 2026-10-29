import type {Store} from "../../../kernel/src/store/types.ts";
import {fail} from "../routes/errors.ts";
const LABELS:Readonly<Record<string,number>>={public:0,internal:1,confidential:2,restricted:3};
/** Read classification from the canonical typed schema, not its display label. */
export async function recordSensitivity(store:Store,type:string,trace=""):Promise<Readonly<Record<string,number>>>{
 const definition=(await store.types()).find(definition=>definition.name===type);
 if(!definition)throw fail("permission.no_grant",trace,{message:"This record type is no longer available."});
 return Object.fromEntries(definition.fields.map(field=>[field.name,field["sensitivity"]===undefined?0:typeof field["sensitivity"]==="string"?(LABELS[field["sensitivity"]]??3):3]));
}
