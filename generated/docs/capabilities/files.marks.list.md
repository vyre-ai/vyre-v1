# files.marks.list

The redactions and highlights on a file, its review for AI, what a new version could not place, and agents waiting to read it

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/marks/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  state: "available" | "reviewed" | "needs_review" | "off";
  access: {
    value: "on" | "redact" | "off";
    own: boolean;
    inherited: "on" | "redact" | "off";
    from?: {
      kind: "file" | "folder";
      id: string;
      name: string;
    };
    setBy?: string;
    setAt?: number;
    overrides?: Array<{
        kind: "file" | "folder";
        id: string;
        name: string;
        value: "on" | "redact" | "off";
      }>;
    files?: number;
  };
  version: number;
  reviewed?: {
    by: string;
    at: number;
    version: number;
  };
  marks: Array<{
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
    }>;
  unplaced: Array<{
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
    }>;
  names: Array<{
      markId: string;
      text: string;
    }>;
  requests: Array<{
      requestId: string;
      agentId?: string;
      actingFor?: string;
      at: number;
    }>;
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
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "access": {
      "files": 1,
      "from": {
        "id": "example",
        "kind": "file",
        "name": "example"
      },
      "inherited": "on",
      "overrides": [
        {
          "id": "example",
          "kind": "file",
          "name": "example",
          "value": "on"
        }
      ],
      "own": true,
      "setAt": 1760000000000,
      "setBy": "example",
      "value": "on"
    },
    "marks": [
      {
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
    ],
    "names": [
      {
        "markId": "mrk_a1b2c3",
        "text": "example"
      }
    ],
    "requests": [
      {
        "actingFor": "example",
        "agentId": "example",
        "at": 1760000000000,
        "requestId": "rrq_a1b2c3"
      }
    ],
    "reviewed": {
      "at": 1760000000000,
      "by": "example",
      "version": 1
    },
    "state": "available",
    "unplaced": [
      {
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
    ],
    "version": 1
  }
}
```
