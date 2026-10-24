# templates.project_starters

Starters for New project and New Journey type, an empty one first

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
| HTTP | POST /v1/templates/project_starters |
| MCP tool | templates_project_starters (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind: "project" | "journey";
};
```

## Output

```ts
type Out = {
  starters: Array<{
      templateId: string;
      title: string;
      kind: "agent" | "automation" | "journey" | "record_type" | "runbook" | "project" | "site" | "form" | "portal";
      summary: string;
      version: string;
      adds: Array<string>;
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
  "input": {
    "kind": "project"
  },
  "output": {
    "starters": [
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
    ]
  }
}
```
