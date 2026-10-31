# dropbox.connect.start

Start signing in to Dropbox: the address to approve at (your own Dropbox, or the Space's with admin rights)

| | |
|---|---|
| Module | dropbox |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/dropbox/connect/start |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  ownerKind?: "person" | "space";
};
```

## Output

```ts
type Out = {
  authUrl: string;
  state: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "ownerKind": "person"
  },
  "output": {
    "authUrl": "example",
    "state": "example"
  }
}
```
