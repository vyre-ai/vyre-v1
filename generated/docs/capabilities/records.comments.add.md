# records.comments.add

Comment on a record or reply to a comment; @ people and agents. A mentioned person gets an Answer request in Needs you; a mentioned agent answers under the comment, headless (no chat is made)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/comments/add |
| MCP tool | records_comments_add (records) |
| CLI | none |
| Emits | record.comment_added |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  text: string;
  parentId?: string;
  mentions?: Array<{
      kind: "person" | "agent";
      id: string;
    }>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  comment: {
    commentId: string;
    type: string;
    recordId: string;
    parentId?: string;
    text: string;
    by: string;
    at: number;
    editedAt?: number;
    resolved: boolean;
    resolvedBy?: string;
    mentions: Array<{
        kind: "person" | "agent";
        id: string;
      }>;
    replying: Array<string>;
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
    "idempotencyKey": "idem_1",
    "mentions": [
      {
        "id": "usr_a1b2c3",
        "kind": "person"
      }
    ],
    "parentId": "example",
    "recordId": "rec_a1b2c3",
    "text": "example",
    "type": "contact"
  },
  "output": {
    "comment": {
      "at": 1760000000000,
      "by": "example",
      "commentId": "rcm_a1b2c3",
      "editedAt": 1760000000000,
      "mentions": [
        {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      ],
      "parentId": "example",
      "recordId": "rec_a1b2c3",
      "replying": [
        "agt_a1b2c3"
      ],
      "resolved": true,
      "resolvedBy": "example",
      "text": "example",
      "type": "contact"
    }
  }
}
```
