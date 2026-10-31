# ms.drive.list_versions

The versions OneDrive or SharePoint keeps of an item, with who saved each

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
| HTTP | POST /v1/ms/drive/list_versions |
| MCP tool | ms_drive_list_versions (files, deferred) |
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
  versions: Array<{
      id: string;
      lastModifiedDateTime: string;
      size?: number;
      lastModifiedBy?: {
        name?: string;
        email?: string;
      };
    }>;
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
    "versions": [
      {
        "id": "example",
        "lastModifiedBy": {
          "email": "example",
          "name": "example"
        },
        "lastModifiedDateTime": "example",
        "size": 1
      }
    ]
  }
}
```
