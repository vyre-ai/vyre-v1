# network.machines

Every machine that runs Vyre work: the Space server, added servers and linked computers, with load, room left and alerts. A member's own computer shows an admin only name, online, capacity and Vyre's work

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
| HTTP | POST /v1/network/machines |
| MCP tool | network_machines (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  machines: Array<{
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
    }>;
  alerts: Array<{
      alertId: string;
      serverId: string;
      kind: "disk" | "memory" | "offline" | "backup" | "update";
      title: string;
      detail: string;
    }>;
  admin: boolean;
  now: number;
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
  "input": {},
  "output": {
    "admin": true,
    "alerts": [
      {
        "alertId": "example",
        "detail": "example",
        "kind": "disk",
        "serverId": "srv_a1b2c3",
        "title": "example"
      }
    ],
    "machines": [
      {
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
      }
    ],
    "now": 1760000000000
  }
}
```
