import type { ConnectorsCtx } from '../projections.ts';
import { refuse } from '../projections.ts';

type SourceFile = { path: string; content: string };
const MAX_FILES = 500, MAX_BYTES = 5 * 1024 * 1024;

function checkFiles(ctx: ConnectorsCtx, files: SourceFile[]): void {
 if (files.length > MAX_FILES || files.reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0) > MAX_BYTES) refuse(ctx, 'validation.too_large', 'This connector is too large to export.');
 for (const file of files) if (!/^(?:actions\/|tests\/)?[^/\\\x00-\x1f]{1,180}$/.test(file.path) || file.path.split('/').some(part => part === '.' || part === '..')) refuse(ctx, 'validation.bad_input', 'A connector source path is not valid.');
}

async function rootFolder(ctx: ConnectorsCtx, rootKey: string, what: string): Promise<string> {
 const tree = await ctx.call('files.tree', {}) as { roots: { key: string; folderId?: string }[] };
 const id = tree.roots.find(root => root.key === rootKey)?.folderId;
 return id ?? refuse(ctx, 'internal.unavailable', `${what} is unavailable.`);
}

async function childFolder(ctx: ConnectorsCtx, parentId: string, name: string): Promise<string | undefined> {
 const listed = await ctx.call('files.list', { folder: parentId, limit: 500 }) as { folders: { folderId: string; name: string }[] };
 return listed.folders.find(folder => folder.name === name)?.folderId;
}

/** The files of a connector, written into an existing folder through the original caller's normal Files capabilities. */
async function writeFiles(ctx: ConnectorsCtx, folderId: string, files: SourceFile[], tag: string): Promise<void> {
 const dirs = new Map<string, string>();
 for (const file of files) {
  const parts = file.path.split('/');
  let target = folderId;
  const name = parts.at(-1)!;
  if (parts.length === 2) {
   const part = parts[0]!;
   let child = dirs.get(part);
   if (!child) {
    const out = await ctx.call('files.folder.create', { parentId: folderId, name: part, idempotencyKey: `connector-dir:${tag}:${part}` }) as { folder: { folderId: string } };
    child = out.folder.folderId; dirs.set(part, child);
   }
   target = child;
  }
  await ctx.call('files.create', { folderId: target, name, content: { text: file.content }, mime: name.endsWith('.md') ? 'text/markdown' : name.endsWith('.json') ? 'application/json' : 'text/plain', kind: name.endsWith('.md') ? 'markdown' : 'code', idempotencyKey: `connector-source:${tag}:${file.path}` });
 }
}

/** A private export: handler-generated files in a new folder of the caller's own Personal Files. It is never the connector's source and never replaces its mapping. */
export async function writeConnectorFolder(ctx: ConnectorsCtx, key: string, files: SourceFile[]): Promise<string> {
 checkFiles(ctx, files);
 const parentId = await rootFolder(ctx, 'personal', 'Your Personal Files folder');
 const made = await ctx.call('files.folder.create', { parentId, name: `${key} connector ${ctx.trace.traceId.slice(0, 8)}`, idempotencyKey: `connector-folder:${ctx.trace.traceId}:${key}` }) as { folder: { folderId: string } };
 await writeFiles(ctx, made.folder.folderId, files, ctx.trace.traceId);
 return made.folder.folderId;
}

/**
 * The canonical editable source: Shared knowledge > connectors > <key>, with Review changes on, made through the original caller's Files capabilities (so the caller needs Files write there). The mapping is
 * registered by `register` as soon as the folder exists and before any file is written, so the source guard already covers the files this writes.
 */
export async function writeSourceFolder(ctx: ConnectorsCtx, key: string, files: SourceFile[], register: (folderId: string) => void): Promise<string> {
 checkFiles(ctx, files);
 const shared = await rootFolder(ctx, 'shared_knowledge', 'Shared knowledge');
 let connectors = await childFolder(ctx, shared, 'connectors');
 if (!connectors) connectors = ((await ctx.call('files.folder.create', { parentId: shared, name: 'connectors', idempotencyKey: `connector-source-root:${ctx.trace.traceId}` })) as { folder: { folderId: string } }).folder.folderId;
 if (await childFolder(ctx, connectors, key)) refuse(ctx, 'validation.duplicate', `Shared knowledge already has a connectors/${key} folder that is not this connector's source.`);
 const made = await ctx.call('files.folder.create', { parentId: connectors, name: key, reviewChanges: true, idempotencyKey: `connector-source-folder:${ctx.trace.traceId}:${key}` }) as { folder: { folderId: string } };
 register(made.folder.folderId);
 await writeFiles(ctx, made.folder.folderId, files, ctx.trace.traceId);
 return made.folder.folderId;
}
