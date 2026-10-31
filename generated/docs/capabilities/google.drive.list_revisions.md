# google.drive.list_revisions

The revisions Drive keeps of a file, with who saved each

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
| HTTP | POST /v1/google/drive/list_revisions |
| MCP tool | google_drive_list_revisions (files, deferred) |
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
  revisions: Array<{
      id: string;
      modifiedTime: string;
      size?: number;
      lastModifyingUser?: {
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
    "fileId": "example"
  },
  "output": {
    "revisions": [
      {
        "id": "example",
        "lastModifyingUser": {
          "email": "example",
          "name": "example"
        },
        "modifiedTime": "example",
        "size": 1
      }
    ]
  }
}
```
