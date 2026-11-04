# projects.live_block.query

Evaluate a live block for the reader: the rows they may open, how many they may not (hidden), and for a metric its value. The block stores only its spec

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/live_block/query |
| MCP tool | projects_live_block_query (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
  blockId?: string;
  type?: "tasks" | "milestones" | "links" | "records" | "metric" | "ci" | "goal" | "people" | "status";
  spec?: Record<string, unknown>;
};
```

## Output

```ts
type Out = {
  type: "tasks" | "milestones" | "links" | "records" | "metric" | "ci" | "goal" | "people" | "status";
  rows: Array<{
      id: string;
      title: string;
      state?: string;
      detail?: string;
      url?: string;
      who?: string;
      due?: number;
    }>;
  hidden: number;
  total: number;
  value?: number;
  label?: string;
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
    "blockId": "example",
    "projectId": "prj_a1b2c3",
    "spec": {},
    "type": "tasks"
  },
  "output": {
    "hidden": 1,
    "label": "example",
    "rows": [
      {
        "detail": "example",
        "due": 1760000000000,
        "id": "example",
        "state": "example",
        "title": "example",
        "url": "example",
        "who": "example"
      }
    ],
    "total": 1,
    "type": "tasks",
    "value": 1
  }
}
```
