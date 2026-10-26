# sync_types.discover

List remote objects and their fields with a proposed record type and mapping

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/discover |
| MCP tool | sync_types_discover (engineer) |
| CLI | none |
| Emits | connection.needs_reconnect |

## Input

```ts
type In = {
  connectionId: string;
  remote?: string;
};
```

## Output

```ts
type Out = {
  objects: Array<{
      remote: string;
      title: string;
      fields: Array<{
          remote: string;
          type: string;
          proposedKey: string;
          proposedType: string;
          sensitive: boolean;
        }>;
    }>;
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
    "remote": "example"
  },
  "output": {
    "objects": [
      {
        "fields": [
          {
            "proposedKey": "email",
            "proposedType": "example",
            "remote": "example",
            "sensitive": true,
            "type": "example"
          }
        ],
        "remote": "example",
        "title": "example"
      }
    ]
  }
}
```
