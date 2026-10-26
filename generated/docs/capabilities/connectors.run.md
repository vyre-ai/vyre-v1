# connectors.run

Run one connector action against the live app, sandboxed to the connector domains, with a dry run option

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | connectors.manage |
| Grant level | use |
| Risk | high |
| Resource | connector (/key) |
| Gate | send when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connectors/run |
| MCP tool | connectors_run (engineer) |
| CLI | vyre connector run |
| Emits | connection.needs_reconnect |

## Input

```ts
type In = {
  key: string;
  action: string;
  connectionId: string;
  input: unknown;
  dryRun?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  output: unknown;
  dryRun: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "action": "example",
    "connectionId": "con_a1b2c3",
    "dryRun": true,
    "idempotencyKey": "idem_1",
    "input": {},
    "key": "hubspot"
  },
  "output": {
    "dryRun": true,
    "output": {}
  }
}
```
