# projects.overview_doc.templates.list

The Space's Overview page templates: Client account, Software project and Hiring, and any saved since

| | |
|---|---|
| Module | projects |
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
| HTTP | POST /v1/projects/overview_doc/templates/list |
| MCP tool | projects_overview_doc_templates_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  templates: Array<{
      templateId: string;
      title: string;
      summary?: string;
      builtin: boolean;
      blocks: number;
      by: string;
      at: number;
    }>;
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
  "input": {},
  "output": {
    "templates": [
      {
        "at": 1760000000000,
        "blocks": 1,
        "builtin": true,
        "by": "example",
        "summary": "example",
        "templateId": "tpl_client_account",
        "title": "example"
      }
    ]
  }
}
```
