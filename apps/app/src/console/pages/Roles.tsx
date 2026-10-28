import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { AccessRolesGetOut, AccessRolesListOut, AccessRolesPreviewOut, AccessGrantsListOut, AuditListOut } from "../../../../../generated/types.ts";
import { permissions } from "../../../../../generated/permissions.ts";
import { ObjectPage, ObjectSection, withBaseTabs } from "../../../../../ui/src/ObjectPage/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { ObjectList } from "../objects/ObjectList.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, Select, attempt, useAction, useRead } from "./shared.tsx";
type Role = AccessRolesListOut["roles"][number];
type Drafts = ReadonlyMap<string, readonly string[]>;
type Preview = { role: Role; permissions: string[]; diff: AccessRolesPreviewOut };
export function stageRolePermission(role: Role, drafts: Drafts, key: string): string[] | null {
  if (role.builtIn || !permissions.some((permission) => permission.key === key)) return null;
  const next = new Set(drafts.get(role.id) ?? role.permissions);
  if (next.has(key)) next.delete(key); else next.add(key);
  return [...next].sort();
}
export function PermissionMatrix({ roles, drafts, onChange, onOpen, disabled = false }: { roles: readonly Role[]; drafts: Drafts; onChange: (role: Role, key: string) => void; onOpen: (role: Role) => void; disabled?: boolean }): ReactElement {
  const [details, setDetails] = useState("");
  const areas = [...new Set(permissions.map((permission) => permission.area))];
  const rows: ReactElement[] = [];
  for (const area of areas) {
    const cells: ReactElement[] = [];
    for (const permission of permissions.filter((entry) => entry.area === area)) {
      const columns: ReactElement[] = [];
      for (const role of roles) columns.push(<Pressable key={role.id} accessibilityRole="checkbox" accessibilityLabel={`${role.name}: ${permission.title}`} accessibilityState={{ checked: (drafts.get(role.id) ?? role.permissions).includes(permission.key), disabled: disabled || role.builtIn }} disabled={disabled || role.builtIn} onPress={() => onChange(role, permission.key)} testID={`matrix-${role.id}-${permission.key}`} style={{ width: 104, alignItems: "center", justifyContent: "center", minHeight: 32 }}><Text style={{ color: role.builtIn ? "var(--ink-3)" : "var(--accent)", fontSize: 16 }}>{(drafts.get(role.id) ?? role.permissions).includes(permission.key) ? "☑" : "☐"}</Text></Pressable>);
      cells.push(<Row key={permission.key} id={`permission-${permission.key}`} title={permission.title} note={`${permission.risk === "high" ? "High" : permission.risk === "medium" ? "Medium" : "Low"} risk`} leading={<Text accessibilityLabel={`${permission.risk} risk`} style={{color:permission.risk === "high" ? "var(--danger)" : permission.risk === "medium" ? "var(--warn)" : "var(--ink-3)"}}>●</Text>} trailing={<View style={{flexDirection:"row"}}>{columns}</View>} onPress={() => setDetails(`${permission.title}. Applies to ${permission.appliesTo.join(", ")}.`)} />);
    }
    rows.push(<Section key={area} title={area}><Group>{cells}</Group></Section>);
  }
  const headings: ReactElement[] = [];
  for (const role of roles) headings.push(<Pressable key={role.id} accessibilityRole="button" accessibilityLabel={`Open ${role.name}`} onPress={() => onOpen(role)} style={{width:104,alignItems:"center",padding:8}}><Text style={{fontWeight:"600",color:"var(--ink)"}}>{role.name}</Text><Text style={{fontSize:11,color:"var(--ink-3)"}}>{role.builtIn ? "Locked · Clone to edit" : "Custom"}</Text></Pressable>);
  return <View testID="permission-matrix"><ScrollView horizontal><View style={{width:320 + 104*roles.length}}><View style={{flexDirection:"row",paddingLeft:308}}>{headings}</View>{rows}</View></ScrollView>{details ? <Note>{details}</Note> : null}</View>;
}
function DraftEditor({ roles, displayRoles, drafts, setDrafts, onOpen, refresh }: { roles: Role[]; displayRoles?: Role[]; drafts: Drafts; setDrafts: (drafts: Drafts) => void; onOpen: (role: Role) => void; refresh: () => void }): ReactElement {
  const data = useConsoleData();
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef(false);
  const action = useAction(refresh);
  const changed = roles.filter((role) => drafts.has(role.id) && JSON.stringify([...drafts.get(role.id)!].sort()) !== JSON.stringify([...role.permissions].sort()));
  const preview = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setPreviews([]);
    try { const result: Preview[] = []; for (const role of changed) { const keys = [...drafts.get(role.id)!]; const diff = await data.call("access.roles.preview", {roleId:role.id,permissions:keys}) as AccessRolesPreviewOut; result.push({role,permissions:keys,diff}); } setPreviews(result); }
    catch { setError("Couldn’t calculate this change. Nothing was applied. Try again."); }
    finally { operation.current = false; setBusy(false); }
  };
  const apply = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError("");
    try {
      for (const item of previews) {
        const out = await action.run("access.roles.apply", {roleId:item.role.id,permissions:item.permissions,previewHash:item.diff.previewHash}, "Role permissions updated");
        if (!out) { setError("Stopped at a rejected change. Any earlier successful role changes remain. Refresh and preview again."); setPreviews([]); return; }
      }
      setDrafts(new Map()); setPreviews([]);
    } finally { operation.current=false; setBusy(false); }
  };
  return <><PermissionMatrix roles={displayRoles ?? roles} drafts={drafts} disabled={busy || action.busy} onOpen={onOpen} onChange={(role,key) => {if (operation.current) return; const next = stageRolePermission(role,drafts,key); if (!next) return; setDrafts(new Map(drafts).set(role.id,next)); setPreviews([]);}} />
    {changed.length ? <Actions><Button label="Discard staged changes" disabled={busy} onPress={() => {setDrafts(new Map());setPreviews([]);}} /><Button label="Preview permission changes" testID="roles-preview-changes" disabled={busy} onPress={() => void preview()} /></Actions> : null}
    {previews.length ? <Section title="Confirm permission changes"><Group>{previews.map((item) => <Row key={item.role.id} id={`role-preview-${item.role.id}`} title={item.role.name} note={`${item.diff.gains.length} permission gains · ${item.diff.losses.length} losses`} onPress={() => onOpen(item.role)} />)}</Group><Group>{previews.flatMap((item) => {const before=new Set(item.role.permissions),after=new Set(item.permissions);return [...item.permissions.filter((key)=>!before.has(key)).map((key)=>({role:item.role.id,key,direction:"Added"})),...item.role.permissions.filter((key)=>!after.has(key)).map((key)=>({role:item.role.id,key,direction:"Removed"}))];}).map((change)=><Row key={`${change.role}-${change.key}`} id={`role-permission-diff-${change.role}-${change.key}`} title={`${change.direction}: ${permissions.find((permission)=>permission.key===change.key)?.title??change.key}`} note={roles.find((role)=>role.id===change.role)?.name??"Role"}/>)}</Group>{previews.flatMap((item) => [...item.diff.gains.map((gain) => ({...gain,direction:"gains",role:item.role.id})),...item.diff.losses.map((loss) => ({...loss,direction:"loses",role:item.role.id}))]).map((change) => <Row key={`${change.role}-${change.principal.id}-${change.permission}-${change.direction}`} id={`role-impact-${change.principal.id}-${change.permission}`} title={data.name(change.principal.id)} note={`${change.direction} ${permissions.find((permission) => permission.key === change.permission)?.title ?? change.permission}`} />)}<Button label="Apply changes" testID="roles-apply-changes" disabled={busy} onPress={() => void apply()} /></Section> : null}{error ? <Note>{error}</Note> : null}{action.note ? <Note>{action.note}</Note> : null}
  </>;
}
export function Roles({ initialId }: {initialId?:string}): ReactElement {
  const data = useConsoleData();
  const [more,setMore] = useState<AccessRolesListOut|null>(null);
  const [selected,setSelected] = useState(initialId ?? "");
  const [search,setSearch] = useState("");
  const searchNow=useRef(search);searchNow.current=search;
  const list = useRead<AccessRolesListOut>("access.roles.list", {q:search,limit:100});
  const known=useRef(new Map<string,Role>());
  const [filters,setFilters] = useState<ReadonlySet<string>>(new Set());
  const [picked,setPicked] = useState<ReadonlySet<string>>(new Set());
  const [columns,setColumns] = useState<ReadonlySet<string>>(new Set());
  const [drafts,setDrafts] = useState<Drafts>(new Map());
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const refresh = () => {setMore(null);list.refresh();};
  useEffect(() => {setSelected(initialId ?? "");},[initialId]);
  useEffect(() => {setMore(null);},[search]);
  const open = (role: Role) => {setSelected(role.id);data.nav.openPage("roles",{roleId:role.id});};
  if (selected) return <RoleObject key={selected} roleId={selected} onBack={() => {setSelected("");data.nav.openPage("roles");refresh();}} />;
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const roles = [...new Map([...list.data.roles,...(more?.roles ?? [])].map((role) => [role.id,role])).values()];
  for(const role of roles)known.current.set(role.id,role);
  const visible = roles.filter((role) => (!search || role.name.toLowerCase().includes(search.toLowerCase())) && (!filters.size || filters.has(role.builtIn ? "built-in" : "custom")));
  const next = more ? more.next : list.data.next;
  return <View testID="console-roles"><ObjectList rows={roles.map((role) => ({id:role.id,title:role.name,note:`${role.holders} holders · ${role.clearance}`,filters:[role.builtIn ? "built-in" : "custom"],actions:[{label:role.builtIn ? "Open / Clone role" : "Open role",onSelect:()=>open(role)}],value:role}))} selectedId={null} onOpen={(row)=>{if(row.value)open(row.value);}} search={{value:search,onSearch:setSearch}} filters={[{id:"built-in",label:"Built-in"},{id:"custom",label:"Custom"}]} activeFilters={filters} onFilters={setFilters} picked={picked} onPicked={setPicked} bulkActions={[{label:"Compare selected roles",onSelect:()=>setColumns(new Set(picked))}]} pagination={{...(next?{next}:{}),busy,onMore:()=>{if(!next||busy)return;setBusy(true);void data.call("access.roles.list",{q:search,cursor:next,limit:100}).then((value)=>{const out=value as AccessRolesListOut;if(searchNow.current!==search)return;setMore({...out,roles:[...(more?.roles??[]),...out.roles]});},()=>setError("Couldn’t load more roles.")).finally(()=>setBusy(false));}}} empty="No roles match this search." testID="roles-list" />
    {next ? <Note>Load remaining roles to include them in this matrix.</Note> : null}{columns.size ? <Button label="Show all columns" onPress={()=>setColumns(new Set())}/> : null}<DraftEditor roles={[...known.current.values()]} displayRoles={columns.size ? visible.filter((role)=>columns.has(role.id)) : visible} drafts={drafts} setDrafts={setDrafts} onOpen={open} refresh={refresh} />{error?<Note>{error}</Note>:null}</View>;
}
function RoleObject({roleId,onBack}:{roleId:string;onBack:()=>void}):ReactElement {
  const data=useConsoleData();
  const detail=useRead<AccessRolesGetOut>("access.roles.get",{roleId});
  const grants=useRead<AccessGrantsListOut>("access.grants.list",{subject:{kind:"role",id:roleId},limit:100});
  const [tab,setTab]=useState("overview");
  const [sheet,setSheet]=useState<"clone"|"edit"|null>(null);
  const [name,setName]=useState("");
  const [clearance,setClearance]=useState("internal");
  const [agents,setAgents]=useState(true);
  const [drafts,setDrafts]=useState<Drafts>(new Map());
  const action=useAction(detail.refresh);
  if(!detail.data)return <ReadState error={detail.error} retry={detail.refresh}/>;
  const {role,holders,directHolders}=detail.data;
  return <ObjectPage id={role.id} name={role.name} kind="Role" owner={data.space.name} status={role.builtIn?"Built-in":"Active"} parent="Roles" onBack={onBack} density="regular" actions={[{id:"clone",label:"Clone role",destructive:false},...(!role.builtIn?[{id:"edit",label:"Edit role",destructive:false},{id:"delete",label:"Delete role",destructive:true}]:[])]} tabs={withBaseTabs([{id:"permissions",label:"Permissions",count:role.permissions.length},{id:"holders",label:"Holders",count:holders.length},{id:"clearance",label:"Clearance",count:null},{id:"grants",label:"Where granted",count:grants.data?.total??null}])} activeTabId={tab} onTab={setTab} sheetOpen={sheet!==null} sheetTitle={sheet==="clone"?"Clone role":"Edit role"} onCloseSheet={()=>setSheet(null)} impacts={{delete:`Delete ${role.name}? ${holders.length} effective holders and ${(directHolders??[]).length} direct assignments. Roles with holders cannot be deleted. Review holders first. This cannot be undone.`}} onAction={async(id)=>{if(id==="delete"){const out=await action.run("access.roles.delete",{roleId},"Role deleted");if(!out)return false;onBack();return true;}setName(id==="clone"?`${role.name} copy`:role.name);setClearance(role.clearance);setAgents(role.assignableToAgents);setSheet(id as "clone"|"edit");}} testID="role-object" sheet={<><Field label="Role name" value={name} onChange={setName} testID="role-edit-name"/><Select label="Clearance" value={clearance} options={[{key:"public",title:"Public"},{key:"internal",title:"Internal"},{key:"confidential",title:"Confidential"},{key:"restricted",title:"Restricted"}]} onChange={setClearance}/><Button label={agents?"Agents allowed · Change":"People only · Change"} onPress={()=>setAgents(!agents)}/><Button label={sheet==="clone"?"Create role copy":"Save role"} disabled={action.busy||!name.trim()||!["public","internal","confidential","restricted"].includes(clearance)} testID="role-save" onPress={()=>void action.run<{role:Role}>(sheet==="clone"?"access.roles.create":"access.roles.update",{...(sheet==="clone"?{cloneFrom:roleId,idempotencyKey:attempt()}:{roleId}),name:name.trim(),clearance,assignableToAgents:agents},sheet==="clone"?"Role cloned":"Role updated").then((out)=>{if(out)setSheet(null);})}/></>}>
    {tab==="overview"?<><ObjectSection title="Permissions"><Note>{role.permissions.length} permissions · {holders.length} effective holders</Note><Button label="Open permission column" onPress={()=>setTab("permissions")}/></ObjectSection><ObjectSection title="Clearance"><Note>{role.clearance} · {role.assignableToAgents?"People and agents":"People only"}</Note></ObjectSection></>:null}
    {tab==="permissions"?<><DraftEditor roles={[role]} drafts={drafts} setDrafts={setDrafts} onOpen={()=>undefined} refresh={detail.refresh}/><ObjectSection title="Last permission change">{detail.data.lastChange ? <><Note>{data.name(detail.data.lastChange.by.id)} · {new Date(detail.data.lastChange.at).toLocaleString()}</Note><Group>{[...detail.data.lastChange.after.filter((key)=>!detail.data!.lastChange!.before.includes(key)).map((key)=>({key,direction:"Added"})),...detail.data.lastChange.before.filter((key)=>!detail.data!.lastChange!.after.includes(key)).map((key)=>({key,direction:"Removed"}))].map((change)=><Row key={change.key} id={`role-last-change-${change.key}`} title={`${change.direction}: ${permissions.find((permission)=>permission.key===change.key)?.title??change.key}`}/>)}</Group></> : <Note>No earlier permission snapshot is recorded.</Note>}</ObjectSection></>:null}
    {tab==="holders"?<><ObjectSection title="Direct assignments"><Group>{(directHolders??holders).map((holder)=><Row key={`${holder.kind}-${holder.id}`} id={`role-holder-${holder.id}`} title={data.name(holder.id)} note={holder.kind} onPress={()=>data.nav.openPage(holder.kind==="group"?"groups":"people",holder.kind==="group"?{groupId:holder.id}:{personId:holder.id})}/>)}</Group></ObjectSection><ObjectSection title="Effective holders"><Group>{holders.map((holder)=><Row key={holder.id} id={`effective-holder-${holder.id}`} title={data.name(holder.id)} note={holder.kind}/>)}</Group></ObjectSection></>:null}
    {tab==="clearance"?<ObjectSection title="Clearance"><Note>{role.clearance}. {role.assignableToAgents?"This role can be assigned to people and agents.":"This role is for people only."}</Note>{!role.builtIn?<Button label="Change clearance" onPress={()=>{setName(role.name);setClearance(role.clearance);setAgents(role.assignableToAgents);setSheet("edit");}}/>:<Note>Built-in roles are locked. Clone this role to make changes.</Note>}</ObjectSection>:null}
    {tab==="access"||tab==="grants"?<RoleGrants roleId={roleId}/>:null}{tab==="activity"?<RoleActivity roleId={roleId}/>:null}{action.note?<Note>{action.note}</Note>:null}
  </ObjectPage>;
}
function RoleGrants({roleId}:{roleId:string}):ReactElement {
  const data=useConsoleData();const query=useRead<AccessGrantsListOut>("access.grants.list",{subject:{kind:"role",id:roleId},limit:100});
  const[more,setMore]=useState<AccessGrantsListOut|null>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  if(!query.data)return <ReadState error={query.error} retry={query.refresh}/>;
  const next=more?more.next:query.data.next;const rows=[...query.data.grants,...(more?.grants??[])];
  return <ObjectSection title="Where granted"><Group>{rows.map((grant)=><Row key={grant.id} id={`role-grant-${grant.id}`} title={`${grant.level} · ${data.name(grant.resource.id)}`} note={`${grant.resource.type} · granted by ${data.name(grant.by)}${grant.conditions.expiresAt ? ` · expires ${new Date(grant.conditions.expiresAt).toLocaleDateString()}` : ""}`} onPress={()=>data.nav.openPage("grants",{resourceType:grant.resource.type,resourceId:grant.resource.id})}/>)}</Group>{!rows.length?<Note>No direct resource grants for this role.</Note>:null}{next?<Button label="Load more grants" disabled={busy} onPress={()=>{setBusy(true);void data.call("access.grants.list",{subject:{kind:"role",id:roleId},cursor:next,limit:100}).then((value)=>{const out=value as AccessGrantsListOut;setMore({...out,grants:[...(more?.grants??[]),...out.grants]});},()=>setError("Couldn’t load more grants.")).finally(()=>setBusy(false));}}/>:null}{error?<Note>{error}</Note>:null}</ObjectSection>;
}

function RoleActivity({roleId}:{roleId:string}):ReactElement {
 const data=useConsoleData();const query=useRead<AuditListOut>("audit.list",{target:{kind:"role",id:roleId},limit:50});const[more,setMore]=useState<AuditListOut|null>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState("");
 if(!query.data)return <ReadState error={query.error} retry={query.refresh}/>;
 const rows=[...query.data.rows,...(more?.rows??[])];const next=more?more.next:query.data.next;
 return <ObjectSection title="Activity"><Group>{rows.map((row)=><Row key={row.id} id={`role-activity-${row.id}`} title={row.action.replace(/[._]/g," ")} note={`${data.name(row.actor.id)} · ${new Date(row.at).toLocaleString()}`}/>)}</Group>{!rows.length?<Note>No recorded changes to this role.</Note>:null}{next?<Button label="Load earlier activity" disabled={busy} onPress={()=>{setBusy(true);void data.call("audit.list",{target:{kind:"role",id:roleId},cursor:next,limit:50}).then((value)=>{const out=value as AuditListOut;setMore({...out,rows:[...(more?.rows??[]),...out.rows]});},()=>setError("Couldn’t load earlier activity.")).finally(()=>setBusy(false));}}/>:null}{error?<Note>{error}</Note>:null}</ObjectSection>;
}
