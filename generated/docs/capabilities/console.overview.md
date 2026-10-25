# console.overview

Overview: health, attention items, recent admin activity, usage, server CPU, memory and disk, and the last backup

| | |
|---|---|
| Module | console-views |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | console.access |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/overview |
| MCP tool | console_overview (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  health: "healthy" | "degraded" | "down";
  attention: Array<{
      kind: "failing_check" | "expiring_certificate" | "failed_run" | "stuck_update" | "limit_hit" | "access_review_due";
      title: string;
      ref?: string;
      since: number;
      next: string;
    }>;
  activity: Array<{
      at: number;
      actor: string;
      action: string;
      resource?: string;
    }>;
  usage: {
    turnsToday: number;
    costMicrosMonth: number;
    members: number;
    agents: number;
  };
  machine?: {
    cpuPercent?: number;
    memoryUsedBytes?: number;
    memoryTotalBytes?: number;
    diskFreeBytes?: number;
    diskTotalBytes?: number;
  };
  lastBackup?: {
    at: number;
    result: "verified" | "unverified";
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "activity": [
      {
        "action": "example",
        "actor": "example",
        "at": 1760000000000,
        "resource": "example"
      }
    ],
    "attention": [
      {
        "kind": "failing_check",
        "next": "example",
        "ref": "example",
        "since": 1760000000000,
        "title": "example"
      }
    ],
    "health": "healthy",
    "lastBackup": {
      "at": 1760000000000,
      "result": "verified"
    },
    "machine": {
      "cpuPercent": 1,
      "diskFreeBytes": 1,
      "diskTotalBytes": 1,
      "memoryTotalBytes": 1,
      "memoryUsedBytes": 1
    },
    "usage": {
      "agents": 1,
      "costMicrosMonth": 1,
      "members": 1,
      "turnsToday": 1
    }
  }
}
```
