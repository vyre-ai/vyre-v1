# spaces.onboarding.seen

Note that the onboarding screen has opened for me once, so it does not open by itself again

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
| HTTP | POST /v1/spaces/onboarding/seen |
| MCP tool | spaces_onboarding_seen (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  flow: "personal" | "team" | "member";
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
    "flow": "personal"
  },
  "output": {
    "ok": true
  }
}
```
