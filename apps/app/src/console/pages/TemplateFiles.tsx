import {useEffect,useRef,useState} from "react";
import type {ReactElement} from "react";
import {View} from "react-native";
import type {CapMap} from "../../../../../generated/types.ts";
import {Row} from "../../../../../ui/src/Row/index.tsx";
import {Group,Section} from "../shell/ui.tsx";
import {useConsoleData} from "../shell/data.tsx";
import { Help, Actions,Button,Field,Note,ReadState,attempt,useAction,useRead} from "./shared.tsx";
type Listing=CapMap["files.list"]["out"];
type File=Listing["files"][number];
export function templateName(name:string):string{const clean=name.trim();if(!clean||clean.length>120||/[\\/\0]/.test(clean)||[".",".."].includes(clean)||clean.toLocaleLowerCase()==="agent.toml")throw new Error("Choose a file or folder name without path separators. Agent configuration stays outside the template.");return clean;}
export function TemplateFiles({onChanged}:{onChanged():void}):ReactElement{
 const roots=useRead<CapMap["files.tree"]["out"]>("files.tree",{});
 if(!roots.data)return <ReadState error={roots.error} retry={roots.refresh}/>;
 const root=roots.data.roots.find(root=>root.key==="agent_template"&&root.folderId);
 return root?.folderId?<TemplateFolder root={root.folderId} onChanged={onChanged}/>:<Note>The Space’s Agent template folder is unavailable. Retry Files before editing the template.</Note>;
}
function TemplateFolder({root,onChanged}:{root:string;onChanged():void}):ReactElement{
 const data=useConsoleData();const[path,setPath]=useState([{id:root,name:"Agent template"}]);const folder=path.at(-1)!;
 const list=useRead<Listing>("files.list",{section:"space",folder:folder.id,limit:100});const[more,setMore]=useState<Listing|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const[selected,setSelected]=useState<File|null>(null),[creating,setCreating]=useState(false),[folderName,setFolderName]=useState(""),[q,setQ]=useState("");const active=useRef(folder.id);active.current=folder.id;
 const refresh=()=>{setMore(null);list.refresh();onChanged();};const action=useAction(refresh);
 const navigate=(next:typeof path)=>{setPath(next);setMore(null);setSelected(null);setCreating(false);setFolderName("");setQ("");setError("");};
 if(!list.data)return <ReadState error={list.error} retry={list.refresh}/>;
 const files=[...list.data.files,...(more?.files??[])],folders=[...list.data.folders,...(more?.folders??[])],next=more?more.next:list.data.next;
 return <Section title="Edit Space template files"><Help>Changes update the Space template. Preview them before applying to existing agents; changed agent-owned files become suggestions.</Help><Actions>{path.length>1?<Button label="Parent folder" onPress={()=>navigate(path.slice(0,-1))}/>:null}<Button label="New text file" testID="template-file-new" onPress={()=>{setSelected(null);setCreating(true);}}/></Actions><Note>{path.map(folder=>folder.name).join(" / ")}</Note><Button label="Manage this folder in Files" onPress={()=>data.nav.openApp({screen:"files.list",args:{folderId:folder.id}})}/>
 <Field label="Find a template file" value={q} onChange={setQ}/><Group>{folders.filter(folder=>folder.name.toLowerCase().includes(q.toLowerCase())).map(child=><Row key={child.folderId} title={child.name} note="Folder" onPress={()=>navigate([...path,{id:child.folderId,name:child.name}])}/>)}{files.filter(file=>file.name.toLowerCase().includes(q.toLowerCase())).map(file=><Row key={file.fileId} id={`template-edit-${file.fileId}`} title={file.name} note={`Version ${file.version}`} trailing={<Button label="Edit text" disabled={!["text","markdown","code"].includes(file.kind)} onPress={()=>{setCreating(false);setSelected(file);}}/>}/>)}{!files.length&&!folders.length?<Help>No Space overrides in this folder. Built-in starter files remain available in the template.</Help>:null}</Group>
 {next?<Button label="Load more template files" disabled={busy} onPress={()=>{const requested=folder.id;setBusy(true);void data.call("files.list",{section:"space",folder:requested,limit:100,cursor:next}).then(result=>{if(active.current!==requested)return;const out=result as Listing;setMore({...out,files:[...(more?.files??[]),...out.files],folders:[...(more?.folders??[]),...out.folders]});},()=>setError("Couldn’t load more template files.")).finally(()=>setBusy(false));}}/>:null}
 {selected||creating?<TemplateText key={selected?.fileId??`new:${folder.id}`} folder={folder.id} {...(selected?{file:selected}:{})} onClose={()=>{setSelected(null);setCreating(false);}} onSaved={()=>{setSelected(null);setCreating(false);refresh();}}/>:null}
 <Field label="New template folder" value={folderName} onChange={setFolderName}/><Button label="Create template folder" disabled={action.busy||!folderName.trim()} why={!folderName.trim()?"Name the folder first":undefined} onPress={()=>{try{const name=templateName(folderName);void action.run("files.folder.create",{parentId:folder.id,name,idempotencyKey:attempt()},"Template folder created").then(out=>{if(out)setFolderName("");});}catch(error){setError(error instanceof Error?error.message:"Choose a valid folder name.");}}}/>{action.note||error?<Note>{error||action.note}</Note>:null}</Section>;
}
export function TemplateText({folder,file,onClose,onSaved}:{folder:string;file?:File;onClose():void;onSaved():void}):ReactElement{
 const read=useRead<CapMap["files.read"]["out"]>("files.read",{fileId:file?.fileId??"",as:"text"},{enabled:!!file});const[name,setName]=useState(file?.name??"NOTES.md"),[text,setText]=useState(""),[dirty,setDirty]=useState(false),[error,setError]=useState("");const action=useAction(onSaved);
 useEffect(()=>{if(!dirty&&read.data?.text!==undefined)setText(read.data.text);},[read.data,dirty]);
 if(file&&!read.data)return <ReadState error={read.error} retry={read.refresh}/>;
 if(file&&read.data?.truncated)return <View><Note>This file is too large to edit here. Open it in Files to keep its complete contents.</Note><Button label="Back to template files" onPress={onClose}/></View>;
 const save=()=>{setError("");try{const clean=templateName(name);void action.run(file?"files.write":"files.create",file?{fileId:file.fileId,baseVersion:file.version,content:{text},reason:"Edit Space Agent template"}:{folderId:folder,name:clean,kind:clean.endsWith(".md")?"markdown":"text",content:{text},idempotencyKey:attempt()},"Template file saved");}catch(error){setError(error instanceof Error?error.message:"Check the file name.");}};
 return <View testID="template-text-editor">{file?<Note>{file.name} · version {file.version}</Note>:<Field label="Template file name" testID="template-file-name" value={name} onChange={setName}/>}<Field label="Template file content" testID="template-file-content" multiline value={text} onChange={value=>{setDirty(true);setText(value);}}/><Actions><Button label="Cancel file edit" onPress={onClose}/><Button label="Save template file" testID="template-file-save" disabled={action.busy} onPress={save}/></Actions>{action.note||error?<Note>{error||action.note}</Note>:null}</View>;
}
