# google.drive.list_files

List or search Drive files and folders (My Drive and Shared Drives)

| | |
|---|---|
| Module | google |
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
| HTTP | POST /v1/google/drive/list_files |
| MCP tool | google_drive_list_files (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  q?: string;
  driveId?: string;
  parentId?: string;
  pageToken?: string;
  pageSize?: number;
};
```

## Output

```ts
type Out = {
  files: Array<{
      id: string;
      name: string;
      mimeType: string;
      parents?: Array<string>;
      modifiedTime?: string;
      size?: number;
      webViewLink?: string;
      driveId?: string;
    }>;
  nextPageToken?: string;
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
    "pageSize": 1,
    "pageToken": "example",
    "parentId": "example",
    "q": "example"
  },
  "output": {
    "files": [
      {
        "driveId": "example",
        "id": "example",
        "mimeType": "example",
        "modifiedTime": "example",
        "name": "example",
        "parents": [
          "example"
        ],
        "size": 1,
        "webViewLink": "example"
      }
    ],
    "nextPageToken": "example"
  }
}
```
