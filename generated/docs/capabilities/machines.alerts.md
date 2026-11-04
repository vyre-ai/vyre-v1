# machines.alerts

What needs a look: disk under 10% free, memory pressure, a machine offline with pinned work, an update waiting, a failed backup. Each says what to do

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
| HTTP | POST /v1/machines/alerts |
| MCP tool | machines_alerts (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  alerts: Array<{
      alertId: string;
      machineId: string;
      kind: "disk_low" | "memory_pressure" | "offline_pinned" | "update_waiting" | "backup_failed";
      severity: "info" | "warn" | "bad";
      title: string;
      detail: string;
      next: string;
    }>;
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
    ]
  }
}
```
