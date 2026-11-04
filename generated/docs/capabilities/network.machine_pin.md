# network.machine_pin

Pin an agent to a machine so its turns always run there (waiting when it is away), or let it go

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/machine_pin |
| MCP tool | network_machine_pin (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  serverId: string;
  agentId: string;
  pinned: boolean;
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
    "agentId": "example",
    "pinned": true,
    "serverId": "srv_local"
  },
  "output": {
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
      "serverId": "srv_local",
      "state": "healthy",
      "version": "example",
      "vyre": {
        "cpu": 1,
        "memPct": 1
      }
    }
  }
}
```
