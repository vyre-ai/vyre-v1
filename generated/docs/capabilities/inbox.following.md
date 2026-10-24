# inbox.following

Contacts that reach your Inbox and why: owner, project, follow, campaign or shared inbox

| | |
|---|---|
| Module | inbox |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/inbox/following |
| MCP tool | inbox_following (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      contactId: string;
      reasons: Array<"owner" | "project" | "follow" | "campaign" | "shared_inbox">;
      alertOnReplies: boolean;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "next": "example",
    "rows": [
      {
        "alertOnReplies": true,
        "contactId": "rec_a1b2c3",
        "reasons": [
          "owner"
        ]
      }
    ],
    "total": 1
  }
}
```
