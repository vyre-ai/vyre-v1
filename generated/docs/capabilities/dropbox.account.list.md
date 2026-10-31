# dropbox.account.list

Dropbox accounts you can use: your own and the Space's

| | |
|---|---|
| Module | dropbox |
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
| HTTP | POST /v1/dropbox/account/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  connections: Array<{
      connectionId: string;
      ownerKind: "person" | "space";
      accountId: string;
      email?: string;
      name?: string;
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
    "connections": [
      {
        "accountId": "example",
        "connectionId": "con_a1b2c3",
        "email": "example",
        "name": "example",
        "ownerKind": "person"
      }
    ]
  }
}
```
