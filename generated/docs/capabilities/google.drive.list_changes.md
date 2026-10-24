# google.drive.list_changes

Drive changes since a page token (mount sync and mount lag)

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
| HTTP | POST /v1/google/drive/list_changes |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  pageToken: string;
  driveId?: string;
};
```

## Output

```ts
type Out = {
  changes: Array<{
      fileId: string;
      removed: boolean;
      file?: {
        id: string;
        name: string;
        mimeType: string;
        parents?: Array<string>;
        modifiedTime?: string;
        size?: number;
        webViewLink?: string;
        driveId?: string;
      };
    }>;
  newStartPageToken?: string;
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
    "pageToken": "example"
  },
  "output": {
    "changes": [
      {
        "file": {
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
        },
        "fileId": "example",
        "removed": true
      }
    ],
    "newStartPageToken": "example",
    "nextPageToken": "example"
  }
}
```
