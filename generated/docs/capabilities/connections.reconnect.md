# connections.reconnect

Start signing in again; returns the provider sign-in address when one is needed

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connections/reconnect |
| MCP tool | connections_reconnect (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
};
```

## Output

```ts
type Out = {
  authUrl?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3"
  },
  "output": {
    "authUrl": "example"
  }
}
```
