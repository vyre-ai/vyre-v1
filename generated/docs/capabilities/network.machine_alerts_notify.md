# network.machine_alerts_notify

Host only: send each new machine alert to the Inbox once while it lasts

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/machine_alerts_notify |
| MCP tool | none |
| CLI | none |
| Emits | network.machine_alert |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  sent: number;
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
    "sent": 1
  }
}
```
