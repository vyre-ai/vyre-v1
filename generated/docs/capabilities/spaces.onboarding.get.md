# spaces.onboarding.get

The first-run checklist for me: steps done, steps left

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
| HTTP | POST /v1/spaces/onboarding/get |
| MCP tool | spaces_onboarding_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  dismissed: boolean;
  steps: Array<{
      key: "photo_title" | "connect_mailbox" | "meet_assistant" | "first_project" | "import";
      title: string;
      done: boolean;
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
    "dismissed": true,
    "steps": [
      {
        "done": true,
        "key": "photo_title",
        "title": "example"
      }
    ]
  }
}
```
