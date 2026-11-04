# machines.set

Name a machine, set the most turns or agent computers it takes at once, drain it (no new work, what runs finishes) or pin an agent to it. A server is an admin's (and its owner's); a person's own computer is theirs, and an admin may only drain it

| | |
|---|---|
| Module | machines |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/machines/set |
| MCP tool | machines_set (engineer) |
| CLI | none |
| Emits | machine.changed |

## Input

```ts
type In = {
  machineId: string;
  nickname?: string | null;
  maxTurns?: number;
  maxAgentComputers?: number;
  drain?: boolean;
  pinAgent?: {
    agentId: string;
    pinned: boolean;
  };
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
    "drain": true,
    "machineId": "example",
    "maxAgentComputers": 1,
    "maxTurns": 1,
    "nickname": "example",
    "pinAgent": {
      "agentId": "agt_a1b2c3",
      "pinned": true
    }
  },
  "output": {
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
    }
  }
}
```
