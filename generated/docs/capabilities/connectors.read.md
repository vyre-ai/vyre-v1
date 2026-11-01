# connectors.read

Run one read action (a GET) of a connector against the live app, for the sync engine: reads are not held at the Gate for the person or agent the pass runs as, writes never go through here

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | connectors.manage |
| Grant level | use |
| Risk | high |
| Resource | connector (/key) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connectors/read |
| MCP tool | none |
| CLI | none |
| Emits | connection.needs_reconnect |

## Input

```ts
type In = {
  key: string;
  action: string;
  connectionId: string;
  input: unknown;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  output: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "action": "example",
    "connectionId": "con_a1b2c3",
    "idempotencyKey": "idem_1",
    "input": {},
    "key": "hubspot"
  },
  "output": {
    "output": {}
  }
}
```
