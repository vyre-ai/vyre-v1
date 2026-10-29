# spaces.onboarding.flow

My onboarding screen for one flow (personal, team or member): each step done or put off, and whether the screen has opened for me

| | |
|---|---|
| Module | spaces |
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
| HTTP | POST /v1/spaces/onboarding/flow |
| MCP tool | spaces_onboarding_flow (meta) |
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
  seen: boolean;
  steps: Array<{
      key: string;
      state: "done" | "later";
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
  "input": {
    "flow": "personal"
  },
  "output": {
    "seen": true,
    "steps": [
      {
        "key": "ai",
        "state": "done"
      }
    ]
  }
}
```
