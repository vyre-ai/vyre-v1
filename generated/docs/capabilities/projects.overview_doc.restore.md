# projects.overview_doc.restore

Bring an older version of the Overview back: its blocks become the page again, as a new revision (so the restore can be undone)

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
| HTTP | POST /v1/projects/overview_doc/restore |
| MCP tool | projects_overview_doc_restore (records) |
| CLI | none |
| Emits | project.overview_edited |

## Input

```ts
type In = {
  projectId: string;
  rev: number;
  baseRev?: number;
};
```

## Output

```ts
type Out = {
  rev: number;
  restored: number;
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
    "projectId": "prj_a1b2c3",
    "rev": 1
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
    "restored": 1,
    "rev": 1
  }
}
```
