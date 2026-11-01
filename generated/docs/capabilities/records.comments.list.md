# records.comments.list

Comments on a record as threads (a root comment and its replies, oldest first); resolved threads only when asked for

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/comments/list |
| MCP tool | records_comments_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  includeResolved?: boolean;
};
```

## Output

```ts
type Out = {
  comments: Array<{
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
    }>;
  resolvedCount: number;
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
    "includeResolved": true,
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "comments": [
      {
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
    ],
    "resolvedCount": 1
  }
}
```
