# google.drive.update_file

Rename a Drive file or folder, move it between folders, or take it back out of the Trash; the file keeps its id, its links and its sharing

| | |
|---|---|
| Module | google |
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
| HTTP | POST /v1/google/drive/update_file |
| MCP tool | google_drive_update_file (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  fileId: string;
  name?: string;
  addParentId?: string;
  removeParentId?: string;
  trashed?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  file: {
    id: string;
    name: string;
    mimeType: string;
    parents?: Array<string>;
    modifiedTime?: string;
    size?: number;
    webViewLink?: string;
    driveId?: string;
    headRevisionId?: string;
    lastModifyingUser?: {
      name?: string;
      email?: string;
    };
    trashed?: boolean;
    canEdit?: boolean;
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
    "addParentId": "example",
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "fileId": "example",
    "idempotencyKey": "idem_1",
    "name": "example",
    "removeParentId": "example",
    "trashed": true
  },
  "output": {
    "file": {
      "canEdit": true,
      "driveId": "example",
      "headRevisionId": "example",
      "id": "example",
      "lastModifyingUser": {
        "email": "example",
        "name": "example"
      },
      "mimeType": "example",
      "modifiedTime": "example",
      "name": "example",
      "parents": [
        "example"
      ],
      "size": 1,
      "trashed": true,
      "webViewLink": "example"
    }
  }
}
```
