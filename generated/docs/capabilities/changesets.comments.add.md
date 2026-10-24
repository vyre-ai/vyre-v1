# changesets.comments.add

Add an inline comment to a changeset with @ people and agents (an @ agent answers in the thread)

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/changesets/comments/add |
| MCP tool | changesets_comments_add (files) |
| CLI | none |
| Emits | file.comment_added |

## Input

```ts
type In = {
  changesetId: string;
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
    "changesetId": "chg_a1b2c3",
    "idempotencyKey": "idem_1",
    "mentions": [
      "example"
    ],
    "text": "example"
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
