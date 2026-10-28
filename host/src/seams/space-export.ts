// A current-state shared Space archive, collected through the original owner's canonical reads.
import { sha256Hex } from '../../../kernel/src/log/hash.ts';
export class SpaceExportError extends Error {
}
interface Entry {
    path: string;
    bytes: Uint8Array;
}
type Obj = Record<string, any>;
export interface ExportReader {
    space: string;
    requester: string;
    read(cap: string, input: Record<string, unknown>): Promise<any>;
    assertOwner(): Promise<void>;
    head(): Promise<number>;
    revision?(): number;
    now(): number;
    recordScope?(type: string, row: Obj): Promise<'shared' | 'private' | 'unknown'>;
    secrets?: readonly string[];
}
const enc = new TextEncoder(), MAX_BYTES = 240 * 1024 * 1024, MAX_ITEMS = 100000, CHUNK = 128 * 1024;
const sensitive = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|authorization|private[_-]?key|secret|token)$/i;
export function credentialContent(text: string, secrets: readonly string[] = []): boolean {
    return secrets.some(secret => secret.length >= 6 && text.includes(secret)) || /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b|\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|authorization|secret|token)["']?\s*[:=]\s*(?:"[^"\n]+"|'[^'\n]+'|[^\s,;}\n]+)/i.test(text) || /https?:\/\/[^\s/]+:[^\s/]+@/i.test(text);
}
export async function collectSpaceExport(o: ExportReader): Promise<{
    entries: Entry[];
    manifest: Obj;
}> {
    const started = o.now(), entries: Entry[] = [], exclusions: Obj[] = [], records: Obj[] = [], files: Obj[] = [], chats: Obj[] = [], sourceChecks: (() => Promise<void>)[] = [];
    let total = 0, items = 0,retainedItems=0;
    const retain=(count:number):void=>{retainedItems+=count;if(retainedItems>MAX_ITEMS)throw new SpaceExportError('The retained export item limit was reached. No partial archive was created.');};
    const check = async (): Promise<void> => { await o.assertOwner(); if (++items > MAX_ITEMS || o.now() - started > 120000)
        throw new SpaceExportError('This Space export exceeds the bounded snapshot window. Try again with fewer retained items.'); };
    const read = async (cap: string, input: Record<string, unknown> = {}): Promise<any> => { await check(); return o.read(cap, input); };
    const paths = new Set<string>();
    const hash = (bytes: Uint8Array): string => sha256Hex(bytes);
    const add = (path: string, bytes: Uint8Array): void => { if (path.startsWith('/') || path.split('/').includes('..') || paths.has(path))
        throw new SpaceExportError('Unsafe or duplicate export path.'); paths.add(path); total += bytes.length; if (total > MAX_BYTES)
        throw new SpaceExportError('The shared Space export exceeds 240 MiB of contents. No partial archive was created.'); entries.push({ path, bytes }); };
    const safeId = (id: unknown): string => { if (typeof id !== 'string' || !/^[-a-zA-Z0-9_]+$/.test(id))
        throw new SpaceExportError('A canonical item returned an unsafe identifier.'); return id; };
    const sanitize = (value: any, category: string, id: string, path = '', depth = 0): any => {
        if (depth > 32)
            throw new SpaceExportError('An export value exceeds the nesting limit.');
        if (typeof value === 'string' && credentialContent(value, o.secrets)) {
            exclusions.push({ category, id, path, reason: 'credential_value' });
            return undefined;
        }
        if (Array.isArray(value))
            return value.map((v, index) => sanitize(v, category, id, `${path}/${index}`, depth + 1) ?? null);
        if (value && typeof value === 'object')
            return Object.fromEntries(Object.entries(value).flatMap(([key, v]) => { if (sensitive.test(key) && v !== null && v !== undefined) {
                exclusions.push({ category, id, path: `${path}/${key}`, reason: 'credential_field' });
                return [];
            } const next = sanitize(v, category, id, `${path}/${key}`, depth + 1); return next === undefined ? [] : [[key, next]]; }));
        return value;
    };
    const json = (path: string, value: any): void => add(path, enc.encode(JSON.stringify(value, null, 2)));
    const pages = async (cap: string, key: string, input: Record<string, unknown> = {}): Promise<Obj[]> => { const out: Obj[] = []; let cursor: string | undefined; const seen = new Set<string>(); do {
        const page = await read(cap, { ...input, limit: 200, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(page[key]))
            throw new SpaceExportError(`${cap} did not return required contents.`);
        out.push(...page[key]);
        if (out.length > MAX_ITEMS)
            throw new SpaceExportError('This export has too many items.');
        cursor = typeof page.next === 'string' ? page.next : undefined;
        if (cursor) {
            if (seen.has(cursor))
                throw new SpaceExportError(`${cap} repeated a page cursor.`);
            seen.add(cursor);
        }
    } while (cursor); return out; };
    // Canonical Files may establish its root metadata on first read. Finish that before the snapshot boundary.
    await read('files.list', { section: 'space', limit: 1 });
    const before = await o.head(), mutationBefore = o.revision?.();
    const profile = await read('spaces.get');
    if (profile.space?.id !== o.space || profile.space?.owner !== o.requester)
        throw new SpaceExportError('The Space profile belongs to another Space.');
    json('space.json', sanitize(profile.space, 'space', o.space));
    const schema = await read('schema.describe');
    if (!Array.isArray(schema.types))
        throw new SpaceExportError('The Space schema is unavailable.');
    retain(schema.types.length);
    const types: Obj[] = schema.types.filter((type: Obj) => { if (type.scope !== undefined && type.scope !== 'space') {
        exclusions.push({ category: 'record_type', id: type.key, reason: 'non_space_scope' });
        return false;
    } return true; });
    json('records/schema.json', sanitize(types, 'schema', o.space));
    const recordSignature = (rows: Obj[]): string => JSON.stringify(rows.map(row => [row.id, row.version, row.deletedAt ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    for (const type of types) {
        if(!Array.isArray(type.fields))throw new SpaceExportError('A required record schema is incomplete.');
        const key = safeId(type.key), rows = await pages('records.query', 'rows', { type: key });
        const signature = recordSignature(rows);
        sourceChecks.push(async () => { if (recordSignature(await pages('records.query', 'rows', { type: key })) !== signature)
            throw new SpaceExportError(`Records changed during export: ${key}. Retry the snapshot.`); });
        const kept: Obj[] = [];
        let recordBytes = 0;
        for (const row of rows) {
            if(!Number.isSafeInteger(row.version)||row.version<1||!row.fields||typeof row.fields!=='object'||Array.isArray(row.fields))throw new SpaceExportError('A required current record is incomplete.');
            if (row.deletedAt !== undefined) {
                exclusions.push({ category: 'record', id: row.id, reason: 'deleted' });
                continue;
            }
            const scope = await o.recordScope?.(key, row) ?? 'unknown';
            if (scope === 'unknown')
                throw new SpaceExportError(`Cannot prove the shared scope of a required record in ${key}.`);
            if (scope === 'private') {
                exclusions.push({ category: 'record', type: key, reason: 'private_scope' });
                continue;
            }
            const id = safeId(row.id), fields = { ...row.fields };
            for (const field of type.fields ?? [])
                if (field.type === 'sealed' && field.key in fields)
                    fields[field.key] = { sealed: true, masked: true };
            const item = sanitize({ ...row, fields }, 'record', id);
            recordBytes += enc.encode(JSON.stringify(item)).length;
            if (recordBytes + total > MAX_BYTES)
                throw new SpaceExportError('Records exceed the remaining Space export size limit.');
            kept.push(item);
            records.push({ type: key, id, version: row.version, path: `records/${key}.json` });
        }
        json(`records/${key}.json`, kept);
    }
    const roots: Obj[] = [], fileRows: Obj[] = [];
    let rootCursor: string | undefined;
    const rootCursors = new Set<string>();
    do {
        const page = await read('files.list', { section: 'space', limit: 200, ...(rootCursor ? { cursor: rootCursor } : {}) });
        if (!Array.isArray(page.folders) || !Array.isArray(page.files))
            throw new SpaceExportError('The Space root contents are unavailable.');
        retain(page.folders.length+page.files.length);roots.push(...page.folders);
        fileRows.push(...page.files);
        rootCursor = page.next;
        if (rootCursor) {
            if (rootCursors.has(rootCursor))
                throw new SpaceExportError('The Space roots repeated a cursor.');
            rootCursors.add(rootCursor);
        }
    } while (rootCursor);
    const folders: Obj[] = [], queue = roots.filter(folder => { if (folder.scope !== 'space') {
        exclusions.push({ category: 'folder', reason: 'personal_scope' });
        return false;
    } return true; }), seenFolders = new Set<string>();
    while (queue.length) {
        const folder = queue.shift()!, id = safeId(folder.folderId);
        if (seenFolders.has(id))
            throw new SpaceExportError('The Space folder tree contains a cycle.');
        seenFolders.add(id);
        folders.push(folder);
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
            const page = await read('files.list', { section: 'space', folder: id, limit: 200, ...(cursor ? { cursor } : {}) });
            if (!Array.isArray(page.files) || !Array.isArray(page.folders))
                throw new SpaceExportError('A required Space folder is unavailable.');
            retain(page.files.length+page.folders.length);fileRows.push(...page.files);
            for (const child of page.folders) {
                if (child.scope === 'space')
                    queue.push(child);
                else
                    exclusions.push({ category: 'folder', reason: 'personal_scope' });
            }
            cursor = page.next;
            if (cursor) {
                if (seen.has(cursor))
                    throw new SpaceExportError('A Space folder repeated its page cursor.');
                seen.add(cursor);
            }
        } while (cursor);
    }
    json('files/folders.json', sanitize(folders, 'folder', o.space));
    for (const file of fileRows) {
        const id = safeId(file.fileId);
        if (!seenFolders.has(file.folderId)) {
            const folder = (await read('files.folder.get', { folderId: file.folderId })).folder;
            if (folder?.scope !== 'space') {
                exclusions.push({ category: 'file', reason: 'personal_scope' });
                continue;
            }
        }
        if (file.deletedAt !== undefined)
            continue;
        const versionsOut = await read('files.versions', { fileId: id });
        if (!Array.isArray(versionsOut.versions) || !versionsOut.versions.length)
            throw new SpaceExportError(`Retained versions are unavailable for ${id}.`);
        retain(versionsOut.versions.length);const versions: Obj[] = versionsOut.versions, parts: Entry[] = [], metadata: Obj[] = [];
        let pendingBytes = 0;
        for (const version of versions) {
            const versionId = safeId(version.versionId);
            let offset = 0, size = -1;
            const chunks: Uint8Array[] = [];
            do {
                const result = await read('files.read', { fileId: id, versionId, as: 'base64', offset, length: CHUNK });
                if (typeof result.base64 !== 'string' || result.version !== version.n || !Number.isSafeInteger(result.size) || result.size < 0)
                    throw new SpaceExportError(`Required snapshot bytes are unavailable for ${id}.`);
                if (size < 0)
                    size = result.size;
                if (result.size !== size)
                    throw new SpaceExportError(`File changed during export: ${id}.`);
                if (size > MAX_BYTES - total - pendingBytes)
                    throw new SpaceExportError('A file exceeds the remaining Space export size limit.');
                const bytes = new Uint8Array(Buffer.from(result.base64, 'base64'));
                if (bytes.length === 0 && offset < size)
                    throw new SpaceExportError(`A file download stopped early: ${id}.`);
                chunks.push(bytes);
                offset += bytes.length;
                if (offset > size)
                    throw new SpaceExportError('A file returned more bytes than its canonical size.');
            } while (offset < size);
            if (file.kind === 'google_native' && size === 0)
                throw new SpaceExportError(`Required provider-native snapshot bytes are missing for ${id}.`);
            const bytes = Buffer.concat(chunks), path = `files/${id}/versions/${versionId}.bin`;
            if (credentialContent(new TextDecoder().decode(bytes), o.secrets) || credentialContent(String(file.name), o.secrets)) {
                exclusions.push({ category: 'file_version', id, versionId, reason: 'credential_content' });
                continue;
            }
            pendingBytes += bytes.length;
            parts.push({ path, bytes });
            metadata.push({ ...version, path, sizeBytes: bytes.length, sha256: hash(bytes) });
        }
        if(!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_BYTES-total)throw new SpaceExportError('The current file exceeds the remaining export size.');
        // The current pointer is a byte/hash match, because retained conflict versions may share a version number.
        const currentChunks:Uint8Array[]=[];let currentOffset=0;do{const current=await read('files.read',{fileId:id,as:'base64',offset:currentOffset,length:CHUNK});if(typeof current.base64!=='string'||current.version!==file.version||current.size!==file.size)throw new SpaceExportError(`Current file bytes changed during export: ${id}.`);const chunk=new Uint8Array(Buffer.from(current.base64,'base64'));if(!chunk.length&&currentOffset<file.size)throw new SpaceExportError(`Current file bytes are missing: ${id}.`);currentChunks.push(chunk);currentOffset+=chunk.length;if(currentOffset>file.size)throw new SpaceExportError('A file returned more current bytes than its canonical size.');}while(currentOffset<file.size);
        const currentBytes=Buffer.concat(currentChunks),currentSecret=credentialContent(new TextDecoder().decode(currentBytes),o.secrets)||credentialContent(String(file.name),o.secrets),currentVersion=metadata.find(version=>version.n===file.version&&version.sha256===hash(currentBytes));
        if(currentSecret)exclusions.push({category:'file_current',id,reason:'credential_content'});else if(!currentVersion)throw new SpaceExportError(`Current file bytes do not match a retained version: ${id}.`);
        for (const part of parts)add(part.path, part.bytes);
        files.push({ ...sanitize(file, 'file', id), versions: metadata,...(currentVersion?{currentVersionId:currentVersion.versionId,currentPath:currentVersion.path}:{currentOmitted:'credential_content'}) });
        sourceChecks.push(async () => { const latest = await read('files.get', { fileId: id }), history = await read('files.versions', { fileId: id }); if (['version', 'size', 'name', 'folderId', 'label', 'updatedAt'].some(key => latest.file?.[key] !== file[key]) || JSON.stringify(history.versions) !== JSON.stringify(versions))
            throw new SpaceExportError(`File versions changed during export: ${id}. Retry the snapshot.`); });
    }
    json('files/index.json', files);
    const channels = (await pages('channels.list', 'channels', { section: 'space' })).filter(channel => { if (channel.visibility !== 'public') {
        exclusions.push({ category: 'channel', reason: 'private_scope' });
        return false;
    } return true; });
    const publicChannels = new Set(channels.map(ch => ch.channelId)), threads = await pages('threads.list', 'threads', { kind: ['channel', 'thread'] }), threadMap = new Map<string, Obj>(threads.map(thread => [thread.threadId, thread])), allowed = new Set<string>(), checked = new Map<string, boolean>();
    const sharedThread = async (thread: Obj, path = new Set<string>()): Promise<boolean> => {
        const id = safeId(thread.threadId);
        if (checked.has(id))
            return checked.get(id)!;
        if (path.has(id))
            throw new SpaceExportError('A chat parent chain contains a cycle.');
        if (!['channel', 'thread'].includes(thread.kind) || ['private', 'personal', 'invite'].includes(thread.visibility ?? thread.scope) || thread.private === true) {
            checked.set(id, false);
            return false;
        }
        if (thread.channelId && !publicChannels.has(thread.channelId)) {
            checked.set(id, false);
            return false;
        }
        const canonical = (await read('threads.get', { threadId: id })).thread;
        if (!canonical || canonical.threadId !== id || canonical.kind !== thread.kind || canonical.channelId !== thread.channelId || canonical.parentThreadId !== thread.parentThreadId)
            throw new SpaceExportError('A chat changed during export. Retry the snapshot.');
        let shared = false;
        if (canonical.parentThreadId) {
            const parent = threadMap.get(canonical.parentThreadId);
            shared = !!parent && await sharedThread(parent, new Set([...path, id]));
        }
        else
            shared = publicChannels.has(canonical.channelId) && channels.some(channel => channel.channelId === canonical.channelId && (canonical.kind === 'thread' || channel.mainThreadId === id));
        checked.set(id, shared);
        if (shared)
            allowed.add(id);
        return shared;
    };
    for (const thread of threads)
        await sharedThread(thread);
    for (const channel of channels)
        if (!allowed.has(channel.mainThreadId))
            throw new SpaceExportError('A required public channel thread is missing or has private scope.');
    for (const thread of threads) {
        if (!allowed.has(thread.threadId)) {
            exclusions.push({ category: 'thread', reason: 'private_scope' });
            continue;
        }
        const id = safeId(thread.threadId), messages: Obj[] = [];
        let after = 0, messageBytes = 0;
        for (;;) {
            const page = await read('chat.messages.list', { threadId: id, after, limit: 200 });
            if (!Array.isArray(page.messages))
                throw new SpaceExportError(`Shared chat messages are unavailable: ${id}.`);
            retain(page.messages.length);for (const message of page.messages) {
                if (message.threadId !== id)
                    throw new SpaceExportError('A chat returned a message from another thread.');
                if (message.enc > 0 && credentialContent(JSON.stringify(message), o.secrets))
                    throw new SpaceExportError('A shared encrypted envelope contains prohibited credentials and cannot be preserved safely.');
                const value = message.enc > 0 ? message : sanitize(message, 'message', message.messageId);
                messageBytes += enc.encode(JSON.stringify(value)).length;
                if (messages.length >= MAX_ITEMS || messageBytes + total > MAX_BYTES)
                    throw new SpaceExportError('Shared chat contents exceed the bounded Space export size.');
                messages.push(value);
            }
            if (!page.hasMore)
                break;
            const next = Math.max(...page.messages.map((m: Obj) => m.threadSeq));
            if (!Number.isSafeInteger(next) || next <= after)
                throw new SpaceExportError('A chat repeated its message window.');
            after = next;
        }
        json(`chats/${id}.json`, { thread: sanitize(thread, 'thread', id), messages });
        chats.push({ threadId: id, messageCount: messages.length, path: `chats/${id}.json` });
    }
    json('chats/channels.json', sanitize(channels, 'channel', o.space));
    const settings = await read('settings.list', { scope: 'space' });
    if (!Array.isArray(settings.rows))
        throw new SpaceExportError('Space settings are unavailable.');
    const spaceSettings = settings.rows.filter((row: Obj) => row.scope === 'space');
    json('settings.json', sanitize(spaceSettings, 'setting', o.space));
    for (const verify of sourceChecks)
        await verify();
    const after = await o.head();
    await o.assertOwner();
    if (after !== before || o.revision?.() !== mutationBefore)
        throw new SpaceExportError('The Space changed during export. Retry to get a consistent snapshot.');
    const manifest = { format: 'vyre-space-export', version: 1, scope: 'shared_space', spaceId: o.space, requester: o.requester, generatedAt: started, source: { before, after, ...(mutationBefore !== undefined ? { mutationBefore, mutationAfter: o.revision?.() } : {}) }, records, files: files.map(file => ({ id: file.fileId, version: file.version, currentVersionId:file.currentVersionId,currentPath:file.currentPath,currentOmitted:file.currentOmitted,versions: file.versions })), chats, settings: { scope: 'space', count: spaceSettings.length }, exclusions, privateCategoriesExcluded: ['personal_files', 'private_and_group_chats', 'personal_memory', 'vault_values', 'account_sessions', 'local_session_imports'], entries: entries.map(entry => ({ path: entry.path, sizeBytes: entry.bytes.length, sha256: hash(entry.bytes) })) };
    json('manifest.json', manifest);
    return { entries, manifest };
}
