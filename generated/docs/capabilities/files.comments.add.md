# files.comments.add

Comment on a file, a range, a cell, a page or an area (area comments are numbered pins); @ people and agents

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/comments/add |
| MCP tool | files_comments_add (files) |
| CLI | none |
| Emits | file.comment_added |

## Input

```ts
type In = {
  fileId: string;
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
  text: string;
  versionId?: string;
  mentions?: Array<string>;
  idempotencyKey: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
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
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "mentions": [
      "example"
    ],
    "text": "example",
    "versionId": "ver_a1b2c3"
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
