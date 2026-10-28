import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bootCore, CORE_SPACE } from '../../fixtures/seed/core/index.ts';
import { startDaemon } from '../src/daemon/daemon.ts';
import { loadConfig } from '../src/daemon/config.ts';
import { fakePlatform } from '../src/platform/index.ts';
function unzip(bytes: Buffer): Map<string, Buffer> { const out = new Map<string, Buffer>(); let at = 0; while (at + 30 <= bytes.length && bytes.readUInt32LE(at) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(at + 8), 0);
    const size = bytes.readUInt32LE(at + 18), nameLength = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28), name = bytes.subarray(at + 30, at + 30 + nameLength).toString(), start = at + 30 + nameLength + extra;
    out.set(name, bytes.subarray(start, start + size));
    at = start + size;
} return out; }
test('HTTP shared Space archive contains canonical current records, retained file versions, shared chats/settings and no private or credential content', async () => {
    const core = bootCore(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyre-full-space-export-'));
    core.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE');
    fs.copyFileSync(core.file, path.join(dir, 'events.db'));
    core.close();
    const options: Parameters<typeof startDaemon>[0] = { config: loadConfig(['--data-dir', dir, '--port', '0'], {}, '1.2.3'), platform: fakePlatform({ os: 'linux', hostname: 'export-content', free: 80e9 }), fetch: () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{}') }), session: h => { const id = String(h.authorization ?? '').replace(/^Bearer /, ''); return ['usr_olivia', 'usr_tess'].includes(id) ? { space: CORE_SPACE, principal: { kind: 'person', id }, device: 'export-fixture' } : null; }, intervals: { fast: 3600000, slow: 3600000, encryption: 3600000, commands: 3600000, hooks: 3600000 } };
    let d = await startDaemon(options);
    const call = async (cap: string, input: any = {}, person = 'usr_olivia'): Promise<any> => { const response = await fetch(`${d.url}/v1/${cap.replaceAll('.', '/')}`, { method: 'POST', headers: { authorization: `Bearer ${person}`, 'content-type': 'application/json' }, body: JSON.stringify(input) }), body = await response.json() as any; assert.equal(response.status, 200, `${cap}: ${JSON.stringify(body)}`); return body.data; };
    try {
        await call('access.roles.assign', { subject: { kind: 'person', id: 'usr_tess' }, roleId: 'rol_admin' });
        const current = (await call('records.create', { type: 'contact', fields: { name: 'Original export contact' }, idempotencyKey: 'export-contact' })).record;
        const updated = (await call('records.update', { type: 'contact', recordId: current.id, patch: { name: 'Current export contact' }, baseVersion: current.version })).record;
        const removed = (await call('records.create', { type: 'contact', fields: { name: 'Deleted contact must stay absent' }, idempotencyKey: 'export-deleted' })).record;
        await call('records.delete', { type: 'contact', recordId: removed.id });
        const privateAgent = (await call('records.create', { type: 'agent', fields: { name: 'PRIVATE AGENT MARKER', owner: 'usr_tess' }, idempotencyKey: 'export-private-agent' })).record;
        const privateEnvelope = (await call('records.create', { type: 'envelope', fields: { title: 'PRIVATE ENVELOPE MARKER' }, idempotencyKey: 'export-private-envelope' })).record;
        const sharedAgent = (await call('records.create', { type: 'agent', fields: { name: 'Shared agent record' }, idempotencyKey: 'export-shared-agent' })).record;
        const tree = await call('files.tree'), spaceFolder = tree.roots.find((root: any) => root.key === 'projects').folderId;
        const sharedFile = (await call('files.create', { folderId: spaceFolder, name: 'shared.txt', content: { text: 'First retained file version' }, idempotencyKey: 'export-shared-file' })).file;
        const second = (await call('files.write', { fileId: sharedFile.fileId, baseVersion: sharedFile.version, content: { text: 'Current shared file bytes' } })).file;
    // secret-scan: fake; fixed synthetic provider-shaped credential used only to test archive exclusion.
        const token = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
        const secretFile = (await call('files.create', { folderId: spaceFolder, name: 'credentials.env', content: { text: `OPENAI_API_KEY=${token}` }, idempotencyKey: 'export-secret-file' })).file;
        const personalTree = await call('files.tree', {}, 'usr_tess'), personalFolder = personalTree.roots.find((root: any) => root.key === 'personal').folderId;
        await call('files.create', { folderId: personalFolder, name: 'private.txt', content: { text: 'OTHER PERSON PERSONAL FILE MARKER' }, idempotencyKey: 'export-private-file' }, 'usr_tess');
        const publicChannel = (await call('channels.create', { name: 'Export shared channel', visibility: 'public', idempotencyKey: 'export-public-channel' })).channel;
        await call('chat.post', { threadId: publicChannel.mainThreadId, body: 'Public Space message included', idempotencyKey: 'export-public-message' });
        const privateChannel = (await call('channels.create', { name: 'Private export fixture', visibility: 'invite', idempotencyKey: 'export-private-channel' }, 'usr_tess')).channel;
        await call('chat.post', { threadId: privateChannel.mainThreadId, body: 'OTHER PERSON PRIVATE CHAT MARKER', idempotencyKey: 'export-private-message' }, 'usr_tess');
        // Deliberately inconsistent legacy private descendants cannot be created by normal UI flows.
        const privateRow=(id:string,kind:string,title:string,channel:string,body:string)=>{
            const now=Date.now();d.db!.run('INSERT INTO chat_thread (id,kind,title,starter,channelId,parentThreadId,listed,modePlan,createdAt,version,updated_at) VALUES (?,?,?,?,?,?,0,0,?,0,?)',id,kind,title,'usr_tess',channel,publicChannel.mainThreadId,now,now);
            d.db!.run('INSERT INTO chat_message (id,thread,threadSeq,author,kind,body,blocks,depth,attachments,pinned,reactions,createdAt,version,updated_at) VALUES (?,?,1,?,?,?,?,0,?,0,?,?,0,?)',`msg_${id.slice(4)}`,id,'usr_tess','text',body,'[]','[]','[]',now,now);return{id};
        };
        const privateChild=privateRow('thr_exportprivatechild','thread','PRIVATE CHILD TITLE',privateChannel.channelId,'PRIVATE CHILD BODY MARKER');
        const privateHelper=privateRow('thr_exportprivatehelper','helper','PRIVATE HELPER TITLE',publicChannel.channelId,'PRIVATE HELPER BODY MARKER');
        const memory = await call('memory.propose_fact', { layer: 'person', text: 'PERSONAL MEMORY EXPORT MARKER', sourceKind: 'manual', sourceRef: 'export-fixture', idempotencyKey: 'export-personal-memory' }, 'usr_tess');
        assert.equal(memory.fact.layer, 'person');
        const vaultFolder = (await call('vault.folders.create', { name: 'Export privacy fixture', scope: 'shared', idempotencyKey: 'export-vault-folder' })).folder;
        await call('vault.item.put', { folderId: vaultFolder.id, name: 'VAULT EXCLUDED ITEM', kind: 'api_key', fields: [{ key: 'api_key', value: 'VAULT ONLY VALUE FOR EXPORT FIXTURE', secret: true }], idempotencyKey: 'export-vault-item' });
        await call('settings.set_space', { key: 'backup.encrypt', value: false });
        // An explicit broad Owner grant makes private fixture rows readable canonically. Scope classification must still refuse them.
        await d.log!.append({ id: 'evt_export_broad_fixture', type: 'grant.created', sv: 1, trace_id: '1'.repeat(32), actor: 'usr_olivia', vis: 'space', payload: { id: 'gr_exportfixture', subject_kind: 'actor', subject_id: 'usr_olivia', resource_type: 'record', resource_id: null, level: 'manage' } });
        for (const row of [privateAgent, privateEnvelope])
            await d.log!.append({ id: `evt_private_${row.id}`, type: 'resource.created', sv: 1, trace_id: '1'.repeat(32), actor: 'usr_olivia', vis: 'private', payload: { id: row.id, type: 'record', parent_id: null, label: 0, owner_id: 'usr_tess', holds: 0 } });
        for (const row of [privateChild, privateHelper])
            await d.log!.append({ id: `evt_private_thread_${row.id}`, type: 'resource.created', sv: 1, trace_id: '1'.repeat(32), actor: 'usr_olivia', vis: 'private', payload: { id: row.id, type: 'thread', parent_id: publicChannel.mainThreadId, label: 0, owner_id: 'usr_tess', holds: 0 } });
        await d.stop();
        d = await startDaemon(options);
        assert.ok((await call('records.query', { type: 'agent' })).rows.some((row: any) => row.id === privateAgent.id), 'broad Owner canonical read sees private fixture; export must independently classify scope');
        const candidates = (await call('threads.list', { kind: ['thread', 'helper'] })).threads;
        assert.ok(candidates.some((row: any) => row.threadId === privateChild.id));
        assert.ok(candidates.some((row: any) => row.threadId === privateHelper.id));
        const canonicalMessage = (await call('chat.messages.list', { threadId: publicChannel.mainThreadId })).messages[0];
        const run = await call('backup.export_start', { idempotencyKey: 'full-content-export' }), ready = await call('backup.export_status', { runId: run.runId });
        assert.equal(ready.state, 'ready');
        const chunks: Buffer[] = [];
        let offset = 0;
        while (offset < ready.sizeBytes) {
            const part = await call('files.read', { fileId: ready.fileId, as: 'base64', offset, length: 4096 });
            const chunk = Buffer.from(part.base64, 'base64');
            assert.ok(chunk.length);
            chunks.push(chunk);
            offset += chunk.length;
        }
        const zip = Buffer.concat(chunks);
        assert.equal(zip.length, ready.sizeBytes);
        const entries = unzip(zip), manifest = JSON.parse(entries.get('manifest.json')!.toString());
        assert.equal(manifest.scope, 'shared_space');
        assert.equal(manifest.source.before, manifest.source.after);
        const contacts = JSON.parse(entries.get('records/contact.json')!.toString());
        assert.equal(contacts.find((row: any) => row.id === current.id).fields.name, 'Current export contact');
        assert.equal(contacts.find((row: any) => row.id === current.id).version, updated.version);
        assert.ok(!contacts.some((row: any) => row.id === removed.id));
        assert.ok(JSON.parse(entries.get('records/agent.json')!.toString()).some((row: any) => row.id === sharedAgent.id));
        const file = manifest.files.find((row: any) => row.id === sharedFile.fileId);
        assert.equal(file.version, second.version);
        assert.equal(file.versions.length, 2);
        assert.ok(file.versions.some((version: any) => entries.get(version.path)!.toString() === 'First retained file version'));
        assert.ok(file.versions.some((version: any) => entries.get(version.path)!.toString() === 'Current shared file bytes'));
        assert.ok(manifest.exclusions.some((row: any) => row.id === secretFile.fileId && row.reason === 'credential_content'));
        assert.equal(JSON.parse(entries.get('settings.json')!.toString()).find((row: any) => row.key === 'backup.encrypt').value, false);
        const all = Buffer.concat([...entries.values()]).toString();
        for (const marker of [token, 'PRIVATE AGENT MARKER', 'PRIVATE ENVELOPE MARKER', 'OTHER PERSON PERSONAL FILE MARKER', 'OTHER PERSON PRIVATE CHAT MARKER', 'PRIVATE CHILD BODY MARKER', 'PRIVATE HELPER BODY MARKER', 'PERSONAL MEMORY EXPORT MARKER', 'VAULT ONLY VALUE FOR EXPORT FIXTURE', 'VAULT EXCLUDED ITEM', 'Deleted contact must stay absent'])
            assert.equal(all.includes(marker), false, 'private/credential/deleted fixture absent');
        assert.ok(all.includes('Public Space message included'));
        assert.deepEqual(JSON.parse(entries.get(`chats/${publicChannel.mainThreadId}.json`)!.toString()).messages.find((row: any) => row.messageId === canonicalMessage.messageId), canonicalMessage);
        for (const item of manifest.entries) {
            assert.equal(entries.get(item.path)!.length, item.sizeBytes);
            assert.equal(createHash('sha256').update(entries.get(item.path)!).digest('hex'), item.sha256);
        }
        const archivesBefore = d.db!.all('SELECT id FROM host_owner_archive').length;
        await call('files.create', { folderId: spaceFolder, name: 'missing-native-snapshot', kind: 'google_native', mime: 'application/vnd.google-apps.document', content: { base64: '' }, idempotencyKey: 'export-native-missing' });
        const refused = await fetch(`${d.url}/v1/backup/export_start`, { method: 'POST', headers: { authorization: 'Bearer usr_olivia', 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'export-missing-snapshot' }) });
        const refusal = await refused.json() as any;
        assert.equal(refused.status, 422, JSON.stringify(refusal));
        assert.match(refusal.error.message, /snapshot bytes are missing/);
        assert.equal(d.db!.all('SELECT id FROM host_owner_archive').length, archivesBefore, 'missing required content must not persist a partial archive');
        console.log(`Space ZIP verified: ${zip.length} bytes, ${entries.size} entries, ${manifest.records.length} records, ${manifest.files.length} files, ${manifest.chats.length} public threads.`);
    }
    finally {
        await d.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
