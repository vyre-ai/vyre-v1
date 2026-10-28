// Full Space ZIPs are already filtered by the backup handler. Keep this port separate from metadata exports.
import type { Ctx } from '../../../packages/contracts/src/ctx.ts';
import { mintUuid } from '../../../lib/ids.ts';
import type { BlobStore } from '../ctx/blobs.ts';
import type { RawDb } from '../ctx/db.ts';
import { fail } from '../routes/errors.ts';
const TTL = 24 * 60 * 60 * 1000, MAX = 256 * 1024 * 1024, CHUNK = 1024 * 1024;
type Execution = Pick<Ctx, 'space' | 'principal' | 'actingFor' | 'trace' | 'authorize' | 'run'> & {call?:Ctx['call']};
interface Archive {
    id: string;
    space: string;
    requester: string;
    run_id: string;
    blob_id: string;
    name: string;
    size: number;
    at: number;
    expires_at: number;
}
export function createOwnerArchives(o: {
    db: RawDb;
    blobs: BlobStore;
    space: string;
    owner(): string | null;
    now(): number;
    register(id: string, ctx: Execution): Promise<void>;
    collect?(ctx:Execution,assertOwner:()=>void):Promise<{path:string;bytes:Uint8Array}[]>;
    assertSnapshot?(ctx:Execution):void;
}) {
    const port = o.blobs.forModule('owner_archives');
    o.db.run('CREATE TABLE IF NOT EXISTS host_owner_archive (id TEXT PRIMARY KEY,space TEXT NOT NULL,requester TEXT NOT NULL,run_id TEXT NOT NULL,blob_id TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,at INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
    const get = (id: string) => (o.db.all('SELECT * FROM host_owner_archive WHERE id = ? AND space = ?', id, o.space)[0] as unknown as Archive | undefined);
    function check(ctx: Execution, row?: Archive): void { if (ctx.space !== o.space || ctx.principal.kind !== 'person' || ctx.actingFor || ctx.principal.id !== o.owner() || (row && row.requester !== ctx.principal.id) || ['server.backups', 'records.export'].some(perm => ctx.authorize({ perm, level: 'manage' }, { type: 'space', id: o.space }).effect !== 'allow'))
        throw fail('permission.no_grant', ctx.trace.traceId, { message: 'Only the current Space owner with export permission can read this private archive.' }); }
    async function cleanup(): Promise<void> { for (const row of o.db.all('SELECT * FROM host_owner_archive WHERE expires_at <= ? AND space = ?', o.now(), o.space) as unknown as Archive[]) {
        await port.delete(row.blob_id);
        o.db.run('DELETE FROM host_owner_archive WHERE id = ?', row.id);
        o.db.run('DELETE FROM backup_export WHERE file_id = ?', row.id);
    } }
    function live(ctx:Execution,row:Archive):void {
        check(ctx,row);
        if(row.expires_at<=o.now())throw fail('validation.not_found',ctx.trace.traceId,{message:'This Space archive has expired.'});
    }
    function forExecution(cap:string,ctx:Execution):Record<string,unknown>|undefined {
        if(cap!=='backup.export_start'&&cap!=='backup.export_status')return undefined;
        check(ctx);
        if(cap==='backup.export_status')return Object.freeze({status:async(runId:string)=>{
            await cleanup();const row=o.db.all('SELECT * FROM host_owner_archive WHERE run_id = ? AND space = ?',runId,o.space)[0] as unknown as Archive|undefined;
            if(!row)throw fail('validation.not_found',ctx.trace.traceId,{message:'This export is not ready or has expired.'});
            live(ctx,row);const blob=await port.get(row.blob_id);live(ctx,row);
            if(!blob)throw fail('validation.not_found',ctx.trace.traceId,{message:'This export is unavailable.'});
            return{runId,state:'ready',fileId:row.id,name:row.name,sizeBytes:row.size,expiresAt:row.expires_at};
        }});
        return Object.freeze({...(o.collect?{collect:()=>o.collect!(ctx,()=>check(ctx))}:{}),saveZip:async(runId:string,name:string,bytes:Uint8Array)=>{
            check(ctx);await cleanup();check(ctx);o.assertSnapshot?.(ctx);
            if(!/^run_[A-Za-z0-9]+$/.test(runId)||!(bytes instanceof Uint8Array)||bytes.length<4||bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4||bytes.length>MAX||!/^vyre-export-\d{4}-\d{2}-\d{2}\.zip$/.test(name))throw fail('validation.bad_input',ctx.trace.traceId,{message:'The generated Space archive is invalid or exceeds 256 MB.'});
            const at=o.now(),id=`fil_${mintUuid(at).replaceAll('-','')}`,blob=await port.put(bytes,'application/zip');
            try {
                const saved=await port.get(blob.id);
                if(!saved||saved.bytes.length!==bytes.length||!saved.bytes.every((value,index)=>value===bytes[index]))throw fail('internal.unavailable',ctx.trace.traceId,{message:'The Space archive could not be verified after storage.'});
                check(ctx);o.assertSnapshot?.(ctx);await o.register(id,ctx);check(ctx);o.assertSnapshot?.(ctx);
                if(at+TTL<=o.now())throw fail('validation.precondition_failed',ctx.trace.traceId,{message:'This archive expired during persistence. Create it again.'});
                // Status cannot see a ready pointer until verification and resource registration both finish.
                o.db.run('INSERT INTO host_owner_archive VALUES (?,?,?,?,?,?,?,?,?)',id,o.space,ctx.principal.id,runId,blob.id,name,bytes.length,at,at+TTL);
                return{fileId:id};
            }catch(error){o.db.run('DELETE FROM host_owner_archive WHERE id = ?',id);await port.delete(blob.id);throw error;}
        }});
    }
    async function read(cap:string,ctx:Execution,input:{fileId:string;as?:string;offset?:number;length?:number}):Promise<unknown>{
        await cleanup();const row=get(input.fileId);
        if(!row)throw fail('validation.not_found',ctx.trace.traceId,{message:'This Space archive has expired.'});
        live(ctx,row);
        if(cap==='files.get')return{file:{fileId:row.id,folderId:'fld_ownerarchives',name:row.name,kind:'archive',mime:'application/zip',size:row.size,version:1,label:0,ownerId:row.requester,createdAt:row.at,updatedAt:row.at,updatedBy:row.requester,thumb:false,holds:0}};
        if(input.as&&input.as!=='base64')throw fail('validation.bad_input',ctx.trace.traceId,{message:'Read private Space archives as authenticated base64 chunks.'});
        const blob=await port.get(row.blob_id);live(ctx,row);
        if(!blob)throw fail('validation.not_found',ctx.trace.traceId,{message:'This Space archive is unavailable.'});
        const start=input.offset??0,end=Math.min(blob.bytes.length,start+Math.min(input.length??CHUNK,CHUNK));
        return{mime:'application/zip',size:row.size,version:1,truncated:end<row.size,base64:Buffer.from(blob.bytes.subarray(start,end)).toString('base64')};
    }
    return { forExecution, read, cleanup, has: (id: string) => !!get(id) };
}
