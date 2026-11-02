# identity.sso_link

Start proving a provider identity is yours: the address to finish a sign-in at. Whatever comes back is bound to you; a provider id already linked to someone else stays theirs

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
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/identity/sso_link |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  provider: string;
};
```

## Output

```ts
type Out = {
  start: string;
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
    "provider": "google"
  },
  "output": {
    "start": "example"
  }
}
```
