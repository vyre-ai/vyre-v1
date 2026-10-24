# templates.list

Gallery of template packages

| | |
|---|---|
| Module | templates |
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
| HTTP | POST /v1/templates/list |
| MCP tool | templates_list (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind?: "agent" | "automation" | "journey" | "record_type" | "runbook" | "project" | "site" | "form" | "portal";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  templates: Array<{
      templateId: string;
      title: string;
      kind: "agent" | "automation" | "journey" | "record_type" | "runbook" | "project" | "site" | "form" | "portal";
      summary: string;
      version: string;
      adds: Array<string>;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "kind": "agent",
    "limit": 1
  },
  "output": {
    "next": "example",
    "templates": [
      {
        "adds": [
          "example"
        ],
        "kind": "agent",
        "summary": "example",
        "templateId": "tpl_a1b2c3",
        "title": "example",
        "version": "example"
      }
    ],
    "total": 1
  }
}
```
