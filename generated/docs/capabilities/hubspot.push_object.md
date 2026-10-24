# hubspot.push_object

Push one record change to HubSpot (stores the replaced value so the push can be undone)

| | |
|---|---|
| Module | hubspot |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/hubspot/push_object |
| MCP tool | hubspot_push_object (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  objectType: string;
  remoteId?: string;
  properties: Record<string, unknown>;
};
```

## Output

```ts
type Out = {
  remoteId: string;
  replaced?: Record<string, unknown>;
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
    "connectionId": "con_a1b2c3",
    "objectType": "example",
    "properties": {},
    "remoteId": "example"
  },
  "output": {
    "remoteId": "example",
    "replaced": {}
  }
}
```
