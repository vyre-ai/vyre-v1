# records.comments.edit

Edit your own comment

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/comments/edit |
| MCP tool | records_comments_edit (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  commentId: string;
  text: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "commentId": "rcm_a1b2c3",
    "text": "example"
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
