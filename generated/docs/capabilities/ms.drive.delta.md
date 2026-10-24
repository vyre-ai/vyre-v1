# ms.drive.delta

Item changes since a delta link (mount sync and mount lag)

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/ms/drive/delta |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  driveId?: string;
  deltaLink?: string;
};
```

## Output

```ts
type Out = {
  changed: Array<{
      id: string;
      name: string;
      size?: number;
      lastModifiedDateTime?: string;
      folder?: boolean;
      webUrl?: string;
      parentId?: string;
    }>;
  removed: Array<string>;
  deltaLink: string;
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
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "deltaLink": "example",
    "driveId": "example"
  },
  "output": {
    "changed": [
      {
        "folder": true,
        "id": "example",
        "lastModifiedDateTime": "example",
        "name": "example",
        "parentId": "example",
        "size": 1,
        "webUrl": "example"
      }
    ],
    "deltaLink": "example",
    "removed": [
      "example"
    ]
  }
}
```
