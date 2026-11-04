# projects.overview_doc.apply_template

Put a template's blocks on a project's Overview, replacing the page (one revision, so Undo brings the old page back)

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
| HTTP | POST /v1/projects/overview_doc/apply_template |
| MCP tool | projects_overview_doc_apply_template (records) |
| CLI | none |
| Emits | project.overview_edited |

## Input

```ts
type In = {
  projectId: string;
  templateId: string;
  baseRev?: number;
};
```

## Output

```ts
type Out = {
  rev: number;
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
    "templateId": "example"
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
    "rev": 1
  }
}
```
