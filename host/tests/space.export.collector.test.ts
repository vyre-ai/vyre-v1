import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSpaceExport } from '../src/seams/space-export.ts';
function fixture() {
    let version = 2;
    const calls: {
        cap: string;
        input: any;
    }[] = [];
    // secret-scan: fake; fixed synthetic provider-shaped credential used only to test archive exclusion.
    const token = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const records = [{ id: 'rec_current', type: 'contact', version: 2, label: 0, fields: { name: 'Current name', tax_id: { sealed: 'tax_id', ref: 'private-sealed-reference', present: true } }, createdAt: 1, updatedAt: 2, holds: 0 }];
    const read = async (cap: string, input: any): Promise<any> => {
        calls.push({ cap, input });
        switch (cap) {
            case 'spaces.get': return { space: { id: 'spc_fixture', name: 'Fixture Space', owner: 'usr_owner' } };
            case 'schema.describe': return { types: [{ key: 'contact', scope: 'space', fields: [{ key: 'name', type: 'text' }, { key: 'tax_id', type: 'sealed' }], version: 1 }, { key: 'site_private', scope: 'site', fields: [], version: 1 }] };
            case 'records.query': return { rows: records, total: records.length };
            case 'files.list': return input.folder ? { files: [{ fileId: 'fil_shared', folderId: 'fld_space', name: 'shared.txt', kind: 'text', mime: 'text/plain', size: 5, version, label: 0, ownerId: 'usr_other' }, { fileId: 'fil_secret', folderId: 'fld_space', name: 'credentials.env', kind: 'text', mime: 'text/plain', size: token.length, version: 1, label: 0, ownerId: 'usr_owner' }], folders: [], total: 2 } : { files: [], folders: [{ folderId: 'fld_space', name: 'Space', scope: 'space' }, { folderId: 'fld_personal', name: 'Personal', scope: 'personal' }], total: 2 };
            case 'files.versions': return { versions: [{ versionId: 'ver_current', n: input.fileId === 'fil_shared' ? version : 1, at: 1, by: 'usr_owner' }] };
            case 'files.get': return { file: { fileId: input.fileId, folderId: 'fld_space', name: input.fileId === 'fil_shared' ? 'shared.txt' : 'credentials.env', label: 0, size: input.fileId === 'fil_shared' ? 5 : token.length, version: input.fileId === 'fil_shared' ? version : 1 } };
            case 'files.read': {
                const bytes = Buffer.from(input.fileId === 'fil_shared' ? 'hello' : token), start = input.offset ?? 0, end = Math.min(bytes.length, start + (input.length ?? bytes.length));
                return { base64: bytes.subarray(start, end).toString('base64'), size: bytes.length, version: input.fileId === 'fil_shared' ? version : 1, mime: 'text/plain', truncated: end < bytes.length };
            }
            case 'channels.list': return { channels: [{ channelId: 'chn_public', mainThreadId: 'thr_public', name: 'Public', visibility: 'public' }, { channelId: 'chn_private', mainThreadId: 'thr_private', visibility: 'invite' }] };
            case 'threads.list': return { threads: [{ threadId: 'thr_public', kind: 'channel', channelId: 'chn_public' }, { threadId: 'thr_private', kind: 'chat', starter: 'usr_other' }] };
            case 'threads.get': return { thread: input.threadId === 'thr_public' ? { threadId: 'thr_public', kind: 'channel', channelId: 'chn_public' } : { threadId: 'thr_private', kind: 'chat', starter: 'usr_other' } };
            case 'chat.messages.list': return { messages: [{ messageId: 'msg_shared', threadId: 'thr_public', threadSeq: 1, body: 'Shared message', enc: 0 }, { messageId: 'msg_encrypted', threadId: 'thr_public', threadSeq: 2, body: 'authorized encrypted envelope', enc: 2 }], hasMore: false };
            case 'settings.list': return { rows: [{ key: 'backup.encrypt', scope: 'space', value: true, default: true, source: 'space' }, { key: 'memory.private', scope: 'person', value: 'private memory' }] };
            default: throw new Error(`unexpected capability ${cap}`);
        }
    };
    return { read, calls, token, records, change: () => { version++; } };
}
test('Space export collects current canonical shared contents, omits credential files with a reason, and never reads Personal/private sources', async () => {
    const f = fixture();
    const out = await collectSpaceExport({ space: 'spc_fixture', requester: 'usr_owner', read: f.read, recordScope: async () => 'shared', assertOwner: async () => undefined, head: async () => 7, now: () => 1000 });
    const entries = new Map(out.entries.map(e => [e.path, Buffer.from(e.bytes)]));
    const manifest = JSON.parse(entries.get('manifest.json')!.toString());
    assert.deepEqual(JSON.parse(entries.get('chats/thr_public.json')!.toString()).messages[1], { messageId: 'msg_encrypted', threadId: 'thr_public', threadSeq: 2, body: 'authorized encrypted envelope', enc: 2 });
    assert.deepEqual(JSON.parse(entries.get('records/contact.json')!.toString())[0].fields.tax_id, { sealed: true, masked: true });
    assert.ok(!Buffer.concat([...entries.values()]).includes(Buffer.from('private-sealed-reference')));
    assert.ok([...entries.values()].some(bytes => bytes.toString() === 'hello'));
    assert.ok([...entries.values()].some(bytes => bytes.toString().includes('Current name')));
    assert.ok([...entries.values()].some(bytes => bytes.toString().includes('Shared message')));
    assert.ok([...entries.values()].some(bytes => bytes.toString().includes('backup.encrypt')));
    assert.ok([...entries.values()].some(bytes => bytes.toString().includes('authorized encrypted envelope')));
    assert.ok(!Buffer.concat([...entries.values()]).includes(Buffer.from(f.token)));
    assert.ok(manifest.exclusions.some((row: any) => row.id === 'fil_secret' && row.reason === 'credential_content'));
    assert.ok(!f.calls.some(call => JSON.stringify(call.input).includes('thr_private') || JSON.stringify(call.input).includes('fld_personal')));
    assert.ok(!f.calls.some(call => /vault|memory|identity|transcript|reveal/.test(call.cap)));
    assert.deepEqual(manifest.records.map((row: any) => ({ id: row.id, version: row.version })), [{ id: 'rec_current', version: 2 }]);
});
test('Space export refuses changed data and owner revocation rather than returning a successful partial archive', async () => {
    const f = fixture();
    let checks = 0;
    await assert.rejects(collectSpaceExport({ space: 'spc_fixture', requester: 'usr_owner', read: f.read, recordScope: async () => 'shared', assertOwner: async () => { if (++checks > 4)
            throw new Error('Owner revoked'); }, head: async () => 7, now: () => 1000 }), /Owner revoked/);
    let heads = 0;
    await assert.rejects(collectSpaceExport({ space: 'spc_fixture', requester: 'usr_owner', read: f.read, recordScope: async () => 'shared', assertOwner: async () => undefined, head: async () => ++heads, now: () => 1000 }), /changed|snapshot/i);
});
test('root-page files are collected and private child channel/helper scope cannot inherit a public parent', async () => {
    const f = fixture(), read = async (cap: string, input: any): Promise<any> => {
        const out = await f.read(cap, input);
        if (cap === 'files.list' && !input.folder)
            out.files = [{ fileId: 'fil_root', folderId: 'fld_space', name: 'root.txt', kind: 'text', mime: 'text/plain', size: 4, version: 1, label: 0 }];
        if (cap === 'files.get' && input.fileId === 'fil_root')
            return { file: { fileId: 'fil_root', folderId: 'fld_space', name: 'root.txt', size: 4, version: 1, label: 0 } };
        if (cap === 'files.read' && input.fileId === 'fil_root')
            return { base64: Buffer.from('root').toString('base64'), size: 4, version: 1, mime: 'text/plain', truncated: false };
        if (cap === 'threads.list')
            out.threads.push({ threadId: 'thr_invite_child', kind: 'thread', parentThreadId: 'thr_public', channelId: 'chn_private' }, { threadId: 'thr_private_child', kind: 'chat', parentThreadId: 'thr_public', channelId: 'chn_public' }, { threadId: 'thr_helper', kind: 'helper', parentThreadId: 'thr_public', channelId: 'chn_public' });
        return out;
    };
    const result = await collectSpaceExport({ space: 'spc_fixture', requester: 'usr_owner', read, recordScope: async () => 'shared', assertOwner: async () => undefined, head: async () => 7, now: () => 1000 });
    assert.ok(result.entries.some(entry => Buffer.from(entry.bytes).toString() === 'root'));
    assert.ok(!f.calls.some(call => call.cap === 'chat.messages.list' && ['thr_invite_child', 'thr_private_child', 'thr_helper'].includes(call.input.threadId)));
});
test('missing provider snapshot bytes, required read failures and record drift refuse the export', async () => {
    for (const mode of ['native', 'read', 'records'] as const) {
        const f = fixture();
        let queries = 0;
        const read = async (cap: string, input: any): Promise<any> => { if (mode === 'read' && cap === 'files.read')
            throw new Error('Required file unavailable'); const out = await f.read(cap, input); if (mode === 'native' && cap === 'files.list' && input.folder)
            out.files = [{ fileId: 'fil_shared', folderId: 'fld_space', name: 'native', kind: 'google_native', mime: 'application/vnd.google-apps.document', size: 0, version: 2, label: 0 }]; if (mode === 'native' && cap === 'files.read')
            return { base64: '', size: 0, version: 2, mime: 'application/pdf', truncated: false }; if (mode === 'records' && cap === 'records.query' && ++queries === 2)
            out.rows[0].version++; return out; };
        await assert.rejects(collectSpaceExport({ space: 'spc_fixture', requester: 'usr_owner', read, recordScope: async () => 'shared', assertOwner: async () => undefined, head: async () => 7, now: () => 1000 }), /snapshot bytes|Required file|Records changed/);
    }
});
test('credential-bearing record and setting values are omitted with metadata rather than silently rewritten', async () => {
    const f = fixture(), read = async (cap: string, input: any): Promise<any> => { const out = await f.read(cap, input); if (cap === 'records.query')
        out.rows[0].fields.note = f.token; if (cap === 'settings.list')
        out.rows.push({ key: 'fixture.setting', scope: 'space', value: f.token, default: 'safe' }); return out; };
    const result = await collectSpaceExport({ space: 'spc_fixture', requester: 'usr_owner', read, recordScope: async () => 'shared', assertOwner: async () => undefined, head: async () => 7, now: () => 1000 });
    const rows = JSON.parse(Buffer.from(result.entries.find(entry => entry.path === 'records/contact.json')!.bytes).toString());
    assert.equal('note' in rows[0].fields, false);
    const settings = JSON.parse(Buffer.from(result.entries.find(entry => entry.path === 'settings.json')!.bytes).toString());
    assert.equal('value' in settings.find((row: any) => row.key === 'fixture.setting'), false);
    assert.ok(result.manifest.exclusions.some((row: any) => row.category === 'record' && row.path === '/fields/note'));
    assert.ok(result.manifest.exclusions.some((row: any) => row.category === 'setting' && row.reason === 'credential_value'));
});
test('a mutation-start revision rejects a snapshot even when its durable log head has not moved yet', async () => {
    const f = fixture();
    let revision = 0;
    const read = async (cap: string, input: any) => { const out = await f.read(cap, input); if (cap === 'files.read')
        revision++; return out; };
    await assert.rejects(collectSpaceExport({ space: 'spc_fixture', requester: 'usr_owner', read, recordScope: async () => 'shared', assertOwner: async () => undefined, head: async () => 7, revision: () => revision, now: () => 1000 }), /changed/);
});

test('the current file pointer matches canonical bytes when conflict versions share a number',async()=>{
 const f=fixture(),read=async(cap:string,input:any):Promise<any>=>{if(cap==='files.versions'&&input.fileId==='fil_shared')return{versions:[{versionId:'ver_conflict',n:2,at:1},{versionId:'ver_current',n:2,at:2}]};if(cap==='files.read'&&input.fileId==='fil_shared'&&input.versionId==='ver_conflict')return{base64:Buffer.from('oldxx').toString('base64'),size:5,version:2,mime:'text/plain',truncated:false};return f.read(cap,input);};const out=await collectSpaceExport({space:'spc_fixture',requester:'usr_owner',read,recordScope:async()=> 'shared',assertOwner:async()=>undefined,head:async()=>7,now:()=>1000});const file=out.manifest.files.find((row:any)=>row.id==='fil_shared');assert.equal(file.currentVersionId,'ver_current');assert.equal(file.versions.length,2);assert.equal(Buffer.from(out.entries.find(entry=>entry.path===file.currentPath)!.bytes).toString(),'hello');
});
