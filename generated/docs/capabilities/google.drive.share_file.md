# google.drive.share_file

Share a Drive file with people; Google emails them

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/drive/share_file |
| MCP tool | google_drive_share_file (files, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  fileId: string;
  emails: Array<string>;
  role: "reader" | "commenter" | "writer";
  notify?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  shared: boolean;
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
    "emails": [
      "maya@example.com"
    ],
    "fileId": "example",
    "idempotencyKey": "idem_1",
    "notify": true,
    "role": "reader"
  },
  "output": {
    "shared": true
  }
}
```
