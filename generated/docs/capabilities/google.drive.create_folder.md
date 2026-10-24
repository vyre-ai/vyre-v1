# google.drive.create_folder

Create a Drive folder

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
| HTTP | POST /v1/google/drive/create_folder |
| MCP tool | google_drive_create_folder (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  name: string;
  parentId?: string;
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
    "idempotencyKey": "idem_1",
    "name": "example",
    "parentId": "example"
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
