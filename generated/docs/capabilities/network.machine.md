# network.machine

One machine with its history for a range (1 hour, 24 hours, 7 days or 30 days), what runs on it by agent and chat, and its Doctor findings

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/machine |
| MCP tool | network_machine (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  serverId: string;
  range?: "1h" | "24h" | "7d" | "30d";
};
```

## Output

```ts
type Out = {
  machine: {
    serverId: string;
    name: string;
    nickname?: string;
    kind: "space" | "server" | "linked";
    owner?: string;
    mine: boolean;
    state: "healthy" | "degraded" | "down";
    online: boolean;
    lastSeenAt?: number;
    version?: string;
    os?: string;
    arch?: string;
    cores?: number;
    memBytes?: number;
    diskBytes?: number;
    latencyMs?: number;
    load?: {
      cpu: number;
      memPct: number;
      diskPct: number;
      diskFreeBytes: number;
    };
    vyre?: {
      cpu: number;
      memPct: number;
    };
    private: boolean;
    runs: {
      turns: number;
      agentComputers: number;
      sites: number;
      automations: number;
    };
    can: Array<string>;
    room: {
      n: number;
      why: string;
    };
    limits: {
      maxTurns: number | null;
      maxAgentComputers: number | null;
    };
    drain: boolean;
    pins: Array<string>;
  };
  series: {
    range: "1h" | "24h" | "7d" | "30d";
    step: number;
    points: Array<{
        t: number;
        cpu: number | null;
        mem: number | null;
        disk: number | null;
        netIn: number | null;
        netOut: number | null;
      }>;
  };
  findings: Array<{
      key: string;
      state: "healthy" | "degraded" | "down";
      detail: string;
      next: string;
      fix: string | null;
    }>;
  work: Array<{
      agent: string;
      what: string;
      where: string;
      cpu: number;
    }>;
  alerts: Array<{
      alertId: string;
      serverId: string;
      kind: "disk" | "memory" | "offline" | "backup" | "update";
      title: string;
      detail: string;
    }>;
  privacy: "full" | "vyre_only";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "range": "1h",
    "serverId": "srv_a1b2c3"
  },
  "output": {
    "alerts": [
      {
        "alertId": "example",
        "detail": "example",
        "kind": "disk",
        "serverId": "srv_a1b2c3",
        "title": "example"
      }
    ],
    "findings": [
      {
        "detail": "example",
        "fix": "example",
        "key": "example",
        "next": "example",
        "state": "healthy"
      }
    ],
    "machine": {
      "arch": "example",
      "can": [
        "example"
      ],
      "cores": 1,
      "diskBytes": 1,
      "drain": true,
      "kind": "space",
      "lastSeenAt": 1760000000000,
      "latencyMs": 1,
      "limits": {
        "maxAgentComputers": 1,
        "maxTurns": 1
      },
      "load": {
        "cpu": 1,
        "diskFreeBytes": 1,
        "diskPct": 1,
        "memPct": 1
      },
      "memBytes": 1,
      "mine": true,
      "name": "example",
      "nickname": "example",
      "online": true,
      "os": "example",
      "owner": "example",
      "pins": [
        "example"
      ],
      "private": true,
      "room": {
        "n": 1,
        "why": "example"
      },
      "runs": {
        "agentComputers": 1,
        "automations": 1,
        "sites": 1,
        "turns": 1
      },
      "serverId": "srv_a1b2c3",
      "state": "healthy",
      "version": "example",
      "vyre": {
        "cpu": 1,
        "memPct": 1
      }
    },
    "privacy": "full",
    "series": {
      "points": [
        {
          "cpu": 1,
          "disk": 1,
          "mem": 1,
          "netIn": 1,
          "netOut": 1,
          "t": 1760000000000
        }
      ],
      "range": "1h",
      "step": 1
    },
    "work": [
      {
        "agent": "example",
        "cpu": 1,
        "what": "example",
        "where": "example"
      }
    ]
  }
}
```
