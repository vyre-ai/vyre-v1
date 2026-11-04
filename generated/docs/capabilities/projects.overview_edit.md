# projects.overview_edit

Edit the Overview by ops: insert, update, move, delete a block, or set_property on a custom field of the project. One revision for the call, carrying its author; an agent's edit leaves one quiet line in the project channel

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/overview_edit |
| MCP tool | overview_edit (records) |
| CLI | none |
| Emits | project.overview_edited |

## Input

```ts
type In = {
  projectId: string;
  ops: Array<{
      op: "insert" | "update" | "move" | "delete" | "set_property";
      id?: string;
      after?: string;
      block?: {
        id?: string;
        kind: "text" | "heading" | "live";
        text?: string;
        level?: number;
        live?: {
          type: "tasks" | "milestones" | "links" | "records" | "metric" | "ci" | "goal" | "people" | "status";
          spec: Record<string, unknown>;
          view?: "list" | "table" | "count" | "cards";
        };
      };
      key?: string;
      value?: unknown;
    }>;
  baseRev?: number;
};
```

## Output

```ts
type Out = {
  rev: number;
  summary: string;
  blocks: Array<{
      id: string;
      kind: "text" | "heading" | "live";
      text?: string;
      level?: number;
      live?: {
        type: "tasks" | "milestones" | "links" | "records" | "metric" | "ci" | "goal" | "people" | "status";
        spec: Record<string, unknown>;
        view?: "list" | "table" | "count" | "cards";
      };
      by?: string;
      at?: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "baseRev": 1,
    "ops": [
      {
        "after": "example",
        "block": {
          "id": "example",
          "kind": "text",
          "level": 1,
          "live": {
            "spec": {},
            "type": "tasks",
            "view": "list"
          },
          "text": "example"
        },
        "id": "example",
        "key": "example",
        "op": "insert",
        "value": {}
      }
    ],
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "blocks": [
      {
        "at": 1760000000000,
        "by": "example",
        "id": "blk_a1b2c3",
        "kind": "text",
        "level": 1,
        "live": {
          "spec": {},
          "type": "tasks",
          "view": "list"
        },
        "text": "example"
      }
    ],
    "rev": 1,
    "summary": "example"
  }
}
```
