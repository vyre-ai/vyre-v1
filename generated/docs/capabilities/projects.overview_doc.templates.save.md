# projects.overview_doc.templates.save

Save a page template for the Space, from a project's Overview or from blocks; an agent can too

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/overview_doc/templates/save |
| MCP tool | projects_overview_doc_templates_save (records) |
| CLI | none |
| Emits | project.overview_template_saved |

## Input

```ts
type In = {
  title: string;
  summary?: string;
  projectId?: string;
  blocks?: Array<{
      id?: string;
      kind: "text" | "heading" | "live";
      text?: string;
      level?: number;
      live?: {
        type: "tasks" | "milestones" | "links" | "records" | "metric" | "ci" | "goal" | "people" | "status";
        spec: Record<string, unknown>;
        view?: "list" | "table" | "count" | "cards";
      };
    }>;
  templateId?: string;
};
```

## Output

```ts
type Out = {
  template: {
    templateId: string;
    title: string;
    summary?: string;
    builtin: boolean;
    blocks: number;
    by: string;
    at: number;
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
    "blocks": [
      {
        "id": "example",
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
    "projectId": "prj_a1b2c3",
    "summary": "example",
    "templateId": "example",
    "title": "example"
  },
  "output": {
    "template": {
      "at": 1760000000000,
      "blocks": 1,
      "builtin": true,
      "by": "example",
      "summary": "example",
      "templateId": "tpl_client_account",
      "title": "example"
    }
  }
}
```
