# health.paused_reasons

What is paused and why (shown on the paused automation, sync or campaign)

| | |
|---|---|
| Module | health |
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
| HTTP | POST /v1/health/paused_reasons |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  paused: Array<{
      area: "automations" | "sync" | "sends" | "campaigns";
      key: string;
      reason: string;
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
    "paused": [
      {
        "area": "automations",
        "key": "example",
        "reason": "example"
      }
    ]
  }
}
```
