# google.user.remove

Sign out of your own Google account: revoke it at Google and remove its token

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/user/remove |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  accountId: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "accountId": "example"
  },
  "output": {
    "removed": true
  }
}
```
