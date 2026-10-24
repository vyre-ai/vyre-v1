# console.usage

Usage and limits by agent, person and model for a period, plus the design-beta sentence

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
| HTTP | POST /v1/console/usage |
| MCP tool | console_usage (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  period: "day" | "week" | "month";
  by: "agent" | "person" | "model";
};
```

## Output

```ts
type Out = {
  rows: Array<{
      key: string;
      name: string;
      turns: number;
      tokensIn: number;
      tokensOut: number;
      costMicros: number;
    }>;
  note: string;
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
  "input": {
    "by": "agent",
    "period": "day"
  },
  "output": {
    "note": "Vyre is in design beta. Contact Clearfield Labs for more information on plans and pricing.",
    "rows": [
      {
        "costMicros": 1,
        "key": "example",
        "name": "example",
        "tokensIn": 1,
        "tokensOut": 1,
        "turns": 1
      }
    ]
  }
}
```
