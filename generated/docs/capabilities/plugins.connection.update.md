# plugins.connection.update

Rename a connection, turn it off or on, switch it to OAuth sign-in, or (admins) choose who in the Space can use it: Everyone or groups

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/plugins/connection/update |
| MCP tool | plugins_connection_update (agents) |
| CLI | none |
| Emits | plugin.connection_changed |

## Input

```ts
type In = {
  connectionId: string;
  title?: string;
  enabled?: boolean;
  auth?: "oauth" | "none";
  share?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  connectionId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "auth": "oauth",
    "connectionId": "mcs_a1b2c3",
    "enabled": true,
    "idempotencyKey": "idem_1",
    "share": [
      "example"
    ],
    "title": "example"
  },
  "output": {
    "connectionId": "mcs_a1b2c3"
  }
}
```
