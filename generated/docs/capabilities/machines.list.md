# machines.list

Every machine you may see with its load, what Vyre runs on it, what it can run and its room left; agent computers nested under their host. An admin sees all, a member their own; on a member's computer an admin sees only name, online, capacity and Vyre's own work

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
| HTTP | POST /v1/machines/list |
| MCP tool | machines_list (engineer) |
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
    }>;
  summary: {
    online: number;
    total: number;
    agentComputers: number;
    roomAvg: number;
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
  "input": {},
  "output": {
    "machines": [
      {
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
    ],
    "summary": {
      "agentComputers": 1,
      "online": 1,
      "roomAvg": 1,
      "total": 1
    }
  }
}
```
