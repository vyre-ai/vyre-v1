// @reads /modules/connectors/migrations/0001_connectors.sql
// Connectors module (lane L3). The host loads these handlers once the manifest status is live (ARCH 12.4).
// Secrets arrive through deps.resolveSecret (the Vault, resolved server side at call time); this module stores only handles. Standalone (tests, the loader entry below) it opens a kernel
// store for a database handle; the host passes the Space's tx when it builds the handle.
import { readFileSync } from "node:fs";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import type { ProjectionHost, Tx } from "../../kernel/src/store/projection.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import type { SpaceStoreSeam } from "../../host/src/daemon/store.ts";
import { writeConnectorFolder } from "./handlers/files.ts";
import { createConnectorsHandlers } from "./handlers/index.ts";
import type { ConnectorsHandlers } from "./handlers/index.ts";
import { ensureTables, seedBuiltins } from "./projections.ts";
import { refuse } from "./projections.ts";
import type { BuiltinRow, ConnectorsCtx, ConnectionDb, ConnectorDef } from "./projections.ts";
import type { SyncDeps, SyncEngine } from "./handlers/sync.ts";

export function loadBuiltins(path: URL = new URL("../../generated/registry.json", import.meta.url)): BuiltinRow[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { connectors: BuiltinRow[] }).connectors;
}

export interface ConnectorsHandle { deps: SyncDeps; tx: Tx; host?: ProjectionHost; handlers: ConnectorsHandlers }

export function openConnectors(o: Partial<Omit<SyncDeps, "tx">> & { tx?: Tx; path?: string; space?: string } = {}): ConnectorsHandle {
  let tx = o.tx;
  let host: ProjectionHost | undefined;
  if (!tx) {
    const opened = openRecordStore({ path: o.path ?? ":memory:", space: o.space ?? "sp_connectors" });
    host = opened.host;
    tx = opened.host.tx;
  }
  const { tx: _t, path: _p, space: _s, builtins, ...rest } = o as Partial<SyncDeps> & { path?: string; space?: string };
  void _t; void _p; void _s;
  const deps: SyncDeps = { ...rest, tx, builtins: builtins ?? loadBuiltins() };
  ensureTables(tx);
  seedBuiltins(deps);
  return { deps, tx, ...(host ? { host } : {}), handlers: createConnectorsHandlers(deps) };
}

// ---- loader entry ----

type HostCtx = Omit<ConnectorsCtx, "actor"> & { authorize(action:{perm:string|null;level:"use"|"view"|"edit"|"manage"},resource:{type:string;id:string|null}):{effect:string};rememberVaultItem?(id:string):void;assertAuthorized?():void;space:string; principal: { kind:string;id: string };actingFor?:string;depth:number;trace:{traceId:string;spanId:string} };
interface ConnectorsHost { publicBase():string; fill(ctx:HostCtx,binding:{connector:string;connectionId:string;slot:string;handle:string}):Promise<string>;http(ctx:HostCtx,domains:readonly string[],url:string,init?:{method?:string;headers?:Record<string,string>;body?:string}):ReturnType<ConnectorsCtx['http']> }
let connectorHost:ConnectorsHost|null=null;
export function setConnectorsHost(host:ConnectorsHost|null):void{connectorHost=host;}
let shared: ConnectorsHandle | null = null;
let spaceSeam: SpaceStoreSeam | null = null;
let engine: SyncEngine | null = null;
/** The host hands the Space store (P-H_08, ruling 31). */
export function setConnectorsSpaceStore(seam: SpaceStoreSeam | null): void { spaceSeam = seam; shared = null; }
export const hostSeams: SeamSetters = { setConnectorsSpaceStore, setSyncEngine, setConnectorsHost };
const live = (): ConnectorsHandle => {
  if (!shared) {
    shared = openConnectors(spaceSeam ? { tx: spaceSeam.open().tx } : {});
    if (engine) shared.deps.engine = engine;
  }
  return shared;
};
/** The host hands the sync engine (modules/sources) to the live handlers: preview, undo, conflict settling, replay, confirm deletes and push need it (boundary B1 keeps this module from importing it). */
export function setSyncEngine(e: SyncEngine | null): void { engine = e; if (shared) { if (e) shared.deps.engine = e; else delete shared.deps.engine; } }

function adapt(name: keyof ConnectorsHandlers): (ctx: HostCtx, input: never) => Promise<unknown> {
  return (ctx, input) => {
    const handle = live(), port=connectorHost, args=input as Record<string,unknown>;
    const connectionId=typeof args['connectionId']==='string'?args['connectionId']:typeof args['state']==='string'?handle.tx.get<{connection_id:string}>('SELECT connection_id FROM cn_oauth WHERE state = ?',args['state'])?.connection_id:undefined;
    const connection=connectionId?handle.tx.get<ConnectionDb>('SELECT * FROM cn_connections WHERE connection_id = ?',connectionId):undefined;
    const key=typeof args['key']==='string'?args['key']:typeof args['connector']==='string'?args['connector']:connection?.connector;
    const stored=key?handle.tx.get<{def:string;state:string}>('SELECT def,state FROM cn_connectors WHERE key = ?',key):undefined;
    const definition=stored?JSON.parse(stored.def) as ConnectorDef:undefined;
    const usedVaultItems=new Set<string>();
    const assertAuthorized=()=>{
      const current=key?handle.tx.get<{def:string;state:string}>('SELECT def,state FROM cn_connectors WHERE key = ?',key):undefined;
      if(!current||current.state!=='live'||current.def!==stored?.def)return refuse(cc,'validation.precondition_failed','The connector changed while preparing this request. Try again.');
      const resource=name==='connections.complete_auth'?{type:'space',id:ctx.space}:name==='connectors.run'?{type:'connector',id:key!}:{type:'connection',id:connectionId??''};
      const action={perm:name==='connectors.run'||name==='sync_types.discover'?'connectors.manage':null,level:name==='connectors.run'||name==='connections.complete_auth'?'use' as const:'view' as const};
      if(ctx.authorize(action,resource).effect!=='allow')return refuse(cc,'permission.no_grant','Access changed before this connector request.');
      for(const id of usedVaultItems)if(ctx.authorize({perm:null,level:'use'},{type:'vault_item',id}).effect!=='allow')return refuse(cc,'permission.no_grant','Vault access changed before this connector request.');
    };
    const execution={...ctx,rememberVaultItem:(id:string)=>usedVaultItems.add(id),assertAuthorized};
    const cc: ConnectorsCtx = {
      trace: ctx.trace, emit: (n, s, p, o) => ctx.emit(n, s, p, o), call: (c, i) => ctx.call(c, i),
      http: (url,init) => port&&definition&&stored?.state==='live'?port.http(execution,definition.domains,url,init):ctx.http(url,init),
      ...(ctx.log ? { log: ctx.log } : {}), ...((ctx.actingFor??ctx.principal?.id)?{actor:ctx.actingFor??ctx.principal!.id}:{}),
    };
    const bound = createConnectorsHandlers({ ...handle.deps, writeFolder: (key, files) => writeConnectorFolder(cc, key, files), ...(port?{
      publicBase:port.publicBase(),
      resolveSecret:async(secretHandle:string,binding?:{connector:string;connectionId:string;slot:string})=>{
        if(!binding) return refuse(cc,'permission.no_grant','Select an authorized connection before using a Vault item.');
        const selected=handle.tx.get<ConnectionDb>('SELECT * FROM cn_connections WHERE connection_id = ?',binding.connectionId);
        const row=selected?handle.tx.get<{def:string}>('SELECT def FROM cn_connectors WHERE key = ?',selected.connector):undefined;
        const def=row?JSON.parse(row.def) as ConnectorDef:undefined;
        if(!selected||selected.connector!==binding.connector||!def?.secrets.some(slot=>slot.name===binding.slot)||(JSON.parse(selected.secrets) as Record<string,string>)[binding.slot]!==secretHandle||(selected.owner_kind==='person'&&selected.owner_id!==cc.actor))return refuse(cc,'permission.no_grant','That connection cannot use this Vault item.');
        await ctx.call('connections.get',{connectionId:selected.connection_id});
        return port.fill(execution,{...binding,handle:secretHandle});
      },
    }: {}) });
    return (bound[name] as (c: ConnectorsCtx, i: unknown) => Promise<unknown>)(cc, input);
  };
}

const NAMES = [
  "connectors.list", "connectors.get", "connectors.init", "connectors.build", "connectors.test", "connectors.run", "connectors.diff", "connectors.publish", "connectors.versions",
  "connectors.rollback", "connectors.export", "connectors.remove", "connectors.health",
  "connections.list", "connections.get", "connections.create", "connections.update", "connections.pause", "connections.resume", "connections.reconnect", "connections.complete_auth",
  "connections.test", "connections.delete",
  "sync_types.list", "sync_types.get", "sync_types.discover", "sync_types.create", "sync_types.update", "sync_types.preview", "sync_types.pause", "sync_types.resume", "sync_types.log",
  "sync_types.schema_changes", "sync_types.review_schema", "sync_types.confirm_deletes", "sync_types.make_native", "sync_types.resolve_conflict", "sync_types.replay_conflict", "sync_types.undo_push",
  "connectors.sync_now", "connectors.outbox.list", "connectors.outbox.retry", "connectors.outbox.cancel", "connectors.push",
] as const satisfies readonly (keyof ConnectorsHandlers)[];

export const handlers = Object.fromEntries(NAMES.map((n) => [n, adapt(n)])) as Record<(typeof NAMES)[number], (ctx: HostCtx, input: never) => Promise<unknown>>;
export { createConnectorsHandlers };
export { executeAction, runCases, diffDefs, noteSchemaChanges, syncRequest } from "./handlers/index.ts";
