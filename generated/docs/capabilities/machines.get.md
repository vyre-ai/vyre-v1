# machines.get

One machine with its series for 1 hour (60 one-minute points), 24 hours (144 ten-minute), 7 days (168 hourly) and 30 days (180 four-hourly), its alerts and, for the Space server, the doctor's findings. A gap is a bucket with only its time

| | |
|---|---|
| Module | machines |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/machines/get |
| MCP tool | machines_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  machineId: string;
};
```

## Output

```ts
type Out = {
  machine: {
    machineId: string;
    kind: "space" | "server" | "computer";
    name: string;
    nickname?: string;
    ownerId?: string;
    personal: boolean;
    mine: boolean;
    online: boolean;
    draining: boolean;
    restricted: boolean;
    lastSeenAt?: number;
    latencyMs?: number;
    version?: string;
    os?: string;
    arch?: string;
    diskBytes?: number;
    gpu?: string;
    cores?: number;
    memBytes?: number;
    load?: {
      cpuPct: number;
      memUsedBytes: number;
      diskFreeBytes: number;
      netInBps: number;
      netOutBps: number;
    };
    vyreLoad?: {
      cpuPct: number;
      memBytes: number;
    };
    runs: {
      turns: number;
      agentComputers: number;
      sites: number;
      automations: number;
    };
    can: Array<"claude_code" | "codex" | "docker" | "chrome">;
    limits: {
      maxTurns: number;
      maxAgentComputers: number;
    };
    pinned: Array<{
        agentId: string;
      }>;
    room: {
      score: number;
      tightest: "cpu" | "memory" | "turns" | "disk" | "offline" | "draining" | "busy";
    };
    alerts: number;
    agentComputers: Array<{
        computerId: string;
        agentId: string;
        state: string;
        tabs: number;
        tabLimit: number;
        caption?: string;
      }>;
  };
  series: {
    "1h": Array<{
        t: number;
        cpuPct?: number;
        memPct?: number;
        diskFreePct?: number;
        netInBps?: number;
        netOutBps?: number;
        vyreCpuPct?: number;
        vyreMemBytes?: number;
      }>;
    "24h": Array<{
        t: number;
        cpuPct?: number;
        memPct?: number;
        diskFreePct?: number;
        netInBps?: number;
        netOutBps?: number;
        vyreCpuPct?: number;
        vyreMemBytes?: number;
      }>;
    "7d": Array<{
        t: number;
        cpuPct?: number;
        memPct?: number;
        diskFreePct?: number;
        netInBps?: number;
        netOutBps?: number;
        vyreCpuPct?: number;
        vyreMemBytes?: number;
      }>;
    "30d": Array<{
        t: number;
        cpuPct?: number;
        memPct?: number;
        diskFreePct?: number;
        netInBps?: number;
        netOutBps?: number;
        vyreCpuPct?: number;
        vyreMemBytes?: number;
      }>;
  };
  alerts: Array<{
      alertId: string;
      machineId: string;
      kind: "disk_low" | "memory_pressure" | "offline_pinned" | "update_waiting" | "backup_failed";
      severity: "info" | "warn" | "bad";
      title: string;
      detail: string;
      next: string;
    }>;
  work: Array<{
      kind: "turn" | "site" | "automation";
      agentId?: string;
      what: string;
      where: string;
      minutes: number;
    }>;
  findings: Array<{
      key: string;
      state: "healthy" | "degraded" | "down";
      detail: string;
      next: string;
      fix: ("clear_caches" | "stop_idle" | "update") | null;
    }>;
  idleSessions: number;
  privacy: "full" | "vyre_only";
  lastFix?: {
    fix: string;
    at: number;
    state: "done" | "failed";
    detail: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "machineId": "example"
  },
  "output": {
    "alerts": [
      {
        "alertId": "example",
        "detail": "example",
        "kind": "disk_low",
        "machineId": "example",
        "next": "example",
        "severity": "info",
        "title": "example"
      }
    ],
    "findings": [
      {
        "detail": "example",
        "fix": "clear_caches",
        "key": "example",
        "next": "example",
        "state": "healthy"
      }
    ],
    "idleSessions": 1,
    "lastFix": {
      "at": 1760000000000,
      "detail": "example",
      "fix": "example",
      "state": "done"
    },
    "machine": {
      "agentComputers": [
        {
          "agentId": "agt_a1b2c3",
          "caption": "example",
          "computerId": "cmt_a1b2c3",
          "state": "example",
          "tabLimit": 1,
          "tabs": 1
        }
      ],
      "alerts": 1,
      "arch": "example",
      "can": [
        "claude_code"
      ],
      "cores": 1,
      "diskBytes": 1,
      "draining": true,
      "gpu": "example",
      "kind": "space",
      "lastSeenAt": 1760000000000,
      "latencyMs": 1,
      "limits": {
        "maxAgentComputers": 1,
        "maxTurns": 1
      },
      "load": {
        "cpuPct": 1,
        "diskFreeBytes": 1,
        "memUsedBytes": 1,
        "netInBps": 1,
        "netOutBps": 1
      },
      "machineId": "space",
      "memBytes": 1,
      "mine": true,
      "name": "example",
      "nickname": "example",
      "online": true,
      "os": "example",
      "ownerId": "usr_a1b2c3",
      "personal": true,
      "pinned": [
        {
          "agentId": "agt_a1b2c3"
        }
      ],
      "restricted": true,
      "room": {
        "score": 1,
        "tightest": "cpu"
      },
      "runs": {
        "agentComputers": 1,
        "automations": 1,
        "sites": 1,
        "turns": 1
      },
      "version": "example",
      "vyreLoad": {
        "cpuPct": 1,
        "memBytes": 1
      }
    },
    "privacy": "full",
    "series": {
      "1h": [
        {
          "cpuPct": 1,
          "diskFreePct": 1,
          "memPct": 1,
          "netInBps": 1,
          "netOutBps": 1,
          "t": 1760000000000,
          "vyreCpuPct": 1,
          "vyreMemBytes": 1
        }
      ],
      "24h": [
        {
          "cpuPct": 1,
          "diskFreePct": 1,
          "memPct": 1,
          "netInBps": 1,
          "netOutBps": 1,
          "t": 1760000000000,
          "vyreCpuPct": 1,
          "vyreMemBytes": 1
        }
      ],
      "30d": [
        {
          "cpuPct": 1,
          "diskFreePct": 1,
          "memPct": 1,
          "netInBps": 1,
          "netOutBps": 1,
          "t": 1760000000000,
          "vyreCpuPct": 1,
          "vyreMemBytes": 1
        }
      ],
      "7d": [
        {
          "cpuPct": 1,
          "diskFreePct": 1,
          "memPct": 1,
          "netInBps": 1,
          "netOutBps": 1,
          "t": 1760000000000,
          "vyreCpuPct": 1,
          "vyreMemBytes": 1
        }
      ]
    },
    "work": [
      {
        "agentId": "agt_a1b2c3",
        "kind": "turn",
        "minutes": 1,
        "what": "example",
        "where": "example"
      }
    ]
  }
}
```
