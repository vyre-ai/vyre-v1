# ms.mail.list_folders

List mail folders of the member

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
| HTTP | POST /v1/ms/mail/list_folders |
| MCP tool | ms_mail_list_folders (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
};
```

## Output

```ts
type Out = {
  folders: Array<{
      id: string;
      displayName: string;
      unreadItemCount?: number;
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
    "connectionId": "con_a1b2c3"
  },
  "output": {
    "folders": [
      {
        "displayName": "example",
        "id": "example",
        "unreadItemCount": 1
      }
    ]
  }
}
```
