# campaigns.replies

Replies that landed in owners Inboxes, marked with the campaign

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | campaign (/campaignId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/campaigns/replies |
| MCP tool | campaigns_replies (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  campaignId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  replies: Array<{
      recordId: string;
      messageId: string;
      at: number;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "campaignId": "cmp_a1b2c3",
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "next": "example",
    "replies": [
      {
        "at": 1760000000000,
        "messageId": "eml_a1b2c3",
        "recordId": "rec_a1b2c3"
      }
    ],
    "total": 1
  }
}
```
