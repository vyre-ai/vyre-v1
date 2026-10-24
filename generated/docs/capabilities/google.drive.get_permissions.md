# google.drive.get_permissions

Who a Drive file is shared with

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
| HTTP | POST /v1/google/drive/get_permissions |
| MCP tool | google_drive_get_permissions (files, deferred) |
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
  permissions: Array<{
      id: string;
      role: string;
      type: string;
      emailAddress?: string;
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
    "permissions": [
      {
        "emailAddress": "maya@example.com",
        "id": "example",
        "role": "example",
        "type": "example"
      }
    ]
  }
}
```
