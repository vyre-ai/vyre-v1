# files.comments.resolve

Resolve or reopen a comment

| | |
|---|---|
| Module | files |
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
| HTTP | POST /v1/files/comments/resolve |
| MCP tool | files_comments_resolve (files) |
| CLI | none |
| Emits | file.comment_resolved |

## Input

```ts
type In = {
  commentId: string;
  resolved: boolean;
};
```

## Output

```ts
type Out = {
  comment: {
    commentId: string;
    fileId?: string;
    changesetId?: string;
    versionId?: string;
    anchor: {
      kind: "file" | "line" | "range" | "area" | "page" | "cell";
      line?: number;
      from?: number;
      to?: number;
      page?: number;
      box?: {
        x: number;
        y: number;
        w: number;
        h: number;
      };
      cell?: string;
      quote?: string;
      path?: string;
    };
    pin?: number;
    text: string;
    by: string;
    at: number;
    resolved: boolean;
    mentions: Array<string>;
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
    "commentId": "fcm_a1b2c3",
    "resolved": true
  },
  "output": {
    "comment": {
      "anchor": {
        "box": {
          "h": 1,
          "w": 1,
          "x": 1,
          "y": 1
        },
        "cell": "example",
        "from": 1,
        "kind": "file",
        "line": 1,
        "page": 1,
        "path": "example",
        "quote": "example",
        "to": 1
      },
      "at": 1760000000000,
      "by": "example",
      "changesetId": "chg_a1b2c3",
      "commentId": "fcm_a1b2c3",
      "fileId": "fil_a1b2c3",
      "mentions": [
        "example"
      ],
      "pin": 1,
      "resolved": true,
      "text": "example",
      "versionId": "ver_a1b2c3"
    }
  }
}
```
