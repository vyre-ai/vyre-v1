// machines (lane l-machines): every machine Vyre runs on, one table for Console > Machines and Settings > This device. The Space server, the servers an admin or a member added, and each member's linked computers
// report every 30 seconds (specs, load, what Vyre runs, what it can run, version, latency); the Space keeps one-minute points for a day and ten-minute points for 30 days.
// DECISION: the report is not a capability. It travels on the socket each machine already holds to the Space, and the host hands it to the module (hostCalls machines.ingest), so no session can post one.
// DECISION: privacy is decided once, in the handlers. On a member's own computer an admin sees its name, whether it is online, its capacity (cores, memory, limits) and Vyre's own work; the member sees everything.
//   A member sees only their own machines; an admin sees every machine.
// DECISION: "room left" is roomLeft in agent/src/placement/room.ts, the number the Machines page shows and the number placement skips a busy machine by.
import { defineManifest, ev, read, t, write } from '../packages/contracts/src/index.ts';

const kind = t.enm('space', 'server', 'computer');
const can = t.enm('claude_code', 'codex', 'docker', 'chrome');
const tightest = t.enm('cpu', 'memory', 'turns', 'disk', 'offline', 'draining', 'busy');
const load = t.obj({ cpuPct: t.num({ minimum: 0, maximum: 100 }), memUsedBytes: t.int({ minimum: 0 }), diskFreeBytes: t.int({ minimum: 0 }), netInBps: t.int({ minimum: 0 }), netOutBps: t.int({ minimum: 0 }) });
const agentComputerRow = t.obj({ computerId: t.id('cmt'), agentId: t.id('agt'), state: t.str(), tabs: t.int({ minimum: 0 }), tabLimit: t.int({ minimum: 0 }), caption: t.opt(t.str()) });
const machineRow = t.obj({
  machineId: t.str({ examples: ['space', 'srv_a1b2c3', 'device:dev_a1b2c3'], description: '"space", a server id, or "device:<device id>"' }),
  kind, name: t.str(), nickname: t.opt(t.str({ maxLength: 40 })), ownerId: t.opt(t.id('usr')),
  personal: t.bool({ description: 'A person\'s own linked computer' }), online: t.bool(), draining: t.bool(),
  restricted: t.bool({ description: 'An admin looking at a member\'s own computer: only name, online, capacity, limits and Vyre\'s own work are filled' }),
  lastSeenAt: t.opt(t.ts()), latencyMs: t.opt(t.int({ minimum: 0 })), version: t.opt(t.str()),
  os: t.opt(t.str()), arch: t.opt(t.str()), diskBytes: t.opt(t.int({ minimum: 0 })), gpu: t.opt(t.str()), cores: t.opt(t.int({ minimum: 1 })), memBytes: t.opt(t.int({ minimum: 0 })),
  load: t.opt(load), vyreLoad: t.opt(t.obj({ cpuPct: t.num({ minimum: 0, maximum: 100 }), memBytes: t.int({ minimum: 0 }) })),
  runs: t.obj({ turns: t.int({ minimum: 0 }), agentComputers: t.int({ minimum: 0 }), sites: t.int({ minimum: 0 }), automations: t.int({ minimum: 0 }) }),
  can: t.arr(can), limits: t.obj({ maxTurns: t.int({ minimum: 1 }), maxAgentComputers: t.int({ minimum: 0 }) }),
  pinned: t.arr(t.obj({ agentId: t.id('agt') })),
  room: t.obj({ score: t.int({ minimum: 0, maximum: 100 }), tightest }), alerts: t.int({ minimum: 0 }),
  agentComputers: t.arr(agentComputerRow),
});
const point = t.obj({
  t: t.ts({ description: 'Where the bucket starts' }), cpuPct: t.opt(t.num()), memPct: t.opt(t.num()), diskFreePct: t.opt(t.num()), netInBps: t.opt(t.num()), netOutBps: t.opt(t.num()),
  vyreCpuPct: t.opt(t.num()), vyreMemBytes: t.opt(t.num()),
});
const alertRow = t.obj({
  alertId: t.str(), machineId: t.str(), kind: t.enm('disk_low', 'memory_pressure', 'offline_pinned', 'update_waiting', 'backup_failed'), severity: t.enm('info', 'warn', 'bad'),
  title: t.str(), detail: t.str(), next: t.str(),
});
const V = { level: 'view', tool: 'engineer' } as const;

export default defineManifest({
  id: 'machines',
  title: 'Machines',
  owner: 'L2',
  events: [
    ev('machine.changed', 'A machine was renamed, limited, drained or had an agent pinned or unpinned', { p: { machineId: t.str(), what: t.arr(t.enm('nickname', 'limits', 'drain', 'pins')) }, subject: ['entity', '/machineId'] }),
  ],
  capabilities: [
    read('machines.list', 'Every machine you may see with its load, what Vyre runs on it, what it can run and its room left; agent computers nested under their host. An admin sees all, a member their own; on a member\'s computer an admin sees only name, online, capacity and Vyre\'s own work', {
      ...V, in: {}, out: { machines: t.arr(machineRow), summary: t.obj({ online: t.int({ minimum: 0 }), total: t.int({ minimum: 0 }), agentComputers: t.int({ minimum: 0 }), roomAvg: t.int({ minimum: 0, maximum: 100 }) }) },
    }),
    read('machines.get', 'One machine with its series for 1 hour (60 one-minute points), 24 hours (144 ten-minute), 7 days (168 hourly) and 30 days (180 four-hourly), its alerts and, for the Space server, the doctor\'s findings. A gap is a bucket with only its time', {
      ...V, in: { machineId: t.str() },
      out: {
        machine: machineRow, series: t.obj({ '1h': t.arr(point), '24h': t.arr(point), '7d': t.arr(point), '30d': t.arr(point) }), alerts: t.arr(alertRow),
        work: t.arr(t.obj({ agentId: t.id('agt'), what: t.str(), where: t.str(), minutes: t.int({ minimum: 0 }) })),
        findings: t.arr(t.obj({ key: t.str(), state: t.enm('healthy', 'degraded', 'down'), detail: t.str(), next: t.str() })),
      },
      errors: ['validation.not_found'],
    }),
    write('machines.set', 'Name a machine, set the most turns or agent computers it takes at once, drain it (no new work, what runs finishes) or pin an agent to it. A server is an admin\'s (and its owner\'s); a person\'s own computer is theirs, and an admin may only drain it', {
      ...V, in: {
        machineId: t.str(), nickname: t.opt(t.nullable(t.str({ maxLength: 40 }))), maxTurns: t.opt(t.int({ minimum: 1, maximum: 64 })), maxAgentComputers: t.opt(t.int({ minimum: 0, maximum: 32 })), drain: t.opt(t.bool()),
        pinAgent: t.opt(t.obj({ agentId: t.id('agt'), pinned: t.bool() })),
      },
      out: { machine: machineRow }, emits: ['machine.changed'], audit: 'always', idem: 'natural', errors: ['validation.not_found', 'permission.no_grant', 'validation.bad_input'],
    }),
    read('machines.alerts', 'What needs a look: disk under 10% free, memory pressure, a machine offline with pinned work, an update waiting, a failed backup. Each says what to do', {
      ...V, in: {}, out: { alerts: t.arr(alertRow) },
    }),
  ],
});
