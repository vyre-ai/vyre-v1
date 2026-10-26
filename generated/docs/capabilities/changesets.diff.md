# changesets.diff

Hunks of one file inside a changeset, against its recorded base version

| | |
|---|---|
| Module | files |
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
| HTTP | POST /v1/changesets/diff |
| MCP tool | changesets_diff (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  changesetId: string;
  path: string;
  mode?: "unified" | "split" | "words" | "paragraph";
  context?: "hunks" | "full";
};
```

## Output

```ts
type Out = {
  kind: "text" | "paragraph" | "image" | "binary";
  added: number;
  removed: number;
  hunks: Array<{
      hunkId: string;
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: Array<{
          op: "ctx" | "add" | "del";
          text: string;
          marks?: Array<{
              from: number;
              to: number;
            }>;
        }>;
    }>;
  images?: {
    left?: string;
    right?: string;
  };
  identical: boolean;
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
    "changesetId": "chg_a1b2c3",
    "context": "hunks",
    "mode": "unified",
    "path": "example"
  },
  "output": {
    "added": 1,
    "hunks": [
      {
        "hunkId": "example",
        "lines": [
          {
            "marks": [
              {
                "from": 1,
                "to": 1
              }
            ],
            "op": "ctx",
            "text": "example"
          }
        ],
        "newLines": 1,
        "newStart": 1,
        "oldLines": 1,
        "oldStart": 1
      }
    ],
    "identical": true,
    "images": {
      "left": "blb_a1b2c3",
      "right": "blb_a1b2c3"
    },
    "kind": "text",
    "removed": 1
  }
}
```
