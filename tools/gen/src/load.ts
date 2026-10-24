import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Manifest } from '../../../packages/contracts/src/index.ts';

export interface Loaded { file: string; dir: '' | 'connectors' | 'kits'; manifest: Manifest }

const NOT_MANIFESTS = new Set(['permissions.ts', 'index.ts']);

export async function loadManifests(root: string): Promise<Loaded[]> {
  const out: Loaded[] = [];
  for (const dir of ['', 'connectors', 'kits'] as const) {
    const abs = join(root, 'manifests', dir);
    if (!existsSync(abs)) continue;
    const files = readdirSync(abs).filter((f) => f.endsWith('.ts') && !f.startsWith('_') && !NOT_MANIFESTS.has(f)).sort();
    for (const f of files) {
      const mod = (await import(pathToFileURL(join(abs, f)).href)) as { default?: Manifest };
      if (!mod.default) throw new Error(`manifests/${dir ? dir + '/' : ''}${f}: no default export`);
      out.push({ file: `manifests/${dir ? dir + '/' : ''}${f}`, dir, manifest: mod.default });
    }
  }
  return out;
}
