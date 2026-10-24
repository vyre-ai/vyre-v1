# ms.drive.upload_item

Upload a Space file into OneDrive or SharePoint

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | post |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ms/drive/upload_item |
| MCP tool | ms_drive_upload_item (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  driveId?: string;
  folderId?: string;
  name: string;
  fileId: string;
  idempotencyKey: string;
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
- provider.network
- provider.unavailable
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
    "fileId": "fil_a1b2c3",
    "folderId": "example",
    "idempotencyKey": "idem_1",
    "name": "example"
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
