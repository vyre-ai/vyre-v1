# files.marks.add

Highlight part of a file for the team, or hide it from AI (a span, a box on a scan or picture, a transcript range, or a piece of the name); anyone who can open the file may

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/marks/add |
| MCP tool | files_redact (files) |
| CLI | none |
| Emits | file.redacted, file.highlighted |

## Input

```ts
type In = {
  target: {
    type: "file" | "folder";
    id: string;
  };
  kind: "redact" | "highlight";
  shape: "span" | "box" | "range" | "name";
  text?: string;
  occurrence?: number;
  page?: number;
  box?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  from?: number;
  to?: number;
  label?: string;
  via?: "select" | "check" | "box" | "range" | "name";
};
```

## Output

```ts
type Out = {
  mark: {
    markId: string;
    targetId: string;
    version: number;
    kind: "redact" | "highlight";
    shape: "span" | "box" | "range" | "name";
    text?: string;
    occurrence?: number;
    page?: number;
    box?: {
      x: number;
      y: number;
      w: number;
      h: number;
    };
    from?: number;
    to?: number;
    label?: string;
    by: string;
    byAgent?: string;
    via?: string;
    at: number;
    unplaced: boolean;
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
    "box": {
      "h": 1,
      "w": 1,
      "x": 1,
      "y": 1
    },
    "from": 1,
    "kind": "redact",
    "label": "example",
    "occurrence": 1,
    "page": 1,
    "shape": "span",
    "target": {
      "id": "fil_a1b2c3",
      "type": "file"
    },
    "text": "example",
    "to": 1,
    "via": "select"
  },
  "output": {
    "mark": {
      "at": 1760000000000,
      "box": {
        "h": 1,
        "w": 1,
        "x": 1,
        "y": 1
      },
      "by": "example",
      "byAgent": "example",
      "from": 1,
      "kind": "redact",
      "label": "example",
      "markId": "mrk_a1b2c3",
      "occurrence": 1,
      "page": 1,
      "shape": "span",
      "targetId": "example",
      "text": "example",
      "to": 1,
      "unplaced": true,
      "version": 1,
      "via": "example"
    }
  }
}
```
