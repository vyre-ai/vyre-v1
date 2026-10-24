# identity.username_available

Check a username is free (join page)

| | |
|---|---|
| Module | identity |
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
| HTTP | POST /v1/identity/username_available |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  username: string;
};
```

## Output

```ts
type Out = {
  available: boolean;
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
    "username": "maya"
  },
  "output": {
    "available": true
  }
}
```
