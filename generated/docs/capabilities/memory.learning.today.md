# memory.learning.today

What learning from your chats used today against your daily quota (model passes and input tokens), when it resets, and whether it learns with a model or by rules until then

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/learning/today |
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
  day: string;
  passes: number;
  tokensIn: number;
  tokensOut: number;
  rulePasses: number;
  capPasses: number;
  capTokens: number;
  resetsAt: number;
  timezone: string;
  state: "learning" | "rules_only";
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
    "capPasses": 1,
    "capTokens": 1,
    "day": "2026-11-03",
    "passes": 1,
    "resetsAt": 1760000000000,
    "rulePasses": 1,
    "state": "learning",
    "timezone": "example",
    "tokensIn": 1,
    "tokensOut": 1
  }
}
```
