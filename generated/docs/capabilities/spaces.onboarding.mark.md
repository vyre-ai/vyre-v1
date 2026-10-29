# spaces.onboarding.mark

Mark an onboarding step done, put it off, or open it again

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/spaces/onboarding/mark |
| MCP tool | spaces_onboarding_mark (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  flow: "personal" | "team" | "member";
  step: string;
  state: "done" | "later" | "open";
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "flow": "personal",
    "state": "done",
    "step": "ai"
  },
  "output": {
    "ok": true
  }
}
```
