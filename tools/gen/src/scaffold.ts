// vyre-gen new module <name> --lane <Lx>: a valid manifest (a get, a create, one event, one entity), registered in host/modules.json.
import type { Manifest } from '../../../packages/contracts/src/index.ts';
import { create, defineManifest, entity, ev, read, t } from '../../../packages/contracts/src/index.ts';

export function scaffoldModule(name: string, lane: string): { manifestSource: string; manifest: Manifest; registryRow: { id: string; owner: string; status: string } } {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) throw new Error(`module name must be kebab case: ${name}`);
  const noun = name.replace(/-/g, '_');
  const idp = t.id(noun.slice(0, 3).padEnd(3, 'x'));
  const manifest = defineManifest({
    id: name, title: name, owner: lane,
    events: [ev(`${noun}.created`, `A ${noun} was created`, { p: { id: idp }, subject: ['entity', '/id'] })],
    entities: [entity(noun, `${noun}_item`, `${noun.slice(0, 3)}_`, { name: 'text' }, 'space')],
    capabilities: [
      read(`${noun}.get`, `Read one ${noun}`, { in: { id: idp }, out: { name: t.str() } }),
      create(`${noun}.create`, `Create a ${noun}`, { in: { name: t.str() }, out: { id: idp }, emits: [`${noun}.created`] }),
    ],
  });
  const manifestSource = `// ${name} (lane ${lane}): scaffold from vyre-gen new module. Replace with the real declarations.
import { create, defineManifest, entity, ev, read, t } from '../packages/contracts/src/index.ts';

const idp = t.id(${JSON.stringify(noun.slice(0, 3).padEnd(3, 'x'))});

export default defineManifest({
  id: ${JSON.stringify(name)},
  title: ${JSON.stringify(name)},
  owner: ${JSON.stringify(lane)},
  events: [ev(${JSON.stringify(`${noun}.created`)}, ${JSON.stringify(`A ${noun} was created`)}, { p: { id: idp }, subject: ['entity', '/id'] })],
  entities: [entity(${JSON.stringify(noun)}, ${JSON.stringify(`${noun}_item`)}, ${JSON.stringify(`${noun.slice(0, 3)}_`)}, { name: 'text' }, 'space')],
  capabilities: [
    read(${JSON.stringify(`${noun}.get`)}, ${JSON.stringify(`Read one ${noun}`)}, { in: { id: idp }, out: { name: t.str() } }),
    create(${JSON.stringify(`${noun}.create`)}, ${JSON.stringify(`Create a ${noun}`)}, { in: { name: t.str() }, out: { id: idp }, emits: [${JSON.stringify(`${noun}.created`)}] }),
  ],
});
`;
  return { manifestSource, manifest, registryRow: { id: name, owner: lane, status: 'stub' } };
}
