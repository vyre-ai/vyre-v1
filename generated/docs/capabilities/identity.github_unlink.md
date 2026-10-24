# identity.github_unlink

Remove the GitHub link

| | |
|---|---|
| Module | identity |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/identity/github_unlink |
| MCP tool | identity_github_unlink (meta) |
| CLI | none |
| Emits | github.unlinked |

## Input

```ts
type In = Record<string, unknown>;
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
  "input": {},
  "output": {
    "ok": true
  }
}
```
