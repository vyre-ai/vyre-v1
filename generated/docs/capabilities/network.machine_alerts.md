# network.machine_alerts

The machine alerts the asker may see: disk under 10 percent free, memory pressure, a machine offline with pinned work, a failed backup, an update waiting (the Console dot and the Inbox line)

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
| HTTP | POST /v1/network/machine_alerts |
| MCP tool | network_machine_alerts (engineer) |
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
      serverId: string;
      kind: "disk" | "memory" | "offline" | "backup" | "update";
      title: string;
      detail: string;
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
        "kind": "disk",
        "serverId": "srv_local",
        "title": "example"
      }
    ]
  }
}
```
