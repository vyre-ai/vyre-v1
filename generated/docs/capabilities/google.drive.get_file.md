# google.drive.get_file

Read Drive file metadata

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
| HTTP | POST /v1/google/drive/get_file |
| MCP tool | google_drive_get_file (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  fileId: string;
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
    "fileId": "example"
  },
  "output": {
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
    }
  }
}
```
