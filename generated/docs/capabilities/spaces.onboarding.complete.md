# spaces.onboarding.complete

Mark a checklist step done (steps also complete themselves when the event happens)

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
| HTTP | POST /v1/spaces/onboarding/complete |
| MCP tool | spaces_onboarding_complete (meta) |
| CLI | none |
| Emits | onboarding.step_completed |

## Input

```ts
type In = {
  step: "photo_title" | "connect_mailbox" | "meet_assistant" | "first_project" | "import";
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
    "step": "photo_title"
  },
  "output": {
    "ok": true
  }
}
```
