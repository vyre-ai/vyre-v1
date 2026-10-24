# ms.drive.get_item

Read item metadata

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
| HTTP | POST /v1/ms/drive/get_item |
| MCP tool | ms_drive_get_item (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  driveId?: string;
  itemId: string;
};
```

## Output

```ts
type Out = {
  item: {
    id: string;
    name: string;
    size?: number;
    lastModifiedDateTime?: string;
    folder?: boolean;
    webUrl?: string;
    parentId?: string;
  };
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
    "driveId": "example",
    "itemId": "example"
  },
  "output": {
    "item": {
      "folder": true,
      "id": "example",
      "lastModifiedDateTime": "example",
      "name": "example",
      "parentId": "example",
      "size": 1,
      "webUrl": "example"
    }
  }
}
```
