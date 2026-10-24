# forms.save_partial

Public: keep the answers typed so far against a signed or one-use link so the person can come back; nothing reaches the record until submit

| | |
|---|---|
| Module | forms |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /f/partial |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  slug: string;
  token: string;
  answers: Record<string, unknown>;
  step?: number;
};
```

## Output

```ts
type Out = {
  saved: boolean;
  expiresAt?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "answers": {},
    "slug": "intake",
    "step": 1,
    "token": "example"
  },
  "output": {
    "expiresAt": 1760000000000,
    "saved": true
  }
}
```
